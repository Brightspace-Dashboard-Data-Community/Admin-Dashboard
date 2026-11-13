// change-role-modal.js
import { BrightspaceFetch } from './auth.js';
import { hideAllModals, showConfirmation } from './modal-utils.js';

const predefinedRoles = [
    { Id: 100, Name: "Admin" },
    { Id: 101, Name: "Student" },
    { Id: 102, Name: "Instructor" },
    { Id: 107, Name: "Incomplete Student" },
    { Id: 139, Name: "Faculty Member" },
    { Id: 151, Name: "Faculty" },
    { Id: 138, Name: "Course Evaluator" },
    { Id: 112, Name: "Student View" },
    { Id: 122, Name: "Trainer" },
    { Id: 135, Name: "Master Trainer" },
    { Id: 172, Name: "Designer" }
];

export function openChangeRoleModal(user, course, currentRoleId, onSuccess) {
    hideAllModals();
    const modal = document.getElementById('changeRoleModal');
    const userInput = document.getElementById('changeRoleUser');
    const courseInput = document.getElementById('changeRoleCourse');
    const roleSelect = document.getElementById('changeRoleSelect');
    const confirmBtn = document.getElementById('changeRoleConfirmBtn');
    const cancelBtn = document.getElementById('changeRoleCancelBtn');

    if (!modal || !userInput || !courseInput || !roleSelect || !confirmBtn || !cancelBtn) {
        console.error('Change Role Modal: One or more DOM elements not found.');
        alert('Error: Modal elements not found. Please check the page structure.');
        return;
    }

    const normalizedUser = user.UserId ? user : (user.Items && user.Items.length > 0 ? user.Items[0] : user);
    if (!normalizedUser || !normalizedUser.UserId) {
        alert('Error: Invalid user data. Please try again.');
        return;
    }

    const normalizedCourse = course.Id ? course : (course.Identifier ? { ...course, Id: course.Identifier } : course);
    if (!normalizedCourse || (!normalizedCourse.Id && !normalizedCourse.Identifier)) {
        alert('Error: Invalid course data. Please try again.');
        return;
    }
    const courseId = normalizedCourse.Id || normalizedCourse.Identifier;

    userInput.value = `${normalizedUser.FirstName || ''} ${normalizedUser.LastName || ''} (${normalizedUser.UserId})`;
    courseInput.value = `${normalizedCourse.Name || ''} (${normalizedCourse.Code || ''})`;
    roleSelect.innerHTML = '';
    predefinedRoles.forEach(role => {
        const option = document.createElement('option');
        option.value = role.Id;
        option.textContent = role.Name;
        if (parseInt(role.Id) === parseInt(currentRoleId)) option.selected = true;
        roleSelect.appendChild(option);
    });

    modal.style.zIndex = '2001';
    modal.style.display = 'flex';

    const confirmBtnClone = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(confirmBtnClone, confirmBtn);
    const cancelBtnClone = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(cancelBtnClone, cancelBtn);
    const newConfirmBtn = document.getElementById('changeRoleConfirmBtn');
    const newCancelBtn = document.getElementById('changeRoleCancelBtn');

    newConfirmBtn.addEventListener('click', async () => {
        const newRoleId = roleSelect.value;
        if (!newRoleId) { alert('Please select a role.'); return; }
        newConfirmBtn.disabled = true;
        newConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Changing Role...';
        try {
            const userId = normalizedUser.UserId;
            await BrightspaceFetch(`/d2l/api/lp/1.46/enrollments/users/${userId}/orgUnits/${courseId}`, 'DELETE');
            await BrightspaceFetch('/d2l/api/lp/1.46/enrollments/', 'POST', {
                OrgUnitId: parseInt(courseId),
                UserId: parseInt(userId),
                RoleId: parseInt(newRoleId),
                IsCascading: false
            });
            hideAllModals();
            const confirmationMessage = document.getElementById('roleChangeConfirmationMessage');
            if (confirmationMessage) {
                const roleName = predefinedRoles.find(r => r.Id === parseInt(newRoleId))?.Name || `Role ${newRoleId}`;
                confirmationMessage.innerHTML = `<strong>User:</strong> ${normalizedUser.FirstName} ${normalizedUser.LastName} (${normalizedUser.UserId})<br><strong>Course:</strong> ${normalizedCourse.Name} (${normalizedCourse.Code || ''})<br><strong>New Role:</strong> ${roleName}`;
            }
            const courseLink = document.getElementById('roleCourseLink');
            if (courseLink) courseLink.href = (window.location.origin || 'https://your-brightspace.example.edu') + '/d2l/home/' + courseId;
            showConfirmation('roleChangeConfirmation');
            const closeBtn = document.getElementById('closeRoleConfirmation');
            if (closeBtn) closeBtn.onclick = () => { document.getElementById('roleChangeConfirmation').style.display = 'none'; };
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error changing role:', error);
            alert(`Failed to change role: ${error.message}`);
        } finally {
            newConfirmBtn.disabled = false;
            newConfirmBtn.innerHTML = '<i class="fas fa-check"></i> Confirm';
        }
    });
    newCancelBtn.addEventListener('click', () => hideAllModals());
}
