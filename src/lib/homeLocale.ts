import type { AppLocale } from "./i18n";

const labels = {
  ja: ["ホーム", "仲間とつくる、\nもっと広い世界。", "Minecraftも、Palworldも。あなたのサーバーから、次の冒険へ。", "マイサーバー", "遊び方を広げる", "サーバーを作る", "ゲームと構成を選んで、自分たちの遊び場を。", "プラグイン・Mod", "サーバーに合う拡張機能を探す。", "自動運用", "自動停止と通知を設定。", "友達と遊ぶ", "参加方法を確認して、仲間を招待しよう。"],
  en: ["Home", "Build together.\nExplore further.", "Minecraft and Palworld. Your next adventure starts on your server.", "My servers", "More ways to play", "Create a server", "Choose a game and make a place of your own.", "Plugins & Mods", "Find extensions for your server.", "Automatic operation", "Manage automatic shutdown and notifications.", "Play with friends", "Check connection details and invite your friends."],
  "zh-CN": ["主页", "与伙伴一起创造，\n探索更广阔的世界。", "Minecraft与Palworld。从你的服务器开启下一场冒险。", "我的服务器", "探索更多玩法", "创建服务器", "选择游戏和配置，打造自己的世界。", "插件与Mod", "寻找适合服务器的扩展。", "自动运行", "设置自动停止和通知。", "与朋友同玩", "查看连接方式，邀请伙伴。"],
  "zh-TW": ["首頁", "與夥伴一起創造，\n探索更廣闊的世界。", "Minecraft與Palworld。從你的伺服器開啟下一場冒險。", "我的伺服器", "探索更多玩法", "建立伺服器", "選擇遊戲與設定，打造自己的世界。", "外掛與Mod", "尋找適合伺服器的擴充功能。", "自動運作", "設定自動停止和通知。", "與朋友同玩", "查看連線方式，邀請夥伴。"],
  ko: ["홈", "함께 만들고,\n더 넓게 탐험하세요.", "Minecraft와 Palworld. 내 서버에서 시작하는 새로운 모험.", "내 서버", "더 다양한 플레이", "서버 만들기", "게임과 구성을 선택해 우리만의 공간을 만드세요.", "플러그인 · Mod", "서버에 맞는 확장 기능을 찾아보세요.", "자동 운영", "자동 종료와 알림을 설정하세요.", "친구와 플레이", "접속 방법을 확인하고 친구를 초대하세요."],
  es: ["Inicio", "Construye en equipo.\nExplora más lejos.", "Minecraft y Palworld. Tu próxima aventura empieza en tu servidor.", "Mis servidores", "Más formas de jugar", "Crear servidor", "Elige un juego y crea tu propio espacio.", "Plugins y Mods", "Encuentra extensiones para tu servidor.", "Operación automática", "Configura el apagado automático y las notificaciones.", "Juega con amigos", "Consulta la conexión e invita a tus amigos."],
  de: ["Start", "Gemeinsam bauen.\nMehr entdecken.", "Minecraft und Palworld. Dein nächstes Abenteuer beginnt auf deinem Server.", "Meine Server", "Mehr Spielmöglichkeiten", "Server erstellen", "Wähle ein Spiel und gestalte euren eigenen Ort.", "Plugins & Mods", "Finde Erweiterungen für deinen Server.", "Automatischer Betrieb", "Automatisches Stoppen und Benachrichtigungen einrichten.", "Mit Freunden spielen", "Verbindung prüfen und Freunde einladen."],
  fr: ["Accueil", "Construisez ensemble.\nExplorez plus loin.", "Minecraft et Palworld. Votre prochaine aventure commence sur votre serveur.", "Mes serveurs", "Plus de façons de jouer", "Créer un serveur", "Choisissez un jeu et créez votre propre espace.", "Plugins et Mods", "Trouvez des extensions pour votre serveur.", "Gestion automatique", "Configurez l’arrêt automatique et les notifications.", "Jouer entre amis", "Vérifiez la connexion et invitez vos amis."],
  "pt-BR": ["Início", "Construam juntos.\nExplorem mais longe.", "Minecraft e Palworld. Sua próxima aventura começa no seu servidor.", "Meus servidores", "Mais formas de jogar", "Criar servidor", "Escolha um jogo e crie seu próprio espaço.", "Plugins e Mods", "Encontre extensões para seu servidor.", "Operação automática", "Configure desligamento automático e notificações.", "Jogue com amigos", "Confira a conexão e convide seus amigos."],
} satisfies Record<AppLocale, readonly string[]>;

export function homeText(locale: AppLocale) {
  const [home, title, subtitle, servers, discover, create, createDetail, extensions, extensionsDetail, operations, operationsDetail, invite, inviteDetail] = labels[locale];
  return { home, title, subtitle, servers, discover, create, createDetail, extensions, extensionsDetail, operations, operationsDetail, invite, inviteDetail };
}
