# Minecraft Server Hub

Windows向けのMinecraft・Palworld専用サーバー管理アプリです。Vanilla、Paper、Fabric、Forge、NeoForge、Bedrock Dedicated Serverに加え、Valve公式SteamCMDから取得するPalworld Dedicated Serverの新規作成、起動、ローカル監視、保存、安全停止に対応しています。Minecraft側では既存フォルダー取り込み、Java選択、ログ、ローカル診断、バックアップ／復元、拡張機能、構成プロファイル、テンプレート、確認付き更新、ダーク／ライトテーマを引き続き利用できます。

## Palworld PW0–PW2

- 「新しいサーバー」でPalworldを選ぶと、ゲーム共通アダプターを通じてMinecraftとは別のネイティブ実行・UDP構成として登録します。既存MinecraftプロファイルはSQLite移行時に`minecraft`として維持されます。
- PW1では公式SteamCMDを固定HTTPS配布元から取得してWindows署名と安全なZIP構造を確認し、Steam App `2394010`を専用フォルダーへ導入して`PalServer.exe`を非表示で起動します。ゲーム用UDPポートとREST管理用TCPポートは、既存サーバーとOSの使用状況を確認して別々に選べます。
- PW2では公式REST APIの情報・メトリクス・参加者を読み取り、ワールド保存が成功した後だけ安全停止を要求します。管理資格情報はWindows資格情報マネージャーへ保存し、RESTクライアントは`127.0.0.1`固定です。
- Palworld専用の概要、読み取り専用ログ、参加者、設定画面と作成フローは、日本語、英語、ドイツ語、スペイン語、フランス語、韓国語、ポルトガル語（ブラジル）、簡体字中国語、繁体字中国語の9言語に対応します。
- 公式仕様の参照先: [Palworld Dedicated Serverの構築](https://docs.palworldgame.com/getting-started/deploy-dedicated-server/)、[REST API](https://docs.palworldgame.com/api/rest-api/palwold-rest-api/)、[設定項目](https://docs.palworldgame.com/settings-and-operation/configuration/)

## Safety and privacy

- 既存サーバーの取り込みは、登録確認まで元フォルダーを読み取り専用で検査します。
- 設定・拡張機能・復元などの変更前にローカルバックアップを作成します。
- Modrinthカタログからの導入はMinecraft版・ローダー・サーバー対応を確認し、必須依存を解決してSHA-512／SHA-1検証後に反映します。
- 拡張機能カタログはModrinthの公式API／CDNだけを使用します。Modの配布条件とライセンスは各プロジェクトの案内に従ってください。
- 復元前に現在状態を退避し、ZIP内容とSHA-256を検証します。
- クラッシュ診断は外部送信せず、IPアドレスや秘密情報らしきログを伏せ字にします。
- Javaがない場合は、配布元・ライセンス・版・容量・保存先を表示して本人が確認した後だけ、公式Eclipse Temurin JREをアプリ専用領域へ取得します。SHA-256を検証し、Windows全体のPATHや`JAVA_HOME`は変更しません。
- 更新は停止中の同じサーバー種類に限定し、警告確認とサーバー名入力後に更新直前バックアップを作成してから、公式配布元の検証済みファイルを適用します。無条件の自動更新は行いません。
- ポート開放なし招待では、利用者が配布元・版・容量・ライセンス・管理者権限・Windowsサービス・保存先を確認した後だけ、公式playit.gg x64 MSI v1.0.10をGitHub Releasesから取得します。固定SHA-256とWindows署名（Developed Methods LLC）を検証してから実行し、一時MSIは削除します。MinecraftのループバックTCPポートだけを中継し、管理画面・SQLite・設定・バックアップは公開しません。
- playit.ggのUAC確認、初回アカウント連携、最初のMinecraftトンネル作成は公式画面で利用者が行います。パスワード、二要素認証コード、生トークンはアプリへ入力・保存しません。
- 初回のWindowsファイアウォール確認では、信頼できるプライベートネットワークだけを利用者本人が許可する必要があります。アプリからWindowsのセキュリティ設定を勝手に変更しません。
- Minecraft EULAへの同意は利用者本人の明示操作が必要です。
- PalworldサーバーはSteamCMDの固定公式HTTPS配布元から取得し、自己更新後の`steamcmd.exe`もValveのWindows署名を再検証します。非公式ミラーは使用しません。
- Palworldの管理パスワードのアプリ側コピーはWindows資格情報マネージャーへ保存し、SQLite・画面・ログへ平文保存しません。Palworld自身の`PalWorldSettings.ini`には管理パスワードが必要なため、この設定ファイルも秘密情報として扱ってください。
- アプリのPalworld RESTクライアントは`127.0.0.1`だけへ接続します。ただしPalServer側の待受範囲までは保証できないため、REST管理用TCPポートはWindowsファイアウォールでLAN／インターネットから遮断し、ルーターのポート転送、公開VPN、トンネルへ設定しないでください。公式APIが返す接続元IPと座標は破棄します。
- Palworldの通常停止はREST APIの保存成功後に安全停止を要求します。保存に失敗した場合、アプリは自動で強制終了しません。

## Development

```powershell
npm install
npm run check
npm test
npm run test:ui
npm run verify:release
npm run tauri dev
```

Rustバックエンドは `cd src-tauri; cargo test`、紹介サイトは `cd website; npm run build; npm test` で確認できます。

実機Palworld受入試験は、空の専用フォルダーと未使用ポートを環境変数で指定したうえで、明示的にignoredテストを実行します。この試験は約6 GiBを取得し、本物のPalworldクライアント参加を最大15分待ちます。

実サーバー作成は各公式配布元からファイルを取得します。外部配布サイトの完全な互換性を保証するものではありません。

このプロジェクトはMojang Studios、Microsoft、Pocketpair、Valveの公式製品ではなく、承認・提携を受けたものではありません。公開前に仮称を独自名へ変更します。

## Code signing policy

通常のアプリ内更新は、0.3.9と同じTauri Updater署名を必須とします。SignPathとWindows Authenticodeは通常更新の必須条件ではありません。秘密鍵を含まないローカルQAと、公開用の署名済み資産を混同しないため、詳細は[コード署名ポリシー](docs/CODE_SIGNING_POLICY.md)と[アプリ更新の配布手順](docs/APP_UPDATE_RELEASE.md)を参照してください。

## License

Minecraft Server Hub is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
