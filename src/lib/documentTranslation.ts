import type { AppLocale } from "./i18n";
import { getTranslationCatalog } from "./translationCatalog";

const JAPANESE = /[\u3041-\u30fa\u3400-\u9fff]/;
const MARKER = /\[\[VAR\d+\]\]/g;
const TRANSLATED_ATTRIBUTES = ["aria-label", "title", "placeholder"] as const;
const EXCLUDED_SELECTOR = [
  "[data-no-translate]",
  "pre",
  "code",
].join(",");

const CURATED_EXACT: Partial<Record<AppLocale, Record<string, string>>> = {
  en: {
    "ビジター": "Visitor", "メンバー": "Member", "オペレーター": "Operator", "許可リストを有効にする": "Enable allowlist", "ホワイトリストを有効にする": "Enable whitelist", "ポート番号（UDP）": "Port number (UDP)", "ポート番号（TCP）": "Port number (TCP)", "空きを選ぶ": "Choose available port", "PvPを有効にする": "Enable PvP", "シングルプレイに近いワールド生成設定": "Single-player-style world generation",
    "キャンセル": "Cancel",
    "確認とEULA": "Review & EULA",
    "作成画面を閉じる": "Close server creation",
    "作成手順": "Creation steps",
    "このサーバー用の推奨値を再計算できます": "You can recalculate recommended settings for this server",
    "CPU・メモリ・Java・保存先の空き容量だけをPC内で確認します。結果は外部へ送信しません。": "Only CPU, memory, Java, and free storage space are checked on this PC. Results are not sent externally.",
    "サーバーの保存先": "Server storage location",
    "診断する保存先フォルダー": "Folder to check for storage space",
    "PCを診断中…": "Diagnosing this PC…",
    "このPCを診断": "Diagnose this PC",
    "もう一度診断": "Diagnose again",
    "今回は診断せずに次へ進むこともできます。作成後は概要画面から手動診断できます。": "You can continue without diagnosis this time. After creation, you can run it manually from Overview.",
    "検索・対応版・ダウンロードは公式Modrinth API/CDNだけを使用します。": "Search, compatibility data, and downloads use only the official Modrinth API and CDN.",
    "インポート": "Import",
    "難易度": "Difficulty",
    "スポーン保護範囲": "Spawn protection radius",
    "描画距離": "View distance",
    "大きなバイオーム": "Large biomes",
    "アンプリファイド": "Amplified",
    "ワールド生成のシード値": "World seed",
    "村や要塞などの構造物を生成する": "Generate structures such as villages and strongholds",
    "参加時の案内": "Join prompt",
    "サーバー停止中": "Server stopped",
    "オンライン": "Online",
    "安全停止でワールドを保存します": "The world is saved during safe shutdown.",
    "メモリ圧力": "Memory pressure",
    "ローカル応答": "Local response",
    "設定した上限に対する割合": "Percentage of the configured limit",
    "Javaプロセスの使用率": "Java process usage",
    "チャンク数はMinecraft共通APIがないため非表示": "Chunk count is hidden because Minecraft has no common API.",
    "ワールドフォルダーを開く": "Open world folder",
    "ログを検索": "Search logs", "保存": "Save", "送信": "Send",
    "サーバーコマンド": "Server command", "コマンドを入力（例: list）": "Enter a command (e.g. list)",
    "サーバーを起動するとコマンドを送信できます": "Start the server to send commands.",
    "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。": "Diagnostics run only on this PC. Results are not sent externally, and network speed tests are not run automatically.",
    "クリア": "Clear",
    "サーバーを起動すると、ここに最近のログが表示されます。": "Start the server to show recent logs here.",
    "一致するログはありません。": "No matching logs.",
    "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。": "Built-in packs included with the official BDS are hidden. Only added or applied packs are shown.",
    "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。": "No Bedrock add-ons have been added or applied. Packs bundled with the official BDS are excluded for safety.",
    "アプリ管理": "App managed", "外部追加（参照のみ）": "Added externally (read-only)", "保護中": "Protected",
    "XUID待ち・権限はまだ未反映": "Waiting for XUID; permission is not applied yet",
    "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。": "After the player joins once, confirm their XUID by selecting Register permission again.",
    "待機を取消": "Cancel pending",
    "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。": "After the player joins, the app confirms the XUID and applies operator permission automatically within about 3 seconds.",
    "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。": "The allowlist is saved to allowlist.json and permissions to permissions.json. Gamertags without a known XUID remain pending; register them again after they join once to confirm.",
    "このプレイヤーはXUID確認待ちとして登録済みです": "This player is already waiting for XUID confirmation.",
    "権限反映待ちの保存先が正しくありません": "The pending-permission storage path is invalid.",
    "公式BDS同梱または外部追加のパックは保護されています。アプリから追加したパックだけを無効化・削除できます": "Packs bundled with the official BDS or added externally are protected. Only packs added by this app can be disabled or deleted.",
    "と": " and ",
  },
  de: {
    "ビジター": "Besucher", "メンバー": "Mitglied", "オペレーター": "Operator", "許可リストを有効にする": "Allowlist aktivieren", "ホワイトリストを有効にする": "Whitelist aktivieren", "ポート番号（UDP）": "Portnummer (UDP)", "ポート番号（TCP）": "Portnummer (TCP)", "空きを選ぶ": "Freien Port wählen", "PvPを有効にする": "PvP aktivieren", "シングルプレイに近いワールド生成設定": "Weltgenerierung wie im Einzelspieler", "確認とEULA": "Prüfen & EULA",
    "キャンセル": "Abbrechen", "インポート": "Importieren", "難易度": "Schwierigkeitsgrad",
    "サーバー停止中": "Server gestoppt", "Javaプロセスの使用率": "Java-Prozessauslastung",
    "オンライン": "Online", "安全停止でワールドを保存します": "Beim sicheren Herunterfahren wird die Welt gespeichert.",
    "メモリ圧力": "Speicherdruck", "ローカル応答": "Lokale Antwort", "設定した上限に対する割合": "Anteil am festgelegten Limit",
    "チャンク数はMinecraft共通APIがないため非表示": "Die Chunk-Anzahl wird ausgeblendet, da Minecraft keine einheitliche API bietet.",
    "ワールドフォルダーを開く": "Weltordner öffnen", "ログを検索": "Protokolle durchsuchen", "保存": "Speichern", "送信": "Senden",
    "サーバーコマンド": "Serverbefehl", "コマンドを入力（例: list）": "Befehl eingeben (z. B. list)",
    "サーバーを起動するとコマンドを送信できます": "Starte den Server, um Befehle zu senden.", "クリア": "Leeren",
    "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。": "Die Diagnose wird nur auf diesem PC ausgeführt. Ergebnisse werden nicht extern gesendet und Netzwerkgeschwindigkeitstests werden nicht automatisch gestartet.",
    "サーバーを起動すると、ここに最近のログが表示されます。": "Starte den Server, damit hier die neuesten Protokolle angezeigt werden.",
    "一致するログはありません。": "Keine passenden Protokolle.", "と": " und ",
    "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。": "Integrierte Pakete des offiziellen BDS werden ausgeblendet. Nur hinzugefügte oder angewendete Pakete werden angezeigt.",
    "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。": "Es wurden keine Bedrock-Add-ons hinzugefügt oder angewendet. Mit dem offiziellen BDS gelieferte Pakete sind aus Sicherheitsgründen ausgeschlossen.",
    "アプリ管理": "Von der App verwaltet", "外部追加（参照のみ）": "Extern hinzugefügt (nur Lesen)", "保護中": "Geschützt",
    "XUID待ち・権限はまだ未反映": "XUID ausstehend; Berechtigung noch nicht angewendet", "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。": "Nachdem der Spieler einmal beigetreten ist, wählen Sie erneut „Berechtigung registrieren“, um die XUID zu bestätigen.", "待機を取消": "Ausstehend abbrechen",
    "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。": "Nach dem Beitritt wird die XUID innerhalb von etwa 3 Sekunden geprüft und die Operatorberechtigung automatisch angewendet.",
    "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。": "Die Zulassungsliste wird in allowlist.json und Berechtigungen in permissions.json gespeichert. Gamertags ohne bekannte XUID bleiben ausstehend; registrieren Sie sie nach dem ersten Beitritt erneut.",
  },
  es: {
    "ビジター": "Visitante", "メンバー": "Miembro", "オペレーター": "Operador", "許可リストを有効にする": "Activar lista de permitidos", "ホワイトリストを有効にする": "Activar lista blanca", "ポート番号（UDP）": "Número de puerto (UDP)", "ポート番号（TCP）": "Número de puerto (TCP)", "空きを選ぶ": "Elegir puerto libre", "PvPを有効にする": "Activar PvP", "シングルプレイに近いワールド生成設定": "Generación de mundo similar al modo individual", "確認とEULA": "Revisión y EULA",
    "キャンセル": "Cancelar", "インポート": "Importar", "難易度": "Dificultad",
    "サーバー停止中": "Servidor detenido", "Javaプロセスの使用率": "Uso del proceso Java",
    "オンライン": "En línea", "安全停止でワールドを保存します": "El mundo se guarda durante el apagado seguro.",
    "メモリ圧力": "Presión de memoria", "ローカル応答": "Respuesta local", "設定した上限に対する割合": "Porcentaje del límite configurado",
    "チャンク数はMinecraft共通APIがないため非表示": "El recuento de chunks se oculta porque Minecraft no tiene una API común.",
    "ワールドフォルダーを開く": "Abrir carpeta del mundo", "ログを検索": "Buscar registros", "保存": "Guardar", "送信": "Enviar",
    "サーバーコマンド": "Comando del servidor", "コマンドを入力（例: list）": "Introduce un comando (p. ej., list)",
    "サーバーを起動するとコマンドを送信できます": "Inicia el servidor para enviar comandos.", "クリア": "Limpiar",
    "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。": "El diagnóstico se ejecuta únicamente en este PC. Los resultados no se envían al exterior y las pruebas de velocidad de red no se ejecutan automáticamente.",
    "サーバーを起動すると、ここに最近のログが表示されます。": "Inicia el servidor para mostrar aquí los registros recientes.",
    "一致するログはありません。": "No hay registros que coincidan.", "と": " y ",
    "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。": "Los paquetes integrados del BDS oficial se ocultan. Solo se muestran los paquetes añadidos o aplicados.",
    "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。": "No hay complementos de Bedrock añadidos o aplicados. Los paquetes incluidos con el BDS oficial se excluyen por seguridad.",
    "アプリ管理": "Gestionado por la aplicación", "外部追加（参照のみ）": "Añadido externamente (solo lectura)", "保護中": "Protegido",
    "XUID待ち・権限はまだ未反映": "XUID pendiente; el permiso aún no se ha aplicado", "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。": "Cuando el jugador se haya unido una vez, vuelve a seleccionar «Registrar permiso» para confirmar su XUID.", "待機を取消": "Cancelar pendiente",
    "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。": "Después de unirse, la aplicación confirma el XUID y aplica automáticamente el permiso de operador en unos 3 segundos.",
    "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。": "La lista de permitidos se guarda en allowlist.json y los permisos en permissions.json. Los gamertags sin XUID quedan pendientes; regístralos de nuevo después de que se unan una vez.",
  },
  fr: {
    "ビジター": "Visiteur", "メンバー": "Membre", "オペレーター": "Opérateur", "許可リストを有効にする": "Activer la liste d’autorisation", "ホワイトリストを有効にする": "Activer la liste blanche", "ポート番号（UDP）": "Numéro de port (UDP)", "ポート番号（TCP）": "Numéro de port (TCP)", "空きを選ぶ": "Choisir un port libre", "PvPを有効にする": "Activer le PvP", "シングルプレイに近いワールド生成設定": "Génération du monde comme en solo", "確認とEULA": "Vérification et EULA",
    "キャンセル": "Annuler", "インポート": "Importer", "難易度": "Difficulté",
    "サーバー停止中": "Serveur arrêté", "Javaプロセスの使用率": "Utilisation du processus Java",
    "オンライン": "En ligne", "安全停止でワールドを保存します": "Le monde est enregistré lors de l’arrêt sécurisé.",
    "メモリ圧力": "Pression mémoire", "ローカル応答": "Réponse locale", "設定した上限に対する割合": "Pourcentage de la limite configurée",
    "チャンク数はMinecraft共通APIがないため非表示": "Le nombre de chunks est masqué, car Minecraft ne fournit pas d’API commune.",
    "ワールドフォルダーを開く": "Ouvrir le dossier du monde", "ログを検索": "Rechercher dans les journaux", "保存": "Enregistrer", "送信": "Envoyer",
    "サーバーコマンド": "Commande serveur", "コマンドを入力（例: list）": "Saisissez une commande (ex. : list)",
    "サーバーを起動するとコマンドを送信できます": "Démarrez le serveur pour envoyer des commandes.", "クリア": "Effacer",
    "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。": "Le diagnostic s’exécute uniquement sur ce PC. Les résultats ne sont pas envoyés à l’extérieur et les tests de débit réseau ne démarrent pas automatiquement.",
    "サーバーを起動すると、ここに最近のログが表示されます。": "Démarrez le serveur pour afficher ici les journaux récents.",
    "一致するログはありません。": "Aucun journal correspondant.", "と": " et ",
    "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。": "Les packs intégrés au BDS officiel sont masqués. Seuls les packs ajoutés ou appliqués sont affichés.",
    "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。": "Aucun module complémentaire Bedrock n’a été ajouté ou appliqué. Les packs fournis avec le BDS officiel sont exclus par sécurité.",
    "アプリ管理": "Géré par l’application", "外部追加（参照のみ）": "Ajouté en externe (lecture seule)", "保護中": "Protégé",
    "XUID待ち・権限はまだ未反映": "XUID en attente ; autorisation pas encore appliquée", "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。": "Après la première connexion du joueur, sélectionnez à nouveau « Enregistrer l’autorisation » pour confirmer son XUID.", "待機を取消": "Annuler l’attente",
    "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。": "Après la connexion, l’application confirme le XUID et applique automatiquement l’autorisation d’opérateur sous environ 3 secondes.",
    "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。": "La liste d’autorisation est enregistrée dans allowlist.json et les autorisations dans permissions.json. Les gamertags sans XUID restent en attente ; enregistrez-les à nouveau après leur première connexion.",
  },
  ko: {
    "ビジター": "방문자", "メンバー": "멤버", "オペレーター": "운영자", "許可リストを有効にする": "허용 목록 사용", "ホワイトリストを有効にする": "화이트리스트 사용", "ポート番号（UDP）": "포트 번호(UDP)", "ポート番号（TCP）": "포트 번호(TCP)", "空きを選ぶ": "사용 가능한 포트 선택", "PvPを有効にする": "PvP 사용", "シングルプレイに近いワールド生成設定": "싱글 플레이와 유사한 월드 생성", "確認とEULA": "확인 및 EULA",
    "キャンセル": "취소", "インポート": "가져오기", "難易度": "난이도",
    "サーバー停止中": "서버 중지됨", "Javaプロセスの使用率": "Java 프로세스 사용률",
    "オンライン": "온라인", "安全停止でワールドを保存します": "안전하게 중지하며 월드를 저장합니다.",
    "メモリ圧力": "메모리 압력", "ローカル応答": "로컬 응답", "設定した上限に対する割合": "설정한 상한 대비 비율",
    "チャンク数はMinecraft共通APIがないため非表示": "Minecraft 공통 API가 없어 청크 수를 표시하지 않습니다.",
    "ワールドフォルダーを開く": "월드 폴더 열기", "ログを検索": "로그 검색", "保存": "저장", "送信": "보내기",
    "サーバーコマンド": "서버 명령어", "コマンドを入力（例: list）": "명령어 입력 (예: list)",
    "サーバーを起動するとコマンドを送信できます": "서버를 시작하면 명령어를 보낼 수 있습니다.", "クリア": "지우기",
    "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。": "진단은 이 PC에서만 실행됩니다. 결과를 외부로 전송하지 않으며 네트워크 속도 테스트도 자동으로 실행하지 않습니다.",
    "サーバーを起動すると、ここに最近のログが表示されます。": "서버를 시작하면 여기에 최근 로그가 표시됩니다.",
    "一致するログはありません。": "일치하는 로그가 없습니다.", "と": " 및 ",
    "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。": "공식 BDS에 기본 포함된 팩은 숨기고 추가하거나 적용한 팩만 표시합니다.",
    "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。": "추가되거나 적용된 베드락 애드온이 없습니다. 공식 BDS 번들 팩은 안전을 위해 목록에서 제외됩니다.",
    "アプリ管理": "앱 관리", "外部追加（参照のみ）": "외부 추가(읽기 전용)", "保護中": "보호됨",
    "XUID待ち・権限はまだ未反映": "XUID 대기 중; 권한은 아직 적용되지 않음", "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。": "플레이어가 한 번 참가한 뒤 ‘권한 등록’을 다시 선택하여 XUID를 확인하세요.", "待機を取消": "대기 취소",
    "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。": "참가 후 약 3초 안에 XUID를 확인하고 운영자 권한을 자동으로 적용합니다.",
    "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。": "허용 목록은 allowlist.json에, 권한은 permissions.json에 저장됩니다. XUID가 없는 게이머태그는 대기 상태로 표시되며, 한 번 참가한 뒤 다시 등록하면 확정됩니다.",
  },
  "pt-BR": {
    "ビジター": "Visitante", "メンバー": "Membro", "オペレーター": "Operador", "許可リストを有効にする": "Ativar lista de permissões", "ホワイトリストを有効にする": "Ativar lista branca", "ポート番号（UDP）": "Número da porta (UDP)", "ポート番号（TCP）": "Número da porta (TCP)", "空きを選ぶ": "Escolher porta livre", "PvPを有効にする": "Ativar PvP", "シングルプレイに近いワールド生成設定": "Geração de mundo semelhante ao modo solo", "確認とEULA": "Revisão e EULA",
    "キャンセル": "Cancelar", "インポート": "Importar", "難易度": "Dificuldade",
    "サーバー停止中": "Servidor parado", "Javaプロセスの使用率": "Uso do processo Java",
    "オンライン": "Online", "安全停止でワールドを保存します": "O mundo é salvo durante a parada segura.",
    "メモリ圧力": "Pressão de memória", "ローカル応答": "Resposta local", "設定した上限に対する割合": "Percentual do limite configurado",
    "チャンク数はMinecraft共通APIがないため非表示": "A contagem de chunks fica oculta porque o Minecraft não possui uma API comum.",
    "ワールドフォルダーを開く": "Abrir pasta do mundo", "ログを検索": "Pesquisar logs", "保存": "Salvar", "送信": "Enviar",
    "サーバーコマンド": "Comando do servidor", "コマンドを入力（例: list）": "Insira um comando (ex.: list)",
    "サーバーを起動するとコマンドを送信できます": "Inicie o servidor para enviar comandos.", "クリア": "Limpar",
    "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。": "O diagnóstico é executado somente neste PC. Os resultados não são enviados para fora e os testes de velocidade da rede não são iniciados automaticamente.",
    "サーバーを起動すると、ここに最近のログが表示されます。": "Inicie o servidor para exibir os logs recentes aqui.",
    "一致するログはありません。": "Nenhum log correspondente.", "と": " e ",
    "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。": "Os pacotes integrados do BDS oficial ficam ocultos. Somente pacotes adicionados ou aplicados são exibidos.",
    "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。": "Nenhum complemento Bedrock foi adicionado ou aplicado. Os pacotes incluídos no BDS oficial são excluídos por segurança.",
    "アプリ管理": "Gerenciado pelo aplicativo", "外部追加（参照のみ）": "Adicionado externamente (somente leitura)", "保護中": "Protegido",
    "XUID待ち・権限はまだ未反映": "XUID pendente; permissão ainda não aplicada", "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。": "Depois que o jogador entrar uma vez, selecione “Registrar permissão” novamente para confirmar o XUID.", "待機を取消": "Cancelar pendência",
    "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。": "Após o jogador entrar, o aplicativo confirma o XUID e aplica automaticamente a permissão de operador em cerca de 3 segundos.",
    "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。": "A lista de permissões é salva em allowlist.json e as permissões em permissions.json. Gamertags sem XUID ficam pendentes; registre-os novamente após a primeira entrada.",
  },
  "zh-CN": {
    "ビジター": "访客", "メンバー": "成员", "オペレーター": "操作员", "許可リストを有効にする": "启用允许列表", "ホワイトリストを有効にする": "启用白名单", "ポート番号（UDP）": "端口号（UDP）", "ポート番号（TCP）": "端口号（TCP）", "空きを選ぶ": "选择可用端口", "PvPを有効にする": "启用 PvP", "シングルプレイに近いワールド生成設定": "类似单人游戏的世界生成", "確認とEULA": "检查与 EULA",
    "キャンセル": "取消", "インポート": "导入", "難易度": "难度",
    "サーバー停止中": "服务器已停止", "Javaプロセスの使用率": "Java 进程使用率",
    "オンライン": "在线", "安全停止でワールドを保存します": "安全停止时会保存世界。",
    "メモリ圧力": "内存压力", "ローカル応答": "本地响应", "設定した上限に対する割合": "占已配置上限的百分比",
    "チャンク数はMinecraft共通APIがないため非表示": "由于 Minecraft 没有通用 API，因此不显示区块数量。",
    "ワールドフォルダーを開く": "打开世界文件夹", "ログを検索": "搜索日志", "保存": "保存", "送信": "发送",
    "サーバーコマンド": "服务器命令", "コマンドを入力（例: list）": "输入命令（例如：list）",
    "サーバーを起動するとコマンドを送信できます": "启动服务器后即可发送命令。", "クリア": "清空",
    "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。": "诊断仅在此电脑上运行。结果不会发送到外部，也不会自动运行网络测速。",
    "サーバーを起動すると、ここに最近のログが表示されます。": "启动服务器后，最近日志会显示在这里。",
    "一致するログはありません。": "没有匹配的日志。", "と": "和",
    "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。": "隐藏官方 BDS 自带的内置包，仅显示已添加或已应用的包。",
    "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。": "没有已添加或已应用的基岩版附加包。为安全起见，官方 BDS 自带包不列入列表。",
    "アプリ管理": "应用管理", "外部追加（参照のみ）": "外部添加（只读）", "保護中": "受保护",
    "XUID待ち・権限はまだ未反映": "等待 XUID；权限尚未应用", "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。": "玩家加入一次后，再次选择“注册权限”以确认其 XUID。", "待機を取消": "取消等待",
    "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。": "玩家加入后，应用会在约 3 秒内确认 XUID 并自动应用操作员权限。",
    "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。": "允许列表保存在 allowlist.json，权限保存在 permissions.json。尚无 XUID 的玩家名称会保持等待状态；玩家加入一次后再次注册即可确认。",
  },
  "zh-TW": {
    "ビジター": "訪客", "メンバー": "成員", "オペレーター": "操作員", "許可リストを有効にする": "啟用允許清單", "ホワイトリストを有効にする": "啟用白名單", "ポート番号（UDP）": "連接埠號碼（UDP）", "ポート番号（TCP）": "連接埠號碼（TCP）", "空きを選ぶ": "選擇可用連接埠", "PvPを有効にする": "啟用 PvP", "シングルプレイに近いワールド生成設定": "類似單人遊戲的世界生成", "確認とEULA": "檢查與 EULA",
    "キャンセル": "取消", "インポート": "匯入", "難易度": "難度",
    "サーバー停止中": "伺服器已停止", "Javaプロセスの使用率": "Java 處理程序使用率",
    "オンライン": "線上", "安全停止でワールドを保存します": "安全停止時會儲存世界。",
    "メモリ圧力": "記憶體壓力", "ローカル応答": "本機回應", "設定した上限に対する割合": "佔已設定上限的百分比",
    "チャンク数はMinecraft共通APIがないため非表示": "由於 Minecraft 沒有通用 API，因此不顯示區塊數量。",
    "ワールドフォルダーを開く": "開啟世界資料夾", "ログを検索": "搜尋日誌", "保存": "儲存", "送信": "傳送",
    "サーバーコマンド": "伺服器指令", "コマンドを入力（例: list）": "輸入指令（例如：list）",
    "サーバーを起動するとコマンドを送信できます": "啟動伺服器後即可傳送指令。", "クリア": "清除",
    "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。": "診斷只會在此電腦上執行。結果不會傳送到外部，也不會自動執行網路測速。",
    "サーバーを起動すると、ここに最近のログが表示されます。": "啟動伺服器後，最近日誌會顯示在這裡。",
    "一致するログはありません。": "沒有符合的日誌。", "と": "與",
    "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。": "隱藏官方 BDS 內建套件，只顯示已新增或已套用的套件。",
    "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。": "沒有已新增或已套用的基岩版附加內容。為安全起見，官方 BDS 隨附套件不列入清單。",
    "アプリ管理": "應用程式管理", "外部追加（参照のみ）": "外部新增（唯讀）", "保護中": "受保護",
    "XUID待ち・権限はまだ未反映": "等待 XUID；權限尚未套用", "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。": "玩家加入一次後，再次選擇「登錄權限」以確認其 XUID。", "待機を取消": "取消等待",
    "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。": "玩家加入後，應用程式會在約 3 秒內確認 XUID 並自動套用操作員權限。",
    "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。": "允許清單儲存在 allowlist.json，權限儲存在 permissions.json。尚無 XUID 的玩家名稱會保持等待狀態；玩家加入一次後再次登錄即可確認。",
  },
};

// Technical terms in Server Lab need deliberate translations. Generic machine
// translation tends to interpret Minecraft "ports", "chunks", and "seeds" as
// harbours, pieces, and agriculture.
const SERVER_LAB_EXACT: Partial<Record<AppLocale, Record<string, string>>> = {
  en: {
    "サーバーラボ": "Server Lab",
    "遊び方プリセット": "Game-mode presets",
    "性能プリセット": "Performance presets",
    "人数・メモリプランナー": "Player & memory planner",
    "チャンク・保護範囲の推定": "Chunk & spawn-protection estimate",
    "ワールドシード生成": "World seed generator",
    "ポート検査と提案": "Port check & suggestion",
    "公開前セキュリティ監査": "Pre-publish security audit",
    "未保存の変更差分": "Unsaved changes",
    "server.properties変更案": "server.properties change proposal",
    "バックアップして全変更を保存": "Back up & save all changes",
  },
  de: {
    "サーバーラボ": "Serverlabor",
    "遊び方プリセット": "Spielstil-Voreinstellungen",
    "性能プリセット": "Leistungsvoreinstellungen",
    "人数・メモリプランナー": "Spieler- und Arbeitsspeicherplaner",
    "チャンク・保護範囲の推定": "Chunk- und Spawnschutz-Schätzung",
    "ワールドシード生成": "Welt-Seed-Generator",
    "ポート検査と提案": "Portprüfung und -vorschlag",
    "公開前セキュリティ監査": "Sicherheitsprüfung vor der Freigabe",
    "未保存の変更差分": "Ungespeicherte Änderungen",
    "server.properties変更案": "server.properties-Änderungsvorschlag",
    "バックアップして全変更を保存": "Sicherung erstellen und alle Änderungen speichern",
  },
  es: {
    "サーバーラボ": "Laboratorio del servidor",
    "遊び方プリセット": "Preajustes de juego",
    "性能プリセット": "Preajustes de rendimiento",
    "人数・メモリプランナー": "Planificador de jugadores y memoria",
    "チャンク・保護範囲の推定": "Estimación de chunks y protección del spawn",
    "ワールドシード生成": "Generador de semilla del mundo",
    "ポート検査と提案": "Comprobación y sugerencia de puerto",
    "公開前セキュリティ監査": "Auditoría de seguridad antes de publicar",
    "未保存の変更差分": "Cambios sin guardar",
    "server.properties変更案": "Propuesta de cambios de server.properties",
    "バックアップして全変更を保存": "Crear copia y guardar todos los cambios",
  },
  fr: {
    "サーバーラボ": "Laboratoire serveur",
    "遊び方プリセット": "Préréglages de jeu",
    "性能プリセット": "Préréglages de performances",
    "人数・メモリプランナー": "Planificateur de joueurs et de mémoire",
    "チャンク・保護範囲の推定": "Estimation des chunks et de la protection du spawn",
    "ワールドシード生成": "Générateur de graine du monde",
    "ポート検査と提案": "Vérification et suggestion de port",
    "公開前セキュリティ監査": "Audit de sécurité avant publication",
    "未保存の変更差分": "Modifications non enregistrées",
    "server.properties変更案": "Proposition de modification de server.properties",
    "バックアップして全変更を保存": "Sauvegarder et enregistrer toutes les modifications",
  },
  ko: {
    "サーバーラボ": "서버 랩",
    "遊び方プリセット": "플레이 방식 프리셋",
    "性能プリセット": "성능 프리셋",
    "人数・メモリプランナー": "플레이어 및 메모리 플래너",
    "チャンク・保護範囲の推定": "청크 및 스폰 보호 범위 추정",
    "ワールドシード生成": "월드 시드 생성기",
    "ポート検査と提案": "포트 검사 및 제안",
    "公開前セキュリティ監査": "공개 전 보안 점검",
    "未保存の変更差分": "저장되지 않은 변경 사항",
    "server.properties変更案": "server.properties 변경 제안",
    "バックアップして全変更を保存": "백업 후 모든 변경 사항 저장",
  },
  "pt-BR": {
    "サーバーラボ": "Laboratório do servidor",
    "遊び方プリセット": "Predefinições de jogo",
    "性能プリセット": "Predefinições de desempenho",
    "人数・メモリプランナー": "Planejador de jogadores e memória",
    "チャンク・保護範囲の推定": "Estimativa de chunks e proteção do spawn",
    "ワールドシード生成": "Gerador de semente do mundo",
    "ポート検査と提案": "Verificação e sugestão de porta",
    "公開前セキュリティ監査": "Auditoria de segurança antes da publicação",
    "未保存の変更差分": "Alterações não salvas",
    "server.properties変更案": "Proposta de alteração de server.properties",
    "バックアップして全変更を保存": "Fazer backup e salvar todas as alterações",
  },
  "zh-CN": {
    "サーバーラボ": "服务器实验室",
    "遊び方プリセット": "玩法预设",
    "性能プリセット": "性能预设",
    "人数・メモリプランナー": "玩家人数与内存规划器",
    "チャンク・保護範囲の推定": "区块与出生点保护范围估算",
    "ワールドシード生成": "世界种子生成器",
    "ポート検査と提案": "端口检查与建议",
    "公開前セキュリティ監査": "公开前安全检查",
    "未保存の変更差分": "未保存的更改",
    "server.properties変更案": "server.properties 更改建议",
    "バックアップして全変更を保存": "备份并保存所有更改",
  },
  "zh-TW": {
    "サーバーラボ": "伺服器實驗室",
    "遊び方プリセット": "玩法預設",
    "性能プリセット": "效能預設",
    "人数・メモリプランナー": "玩家人數與記憶體規劃器",
    "チャンク・保護範囲の推定": "區塊與出生點保護範圍估算",
    "ワールドシード生成": "世界種子產生器",
    "ポート検査と提案": "連接埠檢查與建議",
    "公開前セキュリティ監査": "公開前安全檢查",
    "未保存の変更差分": "未儲存的變更",
    "server.properties変更案": "server.properties 變更建議",
    "バックアップして全変更を保存": "備份並儲存所有變更",
  },
};

const CURATED_PATTERNS: Partial<Record<AppLocale, Record<string, string>>> = {
  en: {
    "確認のため「[[VAR0]]」と入力": "For confirmation, enter \"[[VAR0]]\"",
    "人気の[[VAR0]]": "Popular [[VAR0]]",
    "[[VAR0]]を探して導入": "Find and install [[VAR0]]",
    "人気の[[VAR0]]を読み込んでいます": "Loading popular [[VAR0]]…",
    "[[VAR0]] / [[VAR1]] 対応 · ダウンロード数順": "[[VAR0]] / [[VAR1]] compatible · Sorted by downloads",
    "追加済みの[[VAR0]]はありません。": "No [[VAR0]] installed.",
    "[[VAR0]] / [[VAR1]] に合う項目だけを表示します": "Show only items compatible with [[VAR0]] / [[VAR1]]",
    "このサーバー構成に合う[[VAR0]]は見つかりませんでした。": "No compatible [[VAR0]] was found for this server.",
    "Java [[VAR0]]以上が必要です。現在はJava [[VAR1]]です": "Java [[VAR0]] or later is required. Current version: Java [[VAR1]].",
    "バックアップ先の空き容量が不足しています。少なくとも約[[VAR0]] MiB必要です": "The backup destination does not have enough free space. At least about [[VAR0]] MiB is required.",
  },
  de: {
    "確認のため「[[VAR0]]」と入力": "Geben Sie zur Bestätigung \"[[VAR0]]\" ein",
    "Java [[VAR0]]以上が必要です。現在はJava [[VAR1]]です": "Java [[VAR0]] oder neuer ist erforderlich. Aktuell ist Java [[VAR1]] ausgewählt.",
    "バックアップ先の空き容量が不足しています。少なくとも約[[VAR0]] MiB必要です": "Am Sicherungsziel ist nicht genügend Speicherplatz frei. Mindestens etwa [[VAR0]] MiB sind erforderlich.",
  },
  es: {
    "確認のため「[[VAR0]]」と入力": "Para confirmar, escribe \"[[VAR0]]\"",
    "Java [[VAR0]]以上が必要です。現在はJava [[VAR1]]です": "Se requiere Java [[VAR0]] o posterior. Actualmente está seleccionado Java [[VAR1]].",
    "バックアップ先の空き容量が不足しています。少なくとも約[[VAR0]] MiB必要です": "El destino de la copia de seguridad no tiene suficiente espacio libre. Se requieren al menos unos [[VAR0]] MiB.",
  },
  fr: {
    "確認のため「[[VAR0]]」と入力": "Pour confirmer, saisissez \"[[VAR0]]\"",
    "Java [[VAR0]]以上が必要です。現在はJava [[VAR1]]です": "Java [[VAR0]] ou version ultérieure est requis. Java [[VAR1]] est actuellement sélectionné.",
    "バックアップ先の空き容量が不足しています。少なくとも約[[VAR0]] MiB必要です": "L’emplacement de sauvegarde ne dispose pas d’assez d’espace libre. Environ [[VAR0]] Mio au minimum sont nécessaires.",
  },
  ko: {
    "確認のため「[[VAR0]]」と入力": "확인을 위해 \"[[VAR0]]\"를 입력하세요",
    "Java [[VAR0]]以上が必要です。現在はJava [[VAR1]]です": "Java [[VAR0]] 이상이 필요합니다. 현재 Java [[VAR1]]이 선택되어 있습니다.",
    "バックアップ先の空き容量が不足しています。少なくとも約[[VAR0]] MiB必要です": "백업 위치의 여유 공간이 부족합니다. 최소 약 [[VAR0]] MiB가 필요합니다.",
  },
  "pt-BR": {
    "確認のため「[[VAR0]]」と入力": "Para confirmar, digite \"[[VAR0]]\"",
    "Java [[VAR0]]以上が必要です。現在はJava [[VAR1]]です": "É necessário Java [[VAR0]] ou posterior. Atualmente, o Java [[VAR1]] está selecionado.",
    "バックアップ先の空き容量が不足しています。少なくとも約[[VAR0]] MiB必要です": "O destino do backup não tem espaço livre suficiente. São necessários pelo menos cerca de [[VAR0]] MiB.",
  },
  "zh-CN": {
    "確認のため「[[VAR0]]」と入力": "请输入“[[VAR0]]”以确认",
    "Java [[VAR0]]以上が必要です。現在はJava [[VAR1]]です": "需要 Java [[VAR0]] 或更高版本。当前选择的是 Java [[VAR1]]。",
    "バックアップ先の空き容量が不足しています。少なくとも約[[VAR0]] MiB必要です": "备份位置的可用空间不足。至少需要约 [[VAR0]] MiB。",
  },
  "zh-TW": {
    "確認のため「[[VAR0]]」と入力": "請輸入「[[VAR0]]」以確認",
    "Java [[VAR0]]以上が必要です。現在はJava [[VAR1]]です": "需要 Java [[VAR0]] 或更新版本。目前選擇的是 Java [[VAR1]]。",
    "バックアップ先の空き容量が不足しています。少なくとも約[[VAR0]] MiB必要です": "備份位置的可用空間不足。至少需要約 [[VAR0]] MiB。",
  },
};

const MEMORY_HELP_EXACT: Partial<Record<AppLocale, Record<string, string>>> = {
  en: { "1〜16 GiBから選べるJava起動設定": "Java launch memory selectable from 1 to 16 GiB" },
  de: { "1〜16 GiBから選べるJava起動設定": "Java-Startspeicher von 1 bis 16 GiB auswählbar" },
  es: { "1〜16 GiBから選べるJava起動設定": "Memoria de inicio de Java seleccionable de 1 a 16 GiB" },
  fr: { "1〜16 GiBから選べるJava起動設定": "Mémoire de lancement Java réglable de 1 à 16 Gio" },
  ko: { "1〜16 GiBから選べるJava起動設定": "1~16 GiB에서 선택할 수 있는 Java 실행 메모리" },
  "pt-BR": { "1〜16 GiBから選べるJava起動設定": "Memória de inicialização do Java selecionável de 1 a 16 GiB" },
  "zh-CN": { "1〜16 GiBから選べるJava起動設定": "可选择 1 到 16 GiB 的 Java 启动内存" },
  "zh-TW": { "1〜16 GiBから選べるJava起動設定": "可選擇 1 到 16 GiB 的 Java 啟動記憶體" },
};

const PLAYER_STATUS_EXACT: Partial<Record<AppLocale, Record<string, string>>> = {
  en: { "現在参加しているプレイヤー": "Players online now", "Java版またはGeyser経由のプレイヤー": "Java player or player connected through Geyser", "現在参加しているプレイヤーはいません。": "No players are currently online.", "サーバー起動後に参加中のプレイヤーが表示されます。": "Online players will appear after the server starts." },
  de: { "現在参加しているプレイヤー": "Derzeit verbundene Spieler", "Java版またはGeyser経由のプレイヤー": "Java-Spieler oder über Geyser verbunden", "現在参加しているプレイヤーはいません。": "Derzeit sind keine Spieler verbunden.", "サーバー起動後に参加中のプレイヤーが表示されます。": "Verbundene Spieler werden nach dem Serverstart angezeigt." },
  es: { "現在参加しているプレイヤー": "Jugadores conectados ahora", "Java版またはGeyser経由のプレイヤー": "Jugador de Java o conectado mediante Geyser", "現在参加しているプレイヤーはいません。": "No hay jugadores conectados ahora.", "サーバー起動後に参加中のプレイヤーが表示されます。": "Los jugadores conectados aparecerán después de iniciar el servidor." },
  fr: { "現在参加しているプレイヤー": "Joueurs actuellement connectés", "Java版またはGeyser経由のプレイヤー": "Joueur Java ou connecté via Geyser", "現在参加しているプレイヤーはいません。": "Aucun joueur n’est actuellement connecté.", "サーバー起動後に参加中のプレイヤーが表示されます。": "Les joueurs connectés apparaîtront après le démarrage du serveur." },
  ko: { "現在参加しているプレイヤー": "현재 접속 중인 플레이어", "Java版またはGeyser経由のプレイヤー": "Java 플레이어 또는 Geyser를 통해 접속한 플레이어", "現在参加しているプレイヤーはいません。": "현재 접속 중인 플레이어가 없습니다.", "サーバー起動後に参加中のプレイヤーが表示されます。": "서버를 시작하면 접속 중인 플레이어가 표시됩니다." },
  "pt-BR": { "現在参加しているプレイヤー": "Jogadores conectados agora", "Java版またはGeyser経由のプレイヤー": "Jogador Java ou conectado pelo Geyser", "現在参加しているプレイヤーはいません。": "Nenhum jogador está conectado agora.", "サーバー起動後に参加中のプレイヤーが表示されます。": "Os jogadores conectados aparecerão após iniciar o servidor." },
  "zh-CN": { "現在参加しているプレイヤー": "当前在线玩家", "Java版またはGeyser経由のプレイヤー": "Java 版玩家或通过 Geyser 连接的玩家", "現在参加しているプレイヤーはいません。": "当前没有在线玩家。", "サーバー起動後に参加中のプレイヤーが表示されます。": "服务器启动后会显示在线玩家。" },
  "zh-TW": { "現在参加しているプレイヤー": "目前線上玩家", "Java版またはGeyser経由のプレイヤー": "Java 版玩家或透過 Geyser 連線的玩家", "現在参加しているプレイヤーはいません。": "目前沒有線上玩家。", "サーバー起動後に参加中のプレイヤーが表示されます。": "伺服器啟動後會顯示線上玩家。" },
};

const CROSSPLAY_ACCESS_EXACT: Partial<Record<AppLocale, Record<string, string>>> = {
  en: { "統合版ホワイトリスト": "Bedrock whitelist", "Geyser／Floodgateから参加するプレイヤー": "Players joining through Geyser / Floodgate", "統合版プレイヤーを追加": "Add Bedrock player", "Xboxゲーマータグ（接頭辞は不要）": "Xbox gamertag (no prefix needed)", "Xboxゲーマータグ": "Xbox gamertag", "Floodgate専用": "Floodgate only", "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。": "Uses the official fwhitelist command. Enter the Xbox gamertag without the configured prefix. Floodgate must be installed before adding players.", "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。": "Only players whose Floodgate UUID can be confirmed through the official GeyserMC profile service are safely saved to whitelist.json. If confirmation fails, start the server and try again." },
  de: { "統合版ホワイトリスト": "Bedrock-Whitelist", "Geyser／Floodgateから参加するプレイヤー": "Spieler über Geyser / Floodgate", "統合版プレイヤーを追加": "Bedrock-Spieler hinzufügen", "Xboxゲーマータグ（接頭辞は不要）": "Xbox-Gamertag (kein Präfix nötig)", "Xboxゲーマータグ": "Xbox-Gamertag", "Floodgate専用": "Nur Floodgate", "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。": "Verwendet den offiziellen Befehl fwhitelist. Gib den Xbox-Gamertag ohne das konfigurierte Präfix ein. Floodgate muss installiert sein.", "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。": "Nur Spieler mit einer über den offiziellen GeyserMC-Profildienst bestätigten Floodgate-UUID werden sicher in whitelist.json gespeichert. Starte andernfalls den Server und versuche es erneut." },
  es: { "統合版ホワイトリスト": "Lista blanca de Bedrock", "Geyser／Floodgateから参加するプレイヤー": "Jugadores que entran mediante Geyser / Floodgate", "統合版プレイヤーを追加": "Añadir jugador de Bedrock", "Xboxゲーマータグ（接頭辞は不要）": "Gamertag de Xbox (sin prefijo)", "Xboxゲーマータグ": "Gamertag de Xbox", "Floodgate専用": "Solo Floodgate", "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。": "Usa el comando oficial fwhitelist. Introduce el gamertag de Xbox sin el prefijo configurado. Floodgate debe estar instalado.", "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。": "Solo se guardan en whitelist.json los jugadores cuyo UUID de Floodgate pueda confirmarse mediante el servicio oficial de perfiles de GeyserMC. Si falla, inicia el servidor e inténtalo de nuevo." },
  fr: { "統合版ホワイトリスト": "Liste blanche Bedrock", "Geyser／Floodgateから参加するプレイヤー": "Joueurs via Geyser / Floodgate", "統合版プレイヤーを追加": "Ajouter un joueur Bedrock", "Xboxゲーマータグ（接頭辞は不要）": "Gamertag Xbox (sans préfixe)", "Xboxゲーマータグ": "Gamertag Xbox", "Floodgate専用": "Floodgate uniquement", "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。": "Utilise la commande officielle fwhitelist. Saisissez le gamertag Xbox sans le préfixe configuré. Floodgate doit être installé.", "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。": "Seuls les joueurs dont l’UUID Floodgate est confirmé par le service de profils officiel GeyserMC sont enregistrés dans whitelist.json. Sinon, démarrez le serveur et réessayez." },
  ko: { "統合版ホワイトリスト": "베드락 화이트리스트", "Geyser／Floodgateから参加するプレイヤー": "Geyser / Floodgate로 접속하는 플레이어", "統合版プレイヤーを追加": "베드락 플레이어 추가", "Xboxゲーマータグ（接頭辞は不要）": "Xbox 게이머태그(접두사 불필요)", "Xboxゲーマータグ": "Xbox 게이머태그", "Floodgate専用": "Floodgate 전용", "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。": "공식 fwhitelist 명령을 사용합니다. 설정된 접두사 없이 Xbox 게이머태그를 입력하세요. 플레이어를 추가하려면 Floodgate가 필요합니다.", "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。": "GeyserMC 공식 프로필 서비스에서 Floodgate UUID가 확인된 플레이어만 whitelist.json에 안전하게 저장합니다. 확인되지 않으면 서버를 시작한 뒤 다시 시도하세요." },
  "pt-BR": { "統合版ホワイトリスト": "Lista de permissões Bedrock", "Geyser／Floodgateから参加するプレイヤー": "Jogadores que entram pelo Geyser / Floodgate", "統合版プレイヤーを追加": "Adicionar jogador Bedrock", "Xboxゲーマータグ（接頭辞は不要）": "Gamertag do Xbox (sem prefixo)", "Xboxゲーマータグ": "Gamertag do Xbox", "Floodgate専用": "Somente Floodgate", "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。": "Usa o comando oficial fwhitelist. Digite o gamertag do Xbox sem o prefixo configurado. O Floodgate precisa estar instalado.", "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。": "Somente jogadores com UUID Floodgate confirmado pelo serviço oficial de perfis do GeyserMC são salvos com segurança no whitelist.json. Se falhar, inicie o servidor e tente novamente." },
  "zh-CN": { "統合版ホワイトリスト": "基岩版白名单", "Geyser／Floodgateから参加するプレイヤー": "通过 Geyser / Floodgate 加入的玩家", "統合版プレイヤーを追加": "添加基岩版玩家", "Xboxゲーマータグ（接頭辞は不要）": "Xbox 玩家代号（无需前缀）", "Xboxゲーマータグ": "Xbox 玩家代号", "Floodgate専用": "仅限 Floodgate", "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。": "使用官方 fwhitelist 命令。请输入不带配置前缀的 Xbox 玩家代号。添加玩家前必须安装 Floodgate。", "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。": "只有能通过 GeyserMC 官方档案服务确认 Floodgate UUID 的玩家才会安全保存到 whitelist.json。若无法确认，请启动服务器后重试。" },
  "zh-TW": { "統合版ホワイトリスト": "基岩版白名單", "Geyser／Floodgateから参加するプレイヤー": "透過 Geyser / Floodgate 加入的玩家", "統合版プレイヤーを追加": "新增基岩版玩家", "Xboxゲーマータグ（接頭辞は不要）": "Xbox 玩家代號（不需前綴）", "Xboxゲーマータグ": "Xbox 玩家代號", "Floodgate専用": "僅限 Floodgate", "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。": "使用官方 fwhitelist 指令。請輸入不含設定前綴的 Xbox 玩家代號。新增玩家前必須安裝 Floodgate。", "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。": "只有可透過 GeyserMC 官方個人資料服務確認 Floodgate UUID 的玩家才會安全儲存到 whitelist.json。若無法確認，請啟動伺服器後重試。" },
};

const FIXED_MEMBER_EXACT: Partial<Record<AppLocale, Record<string, string>>> = {
  en: { "統合版専用のいつものメンバー": "Regular Bedrock players" },
  de: { "統合版専用のいつものメンバー": "Regelmäßige Bedrock-Spieler" },
  es: { "統合版専用のいつものメンバー": "Jugadores habituales de Bedrock" },
  fr: { "統合版専用のいつものメンバー": "Joueurs Bedrock habituels" },
  ko: { "統合版専用のいつものメンバー": "베드락 전용 고정 멤버" },
  "pt-BR": { "統合版専用のいつものメンバー": "Jogadores Bedrock frequentes" },
  "zh-CN": { "統合版専用のいつものメンバー": "常用基岩版成员" },
  "zh-TW": { "統合版専用のいつものメンバー": "常用基岩版成員" },
};

const BEDROCK_ENDPOINT_EXACT: Partial<Record<AppLocale, Record<string, string>>> = {
  en: {
    "統合版の友達が入力する内容": "What your Bedrock friend should enter",
    "Minecraft統合版では、アドレスとポートを別々に入力します": "In Minecraft Bedrock, enter the address and port separately",
    "サーバーアドレス": "Server Address",
    "サーバーポート": "Server Port",
    "アドレスをコピー": "Copy address",
    "ポートをコピー": "Copy port",
    "未取得": "Not available",
    "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。": "Do not leave the Java port 25565 in Bedrock's Server Port field. Enter the Bedrock port shown above.",
    "「プレイ」を開く": "Open Play",
    "「サーバー」→「サーバーを追加」を選ぶ": "Select Servers, then Add Server",
    "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する": "Enter the Server Address and Server Port shown above in their matching fields",
    "公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。": "The port could not be separated from the public endpoint. Check the Minecraft Bedrock / UDP settings in playit.gg.",
    "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。": "Java Edition friends should use the usual Java address, not the values shown here.",
  },
  de: {
    "統合版の友達が入力する内容": "Eingaben für deinen Bedrock-Freund",
    "Minecraft統合版では、アドレスとポートを別々に入力します": "In Minecraft Bedrock werden Adresse und Port getrennt eingegeben",
    "サーバーアドレス": "Serveradresse", "サーバーポート": "Serverport", "アドレスをコピー": "Adresse kopieren", "ポートをコピー": "Port kopieren", "未取得": "Nicht verfügbar",
    "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。": "Lass im Bedrock-Feld Serverport nicht den Java-Port 25565 stehen. Gib den oben angezeigten Bedrock-Port ein.",
    "「プレイ」を開く": "Spielen öffnen", "「サーバー」→「サーバーを追加」を選ぶ": "Server und dann Server hinzufügen wählen", "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する": "Serveradresse und Serverport von oben in die passenden Felder eingeben",
    "公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。": "Der Port konnte nicht vom öffentlichen Endpunkt getrennt werden. Prüfe die Minecraft-Bedrock-/UDP-Einstellungen in playit.gg.",
    "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。": "Freunde mit der Java Edition verwenden die normale Java-Adresse, nicht die hier angezeigten Werte.",
  },
  es: {
    "統合版の友達が入力する内容": "Datos que debe introducir tu amigo de Bedrock",
    "Minecraft統合版では、アドレスとポートを別々に入力します": "En Minecraft Bedrock, introduce la dirección y el puerto por separado",
    "サーバーアドレス": "Dirección del servidor", "サーバーポート": "Puerto del servidor", "アドレスをコピー": "Copiar dirección", "ポートをコピー": "Copiar puerto", "未取得": "No disponible",
    "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。": "No dejes el puerto 25565 de Java en el campo Puerto del servidor de Bedrock. Introduce el puerto de Bedrock mostrado arriba.",
    "「プレイ」を開く": "Abre Jugar", "「サーバー」→「サーバーを追加」を選ぶ": "Selecciona Servidores y luego Agregar servidor", "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する": "Introduce la Dirección y el Puerto mostrados arriba en sus campos correspondientes",
    "公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。": "No se pudo separar el puerto del destino público. Revisa la configuración Minecraft Bedrock / UDP en playit.gg.",
    "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。": "Los amigos con Java Edition deben usar la dirección habitual de Java, no estos valores.",
  },
  fr: {
    "統合版の友達が入力する内容": "Informations à saisir par votre ami Bedrock",
    "Minecraft統合版では、アドレスとポートを別々に入力します": "Dans Minecraft Bedrock, saisissez séparément l’adresse et le port",
    "サーバーアドレス": "Adresse du serveur", "サーバーポート": "Port du serveur", "アドレスをコピー": "Copier l’adresse", "ポートをコピー": "Copier le port", "未取得": "Indisponible",
    "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。": "Ne laissez pas le port Java 25565 dans le champ Port du serveur Bedrock. Saisissez le port Bedrock affiché ci-dessus.",
    "「プレイ」を開く": "Ouvrez Jouer", "「サーバー」→「サーバーを追加」を選ぶ": "Choisissez Serveurs, puis Ajouter un serveur", "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する": "Saisissez l’adresse et le port affichés ci-dessus dans les champs correspondants",
    "公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。": "Impossible de séparer le port de l’adresse publique. Vérifiez les réglages Minecraft Bedrock / UDP dans playit.gg.",
    "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。": "Les amis sur Java Edition doivent utiliser l’adresse Java habituelle, pas les valeurs affichées ici.",
  },
  ko: {
    "統合版の友達が入力する内容": "베드락 친구가 입력할 내용",
    "Minecraft統合版では、アドレスとポートを別々に入力します": "Minecraft 베드락에서는 주소와 포트를 따로 입력합니다",
    "サーバーアドレス": "서버 주소", "サーバーポート": "서버 포트", "アドレスをコピー": "주소 복사", "ポートをコピー": "포트 복사", "未取得": "가져오지 못함",
    "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。": "베드락의 서버 포트 칸에 Java용 25565를 그대로 두지 말고 위에 표시된 베드락용 포트를 입력하세요.",
    "「プレイ」を開く": "플레이 열기", "「サーバー」→「サーバーを追加」を選ぶ": "서버에서 서버 추가 선택", "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する": "위의 서버 주소와 서버 포트를 각각 맞는 칸에 입력",
    "公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。": "공개 주소에서 포트를 분리하지 못했습니다. playit.gg의 Minecraft Bedrock / UDP 설정을 확인하세요.",
    "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。": "Java Edition 친구는 여기에 표시된 값이 아니라 기존 Java용 주소를 사용합니다.",
  },
  "pt-BR": {
    "統合版の友達が入力する内容": "Dados que seu amigo Bedrock deve inserir",
    "Minecraft統合版では、アドレスとポートを別々に入力します": "No Minecraft Bedrock, informe o endereço e a porta separadamente",
    "サーバーアドレス": "Endereço do servidor", "サーバーポート": "Porta do servidor", "アドレスをコピー": "Copiar endereço", "ポートをコピー": "Copiar porta", "未取得": "Indisponível",
    "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。": "Não deixe a porta Java 25565 no campo Porta do servidor do Bedrock. Informe a porta Bedrock mostrada acima.",
    "「プレイ」を開く": "Abra Jogar", "「サーバー」→「サーバーを追加」を選ぶ": "Selecione Servidores e depois Adicionar servidor", "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する": "Informe o endereço e a porta mostrados acima nos campos correspondentes",
    "公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。": "Não foi possível separar a porta do destino público. Verifique as configurações Minecraft Bedrock / UDP no playit.gg.",
    "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。": "Amigos na Java Edition devem usar o endereço Java habitual, não estes valores.",
  },
  "zh-CN": {
    "統合版の友達が入力する内容": "基岩版朋友需要输入的内容", "Minecraft統合版では、アドレスとポートを別々に入力します": "Minecraft 基岩版需要分别输入地址和端口", "サーバーアドレス": "服务器地址", "サーバーポート": "服务器端口", "アドレスをコピー": "复制地址", "ポートをコピー": "复制端口", "未取得": "未获取",
    "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。": "不要在基岩版的服务器端口中保留 Java 版端口 25565。请输入上方显示的基岩版端口。", "「プレイ」を開く": "打开游戏", "「サーバー」→「サーバーを追加」を選ぶ": "选择服务器，然后选择添加服务器", "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する": "将上方的服务器地址和端口分别输入对应栏位", "公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。": "无法从公开地址中分离端口。请检查 playit.gg 的 Minecraft Bedrock / UDP 设置。", "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。": "Java 版朋友应使用原来的 Java 地址，而不是这里显示的值。",
  },
  "zh-TW": {
    "統合版の友達が入力する内容": "基岩版朋友需要輸入的內容", "Minecraft統合版では、アドレスとポートを別々に入力します": "Minecraft 基岩版需要分別輸入位址和連接埠", "サーバーアドレス": "伺服器位址", "サーバーポート": "伺服器連接埠", "アドレスをコピー": "複製位址", "ポートをコピー": "複製連接埠", "未取得": "尚未取得",
    "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。": "請勿在基岩版的伺服器連接埠保留 Java 版連接埠 25565。請輸入上方顯示的基岩版連接埠。", "「プレイ」を開く": "開啟遊玩", "「サーバー」→「サーバーを追加」を選ぶ": "選擇伺服器，再選擇新增伺服器", "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する": "將上方的伺服器位址與連接埠分別輸入對應欄位", "公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。": "無法從公開位址分離連接埠。請檢查 playit.gg 的 Minecraft Bedrock / UDP 設定。", "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。": "Java 版朋友應使用原本的 Java 位址，而不是這裡顯示的值。",
  },
};

const UI_CORRECTION_PATTERNS: Partial<Record<AppLocale, Record<string, string>>> = {
  en: { "[[VAR0]]人": "[[VAR0]] players", "[[VAR0]]コア / [[VAR1]]スレッド": "[[VAR0]] cores / [[VAR1]] threads", "[[VAR0]]コア / [[VAR1]]スレッド · 使用率 [[VAR2]]%": "[[VAR0]] cores / [[VAR1]] threads · [[VAR2]]% usage", "参加人数は[[VAR0]]人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。": "[[VAR0]] players are connected, but their names could not be read from the server response or current session log." },
  de: { "[[VAR0]]人": "[[VAR0]] Spieler", "[[VAR0]]コア / [[VAR1]]スレッド": "[[VAR0]] Kerne / [[VAR1]] Threads", "[[VAR0]]コア / [[VAR1]]スレッド · 使用率 [[VAR2]]%": "[[VAR0]] Kerne / [[VAR1]] Threads · [[VAR2]] % Auslastung", "参加人数は[[VAR0]]人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。": "[[VAR0]] Spieler sind verbunden, ihre Namen konnten jedoch nicht aus der Serverantwort oder dem aktuellen Sitzungsprotokoll gelesen werden." },
  es: { "[[VAR0]]人": "[[VAR0]] jugadores", "[[VAR0]]コア / [[VAR1]]スレッド": "[[VAR0]] núcleos / [[VAR1]] hilos", "[[VAR0]]コア / [[VAR1]]スレッド · 使用率 [[VAR2]]%": "[[VAR0]] núcleos / [[VAR1]] hilos · [[VAR2]] % de uso", "参加人数は[[VAR0]]人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。": "Hay [[VAR0]] jugadores conectados, pero sus nombres no se pudieron leer de la respuesta del servidor ni del registro de la sesión actual." },
  fr: { "[[VAR0]]人": "[[VAR0]] joueurs", "[[VAR0]]コア / [[VAR1]]スレッド": "[[VAR0]] cœurs / [[VAR1]] threads", "[[VAR0]]コア / [[VAR1]]スレッド · 使用率 [[VAR2]]%": "[[VAR0]] cœurs / [[VAR1]] threads · utilisation [[VAR2]] %", "参加人数は[[VAR0]]人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。": "[[VAR0]] joueurs sont connectés, mais leurs noms n’ont pas pu être lus dans la réponse du serveur ou le journal de la session actuelle." },
  ko: { "[[VAR0]]人": "[[VAR0]]명", "[[VAR0]]コア / [[VAR1]]スレッド": "[[VAR0]]코어 / [[VAR1]]스레드", "[[VAR0]]コア / [[VAR1]]スレッド · 使用率 [[VAR2]]%": "[[VAR0]]코어 / [[VAR1]]스레드 · 사용률 [[VAR2]]%", "参加人数は[[VAR0]]人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。": "[[VAR0]]명이 접속 중이지만 서버 응답이나 현재 세션 로그에서 이름을 가져오지 못했습니다." },
  "pt-BR": { "[[VAR0]]人": "[[VAR0]] jogadores", "[[VAR0]]コア / [[VAR1]]スレッド": "[[VAR0]] núcleos / [[VAR1]] threads", "[[VAR0]]コア / [[VAR1]]スレッド · 使用率 [[VAR2]]%": "[[VAR0]] núcleos / [[VAR1]] threads · [[VAR2]]% de uso", "参加人数は[[VAR0]]人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。": "Há [[VAR0]] jogadores conectados, mas os nomes não puderam ser lidos da resposta do servidor nem do registro da sessão atual." },
  "zh-CN": { "[[VAR0]]人": "[[VAR0]] 人", "[[VAR0]]コア / [[VAR1]]スレッド": "[[VAR0]] 核 / [[VAR1]] 线程", "[[VAR0]]コア / [[VAR1]]スレッド · 使用率 [[VAR2]]%": "[[VAR0]] 核 / [[VAR1]] 线程 · 使用率 [[VAR2]]%", "参加人数は[[VAR0]]人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。": "已有 [[VAR0]] 人连接，但无法从服务器响应或当前会话日志中读取姓名。" },
  "zh-TW": { "[[VAR0]]人": "[[VAR0]] 人", "[[VAR0]]コア / [[VAR1]]スレッド": "[[VAR0]] 核心 / [[VAR1]] 執行緒", "[[VAR0]]コア / [[VAR1]]スレッド · 使用率 [[VAR2]]%": "[[VAR0]] 核心 / [[VAR1]] 執行緒 · 使用率 [[VAR2]]%", "参加人数は[[VAR0]]人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。": "已有 [[VAR0]] 人連線，但無法從伺服器回應或目前工作階段日誌讀取名稱。" },
};

const MEMORY_HELP_PATTERNS: Partial<Record<AppLocale, Record<string, string>>> = {
  en: { "このPC（合計約[[VAR0]] GiB）に合わせたJava起動設定": "Java launch settings adapted to this PC (about [[VAR0]] GiB total)" },
  de: { "このPC（合計約[[VAR0]] GiB）に合わせたJava起動設定": "An diesen PC angepasste Java-Starteinstellungen (insgesamt etwa [[VAR0]] GiB)" },
  es: { "このPC（合計約[[VAR0]] GiB）に合わせたJava起動設定": "Ajustes de inicio de Java adaptados a este PC (unos [[VAR0]] GiB en total)" },
  fr: { "このPC（合計約[[VAR0]] GiB）に合わせたJava起動設定": "Réglages de lancement Java adaptés à ce PC (environ [[VAR0]] Gio au total)" },
  ko: { "このPC（合計約[[VAR0]] GiB）に合わせたJava起動設定": "이 PC(총 약 [[VAR0]] GiB)에 맞춘 Java 실행 설정" },
  "pt-BR": { "このPC（合計約[[VAR0]] GiB）に合わせたJava起動設定": "Configurações de inicialização do Java adaptadas a este PC (cerca de [[VAR0]] GiB no total)" },
  "zh-CN": { "このPC（合計約[[VAR0]] GiB）に合わせたJava起動設定": "适合此电脑的 Java 启动设置（总计约 [[VAR0]] GiB）" },
  "zh-TW": { "このPC（合計約[[VAR0]] GiB）に合わせたJava起動設定": "適合此電腦的 Java 啟動設定（總計約 [[VAR0]] GiB）" },
};

type CompiledPattern = { regex: RegExp; translated: string; specificity: number };
type AttributeState = { source: string; rendered: string };

const textSources = new WeakMap<Text, string>();
const textRendered = new WeakMap<Text, string>();
const attributeStates = new WeakMap<Element, Map<string, AttributeState>>();
const patternCache = new Map<AppLocale, { source: TranslationCatalogPatterns; compiled: CompiledPattern[] }>();
type TranslationCatalogPatterns = Readonly<Record<string, string>>;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePatterns(locale: AppLocale): CompiledPattern[] {
  const generated = getTranslationCatalog(locale);
  const cached = patternCache.get(locale);
  if (cached?.source === generated.patterns) return cached.compiled;
  const sourcePatterns = { ...generated.patterns, ...CURATED_PATTERNS[locale], ...MEMORY_HELP_PATTERNS[locale], ...UI_CORRECTION_PATTERNS[locale] };
  const compiled = Object.entries(sourcePatterns).map(([source, translated]) => {
    let position = 0;
    let expression = "^";
    for (const match of source.matchAll(MARKER)) {
      expression += escapeRegExp(source.slice(position, match.index)) + "(.*?)";
      position = (match.index ?? 0) + match[0].length;
    }
    expression += escapeRegExp(source.slice(position)) + "$";
    return { regex: new RegExp(expression, "s"), translated: UI_CORRECTION_PATTERNS[locale]?.[source] ?? MEMORY_HELP_PATTERNS[locale]?.[source] ?? CURATED_PATTERNS[locale]?.[source] ?? translated, specificity: source.replace(MARKER, "").length };
  }).sort((left, right) => right.specificity - left.specificity);
  patternCache.set(locale, { source: generated.patterns, compiled });
  return compiled;
}

function translateCore(source: string, locale: AppLocale) {
  if (locale === "ja" || !JAPANESE.test(source)) return source;
  const serverLab = SERVER_LAB_EXACT[locale]?.[source];
  if (serverLab !== undefined) return serverLab;
  const curated = CURATED_EXACT[locale]?.[source];
  if (curated !== undefined) return curated;
  const memoryHelp = MEMORY_HELP_EXACT[locale]?.[source];
  if (memoryHelp !== undefined) return memoryHelp;
  const playerStatus = PLAYER_STATUS_EXACT[locale]?.[source];
  if (playerStatus !== undefined) return playerStatus;
  const crossplayAccess = CROSSPLAY_ACCESS_EXACT[locale]?.[source];
  if (crossplayAccess !== undefined) return crossplayAccess;
  const fixedMember = FIXED_MEMBER_EXACT[locale]?.[source];
  if (fixedMember !== undefined) return fixedMember;
  const bedrockEndpoint = BEDROCK_ENDPOINT_EXACT[locale]?.[source];
  if (bedrockEndpoint !== undefined) return bedrockEndpoint;
  const catalog = getTranslationCatalog(locale);
  const exact = catalog.exact[source];
  if (exact) return exact;
  for (const pattern of compilePatterns(locale)) {
    const match = pattern.regex.exec(source);
    if (!match) continue;
    let index = 1;
    return pattern.translated.replace(MARKER, () => {
      const captured = match[index++] ?? "";
      const curatedCapture = CURATED_EXACT[locale]?.[captured];
      if (curatedCapture !== undefined) return curatedCapture;
      const crossplayCapture = CROSSPLAY_ACCESS_EXACT[locale]?.[captured];
      if (crossplayCapture !== undefined) return crossplayCapture;
      return catalog.exact[captured] || captured;
    });
  }
  return source;
}

export function translateGeneratedText(source: string, locale: AppLocale) {
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  const core = source.slice(leading.length, source.length - trailing.length || undefined);
  if (!core) return source;
  const direct = translateCore(core, locale);
  if (direct !== core) return `${leading}${direct}${trailing}`;
  const normalized = core.replace(/[ \t\r\f\v]+/g, " ");
  const normalizedTranslation = translateCore(normalized, locale);
  return normalizedTranslation === normalized ? source : `${leading}${normalizedTranslation}${trailing}`;
}

function isExcluded(element: Element | null) {
  return Boolean(element?.closest(EXCLUDED_SELECTOR));
}

function translateTextNode(node: Text, locale: AppLocale) {
  if (isExcluded(node.parentElement)) return;
  const current = node.nodeValue ?? "";
  const lastRendered = textRendered.get(node);
  if (!textSources.has(node) || (lastRendered !== undefined && current !== lastRendered)) textSources.set(node, current);
  const source = textSources.get(node) ?? current;
  const translated = translateGeneratedText(source, locale);
  textRendered.set(node, translated);
  if (current !== translated) node.nodeValue = translated;
}

function translateAttribute(element: Element, attribute: string, locale: AppLocale) {
  if (isExcluded(element)) return;
  const current = element.getAttribute(attribute);
  if (current === null) return;
  let states = attributeStates.get(element);
  if (!states) {
    states = new Map();
    attributeStates.set(element, states);
  }
  const previous = states.get(attribute);
  const source = !previous || current !== previous.rendered ? current : previous.source;
  const translated = translateGeneratedText(source, locale);
  states.set(attribute, { source, rendered: translated });
  if (current !== translated) element.setAttribute(attribute, translated);
}

function translateSubtree(root: Node, locale: AppLocale) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, locale);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof DocumentFragment) && !(root instanceof Document)) return;
  if (root instanceof Element) {
    if (isExcluded(root)) return;
    TRANSLATED_ATTRIBUTES.forEach((attribute) => translateAttribute(root, attribute, locale));
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text, locale);
    else TRANSLATED_ATTRIBUTES.forEach((attribute) => translateAttribute(node as Element, attribute, locale));
    node = walker.nextNode();
  }
}

export function installDocumentTranslation(locale: AppLocale) {
  const root = document.body;
  if (!root) return () => undefined;
  translateSubtree(root, locale);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") translateTextNode(mutation.target as Text, locale);
      else if (mutation.type === "attributes") translateAttribute(mutation.target as Element, mutation.attributeName ?? "", locale);
      else mutation.addedNodes.forEach((node) => translateSubtree(node, locale));
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...TRANSLATED_ATTRIBUTES] });
  return () => observer.disconnect();
}
