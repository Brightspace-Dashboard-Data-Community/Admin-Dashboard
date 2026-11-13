/**
 * Course / semester enrollment watch list
 * Classlist + June 2026 enrollment logs since last run (SIS/ILP overnight changes).
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'd2lEnrollmentWatchList.v1';
    const MODAL = 'loadingModal';
    const J = () => window.JuneLogs;

    let picker = null;
    let lastRows = [];
    let dataTable = null;

    function loadStore() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (!parsed.courses || typeof parsed.courses !== 'object') parsed.courses = {};
            return parsed;
        } catch {
            return { courses: {} };
        }
    }

    function saveStore(store) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function setStatus(message, isError) {
        const el = document.getElementById('statusLine');
        if (!el) return;
        el.textContent = message || '';
        el.className = isError ? 'status-line error' : 'status-line';
    }

    function isCancelled() {
        return typeof LoadingUtils !== 'undefined' && LoadingUtils.isCancelled(MODAL);
    }

    function snapshotHint(courses) {
        const store = loadStore();
        if (!courses || !courses.length) {
            return 'No courses selected yet. Last-run timestamps are stored in this browser per OrgUnit ID.';
        }
        const known = courses.filter((c) => store.courses[c.id] && store.courses[c.id].lastSuccessfulRun);
        if (!known.length) {
            return 'First run for ' + (courses.length === 1 ? 'this course' : 'these courses') +
                '. Default window is 24 hours. Drops of people who already left will appear on the next run.';
        }
        const times = known.map((c) => store.courses[c.id].lastSuccessfulRun).sort();
        const api = J();
        if (known.length === 1) {
            return 'Last successful run for ' + (known[0].code || known[0].id) + ': ' +
                api.formatDetroit(times[0]) + ' (Detroit).';
        }
        return 'Saved last-run on ' + known.length + '/' + courses.length + ' selected courses. Oldest: ' +
            api.formatDetroit(times[0]) + ' (Detroit).';
    }

    async function updateHint() {
        try {
            const pasted = (document.getElementById('orgUnitId').value || '').trim();
            if (pasted && /^\d+$/.test(pasted)) {
                document.getElementById('lastRunHint').textContent = snapshotHint([{ id: pasted, code: pasted }]);
                return;
            }
            const courses = await picker.getSelectedCourses().catch(() => []);
            document.getElementById('lastRunHint').textContent = snapshotHint(courses);
        } catch {
            document.getElementById('lastRunHint').textContent = snapshotHint([]);
        }
    }

    function resolveSinceIso(courses, store) {
        const mode = document.getElementById('sinceMode').value;
        const api = J();
        if (mode === '24') return api.hoursAgoIso(24);
        if (mode === '7') return api.daysAgoIso(7);
        if (mode === 'custom') {
            const d = api.fromDatetimeLocal(document.getElementById('customSince').value);
            if (!d) throw new Error('Choose a custom start date and time.');
            return api.toUtcIso(d);
        }
        const runs = courses
            .map((c) => store.courses[c.id] && store.courses[c.id].lastSuccessfulRun)
            .filter(Boolean)
            .sort();
        if (runs.length) return runs[0];
        return api.hoursAgoIso(24);
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

        const enrolls = rows.filter((r) => r.action === 1).length;
        const drops = rows.filter((r) => r.action === 0).length;
        pills.innerHTML =
            '<span class="pill">Events: ' + rows.length + '</span>' +
            '<span class="pill">Enrolls: ' + enrolls + '</span>' +
            '<span class="pill">Drops: ' + drops + '</span>';

        destroyTable();
        const tbody = document.querySelector('#resultsTable tbody');
        const api = J();
        tbody.innerHTML = rows.map((r) => {
            const actionClass = r.action === 1 ? 'action-enroll' : (r.action === 0 ? 'action-unenroll' : '');
            return '<tr>' +
                '<td>' + api.escapeHtml(r.whenDetroit) + '</td>' +
                '<td class="' + actionClass + '">' + api.escapeHtml(r.actionLabel) + '</td>' +
                '<td class="mono">' + api.escapeHtml(r.orgDefinedId) + '</td>' +
                '<td>' + api.escapeHtml(r.displayName) + '</td>' +
                '<td class="mono">' + api.escapeHtml(r.userName) + '</td>' +
                '<td class="mono">' + api.escapeHtml(r.userId) + '</td>' +
                '<td class="mono">' + api.escapeHtml(r.courseCode) + '</td>' +
                '<td>' + api.escapeHtml(r.courseName) + '</td>' +
                '<td class="mono">' + api.escapeHtml(r.roleId) + '</td>' +
                '<td class="mono">' + api.escapeHtml(r.enrolledBy) + '</td>' +
                '</tr>';
        }).join('');

        dataTable = $('#resultsTable').DataTable({
            pageLength: 25,
            order: [[0, 'desc']],
            autoWidth: false
        });
    }

    async function runScan() {
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
            'This will read classlists and enrollment logs for ' + courses.length + ' courses. Continue?'
        )) {
            return;
        }

        const store = loadStore();
        let sinceIso;
        try {
            sinceIso = resolveSinceIso(courses, store);
        } catch (error) {
            setStatus(error.message, true);
            return;
        }
        const endIso = api.toUtcIso(new Date());
        const actionFilter = document.getElementById('actionFilter').value;
        const courseIdSet = new Set(courses.map((c) => String(c.id)));
        const courseById = new Map(courses.map((c) => [String(c.id), c]));

        LoadingUtils.showLoadingModal('Loading classlists…', MODAL, function () {});
        const runBtn = document.getElementById('runBtn');
        runBtn.disabled = true;

        try {
            const userIndex = new Map();
            const currentIdsByCourse = {};
            const userIds = new Set();
            let firstRunCount = 0;

            for (let i = 0; i < courses.length; i++) {
                if (isCancelled()) throw new api.CancelledError();
                const course = courses[i];
                LoadingUtils.updateLoadingModal(
                    Math.round(((i + 1) / courses.length) * 30),
                    'Classlist ' + (i + 1) + '/' + courses.length + ' · ' + (course.code || course.id),
                    MODAL
                );
                const classlist = await api.fetchClasslist(course.id, api.STUDENT_ROLE_ID);
                const ids = [];
                classlist.forEach((item) => {
                    const user = api.userFromEnrollment(item);
                    if (!user.userId) return;
                    ids.push(user.userId);
                    userIds.add(user.userId);
                    if (!userIndex.has(user.userId)) userIndex.set(user.userId, user);
                });
                currentIdsByCourse[course.id] = ids;
                const prev = store.courses[course.id];
                if (!prev || !prev.lastSuccessfulRun) firstRunCount += 1;
                (prev && Array.isArray(prev.userIds) ? prev.userIds : []).forEach((id) => userIds.add(String(id)));
            }

            const idList = [...userIds];
            LoadingUtils.updateLoadingModal(32, 'Enrollment logs for ' + idList.length + ' user(s) since ' + api.formatDetroit(sinceIso) + '…', MODAL);

            const logCache = new Map();
            const multi = courses.length > 1;
            await api.mapPool(idList, async (userId) => {
                const opts = { startDateTime: sinceIso, endDateTime: endIso };
                if (!multi) opts.orgUnitId = courses[0].id;
                const logs = await api.fetchEnrollmentLogs(userId, opts);
                logCache.set(String(userId), logs || []);
            }, {
                concurrency: 4,
                isCancelled: isCancelled,
                onProgress: function (done, total) {
                    LoadingUtils.updateLoadingModal(
                        32 + Math.round((done / Math.max(total, 1)) * 60),
                        'Enrollment logs ' + done + '/' + total,
                        MODAL
                    );
                }
            });

            const logErrors = idList.filter((id) => !logCache.has(String(id))).length;
            if (idList.length && logErrors === idList.length) {
                throw new Error('Could not read enrollment logs for any user. This LMS may not have LP 1.61+ (June 2026), or your role lacks users:enrollmentlogs:read.');
            }

            const events = [];
            idList.forEach((userId) => {
                const logs = logCache.get(String(userId)) || [];
                const user = userIndex.get(String(userId)) || { userId: String(userId), displayName: '', userName: '', orgDefinedId: '' };
                logs.forEach((log) => {
                    const ou = String(log.OrgUnitId || '');
                    if (!courseIdSet.has(ou)) return;
                    const action = Number(log.Action);
                    if (actionFilter !== 'both' && String(action) !== actionFilter) return;
                    if (action !== 0 && action !== 1) return;
                    const course = courseById.get(ou) || { id: ou, code: log.OrgUnitCode || '', name: log.OrgUnitName || '' };
                    events.push({
                        whenIso: log.Date || '',
                        whenDetroit: api.formatDetroit(log.Date),
                        action: action,
                        actionLabel: api.actionLabel(action),
                        orgDefinedId: user.orgDefinedId || '',
                        displayName: user.displayName || '',
                        userName: user.userName || '',
                        userId: String(userId),
                        courseId: ou,
                        courseCode: course.code || log.OrgUnitCode || '',
                        courseName: course.name || log.OrgUnitName || '',
                        roleId: log.RoleId == null ? '' : String(log.RoleId),
                        enrolledBy: log.EnrolledBy == null ? 'System / SIS' : String(log.EnrolledBy)
                    });
                });
            });

            events.sort((a, b) => String(b.whenIso).localeCompare(String(a.whenIso)));
            lastRows = events;
            renderRows(events);

            if (logErrors === 0) {
                courses.forEach((course) => {
                    store.courses[course.id] = {
                        lastSuccessfulRun: endIso,
                        userIds: currentIdsByCourse[course.id] || [],
                        code: course.code || '',
                        name: course.name || ''
                    };
                });
                saveStore(store);
            }
            document.getElementById('lastRunHint').textContent = snapshotHint(courses);

            setStatus(
                events.length + ' enrollment event(s) since ' + api.formatDetroit(sinceIso) +
                ' (Detroit). Scanned ' + idList.length + ' user(s) across ' + courses.length + ' course(s).' +
                (firstRunCount ? ' ' + firstRunCount + ' course(s) had no prior snapshot.' : '') +
                (logErrors ? ' Enrollment-log errors: ' + logErrors + '. Snapshot was not updated.' : ' Snapshot saved for the next run.')
            );
            LoadingUtils.updateLoadingModal(100, 'Done', MODAL);
        } catch (error) {
            if (error && error.name === 'CancelledError') {
                setStatus('Cancelled. Snapshots were not updated.', true);
                return;
            }
            setStatus(api.friendlyApiError(error, 'enrollment logs'), true);
        } finally {
            runBtn.disabled = false;
            setTimeout(() => LoadingUtils.hideLoadingModal(MODAL), 400);
        }
    }

    function downloadCsv() {
        const api = J();
        const headers = [
            'WhenDetroit', 'WhenUtc', 'Action', 'OrgDefinedId', 'Name', 'Username', 'UserId',
            'CourseCode', 'CourseName', 'OrgUnitId', 'RoleId', 'EnrolledBy'
        ];
        const rows = lastRows.map((r) => ({
            WhenDetroit: r.whenDetroit,
            WhenUtc: r.whenIso,
            Action: r.actionLabel,
            OrgDefinedId: r.orgDefinedId,
            Name: r.displayName,
            Username: r.userName,
            UserId: r.userId,
            CourseCode: r.courseCode,
            CourseName: r.courseName,
            OrgUnitId: r.courseId,
            RoleId: r.roleId,
            EnrolledBy: r.enrolledBy
        }));
        api.downloadCsv('enrollment-watch-list-' + new Date().toISOString().slice(0, 10) + '.csv', headers, rows);
    }

    function clearHistory() {
        if (!window.confirm('Clear all saved classlist snapshots and last-run times for this tool in this browser?')) {
            return;
        }
        saveStore({ courses: {} });
        updateHint();
        setStatus('Saved snapshots cleared. The next scan will use a 24-hour window unless you pick another since option.');
    }

    async function init() {
        picker = J().bindCoursePicker();
        try {
            await J().populateSemesterSelect(document.getElementById('semesterSelect'));
        } catch (error) {
            setStatus('Could not load semesters: ' + (error.message || error), true);
        }

        const customWrap = document.getElementById('customSinceWrap');
        document.getElementById('sinceMode').addEventListener('change', () => {
            const custom = document.getElementById('sinceMode').value === 'custom';
            customWrap.classList.toggle('hidden', !custom);
            if (custom && !document.getElementById('customSince').value) {
                document.getElementById('customSince').value = J().datetimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1000));
            }
        });

        document.getElementById('runBtn').addEventListener('click', runScan);
        document.getElementById('csvBtn').addEventListener('click', downloadCsv);
        document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
        document.getElementById('orgUnitId').addEventListener('input', updateHint);
        document.getElementById('orgUnitId').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') runScan();
        });
        document.getElementById('coursePickerBody').addEventListener('change', updateHint);
        document.getElementById('loadCoursesBtn').addEventListener('click', () => setTimeout(updateHint, 500));
        updateHint();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
