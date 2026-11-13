// delete-enrollment-modal.js
import { BrightspaceFetch } from './auth.js';
import { hideAllModals, showConfirmation } from './modal-utils.js';

export function openDeleteEnrollmentModal(user, course, onSuccess) {
    hideAllModals();
    const modal = document.getElementById('deleteEnrollmentModal');
    const userInput = document.getElementById('deleteEnrollmentUser');
    const courseInput = document.getElementById('deleteEnrollmentCourse');
    const confirmBtn = document.getElementById('deleteEnrollmentConfirmBtn');
    const cancelBtn = document.getElementById('deleteEnrollmentCancelBtn');

    if (!modal || !userInput || !courseInput || !confirmBtn || !cancelBtn) {
        console.error('Delete Enrollment Modal: One or more DOM elements not found.');
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

    const confirmBtnClone = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(confirmBtnClone, confirmBtn);
    const cancelBtnClone = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(cancelBtnClone, cancelBtn);
    const newConfirmBtn = document.getElementById('deleteEnrollmentConfirmBtn');
    const newCancelBtn = document.getElementById('deleteEnrollmentCancelBtn');

    newConfirmBtn.addEventListener('click', async () => {
        newConfirmBtn.disabled = true;
        newConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        try {
            await BrightspaceFetch(`/d2l/api/lp/1.46/enrollments/users/${normalizedUser.UserId}/orgUnits/${courseId}`, 'DELETE');
            hideAllModals();
            const confirmationMessage = document.getElementById('deleteEnrollmentConfirmationMessage');
            if (confirmationMessage) {
                confirmationMessage.innerHTML = `<strong>User:</strong> ${normalizedUser.FirstName} ${normalizedUser.LastName} (${normalizedUser.UserId})<br><strong>Course:</strong> ${normalizedCourse.Name} (${normalizedCourse.Code || ''})<br><strong>Action:</strong> Enrollment deleted successfully`;
            }
            const courseLink = document.getElementById('deletedCourseLink');
            if (courseLink) courseLink.href = (window.location.origin || 'https://your-brightspace.example.edu') + '/d2l/home/' + courseId;
            showConfirmation('deleteEnrollmentConfirmation');
            const closeBtn = document.getElementById('closeDeleteConfirmation');
            if (closeBtn) closeBtn.onclick = () => { document.getElementById('deleteEnrollmentConfirmation').style.display = 'none'; };
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error deleting enrollment:', error);
            alert(`Failed to delete enrollment: ${error.message}`);
        } finally {
            newConfirmBtn.disabled = false;
            newConfirmBtn.innerHTML = '<i class="fas fa-check"></i> Confirm';
        }
    });
    newCancelBtn.addEventListener('click', () => hideAllModals());
    modal.style.display = 'flex';
}
