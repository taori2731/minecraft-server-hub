import { AlertTriangle, Ban, Check, CircleGauge, CloudOff, Cpu, Database, Eye, Gauge, HardDrive, Languages, Network, RotateCcw, ShieldCheck, SlidersHorizontal, UserCog, Users } from "lucide-react";
import { SectionHeading, StatusTag } from "./Ui";

const diagnosis = ["Javaなし・バージョン不一致", "EULA未同意・JAR／実行ファイル不足", "TCP／UDPポート使用中・メモリ不足", "Mod依存関係・ローダー不一致", "ワールド読込・クラッシュログの主要エラー"];
const access = ["ホワイトリスト", "OP権限者", "BANプレイヤー", "BANしたIPアドレス", "いつものメンバーをまとめて反映"];
const limits = ["UPnPまたは外部中継の条件と公開範囲を事前に確認", "playit.ggは初回だけ公式画面でアカウント連携とトンネル作成が必要", "Minecraft JavaはTCP、BedrockはUDPなどゲームに合う経路が必要", "外部サービスの稼働状況・利用条件・ISP・回線品質に依存", "接続先は招待する相手だけに共有し、すべての家庭環境での接続は保証しない"];
const privacy = [
  { icon: Eye, title: "テレメトリーなし", body: "利用状況やPC診断情報を収集する仕組みは接続していません。" },
  { icon: Ban, title: "広告・決済なし", body: "広告ネットワーク、購入、ライセンス認証サービスは未接続です。" },
  { icon: CloudOff, title: "外部AIへ送らない", body: "診断とログ解析はPC内で行い、秘密情報らしき値を表示前に伏せます。" },
  { icon: Database, title: "ローカル保存", body: "サーバー登録情報や招待設定、いつものメンバーはローカルSQLiteへ保存。Palworldの管理資格情報はWindows資格情報マネージャーで保護します。" },
];

export function DiagnosticsCommunity() {
  return <>
    <section className="section safety-section" id="safety" aria-labelledby="safety-title">
      <div className="safety-copy">
        <div className="heading-with-status"><h2 id="safety-title">PC診断から、起動失敗の原因まで</h2><StatusTag status="available" /></div>
        <p>PCの構成を確認して初期値を提案し、起動できないときは「何が起きたか」「次に何を試すか」を日本語で整理します。</p>
        <ul className="check-list">{diagnosis.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
        <div className="metric-rail"><span><Cpu aria-hidden="true" /><b>CPU</b></span><span><Gauge aria-hidden="true" /><b>メモリ</b></span><span><HardDrive aria-hidden="true" /><b>空き容量</b></span><span><CircleGauge aria-hidden="true" /><b>Java</b></span></div>
        <p className="truth-note compact"><AlertTriangle aria-hidden="true" />性能保証ではありません。PC、回線、ワールド、Mod、参加人数によって実際の上限は変わります。</p>
      </div>
      <figure className="product-shot"><img src="/screenshots/safety-tools-dark.png" alt="Mod構成プロファイル、Java環境、更新前チェックをまとめた安全ツール画面" /><figcaption><ShieldCheck aria-hidden="true" />Java・構成・更新前チェックをサーバーごとに管理</figcaption></figure>
    </section>

    <section className="lab-band" aria-labelledby="lab-title">
      <div className="section product-split">
        <div className="product-copy">
          <div className="heading-with-status"><h2 id="lab-title">サーバーラボで、設定を保存前に試算</h2><StatusTag status="available">開発版</StatusTag></div>
          <p>遊び方と性能のプリセット、人数・メモリ、距離、チャンク候補、シード、ポート、公開前監査をひとつの下書きにまとめます。</p>
          <ul className="check-list">
            <li><Check aria-hidden="true" />変更はすぐ反映せず、現在値との差分として表示</li>
            <li><Check aria-hidden="true" />サーバーごとの下書きをPC内へ保存・復元</li>
            <li><Check aria-hidden="true" />停止中だけ、バックアップしてから設定へ適用</li>
            <li><Check aria-hidden="true" />推定人数はMod構成や建築量で変わる目安として表示</li>
          </ul>
          <p className="truth-note compact"><SlidersHorizontal aria-hidden="true" />自動で性能を保証する機能ではありません。安全な初期値と確認材料を提案します。</p>
        </div>
        <figure className="product-shot"><img src="/screenshots/server-lab-dark.png" alt="人数とメモリの試算、ポート検査、公開前セキュリティ監査を表示するサーバーラボ画面" /><figcaption><SlidersHorizontal aria-hidden="true" />保存前に試算・監査・差分確認</figcaption></figure>
      </div>
    </section>

    <section className="operations-band" aria-label="バックアップとプレイヤー管理">
      <div className="section operations-grid">
        <div className="operation-copy">
          <span className="section-index">01 / 運用と保護</span>
          <h2>止める前も、戻す前も、安全確認</h2>
          <ul className="check-list"><li><Check aria-hidden="true" />ワールドを保存する安全な停止</li><li><Check aria-hidden="true" />手動・変更前バックアップ</li><li><Check aria-hidden="true" />ZIPとSHA-256の整合性確認</li><li><Check aria-hidden="true" />復元前に現在状態を退避</li><li><Check aria-hidden="true" />削除前の最終バックアップ</li></ul>
          <p className="truth-note compact"><RotateCcw aria-hidden="true" />複数世代を扱う基盤はありますが、毎日の予約バックアップUIは開発中です。</p>
        </div>
        <div className="operation-copy">
          <span className="section-index">02 / プレイヤーアクセス</span>
          <h2>遊ぶメンバーを、起動前から管理</h2>
          <ul className="check-list">{access.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
          <p>停止中はJSONファイルを安全に更新し、起動中はMinecraftのコンソールコマンドで反映します。</p>
        </div>
        <figure className="wide-product-shot"><img src="/screenshots/fixed-members-player-management-dark.png" alt="ホワイトリスト、OP、BAN、BAN IPと、いつものメンバーを管理する画面" /><figcaption><Users aria-hidden="true" />よく遊ぶ友達を保存し、サーバーへまとめて反映</figcaption></figure>
      </div>
    </section>

    <section className="section invite-section" id="friends" aria-labelledby="invite-title">
      <div className="invite-copy">
        <div className="heading-with-status"><h2 id="invite-title">接続方式を選び、別の家の友達を招待</h2><StatusTag status="conditional" /></div>
        <p>家庭環境に応じてUPnPまたはplayit.gg中継を案内します。playit未導入時は配布元・版・容量・ライセンス・保存先を確認し、公式MSIの署名とSHA-256を検証してから導入します。</p>
        <div className="network-path" aria-label="中継トンネルの流れ"><span><Cpu aria-hidden="true" /><b>ホストPC</b></span><i aria-hidden="true" /><span><Network aria-hidden="true" /><b>playit中継</b></span><i aria-hidden="true" /><span><Users aria-hidden="true" /><b>友達</b></span></div>
        <ul className="limit-list">{limits.map((item) => <li key={item}><AlertTriangle aria-hidden="true" />{item}</li>)}</ul>
        <p className="truth-note compact"><UserCog aria-hidden="true" />中継対象はゲーム用ポートだけです。SQLite、設定、バックアップは公開せず、playitのパスワード、二要素認証コード、生トークンも保存しません。</p>
      </div>
      <figure className="product-shot"><img src="/screenshots/internet-invite-published.png" alt="インターネット公開中の接続アドレスと公開終了ボタンを表示する画面" /><figcaption><Network aria-hidden="true" />公開終了までホストが管理</figcaption></figure>
    </section>

    <section className="privacy-band" aria-labelledby="privacy-title">
      <div className="section"><SectionHeading id="privacy-title" title="診断もログ解析も、PCの中で" description="サーバー運用に必要なデータを、広告や外部診断のために送らない設計です。" /><div className="privacy-grid">{privacy.map(({ icon: Icon, title, body }) => <article key={title}><Icon aria-hidden="true" /><h3>{title}</h3><p>{body}</p></article>)}</div><p className="privacy-footnote"><Languages aria-hidden="true" />現行版にブラウザ遠隔管理・共同管理は含まれていません。アプリ画面は9言語に対応しますが、サーバーログや識別子は原文を保ちます。</p></div>
    </section>
  </>;
}
