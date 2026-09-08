import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { installDocumentTranslation } from "./documentTranslation";
import { hasTranslationCatalog, loadTranslationCatalog } from "./translationCatalog";

export type AppLocale = "en" | "ja" | "zh-CN" | "zh-TW" | "ko" | "es" | "de" | "fr" | "pt-BR";
export type LanguagePreference = "system" | AppLocale;

const STORAGE_KEY = "server-hub:language:v1";

export const languageOptions: readonly { value: LanguagePreference; nativeName: string }[] = [
  { value: "system", nativeName: "System language" },
  { value: "en", nativeName: "English" },
  { value: "ja", nativeName: "日本語" },
  { value: "zh-CN", nativeName: "简体中文" },
  { value: "zh-TW", nativeName: "繁體中文" },
  { value: "ko", nativeName: "한국어" },
  { value: "es", nativeName: "Español" },
  { value: "de", nativeName: "Deutsch" },
  { value: "fr", nativeName: "Français" },
  { value: "pt-BR", nativeName: "Português (Brasil)" },
] as const;

export function detectSystemLocale(languages: readonly string[] = navigator.languages): AppLocale {
  for (const raw of languages.length ? languages : [navigator.language]) {
    const locale = raw.toLowerCase();
    if (locale.startsWith("ja")) return "ja";
    if (locale.startsWith("zh-tw") || locale.startsWith("zh-hk") || locale.startsWith("zh-hant")) return "zh-TW";
    if (locale.startsWith("zh")) return "zh-CN";
    if (locale.startsWith("ko")) return "ko";
    if (locale.startsWith("es")) return "es";
    if (locale.startsWith("de")) return "de";
    if (locale.startsWith("fr")) return "fr";
    if (locale.startsWith("pt")) return "pt-BR";
    if (locale.startsWith("en")) return "en";
  }
  return "en";
}

export function readLanguagePreference(): LanguagePreference {
  const saved = localStorage.getItem(STORAGE_KEY);
  return languageOptions.some((option) => option.value === saved) ? saved as LanguagePreference : "system";
}

const en = {
  unofficial: "Unofficial tool", inviteFriends: "Invite friends", inviteBedrock: "Invite Bedrock", theme: "Theme", importServer: "Import existing server", newServer: "New server",
  serverList: "Servers", collapseSidebar: "Collapse sidebar", deleteServer: "Delete server", noServers: "No servers yet", createFirstServer: "Create your first server.", create: "Create", appSettings: "App settings", information: "About",
  loadingServers: "Loading server information", firstServerTitle: "Create your first server", firstServerBody: "No difficult commands required. Just choose where to save it and how you want to play.", serverDetails: "Server details",
  overview: "Overview", console: "Console", players: "Players", files: "Files", extensions: "Extensions", lab: "Server Lab", safety: "Safety tools", settings: "Settings",
  running: "Running", starting: "Starting…", stopping: "Stopping…", stopped: "Stopped", crashed: "Error", start: "Start", stop: "Stop", restart: "Restart", restarting: "Restarting…", serverActions: "Server actions",
  selectServerFirst: "Select a server first", language: "Language", languageTitle: "Language & region", languageIntro: "The first launch uses your system language. If it is not supported, the app starts in English.", languageChoice: "Display language", languageSystem: "System language", languageResolved: "Current display language", languageSaved: "Language preference saved", languageLocal: "This setting is stored only on this PC.", close: "Close",
  members: "Regular players", proOperations: "Pro operations", plan: "Plan", privacy: "Privacy", uninstall: "Uninstall",
  serverIcon: "Server icon", serverIconIntro: "Choose a PNG, JPEG, or WebP image. It is resized and stored only in this app.", serverIconProcessing: "Processing…", chooseImage: "Choose image", restoreDefaultIcon: "Restore default", serverIconSaved: "Server icon saved", serverIconReset: "Restored the default server icon", serverIconTypeError: "Choose a PNG, JPEG, or WebP image.", serverIconSizeError: "Choose an image no larger than 8 MiB.", serverIconDecodeError: "The image could not be read. Choose another image.", serverIconStorageError: "The icon could not be saved in this app.",
  appearanceStorageError: "Appearance settings could not be saved on this PC.", invalidThemeColor: "Enter a color as #RRGGBB.", customColorApplied: "Custom theme color applied", customColor: "Custom color", customColorHelp: "Choose any accent color. Text color is adjusted automatically for readability.", themeColor: "Theme color", colorCode: "Color code", applyColor: "Apply color",
} as const;

type MessageKey = keyof typeof en;
type Translation = Record<MessageKey, string>;

const dictionaries: Record<AppLocale, Translation> = {
  en,
  ja: {
    unofficial: "非公式ツール", inviteFriends: "友達を招待", inviteBedrock: "統合版を招待", theme: "テーマ", importServer: "既存サーバーを取り込む", newServer: "新しいサーバー",
    serverList: "サーバー一覧", collapseSidebar: "サイドバーを折りたたむ", deleteServer: "サーバーを削除", noServers: "サーバーはまだありません", createFirstServer: "最初のサーバーを作成しましょう。", create: "作成する", appSettings: "アプリ設定", information: "情報",
    loadingServers: "サーバー情報を読み込んでいます", firstServerTitle: "最初のサーバーを作りましょう", firstServerBody: "難しいコマンドは不要です。保存先と遊び方を選ぶだけで準備できます。", serverDetails: "サーバー詳細",
    overview: "概要", console: "コンソール", players: "プレイヤー", files: "ファイル", extensions: "拡張機能", lab: "サーバーラボ", safety: "安全ツール", settings: "設定",
    running: "起動中", starting: "起動しています", stopping: "停止中…", stopped: "停止中", crashed: "エラー", start: "起動", stop: "停止", restart: "再起動", restarting: "再起動中…", serverActions: "サーバー操作",
    selectServerFirst: "先にサーバーを選択してください", language: "言語", languageTitle: "言語と地域", languageIntro: "初回起動はシステム言語を使用します。未対応の言語の場合は英語で起動します。", languageChoice: "表示言語", languageSystem: "システム言語", languageResolved: "現在の表示言語", languageSaved: "言語設定を保存しました", languageLocal: "この設定はこのPC内だけに保存されます。", close: "閉じる",
    members: "いつものメンバー", proOperations: "Pro運用", plan: "プラン", privacy: "プライバシー", uninstall: "アンインストール",
    serverIcon: "サーバーアイコン", serverIconIntro: "PNG・JPEG・WebP画像を選べます。サイズを整えて、このアプリ内だけに保存します。", serverIconProcessing: "画像を処理中…", chooseImage: "画像を選ぶ", restoreDefaultIcon: "標準に戻す", serverIconSaved: "サーバーアイコンを保存しました", serverIconReset: "標準のサーバーアイコンに戻しました", serverIconTypeError: "PNG・JPEG・WebP画像を選んでください。", serverIconSizeError: "8 MiB以下の画像を選んでください。", serverIconDecodeError: "画像を読み取れませんでした。別の画像を選んでください。", serverIconStorageError: "このアプリにアイコンを保存できませんでした。",
    appearanceStorageError: "このPCに外観設定を保存できませんでした。", invalidThemeColor: "#RRGGBB形式で色を入力してください。", customColorApplied: "カスタムテーマ色を適用しました", customColor: "自由な色", customColorHelp: "好きなアクセント色を選べます。文字色は読みやすい色へ自動調整します。", themeColor: "テーマ色", colorCode: "カラーコード", applyColor: "この色を適用",
  },
  "zh-CN": {
    unofficial: "非官方工具", inviteFriends: "邀请好友", inviteBedrock: "邀请基岩版", theme: "主题", importServer: "导入现有服务器", newServer: "新建服务器",
    serverList: "服务器列表", collapseSidebar: "收起侧边栏", deleteServer: "删除服务器", noServers: "还没有服务器", createFirstServer: "创建你的第一个服务器。", create: "创建", appSettings: "应用设置", information: "关于",
    loadingServers: "正在加载服务器信息", firstServerTitle: "创建你的第一个服务器", firstServerBody: "无需复杂命令。只需选择保存位置和玩法即可。", serverDetails: "服务器详情",
    overview: "概览", console: "控制台", players: "玩家管理", files: "文件", extensions: "扩展", lab: "服务器实验室", safety: "安全工具", settings: "设置",
    running: "运行中", starting: "正在启动…", stopping: "正在停止…", stopped: "已停止", crashed: "错误", start: "启动", stop: "停止", restart: "重启", restarting: "正在重启…", serverActions: "服务器操作",
    selectServerFirst: "请先选择服务器", language: "语言", languageTitle: "语言和地区", languageIntro: "首次启动时使用系统语言。若不支持，则以英语启动。", languageChoice: "显示语言", languageSystem: "系统语言", languageResolved: "当前显示语言", languageSaved: "语言设置已保存", languageLocal: "此设置仅保存在本机。", close: "关闭",
    members: "常用成员", proOperations: "专业运维", plan: "方案", privacy: "隐私", uninstall: "卸载",
    serverIcon: "服务器图标", serverIconIntro: "请选择 PNG、JPEG 或 WebP 图片。图片会缩放并仅保存在本应用中。", serverIconProcessing: "正在处理…", chooseImage: "选择图片", restoreDefaultIcon: "恢复默认", serverIconSaved: "服务器图标已保存", serverIconReset: "已恢复默认服务器图标", serverIconTypeError: "请选择 PNG、JPEG 或 WebP 图片。", serverIconSizeError: "请选择不超过 8 MiB 的图片。", serverIconDecodeError: "无法读取图片，请选择其他图片。", serverIconStorageError: "无法在本应用中保存图标。",
    appearanceStorageError: "无法在此电脑上保存外观设置。", invalidThemeColor: "请以 #RRGGBB 格式输入颜色。", customColorApplied: "已应用自定义主题色", customColor: "自定义颜色", customColorHelp: "可选择任意强调色，文字颜色会自动调整以保证可读性。", themeColor: "主题色", colorCode: "颜色代码", applyColor: "应用颜色",
  },
  "zh-TW": {
    unofficial: "非官方工具", inviteFriends: "邀請朋友", inviteBedrock: "邀請基岩版", theme: "主題", importServer: "匯入現有伺服器", newServer: "新增伺服器",
    serverList: "伺服器列表", collapseSidebar: "收合側邊欄", deleteServer: "刪除伺服器", noServers: "尚無伺服器", createFirstServer: "建立第一個伺服器。", create: "建立", appSettings: "應用程式設定", information: "關於",
    loadingServers: "正在載入伺服器資訊", firstServerTitle: "建立第一個伺服器", firstServerBody: "不需要複雜指令，只要選擇儲存位置與遊玩方式。", serverDetails: "伺服器詳細資料",
    overview: "總覽", console: "主控台", players: "玩家管理", files: "檔案", extensions: "擴充功能", lab: "伺服器實驗室", safety: "安全工具", settings: "設定",
    running: "執行中", starting: "正在啟動…", stopping: "正在停止…", stopped: "已停止", crashed: "錯誤", start: "啟動", stop: "停止", restart: "重新啟動", restarting: "正在重新啟動…", serverActions: "伺服器操作",
    selectServerFirst: "請先選擇伺服器", language: "語言", languageTitle: "語言與地區", languageIntro: "首次啟動使用系統語言；若不支援則使用英文。", languageChoice: "顯示語言", languageSystem: "系統語言", languageResolved: "目前顯示語言", languageSaved: "語言設定已儲存", languageLocal: "此設定只儲存在這台電腦。", close: "關閉",
    members: "常用成員", proOperations: "進階運作", plan: "方案", privacy: "隱私權", uninstall: "解除安裝",
    serverIcon: "伺服器圖示", serverIconIntro: "請選擇 PNG、JPEG 或 WebP 圖片。圖片會縮放並只儲存在本應用程式。", serverIconProcessing: "處理中…", chooseImage: "選擇圖片", restoreDefaultIcon: "還原預設", serverIconSaved: "已儲存伺服器圖示", serverIconReset: "已還原預設伺服器圖示", serverIconTypeError: "請選擇 PNG、JPEG 或 WebP 圖片。", serverIconSizeError: "請選擇不超過 8 MiB 的圖片。", serverIconDecodeError: "無法讀取圖片，請選擇其他圖片。", serverIconStorageError: "無法在本應用程式儲存圖示。",
    appearanceStorageError: "無法在這台電腦儲存外觀設定。", invalidThemeColor: "請以 #RRGGBB 格式輸入顏色。", customColorApplied: "已套用自訂主題色", customColor: "自訂顏色", customColorHelp: "可選擇任意強調色，文字顏色會自動調整以保持易讀。", themeColor: "主題色", colorCode: "色碼", applyColor: "套用顏色",
  },
  ko: {
    unofficial: "비공식 도구", inviteFriends: "친구 초대", inviteBedrock: "베드락 초대", theme: "테마", importServer: "기존 서버 가져오기", newServer: "새 서버",
    serverList: "서버 목록", collapseSidebar: "사이드바 접기", deleteServer: "서버 삭제", noServers: "아직 서버가 없습니다", createFirstServer: "첫 서버를 만들어 보세요.", create: "만들기", appSettings: "앱 설정", information: "정보",
    loadingServers: "서버 정보를 불러오는 중", firstServerTitle: "첫 서버 만들기", firstServerBody: "어려운 명령어 없이 저장 위치와 플레이 방식을 선택하면 됩니다.", serverDetails: "서버 상세",
    overview: "개요", console: "콘솔", players: "플레이어 관리", files: "파일", extensions: "확장 기능", lab: "서버 랩", safety: "안전 도구", settings: "설정",
    running: "실행 중", starting: "시작 중…", stopping: "중지 중…", stopped: "중지됨", crashed: "오류", start: "시작", stop: "중지", restart: "재시작", restarting: "재시작 중…", serverActions: "서버 작업",
    selectServerFirst: "먼저 서버를 선택하세요", language: "언어", languageTitle: "언어 및 지역", languageIntro: "첫 실행에는 시스템 언어를 사용하며 지원하지 않으면 영어로 시작합니다.", languageChoice: "표시 언어", languageSystem: "시스템 언어", languageResolved: "현재 표시 언어", languageSaved: "언어 설정을 저장했습니다", languageLocal: "이 설정은 이 PC에만 저장됩니다.", close: "닫기",
    members: "고정 멤버", proOperations: "Pro 운영", plan: "플랜", privacy: "개인정보", uninstall: "제거",
    serverIcon: "서버 아이콘", serverIconIntro: "PNG, JPEG 또는 WebP 이미지를 선택하세요. 크기를 조정해 이 앱에만 저장합니다.", serverIconProcessing: "처리 중…", chooseImage: "이미지 선택", restoreDefaultIcon: "기본값 복원", serverIconSaved: "서버 아이콘을 저장했습니다", serverIconReset: "기본 서버 아이콘으로 복원했습니다", serverIconTypeError: "PNG, JPEG 또는 WebP 이미지를 선택하세요.", serverIconSizeError: "8 MiB 이하의 이미지를 선택하세요.", serverIconDecodeError: "이미지를 읽을 수 없습니다. 다른 이미지를 선택하세요.", serverIconStorageError: "이 앱에 아이콘을 저장할 수 없습니다.",
    appearanceStorageError: "이 PC에 모양 설정을 저장할 수 없습니다.", invalidThemeColor: "색상을 #RRGGBB 형식으로 입력하세요.", customColorApplied: "사용자 지정 테마 색상을 적용했습니다", customColor: "사용자 지정 색상", customColorHelp: "원하는 강조 색상을 선택하세요. 글자색은 읽기 쉽게 자동 조정됩니다.", themeColor: "테마 색상", colorCode: "색상 코드", applyColor: "색상 적용",
  },
  es: {
    unofficial: "Herramienta no oficial", inviteFriends: "Invitar amigos", inviteBedrock: "Invitar Bedrock", theme: "Tema", importServer: "Importar servidor", newServer: "Nuevo servidor",
    serverList: "Servidores", collapseSidebar: "Contraer barra lateral", deleteServer: "Eliminar servidor", noServers: "Aún no hay servidores", createFirstServer: "Crea tu primer servidor.", create: "Crear", appSettings: "Ajustes de la aplicación", information: "Información",
    loadingServers: "Cargando información del servidor", firstServerTitle: "Crea tu primer servidor", firstServerBody: "No necesitas comandos difíciles. Elige dónde guardarlo y cómo jugar.", serverDetails: "Detalles del servidor",
    overview: "Resumen", console: "Consola", players: "Jugadores", files: "Archivos", extensions: "Extensiones", lab: "Laboratorio del servidor", safety: "Herramientas de seguridad", settings: "Ajustes",
    running: "En ejecución", starting: "Iniciando…", stopping: "Deteniendo…", stopped: "Detenido", crashed: "Error", start: "Iniciar", stop: "Detener", restart: "Reiniciar", restarting: "Reiniciando…", serverActions: "Acciones del servidor",
    selectServerFirst: "Selecciona primero un servidor", language: "Idioma", languageTitle: "Idioma y región", languageIntro: "El primer inicio usa el idioma del sistema. Si no es compatible, se usa inglés.", languageChoice: "Idioma de pantalla", languageSystem: "Idioma del sistema", languageResolved: "Idioma actual", languageSaved: "Idioma guardado", languageLocal: "Este ajuste solo se guarda en este PC.", close: "Cerrar",
    members: "Jugadores habituales", proOperations: "Operaciones Pro", plan: "Plan", privacy: "Privacidad", uninstall: "Desinstalar",
    serverIcon: "Icono del servidor", serverIconIntro: "Elige una imagen PNG, JPEG o WebP. Se redimensiona y se guarda solo en esta aplicación.", serverIconProcessing: "Procesando…", chooseImage: "Elegir imagen", restoreDefaultIcon: "Restaurar predeterminado", serverIconSaved: "Icono del servidor guardado", serverIconReset: "Se restauró el icono predeterminado", serverIconTypeError: "Elige una imagen PNG, JPEG o WebP.", serverIconSizeError: "Elige una imagen de hasta 8 MiB.", serverIconDecodeError: "No se pudo leer la imagen. Elige otra.", serverIconStorageError: "No se pudo guardar el icono en esta aplicación.",
    appearanceStorageError: "No se pudieron guardar los ajustes de apariencia en este PC.", invalidThemeColor: "Introduce un color con el formato #RRGGBB.", customColorApplied: "Color de tema personalizado aplicado", customColor: "Color personalizado", customColorHelp: "Elige cualquier color de énfasis. El color del texto se ajusta automáticamente para facilitar la lectura.", themeColor: "Color del tema", colorCode: "Código de color", applyColor: "Aplicar color",
  },
  de: {
    unofficial: "Inoffizielles Tool", inviteFriends: "Freunde einladen", inviteBedrock: "Bedrock einladen", theme: "Design", importServer: "Server importieren", newServer: "Neuer Server",
    serverList: "Server", collapseSidebar: "Seitenleiste einklappen", deleteServer: "Server löschen", noServers: "Noch keine Server", createFirstServer: "Erstelle deinen ersten Server.", create: "Erstellen", appSettings: "App-Einstellungen", information: "Info",
    loadingServers: "Serverinformationen werden geladen", firstServerTitle: "Erstelle deinen ersten Server", firstServerBody: "Keine komplizierten Befehle. Wähle Speicherort und Spielweise aus.", serverDetails: "Serverdetails",
    overview: "Übersicht", console: "Konsole", players: "Spieler", files: "Dateien", extensions: "Erweiterungen", lab: "Serverlabor", safety: "Sicherheitswerkzeuge", settings: "Einstellungen",
    running: "Läuft", starting: "Startet…", stopping: "Wird gestoppt…", stopped: "Gestoppt", crashed: "Fehler", start: "Starten", stop: "Stoppen", restart: "Neu starten", restarting: "Neustart…", serverActions: "Serveraktionen",
    selectServerFirst: "Wähle zuerst einen Server", language: "Sprache", languageTitle: "Sprache und Region", languageIntro: "Beim ersten Start wird die Systemsprache verwendet. Nicht unterstützte Sprachen verwenden Englisch.", languageChoice: "Anzeigesprache", languageSystem: "Systemsprache", languageResolved: "Aktuelle Sprache", languageSaved: "Spracheinstellung gespeichert", languageLocal: "Diese Einstellung wird nur auf diesem PC gespeichert.", close: "Schließen",
    members: "Stammspieler", proOperations: "Pro-Betrieb", plan: "Plan", privacy: "Datenschutz", uninstall: "Deinstallieren",
    serverIcon: "Server-Symbol", serverIconIntro: "Wähle ein PNG-, JPEG- oder WebP-Bild. Es wird skaliert und nur in dieser App gespeichert.", serverIconProcessing: "Wird verarbeitet…", chooseImage: "Bild auswählen", restoreDefaultIcon: "Standard wiederherstellen", serverIconSaved: "Server-Symbol gespeichert", serverIconReset: "Standard-Server-Symbol wiederhergestellt", serverIconTypeError: "Wähle ein PNG-, JPEG- oder WebP-Bild.", serverIconSizeError: "Wähle ein Bild bis 8 MiB.", serverIconDecodeError: "Das Bild konnte nicht gelesen werden. Wähle ein anderes Bild.", serverIconStorageError: "Das Symbol konnte nicht in dieser App gespeichert werden.",
    appearanceStorageError: "Die Darstellung konnte auf diesem PC nicht gespeichert werden.", invalidThemeColor: "Gib eine Farbe als #RRGGBB ein.", customColorApplied: "Benutzerdefinierte Designfarbe angewendet", customColor: "Eigene Farbe", customColorHelp: "Wähle eine beliebige Akzentfarbe. Die Textfarbe wird für gute Lesbarkeit automatisch angepasst.", themeColor: "Designfarbe", colorCode: "Farbcode", applyColor: "Farbe anwenden",
  },
  fr: {
    unofficial: "Outil non officiel", inviteFriends: "Inviter des amis", inviteBedrock: "Inviter Bedrock", theme: "Thème", importServer: "Importer un serveur", newServer: "Nouveau serveur",
    serverList: "Serveurs", collapseSidebar: "Réduire la barre latérale", deleteServer: "Supprimer le serveur", noServers: "Aucun serveur", createFirstServer: "Créez votre premier serveur.", create: "Créer", appSettings: "Paramètres de l’application", information: "À propos",
    loadingServers: "Chargement des informations du serveur", firstServerTitle: "Créez votre premier serveur", firstServerBody: "Aucune commande compliquée. Choisissez l’emplacement et votre façon de jouer.", serverDetails: "Détails du serveur",
    overview: "Vue d’ensemble", console: "Console", players: "Joueurs", files: "Fichiers", extensions: "Extensions", lab: "Laboratoire serveur", safety: "Outils de sécurité", settings: "Paramètres",
    running: "En ligne", starting: "Démarrage…", stopping: "Arrêt…", stopped: "Arrêté", crashed: "Erreur", start: "Démarrer", stop: "Arrêter", restart: "Redémarrer", restarting: "Redémarrage…", serverActions: "Actions du serveur",
    selectServerFirst: "Sélectionnez d’abord un serveur", language: "Langue", languageTitle: "Langue et région", languageIntro: "Le premier lancement utilise la langue du système. Si elle n’est pas prise en charge, l’anglais est utilisé.", languageChoice: "Langue d’affichage", languageSystem: "Langue du système", languageResolved: "Langue actuelle", languageSaved: "Langue enregistrée", languageLocal: "Ce réglage est conservé uniquement sur ce PC.", close: "Fermer",
    members: "Joueurs habituels", proOperations: "Opérations Pro", plan: "Offre", privacy: "Confidentialité", uninstall: "Désinstaller",
    serverIcon: "Icône du serveur", serverIconIntro: "Choisissez une image PNG, JPEG ou WebP. Elle est redimensionnée et enregistrée uniquement dans cette application.", serverIconProcessing: "Traitement…", chooseImage: "Choisir une image", restoreDefaultIcon: "Rétablir par défaut", serverIconSaved: "Icône du serveur enregistrée", serverIconReset: "Icône du serveur par défaut rétablie", serverIconTypeError: "Choisissez une image PNG, JPEG ou WebP.", serverIconSizeError: "Choisissez une image de 8 MiB maximum.", serverIconDecodeError: "L’image n’a pas pu être lue. Choisissez-en une autre.", serverIconStorageError: "L’icône n’a pas pu être enregistrée dans cette application.",
    appearanceStorageError: "Les paramètres d’apparence n’ont pas pu être enregistrés sur ce PC.", invalidThemeColor: "Saisissez une couleur au format #RRGGBB.", customColorApplied: "Couleur de thème personnalisée appliquée", customColor: "Couleur personnalisée", customColorHelp: "Choisissez la couleur d’accentuation souhaitée. La couleur du texte s’adapte automatiquement pour rester lisible.", themeColor: "Couleur du thème", colorCode: "Code couleur", applyColor: "Appliquer la couleur",
  },
  "pt-BR": {
    unofficial: "Ferramenta não oficial", inviteFriends: "Convidar amigos", inviteBedrock: "Convidar Bedrock", theme: "Tema", importServer: "Importar servidor", newServer: "Novo servidor",
    serverList: "Servidores", collapseSidebar: "Recolher barra lateral", deleteServer: "Excluir servidor", noServers: "Ainda não há servidores", createFirstServer: "Crie seu primeiro servidor.", create: "Criar", appSettings: "Configurações do aplicativo", information: "Sobre",
    loadingServers: "Carregando informações do servidor", firstServerTitle: "Crie seu primeiro servidor", firstServerBody: "Sem comandos difíceis. Escolha onde salvar e como jogar.", serverDetails: "Detalhes do servidor",
    overview: "Visão geral", console: "Console", players: "Jogadores", files: "Arquivos", extensions: "Extensões", lab: "Laboratório do servidor", safety: "Ferramentas de segurança", settings: "Configurações",
    running: "Em execução", starting: "Iniciando…", stopping: "Parando…", stopped: "Parado", crashed: "Erro", start: "Iniciar", stop: "Parar", restart: "Reiniciar", restarting: "Reiniciando…", serverActions: "Ações do servidor",
    selectServerFirst: "Selecione um servidor primeiro", language: "Idioma", languageTitle: "Idioma e região", languageIntro: "A primeira inicialização usa o idioma do sistema. Se não houver suporte, o app inicia em inglês.", languageChoice: "Idioma de exibição", languageSystem: "Idioma do sistema", languageResolved: "Idioma atual", languageSaved: "Idioma salvo", languageLocal: "Esta configuração é salva somente neste PC.", close: "Fechar",
    members: "Jogadores frequentes", proOperations: "Operações Pro", plan: "Plano", privacy: "Privacidade", uninstall: "Desinstalar",
    serverIcon: "Ícone do servidor", serverIconIntro: "Escolha uma imagem PNG, JPEG ou WebP. Ela é redimensionada e salva somente neste aplicativo.", serverIconProcessing: "Processando…", chooseImage: "Escolher imagem", restoreDefaultIcon: "Restaurar padrão", serverIconSaved: "Ícone do servidor salvo", serverIconReset: "Ícone padrão do servidor restaurado", serverIconTypeError: "Escolha uma imagem PNG, JPEG ou WebP.", serverIconSizeError: "Escolha uma imagem de até 8 MiB.", serverIconDecodeError: "Não foi possível ler a imagem. Escolha outra.", serverIconStorageError: "Não foi possível salvar o ícone neste aplicativo.",
    appearanceStorageError: "Não foi possível salvar as configurações de aparência neste PC.", invalidThemeColor: "Digite uma cor no formato #RRGGBB.", customColorApplied: "Cor de tema personalizada aplicada", customColor: "Cor personalizada", customColorHelp: "Escolha qualquer cor de destaque. A cor do texto é ajustada automaticamente para facilitar a leitura.", themeColor: "Cor do tema", colorCode: "Código da cor", applyColor: "Aplicar cor",
  },
};

export function translate(locale: AppLocale, key: MessageKey) {
  return dictionaries[locale][key];
}

type I18nValue = {
  preference: LanguagePreference;
  locale: AppLocale;
  setPreference: (preference: LanguagePreference) => void;
  t: (key: MessageKey) => string;
};

const defaultLocale = detectSystemLocale();
const I18nContext = createContext<I18nValue>({ preference: "system", locale: defaultLocale, setPreference: () => undefined, t: (key) => dictionaries[defaultLocale][key] });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<LanguagePreference>(readLanguagePreference);
  const [systemLocale, setSystemLocale] = useState<AppLocale>(detectSystemLocale);
  const desiredLocale = preference === "system" ? systemLocale : preference;
  const [locale, setLocale] = useState<AppLocale>(desiredLocale);
  const [catalogRevision, setCatalogRevision] = useState(() => hasTranslationCatalog(desiredLocale) ? 1 : 0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  useEffect(() => {
    const update = () => setSystemLocale(detectSystemLocale());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (hasTranslationCatalog(desiredLocale)) {
      setLocale(desiredLocale);
      setCatalogRevision((revision) => revision + 1);
      return () => { cancelled = true; };
    }
    void loadTranslationCatalog(desiredLocale).then(() => {
      if (cancelled) return;
      setLocale(desiredLocale);
      setCatalogRevision((revision) => revision + 1);
    }).catch((error: unknown) => {
      console.error(`Failed to load the ${desiredLocale} translation catalog.`, error);
    });
    return () => { cancelled = true; };
  }, [desiredLocale]);

  useEffect(() => {
    if (!hasTranslationCatalog(locale)) return;
    document.documentElement.lang = locale;
    return installDocumentTranslation(locale);
  }, [catalogRevision, locale]);

  const value = useMemo<I18nValue>(() => ({ preference, locale, setPreference, t: (key) => translate(locale, key) }), [locale, preference]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function localeDisplayName(locale: AppLocale, displayLocale: AppLocale) {
  try { return new Intl.DisplayNames([displayLocale], { type: "language" }).of(locale) ?? locale; }
  catch { return languageOptions.find((option) => option.value === locale)?.nativeName ?? locale; }
}
