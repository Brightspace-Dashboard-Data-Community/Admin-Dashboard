/**
 * Dormant logins report (active accounts, no login for N years)
 * Finds users with RoleId 101 (Student) or 102 (Instructor) who have been inactive for a specified number of years
 */

let inactiveTable = null;
let currentInactiveUsers = [];

// Grab the most recent full "Users" extract and return parsed CSV
async function getUsersBDSData() {
    const extractList = await D2LApi._fetch(
        '/d2l/api/lp/1.50/datasets/bds/b21a6414-38f8-4da8-9a65-8b5586f9fe3b/plugins/1d6d722e-b572-456f-97c1-d526570daa6b/extracts'
    );

    if (!extractList?.Objects?.length) {
        throw new Error('❌ No extracts found for \'Users\' dataset');
    }

    const latestExtract = extractList.Objects[0];
    const zipRes = await fetch(latestExtract.DownloadLink);
    const blob = await zipRes.blob();
    const zip = await JSZip.loadAsync(blob);

    const csvFileName = Object.keys(zip.files).find(name => name.endsWith('.csv'));
    const csvText = await zip.file(csvFileName).async('string');
    return Papa.parse(csvText, { header: true }).data;
}

function parseDate(dateStr) {
    const d = new Date(dateStr);
    return isNaN(d) ? null : d;
}

async function processInactiveUsers() {
    const summaryEl = document.querySelector('#summary');
    const fetchBtn = document.getElementById('fetchBtn');
    const downloadBtn = document.getElementById('downloadCsv');
    
    // Disable button and show loading modal
    fetchBtn.disabled = true;
    downloadBtn.style.display = 'none';
    
    // Destroy existing table if it exists
    if (inactiveTable) {
        inactiveTable.destroy();
        inactiveTable = null;
    }
    
    LoadingUtils.showLoadingModal('Initializing report...', 'loadingModal', () => {
        // Cancel callback
    });
    LoadingUtils.updateLoadingModal(10, 'Processing BDS extract...', 'loadingModal');
    
    summaryEl.textContent = 'Processing BDS extract...';
    
    try {
        const thresholdYears = parseInt(document.getElementById('yearSelect').value);
        const cutoffDate = new Date();
        cutoffDate.setFullYear(cutoffDate.getFullYear() - thresholdYears);

        LoadingUtils.updateLoadingModal(30, 'Fetching user data from BDS...', 'loadingModal');
        const bdsUsers = await getUsersBDSData();

        LoadingUtils.updateLoadingModal(60, 'Filtering inactive users...', 'loadingModal');
        const inactive = bdsUsers
            .filter(row => row.OrgRoleId === '101' || row.OrgRoleId === '102')
            .map(row => {
                const lastAccessDate = parseDate(row.LastAccessed);
                return {
                    OrgDefinedId: row.OrgDefinedId,
                    FirstName: row.FirstName,
                    LastName: row.LastName,
                    Username: row.Username,
                    Email: row.ExternalEmail,
                    Role: row.OrgRoleId === '101' ? 'Student' : 'Instructor',
                    LastLogin: lastAccessDate ? lastAccessDate.toISOString().split('T')[0] : 'Never',
                    LoginDate: lastAccessDate
                };
            })
            .filter(user => !user.LoginDate || user.LoginDate < cutoffDate);

        LoadingUtils.updateLoadingModal(80, 'Populating table...', 'loadingModal');
        
        summaryEl.textContent = `🧹 ${inactive.length} users with RoleId 101 or 102 inactive for ${thresholdYears}+ years`;

        const tbody = document.querySelector('#inactiveTable tbody');
        tbody.innerHTML = '';
        
        // Escape HTML to prevent XSS
        const escapeHtml = (text) => {
            if (text == null) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };
        
        inactive.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(u.OrgDefinedId)}</td>
                <td>${escapeHtml(u.FirstName)}</td>
                <td>${escapeHtml(u.LastName)}</td>
                <td>${escapeHtml(u.Username)}</td>
                <td>${escapeHtml(u.Email)}</td>
                <td>${escapeHtml(u.Role)}</td>
                <td>${escapeHtml(u.LastLogin)}</td>`;
            tbody.appendChild(tr);
        });

        // Initialize or refresh DataTable with better configuration
        inactiveTable = $('#inactiveTable').DataTable({
            data: inactive,
            columns: [
                { data: 'OrgDefinedId' },
                { data: 'FirstName' },
                { data: 'LastName' },
                { data: 'Username' },
                { data: 'Email' },
                { data: 'Role' },
                { data: 'LastLogin' }
            ],
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

        currentInactiveUsers = inactive;
        downloadBtn.style.display = 'inline-flex';
        
        LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
        setTimeout(() => {
            LoadingUtils.hideLoadingModal('loadingModal');
        }, 1000);
    } catch (error) {
        console.error('Error processing inactive users:', error);
        summaryEl.textContent = 'Error: ' + (error.message || 'Failed to process users');
        LoadingUtils.hideLoadingModal('loadingModal');
    } finally {
        fetchBtn.disabled = false;
    }
}

function downloadCSV() {
    if (!currentInactiveUsers || currentInactiveUsers.length === 0) {
        alert('No data to download.');
        return;
    }
    
    const rows = currentInactiveUsers.map(u => ({
        OrgDefinedId: u.OrgDefinedId,
        FirstName: u.FirstName,
        LastName: u.LastName,
        Username: u.Username,
        Email: u.Email,
        Role: u.Role,
        LastLogin: u.LastLogin
    }));
    
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inactive-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Set up event listeners
    document.getElementById('fetchBtn').addEventListener('click', processInactiveUsers);
    document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
});
