/**
 * Onboarding Instructors Page — JSON-based action queue (Faculty Success Path)
 */

let allUsers = [];
let filteredUsers = [];

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('refresh-data-btn')?.addEventListener('click', loadInstructors);
    document.getElementById('download-csv-btn')?.addEventListener('click', downloadCSV);
    document.getElementById('action-filter')?.addEventListener('change', applyFilters);
    document.getElementById('sort-by')?.addEventListener('change', applyFilters);
    document.getElementById('bulk-complete-btn')?.addEventListener('click', handleBulkComplete);
    document.getElementById('select-all-checkbox')?.addEventListener('change', handleSelectAll);
    await loadInstructors();
});

async function loadInstructors() {
    const loading = document.getElementById('loading-indicator');
    const container = document.getElementById('results-container');
    const noResults = document.getElementById('no-results');

    if (loading) {
        loading.style.display = 'flex';
        loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Loading instructors…</span><div class="progress-bar"><div class="progress-fill progress-fill-indeterminate"></div></div>';
    }
    if (container) container.style.display = 'none';
    if (noResults) noResults.style.display = 'none';

    try {
        await FacultyRecordService.loadConfig();
        const entries = await OnboardingQueueService.getAllUsersNeedingAction();
        allUsers = entries.map((e) => OnboardingQueueService.recordToQueueRow(e));
        applyFilters();
    } catch (error) {
        console.error('Error loading instructors:', error);
        if (loading) {
            loading.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i><span>Error loading instructors. Please try again.</span>';
        }
        const status = document.getElementById('status');
        if (status) {
            status.className = 'status-message show error';
            status.textContent = error.message || 'Error loading instructors.';
        }
    }
}

function applyFilters() {
    const actionFilter = document.getElementById('action-filter')?.value || 'all';
    const sortBy = document.getElementById('sort-by')?.value || 'priority';

    filteredUsers = allUsers.filter((u) => !u.is_completed);
    if (actionFilter !== 'all') {
        filteredUsers = filteredUsers.filter((u) => !u[actionFilter]);
    }

    filteredUsers.sort((a, b) => {
        switch (sortBy) {
            case 'priority': return b.priority_score - a.priority_score;
            case 'priority-asc': return a.priority_score - b.priority_score;
            case 'updated': return new Date(b.updated_at) - new Date(a.updated_at);
            case 'userid': return String(a.orgDefinedId).localeCompare(String(b.orgDefinedId));
            default: return 0;
        }
    });

    const countEl = document.getElementById('results-count');
    if (countEl) countEl.textContent = `${filteredUsers.length} instructor(s) found`;

    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('results-tbody');
    const container = document.getElementById('results-container');
    const loading = document.getElementById('loading-indicator');
    const noResults = document.getElementById('no-results');

    if (!tbody) return;
    if (loading) loading.style.display = 'none';

    if (filteredUsers.length === 0) {
        if (container) container.style.display = 'none';
        if (noResults) noResults.style.display = 'block';
        return;
    }

    if (noResults) noResults.style.display = 'none';
    if (container) container.style.display = 'block';
    tbody.innerHTML = '';

    filteredUsers.forEach((user) => {
        const row = document.createElement('tr');
        row.dataset.fileName = user.fileName;
        row.dataset.folder = user.folder;
        row.innerHTML = `
            <td><input type="checkbox" class="user-checkbox" data-file="${user.fileName}" data-folder="${user.folder}"></td>
            <td>${user.orgDefinedId || '—'}</td>
            <td>${user.firstName || ''} ${user.lastName || ''}</td>
            <td>${user.email || '—'}</td>
            ${actionCell(user, 'welcome_email_sent')}
            ${actionCell(user, 'login_nudge_sent')}
            ${actionCell(user, 'scheduled_call_or_walkin')}
            ${actionCell(user, 'orientation_course_registered')}
            ${actionCell(user, 'faculty_orientation_completed')}
            <td><span class="badge ${getPriorityBadgeClass(user.priority_score)}" id="priority-${user.fileName}">${user.priority_score}</span></td>
            <td>
                <a href="faculty-onboarding/command-center.html" class="btn btn-sm btn-outline">Open Record</a>
                <button class="btn btn-sm btn-outline" onclick="markUserComplete('${user.fileName}', '${user.folder}')">Complete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function actionCell(user, action) {
    const checked = user[action] ? 'checked' : '';
    return `<td class="action-checkbox-cell">
        <label class="action-checkbox-label">
            <input type="checkbox" class="action-checkbox"
                data-file="${user.fileName}" data-folder="${user.folder}" data-action="${action}"
                ${checked} onchange="handleActionCheckbox('${user.fileName}', '${user.folder}', '${action}', this.checked)">
            <span class="action-checkbox-text">${user[action] ? '✓' : '✗'}</span>
        </label>
    </td>`;
}

async function handleActionCheckbox(fileName, folder, actionField, checked) {
    try {
        const success = await OnboardingQueueService.updateAction(fileName, folder, actionField, checked);
        if (success) await loadInstructors();
        else alert('Error updating action.');
    } catch (error) {
        console.error(error);
        alert('Error updating action.');
    }
}

function getPriorityBadgeClass(priority) {
    if (priority >= 10) return 'badge-danger';
    if (priority >= 5) return 'badge-warning';
    return 'badge-info';
}

function handleSelectAll(e) {
    document.querySelectorAll('.user-checkbox').forEach((cb) => { cb.checked = e.target.checked; });
}

async function handleBulkComplete() {
    const checkboxes = document.querySelectorAll('.user-checkbox:checked');
    if (!checkboxes.length) { alert('Select at least one instructor.'); return; }
    if (!confirm(`Mark ${checkboxes.length} instructor(s) as complete?`)) return;

    for (const cb of checkboxes) {
        await OnboardingQueueService.markRecordComplete(cb.dataset.file, cb.dataset.folder);
    }
    await loadInstructors();
}

async function markUserComplete(fileName, folder) {
    if (!confirm('Mark all actions complete and move to finished?')) return;
    await OnboardingQueueService.markRecordComplete(fileName, folder);
    await loadInstructors();
}

async function downloadCSV() {
    if (!filteredUsers.length) { alert('No data to download.'); return; }
    const headers = ['OrgDefinedId', 'First Name', 'Last Name', 'Email', 'Welcome Email', 'Login Nudge', 'Call/Walk-in', 'Orientation Course', 'Faculty Orientation', 'Priority', 'Folder'];
    const rows = filteredUsers.map((u) => [
        u.orgDefinedId, u.firstName, u.lastName, u.email,
        u.welcome_email_sent ? 'Yes' : 'No', u.login_nudge_sent ? 'Yes' : 'No',
        u.scheduled_call_or_walkin ? 'Yes' : 'No', u.orientation_course_registered ? 'Yes' : 'No',
        u.faculty_orientation_completed ? 'Yes' : 'No', u.priority_score, u.folder
    ]);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `instructors-onboarding-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
}

window.handleActionCheckbox = handleActionCheckbox;
window.markUserComplete = markUserComplete;
