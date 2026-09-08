import { Ban, Check, HeartHandshake, Megaphone, Shield, Star } from "lucide-react";
import { SectionHeading, StatusTag } from "./Ui";

const freeFeatures = [
  "Minecraft／Palworldサーバーの作成・起動・停止",
  "Minecraft Java／Bedrockの既存サーバー取り込み",
  "Javaの自動準備とPC診断",
  "基本診断・ログ・ローカル監視",
  "手動バックアップ・復元と変更前の安全バックアップ",
  "サーバーラボの試算・下書き・バックアップ付き反映",
  "Modrinthからの拡張導入",
  "UPnP／playit.ggを使う基本的な友達招待",
  "Java／Bedrockのプレイヤー管理とダーク・ライトテーマ",
];
const proFeatures = [
  "予約・複数世代バックアップ（基盤実装済み・予約UI開発中）",
  "複数サーバーの一括起動・安全停止・再起動（開発版で利用可能）",
  "長期操作履歴と検索（開発版で利用可能）",
  "CPU・メモリ・TPSのしきい値監視（開発版で利用可能）",
  "Modパック構成の保存・共有（開発版で利用可能）",
  "追加アクセント・カスタム色・アイコン密度（開発版で利用可能）",
  "優先サポート（提供体制の準備後）",
];

export function PricingPolicy() {
  return (
    <>
      <section className="section pricing-section" id="pricing" aria-labelledby="pricing-title">
        <SectionHeading id="pricing-title" title="基本機能と安全機能は無料のまま" description="Pro版は複数サーバー運用を便利にする開発支援版として検討中です。現時点では購入できません。" align="center" />
        <div className="pricing-grid">
          <article className="plan plan-free"><div className="plan-heading"><div><span>無料版</span><h3>基本機能を無料で</h3></div><StatusTag status="available">開発版</StatusTag></div><p className="plan-price">¥0 <small>基本機能</small></p><ul>{freeFeatures.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul><a className="button button-primary" href="#download">無料で始める</a></article>
          <article className="plan plan-pro"><div className="plan-heading"><div><span>Pro / サポーター版</span><h3>もっと便利に運用</h3></div><StatusTag status="developing">開発中</StatusTag></div><p className="plan-price plan-price-undecided">価格未定 <small>買い切り方式を検討中</small></p><ul>{proFeatures.map((item) => <li key={item}><Star aria-hidden="true" />{item}</li>)}</ul><button className="button button-disabled" type="button" disabled>準備中（購入・認証なし）</button></article>
        </div>
        <figure className="pro-preview"><img src="/screenshots/pro-operations-amethyst.png" alt="開発版Pro運用で複数サーバーを選び、一括起動・安全停止・再起動する画面" /><figcaption>Pro候補機能は開発版UIで検証中。提供開始・価格・購入権は未確定です。</figcaption></figure>
        <p className="pricing-note">本番の決済・ライセンス認証は接続していません。価格・税・返金・提供地域も未確定です。復元、診断、Java準備、変更前バックアップ、基本招待などの安全機能を有料限定にはしません。</p>
      </section>

      <section className="policy-band" id="policy" aria-labelledby="policy-title">
        <div className="policy-inner">
          <SectionHeading id="policy-title" title="支援とプライバシーの方針" description="有料版を検討する段階から、無料機能とデータの扱いを明確にします。" />
          <div className="policy-grid">
            <article><Ban aria-hidden="true" /><h3>広告を前提にしない</h3><p>無料版へ広告を追加して「広告非表示」を販売する計画はありません。</p></article>
            <article><Shield aria-hidden="true" /><h3>診断情報を販売しない</h3><p>サーバーログ、IP、プレイヤー名、PC診断情報を広告や販売目的で外部送信しません。</p></article>
            <article><HeartHandshake aria-hidden="true" /><h3>支援版は準備中</h3><p>購入・決済・ライセンス認証は未接続です。実装していない機能を提供中とは表示しません。</p></article>
          </div>
          <div className="privacy-strip" id="legal"><Shield aria-hidden="true" /><div><h3>安全性とプライバシー</h3><p>PC診断は端末内での確認を基本とし、必要最小限の情報だけを扱う方針です。正式なプライバシーポリシー、利用規約、ライセンス文書は公開前に整備します。</p></div><Megaphone aria-hidden="true" /></div>
        </div>
      </section>
    </>
  );
}
