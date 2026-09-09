-- Request-time revocation must work with the least-privileged relay role,
-- which intentionally has no DELETE permission. Physical deletion remains a
-- maintenance-role responsibility.
ALTER TABLE co_management_sessions
  ADD COLUMN revoked_at TIMESTAMPTZ;

ALTER TABLE co_management_snapshots
  ADD COLUMN invalidated_at TIMESTAMPTZ;

CREATE INDEX co_management_sessions_revoked
  ON co_management_sessions(revoked_at)
  WHERE revoked_at IS NOT NULL;

CREATE INDEX co_management_snapshots_invalidated
  ON co_management_snapshots(invalidated_at)
  WHERE invalidated_at IS NOT NULL;
