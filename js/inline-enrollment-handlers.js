// inline-enrollment-handlers.js
import { BrightspaceFetch } from './auth.js';
import { openChangeRoleModal } from './change-role-modal.js';
import { openDeleteEnrollmentModal } from './delete-enrollment-modal.js';
import { hideAllModals } from './modal-utils.js';

export function initializeInlineEnrollmentHandlers() {
    document.removeEventListener('click', handleEnrollmentButtonClick);
    document.addEventListener('click', handleEnrollmentButtonClick);
}

function handleEnrollmentButtonClick(event) {
    const enrollmentsBtn = event.target.closest('.view-course-enrollments-btn');
    if (enrollmentsBtn) {
        event.preventDefault();
        event.stopPropagation();
        handleViewCourseEnrollments(enrollmentsBtn);
    }
    const closeBtn = event.target.closest('.close-enrollments-btn');
    if (closeBtn) {
        event.preventDefault();
        event.stopPropagation();
        const row = closeBtn.closest('.course-enrollments-row');
        if (row) row.style.display = 'none';
    }
    const changeRoleBtn = event.target.closest('.inline-change-role-btn');
    if (changeRoleBtn) {
        event.preventDefault();
        event.stopPropagation();
        handleInlineChangeRole(changeRoleBtn);
    }
    const deleteBtn = event.target.closest('.inline-delete-btn');
    if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        handleInlineDelete(deleteBtn);
    }
}

function handleViewCourseEnrollments(button) {
    const courseId = button.dataset.courseId;
    const courseName = button.dataset.courseName;
    const courseRow = button.closest('tr');
    const existingEnrollmentRow = document.querySelector(`.course-enrollments-row[data-course-id="${courseId}"]`);
    if (existingEnrollmentRow) {
        existingEnrollmentRow.style.display = existingEnrollmentRow.style.display === 'none' ? 'table-row' : 'none';
        return;
    }
    const enrollmentsRow = document.createElement('tr');
    enrollmentsRow.className = 'course-enrollments-row';
    enrollmentsRow.dataset.courseId = courseId;
    const numColumns = courseRow.cells.length;
    const enrollmentsCell = document.createElement('td');
    enrollmentsCell.colSpan = numColumns;
    enrollmentsCell.innerHTML = `<div class="course-enrollments-container"><h4>Loading enrollments for ${courseName}...</h4><span class="loading-spinner"></span></div>`;
    enrollmentsRow.appendChild(enrollmentsCell);
    courseRow.parentNode.insertBefore(enrollmentsRow, courseRow.nextSibling);
    fetchAndDisplayEnrollments(courseId, courseName, enrollmentsCell);
}

async function fetchAndDisplayEnrollments(courseId, courseName, container) {
    try {
        const classlistUrl = `/d2l/api/le/1.78/${courseId}/classlist/paged/`;
        const classlist = await BrightspaceFetch(classlistUrl);
        let users = [];
        if (classlist && classlist.Objects && Array.isArray(classlist.Objects)) users = classlist.Objects;
        else if (classlist && classlist.Items && Array.isArray(classlist.Items)) users = classlist.Items;
        else if (Array.isArray(classlist)) users = classlist;

        if (!users.length) {
            container.innerHTML = `<div class="course-enrollments-container"><h4>Enrollments for ${courseName}</h4><p>No enrollments found.</p><button class="btn btn-outline close-enrollments-btn"><i class="fa-solid fa-xmark"></i> Close</button></div>`;
            return;
        }

        const roleNames = { 100: "Admin", 101: "Student", 102: "Instructor", 107: "Incomplete Student", 112: "Student View", 122: "Trainer", 135: "Master Trainer", 138: "Course Evaluator", 139: "Faculty Member", 151: "Faculty", 172: "Designer" };
        const tableRows = users.map(user => {
            const userId = user.Identifier || user.UserId || '';
            const userName = `${user.FirstName || ''} ${user.LastName || ''}`.trim() || 'Unknown';
            const orgDefinedId = user.OrgDefinedId || '';
            const roleId = user.RoleId || '';
            const roleName = roleNames[roleId] || `Role ${roleId}`;
            return `<tr><td>${userName}${orgDefinedId ? ` (${orgDefinedId})` : ''}</td><td>${roleName}</td><td><button class="btn btn-sm inline-change-role-btn" data-user-id="${userId}" data-org-unit-id="${courseId}" data-role-id="${roleId}"><i class="fa-solid fa-pen"></i> Change Role</button> <button class="btn btn-sm inline-delete-btn" data-user-id="${userId}" data-org-unit-id="${courseId}"><i class="fa-solid fa-trash"></i> Delete</button></td></tr>`;
        }).join('');

        container.innerHTML = `<div class="course-enrollments-container"><h4>Enrollments for ${courseName}</h4><table class="enrollments-table data-table"><thead><tr><th>User</th><th>Role</th><th>Actions</th></tr></thead><tbody>${tableRows}</tbody></table><button class="btn btn-outline close-enrollments-btn"><i class="fa-solid fa-xmark"></i> Close</button></div>`;
    } catch (error) {
        container.innerHTML = `<div class="course-enrollments-container"><h4>Error</h4><p>${error.message}</p><button class="btn btn-outline close-enrollments-btn"><i class="fa-solid fa-xmark"></i> Close</button></div>`;
    }
}

async function handleInlineChangeRole(button) {
    const userId = button.dataset.userId;
    const orgUnitId = button.dataset.orgUnitId;
    const currentRoleId = button.dataset.roleId;
    try {
        const userInfo = await getUserInfo(userId);
        const courseInfo = await getCourseInfo(orgUnitId);
        const enrollmentRow = button.closest('.course-enrollments-row');
        const enrollmentCell = enrollmentRow ? enrollmentRow.querySelector('td') : null;
        hideAllModals();
        openChangeRoleModal(userInfo, courseInfo, currentRoleId, () => {
            if (enrollmentCell) fetchAndDisplayEnrollments(orgUnitId, courseInfo.Name, enrollmentCell);
        });
    } catch (error) {
        alert(`Failed to load: ${error.message}`);
    }
}

async function handleInlineDelete(button) {
    const userId = button.dataset.userId;
    const orgUnitId = button.dataset.orgUnitId;
    try {
        const userInfo = await getUserInfo(userId);
        const courseInfo = await getCourseInfo(orgUnitId);
        const enrollmentRow = button.closest('.course-enrollments-row');
        const enrollmentCell = enrollmentRow ? enrollmentRow.querySelector('td') : null;
        hideAllModals();
        openDeleteEnrollmentModal(userInfo, courseInfo, () => {
            if (enrollmentCell) fetchAndDisplayEnrollments(orgUnitId, courseInfo.Name, enrollmentCell);
        });
    } catch (error) {
        alert(`Failed to load: ${error.message}`);
    }
}

async function getUserInfo(userId) {
    try {
        return await BrightspaceFetch(`/d2l/api/lp/1.46/users/${userId}`);
    } catch (_) {
        return { UserId: userId, FirstName: 'User', LastName: userId, DisplayName: `User ${userId}` };
    }
}

async function getCourseInfo(courseId) {
    try {
        const c = await BrightspaceFetch(`/d2l/api/lp/1.46/orgstructure/${courseId}`);
        return c.Id ? c : { ...c, Id: c.Identifier };
    } catch (_) {
        return { Id: courseId, Identifier: courseId, Name: `Course ${courseId}`, Code: courseId };
    }
}
