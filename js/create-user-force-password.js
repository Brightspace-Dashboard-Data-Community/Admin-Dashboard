/**
 * create-user-force-password.js
 * Create Manual User → Force Password Reset tab on Create User page.
 * Creates a Brightspace user, sets temp password via PUT /users/{{id}}/password
 * with ForcePasswordReset = true, preps welcome email for /d2l/login?noredirect=1.
 */

const CONFIG = {
  loginUrl: 'https://your-brightspace.example.edu/d2l/login?noredirect=1',
  lpBase: '/d2l/api/lp/',
  lpUsersVersion: '1.57',       // LP 1.57 for all user/password (matches your LatestVersion)
  lpRolesVersion: '1.47',
  lpEnrollmentsVersion: '1.46'
};

function getCsrfToken() {
  return localStorage.getItem('csrfToken') || localStorage.getItem('XSRF.Token') || '';
}

async function BrightspaceFetch(path, method, bodyObj) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getCsrfToken();
  if (token) headers['X-CSRF-Token'] = token;

  const res = await fetch(path, {
    method: method || 'GET',
    credentials: 'include',
    headers,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined
  });

  const text = await res.text();
  const ct = res.headers.get('content-type') || '';

  if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + text);
  return ct.includes('application/json') ? JSON.parse(text) : text;
}

function log(msg) {
  const el = document.getElementById('fp-console');
  if (!el) return;
  el.textContent = (new Date()).toISOString() + '  ' + msg + '\n' + el.textContent;
}

async function loadRolesIntoSelect() {
  const rolesUrl = `${CONFIG.lpBase}${CONFIG.lpRolesVersion}/roles/`;
  const sel = document.getElementById('fp-roleIdSelect');
  if (!sel) return;

  sel.innerHTML = '<option value="">(loading…)</option>';

  try {
    const roles = await BrightspaceFetch(rolesUrl, 'GET');
    if (!Array.isArray(roles)) {
      sel.innerHTML = '<option value="">(invalid response)</option>';
      return;
    }

    roles.sort((a, b) => parseInt(a.Identifier) - parseInt(b.Identifier));
    sel.innerHTML = '<option value="">— select a role —</option>';
    for (const r of roles) {
      const opt = document.createElement('option');
      opt.value = r.Identifier;
      opt.textContent = `${r.Identifier} — ${r.DisplayName}`;
      sel.appendChild(opt);
    }
    log('Roles fetched: ' + roles.map(r => `${r.Identifier} — ${r.DisplayName}`).join(', '));
  } catch (e) {
    sel.innerHTML = '<option value="">(failed to load roles)</option>';
    log('ERROR loading roles: ' + e.message);
  }
}

function getSelectedRoleId() {
  const fromSelect = (document.getElementById('fp-roleIdSelect')?.value || '').trim();
  const typed = (document.getElementById('fp-roleId')?.value || '').trim();
  if (fromSelect) return parseInt(fromSelect, 10);
  if (typed) return parseInt(typed, 10);
  return NaN;
}

function getBulkRoleId() {
  const fromSelect = (document.getElementById('bulk-roleIdSelect')?.value || '').trim();
  const typed = (document.getElementById('bulk-roleId')?.value || '').trim();
  if (fromSelect) return parseInt(fromSelect, 10);
  if (typed) return parseInt(typed, 10);
  return NaN;
}

function genPassword() {
  const upp = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const low = 'abcdefghijkmnpqrstuvwxyz';
  const num = '23456789';
  const sym = '!@#$%^*?';
  const all = upp + low + num + sym;
  const pick = s => s.charAt(Math.floor(Math.random() * s.length));
  let p = pick(upp) + pick(low) + pick(num) + pick(sym);
  for (let i = 0; i < 8; i++) p += pick(all);
  return p.split('').sort(() => Math.random() - 0.5).join('');
}

function buildWelcomeBody(first, userName, tempPw) {
  return [
    'Hello ' + first + ',',
    '',
    'A Brightspace account has been created for you. Please log in at:',
    CONFIG.loginUrl,
    '',
    'Username: ' + userName,
    'Temporary Password: ' + tempPw,
    '',
    'You will be prompted to change your password at first login.',
    '',
    'If you have any trouble, please contact the eLearning Office.'
  ].join('\n');
}

let lastUser = null;

async function findUserBy(query) {
  const qs = new URLSearchParams(query).toString();
  const url = `${CONFIG.lpBase}${CONFIG.lpUsersVersion}/users/?${qs}`;
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'X-CSRF-Token': getCsrfToken() }
    });
    const txt = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Users HTTP ${res.status} — ${txt}`);
    try { return JSON.parse(txt); } catch { return txt; }
  } catch (e) {
    return null;
  }
}

async function runPreflight() {
  const out = document.getElementById('fp-createResult');
  if (out) {
    out.style.display = 'block';
    out.textContent = 'Running preflight checks…';
  }

  const roleId = getSelectedRoleId();
  const userName = (document.getElementById('fp-userName')?.value || '').trim();
  const orgDefinedId = (document.getElementById('fp-orgDefinedId')?.value || '').trim();
  const externalEmail = (document.getElementById('fp-externalEmail')?.value || '').trim();
  const sendCreationEmail = (document.getElementById('fp-sendCreationEmail')?.value === 'true');

  try {
    const roles = await BrightspaceFetch(`${CONFIG.lpBase}${CONFIG.lpRolesVersion}/roles/`, 'GET');
    const role = (roles || []).find(r => String(r.Identifier) === String(roleId));
    if (!role) {
      if (out) out.textContent += `\n❌ RoleId ${roleId || '(none)'} not found. Select from dropdown or refresh roles.`;
      return false;
    }
    if (out) out.textContent += `\n✅ RoleId ${role.Identifier} (${role.DisplayName}) found.`;
  } catch (e) {
    if (out) out.textContent += '\n⚠️ Could not fetch roles (continuing).';
  }

  if (userName) {
    const byUN = await findUserBy({ userName });
    if (byUN && byUN.UserId) {
      if (out) out.textContent += `\n❌ Username "${userName}" already exists.`;
      return false;
    }
    if (out) out.textContent += `\n✅ Username "${userName}" available.`;
  }

  if (orgDefinedId) {
    const byOD = await findUserBy({ orgDefinedId });
    if (byOD && byOD.UserId) {
      if (out) out.textContent += `\n❌ OrgDefinedId "${orgDefinedId}" already in use.`;
      return false;
    }
    if (out) out.textContent += `\n✅ OrgDefinedId "${orgDefinedId}" available.`;
  }

  if (sendCreationEmail && !externalEmail) {
    if (out) out.textContent += '\n❌ SendCreationEmail=true requires ExternalEmail.';
    return false;
  }
  if (externalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(externalEmail)) {
    if (out) out.textContent += '\n❌ ExternalEmail looks invalid.';
    return false;
  }

  if (out) out.textContent += '\nPreflight passed.';
  return true;
}

function buildCreateUserPayload(includePasswordData, tempPassword) {
  const p = {
    OrgDefinedId: (document.getElementById('fp-orgDefinedId')?.value || '').trim() || null,
    FirstName: (document.getElementById('fp-firstName')?.value || '').trim(),
    MiddleName: null,
    LastName: (document.getElementById('fp-lastName')?.value || '').trim(),
    ExternalEmail: (document.getElementById('fp-externalEmail')?.value || '').trim() || null,
    UserName: (document.getElementById('fp-userName')?.value || '').trim(),
    RoleId: getSelectedRoleId(),
    IsActive: true,
    SendCreationEmail: (document.getElementById('fp-sendCreationEmail')?.value === 'true'),
    Pronouns: null
  };
  if (includePasswordData && tempPassword) {
    p.PasswordData = { Password: tempPassword, ForcePasswordReset: true };
  }
  if (!p.FirstName) throw new Error('First Name is required.');
  if (!p.LastName) throw new Error('Last Name is required.');
  if (!p.UserName) throw new Error('Username is required.');
  if (!/^[A-Za-z0-9._-]+$/.test(p.UserName)) throw new Error('Username has invalid characters.');
  if (Number.isNaN(p.RoleId)) throw new Error('RoleId is required and must be numeric (use dropdown or type).');
  if (p.SendCreationEmail && !p.ExternalEmail) throw new Error('ExternalEmail required when SendCreationEmail=true.');
  if (p.ExternalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.ExternalEmail)) throw new Error('ExternalEmail looks invalid.');
  return p;
}

async function setUserPassword(userId, password, forceReset) {
  const url = `${CONFIG.lpBase}${CONFIG.lpUsersVersion}/users/${encodeURIComponent(userId)}/password`;
  const body = { Password: password, ForcePasswordReset: !!forceReset };
  const headers = { 'Content-Type': 'application/json' };
  const token = getCsrfToken();
  if (token) headers['X-CSRF-Token'] = token;

  const res = await fetch(url, { method: 'PUT', credentials: 'include', headers, body: JSON.stringify(body) });
  const text = await res.text();

  if (!(res.ok || res.status === 204)) throw new Error('HTTP ' + res.status + ' — ' + text);
  return true;
}

/** POST to password endpoint with ForcePasswordReset: true to flag user for reset on next login (UserResetPassword). */
async function forcePasswordResetOnNextLogin(userId) {
  const url = `${CONFIG.lpBase}${CONFIG.lpUsersVersion}/users/${encodeURIComponent(userId)}/password`;
  const body = { ForcePasswordReset: true };
  const headers = { 'Content-Type': 'application/json' };
  const token = getCsrfToken();
  if (token) headers['X-CSRF-Token'] = token;

  const res = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
  const text = await res.text();

  if (!(res.ok || res.status === 204)) throw new Error('HTTP ' + res.status + ' — ' + text);
  return true;
}

function initForcePasswordTab() {
  const btnGenPass = document.getElementById('fp-btnGenPass');
  const btnRefreshRoles = document.getElementById('fp-btnRefreshRoles');
  const btnPreflight = document.getElementById('fp-btnPreflight');
  const btnCreate = document.getElementById('fp-btnCreate');
  const btnEnroll = document.getElementById('fp-btnEnroll');
  const btnMailto = document.getElementById('fp-btnMailto');
  const btnCopy = document.getElementById('fp-btnCopy');

  if (btnGenPass) btnGenPass.addEventListener('click', () => { const el = document.getElementById('fp-tempPassword'); if (el) el.value = genPassword(); });
  if (btnRefreshRoles) btnRefreshRoles.addEventListener('click', loadRolesIntoSelect);
  if (btnPreflight) btnPreflight.addEventListener('click', () => runPreflight());

  if (btnCreate) {
    btnCreate.addEventListener('click', async () => {
      const out = document.getElementById('fp-createResult');
      if (out) out.style.display = 'block';

      const ok = await runPreflight();
      if (!ok) return;

      const tempPw = (document.getElementById('fp-tempPassword')?.value || '').trim();
      let payload;
      try { payload = buildCreateUserPayload(!!tempPw, tempPw || ''); }
      catch (e) {
        if (out) out.textContent = 'Validation error: ' + e.message;
        return;
      }

      const usersUrl = `${CONFIG.lpBase}${CONFIG.lpUsersVersion}/users/`;

      if (out) out.textContent = 'Creating user…' + (payload.PasswordData ? '\n(LP 1.57: PasswordData at creation + force reset on next login)' : '\n(Will set password then force reset on next login.)');

      try {
        let created;
        if (payload.PasswordData) {
          try {
            created = await BrightspaceFetch(usersUrl, 'POST', payload);
            if (out) out.textContent = 'User created with PasswordData.\n' + JSON.stringify(created, null, 2);
            log('Created with PasswordData (LP 1.57).');
            const uid = created.UserId ?? created.Identifier;
            await forcePasswordResetOnNextLogin(uid);
            if (out) out.textContent += '\n\n✅ ForcePasswordReset flagged (POST password).';
            log('POST password with ForcePasswordReset=true.');
          } catch (err57) {
            const status = err57.message && err57.message.match(/HTTP (\d+)/);
            const code = status ? parseInt(status[1], 10) : 0;
            if (code === 403 || code === 400 || code === 404) {
              if (out) out.textContent += '\n(Create with PasswordData not permitted, using create then set password.)';
              delete payload.PasswordData;
              created = await BrightspaceFetch(usersUrl, 'POST', payload);
              const userId = created.UserId ?? created.Identifier;
              if (tempPw) {
                await setUserPassword(userId, tempPw, true);
                await forcePasswordResetOnNextLogin(userId);
                if (out) out.textContent = 'User created. Password set + ForcePasswordReset flagged.\n' + JSON.stringify(created, null, 2);
              } else {
                if (out) out.textContent = 'User created (no password set).\n' + JSON.stringify(created, null, 2);
              }
            } else {
              throw err57;
            }
          }
        } else {
          created = await BrightspaceFetch(usersUrl, 'POST', payload);
          if (out) out.textContent = 'User created.\n' + JSON.stringify(created, null, 2);
          if (tempPw) {
            const userId = created.UserId ?? created.Identifier;
            await setUserPassword(userId, tempPw, true);
            await forcePasswordResetOnNextLogin(userId);
            if (out) out.textContent += '\n\n✅ Password set + ForcePasswordReset flagged (PUT then POST password).';
          }
        }
        lastUser = created;

        const emailBody = buildWelcomeBody(
          payload.FirstName,
          payload.UserName,
          (document.getElementById('fp-tempPassword')?.value || '').trim() || '(sent separately)'
        );
        const emailBodyEl = document.getElementById('fp-emailBody');
        const emailToEl = document.getElementById('fp-emailTo');
        if (emailBodyEl) emailBodyEl.value = emailBody;
        if (payload.ExternalEmail && emailToEl) emailToEl.value = payload.ExternalEmail;
      } catch (err) {
        if (out) {
          try {
            const pd = JSON.parse((err.message.split('— ')[1] || '').trim() || '{}');
            if (pd && pd.detail) { out.textContent = 'Error creating user: ' + pd.detail; return; }
          } catch (_) {}
          out.textContent = 'Error creating user:\n' + err.message;
        }
      }
    });
  }

  if (btnEnroll) {
    btnEnroll.addEventListener('click', async () => {
      if (!lastUser || (!lastUser.UserId && !lastUser.Identifier)) {
        alert('Create a user first. No user in memory.');
        return;
      }
      const userIdRaw = lastUser.UserId ?? lastUser.Identifier;
      const userId = parseInt(userIdRaw, 10);
      if (Number.isNaN(userId)) {
        alert('Invalid user ID from created user. Try creating the user again.');
        return;
      }
      const ou = (document.getElementById('fp-enrollOrgUnitId')?.value || '').trim();
      const roleStr = (document.getElementById('fp-enrollRoleId')?.value || '').trim();
      const role = parseInt(roleStr, 10);
      if (!ou) {
        alert('Please enter OrgUnitId (Course Offering ID).');
        return;
      }
      if (!roleStr || Number.isNaN(role)) {
        alert('Please enter a valid Enroll As RoleId (e.g. 101 for Student, 102 for Instructor).');
        return;
      }
      const orgUnitId = parseInt(ou, 10);
      if (Number.isNaN(orgUnitId)) {
        alert('OrgUnitId must be a number (e.g. 2901369).');
        return;
      }

      // LP enrollments API: POST /d2l/api/lp/{version}/enrollments/ (same as enrollment-actions.js)
      const url = `${CONFIG.lpBase}${CONFIG.lpEnrollmentsVersion}/enrollments/`;
      const body = {
        OrgUnitId: orgUnitId,
        UserId: userId,
        RoleId: role,
        IsCascading: false
      };

      const out = document.getElementById('fp-enrollResult');
      if (out) { out.style.display = 'block'; out.textContent = 'Enrolling user…'; }
      log(`Enroll: POST ${url} with UserId=${userId}, OrgUnitId=${orgUnitId}, RoleId=${role}`);

      try {
        const res = await BrightspaceFetch(url, 'POST', body);
        if (out) out.textContent = 'Enrollment successful.\n' + (res && Object.keys(res).length ? JSON.stringify(res, null, 2) : '(No body returned)');
        log('Enrollment completed successfully.');
      } catch (err) {
        if (out) out.textContent = 'Error enrolling user:\n' + err.message;
        log('Enrollment failed: ' + err.message);
      }
    });
  }

  if (btnMailto) {
    btnMailto.addEventListener('click', () => {
      const to = (document.getElementById('fp-emailTo')?.value || '').trim();
      const sub = (document.getElementById('fp-emailSub')?.value || '').trim();
      const body = (document.getElementById('fp-emailBody')?.value || '');
      if (!to) { alert('Provide at least one recipient email.'); return; }
      window.location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(sub) + '&body=' + encodeURIComponent(body);
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', async () => {
      const el = document.getElementById('fp-emailBody');
      if (!el) return;
      try {
        await navigator.clipboard.writeText(el.value);
        alert('Email body copied to clipboard.');
      } catch (_) {
        alert('Could not copy. Select the text and copy manually.');
      }
    });
  }

  loadRolesIntoSelect();
}

// ---------- Bulk Create tab ----------
let bulkCreatedUsers = [];

function bulkLog(msg) {
  const el = document.getElementById('bulk-console');
  if (el) el.textContent = (new Date()).toISOString() + '  ' + msg + '\n' + el.textContent;
}

function slug(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

function parseBulkCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headerLine = (lines[0] || '').toLowerCase();
  const headerParts = headerLine.split(',').map(p => p.replace(/^"|"$/g, '').trim().replace(/_/g, ' '));
  let firstIdx = 0, lastIdx = 1, emailIdx = 2;
  const hasHeader = headerParts.some(p => p.includes('first') && p.includes('name')) ||
    headerParts.some(p => p.includes('last') && p.includes('name')) ||
    headerParts.some(p => p.includes('email'));
  if (hasHeader) {
    firstIdx = headerParts.findIndex(p => p.includes('first') && p.includes('name'));
    lastIdx = headerParts.findIndex(p => p.includes('last') && p.includes('name'));
    emailIdx = headerParts.findIndex(p => p.includes('email'));
    if (firstIdx === -1) firstIdx = 0;
    if (lastIdx === -1) lastIdx = 1;
    if (emailIdx === -1) emailIdx = 2;
  }
  const rows = [];
  const start = hasHeader ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(',').map(p => p.replace(/^"|"$/g, '').trim());
    const firstName = (parts[firstIdx] ?? '').trim();
    const lastName = (parts[lastIdx] ?? '').trim();
    const email = (parts[emailIdx] ?? '').trim();
    if (firstName || lastName || email) rows.push({ firstName, lastName, email });
  }
  return rows;
}

/** Returns true if this username already exists in D2L. */
async function usernameExistsInD2L(userName) {
  const u = await findUserBy({ userName });
  if (Array.isArray(u)) return u.length > 0 && !!(u[0].UserId || u[0].Identifier);
  return !!(u && (u.UserId || u.Identifier));
}

/** Generate guser.firstnamelastname; if taken in D2L or in batch, append number until free. */
async function generateBulkUsername(firstName, lastName, existingInBatch) {
  const base = 'guser.' + slug(firstName) + slug(lastName);
  if (!base.replace('guser.', '')) return null;
  let username = base;
  let n = 0;
  for (;;) {
    const candidate = n === 0 ? base : base + n;
    if (existingInBatch.has(candidate)) {
      n++;
      continue;
    }
    const takenInD2L = await usernameExistsInD2L(candidate);
    if (!takenInD2L) {
      username = candidate;
      existingInBatch.add(username);
      return username;
    }
    if (n === 0) bulkLog(`Username "${base}" already exists in D2L, trying suffix.`);
    n = n === 0 ? 2 : n + 1;
  }
}

async function loadBulkRoles() {
  const sel = document.getElementById('bulk-roleIdSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">(loading…)</option>';
  try {
    const roles = await BrightspaceFetch(`${CONFIG.lpBase}${CONFIG.lpRolesVersion}/roles/`, 'GET');
    if (!Array.isArray(roles)) { sel.innerHTML = '<option value="">(invalid)</option>'; return; }
    roles.sort((a, b) => parseInt(a.Identifier) - parseInt(b.Identifier));
    sel.innerHTML = '<option value="">— select role —</option>';
    for (const r of roles) {
      const opt = document.createElement('option');
      opt.value = r.Identifier;
      opt.textContent = `${r.Identifier} — ${r.DisplayName}`;
      sel.appendChild(opt);
    }
  } catch (e) {
    sel.innerHTML = '<option value="">(failed)</option>';
  }
}

function buildBulkEmailBody(users) {
  const lines = [
    'Hello,',
    '',
    'Brightspace accounts have been created. Please log in at:',
    CONFIG.loginUrl,
    '',
    'Use an Incognito/Private browser window so you are prompted to change your password on first login.',
    '',
    '---',
    ''
  ];
  for (const u of users) {
    lines.push(`${u.firstName} ${u.lastName} (${u.email})`);
    lines.push(`  Username: ${u.userName}`);
    lines.push(`  Temporary Password: ${u.tempPassword}`);
    lines.push('');
  }
  lines.push('You will be prompted to change your password at first login.');
  lines.push('');
  lines.push('If you have any trouble, please contact the eLearning Office.');
  return lines.join('\n');
}

/** Build welcome email body for a single user (for per-row "Email" button). */
function buildSingleUserEmailBody(user) {
  return [
    'Hello ' + (user.firstName || '') + ',',
    '',
    'A Brightspace account has been created for you. Please log in at:',
    CONFIG.loginUrl,
    '',
    'Use an Incognito/Private browser window so you are prompted to change your password on first login.',
    '',
    'Username: ' + user.userName,
    'Temporary Password: ' + user.tempPassword,
    '',
    'You will be prompted to change your password at first login.',
    '',
    'If you have any trouble, please contact the eLearning Office.'
  ].join('\n');
}

function initBulkTab() {
  const csvInput = document.getElementById('bulk-csv');
  const bulkBtnCreate = document.getElementById('bulk-btnCreate');
  const bulkBtnEnrollAll = document.getElementById('bulk-btnEnrollAll');
  const bulkBtnDownloadCsv = document.getElementById('bulk-btnDownloadCsv');

  if (bulkBtnCreate) {
    bulkBtnCreate.addEventListener('click', async () => {
      const fileInput = document.getElementById('bulk-csv');
      const out = document.getElementById('bulk-createResult');
      const afterSection = document.getElementById('bulk-after-section');
      const tbody = document.getElementById('bulk-users-tbody');
      if (!fileInput || !fileInput.files.length) {
        alert('Please select a CSV file.');
        return;
      }
      const roleId = getBulkRoleId();
      if (Number.isNaN(roleId)) {
        alert('Please select or enter a Role.');
        return;
      }

      let text;
      try {
        text = await fileInput.files[0].text();
      } catch (e) {
        if (out) out.textContent = 'Could not read file: ' + e.message;
        return;
      }
      const rows = parseBulkCsv(text);
      if (!rows.length) {
        if (out) { out.style.display = 'block'; out.textContent = 'No valid rows found in CSV. Expected columns: first_name, last_name, email'; }
        return;
      }

      bulkCreatedUsers = [];
      if (out) { out.style.display = 'block'; out.textContent = `Creating ${rows.length} user(s)…`; }
      bulkLog(`Starting bulk create: ${rows.length} rows, RoleId=${roleId} (unique password per user)`);

      const existingUsernames = new Set();
      const usersUrl = `${CONFIG.lpBase}${CONFIG.lpUsersVersion}/users/`;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const userName = await generateBulkUsername(r.firstName, r.lastName, existingUsernames);
        if (!userName) {
          bulkLog(`Skip row ${i + 1}: no valid name`);
          continue;
        }
        const tempPassword = genPassword();
        const payload = {
          OrgDefinedId: null,
          FirstName: r.firstName,
          MiddleName: null,
          LastName: r.lastName,
          ExternalEmail: r.email || null,
          UserName: userName,
          RoleId: roleId,
          IsActive: true,
          SendCreationEmail: false,
          Pronouns: null,
          PasswordData: { Password: tempPassword, ForcePasswordReset: true }
        };
        try {
          let created;
          try {
            created = await BrightspaceFetch(usersUrl, 'POST', payload);
            const uid = created.UserId ?? created.Identifier;
            await forcePasswordResetOnNextLogin(uid);
            bulkLog(`Created: ${userName} (UserId ${uid}) with PasswordData + POST force reset.`);
          } catch (err57) {
            const status = err57.message && err57.message.match(/HTTP (\d+)/);
            const code = status ? parseInt(status[1], 10) : 0;
            if (code === 403 || code === 400 || code === 404) {
              delete payload.PasswordData;
              created = await BrightspaceFetch(usersUrl, 'POST', payload);
              const userId = created.UserId ?? created.Identifier;
              await setUserPassword(userId, tempPassword, true);
              await forcePasswordResetOnNextLogin(userId);
              bulkLog(`Created: ${userName} (UserId ${userId}) via fallback; password + POST force reset.`);
            } else {
              throw err57;
            }
          }
          const userId = created.UserId ?? created.Identifier;
          bulkCreatedUsers.push({
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            userName,
            userId,
            tempPassword
          });
        } catch (err) {
          bulkLog(`Failed row ${i + 1} (${r.firstName} ${r.lastName}): ${err.message}`);
          if (out) out.textContent += '\nFailed: ' + r.firstName + ' ' + r.lastName + ' — ' + err.message;
        }
      }

      if (out) out.textContent = `Created ${bulkCreatedUsers.length} of ${rows.length} user(s). Each user has a unique temporary password.`;
      if (afterSection) afterSection.style.display = 'block';
      if (tbody) {
        tbody.innerHTML = '';
        const subjectDefault = 'Your D2L Brightspace Login Information';
        for (const u of bulkCreatedUsers) {
          const tr = document.createElement('tr');
          const subject = (document.getElementById('bulk-emailSub')?.value || subjectDefault).trim();
          const emailBtn = document.createElement('button');
          emailBtn.type = 'button';
          emailBtn.className = 'btn btn-outline btn-sm';
          emailBtn.innerHTML = '<i class="fa-solid fa-envelope"></i> Email';
          emailBtn.title = 'Create email template and open in Outlook for this user';
          emailBtn.addEventListener('click', () => {
            if (!u.email) {
              alert('No email address for this user.');
              return;
            }
            const body = buildSingleUserEmailBody(u);
            const sub = (document.getElementById('bulk-emailSub')?.value || subjectDefault).trim();
            window.location.href = 'mailto:' + encodeURIComponent(u.email) + '?subject=' + encodeURIComponent(sub) + '&body=' + encodeURIComponent(body);
          });
          const actionsCell = document.createElement('td');
          actionsCell.appendChild(emailBtn);
          tr.innerHTML = `<td>${escapeHtml(u.firstName)}</td><td>${escapeHtml(u.lastName)}</td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.userName)}</td><td>${escapeHtml(u.tempPassword)}</td><td>${u.userId}</td>`;
          tr.appendChild(actionsCell);
          tbody.appendChild(tr);
        }
      }
    });
  }

  if (bulkBtnEnrollAll) {
    bulkBtnEnrollAll.addEventListener('click', async () => {
      if (!bulkCreatedUsers.length) {
        alert('Create users first.');
        return;
      }
      const ou = (document.getElementById('bulk-enrollOrgUnitId')?.value || '').trim();
      const roleStr = (document.getElementById('bulk-enrollRoleId')?.value || '').trim();
      const role = parseInt(roleStr, 10);
      const orgUnitId = parseInt(ou, 10);
      if (!ou || Number.isNaN(orgUnitId)) {
        alert('Please enter a valid OrgUnitId (Course Offering ID).');
        return;
      }
      if (!roleStr || Number.isNaN(role)) {
        alert('Please enter a valid Enroll as RoleId (e.g. 101).');
        return;
      }
      const out = document.getElementById('bulk-enrollResult');
      if (out) { out.style.display = 'block'; out.textContent = 'Enrolling ' + bulkCreatedUsers.length + ' user(s)…'; }
      const url = `${CONFIG.lpBase}${CONFIG.lpEnrollmentsVersion}/enrollments/`;
      let ok = 0, fail = 0;
      for (const u of bulkCreatedUsers) {
        try {
          await BrightspaceFetch(url, 'POST', { OrgUnitId: orgUnitId, UserId: parseInt(u.userId, 10), RoleId: role, IsCascading: false });
          ok++;
          bulkLog('Enrolled UserId ' + u.userId);
        } catch (err) {
          fail++;
          bulkLog('Enroll failed ' + u.userName + ': ' + err.message);
        }
      }
      if (out) out.textContent = `Enrolled ${ok} user(s).${fail ? ' Failed: ' + fail : ''}`;
    });
  }

  if (bulkBtnDownloadCsv) {
    bulkBtnDownloadCsv.addEventListener('click', () => {
      if (!bulkCreatedUsers.length) {
        alert('Create users first.');
        return;
      }
      const header = 'first_name,last_name,email,username,password,userId';
      const rows = bulkCreatedUsers.map(u => {
        const esc = (v) => {
          const s = String(v ?? '');
          return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        return [u.firstName, u.lastName, u.email, u.userName, u.tempPassword, u.userId].map(esc).join(',');
      });
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bulk-created-users.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  loadBulkRoles();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initForcePasswordTab(); initBulkTab(); });
} else {
  initForcePasswordTab();
  initBulkTab();
}
