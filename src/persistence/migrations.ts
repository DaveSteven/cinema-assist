import type { DatabaseSync } from "node:sqlite";

export type Migration = {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
};

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "create_watch_tables",
    up(db) {
      db.exec(`
        CREATE TABLE watch_rules (
          id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1,
          theater_code TEXT NOT NULL,
          movie_title_pattern TEXT NOT NULL,
          target_date TEXT NOT NULL,
          format_includes TEXT NOT NULL DEFAULT '[]',
          format_excludes TEXT NOT NULL DEFAULT '[]',
          start_time_from TEXT,
          start_time_to TEXT,
          ticket_count INTEGER NOT NULL DEFAULT 1,
          require_adjacent INTEGER NOT NULL DEFAULT 1,
          preferred_rows TEXT,
          excluded_rows TEXT,
          preferred_seat_numbers TEXT,
          aisle_preference TEXT NOT NULL DEFAULT 'none',
          mode TEXT NOT NULL DEFAULT 'notify',
          member_tier TEXT NOT NULL DEFAULT 'none',
          sale_opens_at_override TEXT,
          last_state TEXT,
          last_notification_key TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE watch_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_id TEXT NOT NULL,
          at TEXT NOT NULL,
          state TEXT NOT NULL,
          performance_id TEXT,
          detail TEXT,
          FOREIGN KEY (rule_id) REFERENCES watch_rules(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_watch_events_rule ON watch_events (rule_id, id);
      `);
    },
  },
  {
    version: 2,
    name: "add_seat_type_constraints",
    up(db) {
      db.exec(`
        ALTER TABLE watch_rules ADD COLUMN allowed_seat_types TEXT NOT NULL DEFAULT '["standard"]';
        ALTER TABLE watch_rules ADD COLUMN excluded_seat_types TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE watch_rules ADD COLUMN max_surcharge_yen INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as {
    version: number;
  }[];
  const applied = new Set(appliedRows.map((row) => Number(row.version)));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN");
    try {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
