// bulk-unenroll-by-role.js
// Search a user by role (including cascading) and bulk-remove matching enrollments.
import { BrightspaceFetch } from './auth.js';

const COURSE_OFFERING_TYPE_ID = 3;
const MAX_ENROLLMENT_PAGES = 250;

let selectedUser = null;
let matchedEnrollments = [];
let rolesCache = null;
let searchCsvRows = [];
let actionCsvRows = []; // 'search' | 'action'

export function initializeBulkUnenrollByRole() {
    const form = document.getElementById('bulk-unenroll-form');
    if (!form) return;

    loadRolesIntoSelect();

    form.addEventListener('submit', handleBulkUnenrollSearch);
    const resetBtn = document.querySelector('#bulk-unenroll-tab button[type="reset"]');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            clearBulkUnenrollUI();
            setTimeout(() => loadRolesIntoSelect(), 0);
        });
    }

    const cascadingSelect = document.getElementById('bulkUnenrollCascading');
    const includeNonCourse = document.getElementById('bulkUnenrollIncludeNonCourse');
    if (cascadingSelect && includeNonCourse) {
        cascadingSelect.addEventListener('change', () => {
            if (cascadingSelect.value === 'cascading') includeNonCourse.checked = true;
        });
    }

    const selectAll = document.getElementById('bulkUnenrollSelectAll');
    if (selectAll) {
        selectAll.addEventListener('change', () => {
            document.querySelectorAll('.bulk-unenroll-checkbox').forEach(cb => {
                cb.checked = selectAll.checked;
            });
            updateSelectedCount();
        });
    }

    const unenrollBtn = document.getElementById('bulkUnenrollActionBtn');
    if (unenrollBtn) unenrollBtn.addEventListener('click', openBulkUnenrollConfirm);

    const confirmBtn = document.getElementById('bulkUnenrollConfirmBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', executeBulkUnenroll);

    const cancelBtn = document.getElementById('bulkUnenrollCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeBulkUnenrollConfirm);

    const downloadBtn = document.getElementById('bulkUnenrollDownloadCsvBtn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => downloadResultsCsv('search'));

    const downloadResultBtn = document.getElementById('bulkUnenrollDownloadResultCsvBtn');
    if (downloadResultBtn) downloadResultBtn.addEventListener('click', () => downloadResultsCsv('action'));

    const closeResultBtn = document.getElementById('closeBulkUnenrollResult');
    if (closeResultBtn) {
        closeResultBtn.addEventListener('click', () => {
            const el = document.getElementById('bulkUnenrollResultBanner');
            if (el) el.style.display = 'none';
        });
    }
}

async function loadRolesIntoSelect() {
    const select = document.getElementById('bulkUnenrollRole');
    if (!select) return;

    try {
        if (!rolesCache) {
            const roles = await BrightspaceFetch('/d2l/api/lp/1.46/roles/');
            rolesCache = Array.isArray(roles) ? roles : [];
            rolesCache.sort((a, b) =>
                (a.DisplayName || a.Name || '').localeCompare(b.DisplayName || b.Name || '')
            );
        }

        const previous = select.value;
        select.innerHTML = '<option value="">Select a role...</option>';
        rolesCache.forEach(role => {
            const id = role.Identifier ?? role.Id;
            const name = role.DisplayName || role.Name || `Role ${id}`;
            const opt = document.createElement('option');
            opt.value = String(id);
            opt.textContent = name;
            select.appendChild(opt);
        });
        if (previous && [...select.options].some(o => o.value === previous)) {
            select.value = previous;
        }
    } catch (error) {
        select.innerHTML = '<option value="">Unable to load roles</option>';
        showError(`Failed to load roles: ${error.message}`);
    }
}

async function handleBulkUnenrollSearch(event) {
    event.preventDefault();
    clearMessages();
    if (event.isTrusted) hideResultBanner();

    const query = document.getElementById('bulkUnenrollUserQuery')?.value.trim();
    const searchType = document.getElementById('bulkUnenrollSearchType')?.value;
    const roleId = document.getElementById('bulkUnenrollRole')?.value;
    const cascadingFilter = document.getElementById('bulkUnenrollCascading')?.value || 'all';
    const includeNonCourse = document.getElementById('bulkUnenrollIncludeNonCourse')?.checked;

    if (!query) {
        showError('Please enter a search term for the user.');
        return;
    }
    if (!roleId) {
        showError('Please select a role to filter by.');
        return;
    }

    const resultsPanel = document.getElementById('bulk-unenroll-results');
    const tbody = document.getElementById('bulkUnenrollResultsBody');
    if (resultsPanel) resultsPanel.style.display = 'block';
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center"><span class="loading-spinner"></span> Searching user and loading enrollments...</td></tr>';
    }

    try {
        const users = await searchUsers(query, searchType);
        if (!users.length) {
            selectedUser = null;
            matchedEnrollments = [];
            setSearchCsvRows([]);
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">No users found.</td></tr>';
            updateUserSummary(null, 0);
            return;
        }

        selectedUser = users[0];
        if (users.length > 1) {
            showInfo(`Found ${users.length} users; using the first match: ${formatUserName(selectedUser)} (${selectedUser.UserId}).`);
        }

        const allEnrollments = await fetchAllUserEnrollments(selectedUser.UserId);
        matchedEnrollments = filterEnrollments(allEnrollments, {
            roleId: parseInt(roleId, 10),
            cascadingFilter,
            includeNonCourse
        });

        renderResults();
        showInfo(`Found ${matchedEnrollments.length} enrollment(s) matching the selected role for ${formatUserName(selectedUser)}.`);
    } catch (error) {
        selectedUser = null;
        matchedEnrollments = [];
        setSearchCsvRows([]);
        showError(error.message || 'Search failed.');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Search failed. Please try again.</td></tr>';
        updateUserSummary(null, 0);
    }
}

async function searchUsers(query, searchType) {
    let users = [];
    if (searchType === 'userId') {
        if (isNaN(query)) throw new Error('User ID must be a number.');
        const r = await BrightspaceFetch(`/d2l/api/lp/1.46/users/${query}`);
        if (r) users = [r];
    } else if (searchType === 'userName') {
        const r = await BrightspaceFetch(`/d2l/api/lp/1.46/users/?userName=${encodeURIComponent(query)}`);
        users = normalizeUserList(r);
    } else {
        const r = await BrightspaceFetch(`/d2l/api/lp/1.46/users/?orgDefinedId=${encodeURIComponent(query)}`);
        users = normalizeUserList(r);
    }
    return users;
}

function normalizeUserList(r) {
    if (Array.isArray(r)) return r;
    if (r && Array.isArray(r.Items)) return r.Items;
    if (r) return [r];
    return [];
}

async function fetchAllUserEnrollments(userId) {
    const allItems = [];
    let bookmark = null;
    let pageCount = 0;
    const seenBookmarks = new Set();

    while (pageCount < MAX_ENROLLMENT_PAGES) {
        let endpoint = `/d2l/api/lp/1.46/enrollments/users/${userId}/orgUnits/?pageSize=200`;
        if (bookmark) endpoint += `&bookmark=${encodeURIComponent(bookmark)}`;

        const page = await BrightspaceFetch(endpoint);
        const items = Array.isArray(page?.Items) ? page.Items : (Array.isArray(page) ? page : []);
        allItems.push(...items);

        const paging = page?.PagingInfo || {};
        const hasMore = Boolean(paging.HasMoreItems || paging.hasMoreItems);
        const nextBookmark = paging.Bookmark || paging.bookmark || null;

        if (!hasMore || !nextBookmark || seenBookmarks.has(String(nextBookmark))) break;
        seenBookmarks.add(String(nextBookmark));
        bookmark = nextBookmark;
        pageCount += 1;
    }

    return allItems;
}

function filterEnrollments(enrollments, { roleId, cascadingFilter, includeNonCourse }) {
    return enrollments.filter(e => {
        const enrollmentRoleId = e?.Role?.Id ?? e?.Role?.Identifier;
        if (parseInt(enrollmentRoleId, 10) !== roleId) return false;

        const typeId = e?.OrgUnit?.Type?.Id;
        if (!includeNonCourse && typeId !== COURSE_OFFERING_TYPE_ID) return false;

        const isCascading = Boolean(e?.IsCascading);
        if (cascadingFilter === 'cascading' && !isCascading) return false;
        if (cascadingFilter === 'non-cascading' && isCascading) return false;

        return true;
    });
}

function renderResults() {
    const tbody = document.getElementById('bulkUnenrollResultsBody');
    const selectAll = document.getElementById('bulkUnenrollSelectAll');
    if (!tbody) return;

    updateUserSummary(selectedUser, matchedEnrollments.length);
    setSearchCsvRows(matchedEnrollments);

    if (!matchedEnrollments.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No enrollments matched this role and cascading filter.</td></tr>';
        if (selectAll) {
            selectAll.checked = false;
            selectAll.disabled = true;
        }
        updateSelectedCount();
        return;
    }

    if (selectAll) {
        selectAll.disabled = false;
        selectAll.checked = true;
    }

    const baseUrl = window.location.origin || 'https://your-brightspace.example.edu';
    tbody.innerHTML = matchedEnrollments.map((e, index) => {
        const orgUnitId = e.OrgUnit?.Id ?? e.OrgUnit?.Identifier ?? '';
        const name = escapeHtml(e.OrgUnit?.Name || 'Unnamed');
        const code = escapeHtml(e.OrgUnit?.Code || 'N/A');
        const typeName = escapeHtml(e.OrgUnit?.Type?.Name || e.OrgUnit?.Type?.Code || 'Unknown');
        const roleName = escapeHtml(e.Role?.Name || e.Role?.DisplayName || 'Unknown');
        const cascading = e.IsCascading ? 'Yes' : 'No';
        const homeLink = orgUnitId ? `${baseUrl}/d2l/home/${orgUnitId}` : '#';

        return `<tr data-index="${index}">
            <td><input type="checkbox" class="bulk-unenroll-checkbox" data-index="${index}" checked></td>
            <td>${orgUnitId}</td>
            <td>${name}</td>
            <td>${orgUnitId ? `<a href="${homeLink}" target="_blank" rel="noopener">${code} <i class="fa-solid fa-up-right-from-square"></i></a>` : code}</td>
            <td>${typeName}</td>
            <td>${roleName}</td>
            <td>${cascading}</td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.bulk-unenroll-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (selectAll && !cb.checked) selectAll.checked = false;
            else if (selectAll) {
                const all = [...tbody.querySelectorAll('.bulk-unenroll-checkbox')];
                selectAll.checked = all.length > 0 && all.every(c => c.checked);
            }
            updateSelectedCount();
        });
    });

    updateSelectedCount();
}

function getSelectedEnrollments() {
    const selected = [...document.querySelectorAll('.bulk-unenroll-checkbox:checked')]
        .map(cb => matchedEnrollments[parseInt(cb.dataset.index, 10)])
        .filter(Boolean);

    // Delete cascading / higher org units first so child OUs are cleared as a side effect.
    // Remaining child deletes often return 404 (already gone) — treat those as success.
    return selected.sort((a, b) => {
        const aCascade = a.IsCascading ? 0 : 1;
        const bCascade = b.IsCascading ? 0 : 1;
        if (aCascade !== bCascade) return aCascade - bCascade;

        const aType = a.OrgUnit?.Type?.Id === COURSE_OFFERING_TYPE_ID ? 1 : 0;
        const bType = b.OrgUnit?.Type?.Id === COURSE_OFFERING_TYPE_ID ? 1 : 0;
        return aType - bType;
    });
}

function updateSelectedCount() {
    const countEl = document.getElementById('bulkUnenrollSelectedCount');
    const actionBtn = document.getElementById('bulkUnenrollActionBtn');
    const downloadBtn = document.getElementById('bulkUnenrollDownloadCsvBtn');
    const count = document.querySelectorAll('.bulk-unenroll-checkbox:checked').length;
    if (countEl) countEl.textContent = String(count);
    if (actionBtn) actionBtn.disabled = count === 0 || !selectedUser;
    if (downloadBtn) downloadBtn.disabled = searchCsvRows.length === 0;
}

function openBulkUnenrollConfirm() {
    const selected = getSelectedEnrollments();
    if (!selectedUser || !selected.length) {
        showError('Select at least one enrollment to remove.');
        return;
    }

    const summary = document.getElementById('bulkUnenrollConfirmSummary');
    if (summary) {
        const roleName = document.getElementById('bulkUnenrollRole')?.selectedOptions?.[0]?.textContent || 'selected role';
        summary.innerHTML = `
            <p><strong>User:</strong> ${escapeHtml(formatUserName(selectedUser))} (${selectedUser.UserId})</p>
            <p><strong>Role:</strong> ${escapeHtml(roleName)}</p>
            <p><strong>Enrollments to remove:</strong> ${selected.length}</p>
            <p style="color:#c62828; margin-bottom:0;">This cannot be undone. Cascading removals at parent org units may also remove access from child courses. Those child deletes may report 404 — that usually means they were already cleared and still count as success.</p>
        `;
    }

    const modal = document.getElementById('bulkUnenrollConfirmModal');
    if (modal) modal.style.display = 'flex';
}

function closeBulkUnenrollConfirm() {
    const modal = document.getElementById('bulkUnenrollConfirmModal');
    if (modal) modal.style.display = 'none';
}

async function deleteEnrollment(userId, orgUnitId) {
    const token = localStorage.getItem('XSRF.Token');
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    if (token) headers['X-CSRF-Token'] = token;

    const response = await fetch(
        `/d2l/api/lp/1.46/enrollments/users/${userId}/orgUnits/${orgUnitId}`,
        { method: 'DELETE', headers, credentials: 'include' }
    );

    const newToken = response.headers.get('x-csrf-token');
    if (newToken) localStorage.setItem('XSRF.Token', newToken);

    // 404 = no enrollment at this OU (often already removed by a parent cascading delete)
    if (response.status === 404) return { status: 'already-removed' };
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} - ${response.statusText}`);
    }
    return { status: 'removed' };
}

async function executeBulkUnenroll() {
    const selected = getSelectedEnrollments();
    if (!selectedUser || !selected.length) return;

    const confirmBtn = document.getElementById('bulkUnenrollConfirmBtn');
    const cancelBtn = document.getElementById('bulkUnenrollCancelBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';
    }
    if (cancelBtn) cancelBtn.disabled = true;

    const results = { success: [], alreadyRemoved: [], failed: [], rows: [] };
    const userId = selectedUser.UserId;
    const total = selected.length;

    for (let i = 0; i < selected.length; i++) {
        const enrollment = selected[i];
        const orgUnitId = enrollment.OrgUnit?.Id ?? enrollment.OrgUnit?.Identifier;
        const label = `${enrollment.OrgUnit?.Name || ''} (${enrollment.OrgUnit?.Code || orgUnitId})`;

        if (confirmBtn) {
            confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Removing ${i + 1}/${total}...`;
        }

        if (!orgUnitId) {
            results.failed.push({ label, error: 'Missing org unit ID' });
            results.rows.push({ enrollment, status: 'Failed', error: 'Missing org unit ID' });
            continue;
        }

        try {
            const result = await deleteEnrollment(userId, orgUnitId);
            if (result.status === 'already-removed') {
                results.alreadyRemoved.push(label);
                results.rows.push({ enrollment, status: 'Already Removed', error: '' });
            } else {
                results.success.push(label);
                results.rows.push({ enrollment, status: 'Deleted', error: '' });
            }
        } catch (error) {
            const msg = error.message || 'Unknown error';
            results.failed.push({ label, error: msg });
            results.rows.push({ enrollment, status: 'Failed', error: msg });
        }
    }

    setActionCsvRows(results.rows);

    closeBulkUnenrollConfirm();
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm Remove';
    }
    if (cancelBtn) cancelBtn.disabled = false;

    showResultBanner(results);
    updateSelectedCount();

    // Refresh the list for the same filters
    const form = document.getElementById('bulk-unenroll-form');
    if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
}

function showResultBanner(results) {
    const banner = document.getElementById('bulkUnenrollResultBanner');
    const message = document.getElementById('bulkUnenrollResultMessage');
    if (!banner || !message) return;

    const removedTotal = results.success.length + results.alreadyRemoved.length;
    let html = `<strong>Cleared:</strong> ${removedTotal} enrollment(s)`;
    html += ` <span style="color:var(--text-secondary); font-weight:400;">(${results.success.length} deleted`;
    if (results.alreadyRemoved.length) {
        html += `, ${results.alreadyRemoved.length} already gone / cascading side-effect`;
    }
    html += ')</span>';

    if (results.failed.length) {
        html += `<br><strong>Failed:</strong> ${results.failed.length}<ul style="margin:8px 0 0; padding-left:18px;">`;
        results.failed.slice(0, 25).forEach(f => {
            html += `<li>${escapeHtml(f.label)} — ${escapeHtml(f.error)}</li>`;
        });
        if (results.failed.length > 25) {
            html += `<li>…and ${results.failed.length - 25} more</li>`;
        }
        html += '</ul>';
    }
    message.innerHTML = html;
    banner.style.display = 'block';
}

function updateUserSummary(user, matchCount) {
    const el = document.getElementById('bulkUnenrollUserSummary');
    if (!el) return;
    if (!user) {
        el.textContent = 'Search for a user and select a role to see matching enrollments.';
        return;
    }
    el.innerHTML = `<strong>${escapeHtml(formatUserName(user))}</strong>
        &nbsp;|&nbsp; Username: ${escapeHtml(user.UserName || 'N/A')}
        &nbsp;|&nbsp; ID Number: ${escapeHtml(user.OrgDefinedId || 'N/A')}
        &nbsp;|&nbsp; User ID: ${user.UserId}
        &nbsp;|&nbsp; Matches: <strong>${matchCount}</strong>`;
}

function clearBulkUnenrollUI() {
    clearMessages();
    hideResultBanner();
    selectedUser = null;
    matchedEnrollments = [];
    searchCsvRows = [];
    actionCsvRows = [];
    const resultsPanel = document.getElementById('bulk-unenroll-results');
    if (resultsPanel) resultsPanel.style.display = 'none';
    const tbody = document.getElementById('bulkUnenrollResultsBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Search for a user to see matching enrollments.</td></tr>';
    updateUserSummary(null, 0);
    updateSelectedCount();
    const selectAll = document.getElementById('bulkUnenrollSelectAll');
    if (selectAll) {
        selectAll.checked = false;
        selectAll.disabled = true;
    }
}

function getSelectedRoleName() {
    return document.getElementById('bulkUnenrollRole')?.selectedOptions?.[0]?.textContent || '';
}

function getSelectedCascadingFilter() {
    const el = document.getElementById('bulkUnenrollCascading');
    return el?.selectedOptions?.[0]?.textContent || el?.value || '';
}

function enrollmentToCsvRow(enrollment, status = '', error = '') {
    const user = selectedUser || {};
    return {
        UserName: formatUserName(user),
        Username: user.UserName || '',
        OrgDefinedId: user.OrgDefinedId || '',
        UserId: user.UserId || '',
        RoleFilter: getSelectedRoleName(),
        CascadingFilter: getSelectedCascadingFilter(),
        OrgUnitId: enrollment?.OrgUnit?.Id ?? enrollment?.OrgUnit?.Identifier ?? '',
        OrgUnitName: enrollment?.OrgUnit?.Name || '',
        OrgUnitCode: enrollment?.OrgUnit?.Code || '',
        OrgUnitType: enrollment?.OrgUnit?.Type?.Name || enrollment?.OrgUnit?.Type?.Code || '',
        Role: enrollment?.Role?.Name || enrollment?.Role?.DisplayName || '',
        RoleId: enrollment?.Role?.Id ?? enrollment?.Role?.Identifier ?? '',
        IsCascading: enrollment?.IsCascading ? 'Yes' : 'No',
        Status: status,
        Error: error
    };
}

function setSearchCsvRows(enrollments) {
    searchCsvRows = (enrollments || []).map(e => enrollmentToCsvRow(e, 'Matched', ''));
    updateSelectedCount();
}

function setActionCsvRows(rows) {
    actionCsvRows = (rows || []).map(({ enrollment, status, error }) =>
        enrollmentToCsvRow(enrollment, status || '', error || '')
    );
    updateSelectedCount();
}

function csvEscape(value) {
    const str = String(value ?? '');
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
}

function rowsToCsv(rows) {
    const headers = [
        'UserName', 'Username', 'OrgDefinedId', 'UserId', 'RoleFilter', 'CascadingFilter',
        'OrgUnitId', 'OrgUnitName', 'OrgUnitCode', 'OrgUnitType', 'Role', 'RoleId',
        'IsCascading', 'Status', 'Error'
    ];
    const lines = [headers.join(',')];
    rows.forEach(row => {
        lines.push(headers.map(h => csvEscape(row[h])).join(','));
    });
    return lines.join('\n');
}

function downloadResultsCsv(kind = 'search') {
    const rows = kind === 'action' ? actionCsvRows : searchCsvRows;
    if (!rows.length) {
        showError(kind === 'action'
            ? 'No unenroll action results available to download yet.'
            : 'No results available to download. Run a search first.');
        return;
    }

    const userPart = selectedUser?.OrgDefinedId || selectedUser?.UserId || 'user';
    const rolePart = (getSelectedRoleName() || 'role').replace(/[^\w\-]+/g, '_');
    const datePart = new Date().toISOString().slice(0, 10);
    const prefix = kind === 'action' ? 'bulk-unenroll-action' : 'bulk-unenroll-matches';
    const filename = `${prefix}_${userPart}_${rolePart}_${datePart}.csv`;

    const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function formatUserName(user) {
    return `${user.FirstName || ''} ${user.LastName || ''}`.trim() || 'Unknown User';
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showError(msg) {
    const err = document.getElementById('error-container');
    if (err) err.innerHTML = `<div class="error-msg"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(msg)}</div>`;
}

function showInfo(msg) {
    const info = document.getElementById('info-container');
    if (info) info.innerHTML = `<div class="info-msg"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(msg)}</div>`;
}

function clearMessages() {
    const err = document.getElementById('error-container');
    const info = document.getElementById('info-container');
    if (err) err.innerHTML = '';
    if (info) info.innerHTML = '';
}

function hideResultBanner() {
    const banner = document.getElementById('bulkUnenrollResultBanner');
    if (banner) banner.style.display = 'none';
}
