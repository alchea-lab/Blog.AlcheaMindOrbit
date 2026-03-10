# Blog.AlcheaMindOrbit 2号機セットアップ

## このフォルダに入っているもの
- `Main.js` (現行ロジック複製)
- `appsscript.json` (GASマニフェスト)
- `.github/workflows/video-creator.yml` (動画生成ワークフロー)
- `Config.template.js` (値を入れて `Config.js` にリネーム)

## 1. GitHub
- Repository: `https://github.com/alchea-lab/Blog.AlcheaMindOrbit`
- Actions secrets に以下を作成
  - `MAKE_WEBHOOK_URL`
  - `GAS_WEBHOOK_URL`
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`

## 2. GAS
1. 新規 GAS プロジェクトを作成
2. このフォルダの `Main.js` / `appsscript.json` を反映
3. `Config.template.js` を `Config.js` にして値を埋める
4. Webアプリとしてデプロイし `/exec` URL を取得

### Script Properties 推奨キー
- `GH_OWNER=alchea-lab`
- `GH_REPO=Blog.AlcheaMindOrbit`
- `GH_PAT=...`
- `MAKE_WEBHOOK_URL=...`
- `GAS_WEBHOOK_URL=...`

## 3. Make
- 既存シナリオを Clone
- Webhook URL を再生成
- WordPress の投稿カテゴリを `alchea-mind-orbit` に固定
- Instagram / YouTube は既存コネクションを選択
- `Run once` 後に `Regenerate structure`

## 4. WordPress
- 投稿先: `https://bijoux-graces.com/`
- カテゴリスラッグ: `alchea-mind-orbit`
- カテゴリID取得例:
  - `GET https://bijoux-graces.com/wp-json/wp/v2/categories?slug=alchea-mind-orbit`

## 5. 動作確認
1. LINEで本文 + 画像送信
2. 「開始」実行
3. GitHub Actions `create-video` 成功
4. Make 受信成功
5. WordPress / Instagram / YouTube 投稿確認
