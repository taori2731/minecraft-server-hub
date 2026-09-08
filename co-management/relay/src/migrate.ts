import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { applyMigrations } from "./migrations.ts";

function databasePool(): Pool {
  const connectionString = process.env.MSH_CO_MANAGEMENT_MIGRATION_DATABASE_URL
    ?? process.env.MSH_CO_MANAGEMENT_DATABASE_URL;
  if (!connectionString) {
    throw new Error("MSH_CO_MANAGEMENT_MIGRATION_DATABASE_URL or MSH_CO_MANAGEMENT_DATABASE_URL is required");
  }
  return new Pool({
    connectionString,
    max: Number(process.env.MSH_CO_MANAGEMENT_DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    application_name: "minecraft-server-hub-co-management-migrate",
    ssl: process.env.MSH_CO_MANAGEMENT_DATABASE_SSL === "disable" ? false : { rejectUnauthorized: true },
  });
}

async function main(): Promise<void> {
  const pool = databasePool();
  try {
    const applied = await applyMigrations(pool);
    console.log(applied.length === 0 ? "Database schema is current." : `Applied ${applied.length} migration(s).`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error) => {
    console.error("Database migration failed:", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  });
}
