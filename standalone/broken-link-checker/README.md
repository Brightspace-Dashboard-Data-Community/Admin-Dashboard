# Broken / Missing Links

A single Brightspace report. Pick a semester, scan course content, and download the rows that Brightspace already marks as broken, plus file topics with an empty path.

This folder is the whole product. It does not include the rest of the admin dashboard, a database, API keys, or another college’s semester list.

## What the scan checks

For each course offering in the semester (up to the limit you pick), the page reads that course’s content table of contents:

`GET /d2l/api/le/1.75/{orgUnitId}/content/toc`

A row is included when:

- `IsBroken` is true. Brightspace sets this when the activity for the topic cannot be found. The property is part of Learning Environment API 1.72 and newer. The page does not request the outside website itself.
- The topic is a file (`TopicType` 1) and `Url` is empty.

Hidden topics are still listed. The topic review dialog shows whether the topic or its module is hidden.

The scan only reads. It does not edit content, enrollments, or files.

## What you need

- A Brightspace login that can see organization structure (semesters and course offerings) and course content tables of contents. A role that can open those courses and view content is enough.
- The files hosted **on your Brightspace site**, opened while you are signed in. The page calls `/d2l/api/...` on the same address and sends your existing session cookie.
- Outbound access to the public CDNs used for the font, icons, jQuery, and the results table. Those are not required for the API calls.

There is no OAuth app, client id, or server to install.

## Install

1. Unzip this folder. Keep `index.html`, `css/`, and `js/` together.
2. In Brightspace, open the organization **Manage Files/Organization Files** (or a tools course you control).
3. Upload the folder. If you upload the zip, unzip it in Manage Files so the paths stay `css/checker.css` and `js/broken-links.js`.
4. Copy the file’s direct web address and open it in the same browser where you are signed in.

The address will look like one of these:

- `https://your-brightspace-host/shared/broken-link-checker/index.html`
- `https://your-brightspace-host/content/enforced/{orgUnitId}/broken-link-checker/index.html`

Opening the HTML from your desktop will not work. The page will say so. Brightspace’s content viewer sometimes strips scripts. If the semester list stays on “Loading...”, use the file’s direct address from Manage Files instead of the content-topic preview.

## Use

1. Confirm the green line names you and your organization. That means the session is working.
2. Choose a semester. The list is every org unit of type Semester under your organization, newest org unit id first. There is no built-in allowlist.
3. Leave the scan limit at 100 for a first run. “All courses” confirms before it starts.
4. Click **Run Link Scan**. Courses are read a few at a time. A course the account cannot open is skipped.
5. Click a topic title for module, hidden flags, and a link to the course home. Click a course code to open that course.
6. **Download CSV** saves the current results. Columns: OrgUnitId, Course Code, Course Name, Module, Topic Title, Link Type, Link URL / File, Status, Error Details.

If a semester’s course offerings sit under a department instead of directly under the semester, the scan falls back to course-offering descendants of that semester.

## API calls

| Call | Why |
| --- | --- |
| `GET /d2l/api/lp/1.49/users/whoami` | Confirm the signed-in user |
| `GET /d2l/api/lp/1.49/organization/info` | Find the organization id |
| `GET /d2l/api/lp/1.49/orgstructure/{orgId}/descendants/?ouTypeId=5` | List semesters. May need to adjust the ID number to match your system. |
| `GET /d2l/api/lp/1.49/orgstructure/{semesterId}/children/` | List course offerings in the semester |
| `GET /d2l/api/lp/1.49/orgstructure/{semesterId}/descendants/?ouTypeId=3` | Used only when the children list has no course offerings.  May need to adjust the ID number to match your system. |
| `GET /d2l/api/le/1.75/{orgUnitId}/content/toc` | Read topics and `IsBroken` |

To point the content call at a different Learning Environment version, change `LE_VERSION` at the top of `js/broken-links.js`.

## Limits

- External links are flagged only when Brightspace has set `IsBroken`. A link that still loads, or a site that blocks Brightspace’s own check, will not appear.
- The default limit is 100 courses, in API order, not a search. Raise the limit or choose All courses for a full semester.
- Large semesters take a long time because each course is a separate content request.
- Results stay in the browser until you run another scan or leave the page. Nothing is stored on a server.
