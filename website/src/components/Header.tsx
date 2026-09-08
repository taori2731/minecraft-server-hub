import { Menu, Moon, Sun, X } from "lucide-react";
import { useState } from "react";
import type { Theme } from "../App";
import { Brand } from "./Brand";

const navItems = [["機能", "#features"], ["対応ゲーム", "#servers"], ["安全性", "#safety"], ["現在の状態", "#updates"], ["FAQ", "#faq"]] as const;

export function Header({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Minecraft Server Hub トップへ"><Brand /></a>
      <nav className="desktop-nav" aria-label="メインナビゲーション">
        {navItems.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
      </nav>
      <div className="header-actions">
        <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={`${theme === "dark" ? "ライト" : "ダーク"}テーマに切り替える`} aria-pressed={theme === "light"}>
          {theme === "dark" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        </button>
        <button className="menu-toggle" type="button" aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen((current) => !current)}>
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
      <nav className={`mobile-nav${menuOpen ? " is-open" : ""}`} id="mobile-navigation" aria-label="モバイルナビゲーション">
        {navItems.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        <a href="#download" onClick={() => setMenuOpen(false)}>Windows版を準備中</a>
      </nav>
    </header>
  );
}
