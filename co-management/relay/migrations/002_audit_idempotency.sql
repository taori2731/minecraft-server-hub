-- A terminal operation may be observed more than once (for example after a
-- response timeout). Keep the relay's operational audit append-only while
-- making one request produce at most one metadata row.
CREATE UNIQUE INDEX co_management_audit_operation_once
  ON co_management_audit(host_id, server_id, action, request_id)
  WHERE request_id IS NOT NULL;
