import { Blocks, Code2, Cpu, FileCheck2, FileCog, Gauge, HardDrive, Languages, Server, ShieldCheck, Sparkles, SquareTerminal } from "lucide-react";
import { SectionHeading, StatusTag } from "./Ui";

const steps = [
  { number: "01", icon: Server, title: "ゲームを選ぶ", body: "Minecraft Java、Bedrock、Palworldから選びます。" },
  { number: "02", icon: Cpu, title: "PCを確認", body: "CPU、メモリ、空き容量、必要な実行環境をPC内で確認します。" },
  { number: "03", icon: Sparkles, title: "遊び方を選ぶ", body: "サーバー種類や遊び方に合う初期設定を選びます。" },
  { number: "04", icon: Code2, title: "公式配布を確認", body: "取得元、版、容量、ライセンス、保存先を確認してから準備します。" },
  { number: "05", icon: Blocks, title: "設定とポート", body: "ワールド、参加人数、権限、ゲーム用ポートを設定します。" },
  { number: "06", icon: ShieldCheck, title: "最終確認", body: "変更内容と必要な同意を確認し、本人の操作で作成します。" },
] as const;

const highlights = [
  { icon: Gauge, title: "状態と負荷をまとめて把握", body: "プレイヤー数、CPU、メモリ、対応サーバーのTPS、稼働時間、最近のログをローカルで確認。" },
  { icon: SquareTerminal, title: "ゲームに合う安全な停止", body: "Minecraftは保存コマンド、PalworldはローカルREST APIの保存成功を確認してから停止を要求します。" },
  { icon: HardDrive, title: "既存環境も引き継ぐ", body: "Minecraft Java／Bedrockのサーバーフォルダーを読み取り検査し、内容を確認して登録できます。" },
  { icon: FileCheck2, title: "変更前に守り、署名を確認", body: "設定や拡張、復元、サーバー更新の前にバックアップ。アプリ更新は署名検証に成功した場合だけ適用します。" },
  { icon: Languages, title: "9言語の画面", body: "日本語を含む9言語を選択可能。サーバーの実ログや固有値は勝手に翻訳しません。" },
] as const;

export function OverviewFeatures() {
  return <>
    <section className="section setup-section" id="overview" aria-labelledby="setup-title">
      <SectionHeading id="setup-title" title="ゲームが違っても、6ステップでセットアップ" description="Java、ネイティブ実行、TCP／UDPの違いをアプリ側で整理し、必要な確認を順番に案内します。" />
      <ol className="setup-rail">
        {steps.map(({ number, icon: Icon, title, body }) => <li key={number}><span className="step-number">{number}</span><Icon aria-hidden="true" /><h3>{title}</h3><p>{body}</p></li>)}
      </ol>
      <p className="truth-note"><ShieldCheck aria-hidden="true" />診断の推奨人数や設定値は安全側の目安です。実際の性能、対応ゲーム、Mod、ワールド、回線によって上限は変わります。</p>
    </section>

    <section className="feature-band" id="features" aria-labelledby="features-title">
      <div className="section feature-inner">
        <div className="feature-intro"><SectionHeading id="features-title" title="作る、動かす、守るをひとつの画面で" description="MinecraftとPalworldの違いを保ちながら、日々のサーバー運用に必要な操作をまとめています。" /><StatusTag status="available" /></div>
        <div className="highlight-list">{highlights.map(({ icon: Icon, title, body }) => <article key={title}><Icon aria-hidden="true" /><div><h3>{title}</h3><p>{body}</p></div><FileCog aria-hidden="true" className="row-end-icon" /></article>)}</div>
      </div>
    </section>
  </>;
}
