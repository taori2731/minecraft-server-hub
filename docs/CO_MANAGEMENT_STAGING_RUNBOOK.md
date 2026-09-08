# 共同管理ステージング運用手順

状態: コードとCloudflareゾーンの準備手順。オリジン、実PostgreSQL、WSS別回線試験は未完了。

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

確認済み設定（2026-09-08）:

- ゾーンはActive。
- Universal SSLはActive。
- SSL/TLSモードはFull (strict)。
- Always Use HTTPSは有効。
- 最小TLSは1.2。
- TLS 1.3とWebSocketsは有効。
- DNSレコードは0件。オリジン未決定のため、推測したA/CNAMEは追加していない。
- HSTSは未有効。オリジンのHTTPS/WSSを確認してから短いmax-ageで開始する。

オリジン設置後に、`staging`のAまたはCNAMEを1件追加し、Proxy statusをProxiedにする。オリジンは有効な公開CA証明書またはCloudflare Origin CA証明書を提示し、Cloudflare以外からの直接アクセスをファイアウォールまたはトンネルで拒否する。

## PostgreSQL

1. Neonにステージング専用プロジェクトを作る。本番DBと共有しない。
2. マイグレーション用・アプリ用・保持削除用の役割を分離する。
3. アプリ役割には対象テーブルの必要なSELECT/INSERT/UPDATEだけを付与する。監査テーブルのUPDATE/DELETE権限は与えない。
4. Neonのプール接続文字列を`MSH_CO_MANAGEMENT_DATABASE_URL`へ、直接接続文字列を`MSH_CO_MANAGEMENT_MIGRATION_DATABASE_URL`へRenderのSecretとして注入する。値を`render.yaml`やログへ書かない。
5. Render Freeではpre-deploy commandが使えないため、`start:production`が排他ロック付きマイグレーション後にアプリを起動する。失敗時はリレーを起動しない。
6. アプリ起動時の`verifyMigrations`が不一致なら起動を停止する。
7. 接続プール上限、接続タイムアウト、statement timeoutを監視する。

## Render作成順序

1. ソースを非公開Gitリポジトリへ保存する。秘密値、`.env`、実ユーザーデータを含めない。
2. RenderでBlueprintを作り、リポジトリの`render.yaml`を選ぶ。
3. 作成画面で3つの`sync: false`値（プールDB URL、直接DB URL、リレー鍵）だけを入力する。
4. 最初のデプロイでは`Database schema is current.`または適用件数の後にリレー起動ログが出ることを確認する。接続文字列や鍵がログに出ていないことも確認する。
5. `https://<service>.onrender.com/health/live`と`/health/ready`が200になることを確認する。
6. RenderのCustom Domainsに`staging.cohostrelay.online`を追加する。
7. Cloudflareで`staging` CNAMEをRenderの`onrender.com`名へ向け、最初はDNS onlyでRenderの証明書検証を完了する。
8. HTTPS/WSSを検証後、Cloudflare Proxiedへ変更する。直接`onrender.com`経路を無効化できることを確認してから`MSH_CO_MANAGEMENT_TRUST_PROXY=1`を検討する。
9. HSTSは最後に`300`秒から開始する。

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
- HSTSはHTTPS/WSS合格後に`300`から開始し、段階的に延長する

## Cloudflare DNSを追加する条件

次の3点が揃うまでDNSレコードを作らない。

1. オリジンのホスト名または固定IPが確定している。
2. オリジン証明書が`staging.cohostrelay.online`に一致している。
3. PostgreSQLを使用したリレーが`/health/ready`でreadyを返す。

RenderへCloudflare管理ドメインを関連付ける際は、先にRender側へカスタムドメインを登録する。Renderの所有権・証明書検証中はCNAMEをDNS onlyにし、検証完了後にCloudflare Proxiedへ切り替える。

## 未検証

- 管理PostgreSQL上でのマイグレーション、同時招待引換、共有レート制限、DB停止・復帰
- Cloudflare経由のHTTPS/WSS
- 別ネットワークのRustホスト接続
- 署名済みTauriパッケージ
- PCと実スマートフォンの2ブラウザ
- Minecraft Java、Bedrock、Palworldの実機CM4
