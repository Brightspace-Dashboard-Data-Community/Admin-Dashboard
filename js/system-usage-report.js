/**
 * System Usage Analytics Report
 * Quantifies adoption and activity across Brightspace for a selected semester
 */

const LP_VER = '1.52';
let LE_VER = '1.86';
const LE_CANDIDATES = ['1.86', '1.85', '1.82', '1.78', '1.71'];

// Tab functionality
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

    // No loading containers needed - using modals

    // Load semesters
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

const fmtDate = (d) => new Date(d).toISOString().slice(0, 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function setStatus(elId, html) {
    const el = document.getElementById(elId);
    if (!el) return;
    const strong = el.querySelector('div > strong');
    if (strong) strong.textContent = 'Status';
    const body = el.querySelector('div .muted-text');
    if (body) body.innerHTML = html;
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
            const response = await D2LApi._fetch(
                `/d2l/api/lp/${LP_VER}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                data = response.Objects;
            } else if (Array.isArray(response)) {
                data = response;
            }
        }
        
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            data = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data));
        } else {
            data.sort((a, b) => String(b.Name).localeCompare(String(a.Name)));
        }
        const opts = data.map(s => `<option value="${s.Identifier}">${s.Name} (${s.Identifier})</option>`).join('');
        document.getElementById('usageSemester').innerHTML = opts;
        document.getElementById('usageSemester2').innerHTML = opts;
    } catch (error) {
        console.error('Error loading semesters:', error);
    }
}

async function getCoursesForSemester(semesterId) {
    let children = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        children = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/children/`
        );
    } else {
        const response = await D2LApi._fetch(
            `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/children/?pageSize=100`
        );
        if (response.Objects && Array.isArray(response.Objects)) {
            children = response.Objects;
        } else if (Array.isArray(response)) {
            children = response;
        }
    }
    
    return children.filter(c => {
        const code = c?.Code || '';
        return c?.Type?.Id === 3 && !/^(CXLD|MERGED)\s*-/i.test(code);
    });
}

async function getClasslistWithLastAccess(orgUnitId) {
    const base = `/d2l/api/le/${LE_VER}/${orgUnitId}/classlist`;
    
    // Try paged first
    try {
        let bookmark = '';
        const acc = [];
        for (let i = 0; i < 50; i++) {
            const url = `${base}/paged/?pageSize=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`;
            const page = await D2LApi._fetch(url);
            if (Array.isArray(page?.Items)) {
                acc.push(...page.Items);
            }
            const bm = page?.PagingInfo?.Bookmark;
            if (!bm) break;
            bookmark = bm;
            await sleep(150);
        }
        if (acc.length) return acc;
    } catch (e) {
        console.warn('Paged classlist failed', orgUnitId, e);
    }
    
    // Fallback: unpaged
    try {
        const data = await D2LApi._fetch(`${base}/?pageSize=1000`);
        return Array.isArray(data) ? data : (data?.Items || []);
    } catch (e) {
        console.warn('Unpaged classlist failed', orgUnitId, e);
        return [];
    }
}

async function runOverview(semesterId) {
    setStatus('usageStatus', '');
    LoadingUtils.showLoadingModal('Initializing report...', 'loadingModal', () => {
        // Cancel callback
    });
    LoadingUtils.updateLoadingModal(10, 'Loading courses...', 'loadingModal');
    
    const courses = await getCoursesForSemester(semesterId);
    if (!courses.length) {
        setStatus('usageStatus', 'No course offerings found for this semester.');
        LoadingUtils.hideLoadingModal('loadingModal');
        return;
    }
    
    // Resolve LE version
    try {
        await resolveLeVersionFor(courses[0].Identifier);
    } catch (e) {
        setStatus('usageStatus', 'Could not resolve a supported LE version: ' + e.message);
        LoadingUtils.hideLoadingModal('loadingModal');
        return;
    }
    
    // Aggregate by date and by user
    const dailyUsers = new Map(); // date -> Set(userId)
    const seenUsers = new Map();  // userId -> most recent access date
    
    let processed = 0;
    
    for (const c of courses) {
        // Check for cancellation
        if (LoadingUtils.isCancelled('loadingModal')) {
            LoadingUtils.hideLoadingModal('loadingModal');
            setStatus('usageStatus', 'Report cancelled.');
            return;
        }
        
        processed++;
        setStatus('usageStatus', `Processing classlists (${processed}/${courses.length})… <br><span class="muted-text">${c.Code || c.Name} — OU ${c.Identifier}</span>`);
        LoadingUtils.updateLoadingModal(10 + Math.round((processed / courses.length) * 85), `Processing ${processed}/${courses.length}: ${c.Code || c.Name}...`, 'loadingModal');
        
        let cls = [];
        try {
            cls = await getClasslistWithLastAccess(c.Identifier);
        } catch (e) {
            console.warn('Classlist error', c.Identifier, e);
            continue;
        }
        
        // Aggregate users
        for (const u of cls) {
            const uid = u?.UserId || u?.Identifier || u?.OrgDefinedId;
            const last = u?.LastAccessed || u?.LastAccessDate || u?.LastAccess || null;
            
            if (uid) {
                const prev = seenUsers.get(uid);
                if (!prev || (last && new Date(last) > new Date(prev))) {
                    seenUsers.set(uid, last || prev || null);
                }
            }
            if (uid && last) {
                const d = fmtDate(last);
                if (!dailyUsers.has(d)) dailyUsers.set(d, new Set());
                dailyUsers.get(d).add(uid);
            }
        }
        
        await sleep(120);
    }
    
    // Build rows for table
    const dates = Array.from(dailyUsers.keys()).sort();
    const rows = [];
    for (const d of dates) {
        const uniq = dailyUsers.get(d).size;
        rows.push([d, uniq, '-', '-', '-', '-', '-', '-']);
    }
    
    // Recency buckets
    const now = new Date();
    let le7 = 0, gt30 = 0;
    for (const [, last] of seenUsers) {
        if (!last) continue;
        const days = Math.floor((now - new Date(last)) / (1000 * 60 * 60 * 24));
        if (days <= 7) le7++;
        else if (days > 30) gt30++;
    }
    
    // Populate table
    const tbody = document.querySelector('#usageTable tbody');
    tbody.innerHTML = rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('');
    
    // Initialize DataTable with better configuration
    if (window.jQuery && $.fn.DataTable) {
        if ($.fn.DataTable.isDataTable('#usageTable')) {
            $('#usageTable').DataTable().destroy();
        }
        $('#usageTable').DataTable({
            pageLength: 25,
            lengthMenu: [[10, 25, 50, 100, 200, -1], [10, 25, 50, 100, 200, "All"]],
            order: [[0, 'asc']],
            dom: '<"top"lf>rt<"bottom"ip><"clear">',
            language: {
                search: "Search:",
                lengthMenu: "Show _MENU_ entries",
                info: "Showing _START_ to _END_ of _TOTAL_ entries",
                infoEmpty: "No entries to show",
                infoFiltered: "(filtered from _MAX_ total entries)",
                paginate: {
                    first: "First",
                    last: "Last",
                    next: "Next",
                    previous: "Previous"
                }
            },
            responsive: true,
            scrollX: true
        });
    }
    
    setStatus('usageStatus', `Unique active users observed: <b>${seenUsers.size}</b>. Users active in ≤7 days: <b>${le7}</b>. Users inactive >30 days: <b>${gt30}</b>.`);
    LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
    setTimeout(() => {
        LoadingUtils.hideLoadingModal('loadingModal');
    }, 1000);
}

async function runByCourse(semesterId) {
    setStatus('usageStatus', '');
    LoadingUtils.showLoadingModal('Initializing report...', 'loadingModal2', () => {
        // Cancel callback
    });
    LoadingUtils.updateLoadingModal(10, 'Loading courses...', 'loadingModal2');
    
    const courses = await getCoursesForSemester(semesterId);
    if (!courses.length) {
        const tbody = document.querySelector('#usageCourseTable tbody');
        tbody.innerHTML = '<tr><td colspan="7">No course offerings found.</td></tr>';
        LoadingUtils.hideLoadingModal('loadingModal2');
        return;
    }
    
    // Resolve LE version
    try {
        await resolveLeVersionFor(courses[0].Identifier);
    } catch (e) {
        setStatus('usageStatus', 'Could not resolve a supported LE version: ' + e.message);
        LoadingUtils.hideLoadingModal('loadingModal2');
        return;
    }
    
    const tbody = document.querySelector('#usageCourseTable tbody');
    tbody.innerHTML = '';
    
    let idx = 0;
    for (const c of courses) {
        // Check for cancellation
        if (LoadingUtils.isCancelled('loadingModal2')) {
            LoadingUtils.hideLoadingModal('loadingModal2');
            setStatus('usageStatus', 'Report cancelled.');
            return;
        }
        
        idx++;
        setStatus('usageStatus', `Fetching classlist (${idx}/${courses.length})… <br><span class="muted-text">${c.Code || c.Name} — OU ${c.Identifier}</span>`);
        LoadingUtils.updateLoadingModal(10 + Math.round((idx / courses.length) * 85), `Processing ${idx}/${courses.length}: ${c.Code || c.Name}...`, 'loadingModal2');
        
        let cls = [];
        try {
            cls = await getClasslistWithLastAccess(c.Identifier);
        } catch (e) {
            console.warn('Classlist error', c.Identifier, e);
            continue;
        }
        
        // Unique users & last activity
        const uniqUsers = new Set();
        let lastActivity = null;
        for (const u of cls) {
            if (u?.UserId) uniqUsers.add(u.UserId);
            const last = u?.LastAccessed || u?.LastAccessDate || u?.LastAccess || null;
            if (last) {
                const dt = new Date(last);
                if (!lastActivity || dt > lastActivity) lastActivity = dt;
            }
        }
        
        const row = [
            c.Identifier,
            c.Code || c.Name || '-',
            c.Name || '-',
            uniqUsers.size,
            lastActivity ? fmtDate(lastActivity) : '-',
            '-',
            '-'
        ];
        
        const tr = document.createElement('tr');
        tr.innerHTML = row.map(cell => '<td>' + cell + '</td>').join('');
        tbody.appendChild(tr);
        
        await sleep(120);
    }
    
    // Initialize DataTable with better configuration
    if (window.jQuery && $.fn.DataTable) {
        if ($.fn.DataTable.isDataTable('#usageCourseTable')) {
            $('#usageCourseTable').DataTable().destroy();
        }
        $('#usageCourseTable').DataTable({
            pageLength: 25,
            lengthMenu: [[10, 25, 50, 100, 200, -1], [10, 25, 50, 100, 200, "All"]],
            order: [[0, 'asc']],
            dom: '<"top"lf>rt<"bottom"ip><"clear">',
            language: {
                search: "Search:",
                lengthMenu: "Show _MENU_ entries",
                info: "Showing _START_ to _END_ of _TOTAL_ entries",
                infoEmpty: "No entries to show",
                infoFiltered: "(filtered from _MAX_ total entries)",
                paginate: {
                    first: "First",
                    last: "Last",
                    next: "Next",
                    previous: "Previous"
                }
            },
            responsive: true,
            scrollX: true
        });
    }
    
    LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal2');
    setTimeout(() => {
        LoadingUtils.hideLoadingModal('loadingModal2');
    }, 1000);
}

// Event listeners
document.getElementById('usageRun').addEventListener('click', async () => {
    const semesterId = document.getElementById('usageSemester').value;
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }
    await runOverview(semesterId);
});

document.getElementById('usageRun2').addEventListener('click', async () => {
    const semesterId = document.getElementById('usageSemester2').value;
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }
    await runByCourse(semesterId);
});

// CSV download handlers (simplified - would need to collect data)
document.getElementById('usageDownload').addEventListener('click', () => {
    alert('CSV download functionality coming soon.');
});

document.getElementById('usageDownload2').addEventListener('click', () => {
    alert('CSV download functionality coming soon.');
});
