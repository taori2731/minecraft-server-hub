use std::path::Path;

use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    error::{AppError, AppResult},
    models::{BasicSettings, FixedPlayerPreset, InviteSettings, ServerProfile, TunnelSettings},
};

pub struct Store {
    connection: Connection,
}

#[cfg(test)]
mod tests {
    use super::Store;
    use crate::models::{
        BasicSettings, FixedPlayerPreset, InviteSettings, PalworldSettings, ServerProfile,
        TunnelSettings,
    };

    #[test]
    fn deletes_only_the_requested_registration() {
        let database =
            std::env::temp_dir().join(format!("msh-store-delete-{}.sqlite3", uuid::Uuid::new_v4()));
        let store = Store::open(&database).unwrap();
        let now = "2026-08-25T00:00:00Z".to_string();
        let profile = ServerProfile {
            id: "delete-me".into(),
            name: "Delete Me".into(),
            root_path: "C:\\Servers\\Delete-Me".into(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "C:\\Java\\java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: now.clone(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: now.clone(),
            updated_at: now,
        };
        store.insert_server(&profile).unwrap();
        store.delete_server(&profile.id).unwrap();
        assert!(store.list_servers().unwrap().is_empty());
        drop(store);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn persists_invite_settings_and_cascades_them_on_delete() {
        let database =
            std::env::temp_dir().join(format!("msh-store-invite-{}.sqlite3", uuid::Uuid::new_v4()));
        let store = Store::open(&database).unwrap();
        let now = "2026-08-25T00:00:00Z".to_string();
        let profile = ServerProfile {
            id: "invite-server".into(),
            name: "Survival".into(),
            root_path: "C:\\Servers\\Invite".into(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "C:\\Java\\java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: now.clone(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        store.insert_server(&profile).unwrap();
        let settings = InviteSettings {
            invite_name: "夜ふかし部屋".into(),
            custom_hostname: Some("play.example.com".into()),
            updated_at: now,
        };
        store.save_invite_settings(&profile.id, &settings).unwrap();
        let loaded = store
            .get_invite_settings(&profile.id, &profile.name)
            .unwrap();
        assert_eq!(loaded.invite_name, "夜ふかし部屋");
        assert_eq!(loaded.custom_hostname.as_deref(), Some("play.example.com"));
        store.delete_server(&profile.id).unwrap();
        let remaining: i64 = store
            .connection
            .query_row("SELECT COUNT(*) FROM invite_settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
        drop(store);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn persists_updates_and_deletes_fixed_players_case_insensitively() {
        let database = std::env::temp_dir().join(format!(
            "msh-store-fixed-players-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let store = Store::open(&database).unwrap();
        let first = FixedPlayerPreset {
            id: "first-id".into(),
            edition: "java".into(),
            player_name: "PlayerOne".into(),
            whitelist: true,
            operator: false,
            created_at: "2026-08-25T00:00:00Z".into(),
            updated_at: "2026-08-25T00:00:00Z".into(),
        };
        store.save_fixed_player(&first).unwrap();
        let update = FixedPlayerPreset {
            id: "second-id".into(),
            edition: "java".into(),
            player_name: "playerone".into(),
            whitelist: true,
            operator: true,
            created_at: "2026-08-25T01:00:00Z".into(),
            updated_at: "2026-08-25T01:00:00Z".into(),
        };
        let saved = store.save_fixed_player(&update).unwrap();
        assert_eq!(saved.id, "first-id");
        assert!(saved.operator);
        let bedrock = FixedPlayerPreset {
            id: "bedrock-id".into(),
            edition: "bedrock".into(),
            player_name: "PlayerOne".into(),
            whitelist: true,
            operator: false,
            created_at: "2026-08-25T02:00:00Z".into(),
            updated_at: "2026-08-25T02:00:00Z".into(),
        };
        store.save_fixed_player(&bedrock).unwrap();
        let all = store.list_fixed_players().unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|player| player.edition == "java"));
        assert!(all.iter().any(|player| player.edition == "bedrock"));
        store.delete_fixed_player(&saved.id).unwrap();
        assert_eq!(store.list_fixed_players().unwrap().len(), 1);
        drop(store);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn migrates_existing_fixed_players_to_java_edition() {
        let database = std::env::temp_dir().join(format!(
            "msh-store-fixed-player-migration-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        {
            let connection = rusqlite::Connection::open(&database).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE fixed_players (
                   id TEXT PRIMARY KEY,
                   player_name TEXT NOT NULL,
                   whitelist INTEGER NOT NULL DEFAULT 1,
                   is_operator INTEGER NOT NULL DEFAULT 0,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE UNIQUE INDEX fixed_players_name_ci ON fixed_players(lower(player_name));
                 INSERT INTO fixed_players VALUES ('old', 'OldFriend', 1, 0, 'before', 'before');",
                )
                .unwrap();
        }
        let store = Store::open(&database).unwrap();
        let players = store.list_fixed_players().unwrap();
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].edition, "java");
        assert_eq!(players[0].player_name, "OldFriend");
        drop(store);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn persists_only_non_secret_tunnel_settings_and_cascades_on_delete() {
        let database =
            std::env::temp_dir().join(format!("msh-store-tunnel-{}.sqlite3", uuid::Uuid::new_v4()));
        let store = Store::open(&database).unwrap();
        let now = "2026-08-26T00:00:00Z".to_string();
        let profile = ServerProfile {
            id: "tunnel-server".into(),
            name: "Tunnel".into(),
            root_path: "C:\\Servers\\Tunnel".into(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "C:\\Java\\java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: now.clone(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        store.insert_server(&profile).unwrap();
        let settings = TunnelSettings {
            server_id: profile.id.clone(),
            provider_id: "playit".into(),
            agent_path: Some("C:\\Program Files\\playit\\playit.exe".into()),
            local_port: 25565,
            transport: "tcp".into(),
            last_state: "disconnected".into(),
            last_checked_at: Some(now.clone()),
            terms_acknowledged_at: Some(now.clone()),
            updated_at: now,
        };
        store.save_tunnel_settings(&settings).unwrap();
        let loaded = store
            .get_tunnel_settings(&profile.id, profile.port, profile.network_transport())
            .unwrap();
        assert_eq!(loaded.provider_id, "playit");
        assert_eq!(loaded.local_port, 25565);
        assert_eq!(loaded.transport, "tcp");
        let mut crossplay_settings = settings.clone();
        crossplay_settings.local_port = 19132;
        crossplay_settings.transport = "udp".into();
        store
            .save_crossplay_tunnel_settings(&crossplay_settings)
            .unwrap();
        let loaded_crossplay = store
            .get_crossplay_tunnel_settings(&profile.id, 19132)
            .unwrap();
        assert_eq!(loaded_crossplay.local_port, 19132);
        assert_eq!(loaded_crossplay.transport, "udp");
        assert_eq!(
            store
                .get_tunnel_settings(&profile.id, profile.port, profile.network_transport())
                .unwrap()
                .local_port,
            25565
        );
        let columns = store
            .connection
            .prepare("PRAGMA table_info(tunnel_settings)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(
            !columns
                .iter()
                .any(|name| matches!(name.as_str(), "token" | "password" | "endpoint" | "logs"))
        );
        store.delete_server(&profile.id).unwrap();
        let remaining: i64 = store
            .connection
            .query_row("SELECT COUNT(*) FROM tunnel_settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
        let crossplay_remaining: i64 = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM crossplay_tunnel_settings",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(crossplay_remaining, 0);
        drop(store);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn migrates_existing_minecraft_servers_to_game_adapter_columns() {
        let database = std::env::temp_dir().join(format!(
            "msh-store-game-adapter-migration-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        {
            let connection = rusqlite::Connection::open(&database).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE servers (
                       id TEXT PRIMARY KEY,
                       name TEXT NOT NULL,
                       root_path TEXT NOT NULL UNIQUE,
                       server_type TEXT NOT NULL,
                       minecraft_version TEXT NOT NULL,
                       distribution_build TEXT,
                       launch_target TEXT NOT NULL DEFAULT 'server.jar',
                       java_path TEXT NOT NULL,
                       java_major INTEGER NOT NULL,
                       min_memory_mib INTEGER NOT NULL,
                       max_memory_mib INTEGER NOT NULL,
                       port INTEGER NOT NULL,
                       eula_accepted_at TEXT NOT NULL,
                       pending_restart INTEGER NOT NULL DEFAULT 0,
                       settings_json TEXT NOT NULL,
                       created_at TEXT NOT NULL,
                       updated_at TEXT NOT NULL
                     );",
                )
                .unwrap();
            let settings = serde_json::to_string(&BasicSettings::default()).unwrap();
            connection
                .execute(
                    "INSERT INTO servers VALUES (
                       'legacy-java', 'Legacy Java', 'C:\\Servers\\Legacy-Java', 'paper',
                       '1.21.11', NULL, 'server.jar', 'C:\\Java\\java.exe', 21, 1024,
                       4096, 25565, 'accepted', 0, ?1, 'created', 'updated'
                     )",
                    [&settings],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO servers VALUES (
                       'legacy-bedrock', 'Legacy Bedrock', 'C:\\Servers\\Legacy-Bedrock',
                       'bedrock', '1.21.100.7', NULL, 'bedrock_server.exe', '', 0, 0, 0,
                       19132, 'accepted', 0, ?1, 'created', 'updated'
                     )",
                    [&settings],
                )
                .unwrap();
        }

        let store = Store::open(&database).unwrap();
        let java = store.get_server("legacy-java").unwrap();
        assert_eq!(java.game_kind, "minecraft");
        assert!(java.palworld_settings.is_none());
        assert_eq!(java.edition(), "java");
        assert_eq!(java.runtime_kind(), "jvm");
        assert_eq!(java.network_transport(), "tcp");

        let bedrock = store.get_server("legacy-bedrock").unwrap();
        assert_eq!(bedrock.game_kind, "minecraft");
        assert!(bedrock.palworld_settings.is_none());
        assert_eq!(bedrock.edition(), "bedrock");
        assert_eq!(bedrock.runtime_kind(), "native");
        assert_eq!(bedrock.network_transport(), "udp");

        let columns = store
            .connection
            .prepare("PRAGMA table_info(servers)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.iter().any(|name| name == "game_kind"));
        assert!(columns.iter().any(|name| name == "game_settings_json"));

        drop(store);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn persists_and_updates_palworld_game_settings_without_secrets() {
        let database = std::env::temp_dir().join(format!(
            "msh-store-palworld-settings-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let store = Store::open(&database).unwrap();
        let now = "2026-08-29T00:00:00Z".to_string();
        let mut profile = ServerProfile {
            id: "palworld-server".into(),
            name: "Palworld".into(),
            root_path: "C:\\Servers\\Palworld".into(),
            game_kind: "palworld".into(),
            server_type: "palworld".into(),
            minecraft_version: "0.6.7".into(),
            distribution_build: Some("23940110".into()),
            launch_target: "PalServer.exe".into(),
            java_path: String::new(),
            java_major: 0,
            min_memory_mib: 0,
            max_memory_mib: 0,
            port: 8211,
            eula_accepted_at: String::new(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: Some(PalworldSettings {
                server_description: "Friends only".into(),
                max_players: 16,
                rest_api_port: 8212,
                rest_api_enabled: true,
                backup_enabled: true,
                ..PalworldSettings::default()
            }),
            created_at: now.clone(),
            updated_at: now,
        };

        store.insert_server(&profile).unwrap();
        let inserted = store.get_server(&profile.id).unwrap();
        assert_eq!(inserted.game_kind, "palworld");
        assert_eq!(inserted.edition(), "palworld");
        assert_eq!(inserted.runtime_kind(), "native");
        assert_eq!(inserted.network_transport(), "udp");
        let inserted_settings = inserted.palworld_settings.unwrap();
        assert_eq!(inserted_settings.server_description, "Friends only");
        assert_eq!(inserted_settings.max_players, 16);
        assert_eq!(inserted_settings.rest_api_port, 8212);
        assert!(inserted_settings.rest_api_enabled);
        assert!(inserted_settings.backup_enabled);

        profile.palworld_settings = Some(PalworldSettings {
            server_description: "After update".into(),
            max_players: 24,
            rest_api_port: 9222,
            rest_api_enabled: false,
            backup_enabled: true,
            ..PalworldSettings::default()
        });
        profile.updated_at = "2026-08-29T01:00:00Z".into();
        store.update_server(&profile).unwrap();
        let updated = store.get_server(&profile.id).unwrap();
        let updated_settings = updated.palworld_settings.unwrap();
        assert_eq!(updated_settings.server_description, "After update");
        assert_eq!(updated_settings.max_players, 24);
        assert_eq!(updated_settings.rest_api_port, 9222);
        assert!(!updated_settings.rest_api_enabled);

        let persisted_json: String = store
            .connection
            .query_row(
                "SELECT game_settings_json FROM servers WHERE id = ?1",
                [&profile.id],
                |row| row.get(0),
            )
            .unwrap();
        let normalized = persisted_json.to_ascii_lowercase();
        assert!(!normalized.contains("password"));
        assert!(!normalized.contains("token"));

        drop(store);
        let _ = std::fs::remove_file(database);
    }
}

impl Store {
    pub fn open(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS servers (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               root_path TEXT NOT NULL UNIQUE,
               server_type TEXT NOT NULL,
               minecraft_version TEXT NOT NULL,
               distribution_build TEXT,
               launch_target TEXT NOT NULL DEFAULT 'server.jar',
               java_path TEXT NOT NULL,
               java_major INTEGER NOT NULL,
               min_memory_mib INTEGER NOT NULL,
               max_memory_mib INTEGER NOT NULL,
               port INTEGER NOT NULL,
               eula_accepted_at TEXT NOT NULL,
               pending_restart INTEGER NOT NULL DEFAULT 0,
               settings_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               game_kind TEXT NOT NULL DEFAULT 'minecraft',
               game_settings_json TEXT
             );
             CREATE TABLE IF NOT EXISTS invite_settings (
               server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
               invite_name TEXT NOT NULL,
               custom_hostname TEXT,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS fixed_players (
               id TEXT PRIMARY KEY,
               edition TEXT NOT NULL DEFAULT 'java',
               player_name TEXT NOT NULL,
               whitelist INTEGER NOT NULL DEFAULT 1,
               is_operator INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS tunnel_settings (
               server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
               provider_id TEXT NOT NULL,
               agent_path TEXT,
               local_port INTEGER NOT NULL,
               transport TEXT NOT NULL DEFAULT 'tcp',
               last_state TEXT NOT NULL,
               last_checked_at TEXT,
               terms_acknowledged_at TEXT,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS crossplay_tunnel_settings (
               server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
               provider_id TEXT NOT NULL,
               agent_path TEXT,
               local_port INTEGER NOT NULL,
               transport TEXT NOT NULL DEFAULT 'udp',
               last_state TEXT NOT NULL,
               last_checked_at TEXT,
               terms_acknowledged_at TEXT,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS automation_settings (
               server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
               auto_stop_enabled INTEGER NOT NULL DEFAULT 0,
               idle_minutes INTEGER NOT NULL DEFAULT 30,
               notify_startup INTEGER NOT NULL DEFAULT 1,
               notify_player_join INTEGER NOT NULL DEFAULT 1,
               notify_crash INTEGER NOT NULL DEFAULT 1,
               notify_backup_failure INTEGER NOT NULL DEFAULT 1,
               updated_at TEXT NOT NULL
             );
             ",
        )?;
        let has_fixed_player_edition = connection
            .prepare("PRAGMA table_info(fixed_players)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(Result::ok)
            .any(|name| name == "edition");
        if !has_fixed_player_edition {
            connection.execute(
                "ALTER TABLE fixed_players ADD COLUMN edition TEXT NOT NULL DEFAULT 'java'",
                [],
            )?;
        }
        connection.execute_batch(
            "DROP INDEX IF EXISTS fixed_players_name_ci;
             CREATE UNIQUE INDEX IF NOT EXISTS fixed_players_edition_name_ci
               ON fixed_players(edition, lower(player_name));",
        )?;
        let has_launch_target = connection
            .prepare("PRAGMA table_info(servers)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(Result::ok)
            .any(|name| name == "launch_target");
        if !has_launch_target {
            connection.execute(
                "ALTER TABLE servers ADD COLUMN launch_target TEXT NOT NULL DEFAULT 'server.jar'",
                [],
            )?;
        }
        let server_columns = connection
            .prepare("PRAGMA table_info(servers)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(Result::ok)
            .collect::<std::collections::HashSet<_>>();
        if !server_columns.contains("game_kind") {
            connection.execute(
                "ALTER TABLE servers ADD COLUMN game_kind TEXT NOT NULL DEFAULT 'minecraft'",
                [],
            )?;
        }
        if !server_columns.contains("game_settings_json") {
            connection.execute("ALTER TABLE servers ADD COLUMN game_settings_json TEXT", [])?;
        }
        let has_tunnel_transport = connection
            .prepare("PRAGMA table_info(tunnel_settings)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(Result::ok)
            .any(|name| name == "transport");
        if !has_tunnel_transport {
            connection.execute(
                "ALTER TABLE tunnel_settings ADD COLUMN transport TEXT NOT NULL DEFAULT 'tcp'",
                [],
            )?;
        }
        Ok(Self { connection })
    }

    pub fn list_servers(&self) -> AppResult<Vec<ServerProfile>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, root_path, server_type, minecraft_version,
                    distribution_build, launch_target, java_path, java_major, min_memory_mib,
                    max_memory_mib, port, eula_accepted_at, pending_restart,
                    settings_json, created_at, updated_at, game_kind, game_settings_json
             FROM servers ORDER BY created_at ASC",
        )?;
        let rows = statement.query_map([], Self::map_server)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_server(&self, id: &str) -> AppResult<ServerProfile> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, root_path, server_type, minecraft_version,
                    distribution_build, launch_target, java_path, java_major, min_memory_mib,
                    max_memory_mib, port, eula_accepted_at, pending_restart,
                    settings_json, created_at, updated_at, game_kind, game_settings_json
             FROM servers WHERE id = ?1",
        )?;
        statement
            .query_row([id], Self::map_server)
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => crate::error::AppError::NotFound,
                other => other.into(),
            })
    }

    pub fn insert_server(&self, server: &ServerProfile) -> AppResult<()> {
        let settings = serde_json::to_string(&server.settings)?;
        let game_settings = server
            .palworld_settings
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        self.connection.execute(
            "INSERT INTO servers (
               id, name, root_path, server_type, minecraft_version,
               distribution_build, launch_target, java_path, java_major, min_memory_mib,
               max_memory_mib, port, eula_accepted_at, pending_restart,
               settings_json, created_at, updated_at, game_kind, game_settings_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                server.id,
                server.name,
                server.root_path,
                server.server_type,
                server.minecraft_version,
                server.distribution_build,
                server.launch_target,
                server.java_path,
                server.java_major,
                server.min_memory_mib,
                server.max_memory_mib,
                server.port,
                server.eula_accepted_at,
                server.pending_restart,
                settings,
                server.created_at,
                server.updated_at,
                server.game_kind,
                game_settings,
            ],
        )?;
        Ok(())
    }

    pub fn automation_settings(
        &self,
        server_id: &str,
    ) -> AppResult<crate::models::AutomationSettings> {
        use crate::models::AutomationSettings;
        let result = self.connection.query_row(
            "SELECT server_id, auto_stop_enabled, idle_minutes, notify_startup,
                    notify_player_join, notify_crash, notify_backup_failure, updated_at
             FROM automation_settings WHERE server_id = ?1",
            [server_id],
            |row| {
                Ok(AutomationSettings {
                    server_id: row.get(0)?,
                    auto_stop_enabled: row.get(1)?,
                    idle_minutes: row.get::<_, u16>(2)?,
                    notify_startup: row.get(3)?,
                    notify_player_join: row.get(4)?,
                    notify_crash: row.get(5)?,
                    notify_backup_failure: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        );
        match result {
            Ok(value) => Ok(value),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Ok(AutomationSettings::defaults(server_id))
            }
            Err(error) => Err(error.into()),
        }
    }

    pub fn save_automation_settings(
        &self,
        settings: &crate::models::AutomationSettings,
    ) -> AppResult<()> {
        self.get_server(&settings.server_id)?;
        self.connection.execute(
            "INSERT INTO automation_settings (
               server_id, auto_stop_enabled, idle_minutes, notify_startup,
               notify_player_join, notify_crash, notify_backup_failure, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(server_id) DO UPDATE SET
               auto_stop_enabled = excluded.auto_stop_enabled,
               idle_minutes = excluded.idle_minutes,
               notify_startup = excluded.notify_startup,
               notify_player_join = excluded.notify_player_join,
               notify_crash = excluded.notify_crash,
               notify_backup_failure = excluded.notify_backup_failure,
               updated_at = excluded.updated_at",
            params![
                settings.server_id,
                settings.auto_stop_enabled,
                settings.idle_minutes,
                settings.notify_startup,
                settings.notify_player_join,
                settings.notify_crash,
                settings.notify_backup_failure,
                settings.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_server(&self, server: &ServerProfile) -> AppResult<()> {
        let settings = serde_json::to_string(&server.settings)?;
        let game_settings = server
            .palworld_settings
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        self.connection.execute(
            "UPDATE servers SET name=?2, java_path=?3, java_major=?4,
                    min_memory_mib=?5, max_memory_mib=?6, port=?7,
                    pending_restart=?8, settings_json=?9, updated_at=?10,
                    game_kind=?11, game_settings_json=?12
             WHERE id=?1",
            params![
                server.id,
                server.name,
                server.java_path,
                server.java_major,
                server.min_memory_mib,
                server.max_memory_mib,
                server.port,
                server.pending_restart,
                settings,
                server.updated_at,
                server.game_kind,
                game_settings,
            ],
        )?;
        Ok(())
    }

    pub fn delete_server(&self, id: &str) -> AppResult<()> {
        let changed = self
            .connection
            .execute("DELETE FROM servers WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound);
        }
        Ok(())
    }

    pub fn get_invite_settings(
        &self,
        server_id: &str,
        default_name: &str,
    ) -> AppResult<InviteSettings> {
        let result = self.connection.query_row(
            "SELECT invite_name, custom_hostname, updated_at FROM invite_settings WHERE server_id = ?1",
            [server_id],
            |row| Ok(InviteSettings {
                invite_name: row.get(0)?,
                custom_hostname: row.get(1)?,
                updated_at: row.get(2)?,
            }),
        ).optional()?;
        Ok(result.unwrap_or_else(|| InviteSettings {
            invite_name: default_name.to_string(),
            custom_hostname: None,
            updated_at: String::new(),
        }))
    }

    pub fn save_invite_settings(
        &self,
        server_id: &str,
        settings: &InviteSettings,
    ) -> AppResult<()> {
        self.connection.execute(
            "INSERT INTO invite_settings (server_id, invite_name, custom_hostname, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(server_id) DO UPDATE SET
               invite_name=excluded.invite_name,
               custom_hostname=excluded.custom_hostname,
               updated_at=excluded.updated_at",
            params![
                server_id,
                settings.invite_name,
                settings.custom_hostname,
                settings.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn get_tunnel_settings(
        &self,
        server_id: &str,
        default_port: u16,
        default_transport: &str,
    ) -> AppResult<TunnelSettings> {
        let result = self.connection.query_row(
            "SELECT provider_id, agent_path, local_port, transport, last_state, last_checked_at,
                    terms_acknowledged_at, updated_at
             FROM tunnel_settings WHERE server_id = ?1",
            [server_id],
            |row| Ok(TunnelSettings {
                server_id: server_id.to_string(),
                provider_id: row.get(0)?, agent_path: row.get(1)?, local_port: row.get(2)?, transport: row.get(3)?,
                last_state: row.get(4)?, last_checked_at: row.get(5)?,
                terms_acknowledged_at: row.get(6)?, updated_at: row.get(7)?,
            }),
        ).optional()?;
        Ok(result.unwrap_or_else(|| TunnelSettings {
            server_id: server_id.to_string(),
            provider_id: "playit".into(),
            agent_path: None,
            local_port: default_port,
            transport: default_transport.into(),
            last_state: "unconfigured".into(),
            last_checked_at: None,
            terms_acknowledged_at: None,
            updated_at: String::new(),
        }))
    }

    pub fn save_tunnel_settings(&self, settings: &TunnelSettings) -> AppResult<()> {
        self.connection.execute(
            "INSERT INTO tunnel_settings (server_id, provider_id, agent_path, local_port, transport, last_state,
                 last_checked_at, terms_acknowledged_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(server_id) DO UPDATE SET
               provider_id=excluded.provider_id, agent_path=excluded.agent_path,
               local_port=excluded.local_port, transport=excluded.transport, last_state=excluded.last_state,
               last_checked_at=excluded.last_checked_at,
               terms_acknowledged_at=excluded.terms_acknowledged_at,
               updated_at=excluded.updated_at",
            params![settings.server_id, settings.provider_id, settings.agent_path, settings.local_port, settings.transport,
                settings.last_state, settings.last_checked_at, settings.terms_acknowledged_at,
                settings.updated_at],
        )?;
        Ok(())
    }

    pub fn get_crossplay_tunnel_settings(
        &self,
        server_id: &str,
        default_port: u16,
    ) -> AppResult<TunnelSettings> {
        let result = self.connection.query_row(
            "SELECT provider_id, agent_path, local_port, transport, last_state, last_checked_at,
                    terms_acknowledged_at, updated_at
             FROM crossplay_tunnel_settings WHERE server_id = ?1",
            [server_id],
            |row| Ok(TunnelSettings {
                server_id: server_id.to_string(),
                provider_id: row.get(0)?, agent_path: row.get(1)?, local_port: row.get(2)?, transport: row.get(3)?,
                last_state: row.get(4)?, last_checked_at: row.get(5)?,
                terms_acknowledged_at: row.get(6)?, updated_at: row.get(7)?,
            }),
        ).optional()?;
        Ok(result.unwrap_or_else(|| TunnelSettings {
            server_id: server_id.to_string(),
            provider_id: "playit".into(),
            agent_path: None,
            local_port: default_port,
            transport: "udp".into(),
            last_state: "unconfigured".into(),
            last_checked_at: None,
            terms_acknowledged_at: None,
            updated_at: String::new(),
        }))
    }

    pub fn save_crossplay_tunnel_settings(&self, settings: &TunnelSettings) -> AppResult<()> {
        self.connection.execute(
            "INSERT INTO crossplay_tunnel_settings (server_id, provider_id, agent_path, local_port, transport, last_state,
                 last_checked_at, terms_acknowledged_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(server_id) DO UPDATE SET
               provider_id=excluded.provider_id, agent_path=excluded.agent_path,
               local_port=excluded.local_port, transport=excluded.transport, last_state=excluded.last_state,
               last_checked_at=excluded.last_checked_at,
               terms_acknowledged_at=excluded.terms_acknowledged_at, updated_at=excluded.updated_at",
            params![settings.server_id, settings.provider_id, settings.agent_path, settings.local_port, settings.transport,
                settings.last_state, settings.last_checked_at, settings.terms_acknowledged_at,
                settings.updated_at],
        )?;
        Ok(())
    }

    pub fn list_fixed_players(&self) -> AppResult<Vec<FixedPlayerPreset>> {
        let mut statement = self.connection.prepare(
            "SELECT id, edition, player_name, whitelist, is_operator, created_at, updated_at
             FROM fixed_players ORDER BY edition ASC, lower(player_name) ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(FixedPlayerPreset {
                id: row.get(0)?,
                edition: row.get(1)?,
                player_name: row.get(2)?,
                whitelist: row.get(3)?,
                operator: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn save_fixed_player(&self, player: &FixedPlayerPreset) -> AppResult<FixedPlayerPreset> {
        let existing_by_id = self
            .connection
            .query_row(
                "SELECT created_at FROM fixed_players WHERE id=?1",
                [&player.id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let existing_by_name = self
            .connection
            .query_row(
                "SELECT id, created_at FROM fixed_players WHERE edition=?1 AND lower(player_name)=lower(?2)",
                params![player.edition, player.player_name],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if existing_by_id.is_some()
            && existing_by_name
                .as_ref()
                .is_some_and(|(id, _)| id != &player.id)
        {
            return Err(AppError::Validation(
                "同じプレイヤー名がすでに保存されています".into(),
            ));
        }
        let (id, created_at) = if let Some(created_at) = existing_by_id {
            (player.id.clone(), created_at)
        } else {
            existing_by_name.unwrap_or_else(|| (player.id.clone(), player.created_at.clone()))
        };
        self.connection.execute(
            "INSERT INTO fixed_players (id, edition, player_name, whitelist, is_operator, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               edition=excluded.edition,
               player_name=excluded.player_name,
               whitelist=excluded.whitelist,
               is_operator=excluded.is_operator,
               updated_at=excluded.updated_at",
            params![id, player.edition, player.player_name, player.whitelist, player.operator, created_at, player.updated_at],
        )?;
        Ok(FixedPlayerPreset {
            id,
            edition: player.edition.clone(),
            player_name: player.player_name.clone(),
            whitelist: player.whitelist,
            operator: player.operator,
            created_at,
            updated_at: player.updated_at.clone(),
        })
    }

    pub fn delete_fixed_player(&self, id: &str) -> AppResult<()> {
        let changed = self
            .connection
            .execute("DELETE FROM fixed_players WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound);
        }
        Ok(())
    }

    fn map_server(row: &rusqlite::Row<'_>) -> rusqlite::Result<ServerProfile> {
        let settings_json: String = row.get(14)?;
        let settings: BasicSettings = serde_json::from_str(&settings_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                14,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        let game_kind: String = row.get(17)?;
        let game_settings_json: Option<String> = row.get(18)?;
        let palworld_settings = game_settings_json
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    18,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
        Ok(ServerProfile {
            id: row.get(0)?,
            name: row.get(1)?,
            root_path: row.get(2)?,
            game_kind,
            server_type: row.get(3)?,
            minecraft_version: row.get(4)?,
            distribution_build: row.get(5)?,
            launch_target: row.get(6)?,
            java_path: row.get(7)?,
            java_major: row.get(8)?,
            min_memory_mib: row.get(9)?,
            max_memory_mib: row.get(10)?,
            port: row.get(11)?,
            eula_accepted_at: row.get(12)?,
            pending_restart: row.get(13)?,
            settings,
            palworld_settings,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
        })
    }
}
