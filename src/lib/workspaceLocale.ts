import type { AppLocale } from "./i18n";
import { brand } from "./brand";

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
  ja: ["料金プラン表示を廃止し、支援は任意という方針に変更しました。", "支援受付は準備中です。将来の新機能の先行体験や開発中機能へのフィードバック参加、限定外観を候補として検討しています。寄付先・価格・決済方法は未定です。", "高度な運用は全員が利用できます。安定機能、安全機能、バックアップと復元、サーバーデータへのアクセスを支援の有無で制限しません。"],
  en: ["The paid-plan display was removed; support is optional.", "Support sign-up is being prepared. Early access to future features, feedback participation for features in development, and limited appearance options are candidates only; the recipient, price, and payment method are undecided.", "Advanced operations are available to everyone. Stable and safety features, backup and restore, and access to server data are not restricted by support status."],
  "zh-CN": ["已移除付费方案显示；支持项目完全自愿。", "支持受理正在准备中。未来新增功能的提前体验、参与开发中功能反馈和限定外观只是候选方案；接收方、价格和支付方式尚未确定。", "高级运维面向所有人开放。稳定功能、安全功能、备份与恢复以及服务器数据访问不会因是否支持项目而受限。"],
  "zh-TW": ["已移除付費方案顯示；支援專案完全自願。", "支援受理正在準備中。未來新增功能的提前體驗、參與開發中功能的意見回饋與限定外觀只是候選方案；接收方、價格與付款方式尚未確定。", "進階運作提供給所有人。穩定功能、安全功能、備份與還原，以及伺服器資料存取不會因是否支援專案而受限。"],
  ko: ["유료 플랜 표시를 없애고 응원은 선택 사항으로 전환했습니다.", "응원 접수를 준비 중입니다. 앞으로 추가될 기능의 사전 체험, 개발 중 기능 피드백 참여, 한정 외관을 후보로 검토하고 있으며 수신처·가격·결제 방법은 정해지지 않았습니다.", "고급 운영은 모두에게 제공됩니다. 안정 기능, 안전 기능, 백업과 복원, 서버 데이터 접근은 응원 여부로 제한하지 않습니다."],
  es: ["Eliminamos la presentación de planes de pago; el apoyo es opcional.", "Estamos preparando la recepción de apoyos. Consideramos como candidatos el acceso anticipado a futuras funciones, la participación en comentarios sobre funciones en desarrollo y apariencias limitadas; el destinatario, el precio y el método de pago aún no están decididos.", "Las operaciones avanzadas están disponibles para todos. Las funciones estables y de seguridad, las copias y restauraciones y el acceso a los datos del servidor no se limitan por apoyar o no el proyecto."],
  de: ["Die Anzeige kostenpflichtiger Angebote wurde entfernt; Unterstützung ist freiwillig.", "Die Unterstützungsannahme wird vorbereitet. Früher Zugang zu künftigen Funktionen, Feedback zu Funktionen in Entwicklung und exklusive Darstellungen sind nur Kandidaten; Empfänger, Preis und Zahlungsweg stehen noch nicht fest.", "Der erweiterte Betrieb steht allen offen. Stabile und Sicherheitsfunktionen, Sicherung und Wiederherstellung sowie der Zugriff auf Serverdaten werden nicht nach Unterstützung eingeschränkt."],
  fr: ["Nous avons supprimé l’affichage des offres payantes : le soutien est facultatif.", "Le soutien est en préparation. L’accès anticipé aux futures fonctions, la participation aux retours sur les fonctions en développement et des apparences limitées sont des pistes seulement ; destinataire, prix et mode de paiement ne sont pas définis.", "Les opérations avancées sont accessibles à tout le monde. Les fonctions stables et de sécurité, la sauvegarde et la restauration, ainsi que l’accès aux données du serveur ne sont pas limités selon le soutien."],
  "pt-BR": ["Removemos a exibição de planos pagos; o apoio é opcional.", "O recebimento de apoio está sendo preparado. Acesso antecipado a novos recursos, participação em feedback de recursos em desenvolvimento e aparências limitadas são apenas candidatos; destinatário, preço e forma de pagamento ainda não foram definidos.", "As operações avançadas estão disponíveis para todos. Recursos estáveis e de segurança, backup e restauração e acesso aos dados do servidor não são limitados conforme o apoio."],
};

export function workspaceAnnouncements(locale: AppLocale) {
  const titles: Record<AppLocale, readonly string[]> = {
    ja: [`${brand.productName} 0.4.4`, "料金プランを廃止し、任意支援へ", "高度な運用を全員へ"],
    en: [`${brand.productName} 0.4.4`, "Paid plans removed; optional support", "Advanced operations for everyone"],
    "zh-CN": [`${brand.productName} 0.4.4`, "移除付费方案，支持完全自愿", "高级运维面向所有人"],
    "zh-TW": [`${brand.productName} 0.4.4`, "移除付費方案，支援完全自願", "進階運作提供給所有人"],
    ko: [`${brand.productName} 0.4.4`, "유료 플랜 폐지, 응원은 선택 사항", "모두를 위한 고급 운영"],
    es: [`${brand.productName} 0.4.4`, "Planes de pago eliminados; apoyo opcional", "Operaciones avanzadas para todos"],
    de: [`${brand.productName} 0.4.4`, "Kostenpflichtige Angebote entfernt; Unterstützung freiwillig", "Erweiterter Betrieb für alle"],
    fr: [`${brand.productName} 0.4.4`, "Offres payantes supprimées ; soutien facultatif", "Opérations avancées pour tous"],
    "pt-BR": [`${brand.productName} 0.4.4`, "Planos pagos removidos; apoio opcional", "Operações avançadas para todos"],
  };
  return announcementText[locale].map((body, index) => ({ date: ["2026-09-14", "2026-09-13", "2026-09-12"][index], tag: ["APP", "SUPPORT", "OPERATIONS"][index], title: titles[locale][index], body }));
}
