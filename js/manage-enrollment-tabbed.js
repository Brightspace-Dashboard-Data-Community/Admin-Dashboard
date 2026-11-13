// manage-enrollment-tabbed.js
import { BrightspaceFetch } from './auth.js';
import { openChangeRoleModal } from './change-role-modal.js';
import { openDeleteEnrollmentModal } from './delete-enrollment-modal.js';
import { initializeInlineEnrollmentHandlers } from './inline-enrollment-handlers.js';
import { initializeBulkUnenrollByRole } from './bulk-unenroll-by-role.js';

let rootOrgUnitId = null;

document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    initializeUserSearch();
    await initializeCourseSearch();
    initializeCourseIdSearch();
    initializeInlineEnrollmentHandlers();
    initializeBulkUnenrollByRole();
});

function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    tabButtons.forEach(button => {
        button.addEventListener('click', function () {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            button.classList.add('active');
            const tabId = button.dataset.tab + '-tab';
            const el = document.getElementById(tabId);
            if (el) el.classList.add('active');
            const err = document.getElementById('error-container');
            const info = document.getElementById('info-container');
            if (err) err.innerHTML = '';
            if (info) info.innerHTML = '';
        });
    });
}

function initializeUserSearch() {
    const form = document.getElementById('user-search-form');
    if (form) form.addEventListener('submit', handleUserSearch);
    const resetBtn = document.querySelector('#user-tab button[type="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', () => clearSearchResults('userSearchResults', 'Enter a search term to find users.'));
}

async function initializeCourseSearch() {
    await getRootOrgUnitId();
    await loadSemesters();
    const form = document.getElementById('course-search-form');
    if (form) form.addEventListener('submit', handleCourseSearch);
    const resetBtn = document.querySelector('#course-tab button[type="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', () => clearSearchResults('courseSearchResults', 'Use the search box and select a semester to find courses.'));
}

function initializeCourseIdSearch() {
    const form = document.getElementById('course-id-search-form');
    if (form) form.addEventListener('submit', handleCourseIdSearch);
    const resetBtn = document.querySelector('#course-id-tab button[type="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', () => clearSearchResults('courseIdSearchResults', 'Enter a Course ID above to search.'));
}

async function getRootOrgUnitId() {
    try {
        const response = await BrightspaceFetch('/d2l/api/lp/1.49/organization/info');
        if (response && response.Identifier) rootOrgUnitId = response.Identifier;
        else throw new Error('Invalid organization data');
    } catch (error) {
        const err = document.getElementById('error-container');
        if (err) err.innerHTML = '<div class="error-msg"><i class="fa-solid fa-circle-exclamation"></i> Error fetching organization details.</div>';
    }
}

async function loadSemesters() {
    if (!rootOrgUnitId) return;
    const termSelect = document.getElementById('term');
    if (!termSelect) return;
    try {
        const response = await BrightspaceFetch(`/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`);
        const special = { Identifier: '0000', Name: '0000-No Semester' };
        let filtered;
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            filtered = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(Array.isArray(response) ? response : []));
        } else {
            const minId = 2966924;
            filtered = Array.isArray(response) ? response.filter(s => parseInt(s.Identifier || s.Id) >= minId || (s.Identifier || s.Id) === '0000') : [];
            filtered.sort((a, b) => (b.Name || '').localeCompare(a.Name || ''));
        }
        if (!filtered.some(s => (s.Identifier || s.Id) === '0000')) filtered.push(special);
        termSelect.innerHTML = '<option value="">Select a Semester</option>';
        filtered.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.Identifier || s.Id;
            opt.textContent = s.Name;
            termSelect.appendChild(opt);
        });
    } catch (error) {
        const err = document.getElementById('error-container');
        if (err) err.innerHTML = '<div class="error-msg"><i class="fa-solid fa-circle-exclamation"></i> Error loading semesters.</div>';
    }
}

async function handleUserSearch(event) {
    event.preventDefault();
    const errEl = document.getElementById('error-container');
    const infoEl = document.getElementById('info-container');
    const resultsEl = document.getElementById('userSearchResults');
    if (errEl) errEl.innerHTML = '';
    if (infoEl) infoEl.innerHTML = '';
    const query = document.getElementById('userSearchQuery').value.trim();
    const searchType = document.getElementById('userSearchType').value;
    if (!query) {
        if (errEl) errEl.innerHTML = '<div class="error-msg">Please enter a search term.</div>';
        return;
    }
    if (resultsEl) resultsEl.innerHTML = '<tr><td colspan="6" class="text-center"><span class="loading-spinner"></span> Searching...</td></tr>';
    try {
        let users = [];
        if (searchType === 'userId') {
            if (isNaN(query)) throw new Error('User ID must be a number');
            const r = await BrightspaceFetch(`/d2l/api/lp/1.46/users/${query}`);
            if (r) users = [r];
        } else if (searchType === 'userName') {
            const r = await BrightspaceFetch(`/d2l/api/lp/1.46/users/?userName=${encodeURIComponent(query)}`);
            if (Array.isArray(r)) users = r;
            else if (r && r.Items && Array.isArray(r.Items)) users = r.Items;
            else if (r) users = [r];
        } else {
            const r = await BrightspaceFetch(`/d2l/api/lp/1.46/users/?orgDefinedId=${encodeURIComponent(query)}`);
            if (Array.isArray(r)) users = r;
            else if (r && r.Items && Array.isArray(r.Items)) users = r.Items;
            else if (r) users = [r];
        }
        displayUserSearchResults(users);
    } catch (error) {
        if (errEl) errEl.innerHTML = `<div class="error-msg">${error.message}</div>`;
        if (resultsEl) resultsEl.innerHTML = '<tr><td colspan="6" class="text-center">No users found.</td></tr>';
    }
}

async function handleCourseSearch(event) {
    event.preventDefault();
    const errEl = document.getElementById('error-container');
    const infoEl = document.getElementById('info-container');
    const resultsEl = document.getElementById('courseSearchResults');
    if (errEl) errEl.innerHTML = '';
    if (infoEl) infoEl.innerHTML = '';
    const searchQuery = document.getElementById('courseSearchQuery').value.toLowerCase();
    const semesterId = document.getElementById('term').value;
    if (!semesterId) {
        if (errEl) errEl.innerHTML = '<div class="error-msg">Please select a semester.</div>';
        return;
    }
    if (resultsEl) resultsEl.innerHTML = '<tr><td colspan="6" class="text-center"><span class="loading-spinner"></span> Loading courses...</td></tr>';
    try {
        const courses = await fetchCoursesBySemester(semesterId);
        if (!courses.length) {
            if (resultsEl) resultsEl.innerHTML = '<tr><td colspan="6" class="text-center">No courses found for this semester.</td></tr>';
            return;
        }
        const terms = searchQuery.split(/[\s-]+/).filter(t => t.length > 0);
        const filtered = terms.length ? courses.filter(c => c.Code && terms.every(t => c.Code.toLowerCase().includes(t))) : courses;
        const enhanced = await Promise.all(filtered.map(async c => {
            try {
                const d = await fetchCourseDetails(c.Identifier || c.Id);
                return d ? { ...c, ...d } : c;
            } catch (_) { return c; }
        }));
        displayCourseSearchResults(enhanced, 'courseSearchResults');
    } catch (error) {
        if (errEl) errEl.innerHTML = '<div class="error-msg">Error retrieving courses.</div>';
        if (resultsEl) resultsEl.innerHTML = '<tr><td colspan="6" class="text-center">Error. Please try again.</td></tr>';
    }
}

async function handleCourseIdSearch(event) {
    event.preventDefault();
    const errEl = document.getElementById('error-container');
    const infoEl = document.getElementById('info-container');
    const resultsEl = document.getElementById('courseIdSearchResults');
    if (errEl) errEl.innerHTML = '';
    if (infoEl) infoEl.innerHTML = '';
    const courseId = document.getElementById('courseId').value.trim();
    if (!courseId) {
        if (errEl) errEl.innerHTML = '<div class="error-msg">Please enter a Course ID.</div>';
        return;
    }
    if (resultsEl) resultsEl.innerHTML = '<tr><td colspan="6" class="text-center"><span class="loading-spinner"></span> Searching...</td></tr>';
    try {
        const course = await BrightspaceFetch(`/d2l/api/lp/1.49/courses/${courseId}`);
        if (!course || !course.Identifier) throw new Error('Invalid course');
        displayCourseSearchResults([course], 'courseIdSearchResults');
    } catch (error) {
        if (errEl) errEl.innerHTML = `<div class="error-msg">${error.message}</div>`;
        if (resultsEl) resultsEl.innerHTML = `<tr><td colspan="6" class="text-center">No course found with ID ${courseId}.</td></tr>`;
    }
}

async function fetchCoursesBySemester(semesterId) {
    try {
        const r = await BrightspaceFetch(`/d2l/api/lp/1.49/orgstructure/${semesterId}/children/`);
        return r.filter(item => item.Type && (item.Type.Code === 'Course Offering' || item.Type.Name === 'Course Offering' || item.Type.Id === 3));
    } catch (_) {
        const r = await BrightspaceFetch(`/d2l/api/lp/1.49/orgstructure/${semesterId}/descendants/`);
        return r.filter(c => c.Type && c.Type.Code === 'Course Offering');
    }
}

async function fetchCourseDetails(courseId) {
    try {
        return await BrightspaceFetch(`/d2l/api/lp/1.49/courses/${courseId}`);
    } catch (_) { return null; }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const d = new Date(dateString);
        return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) { return 'N/A'; }
}

async function fetchUserEnrollments(userId) {
    try {
        const response = await BrightspaceFetch(`/d2l/api/lp/1.46/enrollments/users/${userId}/orgunits/`);
        const items = response && response.Items && Array.isArray(response.Items) ? response.Items : [];
        return items.filter(item => item.OrgUnit && item.OrgUnit.Type && item.OrgUnit.Type.Id === 3);
    } catch (_) { return []; }
}

async function displayUserSearchResults(users) {
    const resultsContainer = document.getElementById('userSearchResults');
    const infoEl = document.getElementById('info-container');
    if (!resultsContainer) return;
    if (!users || users.length === 0) {
        resultsContainer.innerHTML = '<tr><td colspan="6" class="text-center">No users found.</td></tr>';
        return;
    }
    const baseUrl = window.location.origin || '';
    const rows = await Promise.all(users.map(async user => {
        const name = `${user.FirstName || ''} ${user.LastName || ''}`.trim();
        const enrollments = await fetchUserEnrollments(user.UserId);
        const enrollRows = enrollments.length ? enrollments.map(e => `
            <tr>
                <td>${e.OrgUnit.Name} (${e.OrgUnit.Code})</td>
                <td>${e.Role.Name}</td>
                <td>
                    <button class="btn btn-sm change-role-btn" data-user-id="${user.UserId}" data-org-unit-id="${e.OrgUnit.Id}" data-role-id="${e.Role.Id}"><i class="fa-solid fa-pen"></i> Change Role</button>
                    <button class="btn btn-sm delete-btn" data-user-id="${user.UserId}" data-org-unit-id="${e.OrgUnit.Id}"><i class="fa-solid fa-trash"></i> Delete</button>
                </td>
            </tr>
        `).join('') : '';
        const enrollBlock = enrollments.length ? `<tr class="enrollments-row" style="display:none" data-user-id="${user.UserId}"><td colspan="6"><table class="data-table"><thead><tr><th>Course</th><th>Role</th><th>Actions</th></tr></thead><tbody>${enrollRows}</tbody></table></td></tr>` : '';
        return `<tr><td>${user.UserId}</td><td>${name}</td><td>${user.UserName || ''}</td><td>${user.ExternalEmail || ''}</td><td>${user.OrgDefinedId || ''}</td><td><button class="btn btn-sm view-enrollments-btn" data-user-id="${user.UserId}" data-display-name="${name}"><i class="fa-solid fa-graduation-cap"></i> View Enrollments</button></td></tr>${enrollBlock}`;
    }));
    resultsContainer.innerHTML = `<tr><td colspan="6" class="text-center" style="background:var(--surface-secondary); font-weight:600">Found ${users.length} user(s)</td></tr>${rows.join('')}`;
    if (infoEl) infoEl.innerHTML = `<div class="info-msg"><i class="fa-solid fa-circle-info"></i> Found ${users.length} user(s).</div>`;
    attachUserActionListeners();
}

function displayCourseSearchResults(courses, resultsElementId) {
    const resultsContainer = document.getElementById(resultsElementId);
    const infoEl = document.getElementById('info-container');
    if (!resultsContainer) return;
    if (!courses || !courses.length) {
        resultsContainer.innerHTML = '<tr><td colspan="6" class="text-center">No matching courses.</td></tr>';
        return;
    }
    courses.sort((a, b) => (a.Code || '').localeCompare(b.Code || ''));
    const baseUrl = window.location.origin || 'https://your-brightspace.example.edu';
    const rows = courses.map(course => {
        const courseId = course.Identifier || course.Id;
        const courseCode = course.Code || 'N/A';
        const courseName = course.Name || 'Unnamed Course';
        const startDate = formatDate(course.StartDate);
        const endDate = formatDate(course.EndDate);
        const homeLink = `${baseUrl}/d2l/home/${courseId}`;
        const offeringLink = `${baseUrl}/d2l/lp/manageCourses/course_offering_info_viewedit.d2l?ou=${courseId}`;
        const classListLink = `${baseUrl}/d2l/lms/classlist/classlist.d2l?ou=${courseId}`;
        return `<tr><td>${courseId}</td><td>${courseName}</td><td><a href="${homeLink}" target="_blank" rel="noopener">${courseCode} <i class="fa-solid fa-up-right-from-square"></i></a></td><td>${startDate}</td><td>${endDate}</td><td><a href="${offeringLink}" target="_blank" rel="noopener" class="btn btn-sm" title="Course Info"><i class="fa-solid fa-circle-info"></i></a> <a href="${classListLink}" target="_blank" rel="noopener" class="btn btn-sm" title="Class List"><i class="fa-solid fa-users"></i></a> <button class="btn btn-sm view-course-enrollments-btn" data-course-id="${courseId}" data-course-name="${courseName} (${courseCode})"><i class="fa-solid fa-graduation-cap"></i> View Enrollments</button></td></tr>`;
    }).join('');
    resultsContainer.innerHTML = `<tr><td colspan="6" class="text-center" style="background:var(--surface-secondary); font-weight:600">Found ${courses.length} course(s)</td></tr>${rows}`;
    if (infoEl) infoEl.innerHTML = `<div class="info-msg"><i class="fa-solid fa-circle-info"></i> Found ${courses.length} course(s).</div>`;
}

function attachUserActionListeners() {
    document.querySelectorAll('.view-enrollments-btn').forEach(btn => {
        btn.onclick = function () {
            const userId = this.dataset.userId;
            const row = document.querySelector(`.enrollments-row[data-user-id="${userId}"]`);
            if (!row) return;
            const visible = row.style.display === 'table-row';
            document.querySelectorAll('.enrollments-row').forEach(r => { r.style.display = 'none'; });
            row.style.display = visible ? 'none' : 'table-row';
        };
    });
    document.querySelectorAll('.change-role-btn').forEach(btn => {
        btn.onclick = async function () {
            const userId = this.dataset.userId;
            const orgUnitId = this.dataset.orgUnitId;
            const currentRoleId = this.dataset.roleId;
            try {
                const user = await BrightspaceFetch(`/d2l/api/lp/1.46/users/${userId}`);
                if (!user || !user.UserId) throw new Error('User not found');
                const courseInfo = await BrightspaceFetch(`/d2l/api/lp/1.46/orgstructure/${orgUnitId}`);
                if (!courseInfo) throw new Error('Course not found');
                openChangeRoleModal(user, courseInfo.Id ? courseInfo : { ...courseInfo, Id: courseInfo.Identifier }, currentRoleId, () => handleUserSearch(new Event('submit')));
            } catch (e) {
                alert('Failed to load: ' + e.message);
            }
        };
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.onclick = async function () {
            const userId = this.dataset.userId;
            const orgUnitId = this.dataset.orgUnitId;
            try {
                const user = await BrightspaceFetch(`/d2l/api/lp/1.46/users/${userId}`);
                if (!user || !user.UserId) throw new Error('User not found');
                const courseInfo = await BrightspaceFetch(`/d2l/api/lp/1.46/orgstructure/${orgUnitId}`);
                if (!courseInfo) throw new Error('Course not found');
                openDeleteEnrollmentModal(user, courseInfo.Id ? courseInfo : { ...courseInfo, Id: courseInfo.Identifier }, () => handleUserSearch(new Event('submit')));
            } catch (e) {
                alert('Failed to load: ' + e.message);
            }
        };
    });
}

function clearSearchResults(resultsElementId, message) {
    const err = document.getElementById('error-container');
    const info = document.getElementById('info-container');
    const results = document.getElementById(resultsElementId);
    if (err) err.innerHTML = '';
    if (info) info.innerHTML = '';
    if (results) results.innerHTML = `<tr><td colspan="6" class="text-center">${message}</td></tr>`;
}
