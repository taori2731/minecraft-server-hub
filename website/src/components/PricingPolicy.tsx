import { Ban, Check, HeartHandshake, Megaphone, Shield } from "lucide-react";
import { SectionHeading, StatusTag } from "./Ui";

const allFeatures = [
  "Minecraft／Palworldサーバーの作成・起動・停止",
  "Minecraft Java／Bedrockの既存サーバー取り込み",
  "Javaの自動準備とPC診断",
  "基本診断・ログ・ローカル監視",
  "手動バックアップ・復元と変更前の安全バックアップ",
  "予約・複数世代バックアップ（基盤実装済み・予約UI開発中）",
  "サーバーラボの試算・下書き・バックアップ付き反映",
  "Modrinthからの拡張導入と構成プロファイル",
  "複数サーバーの一括起動・安全停止・再起動（全員利用可）",
  "長期操作履歴と検索（全員利用可）",
  "CPU・メモリ・TPSのしきい値監視（全員利用可）",
  "Modパック構成の保存・共有（全員利用可）",
  "追加アクセント・カスタム色・アイコン密度（全員利用可）",
  "UPnP／playit.ggを使う基本的な友達招待",
  "Java／Bedrockのプレイヤー管理とダーク・ライトテーマ",
];
const supporterCandidates = [
  "将来追加する新機能の先行体験（候補）",
  "開発中機能へのフィードバック参加（候補）",
  "限定外観（候補）",
];

export function PricingPolicy() {
  return (
    <>
      <section className="section support-section" id="pricing" aria-labelledby="pricing-title">
        <SectionHeading id="pricing-title" title="基本・安全・高度な運用は全員無料" description="安定機能と安全機能に、支援の有無による利用制限は設けません。TomoNodeへの支援は任意です。" align="center" />
        <div className="support-grid">
          <article className="plan plan-all"><div className="plan-heading"><div><span>全員に提供</span><h3>基本・安全・高度な運用</h3></div><StatusTag status="available">全員利用可</StatusTag></div><ul>{allFeatures.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul><a className="button button-primary" href="#download">公開版の機能と資産を確認</a></article>
          <article className="plan plan-support"><div className="plan-heading"><div><span>任意支援</span><h3>TomoNodeを応援</h3></div><StatusTag status="preparing">支援受付は準備中</StatusTag></div><ul>{supporterCandidates.map((item) => <li key={item}><HeartHandshake aria-hidden="true" />{item}</li>)}</ul><p className="support-intake">支援受付は準備中</p><p className="support-details">支援先、金額、決済方法、ライセンス条件は未決定です。候補は将来の検討内容であり、現在の提供機能を表しません。</p></article>
        </div>
        <figure className="support-preview"><img src="/screenshots/operations-center-dark.png" alt="MinecraftとPalworldの複数サーバーを一覧し、一括操作や安全停止を行う開発版画面" /><figcaption>高度な運用の画面も、支援の有無にかかわらず全員が利用できます。</figcaption></figure>
        <p className="support-note">支援停止後も、安全機能、バックアップと復元、サーバーデータへのアクセスを制限しません。広告ネットワークや決済処理、支援状態によるライセンス判定は接続していません。</p>
      </section>

      <section className="policy-band" id="policy" aria-labelledby="policy-title">
        <div className="policy-inner">
          <SectionHeading id="policy-title" title="支援とプライバシーの方針" description="安定機能と安全機能は全員へ提供し、任意支援の内容とデータの扱いを明確にします。" />
          <div className="policy-grid">
            <article><Ban aria-hidden="true" /><h3>広告や強制支援を前提にしない</h3><p>基本・安全・高度な運用を全員へ提供します。広告非表示などの制限解除を支援条件にはしません。</p></article>
            <article><Shield aria-hidden="true" /><h3>診断情報を販売しない</h3><p>サーバーログ、IP、プレイヤー名、PC診断情報を広告や販売目的で外部送信しません。</p></article>
            <article><HeartHandshake aria-hidden="true" /><h3>任意支援は準備中</h3><p>将来の新機能の先行体験、フィードバック参加、限定外観は候補です。支援先、金額、決済、ライセンス条件は未決定です。</p></article>
          </div>
          <div className="privacy-strip" id="legal"><Shield aria-hidden="true" /><div><h3>安全性とプライバシー</h3><p>支援停止後も安全機能、バックアップと復元、サーバーデータへのアクセスを制限しません。PC診断は端末内での確認を基本とし、正式なプライバシーポリシー、利用規約、ライセンス文書は公開前に整備します。</p></div><Megaphone aria-hidden="true" /></div>
        </div>
      </section>
    </>
  );
}
