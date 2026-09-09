import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { PostgresRelayMaintenance } from "./postgres-store.ts";

function databasePool(): Pool {
  const connectionString = process.env.MSH_CO_MANAGEMENT_MAINTENANCE_DATABASE_URL;
  if (!connectionString) throw new Error("MSH_CO_MANAGEMENT_MAINTENANCE_DATABASE_URL is required");
  return new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    application_name: "minecraft-server-hub-co-management-maintenance",
    ssl: process.env.MSH_CO_MANAGEMENT_DATABASE_SSL === "disable" ? false : { rejectUnauthorized: true },
  });
}

async function main(): Promise<void> {
  const pool = databasePool();
  try {
    const result = await new PostgresRelayMaintenance(pool).run();
    console.log(`Maintenance complete: auditRowsDeleted=${result.auditRowsDeleted}, rateLimitRowsDeleted=${result.rateLimitRowsDeleted}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error) => {
    console.error("Relay maintenance failed:", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  });
}
