/**
 * Intelligent Agent Email Checker
 * Audits Reply-To settings for Intelligent Agents
 */

let semesters = [];
let courses = [];
let filteredCourses = [];
let courseMapById = new Map();
let csvRows = [];
let csvHeaders = [];
let ouIdCol = '';
let enabledCol = '';
let targetOuIds = [];
let iaTable = null;
let lastAuditRows = [];

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize loading container
    try {
        const loadingContainer = LoadingUtils.createLoadingBar('loadingContainer');
        const firstCard = document.querySelector('.card');
        if (firstCard && loadingContainer) {
            firstCard.appendChild(loadingContainer);
        }
    } catch (e) {
        console.error('IA audit: failed to initialize loading bar', e);
    }
    
    // Load semesters
    loadSemesters();
    
    // Set up event listeners
    const loadSemesterBtn = document.getElementById('loadSemesterBtn');
    const csvUpload = document.getElementById('csvUpload');
    const buildBtn = document.getElementById('buildBtn');
    const auditBtn = document.getElementById('auditBtn');
    const downloadAllBtn = document.getElementById('downloadAll');
    const downloadEmailsBtn = document.getElementById('downloadEmails');

    const semesterSelect = document.getElementById('semesterSelect');
    if (semesterSelect) {
        // Auto-load when semester changes
        semesterSelect.addEventListener('change', handleLoadSemester);
    }
    if (loadSemesterBtn) {
        loadSemesterBtn.addEventListener('click', handleLoadSemester);
    }
    if (csvUpload) {
        csvUpload.addEventListener('change', handleCsvUpload);
    }
    if (buildBtn) {
        buildBtn.addEventListener('click', buildTargets);
    }
    if (auditBtn) {
        auditBtn.addEventListener('click', runAudit);
    }
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', () => downloadCSV('all'));
    }
    if (downloadEmailsBtn) {
        downloadEmailsBtn.addEventListener('click', downloadEmails);
    }
});

function setStatus(msg) {
    const status = document.getElementById('status');
    if (status) status.textContent = msg;
}

function setPhase(msg) {
    const phase = document.getElementById('phaseLabel');
    if (phase) phase.textContent = msg || '';
}

function show(el, yes) {
    if (el) el.classList[yes ? 'remove' : 'add']('hidden');
}

function u(s) {
    return String(s || '');
}

function updateStats() {
    const statSemester = document.getElementById('statSemester');
    const statSemesterFiltered = document.getElementById('statSemesterFiltered');
    const statCsv = document.getElementById('statCsv');
    const statTargets = document.getElementById('statTargets');
    
    if (statSemester) statSemester.textContent = 'Semester courses: ' + courses.length;
    if (statSemesterFiltered) statSemesterFiltered.textContent = 'After MERGED/CXLD: ' + filteredCourses.length;
    if (statCsv) statCsv.textContent = 'CSV rows: ' + csvRows.length;
    if (statTargets) statTargets.textContent = 'Enabled targets: ' + targetOuIds.length;
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
                `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                data = response.Objects;
            } else if (Array.isArray(response)) {
                data = response;
            }
        }
        
        semesters = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
            ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data || []))
            : (data || []).sort((a, b) => String(b.Name || '').localeCompare(String(a.Name || '')));
        
        const sel = document.getElementById('semesterSelect');
        sel.innerHTML = '';
        semesters.forEach(s => {
            const o = document.createElement('option');
            o.value = s.Identifier;
            o.textContent = s.Name + ' (' + s.Identifier + ')';
            sel.appendChild(o);
        });
        
        document.getElementById('semesterSelect').disabled = false;
        document.getElementById('loadSemesterBtn').disabled = false;
        setStatus('Semesters loaded.');
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);
    } catch (error) {
        console.error('Failed to load semesters:', error);
        setStatus('Failed to load semesters.');
        LoadingUtils.hideLoadingBar('loadingContainer');
    }
}

async function loadCoursesForSemester(semesterId) {
    courses = [];
    filteredCourses = [];
    courseMapById.clear();
    
    LoadingUtils.showLoadingBar('loadingContainer');
    LoadingUtils.updateLoadingBar(10, 'Loading courses...', 'loadingContainer');
    
    let arr = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        arr = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/`
        );
    } else {
        const response = await D2LApi._fetch(
            `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/?pageSize=100`
        );
        if (response.Objects && Array.isArray(response.Objects)) {
            arr = response.Objects;
        } else if (Array.isArray(response)) {
            arr = response;
        }
    }
    
    if (!Array.isArray(arr)) {
        throw new Error('Unexpected response (not array)');
    }
    
    arr.forEach(obj => {
        const t = obj.Type || {};
        const isOffering = (t.Id === 3) || (t.Code === 'Course Offering');
        if (isOffering) {
            courses.push({ OrgUnitId: obj.Identifier, Name: obj.Name || '', Code: obj.Code || '' });
        }
    });
    
    filteredCourses = courses.filter(c => {
        const n = String(c.Name || '').toUpperCase();
        const code = String(c.Code || '').toUpperCase();
        return (n.indexOf('MERGED') === -1 && code.indexOf('MERGED') === -1 &&
                n.indexOf('CXLD') === -1 && code.indexOf('CXLD') === -1);
    });
    
    filteredCourses.forEach(c => {
        courseMapById.set(String(c.OrgUnitId), c);
    });
    
    updateStats();
    LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
    setTimeout(() => {
        LoadingUtils.hideLoadingBar('loadingContainer');
    }, 500);
}

async function handleLoadSemester() {
    const semesterId = document.getElementById('semesterSelect').value;
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }
    
    try {
        await loadCoursesForSemester(semesterId);
        setStatus('Courses loaded. If CSV is uploaded, targets will be (re)built.');

        // If a CSV is already loaded, immediately (re)build targets so Run Audit is enabled.
        if (csvRows.length) {
            buildTargets();
        }
    } catch (error) {
        console.error('Error loading courses:', error);
        setStatus('Error loading courses: ' + error.message);
    }
}

function parseCsvFile(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: res => resolve(res),
            error: err => reject(err)
        });
    });
}

function autoDetectColumns(headers) {
    const lu = headers.map(h => String(h || '').trim().toLowerCase());
    function find(cands) {
        for (let i = 0; i < lu.length; i++) {
            for (let j = 0; j < cands.length; j++) {
                if (lu[i] === cands[j] || lu[i].includes(cands[j])) return i;
            }
        }
        return -1;
    }
    const ouIdx = find(['orgunitid', 'org unit id', 'ouid', 'ou id', 'org unit']);
    const enIdx = find(['enabled', 'is enabled', 'agent enabled', 'active']);
    return { ouIdx, enIdx };
}

function populateColumnSelectors(headers, detected) {
    const ouSel = document.getElementById('ouIdColumn');
    const enSel = document.getElementById('enabledColumn');
    ouSel.innerHTML = '<option value="">Auto: OrgUnitId</option>';
    enSel.innerHTML = '<option value="">Auto: Enabled</option>';
    headers.forEach(h => {
        const o1 = document.createElement('option');
        o1.value = h;
        o1.textContent = 'OU: ' + h;
        ouSel.appendChild(o1);
        const o2 = document.createElement('option');
        o2.value = h;
        o2.textContent = 'Enabled: ' + h;
        enSel.appendChild(o2);
    });
    if (detected.ouIdx >= 0) ouSel.value = headers[detected.ouIdx];
    if (detected.enIdx >= 0) enSel.value = headers[detected.enIdx];
    ouSel.disabled = false;
    enSel.disabled = false;
}

function truthy(v) {
    const s = String(v || '').trim().toLowerCase();
    return (s === 'true' || s === 't' || s === '1' || s === 'y' || s === 'yes');
}

async function handleCsvUpload() {
    const file = document.getElementById('csvUpload').files[0];
    if (!file) return;
    
    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(10, 'Parsing CSV...', 'loadingContainer');
        
        const parsed = await parseCsvFile(file);
        csvRows = parsed.data || [];
        csvHeaders = parsed.meta.fields || [];
        
        const detected = autoDetectColumns(csvHeaders);
        populateColumnSelectors(csvHeaders, detected);
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);

        // If semester courses are already loaded, auto-build targets; otherwise wait for semester.
        if (filteredCourses.length) {
            setStatus('CSV loaded. Building target list with auto-detected columns…');
            buildTargets();
        } else {
            setStatus('CSV loaded. Select/load a semester, then build targets.');
        }
    } catch (error) {
        console.error('CSV parse error:', error);
        setStatus('Error parsing CSV: ' + error.message);
        LoadingUtils.hideLoadingBar('loadingContainer');
    }
}

function buildTargets() {
    targetOuIds = [];
    if (!filteredCourses.length) {
        setStatus('Load a semester first.');
        return;
    }
    if (!csvRows.length) {
        setStatus('Upload a CSV first.');
        return;
    }
    
    const ouSel = document.getElementById('ouIdColumn');
    const enSel = document.getElementById('enabledColumn');
    ouIdCol = u(ouSel.value);
    enabledCol = u(enSel.value);
    if (!ouIdCol || !enabledCol) {
        setStatus('Select (or auto-detect) OrgUnitId and Enabled columns.');
        return;
    }
    
    const enabledSet = new Set();
    csvRows.forEach(r => {
        const id = u(r[ouIdCol]).trim();
        const en = r[enabledCol];
        if (!id) return;
        if (truthy(en)) enabledSet.add(id);
    });
    
    enabledSet.forEach(id => {
        if (courseMapById.has(String(id))) targetOuIds.push(String(id));
    });
    
    updateStats();
    document.getElementById('auditBtn').disabled = targetOuIds.length === 0;
    setStatus('Built target list: ' + targetOuIds.length + ' enabled courses in this semester.');
}

// Simplified audit function - would need iframe-based scraping for full implementation
// ---------- Shadow-DOM aware helpers ----------
function deepCollect(root, selector) {
    const out = [];
    function walk(node) {
        if (!node) return;
        try {
            node.querySelectorAll(selector).forEach(el => out.push(el));
        } catch (e) {}
        let all = [];
        try {
            all = node.querySelectorAll('*');
        } catch (e) {
            all = [];
        }
        for (let i = 0; i < all.length; i++) {
            if (all[i] && all[i].shadowRoot) walk(all[i].shadowRoot);
        }
    }
    walk(root);
    return out;
}

// Reply-To extraction (settings page)
function extractReplyTo(doc) {
    const el = doc.querySelector('#replyToAddress');
    if (el && typeof el.value !== 'undefined') return String(el.value || '').trim();

    const wc = deepCollect(doc, 'd2l-input-text');
    for (let i = 0; i < wc.length; i++) {
        const lbl = (wc[i].getAttribute('label') || '').toLowerCase();
        if (lbl.includes('reply')) return String(wc[i].value || '').trim();
    }
    const inputs = doc.querySelectorAll("input[type='email'], input[type='text']");
    for (let j = 0; j < inputs.length; j++) {
        const id = (inputs[j].id || '').toLowerCase();
        const nm = (inputs[j].name || '').toLowerCase();
        if (id.includes('reply') || nm.includes('reply')) return String(inputs[j].value || '').trim();
    }
    return '';
}

function getReplyTo(ou, timeoutMs) {
    return new Promise(resolve => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = `https://your-brightspace.example.edu/d2l/lms/intelligentAgents/settings.d2l?ou=${ou}`;
        let done = false;
        let poll = null;
        let timer = null;
        function cleanup(res) {
            if (done) return;
            done = true;
            if (poll) clearInterval(poll);
            if (timer) clearTimeout(timer);
            try {
                iframe.remove();
            } catch (e) {}
            resolve(res);
        }
        iframe.onload = function () {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                poll = setInterval(function () {
                    try {
                        const v = extractReplyTo(doc);
                        if (typeof v === 'string') {
                            cleanup({ ok: true, value: v });
                        }
                    } catch (e) {}
                }, 250);
                timer = setTimeout(function () {
                    cleanup({ ok: false, value: '', note: 'settings timeout' });
                }, timeoutMs || 12000);
            } catch (e) {
                cleanup({ ok: false, value: '', note: 'settings access denied' });
            }
        };
        document.body.appendChild(iframe);
    });
}

// Instructor emails (classlist page)
async function fetchInstructorEmails(ou) {
    try {
        // Use LE classlist paged API and filter to likely instructor roles
        const LE_VER = '1.85';
        const pageSize = 100;
        let bookmark = '';
        const emails = new Set();
        let guard = 0;

        while (guard < 50) {
            let url = `/d2l/api/le/${LE_VER}/${ou}/classlist/paged/?pageSize=${pageSize}`;
            // Do NOT restrict to roleId=101; we want instructor-ish roles.
            if (bookmark) {
                url += `&bookmark=${encodeURIComponent(bookmark)}`;
            }
            const page = await D2LApi._fetch(url);
            const items = page.Items || page.Objects || page.items || [];

            items.forEach(item => {
                const roleName =
                    item.RoleName ||
                    item.ClasslistRoleName ||
                    item.ClasslistRoleDisplayName ||
                    (item.Roles && item.Roles[0] && (item.Roles[0].DisplayName || item.Roles[0].Name)) ||
                    '';
                const rn = String(roleName || '').toLowerCase();
                const isInstructor =
                    rn.includes('instructor') ||
                    rn.includes('faculty') ||
                    rn.includes('teacher') ||
                    rn.includes('professor');
                if (!isInstructor) return;

                const email =
                    item.Email ||
                    (item.User && item.User.EmailAddress) ||
                    item.EmailAddress ||
                    '';
                if (email && email.indexOf('@') !== -1) {
                    emails.add(email.trim());
                }
            });

            const next =
                (page.PagingInfo && (page.PagingInfo.Bookmark || page.PagingInfo.bookmark)) ||
                page.Bookmark ||
                page.bookmark ||
                '';
            const hasMore =
                page.PagingInfo && (page.PagingInfo.HasMoreItems || page.PagingInfo.hasMoreItems);
            if (!hasMore || !next) break;
            if (bookmark === next) break;
            bookmark = next;
            guard++;
        }

        return { ok: true, emails: Array.from(emails) };
    } catch (e) {
        console.error('IA audit: classlist API failed', e);
        return { ok: false, emails: [], note: e.message || 'classlist error' };
    }
}

function rowObjFromDisplay(tr) {
    const tds = tr.querySelectorAll('td');
    function dehtml(s) {
        return String(s || '').replace(/<[^>]*>/g, '');
    }
    return {
        OrgUnitId: dehtml(tds[0].innerHTML),
        Code: dehtml(tds[1].innerHTML),
        ReplyTo: dehtml(tds[2].innerHTML),
        Status: dehtml(tds[3].innerHTML),
        Emails: dehtml(tds[4].innerHTML)
    };
}

function generateCSV(rows) {
    const header =
        'OrgUnitId,CourseCode,ReplyToValue,Status,InstructorEmails,SettingsURL\n';
    const lines = rows
        .map(d => {
            function q(s) {
                return '"' + String(s || '').replace(/"/g, '""') + '"';
            }
            const url = `https://your-brightspace.example.edu/d2l/lms/intelligentAgents/settings.d2l?ou=${d.OrgUnitId}`;
            return [
                d.OrgUnitId,
                q(d.Code),
                q(d.ReplyTo),
                q(d.Status),
                q(d.Emails),
                q(url)
            ].join(',');
        })
        .join('\n');
    return header + lines;
}

function generateEmailListCSV(rows) {
    const set = new Set();
    rows.forEach(r => {
        String(r.Emails || '')
            .split(/[;,]+/)
            .forEach(e => {
                e = e.trim();
                if (e) set.add(e);
            });
    });
    return 'Email\n' + Array.from(set).join('\n');
}

function downloadBlob(filename, text) {
    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function runAudit() {
    // If targets haven't been built yet, try to build them once automatically
    if (!targetOuIds.length) {
        buildTargets();
    }
    if (!targetOuIds.length) {
        alert('Load a semester, upload a CSV, then try again — no enabled targets found for this semester.');
        return;
    }

    const auditBtn = document.getElementById('auditBtn');
    auditBtn.disabled = true;

    const defaultEmailInput = document.getElementById('defaultEmail');
    const blankIsDefaultCheckbox = document.getElementById('blankIsDefault');
    const defaultEmail = (defaultEmailInput?.value || '').trim().toLowerCase();
    const blankIsDefault = !!(blankIsDefaultCheckbox && blankIsDefaultCheckbox.checked);

    LoadingUtils.showLoadingBar('loadingContainer');
    LoadingUtils.updateLoadingBar(5, 'Starting audit…', 'loadingContainer');
    setPhase('Auditing Reply-To for Enabled courses…');
    setStatus('Starting…');

    // Clear table
    const tbody = document.querySelector('#iaTable tbody');
    tbody.innerHTML = '';

    const queue = [...targetOuIds];
    const total = queue.length || 1;
    let done = 0;
    const rows = [];
    const concurrency = 4;

    async function worker() {
        while (queue.length) {
            const ou = queue.shift();
            const c = courseMapById.get(ou) || { OrgUnitId: ou, Name: '', Code: '' };
            let reply = '';
            let status = '';
            let statusClass = '';
            let note = '';
            let emails = '';

            try {
                const r = await getReplyTo(ou, 12000);
                reply = r.value || '';
                if (!r.ok && r.note) note = r.note;
            } catch (e) {
                note = (e && e.message) ? e.message : 'settings error';
            }

            const norm = (reply || '').trim().toLowerCase();
            if (norm) {
                if (defaultEmail && norm === defaultEmail) {
                    status = 'Default (unchanged)';
                    statusClass = 'warn';
                    if (!note) note = 'Matches provided default';
                } else {
                    status = 'Custom (overridden)';
                    statusClass = 'ok';
                }
            } else {
                if (blankIsDefault) {
                    status = 'Empty (likely default)';
                    statusClass = 'warn';
                } else {
                    status = 'Empty';
                    statusClass = 'err';
                }
            }

            if (status.startsWith('Empty')) {
                try {
                    const eRes = await fetchInstructorEmails(ou, 12000);
                    emails = (eRes.emails || []).join('; ');
                } catch (e) {}
            }

            rows.push({
                OrgUnitId: c.OrgUnitId,
                Name: c.Name,
                Code: c.Code,
                ReplyTo: reply,
                Status: status,
                StatusClass: statusClass,
                InstructorEmails: emails,
                Note: note
            });

            done++;
            const pct = Math.round((done / total) * 100);
            LoadingUtils.updateLoadingBar(pct, `Checked ${done} / ${total}`, 'loadingContainer');
            setStatus(`Checked ${done} / ${total}`);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));

    // Populate table rows
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="mono">${r.OrgUnitId}</span></td>
            <td><span class="mono">${r.Code || ''}</span></td>
            <td><span class="mono">${r.ReplyTo || ''}</span></td>
            <td><span class="${r.StatusClass || ''}">${r.Status || ''}</span></td>
            <td><span class="mono">${r.InstructorEmails || ''}</span></td>
            <td><a class="fix" target="_blank" rel="noopener" href="https://your-brightspace.example.edu/d2l/lms/intelligentAgents/settings.d2l?ou=${r.OrgUnitId}">Open Settings</a></td>
        `;
        tbody.appendChild(tr);
    });

    // Store rows for downloads
    lastAuditRows = rows;

    show(document.getElementById('downloadAll'), rows.length > 0);
    show(
        document.getElementById('downloadEmails'),
        rows.some(r => String(r.InstructorEmails || '').trim().length > 0)
    );

    LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
    setTimeout(() => {
        LoadingUtils.hideLoadingBar('loadingContainer');
    }, 500);
    setPhase('');
    auditBtn.disabled = false;
}

function downloadCSV(type) {
    if (!lastAuditRows.length) return;
    const data = lastAuditRows;
    downloadBlob(
        type === 'filtered' ? 'ia-audit_filtered.csv' : 'ia-audit_all.csv',
        generateCSV(data)
    );
}

function downloadEmails() {
    if (!lastAuditRows.length) return;
    const data = lastAuditRows.filter(r => String(r.InstructorEmails || r.Emails || '').trim().length > 0)
        .map(r => ({
            Emails: r.InstructorEmails || r.Emails
        }));
    downloadBlob('ia-flagged-emails.csv', generateEmailListCSV(data));
}
