/**
 * Enrollment Statistics Report
 * Views enrollment totals by role and division for a selected semester
 */

const semesterSelect = document.getElementById('semesterSelect');
const runReportBtn = document.getElementById('runReport');
const downloadCsvBtn = document.getElementById('downloadCsv');
const statusMessage = document.getElementById('statusMessage');
const tableBody = document.querySelector('#enrollmentTable tbody');

let roleMap = {};
const ignoredRoleIds = [100, 101, 102, 130, 133, 134, 139, 145, 146, 147, 149, 150, 151, 155, 161, 162, 165, 167, 168, 174];
let enrollmentData = [];
let enrollmentTable = null;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Load semesters
    loadSemesters();
});

async function loadSemesters() {
    try {
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;
        
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
        
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            data = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data));
        } else {
            data.sort((a, b) => String(b.Name).localeCompare(String(a.Name)));
        }
        data.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.Identifier;
            option.textContent = semester.Name;
            semesterSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading semesters:', error);
    }
}

async function loadRoles() {
    const roles = await D2LApi._fetch('/d2l/api/lp/1.49/roles/');
    roles.forEach(role => {
        roleMap[parseInt(role.Id)] = role.Name;
    });
}

async function getCourses(semesterId) {
    let results = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        results = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/`
        );
    } else {
        const response = await D2LApi._fetch(
            `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/?pageSize=100`
        );
        if (response.Objects && Array.isArray(response.Objects)) {
            results = response.Objects;
        } else if (Array.isArray(response)) {
            results = response;
        }
    }
    return results;
}

async function getEnrollments(courseId) {
    const res = await D2LApi._fetch(`/d2l/api/lp/1.49/enrollments/orgUnits/${courseId}/users/`);
    return res.Items || [];
}

async function getDisciplineName(courseId) {
    try {
        const courseDetails = await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${courseId}`);
        return courseDetails?.Department?.Name || 'Unknown';
    } catch {
        return 'Unknown';
    }
}

function addRow(data) {
    const row = document.createElement('tr');
    
    // Add special class for TOTAL row
    if (data.semester === 'TOTAL') {
        row.className = 'total-row';
    }
    
    // Escape HTML to prevent XSS
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    
    row.innerHTML = `
        <td>${escapeHtml(data.semester || '')}</td>
        <td>${escapeHtml(data.courseCode || '')}</td>
        <td>${escapeHtml(data.courseName || '')}</td>
        <td class="text-center">${data.orgUnitId ? `<a href="https://your-brightspace.example.edu/d2l/home/${data.orgUnitId}" target="_blank" rel="noopener noreferrer">${data.orgUnitId}</a>` : ''}</td>
        <td class="text-center">${escapeHtml(data.discipline || '')}</td>
        <td class="text-center">${escapeHtml(data.status || '')}</td>
        <td class="text-center">${data.totalFaculty || 0}</td>
        <td class="text-center">${data.totalStudent || 0}</td>
        <td class="text-center">${data.totalOther || 0}</td>
    `;
    tableBody.appendChild(row);
}

function generateCSV() {
    const headers = ['Semester', 'Course Code', 'Course Name', 'OrgUnitId', 'Discipline', 'Status', 'Total Faculty', 'Total Student', 'Total Other'];
    const rows = enrollmentData.map(r => [
        r.semester, r.courseCode, r.courseName, r.orgUnitId, r.discipline, r.status, r.totalFaculty, r.totalStudent, r.totalOther
    ]);
    const csv = Papa.unparse([headers, ...rows]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `enrollment-statistics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

runReportBtn.addEventListener('click', async () => {
    const semesterId = semesterSelect.value;
    const semesterName = semesterSelect.options[semesterSelect.selectedIndex].text;

    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }

    // Disable buttons and show loading modal
    runReportBtn.disabled = true;
    downloadCsvBtn.disabled = true;
    tableBody.innerHTML = '';
    enrollmentData = [];
    
    // Destroy existing table if it exists
    if (enrollmentTable) {
        enrollmentTable.destroy();
        enrollmentTable = null;
    }
    
    // Use loading modal instead of text
    LoadingUtils.showLoadingModal('Initializing report...', 'loadingModal', () => {
        // Cancel callback - will be checked in the loop
    });
    LoadingUtils.updateLoadingModal(5, 'Loading roles...', 'loadingModal');

    try {
        await loadRoles();
        LoadingUtils.updateLoadingModal(10, 'Fetching courses...', 'loadingModal');
        const courses = await getCourses(semesterId);
        let courseCount = 0;

        let totalFaculty = 0, totalStudent = 0, totalOther = 0;

        for (const course of courses) {
            // Check for cancellation
            if (LoadingUtils.isCancelled('loadingModal')) {
                LoadingUtils.hideLoadingModal('loadingModal');
                runReportBtn.disabled = false;
                statusMessage.textContent = 'Report cancelled.';
                return;
            }
            
            courseCount++;
            const progress = 10 + Math.floor((courseCount / courses.length) * 85);
            LoadingUtils.updateLoadingModal(progress, `Processing course ${courseCount}/${courses.length}: ${course.Code || course.Name}...`, 'loadingModal');

            if (course.Type?.Id === 3) {
                const enrollments = await getEnrollments(course.Identifier);
                const discipline = await getDisciplineName(course.Identifier);
                const status = course.IsActive ? 'Active' : 'Inactive';

                let faculty = 0, student = 0, other = 0;

                enrollments.forEach(({ Role, User }) => {
                    if (!User || !Role || !User.Identifier || User.UserName === 'IPSIS') return;
                    const roleId = parseInt(Role.Id);
                    if (roleId === 102) faculty++;
                    else if (roleId === 101) student++;
                    else if (!ignoredRoleIds.includes(roleId)) other++;
                });

                enrollmentData.push({
                    semester: semesterName,
                    courseCode: course.Code || '',
                    courseName: course.Name || '',
                    orgUnitId: course.Identifier,
                    discipline,
                    status,
                    totalFaculty: faculty,
                    totalStudent: student,
                    totalOther: other
                });

                addRow(enrollmentData[enrollmentData.length - 1]);
                totalFaculty += faculty;
                totalStudent += student;
                totalOther += other;
            }
        }

        // Add total row
        addRow({
            semester: 'TOTAL',
            courseCode: '',
            courseName: '',
            orgUnitId: '',
            discipline: '',
            status: '',
            totalFaculty,
            totalStudent,
            totalOther
        });

        // Initialize DataTable with better configuration
        enrollmentTable = $('#enrollmentTable').DataTable({
            pageLength: 50,
            lengthMenu: [[25, 50, 100, 200, -1], [25, 50, 100, 200, "All"]],
            order: [[0, 'asc']],
            dom: '<"top"lf>rt<"bottom"ip><"clear">',
            language: {
                search: "Search:",
                lengthMenu: "Show _MENU_ entries",
                info: "Showing _START_ to _END_ of _TOTAL_ entries",
                infoEmpty: "No entries to show",
                infoFiltered: "(filtered from _MAX_ total entries)",
                paginate: {
                    first: "First",
                    last: "Last",
                    next: "Next",
                    previous: "Previous"
                }
            },
            columnDefs: [
                { 
                    targets: [1, 2], // Course Code and Course Name
                    render: function(data, type, row) {
                        if (type === 'display' && data && data.length > 50) {
                            return '<span title="' + data.replace(/"/g, '&quot;') + '">' + data.substring(0, 50) + '...</span>';
                        }
                        return data;
                    }
                },
                {
                    targets: [3, 4, 5, 6, 7, 8], // OrgUnitId, Division, Status, and counts
                    className: 'text-center'
                }
            ],
            responsive: true,
            scrollX: true
        });

        LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
        statusMessage.textContent = `Report complete. ${enrollmentData.length} courses processed.`;
        downloadCsvBtn.disabled = false;
        
        // Hide modal after a brief delay
        setTimeout(() => {
            LoadingUtils.hideLoadingModal('loadingModal');
        }, 1000);
    } catch (error) {
        console.error('Error running report:', error);
        statusMessage.textContent = 'Error: ' + error.message;
        LoadingUtils.hideLoadingModal('loadingModal');
    } finally {
        runReportBtn.disabled = false;
    }
});

downloadCsvBtn.addEventListener('click', generateCSV);
