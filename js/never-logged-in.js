/**
 * Never Logged In Report
 * Lists users from the Data Hub user extract where First Login Date is blank (never logged into D2L).
 * Uses the same Data Hub extract as the retirement and never-enrolled reports.
 * Option: filter by All, Active only, or Inactive only.
 */

let neverLoggedInTable = null;
let currentNeverLoggedIn = [];

// Same Data Hub load as never-enrolled-1001.js and retirement-report.js
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

/** Detect column for First Login Date (BDS may use "First Login Date", "FirstLoginDate", etc.). */
function detectFirstLoginDateKey(rows) {
    if (!rows || rows.length === 0) return null;
    const keys = Object.keys(rows[0]);
    const preferred = ['First Login Date', 'FirstLoginDate', 'First Login', 'FirstLogin'];
    for (const k of preferred) {
        if (keys.includes(k)) return k;
    }
    const lower = (s) => (s || '').toLowerCase();
    for (const k of keys) {
        if (lower(k).includes('first') && lower(k).includes('login')) return k;
    }
    return null;
}

/** Values that mean "no first login" in Data Hub exports. */
const BLANK_FIRST_LOGIN = new Set(['', 'n/a', 'na', 'null', '-', 'never', '.', 'none', 'n/a.', 'na.']);

/** Date-like strings that mean "no login" (placeholder dates). */
const BLANK_DATE_PATTERNS = [/^0+[-/]0+[-/]0+$/, /^1900[-/]01[-/]01/, /^0000[-/]00[-/]00/];

/** True if value is blank or a common "no first login" placeholder. */
function isBlankFirstLogin(val) {
    if (val == null) return true;
    const s = String(val).trim();
    if (s === '') return true;
    const lower = s.toLowerCase();
    if (BLANK_FIRST_LOGIN.has(lower)) return true;
    if (BLANK_DATE_PATTERNS.some(function (p) { return p.test(s); })) return true;
    return false;
}

/** Get active status from a BDS row; column may be IsActive, Active, etc. with values Yes/No, true/false, 1/0. */
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

/** Get value from row using any of the given keys (first match). */
function getVal(row, keys) {
    for (const k of keys) {
        if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
    }
    return '';
}

function runReport() {
    const summaryEl = document.getElementById('summary');
    const fetchBtn = document.getElementById('fetchBtn');
    const downloadBtn = document.getElementById('downloadCsv');
    const statusFilter = document.getElementById('statusFilter').value;

    fetchBtn.disabled = true;
    downloadBtn.style.display = 'none';

    if (neverLoggedInTable) {
        neverLoggedInTable.destroy();
        neverLoggedInTable = null;
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

            const firstLoginKey = detectFirstLoginDateKey(allUsers);
            if (!firstLoginKey) {
                const firstKeys = Object.keys(allUsers[0] || {}).join(', ');
                summaryEl.textContent = 'Could not find a "First Login Date" column in the Data Hub CSV. Columns: ' + firstKeys;
                LoadingUtils.hideLoadingModal('loadingModal');
                return;
            }
            console.log('Never Logged In: BDS user count =', allUsers.length, '| First Login Date column =', firstLoginKey);

            LoadingUtils.updateLoadingModal(50, 'Filtering users with blank First Login Date...', 'loadingModal');

            // Debug: sample of First Login Date values so we can see what the extract contains
            const sampleFirstLogin = [...new Set(allUsers.slice(0, 500).map(r => String(r[firstLoginKey] ?? '').trim()))].filter(Boolean).slice(0, 10);
            console.log('Never Logged In: sample FirstLoginDate values from BDS:', sampleFirstLogin);

            const neverLoggedIn = [];
            for (const row of allUsers) {
                const firstLoginVal = row[firstLoginKey];
                if (!isBlankFirstLogin(firstLoginVal)) continue;

                const isActive = normalizeIsActive(row);
                if (statusFilter === 'active' && isActive !== true) continue;
                if (statusFilter === 'inactive' && isActive !== false) continue;

                const activeDisplay = isActive === true ? 'Yes' : isActive === false ? 'No' : '';
                neverLoggedIn.push({
                    OrgDefinedId: getVal(row, ['OrgDefinedId', 'Org Defined Id']),
                    LastName: getVal(row, ['Last Name', 'LastName']),
                    FirstName: getVal(row, ['First Name', 'FirstName']),
                    Username: getVal(row, ['Username', 'UserName', 'UniqueName']),
                    Email: getVal(row, ['Email', 'EmailAddress', 'ExternalEmail']),
                    FirstLoginDate: '',
                    LastLoginDate: getVal(row, ['Last Login Date', 'LastLoginDate', 'Last Login']),
                    Active: activeDisplay,
                    OrgUnitName: getVal(row, ['Org Unit Name', 'OrgUnitName', 'Org Unit Name']),
                    Role: getVal(row, ['Role', 'RoleName'])
                });
            }

            currentNeverLoggedIn = neverLoggedIn;
            console.log('Never Logged In: result count =', neverLoggedIn.length);
            if (neverLoggedIn.length === 0) {
                console.log('Never Logged In: no rows matched. Check sample FirstLoginDate values above; we treat empty, N/A, NULL, -, Never as blank.');
            }
            const filterLabel = statusFilter === 'active' ? 'Active only' : statusFilter === 'inactive' ? 'Inactive only' : 'All';
            summaryEl.textContent = 'Found ' + neverLoggedIn.length + ' user(s) with no First Login Date (' + filterLabel + '). Use "Show X entries" or "All" to view more.';

            LoadingUtils.updateLoadingModal(90, 'Building table...', 'loadingModal');

            const escapeHtml = function (t) {
                if (t == null) return '';
                var div = document.createElement('div');
                div.textContent = t;
                return div.innerHTML;
            };

            neverLoggedInTable = $('#neverLoggedInTable').DataTable({
                data: neverLoggedIn,
                deferRender: true,
                columns: [
                    { data: 'OrgDefinedId', render: escapeHtml },
                    { data: 'LastName', render: escapeHtml },
                    { data: 'FirstName', render: escapeHtml },
                    { data: 'Username', render: escapeHtml },
                    { data: 'Email', render: escapeHtml },
                    { data: 'FirstLoginDate', render: escapeHtml },
                    { data: 'LastLoginDate', render: escapeHtml },
                    { data: 'Active', render: escapeHtml },
                    { data: 'OrgUnitName', render: escapeHtml },
                    { data: 'Role', render: escapeHtml }
                ],
                pageLength: 100,
                lengthMenu: [[25, 50, 100, 200, 500, -1], [25, 50, 100, 200, 500, 'All']],
                order: [[1, 'asc']],
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
    if (!currentNeverLoggedIn || currentNeverLoggedIn.length === 0) {
        alert('No data to download.');
        return;
    }
    var csv = Papa.unparse(currentNeverLoggedIn);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'never-logged-in-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('fetchBtn').addEventListener('click', runReport);
    document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
});
