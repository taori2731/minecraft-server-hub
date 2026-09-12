import { ChevronDown, List, MonitorDown } from "lucide-react";

export function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title">自分のWindows PCを、<br /><span>ゲームサーバー</span>に。</h1>
        <p className="hero-support">Minecraft Java／BedrockとPalworldの専用サーバーを、作成・監視・保護・更新。友達と遊ぶ準備まで、ひとつのアプリで案内します。</p>
        <div className="hero-actions" aria-label="主な操作">
          <a className="button button-primary" href="#download"><MonitorDown aria-hidden="true" />Windows版を準備中</a>
          <a className="button button-secondary" href="#features"><List aria-hidden="true" />機能を見る</a>
        </div>
        <p className="unofficial-note">開発版 0.4.1・一般公開準備中・Minecraft／Palworldの公式製品ではありません</p>
      </div>
      <figure className="hero-product"><img src="/screenshots/operations-center-dark.png" alt="MinecraftとPalworldの複数サーバーを一覧し、自動停止やローカル通知を設定する開発版画面" /><figcaption>実際の0.3.2開発版画面</figcaption></figure>
      <a className="scroll-cue" href="#overview" aria-label="概要へ移動"><ChevronDown aria-hidden="true" /></a>
    </section>
  );
}
