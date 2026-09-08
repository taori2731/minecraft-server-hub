# ブラウザ共同管理（CM1〜CM3）

このフォルダーは、Minecraft Server Hub のホストPCと友達のブラウザを、許可された設定・公開状態・監査ログだけで接続するローカル実装です。

現在の実装範囲は次のとおりです。

- ホストPC: Rust/Tauri がサーバー状態、権限、停止判定、バックアップ、設定ファイル指紋、revision、idempotency を管理します。
- 中継: `relay/` の Fastify + `ws` 実装が、localhost開発時のHTTP/WSと、Render + Cloudflareで構成したステージングのHTTPS/WSSを仲介します。ステージングの公開TLS/WSSとRust接続は確認済みですが、本番可用性の構成ではありません。
- ブラウザ: `browser/` は独立したReact + Vite画面で、招待参加、承認待ち、サーバー概要、設定申請、監査ログを提供します。日本語を初期表示にした9言語（英語、日本語、簡体/繁体中国語、韓国語、スペイン語、ドイツ語、フランス語、ブラジルポルトガル語）の表示切替に対応します。
- 共有しない値: ローカルパス、Java実行ファイル、ゲームパスワード、REST管理パスワード、ホストトークン、任意コマンド。

## ローカル確認

```powershell
npm install
npm --prefix co-management/relay install
npm run check:co-management
npm run build:co-management
npm --prefix co-management/relay start
```

別ターミナルで中継を起動したまま、`http://127.0.0.1:8788` でブラウザ開発UIを確認できます。Vite開発サーバーは `/api` を `http://127.0.0.1:8787` へプロキシします。

生成済みUIを中継から配信する場合は、`MSH_CO_MANAGEMENT_UI_DIR` に `co-management/browser/dist` を指定します。既定のリッスン先は `127.0.0.1:8787` です。

公開ステージングの合成2ブラウザ受入は、既存のBraveをPlaywrightから起動して次で実行できます。

```powershell
npm run test:co-management:staging
```

この試験はCloudflare経由の公開HTTPS/WSSへ合成ホストを接続し、デスクトップViewerとモバイルサイズEditorを別ブラウザコンテキストで参加させます。Viewerの変更禁止、Editorの変更前後確認・反映、監査表示、ホスト切断後の両セッション失効に加え、招待画面で9言語を切り替えられることを確認します。招待秘密・ホストトークンは毎回メモリ内で生成し、出力しません。これは物理的なスマートフォン、別回線、実ゲームの代替ではありません。

HTTPの非ループバック接続はRust側で拒否します。localhostの統合試験で確認できるのはHTTP/WSだけで、WSS検証とは別です。2026-09-09時点では、`staging.cohostrelay.online`のCloudflare経由HTTPS/WSS、Neon接続のready応答、公開エッジ経由のRustホスト統合試験、公開UIの9言語切替を確認済みです。物理的な別回線、2ブラウザ手動試験、実ゲーム、署名済みパッケージ、本番可用性・監視・利用規約・プライバシー確認は別途必要です。

## プロトコル境界

ホストから中継へ送る `host.snapshot` は公開可能なサーバー状態と設定能力だけです。設定の読み取り・変更・監査ログは `requestId` を持つ要求として転送し、ホスト側で参加者の状態、権限、停止状態、revision、ファイル指紋、許可キーと値の範囲を再検証します。

設定変更は変更前バックアップを作成してからファイルを書き、SQLiteのrevision・指紋・操作結果・監査ログを同じ処理境界で更新します。既に同じ `requestId` が完了していれば同じ結果を返し、内容ハッシュが異なる再利用は拒否します。

ローカル開発は `MemoryRelayStore`、PostgreSQL接続情報とリレー鍵を指定した環境は `PostgresRelayStore` を使用します。番号付きマイグレーションは `relay/migrations/` にあり、`npm --prefix co-management/relay run migrate` で適用します。アプリ起動時はマイグレーションの名前とチェックサムを検証し、不足・改変時は起動を停止します。

PostgreSQLアダプターは複合キーによるホスト・サーバー・参加者・操作の分離、招待の原子的な1回引換、暗号化した照合コードと操作結果、共有レート制限を実装します。ステージングではNeonへのマイグレーションと`/health/ready`を確認済みです。DB接続障害時は503またはWebSocket 1013で停止し、Memory Storeへフォールバックしませんが、障害注入・復帰、監査保持・削除の実DB受入は未完了です。残りの受入項目は `docs/CO_MANAGEMENT_STAGING_RUNBOOK.md` に記録しています。
