/**
 * Deleted Users Report
 * Identifies users with "DELETED-" prefix in username or matching pattern
 * Allows individual and bulk deletion via API calls
 */

// BrightspaceFetch function for API calls
async function BrightspaceFetch(endpoint, method = "GET", body = null) {
    const token = localStorage.getItem("XSRF.Token");
    
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    };
    
    if (token) {
        headers["X-CSRF-Token"] = token;
    }

    const options = { 
        method, 
        headers,
        credentials: "include"
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(endpoint, options);
        
        // Check for XSRF token in response headers
        const newToken = response.headers.get('x-csrf-token');
        if (newToken && newToken !== token) {
            localStorage.setItem("XSRF.Token", newToken);
        }

        // Read response body first (can only be read once)
        const text = await response.text();
        
        if (!response.ok) {
            // For DELETE requests, 404 means user already deleted (treat as success)
            if (method === 'DELETE' && response.status === 404) {
                console.log(`User already deleted (404): ${endpoint}`);
                return { success: true, alreadyDeleted: true };
            }
            
            // Try to get error details from response body
            let errorDetails = '';
            if (text) {
                try {
                    const errorJson = JSON.parse(text);
                    errorDetails = ` - ${JSON.stringify(errorJson, null, 2)}`;
                } catch {
                    errorDetails = ` - ${text.substring(0, 500)}`;
                }
            }
            const errorMsg = `API Error: ${response.status} - ${response.statusText}${errorDetails}`;
            console.error('API Error Response:', errorMsg);
            throw new Error(errorMsg);
        }

        // Check if response is empty
        if (!text || text.trim() === '') {
            // For DELETE requests, empty response is success
            if (method === 'DELETE') {
                return { success: true };
            }
            return [];
        }

        // Try to parse as JSON
        try {
            return JSON.parse(text);
        } catch (jsonError) {
            return text;
        }
    } catch (error) {
        console.error("Error fetching API:", error.message);
        throw error;
    }
}

let deletedUsersTable = null;
let currentDeletedUsers = [];

// Load user data from Data Hub (same method as user-list.js and search-user.js)
async function getUsersBDSData() {
    try {
        console.log('Loading user data from Data Hub...');
        
        // Load JSZip if needed
        if (!window.JSZip) {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        
        // Use the same endpoint as user-list.js (version 1.43 with type=full)
        const fullDataResponse = await fetch('/d2l/api/lp/1.43/datasets/bds/b21a6414-38f8-4da8-9a65-8b5586f9fe3b/plugins/1d6d722e-b572-456f-97c1-d526570daa6b/extracts?type=full', { 
            method: 'GET',
            credentials: 'include'
        });
        
        if (!fullDataResponse.ok) {
            throw new Error(`Failed to fetch dataset extracts: ${fullDataResponse.status} ${fullDataResponse.statusText}`);
        }
        
        const fullDataJson = await fullDataResponse.json();
        console.log('Full dataset response:', fullDataJson);
        
        if (!fullDataJson.Objects || fullDataJson.Objects.length === 0) {
            throw new Error('No full dataset extracts found');
        }
        
        // Sort by CreatedDate (newest first)
        const sortedExtracts = fullDataJson.Objects.sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate));
        const latestExtract = sortedExtracts[0];
        
        const downloadUrl = latestExtract?.DownloadLink;
        if (!downloadUrl) throw new Error('No download URL found for the full extract');
        
        console.log(`Downloading ZIP from: ${downloadUrl}`);
        const zipResponse = await fetch(downloadUrl, { method: 'GET', credentials: 'include' });
        if (!zipResponse.ok) throw new Error(`Failed to download full dataset ZIP: ${zipResponse.status} ${zipResponse.statusText}`);
        
        const zipBlob = await zipResponse.blob();
        const zip = await window.JSZip.loadAsync(zipBlob);
        console.log('ZIP file loaded, contents:', Object.keys(zip.files));
        
        const csvFile = Object.values(zip.files).find(file => file.name.endsWith('.csv'));
        if (!csvFile) throw new Error('No CSV file found in the dataset ZIP');
        
        const csvContent = await csvFile.async('string');
        
        if (!csvContent || csvContent.trim().length === 0) {
            throw new Error('CSV file is empty');
        }
        
        // Parse CSV using PapaParse (more robust than manual parsing)
        const parsed = Papa.parse(csvContent, { 
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim()
        });
        
        if (parsed.errors && parsed.errors.length > 0) {
            console.warn('CSV parsing errors:', parsed.errors);
        }
        
        console.log(`Parsed ${parsed.data.length} users from Data Hub`);
        
        if (parsed.data.length === 0) {
            console.warn('Warning: DataHub returned 0 users. CSV might be empty or malformed.');
            console.log('CSV sample (first 500 chars):', csvContent.substring(0, 500));
        } else {
            console.log('Sample user from DataHub:', parsed.data[0]);
        }
        
        return parsed.data;
    } catch (error) {
        console.error('Error loading users from Data Hub:', error);
        throw error;
    }
}

// Alternative: Fetch users via API pagination (fallback if DataHub fails)
async function fetchUsersViaAPI() {
    try {
        console.log('Attempting to fetch users via API pagination...');
        let allUsers = [];
        
        // Try using D2LApi's fetchPaginatedData method first (if available)
        try {
            console.log('Trying fetchPaginatedData method...');
            // Get organization info to find root org unit
            const orgInfo = await D2LApi.getOrganizationInfo();
            const rootOrgUnitId = orgInfo.Identifier;
            
            // Try enrollments endpoint first (more reliable)
            const enrollmentsUrl = `/d2l/api/lp/1.47/enrollments/orgUnits/${rootOrgUnitId}/users/`;
            allUsers = await D2LApi.fetchPaginatedData(enrollmentsUrl, 100);
            console.log(`Fetched ${allUsers.length} users via enrollments endpoint`);
        } catch (enrollError) {
            console.warn('Enrollments endpoint failed, trying users endpoint:', enrollError);
            // Fallback: Try direct users endpoint with pagination
            try {
                const usersUrl = `/d2l/api/lp/1.49/users/`;
                allUsers = await D2LApi.fetchPaginatedData(usersUrl, 100);
                console.log(`Fetched ${allUsers.length} users via users endpoint`);
            } catch (usersError) {
                console.error('Both API endpoints failed:', usersError);
                throw new Error(`API pagination failed: ${usersError.message}`);
            }
        }
        
        if (allUsers.length === 0) {
            throw new Error('No users returned from API');
        }
        
        console.log(`Total users fetched via API: ${allUsers.length}`);
        return allUsers;
    } catch (error) {
        console.error('Error fetching users via API:', error);
        throw error;
    }
}

// Search users by username pattern
async function searchUsersByPattern(pattern) {
    try {
        let allUsers = [];
        
        // Try DataHub first (preferred method)
        try {
            console.log('Attempting to load users from Data Hub...');
            allUsers = await getUsersBDSData();
            console.log(`Loaded ${allUsers.length} users from Data Hub`);
            
            // If DataHub returns 0 users, try API as fallback
            if (allUsers.length === 0) {
                console.warn('DataHub returned 0 users, trying API pagination as fallback...');
                allUsers = await fetchUsersViaAPI();
                console.log(`Loaded ${allUsers.length} users via API fallback`);
            }
        } catch (dataHubError) {
            console.warn('DataHub failed, trying API pagination:', dataHubError);
            // Fallback to API pagination
            try {
                allUsers = await fetchUsersViaAPI();
                console.log(`Loaded ${allUsers.length} users via API`);
            } catch (apiError) {
                console.error('Both DataHub and API failed:', apiError);
                throw new Error(`Failed to load users. DataHub error: ${dataHubError.message}. API error: ${apiError.message}`);
            }
        }
        
        if (allUsers.length === 0) {
            const errorMsg = 'No users loaded from any source. Please check:\n' +
                           '1. DataHub extracts are available and not empty\n' +
                           '2. API credentials are valid\n' +
                           '3. Network connectivity is working';
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
        
        // Filter users matching the pattern
        const patternUpper = pattern.toUpperCase().trim();
        
        // Debug: Check what username fields exist in the data
        if (allUsers.length > 0) {
            const sampleUser = allUsers[0];
            console.log('Sample user fields:', Object.keys(sampleUser));
            console.log('Sample user username values:', {
                Username: sampleUser.Username,
                UserName: sampleUser.UserName,
                userName: sampleUser.userName,
                UniqueName: sampleUser.UniqueName
            });
        }
        
        const matchingUsers = allUsers.filter((row, index) => {
            // Check multiple possible field names for username (DataHub uses UserName with capital N)
            const username = (row.UserName || row.Username || row.userName || row.UniqueName || '').toString();
            if (!username || username === 'NULL' || username === '' || username === 'undefined') return false;
            
            const usernameUpper = username.toUpperCase();
            
            // If pattern is "DELETED-" or empty, match usernames starting with "DELETED-"
            if (patternUpper === 'DELETED-' || patternUpper === 'DELETED' || !patternUpper) {
                const matches = usernameUpper.startsWith('DELETED-');
                if (matches && index < 5) {
                    console.log('Sample match found:', { 
                        username, 
                        usernameUpper,
                        UserId: row.UserId,
                        fieldUsed: row.UserName ? 'UserName' : row.Username ? 'Username' : row.userName ? 'userName' : 'UniqueName'
                    });
                }
                return matches;
            }
            // Otherwise, check if username contains the pattern
            return usernameUpper.includes(patternUpper);
        });

        console.log(`Found ${matchingUsers.length} users matching pattern "${pattern}"`);
        if (matchingUsers.length > 0) {
            console.log('Sample matching users:', matchingUsers.slice(0, 5).map(u => ({
                UserId: u.UserId,
                UserName: u.UserName,
                Username: u.Username,
                userName: u.userName,
                FirstName: u.FirstName,
                LastName: u.LastName
            })));
        } else {
            // Debug: Check users with DELETED in username to see what's happening
            const deletedLikeUsers = allUsers.filter(u => {
                const un = (u.UserName || u.Username || u.userName || '').toString().toUpperCase();
                return un.includes('DELETED');
            }).slice(0, 10);
            
            console.log('Debug: Found', deletedLikeUsers.length, 'users with "DELETED" in username (first 10):');
            deletedLikeUsers.forEach(u => {
                console.log('  -', {
                    UserId: u.UserId,
                    UserName: u.UserName,
                    Username: u.Username,
                    userName: u.userName,
                    'UserName upper': (u.UserName || '').toString().toUpperCase()
                });
            });
        }
        return matchingUsers;
    } catch (error) {
        console.error('Error searching users:', error);
        throw error;
    }
}

async function processDeletedUsers() {
    const summaryEl = document.querySelector('#summary');
    const fetchBtn = document.getElementById('fetchBtn');
    const downloadBtn = document.getElementById('downloadCsv');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    const usernamePattern = document.getElementById('usernamePattern').value.trim();
    
    // Disable button and show loading modal
    fetchBtn.disabled = true;
    downloadBtn.style.display = 'none';
    bulkDeleteBtn.style.display = 'none';
    
    // Destroy existing table if it exists
    if (deletedUsersTable) {
        deletedUsersTable.destroy();
        deletedUsersTable = null;
    }
    
    LoadingUtils.showLoadingModal('Initializing report...', 'loadingModal', () => {
        // Cancel callback
    });
    LoadingUtils.updateLoadingModal(10, 'Processing BDS extract...', 'loadingModal');
    
    summaryEl.textContent = 'Processing BDS extract...';
    
    try {
        const pattern = usernamePattern || 'DELETED-';
        LoadingUtils.updateLoadingModal(30, `Searching for users matching pattern "${pattern}"...`, 'loadingModal');
        
        const matchingUsers = await searchUsersByPattern(pattern);

        LoadingUtils.updateLoadingModal(60, 'Processing user data...', 'loadingModal');
        
        // Map to our format (handle different data structures from DataHub vs API)
        const deletedUsers = matchingUsers.map(row => {
            // DataHub uses OrgRoleId, API might use RoleId or different structure
            const roleId = row.OrgRoleId || row.RoleId || row.Role?.Identifier || '';
            const roleName = roleId === '101' ? 'Student' : 
                            roleId === '102' ? 'Instructor' : 
                            roleId === '100' ? 'Admin' : 
                            `Role ${roleId || 'Unknown'}`;
            
            // Handle username field (DataHub uses UserName with capital N)
            const username = row.Username || row.UserName || row.userName || row.UniqueName || '';
            
            return {
                UserId: row.UserId || row.Identifier || '',
                OrgDefinedId: row.OrgDefinedId || row.OrgDefinedId || '',
                FirstName: row.FirstName || row.FirstName || '',
                LastName: row.LastName || row.LastName || '',
                Username: username,
                Email: row.ExternalEmail || row.EmailAddress || row.Email || '',
                Role: roleName,
                RoleId: roleId
            };
        }).filter(u => u.UserId && u.UserId !== '0'); // Filter out any entries without UserId or system user

        LoadingUtils.updateLoadingModal(80, 'Populating table...', 'loadingModal');
        
        const patternDisplay = pattern || 'DELETED-*';
        summaryEl.textContent = `🔍 Found ${deletedUsers.length} users matching pattern "${patternDisplay}"`;

        // Escape HTML to prevent XSS
        const escapeHtml = (text) => {
            if (text == null) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };

        // Initialize or refresh DataTable
        deletedUsersTable = $('#deletedUsersTable').DataTable({
            data: deletedUsers,
            columns: [
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    render: function(data, type, row) {
                        return `<input type="checkbox" class="user-checkbox" data-user-id="${row.UserId}">`;
                    }
                },
                { data: 'UserId' },
                { data: 'OrgDefinedId' },
                { data: 'FirstName' },
                { data: 'LastName' },
                { data: 'Username' },
                { data: 'Email' },
                { data: 'Role' },
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    render: function(data, type, row) {
                        // Escape for JavaScript string (handle quotes and special chars)
                        const jsEscapedUsername = String(row.Username || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
                        return `<button class="delete-btn btn-sm" onclick="deleteSingleUser(${row.UserId}, '${jsEscapedUsername}')" title="Delete this user">
                            <i class="fas fa-trash"></i> Delete
                        </button>`;
                    }
                }
            ],
            pageLength: 25,
            lengthMenu: [[10, 25, 50, 100, 200, -1], [10, 25, 50, 100, 200, "All"]],
            order: [[1, 'asc']],
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
            responsive: true,
            scrollX: true
        });

        // Set up checkbox handlers after table is drawn
        deletedUsersTable.on('draw', function() {
            setupCheckboxHandlers();
        });
        setupCheckboxHandlers();

        currentDeletedUsers = deletedUsers;
        downloadBtn.style.display = 'inline-flex';
        if (deletedUsers.length > 0) {
            bulkDeleteBtn.style.display = 'inline-flex';
        }
        
        LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
        setTimeout(() => {
            LoadingUtils.hideLoadingModal('loadingModal');
        }, 1000);
    } catch (error) {
        console.error('Error processing deleted users:', error);
        summaryEl.textContent = 'Error: ' + (error.message || 'Failed to process users');
        LoadingUtils.hideLoadingModal('loadingModal');
    } finally {
        fetchBtn.disabled = false;
    }
}

function setupCheckboxHandlers() {
    // Select all checkbox
    const selectAllCheckbox = document.getElementById('selectAll');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('.user-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = this.checked;
            });
        });
    }

    // Individual checkboxes
    document.querySelectorAll('.user-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            // Update select all checkbox state
            const allChecked = Array.from(document.querySelectorAll('.user-checkbox'))
                .every(cb => cb.checked);
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = allChecked;
            }
        });
    });
}

// Delete a single user (must be global for onclick handlers)
window.deleteSingleUser = async function(userId, username) {
    if (!confirm(`⚠️ WARNING: Are you sure you want to DELETE user "${username}" (ID: ${userId})?\n\nThis action cannot be undone!`)) {
        return;
    }
    
    if (!confirm(`This will permanently delete the user account. Are you absolutely certain?`)) {
        return;
    }
    
    // Show loading
    LoadingUtils.showLoadingModal(`Deleting user "${username}"...`, 'deleteModal', () => {});
    
    try {
        const response = await BrightspaceFetch(`/d2l/api/lp/1.31/users/${userId}`, 'DELETE');
        
        LoadingUtils.hideLoadingModal('deleteModal');
        
        // Check if user was already deleted
        if (response && response.alreadyDeleted) {
            alert(`User "${username}" was already deleted (not found in system).`);
        } else {
            alert(`User "${username}" has been deleted successfully.`);
        }
        
        // Remove from table
        deletedUsersTable.rows().every(function() {
            const data = this.data();
            if (data.UserId == userId) {
                this.remove();
                return false;
            }
        });
        deletedUsersTable.draw();
        
        // Update currentDeletedUsers array
        currentDeletedUsers = currentDeletedUsers.filter(u => u.UserId != userId);
        
        // Update summary
        const summaryEl = document.querySelector('#summary');
        summaryEl.textContent = `🔍 Found ${currentDeletedUsers.length} users matching pattern`;
        
        // Hide bulk delete button if no users left
        if (currentDeletedUsers.length === 0) {
            document.getElementById('bulkDeleteBtn').style.display = 'none';
        }
    } catch (error) {
        LoadingUtils.hideLoadingModal('deleteModal');
        // Check if it's a 404 (already deleted)
        if (error.message && error.message.includes('404')) {
            alert(`User "${username}" was already deleted (not found in system).`);
            // Still remove from table since it's already deleted
            deletedUsersTable.rows().every(function() {
                const data = this.data();
                if (data.UserId == userId) {
                    this.remove();
                    return false;
                }
            });
            deletedUsersTable.draw();
            currentDeletedUsers = currentDeletedUsers.filter(u => u.UserId != userId);
        } else {
            alert(`Error deleting user: ${error.message}`);
            console.error('Delete error:', error);
        }
    }
};

// Delete selected users (bulk)
async function deleteSelectedUsers() {
    const selectedCheckboxes = Array.from(document.querySelectorAll('.user-checkbox:checked'))
        .filter(cb => cb.id !== 'selectAll');
    
    if (selectedCheckboxes.length === 0) {
        alert('Please select at least one user to delete.');
        return;
    }
    
    const selectedUserIds = selectedCheckboxes.map(cb => cb.getAttribute('data-user-id'));
    const selectedUsers = currentDeletedUsers.filter(u => selectedUserIds.includes(String(u.UserId)));
    
    const userList = selectedUsers.map(u => `  - ${u.Username} (ID: ${u.UserId})`).join('\n');
    
    if (!confirm(`⚠️ WARNING: Are you sure you want to DELETE ${selectedUsers.length} user(s)?\n\nUsers to be deleted:\n${userList}\n\nThis action cannot be undone!`)) {
        return;
    }
    
    if (!confirm(`This will permanently delete ${selectedUsers.length} user account(s). Are you absolutely certain?`)) {
        return;
    }
    
    // Show loading
    LoadingUtils.showLoadingModal(`Deleting ${selectedUsers.length} user(s)...`, 'bulkDeleteModal', () => {});
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    
    for (let i = 0; i < selectedUsers.length; i++) {
        const user = selectedUsers[i];
        LoadingUtils.updateLoadingModal(
            Math.round((i / selectedUsers.length) * 100),
            `Deleting ${i + 1} of ${selectedUsers.length}: ${user.Username}...`,
            'bulkDeleteModal'
        );
        
        try {
            const response = await BrightspaceFetch(`/d2l/api/lp/1.31/users/${user.UserId}`, 'DELETE');
            
            // Success (including 404 which means already deleted)
            successCount++;
            
            // Remove from table
            deletedUsersTable.rows().every(function() {
                const data = this.data();
                if (data.UserId == user.UserId) {
                    this.remove();
                    return false;
                }
            });
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
            // Check if it's a 404 (already deleted) - treat as success
            if (error.message && error.message.includes('404')) {
                successCount++;
                // Remove from table since it's already deleted
                deletedUsersTable.rows().every(function() {
                    const data = this.data();
                    if (data.UserId == user.UserId) {
                        this.remove();
                        return false;
                    }
                });
            } else {
                failCount++;
                errors.push(`${user.Username} (ID: ${user.UserId}): ${error.message}`);
                console.error(`Error deleting user ${user.UserId}:`, error);
            }
        }
    }
    
    // Redraw table to reflect deletions
    deletedUsersTable.draw();
    
    LoadingUtils.hideLoadingModal('bulkDeleteModal');
    
    // Update currentDeletedUsers array
    currentDeletedUsers = currentDeletedUsers.filter(u => !selectedUserIds.includes(String(u.UserId)));
    
    // Update summary
    const summaryEl = document.querySelector('#summary');
    summaryEl.textContent = `🔍 Found ${currentDeletedUsers.length} users matching pattern`;
    
    // Hide bulk delete button if no users left
    if (currentDeletedUsers.length === 0) {
        document.getElementById('bulkDeleteBtn').style.display = 'none';
    }
    
    // Reset select all checkbox
    const selectAllCheckbox = document.getElementById('selectAll');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
    }
    
    // Show results
    let message = `Bulk deletion complete!\n\nSuccessfully processed: ${successCount} user(s)`;
    if (failCount > 0) {
        message += `\nFailed: ${failCount} user(s)\n\nErrors:\n${errors.join('\n')}`;
    } else {
        message += `\n(Some users may have already been deleted, which is normal)`;
    }
    alert(message);
}

function downloadCSV() {
    if (!currentDeletedUsers || currentDeletedUsers.length === 0) {
        alert('No data to download.');
        return;
    }
    
    const rows = currentDeletedUsers.map(u => ({
        UserId: u.UserId,
        OrgDefinedId: u.OrgDefinedId,
        FirstName: u.FirstName,
        LastName: u.LastName,
        Username: u.Username,
        Email: u.Email,
        Role: u.Role
    }));
    
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deleted-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Set up event listeners
    document.getElementById('fetchBtn').addEventListener('click', processDeletedUsers);
    document.getElementById('downloadCsv').addEventListener('click', downloadCSV);
    document.getElementById('bulkDeleteBtn').addEventListener('click', deleteSelectedUsers);
    
    // Allow Enter key to trigger search
    document.getElementById('usernamePattern').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            processDeletedUsers();
        }
    });
});
