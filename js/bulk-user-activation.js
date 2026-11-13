/**
 * Bulk User Activation (INACTIVE → ACTIVE)
 * Upload a headerless CSV of Brightspace UserIds (one per line, or first column).
 * Sets each account to active via PUT /users/{userId}/activation.
 * Optional: strip ".retired.*" from username when reactivating retired accounts.
 */

const USERS_API_VERSION = '1.49';

let parsedUserIds = [];
let lastResults = [];

async function BrightspaceFetch(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('XSRF.Token');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
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

function userIsActive(userData) {
  const act = userData && (userData.Activation || userData.activation);
  if (act && act.IsActive != null) return !!act.IsActive;
  if (userData && userData.IsActive != null) return !!(userData.IsActive === true || userData.IsActive === 'true' || userData.IsActive === 1);
  return null;
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

async function activateUserRecord(userData, options) {
  const userId = userData.UserId;
  const currentUsername = userData.UserName || userData.Username || '';
  const wantsStrip = !!options.stripRetired && isRetiredUsername(currentUsername);
  const newUsername = wantsStrip ? stripRetiredSuffix(currentUsername) : currentUsername;

  if (wantsStrip && newUsername && newUsername !== currentUsername) {
    const payload = buildUpdatePayload(userData, newUsername, true);
    await BrightspaceFetch(`/d2l/api/lp/${USERS_API_VERSION}/users/${encodeURIComponent(userId)}`, 'PUT', payload);
    return { method: 'PUT user (rename + active)' };
  }

  await BrightspaceFetch(`/d2l/api/lp/1.46/users/${encodeURIComponent(userId)}/activation`, 'PUT', { IsActive: true });
  return { method: 'PUT activation' };
}

/** Parse headerless CSV or single-column file into numeric/string UserIds. */
function parseUserIdsFromCsvText(text) {
  const parsed = Papa.parse(text, {
    header: false,
    skipEmptyLines: true,
    transform: v => (v == null ? '' : String(v).trim())
  });

  const raw = [];
  for (const row of parsed.data || []) {
    if (!row || !row.length) continue;
    const first = String(row[0] || '').trim();
    if (!first) continue;
    raw.push(first);
  }

  if (!raw.length) return [];

  const headerLike = new Set([
    'userid', 'user id', 'user_id', 'id', 'identifier', 'd2l_userid', 'd2l userid'
  ]);
  let start = 0;
  if (raw.length > 1 && headerLike.has(raw[0].toLowerCase())) {
    start = 1;
  }

  const ids = [];
  const seen = new Set();
  for (let i = start; i < raw.length; i++) {
    const id = raw[i].replace(/^["']|["']$/g, '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function renderPreview(ids) {
  const previewCard = document.getElementById('previewCard');
  const previewBody = document.getElementById('previewBody');
  const slice = ids.slice(0, 25);
  previewBody.innerHTML = slice
    .map(id => `<tr><td class="mono">${escapeHtml(id)}</td></tr>`)
    .join('');
  if (ids.length > 25) {
    previewBody.innerHTML +=
      `<tr><td colspan="1" style="color:var(--text-secondary);font-style:italic;">… and ${ids.length - 25} more</td></tr>`;
  }
  previewCard.style.display = 'block';
}

function setSummary(text) {
  const el = document.getElementById('summary');
  if (el) el.textContent = text;
}

function updateRunButton() {
  const runBtn = document.getElementById('runBtn');
  const clearBtn = document.getElementById('clearBtn');
  const downloadBtn = document.getElementById('downloadResults');
  if (!runBtn) return;
  const n = parsedUserIds.length;
  runBtn.disabled = n === 0;
  runBtn.innerHTML = n
    ? `<i class="fas fa-user-check"></i> Activate ${n} User${n === 1 ? '' : 's'}`
    : '<i class="fas fa-user-check"></i> Activate Users';
  if (clearBtn) clearBtn.style.display = n ? 'inline-flex' : 'none';
  if (downloadBtn) downloadBtn.style.display = lastResults.length ? 'inline-flex' : 'none';
}

function appendLogLine(logEl, cls, text) {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = text;
  logEl.appendChild(line);
}

async function handleFileSelect(file) {
  if (!file) return;
  const text = await file.text();
  parsedUserIds = parseUserIdsFromCsvText(text);
  lastResults = [];
  document.getElementById('resultsCard').style.display = 'none';
  document.getElementById('resultsLog').innerHTML = '';

  if (!parsedUserIds.length) {
    setSummary('No UserIds found. Use a headerless CSV with one Brightspace UserId per line.');
    document.getElementById('previewCard').style.display = 'none';
    updateRunButton();
    return;
  }

  setSummary(`Loaded ${parsedUserIds.length} unique UserId(s). Review the preview, then click Activate.`);
  renderPreview(parsedUserIds);
  updateRunButton();
}

async function runBulkActivation() {
  if (!parsedUserIds.length) return;

  const stripRetired = !!(document.getElementById('stripRetiredOnActivate') && document.getElementById('stripRetiredOnActivate').checked);
  const skipAlreadyActive = !!(document.getElementById('skipAlreadyActive') && document.getElementById('skipAlreadyActive').checked);

  const renameNote = stripRetired
    ? '\n\nUsernames containing ".retired." will be restored (suffix removed) when needed.'
    : '';

  if (!confirm(`Activate ${parsedUserIds.length} user account(s) in D2L (INACTIVE → ACTIVE)?${renameNote}\n\nContinue?`)) {
    return;
  }

  const runBtn = document.getElementById('runBtn');
  const clearBtn = document.getElementById('clearBtn');
  const csvFile = document.getElementById('csvFile');
  const resultsCard = document.getElementById('resultsCard');
  const resultsLog = document.getElementById('resultsLog');

  runBtn.disabled = true;
  clearBtn.disabled = true;
  if (csvFile) csvFile.disabled = true;

  resultsCard.style.display = 'block';
  resultsLog.innerHTML = '';
  lastResults = [];

  LoadingUtils.showLoadingModal('Activating users...', 'loadingModal', () => {});

  let ok = 0;
  let skipped = 0;
  let fail = 0;

  for (let i = 0; i < parsedUserIds.length; i++) {
    const userId = parsedUserIds[i];
    const pct = Math.round(((i + 1) / parsedUserIds.length) * 100);
    LoadingUtils.updateLoadingModal(pct, `Processing ${i + 1} / ${parsedUserIds.length}: UserId ${userId}`, 'loadingModal');

    const row = { UserId: userId, OrgDefinedId: '', Username: '', Status: '', Message: '', Method: '' };

    try {
      const userData = await getUserById(userId);
      row.OrgDefinedId = userData.OrgDefinedId || '';
      row.Username = userData.UserName || userData.Username || '';

      const active = userIsActive(userData);
      if (active === true && skipAlreadyActive) {
        row.Status = 'Skipped';
        row.Message = 'Already active';
        skipped++;
        appendLogLine(resultsLog, 'skip', `SKIP: UserId ${userId} (${row.Username}) — already active`);
        lastResults.push(row);
        continue;
      }

      const result = await activateUserRecord(userData, { stripRetired });
      row.Status = 'OK';
      row.Message = active === true ? 'Was already active; activation call succeeded' : 'Activated';
      row.Method = result.method;
      ok++;
      appendLogLine(resultsLog, 'ok', `OK: UserId ${userId} (${row.Username}) — ${row.Method}`);
    } catch (e) {
      row.Status = 'Error';
      row.Message = e.message || String(e);
      fail++;
      appendLogLine(resultsLog, 'err', `ERR: UserId ${userId} — ${row.Message}`);
    }

    lastResults.push(row);
  }

  const summary =
    `Complete: ${ok} activated, ${skipped} skipped, ${fail} failed (of ${parsedUserIds.length} loaded).` +
    (fail ? ' Download results CSV for error details.' : '');
  setSummary(summary);

  LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
  setTimeout(() => LoadingUtils.hideLoadingModal('loadingModal'), 800);

  runBtn.disabled = false;
  clearBtn.disabled = false;
  if (csvFile) csvFile.disabled = false;
  updateRunButton();
}

function downloadResultsCsv() {
  if (!lastResults.length) {
    alert('No results to download.');
    return;
  }
  const csv = Papa.unparse(lastResults);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bulk-user-activation-results-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function clearAll() {
  parsedUserIds = [];
  lastResults = [];
  const csvFile = document.getElementById('csvFile');
  if (csvFile) csvFile.value = '';
  document.getElementById('previewCard').style.display = 'none';
  document.getElementById('resultsCard').style.display = 'none';
  document.getElementById('resultsLog').innerHTML = '';
  setSummary('Upload a headerless CSV with one Brightspace UserId per line (no column headers).');
  updateRunButton();
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('csvFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (file) handleFileSelect(file);
  });
  document.getElementById('runBtn').addEventListener('click', runBulkActivation);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  document.getElementById('downloadResults').addEventListener('click', downloadResultsCsv);
  updateRunButton();
});
