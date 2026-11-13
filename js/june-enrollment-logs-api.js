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

    /**
     * The historical-semester note is inserted inside the semester field.
     * That makes the field taller than the Org Unit field, so flex-end
     * drops the other controls. Keep the note on its own line under the row.
     */
    function placeHistoricalNote(selectEl) {
        if (!selectEl || !selectEl.parentElement) return;
        const wrap = selectEl.parentElement.querySelector('.sc-historical-wrap');
        const row = selectEl.closest('.controls-row');
        if (!wrap || !row || !row.parentElement) return;
        if (wrap.previousElementSibling === row) return;
        row.parentElement.insertBefore(wrap, row.nextSibling);
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
                placeHistoricalNote(selectEl);
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

    const SECTION_MONTHS = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };
    const SECTION_MONTH_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** 26/FA → 26fa.csv. Same pattern for 27/WI → 27wi.csv. */
    function semesterDatesFileName(termCode) {
        const match = /^(\d{2})\/(WI|SP|FA|SU|SM|SS)$/i.exec(String(termCode || '').trim());
        if (!match) return '';
        return match[1] + match[2].toLowerCase() + '.csv';
    }

    function normalizeOfferingCode(code) {
        return String(code || '')
            .trim()
            .toUpperCase()
            .replace(/[\u2010-\u2015\u2212]/g, '-')
            .replace(/[\u2044\u2215]/g, '/')
            .replace(/\s+/g, '')
            .replace(/-COURSE$/, '');
    }

    function looseOfferingCode(code) {
        return normalizeOfferingCode(code).replace(/[^A-Z0-9]/g, '');
    }

    function shellOfferingCode(code) {
        const full = normalizeOfferingCode(code);
        const match = /^(.+)-(\d{2})\/(WI|SP|FA|SU|SM|SS)$/.exec(full);
        return match ? match[1] : full;
    }

    function termCodeFromOffering(code) {
        const full = normalizeOfferingCode(code);
        const match = /-(\d{2})\/(WI|SP|FA|SU|SM|SS)$/.exec(full);
        return match ? match[1] + '/' + match[2] : '';
    }

    function monthNumber(token) {
        const word = String(token || '').toLowerCase();
        if (word.indexOf('sept') === 0) return 9;
        return SECTION_MONTHS[word.slice(0, 3)] || 0;
    }

    function dateParts(day, month, yearRaw) {
        const d = parseInt(day, 10);
        const m = typeof month === 'number' ? month : parseInt(month, 10);
        let year = parseInt(yearRaw, 10);
        if (String(yearRaw).length <= 2) year += 2000;
        if (!m || m < 1 || m > 12 || d < 1 || d > 31 || year < 2000 || year > 2100) return null;
        return { year: year, month: m, day: d };
    }

    /** Calendar date from a section file. Accepts 1-Sep-26 and the usual export variants. */
    function parseSectionStart(raw) {
        let text = String(raw || '').trim();
        if (!text) return null;
        text = text.replace(/\u00a0/g, ' ').replace(/[\u2010-\u2015\u2212]/g, '-');
        text = text.replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, '').replace(/,/g, '').trim();

        let match = /^(\d{1,2})-([A-Za-z]{3,9})-(\d{2,4})$/.exec(text);
        if (match) return dateParts(match[1], monthNumber(match[2]), match[3]);

        match = /^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{2,4})$/.exec(text);
        if (match) return dateParts(match[2], monthNumber(match[1]), match[3]);

        match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text);
        if (match) return dateParts(match[2], parseInt(match[1], 10), match[3]);

        match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
        if (match) return dateParts(match[3], parseInt(match[2], 10), match[1]);

        return null;
    }

    function sectionDateKey(parts) {
        if (!parts) return '';
        return String(parts.year) + String(parts.month).padStart(2, '0') + String(parts.day).padStart(2, '0');
    }

    function formatSectionStart(parts) {
        if (!parts) return '';
        return SECTION_MONTH_LABELS[parts.month] + ' ' + parts.day + ', ' + parts.year;
    }

    function detroitTodayKey() {
        const parts = {};
        new Intl.DateTimeFormat('en-US', {
            timeZone: DETROIT_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date()).forEach((part) => {
            if (part.type !== 'literal') parts[part.type] = part.value;
        });
        return String(parts.year || '') + String(parts.month || '') + String(parts.day || '');
    }

    function sectionStartsAfterToday(parts, todayKey) {
        const key = sectionDateKey(parts);
        const today = todayKey || detroitTodayKey();
        if (!key || !today) return false;
        return key > today;
    }

    function csvDelimiter(src) {
        const line = String(src || '').split(/\r?\n/, 1)[0] || '';
        const commas = (line.match(/,/g) || []).length;
        const tabs = (line.match(/\t/g) || []).length;
        return tabs > commas ? '\t' : ',';
    }

    function headerKey(value) {
        return String(value || '').replace(/^\uFEFF/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    }

    function isDateHeaderRow(cells) {
        const keys = cells.map(headerKey);
        return keys.indexOf('coursesecterm') !== -1
            || keys.indexOf('secstartdate') !== -1
            || keys.indexOf('secenddate') !== -1;
    }

    function parseCsvTable(text) {
        const src = String(text || '').replace(/^\uFEFF/, '');
        const delimiter = csvDelimiter(src);
        const rows = [];
        let row = [];
        let cell = '';
        let inQuotes = false;
        for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            if (ch === '\u0000') continue;
            if (inQuotes) {
                if (ch === '"') {
                    if (src[i + 1] === '"') {
                        cell += '"';
                        i += 1;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cell += ch;
                }
            } else if (ch === '"') {
                inQuotes = true;
            } else if (ch === delimiter) {
                row.push(cell);
                cell = '';
            } else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && src[i + 1] === '\n') i += 1;
                row.push(cell);
                rows.push(row);
                row = [];
                cell = '';
            } else {
                cell += ch;
            }
        }
        if (cell.length || row.length) {
            row.push(cell);
            rows.push(row);
        }
        const headerAt = rows.findIndex((cells) => isDateHeaderRow(cells));
        if (headerAt < 0) return [];
        const headers = rows[headerAt].map((header) => String(header || '').trim());
        const out = [];
        for (let r = headerAt + 1; r < rows.length; r++) {
            if (rows[r].every((value) => String(value || '').trim() === '')) continue;
            const obj = {};
            headers.forEach((header, index) => {
                if (!header) return;
                obj[header] = rows[r][index] == null ? '' : String(rows[r][index]).trim();
            });
            out.push(obj);
        }
        return out;
    }

    function csvField(row, name) {
        if (!row) return '';
        const want = String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        const keys = Object.keys(row);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].replace(/[^a-z0-9]/gi, '').toLowerCase() === want) {
                return String(row[keys[i]] == null ? '' : row[keys[i]]).trim();
            }
        }
        return '';
    }

    function csvFieldAny(row, names) {
        for (let i = 0; i < names.length; i++) {
            const value = csvField(row, names[i]);
            if (value) return value;
        }
        return '';
    }

    function rowSectionCode(row) {
        const named = csvFieldAny(row, [
            'course_sec_term',
            'course code',
            'CourseCode',
            'Combined Depts, Course Number, Section, Term'
        ]);
        if (named) return named;
        const dept = csvFieldAny(row, ['depts', 'dept', 'department']);
        const num = csvFieldAny(row, ['course_number', 'course number', 'course no']);
        const section = csvFieldAny(row, ['section', 'sec_no']);
        const term = csvField(row, 'term');
        if (dept && num && section) {
            return term ? (dept + '-' + num + '-' + section + '-' + term) : (dept + '-' + num + '-' + section);
        }
        return '';
    }

    function rowStartRaw(row) {
        return csvFieldAny(row, ['sec_start_date', 'start_date', 'start date', 'StartDate']);
    }

    function rememberStart(index, key, start) {
        if (!key) return;
        const prev = index.get(key);
        if (!prev || sectionDateKey(start) < sectionDateKey(prev)) index.set(key, start);
    }

    /**
     * Index course_sec_term → start date.
     * Brightspace codes that end in -COURSE match the file code, and so does the code without the term.
     */
    function buildSectionStartIndex(rows) {
        const index = new Map();
        let sectionCount = 0;
        let sampleCode = '';
        let sampleDate = '';
        const headers = rows && rows[0] ? Object.keys(rows[0]) : [];
        (rows || []).forEach((row) => {
            const code = rowSectionCode(row);
            const rawDate = rowStartRaw(row);
            if (!sampleCode && code) sampleCode = code;
            if (!sampleDate && rawDate) sampleDate = rawDate;
            const start = parseSectionStart(rawDate);
            if (!code || !start) return;
            sectionCount += 1;
            const full = normalizeOfferingCode(code);
            const shell = shellOfferingCode(full);
            [full, shell, looseOfferingCode(full), looseOfferingCode(shell)].forEach((key) => {
                rememberStart(index, key, start);
            });
        });
        return {
            index: index,
            sectionCount: sectionCount,
            rowCount: (rows || []).length,
            headers: headers,
            sampleCode: sampleCode,
            sampleDate: sampleDate
        };
    }

    function lookupSectionStart(index, code) {
        if (!index) return null;
        const full = normalizeOfferingCode(code);
        if (!full) return null;
        const shell = shellOfferingCode(full);
        const keys = [full, shell, looseOfferingCode(full), looseOfferingCode(shell)];
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] && index.has(keys[i])) return index.get(keys[i]);
        }
        return null;
    }

    function lookupCourseStart(index, course) {
        const direct = lookupSectionStart(index, course && course.code);
        if (direct) return direct;
        const name = String((course && course.name) || '').toUpperCase();
        const embedded = name.match(/[A-Z0-9]+(?:-[A-Z0-9]+)+-\d{2}\/(?:WI|SP|FA|SU|SM|SS)/);
        if (embedded) return lookupSectionStart(index, embedded[0]);
        return null;
    }

    /**
     * Wire a semester + OrgUnit ID + checkbox course picker.
     * Expected element ids: semesterSelect, orgUnitId, loadCoursesBtn, hideIgnored,
     * coursePickerWrap, courseFilter, selectVisibleBtn, clearSelectedBtn,
     * selectedCount, coursePickerBody.
     * options.annotateCourses(courses, semesterId) may add fields before the picker renders.
     * options.courseHidden(course) hides a row from the picker.
     * A Starts column is rendered when the table has #pickerStartCol.
     */
    function bindCoursePicker(options) {
        const opts = options || {};
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
                if (opts.courseHidden && opts.courseHidden(c)) return false;
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
            const showStart = !!document.getElementById('pickerStartCol');
            els.coursePickerBody.innerHTML = rows.map((c) => {
                const on = checked.has(c.id) ? ' checked' : '';
                const startCell = showStart
                    ? '<td>' + escapeHtml(c.startLabel || '') + '</td>'
                    : '';
                return '<tr><td><input type="checkbox" value="' + escapeHtml(c.id) + '"' + on + '></td>' +
                    '<td class="mono">' + escapeHtml(c.id) + '</td>' +
                    '<td class="mono">' + escapeHtml(c.code) + '</td>' +
                    '<td>' + escapeHtml(c.name) + '</td>' +
                    startCell + '</tr>';
            }).join('');
            els.coursePickerBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                cb.addEventListener('change', updateCount);
            });
            updateCount();
        }

        async function loadCourses() {
            const semesterId = effectiveSemesterId(els.semesterSelect);
            loaded = await fetchSemesterCourses(semesterId);
            if (opts.annotateCourses) {
                const annotated = await opts.annotateCourses(loaded, semesterId);
                if (Array.isArray(annotated)) loaded = annotated;
            }
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
        placeHistoricalNote,
        effectiveSemesterId,
        fetchClasslist,
        fetchEnrollmentLogs,
        fetchTrackingLogs,
        mapPool,
        actionLabel,
        semesterDatesFileName,
        normalizeOfferingCode,
        termCodeFromOffering,
        parseSectionStart,
        sectionDateKey,
        formatSectionStart,
        detroitTodayKey,
        sectionStartsAfterToday,
        parseCsvTable,
        buildSectionStartIndex,
        lookupSectionStart,
        lookupCourseStart,
        bindCoursePicker
    };
})(typeof window !== 'undefined' ? window : globalThis);
