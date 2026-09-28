/**
 * Retired Return Reactivation
 * Step 1: Compare retired snapshot CSV to Data Hub Users (full + differential)
 * Step 2: Activate selected users when username is restored and IsActive is false
 */

let returnCandidatesTable = null;
let currentCandidates = [];
const selectedUserIds = new Set();

const USERS_DATASET_EXTRACTS_ENDPOINT =
  '/d2l/api/lp/1.43/datasets/bds/b21a6414-38f8-4da8-9a65-8b5586f9fe3b/plugins/1d6d722e-b572-456f-97c1-d526570daa6b/extracts';
const USERS_API_VERSION = '1.49';
const DEFAULT_RETIRED_SNAPSHOT_PATHS = [
  '../data-hub/retired-report-2026-02-08.csv',
  '../data-hub/retirement-report-2026-02-08.csv'
];

function getVal(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}

function normalizeName(s) {
  return String(s || '').trim().toLowerCase();
}

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

function isRetiredUsername(username) {
  return String(username || '').indexOf('.retired.') !== -1;
}

function parseCsvText(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => (h || '').trim()
  });
  if (parsed.errors && parsed.errors.length) {
    console.warn('CSV parse warnings:', parsed.errors);
  }
  return parsed.data || [];
}

async function fetchExtractList(type) {
  const endpoint = `${USERS_DATASET_EXTRACTS_ENDPOINT}?type=${encodeURIComponent(type)}`;
  const json = await D2LApi._fetch(endpoint);
  const objects = Array.isArray(json.Objects) ? json.Objects : [];
  return objects.sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate));
}

async function downloadZipCsvRows(downloadUrl) {
  const zipResp = await fetch(downloadUrl, { method: 'GET', credentials: 'include' });
  if (!zipResp.ok) throw new Error(`Failed to download extract ZIP: ${zipResp.status}`);
  const zipBlob = await zipResp.blob();
  const zip = await window.JSZip.loadAsync(zipBlob);
  const csvFile = Object.values(zip.files).find(file => file.name.toLowerCase().endsWith('.csv'));
  if (!csvFile) throw new Error('No CSV found in extract ZIP');
  const csvText = await csvFile.async('string');
  if (!csvText || !csvText.trim()) return [];
  return parseCsvText(csvText);
}

async function loadUsersFromDataHub() {
  const [fullExtracts, diffExtracts] = await Promise.all([
    fetchExtractList('full'),
    fetchExtractList('differential')
  ]);

  if (!fullExtracts.length) throw new Error('No Data Hub full extract found.');
  if (!fullExtracts[0].DownloadLink) throw new Error('Latest full extract has no download link.');

  const latestFullExtract = fullExtracts[0];
  const latestFullCreated = new Date(latestFullExtract.CreatedDate);
  const fullRows = await downloadZipCsvRows(latestFullExtract.DownloadLink);

  // Only apply differentials created after the latest full snapshot; older differentials
  // would roll current users back to stale states if merged after the full extract.
  const diffsAfterFull = diffExtracts.filter(ext => {
    if (!ext || !ext.CreatedDate) return false;
    const created = new Date(ext.CreatedDate);
    return !Number.isNaN(created.getTime()) && created > latestFullCreated;
  });

  // Merge applicable differential extracts in chronological order (oldest first) so each
  // later extract overrides earlier ones for the same OrgDefinedId in buildCurrentUsersIndex.
  const diffsOldestFirst = [...diffsAfterFull].sort(
    (a, b) => new Date(a.CreatedDate) - new Date(b.CreatedDate)
  );
  const diffRowArrays = [];
  for (const ext of diffsOldestFirst) {
    if (!ext.DownloadLink) continue;
    try {
      diffRowArrays.push(await downloadZipCsvRows(ext.DownloadLink));
    } catch (err) {
      console.warn('Differential extract load failed, skipping:', ext.CreatedDate, err);
    }
  }
  const diffRows = diffRowArrays.flat();

  return {
    fullRows,
    diffRows,
    differentialExtractFilesLoaded: diffRowArrays.length,
    differentialExtractFilesTotal: diffsOldestFirst.filter(e => e.DownloadLink).length
  };
}

function buildCurrentUsersIndex(fullRows, diffRows) {
  const byOrgDefinedId = new Map();
  const byCompositeName = new Map();

  function upsert(row, sourceLabel) {
    const userId = getVal(row, ['UserId', 'Identifier', 'Id']);
    const orgDefinedId = getVal(row, ['OrgDefinedId', 'Org Defined Id']);
    const firstName = getVal(row, ['FirstName', 'First Name']);
    const lastName = getVal(row, ['LastName', 'Last Name']);
    const username = getVal(row, ['UserName', 'Username', 'userName', 'UniqueName']);

    const normalized = {
      UserId: userId,
      OrgDefinedId: orgDefinedId,
      FirstName: firstName,
      LastName: lastName,
      Username: username,
      IsActive: normalizeIsActive(row),
      Source: sourceLabel,
      _raw: row
    };

    if (orgDefinedId) {
      byOrgDefinedId.set(orgDefinedId, normalized);
    }
    const key = `${normalizeName(firstName)}|${normalizeName(lastName)}`;
    if (firstName || lastName) {
      if (!byCompositeName.has(key)) byCompositeName.set(key, []);
      const arr = byCompositeName.get(key);
      const existingIdx = arr.findIndex(x => x.OrgDefinedId && x.OrgDefinedId === orgDefinedId);
      if (existingIdx >= 0) arr[existingIdx] = normalized;
      else arr.push(normalized);
    }
  }

  // Load full first, then diff to override current fields.
  for (const row of fullRows) upsert(row, 'full');
  for (const row of diffRows) upsert(row, 'differential');

  return { byOrgDefinedId, byCompositeName };
}

function mapRetiredSnapshotRow(row) {
  return {
    UserId: getVal(row, ['UserId', 'Identifier', 'Id']),
    OrgDefinedId: getVal(row, ['OrgDefinedId', 'Org Defined Id']),
    FirstName: getVal(row, ['FirstName', 'First Name']),
    LastName: getVal(row, ['LastName', 'Last Name']),
    Username: getVal(row, ['Username', 'UserName', 'UniqueName']),
    IsActive: normalizeIsActive(row),
    _raw: row
  };
}

function buildCandidateList(retiredRows, currentIndex) {
  const out = [];
  const { byOrgDefinedId, byCompositeName } = currentIndex;

  for (const row of retiredRows) {
    if (!row.OrgDefinedId) continue;
    if (!isRetiredUsername(row.Username)) continue;

    let current = byOrgDefinedId.get(row.OrgDefinedId);
    let matchType = 'OrgDefinedId';

    // Safety fallback if OrgDefinedId fails: exact name match with one result.
    if (!current && row.FirstName && row.LastName) {
      const key = `${normalizeName(row.FirstName)}|${normalizeName(row.LastName)}`;
      const matches = byCompositeName.get(key) || [];
      if (matches.length === 1) {
        current = matches[0];
        matchType = 'NameFallback';
      }
    }
    if (!current) continue;

    const usernameRestored = !isRetiredUsername(current.Username) && current.Username !== '';
    const currentlyInactive = current.IsActive === false;

    if (!usernameRestored || !currentlyInactive) continue;

    out.push({
      UserId: current.UserId || row.UserId,
      OrgDefinedId: row.OrgDefinedId,
      FirstName: row.FirstName || current.FirstName,
      LastName: row.LastName || current.LastName,
      OldUsername: row.Username,
      CurrentUsername: current.Username,
      CurrentIsActive: current.IsActive,
      MatchType: `${matchType}:${current.Source || 'unknown'}`
    });
  }

  return out;
}

function escapeHtml(t) {
  if (t == null) return '';
  const div = document.createElement('div');
  div.textContent = String(t);
  return div.innerHTML;
}

async function brightspaceFetch(endpoint, method, body) {
  const token = localStorage.getItem('XSRF.Token');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token) headers['X-CSRF-Token'] = token;
  const response = await fetch(endpoint, {
    method,
    headers,
    credentials: 'include',
    body: body != null ? JSON.stringify(body) : undefined
  });
  const newToken = response.headers.get('x-csrf-token');
  if (newToken && newToken !== token) localStorage.setItem('XSRF.Token', newToken);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 250)}` : ''}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Brightspace user JSON uses IsActive; treat only explicit false as inactive. */
function parseLiveUserIsActive(user) {
  if (!user || typeof user !== 'object') return undefined;
  const v =
    user.Activation && Object.prototype.hasOwnProperty.call(user.Activation, 'IsActive')
      ? user.Activation.IsActive
      : user.IsActive;
  if (v === true || v === false) return v;
  if (v === 'true' || v === 'false') return v === 'true';
  return undefined;
}

/**
 * Data Hub CSVs lag behind API changes. Re-check each candidate with GET /users/{id}
 * and keep only rows where Brightspace reports IsActive === false.
 */
async function filterCandidatesByLiveActivation(candidates, onProgress) {
  const verified = [];
  const batchSize = 8;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    if (onProgress) onProgress(i, candidates.length);
    const results = await Promise.all(
      batch.map(async c => {
        const id = c.UserId;
        if (id == null || String(id).trim() === '') {
          return { c, live: undefined, err: new Error('Missing UserId') };
        }
        try {
          const user = await brightspaceFetch(
            `/d2l/api/lp/1.46/users/${encodeURIComponent(String(id).trim())}`,
            'GET',
            null
          );
          return { c, live: parseLiveUserIsActive(user), user };
        } catch (err) {
          console.warn('Live activation check failed for user', id, err);
          return { c, live: undefined, err };
        }
      })
    );
    for (const { c, live, user } of results) {
      if (live === false) {
        verified.push({
          ...c,
          CurrentUsername: user && user.UserName != null ? String(user.UserName) : c.CurrentUsername,
          CurrentIsActive: false,
          MatchType: `${c.MatchType || 'unknown'}:apiVerifiedInactive`
        });
      }
    }
  }
  if (onProgress) onProgress(candidates.length, candidates.length);
  return verified;
}

function getSelectedUserIdsFromTable() {
  return Array.from(selectedUserIds);
}

function updateActivateButtonState() {
  const btn = document.getElementById('activateSelectedBtn');
  if (!btn) return;
  const count = getSelectedUserIdsFromTable().length;
  btn.disabled = count === 0;
  btn.textContent = count ? `Step 2: Activate Selected (${count})` : 'Step 2: Activate Selected';
}

async function loadRetiredSnapshotRows() {
  const fileInput = document.getElementById('retiredCsv');
  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    return await new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => (h || '').trim(),
        complete: r => resolve(r.data || []),
        error: reject
      });
    });
  }

  for (const path of DEFAULT_RETIRED_SNAPSHOT_PATHS) {
    const resp = await fetch(path, { method: 'GET', credentials: 'include' });
    if (!resp.ok) continue;
    const text = await resp.text();
    if (text && text.trim()) return parseCsvText(text);
  }

  throw new Error('Failed to load default retired snapshot. Upload CSV manually.');
}

function renderCandidatesTable(rows) {
  selectedUserIds.clear();

  if (returnCandidatesTable) {
    returnCandidatesTable.destroy();
    returnCandidatesTable = null;
  }

  returnCandidatesTable = $('#returnCandidatesTable').DataTable({
    data: rows,
    columns: [
      {
        data: null,
        orderable: false,
        render: function (data, type, row) {
          const userId = row && row.UserId ? String(row.UserId).trim() : '';
          const checked = userId && selectedUserIds.has(userId) ? 'checked' : '';
          return `<input class="row-select" type="checkbox" data-userid="${escapeHtml(userId)}" ${checked} />`;
        }
      },
      { data: 'UserId', render: t => `<span class="mono">${escapeHtml(t)}</span>` },
      { data: 'OrgDefinedId', render: t => `<span class="mono">${escapeHtml(t)}</span>` },
      { data: 'FirstName', render: escapeHtml },
      { data: 'LastName', render: escapeHtml },
      { data: 'OldUsername', render: t => `<span class="mono">${escapeHtml(t)}</span>` },
      { data: 'CurrentUsername', render: t => `<span class="mono">${escapeHtml(t)}</span>` },
      { data: 'CurrentIsActive', render: t => escapeHtml(t === false ? 'false' : String(t)) },
      { data: 'MatchType', render: escapeHtml }
    ],
    pageLength: 100,
    lengthMenu: [[25, 50, 100, 200, 500, -1], [25, 50, 100, 200, 500, 'All']],
    order: [[2, 'asc']],
    dom: '<"top"lf>rt<"bottom"ip><"clear">',
    responsive: true,
    scrollX: true
  });

  $('#returnCandidatesTable').off('change', 'input.row-select');
  $('#returnCandidatesTable').on('change', 'input.row-select', function () {
    const userId = String(this.getAttribute('data-userid') || '').trim();
    if (!userId) return;
    if (this.checked) selectedUserIds.add(userId);
    else selectedUserIds.delete(userId);
    updateActivateButtonState();
  });

  const selectAll = document.getElementById('selectAll');
  if (selectAll) {
    selectAll.checked = false;
    selectAll.onchange = () => {
      const checked = !!selectAll.checked;
      $('#returnCandidatesTable').DataTable().rows({ page: 'current' }).nodes().to$().find('input.row-select').each(function () {
        const userId = String(this.getAttribute('data-userid') || '').trim();
        if (!userId) return;
        this.checked = checked;
        if (checked) selectedUserIds.add(userId);
        else selectedUserIds.delete(userId);
      });
      updateActivateButtonState();
    };
  }

  // Keep checkbox state in sync on sort/filter/page redraw.
  $('#returnCandidatesTable').off('draw.dt');
  $('#returnCandidatesTable').on('draw.dt', function () {
    $('#returnCandidatesTable').DataTable().rows({ page: 'current' }).nodes().to$().find('input.row-select').each(function () {
      const userId = String(this.getAttribute('data-userid') || '').trim();
      if (!userId) return;
      this.checked = selectedUserIds.has(userId);
    });
  });
}

async function runComparison() {
  const summaryEl = document.getElementById('summary');
  const checkBtn = document.getElementById('checkBtn');
  const activateBtn = document.getElementById('activateSelectedBtn');
  const downloadBtn = document.getElementById('downloadCsv');

  checkBtn.disabled = true;
  activateBtn.disabled = true;
  activateBtn.style.display = 'none';
  downloadBtn.style.display = 'none';

  LoadingUtils.showLoadingModal('Running comparison...', 'loadingModal', () => {});
  try {
    LoadingUtils.updateLoadingModal(10, 'Loading retired snapshot...', 'loadingModal');
    const retiredSnapshotRaw = await loadRetiredSnapshotRows();
    const retiredRows = retiredSnapshotRaw.map(mapRetiredSnapshotRow);

    LoadingUtils.updateLoadingModal(30, 'Loading Data Hub full + differential users...', 'loadingModal');
    const { fullRows, diffRows, differentialExtractFilesLoaded, differentialExtractFilesTotal } =
      await loadUsersFromDataHub();

    LoadingUtils.updateLoadingModal(55, 'Comparing retired snapshot to current users...', 'loadingModal');
    const currentIndex = buildCurrentUsersIndex(fullRows, diffRows);
    const dataHubCandidates = buildCandidateList(retiredRows, currentIndex);

    LoadingUtils.updateLoadingModal(65, 'Verifying activation status via Brightspace API...', 'loadingModal');
    const candidates = await filterCandidatesByLiveActivation(dataHubCandidates, (done, total) => {
      if (!total) return;
      const pct = 65 + Math.round((done / total) * 20);
      LoadingUtils.updateLoadingModal(
        pct,
        `Verifying activation via API (${Math.min(done + 1, total)}/${total})...`,
        'loadingModal'
      );
    });
    currentCandidates = candidates;

    LoadingUtils.updateLoadingModal(88, 'Building table...', 'loadingModal');
    renderCandidatesTable(candidates);

    const staleRemoved = dataHubCandidates.length - candidates.length;
    summaryEl.textContent =
      `Loaded retired snapshot rows: ${retiredRows.length}\n` +
      `Data Hub full rows: ${fullRows.length}\n` +
      `Data Hub differential extracts merged: ${differentialExtractFilesLoaded}/${differentialExtractFilesTotal} files, ${diffRows.length} row(s) applied after full snapshot\n` +
      `Data Hub candidates (username restored + CSV inactive): ${dataHubCandidates.length}\n` +
      `After live API check (IsActive must be false): ${candidates.length}` +
      (staleRemoved > 0
        ? `\nExcluded ${staleRemoved} row(s) already active in Brightspace (Data Hub CSV was stale).`
        : '');

    activateBtn.style.display = 'inline-flex';
    downloadBtn.style.display = 'inline-flex';
    updateActivateButtonState();
    LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
    setTimeout(() => LoadingUtils.hideLoadingModal('loadingModal'), 700);
  } catch (err) {
    console.error('Retired return comparison failed:', err);
    summaryEl.textContent = 'Error: ' + (err.message || String(err));
    LoadingUtils.hideLoadingModal('loadingModal');
  } finally {
    checkBtn.disabled = false;
  }
}

async function activateSelectedUsers() {
  const summaryEl = document.getElementById('summary');
  const ids = getSelectedUserIdsFromTable();
  if (!ids.length) return;

  if (!confirm(`Activate ${ids.length} selected user account(s)?`)) return;

  const rowsById = new Map(currentCandidates.map(r => [String(r.UserId), r]));
  const selectedRows = ids.map(id => rowsById.get(String(id))).filter(Boolean);
  if (!selectedRows.length) return;

  const checkBtn = document.getElementById('checkBtn');
  const activateBtn = document.getElementById('activateSelectedBtn');
  const downloadBtn = document.getElementById('downloadCsv');

  checkBtn.disabled = true;
  activateBtn.disabled = true;
  downloadBtn.disabled = true;

  LoadingUtils.showLoadingModal('Activating users...', 'loadingModal', () => {});

  let ok = 0;
  let fail = 0;
  const failures = [];

  for (let i = 0; i < selectedRows.length; i++) {
    const row = selectedRows[i];
    const pct = Math.round(((i + 1) / selectedRows.length) * 100);
    LoadingUtils.updateLoadingModal(pct, `Activating ${i + 1}/${selectedRows.length}: ${row.CurrentUsername}`, 'loadingModal');
    try {
      await brightspaceFetch(`/d2l/api/lp/1.46/users/${encodeURIComponent(row.UserId)}/activation`, 'PUT', { IsActive: true });
      ok++;
    } catch (err) {
      fail++;
      failures.push({ UserId: row.UserId, OrgDefinedId: row.OrgDefinedId, Error: err.message || String(err) });
    }
  }

  if (failures.length) {
    console.warn('Activation failures:', failures);
  }

  summaryEl.textContent = `Activation complete: ${ok} succeeded, ${fail} failed. ${fail ? 'See console for failure details.' : 'Run Step 1 again to refresh candidates.'}`;

  checkBtn.disabled = false;
  activateBtn.disabled = false;
  downloadBtn.disabled = false;
  updateActivateButtonState();

  LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
  setTimeout(() => LoadingUtils.hideLoadingModal('loadingModal'), 800);
}

function downloadCandidatesCsv() {
  if (!currentCandidates.length) {
    alert('No candidate rows to download.');
    return;
  }
  const csv = Papa.unparse(currentCandidates);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'retired-return-reactivation-candidates-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('checkBtn').addEventListener('click', runComparison);
  document.getElementById('activateSelectedBtn').addEventListener('click', activateSelectedUsers);
  document.getElementById('downloadCsv').addEventListener('click', downloadCandidatesCsv);
});
