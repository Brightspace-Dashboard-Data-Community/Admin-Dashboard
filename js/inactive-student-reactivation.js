/**
 * Inactive Student Reactivation
 * - Builds list of users marked INACTIVE (IsActive=false), filtered to RoleId 101 (Student)
 * - Optional: exclude ".retired." usernames from the list
 * - Bulk action: reactivate selected users; optionally strip ".retired.*" suffix from username
 */

let inactiveStudentsTable = null;
let currentInactiveStudents = [];

const PAGED_ORG_UNIT_ID = 1001;
const ENROLLMENTS_BASE = '/d2l/api/lp/1.47/enrollments/orgUnits/' + PAGED_ORG_UNIT_ID + '/users/';
const USERS_API_VERSION = '1.49';
const STUDENT_ROLE_ID = '101';

function getSelectedSource() {
  const active = document.querySelector('.source-tab.active');
  return (active && active.getAttribute('data-source')) || 'datahub';
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

  const sortedExtracts = fullDataJson.Objects.sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate));
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

  return parsed.data || [];
}

function filterInactiveStudentsFromBDS(allRows) {
  const result = [];
  const usernameKeys = ['UserName', 'Username', 'userName', 'UniqueName'];

  for (const row of allRows) {
    if (normalizeIsActive(row) !== false) continue;

    const roleId = String(row.OrgRoleId || row.RoleId || row.Role?.Identifier || row.Role?.Id || '').trim();
    if (roleId !== STUDENT_ROLE_ID) continue;

    const username = usernameKeys.reduce((acc, key) => acc || row[key], '') || getVal(row, ['Username', 'UserName']);
    const lastAccessed = parseDate(row.LastAccessed || row.LastAccessedDate || row['Last Login Date'] || row.LastLoginDate);

    result.push({
      UserId: getVal(row, ['UserId', 'Identifier', 'Id']) || '',
      OrgDefinedId: getVal(row, ['OrgDefinedId', 'Org Defined Id']) || '',
      FirstName: getVal(row, ['First Name', 'FirstName']) || '',
      LastName: getVal(row, ['Last Name', 'LastName']) || '',
      Username: username,
      Email: getVal(row, ['Email', 'EmailAddress', 'ExternalEmail']) || '',
      RoleId: roleId,
      IsActive: 'No',
      LastAccessed: lastAccessed ? formatDateForDisplay(lastAccessed) : '',
      _raw: row
    });
  }

  return result;
}

async function fetchInactiveUsersViaPagedAPI() {
  const pageSize = 100;
  const maxPages = 500;
  const users = [];
  let bookmark = null;
  let pageCount = 0;

  while (pageCount < maxPages) {
    pageCount++;
    let url = ENROLLMENTS_BASE + '?pageSize=' + pageSize + '&isActive=false';
    if (bookmark) url += '&bookmark=' + encodeURIComponent(bookmark);

    const response = await D2LApi._fetch(url);
    const items = response.Items || response.Objects || (Array.isArray(response) ? response : []);

    for (const item of items) {
      const user = item.User || item;
      const userId = user.UserId ?? user.Identifier ?? user.Id;
      if (userId == null) continue;

      const roleId = String((item.Role && (item.Role.Id ?? item.Role.Identifier)) || user.RoleId || '').trim();
      if (roleId !== STUDENT_ROLE_ID) continue;

      users.push({
        UserId: userId,
        OrgDefinedId: user.OrgDefinedId ?? '',
        FirstName: user.FirstName ?? '',
        LastName: user.LastName ?? '',
        Username: user.UserName ?? user.Username ?? '',
        Email: user.ExternalEmail ?? user.Email ?? '',
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

function escapeHtml(t) {
  if (t == null) return '';
  const div = document.createElement('div');
  div.textContent = String(t);
  return div.innerHTML;
}

function isRetiredUsername(username) {
  return String(username || '').includes('.retired.');
}

function stripRetiredSuffix(username) {
  const u = String(username || '');
  const idx = u.indexOf('.retired.');
  if (idx === -1) return u;
  return u.slice(0, idx);
}

async function BrightspaceFetch(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('XSRF.Token');
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (token) headers['X-CSRF-Token'] = token;
  const options = { method, headers, credentials: 'include' };
  if (body != null) options.body = JSON.stringify(body);

  const response = await fetch(endpoint, options);
  const newToken = response.headers.get('x-csrf-token');
  if (newToken && newToken !== token) localStorage.setItem('XSRF.Token', newToken);

  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    if (text) {
      try {
        const j = JSON.parse(text);
        detail = ' - ' + (j.message || j.detail || JSON.stringify(j));
      } catch {
        detail = ' - ' + text.substring(0, 300);
      }
    }
    throw new Error(`API ${response.status} ${response.statusText}${detail}`);
  }
  if (!text || text.trim() === '') return method === 'GET' ? [] : {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function getUserById(userId) {
  return await BrightspaceFetch(`/d2l/api/lp/${USERS_API_VERSION}/users/${encodeURIComponent(userId)}`, 'GET');
}

function buildUpdatePayload(userData, newUsername, isActive) {
  return {
    OrgDefinedId: userData.OrgDefinedId ?? '',
    FirstName: userData.FirstName ?? '',
    MiddleName: userData.MiddleName ?? null,
    LastName: userData.LastName ?? '',
    ExternalEmail: userData.ExternalEmail ?? null,
    UserName: newUsername ?? (userData.UserName ?? userData.Username ?? ''),
    Activation: { IsActive: !!isActive },
    Pronouns: userData.Pronouns ?? null
  };
}

async function reactivateUser(userRow, options) {
  const userId = userRow.UserId;
  const currentUsername = userRow.Username || '';
  const wantsStrip = !!options.stripRetired && isRetiredUsername(currentUsername);
  const newUsername = wantsStrip ? stripRetiredSuffix(currentUsername) : currentUsername;

  if (wantsStrip && newUsername && newUsername !== currentUsername) {
    const userData = await getUserById(userId);
    const payload = buildUpdatePayload(userData, newUsername, true);
    await BrightspaceFetch(`/d2l/api/lp/${USERS_API_VERSION}/users/${encodeURIComponent(userId)}`, 'PUT', payload);
    return { ok: true, userId, usernameBefore: currentUsername, usernameAfter: newUsername, method: 'PUT user' };
  }

  await BrightspaceFetch(`/d2l/api/lp/1.46/users/${encodeURIComponent(userId)}/activation`, 'PUT', { IsActive: true });
  return { ok: true, userId, usernameBefore: currentUsername, usernameAfter: currentUsername, method: 'PUT activation' };
}

function getSelectedUserIdsFromTable() {
  const ids = new Set();
  document.querySelectorAll('input.row-select[type="checkbox"]:checked').forEach(cb => {
    const id = cb.getAttribute('data-userid');
    if (id != null && String(id).trim() !== '') ids.add(String(id).trim());
  });
  return Array.from(ids);
}

function updateReactivateButtonState() {
  const btn = document.getElementById('reactivateSelected');
  if (!btn) return;
  const count = getSelectedUserIdsFromTable().length;
  btn.disabled = count === 0;
  btn.textContent = count ? `Reactivate Selected (${count})` : 'Reactivate Selected';
}

async function runReport() {
  const summaryEl = document.querySelector('#summary');
  const fetchBtn = document.getElementById('fetchBtn');
  const downloadBtn = document.getElementById('downloadCsv');
  const downloadIdsBtn = document.getElementById('downloadIds');
  const reactivateBtn = document.getElementById('reactivateSelected');
  const selectAll = document.getElementById('selectAll');

  fetchBtn.disabled = true;
  downloadBtn.style.display = 'none';
  downloadIdsBtn.style.display = 'none';
  reactivateBtn.style.display = 'none';
  reactivateBtn.disabled = true;
  if (selectAll) selectAll.checked = false;

  if (inactiveStudentsTable) {
    inactiveStudentsTable.destroy();
    inactiveStudentsTable = null;
  }

  LoadingUtils.showLoadingModal('Loading report...', 'loadingModal', () => {});
  const source = getSelectedSource();
  const fromPaged = source === 'paged';

  try {
    let inactiveList;
    if (fromPaged) {
      LoadingUtils.updateLoadingModal(10, 'Fetching inactive users from org ' + PAGED_ORG_UNIT_ID + '...', 'loadingModal');
      summaryEl.textContent = 'Fetching inactive students (this may take a while)...';
      inactiveList = await fetchInactiveUsersViaPagedAPI();
      LoadingUtils.updateLoadingModal(70, 'Building table...', 'loadingModal');
    } else {
      LoadingUtils.updateLoadingModal(20, 'Loading Data Hub user extract...', 'loadingModal');
      summaryEl.textContent = 'Loading Data Hub user extract...';
      const allUsers = await getUsersBDSData();
      LoadingUtils.updateLoadingModal(55, 'Filtering inactive students...', 'loadingModal');
      inactiveList = filterInactiveStudentsFromBDS(allUsers);
      LoadingUtils.updateLoadingModal(80, 'Building table...', 'loadingModal');
    }

    const excludeRetired = !!(document.getElementById('excludeRetired') && document.getElementById('excludeRetired').checked);
    if (excludeRetired) {
      inactiveList = inactiveList.filter(u => !isRetiredUsername(u.Username));
    }

    currentInactiveStudents = inactiveList;
    summaryEl.textContent =
      'Found ' +
      inactiveList.length +
      ' inactive student(s) (RoleId 101). Select rows then click "Reactivate Selected".';

    inactiveStudentsTable = $('#inactiveStudentsTable').DataTable({
      data: inactiveList,
      columns: [
        {
          data: null,
          orderable: false,
          render: function (row) {
            return `<input class="row-select" type="checkbox" data-userid="${escapeHtml(row.UserId)}" />`;
          }
        },
        { data: 'UserId', render: t => `<span class="mono">${escapeHtml(t)}</span>` },
        { data: 'OrgDefinedId', render: t => `<span class="mono">${escapeHtml(t)}</span>` },
        { data: 'FirstName', render: escapeHtml },
        { data: 'LastName', render: escapeHtml },
        { data: 'Username', render: t => `<span class="mono">${escapeHtml(t)}</span>` },
        { data: 'Email', render: t => `<span class="mono">${escapeHtml(t)}</span>` },
        { data: 'IsActive', render: escapeHtml },
        { data: 'LastAccessed', render: t => `<span class="mono">${escapeHtml(t)}</span>` }
      ],
      pageLength: 100,
      lengthMenu: [[25, 50, 100, 200, 500, -1], [25, 50, 100, 200, 500, 'All']],
      order: [[5, 'asc']],
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

    // Wire checkbox handlers (table redraw recreates DOM)
    $('#inactiveStudentsTable').off('change', 'input.row-select');
    $('#inactiveStudentsTable').on('change', 'input.row-select', function () {
      updateReactivateButtonState();
    });
    if (selectAll) {
      selectAll.onchange = () => {
        const checked = !!selectAll.checked;
        // Select all checkboxes on the current page only (DataTables changes DOM per page)
        $('#inactiveStudentsTable').DataTable().rows({ page: 'current' }).nodes().to$().find('input.row-select').prop('checked', checked);
        updateReactivateButtonState();
      };
    }

    downloadBtn.style.display = 'inline-flex';
    downloadIdsBtn.style.display = 'inline-flex';
    reactivateBtn.style.display = 'inline-flex';
    updateReactivateButtonState();

    LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
    setTimeout(() => LoadingUtils.hideLoadingModal('loadingModal'), 800);
  } catch (err) {
    console.error('Inactive Student Reactivation error:', err);
    summaryEl.textContent = 'Error: ' + (err.message || 'Failed to load inactive students');
    LoadingUtils.hideLoadingModal('loadingModal');
  } finally {
    fetchBtn.disabled = false;
  }
}

function downloadCSV() {
  if (!currentInactiveStudents || currentInactiveStudents.length === 0) {
    alert('No data to download.');
    return;
  }
  const rows = currentInactiveStudents.map(u => ({
    UserId: u.UserId,
    OrgDefinedId: u.OrgDefinedId,
    FirstName: u.FirstName,
    LastName: u.LastName,
    Username: u.Username,
    Email: u.Email,
    IsActive: u.IsActive,
    LastAccessed: u.LastAccessed
  }));
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'inactive-students-reactivation-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function downloadIdsOnePerLine() {
  if (!currentInactiveStudents || currentInactiveStudents.length === 0) {
    alert('No data to download.');
    return;
  }
  const lines = currentInactiveStudents.map(u => String(u.OrgDefinedId || '').trim()).filter(Boolean);
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'inactive-students-ids-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  URL.revokeObjectURL(url);
}

async function reactivateSelected() {
  const ids = getSelectedUserIdsFromTable();
  if (!ids.length) return;

  const stripRetired = !!(document.getElementById('stripRetiredOnReactivate') && document.getElementById('stripRetiredOnReactivate').checked);

  const rowsById = new Map(currentInactiveStudents.map(r => [String(r.UserId), r]));
  const selectedRows = ids.map(id => rowsById.get(String(id))).filter(Boolean);
  if (!selectedRows.length) return;

  const retiredSelected = selectedRows.filter(r => isRetiredUsername(r.Username)).length;
  const renameNote = stripRetired && retiredSelected
    ? `\n\nThis will also rename ${retiredSelected} username(s) by stripping ".retired.*".`
    : '';

  if (!confirm(`You are about to reactivate ${selectedRows.length} student account(s) in D2L.${renameNote}\n\nContinue?`)) {
    return;
  }

  const fetchBtn = document.getElementById('fetchBtn');
  const reactivateBtn = document.getElementById('reactivateSelected');
  const downloadBtn = document.getElementById('downloadCsv');
  const downloadIdsBtn = document.getElementById('downloadIds');
  const selectAll = document.getElementById('selectAll');
  const summaryEl = document.getElementById('summary');

  fetchBtn.disabled = true;
  reactivateBtn.disabled = true;
  downloadBtn.disabled = true;
  downloadIdsBtn.disabled = true;
  if (selectAll) selectAll.disabled = true;

  LoadingUtils.showLoadingModal('Reactivating users...', 'loadingModal', () => {});
  LoadingUtils.updateLoadingModal(5, 'Starting...', 'loadingModal');

  let ok = 0;
  let fail = 0;
  const failures = [];

  for (let i = 0; i < selectedRows.length; i++) {
    const r = selectedRows[i];
    const label = `${r.Username || ''} (UserId ${r.UserId})`;
    const pct = Math.round(((i + 1) / selectedRows.length) * 100);
    LoadingUtils.updateLoadingModal(pct, `Reactivating ${i + 1} / ${selectedRows.length}: ${label}`, 'loadingModal');

    try {
      await reactivateUser(r, { stripRetired });
      ok++;
    } catch (e) {
      fail++;
      failures.push({ UserId: r.UserId, Username: r.Username, Error: e.message || String(e) });
    }
  }

  if (failures.length) {
    console.warn('Reactivation failures:', failures);
  }

  const msg = `Reactivation complete: ${ok} succeeded, ${fail} failed.`;
  summaryEl.textContent = msg + (fail ? ' See console for details.' : ' Refresh the report to verify.');

  LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
  setTimeout(() => LoadingUtils.hideLoadingModal('loadingModal'), 900);

  fetchBtn.disabled = false;
  downloadBtn.disabled = false;
  downloadIdsBtn.disabled = false;
  if (selectAll) selectAll.disabled = false;

  // Leave selections as-is; user can refresh to see them disappear from list.
  reactivateBtn.disabled = false;
  updateReactivateButtonState();
}

function switchInactiveStudentsSource(source) {
  const tabList = document.getElementById('sourceTabList');
  const descDataHub = document.getElementById('sourceDescDataHub');
  const descPaged = document.getElementById('sourceDescPaged');
  if (!tabList) return;

  tabList.querySelectorAll('.source-tab').forEach(t => {
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

window.switchInactiveStudentsSource = switchInactiveStudentsSource;

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('fetchBtn').addEventListener('click', runReport);
  document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
  document.getElementById('downloadIds').addEventListener('click', downloadIdsOnePerLine);
  document.getElementById('reactivateSelected').addEventListener('click', reactivateSelected);
});

