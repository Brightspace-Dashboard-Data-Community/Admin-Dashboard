/**
 * Follow-Up Check
 * Checks student access after notification by comparing uploaded CSV with current access data
 */

let followUpTable;

document.addEventListener('DOMContentLoaded', () => {
    // Button: Check Follow-Up
    document.getElementById('checkFollowUpBtn').addEventListener('click', async () => {
        const file = document.getElementById('followUpCsv').files[0];
        if (!file) {
            showStatusMessage('Please upload a CSV file first.', 'warning');
            return;
        }

        // Initialize loading container if not exists
        let loadingContainer = document.getElementById('followUpLoadingContainer');
        if (!loadingContainer.querySelector('.loading-bar')) {
            const loadingBar = LoadingUtils.createLoadingBar('followUpLoadingBar');
            loadingContainer.appendChild(loadingBar);
        }

        LoadingUtils.showLoadingBar('followUpLoadingBar');
        LoadingUtils.updateLoadingBar(10, 'Parsing CSV...', 'followUpLoadingBar');
        
        const studentRows = await parseCsv(file);
        LoadingUtils.updateLoadingBar(30, 'Checking student access...', 'followUpLoadingBar');
        
        const results = await checkStudentAccess(studentRows);
        LoadingUtils.updateLoadingBar(90, 'Populating table...', 'followUpLoadingBar');
        
        populateFollowUpTable(results);
        
        LoadingUtils.updateLoadingBar(100, 'Check complete!', 'followUpLoadingBar');
        
        // Show table and download button
        document.getElementById('followUpTableContainer').style.display = 'block';
        document.getElementById('downloadFollowUpBtn').style.display = 'inline-flex';
    });

    // Button: Download Follow-Up CSV
    document.getElementById('downloadFollowUpBtn').addEventListener('click', () => {
        if (!followUpTable) return;

        const data = followUpTable.rows().data().toArray();

        const csv = Papa.unparse(data, {
            columns: [
                'OrgUnitId',
                'CourseCode',
                'FirstName',
                'LastName',
                'OrgDefinedId',
                'Username',
                'Email',
                'previousAccess',
                'currentAccess',
                'status'
            ]
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `follow-up-check-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
});

function showStatusMessage(message, type = 'info') {
    // Try to use the status message from the report tab, or create a temporary one
    let statusEl = document.getElementById('statusMessage');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'statusMessage';
        statusEl.className = 'status-message';
        document.querySelector('#followup-tab .card').appendChild(statusEl);
    }
    
    statusEl.textContent = message;
    statusEl.className = 'status-message';
    statusEl.classList.add(`status-${type}`);
    statusEl.style.display = 'block';
    
    if (type === 'info') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 5000);
    }
}

function parseCsv(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: results => resolve(results.data),
            error: err => reject(err)
        });
    });
}

async function checkStudentAccess(students) {
    const results = [];
    const total = students.length;

    for (let i = 0; i < students.length; i++) {
        const student = students[i];
        const {
            OrgUnitId,
            Username,
            'First Name': FirstName,
            'Last Name': LastName,
            Email,
            'Course Code': CourseCode,
            'Last Accessed': PreviousAccess,
            OrgDefinedId
        } = student;

        let currentAccess = 'User Not Found';
        let status = '⚠️ Not Found';

        try {
            const sanitizedId = sanitizeOrgUnitId(OrgUnitId);
            const classlist = await D2LApi._fetch(`/d2l/api/le/1.82/${sanitizedId}/classlist/`);
            const foundUser = Array.isArray(classlist) ? classlist.find(user => user.OrgDefinedId === OrgDefinedId) : null;

            if (foundUser) {
                if (foundUser.LastAccessed) {
                    currentAccess = moment(foundUser.LastAccessed).format('YYYY-MM-DD HH:mm');
                    const prev = moment(PreviousAccess, 'M/D/YYYY, h:mm:ss A', true); // CSV format
                    const curr = moment(foundUser.LastAccessed);

                    status = (prev.isValid() && curr.isAfter(prev))
                        ? '✅ Accessed Since Contact'
                        : '❌ Still Inactive';
                } else {
                    currentAccess = 'Never';
                    status = '❌ Still Inactive';
                }
            }

        } catch (err) {
            console.error(`Error checking user ${OrgDefinedId} in course ${OrgUnitId}:`, err);
            currentAccess = 'Error';
            status = '⚠️ API Error';
        }

        results.push({
            OrgUnitId,
            CourseCode,
            FirstName,
            LastName,
            OrgDefinedId,
            Username,
            Email,
            previousAccess: PreviousAccess,
            currentAccess,
            status
        });

        // Update progress
        const progress = 30 + Math.floor((i + 1) / total * 60);
        LoadingUtils.updateLoadingBar(progress, `Checking ${i + 1} of ${total} students...`, 'followUpLoadingBar');
    }

    return results;
}

function sanitizeOrgUnitId(orgUnitId) {
    if (typeof orgUnitId === 'string' && orgUnitId.startsWith('$')) {
        return orgUnitId.slice(1);
    }
    return orgUnitId;
}

function populateFollowUpTable(data) {
    if (followUpTable) {
        followUpTable.clear().rows.add(data).draw();
    } else {
        followUpTable = $('#followUpTable').DataTable({
            data,
            columns: [
                { data: 'OrgUnitId' },
                { data: 'OrgDefinedId' },
                { data: 'CourseCode' },
                { data: 'FirstName' },
                { data: 'LastName' },
                { data: 'Username' },
                { data: 'Email' },
                { data: 'previousAccess' },
                { data: 'currentAccess' },
                { data: 'status' }
            ],
            pageLength: 25,
            dom: '<"top"if>rt<"bottom"lp><"clear">'
        });
    }
}
