/**
 * Completion Report
 * Tracks learner progress-to-completion for courses in the selected semester
 */

const LP_VER = '1.49';
const LE_VER = '1.85';
const LE_VER_CLASSLIST = '1.82';
const ORG_ID = 1001;
const SEMESTER_TYPE_ID = 5;

let completionTable = null;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Load semesters
    loadSemesters();
    
    // Set up event listeners
    document.getElementById('runBtn').addEventListener('click', runReport);
    document.getElementById('downloadBtn').addEventListener('click', downloadCSV);
});

function fmtPct(n) {
    return (n === null || n === undefined || isNaN(n)) ? '—' : (Math.round(n) + '%');
}

function fmtDateISO(d) {
    try {
        return new Date(d).toISOString().slice(0, 10);
    } catch (e) {
        return '—';
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function setInfo(msg) {
    const help = document.getElementById('helpBlock');
    if (!help) return;
    const body = help.querySelector('.muted-text');
    if (body) body.innerHTML = msg;
}

async function loadSemesters() {
    try {
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;
        
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${LP_VER}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=${SEMESTER_TYPE_ID}`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/${LP_VER}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=${SEMESTER_TYPE_ID}&pageSize=100`
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
        const html = data.map(s => `<option value="${s.Identifier}">${s.Name} (${s.Identifier})</option>`).join('');
        document.getElementById('semester').innerHTML = html;
    } catch (error) {
        console.error('Error loading semesters:', error);
    }
}

async function getCoursesForSemester(semesterId) {
    let kids = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        kids = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/children/`
        );
    } else {
        const response = await D2LApi._fetch(
            `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/children/?pageSize=100`
        );
        if (response.Objects && Array.isArray(response.Objects)) {
            kids = response.Objects;
        } else if (Array.isArray(response)) {
            kids = response;
        }
    }
    
    const out = [];
    for (const c of kids) {
        const code = (c && c.Code) ? c.Code : '';
        const isCourseOffering = c && c.Type && c.Type.Id === 3;
        const isCXLD = /^CXLD\s*-/.test(code);
        const isMERGED = /^MERGED\s*-/.test(code);
        if (isCourseOffering && !isCXLD && !isMERGED) {
            out.push(c);
        }
    }
    return out;
}

async function getClasslist(ou) {
    const vers = ['1.82', '1.78', '1.70', '1.65'];
    for (const v of vers) {
        const base = `/d2l/api/le/${v}/${ou}/classlist`;
        // Try unpaged first
        try {
            const url1 = base + '/?pageSize=1000';
            const data = await D2LApi._fetch(url1);
            if (Array.isArray(data)) {
                if (data.length) return data;
            }
            if (data && data.Items && data.Items.length) {
                return data.Items;
            }
        } catch (e) {
            // fall through to paged
        }
        
        // Paged fallback
        try {
            let acc = [];
            let bookmark = '';
            for (let i = 0; i < 80; i++) {
                const url2 = base + '/paged/?pageSize=100' + (bookmark ? ('&bookmark=' + encodeURIComponent(bookmark)) : '');
                const page = await D2LApi._fetch(url2);
                if (page && page.Items && page.Items.length) {
                    acc = acc.concat(page.Items);
                }
                if (!page || !page.PagingInfo || !page.PagingInfo.Bookmark) break;
                bookmark = page.PagingInfo.Bookmark;
                await sleep(120);
            }
            if (acc.length) return acc;
        } catch (e) {
            // try next version
        }
    }
    return [];
}

async function getFinalGradePercent(ou, userId) {
    try {
        const url = `/d2l/api/le/${LE_VER}/${ou}/grades/final/values/${userId}`;
        const j = await D2LApi._fetch(url);
        if (j && (j.NumericGrade !== null && j.NumericGrade !== undefined)) {
            return Number(j.NumericGrade);
        }
        if (j && j.DisplayedGrade) {
            const m = String(j.DisplayedGrade).match(/([0-9]+(?:\.[0-9]+)?)/);
            if (m) return Number(m[1]);
        }
    } catch (e) {
        // ignore
    }
    return null;
}

async function getContentProgressPercent(ou, userId) {
    const paths = [
        `/d2l/api/le/${LE_VER}/${ou}/content/userprogress/${userId}`,
        `/d2l/api/le/${LE_VER}/${ou}/content/userprogress/?userId=${userId}`,
        `/d2l/api/le/1.81/${ou}/content/userprogress/${userId}`
    ];
    
    for (const path of paths) {
        try {
            const j = await D2LApi._fetch(path);
            let comp = null;
            if (j && j.Completion && (j.Completion.Total || j.Completion.Total === 0)) comp = j.Completion;
            if (!comp && j && j.Progress && (j.Progress.Total || j.Progress.Total === 0)) comp = j.Progress;
            if (!comp && j && (j.Total || j.Total === 0) && (j.Completed || j.Completed === 0)) comp = j;
            
            if (comp && comp.Total) {
                const pct = (comp.Completed || 0) / (comp.Total || 1) * 100;
                return pct;
            }
            
            // Modules/Topics fallback
            if (j && j.Modules && j.Modules.length) {
                let total = 0, done = 0;
                for (const mod of j.Modules) {
                    if (mod && mod.Topics && mod.Topics.length) {
                        for (const topic of mod.Topics) {
                            total++;
                            if (topic && topic.IsCompleted) done++;
                        }
                    }
                }
                if (total > 0) return (done / total) * 100;
            }
        } catch (e) {
            // try next
        }
    }
    return null;
}

function computeStatus(finalPct, contentPct, hasAward) {
    let pass = false;
    if (finalPct !== null && !isNaN(finalPct) && finalPct >= 60) pass = true;
    if (!pass && contentPct !== null && !isNaN(contentPct) && contentPct >= 90) pass = true;
    if (!pass && hasAward) pass = true;
    return pass ? 'Complete' : (contentPct !== null && contentPct < 30 ? 'At Risk' : 'On Track');
}

let allRows = [];

async function runReport() {
    const semesterId = document.getElementById('semester').value;
    if (!semesterId || semesterId === 'Loading…') {
        alert('Please select a semester.');
        return;
    }
    
    const runBtn = document.getElementById('runBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    
    // Disable buttons and show loading modal
    runBtn.disabled = true;
    downloadBtn.disabled = true;
    setInfo('');
    
    // Destroy existing table if it exists
    if (completionTable) {
        completionTable.destroy();
        completionTable = null;
    }
    
    // Use loading modal with cancel support
    LoadingUtils.showLoadingModal('Initializing report...', 'loadingModal', () => {
        // Cancel callback - will be checked in the loop
    });
    LoadingUtils.updateLoadingModal(10, 'Fetching courses...', 'loadingModal');
        const courses = await getCoursesForSemester(semesterId);
        if (!courses.length) {
            setInfo('No course offerings found for this semester.');
            LoadingUtils.hideLoadingModal();
            runBtn.disabled = false;
            return;
        }
        
        allRows = [];
        let processed = 0;
        
        for (const c of courses) {
            // Check for cancellation
            if (LoadingUtils.isCancelled('loadingModal')) {
                LoadingUtils.hideLoadingModal('loadingModal');
                runBtn.disabled = false;
                setInfo('Report cancelled.');
                return;
            }
            
            processed++;
            const progress = 10 + Math.floor((processed / courses.length) * 80);
            LoadingUtils.updateLoadingModal(progress, `Processing course ${processed}/${courses.length}: ${c.Code || c.Name}...`, 'loadingModal');
            
            try {
                const classlist = await getClasslist(c.Identifier);
                
                for (const user of classlist) {
                    const userId = user.UserId || user.Identifier;
                    if (!userId) continue;
                    
                    const finalPct = await getFinalGradePercent(c.Identifier, userId);
                    const contentPct = await getContentProgressPercent(c.Identifier, userId);
                    const hasAward = false; // Placeholder - implement awards API when available
                    const status = computeStatus(finalPct, contentPct, hasAward);
                    
                    allRows.push({
                        OrgUnitId: c.Identifier,
                        CourseCode: c.Code || '',
                        Student: user.DisplayName || user.Name || '',
                        Username: user.UserName || user.Username || '',
                        FinalGrade: fmtPct(finalPct),
                        ContentPct: fmtPct(contentPct),
                        Award: hasAward ? 'Certificate' : '—',
                        CompletionStatus: status
                    });
                }
            } catch (e) {
                console.warn('Error processing course', c.Identifier, e);
            }
            
            await sleep(100);
        }
        
        LoadingUtils.updateLoadingModal(95, 'Rendering table...', 'loadingModal');
        
        // Populate table
        const tbody = document.querySelector('#completionTable tbody');
        tbody.innerHTML = '';
        allRows.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.OrgUnitId}</td>
                <td>${row.CourseCode}</td>
                <td>${row.Student}</td>
                <td>${row.Username}</td>
                <td>${row.FinalGrade}</td>
                <td>${row.ContentPct}</td>
                <td>${row.Award}</td>
                <td>${row.CompletionStatus}</td>
            `;
            tbody.appendChild(tr);
        });
        
        // Initialize or refresh DataTable with better configuration
        if (completionTable) {
            completionTable.destroy();
        }
        completionTable = $('#completionTable').DataTable({
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
        
        LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
        setInfo(`Report complete. ${allRows.length} learner records processed.`);
        downloadBtn.disabled = false;
        
        // Hide modal after a brief delay
        setTimeout(() => {
            LoadingUtils.hideLoadingModal('loadingModal');
        }, 1000);
    } catch (error) {
        console.error('Error running report:', error);
        setInfo('Error: ' + error.message);
        LoadingUtils.hideLoadingModal('loadingModal');
    } finally {
        runBtn.disabled = false;
    }
}

function downloadCSV() {
    if (!allRows || allRows.length === 0) {
        alert('No data to download.');
        return;
    }
    
    const headers = ['OrgUnitId', 'Course Code', 'Student', 'Username', 'Final Grade', 'Content %', 'Award', 'Completion Status'];
    const rows = allRows.map(r => [
        r.OrgUnitId,
        r.CourseCode,
        r.Student,
        r.Username,
        r.FinalGrade,
        r.ContentPct,
        r.Award,
        r.CompletionStatus
    ]);
    
    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => {
            const str = String(cell || '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join(','))
        .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `completion-report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
