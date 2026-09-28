# Section Profile Widget

A custom **Brightspace (D2L) course homepage widget** that shows each student the instructor profile for **their enrolled section**. Designed for multi-section courses where different instructors teach different sections of the same offering.

Originally built for **Your College**. Runs entirely in the browser using the Brightspace LP API and a JSON config file you host in **Manage Files**—no separate server or OAuth application required.

---

## What it does

1. Detects the current **course Org Unit ID** (`{OrgUnitId}` replace string, with URL fallback)
2. Calls `GET /d2l/api/lp/.../{orgUnitId}/sections/mysections/` for the logged-in learner
3. Loads `section-instructors.json` from Manage Files for that course
4. Maps the learner’s section (by **Section ID**, **Code**, or **Name**) to an instructor profile
5. Renders a profile card: photo, name, title, office hours, office, phone, bio, and **Email Instructor**

If the learner is not in a section, or no instructor is mapped, the widget shows a clear warning instead of a blank card.

---

## Screenshot

![Section Profile Widget](section-profile-widget.png)

---

## How it works

```mermaid
flowchart TD
    A[Course homepage Custom Widget loads] --> B[Resolve OrgUnitId]
    B --> C[GET sections/mysections]
    C --> D{Learner in a section?}
    D -->|No| E[Show not-assigned warning]
    D -->|Yes| F[Fetch section-instructors.json]
    F --> G[Match SectionId / Code / Name]
    G --> H{Instructor found?}
    H -->|No| I[Show not-configured warning]
    H -->|Yes| J[Render profile card + mailto]
```

### Why `mysections`?

The widget uses **`/sections/mysections/`**, which returns only the current user’s section membership. It does **not** request the full section enrollment roster, so typical student roles can use it without elevated classlist permissions.

### Data sources

| Source | Purpose |
|--------|---------|
| `GET /d2l/api/lp/{LP_VERSION}/{orgUnitId}/sections/mysections/` | Learner’s section(s) in the current course |
| **JSON in Manage Files** | Instructor profiles + section → instructor map |
| Profile images in Manage Files (or absolute URLs) | Photo on the card |

All requests use the browser session (`credentials: "include"`). API paths are **relative** (no hardcoded Brightspace domain).

---

## Files in this folder

| File | Description |
|------|-------------|
| `section-profile-widget.html` | **Student-facing** — paste into a Brightspace Custom Widget on the course homepage |
| `section-profile-builder.html` | Interactive config tool for instructors and admins (JSON + resized photos) |
| `course-tool-topic.html` | Optional Content topic shell that iframes the builder (for hidden instructor modules) |
| `section-instructors.json` | Sample config — replace IDs, names, and contact details |
| `sample-instructor-a.jpg` / `sample-instructor-b.jpg` | Optional sample photos for local testing |
| `embed-snippet.html` | Optional iframe embed if you host the student widget HTML in Manage Files |
| `section-profile-widget.png` | Screenshot |
| `README.md` | This documentation |

---

## Config Builder (instructors & admins)

`section-profile-builder.html` builds and publishes the widget config interactively—no hand-editing JSON required.

### What the builder does

1. **Course** — list teaching courses (`myenrollments` + instructor role) or search by org unit ID / course code (admins)
2. **Sections** — load `/sections/` for the offering; import an existing `section-instructors.json` if present
3. **Instructors** — add profiles manually or suggest from course instructor enrollments; upload a photo (auto **400×400 JPEG**)
4. **Map** — assign each section to an instructor; set a default; live preview the student card
5. **Publish** — download JSON/images, or upload straight to the course Manage Files root

When opened from inside a course (Manage Files / Content path, or `?courseId=`), the builder detects the offering, shows **Course tool mode**, and jumps to that course’s sections.

### Who can use it

| Audience | How they pick courses | Typical publish permission |
|----------|----------------------|----------------------------|
| **Instructor** | “My teaching courses” or course-context auto-select | Manage Files on courses they teach |
| **Admin** | Teaching list **or** Search / ID | Manage Files on target courses |

Role IDs are configurable in the builder `CONFIG` block (`INSTRUCTOR_ROLE_IDS`, default `102`).

---

## Add the builder as a hidden course tool

Use this when instructors should configure section profiles **inside the course**, without giving students access.

### Recommended: hidden Content module + HTML topic

1. Open the course → **Course Admin → Manage Files**.
2. Upload **`section-profile-builder.html`** to the **course files root** (required — this is what the tool actually runs).
3. Open **Content** and create a module such as **Instructor Tools** / **Section Instructor Profile Generator**.
4. Add the builder using **one** of these methods:

   **Method A — Easiest (recommended)**  
   Create a topic from the uploaded file itself: **Create New → Upload File** (or add the Manage Files item).  
   Title it “Section Profile Config Builder”.  
   Do **not** rely on `course-tool-topic.html` for this method.

   **Method B — HTML shell topic**  
   Create an HTML topic and paste `course-tool-topic.html`.  
   The shell looks up `/content/enforced/{OrgUnitId}/section-profile-builder.html`.  
   If you see **Page Not Found** inside the frame, the builder file is not in Manage Files root yet (Method A avoids this).

5. **Hide from students** — hide the module/topic, or use a release condition for Instructor (and Admin).
6. Open the topic as an instructor, map sections, and **Publish to Manage Files**.
7. Add the **student** widget (`section-profile-widget.html`) to the course homepage separately.

### Why relative iframes fail in Content

Brightspace often serves topic HTML from a Content viewer URL, so `src="section-profile-builder.html"` resolves to the wrong place and shows **Page Not Found**. Always upload the builder to Manage Files and either open that file as the topic (Method A) or use the shell that targets `/content/enforced/{OrgUnitId}/…` (Method B).

### Tips for the course tool

- Keep the builder topic out of student pathways (no navbar link for students).
- Publishing writes `section-instructors.json` (+ photos) to the course Manage Files root—the same place the homepage widget reads.
- You can still use org-wide Faculty / Admin dashboards; the hidden course topic is optional convenience for multi-section instructors.

### Other hosting options

| Placement | Notes |
|-----------|--------|
| **Admin Reports & Tools** | Link `section-profile-builder.html` from your admin dashboard (search any course by ID/code). |
| **Faculty tools hub** | Host the builder on a faculty-only site and list it under course tools. |
| **Public / Shared Files** | Host once org-wide; open with `?courseId={OrgUnitId}` when deep-linking from a course. |

Do **not** rely on `{OrgUnitId}` replace strings inside the builder itself—it discovers courses via APIs (and URL context). The **student widget** still uses `{OrgUnitId}` as documented below.

### Builder `CONFIG` (adapt per org)

```javascript
const CONFIG = Object.freeze({
  LP_VERSION: "1.51",
  INSTRUCTOR_ROLE_IDS: [102],
  INSTRUCTOR_ROLE_NAMES: ["instructor", "teacher", "faculty"],
  IMAGE_SIZE: 400,
  IMAGE_QUALITY: 0.85,
  CONFIG_FILE_NAME: "section-instructors.json"
});
```

---

## Requirements

- **Course homepage** Custom Widget for the **student** card (so `{OrgUnitId}` is replaced)
- Course uses **Sections** and learners are assigned to sections
- Permission for learners to call **`sections/mysections`** (standard for Student in most orgs)
- Ability to upload JSON (and optional images) to **Manage Files** for each course, or a shared multi-course JSON (advanced)
- Instructors/admins who use the builder need Manage Files **write** on the target course

---

## Installation (student widget)

You can share the **widget HTML once** at the organization (homepage template / shared custom widget) while keeping **per-course JSON**, or configure everything inside a single course. Both approaches use the same HTML file.

### Option A — Course-level (single course)

Best for a pilot or one multi-section offering.

1. Use the [Config Builder](#config-builder-instructors--admins) (or upload JSON manually) so Manage Files contains:
   - `section-instructors.json`
   - Instructor images referenced by the JSON
2. Open **Course Admin → Homepages** (or edit the course homepage).
3. Create a **Custom Widget**, open the HTML source editor, and paste the full contents of `section-profile-widget.html`.
4. Confirm `CONFIG.CONFIG_URL` still contains `{OrgUnitId}` (do not hardcode unless testing).
5. Save, place the widget on the homepage (sidebar works well), and test by impersonating learners in different sections.
6. Optionally add the [hidden course builder topic](#add-the-builder-as-a-hidden-course-tool) so instructors can update profiles later.

### Option B — Org-level widget, per-course config (recommended for scale)

Share one Custom Widget across many courses; each course still owns its instructor JSON.

1. Create a **Custom Widget** once under **Admin Tools → Homepage Management** (or your org’s shared widgets / course homepage template).
2. Paste `section-profile-widget.html` into that shared widget.
3. Add the widget to the **course homepage template(s)** used by multi-section courses.
4. For **each course** that should show section-specific instructors:
   - Upload `section-instructors.json` (+ images) to that course’s **Manage Files** root
   - Set the `sections` map for that course’s Section IDs
5. Leave `CONFIG_URL` as:

   ```text
   /content/enforced/{OrgUnitId}/section-instructors.json
   ```

   Brightspace replaces `{OrgUnitId}` per course, so the same widget HTML loads the correct file automatically.

### Option C — Optional iframe hosting

Only if you prefer not to paste a large HTML block into the widget editor:

1. Upload `section-profile-widget.html` and `section-instructors.json` (+ images) to the course Manage Files root (or adjust paths).
2. Paste `embed-snippet.html` into a Custom Widget instead.
3. Ensure the iframe `src` path matches where you uploaded the HTML.

Prefer Option A/B for simpler caching and replace-string behavior.

---

## Configuration file (`section-instructors.json`)

### Per-course file (recommended)

```json
{
  "version": 1,
  "defaultInstructorKey": "instructor_a",
  "instructors": {
    "instructor_a": {
      "name": "Alex Smith",
      "firstName": "Alex",
      "lastName": "Smith",
      "title": "Instructor",
      "email": "alex.smith@example.edu",
      "phone": "555-0101",
      "office": "A-210",
      "officeHours": "Monday and Wednesday, 1:00–3:00 PM",
      "bio": "I enjoy helping students succeed and reach their goals.",
      "image": "sample-instructor-a.jpg"
    }
  },
  "sections": {
    "1234567": "instructor_a",
    "Section 1": "instructor_a"
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `defaultInstructorKey` | Recommended | Fallback when a section is not listed in `sections` |
| `instructors` | Yes | Map of keys → profile objects |
| `instructors.*.name` | Yes | Display name as **First Last** (e.g. `Alex Smith`) |
| `instructors.*.firstName` / `lastName` | No | Optional; used by the config builder |
| `instructors.*.title` | No | Role line under the name (Instructor, Professor, TA, …) |
| `instructors.*.officeHours` / `office` / `phone` / `bio` | No | Omitted fields are hidden |
| `instructors.*.image` | No | Relative to the JSON file’s folder, or an absolute `/content/...` or `https://...` URL |
| `sections` | Yes | Keys may be **Section ID**, **Code**, or **Name**; values are instructor keys |

Lookup order for each learner section: **SectionId → Code → Name → `defaultInstructorKey`**.

### Advanced: one shared JSON for many courses

Point `CONFIG_URL` at a Shared/Public Files path, and nest courses:

```json
{
  "version": 1,
  "courses": {
    "6606": {
      "defaultInstructorKey": "instructor_a",
      "instructors": { },
      "sections": { }
    },
    "6607": {
      "defaultInstructorKey": "instructor_b",
      "instructors": { },
      "sections": { }
    }
  }
}
```

Use this only when a central team maintains all mappings; otherwise per-course files are easier for instructors to update.

---

## Finding section IDs

While logged into the course as an admin or instructor:

1. Open the browser console on the course homepage, or call:

   ```text
   GET /d2l/api/lp/1.51/{orgUnitId}/sections/
   ```

2. Note each section’s `SectionId`, `Name`, and `Code`.
3. Put the **SectionId** (most stable) in the JSON `sections` map.

You can also key by display name (e.g. `"Section 2"`) if IDs are inconvenient, but IDs survive renames better.

---

## Adapting for other institutions

Search `section-profile-widget.html` for the `CONFIG` block:

```javascript
const CONFIG = Object.freeze({
  LP_VERSION: "1.51",
  ORG_UNIT_ID: "{OrgUnitId}",
  CONFIG_FILE: "section-instructors.json",
  CONFIG_URL: "/content/enforced/{OrgUnitId}/section-instructors.json",
  HEADING_LABEL: "Your Instructor",
  EMAIL_BUTTON_LABEL: "Email Instructor",
  SHOW_SECTION_NAME: true,
  DEBUG: false
});
```

| Setting | What to change |
|---------|----------------|
| `LP_VERSION` | LP API version supported by your Brightspace instance |
| `CONFIG_URL` | Where the JSON lives (per-course enforced path, or shared/public path) |
| `HEADING_LABEL` / `EMAIL_BUTTON_LABEL` | Wording / localization |
| `SHOW_SECTION_NAME` | Hide the italic “Section: …” line if undesired |
| `DEBUG` | `true` while testing (shows URL/status details under errors) |

### Branding

- Email button: `#006fbf` (hover `#005a9c`)
- Card border: `#d5d9dd`
- Adjust CSS variables in the `<style>` block as needed for your brand

---

## Customization checklist

- [ ] Paste student widget into a **Custom Widget** on a **course** homepage (or shared course template)
- [ ] Confirm `{OrgUnitId}` is replaced at runtime on the student widget
- [ ] Publish `section-instructors.json` (+ images) via the builder or Manage Files
- [ ] Map real **Section IDs** to instructor keys
- [ ] Optional: add builder as a **hidden** instructor Content topic (`course-tool-topic.html`)
- [ ] Impersonate a learner in Section A and Section B — profiles should differ
- [ ] Set builder/widget `DEBUG` to `false` before production

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| “Could not determine the current course offering ID” | Widget not on a course homepage, or `{OrgUnitId}` not replaced |
| “You are not currently assigned to a section” | Learner has no section membership; check **Course Admin → Sections** |
| “No instructor is configured for your section” | Section ID/name missing from JSON; enable `DEBUG` to see resolved keys |
| “Instructor information could not be loaded” + HTTP 404 | JSON path wrong — confirm Manage Files root upload and `CONFIG_URL` |
| Photo missing / broken | Image path wrong relative to JSON folder, or file not uploaded |
| Works for admin, fails for student | Student cannot read the Manage Files path — ensure the JSON/images are available to learners (course content files learners can fetch, or a public/shared path your org allows) |

### Debug

Set `DEBUG: true` in `CONFIG`. Warning and error states then include the request URL, HTTP status, and section identifiers.

---

## Security and privacy notes

- Instructor contact details in the JSON are visible to anyone who can load the widget and the config file URL.
- Do not put private notes, employee IDs, or sensitive personal data in the JSON beyond what you intend students to see.
- The widget does not expose other students’ enrollments—only the current user’s section via `mysections`.

---

## License and contribution

Shared for use and adaptation by other Brightspace administrators. When publishing or forking:

- Replace sample instructor names, emails, phones, and photos
- Confirm `sections/mysections` works for your Student role
- Document your Manage Files path conventions for colleagues

---

## Credits

Developed by **Your College** eLearning / D2L administration.

**Version notes:**

- Config schema: **v1** (`instructors` + `sections`, optional `courses` wrapper)
- LP API: `1.51` (adjust `LP_VERSION` as needed)
- Section lookup: SectionId → Code → Name → defaultInstructorKey
