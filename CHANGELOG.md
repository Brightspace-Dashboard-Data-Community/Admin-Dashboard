# Changelog

Notable changes to the Your College D2L Admin Dashboard, newest first.

Entries are grouped by the day they were made. This log starts on September 28, 2026, when the project was prepared for GitHub. Work done before that date is not listed here.

## November 13, 2026

### Fixed

- Search Courses shows matching courses again. The results table was looking for instructor names in a variable that only existed while those names were being loaded, so every successful search ended on “Error retrieving courses.”
- Users by Role requests the Users full extract on Learning Platform API 1.50. The 1.43 extracts route no longer returns the dataset on the live server.
- Users by Role downloads that extract without sending the login cookie to the file host. The browser was rejecting that redirect.
- Users by Role can load a downloaded Users extract zip when the browser blocks the file host.
- Users by Role reads Created Date from CreationDate. Last Visited stays blank because the Users extract no longer includes last access.
- Users by Role leaves out accounts that already have a DateDeleted value. The review and delete actions were returning Not Found for those accounts.

### Changed

- Users by Role column headers sort the loaded users.
- Users by Role can delete the checked accounts together. The header box selects the rows on the current page.

## November 12, 2026

### Removed

- Self-enrolled Courses in Sandbox is gone. Brightspace does not provide a way to list every Discover self-enrolled course.

## November 10, 2026

### Added

- Training privacy mask hides names, usernames, IDs, and emails before a screen share. Click your name at the bottom of the sidebar, or press Alt+Shift+P. It stays on as you move between dashboard pages.

## October 28, 2026

### Added

- Yuja Accessibility can download a branded PDF of the loaded overview: scores, file-type months, divisions, and disciplines for the filters currently on the page.

## October 26, 2026

### Changed

- Course Overview is no longer listed under Work-in-Progress. It stays under Course Management.
- End of Semester Course Report is in Access and lookups. The WIP and Beta labels are gone from the catalog, the page, the PDF, and the admin guide.

### Fixed

- System Usage Analytics fills the semester list again. The page threw while filtering terms, so both dropdowns stayed on Loading.
- Completion Report fills the semester list again. A script error stopped the page before the dropdown could load, so Run had no term to use.
- End of Semester Course Report stays on the page when you generate it. The old form posted back to the Brightspace content file, which answers with Bad page request.

### Removed

- Course Section Association (Merge) is off Reports & Tools. The page and its script are gone. Course Merge Verifier and Course Merge Updater stay.

## October 22, 2026

### Added

- Reports & Tools has a search field that filters the catalog by name, description, or group.
- Broken / Missing Links is packaged as its own folder and zip under `standalone/`, so another school can upload just that report to Brightspace.
- The admin guide has a report calendar for Fall 2026 through Fall 2027. It marks the window that is open today and the approximate dates for before the term, first week, mid-semester, 7-week grades, the second 7-week session, and the end of the term.

### Changed

- Faculty Feedback Timeliness scans every course that matches the filter, instead of the first 25 or 50. No feedback and late feedback are separate flags, and both wait until the day threshold. A course opens to the activity, then to the student work behind the flag.
- Recently enrolled, never logged in is in Roster and enrollment. It is no longer under Work-in-Progress.
- Recently enrolled, never logged in skips sections whose start date is still in the future. Dates come from `content/semester-courses-w-dates/` (`26fa.csv` for 26/FA, `27wi.csv` for 27/WI).
- Session timing on the admin guide and the course-setup list follows the college’s 7-week dates.

### Fixed

- System Usage Analytics counts students from the classlist user id, leaves out the person running the report, and shows who has opened each course. The empty activity columns are gone.
- Recently enrolled, never logged in reads section start dates from the semester CSV when the export uses another date style, a tab separator, or a Brightspace code that ends in `-COURSE`.
- Recently enrolled, never logged in keeps space between the cards, lines the semester fields up with Load courses, and keeps the results search inside its card.
- The admin guide catalog button keeps white text on the green background. The section link color was covering it.

## October 21, 2026

### Added

- A script combines one-course Watermark evaluation workbooks into a single CSV for the faculty evaluation report. Run it in the download folder with no arguments and it writes watermark-evaluations.csv there.
- Watermark Evaluations loads that CSV and lists low course scores by division and discipline, with an optional faculty list for full-time versus adjunct.
- Yuja Accessibility reads a Panorama LMS export and groups course scores by division and discipline, using the same prefix list as Division Information.

### Changed

- Yuja Accessibility leaves out MERGED and CXLD courses. The checkbox can turn them back on.
- Each course on the Yuja Accessibility Courses tab links to its Panorama report in Brightspace.
- Yuja Accessibility keeps Fall 2026 and later terms. A new export adds the next semesters on its own. Sandboxes, MERGED and CXLD courses, and prefixes that are not on the division list start hidden.

### Fixed

- Watermark Evaluations drops the open course when you change division or discipline, so a French course does not stay on screen after you choose English.
- Choosing a discipline on Yuja Accessibility shows that discipline’s courses.

### Removed

- Yuja Accessibility no longer opens a course report inside the page. Course names stay links to the Brightspace course.
- Yuja Accessibility no longer keeps a Panorama export in the project. Load the JSON or Excel file each time you open the page.
- Yuja Accessibility no longer has Hide Default Term or Hide 0000-No Semester. Those courses are outside Fall 2026 and later, so they are left out with the older terms.

## October 16, 2026

### Changed

- Upcoming Courses reads `course_sec_term` as the section code, so the current future-courses export matches Brightspace offering codes.

## October 15, 2026

### Added

- Deidentified Student Login widget creates an anonymous or guest Brightspace account and enrolls it in courses chosen in the widget, for schools that need this off the class homepage.

## October 1, 2026

### Changed

- Each entry sits under the day it was made, so the log shows when a change landed.

## September 30, 2026

### Changed

- Semester List on Reports & Tools now says it shows semesters the dropdowns already include. A term that is missing is added from the admin guide, not from that report.
- Reports & Tools lists each tool once, with a short description on every card and jump links for each group.
- The June 2026 enrollment monitoring heading is gone. Those reports are no longer grouped by the Brightspace API release date.
- Enrollment watch list and Recently enrolled, never logged in are under Work-in-Progress. The admin guide marks both in progress.
- End of Semester Course Report is listed with the other in-progress tools.
- Master Schedule Date Check columns can be sorted, and the start date and end date can be written separately.

### Added

- Winter 2027 (`27/WI`, org unit 3017014, name `WINTER 2027`) is on the semester list, so report dropdowns can select it.
- Admin guide includes the steps for the next time Brightspace releases a semester: copy the name, code, and org unit id into `js/semester-config.js`, confirm the dropdown, then run the before-the-term reports.
- The home page “Current term” label stays on the semester marked `current: true` (Fall 2026). Releasing the next semester’s shells does not move that label.
- Master Schedule Date Check compares Brightspace dates for a semester to the master schedule and can write the schedule start date, or an end date 7 days later, back to D2L.

### Fixed

- Master Schedule Date Check keeps the start and end controls inside the last column instead of covering the issue text.
- Master Schedule Date Check reads Brightspace section offerings whose codes end in `-COURSE`, such as `RT-121-FA700-26/FA-COURSE`, instead of skipping them as template shells.

### Removed

- Reports & Tools no longer lists Faculty Feedback Check. That page depended on Supabase, which the dashboard no longer uses.

## September 28, 2026

### Changed

- Faculty Success is marked Beta in the menu and on the onboarding pages while that workflow is still being redesigned.

### Added

- New Faculty Tracker config records one Microsoft List per new instructor for the first teaching semester, so the next cohort is not tracked with the six-phase checklist.
- Admin guide lists which reports to run daily, before the term, in the first week, at midterm, at the end of the term, and between sessions.
- Started this changelog as the record of changes going forward.
- Added a separate `git-upload` folder for GitHub. It is rebuilt from the working dashboard with private data, live college URLs, and branding removed.

### Removed

- The GitHub copy leaves out `D2L Widgets`. Those homepage widgets are separate from the admin dashboard.
- The GitHub copy leaves out `extras`. Those legacy pages, notes, and the doc builder are not used by the dashboard.
- Removed Faculty Feedback Check and the Supabase client. The dashboard no longer stores follow-up flags or other data in Supabase.
