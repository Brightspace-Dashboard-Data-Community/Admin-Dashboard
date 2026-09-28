/**
 * Retirement / retired usernames export
 * Lists users whose username contains ".retired." (from the retire-accounts tool).
 * Two data sources: Data Hub file (fast) or paged classlist for org 1001 (slower, no Data Hub dependency).
 */

let retirementTable = null;
let currentRetiredUsers = [];

const RETIRED_PATTERN = '.retired.';
const PAGED_ORG_UNIT_ID = 1001;
/** LP enrollments API for org 1001. Use isActive=false to get INACTIVE users (where .retired. users are). */
const ENROLLMENTS_1001_BASE = '/d2l/api/lp/1.47/enrollments/orgUnits/1001/users/';

function getSelectedSource() {
    const active = document.querySelector('.source-tab.active');
    return (active && active.getAttribute('data-source')) || 'datahub';
}

// Load user data from Data Hub (same method as deleted-users-report.js)
async function getUsersBDSData() {
    if (!window.JSZip) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    const fullDataResponse = await fetch(
        '/d2l/api/lp/1.43/datasets/bds/b21a6414-38f8-4da8-9a65-8b5586f9fe3b/plugins/1d6d722e-b572-456f-97c1-d526570daa6b/extracts?type=full',
        { method: 'GET', credentials: 'include' }
    );

    if (!fullDataResponse.ok) {
        throw new Error(`Failed to fetch dataset extracts: ${fullDataResponse.status} ${fullDataResponse.statusText}`);
    }

    const fullDataJson = await fullDataResponse.json();
    if (!fullDataJson.Objects || fullDataJson.Objects.length === 0) {
        throw new Error('No full dataset extracts found');
    }

    const sortedExtracts = fullDataJson.Objects.sort(
        (a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate)
    );
    const latestExtract = sortedExtracts[0];
    const downloadUrl = latestExtract?.DownloadLink;
    if (!downloadUrl) throw new Error('No download URL found for the full extract');

    const zipResponse = await fetch(downloadUrl, { method: 'GET', credentials: 'include' });
    if (!zipResponse.ok) throw new Error(`Failed to download full dataset ZIP: ${zipResponse.status}`);

    const zipBlob = await zipResponse.blob();
    const zip = await window.JSZip.loadAsync(zipBlob);
    const csvFile = Object.values(zip.files).find(file => file.name.endsWith('.csv'));
    if (!csvFile) throw new Error('No CSV file found in the dataset ZIP');

    const csvContent = await csvFile.async('string');
    if (!csvContent || csvContent.trim().length === 0) throw new Error('CSV file is empty');

    const parsed = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => (h || '').trim()
    });

    if (parsed.errors && parsed.errors.length > 0) {
        console.warn('CSV parsing errors:', parsed.errors);
    }

    return parsed.data || [];
}

/**
 * Fetch all enrolled users for org 1001 by requesting both inactive and active.
 * Retired users are INACTIVE, so we must pass isActive=false (and optionally isActive=true to get all).
 * LP API returns PagedResultSet: { Items: OrgUnitUser[], PagingInfo: { Bookmark, HasMoreItems } }.
 */
async function fetchUsersViaPagedClasslist() {
    const pageSize = 100;
    const maxPages = 300;
    const byUserId = new Map();

    async function fetchStream(isActive) {
        const param = isActive === undefined ? '' : 'isActive=' + (isActive ? 'true' : 'false');
        let url = ENROLLMENTS_1001_BASE + '?pageSize=' + pageSize + (param ? '&' + param : '');
        let bookmark = null;
        let pageCount = 0;

        while (pageCount < maxPages) {
            pageCount++;
            if (bookmark) {
                url = ENROLLMENTS_1001_BASE + '?pageSize=' + pageSize + (param ? '&' + param : '') + '&bookmark=' + encodeURIComponent(bookmark);
            }
            const response = await D2LApi._fetch(url);
            const items = response.Items || response.Objects || (Array.isArray(response) ? response : []);
            for (const item of items) {
                const user = item.User || item;
                const userId = user.UserId ?? user.Identifier ?? user.Id;
                if (userId == null || byUserId.has(userId)) continue;
                byUserId.set(userId, {
                    UserId: userId,
                    OrgDefinedId: user.OrgDefinedId ?? '',
                    FirstName: user.FirstName ?? '',
                    LastName: user.LastName ?? '',
                    UserName: user.UserName ?? user.Username ?? '',
                    Username: user.UserName ?? user.Username ?? '',
                    ExternalEmail: user.ExternalEmail ?? user.Email ?? '',
                    Email: user.ExternalEmail ?? user.Email ?? '',
                    RoleId: ((item.Role && (item.Role.Id ?? item.Role.Identifier)) || user.RoleId) ?? '',
                    IsActive: user.Activation?.IsActive !== undefined ? user.Activation.IsActive : isActive,
                    _fromEnrollment: true
                });
            }
            const paging = response.PagingInfo || response.pagingInfo;
            const hasMore = paging && paging.HasMoreItems;
            bookmark = paging && paging.Bookmark;
            if (!hasMore || !bookmark || items.length === 0) break;
        }
    }

    await fetchStream(false);
    await fetchStream(true);

    return Array.from(byUserId.values());
}

function parseDate(dateStr) {
    if (dateStr == null || String(dateStr).trim() === '') return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function formatDateForDisplay(dateVal) {
    const d = dateVal instanceof Date ? dateVal : parseDate(dateVal);
    if (!d) return '';
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

function formatDateForCSV(dateVal) {
    const d = dateVal instanceof Date ? dateVal : parseDate(dateVal);
    if (!d) return '';
    return d.toISOString();
}

/**
 * Filter users whose username contains ".retired." and map to display/export shape.
 * Preserves raw row for CSV (BDS has _raw; paged has _fromEnrollment and no timestamp fields).
 */
function filterAndMapRetiredUsers(allRows, fromPaged) {
    const usernameKeys = ['UserName', 'Username', 'userName', 'UniqueName'];
    const retired = [];

    for (const row of allRows) {
        const username = usernameKeys.reduce((acc, key) => acc || row[key], '') || '';
        if (String(username).indexOf(RETIRED_PATTERN) === -1) continue;

        const roleId = String(row.OrgRoleId || row.RoleId || row.Role?.Identifier || row.Role?.Id || '').trim();
        const roleName =
            roleId === '101' ? 'Student' :
            roleId === '102' ? 'Instructor' :
            roleId === '100' ? 'Admin' :
            roleId ? `Role ${roleId}` : 'Unknown';

        const lastAccessed = fromPaged ? null : parseDate(row.LastAccessed || row.LastAccessedDate);
        const createdDate = fromPaged ? null : parseDate(row.CreatedDate || row.Created);

        retired.push({
            UserId: row.UserId ?? row.Identifier ?? '',
            OrgDefinedId: row.OrgDefinedId ?? '',
            FirstName: row.FirstName ?? '',
            LastName: row.LastName ?? '',
            Username: username,
            Email: row.ExternalEmail ?? row.EmailAddress ?? row.Email ?? '',
            Role: roleName,
            RoleId: roleId,
            IsActive: row.IsActive != null ? (row.IsActive === true || row.IsActive === 'true' || row.IsActive === '1') : '',
            LastAccessed: lastAccessed ? formatDateForDisplay(lastAccessed) : '',
            LastAccessedISO: lastAccessed ? lastAccessed.toISOString() : '',
            CreatedDate: createdDate ? formatDateForDisplay(createdDate) : '',
            CreatedDateISO: createdDate ? createdDate.toISOString() : '',
            _raw: row
        });
    }

    return retired;
}

async function processRetirementReport() {
    const summaryEl = document.querySelector('#summary');
    const fetchBtn = document.getElementById('fetchBtn');
    const downloadBtn = document.getElementById('downloadCsv');
    const source = getSelectedSource();
    const fromPaged = source === 'paged';

    fetchBtn.disabled = true;
    downloadBtn.style.display = 'none';

    if (retirementTable) {
        retirementTable.destroy();
        retirementTable = null;
    }

    LoadingUtils.showLoadingModal('Loading report...', 'loadingModal', () => {});
    if (fromPaged) {
        LoadingUtils.updateLoadingModal(10, `Paging through org ${PAGED_ORG_UNIT_ID} classlist...`, 'loadingModal');
        summaryEl.textContent = `Fetching users from org unit ${PAGED_ORG_UNIT_ID} (this may take a while)...`;
    } else {
        LoadingUtils.updateLoadingModal(20, 'Loading Data Hub user extract...', 'loadingModal');
        summaryEl.textContent = 'Loading Data Hub user extract...';
    }

    try {
        let allUsers;
        if (fromPaged) {
            allUsers = await fetchUsersViaPagedClasslist();
            LoadingUtils.updateLoadingModal(70, 'Filtering retired users...', 'loadingModal');
        } else {
            allUsers = await getUsersBDSData();
            LoadingUtils.updateLoadingModal(50, 'Filtering retired users...', 'loadingModal');
        }

        const retired = filterAndMapRetiredUsers(allUsers, fromPaged);
        currentRetiredUsers = retired;

        LoadingUtils.updateLoadingModal(80, 'Building table...', 'loadingModal');

        summaryEl.textContent = `Found ${retired.length} user(s) with username containing "${RETIRED_PATTERN}". All rows are loaded—use "Show X entries" or "All" above the table to view more.`;

        const escapeHtml = text => {
            if (text == null) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };

        retirementTable = $('#retirementTable').DataTable({
            data: retired,
            columns: [
                { data: 'UserId' },
                { data: 'OrgDefinedId' },
                { data: 'FirstName' },
                { data: 'LastName' },
                { data: 'Username' },
                { data: 'Email' },
                { data: 'Role' },
                {
                    data: 'IsActive',
                    render: (val) => escapeHtml(val === true || val === 'true' || val === '1' ? 'Yes' : val === false || val === 'false' || val === '0' ? 'No' : (val !== undefined && val !== null && val !== '' ? String(val) : ''))
                },
                { data: 'LastAccessed' },
                { data: 'CreatedDate' }
            ],
            pageLength: 100,
            lengthMenu: [[25, 50, 100, 200, 500, -1], [25, 50, 100, 200, 500, 'All']],
            order: [[4, 'asc']],
            dom: '<"top"lf>rt<"bottom"ip><"clear">',
            language: {
                search: 'Search:',
                lengthMenu: 'Show _MENU_ entries',
                info: 'Showing _START_ to _END_ of _TOTAL_ entries',
                infoEmpty: 'No entries to show',
                infoFiltered: '(filtered from _MAX_ total entries)',
                paginate: { first: 'First', last: 'Last', next: 'Next', previous: 'Previous' }
            },
            responsive: true,
            scrollX: true
        });

        downloadBtn.style.display = 'inline-flex';

        LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
        setTimeout(() => LoadingUtils.hideLoadingModal('loadingModal'), 800);
    } catch (err) {
        console.error('Retirement report error:', err);
        summaryEl.textContent = 'Error: ' + (err.message || 'Failed to load retired users');
        LoadingUtils.hideLoadingModal('loadingModal');
    } finally {
        fetchBtn.disabled = false;
    }
}

/**
 * Build CSV rows with all important user fields and timestamps.
 * Uses normalized fields first, then adds any extra timestamp/important keys from raw BDS row.
 */
function buildCSVRows() {
    const keyColumns = [
        'UserId',
        'OrgDefinedId',
        'FirstName',
        'LastName',
        'Username',
        'Email',
        'Role',
        'RoleId',
        'IsActive',
        'LastAccessed',
        'LastAccessedISO',
        'CreatedDate',
        'CreatedDateISO'
    ];

    const timestampLikeKeys = [
        'LastAccessed',
        'LastAccessedDate',
        'CreatedDate',
        'Created',
        'ModifiedDate',
        'Modified',
        'LastLoginDate',
        'LastLogin'
    ];

    return currentRetiredUsers.map(u => {
        const row = {};
        keyColumns.forEach(col => {
            const val = u[col];
            row[col] = val == null ? '' : String(val);
        });
        // Add any other date/important fields from raw BDS row that we didn't already include
        const raw = u._raw || {};
        const existingKeys = new Set(Object.keys(row));
        timestampLikeKeys.forEach(k => {
            if (existingKeys.has(k)) return;
            if (raw[k] != null && String(raw[k]).trim() !== '') {
                row[k] = String(raw[k]);
            }
        });
        // Include any remaining raw keys that look important (Id, Name, Email, Date, Active)
        ['Identifier', 'Activation', 'ExternalEmail', 'EmailAddress'].forEach(k => {
            if (existingKeys.has(k)) return;
            if (raw[k] != null && String(raw[k]).trim() !== '') {
                row[k] = String(raw[k]);
            }
        });
        return row;
    });
}

function downloadCSV() {
    if (!currentRetiredUsers || currentRetiredUsers.length === 0) {
        alert('No data to download.');
        return;
    }

    const rows = buildCSVRows();
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retirement-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Switch the selected data source tab. Exposed globally so inline onclick works reliably.
 * @param {'datahub'|'paged'} source
 */
function switchRetirementSource(source) {
    const tabList = document.getElementById('sourceTabList');
    const descDataHub = document.getElementById('sourceDescDataHub');
    const descPaged = document.getElementById('sourceDescPaged');
    if (!tabList) return;

    const allTabs = tabList.querySelectorAll('.source-tab');
    allTabs.forEach(t => {
        const isActive = t.getAttribute('data-source') === source;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (source === 'paged') {
        if (descDataHub) descDataHub.style.display = 'none';
        if (descPaged) descPaged.style.display = 'block';
    } else {
        if (descDataHub) descDataHub.style.display = 'block';
        if (descPaged) descPaged.style.display = 'none';
    }
}

// Expose for inline onclick (works even if DOMContentLoaded timing varies)
window.switchRetirementSource = switchRetirementSource;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('fetchBtn').addEventListener('click', processRetirementReport);
    document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
});
