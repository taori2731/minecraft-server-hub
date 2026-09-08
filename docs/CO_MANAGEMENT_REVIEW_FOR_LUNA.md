# 共同管理 CM0〜CM3 レビュー / Luna修正指示

結論: ローカル試作は存在するが、CM0〜CM3完了・本番公開可能とは判定しない。以下のP1を修正し、実Rustホストを含む結合試験を先に通す。

本レビューは設計適合と主要経路のコードレビュー。全リポジトリの網羅的セキュリティ監査ではない。コードの修正、公開、実サーバー操作は行っていない。

## 根拠と検証範囲

- 基準: docs/CO_MANAGEMENT_IMPLEMENTATION_PLAN.md。
- 確認: co-management/relay/src/server.ts・store.ts、shared/protocol.ts、browser/src/App.tsx、src/components/CoManagementDialog.tsx、src/App.tsx、src-tauri/src/co_management.rs、lib.rsの関連操作と接続、依存tungstenite 0.30.0の実装。
- npm run test:co-management: 4件成功、0件失敗。既存テストのWebSocketホストはNode wsであり、Rust HostConnectionManagerを通らない。
- メモリ上の合成データで、ホストトークン上書き、同じserverIdの複数ホスト所有、招待期限とセッション期限の一致、禁止フィールド付きsnapshotの検証通過を再現した。実資格情報・実ネットワーク・実サーバーは使用していない。
- Rust接続不成立、保存と復旧、再送結果の問題はソースと依存実装の照合による判断。障害注入・本物のTauriを使った再現はまだ行っていない。

## P1: 最優先で修正

### R01 実RustホストのWebSocket接続が成立しない

根拠: src-tauri/src/co_management.rs:878付近のHostConnectionManager::connect。
Request::builderにURI・Authorization・X-MSH-Protocol-Versionだけを指定してconnect_asyncへ渡している。
依存tungstenite 0.30.0のclient.rs:262はRequestをそのまま返す。handshake/client.rs:122以降はSec-WebSocket-KeyとHost/Connection/Upgrade/Sec-WebSocket-Versionを要求するため、このリクエストは拒否される。

修正: URLをIntoClientRequestへ変換して正規ハンドシェイクを生成し、その後Authorization等を追加する。host.readyを確認してから接続成功にする。失敗・期限切れではdisconnectedへ戻す。
受入: 実HostConnectionManagerからローカル中継へ接続→host.ready→設定取得。無効トークン・拒否応答では接続済み表示にならない。Nodeホストでの代用は不可。

### R02 既存ホストの資格情報を未認証登録で差し替えられる

根拠: relay/src/server.tsのPOST /api/v1/hosts/register、store.ts:111 registerHost。
登録APIは既存資格情報の確認なしにhosts.setで上書きする。既知のhostIdに別トークンを登録すると元トークンが拒否され、新トークンが受理されることをメモリ再現済み。
攻撃成立には対象hostIdを知る必要がある。ランダムIDが推測困難でも、IDだけを所有権の証明にしてはいけない。

修正: 新規登録と既存ホスト再接続を分離。既存IDの再登録は一致する資格情報なら冪等、別資格情報なら拒否。鍵更新は現在の資格情報または別の明示的な復旧認証を要求する。DB移行後も原子的な一意制約で保護。
受入: 登録APIへの2回目の別トークンPOSTが失敗し、元ホストが接続可能なまま残る。

### R03 ホスト間でserverIdとrequestIdの名前空間が分離されていない

根拠: store.ts:134 bindHostServer、280 setSnapshot、289 saveOperation、server.ts:382 pending.set。
同一serverIdを複数ホストへ関連付けられる。snapshotはserverIdだけがキーなので、別ホストがそのIDを使うと表示データを混在・上書きできる。pendingと操作結果もブラウザ指定requestIdだけがキーで、別参加者の同じIDが既存の待機処理を置き換える。
同じserverIdの複数ホスト所有はメモリ再現済み。実参加者データへのアクセスは試していない。

修正: hostId/serverId、hostId/serverId/participantId/requestIdで分離するか、中継発行の共有リソースIDと一意な所有者を使う。中継の通信相関IDはブラウザの操作IDから分離する。同一操作の再送は内容照合して既存処理を参照し、pendingを上書きしない。
受入: 2ホストで同じローカルserverId、2参加者で同じrequestIdを使ってもsnapshot・結果・タイムアウトが混線しない。

### R04 ホストの操作結果照会で対象・参加者の所有確認がない

根拠: src-tauri/src/lib.rs:706 get_co_management_operation。要求されたserverIdへの参加資格は確認するが、co_store.operation_result(request_id)はrequestIdのみで検索する。
中継のキャッシュがない経路では、あるサーバーの承認済み参加者が既知の別操作IDを指定すると別参加者/サーバーの結果を取得し得る。操作IDを知る必要がある。中継キャッシュのparticipantId検査だけではホスト側の不足を補えない。

修正: ホストDBからserverId・participantIdも条件にして検索。中継・ホスト両方で同じ所有条件を強制。
受入: 他参加者、他サーバーの既知requestIdを照会しても結果が返らない。

### R05 保存失敗の復旧を保証できず、途中操作がrunningのまま残る

根拠: co_management.rs:1643 apply_settings、1722 original_bytes、1730以降のPalworld分岐、1761/1768/1817のrollback、298の操作テーブル。
- 元設定ファイルの読み取り失敗をunwrap_or_defaultで空バイトへ変換している。復旧時の元データとして安全ではない。
- begin_operation後のPalworld資格情報読出し・検証・update_configなどの?は、fail_operationを通らずreturnする。
- ファイル/DBのロールバック失敗をlet _で握り潰す。復旧失敗状態と追加変更の禁止がない。
- 操作テーブルに復旧用退避先・元/新指紋・保存段階がなく、起動時にrunning操作を回復する処理も確認できない。

修正: 読み取りエラーを欠損と区別して中断。退避先・保存段階・指紋を永続ジャーナルへ記録。全失敗経路を統一し、復旧失敗はneeds_recoveryとしてローカル/遠隔両方の追加変更を止める。起動時に途中処理を照合して復旧する。
受入: 元ファイル読取不可、資格情報取得失敗、設定/DB書込失敗、復旧失敗、ファイル保存直後のプロセス終了を注入し、実データと報告状態を確認する。

### R06 再送・タイムアウト後の結果が正しく確定しない

根拠: co_management.rs:1684でrevision確認後に1696 begin_operation。commit_settings_change:698ではserverId/revision/changedFieldsのみ保存するが、再送時はsettings/message/requestIdも必要なCoManagementApplyResultとしてデシリアライズする。
成功済みリクエストを同じrevisionで再送すると、保存済み結果を返す前に409になる。順番だけ直しても保存済み結果の型が一致しない。
relay/server.ts:379のtimeoutでpendingを削除し、PATCH経路は操作をrunningとして保存する。遅延応答は待機項目なしとして捨てられ、結果GETはキャッシュがあればそのrunningを返し続けてホストへ照会しない。
browser/App.tsx:238は送信ごとに新requestIdを作り、失敗時の結果照会を行わない。

修正: 認可・内容照合後、既存操作の結果をrevision検査より先に処理。成功結果を完全な同一スキーマで保存。通信相関IDと操作IDを分離し、タイムアウトを失敗/成功と断定せずホスト照会へ。UIでIDを保持して再送より先に結果確認する。
受入: 保存成功後の応答破棄、10秒超の遅延、同一内容再送、同一ID別内容、ブラウザ再読込を確認。追加の保存なしで元の結果が得られること。

## P2: CM0〜CM3の完了前に修正

### R07 切断・再接続とセッション期限が設計と異なる

根拠: store.ts:180でセッション期限にinvite.expiresAtを転用。session/authorizeは最終参照時刻を更新するが無操作期限を判定しない。server.ts:827 closeはsocket削除のみでsnapshot破棄・再承認化をしない。co_management.rsのpermission_generationはauthorize_participantで比較されない。
10分招待は参加後も同じ時刻に失効する。一方、接続し直しても期限内の承認が残り、設計の再承認条件を満たさない。
修正: 招待10分、セッション絶対12時間、無操作30分を分離する。自動ポーリングを利用者操作として無期限延長しない。再接続/再起動で承認世代を更新し、旧権限を拒否。切断・失効をブラウザにも反映。
受入: 仮想時刻で各期限、切断→再接続、旧Cookieと旧参加者IDを検証。

### R08 公開snapshotの検証が許可リストになっていない

根拠: shared/protocol.tsのisSafePublicSnapshotは一部の必須属性しか検査しない。rootPathなど余分な属性があってもtrue（合成データで確認）。store.setSnapshotは受け取ったオブジェクト全体を保存し、summary/sessionViewへ返す。
現行Rustのsnapshot生成で実パスが漏れたとは確認していないが、公開DTO境界の保証がない。
修正: 余分な属性を拒否する厳密なスキーマ、または必要フィールドだけを再構築する。capabilitiesを含む配列内部・enum・長さも検証する。禁止名の部分的な検出だけに頼らない。
受入: rootPath/adminPassword/serverPassword等、入れ子の余分な属性、巨大配列をブラウザへ返さない。

### R09 同期Tauriコマンド内で全サーバーバックアップを実行している

根拠: lib.rs:688 apply_co_management_settingsは同期コマンドでStoreとCoManagementStoreの全体Mutexを保持し、co_management.rs:1723 backup::createでサーバー全体を圧縮する。
設定1項目の変更でもPalworld本体を含む全体処理となり得る。大きいサーバーではUI/他サーバーのDB操作を長く待たせ、中継10秒timeoutとの組合せでR06を誘発する。実負荷の秒数は未測定。
修正: 初期設計どおり必要な設定の退避にするか、フルバックアップ要件を明示して非同期ジョブへ。重いI/Oはspawn_blocking等に移し、DB全体ロックは最短区間だけ保持。サーバー単位の排他は維持する。
受入: 大きい検証用ファイルを含むサーバーでもアプリの操作・他サーバーの状態取得が継続し、保存結果が確定する。

### R10 ブラウザの編集体験が設計を満たさない

根拠: browser/App.tsx:218-246。差分は内部で算出するだけで変更前後の確認画面なし。revision変更でdraftを即時リセットするため、他人の保存とポーリングで入力中の編集を破棄する。Dashboardは常に「接続中」と表示し、更新失敗でも古いsettingsで編集可能表示が残る。
修正: 変更前後確認、未保存入力の保持と競合解決、情報の鮮度/切断状態と保存禁止、結果不明時の照会を実装する。
受入: 2ブラウザの同時編集、編集中のホスト切断、応答消失をUI操作で確認する。

### R11 承認用コードがダイアログを閉じると失われる

根拠: CoManagementDialog.tsx:33 pendingCodesはコンポーネント内状態。参加イベントのコードをwindowイベントから受けるが、ダイアログを閉じている間は購読しない。再オープン時のsnapshotにコードがなく、照合待ちのまま承認ボタンは有効になる。
修正: 未承認申請の照合情報をホスト側で期限内だけ安全に取得可能にする。コード未取得時は承認不可。検証用demo-participantの固定コードを本番コンポーネントの初期値から除く。
受入: ダイアログを閉じて申請→開く、申請後に閉じて再度開く、期限切れで確認する。

## 残る設計・公開要件（上の不具合と区別）

- PostgreSQLはschemaのみ。storeをインターフェース化し、永続アダプター・migration・再起動試験を追加する。メモリ保存のまま本番へ出さない。
- 共有管理画面は日本語固定。9言語、内部フィールド名/CM1等の開発表示の整理、監査の変更前後表示、ホストの権限変更UIが不足。
- フィールド単位の単位表示を既存画面と照合する。browser/App.tsxのfieldSuffixはspawnProtectionをチャンク、palEggDefaultHatchingTimeを分としている。既存ゲーム設定の値の単位を公式仕様と突合せてから直す。
- メモリ上のhosts/invites/sessions/operations/ratesやRustイベントキューの上限と回収を実装。監査履歴90日/10,000件の整理、進行中ジャーナル保持を分ける。
- 本番TLS/WSS、登録/WS接続を含むレート制限、秘密管理、監視、DB運用は未実装。公開先/予算の決定後にステージングで確認。
- 起動/停止/削除/復元等への排他追加は確認できたが、全更新経路・外部ファイル変更・自動運用との競合は網羅的に実証していない。既存Tauri処理と遠隔保存の重複実装も含め、CM0の共有サービス方針に照合する。

## Lunaへそのまま渡す指示

docs/CO_MANAGEMENT_IMPLEMENTATION_PLAN.mdと本レビューに基づいて修正してください。作業順はR01、R02〜R04、R05〜R06、R07〜R11、残る設計要件です。コードを書く前に対象ファイルと既存変更を確認し、既存ユーザーデータ・既存機能・未コミット変更を保持してください。

指摘ごとに再現/否定テストを追加し、修正前の条件と修正後の結果を報告してください。R01は本物のRust接続を必ず通し、Nodeの疑似ホストだけで完了にしないでください。保存の試験は隔離した一時フォルダー/DBと障害注入で行い、実ユーザーのサーバーを変更しないでください。

既存テストに加え、2ホスト・2参加者・同一ID・期限経過・遅延応答・再起動・復旧失敗を確認してください。実装後は各R番号を修正済み/未解決/反証に分類し、ファイル、テスト、残る制約を記載してください。全件の自動成功や本番対応を根拠なく宣言しないでください。

公開・リリース作成・インストール・新規課金契約は行わず、修正済みコードと検証結果をレビューへ返してください。
