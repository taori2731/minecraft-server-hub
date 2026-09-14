export type DeliveryStatus = "implemented" | "conditional" | "developing";

export const releaseStatus = {
  version: "公開版 0.4.4",
  updatedAt: "2026-09-14",
  download: "公開済み",
  releaseUrl: "https://github.com/taori2731/minecraft-server-hub-releases/releases/tag/v0.4.4",
  installerUrl: "https://github.com/taori2731/minecraft-server-hub-releases/releases/download/v0.4.4/Minecraft.Server.Hub_0.4.4_x64-setup.exe",
  signatureUrl: "https://github.com/taori2731/minecraft-server-hub-releases/releases/download/v0.4.4/Minecraft.Server.Hub_0.4.4_x64-setup.exe.sig",
  manifestUrl: "https://github.com/taori2731/minecraft-server-hub-releases/releases/download/v0.4.4/latest.json",
  checksumUrl: "https://github.com/taori2731/minecraft-server-hub-releases/releases/download/v0.4.4/SHA256SUMS.txt",
  installerName: "Minecraft.Server.Hub_0.4.4_x64-setup.exe",
  sha256: "DAB420310270952869E5965B60B57E9D48C2462CFF25E30A2041AD1BB9D93EEB",
  latestFeedVersion: "0.4.4",
  publicationVerification: "公開再取得検証PASS",
  signatureMethod: "Tauri Updater detached signature (.sig)（公開検証済み）",
  authenticodeStatus: "Windows Authenticodeは未署名（NotSigned）",
  groups: [
    { status: "implemented" as DeliveryStatus, label: "実装済み", items: [
      ["Minecraft Java", "Vanilla、Paper、Fabric、Forge、NeoForgeの作成経路、既存フォルダー検査、Java選択、ログ、設定、バックアップ"],
      ["Minecraft Bedrock", "Windows向けBedrock Dedicated Serverの作成・取り込み・起動、許可リスト、権限、アドオン、UDP設定"],
      ["Palworld", "公式SteamCMDからの専用サーバー作成、起動、ローカルREST監視、ワールド保存後の安全停止"],
      ["クロスプレイ", "PaperへGeyserと任意のFloodgateを公式配布元から検証して追加し、統合版用UDPポートとメンバーを管理"],
      ["診断とサーバーラボ", "PC診断、互換Java準備、人数・メモリ・距離の目安、ポート提案、公開前セキュリティ監査、変更差分"],
      ["拡張機能", "ローカル追加、Modrinth検索、Mod／Modパックの導入計画、依存解決、ハッシュ検証、構成プロファイル、更新候補の事前確認"],
      ["保護と更新", "変更前・手動バックアップ、復元前退避、確認付きサーバー更新、署名検証付きアプリ更新"],
      ["高度な運用", "複数サーバーの一括操作、監視、履歴、Mod構成、外観を支援の有無にかかわらず全員が利用可能"],
      ["9言語UI", "日本語、英語、ドイツ語、スペイン語、フランス語、韓国語、ポルトガル語、簡体字・繁体字中国語"],
    ]},
    { status: "conditional" as DeliveryStatus, label: "条件付き", items: [
      ["Fabric / Forge / NeoForge", "作成と管理の経路は実装済み。Minecraft版、Java、ローダー、Mod構成ごとの実環境検証は継続中"],
      ["Bedrock / Palworld", "Windows向け実装と自動テストはありますが、一般PC・実クライアント参加を含む受入範囲は拡大中"],
      ["TPS", "Paperと対応Vanillaで取得。Fabric、Forge、NeoForgeでは未取得の場合あり"],
      ["別の家から参加", "UPnPまたは公式playit中継を選べます。ルーター、外部サービス、規約、ISP、ファイアウォール、回線状態に依存"],
      ["アプリ内更新", "公開版0.4.4のlatest.json、隣接.sig、SHA-256を公開再取得検証済み。0.4.3からの実アプリ更新・再起動確認は未実施/継続中"],
    ]},
    { status: "developing" as DeliveryStatus, label: "開発中・未接続", items: [
      ["任意支援・将来機能", "支援受付は準備中。将来の新機能の先行体験、開発中機能へのフィードバック参加、限定外観は候補です。支援先、金額、決済、ライセンス条件は未決定"],
      ["予約バックアップ", "複数世代を扱う基盤はありますが、予約UIと本番運用の検証は開発中"],
      ["Windowsパッケージ表示", "互換性のためインストーラー資産名は旧形式を維持。アプリ画面と既存ショートカットはTomoNodeへ移行"],
    ]},
  ],
} as const;
