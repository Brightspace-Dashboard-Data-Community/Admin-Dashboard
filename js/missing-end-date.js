/**
 * Missing End Dates Tool
 * Finds and fixes courses missing start or end dates
 */

let latestReportData = [];
let reportTable = null;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize loading container
    const loadingContainer = LoadingUtils.createLoadingBar('loadingContainer');
    document.querySelector('.card').appendChild(loadingContainer);
    
    // Load semesters
    loadSemesters();
    
    // Set up event listeners
    document.getElementById('runReportBtn').addEventListener('click', () => {
        const semesterId = document.getElementById('semesterSelect').value;
        if (!semesterId) {
            alert('Please select a semester first.');
            return;
        }
        generateReport(semesterId);
    });
    
    document.getElementById('bulkFixBtn').addEventListener('click', handleBulkFix);
    document.getElementById('downloadBtn').addEventListener('click', downloadCSV);
});

async function loadSemesters() {
    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(10, 'Loading semesters...', 'loadingContainer');
        
        // Use the same root org unit as the legacy tool to avoid
        // permissions/endpoint differences that can prevent semesters loading.
        const rootOrgUnitId = 1001;
        
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                data = response.Objects;
            } else if (Array.isArray(response)) {
                data = response;
            }
        }
        
        const select = document.getElementById('semesterSelect');
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.populateSelect) {
            SemesterConfig.populateSelect(select, data, { placeholder: 'Select a Semester' });
        } else {
            select.innerHTML = '<option value="">Select a Semester</option>';
            data.forEach(sem => {
                const opt = document.createElement('option');
                opt.value = sem.Identifier;
                opt.textContent = sem.Name;
                select.appendChild(opt);
            });
        }
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);
    } catch (err) {
        console.error('Failed to load semesters:', err);
        LoadingUtils.hideLoadingBar('loadingContainer');
    }
}

async function generateReport(semesterId) {
    const container = document.getElementById('report-container');
    const runBtn = document.getElementById('runReportBtn');
    const bulkBtn = document.getElementById('bulkFixBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    
    container.innerHTML = '';
    latestReportData = [];
    
    runBtn.disabled = true;
    LoadingUtils.showLoadingBar('loadingContainer');
    LoadingUtils.updateLoadingBar(5, 'Loading courses...', 'loadingContainer');

    try {
        let children = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            children = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/?pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                children = response.Objects;
            } else if (Array.isArray(response)) {
                children = response;
            }
        }
        
        const courseOfferings = children.filter(c => c.Type?.Id === 3);
        const total = courseOfferings.length;
        
        LoadingUtils.updateLoadingBar(10, `Checking ${total} courses...`, 'loadingContainer');

        for (let i = 0; i < total; i++) {
            const course = courseOfferings[i];
            try {
                const courseDetails = await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${course.Identifier}`);
                if (!courseDetails.StartDate || !courseDetails.EndDate) {
                    const instructorInfo = await getPrimaryInstructor(course.Identifier);
                    latestReportData.push({
                        Name: courseDetails.Name,
                        Code: courseDetails.Code,
                        OrgUnitId: course.Identifier,
                        StartDate: courseDetails.StartDate || '(missing)',
                        EndDate: courseDetails.EndDate || '(missing)',
                        IsActive: courseDetails.IsActive,
                        InstructorName: instructorInfo.name,
                        InstructorEmail: instructorInfo.email
                    });
                }
            } catch (err) {
                console.warn('Course load failed:', course.Identifier, err);
            }
            const pct = 10 + ((i + 1) / total) * 85;
            LoadingUtils.updateLoadingBar(pct, `Checked ${i + 1} of ${total} courses...`, 'loadingContainer');
        }

        LoadingUtils.updateLoadingBar(100, 'Report complete!', 'loadingContainer');
        renderReport(latestReportData);
        bulkBtn.style.display = latestReportData.length > 0 ? 'inline-flex' : 'none';
        downloadBtn.style.display = latestReportData.length > 0 ? 'inline-flex' : 'none';
    } catch (error) {
        console.error('Error generating report:', error);
        container.innerHTML = `<div class="card"><p>❌ Error: ${error.message}</p></div>`;
    } finally {
        runBtn.disabled = false;
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);
    }
}

/**
 * Fetch the primary instructor for a course offering.
 * Attempts to find an enrollment with an instructor-type role and then
 * looks up the user's details (including email).
 * Returns a safe fallback when data is unavailable.
 */
async function getPrimaryInstructor(orgUnitId) {
    try {
        const enrollments = await D2LApi._fetch(
            `/d2l/api/lp/${D2LApi.apiVersion}/enrollments/orgUnits/${orgUnitId}/users/`
        );

        if (!Array.isArray(enrollments) || enrollments.length === 0) {
            return { name: '(no instructor)', email: '' };
        }

        const instructorEnrollment =
            enrollments.find(e => {
                const roleName = (e.Role?.Name || '').toUpperCase();
                const roleCode = String(e.Role?.Id || '');
                return roleName.includes('INSTRUCTOR') || roleCode === '102';
            }) || enrollments[0];

        const userId = instructorEnrollment.User?.Identifier;
        if (!userId) {
            const displayName = instructorEnrollment.User?.DisplayName || '(unknown)';
            return { name: displayName, email: '' };
        }

        const user = await D2LApi._fetch(
            `/d2l/api/lp/${D2LApi.apiVersion}/users/${userId}`
        );

        const name =
            user.DisplayName ||
            [user.FirstName, user.LastName].filter(Boolean).join(' ') ||
            '(unknown)';
        const email = user.Email || user.EmailAddress || '';

        return { name, email };
    } catch (error) {
        console.warn('Failed to load instructor for orgUnit', orgUnitId, error);
        return { name: '(error loading instructor)', email: '' };
    }
}

function renderReport(courses) {
    const container = document.getElementById('report-container');
    container.innerHTML = '';

    if (courses.length === 0) {
        container.innerHTML = '<div class="card"><p>✅ All courses have valid start and end dates.</p></div>';
        return;
    }

    const card = document.createElement('div');
    card.className = 'card';
    
    const table = document.createElement('table');
    table.className = 'display';
    table.style.width = '100%';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Course Code</th>
                <th>OrgUnitId</th>
                <th>Instructor</th>
                <th>Instructor Email</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody>
            ${courses.map(course => `
                <tr>
                    <td><a href="https://your-brightspace.example.edu/d2l/home/${course.OrgUnitId}" target="_blank" rel="noopener noreferrer">${course.Code}</a></td>
                    <td>${course.OrgUnitId}</td>
                    <td>${course.InstructorName || ''}</td>
                    <td>${course.InstructorEmail || ''}</td>
                    <td>${course.StartDate}</td>
                    <td id="end-${course.OrgUnitId}">${course.EndDate}</td>
                    <td><button class="btn-primary btn-sm" onclick="setEndDate(${course.OrgUnitId}, true)">Add End Date</button></td>
                </tr>
            `).join('')}
        </tbody>
    `;
    card.appendChild(table);

    // Initialize DataTable
    if (reportTable) {
        reportTable.destroy();
    }
    reportTable = $(table).DataTable({
        pageLength: 50,
        dom: '<"top"if>rt<"bottom"lp><"clear">'
    });

    container.appendChild(card);
}

async function setEndDate(orgUnitId, showAlert = true) {
    try {
        const course = await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${orgUnitId}`);

        const now = new Date();
        const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 1, 0));
        const endDate = endOfToday.toISOString();

        let startDate = course.StartDate;
        if (!startDate) {
            const startDateObj = new Date(endOfToday);
            startDateObj.setDate(startDateObj.getDate() - 1);
            startDate = startDateObj.toISOString();
        }

        const payload = {
            Name: course.Name,
            Code: course.Code,
            Path: course.Path,
            CourseTemplateId: parseInt(course.CourseTemplate?.Identifier) || 0,
            SemesterId: parseInt(course.Semester?.Identifier) || 0,
            StartDate: startDate,
            EndDate: endDate,
            StartDateAvailabilityType: 1,
            EndDateAvailabilityType: 1,
            LocaleId: course.LocaleId ?? null,
            ForceLocale: course.ForceLocale ?? false,
            ShowAddressBook: course.ShowAddressBook ?? false,
            Description: {
                Content: course.Description?.Html || '',
                Type: 'Text|Html'
            },
            CanSelfRegister: course.CanSelfRegister ?? false,
            IsActive: course.IsActive
        };

        await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${orgUnitId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        // Update the display
        const endCell = document.getElementById(`end-${orgUnitId}`);
        if (endCell) {
            endCell.textContent = new Date(endDate).toLocaleDateString();
        }

        // Update the data
        const courseData = latestReportData.find(c => c.OrgUnitId === orgUnitId);
        if (courseData) {
            courseData.EndDate = new Date(endDate).toLocaleDateString();
            if (!courseData.StartDate || courseData.StartDate === '(missing)') {
                courseData.StartDate = new Date(startDate).toLocaleDateString();
            }
        }

        if (showAlert) {
            alert(`✅ End date added to course ${orgUnitId}`);
        }
    } catch (error) {
        console.error('Error setting end date:', error);
        alert(`❌ Error: ${error.message}`);
    }
}

async function handleBulkFix() {
    if (!latestReportData || latestReportData.length === 0) {
        alert('No courses to fix.');
        return;
    }

    if (!confirm(`Are you sure you want to update ${latestReportData.length} courses?`)) {
        return;
    }

    const bulkBtn = document.getElementById('bulkFixBtn');
    bulkBtn.disabled = true;
    
    LoadingUtils.showLoadingModal('Updating courses...');
    let updatedCount = 0;
    
    for (let i = 0; i < latestReportData.length; i++) {
        const course = latestReportData[i];
        const progress = Math.floor(((i + 1) / latestReportData.length) * 100);
        LoadingUtils.updateLoadingModal(progress, `Updated ${i + 1} of ${latestReportData.length} courses...`);
        
        try {
            await setEndDate(course.OrgUnitId, false);
            updatedCount++;
        } catch (error) {
            console.error(`Error updating course ${course.OrgUnitId}:`, error);
        }
    }
    
    LoadingUtils.updateLoadingModal(100, 'Bulk update complete!');
    setTimeout(() => {
        LoadingUtils.hideLoadingModal();
    }, 1000);
    
    alert(`✅ Bulk update complete: ${updatedCount} courses updated.`);
    bulkBtn.disabled = false;
    
    // Refresh the report
    const semesterId = document.getElementById('semesterSelect').value;
    if (semesterId) {
        generateReport(semesterId);
    }
}

function downloadCSV() {
    if (!latestReportData || latestReportData.length === 0) {
        alert('No data to download.');
        return;
    }
    
    const headers = [
        'Course Code',
        'OrgUnitId',
        'Instructor',
        'Instructor Email',
        'Start Date',
        'End Date',
        'Is Active'
    ];
    const rows = latestReportData.map(c => [
        c.Code,
        c.OrgUnitId,
        c.InstructorName || '',
        c.InstructorEmail || '',
        c.StartDate,
        c.EndDate,
        c.IsActive ? 'Yes' : 'No'
    ]);
    
    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => {
            const str = String(cell || '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join(','))
        .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `missing-end-dates_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Make setEndDate globally accessible
window.setEndDate = setEndDate;
