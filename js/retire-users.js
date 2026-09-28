/**
 * Retire Users Process
 * Upload a CSV of usernames (or OrgDefinedIds). For each user:
 * 1. Look up user in D2L by UserName or OrgDefinedId
 * 2. Set user to Inactive (Activation.IsActive = false)
 * 3. Change username to username.retired.2026
 * Uses D2L Valence API: GET /users/?userName= or ?orgDefinedId=, PUT /users/{userId}
 * @see https://docs.valence.desire2learn.com/res/user.html
 */

const RETIRED_SUFFIX = '.retired.2026';
const USERS_API_VERSION = '1.49';

async function BrightspaceFetch(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('XSRF.Token');
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    if (token) headers['X-CSRF-Token'] = token;

    const options = { method, headers, credentials: 'include' };
    if (body) options.body = JSON.stringify(body);

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

/**
 * Find a user by UserName or OrgDefinedId. Returns single UserData or null if not found.
 */
async function lookupUser(identifier, useOrgDefinedId) {
    const base = `/d2l/api/lp/${USERS_API_VERSION}/users/`;
    const url = useOrgDefinedId
        ? `${base}?orgDefinedId=${encodeURIComponent(identifier)}`
        : `${base}?userName=${encodeURIComponent(identifier)}`;

    const result = await BrightspaceFetch(url, 'GET');
    if (useOrgDefinedId || Array.isArray(result)) {
        const list = Array.isArray(result) ? result : (result && result.Items ? result.Items : []);
        if (list.length === 0) return null;
        if (list.length > 1 && !useOrgDefinedId) return list[0];
        return list[0];
    }
    return result && result.UserId != null ? result : null;
}

/**
 * Build UpdateUserData from UserData and set Inactive + new username.
 */
function buildUpdatePayload(userData, newUsername) {
    return {
        OrgDefinedId: userData.OrgDefinedId ?? '',
        FirstName: userData.FirstName ?? '',
        MiddleName: userData.MiddleName ?? null,
        LastName: userData.LastName ?? '',
        ExternalEmail: userData.ExternalEmail ?? null,
        UserName: newUsername,
        Activation: { IsActive: false },
        Pronouns: userData.Pronouns ?? null
    };
}

/**
 * Inactivate user and set username to username.retired.2026
 */
async function retireOneUser(userData, logEl) {
    const userId = userData.UserId;
    const currentUsername = userData.UserName || userData.Username || '';
    const newUsername = currentUsername + RETIRED_SUFFIX;

    const payload = buildUpdatePayload(userData, newUsername);
    await BrightspaceFetch(`/d2l/api/lp/${USERS_API_VERSION}/users/${userId}`, 'PUT', payload);

    const line = document.createElement('div');
    line.className = 'ok';
    line.textContent = `OK: ${currentUsername} → ${newUsername} (UserId ${userId})`;
    logEl.appendChild(line);
    return { success: true, username: currentUsername, newUsername };
}

function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

(function () {
    const csvFile = document.getElementById('csvFile');
    const columnGroup = document.getElementById('columnGroup');
    const identifierColumn = document.getElementById('identifierColumn');
    const runBtn = document.getElementById('runBtn');
    const clearBtn = document.getElementById('clearBtn');
    const summary = document.getElementById('summary');
    const previewCard = document.getElementById('previewCard');
    const previewHead = document.getElementById('previewHead');
    const previewBody = document.getElementById('previewBody');
    const resultsCard = document.getElementById('resultsCard');
    const loadingContainer = document.getElementById('loadingContainer');
    const resultsLog = document.getElementById('resultsLog');

    let parsedRows = [];
    let parsedHeaders = [];

    const identifierColumnNames = [
        'username', 'username', 'orgdefinedid', 'org defined id',
        'user_name', 'user name', 'login', 'loginid'
    ];

    function suggestIdentifierColumn(headers) {
        const lower = headers.map(h => (h || '').trim().toLowerCase());
        const usernameIdx = lower.findIndex(h =>
            h === 'username' || h === 'user_name' || h === 'user name' || h === 'login' || h === 'loginid');
        if (usernameIdx !== -1) return { index: usernameIdx, useOrgDefinedId: false };
        const orgIdx = lower.findIndex(h =>
            h === 'orgdefinedid' || h === 'org defined id' || h === 'org_unit_id' || h === 'banner_id' || h === 'sis_id');
        if (orgIdx !== -1) return { index: orgIdx, useOrgDefinedId: true };
        return { index: 0, useOrgDefinedId: false };
    }

    function renderPreview() {
        if (parsedRows.length === 0) return;
        previewHead.innerHTML = parsedHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('');
        const slice = parsedRows.slice(0, 20);
        previewBody.innerHTML = slice.map(row =>
            '<tr>' + parsedHeaders.map(h => `<td>${escapeHtml(row[h] ?? '')}</td>`).join('') + '</tr>'
        ).join('');
        previewCard.style.display = 'block';

        identifierColumn.innerHTML = parsedHeaders.map((h, i) =>
            `<option value="${i}" data-org="${(h || '').toLowerCase().indexOf('org') !== -1}">${escapeHtml(h)}</option>`
        ).join('');

        const suggested = suggestIdentifierColumn(parsedHeaders);
        identifierColumn.selectedIndex = Math.min(suggested.index, identifierColumn.options.length - 1);
        columnGroup.style.display = 'block';
        runBtn.disabled = false;
        summary.textContent = `Loaded ${parsedRows.length} row(s). Choose the identifier column and click "Inactivate & Rename Users".`;
    }

    csvFile.addEventListener('change', function () {
        const file = this.files[0];
        parsedRows = [];
        parsedHeaders = [];
        previewCard.style.display = 'none';
        columnGroup.style.display = 'none';
        resultsCard.style.display = 'none';
        runBtn.disabled = true;

        if (!file) {
            summary.textContent = 'Upload a CSV file. Accepted columns: Username, UserName, or OrgDefinedId (case-insensitive).';
            return;
        }

        const reader = new FileReader();
        reader.onload = function () {
            const parsed = Papa.parse(reader.result, {
                header: true,
                skipEmptyLines: true,
                transformHeader: h => (h || '').trim()
            });

            if (parsed.errors && parsed.errors.length) {
                console.warn('PapaParse errors:', parsed.errors);
            }
            if (!parsed.meta || !parsed.meta.fields || parsed.meta.fields.length === 0) {
                summary.textContent = 'CSV has no headers or could not be parsed.';
                return;
            }

            parsedHeaders = parsed.meta.fields;
            parsedRows = (parsed.data || []).filter(row => {
                const keys = Object.keys(row);
                return keys.some(k => row[k] != null && String(row[k]).trim() !== '');
            });

            if (parsedRows.length === 0) {
                summary.textContent = 'CSV has no data rows.';
                return;
            }

            renderPreview();
        };
        reader.readAsText(file, 'UTF-8');
    });

    clearBtn.addEventListener('click', function () {
        csvFile.value = '';
        parsedRows = [];
        parsedHeaders = [];
        previewCard.style.display = 'none';
        columnGroup.style.display = 'none';
        resultsCard.style.display = 'none';
        runBtn.disabled = true;
        clearBtn.style.display = 'none';
        summary.textContent = 'Upload a CSV file. Accepted columns: Username, UserName, or OrgDefinedId (case-insensitive).';
    });

    runBtn.addEventListener('click', async function () {
        if (parsedRows.length === 0) return;

        const colIndex = parseInt(identifierColumn.value, 10);
        const colName = parsedHeaders[colIndex];
        const useOrgDefinedId = (colName || '').toLowerCase().indexOf('org') !== -1 ||
            (identifierColumn.selectedOptions[0] && identifierColumn.selectedOptions[0].getAttribute('data-org') === 'true');

        const identifiers = parsedRows
            .map(row => {
                const val = row[colName];
                return val != null ? String(val).trim() : '';
            })
            .filter(v => v !== '');

        const uniqueIds = [...new Set(identifiers)];

        if (uniqueIds.length === 0) {
            alert('No non-empty values in the selected column.');
            return;
        }

        if (!confirm(`You are about to inactivate ${uniqueIds.length} user(s) and rename each username to username.retired.2026. Continue?`)) {
            return;
        }

        runBtn.disabled = true;
        resultsCard.style.display = 'block';
        resultsLog.innerHTML = '';
        loadingContainer.innerHTML = '';
        loadingContainer.appendChild(LoadingUtils.createLoadingBar('retireLoadingBar'));
        LoadingUtils.showLoadingBar('retireLoadingBar');

        let done = 0;
        let okCount = 0;
        let failCount = 0;

        for (let i = 0; i < uniqueIds.length; i++) {
            const id = uniqueIds[i];
            LoadingUtils.updateLoadingBar(
                Math.round(((i + 1) / uniqueIds.length) * 100),
                `Processing ${i + 1} of ${uniqueIds.length}: ${id}`,
                'retireLoadingBar'
            );

            try {
                const user = await lookupUser(id, useOrgDefinedId);
                if (!user) {
                    const line = document.createElement('div');
                    line.className = 'err';
                    line.textContent = `Not found: ${id}`;
                    resultsLog.appendChild(line);
                    failCount++;
                } else {
                    await retireOneUser(user, resultsLog);
                    okCount++;
                }
            } catch (err) {
                const line = document.createElement('div');
                line.className = 'err';
                line.textContent = `Error for "${id}": ${err.message}`;
                resultsLog.appendChild(line);
                failCount++;
            }

            done++;
        }

        LoadingUtils.updateLoadingBar(100, 'Complete', 'retireLoadingBar');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('retireLoadingBar');
        }, 800);

        const sumLine = document.createElement('div');
        sumLine.style.marginTop = '12px';
        sumLine.style.fontWeight = '600';
        sumLine.textContent = `Done: ${okCount} updated, ${failCount} failed or not found.`;
        resultsLog.appendChild(sumLine);

        runBtn.disabled = false;
        clearBtn.style.display = 'inline-flex';
    });
})();
