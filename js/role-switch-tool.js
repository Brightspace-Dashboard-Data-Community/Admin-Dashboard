let allRoles = [];
function switchTab(tabName) {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelector(`.tab-button[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}
async function searchUser() {
    const orgId = document.getElementById('orgIdInput').value.trim();
    if (!orgId) return alert('Please enter an OrgDefinedId');
    LoadingUtils.showLoadingModal('Searching for user...');
    try {
        const userRes = await D2LApi._fetch('/d2l/api/lp/1.46/users/?orgDefinedId=' + encodeURIComponent(orgId));
        const user = userRes[0];
        if (!user) return alert('User not found');
        document.getElementById('userName').textContent = `${user.FirstName} ${user.LastName}`;
        document.getElementById('userId').textContent = user.UserId;
        const enrollments = await getAllUserEnrollments(user.UserId);
        const roles = await D2LApi._fetch('/d2l/api/lp/1.46/roles/');
        allRoles = roles;
        const tbody = document.getElementById('enrollmentTableBody');
        tbody.innerHTML = '';
        enrollments.filter(enroll => String(enroll.OrgUnit?.Type?.Id) === '3').forEach(enroll => {
            const orgUnitCode = enroll.OrgUnit?.Code || enroll.OrgUnit?.Name || '(No OrgUnit)';
            const orgUnitId = enroll.OrgUnit?.Id || '(No ID)';
            const currentRoleId = enroll.Role?.Id;
            const roleName = enroll.Role?.Name || `(Role ID: ${currentRoleId ?? 'unknown'})`;
            const roleOptions = (allRoles || []).map(role => `<option value="${role.Identifier}" ${role.Identifier == currentRoleId ? 'disabled' : ''}>${role.DisplayName}</option>`).join('');
            const row = document.createElement('tr');
            row.innerHTML = `<td><a href="/d2l/home/${orgUnitId}" target="_blank">${orgUnitCode}</a></td><td><a href="/d2l/home/${orgUnitId}" target="_blank">${orgUnitId}</a></td><td>${roleName}</td><td><select data-orgunit="${orgUnitId}" data-userid="${user.UserId}"><option value="">Select Role</option>${roleOptions}</select></td><td><button onclick="switchRole(this)" class="btn-primary btn-sm">Switch</button></td>`;
            tbody.appendChild(row);
        });
        $('#enrollmentTable').DataTable({ pageLength: 25 });
        document.getElementById('results').style.display = 'block';
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        LoadingUtils.hideLoadingModal();
    }
}
async function getAllUserEnrollments(userId) {
    let enrollments = [];
    let nextUrl = `/d2l/api/lp/1.46/enrollments/users/${userId}/orgUnits/`;
    while (nextUrl) {
        const res = await D2LApi._fetch(nextUrl);
        if (res.Items) enrollments = enrollments.concat(res.Items);
        nextUrl = res.PagingInfo?.HasMoreItems ? res.PagingInfo.NextUrl : null;
    }
    return enrollments;
}
async function switchRole(button) {
    const row = button.closest('tr');
    const select = row.querySelector('select');
    const newRoleId = select.value;
    const orgUnitId = select.dataset.orgunit;
    const userId = select.dataset.userid;
    if (!newRoleId) return alert('Please select a new role');
    LoadingUtils.showLoadingModal('Switching role...');
    try {
        await D2LApi._fetch('/d2l/api/lp/1.46/enrollments/', { method: 'POST', body: JSON.stringify({ OrgUnitId: parseInt(orgUnitId), UserId: parseInt(userId), RoleId: parseInt(newRoleId) }) });
        alert('✅ Role switched successfully.');
        searchUser();
    } catch (err) {
        alert('Error switching role: ' + err.message);
    } finally {
        LoadingUtils.hideLoadingModal();
    }
}
async function loadRolesDropdown() {
    allRoles = await D2LApi._fetch('/d2l/api/lp/1.46/roles/');
    const select = document.getElementById('bulkRoleSelect');
    select.innerHTML = `<option value="">Select Role</option>` + allRoles.map(r => `<option value="${r.Identifier}">${r.DisplayName}</option>`).join('');
}
async function processBulkRoleSwitch() {
    const file = document.getElementById('csvInput').files[0];
    const roleId = document.getElementById('bulkRoleSelect').value;
    if (!file || !roleId) return alert('Please select a CSV and role.');
    LoadingUtils.showLoadingModal('Processing bulk role switch...');
    const text = await file.text();
    const rows = Papa.parse(text, { header: true }).data;
    const tbody = document.getElementById('bulkResultsBody');
    tbody.innerHTML = '';
    document.getElementById('bulkResults').style.display = 'block';
    let processed = 0;
    for (const row of rows) {
        processed++;
        LoadingUtils.updateLoadingModal(Math.floor((processed / rows.length) * 100), `Processing ${processed}/${rows.length}...`);
        const orgId = row.OrgDefinedId?.trim();
        const orgUnitId = row.OrgUnitId?.trim();
        if (!orgId || !orgUnitId) continue;
        let status = '❌ Failed';
        try {
            const userRes = await D2LApi._fetch(`/d2l/api/lp/1.46/users/?orgDefinedId=${encodeURIComponent(orgId)}`);
            const user = userRes[0];
            if (user?.UserId) {
                await D2LApi._fetch('/d2l/api/lp/1.46/enrollments/', { method: 'POST', body: JSON.stringify({ OrgUnitId: parseInt(orgUnitId), UserId: parseInt(user.UserId), RoleId: parseInt(roleId) }) });
                status = '✅ Success';
            } else {
                status = '❌ User Not Found';
            }
        } catch (e) {
            console.warn(`Error processing ${orgId} in ${orgUnitId}:`, e);
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${orgId}</td><td>${orgUnitId}</td><td>${status}</td>`;
        tbody.appendChild(tr);
    }
    $('#bulkResultsTable').DataTable({ pageLength: 25 });
    LoadingUtils.hideLoadingModal();
}
window.switchTab = switchTab;
window.searchUser = searchUser;
window.switchRole = switchRole;
document.addEventListener('DOMContentLoaded', () => loadRolesDropdown());
