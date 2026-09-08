# ブラウザ共同管理（CM1〜CM3）

このフォルダーは、Minecraft Server Hub のホストPCと友達のブラウザを、許可された設定・公開状態・監査ログだけで接続するローカル実装です。

現在の実装範囲は次のとおりです。

- ホストPC: Rust/Tauri がサーバー状態、権限、停止判定、バックアップ、設定ファイル指紋、revision、idempotency を管理します。
- 中継: `relay/` の Fastify + `ws` 実装が、localhost開発時のHTTP/WSを仲介します。本番のHTTPS/WSSは未構築です。
- ブラウザ: `browser/` は独立したReact + Vite画面で、招待参加、承認待ち、サーバー概要、設定申請、監査ログを提供します。
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

HTTPの非ループバック接続はRust側で拒否します。localhostの統合試験で確認できるのはHTTP/WSだけで、WSS検証とは別です。公開・ステージング運用には、TLS終端、WSS、永続セッションストレージ、レート制限の共有状態、秘密管理、バックアップ、監視、利用規約・プライバシー確認が別途必要です。現時点でそれらを構築済み・公開済みとは扱いません。

## プロトコル境界

ホストから中継へ送る `host.snapshot` は公開可能なサーバー状態と設定能力だけです。設定の読み取り・変更・監査ログは `requestId` を持つ要求として転送し、ホスト側で参加者の状態、権限、停止状態、revision、ファイル指紋、許可キーと値の範囲を再検証します。

設定変更は変更前バックアップを作成してからファイルを書き、SQLiteのrevision・指紋・操作結果・監査ログを同じ処理境界で更新します。既に同じ `requestId` が完了していれば同じ結果を返し、内容ハッシュが異なる再利用は拒否します。

ローカル開発は `MemoryRelayStore`、PostgreSQL接続情報とリレー鍵を指定した環境は `PostgresRelayStore` を使用します。番号付きマイグレーションは `relay/migrations/` にあり、`npm --prefix co-management/relay run migrate` で適用します。アプリ起動時はマイグレーションの名前とチェックサムを検証し、不足・改変時は起動を停止します。

PostgreSQLアダプターは複合キーによるホスト・サーバー・参加者・操作の分離、招待の原子的な1回引換、暗号化した照合コードと操作結果、共有レート制限を実装します。DB接続障害時は503またはWebSocket 1013で停止し、Memory Storeへフォールバックしません。実管理PostgreSQL、TLS/WSS、別回線の受入は `docs/CO_MANAGEMENT_STAGING_RUNBOOK.md` の未検証項目です。
