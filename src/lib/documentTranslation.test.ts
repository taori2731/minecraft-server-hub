import { afterEach, beforeAll, describe, expect, it } from "vitest";
import japaneseCatalog from "./translations/ja";
import { installDocumentTranslation, translateGeneratedText } from "./documentTranslation";
import type { AppLocale } from "./i18n";
import { getTranslationCatalog, loadTranslationCatalog } from "./translationCatalog";

const locales: AppLocale[] = ["en", "ja", "zh-CN", "zh-TW", "ko", "es", "de", "fr", "pt-BR"];
const japaneseKana = /[\u3041-\u30fa]/;
const cjkIdeograph = /[\u3400-\u9fff]/;

beforeAll(async () => {
  await Promise.all(locales.filter((locale) => locale !== "ja").map(loadTranslationCatalog));
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("generated UI translations", () => {
  it("keeps every locale aligned with the Japanese source catalog", () => {
    const exactKeys = Object.keys(japaneseCatalog.exact);
    const patternKeys = Object.keys(japaneseCatalog.patterns);
    expect(exactKeys.length).toBeGreaterThan(1_400);
    expect(patternKeys.length).toBeGreaterThan(130);
    for (const locale of locales) {
      const catalog = locale === "ja" ? japaneseCatalog : getTranslationCatalog(locale);
      expect(Object.keys(catalog.exact)).toEqual(exactKeys);
      expect(Object.keys(catalog.patterns)).toEqual(patternKeys);
    }
  });

  it("contains no Japanese or damaged replacement characters in non-Japanese values", () => {
    for (const locale of locales.filter((value) => value !== "ja")) {
      const catalog = getTranslationCatalog(locale);
      const values = [...Object.values(catalog.exact), ...Object.values(catalog.patterns)];
      expect(values.filter((value) => japaneseKana.test(value))).toEqual([]);
      expect(values.filter((value) => value.includes("�"))).toEqual([]);
    }
  });

  it("contains no Japanese ideographs in Latin-script and Korean catalogs", () => {
    for (const locale of ["en", "ko", "es", "de", "fr", "pt-BR"] satisfies AppLocale[]) {
      const catalog = getTranslationCatalog(locale);
      const values = [...Object.values(catalog.exact), ...Object.values(catalog.patterns)];
      expect(values.filter((value) => cjkIdeograph.test(value))).toEqual([]);
    }
  });

  it("preserves every dynamic placeholder in every locale", () => {
    for (const source of Object.keys(japaneseCatalog.patterns)) {
      const sourceMarkers = source.match(/\[\[VAR\d+\]\]/g) ?? [];
      for (const locale of locales) {
        const catalog = locale === "ja" ? japaneseCatalog : getTranslationCatalog(locale);
        expect(catalog.patterns[source].match(/\[\[VAR\d+\]\]/g) ?? []).toEqual(sourceMarkers);
      }
    }
  });
});

describe("document translation", () => {
  it("translates exact and dynamic strings while preserving runtime values", () => {
    expect(translateGeneratedText("サーバー診断", "en")).toBe("Server diagnostics");
    const dynamic = translateGeneratedText("Minecraft更新先: 1.21.4", "en");
    expect(dynamic).toContain("1.21.4");
    expect(dynamic).not.toMatch(japaneseKana);
    expect(translateGeneratedText("1時間 24分", "en")).toBe("1 hours 24 minutes");
    expect(translateGeneratedText("人気のプラグイン", "en")).toBe("Popular Plugin");
    expect(translateGeneratedText("このPC（合計約32 GiB）に合わせたJava起動設定", "es")).toBe("Ajustes de inicio de Java adaptados a este PC (unos 32 GiB en total)");
    expect(translateGeneratedText("1〜16 GiBから選べるJava起動設定", "ko")).toBe("1~16 GiB에서 선택할 수 있는 Java 실행 메모리");
  });

  it("keeps the destructive confirmation phrase as Delete in every language", () => {
    for (const locale of locales) {
      const translated = translateGeneratedText("確認のため「Delete」と入力", locale);
      expect(translated).toContain("Delete");
      if (locale !== "ja") expect(translated).not.toMatch(japaneseKana);
    }
  });

  it("translates visible text and accessible attributes but leaves logs untouched", () => {
    document.body.innerHTML = `
      <main>
        <button aria-label="サーバー診断" title="原因を調べる">サーバー診断</button>
        <input placeholder="検索" />
        <pre>[INFO] サーバーを起動しました</pre>
      </main>`;
    const stopEnglish = installDocumentTranslation("en");
    const button = document.querySelector("button")!;
    expect(button.textContent).toBe("Server diagnostics");
    expect(button.getAttribute("aria-label")).toBe("Server diagnostics");
    expect(button.getAttribute("title")).toBe("Run diagnostics");
    expect(document.querySelector("input")?.getAttribute("placeholder")).toBe("Search");
    expect(document.querySelector("pre")?.textContent).toContain("サーバーを起動しました");
    stopEnglish();

    const stopJapanese = installDocumentTranslation("ja");
    expect(button.textContent).toBe("サーバー診断");
    expect(button.getAttribute("title")).toBe("原因を調べる");
    stopJapanese();
  });

  it("translates log empty states while preserving actual Minecraft log rows", () => {
    document.body.innerHTML = `
      <main>
        <div class="recent-log-list">
          <div class="recent-log-row" data-no-translate>[INFO] サーバーを起動しました</div>
          <div class="empty-log">サーバーを起動すると、ここに最近のログが表示されます。</div>
        </div>
        <div class="console-log">
          <div data-no-translate>[WARN] ワールドを保存しました</div>
          <p class="empty-log">一致するログはありません。</p>
        </div>
      </main>`;

    const stopSpanish = installDocumentTranslation("es");
    expect(document.querySelector(".recent-log-row")?.textContent).toContain("サーバーを起動しました");
    expect(document.querySelector(".recent-log-list .empty-log")?.textContent).toBe("Inicia el servidor para mostrar aquí los registros recientes.");
    expect(document.querySelector(".console-log > div")?.textContent).toContain("ワールドを保存しました");
    expect(document.querySelector(".console-log .empty-log")?.textContent).toBe("No hay registros que coincidan.");
    stopSpanish();
  });

  it("provides deliberate log empty-state copy for every supported language", () => {
    for (const locale of locales.filter((value) => value !== "ja")) {
      expect(translateGeneratedText("サーバーを起動すると、ここに最近のログが表示されます。", locale)).not.toMatch(japaneseKana);
      expect(translateGeneratedText("一致するログはありません。", locale)).not.toMatch(japaneseKana);
    }
  });

  it("uses deliberate translations for the overview and console controls shown in every locale", () => {
    expect(translateGeneratedText("ワールドフォルダーを開く", "es")).toBe("Abrir carpeta del mundo");
    expect(translateGeneratedText("クリア", "es")).toBe("Limpiar");
    expect(translateGeneratedText("オンライン", "ko")).toBe("온라인");
    expect(translateGeneratedText("ログを検索", "ko")).toBe("로그 검색");
    expect(translateGeneratedText("送信", "ko")).toBe("보내기");
    expect(translateGeneratedText("チャンク数はMinecraft共通APIがないため非表示", "zh-TW")).toBe("由於 Minecraft 沒有通用 API，因此不顯示區塊數量。");
  });

  it("keeps diagnosis and online-player counters out of Japanese and avoids the Home mistranslation", () => {
    for (const locale of locales.filter((value) => value !== "ja")) {
      for (const source of ["6コア / 12スレッド", "6コア / 12スレッド · 使用率 25%", "22人", "現在参加しているプレイヤーはいません。", "サーバー起動後に参加中のプレイヤーが表示されます。"]) {
        const translated = translateGeneratedText(source, locale);
        expect(translated).not.toMatch(japaneseKana);
        expect(translated).not.toContain("Home");
      }
    }
    expect(translateGeneratedText("6コア / 12スレッド", "en")).toBe("6 cores / 12 threads");
    expect(translateGeneratedText("22人", "es")).toBe("22 jugadores");
    expect(translateGeneratedText("0人", "ko")).toBe("0명");
    expect(translateGeneratedText("現在参加しているプレイヤーはいません。", "en")).toBe("No players are currently online.");
  });

  it("translates the dedicated Floodgate whitelist UI in every supported language", () => {
    const terms = [
      "統合版ホワイトリスト",
      "Geyser／Floodgateから参加するプレイヤー",
      "統合版プレイヤーを追加",
      "Xboxゲーマータグ（接頭辞は不要）",
      "Floodgate専用",
      "公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。",
      "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。",
    ];
    for (const locale of locales.filter((value) => value !== "ja")) {
      for (const term of terms) expect(translateGeneratedText(term, locale)).not.toMatch(japaneseKana);
    }
    expect(translateGeneratedText("統合版ホワイトリスト", "en")).toBe("Bedrock whitelist");
    expect(translateGeneratedText("Xboxゲーマータグ（接頭辞は不要）", "es")).toBe("Gamertag de Xbox (sin prefijo)");
  });

  it("translates the separated Bedrock address and port guidance in every supported language", () => {
    const terms = [
      "統合版の友達が入力する内容",
      "Minecraft統合版では、アドレスとポートを別々に入力します",
      "サーバーアドレス",
      "サーバーポート",
      "アドレスをコピー",
      "ポートをコピー",
      "統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。",
      "「サーバー」→「サーバーを追加」を選ぶ",
      "上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する",
      "Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。",
    ];
    for (const locale of locales.filter((value) => value !== "ja")) {
      for (const term of terms) expect(translateGeneratedText(term, locale)).not.toMatch(japaneseKana);
    }
    expect(translateGeneratedText("サーバーアドレス", "en")).toBe("Server Address");
    expect(translateGeneratedText("サーバーポート", "ko")).toBe("서버 포트");
  });

  it("uses deliberate Bedrock world-setting terms in every supported language", () => {
    const terms = ["ビジター", "メンバー", "オペレーター", "許可リストを有効にする", "ポート番号（UDP）", "空きを選ぶ", "PvPを有効にする", "シングルプレイに近いワールド生成設定", "確認とEULA"];
    for (const locale of locales.filter((value) => value !== "ja")) {
      for (const term of terms) expect(translateGeneratedText(term, locale)).not.toMatch(japaneseKana);
    }
    expect(translateGeneratedText("ビジター", "pt-BR")).toBe("Visitante");
    expect(translateGeneratedText("オペレーター", "ko")).toBe("운영자");
    expect(translateGeneratedText("空きを選ぶ", "de")).toBe("Freien Port wählen");
  });

  it("translates the Bedrock add-on and pending-operator guidance in every supported language", () => {
    const terms = [
      "公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。",
      "追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。",
      "XUID待ち・権限はまだ未反映",
      "プレイヤーが一度参加するとXUIDを確認し、もう一度「権限を登録」で確定できます。",
      "参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。",
      "待機を取消",
    ];
    for (const locale of locales.filter((value) => value !== "ja")) {
      for (const term of terms) expect(translateGeneratedText(term, locale)).not.toMatch(japaneseKana);
    }
  });

  it("translates Rust runtime diagnostics and preserves their dynamic values", () => {
    for (const locale of locales.filter((value) => value !== "ja")) {
      expect(translateGeneratedText("診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。", locale)).not.toMatch(japaneseKana);
      const javaMismatch = translateGeneratedText("Java 21以上が必要です。現在はJava 17です", locale);
      expect(javaMismatch).not.toMatch(japaneseKana);
      expect(javaMismatch).toContain("21");
      expect(javaMismatch).toContain("17");
    }
  });

  it("uses deliberate Minecraft terminology for every Server Lab language", () => {
    const terms = [
      "サーバーラボ", "遊び方プリセット", "性能プリセット", "人数・メモリプランナー",
      "チャンク・保護範囲の推定", "ワールドシード生成", "ポート検査と提案",
      "公開前セキュリティ監査", "未保存の変更差分", "server.properties変更案",
      "バックアップして全変更を保存",
    ];
    for (const locale of locales.filter((value) => value !== "ja")) {
      for (const term of terms) expect(translateGeneratedText(term, locale)).not.toMatch(japaneseKana);
    }
    expect(translateGeneratedText("ポート検査と提案", "de")).toBe("Portprüfung und -vorschlag");
    expect(translateGeneratedText("チャンク・保護範囲の推定", "ko")).toBe("청크 및 스폰 보호 범위 추정");
    expect(translateGeneratedText("未保存の変更差分", "fr")).toBe("Modifications non enregistrées");
    expect(translateGeneratedText("server.properties変更案", "zh-TW")).toBe("server.properties 變更建議");
  });
});
