/**
 * Inactive Status Report
 * Lists all users whose account status is INACTIVE (IsActive = false).
 * Unlike the dormant-logins report (active accounts, no login for N years),
 * this report shows users explicitly marked as inactive in D2L.
 * Data sources: Data Hub user extract (filter IsActive=false) or paged enrollments API (isActive=false).
 */

let inactiveStatusTable = null;
let currentInactiveStatusUsers = [];

const PAGED_ORG_UNIT_ID = 1001;
const ENROLLMENTS_BASE = '/d2l/api/lp/1.47/enrollments/orgUnits/' + PAGED_ORG_UNIT_ID + '/users/';

function getSelectedSource() {
    const active = document.querySelector('.source-tab.active');
    return (active && active.getAttribute('data-source')) || 'datahub';
}

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
        throw new Error('Failed to fetch dataset extracts: ' + fullDataResponse.status + ' ' + fullDataResponse.statusText);
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
    if (!zipResponse.ok) throw new Error('Failed to download full dataset ZIP: ' + zipResponse.status);

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

/** Same as never-logged-in: detect IsActive from BDS row (IsActive, Active, Activation, etc.). */
function normalizeIsActive(row) {
    const v = row.IsActive ?? row.Active ?? row.Activation ?? row['Is Active'] ?? row['Active Status'];
    if (v == null || v === '') return undefined;
    const s = String(v).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'active') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === 'inactive') return false;
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    return undefined;
}

function getVal(row, keys) {
    for (const k of keys) {
        if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
    }
    return '';
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

/**
 * Filter BDS rows to only users marked inactive (IsActive === false).
 */
function filterInactiveFromBDS(allRows) {
    const result = [];
    const usernameKeys = ['UserName', 'Username', 'userName', 'UniqueName'];

    for (const row of allRows) {
        if (normalizeIsActive(row) !== false) continue;

        const username = usernameKeys.reduce((acc, key) => acc || row[key], '') || getVal(row, ['Username', 'UserName']);
        const roleId = String(row.OrgRoleId || row.RoleId || row.Role?.Identifier || row.Role?.Id || '').trim();
        const roleName =
            roleId === '101' ? 'Student' :
            roleId === '102' ? 'Instructor' :
            roleId === '100' ? 'Admin' :
            roleId ? 'Role ' + roleId : 'Unknown';

        const lastAccessed = parseDate(row.LastAccessed || row.LastAccessedDate || row['Last Login Date'] || row.LastLoginDate);

        result.push({
            UserId: getVal(row, ['UserId', 'Identifier', 'Id']) || '',
            OrgDefinedId: getVal(row, ['OrgDefinedId', 'Org Defined Id']) || '',
            FirstName: getVal(row, ['First Name', 'FirstName']) || '',
            LastName: getVal(row, ['Last Name', 'LastName']) || '',
            Username: username,
            Email: getVal(row, ['Email', 'EmailAddress', 'ExternalEmail']) || '',
            Role: roleName,
            RoleId: roleId,
            IsActive: 'No',
            LastAccessed: lastAccessed ? formatDateForDisplay(lastAccessed) : '',
            _raw: row
        });
    }

    return result;
}

/**
 * Fetch only inactive users via paged enrollments API (isActive=false).
 */
async function fetchInactiveUsersViaPagedAPI() {
    const pageSize = 100;
    const maxPages = 500;
    const users = [];
    let url = ENROLLMENTS_BASE + '?pageSize=' + pageSize + '&isActive=false';
    let bookmark = null;
    let pageCount = 0;

    while (pageCount < maxPages) {
        pageCount++;
        if (bookmark) {
            url = ENROLLMENTS_BASE + '?pageSize=' + pageSize + '&isActive=false&bookmark=' + encodeURIComponent(bookmark);
        }
        const response = await D2LApi._fetch(url);
        const items = response.Items || response.Objects || (Array.isArray(response) ? response : []);
        for (const item of items) {
            const user = item.User || item;
            const userId = user.UserId ?? user.Identifier ?? user.Id;
            if (userId == null) continue;

            const roleId = String((item.Role && (item.Role.Id ?? item.Role.Identifier)) || user.RoleId || '').trim();
            const roleName =
                roleId === '101' ? 'Student' :
                roleId === '102' ? 'Instructor' :
                roleId === '100' ? 'Admin' :
                roleId ? 'Role ' + roleId : 'Unknown';

            users.push({
                UserId: userId,
                OrgDefinedId: user.OrgDefinedId ?? '',
                FirstName: user.FirstName ?? '',
                LastName: user.LastName ?? '',
                Username: user.UserName ?? user.Username ?? '',
                Email: user.ExternalEmail ?? user.Email ?? '',
                Role: roleName,
                RoleId: roleId,
                IsActive: 'No',
                LastAccessed: '',
                _raw: null
            });
        }
        const paging = response.PagingInfo || response.pagingInfo;
        const hasMore = paging && paging.HasMoreItems;
        bookmark = paging && paging.Bookmark;
        if (!hasMore || !bookmark || items.length === 0) break;
    }

    return users;
}

async function runReport() {
    const summaryEl = document.querySelector('#summary');
    const fetchBtn = document.getElementById('fetchBtn');
    const downloadBtn = document.getElementById('downloadCsv');
    const source = getSelectedSource();
    const fromPaged = source === 'paged';

    fetchBtn.disabled = true;
    downloadBtn.style.display = 'none';

    if (inactiveStatusTable) {
        inactiveStatusTable.destroy();
        inactiveStatusTable = null;
    }

    LoadingUtils.showLoadingModal('Loading report...', 'loadingModal', () => {});

    if (fromPaged) {
        LoadingUtils.updateLoadingModal(10, 'Fetching inactive users from org ' + PAGED_ORG_UNIT_ID + '...', 'loadingModal');
        summaryEl.textContent = 'Fetching users with status Inactive (this may take a while)...';
    } else {
        LoadingUtils.updateLoadingModal(20, 'Loading Data Hub user extract...', 'loadingModal');
        summaryEl.textContent = 'Loading Data Hub user extract...';
    }

    try {
        let inactiveList;
        if (fromPaged) {
            inactiveList = await fetchInactiveUsersViaPagedAPI();
            LoadingUtils.updateLoadingModal(70, 'Building table...', 'loadingModal');
        } else {
            const allUsers = await getUsersBDSData();
            LoadingUtils.updateLoadingModal(50, 'Filtering users marked Inactive...', 'loadingModal');
            inactiveList = filterInactiveFromBDS(allUsers);
            LoadingUtils.updateLoadingModal(80, 'Building table...', 'loadingModal');
        }

        const excludeRetired = document.getElementById('excludeRetired') && document.getElementById('excludeRetired').checked;
        if (excludeRetired) {
            const before = inactiveList.length;
            inactiveList = inactiveList.filter(function (u) {
                return !String(u.Username || '').includes('.retired.');
            });
            if (before !== inactiveList.length) {
                LoadingUtils.updateLoadingModal(85, 'Excluding .retired. usernames...', 'loadingModal');
            }
        }

        currentInactiveStatusUsers = inactiveList;

        summaryEl.textContent = 'Found ' + inactiveList.length + ' user(s) marked as INACTIVE. Use "Show X entries" or "All" above the table to view more.';

        const escapeHtml = function (t) {
            if (t == null) return '';
            const div = document.createElement('div');
            div.textContent = t;
            return div.innerHTML;
        };

        inactiveStatusTable = $('#inactiveStatusTable').DataTable({
            data: inactiveList,
            columns: [
                { data: 'UserId', render: escapeHtml },
                { data: 'OrgDefinedId', render: escapeHtml },
                { data: 'FirstName', render: escapeHtml },
                { data: 'LastName', render: escapeHtml },
                { data: 'Username', render: escapeHtml },
                { data: 'Email', render: escapeHtml },
                { data: 'Role', render: escapeHtml },
                { data: 'IsActive', render: escapeHtml },
                { data: 'LastAccessed', render: escapeHtml }
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
        setTimeout(function () { LoadingUtils.hideLoadingModal('loadingModal'); }, 800);
    } catch (err) {
        console.error('Inactive Status Report error:', err);
        summaryEl.textContent = 'Error: ' + (err.message || 'Failed to load inactive users');
        LoadingUtils.hideLoadingModal('loadingModal');
    } finally {
        fetchBtn.disabled = false;
    }
}

function downloadCSV() {
    if (!currentInactiveStatusUsers || currentInactiveStatusUsers.length === 0) {
        alert('No data to download.');
        return;
    }

    const rows = currentInactiveStatusUsers.map(u => ({
        UserId: u.UserId,
        OrgDefinedId: u.OrgDefinedId,
        FirstName: u.FirstName,
        LastName: u.LastName,
        Username: u.Username,
        Email: u.Email,
        Role: u.Role,
        IsActive: u.IsActive,
        LastAccessed: u.LastAccessed
    }));

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inactive-status-report-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function switchInactiveStatusSource(source) {
    const tabList = document.getElementById('sourceTabList');
    const descDataHub = document.getElementById('sourceDescDataHub');
    const descPaged = document.getElementById('sourceDescPaged');
    if (!tabList) return;

    tabList.querySelectorAll('.source-tab').forEach(function (t) {
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

window.switchInactiveStatusSource = switchInactiveStatusSource;

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('fetchBtn').addEventListener('click', runReport);
    document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
});
