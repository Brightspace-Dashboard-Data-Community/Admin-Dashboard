/**
 * Never Enrolled (1001) Report
 * Finds users in the Data Hub user extract who have no enrollment in org unit 1001.
 * Uses the same Data Hub and 1001 enrollment logic as the retirement report.
 * Option: filter by All, Active only, or Inactive only.
 */

let neverEnrolledTable = null;
let currentNeverEnrolled = [];

const ORG_1001 = 1001;
const ENROLLMENTS_1001_BASE = '/d2l/api/lp/1.47/enrollments/orgUnits/' + ORG_1001 + '/users/';

// Same as retirement-report.js: load Data Hub user extract. Use D2LApi for auth consistency.
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

    const fullDataJson = await D2LApi._fetch(
        '/d2l/api/lp/1.43/datasets/bds/b21a6414-38f8-4da8-9a65-8b5586f9fe3b/plugins/1d6d722e-b572-456f-97c1-d526570daa6b/extracts?type=full'
    );
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

/** Detect which CSV column holds the user ID (BDS column names can vary: UserId, User ID, Identifier, Id). */
function detectBDSUserIdKey(rows) {
    if (!rows || rows.length === 0) return null;
    const first = rows[0];
    const keys = Object.keys(first);
    const preferred = ['UserId', 'Identifier', 'Id', 'User ID', 'UserID', 'D2L User ID'];
    for (const k of preferred) {
        if (keys.includes(k) && first[k] != null && String(first[k]).trim() !== '') return k;
    }
    const lower = (s) => (s || '').toLowerCase();
    for (const k of keys) {
        if ((lower(k).includes('user') && lower(k).includes('id')) || lower(k) === 'identifier') {
            if (first[k] != null && String(first[k]).trim() !== '') return k;
        }
    }
    return null;
}

// Same pattern as retirement-report.js fetchUsersViaPagedClasslist: get all users enrolled in 1001 (active + inactive)
// We only need their IDs, so we build a Set (with both number and string for comparison with BDS)
async function fetch1001EnrolledUserIds() {
    const enrolledIds = new Set();
    const pageSize = 100;
    const maxPages = 300;

    function addId(uid) {
        if (uid == null || uid === '') return;
        var s = String(uid).trim();
        if (s === '') return;
        var n = Number(s);
        if (!isNaN(n)) enrolledIds.add(n);
        enrolledIds.add(s);
    }

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
                if (userId != null) addId(userId);
            }
            const paging = response.PagingInfo || response.pagingInfo;
            const hasMore = paging && paging.HasMoreItems;
            bookmark = paging && paging.Bookmark;
            if (!hasMore || !bookmark || items.length === 0) break;
        }
    }

    await fetchStream(false);
    await fetchStream(true);
    return enrolledIds;
}

function parseDate(dateStr) {
    if (dateStr == null || String(dateStr).trim() === '') return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function formatDateTime(dateVal) {
    const d = dateVal instanceof Date ? dateVal : parseDate(dateVal);
    if (!d) return '';
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

function normalizeIsActive(row) {
    const v = row.IsActive ?? row.Activation ?? row.Active;
    if (v === true || v === 'true' || v === '1' || v === 1) return true;
    if (v === false || v === 'false' || v === '0' || v === 0) return false;
    return undefined;
}

function runReport() {
    const summaryEl = document.getElementById('summary');
    const fetchBtn = document.getElementById('fetchBtn');
    const downloadBtn = document.getElementById('downloadCsv');
    const statusFilter = document.getElementById('statusFilter').value;

    fetchBtn.disabled = true;
    downloadBtn.style.display = 'none';

    if (neverEnrolledTable) {
        neverEnrolledTable.destroy();
        neverEnrolledTable = null;
    }

    LoadingUtils.showLoadingModal('Loading...', 'loadingModal', () => {});
    LoadingUtils.updateLoadingModal(10, 'Loading Data Hub user extract...', 'loadingModal');
    summaryEl.textContent = 'Loading Data Hub user extract...';

    (async () => {
        try {
            const allUsers = await getUsersBDSData();
            if (!allUsers.length) {
                summaryEl.textContent = 'Data Hub returned no users. Check the user extract.';
                LoadingUtils.hideLoadingModal('loadingModal');
                return;
            }

            const bdsUserIdKey = detectBDSUserIdKey(allUsers);
            if (!bdsUserIdKey) {
                const firstKeys = Object.keys(allUsers[0] || {}).join(', ');
                console.warn('Never Enrolled: BDS columns (first row):', firstKeys);
                summaryEl.textContent = 'Could not find a user ID column in the Data Hub CSV. Columns: ' + firstKeys + '. Check the console for details.';
                LoadingUtils.hideLoadingModal('loadingModal');
                return;
            }
            console.log('Never Enrolled: BDS user count =', allUsers.length, '| User ID column =', bdsUserIdKey, '| Sample IDs:', allUsers.slice(0, 3).map(r => r[bdsUserIdKey]));

            LoadingUtils.updateLoadingModal(40, 'Loading org 1001 enrollments (active + inactive)...', 'loadingModal');
            const enrolled1001Ids = await fetch1001EnrolledUserIds();
            console.log('Never Enrolled: 1001 enrolled ID count =', enrolled1001Ids.size, '| Sample:', Array.from(enrolled1001Ids).slice(0, 5));
            LoadingUtils.updateLoadingModal(70, 'Computing never-enrolled list...', 'loadingModal');

            const usernameKeys = ['UserName', 'Username', 'userName', 'UniqueName'];
            const neverEnrolled = [];

            for (const row of allUsers) {
                let userId = row[bdsUserIdKey] ?? row.UserId ?? row.Identifier ?? row.Id;
                if (userId == null || userId === '') continue;
                userId = String(userId).trim();
                if (userId === '') continue;

                const idNum = Number(userId);
                const idStr = userId; // use trimmed string for lookup
                const isEnrolled = !isNaN(idNum)
                    ? (enrolled1001Ids.has(idNum) || enrolled1001Ids.has(idStr))
                    : enrolled1001Ids.has(idStr);
                if (isEnrolled) continue;

                const isActive = normalizeIsActive(row);
                if (statusFilter === 'active' && isActive !== true) continue;
                if (statusFilter === 'inactive' && isActive !== false) continue;

                const username = usernameKeys.reduce((acc, k) => acc || row[k], '') || '';
                const roleId = String(row.OrgRoleId ?? row.RoleId ?? row.Role?.Identifier ?? row.Role?.Id ?? '').trim();
                const roleName = roleId === '101' ? 'Student' : roleId === '102' ? 'Instructor' : roleId === '100' ? 'Admin' : (roleId ? 'Role ' + roleId : 'Unknown');
                const lastAccessed = parseDate(row.LastAccessed || row.LastAccessedDate);
                const createdDate = parseDate(row.CreatedDate || row.Created);

                neverEnrolled.push({
                    UserId: userId,
                    OrgDefinedId: row.OrgDefinedId ?? '',
                    FirstName: row.FirstName ?? '',
                    LastName: row.LastName ?? '',
                    Username: username,
                    Email: row.ExternalEmail ?? row.EmailAddress ?? row.Email ?? '',
                    Role: roleName,
                    IsActive: isActive === true ? 'Yes' : isActive === false ? 'No' : '',
                    LastAccessed: lastAccessed ? formatDateTime(lastAccessed) : '',
                    CreatedDate: createdDate ? formatDateTime(createdDate) : ''
                });
            }

            currentNeverEnrolled = neverEnrolled;
            console.log('Never Enrolled: result count =', neverEnrolled.length);
            const filterLabel = statusFilter === 'active' ? 'Active only' : statusFilter === 'inactive' ? 'Inactive only' : 'All';
            let summaryText = 'Found ' + neverEnrolled.length + ' user(s) never enrolled in 1001 (' + filterLabel + '). Use "Show X entries" or "All" to view more.';
            if (neverEnrolled.length === 0) {
                summaryText += ' If you expected more: open the browser console (F12 → Console) and check the "Never Enrolled:" logs for BDS user count and 1001 enrolled count.';
            }
            summaryEl.textContent = summaryText;

            LoadingUtils.updateLoadingModal(90, 'Building table...', 'loadingModal');

            const escapeHtml = function (t) {
                if (t == null) return '';
                var div = document.createElement('div');
                div.textContent = t;
                return div.innerHTML;
            };

            neverEnrolledTable = $('#neverEnrolledTable').DataTable({
                data: neverEnrolled,
                columns: [
                    { data: 'UserId' },
                    { data: 'OrgDefinedId' },
                    { data: 'FirstName' },
                    { data: 'LastName' },
                    { data: 'Username' },
                    { data: 'Email' },
                    { data: 'Role' },
                    { data: 'IsActive', render: function (v) { return escapeHtml(v); } },
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
                    infoEmpty: 'No entries',
                    infoFiltered: '(filtered from _MAX_)',
                    paginate: { first: 'First', last: 'Last', next: 'Next', previous: 'Previous' }
                },
                responsive: true,
                scrollX: true
            });

            downloadBtn.style.display = 'inline-flex';
            LoadingUtils.updateLoadingModal(100, 'Done', 'loadingModal');
            setTimeout(function () { LoadingUtils.hideLoadingModal('loadingModal'); }, 500);
        } catch (err) {
            console.error(err);
            summaryEl.textContent = 'Error: ' + (err.message || 'Report failed');
            LoadingUtils.hideLoadingModal('loadingModal');
        } finally {
            fetchBtn.disabled = false;
        }
    })();
}

function downloadCSV() {
    if (!currentNeverEnrolled || currentNeverEnrolled.length === 0) {
        alert('No data to download.');
        return;
    }
    var csv = Papa.unparse(currentNeverEnrolled);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'never-enrolled-1001-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('fetchBtn').addEventListener('click', runReport);
    document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
});
