# 開発基準: Minecraft Server Hub 0.3.2

このワークスペースは、0.3.2のソースと配布アーティファクトを一致させた状態を開発基準にします。添付されたNSISインストーラーからソースコードを復元するのではなく、同じワークスペース内のソースを変更して次のバージョンを作成します。

## 基準アーティファクト

- インストーラー: `artifacts/updates/0.3.2/Minecraft.Server.Hub_0.3.2_x64-setup.exe`
- Tauri更新署名: `artifacts/updates/0.3.2/Minecraft.Server.Hub_0.3.2_x64-setup.exe.sig`
- 更新マニフェスト: `artifacts/updates/0.3.2/latest.json`
- SHA-256: `428ABDB89F0E13F80F79A0AFEB1ACDC2ABD15F7CB19887B14493004B3B7671AB`

このインストーラーはWindowsのAuthenticode署名ではなく、Tauri Updaterのminisign署名を使います。署名の検証にはアプリへ埋め込まれた`src-tauri/updater-public.key`を使用します。検証済みの公開鍵や秘密鍵はこの基準書へコピーしません。

## 基準の検証

リポジトリのルートで次を実行すると、ソースの5つのバージョン値、マニフェスト、隣接する`.sig`、SHA-256、公開鍵、暗号学的署名をまとめて確認できます。

```powershell
.\scripts\verify-release-artifact.ps1 `
  -InstallerPath '.\artifacts\updates\0.3.2\Minecraft.Server.Hub_0.3.2_x64-setup.exe' `
  -ExpectedVersion '0.3.2' `
  -OutputPath '.\artifacts\updates\0.3.2\verification.json'
```

スクリプトは署名検証のためにRustのignoredテストを実行します。インストーラーを起動したり、インストール済みアプリやサーバーフォルダーを変更したりはしません。

## 0.3.2からの開発手順

1. まず上記の基準検証を実行し、`signatureVerified=true`と表示されることを確認します。
2. `src/`または`src-tauri/`を変更します。`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`のバージョンは、リリース時に同じ値へ更新します。
3. 静的検査・ユニットテスト・UIスモーク・Rustテストを実行します。
4. 新しいNSISインストーラーを作成し、隣接する`.sig`と`latest.json`を生成します。
5. 新しいアーティファクトを同じ検証スクリプトへ渡してから、公開または実機更新テストを行います。

### 通常の開発確認

```powershell
npm run check
npm test -- --maxWorkers=1 --no-file-parallelism
npm run test:ui
cargo fmt --manifest-path .\src-tauri\Cargo.toml --all -- --check
cargo test --locked --manifest-path .\src-tauri\Cargo.toml --lib
```

更新確認では、署名秘密鍵をソース管理へ置かず、公開前に必ずバックアップとロールバックの実機確認を行います。

