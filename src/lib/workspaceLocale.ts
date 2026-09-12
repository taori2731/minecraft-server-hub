import type { AppLocale } from "./i18n";

const values = {
  ja: ["サーバー、プレイヤー、テンプレート、設定を検索…", "サーバー", "プレイヤー", "テンプレート", "発見", "ニュース", "すべてのサーバー", "構成から始める", "対応内容を探す", "更新情報とお知らせ", "検索結果はありません", "機能", "設定"],
  en: ["Search servers, players, templates, and settings…", "Servers", "Players", "Templates", "Discover", "News", "All servers", "Start from a configuration", "Explore supported options", "Updates and announcements", "No results found", "Feature", "Settings"],
  "zh-CN": ["搜索服务器、玩家、模板和设置…", "服务器", "玩家", "模板", "发现", "新闻", "所有服务器", "从配置开始", "探索支持内容", "更新与公告", "没有搜索结果", "功能", "设置"],
  "zh-TW": ["搜尋伺服器、玩家、範本與設定…", "伺服器", "玩家", "範本", "探索", "新聞", "所有伺服器", "從設定開始", "探索支援內容", "更新與公告", "找不到結果", "功能", "設定"],
  ko: ["서버, 플레이어, 템플릿, 설정 검색…", "서버", "플레이어", "템플릿", "탐색", "뉴스", "모든 서버", "구성으로 시작", "지원 항목 탐색", "업데이트 및 공지", "검색 결과가 없습니다", "기능", "설정"],
  es: ["Buscar servidores, jugadores, plantillas y ajustes…", "Servidores", "Jugadores", "Plantillas", "Descubrir", "Noticias", "Todos los servidores", "Empezar con una configuración", "Explorar opciones compatibles", "Actualizaciones y avisos", "No hay resultados", "Función", "Ajustes"],
  de: ["Server, Spieler, Vorlagen und Einstellungen suchen…", "Server", "Spieler", "Vorlagen", "Entdecken", "Neuigkeiten", "Alle Server", "Mit einer Konfiguration starten", "Unterstützte Optionen entdecken", "Updates und Hinweise", "Keine Ergebnisse", "Funktion", "Einstellungen"],
  fr: ["Rechercher serveurs, joueurs, modèles et paramètres…", "Serveurs", "Joueurs", "Modèles", "Découvrir", "Actualités", "Tous les serveurs", "Partir d’une configuration", "Explorer les options prises en charge", "Mises à jour et annonces", "Aucun résultat", "Fonction", "Paramètres"],
  "pt-BR": ["Pesquisar servidores, jogadores, modelos e configurações…", "Servidores", "Jogadores", "Modelos", "Descobrir", "Notícias", "Todos os servidores", "Começar por uma configuração", "Explorar opções compatíveis", "Atualizações e avisos", "Nenhum resultado", "Recurso", "Configurações"],
} satisfies Record<AppLocale, readonly string[]>;

export function workspaceText(locale: AppLocale) {
  const [search, servers, players, templates, discover, news, allServers, templateSubtitle, discoverSubtitle, newsSubtitle, noResults, feature, settings] = values[locale];
  return { search, servers, players, templates, discover, news, allServers, templateSubtitle, discoverSubtitle, newsSubtitle, noResults, feature, settings };
}

const catalogDetails: Record<AppLocale, readonly string[]> = {
  ja: ["Vanilla／Paper／Fabric／Forge／NeoForge", "公式Bedrock Dedicated Server", "公式SteamCMD版専用サーバー", "PaperでJava版と統合版のクロスプレイ"],
  en: ["Vanilla, Paper, Fabric, Forge, and NeoForge", "Official Bedrock Dedicated Server", "Official SteamCMD dedicated server", "Java and Bedrock crossplay on Paper"],
  "zh-CN": ["Vanilla、Paper、Fabric、Forge 和 NeoForge", "官方基岩版专用服务器", "官方 SteamCMD 专用服务器", "Paper 上的 Java 版与基岩版跨平台联机"],
  "zh-TW": ["Vanilla、Paper、Fabric、Forge 與 NeoForge", "官方基岩版專用伺服器", "官方 SteamCMD 專用伺服器", "Paper 上的 Java 版與基岩版跨平台連線"],
  ko: ["Vanilla, Paper, Fabric, Forge, NeoForge", "공식 Bedrock 전용 서버", "공식 SteamCMD 전용 서버", "Paper의 Java 및 Bedrock 크로스플레이"],
  es: ["Vanilla, Paper, Fabric, Forge y NeoForge", "Servidor dedicado oficial de Bedrock", "Servidor dedicado oficial mediante SteamCMD", "Juego cruzado Java y Bedrock en Paper"],
  de: ["Vanilla, Paper, Fabric, Forge und NeoForge", "Offizieller Bedrock Dedicated Server", "Offizieller Dedicated Server über SteamCMD", "Java- und Bedrock-Crossplay auf Paper"],
  fr: ["Vanilla, Paper, Fabric, Forge et NeoForge", "Serveur dédié Bedrock officiel", "Serveur dédié officiel via SteamCMD", "Jeu croisé Java et Bedrock sur Paper"],
  "pt-BR": ["Vanilla, Paper, Fabric, Forge e NeoForge", "Servidor dedicado Bedrock oficial", "Servidor dedicado oficial via SteamCMD", "Crossplay entre Java e Bedrock no Paper"],
};

export function supportedCatalog(locale: AppLocale) {
  return ["Minecraft Java", "Minecraft Bedrock", "Palworld", "Geyser + Floodgate"].map((title, index) => ({ title, detail: catalogDetails[locale][index] }));
}

const announcementText: Record<AppLocale, readonly string[]> = {
  ja: ["Tauri Updater署名とローカルサーバー管理画面を更新しました。", "SteamCMD準備、ローカルREST監視、安全保存・停止に対応しました。", "即時削除、重要データ保存、完全バックアップから選べます。"],
  en: ["Tauri updater signing and local server management were refreshed.", "SteamCMD setup, local REST monitoring, safe save, and shutdown are available.", "Choose immediate deletion, essential-data preservation, or a full backup."],
  "zh-CN": ["已更新 Tauri 更新签名和本地服务器管理界面。", "现已支持 SteamCMD 准备、本地 REST 监控、安全保存和停止。", "可选择立即删除、保留重要数据或完整备份。"],
  "zh-TW": ["已更新 Tauri 更新簽章與本機伺服器管理畫面。", "現已支援 SteamCMD 準備、本機 REST 監控、安全儲存與停止。", "可選擇立即刪除、保留重要資料或完整備份。"],
  ko: ["Tauri 업데이트 서명과 로컬 서버 관리 화면을 개선했습니다.", "SteamCMD 준비, 로컬 REST 모니터링, 안전 저장 및 종료를 지원합니다.", "즉시 삭제, 중요 데이터 보존 또는 전체 백업을 선택할 수 있습니다."],
  es: ["Se renovaron la firma del actualizador Tauri y la gestión local de servidores.", "Ya están disponibles SteamCMD, supervisión REST local, guardado seguro y apagado.", "Elige eliminación inmediata, conservación de datos esenciales o copia completa."],
  de: ["Tauri-Updater-Signatur und lokale Serververwaltung wurden überarbeitet.", "SteamCMD-Einrichtung, lokale REST-Überwachung, sicheres Speichern und Stoppen sind verfügbar.", "Wähle sofortiges Löschen, wichtige Daten oder eine vollständige Sicherung."],
  fr: ["La signature de mise à jour Tauri et la gestion locale ont été améliorées.", "La préparation SteamCMD, le suivi REST local, la sauvegarde et l’arrêt sûrs sont disponibles.", "Choisissez la suppression immédiate, les données essentielles ou une sauvegarde complète."],
  "pt-BR": ["A assinatura do atualizador Tauri e o gerenciamento local foram atualizados.", "Preparação via SteamCMD, monitoramento REST local, salvamento e parada segura estão disponíveis.", "Escolha exclusão imediata, dados essenciais ou backup completo."],
};

export function workspaceAnnouncements(locale: AppLocale) {
  const titles: Record<AppLocale, readonly string[]> = {
    ja: ["Minecraft Server Hub 0.3.10", "Palworld専用サーバー対応", "より安全な削除とバックアップ"],
    en: ["Minecraft Server Hub 0.3.10", "Palworld dedicated server support", "Safer deletion and backups"],
    "zh-CN": ["Minecraft Server Hub 0.3.10", "支持 Palworld 专用服务器", "更安全的删除与备份"],
    "zh-TW": ["Minecraft Server Hub 0.3.10", "支援 Palworld 專用伺服器", "更安全的刪除與備份"],
    ko: ["Minecraft Server Hub 0.3.10", "Palworld 전용 서버 지원", "더 안전한 삭제와 백업"],
    es: ["Minecraft Server Hub 0.3.10", "Compatibilidad con servidor de Palworld", "Eliminación y copias más seguras"],
    de: ["Minecraft Server Hub 0.3.10", "Palworld-Dedicated-Server", "Sicheres Löschen und Sichern"],
    fr: ["Minecraft Server Hub 0.3.10", "Prise en charge du serveur Palworld", "Suppression et sauvegardes plus sûres"],
    "pt-BR": ["Minecraft Server Hub 0.3.10", "Suporte a servidor dedicado Palworld", "Exclusão e backups mais seguros"],
  };
  return announcementText[locale].map((body, index) => ({ date: ["2026-09-12", "2026-09-11", "2026-09-10"][index], tag: ["APP", "PALWORLD", "SAFETY"][index], title: titles[locale][index], body }));
}
