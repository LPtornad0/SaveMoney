// Vérifie la décision de fermeture (garde) avec des dépendances simulées.
// Ces tests ne prouvent pas que la fenêtre Tauri se ferme : c'est le rôle des tests manuels.
// Usage : node scripts/verify-close-gate.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src", "utils", "closeGate.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleObject = { exports: {} };
new Function("module", "exports", outputText)(moduleObject, moduleObject.exports);
const { createCloseGate, CLOSE_BLOCKED_MESSAGE, CLOSE_FAILED_MESSAGE } = moduleObject.exports;

// Harnais : `flushResult` et `closeError` pilotent les réponses ; `calls` trace les appels.
function createGate({ pending = true, flushResult = { failed: 0 }, flushError, closeError, flushGate } = {}) {
  const calls = { flush: 0, close: 0 };
  const blocked = [];
  let hasPending = pending;
  const gate = createCloseGate({
    hasPending: () => hasPending,
    // Comme la file réelle : une opération échouée n'est plus en attente après finalisation.
    flush: async () => {
      calls.flush += 1;
      try {
        if (flushGate) await flushGate;
        if (flushError) throw flushError;
        return flushResult;
      } finally {
        hasPending = false;
      }
    },
    close: async () => {
      calls.close += 1;
      if (closeError) throw closeError;
    },
    onBlocked: (message) => blocked.push(message),
  });
  return { gate, calls, blocked };
}

const event = () => {
  const ev = { prevented: false, preventDefault() { this.prevented = true; } };
  return ev;
};

// 1. Aucune suppression en attente : fermeture normale, rien n'est bloqué
{
  const { gate, calls } = createGate({ pending: false });
  const ev = event();
  await gate(ev);
  assert.equal(ev.prevented, false);
  assert.equal(calls.flush, 0);
  assert.equal(calls.close, 0, "la fermeture est laissée au comportement par défaut");
  console.log("OK  rien en attente : fermeture normale, sans finalisation");
}

// 2. Suppressions en attente : fermeture suspendue, finalisée, puis fermée une seule fois
{
  const { gate, calls, blocked } = createGate();
  const ev = event();
  await gate(ev);
  assert.equal(ev.prevented, true, "la fermeture est suspendue");
  assert.equal(calls.flush, 1);
  assert.equal(calls.close, 1, "la fenêtre est fermée après réussite");
  assert.equal(blocked.length, 0);
  console.log("OK  en attente : finalisation puis fermeture une seule fois");
}

// 3. Demandes simultanées : une seule finalisation, une seule fermeture
{
  let release;
  const flushGate = new Promise((resolve) => { release = resolve; });
  const { gate, calls } = createGate({ flushGate });
  const first = gate(event());
  const second = gate(event());
  const third = gate(event());
  release();
  await Promise.all([first, second, third]);
  assert.equal(calls.flush, 1, "une seule finalisation pour trois demandes");
  assert.equal(calls.close, 1, "une seule fermeture");
  console.log("OK  demandes simultanées : une seule finalisation et une seule fermeture");
}

// 4. Échec d'une suppression : fenêtre ouverte, message affiché
{
  const { gate, calls, blocked } = createGate({ flushResult: { failed: 1 } });
  await gate(event());
  assert.equal(calls.close, 0, "la fenêtre reste ouverte");
  assert.deepEqual(blocked, [CLOSE_BLOCKED_MESSAGE]);
  console.log("OK  échec de suppression : fenêtre ouverte et message affiché");
}

// 5. Erreur pendant la finalisation : fenêtre ouverte, pas d'exception remontée
{
  const { gate, calls, blocked } = createGate({ flushError: new Error("boom") });
  await gate(event());
  assert.equal(calls.close, 0);
  assert.deepEqual(blocked, [CLOSE_BLOCKED_MESSAGE]);
  console.log("OK  erreur de finalisation : fenêtre ouverte, message affiché");
}

// 6. Échec de la fermeture elle-même (permission absente, par exemple) : message, pas de boucle
{
  const { gate, calls, blocked } = createGate({ closeError: new Error("denied") });
  await gate(event());
  assert.equal(calls.close, 1);
  assert.deepEqual(blocked, [CLOSE_FAILED_MESSAGE]);
  console.log("OK  fermeture refusée : message affiché, aucune boucle");
}

// 7. La demande de fermeture renvoyée après finalisation n'est pas bloquée (absence de boucle)
{
  const { gate, calls } = createGate();
  await gate(event()); // finalise et ferme
  const again = event();
  await gate(again);
  assert.equal(again.prevented, false, "la fermeture renvoyée ne doit pas être suspendue");
  assert.equal(calls.flush, 1, "pas de nouvelle finalisation");
  console.log("OK  fermeture renvoyée par Tauri : laissée passer, sans boucle");
}

// 8. Échec de suppression : première fermeture annulée, deuxième demande explicite acceptée, aucune nouvelle tentative SQL
{
  const { gate, calls, blocked } = createGate({ flushResult: { failed: 1 } });
  const first = event();
  await gate(first);
  assert.equal(first.prevented, true);
  assert.deepEqual(blocked, [CLOSE_BLOCKED_MESSAGE]);
  const second = event();
  await gate(second);
  assert.equal(second.prevented, false, "la deuxième demande passe si rien n'est en attente");
  assert.equal(calls.flush, 1, "aucune nouvelle finalisation automatique");
  assert.equal(calls.close, 0, "la fermeture par défaut ne passe pas par close()");
  console.log("OK  échec de suppression : première fermeture annulée, deuxième acceptée, sans nouvelle tentative");
}

// 9. Erreur de fermeture après réussite des suppressions : message distinct, aucune restauration
{
  const { gate, calls, blocked } = createGate({ closeError: new Error("denied") });
  await gate(event());
  assert.equal(calls.flush, 1, "les suppressions ont été finalisées une seule fois");
  assert.deepEqual(blocked, [CLOSE_FAILED_MESSAGE], "message de fermeture, pas d'échec de suppression");
  assert.notEqual(CLOSE_FAILED_MESSAGE, CLOSE_BLOCKED_MESSAGE);
  console.log("OK  erreur de fermeture après réussite : message distinct, suppressions non restaurées");
}

console.log("Toutes les vérifications de la garde de fermeture sont passées.");
