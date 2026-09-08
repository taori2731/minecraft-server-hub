import type { AppLocale } from "./i18n";

const ja = {
  title: "Palworldサーバー設定",
  subtitle: "接続、パスワード、ワールド倍率、便利機能をまとめて変更します。",
  stoppedOnly: "設定を変更するにはサーバーを安全停止してください。",
  basic: "基本と接続",
  serverName: "サーバー名",
  description: "サーバー説明",
  gamePort: "ゲーム接続ポート（UDP）",
  restPort: "REST管理ポート（TCP・ローカル専用）",
  chooseFree: "空きを選ぶ",
  maxPlayers: "最大プレイヤー数",
  access: "パスワードと安全",
  joinPassword: "参加パスワード",
  joinConfigured: "設定済み",
  joinNotConfigured: "未設定",
  joinPlaceholder: "変更するときだけ入力",
  clearJoin: "参加パスワードを解除",
  adminPassword: "管理パスワード",
  adminPlaceholder: "変更するときだけ入力",
  secretHelp: "空欄のまま保存すると現在のパスワードを維持します。秘密値はデータベースやログへ保存しません。",
  balance: "ワールド倍率",
  expRate: "経験値倍率",
  captureRate: "パル捕獲率",
  dropRate: "採集・ドロップ倍率",
  daySpeed: "昼の速度",
  nightSpeed: "夜の速度",
  hatchingTime: "巨大卵の孵化時間（時間）",
  gameplay: "遊び方と便利機能",
  deathPenalty: "死亡時ペナルティ",
  deathNone: "なし",
  deathItem: "アイテム",
  deathItemEquipment: "アイテムと装備",
  deathAll: "すべて",
  invasions: "襲撃イベント",
  fastTravel: "ファストトラベル",
  playerList: "プレイヤー一覧を表示",
  joinLeave: "参加・退出メッセージ",
  voiceChat: "ボイスチャット",
  clientMods: "クライアントModを許可",
  backup: "Palworldの自動セーブバックアップ",
  baseCamps: "ギルドの拠点上限",
  baseWorkers: "拠点ごとの作業パル上限",
  save: "設定を安全に保存",
  saving: "設定を保存しています…",
  saved: "Palworld設定を保存しました。次回起動時に反映されます。",
  portSelected: "空きポート {port} を選びました。",
  restart: "変更は次回起動時に反映されます。変更前の設定ファイルも自動保存します。",
} as const;

export type PalworldSettingsLocaleKey = keyof typeof ja;
type Catalog = Record<PalworldSettingsLocaleKey, string>;

const en: Catalog = {
  title: "Palworld server settings", subtitle: "Change connections, passwords, world rates, and convenience features in one place.", stoppedOnly: "Safely stop the server before changing settings.",
  basic: "Basics and connection", serverName: "Server name", description: "Server description", gamePort: "Game connection port (UDP)", restPort: "REST management port (TCP, local only)", chooseFree: "Choose free port", maxPlayers: "Maximum players",
  access: "Passwords and safety", joinPassword: "Join password", joinConfigured: "Configured", joinNotConfigured: "Not configured", joinPlaceholder: "Enter only to change", clearJoin: "Remove join password", adminPassword: "Administrator password", adminPlaceholder: "Enter only to change", secretHelp: "Leaving a field blank keeps its current password. Secrets are never stored in the database or logs.",
  balance: "World rates", expRate: "Experience rate", captureRate: "Pal capture rate", dropRate: "Collection and drop rate", daySpeed: "Day speed", nightSpeed: "Night speed", hatchingTime: "Huge egg hatching time (hours)",
  gameplay: "Gameplay and conveniences", deathPenalty: "Death penalty", deathNone: "None", deathItem: "Items", deathItemEquipment: "Items and equipment", deathAll: "Everything", invasions: "Raid events", fastTravel: "Fast travel", playerList: "Show player list", joinLeave: "Join and leave messages", voiceChat: "Voice chat", clientMods: "Allow client mods", backup: "Palworld automatic save backups", baseCamps: "Base limit per guild", baseWorkers: "Worker Pal limit per base",
  save: "Save settings safely", saving: "Saving settings…", saved: "Palworld settings saved. They take effect on the next start.", portSelected: "Selected free port {port}.", restart: "Changes take effect on the next start. The previous settings file is backed up automatically.",
};

const de: Catalog = {
  title: "Palworld-Servereinstellungen", subtitle: "Verbindung, Passwörter, Weltraten und Komfortfunktionen gemeinsam ändern.", stoppedOnly: "Stoppe den Server sicher, bevor du Einstellungen änderst.",
  basic: "Grundlagen und Verbindung", serverName: "Servername", description: "Serverbeschreibung", gamePort: "Spielport (UDP)", restPort: "REST-Verwaltungsport (TCP, nur lokal)", chooseFree: "Freien Port wählen", maxPlayers: "Maximale Spielerzahl",
  access: "Passwörter und Sicherheit", joinPassword: "Beitrittspasswort", joinConfigured: "Eingerichtet", joinNotConfigured: "Nicht eingerichtet", joinPlaceholder: "Nur zum Ändern eingeben", clearJoin: "Beitrittspasswort entfernen", adminPassword: "Administratorpasswort", adminPlaceholder: "Nur zum Ändern eingeben", secretHelp: "Leere Felder behalten das aktuelle Passwort. Geheimnisse werden nie in Datenbank oder Protokollen gespeichert.",
  balance: "Weltraten", expRate: "Erfahrungsrate", captureRate: "Pal-Fangrate", dropRate: "Sammel- und Droprate", daySpeed: "Tagesgeschwindigkeit", nightSpeed: "Nachtgeschwindigkeit", hatchingTime: "Brutzeit riesiger Eier (Stunden)",
  gameplay: "Spielweise und Komfort", deathPenalty: "Todesstrafe", deathNone: "Keine", deathItem: "Gegenstände", deathItemEquipment: "Gegenstände und Ausrüstung", deathAll: "Alles", invasions: "Überfallereignisse", fastTravel: "Schnellreise", playerList: "Spielerliste anzeigen", joinLeave: "Beitritts- und Austrittsmeldungen", voiceChat: "Sprachchat", clientMods: "Client-Mods erlauben", backup: "Automatische Palworld-Spielstandssicherung", baseCamps: "Basenlimit pro Gilde", baseWorkers: "Arbeits-Pals pro Basis",
  save: "Einstellungen sicher speichern", saving: "Einstellungen werden gespeichert…", saved: "Palworld-Einstellungen gespeichert. Sie gelten beim nächsten Start.", portSelected: "Freier Port {port} ausgewählt.", restart: "Änderungen gelten beim nächsten Start. Die vorherige Einstellungsdatei wird automatisch gesichert.",
};

const es: Catalog = {
  title: "Configuración del servidor Palworld", subtitle: "Cambia conexiones, contraseñas, multiplicadores y funciones prácticas en un solo lugar.", stoppedOnly: "Detén el servidor de forma segura antes de cambiar la configuración.",
  basic: "Datos básicos y conexión", serverName: "Nombre del servidor", description: "Descripción del servidor", gamePort: "Puerto de conexión del juego (UDP)", restPort: "Puerto de administración REST (TCP, solo local)", chooseFree: "Elegir puerto libre", maxPlayers: "Jugadores máximos",
  access: "Contraseñas y seguridad", joinPassword: "Contraseña de acceso", joinConfigured: "Configurada", joinNotConfigured: "Sin configurar", joinPlaceholder: "Escribe solo para cambiarla", clearJoin: "Quitar contraseña de acceso", adminPassword: "Contraseña de administrador", adminPlaceholder: "Escribe solo para cambiarla", secretHelp: "Un campo vacío conserva la contraseña actual. Los secretos nunca se guardan en la base de datos ni en los registros.",
  balance: "Multiplicadores del mundo", expRate: "Experiencia", captureRate: "Captura de Pals", dropRate: "Recolección y botín", daySpeed: "Velocidad del día", nightSpeed: "Velocidad de la noche", hatchingTime: "Incubación de huevo enorme (horas)",
  gameplay: "Juego y funciones prácticas", deathPenalty: "Penalización al morir", deathNone: "Ninguna", deathItem: "Objetos", deathItemEquipment: "Objetos y equipo", deathAll: "Todo", invasions: "Eventos de invasión", fastTravel: "Viaje rápido", playerList: "Mostrar lista de jugadores", joinLeave: "Mensajes de entrada y salida", voiceChat: "Chat de voz", clientMods: "Permitir mods del cliente", backup: "Copias automáticas de partidas de Palworld", baseCamps: "Límite de bases por gremio", baseWorkers: "Pals trabajadores por base",
  save: "Guardar configuración con seguridad", saving: "Guardando configuración…", saved: "Configuración de Palworld guardada. Se aplicará en el próximo inicio.", portSelected: "Puerto libre {port} seleccionado.", restart: "Los cambios se aplican en el próximo inicio. Se crea automáticamente una copia del archivo anterior.",
};

const fr: Catalog = {
  title: "Paramètres du serveur Palworld", subtitle: "Modifiez les connexions, mots de passe, taux du monde et fonctions pratiques au même endroit.", stoppedOnly: "Arrêtez proprement le serveur avant de modifier les paramètres.",
  basic: "Informations et connexion", serverName: "Nom du serveur", description: "Description du serveur", gamePort: "Port de connexion au jeu (UDP)", restPort: "Port de gestion REST (TCP, local uniquement)", chooseFree: "Choisir un port libre", maxPlayers: "Nombre maximal de joueurs",
  access: "Mots de passe et sécurité", joinPassword: "Mot de passe de connexion", joinConfigured: "Configuré", joinNotConfigured: "Non configuré", joinPlaceholder: "Saisir uniquement pour modifier", clearJoin: "Supprimer le mot de passe", adminPassword: "Mot de passe administrateur", adminPlaceholder: "Saisir uniquement pour modifier", secretHelp: "Un champ vide conserve le mot de passe actuel. Les secrets ne sont jamais enregistrés dans la base de données ni les journaux.",
  balance: "Taux du monde", expRate: "Taux d’expérience", captureRate: "Taux de capture des Pals", dropRate: "Taux de collecte et de butin", daySpeed: "Vitesse du jour", nightSpeed: "Vitesse de la nuit", hatchingTime: "Incubation d’un œuf énorme (heures)",
  gameplay: "Jeu et fonctions pratiques", deathPenalty: "Pénalité de mort", deathNone: "Aucune", deathItem: "Objets", deathItemEquipment: "Objets et équipement", deathAll: "Tout", invasions: "Événements d’invasion", fastTravel: "Voyage rapide", playerList: "Afficher la liste des joueurs", joinLeave: "Messages d’arrivée et de départ", voiceChat: "Chat vocal", clientMods: "Autoriser les mods clients", backup: "Sauvegardes automatiques Palworld", baseCamps: "Limite de bases par guilde", baseWorkers: "Pals travailleurs par base",
  save: "Enregistrer les paramètres en sécurité", saving: "Enregistrement des paramètres…", saved: "Paramètres Palworld enregistrés. Ils s’appliqueront au prochain démarrage.", portSelected: "Port libre {port} sélectionné.", restart: "Les changements s’appliquent au prochain démarrage. L’ancien fichier est sauvegardé automatiquement.",
};

const ko: Catalog = {
  title: "Palworld 서버 설정", subtitle: "연결, 비밀번호, 월드 배율과 편의 기능을 한곳에서 변경합니다.", stoppedOnly: "설정을 변경하기 전에 서버를 안전하게 중지하세요.",
  basic: "기본 및 연결", serverName: "서버 이름", description: "서버 설명", gamePort: "게임 연결 포트(UDP)", restPort: "REST 관리 포트(TCP, 로컬 전용)", chooseFree: "빈 포트 선택", maxPlayers: "최대 플레이어 수",
  access: "비밀번호 및 안전", joinPassword: "참가 비밀번호", joinConfigured: "설정됨", joinNotConfigured: "설정 안 됨", joinPlaceholder: "변경할 때만 입력", clearJoin: "참가 비밀번호 제거", adminPassword: "관리자 비밀번호", adminPlaceholder: "변경할 때만 입력", secretHelp: "빈칸으로 저장하면 현재 비밀번호를 유지합니다. 비밀값은 데이터베이스나 로그에 저장하지 않습니다.",
  balance: "월드 배율", expRate: "경험치 배율", captureRate: "팰 포획 배율", dropRate: "채집 및 드롭 배율", daySpeed: "낮 속도", nightSpeed: "밤 속도", hatchingTime: "거대 알 부화 시간(시간)",
  gameplay: "게임 및 편의 기능", deathPenalty: "사망 페널티", deathNone: "없음", deathItem: "아이템", deathItemEquipment: "아이템과 장비", deathAll: "모두", invasions: "습격 이벤트", fastTravel: "빠른 이동", playerList: "플레이어 목록 표시", joinLeave: "참가 및 퇴장 메시지", voiceChat: "음성 채팅", clientMods: "클라이언트 모드 허용", backup: "Palworld 자동 저장 백업", baseCamps: "길드당 거점 한도", baseWorkers: "거점당 작업 팰 한도",
  save: "설정을 안전하게 저장", saving: "설정을 저장하는 중…", saved: "Palworld 설정을 저장했습니다. 다음 시작 때 적용됩니다.", portSelected: "빈 포트 {port}을(를) 선택했습니다.", restart: "변경 사항은 다음 시작 때 적용됩니다. 이전 설정 파일은 자동으로 백업됩니다.",
};

const ptBR: Catalog = {
  title: "Configurações do servidor Palworld", subtitle: "Altere conexões, senhas, taxas do mundo e recursos práticos em um só lugar.", stoppedOnly: "Pare o servidor com segurança antes de alterar as configurações.",
  basic: "Dados básicos e conexão", serverName: "Nome do servidor", description: "Descrição do servidor", gamePort: "Porta de conexão do jogo (UDP)", restPort: "Porta de gerenciamento REST (TCP, somente local)", chooseFree: "Escolher porta livre", maxPlayers: "Máximo de jogadores",
  access: "Senhas e segurança", joinPassword: "Senha de entrada", joinConfigured: "Configurada", joinNotConfigured: "Não configurada", joinPlaceholder: "Digite somente para alterar", clearJoin: "Remover senha de entrada", adminPassword: "Senha de administrador", adminPlaceholder: "Digite somente para alterar", secretHelp: "Um campo vazio mantém a senha atual. Segredos nunca são salvos no banco de dados nem nos registros.",
  balance: "Taxas do mundo", expRate: "Taxa de experiência", captureRate: "Taxa de captura de Pals", dropRate: "Taxa de coleta e itens", daySpeed: "Velocidade do dia", nightSpeed: "Velocidade da noite", hatchingTime: "Incubação de ovo enorme (horas)",
  gameplay: "Jogabilidade e recursos práticos", deathPenalty: "Penalidade de morte", deathNone: "Nenhuma", deathItem: "Itens", deathItemEquipment: "Itens e equipamentos", deathAll: "Tudo", invasions: "Eventos de invasão", fastTravel: "Viagem rápida", playerList: "Mostrar lista de jogadores", joinLeave: "Mensagens de entrada e saída", voiceChat: "Chat de voz", clientMods: "Permitir mods do cliente", backup: "Backups automáticos do Palworld", baseCamps: "Limite de bases por guilda", baseWorkers: "Pals trabalhadores por base",
  save: "Salvar configurações com segurança", saving: "Salvando configurações…", saved: "Configurações do Palworld salvas. Elas serão aplicadas na próxima inicialização.", portSelected: "Porta livre {port} selecionada.", restart: "As alterações valem na próxima inicialização. O arquivo anterior é salvo automaticamente.",
};

const zhCN: Catalog = {
  title: "Palworld 服务器设置", subtitle: "集中修改连接、密码、世界倍率和便利功能。", stoppedOnly: "更改设置前，请安全停止服务器。",
  basic: "基本信息和连接", serverName: "服务器名称", description: "服务器说明", gamePort: "游戏连接端口（UDP）", restPort: "REST 管理端口（TCP，仅限本机）", chooseFree: "选择空闲端口", maxPlayers: "最大玩家数",
  access: "密码和安全", joinPassword: "加入密码", joinConfigured: "已设置", joinNotConfigured: "未设置", joinPlaceholder: "仅在修改时输入", clearJoin: "移除加入密码", adminPassword: "管理员密码", adminPlaceholder: "仅在修改时输入", secretHelp: "留空会保留当前密码。秘密不会保存到数据库或日志中。",
  balance: "世界倍率", expRate: "经验倍率", captureRate: "帕鲁捕获倍率", dropRate: "采集和掉落倍率", daySpeed: "白天速度", nightSpeed: "夜晚速度", hatchingTime: "巨大蛋孵化时间（小时）",
  gameplay: "玩法和便利功能", deathPenalty: "死亡惩罚", deathNone: "无", deathItem: "物品", deathItemEquipment: "物品和装备", deathAll: "全部", invasions: "袭击事件", fastTravel: "快速旅行", playerList: "显示玩家列表", joinLeave: "加入和退出消息", voiceChat: "语音聊天", clientMods: "允许客户端 Mod", backup: "Palworld 自动存档备份", baseCamps: "每个公会的据点上限", baseWorkers: "每个据点的工作帕鲁上限",
  save: "安全保存设置", saving: "正在保存设置…", saved: "Palworld 设置已保存，将在下次启动时生效。", portSelected: "已选择空闲端口 {port}。", restart: "更改将在下次启动时生效。旧设置文件会自动备份。",
};

const zhTW: Catalog = {
  title: "Palworld 伺服器設定", subtitle: "集中修改連線、密碼、世界倍率與便利功能。", stoppedOnly: "變更設定前，請安全停止伺服器。",
  basic: "基本資訊與連線", serverName: "伺服器名稱", description: "伺服器說明", gamePort: "遊戲連線連接埠（UDP）", restPort: "REST 管理連接埠（TCP，僅限本機）", chooseFree: "選擇可用連接埠", maxPlayers: "玩家人數上限",
  access: "密碼與安全", joinPassword: "加入密碼", joinConfigured: "已設定", joinNotConfigured: "未設定", joinPlaceholder: "僅在變更時輸入", clearJoin: "移除加入密碼", adminPassword: "管理員密碼", adminPlaceholder: "僅在變更時輸入", secretHelp: "留空會保留目前密碼。秘密不會儲存到資料庫或記錄中。",
  balance: "世界倍率", expRate: "經驗倍率", captureRate: "帕魯捕獲倍率", dropRate: "採集與掉落倍率", daySpeed: "白天速度", nightSpeed: "夜晚速度", hatchingTime: "巨大蛋孵化時間（小時）",
  gameplay: "玩法與便利功能", deathPenalty: "死亡懲罰", deathNone: "無", deathItem: "物品", deathItemEquipment: "物品與裝備", deathAll: "全部", invasions: "襲擊事件", fastTravel: "快速旅行", playerList: "顯示玩家清單", joinLeave: "加入與離開訊息", voiceChat: "語音聊天", clientMods: "允許用戶端 Mod", backup: "Palworld 自動存檔備份", baseCamps: "每個公會的據點上限", baseWorkers: "每個據點的工作帕魯上限",
  save: "安全儲存設定", saving: "正在儲存設定…", saved: "Palworld 設定已儲存，將在下次啟動時生效。", portSelected: "已選擇可用連接埠 {port}。", restart: "變更將在下次啟動時生效。舊設定檔會自動備份。",
};

const catalogs: Record<AppLocale, Catalog> = { ja, en, de, es, fr, ko, "pt-BR": ptBR, "zh-CN": zhCN, "zh-TW": zhTW };

export function palworldSettingsText(locale: AppLocale, key: PalworldSettingsLocaleKey, values: Record<string, string | number> = {}) {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), catalogs[locale][key]);
}

export function getPalworldSettingsLocaleCatalog(locale: AppLocale) {
  return catalogs[locale];
}
