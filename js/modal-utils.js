// modal-utils.js

/**
 * Hide all modals and confirmation boxes
 */
export function hideAllModals() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => { modal.style.display = 'none'; });
    [document.getElementById('roleChangeConfirmation'), document.getElementById('deleteEnrollmentConfirmation')]
        .forEach(box => { if (box) box.style.display = 'none'; });
}

/**
 * Show a specific modal by ID
 */
export function showModal(modalId) {
    hideAllModals();
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        modal.style.zIndex = '2001';
    }
}

/**
 * Show a specific confirmation box by ID
 */
export function showConfirmation(boxId) {
    hideAllModals();
    const box = document.getElementById(boxId);
    if (box) {
        box.style.display = 'block';
        box.style.zIndex = '2002';
    }
}
