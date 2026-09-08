CREATE TABLE co_management_hosts (
  host_id TEXT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  registered_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE co_management_host_servers (
  host_id TEXT NOT NULL REFERENCES co_management_hosts(host_id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,
  PRIMARY KEY (host_id, server_id)
);

CREATE TABLE co_management_invites (
  host_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  secret_hash CHAR(64) NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (host_id, invite_id),
  FOREIGN KEY (host_id, server_id)
    REFERENCES co_management_host_servers(host_id, server_id)
    ON DELETE CASCADE,
  CHECK (expires_at > issued_at)
);

CREATE UNIQUE INDEX co_management_invites_secret_hash_once
  ON co_management_invites(secret_hash)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX co_management_invites_redeem
  ON co_management_invites(secret_hash, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE co_management_participants (
  host_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 32),
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'revoked')),
  join_code_hash CHAR(64) NOT NULL CHECK (join_code_hash ~ '^[0-9a-f]{64}$'),
  pending_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_interaction_at TIMESTAMPTZ NOT NULL,
  last_polled_at TIMESTAMPTZ,
  PRIMARY KEY (host_id, participant_id),
  FOREIGN KEY (host_id, server_id)
    REFERENCES co_management_host_servers(host_id, server_id)
    ON DELETE CASCADE,
  CHECK (absolute_expires_at > created_at)
);

CREATE INDEX co_management_participants_server_state
  ON co_management_participants(host_id, server_id, state);

CREATE TABLE co_management_sessions (
  session_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  csrf_token_hash CHAR(64) NOT NULL CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$'),
  join_code_ciphertext BYTEA NOT NULL,
  key_id TEXT NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_interaction_at TIMESTAMPTZ NOT NULL,
  last_polled_at TIMESTAMPTZ,
  FOREIGN KEY (host_id, participant_id)
    REFERENCES co_management_participants(host_id, participant_id)
    ON DELETE CASCADE
);

CREATE INDEX co_management_sessions_participant
  ON co_management_sessions(host_id, participant_id);

CREATE INDEX co_management_sessions_expiry
  ON co_management_sessions(absolute_expires_at, idle_expires_at);

CREATE TABLE co_management_snapshots (
  host_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (host_id, server_id),
  FOREIGN KEY (host_id, server_id)
    REFERENCES co_management_host_servers(host_id, server_id)
    ON DELETE CASCADE,
  CHECK (octet_length(snapshot::text) <= 65536)
);

CREATE TABLE co_management_operations (
  host_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
  content_hash CHAR(64),
  result_ciphertext BYTEA,
  key_id TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (host_id, server_id, participant_id, request_id),
  FOREIGN KEY (host_id, server_id)
    REFERENCES co_management_host_servers(host_id, server_id)
    ON DELETE CASCADE,
  FOREIGN KEY (host_id, participant_id)
    REFERENCES co_management_participants(host_id, participant_id)
    ON DELETE CASCADE,
  CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((result_ciphertext IS NULL) = (key_id IS NULL))
);

CREATE INDEX co_management_operations_lookup
  ON co_management_operations(host_id, server_id, participant_id, updated_at DESC);

CREATE INDEX co_management_operations_running
  ON co_management_operations(updated_at)
  WHERE state = 'running';

-- Relay audit rows are intentionally not cascade-deleted with live sessions.
-- The application role receives INSERT/SELECT only; retention is performed by
-- a separate maintenance role after the configured retention period.
CREATE TABLE co_management_audit (
  audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_keys TEXT[] NOT NULL DEFAULT '{}',
  result TEXT NOT NULL,
  request_id TEXT,
  at TIMESTAMPTZ NOT NULL
);

CREATE INDEX co_management_audit_server_at
  ON co_management_audit(host_id, server_id, at DESC, audit_id DESC);

CREATE TABLE co_management_rate_limits (
  identifier_hash CHAR(64) NOT NULL CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  bucket_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier_hash, bucket_started_at)
);

CREATE INDEX co_management_rate_limits_expiry
  ON co_management_rate_limits(expires_at);
