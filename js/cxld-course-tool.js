/**
 * Cancelled Courses Tool
 * Compares D2L courses with College CSV and processes course cancellations
 */

let csvData = [];
let courseData = [];
let comparisonResults = [];
let previewData = [];
let updateLogData = [];
let cancelRequested = false;

function normalizeHeaderKey(s) {
    return String(s || '').replace(/^\uFEFF/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Case-insensitive lookup; also matches prefixed headers like "… → Status". */
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

function isCancelledStatus(status) {
    const s = String(status || '').trim().toUpperCase();
    return s === 'C' || s === 'CANCELLED' || s === 'CANCELED';
}

/** Strip term suffix so ART-111-FA100-26/FA and ART-111-FA100 both match D2L. */
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

function codesMatch(d2lCode, csvCode) {
    const d2l = String(d2lCode || '').toUpperCase().replace(/\s+/g, '');
    const csv = String(csvCode || '').toUpperCase().replace(/\s+/g, '');
    if (!d2l || !csv) return false;
    if (d2l === csv) return true;
    // Parent/master shells (…-COURSE) are not section offerings
    if (/-COURSE$/i.test(d2l) && !/-COURSE$/i.test(csv)) return false;

    const csvShell = toShellCourseCode(csv);
    const d2lShell = toShellCourseCode(d2l);
    if (csvShell && d2lShell === csvShell) return true;
    if (d2l === csvShell) return true;
    if (csvShell && d2l.startsWith(csvShell + '-')) {
        const rest = d2l.slice(csvShell.length);
        return /^-\d{2}\/(WI|SP|FA|SU|SM|SS)$/.test(rest);
    }
    return false;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function courseHomeLink(orgUnitId, text) {
    const label = escapeHtml(text || orgUnitId || '');
    if (!orgUnitId) return label;
    return `<a href="/d2l/home/${encodeURIComponent(orgUnitId)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function toUtcOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString();
}

function buildCourseOfferingInfo(course, { code, isActive }) {
    const html = (course.Description && course.Description.Html) || '';
    const text = (course.Description && course.Description.Text) || '';
    return {
        Name: course.Name || '',
        Code: code,
        StartDate: toUtcOrNull(course.StartDate),
        EndDate: toUtcOrNull(course.EndDate),
        IsActive: !!isActive,
        Description: {
            Content: html || text,
            Type: html ? 'Html' : 'Text'
        },
        CanSelfRegister: course.CanSelfRegister ?? false
    };
}

function formatApiError(err) {
    return err?.message || String(err);
}

async function postCancelledNews(orgUnitId) {
    const newsPayload = {
        Title: 'This Course Has Been Cancelled',
        Body: {
            Text: 'This course has been officially cancelled for the current semester. Please check Faculty Self-Service for your updated schedule and current active courses. If you would like to be removed from this D2L course shell, please submit a request to the eLearning Office Help Desk. Thank you.',
            Html: `<p>This course has been officially cancelled for the current semester.</p>
                   <p>Please check <a href="https://selfservice.example.edu/Student/Student/Faculty" target="_blank">Faculty Self-Service</a> for your updated schedule and current active courses.</p>
                   <p>If you would like to be removed from this D2L course shell, please submit a request to the 
                   <a href="https://deltacollege.zohodesk.com/portal/" target="_blank">eLearning Office Help Desk</a>.</p>
                   <p>Thank you.</p>`
        },
        StartDate: new Date().toISOString(),
        EndDate: null,
        IsGlobal: false,
        IsPublished: true,
        ShowOnlyInCourseOfferings: false,
        IsAuthorInfoShown: false,
        IsPinned: false,
        IsStartDateShown: false,
        SortOrder: null
    };
    const boundary = 'xxBOUNDARYxx';
    const json = JSON.stringify(newsPayload);
    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--\r\n`;
    return D2LApi._fetch(`/d2l/api/le/1.78/${orgUnitId}/news/`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` },
        body
    });
}

function mapCsvRow(row) {
    const status = getCell(row, ['SEC_STATUS', 'Sec_Status', 'Status']);
    const combined = getCombinedCourseCode(row);
    const courseCode = toShellCourseCode(combined);
    if (!status || !courseCode) return null;
    return {
        CourseCode: courseCode,
        Status: isCancelledStatus(status) ? 'Cancelled' : 'Active'
    };
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize loading containers
    const loadingContainer1 = LoadingUtils.createLoadingBar('loadingContainer1');
    const loadingContainer2 = LoadingUtils.createLoadingBar('loadingContainer2');
    document.querySelector('#tab1 .card').appendChild(loadingContainer1);
    document.querySelector('#tab2 .card').appendChild(loadingContainer2);
    
    // Load semesters
    loadSemesters();
    
    // Set up event listeners
    document.getElementById('runCompareBtn').addEventListener('click', runCompare);
    document.getElementById('downloadReportBtn').addEventListener('click', downloadReport);
    document.getElementById('runCxldPreviewBtn').addEventListener('click', runCxldPreview);
    document.getElementById('processCxldBtn').addEventListener('click', processCxld);
    document.getElementById('downloadUpdateLogBtn').addEventListener('click', downloadUpdateLog);
    document.getElementById('cancelUpdateBtn').addEventListener('click', () => {
        cancelRequested = true;
        document.getElementById('cancelUpdateBtn').disabled = true;
        document.getElementById('cancelUpdateBtn').textContent = 'Cancelling...';
    });
});

function openTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(div => {
        div.classList.remove('active');
        div.style.display = 'none';
    });
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.getElementById(tabId).style.display = 'block';
    document.querySelector(`.tab-button[onclick="openTab('${tabId}')"]`).classList.add('active');
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

async function loadSemesters() {
    try {
        LoadingUtils.showLoadingBar('loadingContainer1');
        LoadingUtils.updateLoadingBar(10, 'Loading semesters...', 'loadingContainer1');
        
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
        
        const filteredSemesters = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
            ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data))
            : data.filter(isCurrentYearSemester);

        const select = document.getElementById('semesterSelect');
        select.innerHTML = '<option value="">Select a Semester</option>';
        filteredSemesters.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.Identifier;
            option.textContent = semester.Name;
            select.appendChild(option);
        });
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer1');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer1');
        }, 500);
    } catch (error) {
        console.error('Failed to load semesters:', error);
        LoadingUtils.hideLoadingBar('loadingContainer1');
    }
}

async function getCoursesBySemester(semesterId) {
    let response = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        response = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/1.35/orgstructure/${semesterId}/children/`
        );
    } else {
        const data = await D2LApi._fetch(
            `/d2l/api/lp/1.35/orgstructure/${semesterId}/children/?pageSize=100`
        );
        if (data.Objects && Array.isArray(data.Objects)) {
            response = data.Objects;
        } else if (Array.isArray(data)) {
            response = data;
        }
    }
    return response;
}

async function runCompare() {
    const semesterId = document.getElementById('semesterSelect').value;
    const file = document.getElementById('csvUpload1').files[0];
    
    if (!semesterId || !file) {
        alert('Please select a semester and upload a CSV file.');
        return;
    }
    
    const btn = document.getElementById('runCompareBtn');
    btn.disabled = true;
    LoadingUtils.showLoadingBar('loadingContainer1');
    LoadingUtils.updateLoadingBar(10, 'Parsing CSV...', 'loadingContainer1');
    
    Papa.parse(file, {
        header: true,
        skipEmptyLines: 'greedy',
        complete: async (results) => {
            try {
                LoadingUtils.updateLoadingBar(30, 'Processing CSV data...', 'loadingContainer1');
                
                csvData = results.data
                    .map(mapCsvRow)
                    .filter(Boolean);
                
                LoadingUtils.updateLoadingBar(50, 'Fetching D2L courses...', 'loadingContainer1');
                courseData = await getCoursesBySemester(semesterId);
                
                LoadingUtils.updateLoadingBar(70, 'Comparing courses...', 'loadingContainer1');
                compareCourses();
                
                LoadingUtils.updateLoadingBar(90, 'Rendering results...', 'loadingContainer1');
                renderResults();
                
                LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer1');
                document.getElementById('downloadReportBtn').style.display = 'inline-flex';
            } catch (error) {
                console.error('Error:', error);
                alert('Error: ' + error.message);
            } finally {
                btn.disabled = false;
                setTimeout(() => {
                    LoadingUtils.hideLoadingBar('loadingContainer1');
                }, 500);
            }
        },
        error: (err) => {
            console.error('CSV parse error:', err);
            alert('Error parsing CSV: ' + err.message);
            btn.disabled = false;
            LoadingUtils.hideLoadingBar('loadingContainer1');
        }
    });
}

function compareCourses() {
    const csvMap = new Map();
    csvData.forEach(row => {
        csvMap.set(row.CourseCode, row.Status);
    });
    
    comparisonResults = courseData.map(course => {
        const courseCode = course.Code.toUpperCase();
        const match = [...csvMap.keys()].find(csvCode => codesMatch(courseCode, csvCode));
        const status = match ? csvMap.get(match) : 'Not Found in CSV';
        
        return {
            OrgUnitId: course.Identifier,
            CourseCode: course.Code,
            CourseName: course.Name,
            Status: status
        };
    });
}

function renderResults() {
    const container = document.getElementById('resultsTableCard');
    container.innerHTML = '';
    
    if (comparisonResults.length === 0) {
        container.innerHTML = '<p>No course data matched.</p>';
        return;
    }
    
    const table = document.createElement('table');
    table.className = 'display';
    table.style.width = '100%';
    table.innerHTML = `
        <thead>
            <tr>
                <th>OrgUnitId</th>
                <th>Course Code</th>
                <th>Course Name</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${comparisonResults.map(row => `
                <tr>
                    <td>${escapeHtml(row.OrgUnitId)}</td>
                    <td>${courseHomeLink(row.OrgUnitId, row.CourseCode)}</td>
                    <td>${courseHomeLink(row.OrgUnitId, row.CourseName)}</td>
                    <td>${escapeHtml(row.Status)}</td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    container.appendChild(table);
    
    // Initialize DataTable
    if (window.jQuery && $.fn.DataTable) {
        $(table).DataTable({
            pageLength: 25,
            dom: '<"top"if>rt<"bottom"lp><"clear">'
        });
    }
}

function downloadReport() {
    const csv = Papa.unparse(comparisonResults);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `course_comparison_report_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

async function runCxldPreview() {
    const file = document.getElementById('csvUpload2').files[0];
    if (!file) {
        alert('Upload a CSV file.');
        return;
    }
    
    const btn = document.getElementById('runCxldPreviewBtn');
    btn.disabled = true;
    LoadingUtils.showLoadingBar('loadingContainer2');
    LoadingUtils.updateLoadingBar(10, 'Parsing CSV...', 'loadingContainer2');
    
    Papa.parse(file, {
        header: true,
        complete: async (results) => {
            try {
                updateLogData = [];
                previewData = [];
                
                LoadingUtils.updateLoadingBar(30, 'Filtering cancelled courses...', 'loadingContainer2');
                const csvRows = results.data.filter(row =>
                    row.Status?.trim().toUpperCase() === 'CANCELLED' &&
                    row.OrgUnitId?.trim()
                ).map(row => ({
                    OrgUnitId: row.OrgUnitId.trim(),
                    CourseCode: row.CourseCode || '',
                    CourseName: row.CourseName || '',
                    Status: 'Cancelled'
                }));
                
                LoadingUtils.updateLoadingBar(50, 'Checking courses...', 'loadingContainer2');
                let processed = 0;
                
                for (const row of csvRows) {
                    processed++;
                    LoadingUtils.updateLoadingBar(50 + Math.floor((processed / csvRows.length) * 45), `Checking ${processed}/${csvRows.length}...`, 'loadingContainer2');
                    
                    try {
                        const course = await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${row.OrgUnitId}`);
                        const alreadyCxld = course.Code.trim().startsWith('CXLD -');
                        
                        let newsItems = [];
                        try {
                            newsItems = await D2LApi._fetch(`/d2l/api/le/1.78/${row.OrgUnitId}/news/`);
                        } catch (e) {
                            // News API might fail, continue
                        }
                        const newsExists = Array.isArray(newsItems) && newsItems.some(n => n.Title === 'This Course Has Been Cancelled');
                        
                        let status = 'Will Update';
                        if (alreadyCxld && newsExists) status = 'Skipped - CXLD and News Exists';
                        else if (alreadyCxld) status = 'Only News Will Be Added';
                        else if (newsExists) status = 'Only Course Will Be Updated';
                        
                        previewData.push({
                            OrgUnitId: row.OrgUnitId,
                            CourseCode: course.Code,
                            CourseName: course.Name,
                            Status: status
                        });
                    } catch (err) {
                        previewData.push({
                            OrgUnitId: row.OrgUnitId,
                            CourseCode: row.CourseCode,
                            CourseName: row.CourseName,
                            Status: 'Failed to Load'
                        });
                    }
                }
                
                LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer2');
                renderPreviewTable(previewData);
                document.getElementById('processCxldBtn').style.display = 'inline-flex';
            } catch (error) {
                console.error('Error:', error);
                alert('Error: ' + error.message);
            } finally {
                btn.disabled = false;
                setTimeout(() => {
                    LoadingUtils.hideLoadingBar('loadingContainer2');
                }, 500);
            }
        },
        error: (err) => {
            console.error('CSV parse error:', err);
            alert('Error parsing CSV: ' + err.message);
            btn.disabled = false;
            LoadingUtils.hideLoadingBar('loadingContainer2');
        }
    });
}

function renderPreviewTable(data) {
    const container = document.getElementById('updateLog');
    const table = document.createElement('table');
    table.className = 'display';
    table.style.width = '100%';
    table.innerHTML = `
        <thead>
            <tr>
                <th>OrgUnitId</th>
                <th>Course Code</th>
                <th>Course Name</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${data.map(row => `
                <tr>
                    <td>${escapeHtml(row.OrgUnitId)}</td>
                    <td>${courseHomeLink(row.OrgUnitId, row.CourseCode)}</td>
                    <td>${courseHomeLink(row.OrgUnitId, row.CourseName)}</td>
                    <td>${escapeHtml(row.Status)}</td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    container.innerHTML = '';
    container.appendChild(table);
    
    // Initialize DataTable
    if (window.jQuery && $.fn.DataTable) {
        $(table).DataTable({
            pageLength: 25,
            dom: '<"top"if>rt<"bottom"lp><"clear">'
        });
    }
}

async function processCxld() {
    cancelRequested = false;
    updateLogData = [];
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressContainer = document.getElementById('progressContainer');
    const processBtn = document.getElementById('processCxldBtn');
    
    progressBar.max = previewData.length;
    progressBar.value = 0;
    progressContainer.style.display = 'block';
    processBtn.disabled = true;
    
    LoadingUtils.showLoadingModal('Processing cancellations...');
    
    for (let i = 0; i < previewData.length; i++) {
        const row = previewData[i];
        const index = i + 1;
        
        if (cancelRequested) {
            updateLogData.push({ ...row, Result: 'Cancelled by user' });
            continue;
        }
        
        LoadingUtils.updateLoadingModal(Math.floor((index / previewData.length) * 100), `Processing ${index}/${previewData.length}...`);
        progressBar.value = index;
        progressText.textContent = `Progress: ${index} / ${previewData.length}`;
        
        try {
            const course = await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${row.OrgUnitId}`);
            const alreadyCxld = String(course.Code || '').trim().startsWith('CXLD -');

            let newsItems = [];
            try {
                newsItems = await D2LApi._fetch(`/d2l/api/le/1.78/${row.OrgUnitId}/news/`);
            } catch (e) {
                // Continue
            }
            const newsExists = Array.isArray(newsItems) && newsItems.some(n => n.Title === 'This Course Has Been Cancelled');

            const resultMsg = [];

            if (!alreadyCxld) {
                try {
                    const nextCode = `CXLD - ${course.Code}`.trim();
                    if (nextCode.length > 50) {
                        throw new Error(`Course code would exceed 50 characters: ${nextCode}`);
                    }
                    const payload = buildCourseOfferingInfo(course, {
                        code: nextCode,
                        isActive: false
                    });
                    await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${row.OrgUnitId}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload)
                    });
                    resultMsg.push('Course Updated');
                } catch (err) {
                    resultMsg.push(`Course update failed - ${formatApiError(err)}`);
                }
            }

            if (!newsExists) {
                try {
                    await postCancelledNews(row.OrgUnitId);
                    resultMsg.push('News Posted');
                } catch (err) {
                    resultMsg.push(`News post failed - ${formatApiError(err)}`);
                }
            }

            if (alreadyCxld && newsExists) {
                resultMsg.push('Skipped - Already CXLD and News Exists');
            }

            updateLogData.push({
                OrgUnitId: row.OrgUnitId,
                CourseCode: course.Code,
                CourseName: course.Name,
                Result: resultMsg.join(' & ')
            });
        } catch (err) {
            updateLogData.push({
                OrgUnitId: row.OrgUnitId,
                CourseCode: row.CourseCode,
                CourseName: row.CourseName,
                Result: `Failed - ${formatApiError(err)}`
            });
        }
    }
    
    LoadingUtils.updateLoadingModal(100, 'Complete!');
    setTimeout(() => {
        LoadingUtils.hideLoadingModal();
    }, 500);
    
    progressContainer.style.display = 'none';
    renderUpdateLog();
    processBtn.disabled = false;
}

function renderUpdateLog() {
    const container = document.getElementById('updateLog');
    const table = document.createElement('table');
    table.className = 'display';
    table.style.width = '100%';
    table.innerHTML = `
        <thead>
            <tr>
                <th>OrgUnitId</th>
                <th>Course Code</th>
                <th>Course Name</th>
                <th>Result</th>
            </tr>
        </thead>
        <tbody>
            ${updateLogData.map(row => `
                <tr>
                    <td>${escapeHtml(row.OrgUnitId)}</td>
                    <td>${courseHomeLink(row.OrgUnitId, row.CourseCode)}</td>
                    <td>${courseHomeLink(row.OrgUnitId, row.CourseName)}</td>
                    <td>${escapeHtml(row.Result)}</td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    container.innerHTML = '';
    container.appendChild(table);
    document.getElementById('downloadUpdateLogBtn').style.display = 'inline-flex';
    
    // Initialize DataTable
    if (window.jQuery && $.fn.DataTable) {
        $(table).DataTable({
            pageLength: 25,
            dom: '<"top"if>rt<"bottom"lp><"clear">'
        });
    }
}

function downloadUpdateLog() {
    const csv = Papa.unparse(updateLogData);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cancellation-log_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

// Make openTab globally accessible
window.openTab = openTab;
