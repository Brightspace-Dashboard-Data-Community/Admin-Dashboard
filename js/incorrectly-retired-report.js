/**
 * Incorrectly Retired (.retired.2026) Report
 * Upload a semester enrollment CSV (Term, STATUS, STC_STATUS, FIRST_NAME, LAST_NAME, Person_ID, Email_Address).
 * Matches Person_ID to the Data Hub user extract and lists anyone whose D2L username contains .retired.2026.
 * Export result as CSV.
 */

let incorrectlyRetiredTable = null;
let currentResults = [];

const RETIRED_2026_PATTERN = '.retired.2026';

// Same Data Hub load as other reports
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

/** Find first key in row that matches one of the allowed names (case-insensitive). */
function getColumn(row, allowedNames) {
    const keys = Object.keys(row);
    const lowerAllowed = allowedNames.map(n => n.toLowerCase());
    for (const k of keys) {
        if (lowerAllowed.includes((k || '').toLowerCase())) return k;
    }
    return null;
}

/** Get value from row by column name (flexible: Term, STATUS, Person_ID, etc.). */
function getEnrollmentVal(row, allowedNames) {
    const key = getColumn(row, allowedNames);
    if (!key) return '';
    const v = row[key];
    return v != null ? String(v).trim() : '';
}

/** Build map: OrgDefinedId -> { username, row }. Lookup by exact or lowercase. */
function buildBDSLookup(bdsRows) {
    const byOrgDefinedId = new Map();
    const usernameKeys = ['UserName', 'Username', 'userName', 'UniqueName'];
    for (const row of bdsRows) {
        const oid = (row.OrgDefinedId ?? row['Org Defined Id'] ?? '').toString().trim();
        if (oid === '') continue;
        const username = usernameKeys.reduce((acc, k) => acc || (row[k] ?? ''), '') || '';
        byOrgDefinedId.set(oid, { username, row });
        const oidLower = oid.toLowerCase();
        if (oidLower !== oid && !byOrgDefinedId.has(oidLower)) byOrgDefinedId.set(oidLower, { username, row });
    }
    return byOrgDefinedId;
}

function runReport() {
    const fileInput = document.getElementById('enrollmentCsv');
    const summaryEl = document.getElementById('summary');
    const runBtn = document.getElementById('runBtn');
    const downloadBtn = document.getElementById('downloadCsv');

    if (!fileInput.files || fileInput.files.length === 0) {
        summaryEl.textContent = 'Please select an enrollment CSV file first.';
        return;
    }

    runBtn.disabled = true;
    downloadBtn.style.display = 'none';

    if (incorrectlyRetiredTable) {
        incorrectlyRetiredTable.destroy();
        incorrectlyRetiredTable = null;
    }

    const file = fileInput.files[0];
    LoadingUtils.showLoadingModal('Loading...', 'loadingModal', () => {});
    summaryEl.textContent = 'Parsing enrollment CSV...';

    (async () => {
        try {
            const enrollmentRows = await new Promise((resolve, reject) => {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: true,
                    transformHeader: h => (h || '').trim(),
                    complete: (r) => {
                        if (r.errors && r.errors.length) console.warn('Enrollment CSV parse errors:', r.errors);
                        resolve(r.data || []);
                    },
                    error: reject
                });
            });

            if (!enrollmentRows.length) {
                summaryEl.textContent = 'The enrollment CSV has no data rows.';
                LoadingUtils.hideLoadingModal('loadingModal');
                runBtn.disabled = false;
                return;
            }

            const personIdKey = getColumn(enrollmentRows[0], ['Person_ID', 'Person ID', 'PersonId', 'PersonId']);
            if (!personIdKey) {
                summaryEl.textContent = 'Enrollment CSV must have a Person_ID (or Person ID) column. Columns found: ' + Object.keys(enrollmentRows[0]).join(', ');
                LoadingUtils.hideLoadingModal('loadingModal');
                runBtn.disabled = false;
                return;
            }

            LoadingUtils.updateLoadingModal(30, 'Loading Data Hub user extract...', 'loadingModal');
            const bdsRows = await getUsersBDSData();
            const bdsLookup = buildBDSLookup(bdsRows);
            LoadingUtils.updateLoadingModal(70, 'Checking for incorrectly retired users...', 'loadingModal');

            const incorrectlyRetired = [];
            for (const enr of enrollmentRows) {
                const personId = (enr[personIdKey] ?? '').toString().trim();
                if (!personId) continue;

                const lookup = bdsLookup.get(personId) || bdsLookup.get(personId.toLowerCase());
                if (!lookup) continue;

                const username = lookup.username || '';
                if (username.indexOf(RETIRED_2026_PATTERN) === -1) continue;

                incorrectlyRetired.push({
                    Term: getEnrollmentVal(enr, ['Term']),
                    STATUS: getEnrollmentVal(enr, ['STATUS', 'Status']),
                    STC_STATUS: getEnrollmentVal(enr, ['STC_STATUS', 'STC Status']),
                    FIRST_NAME: getEnrollmentVal(enr, ['FIRST_NAME', 'First Name', 'FirstName']),
                    LAST_NAME: getEnrollmentVal(enr, ['LAST_NAME', 'Last Name', 'LastName']),
                    Person_ID: personId,
                    Email_Address: getEnrollmentVal(enr, ['Email_Address', 'Email Address', 'Email']),
                    D2L_Username: username
                });
            }

            currentResults = incorrectlyRetired;
            summaryEl.textContent = 'Found ' + incorrectlyRetired.length + ' user(s) on your enrollment list with D2L username containing .retired.2026. Export CSV to correct them.';

            LoadingUtils.updateLoadingModal(90, 'Building table...', 'loadingModal');

            const escapeHtml = function (t) {
                if (t == null) return '';
                var div = document.createElement('div');
                div.textContent = t;
                return div.innerHTML;
            };

            incorrectlyRetiredTable = $('#incorrectlyRetiredTable').DataTable({
                data: incorrectlyRetired,
                deferRender: true,
                columns: [
                    { data: 'Term', render: escapeHtml },
                    { data: 'STATUS', render: escapeHtml },
                    { data: 'STC_STATUS', render: escapeHtml },
                    { data: 'FIRST_NAME', render: escapeHtml },
                    { data: 'LAST_NAME', render: escapeHtml },
                    { data: 'Person_ID', render: escapeHtml },
                    { data: 'Email_Address', render: escapeHtml },
                    { data: 'D2L_Username', render: escapeHtml }
                ],
                pageLength: 50,
                lengthMenu: [[25, 50, 100, 200, -1], [25, 50, 100, 200, 'All']],
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

            if (incorrectlyRetired.length > 0) downloadBtn.style.display = 'inline-flex';
            LoadingUtils.updateLoadingModal(100, 'Done', 'loadingModal');
            setTimeout(function () { LoadingUtils.hideLoadingModal('loadingModal'); }, 500);
        } catch (err) {
            console.error(err);
            summaryEl.textContent = 'Error: ' + (err.message || 'Report failed');
            LoadingUtils.hideLoadingModal('loadingModal');
        } finally {
            runBtn.disabled = false;
        }
    })();
}

function downloadCSV() {
    if (!currentResults || currentResults.length === 0) {
        alert('No data to download.');
        return;
    }
    var csv = Papa.unparse(currentResults);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'incorrectly-retired-2026-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('runBtn').addEventListener('click', runReport);
    document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
});
