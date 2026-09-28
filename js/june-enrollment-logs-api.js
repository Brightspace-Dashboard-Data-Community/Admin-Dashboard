/**
 * June 2026 Brightspace user-log helpers (LP 1.61+).
 * Enrollment logs + user tracking logs. Shared by:
 *   - Recently enrolled, never logged in
 *   - Course / semester enrollment watch list
 *
 * Not related to Office Hours Chat or the User Merge API.
 */
(function (global) {
    'use strict';

    const LOGS_API_VERSION = '1.61';
    const USERS_API_VERSION = '1.49';
    const ENROLL_API_VERSION = '1.46';
    const STUDENT_ROLE_ID = 101;
    const COURSE_OFFERING_TYPE_ID = 3;
    const MAX_TRACKING_DAYS = 31;
    const DETROIT_TZ = 'America/Detroit';
    const CONCURRENCY = 4;
    const FALL_2026_ID = '3010530';

    class CancelledError extends Error {
        constructor() {
            super('Cancelled');
            this.name = 'CancelledError';
        }
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function itemsFrom(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.Items)) return data.Items;
        if (Array.isArray(data.Objects)) return data.Objects;
        return [];
    }

    async function apiFetch(endpoint) {
        if (typeof D2LApi === 'undefined' || typeof D2LApi._fetch !== 'function') {
            throw new Error('D2LApi is not loaded.');
        }
        let lastError = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                return await D2LApi._fetch(endpoint);
            } catch (error) {
                lastError = error;
                if (error && error.status === 429 && attempt < 3) {
                    await sleep(1000 * Math.pow(2, attempt));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    async function fetchPaged(buildUrl, maxPages) {
        const all = [];
        let bookmark = null;
        const seen = new Set();
        const limit = maxPages || 80;
        for (let page = 0; page < limit; page++) {
            const data = await apiFetch(buildUrl(bookmark));
            all.push.apply(all, itemsFrom(data));
            const paging = (data && data.PagingInfo) || {};
            const next = paging.Bookmark || paging.bookmark;
            const more = paging.HasMoreItems || paging.hasMoreItems;
            if (!more || next == null || next === '' || seen.has(String(next))) break;
            seen.add(String(next));
            bookmark = next;
        }
        return all;
    }

    function toUtcIso(date) {
        return date.toISOString();
    }

    function addDays(date, days) {
        return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
    }

    /** Inclusive window that stays inside the 31-day tracking-log limit. */
    function trackingWindowUtc(endDate) {
        const end = endDate ? new Date(endDate) : new Date();
        const start = new Date(end.getTime() - (MAX_TRACKING_DAYS * 24 * 60 * 60 * 1000) + 1000);
        return { startDateTime: toUtcIso(start), endDateTime: toUtcIso(end) };
    }

    function hoursAgoIso(hours) {
        return toUtcIso(new Date(Date.now() - hours * 60 * 60 * 1000));
    }

    function daysAgoIso(days) {
        return toUtcIso(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    }

    function formatDetroit(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return String(iso);
        return date.toLocaleString('en-US', {
            timeZone: DETROIT_TZ,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function datetimeLocalValue(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return '';
        const tz = d.getTime() - d.getTimezoneOffset() * 60000;
        return new Date(tz).toISOString().slice(0, 16);
    }

    function fromDatetimeLocal(value) {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function escapeHtml(value) {
        if (value == null) return '';
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    function csvCell(value) {
        const text = value == null ? '' : String(value);
        if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
        return text;
    }

    function downloadCsv(filename, headers, rows) {
        const lines = [headers.map(csvCell).join(',')];
        rows.forEach((row) => {
            lines.push(headers.map((h) => csvCell(row[h])).join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function friendlyApiError(error, kind) {
        const status = error && error.status;
        const label = kind || 'this API';
        if (status === 403) {
            return 'Forbidden reading ' + label + '. Check Users permissions and the June 2026 OAuth scopes.';
        }
        if (status === 404) {
            return label + ' route not found. This LMS needs LP API 1.61+ (Brightspace 20.26.6 / June 2026).';
        }
        if (status === 400) {
            return 'Invalid request for ' + label + '. Tracking logs must stay inside a 31-day window.';
        }
        return (error && error.message) || String(error);
    }

    function userFromEnrollment(item) {
        const u = (item && item.User) || item || {};
        const userId = u.Identifier || u.UserId || item.UserId || '';
        return {
            userId: String(userId || ''),
            firstName: u.FirstName || '',
            lastName: u.LastName || '',
            displayName: (u.DisplayName || [u.FirstName, u.LastName].filter(Boolean).join(' ') || '').trim(),
            userName: u.UserName || u.Username || '',
            orgDefinedId: u.OrgDefinedId || '',
            email: u.ExternalEmail || u.EmailAddress || u.Email || '',
            roleId: item && item.Role ? (item.Role.Id || item.Role.Identifier) : '',
            roleName: item && item.Role ? (item.Role.Name || '') : ''
        };
    }

    function isIgnoredCourse(name, code) {
        const hay = (String(name || '') + ' ' + String(code || '')).toLowerCase();
        return hay.indexOf('sandbox') !== -1 || hay.indexOf('cxld') !== -1;
    }

    async function lookupCourse(orgUnitId) {
        const id = String(orgUnitId || '').trim();
        if (!/^\d+$/.test(id)) throw new Error('Course OrgUnit ID must be a number.');
        const course = await apiFetch('/d2l/api/lp/' + USERS_API_VERSION + '/courses/' + encodeURIComponent(id));
        return {
            id: String(course.Identifier || course.OrgUnitId || id),
            name: course.Name || '',
            code: course.Code || ''
        };
    }

    async function fetchSemesterCourses(semesterId) {
        const id = String(semesterId || '').trim();
        if (!id) throw new Error('Choose a semester.');
        const results = await fetchPaged(function (bookmark) {
            let url = '/d2l/api/lp/' + USERS_API_VERSION + '/orgstructure/' + encodeURIComponent(id) + '/children/?pageSize=200';
            if (bookmark) url += '&bookmark=' + encodeURIComponent(bookmark);
            return url;
        }, 50);
        return (results || [])
            .filter((entry) => entry && entry.Type && (entry.Type.Code === 'Course Offering' || entry.Type.Id === COURSE_OFFERING_TYPE_ID))
            .map((entry) => ({
                id: String(entry.Identifier || entry.Id || ''),
                name: entry.Name || '',
                code: entry.Code || ''
            }))
            .filter((c) => c.id);
    }

    async function populateSemesterSelect(selectEl) {
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) throw new Error('Could not read organization info.');
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                '/d2l/api/lp/' + USERS_API_VERSION + '/orgstructure/' + orgInfo.Identifier + '/descendants/?ouTypeId=5'
            );
        }
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.populateSelect) {
            SemesterConfig.populateSelect(selectEl, data, {
                placeholder: 'Select a semester',
                excludeSandbox: true,
                selectedId: FALL_2026_ID
            });
            if (SemesterConfig.attachHistoricalInput) {
                SemesterConfig.attachHistoricalInput(selectEl);
            }
        } else {
            selectEl.innerHTML = '';
            (data || []).forEach((s) => {
                const opt = document.createElement('option');
                opt.value = s.Identifier;
                opt.textContent = s.Name;
                selectEl.appendChild(opt);
            });
        }
        return data;
    }

    function effectiveSemesterId(selectEl) {
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.getEffectiveSemesterId) {
            return SemesterConfig.getEffectiveSemesterId(selectEl);
        }
        return selectEl ? selectEl.value : '';
    }

    async function fetchClasslist(orgUnitId, roleId) {
        const roleQuery = roleId ? ('&roleId=' + encodeURIComponent(roleId)) : '';
        return fetchPaged(function (bookmark) {
            let url = '/d2l/api/lp/' + ENROLL_API_VERSION + '/enrollments/orgUnits/' +
                encodeURIComponent(orgUnitId) + '/users/?isActive=true&pageSize=200' + roleQuery;
            if (bookmark) url += '&bookmark=' + encodeURIComponent(bookmark);
            return url;
        });
    }

    async function fetchEnrollmentLogs(userId, options) {
        const opts = options || {};
        const logs = await fetchPaged(function (bookmark) {
            const params = [];
            if (opts.startDateTime) params.push('startDateTime=' + encodeURIComponent(opts.startDateTime));
            if (opts.endDateTime) params.push('endDateTime=' + encodeURIComponent(opts.endDateTime));
            if (opts.orgUnitId) params.push('orgUnitId=' + encodeURIComponent(opts.orgUnitId));
            if (opts.orgUnitTypeId) params.push('orgUnitTypeId=' + encodeURIComponent(opts.orgUnitTypeId));
            if (bookmark != null) params.push('bookmark=' + encodeURIComponent(bookmark));
            const qs = params.length ? '?' + params.join('&') : '';
            return '/d2l/api/lp/' + LOGS_API_VERSION + '/users/' + encodeURIComponent(userId) + '/enrollmentlogs/' + qs;
        }, 40);
        return logs;
    }

    async function fetchTrackingLogs(userId, startDateTime, endDateTime) {
        const endpoint =
            '/d2l/api/lp/' + LOGS_API_VERSION + '/users/' + encodeURIComponent(userId) + '/usertrackinglogs/' +
            '?startDateTime=' + encodeURIComponent(startDateTime) +
            '&endDateTime=' + encodeURIComponent(endDateTime);
        const response = await apiFetch(endpoint);
        return Array.isArray(response) ? response : itemsFrom(response);
    }

    async function mapPool(items, fn, options) {
        const opts = options || {};
        const limit = opts.concurrency || CONCURRENCY;
        const results = new Array(items.length);
        let next = 0;
        let done = 0;

        async function worker() {
            while (next < items.length) {
                if (opts.isCancelled && opts.isCancelled()) throw new CancelledError();
                const index = next++;
                try {
                    results[index] = await fn(items[index], index);
                } catch (error) {
                    if (error instanceof CancelledError) throw error;
                    results[index] = { __error: error, item: items[index] };
                }
                done += 1;
                if (opts.onProgress) opts.onProgress(done, items.length, items[index]);
            }
        }

        const workers = [];
        const n = Math.min(limit, Math.max(items.length, 0));
        for (let i = 0; i < n; i++) workers.push(worker());
        if (!workers.length && items.length) await worker();
        else await Promise.all(workers);
        return results;
    }

    function actionLabel(action) {
        const n = Number(action);
        if (n === 1) return 'Enrolled';
        if (n === 0) return 'Unenrolled';
        return String(action == null ? '' : action);
    }

    /**
     * Wire a semester + OrgUnit ID + checkbox course picker.
     * Expected element ids: semesterSelect, orgUnitId, loadCoursesBtn, hideIgnored,
     * coursePickerWrap, courseFilter, selectVisibleBtn, clearSelectedBtn,
     * selectedCount, coursePickerBody.
     */
    function bindCoursePicker() {
        const els = {
            semesterSelect: document.getElementById('semesterSelect'),
            orgUnitId: document.getElementById('orgUnitId'),
            loadCoursesBtn: document.getElementById('loadCoursesBtn'),
            hideIgnored: document.getElementById('hideIgnored'),
            coursePickerWrap: document.getElementById('coursePickerWrap'),
            courseFilter: document.getElementById('courseFilter'),
            selectVisibleBtn: document.getElementById('selectVisibleBtn'),
            clearSelectedBtn: document.getElementById('clearSelectedBtn'),
            selectedCount: document.getElementById('selectedCount'),
            coursePickerBody: document.getElementById('coursePickerBody')
        };
        let loaded = [];

        function visibleCourses() {
            const q = ((els.courseFilter && els.courseFilter.value) || '').trim().toLowerCase();
            const hide = !!(els.hideIgnored && els.hideIgnored.checked);
            return loaded.filter((c) => {
                if (hide && isIgnoredCourse(c.name, c.code)) return false;
                if (!q) return true;
                return (c.code + ' ' + c.name + ' ' + c.id).toLowerCase().indexOf(q) !== -1;
            });
        }

        function selectedIds() {
            const ids = [];
            if (!els.coursePickerBody) return ids;
            els.coursePickerBody.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
                ids.push(cb.value);
            });
            return ids;
        }

        function updateCount() {
            if (els.selectedCount) els.selectedCount.textContent = selectedIds().length + ' selected';
        }

        function render() {
            if (!els.coursePickerBody) return;
            const rows = visibleCourses();
            const checked = new Set(selectedIds());
            els.coursePickerBody.innerHTML = rows.map((c) => {
                const on = checked.has(c.id) ? ' checked' : '';
                return '<tr><td><input type="checkbox" value="' + escapeHtml(c.id) + '"' + on + '></td>' +
                    '<td class="mono">' + escapeHtml(c.id) + '</td>' +
                    '<td class="mono">' + escapeHtml(c.code) + '</td>' +
                    '<td>' + escapeHtml(c.name) + '</td></tr>';
            }).join('');
            els.coursePickerBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                cb.addEventListener('change', updateCount);
            });
            updateCount();
        }

        async function loadCourses() {
            const semesterId = effectiveSemesterId(els.semesterSelect);
            loaded = await fetchSemesterCourses(semesterId);
            if (els.coursePickerWrap) els.coursePickerWrap.classList.remove('hidden');
            render();
            return loaded;
        }

        async function getSelectedCourses() {
            const pasted = ((els.orgUnitId && els.orgUnitId.value) || '').trim();
            if (pasted) {
                const course = await lookupCourse(pasted);
                return [course];
            }
            const ids = selectedIds();
            if (!ids.length) {
                throw new Error('Paste a course OrgUnit ID, or load a semester and select one or more offerings.');
            }
            const byId = new Map(loaded.map((c) => [c.id, c]));
            return ids.map((id) => byId.get(id) || { id: id, name: '', code: '' });
        }

        if (els.loadCoursesBtn) {
            els.loadCoursesBtn.addEventListener('click', async () => {
                els.loadCoursesBtn.disabled = true;
                try {
                    await loadCourses();
                } catch (error) {
                    window.alert(error.message || 'Could not load courses for that semester.');
                } finally {
                    els.loadCoursesBtn.disabled = false;
                }
            });
        }
        if (els.courseFilter) els.courseFilter.addEventListener('input', render);
        if (els.hideIgnored) els.hideIgnored.addEventListener('change', render);
        if (els.selectVisibleBtn) {
            els.selectVisibleBtn.addEventListener('click', () => {
                visibleCourses().forEach((c) => {
                    const safe = (window.CSS && CSS.escape) ? CSS.escape(c.id) : String(c.id);
                    const cb = els.coursePickerBody.querySelector('input[value="' + safe + '"]');
                    if (cb) cb.checked = true;
                });
                updateCount();
            });
        }
        if (els.clearSelectedBtn) {
            els.clearSelectedBtn.addEventListener('click', () => {
                els.coursePickerBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                    cb.checked = false;
                });
                updateCount();
            });
        }

        return { loadCourses, getSelectedCourses, render };
    }

    global.JuneLogs = {
        LOGS_API_VERSION,
        STUDENT_ROLE_ID,
        COURSE_OFFERING_TYPE_ID,
        MAX_TRACKING_DAYS,
        DETROIT_TZ,
        CONCURRENCY,
        FALL_2026_ID,
        CancelledError,
        apiFetch,
        toUtcIso,
        addDays,
        trackingWindowUtc,
        hoursAgoIso,
        daysAgoIso,
        formatDetroit,
        datetimeLocalValue,
        fromDatetimeLocal,
        escapeHtml,
        downloadCsv,
        friendlyApiError,
        userFromEnrollment,
        isIgnoredCourse,
        lookupCourse,
        fetchSemesterCourses,
        populateSemesterSelect,
        effectiveSemesterId,
        fetchClasslist,
        fetchEnrollmentLogs,
        fetchTrackingLogs,
        mapPool,
        actionLabel,
        bindCoursePicker
    };
})(typeof window !== 'undefined' ? window : globalThis);
