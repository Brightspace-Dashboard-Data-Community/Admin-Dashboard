# Faculty Onboarding Progress Widget

A Brightspace homepage widget that shows new instructors their onboarding phase, progress bar, and next faculty-visible steps.

## Setup

1. Copy `faculty-onboarding-progress-widget.html` into a D2L Custom Widget on the faculty homepage.
2. Ensure faculty are enrolled in the onboarding hub course shell (org unit `1000001`) with read access to their JSON file.
3. Update `CONFIG_BASE` in the widget if your admin dashboard is hosted at a different path.

## Data source

Reads the faculty member's JSON record from `inprogress-onboarding/` or `faculty-logs/` via the Manage Files API.

## Faculty-visible steps

Configured in `faculty-onboarding/config/phases.json` via `"facultyVisible": true` on checklist items.
