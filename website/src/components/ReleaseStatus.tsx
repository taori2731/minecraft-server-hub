import { AlertTriangle, CheckCircle2, Clock3, Download, History } from "lucide-react";
import { releaseStatus, type DeliveryStatus } from "../data/releaseStatus";
import { SectionHeading } from "./Ui";

const icon = { implemented: CheckCircle2, conditional: AlertTriangle, developing: Clock3 } satisfies Record<DeliveryStatus, typeof CheckCircle2>;

export function ReleaseStatus() {
  return <section className="section release-section" id="updates" aria-labelledby="updates-title">
    <div className="release-heading"><SectionHeading id="updates-title" title="今できることと、まだできないこと" description="公開済みの事実と、未公開の0.4.4候補を分けて掲載します。" /><dl><div><dt>現在の版</dt><dd>{releaseStatus.version}</dd></div><div><dt>確認日</dt><dd>{releaseStatus.updatedAt}</dd></div><div><dt>配布</dt><dd>{releaseStatus.download}</dd></div></dl></div>
    <div className="status-table"><div className="status-table-head"><span>状態</span><span>機能</span><span>現在の範囲</span></div>{releaseStatus.groups.flatMap((group) => group.items.map(([title, detail], index) => { const Icon = icon[group.status]; return <article key={`${group.status}-${title}`}><span className={`release-status release-${group.status}`}>{index === 0 ? <><Icon aria-hidden="true" />{group.label}</> : null}</span><h3>{title}</h3><p>{detail}</p></article>; }))}</div>
    <div className="update-preview">
      <div><h3>更新も、内容を確認してから</h3><p>サーバー更新は直前バックアップと名前確認を行い、同じ種類の検証済み配布物だけを適用します。アプリ更新はHTTPSの署名付きフィードを確認し、全サーバー停止中に本人が承認した場合だけ進みます。</p><p className="truth-note compact"><AlertTriangle aria-hidden="true" />更新確認が失敗した場合や署名を検証できない場合は、現在のサーバーまたはアプリを維持します。</p></div>
      <figure className="product-shot"><img src="/screenshots/confirmed-update-review-dark.png" alt="サーバー名入力と警告への同意を求める確認付き更新画面" /><figcaption><History aria-hidden="true" />サーバー更新もバックアップと確認を先に</figcaption></figure>
    </div>
    <p className="download-status"><Download aria-hidden="true" />0.4.4候補の配布資産名、候補SHA-256、Tauri更新用の参照先を準備しています。0.4.3からの最終更新確認は未実施/継続中です。</p>
    <p className="evidence-note"><History aria-hidden="true" />架空のダウンロード数、レビュー、スポンサー、提携実績は表示していません。</p>
  </section>;
}
