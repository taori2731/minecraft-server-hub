# アプリ更新の配布手順

Minecraft Server Hubの通常のアプリ内更新は、0.3.9と同じTauri Updaterの署名方式を使います。Windows NSISインストーラーに隣接する`.sig`を、アプリへ埋め込んだ`src-tauri/updater-public.key`で検証できることが更新の必須条件です。

SignPathへの申請とWindows Authenticode署名は、通常のアプリ内更新の必須条件ではありません。このリリース経路ではSignPathへ成果物を送らず、Authenticodeの`Valid`ゲートも設けません。Windowsの発行元表示が必要な場合のAuthenticode署名は、更新のTauri署名ゲートとは別の任意の工程として扱います。

## 変更してはいけない信頼境界

- `src-tauri/updater-public.key`を変更しません。
- `src-tauri/tauri.conf.json`の`plugins.updater.pubkey`を変更しません。
- 0.3.9を署名したものと同じTauri秘密鍵だけを使います。鍵が見つからない、または検証に失敗した場合は新しい鍵を作らず停止します。
- 秘密鍵、鍵パスワード、GitHubトークンをソース、成果物、マニフェスト、ログへ出しません。
- 既存の`v0.3.9` Release、タグ、資産は削除・上書きしません。

公開フィードは次の固定URLです。

`https://github.com/taori2731/minecraft-server-hub-releases/releases/latest/download/latest.json`

`latest.json`内のWindows URLも、認証情報・クエリ・フラグメントを含まないHTTPS URLでなければなりません。

## GitHub Actionsの秘密情報

`Release Windows updater`を実行する前に、ソースリポジトリへ次のActions Secretを登録します。

| Secret | 用途 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 0.3.9と同じTauri updater秘密鍵 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 秘密鍵を暗号化している場合だけ必須 |
| `RELEASE_REPO_TOKEN` | `taori2731/minecraft-server-hub-releases`へDraft/Releaseを書き込む最小権限トークン |

`RELEASE_REPO_TOKEN`は署名鍵ではありません。別リポジトリへ公開するための権限だけを持つFine-grained tokenとして作成し、対象を`minecraft-server-hub-releases`に限定します。どのSecretの値もチャットやログへ貼り付けません。

## 0.3.10の自動リリース

Actionsの`Release Windows updater`を`main`から手動実行し、入力は必ず次にします。

- `version`: `0.3.10`
- `release_tag`: `v0.3.10`

ワークフローは次の順序で停止点を設けます。

1. `main`、入力値、`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`の版番号を確認します。
2. `npm run check`、アプリ/Rust/Developer Tools/UI/websiteの回帰テストとビルドを実行します。
3. Windows x64 NSISをビルドします。
4. 最終リリース名`Minecraft.Server.Hub_0.3.10_x64-setup.exe`へコピーし、その最終バイト列にTauri Updater`.sig`を生成します。
5. 埋め込み公開鍵で`.sig`を検証します。
6. インストーラーのSHA-256を`SHA256SUMS.txt`へ記録し、認証情報のないHTTPS URLを含む`latest.json`を生成します。
7. 公開前の4資産をActions Artifactへ保存し、ローカル検証結果も保存します。
8. `v0.3.10`をReleaseリポジトリでDraftとして作成します。既存Releaseまたはタグがあれば、その時点で停止します。
9. Draftからインストーラー、隣接`.sig`、`latest.json`を再取得し、版番号、URL、署名、埋め込み公開鍵、SHA-256を再検証します。
10. Draft検証に成功した場合だけDraftを解除し、Latestに指定します。
11. `releases/latest/download/latest.json`、インストーラー、`.sig`、`SHA256SUMS.txt`を認証なしHTTPSで再取得し、ローカル検証済み資産とSHA-256を比較します。

Draft検証までに失敗した場合、Draftは公開せず、調査用に残ります。公開後のLatest再取得に失敗した場合はActionsを失敗として記録し、再実行前に公開資産を確認します。

Releaseへ置く資産は次の4つです。

- `Minecraft.Server.Hub_0.3.10_x64-setup.exe`
- `Minecraft.Server.Hub_0.3.10_x64-setup.exe.sig`
- `latest.json`
- `SHA256SUMS.txt`

## ローカル署名・検証

秘密鍵はワークスペース外に置き、内容を表示しないまま署名します。

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath 'C:\安全な保存先\minecraft-server-hub-updater.key' -Raw
# 暗号化鍵の場合は、パスワードを安全な環境変数から設定します。
# $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<鍵のパスワード>'
npm run tauri -- build --bundles nsis --ci
```

既存の署名済みインストーラーを検証する場合は、秘密鍵を要求しません。

```powershell
npm run build:verify:signed -- `
  -InstallerPath 'C:\安全な保存先\Minecraft.Server.Hub_0.3.10_x64-setup.exe'
```

鍵ファイルから一時ターゲットへ署名付きビルドを行うスクリプトも、暗号化鍵のパスワードを現在のプロセス環境から受け取ります。

```powershell
npm run build:verify:signed -- `
  -SigningKeyPath 'C:\安全な保存先\minecraft-server-hub-updater.key' `
  -TargetDir "$env:TEMP\msh-tauri-signed-0.3.10" `
  -OutputPath '.\artifacts\updates\0.3.10\signed-build-verification.json'
```

Authenticodeを別途確認したい場合だけ`-CheckAuthenticode`を付けます。`-RequireAuthenticode`は任意のWindows発行元確認用であり、通常のアプリ内更新やこのワークフローの公開条件ではありません。

マニフェストと資産をまとめて検証するには次を使います。

```powershell
.\scripts\verify-release-artifact.ps1 `
  -InstallerPath '.\artifacts\updates\0.3.10\Minecraft.Server.Hub_0.3.10_x64-setup.exe' `
  -ManifestPath '.\artifacts\updates\0.3.10\latest.json' `
  -ExpectedVersion '0.3.10' `
  -ChecksumPath '.\artifacts\updates\0.3.10\SHA256SUMS.txt'
```

## 0.3.9からの互換性

0.3.10では公開鍵を変更しないため、0.3.9に埋め込まれた公開鍵で0.3.10の`.sig`を検証できます。0.3.9のReleaseとフィードを先に削除・上書きせず、0.3.10のDraft検証が成功してからLatestを切り替えます。

実際にインストール済み0.3.9から更新できたことは、ソース、ビルド、署名、公開後ダウンロードとは別の受入証跡です。停止中のMinecraft／Palworldサーバー、設定バックアップ、更新前後のバージョン、通常の友達招待を確認して記録します。

## 失敗時の扱い

- 秘密鍵がない、暗号化鍵のパスワードがない、または埋め込み公開鍵が署名を拒否した場合は、新しい鍵を生成せず停止します。
- 版番号、資産名、URL、隣接`.sig`、`latest.json`内の署名、SHA-256のどれかが一致しない場合は公開しません。
- Draft検証失敗時はDraftを公開しません。`v0.3.9`を含む既存Releaseには触れません。
- 更新確認または署名検証に失敗した利用者のアプリは終了・上書きせず、現在のアプリを維持します。
