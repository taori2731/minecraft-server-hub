import { Box, CircleHelp, FileText, Lock, Mail, MonitorDown, Scale } from "lucide-react";
import { Brand } from "./Brand";
import { SectionHeading } from "./Ui";

const faqs = [
  { q: "MinecraftやPalworldの公式アプリですか？", a: "いいえ。Minecraft Server Hubは現在の仮称で、Mojang Studios、Microsoft、Pocketpair、Valveの承認・提携を受けた公式製品ではありません。公開前に正式名称を見直します。" },
  { q: "現在どのゲームとサーバー種類に対応していますか？", a: "Minecraft JavaのVanilla、Paper、Fabric、Forge、NeoForge、Windows向けBedrock Dedicated Server、Palworld Dedicated Serverの作成経路を実装しています。Java／Bedrockの既存環境取り込みにも対応します。Modローダー、Bedrock、Palworldは版や環境差が大きいため、実機検証を継続しています。" },
  { q: "Java版と統合版の友達は一緒に遊べますか？", a: "PaperへGeyserと任意のFloodgateを導入するクロスプレイ経路を実装しています。公式配布物のハッシュを確認し、Java版と統合版のメンバーを分けて管理します。ただし対応Minecraft版、Java、プラグイン構成、UDP接続の条件があるため、すべての構成を保証するものではありません。" },
  { q: "Palworldでは何を管理できますか？", a: "公式SteamCMDからの新規作成、UDPポート、起動、読み取り専用ログ、ローカルREST APIによる状態・参加者・負荷の確認、ワールド保存後の安全停止に対応します。REST管理ポートはLANやインターネットへ公開しない運用が必要です。" },
  { q: "すべてのModが動きますか？", a: "保証できません。Modrinthの検索、版・ローダー・依存関係・サーバー対応の確認、ファイル検証は行いますが、配布元の説明と実環境での確認も必要です。" },
  { q: "別の家の友達も必ず招待できますか？", a: "保証はできません。UPnPまたはplayit.gg中継を案内しますが、ルーター、ISP、外部サービスの条件、ファイアウォール、ゲームが使うTCP／UDP、回線品質に依存します。playitは初回の公式画面で本人によるアカウント連携とトンネル作成が必要です。" },
  { q: "診断結果やログは外部へ送られますか？", a: "PC診断とログ解析はローカルで行います。利用状況テレメトリー、広告ネットワーク、外部AI診断は現在接続していません。PalworldのREST監視もアプリからは127.0.0.1へだけ接続し、接続元IPと座標は保存しません。" },
  { q: "Javaが入っていなくても使えますか？", a: "アプリはJavaなしで起動できます。サーバーに必要なJavaがない場合は、Eclipse Temurinの配布元・ライセンス・版・容量・保存先を確認した後、アプリ専用領域へ取得して自動選択できます。Windows全体のJava設定は変更しません。" },
  { q: "アプリは自動更新されますか？", a: "署名された更新フィードを確認し、本人が版と更新内容を承認した場合だけ適用する仕組みを実装しています。サーバーが動作中のときは更新しません。一般公開フィード、旧版からの更新、コード署名を含む配布運用は公開前の最終確認が必要です。" },
  { q: "Pro版は購入できますか？", a: "まだ購入できません。複数サーバーの一括操作、ローカル監視、履歴検索、追加外観などは開発版に実装されていますが、価格、決済、ライセンス認証、税、返金、提供地域は未確定です。" },
  { q: "いつダウンロードできますか？", a: "Windows x64向けの0.3.10リリース候補ビルドを準備しています。正式名称、コード署名、一般公開URL、一般利用者環境でのインストール検証が完了した後、このサイトで案内します。" },
];
const pendingLinks = [[FileText, "公式ドキュメント"], [Lock, "プライバシーポリシー"], [Scale, "利用規約"], [Box, "ライセンス情報"], [Mail, "お問い合わせ・フィードバック"]] as const;

export function FaqDownloadFooter() {
  return <>
    <section className="section faq-section" id="faq" aria-labelledby="faq-title"><div className="faq-heading"><CircleHelp aria-hidden="true" /><SectionHeading id="faq-title" title="よくある質問" description="公開前によく確認したい、対応範囲と制限をまとめました。" /></div><div className="faq-list">{faqs.map(({ q, a }) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></section>
    <section className="download-section" id="download" aria-labelledby="download-title"><MonitorDown aria-hidden="true" /><div><h2 id="download-title">Windows版を準備中</h2><p>0.3.10のリリース候補あり・一般公開準備中。未署名ファイルや架空のダウンロード先には接続しません。</p></div><button className="button button-disabled" type="button" disabled>ダウンロード準備中</button></section>
    <footer className="site-footer"><div className="footer-brand"><Brand /><p>Windows x64向けデスクトップアプリ・製品名は仮称です。</p></div><div className="pending-links" aria-label="準備中の公式情報">{pendingLinks.map(([Icon, label]) => <span key={label}><Icon aria-hidden="true" />{label}<small>準備中</small></span>)}</div><p className="legal-note">MinecraftはMojang StudiosおよびMicrosoft、PalworldはPocketpairの各商標です。本サイトとアプリはMojang Studios、Microsoft、Pocketpair、Valveの承認・提携を受けた公式製品ではありません。</p><p className="copyright">© 2026 Minecraft Server Hub（仮称）</p></footer>
  </>;
}
