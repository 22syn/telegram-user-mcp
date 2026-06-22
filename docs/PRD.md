# PRD — telegram-mcp: General-Purpose Telegram Tooling

**Status:** Draft for approval
**Owner:** Kobi Hazout
**Last updated:** 2026-06-22
**Repo:** `telegram-mcp` (standalone MCP server, MTProto/GramJS, real user account)

---

## 1. רקע ובעיה (Background)

היום `telegram-mcp` הוא שרת MCP **read-only** עם 3 כלים בלבד (`read_messages`, `search_messages`, `get_group_info`), שנבנה במקור כדי לכרות ערוצי תזות־מניות עבור Smart Volume Radar.

ההחלטה: להפוך אותו ל**כלי טלגרם כללי** שמשרת אותנו ברוחב — לא רק מודיעין לרדאר, אלא גם:
- גישה מלאה למדיה (כולל וידאו מקבוצות סגורות),
- אינטראקציה עם Claude דרך טלגרם (human-in-the-loop),
- ובהמשך — יכולות כתיבה מבוקרות.

היתרון המבני שלנו: אנחנו רצים כ**חשבון משתמש אמיתי דרך MTProto** (GramJS), כך שיש לנו בדיוק את הגישה של אפליקציית הטלגרם — כולל קבוצות פרטיות. בוטים (Bot API) לא יכולים לעשות את רוב זה.

---

## 2. מטרות ולא־מטרות (Goals / Non-Goals)

### Goals
- G1 — להרחיב מ-3 ל-~20 כלים, מאורגנים בשכבות לפי סיכון.
- G2 — לשמור על **read-only כברירת מחדל**; כתיבה מאחורי דגל/אישור מפורש.
- G3 — תמיכה מלאה במדיה: הורדת וידאו/תמונה/קובץ מכל צ'אט שהחשבון חבר בו.
- G4 — Human-in-the-loop: Claude מתריע/שואל אותנו דרך טלגרם.
- G5 — קשיחות אבטחה: הגנת prompt-injection על תוכן צ'אט לא־מהימן.
- G6 — לא לשבור את 3 הכלים הקיימים ולא את ניקיון ה-stdio JSON-RPC.

### Non-Goals (כרגע)
- NG1 — ריבוי חשבונות בו־זמנית (design יישאר פתוח לזה, אך לא יוקם).
- NG2 — ניהול אדמין מתקדם (kick/ban/promote) — סיכון גבוה, ערך נמוך לנו.
- NG3 — אינטגרציית TradingView (מסמך נפרד).
- NG4 — שליחה אוטונומית בלי אישור אנושי בשכבת הכתיבה.

---

## 3. משתמשים ותרחישים (Personas & Use Cases)

| Persona | תרחיש |
|---|---|
| **Kobi (operator)** | "תוריד לי את הווידאו מההודעה הזו בקבוצה הסגורה" / "מה נעוץ בערוץ X" |
| **Smart Volume Radar (automation)** | שליפה אינקרמנטלית של ערוצי תזות + אותות מעורבות |
| **Claude (agent)** | מסיים משימה ארוכה → דוחף התראה לטלגרם; נתקע בהחלטה → שואל את Kobi בטלגרם וממתין |
| **Future projects** | חיפוש גלובלי על כל הצ'אטים, ייצוא קבצים, ניטור ערוצים |

---

## 4. קטלוג היכולות לפי שכבות (Scope)

סימון סיכון: 🟢 read-only · 🟡 כתיבה · 🔴 רגיש/בלתי-הפיך

### Phase 0 — Read-only חזק (P0, חובה)
| כלי | סיכון | תיאור | מימוש GramJS |
|---|---|---|---|
| `list_dialogs` | 🟢 | כל הצ'אטים שהחשבון חבר בהם + unread | `client.getDialogs()` |
| `fetch_since` | 🟢 | רק הודעות מאז `minId` (אינקרמנטלי) | `getMessages(e,{minId})` |
| `get_pinned` | 🟢 | ההודעות הנעוצות | `GetFullChannel→pinnedMsgId` |
| `get_replies` | 🟢 | קומנטים/דיון מתחת לפוסט | `getMessages(e,{replyTo})` |
| `download_media` | 🟢 | וידאו/תמונה/קובץ/קול — כולל קבוצות סגורות | `client.downloadMedia()` |
| `get_user_info` | 🟢 | פרטי משתמש (שם, username, bio) | `getEntity` + `GetFullUser` |
| engagement enrich | 🟢 | views/forwards/reactions בכל הודעה | שדות על `msg` |

### Phase 1 — Human-in-the-loop (P1)
| כלי | סיכון | תיאור |
|---|---|---|
| `notify_user` | 🟡 | Claude דוחף התראה ל-"Saved Messages"/צ'אט מוגדר |
| `ask_user` | 🟡 | Claude שואל וממתין לתשובה (polling עד timeout) |
| `send_file` | 🟡 | שליחת פלט/דוח כקובץ אליך |

> שכבה זו "כתיבה" אבל ליעד מוגבל ובטוח (אתה עצמך), ולכן לפני Phase 2.

### Phase 2 — כתיבה מלאה (P2, רק באישור מפורש)
| כלי | סיכון | תיאור |
|---|---|---|
| `send_message` | 🟡 | שליחת הודעה לצ'אט/אדם |
| `reply_to` | 🟡 | תגובה להודעה |
| `react` | 🟡 | אימוג'י ריאקשן |
| `forward_message` | 🟡 | העברה בין צ'אטים |
| `edit_message` | 🟡 | עריכת הודעה ששלחת |
| `delete_message` | 🔴 | מחיקה (בלתי הפיך) |

### Backlog (לא מתוכנן עדיין)
`global_search`, `list_members`, `list_contacts`, `get_poll_results`, `join_chat`/`leave_chat`, `get_invite_link`, ריבוי חשבונות.

---

## 5. עיצוב טכני (Technical Design)

### 5.1 ארכיטקטורה קיימת (לא משתנה)
- חיבור: `TelegramClient(StringSession, apiId, apiHash)` מתוך `~/.telegram-mcp-config.json` + `~/.telegram-mcp-session`.
- Transport: `StdioServerTransport`. **stdout שמור ל-JSON-RPC בלבד** — כל `console.*` מנותב ל-stderr (כבר קיים). כל כלי חדש חייב לכבד את זה.
- `client.setLogLevel('none')`.

### 5.2 שינויים נדרשים
1. **תיקיית הורדות:** `~/.telegram-mcp-downloads/` (ניתן ל-override ב-config `downloadDir`). נוצרת אם חסרה.
2. **תקרת גודל הורדה:** `maxDownloadMB` ב-config (ברירת מחדל 200). מעבר לכך — שגיאה ידידותית במקום למלא דיסק. בדיקת גודל לפני הורדה דרך `document.size`.
3. **דגל כתיבה:** `allowWrite: false` ב-config. כלי 🟡/🔴 רשומים ב-`tools/list` רק אם `allowWrite=true`; אחרת מחזירים שגיאה מנומסת. ברירת מחדל — כבוי.
4. **Prompt-injection guard:** כל טקסט מצ'אט עטוף בתבנית שמסמנת אותו כ-data:
   ```
   <telegram_content source="@channel" untrusted="true">
   ...טקסט המשתמש/הערוץ...
   </telegram_content>
   ```
   זה מצמצם הזרקת הוראות דרך פוסט זדוני.
5. **החזרת מדיה:** כלים מחזירים **נתיב לקובץ** (לא base64) כדי לא לפוצץ את הקונטקסט.

### 5.3 קונבנציות כלי
- שמות args עקביים: `groupUrl`, `messageId`, `limit`, `sinceId`.
- כל handler עטוף ב-try/catch שמחזיר `{ isError:true }` (כמו היום).
- כל כלי כתיבה מחזיר אישור מפורש מה בוצע (id ההודעה שנשלחה/נמחקה).

### 5.4 ניהול session (CLI, בהשראת dryeab)
- `npm run login` (קיים).
- להוסיף: `npm run logout` (מוחק session), `npm run whoami` (מאמת מי מחובר).

---

## 6. אבטחה ובטיחות (Safety Model)

| סיכון | מיטיגציה |
|---|---|
| Prompt injection מתוכן ערוץ | עטיפת `<telegram_content untrusted>` (5.2.4) |
| כתיבה לא־מכוונת | `allowWrite=false` כברירת מחדל; כלים נסתרים אחרת |
| מחיקה בלתי-הפיכה | `delete_message` תמיד דורש `confirm:true` בארגומנטים |
| מילוי דיסק | תקרת `maxDownloadMB` |
| תוכן מוגן (noforwards) | זיהוי השגיאה והחזרת הודעה ברורה: "הערוץ חוסם שמירה" |
| דליפת credentials | config+session מחוץ לריפו (כבר ב-.gitignore) |
| זיהום stdout | כל פלט דרך stderr; smoke-test מאמת 0 שורות לא-JSON |

---

## 7. תוכנית יישום (Implementation Plan)

### Milestone 0 — תשתית (½ יום)
- [ ] config חדש: `downloadDir`, `maxDownloadMB`, `allowWrite`.
- [ ] עטיפת prompt-injection (`wrapUntrusted()`).
- [ ] gating של כלי כתיבה ב-`tools/list`.
- [ ] smoke-harness גנרי לכל כלי (מאמת JSON-RPC נקי).

### Milestone 1 — Phase 0 read-only (1–1.5 ימים)
- [ ] `list_dialogs` → smoke מול החשבון.
- [ ] `fetch_since` → אימות אינקרמנטלי מול `@kikarhashuk`.
- [ ] `get_pinned`, `get_replies`.
- [ ] `download_media` → **smoke אמיתי: וידאו מקבוצה סגורה**.
- [ ] `get_user_info` + engagement enrich.
- [ ] עדכון README + טבלת הכלים.

### Milestone 2 — Phase 1 HITL (1 יום)
- [ ] `notify_user`, `send_file`.
- [ ] `ask_user` עם polling + timeout מוגדר.
- [ ] תיעוד תרחיש "Claude שואל אותך בטלגרם".

### Milestone 3 — Phase 2 כתיבה (רק אחרי אישור, 1 יום)
- [ ] `send_message`, `reply_to`, `react`, `forward_message`.
- [ ] `edit_message`, `delete_message` (עם `confirm`).
- [ ] בדיקות מול צ'אט בדיקה ייעודי.

כל Milestone = commit/PR נפרד על branch, עם smoke-test ירוק לכל כלי לפני merge.

---

## 8. אסטרטגיית בדיקות (Testing)

- **Smoke per-tool:** harness שמריץ `server.js`, עושה MCP handshake, קורא לכלי מול entity אמיתי, ומאמת: (א) תשובה תקינה, (ב) 0 שורות לא-JSON ב-stdout.
- **Read-only:** מאומת מול `@kikarhashuk` (ערוץ ציבורי) + קבוצה פרטית לבדיקת מדיה.
- **כתיבה:** מאומת מול "Saved Messages" / צ'אט בדיקה — לא מול צ'אטים אמיתיים.
- **Regression:** 3 הכלים הקיימים חייבים להישאר ירוקים.

---

## 9. מדדי הצלחה (Success Metrics)

- כל 7 כלי Phase 0 עוברים smoke ירוק end-to-end.
- הורדת וידאו מקבוצה סגורה עובדת בפועל (ההוכחה המרכזית).
- 0 רגרסיות; stdout נשאר נקי.
- README משקף את כל הכלים החדשים.

---

## 10. החלטות פתוחות (Open Decisions)

| # | החלטה | ברירת מחדל מוצעת |
|---|---|---|
| D1 | האם לפתוח Phase 2 (כתיבה) בכלל? | לבנות אך עם `allowWrite=false` עד החלטה |
| D2 | יעד ברירת מחדל ל-`notify_user`/`ask_user` | "Saved Messages" של החשבון |
| D3 | תקרת הורדה | 200MB |
| D4 | ריבוי חשבונות | לא עכשיו; להשאיר session path פרמטרי |

---

## נספח — מיפוי השראה מהמחקר

| Repo | מה לקחנו |
|---|---|
| `chigwell/telegram-mcp` | רוחב הכלים (60+), prompt-injection guard, proxy |
| `dryeab/mcp-telegram` | ניהול session ב-CLI (login/logout/whoami), 2FA |
| `qpd-v/mcp-communicator-telegram` | `notify_user` / `ask_user` / `send_file` (HITL) |
| `sparfenyuk/mcp-telegram` | בסיס read-only נקי (נקודת המוצא שלנו) |
