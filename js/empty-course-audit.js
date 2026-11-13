/**
 * Empty Course Audit Tool
 * Audits courses for empty content and collects instructor information
 */

// ====================== Config & Globals ======================
const LP_VERSION = "1.49";
const LE_VERSION = "1.78";
const INSTRUCTOR_ROLE_ID = 102;

let allRows = [];
let viewPage = 1;
let pageSizeSel = null;
let csvIndex = {};

let statusEl, logEl, resultTbody;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    statusEl = document.getElementById('status');
    logEl = document.getElementById('log');
    resultTbody = document.querySelector('#resultTable tbody');
    pageSizeSel = document.getElementById('pageSize');
    
    // Initialize loading container - find the card with status element
    const statusCard = statusEl ? statusEl.closest('.card') : document.querySelector('.card');
    if (statusCard) {
        const loadingContainer = LoadingUtils.createLoadingBar('loadingContainer');
        statusCard.insertBefore(loadingContainer, statusEl);
    }
    
    // Check if D2LApi is available
    if (typeof D2LApi === 'undefined') {
        setStatus('Error: D2LApi not loaded. Please refresh the page.');
        logMsg('ERROR: D2LApi is not defined. Make sure d2l-api.js is loaded before this script.');
        return;
    }
    
    attachEvents();
    fetchSemesters().catch(err => {
        setStatus('Failed to load semesters. See log.');
        logMsg('ERROR fetchSemesters: ' + (err.message || err));
        LoadingUtils.hideLoadingBar('loadingContainer');
    });
});

// ====================== Utilities ======================
function logMsg(msg) {
    if (!logEl) return;
    logEl.textContent += msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[EmptyCourseAudit] ' + msg);
}

function setStatus(t) {
    if (!statusEl) return;
    statusEl.textContent = 'Status: ' + t;
    // Update loading status if container exists
    const loadingStatus = document.querySelector('#loadingContainer .loading-status');
    if (loadingStatus) {
        loadingStatus.textContent = t;
    }
}

function caseInsensitiveIncludes(h, n) {
    if (!h) return false;
    return String(h).toLowerCase().indexOf(String(n).toLowerCase()) >= 0;
}

function isIgnoredCourse(name, code) {
    const bad = ['merged', 'cxld', 'sandbox'];
    const n = String(name || '');
    const c = String(code || '');
    for (let i = 0; i < bad.length; i++) {
        const b = bad[i];
        if (caseInsensitiveIncludes(n, b) || caseInsensitiveIncludes(c, b)) {
            return true;
        }
    }
    return false;
}

function stripTimeParts(s) {
    if (!s) return '';
    return String(s)
        .replace(/\s+12:00:00\s*AM$/i, '')
        .replace(/\s+00:00:00$/, '')
        .replace(/\s+0:00$/, '')
        .trim();
}

function toISODate(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = ('0' + (dt.getMonth() + 1)).slice(-2);
    const da = ('0' + dt.getDate()).slice(-2);
    return y + '-' + m + '-' + da;
}

function deriveSecNameFromCode(code) {
    if (!code) return '';
    const parts = String(code).split('-');
    if (parts.length >= 3) {
        return parts[0] + '-' + parts[1] + '-' + parts[2];
    }
    return code;
}

function normalizeHeaderKey(s) {
    return String(s || '').replace(/^\uFEFF/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getCell(row, candidates) {
    if (!row || typeof row !== 'object') return '';
    const keys = Object.keys(row);
    const normMap = new Map();
    for (const k of keys) {
        const nk = normalizeHeaderKey(k);
        if (nk && !normMap.has(nk)) normMap.set(nk, k);
    }
    function valueOf(orig) {
        if (orig === undefined) return '';
        const v = row[orig];
        if (v === undefined || v === null) return '';
        return String(v).trim();
    }
    for (const c of candidates) {
        const exact = valueOf(c);
        if (exact) return exact;
        const nk = normalizeHeaderKey(c);
        const named = valueOf(normMap.get(nk));
        if (named) return named;
        if (nk.length >= 6) {
            for (const [hn, orig] of normMap) {
                if (hn !== nk && hn.endsWith(nk)) {
                    const suffixed = valueOf(orig);
                    if (suffixed) return suffixed;
                }
            }
        }
    }
    return '';
}

function toShellCourseCode(code) {
    const full = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = /^(.+)-(\d{2})\/(WI|SP|FA|SU|SM|SS)$/.exec(full);
    return m ? m[1] : full;
}

function getCombinedCourseCode(row) {
    const named = getCell(row, [
        'Combined Depts, Course Number, Section, Term',
        'COURSE_CODE',
        'Course Code',
        'CourseCode',
        'course_code',
        'SEC_NAME',
        'Sec_Name',
        'Section Name'
    ]);
    if (named) return named;
    if (row && typeof row === 'object') {
        for (const k of Object.keys(row)) {
            if (/combined/i.test(k)) {
                const v = String(row[k] || '').trim();
                if (v) return v;
            }
        }
    }
    const dept = getCell(row, ['SEC_DEPTS', 'Sec_Depts', 'DEPT', 'Department', 'Depts']);
    const num = getCell(row, ['SEC_COURSE_NO', 'Sec_Course_No', 'COURSE_NO', 'CourseNo', 'Course Number']);
    const sec = getCell(row, ['SEC_NO', 'Sec_No', 'SECTION', 'Section']);
    if (dept && num && sec) return `${dept}-${num}-${sec}`;
    return '';
}

function normId(x) {
    return (x === null || typeof x === 'undefined') ? '' : String(x);
}

function isCurrentYearSemester(semester) {
    const currentYear2Digit = String(new Date().getFullYear()).slice(-2);
    const allowedTerms = ['WI', 'SP', 'FA'];
    const semesterText = `${semester?.Name || ''} ${semester?.Code || ''}`.toUpperCase();

    return allowedTerms.some(term => {
        const pattern = new RegExp(`\\b${currentYear2Digit}\\s*[\\/-]\\s*${term}\\b`);
        return pattern.test(semesterText);
    });
}

// ====================== CSV Handling ======================
function buildCsvIndex(rows) {
    csvIndex = {};
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r] || {};
        const combined = getCombinedCourseCode(row);
        if (!combined) continue;
        const start = stripTimeParts(getCell(row, ['SEC_START_DATE', 'Sec_Start_Date', 'Start Date', 'Start', 'StartDate']));
        const end = stripTimeParts(getCell(row, ['SEC_END_DATE', 'Sec_End_Date', 'End Date', 'End', 'EndDate']));
        const instructor = getCell(row, [
            'faculty_name', 'FACULTY_NAME', 'INSTRUCTOR', 'Instructor',
            'FACULTY', 'FAC_NAME', 'INSTRUCTOR_NAME', 'Teacher', 'Primary Instructor'
        ]);
        const entry = { start: start, end: end, instructor: instructor };
        const keys = [
            combined,
            String(combined).trim().toUpperCase(),
            toShellCourseCode(combined),
            deriveSecNameFromCode(combined)
        ];
        for (let i = 0; i < keys.length; i++) {
            const key = String(keys[i] || '').trim();
            if (key) csvIndex[key] = entry;
        }
    }
    logMsg('CSV index built: ' + Object.keys(csvIndex).length + ' section keys');
}

function lookupCsvEntry(d2lCode) {
    const code = String(d2lCode || '').trim();
    if (!code) return {};
    return csvIndex[code]
        || csvIndex[code.toUpperCase()]
        || csvIndex[toShellCourseCode(code)]
        || csvIndex[deriveSecNameFromCode(code)]
        || {};
}

// ====================== API: Semesters & Courses ======================
async function fetchSemesters() {
    setStatus('Loading semesters…');
    LoadingUtils.showLoadingBar('loadingContainer');
    LoadingUtils.updateLoadingBar(10, 'Loading semesters…', 'loadingContainer');
    
    try {
        logMsg('Fetching semesters (ouTypeId=5)...');
        
        // Get root org unit ID
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) {
            throw new Error('Could not get organization info');
        }
        
        const rootOrgUnitId = orgInfo.Identifier;
        
        // Fetch semesters
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${LP_VERSION}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/${LP_VERSION}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                data = response.Objects;
            } else if (Array.isArray(response)) {
                data = response;
            }
        }
        
        LoadingUtils.updateLoadingBar(50, 'Processing semesters...', 'loadingContainer');
        
        const select = document.getElementById('semesterSelect');
        select.innerHTML = '';
        
        const filteredSemesters = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
            ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data || []))
            : (data || []).filter(isCurrentYearSemester);

        if (!filteredSemesters.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No semesters available';
            select.appendChild(opt);
            setStatus('No semesters available.');
            LoadingUtils.hideLoadingBar('loadingContainer');
            return;
        }
        
        if (typeof SemesterConfig === 'undefined') {
            filteredSemesters.sort((a, b) => String(b.Name || '').localeCompare(String(a.Name || '')));
        }
        
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a semester…';
        select.appendChild(placeholder);
        
        for (let i = 0; i < filteredSemesters.length; i++) {
            const ou = filteredSemesters[i];
            const o = document.createElement('option');
            o.value = ou.Identifier || ou.Id || ou.OrgUnitId || '';
            o.textContent = (ou.Name || ('Semester ' + o.value));
            select.appendChild(o);
        }
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        setStatus('Semesters loaded.');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);
    } catch (error) {
        console.error('Error fetching semesters:', error);
        LoadingUtils.hideLoadingBar('loadingContainer');
        throw error;
    }
}

async function fetchSemesterCourses(semesterId) {
    const url = `/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/children/`;
    logMsg('Fetching semester children for ' + semesterId + ' …');
    
    let items = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        items = await D2LApi.fetchPaginatedData(url);
    } else {
        const response = await D2LApi._fetch(url);
        if (response.Objects && Array.isArray(response.Objects)) {
            items = response.Objects;
        } else if (Array.isArray(response)) {
            items = response;
        }
    }
    
    const courses = [];
    if (items && items.length) {
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const typ = it.Type || {};
            const typeId = (typeof typ.Id !== 'undefined' ? typ.Id : null);
            const typeCode = typ.Code || '';
            if (typeId === 3 || typeCode === 'Course Offering') {
                courses.push(it);
            }
        }
    }
    logMsg('Found ' + courses.length + ' course offerings in semester ' + semesterId);
    return courses;
}

// ====================== API: Content, News, Grades, Classlist ======================
const DEFAULT_GRADE_NAMES = new Set([
    'final calculated grade',
    'final adjusted grade'
]);
const DEFAULT_GRADE_TYPES = new Set([
    7, 8,
    '7', '8',
    'finalcalculated',
    'finaladjusted',
    'final calculated',
    'final adjusted'
]);

function isIgnoredContentModule(node) {
    const title = String(node && (node.Title || node.Name) || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return title === 'student success modules' || title === 'student success module';
}

function countContentTopics(node) {
    if (!node || isIgnoredContentModule(node)) return 0;
    let n = Array.isArray(node.Topics) ? node.Topics.length : 0;
    const modules = node.Modules || node.ChildModules || node.Structure || [];
    for (let i = 0; i < modules.length; i++) {
        n += countContentTopics(modules[i]);
    }
    return n;
}

async function hasCourseContent(orgUnitId) {
    try {
        const toc = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/content/toc`);
        const modules = (toc && Array.isArray(toc.Modules))
            ? toc.Modules
            : (Array.isArray(toc) ? toc : []);
        let topicCount = 0;
        for (let i = 0; i < modules.length; i++) {
            if (isIgnoredContentModule(modules[i])) continue;
            topicCount += countContentTopics(modules[i]);
        }
        return topicCount > 0;
    } catch (e) {
        logMsg('WARN content/toc failed for OU ' + orgUnitId + ': ' + e.message);
    }
    try {
        const res = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/content/root/`);
        if (!res || (typeof res === 'object' && !Array.isArray(res) && Object.keys(res).length === 0)) {
            return false;
        }
        const items = Array.isArray(res) ? res : (res.Modules || []);
        if (!items.length) return false;
        return items.some(m => !isIgnoredContentModule(m) && countContentTopics(m) > 0);
    } catch (e) {
        logMsg('WARN content/root failed for OU ' + orgUnitId + ': ' + e.message);
        return false;
    }
}

async function getNewsCount(orgUnitId) {
    try {
        const arr = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/news/`);
        return Array.isArray(arr) ? arr.length : 0;
    } catch (e) {
        return 0;
    }
}

function isDefaultGradeItem(grade) {
    if (!grade) return true;
    const name = String(grade.Name || grade.ShortName || '').trim().toLowerCase();
    if (DEFAULT_GRADE_NAMES.has(name)) return true;
    const typeRaw = grade.GradeType ?? grade.GradeObjectType ?? grade.Type;
    const typeNorm = String(typeRaw == null ? '' : typeRaw).trim().toLowerCase().replace(/\s+/g, '');
    return DEFAULT_GRADE_TYPES.has(typeRaw) || DEFAULT_GRADE_TYPES.has(typeNorm);
}

async function hasCustomGrades(orgUnitId) {
    try {
        const res = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/grades/`);
        const items = Array.isArray(res) ? res : [];
        return items.some(g => !isDefaultGradeItem(g));
    } catch (e) {
        logMsg('WARN grades failed for OU ' + orgUnitId + ': ' + e.message);
        return false;
    }
}

function extractPagedItems(data) {
    if (!data) return [];
    if (Array.isArray(data.Items)) return data.Items;
    if (Array.isArray(data.Objects)) return data.Objects;
    if (data.Objects && Array.isArray(data.Objects.Items)) return data.Objects.Items;
    if (Array.isArray(data.Result)) return data.Result;
    if (Array.isArray(data.Results)) return data.Results;
    for (const k in data) {
        if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
        const v = data[k];
        if (v && Array.isArray(v)) return v;
        if (v && typeof v === 'object' && Array.isArray(v.Items)) return v.Items;
    }
    return [];
}

function extractNextLink(data) {
    if (!data) return null;
    if (data.Next) return data.Next;
    if (data.PagingInfo && data.PagingInfo.Next) return data.PagingInfo.Next;
    if (data.Objects && data.Objects.Next) return data.Objects.Next;
    return null;
}

function unpackClasslistRow(it) {
    const userId = it.Identifier || it.UserId || it.Id || (it.User && (it.User.Identifier || it.User.UserId || it.User.Id)) || null;
    const first = it.FirstName || it.GivenName || (it.User && (it.User.FirstName || it.User.GivenName)) || '';
    const last = it.LastName || it.FamilyName || (it.User && (it.User.LastName || it.User.FamilyName)) || '';
    const display = it.DisplayName || (it.User && it.User.DisplayName) || '';
    const username = it.Username || it.UniqueName || (it.User && (it.User.Username || it.User.UniqueName)) || '';
    const email = it.Email || it.UserEmail || it.ExternalEmail || (it.User && (it.User.Email || it.User.UserEmail || it.User.ExternalEmail)) || '';
    let roleIdRaw = (typeof it.RoleId !== 'undefined' ? it.RoleId : (it.OrgRoleId || undefined));
    if (typeof roleIdRaw === 'undefined' && it.Role && typeof it.Role.Id !== 'undefined') {
        roleIdRaw = it.Role.Id;
    }
    const roleNameRaw = it.ClasslistRoleDisplayName || it.OrgRoleName || (it.Role && it.Role.Name) || '';
    const lastRaw = it.LastAccessed || it.LastAccessedDate || it.LastAccessDate || it.LastAccess || null;
    return { userId, first, last, display, username, email, roleId: roleIdRaw, roleName: roleNameRaw, lastAccessRaw: lastRaw };
}

async function getInstructorInfo(orgUnitId) {
    const names = [];
    const emails = [];
    const seenN = {};
    const seenE = {};
    let mostRecent = null;
    let totalInstructorRows = 0;
    let url = `/d2l/api/le/${LE_VERSION}/${orgUnitId}/classlist/paged/?pageSize=100`;
    
    while (url) {
        let data;
        try {
            data = await D2LApi._fetch(url);
        } catch (e) {
            logMsg('WARN classlist/paged failed for OU ' + orgUnitId + ': ' + e.message);
            break;
        }

        const items = extractPagedItems(data);
        if (!items.length) {
            url = extractNextLink(data);
            if (!url) break;
            continue;
        }
        
        for (let i = 0; i < items.length; i++) {
            const r = unpackClasslistRow(items[i]);
            const isInstructor = (normId(r.roleId) === normId(INSTRUCTOR_ROLE_ID)) || (/instructor/i.test(String(r.roleName || '')));
            if (!isInstructor) continue;
            const fullName = (r.first && r.last) ? (r.first + ' ' + r.last) : (r.display || (r.username || String(r.userId || '')));
            const email = r.email || (r.username ? (r.username + '@example.edu') : '');
            if (r.lastAccessRaw) {
                const d = new Date(r.lastAccessRaw);
                if (!isNaN(d.getTime()) && (mostRecent === null || d > mostRecent)) {
                    mostRecent = d;
                }
            }
            if (fullName && !seenN[fullName]) {
                names.push(fullName);
                seenN[fullName] = true;
            }
            if (email && !seenE[email]) {
                emails.push(email);
                seenE[email] = true;
            }
            totalInstructorRows++;
        }
        url = extractNextLink(data);
    }
    return {
        names: names.join('; '),
        emails: emails.join('; '),
        lastAccessISO: (mostRecent ? toISODate(mostRecent) : '')
    };
}

// ====================== UI Helpers ======================
function clearResults() {
    allRows = [];
    if (!resultTbody) resultTbody = document.querySelector('#resultTable tbody');
    if (resultTbody) resultTbody.innerHTML = '';
    updatePager();
    LoadingUtils.hideLoadingBar('loadingContainer');
    const tableCard = document.getElementById('tableCard');
    if (tableCard) tableCard.style.display = 'none';
    
    // Disable download button when no results
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) downloadBtn.disabled = true;
}

function td(v) {
    const d = document.createElement('td');
    d.textContent = v == null ? '' : String(v);
    return d;
}

function tdLink(text, href) {
    const d = document.createElement('td');
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text || '';
    d.appendChild(a);
    return d;
}

function tdPill(isEmpty) {
    const d = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'pill ' + (isEmpty ? 'empty' : 'ok');
    span.textContent = isEmpty ? 'Empty' : 'Not Empty';
    d.appendChild(span);
    return d;
}

function renderPage() {
    if (!resultTbody) resultTbody = document.querySelector('#resultTable tbody');
    resultTbody.innerHTML = '';
    const ps = parseInt(pageSizeSel.value, 10);
    if (isNaN(ps) || ps <= 0) {
        ps = 25;
    }
    const startIdx = (viewPage - 1) * ps;
    const endIdx = Math.min(startIdx + ps, allRows.length);
    for (let i = startIdx; i < endIdx; i++) {
        const r = allRows[i];
        const tr = document.createElement('tr');
        tr.appendChild(td(r.Semester));
        tr.appendChild(td(r.OrgUnitId));
        tr.appendChild(tdLink(r.CourseCode, '/d2l/home/' + r.OrgUnitId));
        tr.appendChild(tdPill(r.IsEmpty === 'Yes'));
        tr.appendChild(td(r.HasNews ? 'Yes' : 'No'));
        tr.appendChild(td(r.HasContent ? 'Yes' : 'No'));
        tr.appendChild(td(r.HasGrades ? 'Yes' : 'No'));
        tr.appendChild(td(r.InstructorLastAccess || (r.InstructorNames || r.InstructorEmails ? 'Never' : '')));
        tr.appendChild(td(r.InstructorNames || ''));
        tr.appendChild(td(r.InstructorEmails || ''));
        tr.appendChild(td(r.StartDate || ''));
        tr.appendChild(td(r.EndDate || ''));
        resultTbody.appendChild(tr);
    }
    updatePager();
}

function updatePager() {
    const ps = parseInt(document.getElementById('pageSize').value, 10);
    if (isNaN(ps) || ps <= 0) {
        ps = 25;
    }
    const pageCount = Math.max(1, Math.ceil(allRows.length / ps));
    if (viewPage > pageCount) {
        viewPage = pageCount;
    }
    const txt = 'Page ' + viewPage + ' / ' + pageCount + '  •  ' + allRows.length + ' rows';
    document.getElementById('pageStats').textContent = txt;
    document.getElementById('pageStats2').textContent = txt;
}

function pushResult(row) {
    allRows.push(row);
}

function downloadCsv() {
    if (!allRows.length) {
        alert('No rows to download.');
        return;
    }
    const headers = [
        'Semester', 'OrgUnitId', 'CourseCode', 'IsEmpty',
        'HasNews', 'HasContent', 'HasGrades',
        'InstructorLastAccess', 'InstructorNames', 'InstructorEmails', 'StartDate', 'EndDate'
    ];
    const lines = [headers.join(',')];
    for (let i = 0; i < allRows.length; i++) {
        const r = allRows[i];
        const vals = [
            r.Semester, r.OrgUnitId, r.CourseCode, r.IsEmpty,
            r.HasNews ? 'Yes' : 'No',
            r.HasContent ? 'Yes' : 'No',
            r.HasGrades ? 'Yes' : 'No',
            r.InstructorLastAccess, r.InstructorNames, r.InstructorEmails, r.StartDate, r.EndDate
        ];
        for (let j = 0; j < vals.length; j++) {
            let v = vals[j] == null ? '' : String(vals[j]);
            if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0) {
                v = '"' + v.replace(/"/g, '""') + '"';
            }
            vals[j] = v;
        }
        lines.push(vals.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'empty-course-audit_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ====================== Main Audit Flow ======================
async function runAudit() {
    clearResults();
    viewPage = 1;

    const semSel = document.getElementById('semesterSelect');
    const semesterId = semSel.value;
    const semesterName = semSel.options[semSel.selectedIndex] ? semSel.options[semSel.selectedIndex].textContent : '';

    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }

    if (!Object.keys(csvIndex).length) {
        if (!confirm('No CSV loaded. You can still run the audit, but Start/End dates will be blank. Continue?')) {
            return;
        }
    }

    setStatus('Loading courses for ' + semesterName + ' …');
    LoadingUtils.showLoadingBar('loadingContainer');
    LoadingUtils.updateLoadingBar(5, 'Loading courses...', 'loadingContainer');
    
    const courses = await fetchSemesterCourses(semesterId);
    if (!courses.length) {
        setStatus('No course offerings found.');
        LoadingUtils.hideLoadingBar('loadingContainer');
        return;
    }

    setStatus('Found ' + courses.length + ' courses. Starting audit…');
    LoadingUtils.updateLoadingBar(10, 'Starting audit...', 'loadingContainer');
    
    let checked = 0;
    let emptyCount = 0;
    const totalCourses = courses.length;

    for (let i = 0; i < courses.length; i++) {
        const c = courses[i] || {};
        const ouId = c.Identifier || c.Id || c.OrgUnitId || null;
        const name = c.Name || '';
        const code = c.Code || '';
        
        // Progress: 10% for loading, 80% for checking courses (10-90%), 10% for finalizing
        const pct = 10 + ((i + 1) / totalCourses) * 80;
        LoadingUtils.updateLoadingBar(pct, `Checking [${i + 1}/${courses.length}] ${code}`, 'loadingContainer');

        if (!ouId) continue;
        if (isIgnoredCourse(name, code)) {
            logMsg('Skipping ignored: ' + ouId + ' | ' + code);
            continue;
        }

        setStatus('Checking [' + (i + 1) + '/' + courses.length + '] OU ' + ouId);
        logMsg('Course OU ' + ouId + ' - ' + code);

        // Composite emptiness check
        const [hasContent, newsCount, hasGrades, instrInfo] = await Promise.all([
            hasCourseContent(ouId),
            getNewsCount(ouId),
            hasCustomGrades(ouId),
            getInstructorInfo(ouId)
        ]);

        const hasNews = newsCount > 0;
        const empty = !hasNews && !hasContent && !hasGrades;
        logMsg(`  └ news=${hasNews}, content=${hasContent}, grades=${hasGrades}, empty=${empty}`);

        const csvEntry = lookupCsvEntry(code);
        const start = csvEntry.start || '';
        const end = csvEntry.end || '';

        const row = {
            Semester: semesterName || '',
            OrgUnitId: ouId,
            CourseCode: code,
            IsEmpty: empty ? 'Yes' : 'No',
            HasNews: hasNews,
            HasContent: hasContent,
            HasGrades: hasGrades,
            InstructorLastAccess: instrInfo.lastAccessISO || '',
            InstructorNames: instrInfo.names || csvEntry.instructor || '',
            InstructorEmails: instrInfo.emails || '',
            StartDate: start,
            EndDate: end
        };
        pushResult(row);
        checked++;
        if (empty) emptyCount++;

        if ((i % 10) === 0) {
            renderPage();
            document.getElementById('tableCard').style.display = 'block';
        }
    }

    LoadingUtils.updateLoadingBar(95, 'Finalizing results…', 'loadingContainer');
    setStatus('Finalizing results…');
    renderPage();
    document.getElementById('tableCard').style.display = 'block';
    LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
    setStatus('Done. Checked ' + checked + ' courses. Empty: ' + emptyCount + '.');
    logMsg('Audit complete. Checked ' + checked + ' (Empty: ' + emptyCount + ').');
    
    // Enable download button
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) downloadBtn.disabled = false;
    
    // Hide loading bar after a brief delay
    setTimeout(() => {
        LoadingUtils.hideLoadingBar('loadingContainer');
    }, 2000);
}

// ====================== Init & Events ======================
function attachEvents() {
    const loadBtn = document.getElementById('loadBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    
    if (!loadBtn || !downloadBtn) {
        logMsg('ERROR: Required buttons not found');
        return;
    }
    
    // Disable download button initially
    downloadBtn.disabled = true;
    
    loadBtn.addEventListener('click', function() {
        // Disable buttons during audit
        loadBtn.disabled = true;
        downloadBtn.disabled = true;
        
        runAudit().catch(function(e) {
            setStatus('Error during audit. See log.');
            logMsg('ERROR runAudit: ' + (e && e.message ? e.message : e));
            LoadingUtils.hideLoadingBar('loadingContainer');
        }).finally(() => {
            // Re-enable load button after audit completes
            loadBtn.disabled = false;
        });
    });
    
    downloadBtn.addEventListener('click', function() {
        try {
            downloadCsv();
        } catch (e) {
            alert('Download failed: ' + e.message);
        }
    });

    document.getElementById('csvFile').addEventListener('change', function(ev) {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        setStatus('Parsing CSV…');
        Papa.parse(f, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                try {
                    const rows = results.data || [];
                    buildCsvIndex(rows);
                    setStatus('CSV loaded: ' + rows.length + ' rows.');
                } catch (e) {
                    setStatus('CSV load failed');
                    logMsg('ERROR parsing CSV: ' + e.message);
                }
            },
            error: function(err) {
                setStatus('CSV parse error');
                logMsg('CSV parse error: ' + err.message);
            }
        });
    });

    pageSizeSel.addEventListener('change', function() {
        viewPage = 1;
        renderPage();
    });

    function goPrev() {
        if (viewPage > 1) {
            viewPage--;
            renderPage();
        }
    }
    
    function goNext() {
        const ps = parseInt(pageSizeSel.value, 10);
        if (isNaN(ps) || ps <= 0) {
            ps = 25;
        }
        const pageCount = Math.max(1, Math.ceil(allRows.length / ps));
        if (viewPage < pageCount) {
            viewPage++;
            renderPage();
        }
    }
    
    document.getElementById('prevBtn').addEventListener('click', goPrev);
    document.getElementById('nextBtn').addEventListener('click', goNext);
    document.getElementById('prevBtn2').addEventListener('click', goPrev);
    document.getElementById('nextBtn2').addEventListener('click', goNext);
}
