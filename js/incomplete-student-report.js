/**
 * Incomplete Student Report
 * Lists all students using the Incomplete Student role (RoleId 107) in a selected semester
 */

let matchedUsers = [];
let changeLog = [];
let userTable = null;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Load semesters
    loadSemesters();
    
    // Set up event listeners
    document.getElementById('runReport').addEventListener('click', runReport);
    document.getElementById('downloadCsv').addEventListener('click', () => exportReportCSV(matchedUsers));
    document.getElementById('batchChange').addEventListener('click', handleBatchChange);
    document.getElementById('downloadLog').addEventListener('click', exportChangeLog);
});

async function loadSemesters() {
    try {
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;
        
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/1.46/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.46/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
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
            data.sort((a, b) => a.Name.localeCompare(b.Name));
        }
        const select = document.getElementById('semesterSelect');
        select.innerHTML = '';
        data.forEach(sem => {
            const option = document.createElement('option');
            option.value = sem.Identifier;
            option.textContent = sem.Name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading semesters:', error);
    }
}

async function getCoursesInSemester(semesterId) {
    let data = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        data = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/1.46/orgstructure/${semesterId}/children/`
        );
    } else {
        const response = await D2LApi._fetch(
            `/d2l/api/lp/1.46/orgstructure/${semesterId}/children/?pageSize=100`
        );
        if (response.Objects && Array.isArray(response.Objects)) {
            data = response.Objects;
        } else if (Array.isArray(response)) {
            data = response;
        }
    }
    return data.filter(c => c.Type && c.Type.Code === 'Course Offering');
}

async function getEnrollmentsForCourse(courseId) {
    let all = [];
    let bookmark = null;
    let hasMore = true;
    
    while (hasMore) {
        let url = `/d2l/api/lp/1.46/enrollments/orgUnits/${courseId}/users/`;
        if (bookmark) {
            url += `?bookmark=${encodeURIComponent(bookmark)}`;
        }
        
        const res = await D2LApi._fetch(url);
        if (res.Items && res.Items.length) {
            all = all.concat(res.Items);
        } else if (Array.isArray(res)) {
            all = all.concat(res);
        }
        
        hasMore = (res.PagingInfo && res.PagingInfo.HasMoreItems) ? true : false;
        bookmark = (res.PagingInfo && res.PagingInfo.Bookmark) ? res.PagingInfo.Bookmark : null;
    }
    
    return all;
}

function renderTable(users) {
    const tbody = document.querySelector('#userTable tbody');
    tbody.innerHTML = '';
    
    // Destroy existing DataTable
    if (userTable) {
        userTable.destroy();
        userTable = null;
    }
    
    // Escape HTML to prevent XSS
    const escapeHtml = (text) => {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    
    // Create rows
    users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(user.UserId)}</td>
            <td>${escapeHtml(user.OrgDefinedId)}</td>
            <td>${escapeHtml(user.DisplayName)}</td>
            <td>${escapeHtml(user.Email)}</td>
            <td><a href="https://your-brightspace.example.edu/d2l/home/${user.OrgUnitId}" target="_blank" rel="noopener noreferrer">${escapeHtml(user.CourseName)}</a></td>
            <td class="text-center">${escapeHtml(user.OrgUnitId)}</td>
            <td class="text-center"><button class="change-role-btn btn-primary btn-sm" data-userid="${user.UserId}" data-orgunitid="${user.OrgUnitId}">Change to Student</button></td>
        `;
        tbody.appendChild(tr);
    });
    
    // Initialize DataTable with better configuration
    userTable = $('#userTable').DataTable({
        pageLength: 25,
        lengthMenu: [[10, 25, 50, 100, 200, -1], [10, 25, 50, 100, 200, "All"]],
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
                targets: [5, 6], // OrgUnitId and Action columns
                className: 'text-center'
            }
        ],
        responsive: true,
        scrollX: true
    });
    
    // Set up change role buttons
    document.querySelectorAll('.change-role-btn').forEach(btn => {
        btn.addEventListener('click', () => processRoleChange(btn));
    });
}

async function processRoleChange(button) {
    const userId = button.getAttribute('data-userid');
    const orgUnitId = button.getAttribute('data-orgunitid');
    
    button.disabled = true;
    button.textContent = 'Processing...';
    
    try {
        // DELETE current enrollment
        await fetch(`/d2l/api/lp/1.50/enrollments/${orgUnitId}/users/${userId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': localStorage.getItem('XSRF.Token') },
            credentials: 'include'
        });
        
        // POST new enrollment with RoleId 101 (Student)
        await D2LApi._fetch('/d2l/api/lp/1.50/enrollments/', {
            method: 'POST',
            body: JSON.stringify({
                OrgUnitId: parseInt(orgUnitId),
                UserId: parseInt(userId),
                RoleId: 101,
                IsCascading: false
            })
        });
        
        button.disabled = true;
        button.textContent = 'Changed';
        button.classList.remove('btn-primary');
        button.classList.add('btn-secondary');
        logChange(userId, orgUnitId, 'Changed');
    } catch (err) {
        console.error(err);
        alert(`Failed to change role for User ${userId}.`);
        button.disabled = false;
        button.textContent = 'Change to Student';
        logChange(userId, orgUnitId, 'Failed');
    }
}

function logChange(userId, orgUnitId, status) {
    const user = matchedUsers.find(u => u.UserId == userId && u.OrgUnitId == orgUnitId);
    if (user) {
        changeLog.push({
            UserId: userId,
            OrgDefinedId: user.OrgDefinedId,
            Name: user.DisplayName,
            Email: user.Email,
            Course: user.CourseName,
            OrgUnitId: orgUnitId,
            Status: status,
            Timestamp: new Date().toLocaleString()
        });
        document.getElementById('downloadLog').style.display = 'inline-flex';
    }
}

function exportChangeLog() {
    const rows = [
        ['UserId', 'OrgDefinedId', 'Name', 'Email', 'Course', 'OrgUnitId', 'Status', 'Timestamp'],
        ...changeLog.map(u => [u.UserId, u.OrgDefinedId, u.Name, u.Email, u.Course, u.OrgUnitId, u.Status, u.Timestamp])
    ];
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `role-change-log_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function exportReportCSV(data) {
    if (!data || data.length === 0) {
        alert('No data to download.');
        return;
    }
    
    const rows = [
        ['UserId', 'OrgDefinedId', 'Name', 'Email', 'CourseName', 'OrgUnitId', 'Action'],
        ...data.map(u => [u.UserId, u.OrgDefinedId, u.DisplayName, u.Email, u.CourseName, u.OrgUnitId, 'Pending'])
    ];
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `incomplete-students_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

async function runReport() {
    const semesterId = document.getElementById('semesterSelect').value;
    const status = document.getElementById('statusMessage');
    const runBtn = document.getElementById('runReport');
    const downloadBtn = document.getElementById('downloadCsv');
    const batchBtn = document.getElementById('batchChange');
    
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }
    
    // Destroy existing table if it exists
    if (userTable) {
        userTable.destroy();
        userTable = null;
    }
    
    // Disable buttons and show loading modal
    runBtn.disabled = true;
    downloadBtn.disabled = true;
    batchBtn.disabled = true;
    status.textContent = '';
    changeLog = [];
    matchedUsers = [];
    
    // Use loading modal instead of text
    LoadingUtils.showLoadingModal('Initializing report...', 'loadingModal', () => {
        // Cancel callback - will be checked in the loop
    });
    LoadingUtils.updateLoadingModal(5, 'Fetching courses...', 'loadingModal');
    
    try {
        const courses = await getCoursesInSemester(semesterId);
        matchedUsers = [];
        
        for (let i = 0; i < courses.length; i++) {
            // Check for cancellation
            if (LoadingUtils.isCancelled('loadingModal')) {
                LoadingUtils.hideLoadingModal('loadingModal');
                runBtn.disabled = false;
                status.textContent = 'Report cancelled.';
                return;
            }
            
            const course = courses[i];
            const progress = 10 + Math.round(((i + 1) / courses.length) * 85);
            LoadingUtils.updateLoadingModal(progress, `Processing course ${i + 1}/${courses.length}: ${course.Name || course.Code || 'Unknown'}...`, 'loadingModal');
            
            const enrollments = await getEnrollmentsForCourse(course.Identifier);
            enrollments.forEach(enr => {
                if (enr.Role && enr.Role.Id === 107) {
                    matchedUsers.push({
                        UserId: enr.User?.Identifier || '',
                        OrgDefinedId: enr.User?.OrgDefinedId || '',
                        DisplayName: enr.User?.DisplayName || '',
                        Email: enr.User?.EmailAddress || '',
                        CourseName: course.Name,
                        OrgUnitId: course.Identifier
                    });
                }
            });
        }
        
        LoadingUtils.updateLoadingModal(95, 'Rendering table...', 'loadingModal');
        renderTable(matchedUsers);
        
        LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
        downloadBtn.disabled = matchedUsers.length === 0;
        batchBtn.disabled = matchedUsers.length === 0;
        
        status.textContent = matchedUsers.length > 0
            ? `✅ Report complete. ${matchedUsers.length} incomplete student(s) found.`
            : `⚠️ Report complete. No users found with Role ID 107 in the selected semester.`;
        
        // Hide modal after a brief delay
        setTimeout(() => {
            LoadingUtils.hideLoadingModal('loadingModal');
        }, 1000);
    } catch (error) {
        console.error('Error running report:', error);
        status.textContent = '❌ Error: ' + error.message;
        LoadingUtils.hideLoadingModal('loadingModal');
    } finally {
        runBtn.disabled = false;
    }
}

async function handleBatchChange() {
    const confirmBatch = confirm('Are you sure you want to change ALL users to Student (RoleId 101)?');
    if (!confirmBatch) return;
    
    const buttons = document.querySelectorAll('.change-role-btn:not(:disabled)');
    for (const btn of buttons) {
        await processRoleChange(btn);
        // Small delay between changes
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    alert('Batch role change complete.');
}
