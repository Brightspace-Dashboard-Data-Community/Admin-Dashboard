# Office Hours Chat Widget

A custom **Brightspace (D2L) course homepage Widget** that runs **live office hours chat** between an instructor and students: open/close hours, a waiting room, private chats (including multiple concurrent chats), and downloadable transcripts.

Originally built for **Your College**. Two deployment options:

- **Homepage widget** — paste `office-hours-chat-widget.html` into a **Custom Widget** (needs `{widgetid}` and Custom Widget Data).
- **Content page (standalone)** — add `office-hours-chat-page.html` as a Content topic. No widget, no widget ID. Chat state is stored in a course discussion forum.

---

## What it does

### Instructor view

1. **Open / Close Office Hours** — shared course-level flag all students can see
2. **Waiting room** — lists students who joined while hours are open
3. **Start Chat** — admits a waiting student into a private conversation
4. **Multiple concurrent chats** — chat with more than one student at once (optional cap via config)
5. **Send messages**, **End Chat**, and **Download Log** (TXT transcript)
6. Closing office hours can end active chats and auto-download transcripts

### Student view

1. Sees whether office hours are **open** or **closed**
2. **Join Waiting Room** when open
3. When admitted → private chat with the instructor
4. **Download My Log** after or during a session
5. Can leave the waiting room or join again after a chat ends

---

## Screenshots

Current Delta green theme. Instructor view while hours are open, and the matching student chat.

| Screenshot | What it shows |
|------------|----------------|
| **Open** — `office-hour-chat-open.jpg` | Instructor view: hours open, active chat, conversation, waiting room |
| **Student** — `office-hours-chat-student.jpg` | Student view: admitted to a private chat |
| **Closed** — `office-hours-chat-closed.jpg` | Instructor view when office hours are closed |

![Office hours open — instructor](office-hour-chat-open.jpg)

![Office hours student chat](office-hours-chat-student.jpg)

![Office hours closed](office-hours-chat-closed.jpg)

---

## How it works

```mermaid
flowchart TD
    A[Content page or homepage Custom Widget loads] --> B[Detect course + role]
    B --> C{Which product?}
    C -->|Content page| D[Discussion forum store]
    C -->|Homepage widget| E[Custom Widget Data]
    D --> F[Open/close hours + waiting room + chats]
    E --> F
    F --> G[Poll every 5s]
```

### Storage model

#### Content page (standalone)

No Custom Widget. A forum named **Live Office Hours (system)** holds JSON threads:

| Store | Where | Purpose |
|-------|--------|---------|
| **Shared** | Thread `[OHW-SHARED]` | `officeOpen`, `sessionId`, `activeChats` map (instructor messages live here) |
| **Per user** | Thread `[OHW-USER-{id}]` | Student waiting/active status + student messages |

The first instructor visit creates the forum and topic. See `CONTENT-AND-POPOUT.md`.

#### Homepage widget

| Store | Path | Purpose |
|-------|------|---------|
| **Shared** | `/widgetdata/{widgetId}` | `officeOpen`, `sessionId`, `activeChats` map (instructor messages live here) |
| **My data** | `/widgetdata/{widgetId}/mydata` | Student waiting/active status + student messages |
| **Per user** | `/widgetdata/{widgetId}/{userId}` | Instructor reads each waiting/active student’s data |

Schema **v3** uses `activeChats: { [studentId]: chat }` for multi-chat. Older single-chat fields (`activeStudentId`, `activeChat`) are migrated when present.

These two products do **not** share a chat store. Pick one per course.

### Other APIs

| API | Purpose |
|-----|---------|
| `GET /d2l/api/lp/.../users/whoami` | Current user |
| `GET /d2l/api/lp/.../enrollments/orgUnits/{ou}/users/{userId}` | Course role detection |
| `GET /d2l/api/le/.../{ou}/classlist/` | Waiting-room student list |
| `GET/PUT` Custom Widget Data | Shared and per-user chat state |

All requests use session cookies and `X-CSRF-TOKEN`.

---

## Brightspace replace strings (required)

| Token | Replaced with |
|-------|----------------|
| `{OrgUnitId}` | Current course org unit ID |
| `{widgetid}` | Custom widget instance ID |
| `{RoleName}` | Viewer’s role name in the course (respects impersonation) |

These **only** work in a **Custom Widget**. The standalone Content page does not need `{widgetid}`; it detects the course from the Content URL and stores data in Discussions.

---

## Files in this folder

| File | Description |
|------|-------------|
| `office-hours-chat-widget.html` | Homepage Custom Widget markup + CSS + JavaScript (sound-only waiting-room chime) |
| `office-hours-chat-widget-notify.html` | **Notify variant** of the homepage widget — desktop notification prompt plus a chime that repeats up to 5 times until Start Chat |
| `office-hours-chat-page.html` | **Standalone Content product** — no widget required |
| `office-hours-chat-page-notify.html` | **Notify variant** of the Content page (best place for desktop notifications) |
| `office-hours-chat-content-topic.html` | Optional embed snippet for a course Content topic |
| `office-hours-chat-content-topic-notify.html` | Notify variant of the Content topic paste |
| `office-hours-chat-widget-popout.html` | Optional homepage widget variant with a Pop out button |
| `office-hours-chat-widget-popout-notify.html` | Notify variant of the pop-out homepage widget |
| `CONTENT-AND-POPOUT.md` | Setup for the standalone Content page |
| `office-hours-chat-closed.jpg` | Screenshot — instructor view, office hours closed |
| `office-hour-chat-open.jpg` | Screenshot — instructor view, office hours open, active chat |
| `office-hours-chat-student.jpg` | Screenshot — student view, private chat |
| `README.md` | This documentation |

---

## Notify variant (optional)

Keep the original `*-widget.html` / `*-page.html` files if you only want a single chime. Use the `*-notify.html` files when faculty also want a computer notification.

1. Paste `office-hours-chat-widget-notify.html` (homepage) or `office-hours-chat-page-notify.html` (Content — more reliable for toasts).
2. Instructor clicks **Open Office Hours** or **Enable notify** and chooses **Allow** on the browser prompt (once per browser).
3. When a student joins: one desktop toast, plus the chime up to **5 times** about **3 seconds** apart.
4. The chime stops early when the instructor clicks **Start Chat**, the student leaves, office hours close, or **Sound off**.

Homepage widgets run in a Brightspace iframe, so the notification prompt may not appear there. The Content page or Pop out is the better test for desktop toasts; sound still works in the widget.

---

## Requirements

- **Content page:** a Content topic with `office-hours-chat-page.html`, plus permission to use **Discussions** (instructors can create a forum; students can post and edit their own posts)
- **Homepage widget:** a **Custom Widget** on a **course** homepage, plus permission to use **Custom Widget Data**
- Role IDs configured to match your institution (see below)

---

## Installation

### Content page (recommended if you do not want a homepage widget)

1. Confirm student and instructor **role IDs** in **Admin Tools → Roles and Permissions**.
2. In the course, **Content → Create New → Upload File** and upload `office-hours-chat-page.html`.
3. Open the topic once as the instructor so it can create the **Live Office Hours (system)** forum.
4. Update `STUDENT_ROLE_IDS` / `INSTRUCTOR_ROLE_IDS` in the file if your org differs from the defaults.
5. Test as instructor and as student (impersonation is supported for role detect).

Details: `CONTENT-AND-POPOUT.md`.

### Homepage widget

1. Confirm student and instructor **role IDs** in **Admin Tools → Roles and Permissions**.
2. Open **Homepage Management** for the **course** homepage template (or a specific course).
3. Create a **Custom Widget** (not HTML in Content).
4. Paste the full contents of `office-hours-chat-widget.html`.
5. Ensure `{OrgUnitId}`, `{widgetid}`, and `{RoleName}` remain as replace strings (do not hardcode unless testing).
6. Update `STUDENT_ROLE_IDS` / `INSTRUCTOR_ROLE_IDS` if your org differs from the defaults.
7. Save and test as instructor and as student (impersonation is supported for role detect).

---

## Adapting for other institutions

Search `office-hours-chat-widget.html` for the `CONFIG` block:

```javascript
const CONFIG = Object.freeze({
  COURSE_ID: parseInt("{OrgUnitId}", 10) || 0,
  LP_VERSION: "1.51",
  LE_VERSION: "1.82",
  INSTRUCTOR_USER_IDS: [ /* optional hard overrides */ ],
  STUDENT_ROLE_IDS: [101, 107, 112],
  INSTRUCTOR_ROLE_IDS: [102],
  CUSTOM_WIDGET_ID: "{widgetid}",
  ROLE_NAME: "{RoleName}",
  POLL_INTERVAL_MS: 5000,
  QUEUE_REFRESH_MS: 10000,
  WAITING_EXPIRATION_MINUTES: 120,
  MAX_MESSAGE_LENGTH: 1500,
  MAX_MESSAGES_PER_SESSION: 100,
  MAX_CONCURRENT_CHATS: 0,  // 0 = unlimited
  AUTO_DOWNLOAD_ON_END: true,
  WIDGET_TITLE: "Live Office Hours"
});
```

| Setting | What to change |
|---------|----------------|
| `STUDENT_ROLE_IDS` | Student, Incomplete, Student View / demo roles at your org |
| `INSTRUCTOR_ROLE_IDS` | Instructor (and any faculty roles that should host office hours) |
| `INSTRUCTOR_USER_IDS` | Optional hard-coded instructor user IDs if auto-detect fails |
| `MAX_CONCURRENT_CHATS` | Cap simultaneous student chats (`0` = unlimited) |
| `WAITING_EXPIRATION_MINUTES` | Drop stale waiting-room entries |
| `AUTO_DOWNLOAD_ON_END` | Auto-download TXT transcript when a chat ends |
| `WIDGET_TITLE` | Header title shown in the UI |
| `LP_VERSION` / `LE_VERSION` | API versions for your Brightspace instance |

### Default role IDs (Your College)

| Role | ID |
|------|-----|
| Student | `101` |
| Instructor | `102` |
| Incomplete Student | `107` |
| Student View / ZZDemo | `112` |

### Branding

Your College greens (same family as the Faculty Navigation Menu):

- Header and primary buttons: `#005b4d`
- Alerts and “your” chat bubbles: mint (`#e7f3ef` / `#d8eee6`)
- Open status: green; closed: red

---

## Customization checklist

- [ ] **Content page:** upload `office-hours-chat-page.html` as a Content topic and open it once as instructor
- [ ] **Or homepage widget:** paste into a Custom Widget and confirm `{OrgUnitId}`, `{widgetid}`, `{RoleName}` are replaced
- [ ] Set `STUDENT_ROLE_IDS` / `INSTRUCTOR_ROLE_IDS` for your org
- [ ] Test instructor: open hours → see waiting room → start chat → send → end → transcript
- [ ] Test student: join wait → admit → chat → download log
- [ ] Test impersonation (admin as student) if you use that workflow
- [ ] Content page: confirm the **Live Office Hours (system)** forum exists and is not deleted
- [ ] Homepage widget: confirm Custom Widget Data permissions for students and instructors

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| “Could not detect the course ID” | Not opened from course Content, or `{OrgUnitId}` not replaced |
| “Could not detect the widget ID” | Homepage widget pasted into Content; use `office-hours-chat-page.html` instead |
| “Could not create the Live Office Hours (system) forum” | Instructor cannot create discussion forums — create that forum/topic once in Discussions |
| Student sees instructor UI (or reverse) | Role IDs / `{RoleName}` mismatch — adjust CONFIG or enrollment role |
| Waiting room always empty | Classlist permission, wrong `STUDENT_ROLE_IDS`, students cannot post in Discussions, or students not joining |
| Messages not syncing | Discussions permission denied; check console for 403 |
| Poll works but queue stale | Waiting-room scan is every `QUEUE_REFRESH_MS` (default 10s) |

### Debug

Open **Developer Tools → Console**. Fatal errors render inside the widget shell with setup hints.

---

## Security and privacy notes

- Chat content is stored in a **course discussion forum** (Content page) or **Brightspace Custom Widget Data** (homepage widget).
- Instructors can read waiting/active student records for enrolled classlist users.
- Transcripts download as plain text to the instructor’s (or student’s) browser.
- Place on course Content or course homepages only; do not expose on org-level public pages.
- Waiting entries older than `WAITING_EXPIRATION_MINUTES` are ignored.

---

## Related widgets

- **ZZStudent Demo** — enroll a demo student so instructors can preview the student chat experience via impersonation

---

## License and contribution

Shared for use and adaptation by other Brightspace administrators. When forking:

- Update role IDs for your org
- Confirm Custom Widget Data is enabled and permitted
- Test both instructor and student flows before production

---

## Credits

Developed by **Your College** eLearning / D2L administration.

**Version notes:**

- Widget Data schema: **v3** (multi-chat `activeChats`)
- Student role IDs: `101`, `107`, `112`
- Instructor role ID: `102`
- LP API: `1.51`, LE API: `1.82`
