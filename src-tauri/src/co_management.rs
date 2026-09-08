//! Local authority and relay bridge for browser co-management.
//!
//! The desktop process remains the authority for server identity, permissions,
//! configuration validation, file writes, and revision changes. The relay only
//! carries authenticated requests and never receives a ServerProfile, a local
//! path, a game password, or a generic command.

use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use base64::Engine;
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use reqwest::Url;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest, http::HeaderValue},
};
use uuid::Uuid;

use crate::{
    backup, credentials,
    error::{AppError, AppResult},
    game_adapter::GameAdapter,
    models::{BasicSettings, PalworldSettings, RuntimeStatus, ServerProfile},
    palworld,
    process::{self, ProcessMap, StoppingMap},
    protected_data, settings,
    store::Store,
};

pub const PROTOCOL_VERSION: u16 = 1;
const MIN_INVITE_SECRET_BYTES: usize = 32;
const INVITE_LIFETIME_MINUTES: i64 = 10;
const APPROVED_SESSION_LIFETIME_HOURS: i64 = 12;
const MAX_BRIDGE_MESSAGE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementCapability {
    pub key: String,
    pub value_type: String,
    pub editable_when_stopped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enum_values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementParticipant {
    pub id: String,
    pub display_name: String,
    pub role: String,
    pub state: String,
    pub expires_at: String,
    pub created_at: String,
    pub approved_at: Option<String>,
    pub last_seen_at: Option<String>,
    #[serde(skip)]
    permission_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementInvite {
    pub id: String,
    pub role: String,
    pub issued_at: String,
    pub expires_at: String,
    pub used_at: Option<String>,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementAuditEntry {
    pub id: String,
    pub at: String,
    pub actor_id: String,
    pub actor_display_name: String,
    pub action: String,
    pub changes: Value,
    pub result: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementServerSnapshot {
    pub server_id: String,
    pub server_name: String,
    pub game_kind: String,
    pub state: String,
    pub player_count: u32,
    pub max_players: u32,
    pub fetched_at: String,
    pub revision: u64,
    pub capabilities: Vec<CoManagementCapability>,
    pub enabled: bool,
    pub connection_state: String,
    pub participants: Vec<CoManagementParticipant>,
    pub invites: Vec<CoManagementInvite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementSettingsSnapshot {
    pub server_id: String,
    pub game_kind: String,
    pub state: String,
    pub revision: u64,
    pub fetched_at: String,
    pub fields: Value,
    pub capabilities: Vec<CoManagementCapability>,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementInviteResult {
    pub invite_id: String,
    pub role: String,
    pub expires_at: String,
    pub invite_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementSettingsInput {
    pub server_id: String,
    pub participant_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementApplyInput {
    pub server_id: String,
    pub participant_id: String,
    pub role: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub changes: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementApplyResult {
    pub request_id: String,
    pub server_id: String,
    pub revision: u64,
    pub changed_fields: Vec<String>,
    pub settings: CoManagementSettingsSnapshot,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementOperationResult {
    pub request_id: String,
    pub state: String,
    pub result: Option<Value>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementJournalMigrationResult {
    pub server_id: String,
    pub migrated: u64,
    pub remaining_legacy: u64,
    pub database_compacted: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementConfigView {
    pub server_id: String,
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub connection_state: String,
    pub revision: u64,
    pub permission_generation: u64,
    pub recovery_required: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureCoManagementInput {
    pub server_id: String,
    pub endpoint: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementParticipantInput {
    pub server_id: String,
    pub participant_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueCoManagementInviteInput {
    pub server_id: String,
    pub role: String,
    pub expires_minutes: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementHostResponseInput {
    pub server_id: String,
    pub request_id: String,
    pub ok: bool,
    pub result: Option<Value>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoManagementEvent {
    pub server_id: String,
    pub event_type: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct CoManagementConfig {
    pub server_id: String,
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub host_id: Option<String>,
    pub connection_state: String,
    pub revision: u64,
    pub fingerprint: Option<String>,
    pub permission_generation: u64,
    pub recovery_required: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
struct StoredOperation {
    request_id: String,
    content_hash: String,
    state: String,
    result: Option<Value>,
    error_code: Option<String>,
}

fn protect_recovery_bytes(operation_key: &str, plaintext: &[u8]) -> AppResult<Vec<u8>> {
    protected_data::protect_bytes(
        protected_data::CO_MANAGEMENT_RECOVERY_DOMAIN,
        operation_key,
        plaintext,
    )
}

fn unprotect_recovery_bytes(operation_key: &str, envelope: &[u8]) -> AppResult<Vec<u8>> {
    protected_data::unprotect_bytes(
        protected_data::CO_MANAGEMENT_RECOVERY_DOMAIN,
        operation_key,
        envelope,
    )
}

fn protect_recovery_text(operation_key: &str, plaintext: &[u8]) -> AppResult<String> {
    Ok(format!(
        "{}{}",
        protected_data::DPAPI_TEXT_PREFIX,
        base64::engine::general_purpose::STANDARD
            .encode(protect_recovery_bytes(operation_key, plaintext)?)
    ))
}

fn unprotect_recovery_text(operation_key: &str, protected: &str) -> AppResult<Vec<u8>> {
    let encoded = protected
        .strip_prefix(protected_data::DPAPI_TEXT_PREFIX)
        .ok_or_else(|| AppError::Other("旧形式または平文の復旧ジャーナルです".into()))?;
    let envelope = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| AppError::Other("復旧ジャーナルの暗号文を解釈できません".into()))?;
    unprotect_recovery_bytes(operation_key, &envelope)
}

fn protected_journal_payload(
    operation_key: &str,
    original_bytes: &[u8],
    original_profile: &ServerProfile,
) -> AppResult<(Vec<u8>, String)> {
    let protected_bytes = protect_recovery_bytes(operation_key, original_bytes)?;
    let profile_json = serde_json::to_vec(original_profile)?;
    let protected_profile = protect_recovery_text(operation_key, &profile_json)?;
    Ok((protected_bytes, protected_profile))
}

pub struct CoManagementStore {
    connection: Connection,
}

impl CoManagementStore {
    pub fn open(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS co_management_config (
               server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
               enabled INTEGER NOT NULL DEFAULT 0,
               endpoint TEXT,
               host_id TEXT,
               connection_state TEXT NOT NULL DEFAULT 'disabled',
               revision INTEGER NOT NULL DEFAULT 1,
               config_fingerprint TEXT,
               permission_generation INTEGER NOT NULL DEFAULT 0,
               recovery_required INTEGER NOT NULL DEFAULT 0,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS co_management_participants (
               id TEXT PRIMARY KEY,
               server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
               display_name TEXT NOT NULL,
               role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
               state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'revoked')),
               join_code_hash TEXT NOT NULL,
               permission_generation INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL,
               approved_at TEXT,
               expires_at TEXT NOT NULL,
               last_seen_at TEXT
             );
             CREATE INDEX IF NOT EXISTS co_management_participants_server
               ON co_management_participants(server_id, state, expires_at);
             CREATE TABLE IF NOT EXISTS co_management_invites (
               id TEXT PRIMARY KEY,
               server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
               secret_hash TEXT NOT NULL UNIQUE,
               role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
               issued_at TEXT NOT NULL,
               expires_at TEXT NOT NULL,
               used_at TEXT,
               revoked_at TEXT
             );
             CREATE INDEX IF NOT EXISTS co_management_invites_server
               ON co_management_invites(server_id, expires_at);
             CREATE TABLE IF NOT EXISTS co_management_operations (
               operation_key TEXT PRIMARY KEY,
               request_id TEXT NOT NULL,
               server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
               participant_id TEXT NOT NULL,
               content_hash TEXT NOT NULL,
               state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
               result_json TEXT,
               error_code TEXT,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               UNIQUE(server_id, participant_id, request_id)
             );
             CREATE INDEX IF NOT EXISTS co_management_operations_lookup
               ON co_management_operations(server_id, participant_id, request_id);
             CREATE TABLE IF NOT EXISTS co_management_audit (
               id TEXT PRIMARY KEY,
               server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
               actor_id TEXT NOT NULL,
               actor_display_name TEXT NOT NULL,
               action TEXT NOT NULL,
               changes_json TEXT NOT NULL,
               result TEXT NOT NULL,
               request_id TEXT,
               at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS co_management_audit_server_at
               ON co_management_audit(server_id, at DESC);
             CREATE TABLE IF NOT EXISTS co_management_operation_journal (
               operation_key TEXT PRIMARY KEY,
               server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
               participant_id TEXT NOT NULL,
               request_id TEXT NOT NULL,
               backup_path TEXT,
               target_path TEXT NOT NULL,
               original_exists INTEGER NOT NULL,
               original_bytes BLOB NOT NULL,
               original_profile_json TEXT NOT NULL,
               original_fingerprint TEXT NOT NULL DEFAULT '',
               new_fingerprint TEXT,
               stage TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS co_management_operation_journal_server
               ON co_management_operation_journal(server_id, updated_at);",
        )?;
        ensure_config_recovery_column(&connection)?;
        ensure_participant_generation_column(&connection)?;
        ensure_operation_journal_fingerprint_columns(&connection)?;
        migrate_operation_namespace(&connection)?;
        Ok(Self { connection })
    }

    pub fn config(&self, server_id: &str) -> AppResult<Option<CoManagementConfig>> {
        self.connection
            .query_row(
                "SELECT server_id, enabled, endpoint, host_id, connection_state,
                        revision, config_fingerprint, permission_generation, recovery_required, updated_at
                 FROM co_management_config WHERE server_id = ?1",
                [server_id],
                |row| {
                    Ok(CoManagementConfig {
                        server_id: row.get(0)?,
                        enabled: row.get(1)?,
                        endpoint: row.get(2)?,
                        host_id: row.get(3)?,
                        connection_state: row.get(4)?,
                        revision: row.get::<_, i64>(5)?.max(0) as u64,
                        fingerprint: row.get(6)?,
                        permission_generation: row.get::<_, i64>(7)?.max(0) as u64,
                        recovery_required: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn ensure_config(
        &self,
        server_id: &str,
        fingerprint: Option<&str>,
    ) -> AppResult<CoManagementConfig> {
        if self.config(server_id)?.is_none() {
            let now = Utc::now().to_rfc3339();
            self.connection.execute(
                "INSERT INTO co_management_config (
                   server_id, enabled, endpoint, host_id, connection_state,
                   revision, config_fingerprint, permission_generation, recovery_required, updated_at
                 ) VALUES (?1, 0, NULL, NULL, 'disabled', 1, ?2, 0, 0, ?3)",
                params![server_id, fingerprint, now],
            )?;
        } else if let Some(fingerprint) = fingerprint {
            self.connection.execute(
                "UPDATE co_management_config
                 SET config_fingerprint = COALESCE(config_fingerprint, ?2), updated_at = ?3
                 WHERE server_id = ?1",
                params![server_id, fingerprint, Utc::now().to_rfc3339()],
            )?;
        }
        self.config(server_id)?.ok_or(AppError::NotFound)
    }

    pub fn configure(
        &self,
        server_id: &str,
        endpoint: Option<&str>,
        host_id: Option<&str>,
        enabled: bool,
        fingerprint: Option<&str>,
    ) -> AppResult<CoManagementConfig> {
        let current = self.ensure_config(server_id, fingerprint)?;
        let now = Utc::now().to_rfc3339();
        let connection_state = if enabled { "disconnected" } else { "disabled" };
        let generation_changed = current.enabled != enabled
            || current.endpoint.as_deref() != endpoint
            || current.host_id.as_deref() != host_id;
        let permission_generation = if generation_changed {
            current.permission_generation.saturating_add(1)
        } else {
            current.permission_generation
        };
        self.connection.execute(
            "UPDATE co_management_config SET enabled=?2, endpoint=?3, host_id=?4,
                    connection_state=?5, permission_generation=?6, updated_at=?7
             WHERE server_id=?1",
            params![
                server_id,
                enabled,
                endpoint,
                host_id,
                connection_state,
                permission_generation as i64,
                now,
            ],
        )?;
        if generation_changed {
            self.connection.execute(
                "UPDATE co_management_participants SET state='revoked'
                 WHERE server_id=?1 AND state <> 'revoked'",
                [server_id],
            )?;
        }
        if !enabled || generation_changed {
            self.connection.execute(
                "UPDATE co_management_invites SET revoked_at=?2
                 WHERE server_id=?1 AND revoked_at IS NULL AND used_at IS NULL",
                params![server_id, Utc::now().to_rfc3339()],
            )?;
        }
        self.config(server_id)?.ok_or(AppError::NotFound)
    }

    pub fn set_connection_state(&self, server_id: &str, state: &str) -> AppResult<()> {
        self.connection.execute(
            "UPDATE co_management_config SET connection_state=?2, updated_at=?3
             WHERE server_id=?1",
            params![server_id, state, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn rotate_permission_generation(&self, server_id: &str) -> AppResult<Vec<String>> {
        let current = self.config(server_id)?.ok_or(AppError::NotFound)?;
        let mut statement = self.connection.prepare(
            "SELECT id FROM co_management_participants
             WHERE server_id=?1 AND state <> 'revoked'",
        )?;
        let participant_ids = statement
            .query_map([server_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let generation = current.permission_generation.saturating_add(1);
        self.connection.execute(
            "UPDATE co_management_config SET permission_generation=?2, updated_at=?3
             WHERE server_id=?1",
            params![server_id, generation as i64, Utc::now().to_rfc3339()],
        )?;
        self.connection.execute(
            "UPDATE co_management_participants SET state='revoked'
             WHERE server_id=?1 AND state <> 'revoked'",
            [server_id],
        )?;
        self.connection.execute(
            "UPDATE co_management_invites SET revoked_at=?2
             WHERE server_id=?1 AND revoked_at IS NULL AND used_at IS NULL",
            params![server_id, Utc::now().to_rfc3339()],
        )?;
        Ok(participant_ids)
    }

    pub fn bump_revision(
        &self,
        server_id: &str,
        fingerprint: Option<&str>,
    ) -> AppResult<Option<u64>> {
        let Some(current) = self.config(server_id)? else {
            return Ok(None);
        };
        let revision = current.revision.saturating_add(1);
        self.connection.execute(
            "UPDATE co_management_config SET revision=?2, config_fingerprint=COALESCE(?3, config_fingerprint), updated_at=?4
             WHERE server_id=?1",
            params![server_id, revision as i64, fingerprint, Utc::now().to_rfc3339()],
        )?;
        Ok(Some(revision))
    }

    pub fn list_participants(&self, server_id: &str) -> AppResult<Vec<CoManagementParticipant>> {
        let mut statement = self.connection.prepare(
            "SELECT id, display_name, role, state, expires_at, created_at, approved_at, last_seen_at,
                    permission_generation
             FROM co_management_participants WHERE server_id=?1 ORDER BY created_at ASC",
        )?;
        let rows = statement.query_map([server_id], |row| {
            Ok(CoManagementParticipant {
                id: row.get(0)?,
                display_name: row.get(1)?,
                role: row.get(2)?,
                state: row.get(3)?,
                expires_at: row.get(4)?,
                created_at: row.get(5)?,
                approved_at: row.get(6)?,
                last_seen_at: row.get(7)?,
                permission_generation: row.get::<_, i64>(8)?.max(0) as u64,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn participant(
        &self,
        server_id: &str,
        participant_id: &str,
    ) -> AppResult<Option<CoManagementParticipant>> {
        self.connection
            .query_row(
                "SELECT id, display_name, role, state, expires_at, created_at, approved_at, last_seen_at,
                        permission_generation
                 FROM co_management_participants WHERE server_id=?1 AND id=?2",
                params![server_id, participant_id],
                |row| {
                    Ok(CoManagementParticipant {
                        id: row.get(0)?,
                        display_name: row.get(1)?,
                        role: row.get(2)?,
                        state: row.get(3)?,
                        expires_at: row.get(4)?,
                        created_at: row.get(5)?,
                        approved_at: row.get(6)?,
                        last_seen_at: row.get(7)?,
                        permission_generation: row.get::<_, i64>(8)?.max(0) as u64,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn upsert_pending(
        &self,
        server_id: &str,
        participant_id: &str,
        display_name: &str,
        role: &str,
        join_code: &str,
        expires_at: &str,
    ) -> AppResult<()> {
        validate_role(role)?;
        validate_display_name(display_name)?;
        let code_hash = hash_secret(join_code);
        let now = Utc::now().to_rfc3339();
        let permission_generation = self
            .config(server_id)?
            .ok_or(AppError::NotFound)?
            .permission_generation;
        if let Some(existing_server_id) = self
            .connection
            .query_row(
                "SELECT server_id FROM co_management_participants WHERE id=?1",
                [participant_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            && existing_server_id != server_id
        {
            return Err(AppError::Validation(
                "共同管理参加者IDが別サーバーです".into(),
            ));
        }
        self.connection.execute(
            "INSERT INTO co_management_participants (
               id, server_id, display_name, role, state, join_code_hash, permission_generation,
               created_at, approved_at, expires_at, last_seen_at
             ) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7, NULL, ?8, ?7)
             ON CONFLICT(id) DO UPDATE SET
               server_id=excluded.server_id,
               display_name=excluded.display_name,
               role=excluded.role,
               state=CASE
                 WHEN co_management_participants.state='approved'
                   AND co_management_participants.permission_generation=excluded.permission_generation
                 THEN 'approved'
                 ELSE 'pending'
               END,
               join_code_hash=excluded.join_code_hash,
               permission_generation=excluded.permission_generation,
               expires_at=excluded.expires_at,
               last_seen_at=excluded.last_seen_at",
            params![
                participant_id,
                server_id,
                display_name,
                role,
                code_hash,
                permission_generation as i64,
                now,
                expires_at,
            ],
        )?;
        Ok(())
    }

    pub fn set_participant_state(
        &self,
        server_id: &str,
        participant_id: &str,
        state: &str,
    ) -> AppResult<CoManagementParticipant> {
        if !matches!(state, "approved" | "revoked") {
            return Err(AppError::Validation(
                "共同管理の参加者状態が不正です".into(),
            ));
        }
        let participant = self
            .participant(server_id, participant_id)?
            .ok_or(AppError::NotFound)?;
        if state == "approved" {
            let config = self.config(server_id)?.ok_or(AppError::NotFound)?;
            if !config.enabled {
                return Err(AppError::Validation(
                    "共同管理を有効にしてから参加者を承認してください".into(),
                ));
            }
            if participant.permission_generation != config.permission_generation {
                return Err(AppError::Validation(
                    "共同管理の接続世代が古いため、参加者を再申請してください".into(),
                ));
            }
            if participant.expires_at <= Utc::now().to_rfc3339() {
                return Err(AppError::Validation(
                    "共同管理の申請コードが期限切れです".into(),
                ));
            }
        }
        let changed_at = Utc::now().to_rfc3339();
        let approved_expires_at =
            (state == "approved" && participant.state != "approved").then(|| {
                (Utc::now() + chrono::Duration::hours(APPROVED_SESSION_LIFETIME_HOURS)).to_rfc3339()
            });
        let changed = self.connection.execute(
            "UPDATE co_management_participants SET state=?3,
                    approved_at=CASE WHEN ?3='approved' THEN ?4 ELSE approved_at END,
                    expires_at=CASE WHEN ?3='approved' AND ?5 IS NOT NULL THEN ?5 ELSE expires_at END,
                    last_seen_at=?4 WHERE server_id=?1 AND id=?2",
            params![server_id, participant_id, state, changed_at, approved_expires_at],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        self.participant(server_id, participant_id)?
            .ok_or(AppError::NotFound)
    }

    pub fn insert_invite(
        &self,
        server_id: &str,
        invite_id: &str,
        secret_hash: &str,
        role: &str,
        issued_at: &str,
        expires_at: &str,
    ) -> AppResult<()> {
        validate_role(role)?;
        self.connection.execute(
            "INSERT INTO co_management_invites (id, server_id, secret_hash, role, issued_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![invite_id, server_id, secret_hash, role, issued_at, expires_at],
        )?;
        Ok(())
    }

    pub fn revoke_invite(&self, invite_id: &str) -> AppResult<()> {
        self.connection.execute(
            "UPDATE co_management_invites SET revoked_at=?2 WHERE id=?1 AND revoked_at IS NULL",
            params![invite_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn list_invites(&self, server_id: &str) -> AppResult<Vec<CoManagementInvite>> {
        let mut statement = self.connection.prepare(
            "SELECT id, role, issued_at, expires_at, used_at, revoked_at
             FROM co_management_invites WHERE server_id=?1 ORDER BY issued_at DESC LIMIT 100",
        )?;
        let rows = statement.query_map([server_id], |row| {
            Ok(CoManagementInvite {
                id: row.get(0)?,
                role: row.get(1)?,
                issued_at: row.get(2)?,
                expires_at: row.get(3)?,
                used_at: row.get(4)?,
                revoked_at: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn operation_key(server_id: &str, participant_id: &str, request_id: &str) -> String {
        format!("{server_id}\u{1f}{participant_id}\u{1f}{request_id}")
    }

    fn operation(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
    ) -> AppResult<Option<StoredOperation>> {
        self.connection
            .query_row(
                "SELECT request_id, content_hash, state, result_json, error_code
                 FROM co_management_operations
                 WHERE server_id=?1 AND participant_id=?2 AND request_id=?3",
                params![server_id, participant_id, request_id],
                |row| {
                    let result_json: Option<String> = row.get(3)?;
                    Ok(StoredOperation {
                        request_id: row.get(0)?,
                        content_hash: row.get(1)?,
                        state: row.get(2)?,
                        result: result_json
                            .as_deref()
                            .map(serde_json::from_str)
                            .transpose()
                            .map_err(|error| {
                                rusqlite::Error::ToSqlConversionFailure(Box::new(error))
                            })?,
                        error_code: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    #[cfg(test)]
    pub fn begin_operation(
        &self,
        request_id: &str,
        server_id: &str,
        participant_id: &str,
        content_hash: &str,
    ) -> AppResult<Option<CoManagementOperationResult>> {
        if let Some(existing) = self.operation(server_id, participant_id, request_id)? {
            if existing.content_hash != content_hash {
                return Err(AppError::Validation(
                    "同じrequestIdに別内容を指定することはできません".into(),
                ));
            }
            return Ok(Some(CoManagementOperationResult {
                request_id: existing.request_id,
                state: existing.state,
                result: existing.result,
                error_code: existing.error_code,
            }));
        }
        let now = Utc::now().to_rfc3339();
        self.connection.execute(
            "INSERT INTO co_management_operations (
               operation_key, request_id, server_id, participant_id, content_hash, state,
               result_json, error_code, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', NULL, NULL, ?6, ?6)",
            params![
                Self::operation_key(server_id, participant_id, request_id),
                request_id,
                server_id,
                participant_id,
                content_hash,
                now
            ],
        )?;
        Ok(None)
    }

    pub fn begin_operation_with_journal(
        &self,
        request_id: &str,
        server_id: &str,
        participant_id: &str,
        content_hash: &str,
        backup_path: &Path,
        target_path: &Path,
        original_exists: bool,
        original_bytes: &[u8],
        original_profile: &ServerProfile,
        original_fingerprint: &str,
        new_fingerprint: &str,
        stage: &str,
    ) -> AppResult<Option<CoManagementOperationResult>> {
        if let Some(existing) = self.operation(server_id, participant_id, request_id)? {
            if existing.content_hash != content_hash {
                return Err(AppError::Validation(
                    "同じrequestIdに別内容を指定することはできません".into(),
                ));
            }
            return Ok(Some(CoManagementOperationResult {
                request_id: existing.request_id,
                state: existing.state,
                result: existing.result,
                error_code: existing.error_code,
            }));
        }
        let operation_key = Self::operation_key(server_id, participant_id, request_id);
        let (protected_bytes, protected_profile) =
            protected_journal_payload(&operation_key, original_bytes, original_profile)?;
        let now = Utc::now().to_rfc3339();
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO co_management_operations (
               operation_key, request_id, server_id, participant_id, content_hash, state,
               result_json, error_code, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', NULL, NULL, ?6, ?6)",
            params![
                operation_key,
                request_id,
                server_id,
                participant_id,
                content_hash,
                now
            ],
        )?;
        transaction.execute(
            "INSERT INTO co_management_operation_journal (
               operation_key, server_id, participant_id, request_id, backup_path,
               target_path, original_exists, original_bytes, original_profile_json,
               original_fingerprint, new_fingerprint, stage, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
            params![
                Self::operation_key(server_id, participant_id, request_id),
                server_id,
                participant_id,
                request_id,
                backup_path.display().to_string(),
                target_path.display().to_string(),
                original_exists,
                protected_bytes,
                protected_profile,
                original_fingerprint,
                new_fingerprint,
                stage,
                now,
            ],
        )?;
        transaction.commit()?;
        Ok(None)
    }

    pub fn fail_operation(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
        error_code: &str,
    ) -> AppResult<()> {
        self.connection.execute(
            "UPDATE co_management_operations SET state='failed', error_code=?2, updated_at=?3
             WHERE operation_key=?1",
            params![
                Self::operation_key(server_id, participant_id, request_id),
                error_code,
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn operation_result(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
    ) -> AppResult<CoManagementOperationResult> {
        self.operation(server_id, participant_id, request_id)?
            .map_or(Err(AppError::NotFound), |operation| {
                Ok(CoManagementOperationResult {
                    request_id: operation.request_id,
                    state: operation.state,
                    result: operation.result,
                    error_code: operation.error_code,
                })
            })
    }

    pub fn legacy_journal_count(&self, server_id: &str) -> AppResult<u64> {
        let count: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM co_management_operation_journal
             WHERE server_id=?1 AND stage <> 'completed'
               AND (length(original_bytes) < ?2 OR substr(original_bytes, 1, ?2) <> ?3
                    OR original_profile_json NOT LIKE ?4)",
            params![
                server_id,
                protected_data::DPAPI_BLOB_MAGIC.len() as i64,
                protected_data::DPAPI_BLOB_MAGIC,
                format!("{}%", protected_data::DPAPI_TEXT_PREFIX),
            ],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as u64)
    }

    /// Explicitly converts old plaintext journal payloads in one transaction.
    /// It never deletes journal rows. SQLite compaction is attempted only after
    /// every row has been replaced by an OS-protected payload.
    pub fn migrate_legacy_journals(
        &self,
        server_id: &str,
    ) -> AppResult<CoManagementJournalMigrationResult> {
        if server_id.trim().is_empty() {
            return Err(AppError::Validation("共同管理サーバーIDが空です".into()));
        }
        let mut statement = self.connection.prepare(
            "SELECT operation_key, participant_id, request_id, original_bytes,
                    original_profile_json
             FROM co_management_operation_journal
             WHERE server_id=?1 AND stage <> 'completed'",
        )?;
        let rows = statement.query_map([server_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        let entries = rows.collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        let mut replacements = Vec::new();
        for (operation_key, participant_id, request_id, original_bytes, original_profile) in entries
        {
            let expected_key = Self::operation_key(server_id, &participant_id, &request_id);
            if operation_key != expected_key {
                return Err(AppError::Validation(
                    "旧形式ジャーナルの操作識別子が一致しないため移行を中止しました".into(),
                ));
            }
            let protected_bytes = if protected_data::is_protected_blob(&original_bytes) {
                // Validate an existing protected value before preserving it.
                let _ = unprotect_recovery_bytes(&operation_key, &original_bytes)?;
                original_bytes
            } else {
                protect_recovery_bytes(&operation_key, &original_bytes)?
            };
            let protected_profile = if protected_data::is_protected_text(&original_profile) {
                let profile_json = unprotect_recovery_text(&operation_key, &original_profile)?;
                let _: ServerProfile = serde_json::from_slice(&profile_json)?;
                original_profile
            } else {
                let _: ServerProfile = serde_json::from_slice(original_profile.as_bytes())?;
                protect_recovery_text(&operation_key, original_profile.as_bytes())?
            };
            if protected_data::is_protected_blob(&protected_bytes)
                && protected_data::is_protected_text(&protected_profile)
            {
                replacements.push((operation_key, protected_bytes, protected_profile));
            }
        }

        let migrated = replacements.len() as u64;
        if migrated > 0 {
            let transaction = self.connection.unchecked_transaction()?;
            for (operation_key, protected_bytes, protected_profile) in replacements {
                transaction.execute(
                    "UPDATE co_management_operation_journal
                     SET original_bytes=?2, original_profile_json=?3, updated_at=?4
                     WHERE operation_key=?1 AND server_id=?5",
                    params![
                        operation_key,
                        protected_bytes,
                        protected_profile,
                        Utc::now().to_rfc3339(),
                        server_id,
                    ],
                )?;
            }
            transaction.commit()?;
        }

        let remaining_legacy = self.legacy_journal_count(server_id)?;
        let database_compacted = if migrated > 0 && remaining_legacy == 0 {
            self.connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
                .is_ok()
        } else {
            remaining_legacy == 0
        };
        let message = if migrated == 0 {
            "移行対象の旧平文ジャーナルはありません。データは削除していません。".into()
        } else if database_compacted {
            "旧平文ジャーナルをWindowsユーザー保護データへ置換し、SQLiteの再構築を完了しました。行は削除していません。".into()
        } else {
            "ジャーナル本体の保護置換は完了しましたが、SQLite/WALの再構築を完了できませんでした。アプリを終了してから再試行してください。".into()
        };
        Ok(CoManagementJournalMigrationResult {
            server_id: server_id.into(),
            migrated,
            remaining_legacy,
            database_compacted,
            message,
        })
    }

    pub fn commit_settings_change(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
        next_revision: u64,
        fingerprint: &str,
        actor_id: &str,
        actor_display_name: &str,
        before: &Value,
        after: &Value,
        changed_fields: &[String],
        operation_result: &Value,
        result: &str,
    ) -> AppResult<()> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "UPDATE co_management_config SET revision=?2, config_fingerprint=?3, updated_at=?4
             WHERE server_id=?1",
            params![
                server_id,
                next_revision as i64,
                fingerprint,
                Utc::now().to_rfc3339()
            ],
        )?;
        let changes = json!({
            "fields": changed_fields,
            "before": before,
            "after": after,
        });
        transaction.execute(
            "UPDATE co_management_operations SET state='completed', result_json=?2, error_code=NULL, updated_at=?3
             WHERE operation_key=?1",
            params![
                Self::operation_key(server_id, participant_id, request_id),
                serde_json::to_string(operation_result)?,
                Utc::now().to_rfc3339(),
            ],
        )?;
        transaction.execute(
            "INSERT INTO co_management_audit (
               id, server_id, actor_id, actor_display_name, action,
               changes_json, result, request_id, at
             ) VALUES (?1, ?2, ?3, ?4, 'settings.update', ?5, ?6, ?7, ?8)",
            params![
                Uuid::new_v4().to_string(),
                server_id,
                actor_id,
                actor_display_name,
                serde_json::to_string(&changes)?,
                result,
                request_id,
                Utc::now().to_rfc3339(),
            ],
        )?;
        transaction.execute(
            "DELETE FROM co_management_operation_journal WHERE operation_key=?1",
            params![Self::operation_key(server_id, participant_id, request_id),],
        )?;
        transaction.commit()?;
        self.prune_audit(server_id)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn record_operation_journal(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
        backup_path: &Path,
        target_path: &Path,
        original_exists: bool,
        original_bytes: &[u8],
        original_profile: &ServerProfile,
        original_fingerprint: &str,
        stage: &str,
    ) -> AppResult<()> {
        self.record_operation_journal_with_candidate(
            server_id,
            participant_id,
            request_id,
            backup_path,
            target_path,
            original_exists,
            original_bytes,
            original_profile,
            original_fingerprint,
            None,
            stage,
        )
    }

    #[cfg(test)]
    pub fn record_operation_journal_with_candidate(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
        backup_path: &Path,
        target_path: &Path,
        original_exists: bool,
        original_bytes: &[u8],
        original_profile: &ServerProfile,
        original_fingerprint: &str,
        new_fingerprint: Option<&str>,
        stage: &str,
    ) -> AppResult<()> {
        let operation_key = Self::operation_key(server_id, participant_id, request_id);
        let (protected_bytes, protected_profile) =
            protected_journal_payload(&operation_key, original_bytes, original_profile)?;
        self.connection.execute(
            "INSERT INTO co_management_operation_journal (
               operation_key, server_id, participant_id, request_id, backup_path,
               target_path, original_exists, original_bytes, original_profile_json,
               original_fingerprint, new_fingerprint, stage, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
             ON CONFLICT(operation_key) DO UPDATE SET
               backup_path=excluded.backup_path, target_path=excluded.target_path,
               original_exists=excluded.original_exists, original_bytes=excluded.original_bytes,
               original_profile_json=excluded.original_profile_json,
               original_fingerprint=excluded.original_fingerprint,
               new_fingerprint=excluded.new_fingerprint, stage=excluded.stage,
               updated_at=excluded.updated_at",
            params![
                operation_key,
                server_id,
                participant_id,
                request_id,
                backup_path.display().to_string(),
                target_path.display().to_string(),
                original_exists,
                protected_bytes,
                protected_profile,
                original_fingerprint,
                new_fingerprint,
                stage,
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn update_operation_stage(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
        stage: &str,
    ) -> AppResult<()> {
        self.connection.execute(
            "UPDATE co_management_operation_journal SET stage=?2, updated_at=?3 WHERE operation_key=?1",
            params![
                Self::operation_key(server_id, participant_id, request_id),
                stage,
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn clear_operation_journal(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
    ) -> AppResult<()> {
        self.connection.execute(
            "DELETE FROM co_management_operation_journal WHERE operation_key=?1",
            [Self::operation_key(server_id, participant_id, request_id)],
        )?;
        Ok(())
    }

    pub fn mark_recovery_required(
        &self,
        server_id: &str,
        participant_id: &str,
        request_id: &str,
        reason: &str,
    ) -> AppResult<()> {
        self.connection.execute(
            "UPDATE co_management_config SET recovery_required=1, updated_at=?2 WHERE server_id=?1",
            params![server_id, Utc::now().to_rfc3339()],
        )?;
        self.connection.execute(
            "UPDATE co_management_operations SET state='failed', error_code=?2, updated_at=?3
             WHERE operation_key=?1",
            params![
                Self::operation_key(server_id, participant_id, request_id),
                reason,
                Utc::now().to_rfc3339(),
            ],
        )?;
        self.update_operation_stage(server_id, participant_id, request_id, "needs-recovery")
    }

    pub fn ensure_change_allowed(&self, server_id: &str) -> AppResult<()> {
        if self
            .config(server_id)?
            .is_some_and(|config| config.recovery_required)
        {
            return Err(AppError::Validation(
                "共同管理の前回保存を復旧できていません。ホストPCで復旧を確認するまで追加変更はできません"
                    .into(),
            ));
        }
        Ok(())
    }

    pub fn recover_incomplete_operations(&self, store: &Store) -> AppResult<Vec<String>> {
        let mut statement = self.connection.prepare(
            "SELECT server_id, participant_id, request_id, backup_path, target_path,
                    original_exists, original_bytes, original_profile_json,
                    original_fingerprint, new_fingerprint, stage
             FROM co_management_operation_journal WHERE stage <> 'completed'",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Vec<u8>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
            ))
        })?;
        let entries = rows.collect::<Result<Vec<_>, _>>()?;
        let mut recovered = Vec::new();
        for (
            server_id,
            participant_id,
            request_id,
            backup_path,
            target_path,
            existed,
            protected_bytes,
            protected_profile,
            original_fingerprint,
            new_fingerprint,
            _stage,
        ) in entries
        {
            let result = (|| -> AppResult<()> {
                let operation_key = Self::operation_key(&server_id, &participant_id, &request_id);
                let bytes = unprotect_recovery_bytes(&operation_key, &protected_bytes)?;
                let profile_json = unprotect_recovery_text(&operation_key, &protected_profile)?;
                let profile: ServerProfile = serde_json::from_slice(&profile_json)?;
                cleanup_incomplete_backup_part(backup_path.as_deref())?;
                let target = Path::new(&target_path);
                let current_fingerprint = current_file_fingerprint(target)?;
                let matches_original =
                    current_fingerprint.as_deref() == Some(original_fingerprint.as_str());
                let matches_new = new_fingerprint
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .is_some_and(|fingerprint| current_fingerprint.as_deref() == Some(fingerprint));
                let matches_missing_original = !existed && current_fingerprint.is_none();
                if !matches_original && !matches_new && !matches_missing_original {
                    return Err(AppError::Other(
                        "復旧対象の設定ファイルの内容を証明できないため自動復旧を中止しました"
                            .into(),
                    ));
                }
                rollback_settings_file(target, existed, &bytes)?;
                store.update_server(&profile)?;
                self.fail_operation(
                    &server_id,
                    &participant_id,
                    &request_id,
                    "recovered-after-restart",
                )?;
                self.clear_operation_journal(&server_id, &participant_id, &request_id)?;
                self.connection.execute(
                    "UPDATE co_management_config SET recovery_required=0, updated_at=?2
                     WHERE server_id=?1 AND NOT EXISTS (
                       SELECT 1 FROM co_management_operation_journal WHERE server_id=?1
                     )",
                    params![server_id, Utc::now().to_rfc3339()],
                )?;
                Ok(())
            })();
            match result {
                Ok(()) => recovered.push(server_id),
                Err(_) => self.mark_recovery_required(
                    &server_id,
                    &participant_id,
                    &request_id,
                    "needs-recovery",
                )?,
            }
        }
        self.recover_orphaned_running_operations()?;
        Ok(recovered)
    }

    fn recover_orphaned_running_operations(&self) -> AppResult<()> {
        let mut statement = self.connection.prepare(
            "SELECT operations.server_id, operations.participant_id, operations.request_id
             FROM co_management_operations AS operations
             LEFT JOIN co_management_operation_journal AS journal
               ON journal.operation_key = operations.operation_key
             WHERE operations.state='running' AND journal.operation_key IS NULL",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        let orphaned = rows.collect::<Result<Vec<_>, _>>()?;
        for (server_id, participant_id, request_id) in orphaned {
            self.connection.execute(
                "UPDATE co_management_operations
                 SET state='failed', error_code='interrupted-before-journal', updated_at=?2
                 WHERE operation_key=?1 AND state='running'",
                params![
                    Self::operation_key(&server_id, &participant_id, &request_id),
                    Utc::now().to_rfc3339(),
                ],
            )?;
        }
        Ok(())
    }

    pub fn append_audit(
        &self,
        server_id: &str,
        actor_id: &str,
        actor_display_name: &str,
        action: &str,
        changes: &Value,
        result: &str,
        request_id: Option<&str>,
    ) -> AppResult<()> {
        self.connection.execute(
            "INSERT INTO co_management_audit (
               id, server_id, actor_id, actor_display_name, action,
               changes_json, result, request_id, at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                Uuid::new_v4().to_string(),
                server_id,
                actor_id,
                actor_display_name,
                action,
                serde_json::to_string(changes)?,
                result,
                request_id,
                Utc::now().to_rfc3339(),
            ],
        )?;
        self.prune_audit(server_id)
    }

    pub fn audit(&self, server_id: &str) -> AppResult<Vec<CoManagementAuditEntry>> {
        let mut statement = self.connection.prepare(
            "SELECT id, at, actor_id, actor_display_name, action, changes_json, result, request_id
             FROM co_management_audit WHERE server_id=?1 ORDER BY at DESC LIMIT 2000",
        )?;
        let rows = statement.query_map([server_id], |row| {
            let changes_json: String = row.get(5)?;
            Ok(CoManagementAuditEntry {
                id: row.get(0)?,
                at: row.get(1)?,
                actor_id: row.get(2)?,
                actor_display_name: row.get(3)?,
                action: row.get(4)?,
                changes: serde_json::from_str(&changes_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                result: row.get(6)?,
                request_id: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn prune_audit(&self, server_id: &str) -> AppResult<()> {
        self.connection.execute(
            "DELETE FROM co_management_audit
             WHERE server_id=?1 AND id NOT IN (
               SELECT id FROM co_management_audit WHERE server_id=?1 ORDER BY at DESC LIMIT 10000
             ) AND at < datetime('now', '-90 day')",
            [server_id],
        )?;
        Ok(())
    }
}

fn migrate_operation_namespace(connection: &Connection) -> AppResult<()> {
    let columns = connection
        .prepare("PRAGMA table_info(co_management_operations)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<std::collections::HashSet<_>, _>>()?;
    if columns.contains("operation_key") {
        return Ok(());
    }
    // The first local prototype used request_id as the global primary key.
    // Preserve every legacy row while moving to the owner-scoped key.
    connection.execute_batch(
        "BEGIN IMMEDIATE;
         ALTER TABLE co_management_operations RENAME TO co_management_operations_legacy;
         DROP INDEX IF EXISTS co_management_operations_lookup;
         CREATE TABLE co_management_operations (
           operation_key TEXT PRIMARY KEY,
           request_id TEXT NOT NULL,
           server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
           participant_id TEXT NOT NULL,
           content_hash TEXT NOT NULL,
           state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
           result_json TEXT,
           error_code TEXT,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           UNIQUE(server_id, participant_id, request_id)
         );
         INSERT INTO co_management_operations (
           operation_key, request_id, server_id, participant_id, content_hash,
           state, result_json, error_code, created_at, updated_at
         ) SELECT
           server_id || char(31) || participant_id || char(31) || request_id,
           request_id, server_id, participant_id, content_hash,
           state, result_json, error_code, created_at, updated_at
         FROM co_management_operations_legacy;
         DROP TABLE co_management_operations_legacy;
         CREATE INDEX co_management_operations_lookup
           ON co_management_operations(server_id, participant_id, request_id);
         COMMIT;",
    )?;
    Ok(())
}

fn ensure_config_recovery_column(connection: &Connection) -> AppResult<()> {
    let columns = connection
        .prepare("PRAGMA table_info(co_management_config)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<std::collections::HashSet<_>, _>>()?;
    if !columns.contains("recovery_required") {
        connection.execute(
            "ALTER TABLE co_management_config ADD COLUMN recovery_required INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

fn ensure_participant_generation_column(connection: &Connection) -> AppResult<()> {
    let columns = connection
        .prepare("PRAGMA table_info(co_management_participants)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<std::collections::HashSet<_>, _>>()?;
    if !columns.contains("permission_generation") {
        connection.execute(
            "ALTER TABLE co_management_participants ADD COLUMN permission_generation INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

fn ensure_operation_journal_fingerprint_columns(connection: &Connection) -> AppResult<()> {
    let columns = connection
        .prepare("PRAGMA table_info(co_management_operation_journal)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<std::collections::HashSet<_>, _>>()?;
    if !columns.contains("original_fingerprint") {
        connection.execute(
            "ALTER TABLE co_management_operation_journal
             ADD COLUMN original_fingerprint TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    if !columns.contains("new_fingerprint") {
        connection.execute(
            "ALTER TABLE co_management_operation_journal ADD COLUMN new_fingerprint TEXT",
            [],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ServerOperationCoordinator {
    locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl Default for ServerOperationCoordinator {
    fn default() -> Self {
        Self {
            locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl ServerOperationCoordinator {
    fn lock_for(&self, server_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.locks
            .lock()
            .unwrap()
            .entry(server_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    pub fn blocking_lock(&self, server_id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        self.lock_for(server_id).blocking_lock_owned()
    }

    pub async fn lock(&self, server_id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        self.lock_for(server_id).lock_owned().await
    }
}

#[derive(Debug, Clone)]
pub struct HostConnectionManager {
    inner: Arc<Mutex<HostConnectionInner>>,
}

#[derive(Debug, Default)]
struct HostConnectionInner {
    connections: HashMap<String, HostConnectionEntry>,
    events: VecDeque<CoManagementEvent>,
}

#[derive(Debug, Clone)]
struct HostConnectionEntry {
    tx: tokio::sync::mpsc::UnboundedSender<BridgeCommand>,
    state: String,
    connection_id: String,
}

#[derive(Debug)]
enum BridgeCommand {
    Send(Value),
    Close,
}

impl Default for HostConnectionManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HostConnectionInner::default())),
        }
    }
}

impl HostConnectionManager {
    pub async fn connect(
        &self,
        server_id: &str,
        endpoint: &str,
        host_id: &str,
        token: &str,
    ) -> AppResult<()> {
        validate_relay_endpoint(endpoint)?;
        validate_host_id(host_id)?;
        validate_secret(token)?;
        self.disconnect(server_id);
        let ws_endpoint = websocket_endpoint(endpoint)?;
        // `Request::builder()` alone omits WebSocket handshake headers. Build
        // the canonical client request first, then add application headers.
        let mut request = ws_endpoint
            .into_client_request()
            .map_err(|error| AppError::Other(format!("共同管理接続を準備できません: {error}")))?;
        request.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&format!("Bearer {token}")).map_err(|error| {
                AppError::Other(format!("共同管理資格情報を準備できません: {error}"))
            })?,
        );
        request.headers_mut().insert(
            "X-MSH-Protocol-Version",
            HeaderValue::from_str(&PROTOCOL_VERSION.to_string()).map_err(|error| {
                AppError::Other(format!("共同管理プロトコルを準備できません: {error}"))
            })?,
        );
        let (socket, _) = connect_async(request)
            .await
            .map_err(|error| AppError::Other(format!("共同管理中継へ接続できません: {error}")))?;
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let connection_id = Uuid::new_v4().to_string();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.connections.insert(
                server_id.to_string(),
                HostConnectionEntry {
                    tx: tx.clone(),
                    state: "connecting".into(),
                    connection_id: connection_id.clone(),
                },
            );
        }
        let inner = self.inner.clone();
        let server_id_owned = server_id.to_string();
        let host_id_owned = host_id.to_string();
        let connection_id_owned = connection_id.clone();
        tokio::spawn(async move {
            run_connection(
                server_id_owned,
                host_id_owned,
                connection_id_owned,
                socket,
                rx,
                Some(ready_tx),
                inner,
            )
            .await;
        });
        match tokio::time::timeout(Duration::from_secs(5), ready_rx).await {
            Ok(Ok(Ok(()))) => {
                self.set_state_if_current(server_id, &connection_id, "connected");
                Ok(())
            }
            Ok(Ok(Err(message))) => {
                self.disconnect_if_current(server_id, &connection_id);
                Err(AppError::Other(format!(
                    "共同管理中継の接続確認に失敗しました: {message}"
                )))
            }
            Ok(Err(_)) => {
                self.disconnect_if_current(server_id, &connection_id);
                Err(AppError::Other(
                    "共同管理中継の接続確認が中断されました".into(),
                ))
            }
            Err(_) => {
                self.disconnect_if_current(server_id, &connection_id);
                Err(AppError::Other(
                    "共同管理中継からhost.readyを受信できませんでした".into(),
                ))
            }
        }
    }

    pub fn disconnect(&self, server_id: &str) {
        if let Some(entry) = self.inner.lock().unwrap().connections.remove(server_id) {
            let _ = entry.tx.send(BridgeCommand::Close);
        }
    }

    fn disconnect_if_current(&self, server_id: &str, connection_id: &str) {
        let entry = {
            let mut inner = self.inner.lock().unwrap();
            let current = inner.connections.get(server_id);
            if current.is_none_or(|item| item.connection_id != connection_id) {
                None
            } else {
                inner.connections.remove(server_id)
            }
        };
        if let Some(entry) = entry {
            let _ = entry.tx.send(BridgeCommand::Close);
        }
    }

    pub fn state(&self, server_id: &str) -> String {
        self.inner
            .lock()
            .unwrap()
            .connections
            .get(server_id)
            .map(|entry| entry.state.clone())
            .unwrap_or_else(|| "disconnected".into())
    }

    fn set_state_if_current(&self, server_id: &str, connection_id: &str, state: &str) {
        if let Some(entry) = self.inner.lock().unwrap().connections.get_mut(server_id)
            && entry.connection_id == connection_id
        {
            entry.state = state.into();
        }
    }

    pub fn send(&self, server_id: &str, payload: Value) -> AppResult<()> {
        if serde_json::to_vec(&payload)?.len() > MAX_BRIDGE_MESSAGE_BYTES {
            return Err(AppError::Validation(
                "共同管理メッセージが大きすぎます".into(),
            ));
        }
        let inner = self.inner.lock().unwrap();
        let entry = inner
            .connections
            .get(server_id)
            .ok_or_else(|| AppError::Validation("共同管理中継に接続していません".into()))?;
        entry
            .tx
            .send(BridgeCommand::Send(payload))
            .map_err(|_| AppError::Other("共同管理中継への送信に失敗しました".into()))
    }

    pub fn poll_events(&self) -> Vec<CoManagementEvent> {
        let mut inner = self.inner.lock().unwrap();
        inner.events.drain(..).collect()
    }

    fn push_event(inner: &Arc<Mutex<HostConnectionInner>>, server_id: &str, payload: Value) {
        let event_type = payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        if matches!(
            event_type.as_str(),
            "host.ready" | "host.ping" | "host.pong"
        ) {
            return;
        }
        if let Ok(serialized) = serde_json::to_vec(&payload) {
            if serialized.len() <= MAX_BRIDGE_MESSAGE_BYTES {
                inner.lock().unwrap().events.push_back(CoManagementEvent {
                    server_id: server_id.to_string(),
                    event_type,
                    payload,
                });
            }
        }
    }
}

async fn run_connection(
    server_id: String,
    host_id: String,
    connection_id: String,
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<BridgeCommand>,
    mut ready: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
    inner: Arc<Mutex<HostConnectionInner>>,
) {
    let (mut writer, mut reader) = socket.split();
    let hello = json!({
        "type": "host.hello",
        "protocolVersion": PROTOCOL_VERSION,
        "hostId": host_id,
        "serverId": server_id,
    });
    if writer
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        signal_connection_ready(&mut ready, Err("host.helloを送信できませんでした".into()));
        mark_connection_disconnected(&inner, &server_id, &connection_id);
        return;
    }
    let mut ready_confirmed = false;
    loop {
        tokio::select! {
            command = rx.recv() => {
                match command {
                    Some(BridgeCommand::Send(payload)) => {
                        if writer.send(Message::Text(payload.to_string().into())).await.is_err() { break; }
                    }
                    Some(BridgeCommand::Close) | None => break,
                }
            }
            message = reader.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if text.len() <= MAX_BRIDGE_MESSAGE_BYTES {
                            if let Ok(payload) = serde_json::from_str::<Value>(&text) {
                                if !ready_confirmed {
                                    match validate_host_ready(&payload, &host_id, &server_id) {
                                        Ok(true) => {
                                            ready_confirmed = true;
                                            signal_connection_ready(&mut ready, Ok(()));
                                            continue;
                                        }
                                        Ok(false) => {
                                            signal_connection_ready(&mut ready, Err("host.ready以外の初期応答です".into()));
                                            break;
                                        }
                                        Err(message) => {
                                            signal_connection_ready(&mut ready, Err(message));
                                            break;
                                        }
                                    }
                                }
                                HostConnectionManager::push_event(&inner, &server_id, payload);
                            }
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) if bytes.len() <= MAX_BRIDGE_MESSAGE_BYTES => {
                        if let Ok(payload) = serde_json::from_slice::<Value>(&bytes) {
                            if !ready_confirmed {
                                match validate_host_ready(&payload, &host_id, &server_id) {
                                    Ok(true) => {
                                        ready_confirmed = true;
                                        signal_connection_ready(&mut ready, Ok(()));
                                        continue;
                                    }
                                    Ok(false) => {
                                        signal_connection_ready(&mut ready, Err("host.ready以外の初期応答です".into()));
                                        break;
                                    }
                                    Err(message) => {
                                        signal_connection_ready(&mut ready, Err(message));
                                        break;
                                    }
                                }
                            }
                            HostConnectionManager::push_event(&inner, &server_id, payload);
                        }
                    }
                    Some(Ok(Message::Ping(value))) => {
                        if writer.send(Message::Pong(value)).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
    if !ready_confirmed {
        signal_connection_ready(
            &mut ready,
            Err("host.readyの前に接続が切断されました".into()),
        );
    }
    mark_connection_disconnected(&inner, &server_id, &connection_id);
}

fn signal_connection_ready(
    ready: &mut Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
    result: Result<(), String>,
) {
    if let Some(sender) = ready.take() {
        let _ = sender.send(result);
    }
}

fn validate_host_ready(payload: &Value, host_id: &str, server_id: &str) -> Result<bool, String> {
    match payload.get("type").and_then(Value::as_str) {
        Some("host.ready") => {
            if payload.get("protocolVersion").and_then(Value::as_u64)
                != Some(u64::from(PROTOCOL_VERSION))
                || payload.get("hostId").and_then(Value::as_str) != Some(host_id)
                || payload.get("serverId").and_then(Value::as_str) != Some(server_id)
            {
                Err("host.readyのホストまたはサーバーIDが一致しません".into())
            } else {
                Ok(true)
            }
        }
        Some("host.error") => Err("中継がホスト接続を拒否しました".into()),
        _ => Ok(false),
    }
}

fn mark_connection_disconnected(
    inner: &Arc<Mutex<HostConnectionInner>>,
    server_id: &str,
    connection_id: &str,
) {
    if let Some(entry) = inner.lock().unwrap().connections.get_mut(server_id)
        && entry.connection_id == connection_id
    {
        entry.state = "disconnected".into();
    }
}

pub fn validate_relay_endpoint(endpoint: &str) -> AppResult<Url> {
    let url = Url::parse(endpoint.trim()).map_err(|_| {
        AppError::Validation("共同管理の中継URLはhttp(s)://で指定してください".into())
    })?;
    if !matches!(url.scheme(), "http" | "https")
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err(AppError::Validation(
            "共同管理の中継URLに認証情報・クエリ・フラグメントは指定できません".into(),
        ));
    }
    if url.scheme() == "http" && !is_loopback_host(url.host_str().unwrap_or_default()) {
        return Err(AppError::Validation(
            "本番の共同管理中継はHTTPSを使用してください。HTTPはlocalhostの開発接続だけ許可します"
                .into(),
        ));
    }
    Ok(url)
}

fn websocket_endpoint(endpoint: &str) -> AppResult<String> {
    let mut url = validate_relay_endpoint(endpoint)?;
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme)
        .map_err(|_| AppError::Validation("共同管理WebSocketのURLを作れません".into()))?;
    let base = url.path().trim_end_matches('/').to_string();
    let websocket_path = if base.is_empty() {
        "/ws/host".to_string()
    } else {
        format!("{base}/ws/host")
    };
    url.set_path(&websocket_path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

pub fn generate_host_id() -> String {
    format!("host-{}", Uuid::new_v4().simple())
}

pub fn generate_secret() -> String {
    let mut bytes = Vec::with_capacity(MIN_INVITE_SECRET_BYTES);
    bytes.extend_from_slice(Uuid::new_v4().as_bytes());
    bytes.extend_from_slice(Uuid::new_v4().as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash_secret(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn config_fingerprint(profile: &ServerProfile) -> AppResult<String> {
    let path = settings_path(profile);
    let bytes = std::fs::read(&path)
        .map_err(|_| AppError::Validation("共同管理の対象設定ファイルを確認できません".into()))?;
    Ok(file_fingerprint_from_bytes(&bytes))
}

fn current_file_fingerprint(path: &Path) -> AppResult<Option<String>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(file_fingerprint_from_bytes(&bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn cleanup_incomplete_backup_part(backup_path: Option<&str>) -> AppResult<()> {
    let Some(backup_path) = backup_path else {
        return Ok(());
    };
    let backup_path = Path::new(backup_path);
    if backup_path.extension().and_then(|value| value.to_str()) != Some("zip") {
        return Ok(());
    }
    let temporary = backup_path.with_extension("zip.part");
    match std::fs::remove_file(temporary) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn file_fingerprint_from_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn settings_path(profile: &ServerProfile) -> PathBuf {
    if profile.game_adapter().is_palworld() {
        Path::new(&profile.root_path)
            .join("Pal")
            .join("Saved")
            .join("Config")
            .join("WindowsServer")
            .join("PalWorldSettings.ini")
    } else {
        Path::new(&profile.root_path).join("server.properties")
    }
}

pub fn capabilities(profile: &ServerProfile) -> Vec<CoManagementCapability> {
    let integer = |key: &str, min: f64, max: f64| CoManagementCapability {
        key: key.into(),
        value_type: "integer".into(),
        editable_when_stopped: true,
        min: Some(min),
        max: Some(max),
        enum_values: Vec::new(),
    };
    let boolean = |key: &str| CoManagementCapability {
        key: key.into(),
        value_type: "boolean".into(),
        editable_when_stopped: true,
        min: None,
        max: None,
        enum_values: Vec::new(),
    };
    let enumeration = |key: &str, values: &[&str]| CoManagementCapability {
        key: key.into(),
        value_type: "string".into(),
        editable_when_stopped: true,
        min: None,
        max: None,
        enum_values: values.iter().map(|value| (*value).into()).collect(),
    };
    let text = |key: &str, max: f64| CoManagementCapability {
        key: key.into(),
        value_type: "string".into(),
        editable_when_stopped: true,
        min: None,
        max: Some(max),
        enum_values: Vec::new(),
    };
    let number = |key: &str, min: f64, max: f64| CoManagementCapability {
        key: key.into(),
        value_type: "number".into(),
        editable_when_stopped: true,
        min: Some(min),
        max: Some(max),
        enum_values: Vec::new(),
    };
    if profile.game_adapter().is_palworld() {
        return vec![
            text("serverDescription", 256.0),
            integer("maxPlayers", 1.0, 32.0),
            number("expRate", 0.1, 20.0),
            number("collectionDropRate", 0.1, 20.0),
            number("palCaptureRate", 0.1, 20.0),
            number("dayTimeSpeedRate", 0.1, 20.0),
            number("nightTimeSpeedRate", 0.1, 20.0),
            number("palEggDefaultHatchingTime", 0.0, 240.0),
            enumeration("deathPenalty", &["None", "Item", "ItemAndEquipment", "All"]),
            boolean("invaderEnemiesEnabled"),
            boolean("fastTravelEnabled"),
            integer("baseCampMaxNumInGuild", 1.0, 10.0),
            integer("baseCampWorkerMaxNum", 1.0, 50.0),
        ];
    }
    let mut result = vec![
        enumeration("difficulty", &["peaceful", "easy", "normal", "hard"]),
        enumeration(
            "defaultGameMode",
            &["survival", "creative", "adventure", "spectator"],
        ),
        integer("maxPlayers", 1.0, 500.0),
    ];
    if profile.game_adapter().is_minecraft_bedrock() {
        result.push(integer("viewDistance", 2.0, 32.0));
    } else {
        result.extend([
            boolean("pvp"),
            boolean("allowFlight"),
            boolean("forceGameMode"),
            integer("spawnProtection", 0.0, 256.0),
            integer("viewDistance", 2.0, 32.0),
            integer("simulationDistance", 2.0, 32.0),
        ]);
    }
    result
}

pub fn safe_settings(profile: &ServerProfile) -> AppResult<Value> {
    let source = if profile.game_adapter().is_palworld() {
        serde_json::to_value(
            profile
                .palworld_settings
                .as_ref()
                .ok_or_else(|| AppError::Validation("Palworld共同管理設定がありません".into()))?,
        )?
    } else {
        serde_json::to_value(&profile.settings)?
    };
    let keys = capabilities(profile)
        .into_iter()
        .map(|capability| capability.key)
        .collect::<Vec<_>>();
    let source = source
        .as_object()
        .ok_or_else(|| AppError::Other("共同管理設定をオブジェクトへ変換できません".into()))?;
    let mut fields = Map::new();
    for key in keys {
        if let Some(value) = source.get(&key) {
            fields.insert(key, value.clone());
        }
    }
    Ok(Value::Object(fields))
}

pub fn build_snapshot(
    profile: &ServerProfile,
    status: &RuntimeStatus,
    config: &CoManagementConfig,
    participants: Vec<CoManagementParticipant>,
    invites: Vec<CoManagementInvite>,
    connection_state: String,
) -> CoManagementServerSnapshot {
    CoManagementServerSnapshot {
        server_id: profile.id.clone(),
        server_name: profile.name.clone(),
        game_kind: profile.edition().into(),
        state: status.state.clone(),
        player_count: status.player_count,
        max_players: status.max_players,
        fetched_at: Utc::now().to_rfc3339(),
        revision: config.revision,
        capabilities: capabilities(profile),
        enabled: config.enabled,
        connection_state,
        participants,
        invites,
    }
}

pub fn build_settings_snapshot(
    profile: &ServerProfile,
    status: &RuntimeStatus,
    revision: u64,
) -> AppResult<CoManagementSettingsSnapshot> {
    Ok(CoManagementSettingsSnapshot {
        server_id: profile.id.clone(),
        game_kind: profile.edition().into(),
        state: status.state.clone(),
        revision,
        fetched_at: Utc::now().to_rfc3339(),
        fields: safe_settings(profile)?,
        capabilities: capabilities(profile),
        editable: status.state == "stopped",
    })
}

pub fn validate_role(role: &str) -> AppResult<()> {
    if matches!(role, "viewer" | "editor") {
        Ok(())
    } else {
        Err(AppError::Validation(
            "共同管理権限はviewerまたはeditorです".into(),
        ))
    }
}

pub fn validate_display_name(name: &str) -> AppResult<()> {
    let value = name.trim();
    if value.is_empty() || value.chars().count() > 32 || value.chars().any(char::is_control) {
        return Err(AppError::Validation(
            "共同管理の表示名は制御文字を含めず1～32文字で入力してください".into(),
        ));
    }
    Ok(())
}

fn validate_host_id(value: &str) -> AppResult<()> {
    if value.len() > 128
        || value.is_empty()
        || value
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_')))
    {
        return Err(AppError::Validation("共同管理ホストIDが不正です".into()));
    }
    Ok(())
}

fn validate_secret(value: &str) -> AppResult<()> {
    if value.len() < 32 || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(AppError::Validation(
            "共同管理資格情報の長さが不正です".into(),
        ));
    }
    Ok(())
}

pub fn create_invite(
    store: &CoManagementStore,
    manager: &HostConnectionManager,
    profile: &ServerProfile,
    endpoint: &str,
    role: &str,
    expires_minutes: Option<u16>,
) -> AppResult<CoManagementInviteResult> {
    validate_role(role)?;
    validate_relay_endpoint(endpoint)?;
    let minutes = i64::from(expires_minutes.unwrap_or(INVITE_LIFETIME_MINUTES as u16));
    if !(1..=10).contains(&minutes) {
        return Err(AppError::Validation(
            "共同管理招待の有効期限は1～10分です".into(),
        ));
    }
    let secret = generate_secret();
    validate_secret(&secret)?;
    let invite_id = format!("invite-{}", Uuid::new_v4().simple());
    let issued_at = Utc::now();
    let expires_at = issued_at + chrono::Duration::minutes(minutes);
    store.insert_invite(
        &profile.id,
        &invite_id,
        &hash_secret(&secret),
        role,
        &issued_at.to_rfc3339(),
        &expires_at.to_rfc3339(),
    )?;
    let payload = json!({
        "type": "invite.register",
        "protocolVersion": PROTOCOL_VERSION,
        "inviteId": invite_id,
        "serverId": profile.id,
        "role": role,
        "secretHash": hash_secret(&secret),
        "expiresAt": expires_at.to_rfc3339(),
    });
    if let Err(error) = manager.send(&profile.id, payload) {
        let _ = store.revoke_invite(&invite_id);
        return Err(error);
    }
    let base = endpoint.trim_end_matches('/');
    Ok(CoManagementInviteResult {
        invite_id,
        role: role.into(),
        expires_at: expires_at.to_rfc3339(),
        invite_url: format!("{base}/#invite={secret}"),
    })
}

pub async fn register_host(
    client: &reqwest::Client,
    endpoint: &str,
    host_id: &str,
    token: &str,
) -> AppResult<()> {
    let base = validate_relay_endpoint(endpoint)?;
    validate_host_id(host_id)?;
    validate_secret(token)?;
    let url = format!(
        "{}/api/v1/hosts/register",
        base.as_str().trim_end_matches('/')
    );
    let response = client
        .post(url)
        .json(&json!({
            "hostId": host_id,
            "token": token,
            "protocolVersion": PROTOCOL_VERSION,
        }))
        .send()
        .await
        .map_err(|error| AppError::Other(format!("共同管理ホスト登録に失敗しました: {error}")))?;
    if !response.status().is_success() {
        return Err(AppError::Other(
            "共同管理中継がホスト登録を拒否しました".into(),
        ));
    }
    Ok(())
}

pub fn authorize_participant(
    store: &CoManagementStore,
    server_id: &str,
    participant_id: &str,
    requested_role: &str,
) -> AppResult<CoManagementParticipant> {
    validate_role(requested_role)?;
    let config = store
        .config(server_id)?
        .ok_or_else(|| AppError::Validation("共同管理設定が見つかりません".into()))?;
    let participant = store
        .participant(server_id, participant_id)?
        .ok_or_else(|| AppError::Validation("共同管理参加者が見つかりません".into()))?;
    if !config.enabled
        || participant.state != "approved"
        || participant.expires_at <= Utc::now().to_rfc3339()
        || participant.permission_generation != config.permission_generation
    {
        return Err(AppError::Validation(
            "共同管理の権限が失効しています".into(),
        ));
    }
    if requested_role == "editor" && participant.role != "editor" {
        return Err(AppError::Validation(
            "設定を変更する権限がありません".into(),
        ));
    }
    Ok(participant)
}

pub fn validate_changes(profile: &ServerProfile, changes: &Value) -> AppResult<Vec<String>> {
    let object = changes.as_object().ok_or_else(|| {
        AppError::Validation("共同管理の変更内容はJSONオブジェクトで指定してください".into())
    })?;
    if object.is_empty() || object.len() > 32 {
        return Err(AppError::Validation(
            "共同管理の変更項目数が不正です".into(),
        ));
    }
    let definitions = capabilities(profile);
    let mut changed = Vec::new();
    for (key, value) in object {
        let capability = definitions
            .iter()
            .find(|item| item.key == *key)
            .ok_or_else(|| {
                AppError::Validation(format!("共同管理では「{key}」を変更できません"))
            })?;
        validate_value(capability, value)?;
        changed.push(key.clone());
    }
    changed.sort();
    Ok(changed)
}

fn validate_value(capability: &CoManagementCapability, value: &Value) -> AppResult<()> {
    match capability.value_type.as_str() {
        "boolean" if value.is_boolean() => Ok(()),
        "integer" => {
            let number = value.as_i64().ok_or_else(|| {
                AppError::Validation(format!("{}は整数で指定してください", capability.key))
            })?;
            let number = number as f64;
            if capability.min.is_some_and(|min| number < min)
                || capability.max.is_some_and(|max| number > max)
            {
                return Err(AppError::Validation(format!(
                    "{}の範囲が不正です",
                    capability.key
                )));
            }
            Ok(())
        }
        "number" => {
            let number = value
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "{}は有限の数値で指定してください",
                        capability.key
                    ))
                })?;
            if capability.min.is_some_and(|min| number < min)
                || capability.max.is_some_and(|max| number > max)
            {
                return Err(AppError::Validation(format!(
                    "{}の範囲が不正です",
                    capability.key
                )));
            }
            Ok(())
        }
        "string" => {
            let text = value.as_str().ok_or_else(|| {
                AppError::Validation(format!("{}は文字列で指定してください", capability.key))
            })?;
            if text.chars().any(char::is_control)
                || capability
                    .max
                    .is_some_and(|max| text.chars().count() as f64 > max)
                || (!capability.enum_values.is_empty()
                    && !capability
                        .enum_values
                        .iter()
                        .any(|candidate| candidate == text))
            {
                return Err(AppError::Validation(format!(
                    "{}の値が不正です",
                    capability.key
                )));
            }
            Ok(())
        }
        _ => Err(AppError::Validation("共同管理の設定型が不正です".into())),
    }
}

fn apply_basic_changes(
    settings: &mut BasicSettings,
    changes: &Map<String, Value>,
) -> AppResult<()> {
    for (key, value) in changes {
        match key.as_str() {
            "difficulty" => settings.difficulty = value.as_str().unwrap_or_default().into(),
            "defaultGameMode" => {
                settings.default_game_mode = value.as_str().unwrap_or_default().into()
            }
            "maxPlayers" => {
                settings.max_players = value.as_u64().ok_or_else(|| {
                    AppError::Validation("maxPlayersは整数で指定してください".into())
                })? as u16
            }
            "pvp" => {
                settings.pvp = value
                    .as_bool()
                    .ok_or_else(|| AppError::Validation("pvpは真偽値で指定してください".into()))?
            }
            "allowFlight" => {
                settings.allow_flight = value.as_bool().ok_or_else(|| {
                    AppError::Validation("allowFlightは真偽値で指定してください".into())
                })?
            }
            "forceGameMode" => {
                settings.force_game_mode = value.as_bool().ok_or_else(|| {
                    AppError::Validation("forceGameModeは真偽値で指定してください".into())
                })?
            }
            "spawnProtection" => {
                settings.spawn_protection = value.as_u64().ok_or_else(|| {
                    AppError::Validation("spawnProtectionは整数で指定してください".into())
                })? as u16
            }
            "viewDistance" => {
                settings.view_distance = value.as_u64().ok_or_else(|| {
                    AppError::Validation("viewDistanceは整数で指定してください".into())
                })? as u8
            }
            "simulationDistance" => {
                settings.simulation_distance = value.as_u64().ok_or_else(|| {
                    AppError::Validation("simulationDistanceは整数で指定してください".into())
                })? as u8
            }
            _ => {
                return Err(AppError::Validation(format!(
                    "共同管理では「{key}」を変更できません"
                )));
            }
        }
    }
    Ok(())
}

fn apply_palworld_changes(
    settings: &mut PalworldSettings,
    changes: &Map<String, Value>,
) -> AppResult<()> {
    for (key, value) in changes {
        match key.as_str() {
            "serverDescription" => {
                settings.server_description = value.as_str().unwrap_or_default().into()
            }
            "maxPlayers" => {
                settings.max_players = value.as_u64().ok_or_else(|| {
                    AppError::Validation("maxPlayersは整数で指定してください".into())
                })? as u16
            }
            "expRate" => {
                settings.exp_rate = value
                    .as_f64()
                    .ok_or_else(|| AppError::Validation("expRateは数値で指定してください".into()))?
                    as f32
            }
            "collectionDropRate" => {
                settings.collection_drop_rate = value.as_f64().ok_or_else(|| {
                    AppError::Validation("collectionDropRateは数値で指定してください".into())
                })? as f32
            }
            "palCaptureRate" => {
                settings.pal_capture_rate = value.as_f64().ok_or_else(|| {
                    AppError::Validation("palCaptureRateは数値で指定してください".into())
                })? as f32
            }
            "dayTimeSpeedRate" => {
                settings.day_time_speed_rate = value.as_f64().ok_or_else(|| {
                    AppError::Validation("dayTimeSpeedRateは数値で指定してください".into())
                })? as f32
            }
            "nightTimeSpeedRate" => {
                settings.night_time_speed_rate = value.as_f64().ok_or_else(|| {
                    AppError::Validation("nightTimeSpeedRateは数値で指定してください".into())
                })? as f32
            }
            "palEggDefaultHatchingTime" => {
                settings.pal_egg_default_hatching_time = value.as_f64().ok_or_else(|| {
                    AppError::Validation("palEggDefaultHatchingTimeは数値で指定してください".into())
                })? as f32
            }
            "deathPenalty" => settings.death_penalty = value.as_str().unwrap_or_default().into(),
            "invaderEnemiesEnabled" => {
                settings.invader_enemies_enabled = value.as_bool().ok_or_else(|| {
                    AppError::Validation("invaderEnemiesEnabledは真偽値で指定してください".into())
                })?
            }
            "fastTravelEnabled" => {
                settings.fast_travel_enabled = value.as_bool().ok_or_else(|| {
                    AppError::Validation("fastTravelEnabledは真偽値で指定してください".into())
                })?
            }
            "baseCampMaxNumInGuild" => {
                settings.base_camp_max_num_in_guild = value.as_u64().ok_or_else(|| {
                    AppError::Validation("baseCampMaxNumInGuildは整数で指定してください".into())
                })? as u16
            }
            "baseCampWorkerMaxNum" => {
                settings.base_camp_worker_max_num = value.as_u64().ok_or_else(|| {
                    AppError::Validation("baseCampWorkerMaxNumは整数で指定してください".into())
                })? as u16
            }
            _ => {
                return Err(AppError::Validation(format!(
                    "共同管理では「{key}」を変更できません"
                )));
            }
        }
    }
    Ok(())
}

struct PreparedCoManagementChange {
    updated: ServerProfile,
    source_text: String,
    rendered: String,
}

fn prepare_co_management_change(
    profile: &ServerProfile,
    changes: &Value,
    original_bytes: &[u8],
    original_exists: bool,
) -> AppResult<PreparedCoManagementChange> {
    let changes = changes
        .as_object()
        .ok_or_else(|| AppError::Validation("共同管理設定の変更形式が不正です".into()))?;
    let mut updated = profile.clone();
    if profile.game_adapter() == GameAdapter::Palworld {
        let mut pal_settings = profile
            .palworld_settings
            .clone()
            .ok_or_else(|| AppError::Validation("Palworld共同管理設定がありません".into()))?;
        apply_palworld_changes(&mut pal_settings, changes)?;
        let admin_password = credentials::load_palworld_admin_password(&profile.id)?;
        palworld::validate_settings(profile.port, &pal_settings)?;
        let source_text = if original_exists {
            String::from_utf8(original_bytes.to_vec()).map_err(|_| {
                AppError::Other("Palworld設定ファイルをUTF-8として読めません".into())
            })?
        } else {
            std::fs::read_to_string(
                Path::new(&profile.root_path).join("DefaultPalWorldSettings.ini"),
            )?
        };
        let rendered = palworld::render_config_from_source(
            &source_text,
            &profile.name,
            profile.port,
            &pal_settings,
            &admin_password,
            None,
        )?;
        updated.palworld_settings = Some(pal_settings);
        updated.pending_restart = true;
        updated.updated_at = Utc::now().to_rfc3339();
        Ok(PreparedCoManagementChange {
            updated,
            source_text,
            rendered,
        })
    } else {
        let mut basic = profile.settings.clone();
        apply_basic_changes(&mut basic, changes)?;
        let source_text = if original_exists {
            String::from_utf8(original_bytes.to_vec()).map_err(|_| {
                AppError::Other("Minecraft設定ファイルをUTF-8として読めません".into())
            })?
        } else {
            String::new()
        };
        let rendered = settings::render(
            profile,
            &source_text,
            &basic,
            profile.max_memory_mib,
            profile.port,
        )?;
        updated.settings = basic;
        updated.pending_restart = true;
        updated.updated_at = Utc::now().to_rfc3339();
        Ok(PreparedCoManagementChange {
            updated,
            source_text,
            rendered,
        })
    }
}

#[cfg(test)]
thread_local! {
    static TEST_INTERRUPT_STAGE: std::cell::RefCell<Option<&'static str>> = const {
        std::cell::RefCell::new(None)
    };
}

#[cfg(test)]
fn set_test_interrupt_stage(stage: Option<&'static str>) {
    TEST_INTERRUPT_STAGE.with(|current| *current.borrow_mut() = stage);
}

#[cfg(test)]
fn interrupt_for_test(stage: &str) -> AppResult<()> {
    TEST_INTERRUPT_STAGE.with(|current| {
        if *current.borrow() == Some(stage) {
            Err(AppError::Other(format!("test-interruption:{stage}")))
        } else {
            Ok(())
        }
    })
}

#[cfg(not(test))]
fn interrupt_for_test(_stage: &str) -> AppResult<()> {
    Ok(())
}

pub fn apply_settings(
    cm_store: &CoManagementStore,
    store: &Store,
    backups_dir: &Path,
    processes: &ProcessMap,
    stopping: &StoppingMap,
    input: &CoManagementApplyInput,
) -> AppResult<CoManagementApplyResult> {
    let participant = authorize_participant(
        cm_store,
        &input.server_id,
        &input.participant_id,
        &input.role,
    )?;
    if input.role != "editor" || participant.role != "editor" {
        return Err(AppError::Validation(
            "設定を変更する権限がありません".into(),
        ));
    }
    if process::is_busy(&input.server_id, processes, stopping) {
        return Err(AppError::Validation(
            "サーバーが停止していないため、共同管理設定を保存できません".into(),
        ));
    }
    let config = cm_store
        .config(&input.server_id)?
        .ok_or(AppError::NotFound)?;
    if !config.enabled {
        return Err(AppError::Validation("共同管理が無効になっています".into()));
    }
    cm_store.ensure_change_allowed(&input.server_id)?;
    let profile = store.get_server(&input.server_id)?;
    let changed_fields = validate_changes(&profile, &input.changes)?;
    let content_hash = hash_secret(&serde_json::to_string(&json!({
        "serverId": input.server_id,
        "participantId": input.participant_id,
        "expectedRevision": input.expected_revision,
        "changes": input.changes,
    }))?);
    let original_path = settings_path(&profile);
    let original_exists = original_path.is_file();
    let original_bytes = std::fs::read(&original_path)?;
    let fingerprint = file_fingerprint_from_bytes(&original_bytes);
    if config
        .fingerprint
        .as_deref()
        .is_some_and(|stored| stored != fingerprint)
    {
        cm_store.fail_operation(
            &input.server_id,
            &input.participant_id,
            &input.request_id,
            "external-file-conflict",
        )?;
        return Err(AppError::Other(
            "409 Conflict: 設定ファイルが外部で変更されたため、再取得が必要です".into(),
        ));
    }
    if config.revision != input.expected_revision {
        cm_store.fail_operation(
            &input.server_id,
            &input.participant_id,
            &input.request_id,
            "revision-conflict",
        )?;
        return Err(AppError::Other(
            "409 Conflict: 設定revisionが古いため、再取得が必要です".into(),
        ));
    }

    let before_fields = safe_settings(&profile)?;
    let prepared =
        prepare_co_management_change(&profile, &input.changes, &original_bytes, original_exists)?;
    let next_fingerprint = file_fingerprint_from_bytes(prepared.rendered.as_bytes());
    let backup_operation_id = format!(
        "{}\u{1f}{}\u{1f}{}",
        input.server_id, input.participant_id, input.request_id
    );
    let planned_backup_path =
        backup::planned_co_management_backup_path(backups_dir, &profile, &backup_operation_id);
    if let Some(existing) = cm_store.begin_operation_with_journal(
        &input.request_id,
        &input.server_id,
        &input.participant_id,
        &content_hash,
        &planned_backup_path,
        &original_path,
        original_exists,
        &original_bytes,
        &profile,
        &fingerprint,
        &next_fingerprint,
        "backup-started",
    )? {
        if existing.state == "completed" {
            let result = existing
                .result
                .ok_or_else(|| AppError::Other("保存結果がありません".into()))?;
            return serde_json::from_value(result).map_err(Into::into);
        }
        if existing.state == "failed" {
            return Err(AppError::Other(format!(
                "共同管理保存が失敗済みです: {}",
                existing.error_code.unwrap_or_else(|| "failed".into())
            )));
        }
        return Err(AppError::Other(
            "共同管理保存は実行中です。結果照会を行ってください".into(),
        ));
    }
    interrupt_for_test("operation-started")?;
    interrupt_for_test("backup-started")?;
    let backup_info = match backup::create_for_operation(
        backups_dir,
        &profile,
        "before-co-management-settings",
        &backup_operation_id,
    ) {
        Ok(value) => value,
        Err(error) => {
            return abort_journaled_change(
                cm_store,
                store,
                input,
                &profile,
                &original_path,
                original_exists,
                &original_bytes,
                &fingerprint,
                &next_fingerprint,
                false,
                "backup-failed",
                error,
            );
        }
    };
    interrupt_for_test("backup-completed-before-stage")?;
    if let Err(error) = cm_store.update_operation_stage(
        &input.server_id,
        &input.participant_id,
        &input.request_id,
        "backup-created",
    ) {
        let _ = cm_store.mark_recovery_required(
            &input.server_id,
            &input.participant_id,
            &input.request_id,
            "needs-recovery",
        );
        return Err(error);
    }
    interrupt_for_test("backup-created")?;
    if let Err(error) = cm_store.update_operation_stage(
        &input.server_id,
        &input.participant_id,
        &input.request_id,
        "file-write-started",
    ) {
        let _ = cm_store.mark_recovery_required(
            &input.server_id,
            &input.participant_id,
            &input.request_id,
            "needs-recovery",
        );
        return Err(error);
    }
    interrupt_for_test("file-write-started")?;
    let current_before_write = match current_file_fingerprint(&original_path) {
        Ok(value) => value,
        Err(error) => {
            return abort_journaled_change(
                cm_store,
                store,
                input,
                &profile,
                &original_path,
                original_exists,
                &original_bytes,
                &fingerprint,
                &next_fingerprint,
                false,
                "settings-file-read-failed",
                error,
            );
        }
    };
    if current_before_write.as_deref() != Some(fingerprint.as_str()) {
        return abort_journaled_change(
            cm_store,
            store,
            input,
            &profile,
            &original_path,
            original_exists,
            &original_bytes,
            &fingerprint,
            &next_fingerprint,
            false,
            "external-file-conflict",
            AppError::Other(
                "409 Conflict: 設定ファイルが外部で変更されたため、再取得が必要です".into(),
            ),
        );
    }
    let write_result = if profile.game_adapter() == GameAdapter::Palworld {
        palworld::write_prepared_config(
            Path::new(&profile.root_path),
            &original_path,
            prepared.source_text.as_bytes(),
            &prepared.rendered,
        )
        .map(|_| ())
    } else {
        settings::write_rendered(
            &profile,
            &prepared.source_text,
            original_exists,
            &prepared.rendered,
        )
    };
    if let Err(error) = write_result {
        return abort_journaled_change(
            cm_store,
            store,
            input,
            &profile,
            &original_path,
            original_exists,
            &original_bytes,
            &fingerprint,
            &next_fingerprint,
            false,
            "validation-or-file-write-failed",
            error,
        );
    }
    let current_after_write = match current_file_fingerprint(&original_path) {
        Ok(value) => value,
        Err(error) => {
            return abort_journaled_change(
                cm_store,
                store,
                input,
                &profile,
                &original_path,
                original_exists,
                &original_bytes,
                &fingerprint,
                &next_fingerprint,
                false,
                "file-fingerprint-failed",
                error,
            );
        }
    };
    if current_after_write.as_deref() != Some(next_fingerprint.as_str()) {
        return abort_journaled_change(
            cm_store,
            store,
            input,
            &profile,
            &original_path,
            original_exists,
            &original_bytes,
            &fingerprint,
            &next_fingerprint,
            false,
            "file-fingerprint-mismatch",
            AppError::Other("保存後の設定ファイルを検証できませんでした".into()),
        );
    }
    interrupt_for_test("file-written-before-stage")?;
    if let Err(error) = cm_store.update_operation_stage(
        &input.server_id,
        &input.participant_id,
        &input.request_id,
        "file-written",
    ) {
        return abort_journaled_change(
            cm_store,
            store,
            input,
            &profile,
            &original_path,
            original_exists,
            &original_bytes,
            &fingerprint,
            &next_fingerprint,
            false,
            "journal-stage-failed",
            error,
        );
    }
    interrupt_for_test("file-written")?;
    if let Err(error) = store.update_server(&prepared.updated) {
        return abort_journaled_change(
            cm_store,
            store,
            input,
            &profile,
            &original_path,
            original_exists,
            &original_bytes,
            &fingerprint,
            &next_fingerprint,
            false,
            "database-write-failed",
            error,
        );
    }
    interrupt_for_test("database-written-before-stage")?;
    if let Err(error) = cm_store.update_operation_stage(
        &input.server_id,
        &input.participant_id,
        &input.request_id,
        "database-written",
    ) {
        return abort_journaled_change(
            cm_store,
            store,
            input,
            &profile,
            &original_path,
            original_exists,
            &original_bytes,
            &fingerprint,
            &next_fingerprint,
            true,
            "journal-stage-failed",
            error,
        );
    }
    interrupt_for_test("database-written")?;
    let after_fields = match safe_settings(&prepared.updated) {
        Ok(value) => value,
        Err(error) => {
            return abort_journaled_change(
                cm_store,
                store,
                input,
                &profile,
                &original_path,
                original_exists,
                &original_bytes,
                &fingerprint,
                &next_fingerprint,
                true,
                "result-build-failed",
                error,
            );
        }
    };
    let next_revision = config.revision.saturating_add(1);
    let settings_snapshot = match build_settings_snapshot(
        &prepared.updated,
        &RuntimeStatus {
            state: "stopped".into(),
            player_count: 0,
            max_players: u32::from(prepared.updated.settings.max_players),
            online_players: Vec::new(),
            memory_used_mib: 0,
            uptime_seconds: 0,
            address: String::new(),
            cpu_percent: 0.0,
            tps: None,
            tps_supported: false,
            ping_latency_ms: None,
            palworld: None,
        },
        next_revision,
    ) {
        Ok(value) => value,
        Err(error) => {
            return abort_journaled_change(
                cm_store,
                store,
                input,
                &profile,
                &original_path,
                original_exists,
                &original_bytes,
                &fingerprint,
                &next_fingerprint,
                true,
                "result-build-failed",
                error,
            );
        }
    };
    let result = CoManagementApplyResult {
        request_id: input.request_id.clone(),
        server_id: input.server_id.clone(),
        revision: next_revision,
        changed_fields: changed_fields.clone(),
        settings: settings_snapshot,
        message: format!(
            "設定を保存しました。次回起動から反映されます（バックアップ: {}）",
            backup_info.id
        ),
    };
    let result_value = match serde_json::to_value(&result) {
        Ok(value) => value,
        Err(error) => {
            return abort_journaled_change(
                cm_store,
                store,
                input,
                &profile,
                &original_path,
                original_exists,
                &original_bytes,
                &fingerprint,
                &next_fingerprint,
                true,
                "result-serialization-failed",
                error.into(),
            );
        }
    };
    if let Err(error) = cm_store.commit_settings_change(
        &input.server_id,
        &input.participant_id,
        &input.request_id,
        next_revision,
        &next_fingerprint,
        &participant.id,
        &participant.display_name,
        &before_fields,
        &after_fields,
        &changed_fields,
        &result_value,
        "success",
    ) {
        return abort_journaled_change(
            cm_store,
            store,
            input,
            &profile,
            &original_path,
            original_exists,
            &original_bytes,
            &fingerprint,
            &next_fingerprint,
            true,
            "audit-or-revision-write-failed",
            error,
        );
    }
    Ok(result)
}

fn rollback_settings_file(path: &Path, existed: bool, bytes: &[u8]) -> AppResult<()> {
    if existed {
        let temporary = path.with_extension("co-management-rollback.part");
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(temporary, path)?;
    } else if path.is_file() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn abort_journaled_change(
    cm_store: &CoManagementStore,
    store: &Store,
    input: &CoManagementApplyInput,
    original_profile: &ServerProfile,
    original_path: &Path,
    original_exists: bool,
    original_bytes: &[u8],
    original_fingerprint: &str,
    new_fingerprint: &str,
    restore_profile: bool,
    failure_code: &str,
    operation_error: AppError,
) -> AppResult<CoManagementApplyResult> {
    let mut rollback_errors = Vec::new();
    match current_file_fingerprint(original_path) {
        Ok(current) => {
            let matches_original = current.as_deref() == Some(original_fingerprint);
            let matches_new = current.as_deref() == Some(new_fingerprint);
            let matches_missing_original = !original_exists && current.is_none();
            if matches_original || matches_new || matches_missing_original {
                if let Err(error) =
                    rollback_settings_file(original_path, original_exists, original_bytes)
                {
                    rollback_errors.push(format!("設定ファイル: {error}"));
                }
            } else {
                rollback_errors.push(
                    "設定ファイルが元内容または今回の候補内容と一致しないため上書きできません"
                        .into(),
                );
            }
        }
        Err(error) => rollback_errors.push(format!("設定ファイルの状態確認: {error}")),
    }
    if restore_profile {
        if let Err(error) = store.update_server(original_profile) {
            rollback_errors.push(format!("設定DB: {error}"));
        }
    }
    if !rollback_errors.is_empty() {
        let marker_error = cm_store
            .mark_recovery_required(
                &input.server_id,
                &input.participant_id,
                &input.request_id,
                "needs-recovery",
            )
            .err();
        let marker_suffix = marker_error
            .map(|error| format!("。復旧状態の記録にも失敗しました: {error}"))
            .unwrap_or_default();
        return Err(AppError::Other(format!(
            "共同管理設定を復旧できませんでした: {}{}",
            rollback_errors.join("; "),
            marker_suffix
        )));
    }
    if let Err(error) = cm_store.fail_operation(
        &input.server_id,
        &input.participant_id,
        &input.request_id,
        failure_code,
    ) {
        let _ = cm_store.mark_recovery_required(
            &input.server_id,
            &input.participant_id,
            &input.request_id,
            "needs-recovery",
        );
        return Err(error);
    }
    if let Err(error) =
        cm_store.clear_operation_journal(&input.server_id, &input.participant_id, &input.request_id)
    {
        let _ = cm_store.mark_recovery_required(
            &input.server_id,
            &input.participant_id,
            &input.request_id,
            "needs-recovery",
        );
        return Err(error);
    }
    Err(operation_error)
}

pub fn record_local_change(
    cm_store: &CoManagementStore,
    server_id: &str,
    actor_id: &str,
    actor_display_name: &str,
    action: &str,
    profile: &ServerProfile,
) -> AppResult<()> {
    let Some(config) = cm_store.config(server_id)? else {
        return Ok(());
    };
    let fingerprint = config_fingerprint(profile).ok();
    let revision = config.revision.saturating_add(1);
    cm_store.bump_revision(server_id, fingerprint.as_deref())?;
    cm_store.append_audit(
        server_id,
        actor_id,
        actor_display_name,
        action,
        &json!({ "source": "local", "revision": revision }),
        "success",
        None,
    )
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, time::Duration};

    use serde_json::Value;

    use super::{
        CoManagementApplyInput, CoManagementApplyResult, CoManagementStore, abort_journaled_change,
        authorize_participant, capabilities, generate_secret, hash_secret, safe_settings,
        validate_changes, validate_relay_endpoint,
    };
    use crate::backup;
    use crate::error::{AppError, AppResult};
    use crate::models::{BasicSettings, PalworldSettings, ServerProfile};

    fn profile(server_type: &str) -> ServerProfile {
        let root = std::env::temp_dir().join(format!(
            "msh-co-management-{server_type}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("server.properties"), "difficulty=easy\n").unwrap();
        ServerProfile {
            id: "co-test".into(),
            name: "Co-management test".into(),
            root_path: root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: server_type.into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "C:\\Java\\java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: "accepted".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: "created".into(),
            updated_at: "updated".into(),
        }
    }

    #[test]
    fn invite_secret_is_at_least_32_bytes_before_encoding() {
        let secret = generate_secret();
        assert!(secret.len() >= 43);
        assert_ne!(secret, generate_secret());
        assert_eq!(hash_secret("same"), hash_secret("same"));
    }

    #[test]
    fn endpoint_policy_allows_only_loopback_http() {
        assert!(validate_relay_endpoint("http://127.0.0.1:8787").is_ok());
        assert!(validate_relay_endpoint("https://relay.example.test/base").is_ok());
        assert!(validate_relay_endpoint("http://relay.example.test").is_err());
        assert!(validate_relay_endpoint("https://user:pass@relay.example.test").is_err());
    }

    #[tokio::test]
    #[ignore = "requires an externally started local TypeScript relay"]
    async fn real_rust_host_connection_reaches_relay_and_settings_route() -> AppResult<()> {
        let endpoint = std::env::var("MSH_CO_MANAGEMENT_REAL_RELAY")
            .unwrap_or_else(|_| "http://127.0.0.1:8787".into());
        let origin = std::env::var("MSH_CO_MANAGEMENT_REAL_RELAY_ORIGIN")
            .unwrap_or_else(|_| "http://127.0.0.1:8787".into());
        let server_id = format!("rust-relay-server-{}", uuid::Uuid::new_v4().simple());
        let host_id = format!("rust-relay-host-{}", uuid::Uuid::new_v4().simple());
        let token = generate_secret();
        let invite_secret = generate_secret();
        let client = reqwest::Client::new();
        super::register_host(&client, &endpoint, &host_id, &token).await?;

        let manager = super::HostConnectionManager::default();
        manager
            .connect(&server_id, &endpoint, &host_id, &token)
            .await?;
        let expires_at = chrono::Utc::now() + chrono::Duration::minutes(5);
        manager.send(
            &server_id,
            serde_json::json!({
                "type": "invite.register",
                "protocolVersion": super::PROTOCOL_VERSION,
                "inviteId": format!("invite-{}", uuid::Uuid::new_v4().simple()),
                "serverId": server_id,
                "role": "viewer",
                "secretHash": super::hash_secret(&invite_secret),
                "expiresAt": expires_at.to_rfc3339(),
            }),
        )?;

        let redeemed = client
            .post(format!("{endpoint}/api/v1/invites/redeem"))
            .header("Origin", &origin)
            .json(&serde_json::json!({ "secret": invite_secret, "displayName": "Rust tester" }))
            .send()
            .await
            .map_err(|error| AppError::Other(format!("招待引換の接続に失敗しました: {error}")))?;
        if !redeemed.status().is_success() {
            return Err(AppError::Other(format!(
                "招待引換が失敗しました: {}",
                redeemed.status()
            )));
        }
        let cookies = redeemed
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .map(|value| value.split(';').next().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        let cookie_header = cookies.join("; ");
        let redeemed_body: Value = redeemed
            .json()
            .await
            .map_err(|error| AppError::Other(format!("招待引換応答が不正です: {error}")))?;
        let participant_id = redeemed_body
            .get("session")
            .and_then(|value| value.get("participantId"))
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Other("参加者IDを取得できませんでした".into()))?
            .to_string();

        let pending = wait_for_event(&manager, "participant.pending").await?;
        if pending.payload.get("participantId").and_then(Value::as_str)
            != Some(participant_id.as_str())
        {
            return Err(AppError::Other(
                "Rustホストが別の参加申請を受信しました".into(),
            ));
        }
        manager.send(
            &server_id,
            serde_json::json!({
                "type": "participant.approved",
                "protocolVersion": super::PROTOCOL_VERSION,
                "serverId": server_id,
                "participantId": participant_id,
            }),
        )?;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let settings_client = client.clone();
        let settings_url = format!("{endpoint}/api/v1/servers/{server_id}/settings");
        let settings_task = tokio::spawn(async move {
            settings_client
                .get(settings_url)
                .header("Origin", origin)
                .header("Cookie", cookie_header)
                .send()
                .await
        });
        let settings_request = wait_for_event(&manager, "settings.get").await?;
        let request_id = settings_request
            .payload
            .get("requestId")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Other("設定取得requestIdを取得できませんでした".into()))?;
        manager.send(
            &server_id,
            serde_json::json!({
                "type": "host.response",
                "protocolVersion": super::PROTOCOL_VERSION,
                "serverId": server_id,
                "requestId": request_id,
                "ok": true,
                "result": {
                    "serverId": server_id,
                    "gameKind": "java",
                    "state": "stopped",
                    "revision": 1,
                    "fetchedAt": chrono::Utc::now().to_rfc3339(),
                    "fields": { "difficulty": "normal" },
                    "capabilities": [],
                    "editable": false,
                },
            }),
        )?;
        let settings_response = settings_task
            .await
            .map_err(|error| AppError::Other(format!("設定取得タスクが中断されました: {error}")))?
            .map_err(|error| AppError::Other(format!("設定取得の接続に失敗しました: {error}")))?;
        if !settings_response.status().is_success() {
            return Err(AppError::Other(format!(
                "Rust接続経由の設定取得が失敗しました: {}",
                settings_response.status()
            )));
        }
        let settings_body: Value = settings_response
            .json()
            .await
            .map_err(|error| AppError::Other(format!("設定取得応答が不正です: {error}")))?;
        assert_eq!(
            settings_body
                .get("settings")
                .and_then(|value| value.get("serverId"))
                .and_then(Value::as_str),
            Some(server_id.as_str())
        );
        manager.disconnect(&server_id);
        Ok(())
    }

    async fn wait_for_event(
        manager: &super::HostConnectionManager,
        event_type: &str,
    ) -> AppResult<super::CoManagementEvent> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(event) = manager
                .poll_events()
                .into_iter()
                .find(|event| event.event_type == event_type)
            {
                return Ok(event);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(AppError::Other(format!(
                    "Rustホストが{event_type}を受信できませんでした"
                )));
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[test]
    fn capabilities_do_not_expose_host_only_fields() {
        let profile = profile("paper");
        let names = capabilities(&profile)
            .into_iter()
            .map(|item| item.key)
            .collect::<Vec<_>>();
        assert!(names.contains(&"maxPlayers".into()));
        assert!(!names.contains(&"onlineMode".into()));
        assert!(!names.contains(&"port".into()));
        assert!(
            !safe_settings(&profile)
                .unwrap()
                .to_string()
                .contains("rootPath")
        );
    }

    #[test]
    fn rejects_unknown_and_wrong_type_changes() {
        let profile = profile("paper");
        assert!(validate_changes(&profile, &serde_json::json!({"port": 25566})).is_err());
        assert!(validate_changes(&profile, &serde_json::json!({"maxPlayers": "20"})).is_err());
        assert!(validate_changes(&profile, &serde_json::json!({"maxPlayers": 24})).is_ok());
    }

    #[test]
    fn creates_co_management_tables_and_config() {
        let database =
            std::env::temp_dir().join(format!("msh-co-store-{}.sqlite3", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        let config = co_store
            .ensure_config(&profile.id, Some("fingerprint"))
            .unwrap();
        assert_eq!(config.revision, 1);
        assert_eq!(config.fingerprint.as_deref(), Some("fingerprint"));
        drop(co_store);
        drop(store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn palworld_recovery_journal_protects_secrets_and_restores_exact_bytes() {
        let database = std::env::temp_dir().join(format!(
            "msh-co-palworld-secret-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let backups = std::env::temp_dir().join(format!(
            "msh-co-palworld-secret-backups-{}",
            uuid::Uuid::new_v4()
        ));
        let mut profile = profile("palworld");
        profile.id = format!("co-palworld-secret-{}", uuid::Uuid::new_v4().simple());
        profile.game_kind = "palworld".into();
        profile.palworld_settings = Some(PalworldSettings::default());
        let settings_path = super::settings_path(&profile);
        std::fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
        let admin_secret = "U01_SYNTHETIC_ADMIN_PASSWORD_9f5d";
        let server_secret = "U01_SYNTHETIC_SERVER_PASSWORD_a3c1";
        let original = format!(
            "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"Synthetic\",AdminPassword=\"{admin_secret}\",ServerPassword=\"{server_secret}\")\n"
        );
        std::fs::write(&settings_path, original.as_bytes()).unwrap();
        let original_fingerprint = super::config_fingerprint(&profile).unwrap();
        let store = crate::store::Store::open(&database).unwrap();
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store
            .ensure_config(&profile.id, Some(&original_fingerprint))
            .unwrap();
        co_store
            .configure(
                &profile.id,
                Some("http://127.0.0.1:8787"),
                Some("host-palworld-secret"),
                true,
                Some(&original_fingerprint),
            )
            .unwrap();
        co_store
            .upsert_pending(
                &profile.id,
                "participant-palworld-secret",
                "Synthetic tester",
                "editor",
                "397218",
                "2999-01-01T00:00:00Z",
            )
            .unwrap();
        co_store
            .set_participant_state(&profile.id, "participant-palworld-secret", "approved")
            .unwrap();
        crate::credentials::store_palworld_admin_password(&profile.id, admin_secret).unwrap();

        let processes = crate::process::ProcessMap::default();
        let stopping = crate::process::StoppingMap::default();
        let input = CoManagementApplyInput {
            server_id: profile.id.clone(),
            participant_id: "participant-palworld-secret".into(),
            role: "editor".into(),
            request_id: "request-palworld-secret".into(),
            expected_revision: 1,
            changes: serde_json::json!({ "maxPlayers": 24 }),
        };
        super::set_test_interrupt_stage(Some("file-written"));
        let interrupted =
            super::apply_settings(&co_store, &store, &backups, &processes, &stopping, &input);
        super::set_test_interrupt_stage(None);
        assert!(interrupted.is_err());
        let config_backup_dir = std::path::Path::new(&profile.root_path)
            .join(".server-hub")
            .join("config-backups");
        let config_backup = std::fs::read_dir(&config_backup_dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| path.extension().and_then(|value| value.to_str()) == Some("ini"))
            .expect("Palworldの設定バックアップが作成されていません");
        let stored_config_backup = std::fs::read(config_backup).unwrap();
        assert!(crate::protected_data::is_protected_blob(
            &stored_config_backup
        ));
        for secret in [admin_secret, server_secret] {
            assert!(
                !stored_config_backup
                    .windows(secret.len())
                    .any(|window| window == secret.as_bytes())
            );
        }
        drop(co_store);
        drop(store);

        let connection = rusqlite::Connection::open(&database).unwrap();
        let stored_bytes: Vec<u8> = connection
            .query_row(
                "SELECT original_bytes FROM co_management_operation_journal",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let stored_profile: String = connection
            .query_row(
                "SELECT original_profile_json FROM co_management_operation_journal",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(stored_bytes, original.as_bytes());
        assert!(stored_profile.starts_with("dpapi-v1:"));
        assert!(!stored_profile.contains(admin_secret));
        assert!(!stored_profile.contains(server_secret));
        let raw_database = std::fs::read(&database).unwrap();
        for secret in [admin_secret, server_secret] {
            assert!(
                !raw_database
                    .windows(secret.len())
                    .any(|window| window == secret.as_bytes())
            );
        }
        for suffix in ["-wal", "-journal", "-shm"] {
            let sidecar = std::path::PathBuf::from(format!("{}{}", database.display(), suffix));
            if sidecar.is_file() {
                let raw_sidecar = std::fs::read(sidecar).unwrap();
                for secret in [admin_secret, server_secret] {
                    assert!(
                        !raw_sidecar
                            .windows(secret.len())
                            .any(|window| window == secret.as_bytes())
                    );
                }
            }
        }
        drop(connection);

        let recovered_store = crate::store::Store::open(&database).unwrap();
        let recovered_co_store = CoManagementStore::open(&database).unwrap();
        let recovered = recovered_co_store
            .recover_incomplete_operations(&recovered_store)
            .unwrap();
        assert_eq!(recovered, vec![profile.id.clone()]);
        assert_eq!(std::fs::read(&settings_path).unwrap(), original.as_bytes());
        assert_eq!(
            recovered_co_store
                .operation_result(
                    &profile.id,
                    "participant-palworld-secret",
                    "request-palworld-secret",
                )
                .unwrap()
                .state,
            "failed"
        );
        assert!(
            !recovered_co_store
                .config(&profile.id)
                .unwrap()
                .unwrap()
                .recovery_required
        );
        drop(recovered_co_store);
        drop(recovered_store);
        let _ = crate::credentials::delete_palworld_admin_password(&profile.id);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(backups);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn legacy_plaintext_journal_is_quarantined_without_overwriting_or_deleting_it() {
        let database = std::env::temp_dir().join(format!(
            "msh-co-legacy-journal-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        let settings_path = std::path::Path::new(&profile.root_path).join("server.properties");
        let original_bytes = std::fs::read(&settings_path).unwrap();
        let original_fingerprint = super::config_fingerprint(&profile).unwrap();
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store.ensure_config(&profile.id, None).unwrap();
        co_store
            .begin_operation(
                "request-legacy-journal",
                &profile.id,
                "participant-test",
                "hash",
            )
            .unwrap();
        drop(co_store);
        let operation_key = format!(
            "{}\u{1f}{}\u{1f}{}",
            profile.id, "participant-test", "request-legacy-journal"
        );
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection
            .execute(
                "INSERT INTO co_management_operation_journal (
                   operation_key, server_id, participant_id, request_id, backup_path,
                   target_path, original_exists, original_bytes, original_profile_json,
                   original_fingerprint, new_fingerprint, stage, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, NULL, 'file-written', ?10, ?10)",
                rusqlite::params![
                    operation_key,
                    profile.id,
                    "participant-test",
                    "request-legacy-journal",
                    "C:/backups/legacy-journal.zip",
                    settings_path.display().to_string(),
                    &original_bytes,
                    serde_json::to_string(&profile).unwrap(),
                    original_fingerprint,
                    "2026-09-07T00:00:00Z",
                ],
            )
            .unwrap();
        drop(connection);
        std::fs::write(&settings_path, b"difficulty=external-legacy-change\n").unwrap();
        drop(store);

        let recovered_store = crate::store::Store::open(&database).unwrap();
        let recovered_co_store = CoManagementStore::open(&database).unwrap();
        assert!(
            recovered_co_store
                .recover_incomplete_operations(&recovered_store)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            std::fs::read(&settings_path).unwrap(),
            b"difficulty=external-legacy-change\n"
        );
        let operation = recovered_co_store
            .operation_result(&profile.id, "participant-test", "request-legacy-journal")
            .unwrap();
        assert_eq!(operation.error_code.as_deref(), Some("needs-recovery"));
        assert!(
            recovered_co_store
                .config(&profile.id)
                .unwrap()
                .unwrap()
                .recovery_required
        );
        let journal_count: i64 = rusqlite::Connection::open(&database)
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM co_management_operation_journal",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(journal_count, 1);
        drop(recovered_co_store);
        drop(recovered_store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn explicit_legacy_journal_migration_encrypts_and_keeps_exact_recovery_data() {
        let database = std::env::temp_dir().join(format!(
            "msh-co-legacy-migration-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let profile = profile("paper");
        let settings_path = std::path::Path::new(&profile.root_path).join("server.properties");
        let synthetic_secret = "U01_LEGACY_SYNTHETIC_SECRET_5c8e";
        let original_bytes = format!("motd=synthetic\nsecret={synthetic_secret}\n").into_bytes();
        std::fs::write(&settings_path, &original_bytes).unwrap();

        let store = crate::store::Store::open(&database).unwrap();
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store.ensure_config(&profile.id, None).unwrap();
        co_store
            .begin_operation(
                "request-legacy-migration",
                &profile.id,
                "participant-test",
                "hash",
            )
            .unwrap();
        let operation_key = format!(
            "{}\u{1f}{}\u{1f}{}",
            profile.id, "participant-test", "request-legacy-migration"
        );
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection
            .execute(
                "INSERT INTO co_management_operation_journal (
                   operation_key, server_id, participant_id, request_id, backup_path,
                   target_path, original_exists, original_bytes, original_profile_json,
                   original_fingerprint, new_fingerprint, stage, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, NULL, 'file-written', ?10, ?10)",
                rusqlite::params![
                    operation_key,
                    profile.id,
                    "participant-test",
                    "request-legacy-migration",
                    "C:/backups/legacy-migration.zip",
                    settings_path.display().to_string(),
                    &original_bytes,
                    serde_json::to_string(&profile).unwrap(),
                    super::file_fingerprint_from_bytes(&original_bytes),
                    "2026-09-07T00:00:00Z",
                ],
            )
            .unwrap();
        drop(connection);

        assert_eq!(co_store.legacy_journal_count(&profile.id).unwrap(), 1);
        let migrated = co_store.migrate_legacy_journals(&profile.id).unwrap();
        assert_eq!(migrated.migrated, 1);
        assert_eq!(migrated.remaining_legacy, 0);
        assert!(migrated.database_compacted);
        assert_eq!(co_store.legacy_journal_count(&profile.id).unwrap(), 0);
        drop(co_store);
        drop(store);

        let raw_database = std::fs::read(&database).unwrap();
        assert!(
            !raw_database
                .windows(synthetic_secret.len())
                .any(|window| window == synthetic_secret.as_bytes())
        );
        for suffix in ["-wal", "-journal", "-shm"] {
            let sidecar = std::path::PathBuf::from(format!("{}{}", database.display(), suffix));
            if sidecar.is_file() {
                let raw_sidecar = std::fs::read(sidecar).unwrap();
                assert!(
                    !raw_sidecar
                        .windows(synthetic_secret.len())
                        .any(|window| window == synthetic_secret.as_bytes())
                );
            }
        }

        let recovered_store = crate::store::Store::open(&database).unwrap();
        let recovered_co_store = CoManagementStore::open(&database).unwrap();
        assert_eq!(
            recovered_co_store
                .recover_incomplete_operations(&recovered_store)
                .unwrap(),
            vec![profile.id.clone()]
        );
        assert_eq!(std::fs::read(&settings_path).unwrap(), original_bytes);
        drop(recovered_co_store);
        drop(recovered_store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn operation_idempotency_and_revision_are_persisted_together() {
        let database =
            std::env::temp_dir().join(format!("msh-co-operation-{}.sqlite3", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store
            .ensure_config(&profile.id, Some("fingerprint-1"))
            .unwrap();
        co_store
            .configure(
                &profile.id,
                Some("http://127.0.0.1:8787"),
                Some("host-test"),
                true,
                Some("fingerprint-1"),
            )
            .unwrap();
        co_store
            .upsert_pending(
                &profile.id,
                "participant-test",
                "Takeru",
                "editor",
                "397218",
                "2999-01-01T00:00:00Z",
            )
            .unwrap();
        let participant = co_store
            .set_participant_state(&profile.id, "participant-test", "approved")
            .unwrap();
        let content_hash = hash_secret("request-body");
        assert!(
            co_store
                .begin_operation("request-test", &profile.id, &participant.id, &content_hash)
                .unwrap()
                .is_none()
        );
        co_store
            .commit_settings_change(
                &profile.id,
                &participant.id,
                "request-test",
                2,
                "fingerprint-2",
                &participant.id,
                &participant.display_name,
                &serde_json::json!({ "difficulty": "easy" }),
                &serde_json::json!({ "difficulty": "hard" }),
                &["difficulty".into()],
                &serde_json::json!({ "requestId": "request-test", "serverId": profile.id, "revision": 2, "changedFields": ["difficulty"] }),
                "success",
            )
            .unwrap();
        let config = co_store.config(&profile.id).unwrap().unwrap();
        assert_eq!(config.revision, 2);
        assert_eq!(config.fingerprint.as_deref(), Some("fingerprint-2"));
        assert_eq!(
            co_store
                .operation_result(&profile.id, &participant.id, "request-test")
                .unwrap()
                .state,
            "completed"
        );
        assert_eq!(
            co_store
                .begin_operation("request-test", &profile.id, &participant.id, &content_hash)
                .unwrap()
                .unwrap()
                .state,
            "completed"
        );
        assert!(
            co_store
                .begin_operation(
                    "request-test",
                    &profile.id,
                    &participant.id,
                    &hash_secret("different-body")
                )
                .is_err()
        );
        assert!(
            co_store
                .begin_operation(
                    "request-test",
                    &profile.id,
                    "participant-other",
                    &content_hash,
                )
                .unwrap()
                .is_none()
        );
        assert!(
            co_store
                .operation_result(&profile.id, "participant-other", "request-test")
                .is_ok()
        );
        assert!(
            co_store
                .operation_result(&profile.id, "participant-unrelated", "request-test")
                .is_err()
        );
        assert!(!co_store.audit(&profile.id).unwrap().is_empty());
        drop(co_store);
        drop(store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn reconnect_rotates_permission_generation_and_requires_reapproval() {
        let database = std::env::temp_dir().join(format!(
            "msh-co-generation-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store
            .configure(
                &profile.id,
                Some("http://127.0.0.1:8787"),
                Some("host-test"),
                true,
                Some("fingerprint"),
            )
            .unwrap();
        co_store
            .upsert_pending(
                &profile.id,
                "participant-test",
                "Takeru",
                "editor",
                "397218",
                "2999-01-01T00:00:00Z",
            )
            .unwrap();
        let approved = co_store
            .set_participant_state(&profile.id, "participant-test", "approved")
            .unwrap();
        assert!(!approved.expires_at.starts_with("2999-"));
        assert!(
            chrono::DateTime::parse_from_rfc3339(&approved.expires_at)
                .unwrap()
                .timestamp()
                > chrono::Utc::now().timestamp() + 11 * 60 * 60
        );
        assert!(
            authorize_participant(&co_store, &profile.id, "participant-test", "editor").is_ok()
        );

        let revoked = co_store.rotate_permission_generation(&profile.id).unwrap();
        assert_eq!(revoked, vec!["participant-test"]);
        assert!(
            authorize_participant(&co_store, &profile.id, "participant-test", "editor").is_err()
        );
        let participant = co_store
            .participant(&profile.id, "participant-test")
            .unwrap()
            .unwrap();
        assert_eq!(participant.state, "revoked");

        co_store
            .upsert_pending(
                &profile.id,
                "participant-test",
                "Takeru",
                "editor",
                "397219",
                "2999-01-01T00:00:00Z",
            )
            .unwrap();
        assert_eq!(
            co_store
                .participant(&profile.id, "participant-test")
                .unwrap()
                .unwrap()
                .state,
            "pending"
        );
        co_store
            .set_participant_state(&profile.id, "participant-test", "approved")
            .unwrap();
        assert!(
            authorize_participant(&co_store, &profile.id, "participant-test", "editor").is_ok()
        );

        drop(co_store);
        drop(store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn incomplete_operation_is_recovered_from_the_persistent_journal() {
        let database =
            std::env::temp_dir().join(format!("msh-co-recovery-{}.sqlite3", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        let original_bytes =
            std::fs::read(std::path::Path::new(&profile.root_path).join("server.properties"))
                .unwrap();
        let original_fingerprint = super::config_fingerprint(&profile).unwrap();
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store
            .ensure_config(&profile.id, Some(&original_fingerprint))
            .unwrap();
        co_store
            .begin_operation("request-recovery", &profile.id, "participant-test", "hash")
            .unwrap();
        let changed_bytes = b"difficulty=hard\n";
        let changed_fingerprint = super::file_fingerprint_from_bytes(changed_bytes);
        co_store
            .record_operation_journal_with_candidate(
                &profile.id,
                "participant-test",
                "request-recovery",
                std::path::Path::new("C:/backups/recovery.zip"),
                &std::path::Path::new(&profile.root_path).join("server.properties"),
                true,
                &original_bytes,
                &profile,
                &original_fingerprint,
                Some(&changed_fingerprint),
                "file-write-started",
            )
            .unwrap();
        std::fs::write(
            std::path::Path::new(&profile.root_path).join("server.properties"),
            changed_bytes,
        )
        .unwrap();
        drop(co_store);
        drop(store);

        let recovered_store = crate::store::Store::open(&database).unwrap();
        let recovered_co_store = CoManagementStore::open(&database).unwrap();
        let recovered = recovered_co_store
            .recover_incomplete_operations(&recovered_store)
            .unwrap();
        assert_eq!(recovered, vec![profile.id.clone()]);
        assert_eq!(
            std::fs::read(std::path::Path::new(&profile.root_path).join("server.properties"))
                .unwrap(),
            original_bytes
        );
        assert_eq!(
            recovered_co_store
                .operation_result(&profile.id, "participant-test", "request-recovery")
                .unwrap()
                .state,
            "failed"
        );
        assert!(
            !recovered_co_store
                .config(&profile.id)
                .unwrap()
                .unwrap()
                .recovery_required
        );
        drop(recovered_co_store);
        drop(recovered_store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn missing_candidate_fingerprint_preserves_external_file_and_requires_recovery() {
        let database = std::env::temp_dir().join(format!(
            "msh-co-unknown-file-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        let settings_path = std::path::Path::new(&profile.root_path).join("server.properties");
        let original_bytes = std::fs::read(&settings_path).unwrap();
        let original_fingerprint = super::config_fingerprint(&profile).unwrap();
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store
            .ensure_config(&profile.id, Some(&original_fingerprint))
            .unwrap();
        co_store
            .begin_operation(
                "request-unknown-file",
                &profile.id,
                "participant-test",
                "hash",
            )
            .unwrap();
        co_store
            .record_operation_journal(
                &profile.id,
                "participant-test",
                "request-unknown-file",
                std::path::Path::new("C:/backups/unknown-file.zip"),
                &settings_path,
                true,
                &original_bytes,
                &profile,
                &original_fingerprint,
                "file-written",
            )
            .unwrap();
        let external_bytes = b"difficulty=external-tool-change\n";
        std::fs::write(&settings_path, external_bytes).unwrap();
        drop(co_store);
        drop(store);

        let recovered_store = crate::store::Store::open(&database).unwrap();
        let recovered_co_store = CoManagementStore::open(&database).unwrap();
        let recovered = recovered_co_store
            .recover_incomplete_operations(&recovered_store)
            .unwrap();
        assert!(recovered.is_empty());
        assert_eq!(std::fs::read(&settings_path).unwrap(), external_bytes);
        let operation = recovered_co_store
            .operation_result(&profile.id, "participant-test", "request-unknown-file")
            .unwrap();
        assert_eq!(operation.state, "failed");
        assert_eq!(operation.error_code.as_deref(), Some("needs-recovery"));
        assert!(
            recovered_co_store
                .config(&profile.id)
                .unwrap()
                .unwrap()
                .recovery_required
        );
        drop(recovered_co_store);
        drop(recovered_store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn missing_candidate_fingerprint_recovers_when_original_file_is_unchanged() {
        let database = std::env::temp_dir().join(format!(
            "msh-co-unchanged-file-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        let settings_path = std::path::Path::new(&profile.root_path).join("server.properties");
        let original_bytes = std::fs::read(&settings_path).unwrap();
        let original_fingerprint = super::config_fingerprint(&profile).unwrap();
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store
            .ensure_config(&profile.id, Some(&original_fingerprint))
            .unwrap();
        co_store
            .begin_operation(
                "request-unchanged-file",
                &profile.id,
                "participant-test",
                "hash",
            )
            .unwrap();
        co_store
            .record_operation_journal(
                &profile.id,
                "participant-test",
                "request-unchanged-file",
                std::path::Path::new("C:/backups/unchanged-file.zip"),
                &settings_path,
                true,
                &original_bytes,
                &profile,
                &original_fingerprint,
                "backup-created",
            )
            .unwrap();
        drop(co_store);
        drop(store);

        let recovered_store = crate::store::Store::open(&database).unwrap();
        let recovered_co_store = CoManagementStore::open(&database).unwrap();
        let recovered = recovered_co_store
            .recover_incomplete_operations(&recovered_store)
            .unwrap();
        assert_eq!(recovered, vec![profile.id.clone()]);
        assert_eq!(std::fs::read(&settings_path).unwrap(), original_bytes);
        assert!(
            !recovered_co_store
                .config(&profile.id)
                .unwrap()
                .unwrap()
                .recovery_required
        );
        drop(recovered_co_store);
        drop(recovered_store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn orphaned_running_operation_is_classified_after_reopen() {
        let database = std::env::temp_dir().join(format!(
            "msh-co-orphaned-operation-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store.ensure_config(&profile.id, None).unwrap();
        co_store
            .begin_operation(
                "request-orphaned-operation",
                &profile.id,
                "participant-test",
                "hash",
            )
            .unwrap();
        drop(co_store);
        drop(store);

        let recovered_store = crate::store::Store::open(&database).unwrap();
        let recovered_co_store = CoManagementStore::open(&database).unwrap();
        assert!(
            recovered_co_store
                .recover_incomplete_operations(&recovered_store)
                .unwrap()
                .is_empty()
        );
        let operation = recovered_co_store
            .operation_result(
                &profile.id,
                "participant-test",
                "request-orphaned-operation",
            )
            .unwrap();
        assert_eq!(operation.state, "failed");
        assert_eq!(
            operation.error_code.as_deref(),
            Some("interrupted-before-journal")
        );
        assert!(
            !recovered_co_store
                .config(&profile.id)
                .unwrap()
                .unwrap()
                .recovery_required
        );
        drop(recovered_co_store);
        drop(recovered_store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn rollback_failure_marks_the_server_as_needing_recovery() {
        let database = std::env::temp_dir().join(format!(
            "msh-co-recovery-failure-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store
            .ensure_config(&profile.id, Some("fingerprint"))
            .unwrap();
        co_store
            .begin_operation(
                "request-recovery-failure",
                &profile.id,
                "participant-test",
                "hash",
            )
            .unwrap();
        let input = CoManagementApplyInput {
            server_id: profile.id.clone(),
            participant_id: "participant-test".into(),
            role: "editor".into(),
            request_id: "request-recovery-failure".into(),
            expected_revision: 1,
            changes: serde_json::json!({ "difficulty": "hard" }),
        };
        let missing_path = std::env::temp_dir()
            .join(format!("msh-co-missing-parent-{}", uuid::Uuid::new_v4()))
            .join("settings.properties");
        let result = abort_journaled_change(
            &co_store,
            &store,
            &input,
            &profile,
            &missing_path,
            true,
            b"original",
            "original-fingerprint",
            "new-fingerprint",
            false,
            "test-failure",
            AppError::Other("injected failure".into()),
        );
        assert!(result.is_err());
        assert!(
            co_store
                .config(&profile.id)
                .unwrap()
                .unwrap()
                .recovery_required
        );
        assert_eq!(
            co_store
                .operation_result(&profile.id, "participant-test", "request-recovery-failure")
                .unwrap()
                .error_code
                .as_deref(),
            Some("needs-recovery")
        );
        drop(co_store);
        drop(store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
    }

    #[test]
    fn apply_interruption_stages_are_recovered_after_reopen() {
        let stages = [
            "operation-started",
            "backup-started",
            "backup-completed-before-stage",
            "backup-created",
            "file-write-started",
            "file-written-before-stage",
            "file-written",
            "database-written-before-stage",
            "database-written",
        ];
        for stage in stages {
            let database = std::env::temp_dir().join(format!(
                "msh-co-interrupt-{}-{}.sqlite3",
                stage,
                uuid::Uuid::new_v4()
            ));
            let backups = std::env::temp_dir()
                .join(format!("msh-co-interrupt-backups-{}", uuid::Uuid::new_v4()));
            let store = crate::store::Store::open(&database).unwrap();
            let profile = profile("paper");
            let settings_path = std::path::Path::new(&profile.root_path).join("server.properties");
            let original_bytes = std::fs::read(&settings_path).unwrap();
            let original_fingerprint = super::config_fingerprint(&profile).unwrap();
            store.insert_server(&profile).unwrap();
            let co_store = CoManagementStore::open(&database).unwrap();
            co_store
                .ensure_config(&profile.id, Some(&original_fingerprint))
                .unwrap();
            co_store
                .configure(
                    &profile.id,
                    Some("http://127.0.0.1:8787"),
                    Some("host-test"),
                    true,
                    Some(&original_fingerprint),
                )
                .unwrap();
            co_store
                .upsert_pending(
                    &profile.id,
                    "participant-test",
                    "Takeru",
                    "editor",
                    "397218",
                    "2999-01-01T00:00:00Z",
                )
                .unwrap();
            co_store
                .set_participant_state(&profile.id, "participant-test", "approved")
                .unwrap();
            let processes = std::sync::Mutex::new(HashMap::new());
            let stopping = std::sync::Mutex::new(HashMap::new());
            let input = CoManagementApplyInput {
                server_id: profile.id.clone(),
                participant_id: "participant-test".into(),
                role: "editor".into(),
                request_id: format!("request-interrupt-{stage}"),
                expected_revision: 1,
                changes: serde_json::json!({ "difficulty": "hard" }),
            };
            super::set_test_interrupt_stage(Some(stage));
            let result =
                super::apply_settings(&co_store, &store, &backups, &processes, &stopping, &input);
            super::set_test_interrupt_stage(None);
            assert!(result.is_err(), "stage {stage} was not interrupted");
            let journal_connection = rusqlite::Connection::open(&database).unwrap();
            let persisted_candidate: Option<String> = journal_connection
                .query_row(
                    "SELECT new_fingerprint FROM co_management_operation_journal",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(persisted_candidate.is_some(), "stage {stage}");
            drop(journal_connection);

            let backup_operation_id = format!(
                "{}\u{1f}{}\u{1f}{}",
                input.server_id, input.participant_id, input.request_id
            );
            let planned_backup =
                backup::planned_co_management_backup_path(&backups, &profile, &backup_operation_id);
            if stage == "backup-started" {
                std::fs::create_dir_all(planned_backup.parent().unwrap()).unwrap();
                std::fs::write(planned_backup.with_extension("zip.part"), b"partial").unwrap();
            }
            drop(co_store);
            drop(store);

            let recovered_store = crate::store::Store::open(&database).unwrap();
            let recovered_co_store = CoManagementStore::open(&database).unwrap();
            let recovered = recovered_co_store
                .recover_incomplete_operations(&recovered_store)
                .unwrap();
            assert_eq!(recovered, vec![profile.id.clone()], "stage {stage}");
            let operation = recovered_co_store
                .operation_result(&profile.id, "participant-test", &input.request_id)
                .unwrap();
            assert_ne!(operation.state, "running", "stage {stage}");
            assert_eq!(
                operation.error_code.as_deref(),
                Some("recovered-after-restart")
            );
            assert_eq!(std::fs::read(&settings_path).unwrap(), original_bytes);
            assert!(!planned_backup.with_extension("zip.part").exists());
            assert!(
                !recovered_co_store
                    .config(&profile.id)
                    .unwrap()
                    .unwrap()
                    .recovery_required
            );
            drop(recovered_co_store);
            drop(recovered_store);
            let _ = std::fs::remove_file(database);
            let _ = std::fs::remove_dir_all(profile.root_path);
            let _ = std::fs::remove_dir_all(backups);
        }
    }

    #[test]
    fn apply_settings_writes_only_allowlisted_fields_and_creates_backup() {
        let database =
            std::env::temp_dir().join(format!("msh-co-apply-{}.sqlite3", uuid::Uuid::new_v4()));
        let backups = std::env::temp_dir().join(format!("msh-co-backups-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&backups).unwrap();
        let store = crate::store::Store::open(&database).unwrap();
        let profile = profile("paper");
        store.insert_server(&profile).unwrap();
        let co_store = CoManagementStore::open(&database).unwrap();
        co_store
            .ensure_config(
                &profile.id,
                Some(&super::config_fingerprint(&profile).unwrap()),
            )
            .unwrap();
        co_store
            .configure(
                &profile.id,
                Some("http://127.0.0.1:8787"),
                Some("host-test"),
                true,
                Some(&super::config_fingerprint(&profile).unwrap()),
            )
            .unwrap();
        co_store
            .upsert_pending(
                &profile.id,
                "participant-test",
                "Takeru",
                "editor",
                "397218",
                "2999-01-01T00:00:00Z",
            )
            .unwrap();
        co_store
            .set_participant_state(&profile.id, "participant-test", "approved")
            .unwrap();
        let processes = std::sync::Mutex::new(HashMap::new());
        let stopping = std::sync::Mutex::new(HashMap::new());
        let result = super::apply_settings(
            &co_store,
            &store,
            &backups,
            &processes,
            &stopping,
            &CoManagementApplyInput {
                server_id: profile.id.clone(),
                participant_id: "participant-test".into(),
                role: "editor".into(),
                request_id: "request-apply".into(),
                expected_revision: 1,
                changes: serde_json::json!({ "difficulty": "hard", "maxPlayers": 24 }),
            },
        )
        .unwrap();
        assert_eq!(result.revision, 2);
        assert_eq!(
            std::fs::read_to_string(
                std::path::Path::new(&profile.root_path).join("server.properties")
            )
            .unwrap()
            .contains("difficulty=hard"),
            true
        );
        assert_eq!(
            co_store
                .operation_result(&profile.id, "participant-test", "request-apply")
                .unwrap()
                .state,
            "completed"
        );
        let replay: CoManagementApplyResult = serde_json::from_value(
            co_store
                .operation_result(&profile.id, "participant-test", "request-apply")
                .unwrap()
                .result
                .unwrap(),
        )
        .unwrap();
        assert_eq!(replay.request_id, "request-apply");
        assert_eq!(replay.settings.revision, result.revision);
        assert_eq!(
            co_store
                .audit(&profile.id)
                .unwrap()
                .iter()
                .any(|entry| entry.action == "settings.update"),
            true
        );
        drop(co_store);
        drop(store);
        let _ = std::fs::remove_file(database);
        let _ = std::fs::remove_dir_all(profile.root_path);
        let _ = std::fs::remove_dir_all(backups);
    }
}
