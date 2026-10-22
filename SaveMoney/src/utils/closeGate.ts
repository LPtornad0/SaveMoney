import { requestEditTransition } from "./inlineEdit";
/**
 * Decides what a window close request does while deletions are pending.
 * The Tauri listener is wired in Dashboard; this module only holds the decision,
 * so it can be tested without a window.
 */

export interface CloseRequest {
  preventDefault: () => void;
}

export interface CloseGateDeps {
  hasPending: () => boolean;
  // Finalizes every pending deletion; resolves with the number that failed.
  flush: () => Promise<{ failed: number }>;
  close: () => Promise<void>;
  // Called when the window stays open; the message is shown to the user.
  onBlocked: (message: string) => void;
}

export const CLOSE_BLOCKED_MESSAGE = "La fermeture est annulée : une suppression n'a pas pu être finalisée.";
export const CLOSE_FAILED_MESSAGE = "La fermeture a échoué. La fenêtre reste ouverte.";

export function createCloseGate(deps: CloseGateDeps): (event: CloseRequest) => Promise<void> {
  let inProgress: Promise<void> | null = null;

  const finalizeAndClose = async (): Promise<void> => {
    let failed: number;
    try {
      ({ failed } = await deps.flush());
    } catch {
      failed = 1;
    }
    if (failed > 0) {
      deps.onBlocked(CLOSE_BLOCKED_MESSAGE);
      return;
    }
    try {
      // This close request is seen again by the gate: with nothing pending it is not blocked, so there is no loop.
      await deps.close();
    } catch {
      deps.onBlocked(CLOSE_FAILED_MESSAGE);
    }
  };

  return (event) => {
    // Nothing pending or running: the default close goes ahead.
    if (!deps.hasPending()) return Promise.resolve();

    event.preventDefault();
    // Several close requests while finalizing share one run.
    if (!inProgress) {
      inProgress = finalizeAndClose().finally(() => {
        inProgress = null;
      });
    }
    return inProgress;
  };
}

export interface EditAwareCloseDeps {
  // True while a save of an edit runs: the close is refused and the user is told.
  isSaving: () => boolean;
  // True when the edited draft differs from the saved values.
  isDirty: () => boolean;
  // Asks before dropping a changed draft (window.confirm in the Dashboard).
  confirmDiscard: () => boolean;
  onSaving: () => void;
  // Drops the edit once the user agreed, so nothing remains to be saved.
  discardEdit: () => void;
  // The gate above: it only finalizes pending deletions after this check has let the close go ahead.
  gate: (event: CloseRequest) => Promise<void>;
}

// Checks the unsaved edit before the deletion gate runs. A refusal stops here: flush is never called,
// and a deletion already waiting keeps its normal timer.
export function createEditAwareClose(deps: EditAwareCloseDeps): (event: CloseRequest) => Promise<void> {
  return async (event) => {
    if (deps.isSaving()) {
      event.preventDefault();
      deps.onSaving();
      return;
    }
    const decision = requestEditTransition(
      { dirty: deps.isDirty(), saving: false },
      deps.confirmDiscard
    );
    if (decision === "blocked") {
      event.preventDefault();
      return;
    }
    deps.discardEdit();
    await deps.gate(event);
  };
}
