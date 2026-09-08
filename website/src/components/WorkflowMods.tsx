import { AlertTriangle, ArchiveRestore, Check, FileArchive, FolderInput, Gamepad2, PackageCheck, Puzzle, Search, ShieldCheck } from "lucide-react";
import { SectionHeading, StatusTag } from "./Ui";

const serverTypes = [
  { name: "Vanilla", detail: "Minecraft公式Javaサーバー", status: "available" as const },
  { name: "Paper", detail: "プラグイン／クロスプレイ向け", status: "available" as const },
  { name: "Fabric", detail: "Modローダー・検証継続中", status: "conditional" as const },
  { name: "Forge", detail: "互換性検証を継続中", status: "conditional" as const },
  { name: "NeoForge", detail: "互換性検証を継続中", status: "conditional" as const },
  { name: "Bedrock", detail: "Windows向け統合版BDS", status: "conditional" as const },
  { name: "Palworld", detail: "SteamCMDから導入", status: "conditional" as const },
];

const importChecks = ["server.propertiesと起動対象", "種類・版・ワールド", "拡張機能と不足ファイル", "Java／ネイティブ実行・ポート・同意状況"];
const modChecks = ["Minecraft版とローダーで絞り込み", "Mod／プラグイン／データパックを区別", "サーバー／クライアント要件を表示", "必須依存関係を導入プランへ追加", "SHA-512／SHA-1でファイル検証", "導入前バックアップ、失敗時は未反映"];

export function WorkflowMods() {
  return <>
    <section className="section servers-section" id="servers" aria-labelledby="servers-title">
      <div className="server-copy">
        <SectionHeading id="servers-title" title="Minecraft 6系統とPalworldを管理" description="Java、ネイティブ実行、TCP、UDPの違いを保ちながら、共通の一覧から状態を確認できます。" />
        <div className="server-type-list">{serverTypes.map((server) => <div key={server.name}><span className="server-glyph" aria-hidden="true" /><strong>{server.name}</strong><small>{server.detail}</small><StatusTag status={server.status} /></div>)}</div>
      </div>
      <div className="import-panel">
        <div className="panel-title"><FolderInput aria-hidden="true" /><div><span>既存サーバーの取り込み</span><h3>登録までは読み取りだけ</h3></div></div>
        <p>Minecraft Java／Bedrockはフォルダーを変更する前に構成と不足ファイルを検査します。不完全なサーバーは安全に拒否し、初回バックアップも選べます。</p>
        <ul>{importChecks.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
        <p className="warning-inline"><AlertTriangle aria-hidden="true" />既存ファイルを自動で上書きしません。Palworldの既存環境取り込みは現行の案内対象外です。</p>
      </div>
    </section>

    <section className="game-band" aria-labelledby="game-support-title">
      <div className="section game-support-grid">
        <div className="game-support-copy">
          <div className="heading-with-status"><h2 id="game-support-title">BedrockとPalworldも、ゲームに合う方法で</h2><StatusTag status="conditional" /></div>
          <p>Java用の仕組みを無理に流用せず、BedrockはWindowsネイティブのUDPサーバー、PalworldはValve公式SteamCMDとローカルREST監視として扱います。</p>
          <ul className="check-list">
            <li><Check aria-hidden="true" />Bedrockの許可リスト、権限、アドオン、UDPポート</li>
            <li><Check aria-hidden="true" />PaperへGeyser／Floodgateを導入するクロスプレイ経路</li>
            <li><Check aria-hidden="true" />Palworldの管理資格情報をWindows資格情報マネージャーへ保存</li>
            <li><Check aria-hidden="true" />Palworld REST接続はアプリから127.0.0.1だけに限定</li>
            <li><Check aria-hidden="true" />保存に失敗したPalworldを自動で強制終了しない</li>
          </ul>
          <p className="truth-note compact"><AlertTriangle aria-hidden="true" />Bedrock／Palworldの実装と自動テストはありますが、全バージョン、一般PC、実クライアント接続を保証するものではありません。</p>
        </div>
        <div className="stacked-shots">
          <figure className="product-shot"><img src="/screenshots/palworld-pw0-pw2-light.png" alt="Palworld Dedicated ServerのUDPポート、ローカルREST API、資格情報保護を表示する設定画面" /><figcaption><Gamepad2 aria-hidden="true" />Palworld専用の安全な管理画面</figcaption></figure>
          <figure className="product-shot"><img src="/screenshots/floodgate-whitelist-light.png" alt="PaperサーバーでGeyserとFloodgateを使う統合版ホワイトリストの画面" /><figcaption><Gamepad2 aria-hidden="true" />Java版と統合版のメンバーを分離</figcaption></figure>
        </div>
      </div>
    </section>

    <section className="product-band" id="mods" aria-labelledby="mods-title">
      <div className="section product-split">
        <div className="product-copy">
          <div className="heading-with-status"><h2 id="mods-title">拡張機能を探して、内容を確認してから追加</h2><StatusTag status="conditional" /></div>
          <p>Minecraft Javaではローカルファイルに加えて、Modrinthの公式API／CDNからModの対応候補を検索できます。Bedrockはローカルアドオンを別の経路で扱います。</p>
          <ul className="check-list">{modChecks.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
          <div className="extension-types"><span><Puzzle aria-hidden="true" />Mod</span><span><PackageCheck aria-hidden="true" />Modパック</span><span><PackageCheck aria-hidden="true" />プラグイン</span><span><FileArchive aria-hidden="true" />データパック</span></div>
          <p className="truth-note compact"><ShieldCheck aria-hidden="true" />Modrinth、GeyserMC、playit.ggなどの公式提携製品ではありません。各配布元の規約とライセンスに従います。</p>
        </div>
        <figure className="product-shot"><img src="/screenshots/safe-extension-catalog-dark.png" alt="Mod導入前に対象サーバー、ファイル、必要な依存関係を確認する画面" /><figcaption><Search aria-hidden="true" />導入プランを確認してから反映</figcaption></figure>
      </div>
    </section>

    <section className="section profile-strip" aria-label="Modパックプロファイル">
      <ArchiveRestore aria-hidden="true" /><div><h2>構成だけを保存して、複製・比較・共有</h2><p>ModパックプロファイルはMinecraft版、ローダー、設定、拡張機能の一覧をJSONで扱います。Mod本体、認証情報、トークン、ワールドは含めません。</p></div><StatusTag status="available">開発版</StatusTag>
    </section>
  </>;
}
