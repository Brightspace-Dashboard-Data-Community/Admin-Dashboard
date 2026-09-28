# Changelog

Notable changes to the Your College D2L Admin Dashboard, newest first.

This log starts on September 28, 2026, when the project was prepared for GitHub. Work done before that date is not listed here.

## Unreleased

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
