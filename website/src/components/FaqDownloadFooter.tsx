import { Box, CircleHelp, FileText, Lock, Mail, MonitorDown, Scale } from "lucide-react";
import { releaseStatus } from "../data/releaseStatus";
import { Brand } from "./Brand";
import { SectionHeading } from "./Ui";

const faqs = [
  { q: "MinecraftやPalworldの公式アプリですか？", a: "いいえ。TomoNodeはMinecraft、Mojang Studios、Microsoft、Palworld、Pocketpair、Valveの公式製品・提携製品ではなく、各社の承認・提携を受けていない独立プロジェクトです。" },
  { q: "現在どのゲームとサーバー種類に対応していますか？", a: "Minecraft JavaのVanilla、Paper、Fabric、Forge、NeoForge、Windows向けBedrock Dedicated Server、Palworld Dedicated Serverの作成経路を実装しています。Java／Bedrockの既存環境取り込みにも対応します。Modローダー、Bedrock、Palworldは版や環境差が大きいため、実機検証を継続しています。" },
  { q: "Java版と統合版の友達は一緒に遊べますか？", a: "PaperへGeyserと任意のFloodgateを導入するクロスプレイ経路を実装しています。公式配布物のハッシュを確認し、Java版と統合版のメンバーを分けて管理します。ただし対応Minecraft版、Java、プラグイン構成、UDP接続の条件があるため、すべての構成を保証するものではありません。" },
  { q: "Palworldでは何を管理できますか？", a: "公式SteamCMDからの新規作成、UDPポート、起動、読み取り専用ログ、ローカルREST APIによる状態・参加者・負荷の確認、ワールド保存後の安全停止に対応します。REST管理ポートはLANやインターネットへ公開しない運用が必要です。" },
  { q: "すべてのModが動きますか？", a: "保証できません。Modrinthの検索、版・ローダー・依存関係・サーバー対応の確認、ファイル検証は行いますが、配布元の説明と実環境での確認も必要です。" },
  { q: "別の家の友達も必ず招待できますか？", a: "保証はできません。UPnPまたはplayit.gg中継を案内しますが、ルーター、ISP、外部サービスの条件、ファイアウォール、ゲームが使うTCP／UDP、回線品質に依存します。playitは初回の公式画面で本人によるアカウント連携とトンネル作成が必要です。" },
  { q: "診断結果やログは外部へ送られますか？", a: "PC診断とログ解析はローカルで行います。利用状況テレメトリー、広告ネットワーク、外部AI診断は現在接続していません。PalworldのREST監視もアプリからは127.0.0.1へだけ接続し、接続元IPと座標は保存しません。" },
  { q: "Javaが入っていなくても使えますか？", a: "アプリはJavaなしで起動できます。サーバーに必要なJavaがない場合は、Eclipse Temurinの配布元・ライセンス・版・容量・保存先を確認した後、アプリ専用領域へ取得して自動選択できます。Windows全体のJava設定は変更しません。" },
  { q: "アプリは自動更新されますか？", a: "署名された更新フィードを確認し、本人が版と更新内容を承認した場合だけ適用する仕組みです。サーバーが動作中のときは更新しません。公開版0.4.4のlatest.json、隣接.sig、SHA-256は公開再取得検証PASSです。Tauri Updater署名も検証済みです。0.4.3からの実アプリ更新・再起動確認は未実施/継続中です。" },
  { q: "TomoNodeへの支援は受け付けていますか？", a: "支援は任意です。支援受付は準備中で、将来追加する新機能の先行体験、開発中機能へのフィードバック参加、限定外観は候補です。支援先、金額、決済方法、ライセンス条件は未決定です。支援停止後も、安全機能、バックアップと復元、サーバーデータへのアクセスを制限しません。" },
  { q: "アンインストールでサーバーやワールドは消えますか？", a: "TomoNodeのアンインストールだけで、外部サーバーフォルダーやワールドを削除しない設計です。削除や移動を行う前に、必要なサーバーフォルダー、ワールド、設定、バックアップを手動で確認してください。" },
  { q: "0.4.4は公開されていますか？", a: "はい。0.4.4はGitHub Releaseで公開済みです。公開資産の再取得検証は完了しています。0.4.3からの実アプリ更新・再起動確認は未実施/継続中です。" },
];
const pendingLinks = [[FileText, "公式ドキュメント"], [Lock, "プライバシーポリシー"], [Scale, "利用規約"], [Box, "ライセンス情報"], [Mail, "お問い合わせ・フィードバック"]] as const;

export function FaqDownloadFooter() {
  return <>
    <section className="section faq-section" id="faq" aria-labelledby="faq-title"><div className="faq-heading"><CircleHelp aria-hidden="true" /><SectionHeading id="faq-title" title="よくある質問" description="公開版の状態、対応範囲、支援方針をまとめました。" /></div><div className="faq-list">{faqs.map(({ q, a }) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></section>
    <section className="download-section" id="download" aria-labelledby="download-title"><MonitorDown aria-hidden="true" /><div className="download-copy"><h2 id="download-title">公開版 0.4.4</h2><p>0.4.4はGitHub Releaseで公開済みです。Windowsインストーラー資産名は従来形式を維持しています。</p><dl className="download-facts"><div><dt>パッケージ</dt><dd><code>{releaseStatus.installerName}</code></dd></div><div><dt>SHA-256</dt><dd><code>{releaseStatus.sha256}</code></dd></div><div><dt>署名方式</dt><dd>{releaseStatus.signatureMethod}</dd></div><div><dt>Authenticode</dt><dd>{releaseStatus.authenticodeStatus}</dd></div></dl><p className="download-proof">公開<span>SHA256SUMS.txt</span>とRelease資産のSHA-256は公開再取得検証PASSです。latest.jsonのバージョンは0.4.4で、隣接<code>.sig</code>とTauri Updater署名も検証済みです。これはWindows Authenticode署名を意味しません。</p><p className="download-warning">Windows Authenticodeは未署名（NotSigned）です。SmartScreenが警告を表示する可能性があるため、公式GitHub ReleaseのURL、Windowsが表示する発行元情報、ファイル名、SHA-256を確認し、不一致や不明点があれば実行しないでください。</p><p className="download-safety">アンインストールだけで外部サーバーフォルダーやワールドを削除しません。削除・移動の前にサーバー、ワールド、設定、バックアップを確認してください。</p><div className="download-links" aria-label="公開版0.4.4の検証リンク"><a href={releaseStatus.releaseUrl} target="_blank" rel="noreferrer">GitHub Release</a><a href={releaseStatus.manifestUrl} target="_blank" rel="noreferrer">latest.json</a><a href={releaseStatus.signatureUrl} target="_blank" rel="noreferrer">隣接.sig</a><a href={releaseStatus.checksumUrl} target="_blank" rel="noreferrer">SHA256SUMS.txt</a></div></div><a className="button button-primary" href={releaseStatus.installerUrl}>0.4.4をダウンロード</a></section>
    <footer className="site-footer"><div className="footer-brand"><Brand /><p>Windows x64向けゲームサーバー管理アプリ。公開版0.4.4を案内しています。</p></div><div className="pending-links" aria-label="公式情報">{pendingLinks.map(([Icon, label]) => <span key={label}><Icon aria-hidden="true" />{label}<small>整備中</small></span>)}</div><p className="legal-note">Minecraft、Mojang Studios、Microsoft、Palworld、Pocketpair、Valveの公式製品・提携製品ではありません。TomoNodeは各社の承認・提携を受けていない独立プロジェクトです。</p><p className="copyright">© 2026 TomoNode</p></footer>
  </>;
}
