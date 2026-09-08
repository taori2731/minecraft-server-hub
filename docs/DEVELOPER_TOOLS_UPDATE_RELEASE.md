# Developer Tools署名付き更新の公開手順

Phase D31ではDeveloper Tools専用フィードを次へ固定しています。

`https://raw.githubusercontent.com/taori2731/minecraft-server-hub-releases/main/developer-tools/latest.json`

一般向けMinecraft Server Hubの`latest.json`とは別ファイルです。Developer Toolsから任意URLへ切り替える設定は提供しません。

## 初回だけの注意

公開済み0.2.0には更新機能がないため、D30を含む0.3.0は一度だけ手動でインストールする必要があります。0.3.0以降は、この専用フィードから次の署名付きバージョンを確認できます。

## 0.3.1公開結果

- Release: `https://github.com/taori2731/minecraft-server-hub-releases/releases/tag/developer-tools-v0.3.1`
- 専用フィード: `https://raw.githubusercontent.com/taori2731/minecraft-server-hub-releases/main/developer-tools/latest.json`
- インストーラーSHA-256: `270B15D5B8BAB6C933ED5B5D03BA742F8AEDE66B148CB5BAF11CE83CE728EA36`
- 公開後にインストーラーと`.sig`を再取得し、SHA-256とUpdater用Minisign署名を検証済みです。
- 0.3.0の旧日時表示との互換性のため、0.3.1のフィードでは任意項目`pub_date`を省略します。0.3.1以降はUnix時刻を安全に各言語表示します。
- インストール済み0.3.0で0.3.1を検出し、明示同意後のダウンロード、署名検証、適用、再起動、Phase D31、0.3.1、最新状態をWindows実機で確認済みです。

## 0.3.0公開結果

- Release: `https://github.com/taori2731/minecraft-server-hub-releases/releases/tag/developer-tools-v0.3.0`
- 専用フィード: `https://raw.githubusercontent.com/taori2731/minecraft-server-hub-releases/main/developer-tools/latest.json`
- インストーラーSHA-256: `B1761F5EAE44D026E5009F4D14EC256654DC637B572F3BA88F4F94D81BACAA6D`
- 公開後にインストーラー、`.sig`、`latest.json`を再取得し、SHA-256とUpdater用Minisign署名を検証済みです。
- インストール済み0.3.0から専用フィードを確認し、最新バージョンとして認識することをWindows実機で確認済みです。

## 署名付き成果物を作る

秘密鍵はリポジトリへ保存しません。公開鍵と対応するTauri署名秘密鍵を、公開担当者が現在のPowerShellプロセスへ明示設定します。

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath 'C:\安全な保存先\minecraft-server-hub-updater.key' -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<秘密鍵作成時のパスワード>'
npm run build:developer-tools:update
```

通常の`npm run build:developer-tools:desktop`は開発確認用で、更新用`.sig`を要求しません。署名付き公開ビルドだけが`tauri.updater.conf.json`を追加読込します。

## マニフェストを作る

```powershell
.\scripts\create-developer-update-manifest.ps1 `
  -Version '0.3.1' `
  -DownloadUrl 'https://github.com/taori2731/minecraft-server-hub-releases/releases/download/developer-tools-v0.3.1/Minecraft.Server.Hub.Developer.Tools_0.3.1_x64-setup.exe' `
  -InstallerPath '.\developer-tools\src-tauri\target\release\bundle\nsis\Minecraft Server Hub Developer Tools_0.3.1_x64-setup.exe' `
  -Notes '更新内容' `
  -OutputPath '.\artifacts\developer-tools\updates\latest.json'
```

インストーラー、隣接する`.sig`、SHA-256、リリースノートを`developer-tools-v<version>`へ公開します。その後、検証済み`latest.json`だけを公開リポジトリの`developer-tools/latest.json`へ反映します。

## 失敗時の境界

- 起動時は確認だけで、ダウンロードとインストールは行いません。
- 画面でバージョンと更新内容を確認し、専用チェックへ同意するまで更新ボタンは無効です。
- Rust側でも`confirmed=true`、確認時と適用時のバージョン一致、固定HTTPSフィードを再確認します。
- Tauri署名検証またはインストーラー起動に失敗した場合、現在のDeveloper Toolsを維持します。
- ワークスペース、検査履歴、ライセンス台帳は更新フィードへ送信しません。
