# AI引き継ぎ指示書（2号機: Blog_AlcheaMindOrbit）

## プロジェクト情報
- Repository: `https://github.com/alchea-lab/Blog.AlcheaMindOrbit`
- WordPress: `https://bijoux-graces.com`
- カテゴリ: `alchea-mind-orbit`
- Spreadsheet: `1qFuPCbyRHOVj8PiEAVRLiYuyYYit54l5N0jDjKY47oY`

## 絶対条件
1. 既存運用を壊さない
2. 変更は最小差分
3. `video_text_2` は `""` を許容
4. Make webhook / GitHub Secrets / GAS Config の同期漏れを出さない
5. WordPress REST レスポンスへ Warning を混ぜない

## 優先確認箇所
1. `Main.js`
2. `.github/workflows/video-creator.yml`
3. Make webhook payload
4. WordPress投稿ルート
5. Instagram / YouTubeルート

## テスト最低限
1. `開始`
2. `開始 1のみ`
3. `シート初期化`
4. WordPress投稿
5. Instagram投稿
6. YouTube投稿
7. `再配信 insta|youtube|blog|all`

## 依頼テンプレート
```text
Project: Blog.AlcheaMindOrbit

Goal:
LINE -> GAS -> GitHub Actions -> Make -> WordPress/Instagram/YouTube
の既存運用を維持したまま、指定変更だけ最小差分で実装してください。

Constraints:
- 運用破壊禁止
- webhook URL / secrets / config の同期漏れ禁止
- payload契約を先に固定
- 15秒動画を維持

Do:
1) 現状診断
2) 最小変更で実装
3) テスト観点を提示
4) 変更差分を要約
```
