/**
 * ================================================================
 *  🌙 Astro Strategist — Blog Automation System
 *  Main.js  |  Google Apps Script
 * ================================================================
 *
 *  ARCHITECTURE (5 Layers)
 *  ─────────────────────────────────────────────────────────────
 *  [1] LINE I/O        ─ send/receive, state machine
 *  [2] Spreadsheet     ─ read/write persistent records
 *  [3] Gemini AI       ─ analysis, captions, tag generation
 *  [4] Cloudinary      ─ upload, composite video, cleanup
 *  [5] Pipeline        ─ orchestrate full flow (phase1_FromLine)
 *  ─────────────────────────────────────────────────────────────
 *
 *  KNOWN FIX POINTS
 *  - [FIX-1] Image reception uses LockService before writing Properties.
 *  - [FIX-2] Cloudinary public_id values are sanitised (/ → :).
 *  - [FIX-3] Video fetch from Cloudinary uses polling.
 *  - [FIX-4] Cloudinary upload uses sorted HMAC-SHA1 signature.
 *  - [FIX-5] Cleanup errors never mask root cause.
 *  - [FIX-6] LINE command now supports text_mode:
 *            "開始"        → both
 *            "開始 1のみ" → first_only
 * ================================================================
 */


// ================================================================
//  LAYER 1 ─ LINE I/O
// ================================================================

/**
 * LINE Reply API — sends a single text reply to a user message.
 * Safe: no-ops on blank messages.
 *
 * @param {string} replyToken
 * @param {string} message
 */
function replyToLine(replyToken, message) {
  if (!replyToken || !message || String(message).trim() === '') return;

  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + CONFIG.LINE_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: String(message) }],
    }),
  });
}

/**
 * LINE Push API — pushes a message to a user at any time.
 * Safe: no-ops on blank messages or missing userId.
 *
 * @param {string} userId
 * @param {string} message
 */
function pushToLine(userId, message) {
  if (!userId || !message || String(message).trim() === '') return;

  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + CONFIG.LINE_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text: String(message) }],
    }),
  });
}

/**
 * Fetches binary content for a LINE image message.
 *
 * @param  {string} messageId  event.message.id from the webhook
 * @returns {GoogleAppsScript.Base.Blob}
 */
function fetchLineImage(messageId) {
  const res = UrlFetchApp.fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      muteHttpExceptions: true,
      headers: { 'Authorization': 'Bearer ' + CONFIG.LINE_ACCESS_TOKEN },
    }
  );

  if (res.getResponseCode() !== 200) {
    throw new Error(`LINE画像の取得に失敗しました (HTTP ${res.getResponseCode()})`);
  }

  return res.getBlob();
}

// ──────────────────────────────────────────────────────────────
//  User State  ─ thin wrapper around PropertiesService
// ──────────────────────────────────────────────────────────────

/**
 * Persists arbitrary user-state JSON (or deletes on null).
 * @param {string} userId
 * @param {object|null} state
 */
function saveUserState(userId, state) {
  const props = PropertiesService.getScriptProperties();
  const key = 'state_' + userId;

  if (state === null) {
    props.deleteProperty(key);
  } else {
    props.setProperty(key, JSON.stringify(state));
  }
}

/**
 * @param {string} userId
 * @returns {object|null}
 */
function getUserState(userId) {
  const raw = PropertiesService.getScriptProperties().getProperty('state_' + userId);
  return raw ? JSON.parse(raw) : null;
}

// ──────────────────────────────────────────────────────────────
//  doPost  ─ entry point
// ──────────────────────────────────────────────────────────────

/**
 * Main webhook handler.
 * Handles:
 *  1) GitHub callback: { action: "video_complete", video_url: "..." }
 *  2) LINE webhook events
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 */
function doPost(e) {
  let userId = '';

  try {
    const body = JSON.parse(e.postData.contents);

    // ── GitHub Actions callback ──────────────────────────────
    if (body.action === 'video_complete') {
      return handleVideoCallback(body);
    }

    // ── LINE Webhook ────────────────────────────────────────
    const event = body.events && body.events[0];
    if (!event) return ContentService.createTextOutput('ok');

    userId = event.source.userId;
    const replyToken = event.replyToken;
    const msgType = event.message ? event.message.type : null;

    if (msgType === 'text') {
      _handleTextMessage(userId, replyToken, event.message.text || '');
    } else if (msgType === 'image') {
      _handleImageMessage(userId, replyToken, event.message.id);
    }

  } catch (err) {
    console.error('[doPost] Unhandled error:', err.message, err.stack);
    if (userId) pushToLine(userId, '❌ 受信エラー: ' + err.message);
  }

  return ContentService.createTextOutput('ok');
}

/**
 * GitHub Actions からのコールバックを処理する。
 * フロー: GitHub (FFmpeg動画完成) → GAS (LINE通知 + スプレッド更新)
 *
 * @param {Object} body
 */
function handleVideoCallback(body) {
  try {
    const props = PropertiesService.getScriptProperties();
    const userId = props.getProperty('last_user_id');
    const videoUrl = body.video_url || '';

    console.log('[handleVideoCallback] video_url:', videoUrl, 'userId:', userId);

    if (userId && videoUrl) {
      pushToLine(
        userId,
        '🎬 GitHub Actions 動画完成！🌸\n\n' +
        '🔗 動画 URL:\n' + videoUrl + '\n\n' +
        '✅ Make が自動で Instagram / YouTube に投稿します🌙'
      );
    }

    if (videoUrl) {
      _updateSheetVideoUrl(videoUrl);
    }

  } catch (err) {
    console.error('[handleVideoCallback] Error:', err.message);
  }

  return ContentService.createTextOutput('ok');
}

/**
 * スプレッドシートの最新行の動画 URL カラムを更新する。
 * @param {string} videoUrl
 */
function _updateSheetVideoUrl(videoUrl) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    // G列 = 動画URL（Drive）
    sheet.getRange(lastRow, 7).setValue(videoUrl);
    // I列 = 合成動画URL（Drive）
    sheet.getRange(lastRow, 9).setValue(videoUrl);

    console.log(`[_updateSheetVideoUrl] Row ${lastRow} の動画 URL を更新しました: ${videoUrl}`);
  } catch (err) {
    console.error('[_updateSheetVideoUrl] Error: ' + err.message);
  }
}

/**
 * Routes incoming text to the correct action.
 * @private
 */
function _handleTextMessage(userId, replyToken, text) {
  const props = PropertiesService.getScriptProperties();

  // ── キャンセル ──────────────────────────────────────────────
  if (text === 'キャンセル') {
    _cancelPipeline(userId, props);
    replyToLine(replyToken, '❌ キャンセルしました。最初からやり直してください🌸');
    return;
  }

  // ── 開始 [日時] ─────────────────────────────────────────────
  if (text.startsWith('開始')) {
    const images = JSON.parse(props.getProperty('pending_images') || '[]');

    if (images.length === 0) {
      replyToLine(replyToken, '⚠️ 画像がまだ届いていません。\n画像を送ってから「開始」してください。');
      return;
    }

    const textMode = _detectTextMode(text);
    props.setProperty('text_mode', textMode);
    // Ensure progress push notifications target the current sender.
    props.setProperty('pending_userId', userId);

    const scheduledAt = _parseScheduledDate(text.replace('開始', '').trim());
    props.setProperty('scheduled_at', scheduledAt.iso);
    props.setProperty('phase1_done', 'false');
    saveUserState(userId, { phase: 'processing' });

    _deleteTriggersFor('phase1_FromLine');
    ScriptApp.newTrigger('phase1_FromLine').timeBased().after(10000).create();

    const modeMsg = textMode === 'first_only'
      ? '\n📝 モード: 1枚目のみ文字'
      : '\n📝 モード: 1枚目・2枚目とも文字あり';

    replyToLine(
      replyToken,
      `${scheduledAt.replyMsg}${modeMsg}\n\n⚙️ 文章解析を開始します。完了まで少しお待ちください。`
    );
    // Execute once immediately to avoid missing time-based trigger executions.
    phase1_FromLine();
    return;
  }

  // ── 本文（Markdown）受信 ─────────────────────────────────
  if (text.startsWith('# ') || text.startsWith('## ') || text.length > 2000) {
    props.setProperty('pending_markdown', text);
    props.setProperty('pending_userId', userId);
    props.setProperty('pending_images', '[]');
    props.setProperty('pending_imageIds', '[]');
    props.setProperty('phase1_done', 'false');
    props.deleteProperty('scheduled_at');
    props.deleteProperty('text_mode');
    saveUserState(userId, { phase: 'waiting_image' });

    replyToLine(replyToken, '✅ 本文受信！\n次に画像を1〜2枚送ってください📸');
    return;
  }

  // ── ヘルプ ───────────────────────────────────────────────
  replyToLine(
    replyToken,
    '🌙 Astro Strategist へようこそ\n\n' +
    '① 本文（Markdown）を送信\n' +
    '② 画像を1〜2枚送信\n' +
    '③ 「開始」または「開始 明日19時」で実行\n' +
    '   2枚目を文字なしにしたい時だけ「開始 1のみ」\n\n' +
    '途中でやめる時は「キャンセル」'
  );
}

/**
 * LINEの「開始」コマンドから text_mode を判定する。
 * デフォルト: both
 * 例外: first_only
 *
 * @param {string} text
 * @returns {"both"|"first_only"}
 */
function _detectTextMode(text) {
  const normalized = String(text || '')
    .replace(/　/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();

  const firstOnlyPatterns = [
    '1のみ',
    '１のみ',
    '1枚目のみ',
    '１枚目のみ',
    '1枚目だけ',
    '１枚目だけ',
    '1だけ',
    '１だけ',
    '2枚目なし',
    '２枚目なし',
    '2枚目不要',
    '２枚目不要',
    '2枚目文字なし',
    '２枚目文字なし',
  ];

  const isFirstOnly = firstOnlyPatterns.some(function(p) {
    return normalized.indexOf(p) !== -1;
  });

  return isFirstOnly ? 'first_only' : 'both';
}

/**
 * Handles an incoming image from LINE.
 * @private
 */
function _handleImageMessage(userId, replyToken, lineMessageId) {
  const props = PropertiesService.getScriptProperties();

  // 1. LINE から画像バイナリを取得
  const imageBlob = fetchLineImage(lineMessageId);

  // 2. Google Drive に永続保存
  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const file = folder.createFile(imageBlob.copyBlob().setName('img_' + Date.now() + '.jpg'));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const driveUrl = `https://drive.google.com/uc?export=download&id=${file.getId()}`;

  // 3. Cloudinary に画像をアップロード
  const publicId = uploadToCloudinary(imageBlob, 'image');

  // 4. 排他的にプロパティへ追記
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  let totalImages;
  try {
    const images = JSON.parse(props.getProperty('pending_images') || '[]');
    const imageIds = JSON.parse(props.getProperty('pending_imageIds') || '[]');

    images.push(driveUrl);
    imageIds.push(publicId);

    props.setProperty('pending_images', JSON.stringify(images));
    props.setProperty('pending_imageIds', JSON.stringify(imageIds));

    totalImages = images.length;
  } finally {
    lock.releaseLock();
  }

  replyToLine(replyToken, `✅ 画像 ${totalImages} 枚目を受信しました！`);
}

/**
 * Cleans up all pending state and kills any running triggers.
 * @private
 */
function _cancelPipeline(userId, props) {
  props.setProperty('phase1_done', 'true');
  _deleteTriggersFor('phase1_FromLine');
  props.deleteProperty('pending_markdown');
  props.deleteProperty('pending_images');
  props.deleteProperty('pending_imageIds');
  props.deleteProperty('pending_userId');
  props.deleteProperty('scheduled_at');
  props.deleteProperty('text_mode');
  saveUserState(userId, null);
}

/**
 * Deletes all project-level time-based triggers for a given function name.
 * @private
 */
function _deleteTriggersFor(handlerName) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(t);
  });
}

/**
 * Parses a natural-language date string using Gemini and returns
 * an ISO-8601 string and a human-readable reply message.
 *
 * @param  {string} dateText
 * @returns {{ iso: string, replyMsg: string }}
 * @private
 */
function _parseScheduledDate(dateText) {
  const IMMEDIATE_MSG =
    '⏳ 開始します！\n完成したらすぐ投稿します🌸\n\n途中でやめる時は「キャンセル」と送ってください。';

  if (!dateText) {
    return { iso: '', replyMsg: IMMEDIATE_MSG };
  }

  try {
    const now = new Date();
    const parsed = callGemini(
      `今は${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日${now.getHours()}時です。\n` +
      `「${dateText}」をISO8601形式（例: 2026-03-10T19:00:00+09:00）に変換してください。\n` +
      `ISO8601の文字列のみ返してください。`
    )
      .replace(/`/g, '')
      .replace(/json/gi, '')
      .trim();

    const d = new Date(parsed);
    if (isNaN(d.getTime())) {
      return { iso: '', replyMsg: IMMEDIATE_MSG };
    }

    const m = d.getMonth() + 1;
    const day = d.getDate();
    const h = d.getHours();
    const min = String(d.getMinutes()).padStart(2, '0');

    return {
      iso: parsed,
      replyMsg:
        `⏳ 開始します！\n📅 ${m}月${day}日 ${h}:${min} に投稿予定🌸\n\n` +
        '途中でやめる時は「キャンセル」と送ってください。',
    };
  } catch (err) {
    console.warn('[_parseScheduledDate] parse failed:', err.message);
    return { iso: '', replyMsg: IMMEDIATE_MSG };
  }
}


// ================================================================
//  LAYER 2 ─ Spreadsheet
// ================================================================

/**
 * Returns (and auto-creates if necessary) the managed sheet.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);

    const headers = [
      '実行日時',
      '投稿日時（予約）',
      '記事タイトル',
      'Instagramキャプション',
      '画像URL①',
      '画像URL②',
      '動画URL（Drive）',
      '音楽URL',
      '合成動画URL（Drive）',
      'WordPress URL',
      'Instagram投稿ID',
      'YouTube動画ID',
      'ステータス',
    ];

    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setBackground('#1a1a2e')
      .setFontColor('#c9a96e')
      .setFontWeight('bold');

    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Appends one record to the managed sheet.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.captionInstagram
 * @param {string} p.imageUrl1
 * @param {string} [p.imageUrl2]
 * @param {string} p.driveVideoUrl
 * @param {string} p.musicUrl
 * @param {string} [p.wpUrl]
 * @param {string} [p.scheduledAt]
 */
function saveToSheet(params) {
  getSheet().appendRow([
    new Date(),
    params.scheduledAt || '',
    params.title || '',
    params.captionInstagram || '',
    params.imageUrl1 || '',
    params.imageUrl2 || '',
    params.driveVideoUrl || '',
    params.musicUrl || '',
    params.driveVideoUrl || '',
    params.wpUrl || '',
    '',
    '',
    '✅ 生成完了',
  ]);
}

/**
 * Picks BGM from the "音楽リスト" sheet using Gemini.
 *
 * @param  {string} theme
 * @returns {string}
 */
function selectMusicFromSheet(theme) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName('音楽リスト');
  if (!sheet) throw new Error('「音楽リスト」シートが見つかりません');

  const rows = sheet.getDataRange().getValues().slice(1);
  if (rows.length === 0) throw new Error('音楽リストが空です');

  const list = rows.map(function(r, i) {
    return `${i}: ジャンル=${r[0]}, 雰囲気=${r[1]}`;
  }).join('\n');

  const result = callGemini(
    `記事のテーマ「${theme}」に最も合う音楽を以下から1つ選び、番号のみ返してください。\n${list}`
  );

  const index = parseInt(result.trim(), 10);

  return (!isNaN(index) && index >= 0 && index < rows.length)
    ? rows[index][2]
    : rows[0][2];
}


// ================================================================
//  LAYER 3 ─ Gemini AI
// ================================================================

/**
 * Calls the Gemini API with exponential backoff (up to 5 attempts).
 *
 * @param  {string} prompt
 * @returns {string}
 */
function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (res.getResponseCode() === 200) {
      const json = JSON.parse(res.getContentText());
      return json.candidates[0].content.parts[0].text;
    }

    console.warn(`[callGemini] attempt ${attempt + 1}: HTTP ${res.getResponseCode()}`);
    Utilities.sleep(15000 * (attempt + 1));
  }

  throw new Error('Gemini API への呼び出しが 5 回失敗しました。しばらく待ってから再試行してください。');
}

/**
 * Analyses a Markdown article and returns structured JSON.
 *
 * @param  {string} markdown
 * @returns {{ title: string, body: string, excerpt: string, tags: string[], theme: string }}
 */
function analyzeMarkdown(markdown) {
  const prompt = [
    '以下のマークダウン記事を分析し、次のJSON形式のみ返してください。',
    '{',
    '  "title":   "記事タイトル",',
    '  "body":    "WordPress投稿用HTML",',
    '  "excerpt": "要約100文字以内",',
    '  "tags":    ["タグ1","タグ2","タグ3"],',
    '  "theme":   "メインテーマ（一言）"',
    '}',
    'マークダウン:',
    markdown,
  ].join('\n');

  const raw = callGemini(prompt);

  try {
    const cleaned = raw
      .replace(/```json|```/gi, '')
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .trim();

    return JSON.parse(cleaned);
  } catch (_) {
    console.warn('[analyzeMarkdown] JSON parse failed, using fallback.');
    return {
      title: '自動生成タイトル',
      body: markdown,
      excerpt: markdown.substring(0, 100),
      tags: ['ブログ'],
      theme: '日常',
    };
  }
}

/**
 * Generates 5 SEO hashtags.
 * @param {{ title: string, theme: string }} blog
 * @returns {string}
 */
function generateHashtags(blog) {
  return callGemini(
    `記事「${blog.title}」テーマ「${blog.theme}」に最適なSEOハッシュタグを5つ生成してください。\n` +
    `条件:\n` +
    `- 必ず5つ\n` +
    `- 日本語と英語を混在させてOK\n` +
    `- 検索されやすい人気タグを選ぶ\n` +
    `- 出力形式: #タグ1 #タグ2 #タグ3 #タグ4 #タグ5\n` +
    `- ハッシュタグのみ出力（説明文不要）`
  ).trim();
}

/**
 * Generates an Instagram caption.
 * @param {{ title: string, body: string }} blog
 * @param {string} hashtags
 * @returns {string}
 */
function generateCaptionInstagram(blog, hashtags) {
  const MAX = 2200;
  const result = callGemini(
    `${STYLE.captionPrompt}\n` +
    `※絶対厳守：${MAX}文字以内で出力してください。\n` +
    `※末尾に必ず以下のハッシュタグを追加: ${hashtags}\n` +
    `記事タイトル: ${blog.title}\n本文: ${blog.body.substring(0, 3000)}`
  );

  if (result.length <= MAX) return result;

  const hashtagSuffix = '\n\n' + hashtags;
  return result.substring(0, MAX - hashtagSuffix.length) + hashtagSuffix;
}

/**
 * Generates a Threads caption.
 * @param {{ title: string, body: string }} blog
 * @returns {string}
 */
function generateCaptionThreads(blog) {
  const result = callGemini(
    `${STYLE.captionPrompt}\n` +
    `※重要：必ず500文字以内で出力してください。ハッシュタグは不要です。\n` +
    `記事タイトル: ${blog.title}\n本文: ${blog.body.substring(0, 3000)}`
  );
  return result.length > 500 ? result.substring(0, 500) : result;
}

/**
 * Generates a YouTube Shorts description.
 * @param {{ title: string, body: string }} blog
 * @param {string} hashtags
 * @returns {string}
 */
function generateCaptionYouTube(blog, hashtags) {
  const prompt = [
    '# Role',
    'あなたは YouTube Shorts 用の説明文ライターです。',
    '',
    '# Task',
    '次の記事情報から、YouTube用の説明文を1本作成してください。',
    '',
    '# Rules',
    '- 出力はプレーンテキストのみ（Markdown記号・HTMLタグ禁止）',
    '- 先頭は強い導入1文、その後に要点を2〜4文で簡潔にまとめる',
    '- 最後に「詳しくは元記事をご覧ください。」で締める',
    '- 全体で80〜180文字（Shorts向けに簡潔に）',
    `- 末尾に次のハッシュタグをそのまま追加: ${hashtags}`,
    '- JSONは不要。説明文本文のみ出力',
    '',
    '# Input',
    `記事タイトル: ${blog.title}`,
    `本文: ${blog.body.substring(0, 3000)}`
  ].join('\n');

  const raw = callGemini(prompt);
  return _normalizeYouTubeDescription(raw, hashtags);
}

/**
 * Normalizes YouTube description text to avoid Markdown/HTML leakage.
 * @param {string} text
 * @param {string} hashtagsText
 * @returns {string}
 * @private
 */
function _normalizeYouTubeDescription(text, hashtagsText) {
  const tags = String(hashtagsText || '')
    .split(/\s+/)
    .filter(function(t) { return /^#/.test(t); })
    .slice(0, 5)
    .join(' ');

  let cleaned = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`~>\[\]\(\)\|]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // If model forgot a clear ending, add one for channel consistency.
  if (!/詳しくは元記事をご覧ください。$/.test(cleaned)) {
    cleaned = `${cleaned}\n\n詳しくは元記事をご覧ください。`.trim();
  }

  if (tags) {
    cleaned = cleaned
      .replace(/#[\w\u3040-\u30FF\u3400-\u9FFFー]+/g, '')
      .trim();
    cleaned = `${cleaned}\n\n${tags}`.trim();
  }

  // Keep Shorts description concise while preserving tags.
  const MAX_TEXT_WITHOUT_TAGS = 180;
  const suffix = tags ? `\n\n${tags}` : '';
  const allowedBodyLen = Math.max(80, MAX_TEXT_WITHOUT_TAGS - suffix.length);

  if (cleaned.length > allowedBodyLen) {
    cleaned = cleaned.substring(0, allowedBodyLen).trim();
  }

  if (cleaned.length < 80) {
    cleaned = `${cleaned}\n要点を短く整理してお届けします。`.trim();
  }

  if (tags) {
    cleaned = cleaned
      .replace(/#[\w\u3040-\u30FF\u3400-\u9FFFー]+/g, '')
      .trim();
    cleaned = `${cleaned}${suffix}`.trim();
  }

  return cleaned;
}

/**
 * Generates 15 YouTube tags as a JSON array.
 * @param {{ title: string, theme: string }} blog
 * @returns {string[]}
 */
function generateYoutubeTags(blog) {
  const result = callGemini(
    `記事「${blog.title}」テーマ「${blog.theme}」に最適なYouTubeタグを15個生成してください。\n` +
    `条件:\n` +
    `- 日本語と英語を混在させてOK\n` +
    `- 検索されやすいキーワードを選ぶ\n` +
    `- JSONの配列形式のみ出力（例: ["タグ1","タグ2"]）\n` +
    `- 説明文不要`
  );

  try {
    return JSON.parse(result.replace(/```json|```/gi, '').trim());
  } catch (_) {
    return [blog.theme, blog.title, 'ショート動画', 'shorts'];
  }
}

/**
 * 動画字幕 + Instagram/Threads キャプションを Gemini で一括生成する。
 *
 * @param {{ title: string, body: string }} blog
 * @param {"both"|"first_only"} textMode
 * @returns {{
 *   video_text_1: string,
 *   video_text_2: string,
 *   caption_insta: string,
 *   caption_threads: string
 * }}
 */
function generateVideoAndCaptions(blog, textMode) {
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const variationToken = Utilities.getUuid().slice(0, 8);
  const prompt = [
    '# Role',
    'あなたは、心理学と脳科学の視点を併せ持つ専属コピーライターです。',
    '親子関係や日々の心理的な事象を、脳科学的な仕組みの観点から、「優しく、洗練された知性」をもって言語化してください。',
    '',
    '# Task',
    '入力された本文と text_mode をもとに、以下の4つの要素をJSON形式で出力してください。',
    '',
    '1. 【video_text_1】',
    '- 動画の1枚目に表示する短文',
    '- 親子関係や心理的葛藤への共感を、短く印象的に表現する',
    '- 28〜44文字を目安に作成する（短すぎる表現は避ける）',
    '- 最大44文字',
    '- 改行が必要な場合のみ \\n を使う',
    '- HTMLタグ、Markdown記号、絵文字、ハッシュタグは使わない',
    '',
    '2. 【video_text_2】',
    '- 動画の2枚目に表示する短文',
    '- その事象を脳科学の視点から一言で紐解く',
    '- 28〜44文字を目安に作成する（短すぎる表現は避ける）',
    '- 最大44文字',
    '- 改行が必要な場合のみ \\n を使う',
    '- HTMLタグ、Markdown記号、絵文字、ハッシュタグは使わない',
    '- text_mode が "first_only" の場合は、必ず空文字 "" を返す',
    '',
    '3. 【caption_insta】',
    '- Instagram用キャプション',
    '- 260〜420文字程度',
    '- video_text の内容を自然に補足する',
    '- 最後に、ブログへの自然な導線として「詳細はプロフィールのリンクから、この仕組みの全貌をご覧いただけます」という趣旨を洗練された言葉で添える',
    '- 語尾は「〜かもしれませんね」で終える',
    '- HTMLタグ、Markdown記号は使わない',
    '- ハッシュタグはここでは出力しない（後段で自動付与）',
    '',
    '4. 【caption_threads】',
    '- Threads用キャプション',
    '- 500文字程度',
    '- 論理的・構造的に一段深く解説する',
    '- 語尾は「〜かもしれませんね」で終える',
    '- HTMLタグ、Markdown記号、絵文字、ハッシュタグは使わない',
    '',
    '# Rules',
    '- 脳科学的な説明（例：扁桃体、神経系、防御反応など）は「自分を責めなくていい理由」として優しく配置する',
    '- 禁止語：占い、運勢、スピリチュアル、運命、神様、頑張れ、努力、クリック、読んで',
    '- 出力はJSONのみ',
    '',
    '# text_mode Rule',
    '- text_mode が "both" の場合は、video_text_1 と video_text_2 の両方を作成する',
    '- text_mode が "first_only" の場合は、video_text_1 のみ作成し、video_text_2 は必ず空文字 "" を返す',
    '',
    '# Output Format (JSON)',
    '{',
    '  "video_text_1": "",',
    '  "video_text_2": "",',
    '  "caption_insta": "",',
    '  "caption_threads": ""',
    '}',
    '',
    '# Input',
    `today: ${today}`,
    `variation_token: ${variationToken}`,
    `text_mode: ${textMode}`,
    `記事タイトル: ${blog.title}`,
    `本文: ${blog.body.substring(0, 3000)}`
  ].join('\n');

  const raw = callGemini(prompt);

  try {
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      video_text_1: parsed.video_text_1 || '',
      video_text_2: parsed.video_text_2 || '',
      caption_insta: parsed.caption_insta || '',
      caption_threads: parsed.caption_threads || '',
    };
  } catch (err) {
    console.warn('[generateVideoAndCaptions] JSON parse failed, fallback used.');
    return {
      video_text_1: '心が揺れる反応には、守ろうとする理由がある',
      video_text_2: textMode === 'first_only' ? '' : 'その揺れは、脳が安全を確かめる防御反応',
      caption_insta: 'その違和感には、責めなくていい仕組みが隠れているのかもしれませんね。詳細はプロフィールのリンクから、この仕組みの全貌をご覧いただけるかもしれませんね。',
      caption_threads: 'その違和感は、性格だけではなく脳の防御反応として起きている可能性があるかもしれませんね。'
    };
  }
}

/**
 * Ensures Instagram/Threads captions follow channel rules.
 *
 * @param {string} captionInsta
 * @param {string} captionThreads
 * @param {string} hashtagsText
 * @returns {{ captionInstagram: string, captionThreads: string }}
 * @private
 */
function _normalizeCaptionsByChannel(captionInsta, captionThreads, hashtagsText) {
  const requiredInstaTag = '#アイピーエム';
  const cleanThreads = String(captionThreads || '')
    .replace(/#[\w\u3040-\u30FF\u3400-\u9FFFー]+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let cleanInsta = String(captionInsta || '')
    .replace(/#[\w\u3040-\u30FF\u3400-\u9FFFー]+/g, '')
    .trim();

  const tagList = String(hashtagsText || '')
    .split(/\s+/)
    .filter(function(t) { return /^#/.test(t); })
    .filter(function(t, i, arr) { return arr.indexOf(t) === i; });

  if (tagList.indexOf(requiredInstaTag) === -1) {
    tagList.push(requiredInstaTag);
  }

  const tags = tagList.slice(0, 5).join(' ');

  if (tags) {
    cleanInsta = `${cleanInsta}\n\n${tags}`.trim();
  }

  return {
    captionInstagram: cleanInsta,
    captionThreads: cleanThreads
  };
}

/**
 * Regenerates Instagram caption once when it matches previous output.
 *
 * @param {{ title: string, body: string }} blog
 * @param {string} currentCaption
 * @param {string} hashtags
 * @param {string} previousCaption
 * @returns {string}
 * @private
 */
function _avoidDuplicateInstagramCaption(blog, currentCaption, hashtags, previousCaption) {
  const now = String(currentCaption || '').trim();
  const prev = String(previousCaption || '').trim();
  if (!now || !prev || now !== prev) return now;

  const prompt = [
    '# Role',
    'あなたはInstagramリール投稿のコピーライターです。',
    '',
    '# Task',
    '前回文と重複しない、新しいInstagramキャプションを1本作成してください。',
    '',
    '# Rules',
    '- 260〜420文字',
    '- プレーンテキストのみ（Markdown/HTML禁止）',
    '- 前回文と語彙・導入・締めを必ず変更する',
    '- 語尾は「〜かもしれませんね」で終える',
    `- 末尾のハッシュタグ候補: ${hashtags}`,
    '- 出力は本文のみ',
    '',
    '# Previous Caption (do not reuse)',
    prev,
    '',
    '# Input',
    `記事タイトル: ${blog.title}`,
    `本文: ${blog.body.substring(0, 3000)}`
  ].join('\n');

  const retry = callGemini(prompt);
  return String(retry || '').trim() || now;
}


// ================================================================
//  LAYER 4 ─ Cloudinary
// ================================================================

/**
 * Builds a Cloudinary HMAC-SHA1 signature from a sorted param map.
 *
 * @param  {Object<string,string>} params
 * @param  {string} apiSecret
 * @returns {string}
 * @private
 */
function _buildCloudinarySignature(params, apiSecret) {
  const sorted = Object.keys(params)
    .sort()
    .map(function(k) { return `${k}=${params[k]}`; })
    .join('&');

  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1,
    sorted + apiSecret
  ).map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

/**
 * Sanitises a Cloudinary public_id for use inside transformation URLs.
 *
 * @param  {string} publicId
 * @returns {string}
 * @private
 */
function _safeLayerId(publicId) {
  return publicId.replace(/\//g, ':');
}

/**
 * Uploads a file (blob or URL string) to Cloudinary.
 *
 * @param  {GoogleAppsScript.Base.Blob|string} fileOrUrl
 * @param  {'image'|'video'} resourceType
 * @param  {string} [folder]
 * @returns {string}
 */
function uploadToCloudinary(fileOrUrl, resourceType, folder) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sigParams = { timestamp: timestamp };
  if (folder) sigParams.folder = folder;

  const signature = _buildCloudinarySignature(sigParams, CONFIG.CLOUDINARY_API_SECRET);

  const payload = {
    api_key: CONFIG.CLOUDINARY_API_KEY,
    timestamp: timestamp,
    signature: signature,
    file: fileOrUrl,
  };
  if (folder) payload.folder = folder;

  const endpoint =
    `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

  const res = UrlFetchApp.fetch(endpoint, {
    method: 'POST',
    muteHttpExceptions: true,
    payload: payload,
  });

  const json = JSON.parse(res.getContentText());

  if (!json.public_id) {
    throw new Error(
      `Cloudinary ${resourceType} アップロード失敗 (HTTP ${res.getResponseCode()}): ` +
      res.getContentText().substring(0, 300)
    );
  }

  return json.public_id;
}

/**
 * Deletes a Cloudinary asset.
 *
 * @param {string} publicId
 * @param {'image'|'video'} resourceType
 */
function deleteFromCloudinary(publicId, resourceType) {
  if (!publicId) return;

  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = _buildCloudinarySignature(
      { public_id: publicId, timestamp: timestamp },
      CONFIG.CLOUDINARY_API_SECRET
    );

    UrlFetchApp.fetch(
      `https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/${resourceType || 'image'}/destroy`,
      {
        method: 'POST',
        muteHttpExceptions: true,
        payload: {
          public_id: publicId,
          api_key: CONFIG.CLOUDINARY_API_KEY,
          timestamp: timestamp,
          signature: signature,
        },
      }
    );
  } catch (e) {
    console.warn(`[deleteFromCloudinary] Cleanup failed for "${publicId}":`, e.message);
  }
}

/**
 * Builds the Cloudinary transformation URL that creates
 * a vertical 9:16 MP4 slideshow from 1-2 images with BGM.
 *
 * @param  {string} publicId1
 * @param  {string|null} publicId2
 * @param  {string} musicPublicId
 * @returns {string}
 */
function buildCloudinaryVideoUrl(publicId1, publicId2, musicPublicId) {
  const safe1 = _safeLayerId(publicId1);
  const safeMusic = _safeLayerId(musicPublicId);

  const parts = [
    `w_1080,h_1920,c_fill,du_15`,
  ];

  if (publicId2) {
    const safe2 = _safeLayerId(publicId2);
    parts.push(
      `l_${safe2}`,
      `w_1080,h_1920,c_fill,du_8`,
      `fl_layer_apply,so_7`
    );
  }

  parts.push(
    `l_video:${safeMusic}`,
    `e_volume:70`,
    `fl_layer_apply`,
    `f_mp4,q_auto`
  );

  const transform = parts.join('/');
  console.log('[buildCloudinaryVideoUrl] transform:', transform);
  return `https://res.cloudinary.com/${CONFIG.CLOUDINARY_CLOUD_NAME}/image/upload/${transform}/${safe1}.mp4`;
}

/**
 * Downloads the rendered MP4 from Cloudinary and saves it to Google Drive.
 *
 * @param  {string} videoUrl
 * @param  {string} title
 * @returns {string}
 */
function saveVideoToDrive(videoUrl, title) {
  const MAX_ATTEMPTS = 10;
  const BASE_WAIT_MS = 15000;
  const CAP_WAIT_MS = 90000;
  const MIN_VIDEO_BYTES = 500000;

  let lastContentType = '(未取得)';
  let lastStatus = 0;
  let lastSnippet = '';

  console.log('[saveVideoToDrive] Cloudinary の初回レンダリング待機中… (45秒)');
  Utilities.sleep(45000);
  console.log('[saveVideoToDrive] 初回待機完了。ポーリング開始。');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[saveVideoToDrive] 試行 ${attempt}/${MAX_ATTEMPTS}`);

    try {
      const res = UrlFetchApp.fetch(videoUrl, { muteHttpExceptions: true });
      lastStatus = res.getResponseCode();
      const headers = res.getHeaders();
      const contentType = (headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
      lastContentType = contentType;

      if (lastStatus === 200 && contentType.includes('video')) {
        const blob = res.getBlob();
        const sizeBytes = blob.getBytes().length;

        if (sizeBytes < MIN_VIDEO_BYTES) {
          console.warn(
            `[saveVideoToDrive] ファイルが小さすぎます (${Math.round(sizeBytes / 1024)} KB。` +
            `最低${Math.round(MIN_VIDEO_BYTES / 1024)} KB 必要)。まだ処理中と判断します。`
          );
        } else {
          const fileName = `${title}_${Date.now()}.mp4`;
          blob.setName(fileName);
          const folder = DriveApp.getFolderById(CONFIG.DRIVE_VIDEO_FOLDER_ID);
          const file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

          console.log(`[saveVideoToDrive] 保存完了: Drive ID=${file.getId()}, サイズ=${Math.round(sizeBytes / 1024)} KB`);
          return `https://drive.google.com/uc?export=download&id=${file.getId()}`;
        }
      }

      if (contentType.includes('image/gif') || contentType.includes('image')) {
        console.log(`[saveVideoToDrive] Cloudinary がまだ合成中です (${contentType})。待機します…`);
      } else {
        lastSnippet = res.getContentText().substring(0, 400);
        console.warn(`[saveVideoToDrive] 予期しないレスポンス HTTP ${lastStatus} / ${contentType}\n${lastSnippet}`);
      }

    } catch (fetchErr) {
      lastSnippet = fetchErr.message;
      console.warn(`[saveVideoToDrive] 通信エラー (試行${attempt}): ${fetchErr.message}`);
    }

    if (attempt < MAX_ATTEMPTS) {
      const waitMs = Math.min(BASE_WAIT_MS * attempt, CAP_WAIT_MS);
      console.log(`[saveVideoToDrive] ${waitMs / 1000}秒後に再試行します…`);
      Utilities.sleep(waitMs);
    }
  }

  throw new Error(
    `❌ Cloudinary動画の取得が${MAX_ATTEMPTS}回すべて失敗しました。\n` +
    `最終ステータス: HTTP ${lastStatus}\n` +
    `最終Content-Type: ${lastContentType}\n` +
    `レスポンス詳細: ${lastSnippet}`
  );
}


// ================================================================
//  LAYER 5 ─ Pipeline
// ================================================================

/**
 * GitHub Actions の video-creator.yml を repository_dispatch で起動する。
 *
 * @param {Object} payload
 */
function triggerGitHubVideoCreation(payload) {
  const url = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/dispatches`;
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = Utilities.newBlob(payloadJson).getBytes().length;

  console.log(`[triggerGitHubVideoCreation] client_payload size: ${payloadBytes} bytes`);
  if (payloadBytes > 60000) {
    throw new Error(
      `repository_dispatch payload が大きすぎます (${payloadBytes} bytes)。` +
      '本文量を減らして再実行してください。'
    );
  }

  const res = UrlFetchApp.fetch(url, {
    method: 'POST',
    muteHttpExceptions: true,
    headers: {
      'Authorization': `token ${CONFIG.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({
      event_type: 'create-video',
      client_payload: JSON.parse(payloadJson),
    }),
  });

  const status = res.getResponseCode();
  if (status !== 204) {
    throw new Error(
      `GitHub Actions の起動に失敗しました (HTTP ${status}): ${res.getContentText().substring(0, 300)}`
    );
  }

  console.log('[triggerGitHubVideoCreation] GitHub Actions ワークフローを起動しました。');
}

/**
 * Converts nullable values to a safe single-line-ish string.
 *
 * @param {*} value
 * @returns {string}
 * @private
 */
function _normalizeVideoText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Make.com webhook - broadcasts all generated assets.
 * @param {Object} params
 */
function sendToMakeWebhook(params) {
  UrlFetchApp.fetch(CONFIG.MAKE_WEBHOOK_URL, {
    method: 'POST',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify(params),
  });
}

/**
 * Main production pipeline.
 */
function phase1_FromLine() {
  const props = PropertiesService.getScriptProperties();
  const userId = props.getProperty('pending_userId') || '';

  if (props.getProperty('phase1_done') === 'true') {
    console.log('[phase1_FromLine] Already completed; skipping.');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.warn('[phase1_FromLine] Could not acquire lock; another instance is running.');
    // Retry once later instead of silently stopping the pipeline.
    _deleteTriggersFor('phase1_FromLine');
    ScriptApp.newTrigger('phase1_FromLine').timeBased().after(15000).create();
    return;
  }

  _deleteTriggersFor('phase1_FromLine');

  try {
    const markdown = props.getProperty('pending_markdown') || '';
    const images = JSON.parse(props.getProperty('pending_images') || '[]');
    const imageIds = JSON.parse(props.getProperty('pending_imageIds') || '[]');
    const scheduledAt = props.getProperty('scheduled_at') || '';
    const textMode = props.getProperty('text_mode') || 'both';

    if (!markdown) throw new Error('本文（Markdown）が存在しません。先に本文を送ってください。');
    if (images.length === 0) throw new Error('画像が1枚も届いていません。画像を送ってから「開始」してください。');
    if (imageIds.length !== images.length) {
      throw new Error(
        `画像データの不整合: Drive URL ${images.length}件 / Cloudinary ID ${imageIds.length}件。` +
        '\nもう一度最初からやり直してください。'
      );
    }

    props.setProperty('phase1_done', 'true');

    const imageUrl1 = images[0];
    const imageUrl2 = images[1] || '';
    const publicId1 = imageIds[0];
    const publicId2 = imageIds[1] || '';

    // Step 1
    pushToLine(userId, '⚙️ [1/4] 記事を解析中...');
    const analyzed = analyzeMarkdown(markdown);

    // Step 2
    pushToLine(userId, '✍️ [2/4] キャプションと動画字幕を生成中...');
    const hashtags = generateHashtags(analyzed);
    const generatedTexts = generateVideoAndCaptions(analyzed, textMode);

    const rawVideoText1 = generatedTexts.video_text_1;
    const rawVideoText2 = generatedTexts.video_text_2;
    const videoText1 = _normalizeVideoText(rawVideoText1);
    const videoText2 = _normalizeVideoText(rawVideoText2);
    const normalizedCaptions = _normalizeCaptionsByChannel(
      generatedTexts.caption_insta || '',
      generatedTexts.caption_threads || '',
      hashtags
    );
    const previousInstaCaption = props.getProperty('last_caption_instagram') || '';
    const uniqueInstaCaption = _avoidDuplicateInstagramCaption(
      analyzed,
      normalizedCaptions.captionInstagram,
      hashtags,
      previousInstaCaption
    );
    const normalizedAfterRetry = _normalizeCaptionsByChannel(
      uniqueInstaCaption,
      normalizedCaptions.captionThreads,
      hashtags
    );
    const captionInstagram = normalizedAfterRetry.captionInstagram;
    const captionThreads = normalizedCaptions.captionThreads;

    console.log('[phase1_FromLine] raw video_text_1:', JSON.stringify(rawVideoText1));
    console.log('[phase1_FromLine] raw video_text_2:', JSON.stringify(rawVideoText2));
    console.log('[phase1_FromLine] normalized video_text_1:', JSON.stringify(videoText1));
    console.log('[phase1_FromLine] normalized video_text_2:', JSON.stringify(videoText2));

    // 必要なら保持
    const captionYouTube = generateCaptionYouTube(analyzed, hashtags);
    const youtubeTags = generateYoutubeTags(analyzed);

    // Step 3
    pushToLine(userId, '🎵 [3/4] BGMを選定中...');
    const musicUrl = selectMusicFromSheet(analyzed.theme);

    // Cloudinary image URLs
    const cloudinaryBase = `https://res.cloudinary.com/${CONFIG.CLOUDINARY_CLOUD_NAME}/image/upload`;
    const cloudinaryImg1 = `${cloudinaryBase}/w_1080,h_1920,c_fill/${publicId1}`;
    const cloudinaryImg2 = publicId2
      ? `${cloudinaryBase}/w_1080,h_1920,c_fill/${publicId2}`
      : '';

    // Step 4
    saveToSheet({
      title: analyzed.title,
      captionInstagram: captionInstagram,
      imageUrl1: imageUrl1,
      imageUrl2: imageUrl2,
      driveVideoUrl: '',
      musicUrl: musicUrl,
      wpUrl: '',
      scheduledAt: scheduledAt,
    });

    pushToLine(
      userId,
      '🎬 [4/4] GitHub Actions で動画を生成中…\n完成したら Make が自動投稿します🌸'
    );

    const publishPayload = {
      caption_threads: captionThreads,
      caption_youtube: captionYouTube,
      tags_youtube: youtubeTags,
      title: analyzed.title,
      body: analyzed.body,
      scheduled_at: scheduledAt
    };

    triggerGitHubVideoCreation({
      image_url1: cloudinaryImg1,
      image_url2: cloudinaryImg2,
      image_public_id_1: publicId1,
      image_public_id_2: publicId2,
      music_url: musicUrl,
      video_text_1: videoText1,
      video_text_2: videoText2,
      caption_instagram: captionInstagram,
      publish_payload_json: JSON.stringify(publishPayload)
    });

    // Make 用に必要なら別保管
    props.setProperty('last_caption_threads', captionThreads);
    props.setProperty('last_caption_instagram', captionInstagram);
    props.setProperty('last_caption_youtube', captionYouTube);
    props.setProperty('last_youtube_tags', JSON.stringify(youtubeTags));
    props.setProperty('last_user_id', userId);

    pushToLine(
      userId,
      '🌙 完了！錬金フェーズが正常に終わりました🎉\n\n' +
      '📝 WordPress・Instagram・Threads・Facebook・YouTube への\n' +
      '配置は、指定時間に従って Make が自動実行します🌸'
    );

    props.deleteProperty('text_mode');
    saveUserState(userId, null);

  } catch (err) {
    console.error('[phase1_FromLine] Error:', err.message, err.stack);
    if (userId) pushToLine(userId, '❌ エラーが発生しました:\n' + err.message);

    PropertiesService.getScriptProperties().setProperty('phase1_done', 'false');

  } finally {
    lock.releaseLock();
  }
}
