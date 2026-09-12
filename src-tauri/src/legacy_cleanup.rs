use std::path::Path;

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;

const LEGACY_HOST_CREDENTIAL_SERVICE: &str = "Minecraft Server Hub - Co-management host";
const LEGACY_PENDING_CREDENTIAL_SERVICE: &str = "Minecraft Server Hub - Co-management pending code";

pub fn purge_removed_remote_management(database_path: &Path) -> AppResult<()> {
    if !database_path.is_file() {
        return Ok(());
    }

    let mut connection = Connection::open(database_path)?;
    let has_legacy_tables = connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='co_management_config'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !has_legacy_tables {
        return Ok(());
    }

    let host_ids = read_first_column(
        &connection,
        "SELECT host_id FROM co_management_config WHERE host_id IS NOT NULL",
    )?;
    let pending_accounts = {
        let mut statement = connection.prepare(
            "SELECT server_id || ':' || id FROM co_management_participants WHERE state='pending'",
        )?;
        let values = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        values
    };

    for host_id in host_ids {
        delete_legacy_credential(LEGACY_HOST_CREDENTIAL_SERVICE, &host_id);
    }
    for account in pending_accounts {
        delete_legacy_credential(LEGACY_PENDING_CREDENTIAL_SERVICE, &account);
    }

    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "DROP TABLE IF EXISTS co_management_operation_journal;
         DROP TABLE IF EXISTS co_management_operations;
         DROP TABLE IF EXISTS co_management_invites;
         DROP TABLE IF EXISTS co_management_participants;
         DROP TABLE IF EXISTS co_management_audit;
         DROP TABLE IF EXISTS co_management_config;",
    )?;
    transaction.commit()?;
    Ok(())
}

fn read_first_column(connection: &Connection, sql: &str) -> AppResult<Vec<String>> {
    let mut statement = connection.prepare(sql)?;
    Ok(statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

#[cfg(windows)]
fn delete_legacy_credential(service: &str, account: &str) {
    if let Ok(entry) = keyring::Entry::new(service, account) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => {}
        }
    }
}

#[cfg(not(windows))]
fn delete_legacy_credential(_service: &str, _account: &str) {}

#[cfg(test)]
mod tests {
    use super::purge_removed_remote_management;

    #[test]
    fn removes_only_the_retired_remote_management_tables() {
        let path = std::env::temp_dir().join(format!(
            "msh-legacy-cleanup-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.execute_batch(
            "CREATE TABLE servers (id TEXT PRIMARY KEY);
             INSERT INTO servers (id) VALUES ('server-1');
             CREATE TABLE co_management_config (server_id TEXT PRIMARY KEY, host_id TEXT);
             CREATE TABLE co_management_participants (id TEXT PRIMARY KEY, server_id TEXT, state TEXT);
             INSERT INTO co_management_config VALUES ('server-1', NULL);
             INSERT INTO co_management_participants VALUES ('participant-1', 'server-1', 'approved');",
        ).unwrap();
        drop(connection);

        purge_removed_remote_management(&path).unwrap();

        let connection = rusqlite::Connection::open(&path).unwrap();
        let server_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM servers", [], |row| row.get(0))
            .unwrap();
        let retired_table_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'co_management_%'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(server_count, 1);
        assert_eq!(retired_table_count, 0);
        drop(connection);
        let _ = std::fs::remove_file(path);
    }
}
