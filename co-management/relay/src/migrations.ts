import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlPool } from "./postgres-store.ts";

const MIGRATION_NAME = /^\d{3}_[a-z0-9_-]+\.sql$/u;
const MIGRATION_LOCK_ID = 730_428_911;

export interface AppliedMigration {
  name: string;
  checksum: string;
}

export function defaultMigrationsDirectory(): string {
  return resolve(fileURLToPath(new URL("../migrations", import.meta.url)));
}

export async function applyMigrations(pool: SqlPool, directory = defaultMigrationsDirectory()): Promise<AppliedMigration[]> {
  const entries = (await fs.readdir(directory))
    .filter((name) => MIGRATION_NAME.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (entries.length === 0) throw new Error("no-database-migrations");

  const client = await pool.connect();
  const applied: AppliedMigration[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS co_management_schema_migrations (
         name TEXT PRIMARY KEY,
         checksum CHAR(64) NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    for (const entry of entries) {
      const path = resolve(directory, entry);
      if (basename(path) !== entry) throw new Error("invalid-migration-path");
      const sql = await fs.readFile(path, "utf8");
      const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM co_management_schema_migrations WHERE name = $1",
        [entry],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum.trim() !== checksum) throw new Error("database-migration-checksum-mismatch:" + entry);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO co_management_schema_migrations (name, checksum) VALUES ($1, $2)",
          [entry, checksum],
        );
        await client.query("COMMIT");
        applied.push({ name: entry, checksum });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    } finally {
      client.release?.();
    }
  }
  return applied;
}

export async function verifyMigrations(pool: SqlPool, directory = defaultMigrationsDirectory()): Promise<void> {
  const entries = (await fs.readdir(directory))
    .filter((name) => MIGRATION_NAME.test(name))
    .sort((left, right) => left.localeCompare(right));
  const result = await pool.query<{ name: string; checksum: string }>(
    "SELECT name, checksum FROM co_management_schema_migrations ORDER BY name",
  );
  const byName = new Map(result.rows.map((row) => [row.name, row.checksum.trim()]));
  for (const entry of entries) {
    const sql = await fs.readFile(resolve(directory, entry), "utf8");
    const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
    if (byName.get(entry) !== checksum) throw new Error("database-migration-required:" + entry);
  }
}
