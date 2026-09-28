/**
 * User Roles Report
 * Fetches and displays all user roles in D2L Brightspace
 */

const viewBtn = document.getElementById('viewBtn');
const downloadBtn = document.getElementById('downloadBtn');
const userRoleTable = document.getElementById('userRoleTable');
const userRoleBody = document.getElementById('userRoleBody');

let userRoles = [];

function ensureLoadingBar(containerId = 'loadingContainer') {
    // `reports/user-roles.html` already includes a placeholder div with this id.
    // Replace its contents with the standardized loading bar markup (avoid duplicate IDs).
    const existing = document.getElementById(containerId);
    const loadingBar = LoadingUtils.createLoadingBar(containerId);
    if (existing) {
        existing.replaceWith(loadingBar);
        return;
    }
    document.querySelector('.card')?.appendChild(loadingBar);
}

async function loadAndRenderUserRoles() {
    const ok = await fetchUserRoles();
    if (ok) populateTable();
}

// Initialize loading container + auto-load report
document.addEventListener('DOMContentLoaded', () => {
    ensureLoadingBar('loadingContainer');
    loadAndRenderUserRoles();
});

async function fetchUserRoles() {
    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(50, 'Fetching user roles...', 'loadingContainer');
        
        userRoles = await D2LApi._fetch('/d2l/api/lp/1.47/roles/');
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        return true;
    } catch (error) {
        console.error('Error fetching user roles:', error);
        LoadingUtils.hideLoadingBar('loadingContainer');
        alert('Failed to fetch user roles. Please try again.');
        return false;
    }
}

function populateTable() {
    userRoleBody.innerHTML = '';
    userRoles.forEach(role => {
        const description = (role.Description && String(role.Description).trim()) || (role.Code || '');
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${role.Identifier}</td>
            <td>${role.DisplayName}</td>
            <td>${description}</td>
        `;
        userRoleBody.appendChild(row);
    });

    if ($.fn.DataTable.isDataTable(userRoleTable)) {
        $(userRoleTable).DataTable().destroy();
    }

    $(userRoleTable).DataTable({
        pageLength: 25,
        dom: '<"top"if>rt<"bottom"lp><"clear">'
    });

    userRoleTable.style.display = 'table';
}

function downloadCSV() {
    const headers = ['Identifier', 'DisplayName', 'Description'];
    const rows = userRoles.map(r => {
        const description = (r.Description && String(r.Description).trim()) || (r.Code || '');
        return [r.Identifier, r.DisplayName, description];
    });

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += headers.join(',') + '\n';
    rows.forEach(row => {
        csvContent += row.map(cell => 
            typeof cell === 'string' && (cell.includes(',') || cell.includes('"')) 
                ? `"${cell.replace(/"/g, '""')}"` 
                : cell
        ).join(',') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `user_roles_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

viewBtn.addEventListener('click', async () => {
    await loadAndRenderUserRoles();
});

downloadBtn.addEventListener('click', async () => {
    if (userRoles.length === 0) await fetchUserRoles();
    downloadCSV();
});
