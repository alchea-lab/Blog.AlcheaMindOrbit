# 2号機 プロンプト一覧

対象リポジトリ: `Blog_AlcheaMindOrbit`

## どこを触れば何が変わるか
- 文体の世界観を変える
  - [Config.js](/Users/tsujimiho/Documents/GitHub/my-blog-system-gas/Blog_AlcheaMindOrbit/Config.js): `STYLE.captionPrompt`
- 画像の雰囲気を変える
  - [Config.js](/Users/tsujimiho/Documents/GitHub/my-blog-system-gas/Blog_AlcheaMindOrbit/Config.js): `STYLE.imagePromptStyle`
- 記事解析のJSON形式を変える
  - [Main.js](/Users/tsujimiho/Documents/GitHub/my-blog-system-gas/Blog_AlcheaMindOrbit/Main.js): `analyzeMarkdown(...)`
- Instagram本文を変える
  - [Main.js](/Users/tsujimiho/Documents/GitHub/my-blog-system-gas/Blog_AlcheaMindOrbit/Main.js): `generateCaptionInstagram(...)`
- Threads本文を変える
  - [Main.js](/Users/tsujimiho/Documents/GitHub/my-blog-system-gas/Blog_AlcheaMindOrbit/Main.js): `generateCaptionThreads(...)`
- YouTube説明文を変える
  - [Main.js](/Users/tsujimiho/Documents/GitHub/my-blog-system-gas/Blog_AlcheaMindOrbit/Main.js): `generateCaptionYouTube(...)`
  - [Main.js](/Users/tsujimiho/Documents/GitHub/my-blog-system-gas/Blog_AlcheaMindOrbit/Main.js): `_normalizeYouTubeDescription(...)`
- 動画字幕のルールを変える
  - [Main.js](/Users/tsujimiho/Documents/GitHub/my-blog-system-gas/Blog_AlcheaMindOrbit/Main.js): `generateVideoAndCaptions(...)`

## 注意
- JSON出力を崩すと後段が壊れる
- `video_text_2` を `null` にしない
- YouTube説明文は Markdown/HTML を混ぜない
