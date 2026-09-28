/**
 * Recently enrolled, never logged in
 * June 2026 APIs: enrollmentlogs (Action = enroll) + usertrackinglogs (no login in 31 days).
 * Incremental classlist scan — not the Data Hub lifetime Never Logged In report.
 */
(function () {
    'use strict';

    const J = () => window.JuneLogs;
    const MODAL = 'loadingModal';

    let picker = null;
    let lastRows = [];
    let dataTable = null;

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
        picker = J().bindCoursePicker();
        try {
            await J().populateSemesterSelect(document.getElementById('semesterSelect'));
        } catch (error) {
            setStatus('Could not load semesters: ' + (error.message || error), true);
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
