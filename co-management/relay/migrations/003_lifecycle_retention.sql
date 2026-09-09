-- Lifecycle indexes support the separate maintenance role without changing
-- the relay role's request-time permissions.
CREATE INDEX co_management_hosts_last_seen
  ON co_management_hosts(last_seen_at);

CREATE INDEX co_management_host_servers_host
  ON co_management_host_servers(host_id);

CREATE INDEX co_management_invites_lifecycle
  ON co_management_invites(expires_at, used_at, revoked_at);

CREATE INDEX co_management_participants_lifecycle
  ON co_management_participants(state, last_seen_at);

CREATE INDEX co_management_sessions_lifecycle
  ON co_management_sessions(absolute_expires_at, idle_expires_at);

CREATE INDEX co_management_operations_lifecycle
  ON co_management_operations(state, updated_at);

CREATE INDEX co_management_snapshots_host
  ON co_management_snapshots(host_id);
