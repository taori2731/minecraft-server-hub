export type DeliveryStatus = "implemented" | "conditional" | "developing";

export const releaseStatus = {
  version: "開発版 0.3.10",
  updatedAt: "2026-09-12",
  download: "一般公開準備中",
  groups: [
    { status: "implemented" as DeliveryStatus, label: "実装済み", items: [
      ["Minecraft Java", "Vanilla、Paper、Fabric、Forge、NeoForgeの作成経路、既存フォルダー検査、Java選択、ログ、設定、バックアップ"],
      ["Minecraft Bedrock", "Windows向けBedrock Dedicated Serverの作成・取り込み・起動、許可リスト、権限、アドオン、UDP設定"],
      ["Palworld", "公式SteamCMDからの専用サーバー作成、起動、ローカルREST監視、ワールド保存後の安全停止"],
      ["クロスプレイ", "PaperへGeyserと任意のFloodgateを公式配布元から検証して追加し、統合版用UDPポートとメンバーを管理"],
      ["診断とサーバーラボ", "PC診断、互換Java準備、人数・メモリ・距離の目安、ポート提案、公開前セキュリティ監査、変更差分"],
      ["拡張機能", "ローカル追加、Modrinth検索、Mod／Modパックの導入計画、依存解決、ハッシュ検証、構成プロファイル、更新候補の事前確認"],
      ["保護と更新", "変更前・手動バックアップ、復元前退避、確認付きサーバー更新、署名検証付きアプリ更新"],
      ["9言語UI", "日本語、英語、ドイツ語、スペイン語、フランス語、韓国語、ポルトガル語、簡体字・繁体字中国語"],
    ]},
    { status: "conditional" as DeliveryStatus, label: "条件付き", items: [
      ["Fabric / Forge / NeoForge", "作成と管理の経路は実装済み。Minecraft版、Java、ローダー、Mod構成ごとの実環境検証は継続中"],
      ["Bedrock / Palworld", "Windows向け実装と自動テストはありますが、一般PC・実クライアント参加を含む受入範囲は拡大中"],
      ["TPS", "Paperと対応Vanillaで取得。Fabric、Forge、NeoForgeでは未取得の場合あり"],
      ["別の家から参加", "UPnPまたは公式playit中継を選べます。ルーター、外部サービス、規約、ISP、ファイアウォール、回線状態に依存"],
      ["アプリ内更新", "署名済み更新だけを適用する実装。実際の公開フィード、旧版からの更新、コード署名を含む配布運用は最終確認が必要"],
    ]},
    { status: "developing" as DeliveryStatus, label: "開発中・未接続", items: [
      ["Pro／サポーター版", "一括操作、ローカル監視、履歴、外観などは開発版で動作。価格、決済、ライセンス認証、提供条件は未接続"],
      ["予約バックアップ", "複数世代を扱う基盤はありますが、予約UIと本番運用の検証は開発中"],
      ["一般配布", "正式名称、コード署名、公開URL、一般利用者環境でのインストール検証が未完了"],
    ]},
  ],
} as const;
