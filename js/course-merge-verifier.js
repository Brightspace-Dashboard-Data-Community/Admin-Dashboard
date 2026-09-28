/**
 * Course Merge Verifier
 * Verifies course merge requests by checking course codes, enrollment status, and instructor permissions
 */

const ORG_ID = 1001;
const LP_VERSION = '1.49';
const LE_VERSION = '1.51';
const INSTRUCTOR_ROLE_ID = 102;

let LOG_BUFFER = [];
let courseByCode = {};
let courseDetailsCache = {};
let semesterIdToShortCode = {};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize loading container
    const loadingContainer = LoadingUtils.createLoadingBar('loadingContainer');
    document.querySelector('.card').appendChild(loadingContainer);
    
    // Load semesters
    loadSemesters();
    
    // Set up event listeners
    document.getElementById('semesterSelect').addEventListener('change', handleSemesterChange);
    document.getElementById('runBtn').addEventListener('click', runVerification);
    document.getElementById('downloadAllBtn').addEventListener('click', downloadAllCSV);
    document.getElementById('downloadLogBtn').addEventListener('click', downloadLog);
});

function nowTime() {
    const d = new Date();
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
}

function println(s) {
    const line = nowTime() + ' ' + s;
    LOG_BUFFER.push(line);
    const log = document.getElementById('log');
    if (log) {
        log.textContent += '\n' + line;
        log.scrollTop = log.scrollHeight;
    }
    console.log(line);
}

function resetLog() {
    LOG_BUFFER = [];
    const log = document.getElementById('log');
    if (log) log.textContent = '🟡 Starting…';
}

function downloadLog() {
    if (!LOG_BUFFER.length) return;
    const blob = new Blob([LOG_BUFFER.join('\n')], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `course-merge-verifier-log_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// CSV helpers
function getField(row, wanted) {
    const lw = wanted.toLowerCase();
    for (const k in row) {
        if (Object.prototype.hasOwnProperty.call(row, k)) {
            if (String(k).toLowerCase().trim() === lw) return row[k];
        }
    }
    return '';
}

function getName(row) { return getField(row, 'name'); }
function getEmail(row) { return getField(row, 'email'); }
function getDivision(row) { return getField(row, 'division') || 'Unspecified'; }
function getDeltaId(row) { return getField(row, 'Delta ID Number'); }

function normalizeDeltaId(id) {
    const digits = String(id ?? '').replace(/\D/g, '');
    return digits.replace(/^0+/, '') || '0';
}

function deltaIdsMatch(a, b) {
    if (!a || !b) return false;
    return normalizeDeltaId(a) === normalizeDeltaId(b);
}

function orgDefinedIdCandidates(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) return [];
    const trimmed = digits.replace(/^0+/, '') || '0';
    const set = new Set([digits, trimmed]);
    for (const len of [7, 8, 9, 10]) {
        set.add(trimmed.padStart(len, '0'));
    }
    return [...set];
}

function extractCourseCodeCells(row) {
    const vals = [];
    for (const k in row) {
        if (Object.prototype.hasOwnProperty.call(row, k)) {
            const key = String(k).toLowerCase().trim();
            if (
                key === 'master course' ||
                key.indexOf('merging course') === 0 ||
                key === 'merge course (not in list)'
            ) {
                const v = row[k];
                if (v != null) {
                    const s = String(v).trim();
                    if (s) vals.push(s);
                }
            }
        }
    }
    const seen = {};
    const out = [];
    for (let i = 0; i < vals.length; i++) {
        const u = vals[i].toUpperCase();
        if (!seen[u]) {
            seen[u] = 1;
            out.push(vals[i]);
        }
    }
    return out;
}

// Canonical code building
function lastCourseishChunk(s) {
    if (!s) return '';
    let txt = String(s).toUpperCase().trim();
    txt = txt.replace(/[–—]/g, '-').replace(/\s+/g, ' ');
    const parts = txt.split(/\s-\s|\s{2,}/g);
    let cand = parts.length ? parts[parts.length - 1] : txt;
    if (!cand || cand.length < 6) cand = txt;
    return cand.trim();
}

function ensureSubjectDash(code) {
    return String(code).replace(/(^[A-Z]{2,5})(\d)/, '$1-$2');
}

function cleanBase(raw) {
    let base = lastCourseishChunk(raw);
    base = base
        .toUpperCase()
        .replace(/[–—]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, '')
        .replace(/^-+/, '').replace(/-+$/, '');
    base = ensureSubjectDash(base);
    base = base.replace(/--+/g, '-');
    return base;
}

function parseThreePart(raw) {
    if (!raw) return null;
    const base = cleanBase(raw);
    const m = base.match(/^([A-Z]{2,5})-?(\d{2,4}[A-Z]*)-?(FA|SP|SU|WN|WI|SS)\s?-?(\d{2,4})/i);
    if (!m) return null;
    let dept = (m[1] || '').toUpperCase();
    const num = (m[2] || '').toUpperCase();
    let term = (m[3] || '').toUpperCase();
    const sect = (m[4] || '').toUpperCase();
    if (term === 'WN') term = 'WI';
    return { dept: dept, num: num, termSection: term + sect };
}

function buildCanonical(parts, semesterShort) {
    if (!parts || !semesterShort) return '';
    return (parts.dept + '-' + parts.num + '-' + parts.termSection + '-' + semesterShort + '-COURSE').toUpperCase();
}

function detectSemesterToken(s) {
    if (!s) return null;
    const m = String(s).toUpperCase().match(/(\d{2})[\/-]?(WI|WN|SP|FA|SU|SS)/i);
    return m ? (m[1] + '/' + m[2].toUpperCase()) : null;
}

function findCourseMatch(raw, semesterShort, courseByCode) {
    const parts = parseThreePart(raw);
    if (parts) {
        const canonical = buildCanonical(parts, semesterShort);
        if (canonical && courseByCode[canonical]) {
            return { item: courseByCode[canonical], code: canonical, how: 'canonical' };
        }
    }
    
    // Fallback: try direct match
    const base = cleanBase(raw);
    if (courseByCode[base]) {
        return { item: courseByCode[base], code: base, how: 'fallback' };
    }
    
    return null;
}

/** Semesters for this calendar year and next only: YY/TERM or YYYY/TERM with WI, SP, FA. */
function isCurrentOrNextYearSemester(it) {
    const y = new Date().getFullYear();
    const allowedYears = [y, y + 1];
    const allowedTerms = ['WI', 'SP', 'FA'];
    const semesterText = `${(it && it.Name) || ''} ${(it && it.Code) || ''}`.toUpperCase();
    return allowedYears.some(function (year) {
        const yy = String(year).slice(-2);
        return allowedTerms.some(function (term) {
            const yyPat = new RegExp('\\b' + yy + '\\s*[\\/-]\\s*' + term + '\\b');
            const yyyyPat = new RegExp('\\b' + year + '\\s*[\\/-]\\s*' + term + '\\b');
            return yyPat.test(semesterText) || yyyyPat.test(semesterText);
        });
    });
}

async function loadSemesters() {
    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(10, 'Loading semesters...', 'loadingContainer');
        
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;
        
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
        
        // Use canonical allowlist when available; fall back to the original year filter.
        const filtered = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
            ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data || []))
            : (data || []).filter(isCurrentOrNextYearSemester);
        
        const sel = document.getElementById('semesterSelect');
        sel.innerHTML = '<option value="">— Select Semester —</option>';
        
        if (!filtered.length) {
            sel.innerHTML = '<option value="">No semesters available</option>';
            println('❌ No semesters available.');
            LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
            setTimeout(function () {
                LoadingUtils.hideLoadingBar('loadingContainer');
            }, 500);
            return;
        }
        
        if (typeof SemesterConfig === 'undefined') {
            filtered.sort((a, b) => {
                const aa = (a && (a.Code || a.Name) || '').toString();
                const bb = (b && (b.Code || b.Name) || '').toString();
                return aa < bb ? 1 : aa > bb ? -1 : 0;
            });
        }
        
        for (const it of filtered) {
            const label = (it.Code ? it.Code + ' — ' : '') + (it.Name || it.Identifier);
            const opt = document.createElement('option');
            opt.value = it.Identifier;
            opt.textContent = label;
            sel.appendChild(opt);
            
            let short = '';
            if (it.Code && /\d{2}\/(WI|WN|SP|FA|SU|SS)/i.test(it.Code)) {
                short = (it.Code.match(/\d{2}\/(WI|WN|SP|FA|SU|SS)/i) || [''])[0].toUpperCase();
            }
            if (!short && it.Name && /\d{2}\/(WI|WN|SP|FA|SU|SS)/i.test(it.Name)) {
                short = (it.Name.match(/\d{2}\/(WI|WN|SP|FA|SU|SS)/i) || [''])[0].toUpperCase();
            }
            if (short) semesterIdToShortCode[it.Identifier] = short;
        }
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);
        println('✅ Semesters loaded. Choose one.');
    } catch (e) {
        println('❌ Failed to load semesters: ' + e.message);
        LoadingUtils.hideLoadingBar('loadingContainer');
    }
}

async function listSemesterCoursesAll(semesterId) {
    const all = [];
    let bookmark = null;
    let page = 0;
    
    while (true) {
        const base = `/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/children/?pageSize=200`;
        const path = bookmark ? (base + '&bookmark=' + encodeURIComponent(bookmark)) : base;
        
        let res = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            res = await D2LApi.fetchPaginatedData(path);
        } else {
            const response = await D2LApi._fetch(path);
            if (response.Objects && Array.isArray(response.Objects)) {
                res = response.Objects;
            } else if (Array.isArray(response)) {
                res = response;
            }
        }
        
        page++;
        const items = res && res.Items ? res.Items : (Array.isArray(res) ? res : []);
        if (items && items.length) all.push(...items);
        
        const pi = res && res.PagingInfo ? res.PagingInfo : null;
        println('   📄 semester children page ' + page + ' items:' + (items ? items.length : 0) + ' hasMore=' + (pi && pi.HasMoreItems));
        
        if (pi && pi.HasMoreItems && pi.Bookmark) {
            bookmark = pi.Bookmark;
        } else {
            break;
        }
    }
    
    const offerings = [];
    for (const it of all) {
        const isOffering = it && it.Type && (it.Type.Id === 3 || String(it.Type.Id) === '3');
        if (isOffering) offerings.push(it);
    }
    return offerings;
}

async function handleSemesterChange() {
    courseByCode = {};
    courseDetailsCache = {};
    document.getElementById('runBtn').disabled = true;
    document.getElementById('downloadAllBtn').disabled = true;
    document.getElementById('downloadLogBtn').disabled = true;
    
    const semId = this.value;
    if (!semId) {
        println('ℹ️ Select a semester.');
        return;
    }
    
    println('🟡 Loading course offerings for semester ' + semId + ' …');
    LoadingUtils.showLoadingBar('loadingContainer');
    LoadingUtils.updateLoadingBar(10, 'Loading courses...', 'loadingContainer');
    
    try {
        const offerings = await listSemesterCoursesAll(semId);
        println('✅ Found ' + offerings.length + ' course offerings. Building code index…');
        
        for (const it of offerings) {
            const code = it && it.Code ? String(it.Code).trim().toUpperCase() : '';
            if (code) courseByCode[code] = it;
        }
        
        println('✅ Course code index built (' + Object.keys(courseByCode).length + ' unique codes).');
        document.getElementById('runBtn').disabled = false;
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);
    } catch (e) {
        println('❌ Failed loading semester children: ' + e.message);
        LoadingUtils.hideLoadingBar('loadingContainer');
    }
}

async function getCourse(ou) {
    const path = `/d2l/api/lp/${LP_VERSION}/courses/${ou}`;
    return await D2LApi._fetch(path);
}

async function getCourseDetailsCached(ou) {
    if (courseDetailsCache[ou]) return courseDetailsCache[ou];
    const c = await getCourse(ou);
    const info = {
        OrgUnitId: ou,
        Code: c && c.Code ? c.Code : '',
        Name: c && c.Name ? c.Name : '',
        IsActive: !!(c && (c.IsActive === true || c.IsActive === 'true'))
    };
    courseDetailsCache[ou] = info;
    return info;
}

async function enrollmentsUserRole(userId, orgUnitId) {
    const p = `/d2l/api/lp/${LP_VERSION}/enrollments/orgUnits/${orgUnitId}/users/${userId}`;
    try {
        const e = await D2LApi._fetch(p);
        if (e && e.RoleId != null) return e.RoleId;
        return null;
    } catch (err) {
        if (err && (err.status === 404)) return null;
        if (err && (err.status === 401 || err.status === 403)) {
            return 'PERM_DENIED';
        }
        println('   ⚠️ enrollments user role failed ' + orgUnitId + ': ' + err.message);
        return null;
    }
}

async function isUserInInstructorList(userId, orgUnitId) {
    let bookmark = null;
    while (true) {
        const base = `/d2l/api/lp/${LP_VERSION}/enrollments/orgUnits/${orgUnitId}/users/?roleId=${INSTRUCTOR_ROLE_ID}&isActive=true&pageSize=200`;
        const url = bookmark ? (base + '&bookmark=' + encodeURIComponent(bookmark)) : base;

        const response = await D2LApi._fetch(url);
        const items = response && Array.isArray(response.Items) ? response.Items : (Array.isArray(response) ? response : []);
        
        if (items && items.length) {
            for (const item of items) {
                const u = item && item.User ? item.User : null;
                if (u && String(u.Identifier) === String(userId)) return true;
            }
        }

        const pi = response && response.PagingInfo;
        if (pi && pi.HasMoreItems && pi.Bookmark) {
            bookmark = pi.Bookmark;
        } else {
            break;
        }
    }
    return false;
}

async function listSections(offeringOu) {
    const all = [];
    let bookmark = null;
    
    while (true) {
        const base = `/d2l/api/lp/${LP_VERSION}/orgstructure/${offeringOu}/children/?ouTypeId=4&pageSize=200`;
        const path = bookmark ? (base + '&bookmark=' + encodeURIComponent(bookmark)) : base;
        
        let res = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            res = await D2LApi.fetchPaginatedData(path);
        } else {
            const response = await D2LApi._fetch(path);
            if (response.Objects && Array.isArray(response.Objects)) {
                res = response.Objects;
            } else if (Array.isArray(response)) {
                res = response;
            }
        }
        
        const items = res && res.Items ? res.Items : (Array.isArray(res) ? res : []);
        if (items && items.length) all.push(...items);
        
        const pi = res && res.PagingInfo;
        if (pi && pi.HasMoreItems && pi.Bookmark) {
            bookmark = pi.Bookmark;
        } else {
            break;
        }
    }
    return all;
}

async function userIsInstructorBest(userId, offeringOu) {
    // 1) single-user enrollment
    const role = await enrollmentsUserRole(userId, offeringOu);
    if (String(role) === String(INSTRUCTOR_ROLE_ID)) return { ok: true, where: 'offering (enrollments/user)' };
    if (role === 'PERM_DENIED') {
        const inList = await isUserInInstructorList(userId, offeringOu);
        if (inList) return { ok: true, where: 'offering (enrollments/list)' };
    }
    
    // 2) sections fallback
    const sections = await listSections(offeringOu);
    for (const section of sections) {
        const secOu = section.Identifier;
        const sRole = await enrollmentsUserRole(userId, secOu);
        if (String(sRole) === String(INSTRUCTOR_ROLE_ID)) return { ok: true, where: 'section ' + secOu + ' (enrollments/user)' };
        if (sRole === 'PERM_DENIED') {
            const inSecList = await isUserInInstructorList(userId, secOu);
            if (inSecList) return { ok: true, where: 'section ' + secOu + ' (enrollments/list)' };
        }
    }
    
    return { ok: false, where: 'none' };
}

async function fetchUserByOrgDefinedId(orgDefinedId) {
    for (const id of orgDefinedIdCandidates(orgDefinedId)) {
        try {
            const out = await D2LApi._fetch(
                `/d2l/api/lp/${LP_VERSION}/users/?orgDefinedId=${encodeURIComponent(id)}`
            );
            if (Array.isArray(out) && out.length) return out[0];
        } catch (e) {
            if (e && e.status !== 404) {
                println('   ⚠️ OrgDefinedId lookup failed for ' + id + ': ' + e.message);
            }
        }
    }
    return null;
}

async function resolveUser(deltaId, email, name) {
    if (deltaId) {
        const byId = await fetchUserByOrgDefinedId(deltaId);
        if (byId) return byId;
        println('   ⚠️ No D2L user found for Delta ID Number ' + deltaId);
    }
    if (email) {
        try {
            const f = await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/users/?externalEmail=${encodeURIComponent(email)}`);
            if (Array.isArray(f) && f.length) return f[0];
        } catch (e) {
            println('   ⚠️ email lookup failed: ' + e.message);
        }
    }
    if (name) {
        try {
            const l = await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/users/?search=${encodeURIComponent(name)}`);
            if (Array.isArray(l) && l.length) return l[0];
        } catch (e) {
            println('   ⚠️ name search failed: ' + e.message);
        }
    }
    return null;
}

function formatInstructorLabel(user) {
    const name = [(user.FirstName || '').trim(), (user.LastName || '').trim()].filter(Boolean).join(' ');
    const id = user.OrgDefinedId || user.OrgDefinedID || '';
    if (name && id) return name + ' (' + id + ')';
    return name || id || user.Username || 'unknown';
}

async function listCourseInstructors(orgUnitId) {
    const instructors = [];
    let bookmark = null;

    while (true) {
        const base = `/d2l/api/lp/${LP_VERSION}/enrollments/orgUnits/${orgUnitId}/users/?roleId=${INSTRUCTOR_ROLE_ID}&isActive=true&pageSize=200`;
        const url = bookmark ? (base + '&bookmark=' + encodeURIComponent(bookmark)) : base;

        let response;
        try {
            response = await D2LApi._fetch(url);
        } catch (err) {
            println('   ⚠️ instructor list failed ' + orgUnitId + ': ' + err.message);
            break;
        }

        const items = response && Array.isArray(response.Items) ? response.Items : (Array.isArray(response) ? response : []);
        for (const item of items) {
            const u = item && item.User ? item.User : null;
            if (u) instructors.push(u);
        }

        const pi = response && response.PagingInfo;
        if (pi && pi.HasMoreItems && pi.Bookmark) {
            bookmark = pi.Bookmark;
        } else {
            break;
        }
    }

    return instructors;
}

let allChecked = [];

const CHECK_COLUMNS = [
    'Courses Found',
    'Courses Active',
    'Not CXLD',
    'User Resolved',
    'Delta ID Match',
    'Instructor Role'
];

const RESULT_COLUMNS = [
    'Name',
    'Email',
    'Delta ID Number',
    'Master course',
    'Merging course 1',
    'Merging course 2',
    'Merging course 3',
    'Merging course 4',
    'Merge Course (Not in list)',
    'Pass',
    ...CHECK_COLUMNS,
    'Failure Reason'
];

function yesNo(ok) {
    return ok ? 'Yes' : 'No';
}

function downloadCSV(filename, rows) {
    if (!rows || !rows.length) return;
    const out = [RESULT_COLUMNS.join(',')];
    rows.forEach(r => {
        const line = RESULT_COLUMNS.map(k => {
            let v = r[k] == null ? '' : String(r[k]);
            if (v.indexOf('"') >= 0) v = v.replace(/"/g, '""');
            if (/[",\n]/.test(v)) v = '"' + v + '"';
            return v;
        }).join(',');
        out.push(line);
    });
    const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function renderResults(rows) {
    const results = document.getElementById('results');
    results.innerHTML = '';
    results.style.display = 'block';

    if (!rows.length) {
        results.innerHTML = '<p class="hint">No checked rows yet.</p>';
        return;
    }
    document.getElementById('downloadAllBtn').disabled = false;

    const heading = document.createElement('h2');
    heading.style.marginTop = '0';
    heading.textContent = 'Verification Results';
    results.appendChild(heading);

    const summary = document.createElement('p');
    const passCount = rows.filter(r => r.Pass === 'Yes').length;
    summary.textContent = passCount + ' of ' + rows.length + ' rows pass all checks (courses found/active/not CXLD, user resolved, Delta ID match, Instructor role 102 on every listed course).';
    results.appendChild(summary);

    const legend = document.createElement('p');
    legend.className = 'hint';
    legend.textContent = 'Check columns are Yes/No for that row. Failure Reason lists every failed check (including which course when applicable).';
    results.appendChild(legend);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'results-table-wrap';
    const table = document.createElement('table');
    table.className = 'results-table';

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    RESULT_COLUMNS.forEach(c => {
        const th = document.createElement('th');
        th.textContent = c;
        trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(r => {
        const tr = document.createElement('tr');
        RESULT_COLUMNS.forEach(c => {
            const td = document.createElement('td');
            const v = r[c];
            td.textContent = (v == null ? '' : String(v));
            if ((c === 'Pass' || CHECK_COLUMNS.indexOf(c) >= 0) && td.textContent === 'No') {
                td.className = 'alerts-cell';
            }
            if (c === 'Failure Reason' && td.textContent) {
                td.className = (td.className ? td.className + ' ' : '') + 'failure-reason-cell';
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    results.appendChild(tableWrap);
}

async function runVerification() {
    console.clear();
    resetLog();
    
    const semId = document.getElementById('semesterSelect').value;
    if (!semId) {
        println('⚠️ Pick a semester first.');
        return;
    }
    
    const fileInput = document.getElementById('csvFile');
    if (!fileInput.files || !fileInput.files[0]) {
        println('⚠️ Choose a CSV file.');
        return;
    }
    
    const runBtn = document.getElementById('runBtn');
    runBtn.disabled = true;
    LoadingUtils.showLoadingModal('Processing verification...');
    
    const semesterShort = semesterIdToShortCode[semId] || '';
    if (semesterShort) println('ℹ️ Using semester code: ' + semesterShort);
    
    try {
        const text = await fileInput.files[0].text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const rows = (parsed && parsed.data) ? parsed.data : [];
        println('📄 Loaded ' + rows.length + ' CSV rows.');
        
        LoadingUtils.updateLoadingModal(10, 'Processing rows...');
        
        allChecked = [];
        
        for (let i = 0; i < rows.length; i++) {
            const progress = 10 + Math.floor((i / rows.length) * 85);
            LoadingUtils.updateLoadingModal(progress, `Processing row ${i + 1}/${rows.length}...`);
            
            println('— Row ' + (i + 1) + '/' + rows.length);
            const name = getName(rows[i]);
            const email = getEmail(rows[i]);
            const deltaId = getDeltaId(rows[i]);
            const rawCodeCells = extractCourseCodeCells(rows[i]);
            const failReasons = [];

            let coursesFoundOk = true;
            let coursesActiveOk = true;
            let notCxldOk = true;
            let userResolvedOk = true;
            let deltaIdMatchOk = true;
            let instructorRoleOk = true;

            if (!rawCodeCells.length) {
                const msg = 'No Master/Merging course values in row';
                println('   ⛔ ' + msg + '.');
                coursesFoundOk = false;
                failReasons.push(msg);
            }

            const user = await resolveUser(deltaId, email, name);
            if (!user) {
                const msg = 'Could not resolve user (Delta ID: ' + (deltaId || '—') + ', ' + (email || name || '—') + ')';
                println('   ⛔ ' + msg + '.');
                userResolvedOk = false;
                instructorRoleOk = false;
                failReasons.push(msg);
            } else {
                const resolvedId = user.OrgDefinedId || user.OrgDefinedID || '';
                println('   👤 UserId ' + user.UserId + ' | ' + (user.FirstName || '') + ' ' + (user.LastName || '') + ' | Delta ID ' + (resolvedId || '—'));
                if (deltaId && resolvedId && !deltaIdsMatch(deltaId, resolvedId)) {
                    const msg = 'Delta ID mismatch: CSV=' + deltaId + ', D2L=' + resolvedId;
                    println('   ⛔ ' + msg);
                    deltaIdMatchOk = false;
                    failReasons.push(msg);
                } else if (deltaId && resolvedId) {
                    println('   ✅ Delta ID Number matches D2L: ' + resolvedId);
                } else if (!deltaId) {
                    println('   ℹ️ No Delta ID Number in CSV; matched user by email/name.');
                }
            }

            for (let cix = 0; cix < rawCodeCells.length; cix++) {
                const rawText = rawCodeCells[cix];
                const match = findCourseMatch(rawText, semesterShort, courseByCode);
                if (!match) {
                    const msg = 'Course not found in selected semester: ' + rawText;
                    println('   ⛔ Not found in selected semester (after canonicalization): ' + rawText);
                    coursesFoundOk = false;
                    failReasons.push(msg);
                } else {
                    const entry = match.item;
                    const normalizedCode = match.code;
                    const ou = entry.Identifier;
                    println('   🔎 Matched "' + rawText + '" → "' + normalizedCode + '" (OU ' + ou + ', via ' + match.how + ')');

                    const det = await getCourseDetailsCached(ou);
                    const displayCode = det.Code || normalizedCode || rawText;
                    const codeUpper = det.Code ? String(det.Code).toUpperCase() : '';
                    const nameUpper = det.Name ? String(det.Name).toUpperCase() : '';
                    const hasCxld = codeUpper.indexOf('CXLD') >= 0 || nameUpper.indexOf('CXLD') >= 0;

                    if (hasCxld) {
                        const msg = 'Marked CXLD: ' + displayCode;
                        println('   ⛔ Marked CXLD (cancelled): ' + det.Code + ' (OU ' + ou + ')');
                        notCxldOk = false;
                        failReasons.push(msg);
                    } else {
                        println('   ✅ Not marked CXLD: ' + det.Code + ' (OU ' + ou + ')');
                    }

                    if (!det.IsActive) {
                        const msg = 'Course not ACTIVE: ' + displayCode;
                        println('   ⛔ Course is not ACTIVE: ' + det.Code + ' (OU ' + ou + ')');
                        coursesActiveOk = false;
                        failReasons.push(msg);
                    } else {
                        println('   ✅ Course is ACTIVE: ' + det.Code);
                    }

                    if (user) {
                        const roleCheck = await userIsInstructorBest(user.UserId, ou);
                        if (!roleCheck.ok) {
                            const actualInstructors = await listCourseInstructors(ou);
                            const actualLabels = actualInstructors.map(formatInstructorLabel);
                            let msg = 'Not Instructor (role 102) on ' + displayCode;
                            if (actualLabels.length) {
                                msg += ' — current instructor(s): ' + actualLabels.join('; ');
                            } else {
                                msg += ' — no active instructors found';
                            }

                            println('   ⛔ User is not Instructor in ' + det.Code + ' [checked offering + sections]');
                            if (actualLabels.length) {
                                println('   ℹ️ Current instructor(s): ' + actualLabels.join('; '));
                            } else {
                                println('   ℹ️ No active instructors found on this course');
                            }
                            instructorRoleOk = false;
                            failReasons.push(msg);
                        } else {
                            println('   ✅ Verified ' + det.Code + ' (OU ' + ou + ') for Delta ID ' + (deltaId || (user.OrgDefinedId || user.OrgDefinedID || email || name)) + ' [' + roleCheck.where + ']');
                        }
                    }
                }
            }

            const passed = coursesFoundOk && coursesActiveOk && notCxldOk && userResolvedOk && deltaIdMatchOk && instructorRoleOk;
            const resolvedDeltaId = deltaId || (user ? (user.OrgDefinedId || user.OrgDefinedID || '') : '');
            const out = {
                Name: name,
                Email: email,
                'Delta ID Number': resolvedDeltaId,
                'Master course': getField(rows[i], 'Master course'),
                'Merging course 1': getField(rows[i], 'Merging course 1'),
                'Merging course 2': getField(rows[i], 'Merging course 2'),
                'Merging course 3': getField(rows[i], 'Merging course 3'),
                'Merging course 4': getField(rows[i], 'Merging course 4'),
                'Merge Course (Not in list)': getField(rows[i], 'Merge Course (Not in list)'),
                Pass: yesNo(passed),
                'Courses Found': yesNo(coursesFoundOk),
                'Courses Active': yesNo(coursesActiveOk),
                'Not CXLD': yesNo(notCxldOk),
                'User Resolved': yesNo(userResolvedOk),
                'Delta ID Match': yesNo(deltaIdMatchOk),
                'Instructor Role': yesNo(instructorRoleOk),
                'Failure Reason': failReasons.join(' | ')
            };

            allChecked.push(out);
            if (passed) {
                println('   ✅ Row passes — all checks OK.');
            } else {
                println('   ⛔ Row fails — ' + failReasons.join(' | '));
            }
        }
        
        LoadingUtils.updateLoadingModal(100, 'Complete!');
        const passRows = allChecked.filter(r => r.Pass === 'Yes').length;
        println('🏁 Done. Checked submissions: ' + allChecked.length + ' | Pass: ' + passRows + ' | Fail: ' + (allChecked.length - passRows));
        renderResults(allChecked);
        
        document.getElementById('downloadAllBtn').disabled = allChecked.length === 0;
        document.getElementById('downloadLogBtn').disabled = LOG_BUFFER.length === 0;
        
        setTimeout(() => {
            LoadingUtils.hideLoadingModal();
        }, 500);
    } catch (error) {
        console.error('Error:', error);
        println('❌ Error: ' + error.message);
        LoadingUtils.hideLoadingModal();
    } finally {
        runBtn.disabled = false;
    }
}

function downloadAllCSV() {
    if (allChecked.length) {
        downloadCSV('course-merge-verifier-results.csv', allChecked);
    }
}
