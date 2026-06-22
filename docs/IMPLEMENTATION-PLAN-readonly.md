# Implementation Plan — Read-Only Expansion (Categories 1, 2, 4-partial)

**Status:** Ready to build
**Owner:** Kobi Hazout
**Last updated:** 2026-06-22
**Parent doc:** [PRD.md](PRD.md)
**Branch:** `claude/priceless-edison-81c4e4`

---

## 1. Scope — מה בונים

8 כלים חדשים, כולם 🟢 **read-only**. אין כתיבה, אין דגל `allowWrite`, אין סיכון לחשבון.

| # | קטגוריה | כלי | קיים? |
|---|---|---|---|
| 1 | קריאה וחיפוש | `read_messages` | ✅ קיים |
| 1 | קריאה וחיפוש | `search_messages` | ✅ קיים |
| 1 | קריאה וחיפוש | **`fetch_since`** | חדש |
| 1 | קריאה וחיפוש | **`get_message`** | חדש |
| 1 | קריאה וחיפוש | **`global_search`** | חדש |
| 2 | גילוי וניווט | `get_group_info` | ✅ קיים |
| 2 | גילוי וניווט | **`list_dialogs`** | חדש |
| 2 | גילוי וניווט | **`list_folders`** | חדש |
| 2 | גילוי וניווט | **`get_pinned`** | חדש |
| 4 | מדיה (חלקי) | **`get_media_info`** | חדש |
| 4 | מדיה (חלקי) | **`download_media`** | חדש |

**מחוץ ל-scope (במכוון):** קטגוריה 3 (engagement signals), כתיבה (5/6), HITL (9), prompt-injection guard (10). `formatMsg` הקיים **לא** משתנה.

---

## 2. שינויי תשתית (Milestone 0)

מינימום הנדרש בשביל `download_media` בלבד:

1. **config חדש (אופציונלי, עם defaults):**
   - `downloadDir` — ברירת מחדל `~/.telegram-mcp-downloads/`.
   - `maxDownloadMB` — ברירת מחדל `200`.
2. **יצירת תיקיית הורדות** ב-bootstrap אם חסרה (`fs.mkdirSync(downloadDir,{recursive:true})`).
3. **import `Api`** — כבר נוסף בשינוי הקודם (`const { TelegramClient, Api } = require('telegram')`).
4. **helper `safeName(s)`** — לניקוי שמות קבצים.

אין שינוי ב-stdio guard, ב-session, או ב-3 הכלים הקיימים.

---

## 3. מפרט מפורט לכל כלי

> כל handler עטוף ב-`try/catch` שמחזיר `{ isError:true }` (קונבנציה קיימת). כל הכלים מחזירים `content:[{type:'text',...}]`.

### 3.1 `fetch_since` — שליפה אינקרמנטלית · effort: נמוך
- **Args:** `groupUrl` (req), `sinceId` (req, number), `limit` (opt, default 100, max 200)
- **Returns:** הודעות עם `id > sinceId`, וגם `maxId` החדש (כדי שהקורא ישמור לפעם הבאה).
- **GramJS:** `client.getMessages(entity, { minId: sinceId, limit })`
- **הערה:** `minId` מחזיר הודעות חדשות יותר מ-id הנתון. אם אין חדשות → `(אין הודעות חדשות)`.
- **Smoke:** קריאה ל-`@kikarhashuk` עם `sinceId` ישן → מצופה רשימה; עם `sinceId` של ההודעה האחרונה → ריק.

### 3.2 `get_message` — הודעה בודדת + מטא-דאטה · effort: נמוך
- **Args:** `groupUrl` (req), `messageId` (req, number)
- **Returns:** טקסט ההודעה + `views`, `forwards`, `reactionsCount`, `repliesCount`, `hasMedia`, `date`, `sender`.
- **GramJS:** `const [msg] = await client.getMessages(entity, { ids: messageId })`
- **Smoke:** ID אמיתי מ-`@kikarhashuk` → שדות מאוכלסים.

### 3.3 `global_search` — חיפוש על כל הצ'אטים · effort: בינוני
- **Args:** `query` (req), `limit` (opt, default 30, max 100)
- **Returns:** תוצאות מכל הצ'אטים, כל אחת עם שם הצ'אט + טקסט + תאריך.
- **GramJS (raw invoke):**
  ```js
  const res = await client.invoke(new Api.messages.SearchGlobal({
    q: query,
    filter: new Api.InputMessagesFilterEmpty(),
    minDate: 0, maxDate: 0,
    offsetRate: 0,
    offsetPeer: new Api.InputPeerEmpty(),
    offsetId: 0,
    limit,
  }));
  ```
  למפות `res.messages` → לפתור שם צ'אט מ-`res.chats`/`res.users` לפי `peerId`.
- **Smoke:** חיפוש מילה נפוצה ("מניה"/ticker) → תוצאות ממספר צ'אטים.

### 3.4 `list_dialogs` — כל הצ'אטים · effort: נמוך
- **Args:** `limit` (opt, default 100, max 500), `archived` (opt bool)
- **Returns:** רשימה: `title`, `id`, `type` (Channel/Group/User), `username`, `unreadCount`.
- **GramJS:** `client.getDialogs({ limit })` → לכל `d`: `d.title`, `d.id`, `d.entity.className`, `d.unreadCount`.
- **Smoke:** מצופה לקבל את רשימת הערוצים/קבוצות האמיתיים של החשבון.

### 3.5 `list_folders` — תיקיות צ'אטים · effort: בינוני
- **Args:** אין.
- **Returns:** רשימת תיקיות: `title`, `id`, מספר ה-peers בכל אחת.
- **GramJS:** `const f = await client.invoke(new Api.messages.GetDialogFilters())` → `f.filters` (לסנן `DialogFilterDefault`), לכל אחת `.title`, `.includePeers.length`.
- **הערה:** אם למשתמש אין תיקיות → `(לא הוגדרו תיקיות)`.
- **Smoke:** מאמת מול התיקיות שמוגדרות בחשבון.

### 3.6 `get_pinned` — הודעות נעוצות · effort: נמוך
- **Args:** `groupUrl` (req), `limit` (opt, default 20)
- **Returns:** ההודעות הנעוצות (תומך במספר פינים).
- **GramJS:** `client.getMessages(entity, { filter: new Api.InputMessagesFilterPinned(), limit })`
- **Smoke:** `@kikarhashuk` → ההודעה/ות הנעוצות.

### 3.7 `get_media_info` — מטא-דאטה של מדיה (בלי הורדה) · effort: נמוך
- **Args:** `groupUrl` (req), `messageId` (req)
- **Returns:** `type` (photo/video/document/voice/none), `mime`, `sizeMB`, `duration` (לוידאו/אודיו), `fileName`, `downloadable` (false אם `noforwards`).
- **GramJS:** `getMessages ids` → לבדוק `msg.media`:
  - `MessageMediaPhoto` → type photo.
  - `MessageMediaDocument` → `doc.mimeType`, `doc.size`, attributes (`DocumentAttributeVideo`→duration, `DocumentAttributeFilename`→שם).
- **מטרה:** מאפשר להחליט אם שווה להוריד **לפני** שמורידים קובץ כבד.
- **Smoke:** הודעה עם וידאו → מחזיר sizeMB + duration נכונים.

### 3.8 `download_media` — הורדת קובץ · effort: בינוני
- **Args:** `groupUrl` (req), `messageId` (req), `maxMB` (opt, override ל-config)
- **Returns:** נתיב הקובץ שנשמר + גודל. **לא base64.**
- **לוגיקה:**
  1. `getMessages ids` → אם אין `msg.media` → "אין מדיה בהודעה".
  2. בדיקת גודל מול `maxMB ?? maxDownloadMB` → אם חורג → שגיאה ברורה עם הגודל.
  3. זיהוי סיומת מ-mime/type.
  4. `await client.downloadMedia(msg, { outputFile: path.join(downloadDir, name) })`.
  5. אם הערוץ `noforwards`/restricted → catch → "הערוץ חוסם שמירת תוכן".
- **Smoke (הוכחה מרכזית):** וידאו מ**קבוצה סגורה** שאתה חבר בה → קובץ נשמר ב-`downloadDir`, גודל > 0, ניתן לפתיחה.

---

## 4. סדר בנייה (Milestones)

| Milestone | תוכן | תלות |
|---|---|---|
| **M0 — תשתית** | config (downloadDir/maxDownloadMB), יצירת תיקייה, `safeName()`, smoke-harness גנרי | — |
| **M1 — גילוי** | `list_dialogs`, `list_folders`, `get_pinned` | M0 |
| **M2 — קריאה** | `fetch_since`, `get_message`, `global_search` | M0 |
| **M3 — מדיה** | `get_media_info`, אז `download_media` (smoke וידאו אמיתי) | M0 |
| **M4 — סגירה** | עדכון README + טבלת כלים, regression ל-3 הקיימים | M1–M3 |

כל Milestone = commit נפרד עם smoke ירוק. M1+M2 יכולים להתבצע במקביל (אין תלות ביניהם).

---

## 5. בדיקות (Testing)

- **Smoke-harness גנרי:** מריץ `server.js`, MCP handshake, `tools/call` לכל כלי, מאמת: תשובה תקינה + **0 שורות לא-JSON ב-stdout**.
- **יעדים:** `@kikarhashuk` (ציבורי) לקריאה/פינים; קבוצה פרטית עם וידאו ל-`download_media` (תספק ID).
- **Regression:** `read_messages`, `search_messages`, `get_group_info` חייבים להישאר ירוקים.
- **קריטריון קבלה:** 8 הכלים החדשים עוברים smoke end-to-end; הורדת וידאו מקבוצה סגורה עובדת בפועל.

---

## 6. סיכונים ומיטיגציות

| סיכון | מיטיגציה |
|---|---|
| וידאו כבד ממלא דיסק | תקרת `maxDownloadMB` (default 200) + בדיקת גודל לפני הורדה |
| תוכן מוגן (`noforwards`) | זיהוי השגיאה והחזרת הודעה ברורה — לא קריסה |
| `global_search`/`list_folders` משתמשים ב-raw invoke | בדיקת מבנה התשובה ב-smoke; fallback ל-`(אין תוצאות)` |
| זיהום stdout מ-logger | כל הכלים עוברים דרך התשתית הקיימת; smoke מאמת 0 שורות לא-JSON |
| שינוי שובר את הקיים | אין נגיעה ב-`formatMsg`/session/3 הכלים הקיימים |

---

## 7. Checklist להרצה

- [ ] M0: config + downloadDir + `safeName()` + smoke-harness
- [ ] M1: `list_dialogs` · `list_folders` · `get_pinned` (+smoke כל אחד)
- [ ] M2: `fetch_since` · `get_message` · `global_search` (+smoke כל אחד)
- [ ] M3: `get_media_info` · `download_media` (+smoke וידאו אמיתי)
- [ ] M4: README + טבלת כלים + regression
- [ ] commit/PR לכל milestone, smoke ירוק לפני merge

---

## נספח — entities לבדיקה

| יעד | שימוש |
|---|---|
| `@kikarhashuk` | קריאה, פינים, get_message, fetch_since |
| קבוצה פרטית (ID מ-Kobi) | `download_media` וידאו — ההוכחה המרכזית |
| מילת חיפוש נפוצה | `global_search` |
