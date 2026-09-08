use serde::{Deserialize, Serialize};

fn default_game_kind() -> String {
    "minecraft".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BasicSettings {
    pub default_game_mode: String,
    pub difficulty: String,
    pub max_players: u16,
    pub pvp: bool,
    pub whitelist: bool,
    pub allow_commands: bool,
    #[serde(default = "default_true")]
    pub online_mode: bool,
    #[serde(default)]
    pub allow_flight: bool,
    #[serde(default)]
    pub force_game_mode: bool,
    #[serde(default = "default_spawn_protection")]
    pub spawn_protection: u16,
    #[serde(default)]
    pub require_resource_pack: bool,
    #[serde(default)]
    pub resource_pack_url: String,
    #[serde(default)]
    pub resource_pack_prompt: String,
    pub world_name: String,
    #[serde(default = "default_world_type")]
    pub world_type: String,
    #[serde(default)]
    pub world_seed: String,
    #[serde(default = "default_true")]
    pub generate_structures: bool,
    #[serde(default)]
    pub hardcore: bool,
    #[serde(default = "default_true")]
    pub daylight_cycle: bool,
    #[serde(default = "default_true")]
    pub spawn_monsters: bool,
    #[serde(default = "default_true")]
    pub spawn_animals: bool,
    #[serde(default = "default_view_distance")]
    pub view_distance: u8,
    #[serde(default = "default_simulation_distance")]
    pub simulation_distance: u8,
}

fn default_true() -> bool {
    true
}
fn default_world_type() -> String {
    "minecraft:normal".into()
}
fn default_view_distance() -> u8 {
    10
}
fn default_simulation_distance() -> u8 {
    10
}
fn default_spawn_protection() -> u16 {
    16
}

impl Default for BasicSettings {
    fn default() -> Self {
        Self {
            default_game_mode: "survival".into(),
            difficulty: "easy".into(),
            max_players: 20,
            pvp: true,
            whitelist: false,
            allow_commands: false,
            online_mode: true,
            allow_flight: false,
            force_game_mode: false,
            spawn_protection: 16,
            require_resource_pack: false,
            resource_pack_url: String::new(),
            resource_pack_prompt: String::new(),
            world_name: "world".into(),
            world_type: default_world_type(),
            world_seed: String::new(),
            generate_structures: true,
            hardcore: false,
            daylight_cycle: true,
            spawn_monsters: true,
            spawn_animals: true,
            view_distance: 10,
            simulation_distance: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerProfile {
    pub id: String,
    pub name: String,
    pub root_path: String,
    #[serde(default = "default_game_kind")]
    pub game_kind: String,
    pub server_type: String,
    pub minecraft_version: String,
    pub distribution_build: Option<String>,
    pub launch_target: String,
    pub java_path: String,
    pub java_major: u16,
    pub min_memory_mib: u32,
    pub max_memory_mib: u32,
    pub port: u16,
    pub eula_accepted_at: String,
    pub pending_restart: bool,
    pub settings: BasicSettings,
    #[serde(default)]
    pub palworld_settings: Option<PalworldSettings>,
    pub created_at: String,
    pub updated_at: String,
}

impl ServerProfile {
    pub fn edition(&self) -> &'static str {
        match crate::game_adapter::GameAdapter::for_profile(self) {
            crate::game_adapter::GameAdapter::MinecraftJava => "java",
            crate::game_adapter::GameAdapter::MinecraftBedrock => "bedrock",
            crate::game_adapter::GameAdapter::Palworld => "palworld",
        }
    }

    pub fn runtime_kind(&self) -> &'static str {
        use crate::game_adapter::ServerAdapter;
        crate::game_adapter::GameAdapter::for_profile(self).runtime_kind()
    }

    pub fn network_transport(&self) -> &'static str {
        use crate::game_adapter::ServerAdapter;
        crate::game_adapter::GameAdapter::for_profile(self).network_transport()
    }

    pub fn game_adapter(&self) -> crate::game_adapter::GameAdapter {
        crate::game_adapter::GameAdapter::for_profile(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PalworldSettings {
    #[serde(default)]
    pub server_description: String,
    #[serde(default = "default_palworld_max_players")]
    pub max_players: u16,
    #[serde(default = "default_palworld_rest_port")]
    pub rest_api_port: u16,
    #[serde(default = "default_true")]
    pub rest_api_enabled: bool,
    #[serde(default = "default_true")]
    pub backup_enabled: bool,
    #[serde(default)]
    pub join_code_configured: bool,
    #[serde(default = "default_rate")]
    pub exp_rate: f32,
    #[serde(default = "default_rate")]
    pub collection_drop_rate: f32,
    #[serde(default = "default_rate")]
    pub pal_capture_rate: f32,
    #[serde(default = "default_rate")]
    pub day_time_speed_rate: f32,
    #[serde(default = "default_rate")]
    pub night_time_speed_rate: f32,
    #[serde(default = "default_palworld_hatching_time")]
    pub pal_egg_default_hatching_time: f32,
    #[serde(default = "default_palworld_death_penalty")]
    pub death_penalty: String,
    #[serde(default = "default_true")]
    pub invader_enemies_enabled: bool,
    #[serde(default = "default_true")]
    pub fast_travel_enabled: bool,
    #[serde(default = "default_true")]
    pub player_list_enabled: bool,
    #[serde(default = "default_true")]
    pub join_leave_messages_enabled: bool,
    #[serde(default)]
    pub voice_chat_enabled: bool,
    #[serde(default)]
    pub client_mods_allowed: bool,
    #[serde(default = "default_palworld_base_camps")]
    pub base_camp_max_num_in_guild: u16,
    #[serde(default = "default_palworld_base_workers")]
    pub base_camp_worker_max_num: u16,
}

fn default_palworld_max_players() -> u16 {
    32
}

fn default_palworld_rest_port() -> u16 {
    8212
}

fn default_rate() -> f32 {
    1.0
}

fn default_palworld_hatching_time() -> f32 {
    72.0
}

fn default_palworld_death_penalty() -> String {
    "All".into()
}

fn default_palworld_base_camps() -> u16 {
    4
}

fn default_palworld_base_workers() -> u16 {
    15
}

impl Default for PalworldSettings {
    fn default() -> Self {
        Self {
            server_description: "Managed locally by Minecraft Server Hub".into(),
            max_players: default_palworld_max_players(),
            rest_api_port: default_palworld_rest_port(),
            rest_api_enabled: true,
            backup_enabled: true,
            join_code_configured: false,
            exp_rate: default_rate(),
            collection_drop_rate: default_rate(),
            pal_capture_rate: default_rate(),
            day_time_speed_rate: default_rate(),
            night_time_speed_rate: default_rate(),
            pal_egg_default_hatching_time: default_palworld_hatching_time(),
            death_penalty: default_palworld_death_penalty(),
            invader_enemies_enabled: true,
            fast_travel_enabled: true,
            player_list_enabled: true,
            join_leave_messages_enabled: true,
            voice_chat_enabled: false,
            client_mods_allowed: false,
            base_camp_max_num_in_guild: default_palworld_base_camps(),
            base_camp_worker_max_num: default_palworld_base_workers(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePalworldSettingsInput {
    pub server_id: String,
    pub name: String,
    pub game_port: u16,
    pub settings: PalworldSettings,
    #[serde(default)]
    pub server_password: Option<String>,
    #[serde(default)]
    pub admin_password: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServerInput {
    pub name: String,
    pub parent_path: String,
    #[serde(default = "default_game_kind")]
    pub game_kind: String,
    pub server_type: String,
    pub minecraft_version: String,
    pub java_path: String,
    pub java_major: u16,
    pub min_memory_mib: u32,
    pub max_memory_mib: u32,
    pub port: u16,
    pub eula_accepted: bool,
    #[serde(default)]
    pub bedrock_archive_path: Option<String>,
    pub settings: BasicSettings,
    #[serde(default)]
    pub palworld_settings: Option<PalworldSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntime {
    pub executable_path: String,
    pub home_path: String,
    pub vendor: String,
    pub version: String,
    pub major_version: u16,
    pub architecture: String,
    pub compatible: bool,
    pub compatibility_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaDownloadPlan {
    pub provider: String,
    pub distribution: String,
    pub major_version: u16,
    pub release_name: String,
    pub package_name: String,
    pub size_bytes: u64,
    pub checksum_sha256: String,
    pub destination_path: String,
    pub license_name: String,
    pub license_url: String,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionOption {
    pub id: String,
    pub channel: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: String,
    pub player_count: u32,
    pub max_players: u32,
    pub online_players: Vec<String>,
    pub memory_used_mib: u64,
    pub uptime_seconds: u64,
    pub address: String,
    pub cpu_percent: f32,
    pub tps: Option<f32>,
    pub tps_supported: bool,
    pub ping_latency_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub palworld: Option<PalworldRuntimeMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PalworldRuntimeMetrics {
    pub api_reachable: bool,
    pub version: Option<String>,
    pub server_name: Option<String>,
    pub world_guid: Option<String>,
    pub server_fps: Option<u32>,
    pub server_frame_time_ms: Option<f32>,
    pub base_camp_count: Option<u32>,
    pub world_days: Option<u32>,
    pub players: Vec<PalworldPlayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PalworldPlayer {
    pub name: String,
    pub account_name: String,
    pub player_id: String,
    pub user_id: String,
    pub ping: f32,
    pub level: u32,
    pub building_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSettings {
    pub server_id: String,
    pub auto_stop_enabled: bool,
    pub idle_minutes: u16,
    pub notify_startup: bool,
    pub notify_player_join: bool,
    pub notify_crash: bool,
    pub notify_backup_failure: bool,
    pub updated_at: String,
}

impl AutomationSettings {
    pub fn defaults(server_id: impl Into<String>) -> Self {
        Self {
            server_id: server_id.into(),
            auto_stop_enabled: false,
            idle_minutes: 30,
            notify_startup: true,
            notify_player_join: true,
            notify_crash: true,
            notify_backup_failure: true,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCheckItem {
    pub severity: String,
    pub code: String,
    pub title: String,
    pub detail: String,
    pub files: Vec<String>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCheckReport {
    pub checked_at: String,
    pub blocking: bool,
    pub scanned_files: usize,
    pub managed_files: usize,
    pub items: Vec<ExtensionCheckItem>,
    pub limitation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationManifest {
    pub schema_version: u16,
    pub created_at: String,
    pub source_server_name: String,
    pub server_type: String,
    pub minecraft_version: String,
    pub distribution_build: Option<String>,
    pub launch_target: String,
    pub java_major: u16,
    pub min_memory_mib: u32,
    pub max_memory_mib: u32,
    pub port: u16,
    pub settings: BasicSettings,
    pub file_count: u64,
    pub source_size_bytes: u64,
    pub archive_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationExportResult {
    pub path: String,
    pub manifest: MigrationManifest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreMigrationInput {
    pub archive_path: String,
    pub parent_path: String,
    pub server_name: String,
    pub java_path: String,
    pub java_major: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcDiagnosis {
    pub cpu_name: String,
    pub physical_cores: usize,
    pub logical_threads: usize,
    pub cpu_usage_percent: f32,
    pub memory_total_mib: u64,
    pub memory_available_mib: u64,
    pub gpu_name: String,
    pub os: String,
    pub storage_kind: String,
    pub storage_free_gib: u64,
    pub storage_available: bool,
    pub java_runtimes: Vec<JavaRuntime>,
    pub recommended_memory_mib: u32,
    pub recommended_players: u16,
    pub recommended_view_distance: u8,
    pub recommended_simulation_distance: u8,
    pub warnings: Vec<String>,
    pub privacy_note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteServerInput {
    pub server_id: String,
    pub delete_files: bool,
    #[serde(default)]
    pub backup_mode: Option<String>,
    pub confirmation_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteServerResult {
    pub deleted_files: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegenerateWorldInput {
    pub server_id: String,
    pub confirmation_name: String,
    pub settings: BasicSettings,
    pub max_memory_mib: u32,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldRegenerationResult {
    pub server: ServerProfile,
    pub backup: BackupInfo,
    pub removed_world_folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackupKind {
    Manual,
    Scheduled,
    BeforeRestore,
    BeforeSettings,
    BeforeExtension,
    BeforeUpdate,
    BeforeWorldRegeneration,
    BeforeServerDelete,
    InitialImport,
    Legacy,
}

impl Default for BackupKind {
    fn default() -> Self {
        Self::Legacy
    }
}

fn legacy_backup_schema_version() -> u16 {
    1
}
fn protect_legacy_backup() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub path: String,
    pub server_name: String,
    pub minecraft_version: String,
    pub server_type: String,
    pub extension_summary: String,
    pub sha256: String,
    pub valid: bool,
    #[serde(default = "legacy_backup_schema_version")]
    pub schema_version: u16,
    #[serde(default)]
    pub kind: BackupKind,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub source_size_bytes: u64,
    #[serde(default)]
    pub file_count: u64,
    #[serde(default)]
    pub verified_at: Option<String>,
    #[serde(default = "protect_legacy_backup")]
    pub pinned: bool,
    #[serde(default)]
    pub schedule_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    pub server_id: String,
    pub stage: String,
    pub bytes_processed: u64,
    pub total_bytes: u64,
    pub files_processed: u64,
    pub total_files: u64,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosisIssue {
    pub id: String,
    pub severity: String,
    pub what_happened: String,
    pub impact: String,
    pub likely_cause: String,
    pub next_actions: Vec<String>,
    pub related_logs: Vec<String>,
    pub suggest_restore: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDiagnosisReport {
    pub checked_at: String,
    pub healthy: bool,
    pub issues: Vec<DiagnosisIssue>,
    pub redaction_note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    pub file_name: String,
    pub kind: String,
    pub enabled: bool,
    pub size_bytes: u64,
    pub compatibility: String,
    pub client_requirement: String,
    pub manageable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionVersionOption {
    pub id: String,
    pub name: String,
    pub version_number: String,
    pub release_channel: String,
    pub published_at: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub required_dependency_count: usize,
    pub client_requirement: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInstallItem {
    pub project_id: String,
    pub version_id: String,
    pub file_name: String,
    pub version_number: String,
    pub size_bytes: u64,
    pub dependency: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInstallPlan {
    pub provider: String,
    pub minecraft_version: String,
    pub loader: String,
    pub kind: String,
    pub items: Vec<ExtensionInstallItem>,
    pub total_size_bytes: u64,
    pub warnings: Vec<String>,
    pub client_requirement: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteInfo {
    pub lan_addresses: Vec<String>,
    pub host_address: String,
    pub port: u16,
    pub whitelist_recommended: bool,
    pub external_providers: Vec<ExternalProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteSettings {
    pub invite_name: String,
    pub custom_hostname: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInviteSettingsInput {
    pub server_id: String,
    pub invite_name: String,
    pub custom_hostname: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalProvider {
    pub id: String,
    pub name: String,
    pub account: String,
    pub price: String,
    pub limits: String,
    pub privacy: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicAccessStatus {
    pub state: String,
    pub address: Option<String>,
    pub named_address: Option<String>,
    pub invite_name: String,
    pub custom_hostname: Option<String>,
    pub hostname_state: String,
    pub hostname_message: String,
    pub method: String,
    pub expires_at: Option<String>,
    pub message: String,
    pub home_ip_exposed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelSettings {
    pub server_id: String,
    pub provider_id: String,
    pub agent_path: Option<String>,
    pub local_port: u16,
    #[serde(default = "default_tcp_transport")]
    pub transport: String,
    pub last_state: String,
    pub last_checked_at: Option<String>,
    pub terms_acknowledged_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    pub server_id: String,
    pub provider_id: String,
    pub state: String,
    pub local_host: String,
    pub local_port: u16,
    pub transport: String,
    pub agent_path: Option<String>,
    pub agent_version: Option<String>,
    pub agent_verified: bool,
    pub terms_acknowledged: bool,
    pub public_endpoint: Option<String>,
    pub account_state: String,
    pub pending_tunnel_count: usize,
    pub provider_notices: Vec<String>,
    pub matching_tunnel: bool,
    pub message: String,
    pub last_checked_at: Option<String>,
    pub recent_logs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidateTunnelAgentInput {
    pub server_id: String,
    pub provider_id: String,
    pub agent_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelAgentValidation {
    pub valid: bool,
    pub provider_id: String,
    pub agent_path: String,
    pub version: Option<String>,
    pub sha256: String,
    pub verification_method: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelAgentInstallPlan {
    pub provider_id: String,
    pub version: String,
    pub source_url: String,
    pub size_bytes: u64,
    pub checksum_sha256: String,
    pub publisher: String,
    pub license_name: String,
    pub license_url: String,
    pub install_scope: String,
    pub install_path: String,
    pub temporary_path: String,
    pub already_installed: bool,
    pub installed_validation: Option<TunnelAgentValidation>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallTunnelAgentInput {
    pub server_id: String,
    pub version: String,
    pub source_url: String,
    pub size_bytes: u64,
    pub checksum_sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartTunnelInput {
    pub server_id: String,
    pub provider_id: String,
    pub agent_path: String,
    pub terms_accepted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuickStartTunnelInput {
    pub server_id: String,
    pub terms_accepted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelDiagnosis {
    pub checked_at: String,
    pub server_running: bool,
    pub local_port_listening: bool,
    pub transport: String,
    pub agent_configured: bool,
    pub agent_verified: bool,
    pub agent_running: bool,
    pub provider_authenticated: bool,
    pub matching_tunnel: bool,
    pub tunnel_connected: bool,
    pub endpoint_available: bool,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelExternalProbe {
    pub checked_at: String,
    pub attempted: bool,
    pub reachable: bool,
    pub endpoint: Option<String>,
    pub transport: String,
    pub scope: String,
    pub message: String,
}

fn default_tcp_transport() -> String {
    "tcp".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub at: String,
    pub actor: String,
    pub action: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhitelistEntry {
    pub uuid: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerAccessEntry {
    pub id: String,
    pub label: String,
    pub detail: String,
    pub level: Option<u8>,
    pub reason: Option<String>,
    pub expires: Option<String>,
    pub pending: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlayerAccessInput {
    pub server_id: String,
    pub kind: String,
    pub target: String,
    pub entry_id: Option<String>,
    pub add: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedPlayerPreset {
    pub id: String,
    pub edition: String,
    pub player_name: String,
    pub whitelist: bool,
    pub operator: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFixedPlayerInput {
    pub id: Option<String>,
    pub edition: String,
    pub player_name: String,
    pub whitelist: bool,
    pub operator: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub root_path: String,
    pub suggested_name: String,
    pub server_type: String,
    pub minecraft_version: String,
    pub distribution_build: Option<String>,
    pub server_jar: Option<String>,
    pub world_folders: Vec<String>,
    pub mod_count: usize,
    pub plugin_count: usize,
    pub datapack_count: usize,
    pub port: u16,
    pub min_memory_mib: u32,
    pub max_memory_mib: u32,
    pub eula_accepted: bool,
    pub java_runtimes: Vec<JavaRuntime>,
    pub settings: BasicSettings,
    pub warnings: Vec<String>,
    pub can_import: bool,
    pub source_fingerprint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportServerInput {
    pub root_path: String,
    pub name: String,
    pub java_path: String,
    pub java_major: u16,
    pub create_initial_backup: bool,
    pub source_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileEntry {
    pub file_name: String,
    pub version: String,
    pub dependency_note: String,
    pub client_requirement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModpackProfile {
    pub id: String,
    pub name: String,
    pub source_server_id: String,
    pub minecraft_version: String,
    pub server_type: String,
    pub loader: String,
    pub mods: Vec<ProfileEntry>,
    pub plugins: Vec<ProfileEntry>,
    pub datapacks: Vec<ProfileEntry>,
    #[serde(default)]
    pub configuration_files: Vec<String>,
    pub settings: BasicSettings,
    pub recommended_memory_mib: u32,
    pub planned_players: u16,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDiff {
    pub missing_from_server: Vec<String>,
    pub extra_on_server: Vec<String>,
    pub configuration_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSafetyReport {
    pub checked_at: String,
    pub safe_to_proceed: bool,
    pub backup_recommended: bool,
    pub latest_backup_at: Option<String>,
    pub compatibility_checks: Vec<String>,
    pub dependency_warnings: Vec<String>,
    pub affected_files: Vec<String>,
    pub rollback_possible: bool,
    pub disclaimer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyServerUpdateInput {
    pub server_id: String,
    pub target_minecraft_version: String,
    pub target_server_type: String,
    pub confirmation_name: String,
    pub accept_warnings: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateApplyResult {
    pub server: ServerProfile,
    pub backup: BackupInfo,
    pub changed_files: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCenterItem {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub current_version: String,
    pub available_version: String,
    pub source: String,
    pub managed: bool,
    pub selectable: bool,
    pub requires_client_update: bool,
    pub note: String,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub extension_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCenterReport {
    pub checked_at: String,
    pub items: Vec<UpdateCenterItem>,
    pub unmanaged_files: Vec<String>,
    pub disclaimer: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyManagedExtensionUpdateInput {
    pub server_id: String,
    pub project_id: String,
    pub version_id: String,
    pub kind: String,
}

#[cfg(test)]
mod palworld_settings_compatibility_tests {
    use super::PalworldSettings;

    #[test]
    fn older_saved_palworld_settings_receive_safe_defaults() {
        let settings: PalworldSettings = serde_json::from_str(
            r#"{"serverDescription":"Old profile","maxPlayers":8,"restApiPort":8212,"restApiEnabled":true,"backupEnabled":true}"#,
        )
        .unwrap();
        assert_eq!(settings.exp_rate, 1.0);
        assert_eq!(settings.pal_capture_rate, 1.0);
        assert_eq!(settings.death_penalty, "All");
        assert_eq!(settings.base_camp_max_num_in_guild, 4);
        assert_eq!(settings.base_camp_worker_max_num, 15);
        assert!(!settings.join_code_configured);
    }
}
