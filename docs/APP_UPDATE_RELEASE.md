# アプリ更新の配布手順

Minecraft Server Hub 0.3.0以降は、Tauri Updaterの署名検証を通過したWindows向けNSIS更新だけをアプリ内から適用します。

## 初回準備

- 署名秘密鍵はリポジトリや配布物へ入れず、安全なオフラインバックアップを作成します。
- `src-tauri/updater-public.key` と `src-tauri/tauri.conf.json` の公開鍵は、同じ秘密鍵から生成された値を使います。
- 認証情報やURLフラグメントを含まないHTTPS上に、`latest.json` と更新用NSISファイルを公開します。
- 公式フィードは `https://github.com/taori2731/minecraft-server-hub-releases/releases/latest/download/latest.json` を標準で使用します。
- 検証環境などで別フィードを使う場合だけ、ビルド時の `MSH_UPDATE_ENDPOINT` または設定画面に、認証情報を含まないHTTPS URLを指定します。

## リリース作成

1. `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` のバージョンを同じ値へ更新します。
2. PowerShellで署名鍵のパスを設定してビルドします。

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath 'C:\安全な保存先\minecraft-server-hub-updater.key' -Raw
   # 暗号化した鍵を使う本番環境では、パスワードも安全なCIシークレットから設定します。
   # $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<鍵のパスワード>'
   $env:MSH_UPDATE_ENDPOINT = 'https://github.com/taori2731/minecraft-server-hub-releases/releases/latest/download/latest.json'
   npm run tauri build -- --ci
   ```

3. `src-tauri/target/release/bundle/nsis/` に生成された更新用NSISファイルと同名の `.sig` があることを確認します。
   さらに、生成物と隣接する`.sig`を、アプリへ埋め込んだ公開鍵で実際に検証します。

   ```powershell
   $env:MSH_UPDATER_ARTIFACT = (Resolve-Path -LiteralPath '.\src-tauri\target\release\bundle\nsis\Minecraft Server Hub_0.3.2_x64-setup.exe').Path
   cargo test --manifest-path .\src-tauri\Cargo.toml --locked app_update::tests::verifies_a_built_updater_with_the_embedded_public_key -- --ignored
   ```

4. 配布先URLを確定し、マニフェストを作成します。

   ```powershell
   .\scripts\create-update-manifest.ps1 `
     -Version '0.3.2' `
     -DownloadUrl 'https://github.com/taori2731/minecraft-server-hub-releases/releases/download/v0.3.2/Minecraft.Server.Hub_0.3.2_x64-setup.exe' `
     -InstallerPath '.\src-tauri\target\release\bundle\nsis\Minecraft Server Hub_0.3.2_x64-setup.exe' `
     -Notes '変更内容' `
     -OutputPath '.\artifacts\updates\latest.json'
   ```

5. NSISファイル、`.sig`、`latest.json` の3ファイルだけをGitHub Releaseへ公開します。固定URLが新しい公開版を指すよう、`latest.json` も同じReleaseへ置きます。
6. 旧版の設定画面から手動確認し、バージョンと更新内容、同意画面、ダウンロード、署名検証、再起動後のバージョンを実機確認します。

## 署名付きビルドの再現確認

秘密鍵をソース管理へ置かず、鍵ファイルのパスだけを指定して現行ソースを一時ターゲットへビルド・検証できます。スクリプトは鍵の内容を表示せず、既存のターゲットやインストール済みアプリを上書きしません。

```powershell
npm run build:verify:signed -- `
  -SigningKeyPath 'C:\安全な保存先\minecraft-server-hub-updater.key' `
  -TargetDir "$env:TEMP\msh-tauri-signed-0.3.8" `
  -OutputPath '.\artifacts\updates\0.3.8\signed-build-verification.json'
```

すでに生成したインストーラーを再ビルドせず確認する場合は、`-InstallerPath`だけを指定します。このモードは秘密鍵を要求せず、隣接`.sig`と埋込み公開鍵を検証します。

```powershell
npm run build:verify:signed -- `
  -InstallerPath "$env:TEMP\msh-tauri-signed-0.3.8\release\bundle\nsis\Minecraft Server Hub_0.3.8_x64-setup.exe"
```

この確認で合格するのは、NSIS生成物に隣接するTauri更新署名とアプリへ埋め込んだ公開鍵の一致です。`Get-AuthenticodeSignature` の結果も記録しますが、`NotSigned` はWindows Authenticode署名が無い状態であり、一般配布の信頼済み発行元を意味しません。公開前には別途、Windowsコード署名証明書と安全な署名環境でAuthenticode署名を付け、クリーン環境のインストール・アンインストール・再インストール・更新を確認します。

署名秘密鍵が表示・漏えいした可能性がある場合は、その鍵で公開や本番更新を続けません。新しい鍵を安全な環境で生成し、`src-tauri/updater-public.key`、`tauri.conf.json`、更新マニフェスト、配布経路を同時に切り替えます。公開鍵だけを差し替えると、旧公開鍵を埋め込んだ既存版から新鍵の更新を受けられなくなるため、切替版の配布計画と旧版の扱いを先に決めます。

## 失敗時の扱い

- 確認、ダウンロード、署名検証が失敗した場合はインストーラーを起動せず、現在のアプリを維持します。
- 署名検証後にだけTauri Updaterへインストールを渡し、アプリ終了を許可します。
- すべてのMinecraft／Palworldサーバーが停止していない限り、更新を開始しません。
- 秘密鍵を紛失すると同じ公開鍵を持つ既存アプリへ正規更新を配布できません。公開鍵を差し替えるだけでは既存版を更新できません。
