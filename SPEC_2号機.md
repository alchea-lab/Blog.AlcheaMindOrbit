# 2号機システム仕様書（Blog_AlcheaMindOrbit）

対象: `alchea-lab/Blog.AlcheaMindOrbit`

## 1. 目的
- LINEで受けた本文と画像から、動画生成とSNS投稿を自動化する。
- フローは `LINE -> GAS -> GitHub Actions(FFmpeg) -> Make -> WordPress/Instagram/YouTube`。
- WordPress投稿先は `https://bijoux-graces.com/` の `alchea-mind-orbit` カテゴリ。

## 2. 全体構成
1. LINE Messaging API: 本文/画像/コマンド受信
2. GAS (`Main.js`): 解析、キャプション生成、状態管理、GitHub起動
3. GitHub Actions (`video-creator.yml`): 動画合成、Cloudinaryアップロード、Make通知
4. Make: 各媒体投稿（WordPress/Instagram/YouTube）
5. Spreadsheet: 実行ログと投稿データ記録
6. Cloudinary: 入力画像・出力動画URL

## 3. LINE操作仕様
- 本文送信: Markdown本文を受信して待機状態へ
- 画像送信: 1〜2枚受信
- 実行コマンド:
  - `開始` -> `text_mode=both`
  - `開始 1のみ` -> `text_mode=first_only`
- 補助コマンド:
  - `キャンセル`
  - `シート初期化`
  - `再配信`
  - `再配信 insta|youtube|blog|all`
  - `再配信 YYYY-MM-DD insta`

## 4. スプレッドシート仕様
- `SPREADSHEET_ID`: `1qFuPCbyRHOVj8PiEAVRLiYuyYYit54l5N0jDjKY47oY`
- 管理シート: `自動投稿管理`
  - 無ければ自動作成
  - ヘッダー13列:
    - `実行日時`
    - `投稿日時（予約）`
    - `記事タイトル`
    - `Instagramキャプション`
    - `画像URL①`
    - `画像URL②`
    - `動画URL（Drive）`
    - `音楽URL`
    - `合成動画URL（Drive）`
    - `WordPress URL`
    - `Instagram投稿ID`
    - `YouTube動画ID`
    - `ステータス`
- 音楽シート: `音楽リスト`
  - 無ければ自動作成
  - ヘッダー:
    - A列 `ジャンル`
    - B列 `雰囲気`
    - C列 `音楽URL`
  - データ行は手動入力が必要

## 5. 生成仕様
- `video_text_1`
- `video_text_2`（`first_only`時は `""`）
- `caption_insta`
- `caption_threads`
- `caption_youtube`
- `tags_youtube`

## 6. 動画生成仕様
- 画像1枚:
  - 前半に `video_text_1`
  - 後半に `video_text_2`
  - 合計15秒
- 画像2枚:
  - 1枚目に `video_text_1`
  - 2枚目に `video_text_2`
  - 合計15秒
- `video_text_2=""` のとき:
  - 2枚目は文字なし

## 7. Make連携
- Webhook URL は 2号機専用のものを使う
- シナリオは `Immediately as data arrives`
- `Regenerate structure` 実施済み前提
- 再配信では `repost_channel` を見て媒体分岐する

## 8. WordPress連携
- 投稿先サイト: `https://bijoux-graces.com`
- カテゴリ: `alchea-mind-orbit`
- `Featured media ID` は `Create a Media Item` の `Media Item ID` を使う
- `wp-config.php` は Warning を REST API に混ぜないこと

## 9. 受け入れテスト
1. `シート初期化`
2. `開始`
3. `開始 1のみ`
4. 画像1枚
5. 画像2枚
6. Make受信200系
7. WordPress投稿成功
8. Instagram投稿成功
9. YouTube投稿成功
10. 再配信成功
