/**
 * Incomplete Student Tool
 * Changes student roles between Student and Incomplete, and generates email templates
 */

let selectedCourse = { incomplete: null, convert: null };

function isAllowedSemester(semester) {
    const currentYear = new Date().getFullYear();
    const allowedYears = new Set([2024, 2025, currentYear, 2027]);
    const allowedTerms = ['WI', 'SP', 'FA'];
    const semesterText = `${semester?.Name || ''} ${semester?.Code || ''}`.toUpperCase();

    return Array.from(allowedYears).some(year => {
        const yy = String(year).slice(-2);
        return allowedTerms.some(term => {
            const yyPattern = new RegExp(`\\b${yy}\\s*[\\/-]\\s*${term}\\b`);
            const yyyyPattern = new RegExp(`\\b${year}\\s*[\\/-]\\s*${term}\\b`);
            return yyPattern.test(semesterText) || yyyyPattern.test(semesterText);
        });
    });
}

function openTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(div => {
        div.style.display = 'none';
        div.classList.remove('active');
    });
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    const tab = document.getElementById(tabId);
    if (tab) {
        tab.style.display = 'block';
        tab.classList.add('active');
    }
    const btn = document.querySelector(`.tab-button[onclick="openTab('${tabId}')"]`);
    if (btn) btn.classList.add('active');
}

function copyToClipboard(id) {
    const textarea = document.getElementById(id);
    if (textarea) {
        textarea.select();
        document.execCommand('copy');
        alert('Copied to clipboard!');
    }
}

async function loadSemesters() {
    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(10, 'Loading semesters...', 'loadingContainer');
        
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
        
        const filteredSemesters = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
            ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data))
            : data.filter(isAllowedSemester).sort((a, b) => b.Name.localeCompare(a.Name));

        ['term_incomplete', 'term_convert'].forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            sel.innerHTML = '<option value="">Select a Semester</option>';
            filteredSemesters.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.Identifier;
                opt.textContent = s.Name;
                sel.appendChild(opt);
            });
        });
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);
    } catch (error) {
        console.error('Error loading semesters:', error);
        LoadingUtils.hideLoadingBar('loadingContainer');
    }
}

async function searchCourse(mode) {
    const query = document.getElementById(`courseSearch_${mode}`).value.trim().toLowerCase();
    const termId = document.getElementById(`term_${mode}`).value;
    if (!termId || !query) {
        alert('Select a semester and enter a course search term');
        return;
    }
    
    const resultsContainer = document.getElementById(`courseResults_${mode}`);
    resultsContainer.innerHTML = 'Searching...';
    
    try {
        let results = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            results = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/1.49/orgstructure/${termId}/children/`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.49/orgstructure/${termId}/children/?pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                results = response.Objects;
            } else if (Array.isArray(response)) {
                results = response;
            }
        }
        
        const courses = results.filter(c =>
            c.Type?.Code === 'Course Offering' &&
            (c.Name.toLowerCase().includes(query) || c.Code?.toLowerCase().includes(query))
        );
        
        if (!courses.length) {
            resultsContainer.innerHTML = 'No courses found.';
            return;
        }
        
        resultsContainer.innerHTML = '<table class="display" style="width:100%"><thead><tr><th></th><th>Code</th><th>Name</th></tr></thead><tbody>' +
            courses.map(c => `
                <tr>
                    <td><input type="radio" name="course_${mode}" value="${c.Identifier}"></td>
                    <td>${c.Code}</td>
                    <td>${c.Name}</td>
                </tr>
            `).join('') + '</tbody></table>';
        
        document.querySelectorAll(`input[name="course_${mode}"]`).forEach(input => {
            input.addEventListener('change', () => {
                const course = courses.find(c => c.Identifier == input.value);
                selectedCourse[mode] = course;
                const selectedBox = document.getElementById(`selectedCourse_${mode}`);
                selectedBox.style.display = 'block';
                selectedBox.innerHTML = `<h4>${course.Name}</h4><p>${course.Code}</p>`;
            });
        });
    } catch (e) {
        resultsContainer.innerHTML = `Error: ${e.message}`;
    }
}

async function changeRoleDeletePost(mode) {
    let orgId = document.getElementById(`orgDefinedId_${mode}`).value.trim();
    if (orgId.startsWith('$')) orgId = orgId.substring(1);
    
    const course = selectedCourse[mode];
    if (!orgId || !course) {
        alert('Enter OrgDefinedId and select a course');
        return;
    }
    
    try {
        let courseId = course.Identifier;
        if (typeof courseId === 'string' && courseId.startsWith('$')) {
            courseId = courseId.substring(1);
        }
        
        LoadingUtils.showLoadingModal('Processing role change...');
        
        const students = await D2LApi._fetch('/d2l/api/lp/1.46/users/?orgDefinedId=' + encodeURIComponent(orgId));
        const student = students[0];
        const newRoleId = mode === 'incomplete' ? 107 : 101;
        
        // Delete existing enrollment
        await fetch(`/d2l/api/lp/1.50/enrollments/${courseId}/users/${student.UserId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': localStorage.getItem('XSRF.Token') },
            credentials: 'include'
        });
        
        // Create new enrollment
        await D2LApi._fetch('/d2l/api/lp/1.50/enrollments/', {
            method: 'POST',
            body: JSON.stringify({
                OrgUnitId: parseInt(courseId),
                UserId: student.UserId,
                RoleId: newRoleId,
                IsCascading: false
            })
        });
        
        // Get instructor info
        let instructor = null;
        try {
            const classlist = await D2LApi._fetch(`/d2l/api/le/1.82/${courseId}/classlist/`);
            instructor = classlist.find(u => u.RoleId === 102);
        } catch (e) {
            console.warn('Could not fetch classlist:', e);
        }
        
        // Generate email templates
        const studentName = `${student.FirstName} ${student.LastName}`;
        const courseName = `${course.Name} (${course.Code})`;
        
        let studentMsg = '';
        let instructorMsg = '';
        
        if (mode === 'incomplete') {
            studentMsg = `To: ${student.ExternalEmail}

Hello ${student.FirstName},

You have been marked as Incomplete in your course:

${courseName}

This means you now have temporary access to finish outstanding course materials beyond the original end date. Please log in to your D2L account to complete any remaining work.

If you have any questions, please contact elearning@example.edu.

Regards,
eLearning Office`;

            instructorMsg = `To: ${instructor?.Email || 'N/A'}

Dear ${instructor?.FirstName || 'Instructor'},

eLearning was notified by the Registrar's Office that ${studentName} (OrgDefinedId: ${student.OrgDefinedId}) has been issued an Incomplete in your course:

${courseName}

eLearning has enrolled the student with an Incomplete Status. When the student has completed the course and received their Final Grade, eLearning will receive a notification from the Registrar's Office to change the status of the student from 'Incomplete Student' back to 'Student'.

If you have any questions, please contact elearning@example.edu.

Regards,
eLearning Office`;
        } else {
            studentMsg = `To: ${student.ExternalEmail}

Hello ${student.FirstName},

Your status in the course:

${courseName}

has been converted back to Student. You can check your MyDelta > Grades to view the changed grade.

If you have any questions, please contact elearning@example.edu.

Regards,
eLearning Office`;

            instructorMsg = `To: ${instructor?.Email || 'N/A'}

Dear ${instructor?.FirstName || 'Instructor'},

The student ${studentName} (OrgDefinedId: ${student.OrgDefinedId}) has been converted back to Student in your course:

${courseName}

Their extended Incomplete period is now closed. Please proceed with final grading as appropriate.

Regards,
eLearning Office`;
        }
        
        document.getElementById(`studentEmailTemplate_${mode}`).value = studentMsg;
        document.getElementById(`instructorEmailTemplate_${mode}`).value = instructorMsg;
        document.getElementById(`studentEmailTo_${mode}`).value = student.ExternalEmail || '';
        document.getElementById(`instructorEmailTo_${mode}`).value = instructor?.Email || 'N/A';
        document.getElementById(`studentEmailSubject_${mode}`).value = `Incomplete Status - ${courseName}`;
        document.getElementById(`instructorEmailSubject_${mode}`).value = `Incomplete Status Change - ${courseName}`;
        
        document.getElementById('confirmationBox').style.display = 'block';
        document.getElementById('confirmationMessage').textContent = `Role changed to ${mode === 'incomplete' ? 'Incomplete Student' : 'Student'} for ${studentName} in ${courseName}`;
        
        LoadingUtils.hideLoadingModal();
    } catch (e) {
        alert(`Error: ${e.message}`);
        console.error(e);
        LoadingUtils.hideLoadingModal();
    }
}

// Make functions globally accessible
window.openTab = openTab;
window.searchCourse = searchCourse;
window.changeRoleDeletePost = changeRoleDeletePost;
window.copyToClipboard = copyToClipboard;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    loadSemesters();
});
