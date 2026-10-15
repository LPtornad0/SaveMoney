import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!isTauri()) {
    throw new Error("Cette app doit être lancée via Tauri. Utilisez la commande: npm.cmd run tauri dev");
  }

  if (!dbPromise) {
    dbPromise = Database.load("sqlite:save_money.db");
  }
  return dbPromise;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  color TEXT
);

CREATE TABLE IF NOT EXISTS incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  category_id INTEGER,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  category_id INTEGER,
  day_of_month INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  category_id INTEGER,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
`;

const DEFAULT_CATEGORIES: Array<{ name: string; type: "income" | "expense" }> = [
  { name: "Salaire", type: "income" },
  { name: "Autre revenu", type: "income" },
  { name: "Assurance", type: "expense" },
  { name: "Abonnement", type: "expense" },
  { name: "Alimentation", type: "expense" },
  { name: "Transport", type: "expense" },
  { name: "Loisirs", type: "expense" },
  { name: "Logement", type: "expense" },
  { name: "Autre", type: "expense" },
  { name: "Épargne", type: "expense" },
];

export async function initSchema() {
  const db = await getDb();
  await db.execute(SCHEMA_SQL);

  const existing = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM categories"
  );

  if (existing[0]?.count === 0) {
    // Fresh install - insert all default categories
    for (const cat of DEFAULT_CATEGORIES) {
      await db.execute(
        "INSERT INTO categories (name, type) VALUES (?, ?)",
        [cat.name, cat.type]
      );
    }
  } else {
    // Existing database - check if Épargne category exists, add if missing
    const epargneExists = await db.select<{ count: number }[]>(
      "SELECT COUNT(*) as count FROM categories WHERE name = ?",
      ["Épargne"]
    );

    if (epargneExists[0]?.count === 0) {
      await db.execute(
        "INSERT INTO categories (name, type) VALUES (?, ?)",
        ["Épargne", "expense"]
      );
    }
  }
}
