# 共同管理ステージング運用手順

状態（2026-09-09）: 無料ステージングのRenderオリジン、Neon PostgreSQL、Cloudflare DNS/TLS/WSSを構築済み。公開エッジ経由のRustホスト統合試験とhealth確認、公開UIの9言語切替確認、署名付き0.3.8 QA生成物の埋込み公開鍵検証と隔離インストール／アンインストールを完了。物理的な別回線、2ブラウザ手動試験、Authenticode署名、実機での更新適用、実ゲーム、本番運用は未完了。

## 無料ステージング構成

- Node.js/WSS: Render Free Web Service（Singapore）
- PostgreSQL: Neon Free
- DNS/TLSエッジ: Cloudflare Free
- Render設定: リポジトリルートの`render.yaml`

これは無料ステージング用であり、本番可用性の構成ではない。Render Freeは15分間、HTTP要求もWebSocketメッセージもない場合に停止し、次のHTTP要求またはWebSocket接続で再起動する。再起動には約1分かかる場合がある。Render側の再起動・月間無料時間や帯域上限、Neon側の0.5GBストレージ・月100 CU時間にも依存する。

## 公開名

- ブラウザ/API: `staging.cohostrelay.online`
- ホストWSS: 同一オリジンの `wss://staging.cohostrelay.online/ws/host`
- 本番用のルートドメインと鍵・DB・Cookieを共有しない。

## Cloudflare

確認済み設定（2026-09-09）:

- ゾーンはActive。
- Universal SSLはActive。
- SSL/TLSモードはFull (strict)。
- Always Use HTTPSは有効。
- 最小TLSは1.2。
- TLS 1.3とWebSocketsは有効。
- DNSレコードは`staging` CNAME → `cohostrelay-staging.onrender.com`の1件で、Cloudflare Proxy（Proxied）を有効化済み。
- RenderのカスタムドメインはVerified / Certificate Issued。
- アプリのHSTSは`Strict-Transport-Security: max-age=300`で段階導入済み。延長は全対象ホスト名の受入後に行う。

現在のステージングは上記の設定で稼働しています。Renderの`onrender.com`サブドメインはまだ有効で、直接オリジン経路の無効化やファイアウォール制限は未実施です。本番化する場合は、Cloudflare経由だけを許可する構成と、鍵・DB・Cookieの本番分離を別途確認してください。

## PostgreSQL

1. Neonにステージング専用プロジェクトを作る。本番DBと共有しない。
2. マイグレーション用・アプリ用・保持削除用の役割を分離する。
3. アプリ役割には対象テーブルの必要なSELECT/INSERT/UPDATEだけを付与する。監査テーブルのUPDATE/DELETE権限は与えない。
4. Neonのプール接続文字列を`MSH_CO_MANAGEMENT_DATABASE_URL`へ、直接接続文字列を`MSH_CO_MANAGEMENT_MIGRATION_DATABASE_URL`へRenderのSecretとして注入する。値を`render.yaml`やログへ書かない。
5. Render Freeではpre-deploy commandが使えないため、`start:production`が排他ロック付きマイグレーション後にアプリを起動する。失敗時はリレーを起動しない。
6. アプリ起動時の`verifyMigrations`が不一致なら起動を停止する。
7. 接続プール上限、接続タイムアウト、statement timeoutを監視する。

## Render作成順序（実施記録）

1. ソースを非公開Gitリポジトリへ保存する。秘密値、`.env`、実ユーザーデータを含めない。
2. RenderでBlueprintを作り、リポジトリの`render.yaml`を選ぶ。
3. 作成画面で3つの`sync: false`値（プールDB URL、直接DB URL、リレー鍵）だけを入力する。
4. 最初のデプロイでは`Database schema is current.`または適用件数の後にリレー起動ログが出ることを確認する。接続文字列や鍵がログに出ていないことも確認する。
5. `https://<service>.onrender.com/health/live`と`/health/ready`が200になることを確認する。
6. RenderのCustom Domainsに`staging.cohostrelay.online`を追加する。
7. Cloudflareで`staging` CNAMEをRenderの`onrender.com`名へ向け、最初はDNS onlyでRenderの証明書検証を完了する。
8. HTTPS/WSSを検証後、Cloudflare Proxiedへ変更する。直接`onrender.com`経路を無効化できることを確認してから`MSH_CO_MANAGEMENT_TRUST_PROXY=1`を検討する。
9. HSTSはHTTPS/WSS確認後に`300`秒から開始する。完了（2026-09-08）。

## リレー鍵

`MSH_CO_MANAGEMENT_RELAY_KEYS`は`key-id:base64url`をカンマ区切りで指定する。先頭の鍵だけが新規暗号化に使われ、過去鍵は復号専用になる。

ローテーション順序:

1. 新鍵を先頭、旧鍵を2番目にして再起動する。
2. 新規データが新鍵IDで保存されることを確認する。
3. 保持期間を過ぎ、旧鍵で暗号化されたセッション・操作が残っていないことをDB集計で確認する。
4. 旧鍵を設定から外す。

鍵、Cookie、招待コード、ホストトークン、DB接続文字列をログへ出さない。

## 起動前ゲート

- `NODE_ENV=production`
- PostgreSQLマイグレーション適用済み
- HTTPSの完全一致Origin許可リスト
- Secure/HttpOnly/SameSite=Strict Cookie
- `/health/ready`がDB停止時に503
- DB停止時に書込みAPIが503で、Memory Storeへフォールバックしない
- ホストWSS切断時にスナップショット・招待・参加者が失効
- HSTSはHTTPS/WSS合格後に`300`から開始済み。全対象ホスト名の受入後に段階的に延長する

## 公開エッジの合成2ブラウザ受入

2026-09-09に、次のコマンドで公開ステージングのブラウザ経路を再確認した。

```powershell
npm run test:co-management:staging
```

確認内容:

- Cloudflare経由のHTTPSでUIを開き、HSTSとready応答を確認。
- 合成ホストを同一オリジンのWSSへ接続し、`host.ready`、招待登録、参加承認を確認。
- 独立した2セッション（Viewer: 1280x900、Editor: 390x844）を同時に操作。
- 招待画面でシステム言語を含む10個の選択肢を表示し、9言語すべての見出し切替と日本語への復帰を確認。
- Viewerの設定申請が無効であること、Editorの確認画面で`20 → 24`を表示し、`rev. 2`と監査行へ反映されることを確認。
- ホストWSS切断後、両ブラウザが「参加セッションが終了しました」へ遷移することを確認。

### PostgreSQL監査の保守

リレーアプリケーションのDBロールには、通常の要求処理に必要なテーブルの読取・追加・更新だけを与え、監査削除権限は与えない。別の保守ロールを`MSH_CO_MANAGEMENT_MAINTENANCE_DATABASE_URL`へ設定し、期限切れレート制限と、各ホスト・サーバー単位で最新10,000件を残す90日超の監査メタデータだけを定期的に削除する。

Neon等の管理PostgreSQLでは、実際のロール名を決めたうえで、リレー用接続ユーザーから`co_management_audit`と`co_management_rate_limits`の`DELETE`を剥奪し、保守用接続ユーザーへその2表の`DELETE`と必要な読取権限だけを付与する。ロール作成・権限変更はDB所有者の管理画面またはSQLコンソールで行い、アプリ起動時には実行しない。

```powershell
$env:MSH_CO_MANAGEMENT_MAINTENANCE_DATABASE_URL = "<maintenance-role-connection-string>"
npm --prefix co-management/relay run maintenance
```

このコマンドは監査メタデータとレート制限行だけを対象にし、操作結果、参加者、設定スナップショット、進行中操作の行を削除しない。接続障害や権限不足時は成功扱いにせず終了する。接続文字列はログへ出さない。

秘密値は合成してメモリ内だけで扱い、試験出力・スクリーンショットへ記録しない。初期未認証の`/api/v1/session` 401と、切断直後の設定API 403/502は想定遷移としてURL・ステータスを限定して扱い、それ以外のブラウザconsole/page errorは失敗にする。これは物理スマートフォン、別回線、手動2ブラウザ、実ゲームの受入ではない。Playwrightは通常のブラウザ実行であり、Codex Browserプラグインはこの環境で利用できないため使用していない。

## Cloudflare DNSを追加する条件

次の3点が揃うまでDNSレコードを作らない。

1. オリジンのホスト名または固定IPが確定している。
2. オリジン証明書が`staging.cohostrelay.online`に一致している。
3. PostgreSQLを使用したリレーが`/health/ready`でreadyを返す。

RenderへCloudflare管理ドメインを関連付ける際は、先にRender側へカスタムドメインを登録する。Renderの所有権・証明書検証中はCNAMEをDNS onlyにし、検証完了後にCloudflare Proxiedへ切り替える。

## 未検証・残作業

- 管理PostgreSQLの障害注入・復帰、監査保持・削除、同時実行の実DB受入（Neon接続・起動マイグレーション・ready応答は確認済み）
- 物理的な別ネットワークからのRustホスト接続（今回のRust試験は公開エッジ経由だが、同一作業環境からの実行）
- 現行ソースの署名済みTauriパッケージと、隔離先でのインストール・アンインストール（署名付き生成物の埋込み公開鍵検証とQA用隔離インストール／アンインストールは完了。Authenticodeは未署名。クリーン環境での再インストール・実機更新は未確認）
- PCと実スマートフォンの2ブラウザの再現可能な手動証跡（ユーザー報告はあるが、こちらの直接操作・別回線証明は未取得）
- Minecraft Java、Bedrock、Palworldの実機CM4
