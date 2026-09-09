/**
 * Keep the PostgreSQL transport policy identical for the relay and both
 * operational CLI entry points. Development may opt out explicitly; a
 * production process must never silently downgrade to plaintext.
 */
export function assertDatabaseTlsConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && env.MSH_CO_MANAGEMENT_DATABASE_SSL === "disable") {
    throw new Error("本番中継は停止しました。PostgreSQL TLSを無効化できません。");
  }
}

export function postgresSslConfiguration(env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: true } {
  assertDatabaseTlsConfiguration(env);
  return env.MSH_CO_MANAGEMENT_DATABASE_SSL === "disable"
    ? false
    : { rejectUnauthorized: true };
}
