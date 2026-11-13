/**
 * Organization Types Report
 * Fetches and displays all organization unit types in D2L Brightspace
 */

const viewBtn = document.getElementById('viewBtn');
const downloadBtn = document.getElementById('downloadBtn');
const orgTypeTable = document.getElementById('orgTypeTable');
const orgTypeBody = document.getElementById('orgTypeBody');

let orgTypes = [];

function ensureLoadingBar(containerId = 'loadingContainer') {
    // `reports/org-types.html` already includes a placeholder div with this id.
    // Replace its contents with the standardized loading bar markup (avoid duplicate IDs).
    const existing = document.getElementById(containerId);
    const loadingBar = LoadingUtils.createLoadingBar(containerId);
    if (existing) {
        existing.replaceWith(loadingBar);
        return;
    }
    document.querySelector('.card')?.appendChild(loadingBar);
}

async function loadAndRenderOrgTypes() {
    const ok = await fetchOrgTypes();
    if (ok) populateTable();
}

// Initialize loading container + auto-load report
document.addEventListener('DOMContentLoaded', () => {
    ensureLoadingBar('loadingContainer');
    loadAndRenderOrgTypes();
});

async function fetchOrgTypes() {
    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(50, 'Fetching organization types...', 'loadingContainer');
        
        orgTypes = await D2LApi._fetch('/d2l/api/lp/1.47/outypes/');
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        return true;
    } catch (error) {
        console.error('Error fetching org types:', error);
        LoadingUtils.hideLoadingBar('loadingContainer');
        alert('Failed to fetch organization types. Please try again.');
        return false;
    }
}

function populateTable() {
    orgTypeBody.innerHTML = '';
    orgTypes.forEach(type => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${type.Id}</td>
            <td>${type.Code}</td>
            <td>${type.Name}</td>
        `;
        orgTypeBody.appendChild(row);
    });

    if ($.fn.DataTable.isDataTable(orgTypeTable)) {
        $(orgTypeTable).DataTable().destroy();
    }

    $(orgTypeTable).DataTable({
        pageLength: 25,
        dom: '<"top"if>rt<"bottom"lp><"clear">'
    });

    orgTypeTable.style.display = 'table';
}

function downloadCSV() {
    const headers = ['Id', 'Code', 'Name'];
    const rows = orgTypes.map(t => [t.Id, t.Code, t.Name]);

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
    link.setAttribute('download', `org_types_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

viewBtn.addEventListener('click', async () => {
    await loadAndRenderOrgTypes();
});

downloadBtn.addEventListener('click', async () => {
    if (orgTypes.length === 0) await fetchOrgTypes();
    downloadCSV();
});
