/**
 * Recently enrolled, never logged in
 * June 2026 APIs: enrollmentlogs (Action = enroll) + usertrackinglogs (no login in 31 days).
 * Incremental classlist scan — not the Data Hub lifetime Never Logged In report.
 */
(function () {
    'use strict';

    const J = () => window.JuneLogs;
    const MODAL = 'loadingModal';
    const DATE_FOLDER = '/content/semester-courses-w-dates/';

    let picker = null;
    let lastRows = [];
    let dataTable = null;
    const dateFileCache = new Map();

    function setStatus(message, isError) {
        const el = document.getElementById('statusLine');
        if (!el) return;
        el.textContent = message || '';
        el.className = isError ? 'status-line error' : 'status-line';
    }

    function destroyTable() {
        if (dataTable) {
            dataTable.destroy();
            dataTable = null;
        }
        const tbody = document.querySelector('#resultsTable tbody');
        if (tbody) tbody.innerHTML = '';
    }

    function renderRows(rows) {
        const card = document.getElementById('resultsCard');
        const pills = document.getElementById('summaryPills');
        card.classList.remove('hidden');
        document.getElementById('csvBtn').classList.toggle('hidden', !rows.length);

        const courseCount = new Set(rows.map((r) => r.courseId)).size;
        pills.innerHTML =
            '<span class="pill">Hits: ' + rows.length + '</span>' +
            '<span class="pill">Courses in result: ' + courseCount + '</span>';

        destroyTable();
        const tbody = document.querySelector('#resultsTable tbody');
        tbody.innerHTML = rows.map((r) => {
            return '<tr>' +
                '<td class="mono">' + J().escapeHtml(r.orgDefinedId) + '</td>' +
                '<td>' + J().escapeHtml(r.displayName) + '</td>' +
                '<td class="mono">' + J().escapeHtml(r.userName) + '</td>' +
                '<td class="mono">' + J().escapeHtml(r.userId) + '</td>' +
                '<td class="mono">' + J().escapeHtml(r.courseCode) + '</td>' +
                '<td>' + J().escapeHtml(r.courseName) + '</td>' +
                '<td>' + J().escapeHtml(r.enrolledDetroit) + '</td>' +
                '<td class="mono">' + J().escapeHtml(r.enrolledBy) + '</td>' +
                '<td>' + r.loginCount + '</td>' +
                '</tr>';
        }).join('');

        dataTable = $('#resultsTable').DataTable({
            pageLength: 25,
            order: [[6, 'desc']],
            autoWidth: false
        });
    }

    function isCancelled() {
        return typeof LoadingUtils !== 'undefined' && LoadingUtils.isCancelled(MODAL);
    }

    function hideNotStartedChecked() {
        const box = document.getElementById('hideNotStarted');
        return !box || box.checked;
    }

    function selectedTermCode(semesterId, courses) {
        const api = J();
        const select = document.getElementById('semesterSelect');
        const histId = select && select.dataset.scHistoricalInputId;
        const hist = histId ? document.getElementById(histId) : null;
        const usingHistorical = !!(hist && hist.value && hist.value.trim());
        if (!usingHistorical && select) {
            const opt = select.options[select.selectedIndex];
            if (opt && opt.dataset.code && (!semesterId || opt.value === String(semesterId))) {
                return opt.dataset.code;
            }
        }
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.match && semesterId) {
            const entry = SemesterConfig.match(semesterId);
            if (entry && entry.Code && entry.Code !== 'Sandbox') return entry.Code;
        }
        const counts = new Map();
        (courses || []).forEach((course) => {
            const term = api.termCodeFromOffering(course.code);
            if (!term) return;
            counts.set(term, (counts.get(term) || 0) + 1);
        });
        let best = '';
        let bestCount = 0;
        counts.forEach((count, term) => {
            if (count > bestCount) {
                best = term;
                bestCount = count;
            }
        });
        return best;
    }

    function updateDateFileHint() {
        const hint = document.getElementById('dateFileHint');
        if (!hint) return;
        const term = selectedTermCode('', []);
        const name = J().semesterDatesFileName(term);
        if (!name) {
            hint.innerHTML = 'Start dates come from <code>content/semester-courses-w-dates/26fa.csv</code> for 26/FA, and the same pattern for other terms. A section is skipped when <code>sec_start_date</code> is after today. A course that is not in the file stays in the scan.';
            return;
        }
        hint.innerHTML = 'Start dates for ' + J().escapeHtml(term) + ' come from <code>content/semester-courses-w-dates/' + J().escapeHtml(name) + '</code>. A section is skipped when <code>sec_start_date</code> is after today. A course that is not in the file stays in the scan.';
    }

    async function loadDateFile(termCode, force) {
        const api = J();
        const name = api.semesterDatesFileName(termCode);
        if (!name) {
            return {
                ok: false,
                name: '',
                term: termCode || '',
                index: new Map(),
                sectionCount: 0,
                message: 'This semester has no date file name. Expected a code like 26/FA.'
            };
        }
        if (!force && dateFileCache.has(name)) return dateFileCache.get(name);
        const url = DATE_FOLDER + name;
        let result;
        try {
            const response = await fetch(url, { cache: 'no-store', credentials: 'include' });
            if (!response.ok) {
                result = {
                    ok: false,
                    name: name,
                    term: termCode,
                    index: new Map(),
                    sectionCount: 0,
                    message: name + ' was not found in content/semester-courses-w-dates/ (HTTP ' + response.status + '). Courses that have not started were not filtered.'
                };
                } else {
                    const text = await csvTextFromResponse(response);
                    const trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
                    if (!trimmed || trimmed.charAt(0) === '<') {
                        result = {
                            ok: false,
                            name: name,
                            term: termCode,
                            index: new Map(),
                            sectionCount: 0,
                            rowCount: 0,
                            message: name + ' did not return a CSV. Sign in to Brightspace and confirm the file is in content/semester-courses-w-dates/.'
                        };
                    } else {
                        const built = api.buildSectionStartIndex(api.parseCsvTable(text));
                        const unread = !built.sectionCount;
                        let message = '';
                        if (unread) {
                            message = name + ' loaded (' + built.rowCount + ' rows) but no start dates were recognized.';
                            if (built.sampleDate) message += ' First date value was "' + built.sampleDate + '".';
                            else message += ' No sec_start_date column was found.';
                            if (built.headers && built.headers.length) message += ' Columns: ' + built.headers.slice(0, 12).join(', ') + '.';
                        }
                        result = {
                            ok: true,
                            name: name,
                            term: termCode,
                            index: built.index,
                            sectionCount: built.sectionCount,
                            rowCount: built.rowCount,
                            sampleCode: built.sampleCode,
                            sampleDate: built.sampleDate,
                            message: message
                        };
                    }
                }
        } catch (error) {
            result = {
                ok: false,
                name: name,
                term: termCode,
                index: new Map(),
                sectionCount: 0,
                message: 'Could not load ' + name + ' from content/semester-courses-w-dates/. ' + ((error && error.message) || '')
            };
        }
        if (result.ok) dateFileCache.set(name, result);
        else dateFileCache.delete(name);
        return result;
    }

    async function csvTextFromResponse(response) {
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
            return new TextDecoder('utf-16le').decode(bytes);
        }
        if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
            return new TextDecoder('utf-16be').decode(bytes);
        }
        let text = new TextDecoder('utf-8').decode(bytes);
        if (text.indexOf('\u0000') !== -1) text = new TextDecoder('utf-16le').decode(bytes);
        return text;
    }

    function applyStartDate(course, file) {
        const api = J();
        course.dateFileName = file.name || '';
        course.dateFileOk = !!file.ok;
        if (!file.ok) {
            course.startLabel = 'Date file missing';
            course.startKnown = false;
            course.notStarted = false;
            return;
        }
        if (!file.sectionCount) {
            course.startLabel = 'Date not read';
            course.startKnown = false;
            course.notStarted = false;
            return;
        }
        const start = api.lookupCourseStart(file.index, course);
        if (!start) {
            course.startLabel = 'Not in date file';
            course.startKnown = false;
            course.notStarted = false;
            return;
        }
        course.startLabel = api.formatSectionStart(start);
        course.startKnown = true;
        course.notStarted = api.sectionStartsAfterToday(start);
    }

    async function attachStartDates(courses, semesterId, force) {
        const groups = new Map();
        (courses || []).forEach((course) => {
            const term = J().termCodeFromOffering(course.code) || selectedTermCode(semesterId, courses);
            const key = term || '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(course);
        });
        let primary = null;
        const keys = [...groups.keys()];
        for (let i = 0; i < keys.length; i++) {
            const file = await loadDateFile(keys[i], force);
            groups.get(keys[i]).forEach((course) => applyStartDate(course, file));
            if (!primary || groups.get(keys[i]).length > (groups.get(primary.term || '') || []).length) {
                primary = file;
            }
        }
        return primary || {
            ok: false,
            name: '',
            term: '',
            index: new Map(),
            sectionCount: 0,
            message: 'No courses to match against a date file.'
        };
    }

    function dateLoadSummary(courses, file) {
        const future = courses.filter((course) => course.notStarted).length;
        const matched = courses.filter((course) => course.startKnown).length;
        if (!file || !file.ok) return (file && file.message) || 'Date file was not loaded.';
        if (!file.sectionCount) return file.message || (file.name + ' did not include any start dates.');
        if (!matched && courses.length) {
            const example = courses[0].code || courses[0].name || 'a Brightspace course';
            return file.name + ' lists ' + file.sectionCount + ' sections, but none matched these course codes. Brightspace example: ' +
                example + '. File example: ' + (file.sampleCode || 'none') + '.';
        }
        let message = 'Loaded ' + courses.length + ' courses. ' + file.name + ' lists ' + file.sectionCount + ' sections. ';
        message += matched + ' matched a start date. ';
        message += future + ' have not started' + (hideNotStartedChecked() ? ' and are hidden. ' : '. ');
        const unknown = courses.filter((course) => course.dateFileOk && !course.startKnown).length;
        if (unknown) message += unknown + ' are not in that file and stay in the scan.';
        return message.trim();
    }

    async function annotateCourses(courses, semesterId) {
        const file = await attachStartDates(courses, semesterId, true);
        const matched = courses.filter((course) => course.startKnown).length;
        const failed = !(file && file.ok && file.sectionCount) || (courses.length > 0 && matched === 0);
        setStatus(dateLoadSummary(courses, file), failed);
        return courses;
    }

    function filterUnstarted(courses) {
        const skipped = courses.filter((course) => course.notStarted);
        const kept = courses.filter((course) => !course.notStarted);
        const unknown = kept.filter((course) => course.dateFileOk && !course.startKnown);
        let note = '';
        if (skipped.length) note += 'Skipped ' + skipped.length + ' course(s) that have not started. ';
        if (unknown.length) {
            const name = unknown[0].dateFileName || 'the date file';
            note += unknown.length + ' course(s) are not in ' + name + ' and were still scanned. ';
        }
        return { courses: kept, note: note };
    }

    async function runReport() {
        const api = J();
        lastRows = [];
        document.getElementById('csvBtn').classList.add('hidden');

        let courses;
        try {
            courses = await picker.getSelectedCourses();
        } catch (error) {
            setStatus(error.message, true);
            return;
        }

        let dateNote = '';
        if (hideNotStartedChecked()) {
            const file = await attachStartDates(courses, api.effectiveSemesterId(document.getElementById('semesterSelect')), false);
            const filtered = filterUnstarted(courses);
            courses = filtered.courses;
            dateNote = (file.ok ? '' : file.message + ' ') + filtered.note;
            if (!courses.length) {
                setStatus('Nothing to scan. ' + dateNote.trim(), !file.ok);
                return;
            }
        }

        if (courses.length > 40 && !window.confirm(
            'This will scan ' + courses.length + ' courses (classlist + enrollment log + tracking log per student). Continue?'
        )) {
            return;
        }

        const days = Number(document.getElementById('enrollWindow').value) || 7;
        const enrollStart = api.daysAgoIso(days);
        const enrollEnd = api.toUtcIso(new Date());
        const tracking = api.trackingWindowUtc();

        LoadingUtils.showLoadingModal('Loading classlists…', MODAL, function () {});
        const runBtn = document.getElementById('runBtn');
        runBtn.disabled = true;

        try {
            const seats = []; // { user, course }

            for (let i = 0; i < courses.length; i++) {
                if (isCancelled()) throw new api.CancelledError();
                const course = courses[i];
                LoadingUtils.updateLoadingModal(
                    Math.round(((i + 1) / courses.length) * 25),
                    'Classlist ' + (i + 1) + '/' + courses.length + ' · ' + (course.code || course.id),
                    MODAL
                );
                const classlist = await api.fetchClasslist(course.id, api.STUDENT_ROLE_ID);
                classlist.forEach((item) => {
                    const user = api.userFromEnrollment(item);
                    if (user.userId) seats.push({ user: user, course: course });
                });
            }

            const uniqueUserIds = [...new Set(seats.map((s) => s.user.userId))];
            const logCache = new Map();
            const trackCache = new Map();
            const multiCourse = courses.length > 1;

            LoadingUtils.updateLoadingModal(30, 'Reading enrollment logs for ' + uniqueUserIds.length + ' students…', MODAL);

            await api.mapPool(uniqueUserIds, async (userId) => {
                const opts = {
                    startDateTime: enrollStart,
                    endDateTime: enrollEnd
                };
                if (!multiCourse) opts.orgUnitId = courses[0].id;
                const logs = await api.fetchEnrollmentLogs(userId, opts);
                logCache.set(String(userId), logs || []);
            }, {
                concurrency: 4,
                isCancelled: isCancelled,
                onProgress: function (done, total) {
                    LoadingUtils.updateLoadingModal(
                        30 + Math.round((done / total) * 40),
                        'Enrollment logs ' + done + '/' + total,
                        MODAL
                    );
                }
            });

            const logErrors = uniqueUserIds.filter((id) => !logCache.has(String(id))).length;
            if (uniqueUserIds.length && logErrors === uniqueUserIds.length) {
                throw new Error('Could not read enrollment logs for any student. This LMS may not have LP 1.61+ (June 2026), or your role lacks users:enrollmentlogs:read.');
            }

            const candidates = [];
            seats.forEach((seat) => {
                const logs = logCache.get(String(seat.user.userId)) || [];
                const enrolls = logs.filter((log) => {
                    if (Number(log.Action) !== 1) return false;
                    if (String(log.OrgUnitId) !== String(seat.course.id)) return false;
                    return true;
                });
                if (!enrolls.length) return;
                enrolls.sort((a, b) => String(b.Date).localeCompare(String(a.Date)));
                candidates.push({ seat: seat, enroll: enrolls[0] });
            });

            const candidateUserIds = [...new Set(candidates.map((c) => c.seat.user.userId))];
            LoadingUtils.updateLoadingModal(72, 'Checking logins for ' + candidateUserIds.length + ' recently enrolled students…', MODAL);

            await api.mapPool(candidateUserIds, async (userId) => {
                const logs = await api.fetchTrackingLogs(userId, tracking.startDateTime, tracking.endDateTime);
                trackCache.set(String(userId), logs || []);
            }, {
                concurrency: 4,
                isCancelled: isCancelled,
                onProgress: function (done, total) {
                    LoadingUtils.updateLoadingModal(
                        72 + Math.round((done / Math.max(total, 1)) * 25),
                        'Tracking logs ' + done + '/' + total,
                        MODAL
                    );
                }
            });

            const hits = [];
            candidates.forEach((c) => {
                const logins = trackCache.get(String(c.seat.user.userId));
                if (!logins) return;
                if (logins.length > 0) return;
                const enrolledBy = c.enroll.EnrolledBy == null ? 'System / SIS' : String(c.enroll.EnrolledBy);
                hits.push({
                    orgDefinedId: c.seat.user.orgDefinedId,
                    displayName: c.seat.user.displayName,
                    userName: c.seat.user.userName,
                    userId: c.seat.user.userId,
                    courseId: c.seat.course.id,
                    courseCode: c.seat.course.code,
                    courseName: c.seat.course.name,
                    enrolledIso: c.enroll.Date || '',
                    enrolledDetroit: api.formatDetroit(c.enroll.Date),
                    enrolledBy: enrolledBy,
                    loginCount: 0
                });
            });

            lastRows = hits;
            renderRows(hits);
            const courseLabel = courses.length === 1
                ? (courses[0].code || courses[0].id)
                : courses.length + ' courses';
            setStatus(
                dateNote +
                hits.length + ' student(s) enrolled in the last ' + days + ' day(s) in ' +
                courseLabel + ' with no system login in the last 31 days. ' +
                'Scanned ' + uniqueUserIds.length + ' classlist student(s); ' +
                candidateUserIds.length + ' had a recent enroll event.' +
                (logErrors ? ' Enrollment-log errors: ' + logErrors + '.' : '')
            );
            LoadingUtils.updateLoadingModal(100, 'Done', MODAL);
        } catch (error) {
            if (error && error.name === 'CancelledError') {
                setStatus('Cancelled. Last run was not saved. Partial results are not shown.', true);
                return;
            }
            const message = api.friendlyApiError(error, 'enrollment or tracking logs');
            setStatus(message, true);
        } finally {
            runBtn.disabled = false;
            setTimeout(() => LoadingUtils.hideLoadingModal(MODAL), 400);
        }
    }

    function downloadCsv() {
        const api = J();
        const headers = [
            'OrgDefinedId', 'Name', 'Username', 'UserId', 'CourseCode', 'CourseName',
            'OrgUnitId', 'EnrolledUtc', 'EnrolledDetroit', 'EnrolledBy', 'LoginsIn31Days'
        ];
        const rows = lastRows.map((r) => ({
            OrgDefinedId: r.orgDefinedId,
            Name: r.displayName,
            Username: r.userName,
            UserId: r.userId,
            CourseCode: r.courseCode,
            CourseName: r.courseName,
            OrgUnitId: r.courseId,
            EnrolledUtc: r.enrolledIso,
            EnrolledDetroit: r.enrolledDetroit,
            EnrolledBy: r.enrolledBy,
            LoginsIn31Days: r.loginCount
        }));
        api.downloadCsv('recently-enrolled-never-logged-in-' + new Date().toISOString().slice(0, 10) + '.csv', headers, rows);
    }

    async function init() {
        picker = J().bindCoursePicker({
            annotateCourses: annotateCourses,
            courseHidden: function (course) {
                return hideNotStartedChecked() && !!course.notStarted;
            }
        });
        const semesterSelect = document.getElementById('semesterSelect');
        try {
            await J().populateSemesterSelect(semesterSelect);
        } catch (error) {
            setStatus('Could not load semesters: ' + (error.message || error), true);
        }
        updateDateFileHint();
        if (semesterSelect) semesterSelect.addEventListener('change', updateDateFileHint);
        const hideNotStarted = document.getElementById('hideNotStarted');
        if (hideNotStarted) {
            hideNotStarted.addEventListener('change', function () {
                if (picker) picker.render();
            });
        }
        document.getElementById('runBtn').addEventListener('click', runReport);
        document.getElementById('csvBtn').addEventListener('click', downloadCsv);
        document.getElementById('orgUnitId').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') runReport();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
