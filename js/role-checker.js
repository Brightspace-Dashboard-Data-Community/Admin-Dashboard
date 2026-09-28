/**
 * Role Checker Report
 * Compares a faculty assignment CSV to live Brightspace enrollments on org 1001
 * and identifies faculty who are Students (or not enrolled) so they can be
 * updated to Instructor.
 */

const MAIN_ORG_UNIT_ID = 1001;
const INSTRUCTOR_ROLE_ID = 102;
const STUDENT_ROLE_ID = 101;
const LP_VERSION = '1.46';
const LOOKUP_CONCURRENCY = 4;

const FACULTY_ID_COLUMNS = [
    'Full Faculty',
    'FullFaculty',
    'Faculty_ID',
    'Faculty ID',
    'faculty_id',
    'OrgDefinedId'
];

const FACULTY_NAME_COLUMNS = [
    'faculty_name',
    'Faculty_Name',
    'Full_Name',
    'Full Name'
];

let analysisResults = [];

document.addEventListener('DOMContentLoaded', () => {
    const runButton = document.getElementById('loadUsersBtn');
    const fileInput = document.getElementById('facultyFile');
    const resultsContainer = document.getElementById('resultsContainer');
    const downloadBtn = document.getElementById('downloadCsvBtn');
    const bulkUpdateBtn = document.getElementById('bulkUpdateBtn');

    runButton.addEventListener('click', async () => {
        console.clear();
        resultsContainer.innerHTML = '<p>⏳ Loading and comparing data...</p>';
        downloadBtn.style.display = 'none';
        bulkUpdateBtn.style.display = 'none';
        analysisResults = [];

        if (!fileInput.files[0]) {
            alert('Please upload a faculty CSV file first.');
            return;
        }

        runButton.disabled = true;
        LoadingUtils.showLoadingModal('Initializing report...', 'loadingModal', () => {});
        LoadingUtils.updateLoadingModal(10, 'Parsing faculty CSV...', 'loadingModal');

        try {
            const facultyFile = fileInput.files[0];
            const facultyText = await facultyFile.text();
            const facultyParsed = Papa.parse(facultyText.replace(/^\uFEFF/, ''), {
                header: true,
                skipEmptyLines: 'greedy',
                transformHeader: (h) => String(h || '').replace(/^\uFEFF/, '').trim()
            });
            const facultyRows = facultyParsed.data || [];
            const facultyMap = extractFacultyFromRows(facultyRows);

            if (facultyMap.size === 0) {
                throw new Error(
                    'No faculty IDs found. Expected a "Full Faculty" column (OrgDefinedId). ' +
                    'Save the Excel file as CSV and keep the header row.'
                );
            }

            const facultyList = [...facultyMap.values()];
            console.log(`📄 Found ${facultyList.length} unique faculty IDs in CSV (${facultyRows.length} rows)`);

            LoadingUtils.updateLoadingModal(20, `Checking ${facultyList.length} faculty in Brightspace...`, 'loadingModal');

            const issues = [];
            const notFound = [];
            let alreadyInstructor = 0;
            let otherRole = 0;
            let processed = 0;

            await mapPool(facultyList, LOOKUP_CONCURRENCY, async (facultyData) => {
                if (LoadingUtils.isCancelled('loadingModal')) return;

                processed++;
                const progress = 20 + Math.floor((processed / facultyList.length) * 70);
                LoadingUtils.updateLoadingModal(
                    progress,
                    `Checking ${processed}/${facultyList.length}: ${facultyData.lastName || facultyData.facultyId}`,
                    'loadingModal'
                );

                const user = await lookupUserByOrgDefinedId(facultyData.facultyId);
                if (!user) {
                    notFound.push(facultyData);
                    return;
                }

                const enrollment = await fetchOrgEnrollment(user.UserId || user.Identifier);
                const orgRoleId = enrollment
                    ? parseInt(enrollment.Role?.Id ?? enrollment.RoleId ?? enrollment.Role?.Identifier, 10)
                    : null;
                const roleName = enrollment?.Role?.Name || enrollment?.Role?.DisplayName || '';

                const row = {
                    facultyId: facultyData.facultyId,
                    userId: String(user.UserId || user.Identifier || ''),
                    firstName: user.FirstName || facultyData.firstName || '',
                    lastName: user.LastName || facultyData.lastName || '',
                    userName: user.UserName || '',
                    email: user.ExternalEmail || user.UniqueName || facultyData.email || '',
                    orgRoleId,
                    roleLabel: enrollment
                        ? `${roleName || 'Role'} (${orgRoleId})`
                        : 'Not enrolled on 1001',
                    selected: orgRoleId === STUDENT_ROLE_ID || !enrollment
                };

                if (!enrollment || orgRoleId === STUDENT_ROLE_ID) {
                    issues.push(row);
                } else if (orgRoleId === INSTRUCTOR_ROLE_ID) {
                    alreadyInstructor++;
                } else {
                    otherRole++;
                    issues.push(row);
                }
            });

            if (LoadingUtils.isCancelled('loadingModal')) {
                LoadingUtils.hideLoadingModal('loadingModal');
                runButton.disabled = false;
                resultsContainer.innerHTML = '<p>Report cancelled.</p>';
                return;
            }

            issues.sort((a, b) =>
                String(a.lastName || '').localeCompare(String(b.lastName || '')) ||
                String(a.firstName || '').localeCompare(String(b.firstName || ''))
            );
            notFound.sort((a, b) =>
                String(a.lastName || '').localeCompare(String(b.lastName || '')) ||
                String(a.facultyId || '').localeCompare(String(b.facultyId || ''))
            );

            analysisResults = issues;
            console.log(`Found ${issues.length} faculty needing review`);

            LoadingUtils.updateLoadingModal(95, 'Generating results table...', 'loadingModal');
            renderResults({
                facultyRows,
                facultyList,
                issues,
                notFound,
                alreadyInstructor,
                otherRole,
                resultsContainer,
                downloadBtn,
                bulkUpdateBtn
            });

            LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
            setTimeout(() => {
                LoadingUtils.hideLoadingModal('loadingModal');
            }, 1000);
        } catch (err) {
            console.error('❌ Error:', err);
            resultsContainer.innerHTML = `<p style="color:red; padding: var(--spacing-md); background-color: #ffebee; border-radius: var(--radius-sm);">Error: ${escapeHtml(err.message)}</p>`;
            LoadingUtils.hideLoadingModal('loadingModal');
        } finally {
            runButton.disabled = false;
        }
    });
});

function renderResults({
    facultyRows,
    facultyList,
    issues,
    notFound,
    alreadyInstructor,
    otherRole,
    resultsContainer,
    downloadBtn,
    bulkUpdateBtn
}) {
    const actionable = issues.filter(i => i.selected);
    const summaryHtml = `
        <div style="padding: var(--spacing-md); background-color: var(--bg-color); border-radius: var(--radius-sm); margin-top: var(--spacing-md);">
            <h3 style="margin-top: 0;">CSV summary</h3>
            <p style="margin: 0;">
                ${facultyRows.length} row(s) → <strong>${facultyList.length} unique faculty</strong>
                (already Instructor: ${alreadyInstructor};
                Student or not enrolled: ${actionable.length};
                other org role: ${otherRole};
                not found in Brightspace: ${notFound.length}).
            </p>
        </div>
    `;

    if (issues.length === 0) {
        resultsContainer.innerHTML = summaryHtml + `
            <div style="padding: var(--spacing-md); background-color: var(--success-color); color: white; border-radius: var(--radius-sm); margin-top: var(--spacing-md);">
                <h3>No issues found</h3>
                <p>Every matched faculty member is already enrolled as Instructor (${INSTRUCTOR_ROLE_ID}) on org ${MAIN_ORG_UNIT_ID}.</p>
            </div>
            ${renderNotFoundTable(notFound)}
        `;
        return;
    }

    let tableHtml = summaryHtml + `
        <div style="margin: var(--spacing-md) 0;">
            <h3>Found ${issues.length} faculty member(s) who are not Instructor on org ${MAIN_ORG_UNIT_ID}</h3>
            <p>Student (101) and missing 1001 enrollments are selected by default. Other roles are listed but left unchecked so admin enrollments are not overwritten by accident.</p>
        </div>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background-color: var(--bg-color);">
                    <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">
                        <input type="checkbox" id="selectAll">
                    </th>
                    <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Faculty ID</th>
                    <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Name</th>
                    <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">User Name</th>
                    <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Email</th>
                    <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">User ID</th>
                    <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Current role on 1001</th>
                </tr>
            </thead>
            <tbody>
    `;

    issues.forEach((issue, index) => {
        tableHtml += `
            <tr>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color); text-align: center;">
                    <input type="checkbox" class="issue-checkbox" data-index="${index}" ${issue.selected ? 'checked' : ''}>
                </td>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(issue.facultyId)}</td>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(issue.firstName)} ${escapeHtml(issue.lastName)}</td>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(issue.userName)}</td>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(issue.email)}</td>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(issue.userId)}</td>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(issue.roleLabel)}</td>
            </tr>
        `;
    });

    tableHtml += `</tbody></table>${renderNotFoundTable(notFound)}`;
    resultsContainer.innerHTML = tableHtml;

    const selectAllCheckbox = document.getElementById('selectAll');
    const issueCheckboxes = document.querySelectorAll('.issue-checkbox');
    const syncSelectAll = () => {
        const all = [...issueCheckboxes];
        selectAllCheckbox.checked = all.length > 0 && all.every(cb => cb.checked);
    };
    selectAllCheckbox.addEventListener('change', (e) => {
        issueCheckboxes.forEach(cb => cb.checked = e.target.checked);
    });
    issueCheckboxes.forEach(cb => cb.addEventListener('change', syncSelectAll));
    syncSelectAll();

    downloadBtn.style.display = 'inline-flex';
    bulkUpdateBtn.style.display = 'inline-flex';

    downloadBtn.onclick = () => {
        const csvData = [
            ['Faculty_ID', 'User_ID', 'First_Name', 'Last_Name', 'User_Name', 'Email', 'Current_Role_On_1001']
        ];
        issues.forEach(issue => {
            csvData.push([
                issue.facultyId,
                issue.userId,
                issue.firstName,
                issue.lastName,
                issue.userName,
                issue.email,
                issue.roleLabel
            ]);
        });
        notFound.forEach(faculty => {
            csvData.push([
                faculty.facultyId,
                '',
                faculty.firstName,
                faculty.lastName,
                '',
                '',
                'Not found in Brightspace'
            ]);
        });

        const csvString = Papa.unparse(csvData);
        const blob = new Blob([csvString], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `role-checker-results_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    bulkUpdateBtn.onclick = async () => {
        const selectedIssues = [...issueCheckboxes]
            .filter(cb => cb.checked)
            .map(cb => analysisResults[parseInt(cb.getAttribute('data-index'), 10)])
            .filter(issue => issue && issue.userId);

        if (selectedIssues.length === 0) {
            alert('Please select at least one user to update.');
            return;
        }

        const confirmMessage = `Update ${selectedIssues.length} user(s) to Instructor (${INSTRUCTOR_ROLE_ID}) on org ${MAIN_ORG_UNIT_ID}?`;
        if (!confirm(confirmMessage)) return;

        bulkUpdateBtn.disabled = true;
        bulkUpdateBtn.textContent = 'Updating...';
        resultsContainer.innerHTML += `<div id="updateProgress" style="margin-top: var(--spacing-md); padding: var(--spacing-md); background-color: #fff3cd; border-radius: var(--radius-sm);"><p>Updating roles...</p></div>`;

        const updateResults = [];
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < selectedIssues.length; i++) {
            const issue = selectedIssues[i];
            const progressDiv = document.getElementById('updateProgress');
            if (progressDiv) {
                progressDiv.innerHTML = `<p>Updating ${i + 1} of ${selectedIssues.length}: ${escapeHtml(issue.firstName)} ${escapeHtml(issue.lastName)} (${escapeHtml(issue.facultyId)})...</p>`;
            }

            try {
                let existingEnrollment = null;
                try {
                    existingEnrollment = await D2LApi._fetch(
                        `/d2l/api/lp/${LP_VERSION}/enrollments/orgUnits/${MAIN_ORG_UNIT_ID}/users/${issue.userId}`
                    );
                } catch (e) {
                    // User might not be enrolled
                }

                if (existingEnrollment) {
                    await fetch(`/d2l/api/lp/${LP_VERSION}/enrollments/orgUnits/${MAIN_ORG_UNIT_ID}/users/${issue.userId}`, {
                        method: 'DELETE',
                        headers: { 'X-CSRF-Token': localStorage.getItem('XSRF.Token') },
                        credentials: 'include'
                    });
                }

                await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/enrollments/`, {
                    method: 'POST',
                    body: JSON.stringify({
                        OrgUnitId: MAIN_ORG_UNIT_ID,
                        UserId: parseInt(issue.userId, 10),
                        RoleId: INSTRUCTOR_ROLE_ID,
                        IsCascading: false
                    })
                });

                successCount++;
                updateResults.push({ ...issue, result: 'Success', error: null });
            } catch (err) {
                errorCount++;
                updateResults.push({ ...issue, result: 'Error', error: err.message });
                console.error(`Error updating ${issue.facultyId}:`, err);
            }
        }

        const progressDiv = document.getElementById('updateProgress');
        if (progressDiv) {
            progressDiv.innerHTML = `
                <h4>Update Complete</h4>
                <p>Successfully updated: ${successCount}</p>
                <p>Errors: ${errorCount}</p>
            `;
        }

        bulkUpdateBtn.disabled = false;
        bulkUpdateBtn.innerHTML = '<i class="fas fa-sync"></i> Bulk Update Selected to Instructor';

        let resultsHtml = `
            <div style="margin-top: var(--spacing-md); padding: var(--spacing-md); background-color: var(--bg-color); border-radius: var(--radius-sm);">
                <h4>Update Results</h4>
                <table style="width: 100%; border-collapse: collapse; margin-top: var(--spacing-md);">
                    <thead>
                        <tr style="background-color: var(--bg-color);">
                            <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Faculty ID</th>
                            <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Name</th>
                            <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Result</th>
                            <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Error</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        updateResults.forEach(result => {
            const rowColor = result.result === 'Success' ? '#d4edda' : '#f8d7da';
            resultsHtml += `
                <tr style="background-color: ${rowColor};">
                    <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(result.facultyId)}</td>
                    <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(result.firstName)} ${escapeHtml(result.lastName)}</td>
                    <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(result.result)}</td>
                    <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(result.error || '')}</td>
                </tr>
            `;
        });

        resultsHtml += `</tbody></table></div>`;
        resultsContainer.innerHTML += resultsHtml;
        alert(`Update complete!\nSuccess: ${successCount}\nErrors: ${errorCount}`);
    };
}

function renderNotFoundTable(notFound) {
    if (!notFound.length) return '';
    let html = `
        <div style="margin-top: var(--spacing-lg);">
            <h3>${notFound.length} faculty ID(s) not found in Brightspace</h3>
            <p>These OrgDefinedIds are in the CSV but did not match a D2L user, so they cannot be updated here.</p>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background-color: var(--bg-color);">
                        <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Faculty ID</th>
                        <th style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">Name from CSV</th>
                    </tr>
                </thead>
                <tbody>
    `;
    notFound.forEach(faculty => {
        html += `
            <tr>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml(faculty.facultyId)}</td>
                <td style="padding: var(--spacing-sm); border: 1px solid var(--border-color);">${escapeHtml([faculty.firstName, faculty.lastName].filter(Boolean).join(' ') || faculty.lastName)}</td>
            </tr>
        `;
    });
    html += `</tbody></table></div>`;
    return html;
}

async function lookupUserByOrgDefinedId(rawId) {
    for (const id of orgDefinedIdCandidates(rawId)) {
        try {
            const result = await D2LApi._fetch(
                `/d2l/api/lp/${LP_VERSION}/users/?orgDefinedId=${encodeURIComponent(id)}`
            );
            const user = firstUser(result);
            if (user && (user.UserId || user.Identifier)) return user;
        } catch (err) {
            if (err && err.status && err.status !== 404) {
                console.warn('User lookup failed for', id, err);
            }
        }
    }
    return null;
}

async function fetchOrgEnrollment(userId) {
    if (!userId) return null;
    try {
        const enrollment = await D2LApi._fetch(
            `/d2l/api/lp/${LP_VERSION}/enrollments/orgUnits/${MAIN_ORG_UNIT_ID}/users/${userId}`
        );
        if (!enrollment || (Array.isArray(enrollment) && enrollment.length === 0)) return null;
        return Array.isArray(enrollment) ? enrollment[0] : enrollment;
    } catch (err) {
        if (err && err.status === 404) return null;
        throw err;
    }
}

function firstUser(result) {
    if (Array.isArray(result)) return result[0] || null;
    if (result?.Items?.[0]) return result.Items[0];
    if (result?.UserId || result?.Identifier) return result;
    return null;
}

function orgDefinedIdCandidates(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) return [];
    const trimmed = digits.replace(/^0+/, '') || '0';
    const set = new Set([digits, trimmed]);
    for (const len of [7, 8, 9, 10]) {
        if (trimmed.length <= len) set.add(trimmed.padStart(len, '0'));
    }
    return [...set];
}

async function mapPool(items, limit, fn) {
    let next = 0;
    async function worker() {
        while (next < items.length) {
            if (LoadingUtils.isCancelled('loadingModal')) return;
            const index = next++;
            await fn(items[index], index);
        }
    }
    const size = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: size }, worker));
}

function csvCell(row, names) {
    if (!row) return '';
    const keys = Object.keys(row);
    for (const name of names) {
        const target = String(name).toLowerCase().trim();
        const key = keys.find(k => String(k).toLowerCase().trim() === target);
        if (key != null && row[key] != null && String(row[key]).trim() !== '') {
            return String(row[key]).trim();
        }
    }
    return '';
}

function normalizeOrgDefinedId(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.replace(/^0+/, '') || '0';
}

function parseFacultyName(name) {
    const value = String(name || '').trim();
    if (!value) return { firstName: '', lastName: '', fullName: '' };
    const parts = value.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return {
            lastName: parts[0],
            firstName: parts.slice(1).join(', '),
            fullName: value
        };
    }
    return { firstName: '', lastName: value, fullName: value };
}

function extractFacultyFromRows(rows) {
    const facultyMap = new Map();
    (rows || []).forEach(row => {
        const rawId = csvCell(row, FACULTY_ID_COLUMNS);
        const normalizedId = normalizeOrgDefinedId(rawId);
        if (!normalizedId || facultyMap.has(normalizedId)) return;

        const parsedName = parseFacultyName(csvCell(row, FACULTY_NAME_COLUMNS));
        facultyMap.set(normalizedId, {
            facultyId: normalizedId,
            normalizedId,
            firstName: parsedName.firstName,
            lastName: parsedName.lastName,
            email: ''
        });
    });
    return facultyMap;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
