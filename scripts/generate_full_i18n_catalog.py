"""Generate the checked-in UI translation catalog with offline Argos models.

This development-only script never runs in the shipped application. Set
ARGOS_PACKAGES_DIR to a temporary directory before running it so model files do
not become project dependencies.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import argostranslate.package
import argostranslate.translate
import ctranslate2
from opencc import OpenCC


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "src"
CATALOG_DIR = SOURCE_ROOT / "lib" / "translations"
LEGACY_OUTPUT = SOURCE_ROOT / "lib" / "generatedTranslations.ts"
TARGETS = {"de": "de", "es": "es", "fr": "fr", "ko": "ko", "pt-BR": "pb", "zh-CN": "zh"}
JAPANESE = re.compile(r"[ぁ-んァ-ヶ一-龠]")
JAPANESE_RUN = re.compile(r"[ぁ-んァ-ヶー一-龠]+")

ENGLISH_OVERRIDES = {
    "Minecraft 統合版": "Minecraft Bedrock Edition",
    "統合版（BDS）": "Bedrock Edition (BDS)",
    "Bedrock Dedicated Server": "Bedrock Dedicated Server",
    "Javaは必要ありません": "Java is not required",
    "Java不要": "No Java required",
    "公式版を自動取得（おすすめ）": "Download the official version automatically (recommended)",
    "ダウンロード済みZIPを選ぶ": "Choose a downloaded ZIP",
    "公式利用条件を起動前に確認": "Review the official terms before starting",
    "許可リスト": "Allowlist",
    "権限": "Permissions",
    "アドオン": "Add-ons",
    "Behavior Pack": "Behavior Pack",
    "Resource Pack": "Resource Pack",
    "統合版アドオンを追加": "Add Bedrock add-ons",
    "統合版の実行環境": "Bedrock runtime",
    "統合版サーバーの更新": "Update Bedrock server",
    "自動適用しません": "Not applied automatically",
    "Java版＋統合版": "Java + Bedrock Edition",
    "統合版から参加": "Join from Bedrock Edition",
    "ポート開放なしで統合版の友達を招待": "Invite Bedrock friends without port forwarding",
    "Eclipse Temurin 公式": "Official Eclipse Temurin",
    "Modrinthのダウンロード数順カタログの表示例です。": "This catalog example is sorted by Modrinth download count.",
    "この人を反映": "Apply this player",
    "アメジスト": "Amethyst",
    "エメラルド": "Emerald",
    "サバイバル": "Survival",
    "サーバー診断": "Server diagnostics",
    "シード": "Seed",
    "バージョン": "Version",
    "リソースパックを必須にする": "Require resource pack",
    "公式MSI": "Official MSI",
    "公式に近い標準サーバー": "Standard server close to the official version",
    "公式に近い設定": "Settings close to the official defaults",
    "公式アカウント認証": "Official account authentication",
    "公式エージェントの準備をブラウザデモで再現しました": "The official agent setup was reproduced in a browser demo.",
    "公式エージェントを準備しました": "Official agent is ready",
    "公式エージェントを確認中…": "Checking the official agent…",
    "公式セットアップ": "Official setup",
    "公式ログイン画面でアカウントを確認": "Verify your account on the official login page",
    "公式配布ファイル": "Official distribution file",
    "公式配布情報を確認中…": "Checking official distribution information…",
    "初回にWindowsファイアウォール確認が表示された場合は、信頼できるプライベートネットワークだけを許可してください。パブリックネットワークは許可しないでください。": "If Windows Firewall asks on first use, allow only trusted private networks. Do not allow public networks.",
    "検索": "Search",
    "登録中…": "Registering…",
    "確認付きサーバー更新": "Server updates with confirmation",
    "軽量なModローダー。Fabric Mod向け": "Lightweight mod loader for Fabric mods",
    "選択": "Select",
    "選択を保存": "Save selection",
    "選択中の「": "Selected: “",
    "選択解除": "Clear selection",
    "選択項目": "Selected item",
    "非公開": "Private",
    "ワールドを最初から作り直す": "Regenerate the world",
    "友達と遊べるようにする": "Make the server available to friends",
    "バックアップして導入": "Back up and install",
    "原因を調べる": "Run diagnostics",
    "本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。": "Production advertising, payments, and license authentication are not connected. Logs, world names, player names, and IP addresses are not sent for advertising.",
    "CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。": "CPU, memory, GPU, Java, and storage information is processed locally and is not sent automatically.",
    "管理画面・SQLite・バックアップは公開しません。": "The management interface, SQLite database, and backups are never exposed.",
    "ログは外部へ送信しません。": "Logs are not sent to external services.",
    "コピー": "Copy",
    "バックアップ": "Backups",
    "PCを診断": "Diagnose this PC",
    "保存先": "Storage location",
    "最近のログ": "Recent logs",
    "プレイヤー": "Players",
    "使用メモリ": "Memory usage",
    "起動時間": "Uptime",
    "いつものメンバー": "Regular players",
    "Java版": "Java Edition",
    "統合版専用": "Bedrock Edition only",
    "メンバーの種類": "Player edition",
    "Xboxゲーマータグ": "Xbox gamertag",
    "プレイヤー名": "Player name",
    "固定メンバーのXboxゲーマータグ": "Saved player's Xbox gamertag",
    "固定メンバーのプレイヤー名": "Saved player's Java username",
    "統合版のXboxゲーマータグ": "Bedrock player's Xbox gamertag",
    "Minecraft Java版の名前": "Minecraft Java username",
    "統合版ホワイトリスト": "Bedrock allowlist",
    "ホワイトリスト": "Whitelist",
    "権限者": "Operator",
    "変更を保存": "Save changes",
    "メンバーを保存": "Save player",
    "編集をやめる": "Cancel editing",
    "対応メンバーを反映": "Apply compatible players",
    "適用先:": "Target server:",
    "適用先: [[VAR0]]": "Target server: [[VAR0]]",
    "適用先のサーバーがありません": "No target server selected",
    "起動中のため即時反映します": "Applied immediately while the server is running",
    "停止中の設定ファイルへ保存します": "Saved to the settings files while the server is stopped",
    "起動・停止処理の完了後に適用できます": "Available after the start or stop operation finishes",
    "先にサーバーを作成または取り込んでください": "Create or import a server first",
    "編集": "Edit",
    "この人を反映": "Apply this player",
    "保存されたメンバーはいません。種類と名前を選んで追加してください。": "No regular players have been saved. Choose an edition and enter a name to add one.",
    "Java版の名前と統合版のXboxゲーマータグを分けて保存し、対応するサーバーへまとめて登録できます。保存しただけではサーバーを書き換えません。": "Save Java usernames and Bedrock Xbox gamertags separately, then apply them to compatible servers together. Saving a player does not change any server.",
    "統合版専用メンバーは、PaperではFloodgateの統合版ホワイトリスト、BDSでは許可リストへ反映します。Java版メンバーとは同名でも別に保存できます。": "Bedrock-only players are applied to the Floodgate allowlist on Paper or the allowlist on BDS. They are stored separately from Java players, even when the names match.",
    "アプリをアンインストール": "Uninstall the app",
    "Minecraft Server Hubの削除はWindowsの「インストールされているアプリ」から行います。確認なく削除は開始しません。": "Remove Minecraft Server Hub from Windows Installed apps. Nothing is uninstalled without your confirmation.",
    "Windowsのアンインストール画面を開く": "Open Windows uninstall settings",
    "サーバーフォルダーやワールドは、この操作だけでは削除しません。": "Opening this screen does not delete server folders or worlds.",
    "アンインストール画面を開く": "Open uninstall settings",
    "このボタンはWindows設定を開くだけです。サーバー、ワールド、バックアップ、アプリ管理データの削除はここでは実行しません。": "This button only opens Windows Settings. It does not delete servers, worlds, backups, or app data.",
    "統合版を招待": "Invite Bedrock players",
    "Java版＋統合版": "Java + Bedrock Edition",
    "このPaperサーバーと同じワールドへ、Java版の友達は通常のJavaアドレス、統合版の友達はここで作るUDPアドレスから参加します。": "Java and Bedrock players can join the same Paper world. Java players use the normal Java address; Bedrock players use the UDP address created here.",
    "Java版と統合版をつなぐ": "Connect Java and Bedrock Edition",
    "未導入": "Not installed",
    "統合版用UDPポート": "Bedrock UDP port",
    "Floodgateも導入する（統合版の友達はJavaアカウント不要）": "Also install Floodgate (Bedrock players do not need a Java account)",
    "公式導入内容を確認": "Review official installation",
    "このPaperサーバーへ導入できます": "Compatible with this Paper server",
    "現在の構成には導入できません": "Not compatible with the current configuration",
    "統合版用アドレスを作る": "Create a Bedrock address",
    "接続確認済み": "Connection verified",
    "接続先取得済み": "Endpoint ready",
    "準備中": "Preparing",
    "停止中": "Stopped",
    "統合版の招待を停止": "Stop Bedrock invite",
    "統合版の友達が入力する内容": "What your Bedrock friend should enter",
    "Minecraft統合版では、アドレスとポートを別々に入力します": "In Minecraft Bedrock, enter the address and port separately",
    "サーバーアドレス": "Server address",
    "サーバーポート": "Server port",
    "アドレスをコピー": "Copy address",
    "ポートをコピー": "Copy port",
    "Java版と統合版では参加アドレスと通信方式が別です。": "Java and Bedrock Edition use different connection addresses and network protocols.",
    "步骤": "Step",
    "步驟": "Step",
    "[[VAR0]]時間 [[VAR1]]分": "[[VAR0]] hours [[VAR1]] minutes",
    "Modrinthからの拡張導入": "Extensions from Modrinth",
    "Modパック": "Modpack",
    "公式API／CDNから対応版を確認します。": "Compatible versions are checked through the official API/CDN.",
    "クライアント側にも同じModパックが必要です。": "Clients also need the same Modpack.",
    "更新センターで管理": "Managed by the Update Center",
    "検索・対応版・ダウンロードは公式Modrinth API／CDNだけを使用します。": "Search, compatibility checks, and downloads use only the official Modrinth API/CDN.",
    "カタログで拡張機能を検索": "Search the catalog for extensions",
    "種類確認と変更前バックアップを行います": "The type is checked and a backup is made before changes.",
    "Modパックの保存先にシンボリックリンクがあります": "The Modpack destination contains a symbolic link.",
}

RESIDUAL_GLOSSARY = {
    "カタログ": "catalog", "この": "this", "サーバー": "server", "バージョン": "version",
    "ローダー": "loader", "検索": "search", "公式": "official", "選択": "selection",
    "中": "in progress", "非": "private", "シー": "seed", "リース": "Require", "メンバー": "members",
    "エー": "a", "ーク": "ork", "ア": "Amethyst", "サ": "Survival", "シード": "Seed",
    "ド": "d", "ー": "-",
}

LOCALE_OVERRIDES = {
    "de": {
        "本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。": "Produktivwerbung, Zahlungen und Lizenzprüfung sind nicht verbunden. Protokolle, Weltnamen, Spielernamen und IP-Adressen werden nicht zu Werbezwecken gesendet.",
        "CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。": "Informationen zu CPU, Arbeitsspeicher, GPU, Java und Speicherort werden lokal verarbeitet und nicht automatisch gesendet.",
        "管理画面・SQLite・バックアップは公開しません。": "Verwaltungsoberfläche, SQLite-Datenbank und Sicherungen werden niemals veröffentlicht.",
        "ログは外部へ送信しません。": "Protokolle werden nicht an externe Dienste gesendet.",
        "コピー": "Kopieren", "バックアップ": "Sicherungen", "PCを診断": "Diesen PC prüfen", "保存先": "Speicherort", "最近のログ": "Letzte Protokolle", "プレイヤー": "Spieler", "使用メモリ": "Speichernutzung", "起動時間": "Laufzeit", "[[VAR0]]時間 [[VAR1]]分": "[[VAR0]] Stunden [[VAR1]] Minuten",
    },
    "es": {
        "本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。": "La publicidad de producción, los pagos y la autenticación de licencias no están conectados. Los registros, nombres de mundos, nombres de jugadores y direcciones IP no se envían con fines publicitarios.",
        "CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。": "La información de CPU, memoria, GPU, Java y almacenamiento se procesa localmente y no se envía automáticamente.",
        "管理画面・SQLite・バックアップは公開しません。": "La interfaz de administración, la base de datos SQLite y las copias de seguridad nunca se exponen.",
        "ログは外部へ送信しません。": "Los registros no se envían a servicios externos.",
        "コピー": "Copiar", "バックアップ": "Copias de seguridad", "PCを診断": "Diagnosticar este PC", "保存先": "Ubicación de almacenamiento", "最近のログ": "Registros recientes", "プレイヤー": "Jugadores", "使用メモリ": "Uso de memoria", "起動時間": "Tiempo activo", "[[VAR0]]時間 [[VAR1]]分": "[[VAR0]] horas [[VAR1]] minutos",
    },
    "fr": {
        "本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。": "La publicité en production, les paiements et l’authentification des licences ne sont pas connectés. Les journaux, noms de mondes, noms de joueurs et adresses IP ne sont pas envoyés à des fins publicitaires.",
        "CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。": "Les informations sur le processeur, la mémoire, le GPU, Java et le stockage sont traitées localement et ne sont pas envoyées automatiquement.",
        "管理画面・SQLite・バックアップは公開しません。": "L’interface d’administration, la base SQLite et les sauvegardes ne sont jamais exposées.",
        "ログは外部へ送信しません。": "Les journaux ne sont pas envoyés à des services externes.",
        "コピー": "Copier", "バックアップ": "Sauvegardes", "PCを診断": "Diagnostiquer ce PC", "保存先": "Emplacement de stockage", "最近のログ": "Journaux récents", "プレイヤー": "Joueurs", "使用メモリ": "Utilisation de la mémoire", "起動時間": "Durée de fonctionnement", "[[VAR0]]時間 [[VAR1]]分": "[[VAR0]] heures [[VAR1]] minutes",
    },
    "ko": {
        "本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。": "운영 광고, 결제 및 라이선스 인증은 연결되어 있지 않습니다. 로그, 월드 이름, 플레이어 이름 및 IP 주소는 광고 목적으로 전송하지 않습니다.",
        "CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。": "CPU, 메모리, GPU, Java 및 저장 위치 정보는 로컬에서 처리하며 자동으로 전송하지 않습니다.",
        "管理画面・SQLite・バックアップは公開しません。": "관리 화면, SQLite 데이터베이스 및 백업은 외부에 공개하지 않습니다.",
        "ログは外部へ送信しません。": "로그는 외부 서비스로 전송하지 않습니다.",
        "コピー": "복사", "バックアップ": "백업", "PCを診断": "이 PC 진단", "保存先": "저장 위치", "最近のログ": "최근 로그", "プレイヤー": "플레이어", "使用メモリ": "메모리 사용량", "起動時間": "가동 시간", "[[VAR0]]時間 [[VAR1]]分": "[[VAR0]]시간 [[VAR1]]분",
    },
    "pt-BR": {
        "本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。": "Publicidade de produção, pagamentos e autenticação de licença não estão conectados. Logs, nomes de mundos, nomes de jogadores e endereços IP não são enviados para fins publicitários.",
        "CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。": "Informações de CPU, memória, GPU, Java e armazenamento são processadas localmente e não são enviadas automaticamente.",
        "管理画面・SQLite・バックアップは公開しません。": "A interface de administração, o banco SQLite e os backups nunca são expostos.",
        "ログは外部へ送信しません。": "Os logs não são enviados a serviços externos.",
        "コピー": "Copiar", "バックアップ": "Backups", "PCを診断": "Diagnosticar este PC", "保存先": "Local de armazenamento", "最近のログ": "Logs recentes", "プレイヤー": "Jogadores", "使用メモリ": "Uso de memória", "起動時間": "Tempo de atividade", "[[VAR0]]時間 [[VAR1]]分": "[[VAR0]] horas [[VAR1]] minutos",
    },
    "zh-CN": {
        "本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。": "生产环境广告、支付和许可证验证均未接入。日志、世界名称、玩家名称和 IP 地址不会用于广告，也不会为此目的发送。",
        "CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。": "CPU、内存、GPU、Java 和存储位置等信息仅在本机处理，不会自动发送。",
        "管理画面・SQLite・バックアップは公開しません。": "管理界面、SQLite 数据库和备份绝不会对外公开。",
        "ログは外部へ送信しません。": "日志不会发送到外部服务。",
        "コピー": "复制", "バックアップ": "备份", "PCを診断": "诊断此电脑", "保存先": "存储位置", "最近のログ": "最近日志", "プレイヤー": "玩家", "使用メモリ": "内存使用量", "起動時間": "运行时间", "[[VAR0]]時間 [[VAR1]]分": "[[VAR0]] 小时 [[VAR1]] 分钟",
    },
    "zh-TW": {
        "本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。": "正式環境廣告、付款與授權驗證均未連接。日誌、世界名稱、玩家名稱與 IP 位址不會用於廣告，也不會為此目的傳送。",
        "CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。": "CPU、記憶體、GPU、Java 與儲存位置等資訊僅在本機處理，不會自動傳送。",
        "管理画面・SQLite・バックアップは公開しません。": "管理介面、SQLite 資料庫與備份絕不會對外公開。",
        "ログは外部へ送信しません。": "日誌不會傳送到外部服務。",
        "コピー": "複製", "バックアップ": "備份", "PCを診断": "診斷此電腦", "保存先": "儲存位置", "最近のログ": "最近日誌", "プレイヤー": "玩家", "使用メモリ": "記憶體使用量", "起動時間": "執行時間", "[[VAR0]]時間 [[VAR1]]分": "[[VAR0]] 小時 [[VAR1]] 分鐘",
    },
}

for _locale, _value in {
    "de": "Im Update-Center verwaltet",
    "es": "Gestionado por el centro de actualizaciones",
    "fr": "Géré par le centre de mises à jour",
    "ko": "업데이트 센터에서 관리됨",
    "pt-BR": "Gerenciado pelo Centro de Atualizações",
    "zh-CN": "由更新中心管理",
    "zh-TW": "由更新中心管理",
}.items():
    LOCALE_OVERRIDES[_locale]["更新センターで管理"] = _value


def clean(value: str) -> str:
    value = value.replace("\\n", "\n").replace("\\t", "\t").replace("\\\"", '"').replace("\\'", "'")
    return re.sub(r"[ \t\r\f\v]+", " ", value).strip()


def extract() -> tuple[list[str], list[str]]:
    result = subprocess.run(
        ["node", str(ROOT / "scripts" / "extract_i18n_strings.mjs")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    payload = json.loads(result.stdout)
    return payload["exact"], payload["patterns"]


def install_pair(from_code: str, to_code: str) -> None:
    installed = {(pkg.from_code, pkg.to_code) for pkg in argostranslate.package.get_installed_packages()}
    if (from_code, to_code) in installed:
        return
    packages = argostranslate.package.get_available_packages()
    package = next(pkg for pkg in packages if pkg.from_code == from_code and pkg.to_code == to_code)
    argostranslate.package.install_from_path(package.download())


def translator(from_code: str, to_code: str):
    languages = argostranslate.translate.get_installed_languages()
    source = next(language for language in languages if language.code == from_code)
    target = next(language for language in languages if language.code == to_code)
    return source.get_translation(target)


def protect_markers(value: str) -> tuple[str, list[str]]:
    markers = re.findall(r"\[\[VAR\d+\]\]", value)
    protected = value
    for index, marker in enumerate(markers):
        protected = protected.replace(marker, f"ZXQVAR{index}QXZ")
    return protected, markers


def restore_markers(value: str, markers: list[str]) -> str:
    for index, marker in enumerate(markers):
        variants = [f"ZXQVAR{index}QXZ", f"ZXQVAR {index} QXZ", f"zxqvar{index}qxz"]
        for variant in variants:
            value = value.replace(variant, marker)
    return value


def apply_translation_batch(engine, values: list[str]) -> list[str]:
    protected_values: list[str] = []
    marker_sets: list[list[str]] = []
    for value in values:
        protected, markers = protect_markers(value)
        protected_values.append(protected)
        marker_sets.append(markers)
    while hasattr(engine, "underlying"):
        engine = engine.underlying
    package = engine.pkg
    backend = ctranslate2.Translator(str(package.package_path / "model"), device="cpu", compute_type="default")
    tokenized = [package.tokenizer.encode(value) for value in protected_values]
    prefix = [[package.target_prefix]] * len(tokenized) if package.target_prefix else None
    results = backend.translate_batch(
        tokenized,
        target_prefix=prefix,
        replace_unknowns=True,
        max_batch_size=64,
        batch_type="tokens",
        beam_size=4,
        num_hypotheses=1,
        length_penalty=0.2,
    )
    translated: list[str] = []
    for result, markers in zip(results, marker_sets):
        value = package.tokenizer.decode(result.hypotheses[0]).strip()
        if package.target_prefix and value.startswith(package.target_prefix):
            value = value[len(package.target_prefix):].lstrip()
        translated.append(restore_markers(value, markers))
    return translated


def repair_remaining_japanese(engine, values: list[str]) -> list[str]:
    repaired = values
    for _ in range(4):
        runs = sorted({match.group(0) for value in repaired for match in JAPANESE_RUN.finditer(value)})
        if not runs:
            return repaired
        replacements = dict(zip(runs, apply_translation_batch(engine, runs)))
        replacements.update({run: RESIDUAL_GLOSSARY[run] for run in runs if run in RESIDUAL_GLOSSARY})
        next_values = [JAPANESE_RUN.sub(lambda match: replacements[match.group(0)], value) for value in repaired]
        if next_values == repaired:
            return repaired
        repaired = next_values
    return repaired


def translate_pattern_batch(engine, values: list[str]) -> list[str]:
    split_values = [re.split(r"(\[\[VAR\d+\]\])", value) for value in values]
    segments = sorted({part for parts in split_values for part in parts if part and not part.startswith("[[VAR")})
    translated_segments = repair_remaining_japanese(engine, apply_translation_batch(engine, segments))
    translated = dict(zip(segments, translated_segments))
    return ["".join(part if part.startswith("[[VAR") else translated.get(part, part) for part in parts) for parts in split_values]


def render_locale_ts(locale: str, exact_catalog: dict, pattern_catalog: dict) -> str:
    payload_exact = json.dumps(exact_catalog[locale], ensure_ascii=False, indent=2)
    payload_patterns = json.dumps(pattern_catalog[locale], ensure_ascii=False, indent=2)
    return (
        "/* Generated by scripts/generate_full_i18n_catalog.py. Do not edit by hand. */\n"
        "import type { TranslationCatalog } from \"../translationCatalog\";\n\n"
        "const catalog: TranslationCatalog = {\n"
        f"  exact: {payload_exact},\n"
        f"  patterns: {payload_patterns},\n"
        "};\n\n"
        "export default catalog;\n"
    )


def write_catalogs(exact_catalog: dict, pattern_catalog: dict) -> None:
    CATALOG_DIR.mkdir(parents=True, exist_ok=True)
    for locale in exact_catalog:
        output = CATALOG_DIR / f"{locale}.ts"
        output.write_text(render_locale_ts(locale, exact_catalog, pattern_catalog), encoding="utf-8")
        print(f"Wrote {output}")
    LEGACY_OUTPUT.write_text(
        "/* Generated catalogs are split by locale in ./translations for lazy loading. */\n",
        encoding="utf-8",
    )
    print(f"Wrote {LEGACY_OUTPUT}")


def load_checked_in_catalog(locale: str) -> tuple[dict[str, str], dict[str, str]]:
    """Read the JSON object literals from an existing generated TypeScript catalog."""
    text = (CATALOG_DIR / f"{locale}.ts").read_text(encoding="utf-8")
    decoder = json.JSONDecoder()
    exact_marker = "  exact: "
    pattern_marker = "  patterns: "
    exact, _ = decoder.raw_decode(text, text.index(exact_marker) + len(exact_marker))
    patterns, _ = decoder.raw_decode(text, text.index(pattern_marker) + len(pattern_marker))
    return exact, patterns


def incremental_main() -> None:
    """Translate only newly extracted keys while preserving checked-in translations."""
    exact, patterns = extract()
    locales = ["ja", "en", *TARGETS.keys(), "zh-TW"]
    exact_catalog: dict[str, dict[str, str]] = {}
    pattern_catalog: dict[str, dict[str, str]] = {}
    for locale in locales:
        exact_catalog[locale], pattern_catalog[locale] = load_checked_in_catalog(locale)

    missing_exact = [source for source in exact if source not in exact_catalog["en"]]
    missing_patterns = [source for source in patterns if source not in pattern_catalog["en"]]
    print(f"Extracted {len(exact)} exact strings and {len(patterns)} dynamic patterns; missing {len(missing_exact)} + {len(missing_patterns)}")
    if missing_exact or missing_patterns:
        argostranslate.package.update_package_index()
        install_pair("ja", "en")
        for target in TARGETS.values():
            install_pair("en", target)

        ja_en = translator("ja", "en")
        translated_exact = repair_remaining_japanese(ja_en, apply_translation_batch(ja_en, missing_exact)) if missing_exact else []
        translated_patterns = translate_pattern_batch(ja_en, missing_patterns) if missing_patterns else []
        for source, value in zip(missing_exact, translated_exact):
            exact_catalog["en"][source] = ENGLISH_OVERRIDES.get(source, value)
        for source, value in zip(missing_patterns, translated_patterns):
            pattern_catalog["en"][source] = ENGLISH_OVERRIDES.get(source, value)

        unresolved = [(source, exact_catalog["en"][source]) for source in missing_exact if JAPANESE.search(exact_catalog["en"][source])]
        unresolved += [(source, pattern_catalog["en"][source]) for source in missing_patterns if JAPANESE.search(pattern_catalog["en"][source])]
        if unresolved:
            raise RuntimeError(f"English translations still contain Japanese: {unresolved[:10]}")

        for locale, target_code in TARGETS.items():
            engine = translator("en", target_code)
            locale_exact = apply_translation_batch(engine, [exact_catalog["en"][source] for source in missing_exact]) if missing_exact else []
            locale_patterns = translate_pattern_batch(engine, [pattern_catalog["en"][source] for source in missing_patterns]) if missing_patterns else []
            for source, value in zip(missing_exact, locale_exact):
                exact_catalog[locale][source] = LOCALE_OVERRIDES.get(locale, {}).get(source, value)
            for source, value in zip(missing_patterns, locale_patterns):
                pattern_catalog[locale][source] = LOCALE_OVERRIDES.get(locale, {}).get(source, value)

        converter = OpenCC("s2t")
        for source in missing_exact:
            exact_catalog["zh-TW"][source] = LOCALE_OVERRIDES.get("zh-TW", {}).get(source, converter.convert(exact_catalog["zh-CN"][source]))
        for source in missing_patterns:
            pattern_catalog["zh-TW"][source] = LOCALE_OVERRIDES.get("zh-TW", {}).get(source, converter.convert(pattern_catalog["zh-CN"][source]))

    for source, value in ENGLISH_OVERRIDES.items():
        if source in exact_catalog["en"]:
            exact_catalog["en"][source] = value
        if source in pattern_catalog["en"]:
            pattern_catalog["en"][source] = value
    for locale, overrides in LOCALE_OVERRIDES.items():
        for source, value in overrides.items():
            if source in exact_catalog[locale]:
                exact_catalog[locale][source] = value
            if source in pattern_catalog[locale]:
                pattern_catalog[locale][source] = value

    exact_catalog["ja"] = {source: source for source in exact}
    pattern_catalog["ja"] = {source: source for source in patterns}
    exact_catalog = {locale: {source: exact_catalog[locale][source] for source in exact} for locale in locales}
    pattern_catalog = {locale: {source: pattern_catalog[locale][source] for source in patterns} for locale in locales}
    write_catalogs(exact_catalog, pattern_catalog)


def apply_locale_overrides(locale: str, sources: list[str], values: list[str]) -> list[str]:
    overrides = LOCALE_OVERRIDES.get(locale, {})
    return [overrides.get(source, value) for source, value in zip(sources, values)]


def main() -> None:
    exact, patterns = extract()
    print(f"Extracted {len(exact)} exact strings and {len(patterns)} dynamic patterns")
    argostranslate.package.update_package_index()
    install_pair("ja", "en")
    for target in TARGETS.values():
        install_pair("en", target)

    ja_en = translator("ja", "en")
    english_exact = repair_remaining_japanese(ja_en, apply_translation_batch(ja_en, exact))
    english_exact = [ENGLISH_OVERRIDES.get(source, value) for source, value in zip(exact, english_exact)]
    english_patterns = translate_pattern_batch(ja_en, patterns)
    english_patterns = [ENGLISH_OVERRIDES.get(source, value) for source, value in zip(patterns, english_patterns)]
    english = english_exact + english_patterns
    unresolved = [(source, value) for source, value in zip(exact + patterns, english) if JAPANESE.search(value)]
    if unresolved:
        details = [(source, value, [f"U+{ord(char):04X}" for char in value]) for source, value in unresolved[:10]]
        raise RuntimeError(f"English translations still contain Japanese: {details}")
    translations: dict[str, list[str]] = {"ja": exact + patterns, "en": english}
    for locale, target_code in TARGETS.items():
        engine = translator("en", target_code)
        translations[locale] = apply_translation_batch(engine, english_exact) + translate_pattern_batch(engine, english_patterns)
        translations[locale] = apply_locale_overrides(locale, exact + patterns, translations[locale])
        print(f"Translated {locale}")
    converter = OpenCC("s2t")
    translations["zh-TW"] = [converter.convert(value) for value in translations["zh-CN"]]
    translations["zh-TW"] = apply_locale_overrides("zh-TW", exact + patterns, translations["zh-TW"])

    exact_count = len(exact)
    exact_catalog = {locale: dict(zip(exact, values[:exact_count])) for locale, values in translations.items()}
    pattern_catalog = {locale: dict(zip(patterns, values[exact_count:])) for locale, values in translations.items()}
    write_catalogs(exact_catalog, pattern_catalog)


if __name__ == "__main__":
    incremental_main() if os.environ.get("I18N_INCREMENTAL") == "1" else main()
