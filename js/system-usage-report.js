/**
 * System Usage Analytics
 * Student last-access for one semester, from course classlists.
 * Brightspace classlist users use Identifier, not UserId.
 */

const LP_VER = '1.52';
let LE_VER = '1.86';
const LE_CANDIDATES = ['1.86', '1.85', '1.82', '1.78', '1.71'];
const STUDENT_ROLE_IDS = new Set(['101', '107', '112', '3', '5']);
const SCAN_CONCURRENCY = 4;

const EASTERN_DATE = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Detroit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

let overviewRows = [];
let courseRows = [];

document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-button');
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            tabs.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            const id = btn.getAttribute('data-tab');
            const panel = document.getElementById(id);
            if (panel) panel.classList.add('active');
        });
    });

    loadSemesters();
});

async function resolveLeVersionFor(ouId) {
    for (const v of LE_CANDIDATES) {
        try {
            await D2LApi._fetch(`/d2l/api/le/${v}/${ouId}/classlist/paged/?pageSize=1`);
            LE_VER = v;
            return v;
        } catch {
            // try next
        }
    }
    throw new Error('No supported LE version found for classlist endpoints.');
}

function setStatus(elId, html) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = html || '';
    el.hidden = !html;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseAccessDate(value) {
    if (value == null || value === '' || typeof value === 'object') return null;
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return null;
    if (dt.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
    return dt;
}

function fmtDate(value) {
    const dt = value instanceof Date ? value : parseAccessDate(value);
    if (!dt) return '';
    return EASTERN_DATE.format(dt);
}

function isStudentEnrollment(roleId, roleName) {
    const name = String(roleName || '');
    if (/instructor|designer|admin|faculty|teacher|grader|auditor/i.test(name) && !/student/i.test(name)) {
        return false;
    }
    if (/\bta\b|teaching assistant/i.test(name)) return false;
    if (/student|learner|incomplete/i.test(name)) return true;
    const id = roleId == null || roleId === '' ? '' : String(roleId);
    if (STUDENT_ROLE_IDS.has(id)) return true;
    if (!id) return true;
    return false;
}

function summarizeClasslist(cls, selfId) {
    const students = new Set();
    const accessed = new Set();
    let lastActivity = null;
    const visits = [];
    const selfKey = selfId ? String(selfId) : '';

    for (const u of cls || []) {
        const uid = String(
            u?.Identifier || u?.UserId || u?.Id ||
            u?.User?.Identifier || u?.User?.UserId || u?.User?.Id ||
            ''
        );
        if (!uid || uid === selfKey) continue;
        const roleId = u?.RoleId != null ? u.RoleId : u?.Role?.Id;
        const roleName = u?.ClasslistRoleDisplayName || u?.Role?.Name || '';
        if (!isStudentEnrollment(roleId, roleName)) continue;
        students.add(uid);
        const dt = parseAccessDate(u?.LastAccessed || u?.LastAccessedDate || u?.LastAccessDate || u?.LastAccess);
        if (!dt) continue;
        accessed.add(uid);
        visits.push({ uid, dt });
        if (!lastActivity || dt > lastActivity) lastActivity = dt;
    }

    return { students, accessed, lastActivity, visits };
}

async function currentUserId() {
    try {
        const me = await D2LApi._fetch('/d2l/api/lp/1.45/users/whoami');
        return String(me?.Identifier || me?.UserId || '');
    } catch (e) {
        return '';
    }
}

async function fetchPagedItems(firstUrl) {
    const acc = [];
    const seen = new Set();
    let url = firstUrl;

    for (let i = 0; i < 100 && url; i++) {
        if (seen.has(url)) break;
        seen.add(url);
        const page = await D2LApi._fetch(url);
        acc.push(...classlistItems(page));
        if (Array.isArray(page)) break;
        const paging = page?.PagingInfo || {};
        const more = !!(paging.HasMoreItems || paging.hasMoreItems);
        const bookmark = paging.Bookmark || paging.bookmark || '';
        const next = page?.Next || paging.Next || '';
        if (next && !seen.has(next)) {
            url = next;
            continue;
        }
        if (more && bookmark) {
            const join = firstUrl.includes('?') ? '&' : '?';
            url = `${firstUrl}${join}bookmark=${encodeURIComponent(bookmark)}`;
            continue;
        }
        break;
    }

    return acc;
}

async function loadSemesters() {
    try {
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${LP_VER}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            data = await fetchPagedItems(
                `/d2l/api/lp/${LP_VER}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
        }
        if (!Array.isArray(data)) data = [];

        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            data = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data));
        } else {
            data.sort((a, b) => String(b.Name).localeCompare(String(a.Name)));
        }
        fillSemesterSelects(data);
    } catch (error) {
        console.error('Error loading semesters:', error);
        fillSemesterSelects([]);
    }
}

function fillSemesterSelects(data) {
    let list = Array.isArray(data) ? data : [];
    if (!list.length && typeof SemesterConfig !== 'undefined' && SemesterConfig.getAll) {
        list = SemesterConfig.sortByRecency(SemesterConfig.getAll());
    }

    const markup = list.length
        ? list.map(s => `<option value="${s.Identifier}">${escapeHtml(s.Name)} (${s.Identifier})</option>`).join('')
        : '<option value="">Could not load semesters</option>';
    const current = (typeof SemesterConfig !== 'undefined' && SemesterConfig.getCurrent)
        ? SemesterConfig.getCurrent()
        : null;

    for (const id of ['usageSemester', 'usageSemester2']) {
        const select = document.getElementById(id);
        if (!select) continue;
        select.innerHTML = markup;
        if (current && list.some(s => String(s.Identifier) === String(current.Identifier))) {
            select.value = String(current.Identifier);
        }
    }
}

async function getCoursesForSemester(semesterId) {
    const children = await fetchPagedItems(
        `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/children/?pageSize=200`
    );

    return children.filter(c => {
        const code = c?.Code || '';
        const typeId = c?.Type?.Id;
        const typeCode = c?.Type?.Code || '';
        const isCourse = typeId === 3 || /course offering/i.test(typeCode);
        return isCourse && !/^(CXLD|MERGED)\s*-/i.test(code);
    });
}

function classlistItems(page) {
    if (Array.isArray(page)) return page;
    if (Array.isArray(page?.Items)) return page.Items;
    if (Array.isArray(page?.Objects)) return page.Objects;
    return [];
}

async function getClasslist(orgUnitId) {
    try {
        const items = await fetchPagedItems(
            `/d2l/api/le/${LE_VER}/${orgUnitId}/classlist/paged/?pageSize=100`
        );
        if (items.length) return items;
    } catch (e) {
        console.warn('Paged classlist failed', orgUnitId, e);
    }

    try {
        const data = await D2LApi._fetch(`/d2l/api/le/${LE_VER}/${orgUnitId}/classlist/`);
        return classlistItems(data);
    } catch (e) {
        console.warn('Classlist failed', orgUnitId, e);
        return [];
    }
}

async function mapPool(items, limit, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}

async function scanSemester(semesterId, modalId, statusId) {
    setStatus(statusId, '');
    LoadingUtils.showLoadingModal('Initializing report...', modalId, () => {});
    LoadingUtils.updateLoadingModal(5, 'Loading courses...', modalId);

    const courses = await getCoursesForSemester(semesterId);
    if (!courses.length) {
        LoadingUtils.hideLoadingModal(modalId);
        return { courses: [], results: [], empty: true };
    }

    try {
        await resolveLeVersionFor(courses[0].Identifier);
    } catch (e) {
        LoadingUtils.hideLoadingModal(modalId);
        throw e;
    }

    const selfId = await currentUserId();
    const results = new Array(courses.length);
    let processed = 0;
    let failed = 0;

    await mapPool(courses, SCAN_CONCURRENCY, async (course, index) => {
        if (LoadingUtils.isCancelled(modalId)) return;
        let summary = summarizeClasslist([], selfId);
        try {
            const cls = await getClasslist(course.Identifier);
            summary = summarizeClasslist(cls, selfId);
        } catch (e) {
            failed++;
            console.warn('Classlist error', course.Identifier, e);
        }
        results[index] = { course, summary };
        processed++;
        if (LoadingUtils.isCancelled(modalId)) return;
        const pct = 10 + Math.round((processed / courses.length) * 85);
        const label = course.Code || course.Name || course.Identifier;
        LoadingUtils.updateLoadingModal(pct, `Reading classlists ${processed}/${courses.length}: ${label}`, modalId);
        setStatus(statusId, `Reading classlists (${processed}/${courses.length}).`);
    });

    if (LoadingUtils.isCancelled(modalId)) {
        LoadingUtils.hideLoadingModal(modalId);
        setStatus(statusId, 'Report cancelled.');
        return null;
    }

    return { courses, results: results.filter(Boolean), failed, selfId };
}

function renderDataTable(selector, options) {
    if (!(window.jQuery && $.fn.DataTable)) return;
    if ($.fn.DataTable.isDataTable(selector)) {
        $(selector).DataTable().destroy();
    }
    $(selector).DataTable(Object.assign({
        pageLength: 25,
        lengthMenu: [[10, 25, 50, 100, 200, -1], [10, 25, 50, 100, 200, 'All']],
        dom: '<"top"lf>rt<"bottom"ip><"clear">',
        language: {
            search: 'Search:',
            lengthMenu: 'Show _MENU_ entries',
            info: 'Showing _START_ to _END_ of _TOTAL_ entries',
            infoEmpty: 'No entries to show',
            infoFiltered: '(filtered from _MAX_ total entries)',
            paginate: {
                first: 'First',
                last: 'Last',
                next: 'Next',
                previous: 'Previous'
            }
        },
        responsive: true,
        scrollX: true
    }, options));
}

function finishModal(modalId) {
    LoadingUtils.updateLoadingModal(100, 'Complete!', modalId);
    setTimeout(() => LoadingUtils.hideLoadingModal(modalId), 600);
}

function daysSince(date) {
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

async function runOverview(semesterId) {
    const scan = await scanSemester(semesterId, 'loadingModal', 'usageStatus');
    if (!scan) return;
    if (scan.empty) {
        setStatus('usageStatus', 'No course offerings found for this semester.');
        overviewRows = [];
        renderDataTable('#usageTable', { order: [[0, 'desc']] });
        return;
    }

    const studentLast = new Map();
    const dailyCourses = new Map();
    let neverAccessed = 0;
    let coursesQuiet = 0;

    for (const row of scan.results) {
        const { summary } = row;
        if (!summary.lastActivity) coursesQuiet++;
        else {
            const day = fmtDate(summary.lastActivity);
            dailyCourses.set(day, (dailyCourses.get(day) || 0) + 1);
        }
        const latestByStudent = new Map();
        for (const visit of summary.visits) {
            const prev = latestByStudent.get(visit.uid);
            if (!prev || visit.dt > prev) latestByStudent.set(visit.uid, visit.dt);
        }
        for (const uid of summary.students) {
            const dt = latestByStudent.get(uid) || null;
            if (!studentLast.has(uid)) studentLast.set(uid, dt);
            else if (dt && (!studentLast.get(uid) || dt > studentLast.get(uid))) studentLast.set(uid, dt);
        }
    }

    const dailyUsers = new Map();
    let within7 = 0;
    let olderThan30 = 0;
    for (const [, last] of studentLast) {
        if (!last) {
            neverAccessed++;
            continue;
        }
        const age = daysSince(last);
        if (age <= 7) within7++;
        else if (age > 30) olderThan30++;
        const day = fmtDate(last);
        dailyUsers.set(day, (dailyUsers.get(day) || 0) + 1);
    }

    const dates = Array.from(new Set([...dailyUsers.keys(), ...dailyCourses.keys()])).sort().reverse();
    overviewRows = dates.map(day => [day, dailyUsers.get(day) || 0, dailyCourses.get(day) || 0]);

    const tbody = document.querySelector('#usageTable tbody');
    if (window.jQuery && $.fn.DataTable && $.fn.DataTable.isDataTable('#usageTable')) {
        $('#usageTable').DataTable().destroy();
    }
    tbody.innerHTML = overviewRows.length
        ? overviewRows.map(r => '<tr>' + r.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>').join('')
        : '<tr><td colspan="3">No student access dates were returned.</td></tr>';
    if (overviewRows.length) renderDataTable('#usageTable', { order: [[0, 'desc']] });

    const failedNote = scan.failed ? ` ${scan.failed} course classlist${scan.failed === 1 ? '' : 's'} could not be read.` : '';
    setStatus(
        'usageStatus',
        `Scanned <b>${scan.results.length}</b> courses and <b>${studentLast.size}</b> students. ` +
        `Opened a course in the last 7 days: <b>${within7}</b>. ` +
        `Last access more than 30 days ago: <b>${olderThan30}</b>. ` +
        `No course access on record: <b>${neverAccessed}</b>. ` +
        `Courses with no student access: <b>${coursesQuiet}</b>.${failedNote}`
    );
    finishModal('loadingModal');
}

async function runByCourse(semesterId) {
    const scan = await scanSemester(semesterId, 'loadingModal2', 'usageStatus2');
    if (!scan) return;

    const tbody = document.querySelector('#usageCourseTable tbody');
    if (window.jQuery && $.fn.DataTable && $.fn.DataTable.isDataTable('#usageCourseTable')) {
        $('#usageCourseTable').DataTable().destroy();
    }

    if (scan.empty) {
        courseRows = [];
        tbody.innerHTML = '<tr><td colspan="6">No course offerings found.</td></tr>';
        setStatus('usageStatus2', 'No course offerings found for this semester.');
        return;
    }

    courseRows = scan.results.map(({ course, summary }) => [
        course.Identifier,
        course.Code || course.Name || '',
        course.Name || '',
        summary.students.size,
        summary.accessed.size,
        summary.lastActivity ? fmtDate(summary.lastActivity) : 'None'
    ]);

    tbody.innerHTML = courseRows.map(r => '<tr>' + r.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>').join('');
    renderDataTable('#usageCourseTable', { order: [[1, 'asc']] });

    const opened = courseRows.reduce((sum, row) => sum + Number(row[4] || 0), 0);
    const quiet = courseRows.filter(row => row[5] === 'None').length;
    const failedNote = scan.failed ? ` ${scan.failed} course classlist${scan.failed === 1 ? '' : 's'} could not be read.` : '';
    setStatus(
        'usageStatus2',
        `<b>${courseRows.length}</b> courses. Students who have opened their course (counted once per course): <b>${opened}</b>. ` +
        `Courses with no student access: <b>${quiet}</b>.${failedNote}`
    );
    finishModal('loadingModal2');
}

function downloadCsv(filename, headers, rows) {
    if (!rows.length) {
        alert('Run the report before downloading.');
        return;
    }
    const lines = [headers, ...rows].map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

document.getElementById('usageRun').addEventListener('click', async () => {
    const semesterId = document.getElementById('usageSemester').value;
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }
    try {
        await runOverview(semesterId);
    } catch (e) {
        console.error(e);
        LoadingUtils.hideLoadingModal('loadingModal');
        setStatus('usageStatus', 'Error building the overview: ' + escapeHtml(e.message));
    }
});

document.getElementById('usageRun2').addEventListener('click', async () => {
    const semesterId = document.getElementById('usageSemester2').value;
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }
    try {
        await runByCourse(semesterId);
    } catch (e) {
        console.error(e);
        LoadingUtils.hideLoadingModal('loadingModal2');
        setStatus('usageStatus2', 'Error building the course list: ' + escapeHtml(e.message));
    }
});

document.getElementById('usageDownload').addEventListener('click', () => {
    downloadCsv(
        'system-usage-analytics.csv',
        ['Date', 'Students last seen', 'Courses last active'],
        overviewRows
    );
});

document.getElementById('usageDownload2').addEventListener('click', () => {
    downloadCsv(
        'system-usage-by-course.csv',
        ['OrgUnitId', 'Course Code', 'Course Name', 'Students', 'Opened the course', 'Last student access'],
        courseRows
    );
});
