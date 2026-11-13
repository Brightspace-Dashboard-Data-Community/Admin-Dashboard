/**
 * Semester List Report
 * Fetches and displays all semesters in D2L Brightspace
 */

const viewBtn = document.getElementById('viewBtn');
const downloadBtn = document.getElementById('downloadBtn');
const semesterTable = document.getElementById('semesterTable');
const semesterBody = document.getElementById('semesterBody');

let semesters = [];

function ensureLoadingBar(containerId = 'loadingContainer') {
    // `reports/semester-list.html` already includes a placeholder div with this id.
    // Replace its contents with the standardized loading bar markup (avoid duplicate IDs).
    const existing = document.getElementById(containerId);
    const loadingBar = LoadingUtils.createLoadingBar(containerId);
    if (existing) {
        existing.replaceWith(loadingBar);
        return;
    }
    document.querySelector('.card')?.appendChild(loadingBar);
}

async function loadAndRenderSemesters() {
    const ok = await fetchSemesters();
    if (ok) populateTable();
}

// Initialize loading container + auto-load report
document.addEventListener('DOMContentLoaded', () => {
    ensureLoadingBar('loadingContainer');
    loadAndRenderSemesters();
});

async function fetchSemesters() {
    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(50, 'Fetching semesters...', 'loadingContainer');
        
        // Get root org unit ID
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;
        
        const apiSemesters = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
        );
        // This table is the canonical reference for the rest of the dashboard,
        // so it must mirror the allowlist in js/semester-config.js.
        semesters = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
            ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(apiSemesters))
            : apiSemesters;
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        return true;
    } catch (error) {
        console.error('Error fetching semesters:', error);
        LoadingUtils.hideLoadingBar('loadingContainer');
        alert('Failed to fetch semesters. Please try again.');
        return false;
    }
}

function populateTable() {
    semesterBody.innerHTML = '';
    semesters.forEach(semester => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${semester.Identifier}</td>
            <td>${semester.Name}</td>
            <td>${semester.Code || ''}</td>
        `;
        semesterBody.appendChild(row);
    });

    if ($.fn.DataTable.isDataTable(semesterTable)) {
        $(semesterTable).DataTable().destroy();
    }

    $(semesterTable).DataTable({
        pageLength: 25,
        dom: '<"top"if>rt<"bottom"lp><"clear">'
    });

    semesterTable.style.display = 'table';
}

function downloadCSV() {
    const headers = ['Identifier', 'Name', 'Code'];
    const rows = semesters.map(s => [s.Identifier, s.Name, s.Code || '']);

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
    link.setAttribute('download', `semester_list_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

viewBtn.addEventListener('click', async () => {
    await loadAndRenderSemesters();
});

downloadBtn.addEventListener('click', async () => {
    if (semesters.length === 0) await fetchSemesters();
    downloadCSV();
});
