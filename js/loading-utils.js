/**
 * Loading Utilities
 * Provides consistent loading indicators across all reports
 */

const LoadingUtils = {
    // Track cancellation state
    _cancelled: {},
    _cancelCallbacks: {},

    /**
     * Create a loading bar container (inline progress bar)
     * @param {string} containerId - ID for the container element
     * @returns {HTMLElement} The loading container element
     */
    createLoadingBar(containerId = 'loadingContainer') {
        const existing = document.getElementById(containerId);
        if (existing) return existing;

        const container = document.createElement('div');
        container.id = containerId;
        container.className = 'loading-container';
        container.innerHTML = `
            <div class="loading-bar-row">
                <div class="loading-bar">
                    <div class="loading-bar-fill"></div>
                </div>
                <span class="loading-percent">0%</span>
            </div>
            <div class="loading-status"></div>
        `;

        return container;
    },

    /**
     * Show the loading bar
     * @param {string} containerId - ID of the loading container
     */
    showLoadingBar(containerId = 'loadingContainer') {
        const container = document.getElementById(containerId);
        if (container) {
            container.style.display = 'block';
        }
    },

    /**
     * Hide the loading bar
     * @param {string} containerId - ID of the loading container
     */
    hideLoadingBar(containerId = 'loadingContainer') {
        const container = document.getElementById(containerId);
        if (container) {
            container.style.display = 'none';
        }
    },

    /**
     * Update loading bar progress
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} status - Status message
     * @param {string} containerId - ID of the loading container
     */
    updateLoadingBar(percent, status = '', containerId = 'loadingContainer') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const fill = container.querySelector('.loading-bar-fill');
        const percentEl = container.querySelector('.loading-percent');
        const statusEl = container.querySelector('.loading-status');

        if (fill) {
            fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
        }
        if (percentEl) {
            percentEl.textContent = Math.round(percent) + '%';
        }
        if (statusEl && status) {
            statusEl.textContent = status;
        }

        if (percent > 0 && percent < 100) {
            this.showLoadingBar(containerId);
        } else if (percent >= 100) {
            setTimeout(() => {
                this.hideLoadingBar(containerId);
                if (fill) fill.style.width = '0%';
                if (percentEl) percentEl.textContent = '0%';
            }, 1000);
        }
    },

    /**
     * Create a loading modal (full-screen overlay)
     * @param {string} modalId - ID for the modal element
     * @returns {HTMLElement} The modal element
     */
    createLoadingModal(modalId = 'loadingModal') {
        // Check if modal already exists
        let modal = document.getElementById(modalId);
        if (modal) {
            // Ensure cancel button is visible if modal exists
            const cancelBtn = modal.querySelector('.loading-modal-cancel');
            if (cancelBtn) {
                cancelBtn.style.display = 'block';
            }
            return modal;
        }

        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'loading-modal';

        modal.innerHTML = `
            <div class="loading-modal-content">
                <h3>Processing</h3>
                <div class="loading-modal-progress">
                    <div class="loading-modal-fill"></div>
                </div>
                <p class="loading-modal-status">Initializing...</p>
                <button type="button" class="btn btn-outline loading-modal-cancel">Cancel</button>
            </div>
        `;

        // Add cancel button event listener
        const cancelBtn = modal.querySelector('.loading-modal-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.cancel(modalId);
            });
        }

        document.body.appendChild(modal);
        return modal;
    },

    /**
     * Show the loading modal
     * @param {string} message - Initial message
     * @param {string} modalId - ID of the modal
     * @param {Function} onCancel - Optional callback when cancel is clicked
     */
    showLoadingModal(message = 'Initializing...', modalId = 'loadingModal', onCancel = null) {
        const modal = this.createLoadingModal(modalId);
        const statusEl = modal.querySelector('.loading-modal-status');
        const cancelBtn = modal.querySelector('.loading-modal-cancel');
        const fill = modal.querySelector('.loading-modal-fill');
        
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.style.color = 'var(--text-secondary)'; // Reset color
        }
        
        // Ensure cancel button is visible
        if (cancelBtn) {
            cancelBtn.style.display = 'block';
        }
        
        // Reset progress bar
        if (fill) {
            fill.style.width = '0%';
            fill.style.transition = 'width 0.3s ease';
        }
        
        // Reset cancellation state
        this._cancelled[modalId] = false;
        if (onCancel) {
            this._cancelCallbacks[modalId] = onCancel;
        }
        
        modal.style.display = 'flex';
    },

    /**
     * Hide the loading modal
     * @param {string} modalId - ID of the modal
     */
    hideLoadingModal(modalId = 'loadingModal') {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
        // Clean up cancellation state
        delete this._cancelled[modalId];
        delete this._cancelCallbacks[modalId];
    },

    /**
     * Cancel the current operation
     * @param {string} modalId - ID of the modal
     */
    cancel(modalId = 'loadingModal') {
        this._cancelled[modalId] = true;
        
        // Call the cancel callback if provided
        if (this._cancelCallbacks[modalId]) {
            this._cancelCallbacks[modalId]();
        }
        
        // Update modal to show cancellation
        const modal = document.getElementById(modalId);
        if (modal) {
            const statusEl = modal.querySelector('.loading-modal-status');
            const fill = modal.querySelector('.loading-modal-fill');
            
            if (statusEl) {
                statusEl.textContent = 'Cancelled';
                statusEl.style.color = '#d73a49';
            }
            
            // Stop progress bar animation
            if (fill) {
                fill.style.transition = 'none';
            }
            
            // Hide cancel button
            const cancelBtn = modal.querySelector('.loading-modal-cancel');
            if (cancelBtn) {
                cancelBtn.style.display = 'none';
            }
            
            // Auto-close modal after a short delay
            setTimeout(() => {
                this.hideLoadingModal(modalId);
            }, 1500);
        }
    },

    /**
     * Check if operation was cancelled
     * @param {string} modalId - ID of the modal
     * @returns {boolean} True if cancelled
     */
    isCancelled(modalId = 'loadingModal') {
        return this._cancelled[modalId] === true;
    },

    /**
     * Update loading modal progress
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} message - Status message
     * @param {string} modalId - ID of the modal
     */
    updateLoadingModal(percent, message = '', modalId = 'loadingModal') {
        // Don't update if cancelled - check if modal still exists first
        if (this.isCancelled(modalId)) {
            const modal = document.getElementById(modalId);
            if (modal) {
                const statusEl = modal.querySelector('.loading-modal-status');
                // Only update if not already showing cancelled state
                if (statusEl && statusEl.textContent !== 'Cancelled' && statusEl.textContent !== 'Cancelling...') {
                    statusEl.textContent = 'Cancelling...';
                    statusEl.style.color = '#d73a49';
                }
            }
            return;
        }
        
        const modal = this.createLoadingModal(modalId);
        if (!modal) return;
        
        const fill = modal.querySelector('.loading-modal-fill');
        const statusEl = modal.querySelector('.loading-modal-status');

        if (fill) {
            fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
        }
        if (statusEl && message) {
            statusEl.textContent = message;
            statusEl.style.color = 'var(--text-secondary)'; // Reset color in case it was red
        }
    },

    /**
     * Create a simple spinner element
     * @param {string} size - Size: 'sm', 'md', 'lg'
     * @returns {HTMLElement} Spinner element
     */
    createSpinner(size = 'md') {
        const sizes = {
            sm: '16px',
            md: '24px',
            lg: '32px'
        };
        const spinnerSize = sizes[size] || sizes.md;

        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        spinner.style.width = spinnerSize;
        spinner.style.height = spinnerSize;
        return spinner;
    }
};
