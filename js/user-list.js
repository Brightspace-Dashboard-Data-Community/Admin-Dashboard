/**
 * user-list.js
 * Handles user list functionality with role filtering, pagination, and search
 * Based on old-Admin-Dashboard/js/user-list-all.js
 */

// Import the BrightspaceFetch function
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

// Global state
let allUsers = [];
let filteredUsers = [];
let currentPage = 1;
let rowsPerPage = 20;
let currentSortColumn = 0;
let currentSortDirection = 'asc';
let availableRoles = {};
let rolesCache = {}; // Cache for role names from API

// Fetch all roles from the D2L API
async function fetchAllRoles() {
    // Return cached roles if available
    if (Object.keys(rolesCache).length > 0) {
        return rolesCache;
    }
    
    try {
        console.log('Fetching all roles from API...');
        updateStatus('Loading role names from system...');
        
        // Fetch all roles from the system
        const rolesData = await BrightspaceFetch('/d2l/api/lp/1.47/roles/', 'GET');
        console.log('Roles API data:', rolesData);
        
        // Process the API response
        let processedRoles = [];
        
        // Check if the response is an array
        if (Array.isArray(rolesData)) {
            processedRoles = rolesData.map(role => ({
                Id: String(role.Identifier || role.Id || role.id || 'Unknown'),
                Name: role.DisplayName || role.Name || 'Unknown',
                Description: role.Description || role.Code || 'No description available'
            }));
        } else if (rolesData && rolesData.Items && Array.isArray(rolesData.Items)) {
            // Alternative format with Items property
            processedRoles = rolesData.Items.map(role => ({
                Id: String(role.Identifier || role.Id || role.id || 'Unknown'),
                Name: role.DisplayName || role.Name || 'Unknown',
                Description: role.Description || role.Code || 'No description available'
            }));
        } else if (rolesData && typeof rolesData === 'object') {
            // Object format
            processedRoles = Object.entries(rolesData)
                .filter(([_, value]) => value && typeof value === 'object')
                .map(([key, role]) => ({
                    Id: String(role.Identifier || role.Id || role.id || key),
                    Name: role.DisplayName || role.Name || 'Unknown',
                    Description: role.Description || role.Code || 'No description available'
                }));
        }
        
        // Build cache object with role ID as key
        processedRoles.forEach(role => {
            if (role.Id && role.Id !== 'Unknown') {
                rolesCache[role.Id] = role.Name;
            }
        });
        
        console.log(`Loaded ${Object.keys(rolesCache).length} role names from API`);
        console.log('Roles cache:', rolesCache);
        
        return rolesCache;
    } catch (error) {
        console.error('Error fetching roles from API:', error);
        // Return empty cache on error, will fall back to hardcoded names
        return {};
    }
}

// Helper function to get role name based on ID
function getRoleName(roleId) {
    const roleIdStr = String(roleId);
    
    // First check API cache
    if (rolesCache[roleIdStr]) {
        return rolesCache[roleIdStr];
    }
    
    // Fallback to hardcoded common roles
    const roleNames = {
        '100': 'Administrator',
        '101': 'Student',
        '102': 'Instructor',
        '112': 'Student Viewer',
        '103': 'Associate',
        '104': 'Auditor',
        '105': 'Assistant',
        '106': 'Teaching Assistant',
        '107': 'Sponsor',
        '108': 'Department Admin',
        '109': 'Site Admin',
        '110': 'External Admin',
        '111': 'Observer',
        '113': 'Guest',
    };
    
    return roleNames[roleIdStr] || `Role ${roleId}`;
}

// Format date for display
function formatDate(dateString) {
    try {
        if (!dateString) return 'Never';
        
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return 'Invalid date';
        }
        
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays < 1) {
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            if (diffHours < 1) {
                const diffMinutes = Math.floor(diffMs / (1000 * 60));
                return diffMinutes < 1 ? 'Just now' : `${diffMinutes} minutes ago`;
            }
            return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
        }
        
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (error) {
        console.error('Error formatting date:', error);
        return 'Invalid date';
    }
}

// Load JSZip library
function loadJSZip() {
    return new Promise((resolve, reject) => {
        if (window.JSZip) {
            resolve(window.JSZip);
            return;
        }
        
        console.log('Loading JSZip library...');
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => {
            console.log('JSZip loaded successfully');
            resolve(window.JSZip);
        };
        script.onerror = () => {
            console.error('Failed to load JSZip');
            reject(new Error('JSZip script load failed'));
        };
        document.head.appendChild(script);
    });
}

// Parse CSV content into user records
function parseUserData(csvContent, datasetType = 'unknown') {
    try {
        console.log(`Parsing ${datasetType} CSV data...`);
        
        if (!csvContent || typeof csvContent !== 'string') {
            throw new Error(`Invalid CSV content: ${typeof csvContent}`);
        }
        
        const lines = csvContent.split('\n');
        console.log(`Total lines in CSV (including header): ${lines.length}`);
        
        if (lines.length === 0) {
            throw new Error('CSV file is empty');
        }
        
        // Get headers
        const headers = lines[0].split(',').map(h => h.trim());
        console.log('CSV headers:', headers);
        
        // Required columns
        const requiredColumns = ['UserId', 'OrgRoleId'];
        const headersLower = headers.map(h => h.toLowerCase());
        const missingColumns = requiredColumns.filter(col => !headersLower.includes(col.toLowerCase()));
        
        if (missingColumns.length > 0) {
            throw new Error(`Missing required columns in CSV: ${missingColumns.join(', ')}`);
        }
        
        const users = [];
        
        // Skip the header line
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            try {
                // Handle CSV parsing with possible quoted fields
                const values = [];
                let currentValue = '';
                let isInsideQuotes = false;
                
                for (let char of line) {
                    if (char === '"') isInsideQuotes = !isInsideQuotes;
                    else if (char === ',' && !isInsideQuotes) {
                        values.push(currentValue.trim());
                        currentValue = '';
                    } else currentValue += char;
                }
                values.push(currentValue.trim());
                
                if (values.length !== headers.length) {
                    if (i < 5) {
                        console.warn(`Line ${i + 1} has mismatched columns. Expected ${headers.length}, got ${values.length}:`, line);
                    }
                    continue;
                }
                
                const user = {};
                headers.forEach((header, index) => {
                    user[header] = values[index].replace(/^"|"$/g, '');
                });
                users.push(user);
            } catch (lineError) {
                console.error(`Error parsing line ${i + 1}:`, lineError);
                // Continue with next line
            }
        }
        
        console.log(`Successfully parsed ${users.length} users from ${datasetType}`);
        if (users.length > 0) {
            console.log('Sample user:', users[0]);
        }
        return users;
    } catch (error) {
        console.error(`Error parsing ${datasetType} user data:`, error);
        throw error;
    }
}

// Load user data from Data Hub
async function loadUserData() {
    try {
        console.log('Loading user data from datasets...');
        updateStatus('Fetching full dataset extract list...');
        
        // Directly use fetch with credentials for API calls
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
        console.log('Sorted extracts:', sortedExtracts);
        const latestExtract = sortedExtracts[0];
        
        updateStatus('Downloading latest full dataset...');
        // Download and process the latest full dataset
        const downloadUrl = latestExtract?.DownloadLink;
        if (!downloadUrl) throw new Error('No download URL found for the full extract');
        
        console.log(`Downloading ZIP from: ${downloadUrl}`);
        const zipResponse = await fetch(downloadUrl, { method: 'GET', credentials: 'include' });
        if (!zipResponse.ok) throw new Error(`Failed to download full dataset ZIP: ${zipResponse.status} ${zipResponse.statusText}`);
        
        updateStatus('Processing downloaded dataset...');
        const zipBlob = await zipResponse.blob();
        
        // Make sure JSZip is loaded
        if (!window.JSZip) {
            updateStatus('Loading JSZip library...');
            await loadJSZip();
        }
        
        // Process the ZIP file
        const zip = await window.JSZip.loadAsync(zipBlob);
        console.log('ZIP file loaded, contents:', Object.keys(zip.files));
        
        const csvFile = Object.values(zip.files).find(file => file.name.endsWith('.csv'));
        if (!csvFile) throw new Error('No CSV file found in the dataset ZIP');
        
        updateStatus('Extracting and parsing CSV data...');
        const csvContent = await csvFile.async('string');
        
        // Parse the full dataset
        const fullDataUsers = parseUserData(csvContent, 'Full Dataset');
        console.log(`Parsed ${fullDataUsers.length} users from full dataset`);
        
        // Extract all unique roles from the dataset
        updateStatus('Analyzing user roles...');
        const roles = extractAvailableRoles(fullDataUsers);
        
        // Fetch role names from API and update role names,
        // and ensure we include ALL roles from the system.
        updateStatus('Fetching role names from API...');
        await fetchAllRoles();
        
        // Update role names in the roles object with API data
        Object.keys(roles).forEach(roleId => {
            const apiRoleName = rolesCache[roleId];
            if (apiRoleName) {
                roles[roleId].name = apiRoleName;
            }
        });

        // Add any roles that exist in the system but did not appear
        // in the dataset (so they would otherwise be missing).
        Object.keys(rolesCache).forEach(roleId => {
            if (!roles[roleId]) {
                roles[roleId] = {
                    count: 0,
                    name: rolesCache[roleId]
                };
            }
        });
        
        return { 
            users: fullDataUsers,
            roles: roles
        };
    } catch (error) {
        console.error('Error loading user data:', error);
        throw error;
    }
}

// Extract all unique role IDs from the dataset
function extractAvailableRoles(users) {
    const roles = {};
    
    if (!Array.isArray(users)) {
        console.error('Cannot extract roles: users is not an array', users);
        return roles;
    }
    
    console.log(`Extracting roles from ${users.length} users`);
    
    users.forEach(user => {
        const roleId = user.OrgRoleId;
        if (roleId) {
            if (!roles[roleId]) {
                roles[roleId] = {
                    count: 1,
                    name: getRoleName(roleId)
                };
            } else {
                roles[roleId].count++;
            }
        }
    });
    
    console.log('Available roles:', roles);
    return roles;
}

// Update status message
function updateStatus(message, type = 'info') {
    // Create status container if it doesn't exist
    let statusContainer = document.getElementById('status-container');
    if (!statusContainer) {
        const formContainer = document.querySelector('.form-container');
        if (formContainer) {
            statusContainer = document.createElement('div');
            statusContainer.id = 'status-container';
            statusContainer.className = 'card';
            statusContainer.style.marginBottom = 'var(--spacing-lg)';
            formContainer.insertBefore(statusContainer, formContainer.firstChild);
        } else {
            return;
        }
    }
    
    let icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
    if (type === 'success') icon = '<i class="fa-solid fa-check-circle"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-exclamation-circle"></i>';
    
    statusContainer.innerHTML = `<div class="card-body"><p>${icon} ${message}</p></div>`;
    
    if (type === 'error') {
        statusContainer.style.backgroundColor = '#ffebee';
        statusContainer.style.color = '#d32f2f';
    } else if (type === 'success') {
        statusContainer.style.backgroundColor = '#e8f5e9';
        statusContainer.style.color = '#2e7d32';
        
        // Hide success message after 3 seconds
        setTimeout(() => {
            statusContainer.style.display = 'none';
        }, 3000);
    }
}

// Populate the role dropdown
function populateRoleDropdown() {
    const roleSelect = document.querySelector('.controls-row select');
    if (!roleSelect) {
        console.error('Role select element not found');
        return;
    }
    
    // Clear existing options
    roleSelect.innerHTML = '<option value="">Select a role...</option>';
    
    // Check if we have roles to populate
    if (Object.keys(availableRoles).length === 0) {
        const option = document.createElement('option');
        option.value = "";
        option.textContent = "No roles found";
        roleSelect.appendChild(option);
        console.warn('No roles available to populate dropdown');
        return;
    }
    
    // Update role names with API data if available
    Object.keys(availableRoles).forEach(roleId => {
        const apiRoleName = rolesCache[roleId];
        if (apiRoleName && availableRoles[roleId].name === `Role ${roleId}`) {
            availableRoles[roleId].name = apiRoleName;
        }
    });
    
    // Sort roles by count (descending)
    const sortedRoles = Object.entries(availableRoles)
        .sort(([, a], [, b]) => b.count - a.count);
    
    console.log('Populating dropdown with sorted roles:', sortedRoles);
    
    // Add options for each role
    sortedRoles.forEach(([roleId, roleInfo]) => {
        const option = document.createElement('option');
        // Use the role name from API if available, otherwise use the name from getRoleName
        const displayName = roleInfo.name || getRoleName(roleId);
        option.value = roleId;
        option.textContent = `${displayName} (${roleId}) - ${roleInfo.count} users`;
        roleSelect.appendChild(option);
    });
    
    console.log('Role dropdown populated with', roleSelect.options.length, 'options');
}

// Fetch users by role
async function fetchUsersByRole() {
    try {
        const roleSelect = document.querySelector('.controls-row select');
        const selectedRoleId = roleSelect.value;
        
        if (!selectedRoleId) {
            alert('Please select a role');
            return;
        }
        
        console.log(`Fetching users with role ID: ${selectedRoleId}`);
        updateStatus(`Loading users with role ID: ${selectedRoleId}...`);
        
        // Get the role name for display
        const roleName = getRoleName(selectedRoleId);
        console.log(`Role name: ${roleName}`);
        
        // Show loading state
        const tableBody = document.querySelector('.data-table tbody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="table-message">
                        <i class="fa-solid fa-spinner fa-spin"></i> Loading users with role ${selectedRoleId}...
                    </td>
                </tr>
            `;
        }
        
        // Filter users by role
        filteredUsers = allUsers.filter(user => 
            String(user.OrgRoleId) === String(selectedRoleId)
        );
        
        console.log(`Found ${filteredUsers.length} users with role ID ${selectedRoleId}`);
        
        // Reset to first page
        currentPage = 1;
        
        // Apply default sort (User ID ascending)
        currentSortColumn = 0;
        currentSortDirection = 'asc';
        
        // Display users
        displayUsers();
        
        // Hide status indicator
        updateStatus(`Loaded ${filteredUsers.length} users with role ${roleName}`, 'success');
        
    } catch (error) {
        console.error(`Error fetching users by role:`, error);
        updateStatus(`Failed to load users: ${error.message}`, 'error');
    }
}

// Sort users by column
function sortUsers(columnIndex, direction) {
    console.log(`Sorting users by column ${columnIndex} in ${direction} order`);
    
    // Define the field to sort by based on column index
    const fields = ['UserId', 'FirstName', 'LastName', 'UserName', 'SignupDate', 'LastAccessed'];
    const field = fields[columnIndex];
    
    if (!field) {
        console.warn(`No field defined for column index ${columnIndex}`);
        return;
    }
    
    filteredUsers.sort((a, b) => {
        let valueA = a[field] || '';
        let valueB = b[field] || '';
        
        // Special handling for dates
        if (field === 'SignupDate' || field === 'LastAccessed') {
            valueA = valueA ? new Date(valueA).getTime() : 0;
            valueB = valueB ? new Date(valueB).getTime() : 0;
        }
        
        // Special handling for User IDs (numeric comparison)
        if (field === 'UserId') {
            valueA = parseInt(valueA) || 0;
            valueB = parseInt(valueB) || 0;
        }
        
        // Perform comparison
        if (valueA < valueB) {
            return direction === 'asc' ? -1 : 1;
        }
        if (valueA > valueB) {
            return direction === 'asc' ? 1 : -1;
        }
        return 0;
    });
}

// Handle sorting of user table
function sortTable(columnIndex) {
    console.log(`Sorting by column ${columnIndex}`);
    
    if (currentSortColumn === columnIndex) {
        // Toggle direction if already sorting by this column
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        // New column, default to ascending
        currentSortColumn = columnIndex;
        currentSortDirection = 'asc';
    }
    
    // Clear sort indicators from all headers
    document.querySelectorAll('.data-table th').forEach(th => {
        th.innerHTML = th.innerHTML.replace(' ↑', '').replace(' ↓', '');
    });
    
    // Add sort indicator to current column
    const headers = document.querySelectorAll('.data-table th');
    if (headers[columnIndex]) {
        headers[columnIndex].innerHTML += currentSortDirection === 'asc' ? ' ↑' : ' ↓';
    }
    
    // Refresh the display with the new sort
    displayUsers();
}

// Display filtered users with pagination
function displayUsers() {
    console.group('Displaying users');
    
    const tableBody = document.querySelector('.data-table tbody');
    if (!tableBody) {
        console.error('Table body not found');
        return;
    }
    
    if (!filteredUsers || filteredUsers.length === 0) {
        console.log('No users to display');
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="table-message">No users found with the selected role</td>
            </tr>
        `;
        updatePaginationControls(0);
        console.groupEnd();
        return;
    }
    
    // Apply current sort
    sortUsers(currentSortColumn, currentSortDirection);
    
    // Calculate pagination
    const totalPages = Math.ceil(filteredUsers.length / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, filteredUsers.length);
    const pageUsers = filteredUsers.slice(startIndex, endIndex);
    
    console.log(`Displaying users ${startIndex+1}-${endIndex} of ${filteredUsers.length} (page ${currentPage} of ${totalPages})`);
    
    // Build table rows
    let tableHTML = '';
    
    pageUsers.forEach(user => {
        const lastVisited = user.LastAccessed ? formatDate(user.LastAccessed) : 'Never';
        const createdDate = user.SignupDate ? formatDate(user.SignupDate) : 'Unknown';
        
        tableHTML += `
            <tr>
                <td>${user.UserId || ''}</td>
                <td>${user.FirstName || ''}</td>
                <td>${user.LastName || ''}</td>
                <td>${user.UserName || ''}</td>
                <td>${createdDate}</td>
                <td>${lastVisited}</td>
                <td class="table-actions" style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee); text-align: center;">
                    <div style="display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: wrap;">
                        <a href="https://your-brightspace.example.edu/d2l/lp/manageUsers/admin/newedit_user.d2l?ou=1001&uid=${user.UserId}" 
                           class="btn-icon-small" 
                           target="_blank" 
                           title="View/Edit User on D2L"
                           style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; background-color: var(--primary, #007bff); color: white; border: none; border-radius: 4px; text-decoration: none; cursor: pointer;">
                            <i class="fa-solid fa-edit"></i>
                        </a>
                        <button class="btn-icon-small role-switch-btn" 
                                data-user-id="${user.UserId}" 
                                data-user-name="${(user.FirstName || '') + ' ' + (user.LastName || '')}"
                                title="Switch Role">
                            <i class="fa-solid fa-user-gear"></i>
                        </button>
                        <button class="btn-icon-small inactivate-user-btn" 
                                data-user-id="${user.UserId}" 
                                data-user-name="${(user.FirstName || '') + ' ' + (user.LastName || '')}"
                                title="Inactivate User"
                                style="background-color: var(--warning, #ffc107);">
                            <i class="fa-solid fa-user-slash"></i>
                        </button>
                        <button class="btn-icon-small delete-user-btn" 
                                data-user-id="${user.UserId}" 
                                data-user-name="${(user.FirstName || '') + ' ' + (user.LastName || '')}"
                                title="Delete User"
                                style="background-color: var(--danger, #dc3545);">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tableBody.innerHTML = tableHTML;
    
    // Update pagination controls
    updatePaginationControls(totalPages);
    
    // Add event listeners to action buttons
    document.querySelectorAll('.role-switch-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const userId = button.dataset.userId;
            const userName = button.dataset.userName;
            console.log('Role switch button clicked for user:', userId, userName);
            try {
                await openRoleSwitchModal(userId, userName);
            } catch (error) {
                console.error('Error opening role switch modal:', error);
                alert('Error opening role switch: ' + error.message);
            }
        });
    });
    
    document.querySelectorAll('.inactivate-user-btn').forEach(button => {
        button.addEventListener('click', () => {
            const userId = button.dataset.userId;
            const userName = button.dataset.userName;
            openInactivateUserModal(userId, userName);
        });
    });
    
    document.querySelectorAll('.delete-user-btn').forEach(button => {
        button.addEventListener('click', () => {
            const userId = button.dataset.userId;
            const userName = button.dataset.userName;
            openDeleteUserModal(userId, userName);
        });
    });
    
    console.groupEnd();
}

// Update pagination controls
function updatePaginationControls(totalPages) {
    const tableFooter = document.querySelector('.table-footer');
    if (!tableFooter) {
        console.error('Table footer not found');
        return;
    }
    
    // No pagination needed if only one page
    if (totalPages <= 1) {
        return;
    }
    
    // Add pagination info
    const paginationInfo = document.createElement('div');
    paginationInfo.style.marginTop = 'var(--spacing-md)';
    paginationInfo.style.textAlign = 'center';
    paginationInfo.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; gap: 8px;">
            ${currentPage > 1 ? `<button class="btn btn-outline btn-sm" onclick="window.prevPage()">« Previous</button>` : ''}
            <span>Page ${currentPage} of ${totalPages}</span>
            ${currentPage < totalPages ? `<button class="btn btn-outline btn-sm" onclick="window.nextPage()">Next »</button>` : ''}
        </div>
    `;
    
    // Remove existing pagination if any
    const existingPagination = tableFooter.querySelector('.pagination-info');
    if (existingPagination) {
        existingPagination.remove();
    }
    
    paginationInfo.className = 'pagination-info';
    tableFooter.appendChild(paginationInfo);
}

// Pagination functions
window.prevPage = function() {
    if (currentPage > 1) {
        currentPage--;
        displayUsers();
    }
};

window.nextPage = function() {
    const totalPages = Math.ceil(filteredUsers.length / rowsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        displayUsers();
    }
};

// Initialize the page
async function initializeUserList() {
    try {
        console.log('Initializing user list...');
        updateStatus('Initializing... Loading user data from Data Hub');
        
        // Show loading state
        const tableBody = document.querySelector('.data-table tbody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="table-message">
                        <i class="fa-solid fa-spinner fa-spin"></i> Loading user data...
                    </td>
                </tr>
            `;
        }
        
        // Load user data
        try {
            console.log('Loading user data...');
            updateStatus('Fetching user datasets...');
            const userData = await loadUserData();
            allUsers = userData.users;
            availableRoles = userData.roles;
            
            console.log('User data loaded successfully');
            console.log('Sample user data structure:', allUsers.length > 0 ? allUsers[0] : 'No users');
        } catch (loadError) {
            console.error('Error loading user data:', loadError);
            updateStatus('Failed to load user data. See console for details.', 'error');
            throw loadError;
        }

        // Fetch role names from API if not already cached
        try {
            if (Object.keys(rolesCache).length === 0) {
                console.log('Fetching role names from API...');
                updateStatus('Loading role names from system...');
                await fetchAllRoles();
                
                // Update role names in availableRoles with API data
                Object.keys(availableRoles).forEach(roleId => {
                    const apiRoleName = rolesCache[roleId];
                    if (apiRoleName) {
                        availableRoles[roleId].name = apiRoleName;
                        console.log(`Updated role ${roleId} name to: ${apiRoleName}`);
                    }
                });
            }
        } catch (roleFetchError) {
            console.warn('Error fetching role names from API, using fallback names:', roleFetchError);
            // Continue with hardcoded names if API fails
        }

        // Populate role dropdown
        try {
            console.log('Populating role dropdown...');
            updateStatus('Processing user roles...');
            populateRoleDropdown();
            console.log('Role dropdown populated');
        } catch (roleError) {
            console.error('Error populating roles:', roleError);
            updateStatus('Failed to process roles. See console for details.', 'error');
            throw roleError;
        }

        // Setup rows per page control
        const rowsPerPageSelect = document.querySelector('.rows-per-page');
        if (rowsPerPageSelect) {
            rowsPerPageSelect.addEventListener('change', function() {
                rowsPerPage = parseInt(this.value);
                currentPage = 1;
                displayUsers();
            });
        }

        // Setup fuzzy search
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                const searchTerm = this.value.toLowerCase().trim();
                if (!searchTerm) {
                    // Reset to original filtered users if search is cleared
                    const roleSelect = document.querySelector('.controls-row select');
                    if (roleSelect && roleSelect.value) {
                        filteredUsers = allUsers.filter(user => 
                            String(user.OrgRoleId) === String(roleSelect.value)
                        );
                    } else {
                        filteredUsers = [...allUsers];
                    }
                } else {
                    // Apply fuzzy search
                    const roleSelect = document.querySelector('.controls-row select');
                    const baseUsers = roleSelect && roleSelect.value ? 
                        allUsers.filter(user => String(user.OrgRoleId) === String(roleSelect.value)) :
                        allUsers;
                    
                    filteredUsers = baseUsers.filter(user => {
                        const firstName = (user.FirstName || '').toLowerCase();
                        const lastName = (user.LastName || '').toLowerCase();
                        const username = (user.UserName || '').toLowerCase();
                        const userId = String(user.UserId || '').toLowerCase();
                        
                        return firstName.includes(searchTerm) ||
                               lastName.includes(searchTerm) ||
                               username.includes(searchTerm) ||
                               userId.includes(searchTerm);
                    });
                }
                currentPage = 1;
                displayUsers();
            });
        }

        // Setup clear search button
        const clearBtn = document.querySelector('.btn-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                const searchInput = document.querySelector('.search-input');
                if (searchInput) {
                    searchInput.value = '';
                    const roleSelect = document.querySelector('.controls-row select');
                    if (roleSelect && roleSelect.value) {
                        filteredUsers = allUsers.filter(user => 
                            String(user.OrgRoleId) === String(roleSelect.value)
                        );
                    } else {
                        filteredUsers = [...allUsers];
                    }
                    currentPage = 1;
                    displayUsers();
                }
            });
        }

        // Signal that initialization is complete
        console.log('User list initialization complete');
        updateStatus('Initialization complete', 'success');
        
    } catch (error) {
        console.error('Error initializing user list:', error);
        updateStatus('Initialization failed: ' + error.message, 'error');
    }
}

// ===================================
// USER ACTION MODALS AND FUNCTIONS
// ===================================

// Open role switch modal
async function openRoleSwitchModal(userId, userName) {
    // Close any existing modals first
    closeRoleSwitchModal();
    closeRolesGlossaryModal();
    
    try {
        // In D2L, user roles are associated with enrollments, not the user object directly
        // Fetch user details to get OrgId (main org unit)
        console.log('Fetching user details for userId:', userId);
        const userDetails = await BrightspaceFetch(`/d2l/api/lp/1.49/users/${userId}`, 'GET');
        console.log('User details response:', userDetails);
        
        // Get the main org unit ID
        let mainOrgUnitId = userDetails.OrgId;
        if (!mainOrgUnitId) {
            // Fallback: Get organization info
            const orgInfo = await BrightspaceFetch('/d2l/api/lp/1.49/organization/info', 'GET');
            mainOrgUnitId = orgInfo.Identifier;
            console.log('Fetched main org unit ID from organization info:', mainOrgUnitId);
        }
        
        // Fetch the user's enrollment in the main org unit to get their current role
        let currentRoleId = null;
        try {
            const enrollment = await BrightspaceFetch(
                `/d2l/api/lp/1.46/enrollments/orgUnits/${mainOrgUnitId}/users/${userId}`, 
                'GET'
            );
            console.log('User enrollment in main org unit:', enrollment);
            currentRoleId = enrollment.Role?.Id || enrollment.RoleId || enrollment.Role?.Identifier;
            console.log('Current role ID from enrollment:', currentRoleId);
        } catch (enrollmentError) {
            console.warn('Could not fetch enrollment (user may not be enrolled in main org unit):', enrollmentError);
            // User might not have an enrollment - try to get role from user object as fallback
            currentRoleId = userDetails.RoleId || userDetails.OrgRoleId || 
                           (userDetails.Role && (userDetails.Role.Id || userDetails.Role.Identifier));
        }
        
        // Fetch all available roles
        const allRoles = await BrightspaceFetch('/d2l/api/lp/1.46/roles/', 'GET');
        const rolesArray = Array.isArray(allRoles) ? allRoles : (allRoles.Items || []);
        console.log('Fetched roles array, count:', rolesArray.length);
        
        // Sort roles by name for better UX
        rolesArray.sort((a, b) => {
            const nameA = (a.DisplayName || a.Name || '').toLowerCase();
            const nameB = (b.DisplayName || b.Name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });
        
        // Get current role name
        const currentRole = rolesArray.find(r => {
            const roleId = String(r.Identifier || r.Id);
            return roleId === String(currentRoleId);
        });
        const currentRoleName = currentRole ? (currentRole.DisplayName || currentRole.Name) : (currentRoleId ? `Role ${currentRoleId}` : 'Unknown Role');
        console.log('Current role name:', currentRoleName, 'Current role ID:', currentRoleId);
        
        // Create modal HTML
        let modalHTML = `
            <div id="role-switch-modal" class="modal-overlay show" style="display: flex !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.5) !important; z-index: 99999 !important; align-items: center !important; justify-content: center !important; opacity: 1 !important;">
                <div class="modal-content" style="background: white !important; padding: 24px !important; border-radius: 8px !important; max-width: 600px !important; width: 90% !important; max-height: 90vh !important; overflow-y: auto !important; box-shadow: 0 4px 6px rgba(0,0,0,0.1) !important; position: relative !important; z-index: 100000 !important; transform: scale(1) !important;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #eee; padding-bottom: 16px;">
                        <h2 style="margin: 0; font-size: 24px; color: #333;">Switch Role for ${userName}</h2>
                        <button id="close-role-switch-btn" class="close-modal-btn" style="background: none; border: none; font-size: 28px; cursor: pointer; color: #999; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background-color 0.2s;">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom: 20px; padding: 16px; background-color: #f8f9fa; border-radius: 6px; border-left: 4px solid var(--primary, #007bff);">
                            <p style="margin: 0 0 8px 0; font-weight: 600; color: #333;">Current Role:</p>
                            <p style="margin: 0; font-size: 18px; color: ${currentRoleId ? '#666' : '#d32f2f'};">
                                ${currentRoleId ? `${currentRoleName} (ID: ${currentRoleId})` : 'Unable to determine current role. Please check D2L directly.'}
                            </p>
                        </div>
                        
                        <div class="form-group" style="margin-bottom: 24px;">
                            <label for="new-role-select" style="display: block; margin-bottom: 8px; font-weight: 600; color: #333;">Select New Role:</label>
                            <select id="new-role-select" 
                                    class="form-control" 
                                    style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 6px; font-size: 16px; background-color: white; cursor: pointer;">
                                <option value="">-- Select a role --</option>
        `;
        
        rolesArray.forEach(role => {
            const roleId = role.Identifier || role.Id;
            const roleName = role.DisplayName || role.Name || `Role ${roleId}`;
            const isCurrent = String(roleId) === String(currentRoleId);
            modalHTML += `<option value="${roleId}" ${isCurrent ? 'disabled' : ''}>${roleName} (ID: ${roleId})${isCurrent ? ' - Current' : ''}</option>`;
        });
        
        modalHTML += `
                            </select>
                            <small style="display: block; margin-top: 6px; color: #666; font-size: 13px;">
                                <i class="fa-solid fa-info-circle"></i> Select a new role to assign to this user
                            </small>
                        </div>
                        
                        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; padding-top: 20px; border-top: 1px solid #eee;">
                            <button id="cancel-role-switch" class="btn btn-outline" style="padding: 10px 20px; font-size: 14px; border-radius: 6px;">
                                Cancel
                            </button>
                            <button id="confirm-role-switch" class="btn btn-primary" style="padding: 10px 20px; font-size: 14px; border-radius: 6px; background-color: var(--primary, #007bff); color: white; border: none; cursor: pointer;">
                                <i class="fa-solid fa-user-gear"></i> Switch Role
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing modal if any
        const existingModal = document.getElementById('role-switch-modal');
        if (existingModal) {
            existingModal.remove();
            console.log('Removed existing role switch modal');
        }
        
        // Add modal to body (not inside any container)
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Force visibility
        const modal = document.getElementById('role-switch-modal');
        if (modal) {
            modal.style.display = 'flex';
            modal.style.opacity = '1';
            modal.style.visibility = 'visible';
            console.log('Role switch modal added to DOM');
            
            // Add close button event listener
            const closeBtn = document.getElementById('close-role-switch-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeRoleSwitchModal();
                });
                closeBtn.addEventListener('mouseenter', function() {
                    this.style.backgroundColor = '#f0f0f0';
                });
                closeBtn.addEventListener('mouseleave', function() {
                    this.style.backgroundColor = 'transparent';
                });
            }
        } else {
            console.error('Failed to create role switch modal');
            return;
        }
        
        // Add event listeners
        const confirmBtn = document.getElementById('confirm-role-switch');
        const cancelBtn = document.getElementById('cancel-role-switch');
        const roleSelect = document.getElementById('new-role-select');
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeRoleSwitchModal();
            });
        }
        
        if (!confirmBtn || !roleSelect) {
            console.error('Modal elements not found');
            return;
        }
        
        confirmBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            const newRoleId = roleSelect.value;
            
            if (!newRoleId) {
                alert('Please select a role');
                return;
            }
            
            if (newRoleId == currentRoleId) {
                alert('Please select a different role than the current one');
                return;
            }
            
            const selectedRole = rolesArray.find(r => String(r.Identifier || r.Id) === String(newRoleId));
            const newRoleName = selectedRole ? (selectedRole.DisplayName || selectedRole.Name) : `Role ${newRoleId}`;
            
            const fromRoleText = currentRoleId ? `"${currentRoleName}"` : 'their current role';
            if (!confirm(`Are you sure you want to change ${userName}'s role from ${fromRoleText} to "${newRoleName}"?`)) {
                return;
            }
            
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Switching...';
            
            try {
                // In D2L Brightspace, user roles are associated with enrollments in organizational units
                // To change a user's system role, we need to update their enrollment in the main org unit
                console.log('Updating user role via enrollment method...');
                
                // Step 1: Get the main org unit ID (root organization)
                // Use the OrgId from the user data, or fetch organization info
                const currentUserData = await BrightspaceFetch(`/d2l/api/lp/1.49/users/${userId}`, 'GET');
                console.log('Current user data:', currentUserData);
                
                let mainOrgUnitId = currentUserData.OrgId;
                if (!mainOrgUnitId) {
                    // Fallback: Get organization info
                    const orgInfo = await BrightspaceFetch('/d2l/api/lp/1.49/organization/info', 'GET');
                    mainOrgUnitId = orgInfo.Identifier;
                    console.log('Fetched main org unit ID from organization info:', mainOrgUnitId);
                } else {
                    console.log('Using OrgId from user data as main org unit ID:', mainOrgUnitId);
                }
                
                // Step 2: Get the user's current enrollment in the main org unit
                console.log(`Fetching current enrollment for user ${userId} in org unit ${mainOrgUnitId}...`);
                let currentEnrollment;
                try {
                    currentEnrollment = await BrightspaceFetch(
                        `/d2l/api/lp/1.46/enrollments/orgUnits/${mainOrgUnitId}/users/${userId}`, 
                        'GET'
                    );
                    console.log('Current enrollment:', currentEnrollment);
                } catch (enrollmentError) {
                    console.warn('Could not fetch current enrollment (user may not be enrolled in main org unit):', enrollmentError);
                    // User might not have an enrollment yet, we'll create one
                }
                
                // Step 3: Delete existing enrollment if it exists
                if (currentEnrollment) {
                    console.log('Deleting existing enrollment...');
                    try {
                        await BrightspaceFetch(
                            `/d2l/api/lp/1.46/enrollments/orgUnits/${mainOrgUnitId}/users/${userId}`, 
                            'DELETE'
                        );
                        console.log('Existing enrollment deleted');
                    } catch (deleteError) {
                        console.warn('Error deleting existing enrollment (may not exist):', deleteError);
                        // Continue anyway - we'll try to create the new enrollment
                    }
                }
                
                // Step 4: Create new enrollment with the new role
                console.log(`Creating new enrollment with role ${newRoleId}...`);
                const enrollmentData = {
                    OrgUnitId: parseInt(mainOrgUnitId, 10),
                    UserId: parseInt(userId, 10),
                    RoleId: parseInt(newRoleId, 10),
                    IsActive: true,
                    IsCascading: false
                };
                console.log('Enrollment data:', enrollmentData);
                
                const enrollmentResponse = await BrightspaceFetch(
                    '/d2l/api/lp/1.46/enrollments/', 
                    'POST', 
                    enrollmentData
                );
                console.log('Enrollment created successfully:', enrollmentResponse);
                
                // Step 5: Verify the change by checking the enrollment
                console.log('Verifying role change...');
                const verifyEnrollment = await BrightspaceFetch(
                    `/d2l/api/lp/1.46/enrollments/orgUnits/${mainOrgUnitId}/users/${userId}`, 
                    'GET'
                );
                const verifiedRoleId = verifyEnrollment.Role?.Id || verifyEnrollment.RoleId;
                console.log('Verified role after update:', verifiedRoleId, 'Expected:', newRoleId);
                
                if (String(verifiedRoleId) === String(newRoleId)) {
                    alert(`Role successfully changed to "${newRoleName}"!`);
                    closeRoleSwitchModal();
                    
                    // Refresh the user list
                    if (document.querySelector('.controls-row select')?.value) {
                        fetchUsersByRole();
                    } else {
                        // If no role filter is active, just refresh the display
                        displayUsers();
                    }
                } else {
                    throw new Error(`Role change may not have persisted. Expected role ${newRoleId}, but enrollment shows role ${verifiedRoleId}`);
                }
            } catch (error) {
                console.error('Error switching role:', error);
                console.error('Error details:', {
                    message: error.message,
                    stack: error.stack,
                    userId: userId,
                    newRoleId: newRoleId
                });
                alert(`Error switching role: ${error.message || 'Unknown error occurred. Please check the console for details.'}`);
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fa-solid fa-user-gear"></i> Switch Role';
            }
        });
        
        // Close on overlay click
        document.getElementById('role-switch-modal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeRoleSwitchModal();
            }
        });
        
        // Close on Escape key
        document.addEventListener('keydown', handleEscapeKey);
        
        // Verify modal is visible
        setTimeout(() => {
            const modal = document.getElementById('role-switch-modal');
            if (modal) {
                console.log('Role switch modal created, checking visibility:', {
                    display: window.getComputedStyle(modal).display,
                    opacity: window.getComputedStyle(modal).opacity,
                    zIndex: window.getComputedStyle(modal).zIndex,
                    visible: modal.offsetParent !== null
                });
            }
        }, 100);
        
    } catch (error) {
        console.error('Error loading roles:', error);
        alert(`Error loading roles: ${error.message}`);
    }
}

function closeRoleSwitchModal() {
    const modal = document.getElementById('role-switch-modal');
    if (modal) {
        // Remove event listeners before removing
        const closeBtn = document.getElementById('close-role-switch-btn');
        if (closeBtn) {
            closeBtn.replaceWith(closeBtn.cloneNode(true)); // Remove all listeners
        }
        modal.remove();
        console.log('Role switch modal closed and removed');
    }
    // Remove escape key listener
    document.removeEventListener('keydown', handleEscapeKey);
}

// Handle Escape key for closing modals
function handleEscapeKey(e) {
    if (e.key === 'Escape') {
        const roleModal = document.getElementById('role-switch-modal');
        const glossaryModal = document.getElementById('roles-glossary-modal');
        if (roleModal) closeRoleSwitchModal();
        if (glossaryModal) closeRolesGlossaryModal();
    }
}

// Open inactivate user modal
function openInactivateUserModal(userId, userName) {
    if (!confirm(`Are you sure you want to inactivate user "${userName}" (ID: ${userId})?`)) {
        return;
    }
    
    // Show loading
    const loadingMsg = document.createElement('div');
    loadingMsg.id = 'inactivate-loading';
    loadingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 2000;';
    loadingMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Inactivating user...';
    document.body.appendChild(loadingMsg);
    
    BrightspaceFetch(`/d2l/api/lp/1.46/users/${userId}/activation`, 'PUT', {
        IsActive: false
    }).then(() => {
        alert(`User "${userName}" has been inactivated successfully.`);
        document.body.removeChild(loadingMsg);
        // Refresh the user list
        if (document.querySelector('.controls-row select').value) {
            fetchUsersByRole();
        }
    }).catch(error => {
        alert(`Error inactivating user: ${error.message}`);
        document.body.removeChild(loadingMsg);
    });
}

// Open delete user modal
function openDeleteUserModal(userId, userName) {
    if (!confirm(`⚠️ WARNING: Are you sure you want to DELETE user "${userName}" (ID: ${userId})?\n\nThis action cannot be undone!`)) {
        return;
    }
    
    if (!confirm(`This will permanently delete the user account. Are you absolutely certain?`)) {
        return;
    }
    
    // Show loading
    const loadingMsg = document.createElement('div');
    loadingMsg.id = 'delete-loading';
    loadingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 2000;';
    loadingMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting user...';
    document.body.appendChild(loadingMsg);
    
    BrightspaceFetch(`/d2l/api/lp/1.31/users/${userId}`, 'DELETE')
        .then(() => {
            alert(`User "${userName}" has been deleted successfully.`);
            document.body.removeChild(loadingMsg);
            // Refresh the user list
            if (document.querySelector('.controls-row select').value) {
                fetchUsersByRole();
            }
        })
        .catch(error => {
            alert(`Error deleting user: ${error.message}`);
            document.body.removeChild(loadingMsg);
        });
}

// ===================================
// ROLES GLOSSARY (API + CSV EXPORT)
// ===================================

async function loadRolesGlossary() {
    try {
        // Always fetch the latest roles from the API so the glossary
        // reflects all current system roles and their descriptions.
        const allRoles = await BrightspaceFetch('/d2l/api/lp/1.47/roles/', 'GET');
        const rolesArray = Array.isArray(allRoles) ? allRoles : (allRoles.Items || []);
        
        const mergedRoles = rolesArray.map(role => {
            const roleId = String(role.Identifier || role.Id);
            
            return {
                Id: roleId,
                Name: role.DisplayName || role.Name || `Role ${roleId}`,
                Description: role.Description || role.Code || 'No description available',
                Code: role.Code || ''
            };
        });
        
        return mergedRoles;
    } catch (error) {
        console.error('Error loading roles glossary:', error);
        return [];
    }
}

// Show roles glossary modal
async function showRolesGlossaryModal() {
    // Close any existing modals first
    closeRoleSwitchModal();
    closeRolesGlossaryModal();
    
    const roles = await loadRolesGlossary();
    
    let modalHTML = `
        <div id="roles-glossary-modal" class="modal-overlay show" style="display: flex !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0,0,0,0.5) !important; z-index: 99999 !important; align-items: center !important; justify-content: center !important; opacity: 1 !important;">
            <div class="modal-content" style="background: white !important; padding: 24px !important; border-radius: 8px !important; max-width: 1000px !important; width: 90% !important; max-height: 90vh !important; overflow-y: auto !important; position: relative !important; z-index: 100000 !important; box-shadow: 0 4px 6px rgba(0,0,0,0.1) !important; transform: scale(1) !important;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2>Roles Glossary</h2>
                    <button id="close-glossary-btn" class="close-modal-btn" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #999; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background-color 0.2s;">&times;</button>
                </div>
                
                <div style="margin-bottom: 20px; display: flex; gap: 12px; align-items: center;">
                    <button id="download-roles-csv-btn" class="btn btn-outline btn-sm">
                        <i class="fa-solid fa-download"></i> Download CSV
                    </button>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <input type="text" id="roles-glossary-search" placeholder="Search roles..." 
                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>
                
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background-color: #f5f5f5;">
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Role ID</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Name</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Description</th>
                        </tr>
                    </thead>
                    <tbody id="roles-glossary-tbody">
    `;
    
    roles.forEach(role => {
        modalHTML += `
            <tr class="role-glossary-row">
                <td style="padding: 12px; border-bottom: 1px solid #eee;">${role.Id}</td>
                <td style="padding: 12px; border-bottom: 1px solid #eee;"><strong>${role.Name}</strong></td>
                <td style="padding: 12px; border-bottom: 1px solid #eee;">${role.Description}</td>
            </tr>
        `;
    });
    
    modalHTML += `
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('roles-glossary-modal');
    if (existingModal) {
        existingModal.remove();
        console.log('Removed existing roles glossary modal');
    }
    
    // Add modal to body (not inside any container)
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Force visibility
    const modal = document.getElementById('roles-glossary-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        modal.style.visibility = 'visible';
        console.log('Roles glossary modal added to DOM');
    } else {
        console.error('Failed to create roles glossary modal');
    }
    
    // Add search functionality
    document.getElementById('roles-glossary-search').addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        document.querySelectorAll('.role-glossary-row').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    // Wire up "Download CSV" button to export the current roles list
    const downloadBtn = document.getElementById('download-roles-csv-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const headers = ['RoleId', 'Name', 'Description'];
            const rows = roles.map(role => [
                `"${role.Id}"`,
                `"${(role.Name || '').replace(/"/g, '""')}"`,
                `"${(role.Description || '').replace(/"/g, '""')}"`
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(r => r.join(','))
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'roles-glossary.csv';
            a.click();
            window.URL.revokeObjectURL(url);
        });
    }
    
    // Close on overlay click and add close button handler
    const glossaryModal = document.getElementById('roles-glossary-modal');
    if (glossaryModal) {
        glossaryModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeRolesGlossaryModal();
            }
        });
        
        // Add close button event listener
        const closeBtn = document.getElementById('close-glossary-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeRolesGlossaryModal();
            });
            closeBtn.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f0f0f0';
            });
            closeBtn.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent';
            });
        }
        
        // Verify modal is visible
        setTimeout(() => {
            console.log('Roles glossary modal created, checking visibility:', {
                display: window.getComputedStyle(glossaryModal).display,
                opacity: window.getComputedStyle(glossaryModal).opacity,
                zIndex: window.getComputedStyle(glossaryModal).zIndex,
                visible: glossaryModal.offsetParent !== null
            });
        }, 100);
    } else {
        console.error('Failed to create roles glossary modal');
    }
}

function closeRolesGlossaryModal() {
    const modal = document.getElementById('roles-glossary-modal');
    if (modal) {
        // Remove event listeners before removing
        const closeBtn = document.getElementById('close-glossary-btn');
        if (closeBtn) {
            closeBtn.replaceWith(closeBtn.cloneNode(true)); // Remove all listeners
        }
        modal.remove();
        console.log('Roles glossary modal closed and removed');
    }
    // Remove escape key listener
    document.removeEventListener('keydown', handleEscapeKey);
}

// Handle CSV upload
async function handleRolesCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const text = await file.text();
    const parsedData = parseRolesCSV(text);
    
    if (!parsedData) {
        alert('Invalid CSV format. Please use the template.');
        return;
    }
    
    // Merge with existing data
    rolesGlossaryData = { ...rolesGlossaryData, ...parsedData };
    
    // Save to localStorage
    localStorage.setItem('rolesGlossaryData', JSON.stringify(rolesGlossaryData));
    
    alert(`Successfully loaded ${Object.keys(parsedData).length} role definitions from CSV.`);
    
    // Refresh the modal
    closeRolesGlossaryModal();
    showRolesGlossaryModal();
}

// Add global CSS for modals to ensure they're visible
if (!document.getElementById('user-list-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'user-list-modal-styles';
    style.textContent = `
        #role-switch-modal,
        #roles-glossary-modal {
            display: flex !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: rgba(0, 0, 0, 0.5) !important;
            z-index: 99999 !important;
            align-items: center !important;
            justify-content: center !important;
            opacity: 1 !important;
            visibility: visible !important;
        }
        #role-switch-modal .modal-content,
        #roles-glossary-modal .modal-content {
            position: relative !important;
            z-index: 100000 !important;
            transform: scale(1) !important;
        }
    `;
    document.head.appendChild(style);
}

// Make functions globally available
window.closeRoleSwitchModal = closeRoleSwitchModal;
window.closeRolesGlossaryModal = closeRolesGlossaryModal;

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', async function() {
    // Setup fetch button
    const fetchButton = document.querySelector('.controls-row .btn-primary');
    if (fetchButton) {
        fetchButton.addEventListener('click', fetchUsersByRole);
    }
    
    // Setup roles glossary button
    const glossaryButton = document.querySelector('.controls-row .btn-outline');
    if (glossaryButton && glossaryButton.textContent.includes('Roles Glossary')) {
        glossaryButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Roles Glossary button clicked');
            try {
                await showRolesGlossaryModal();
            } catch (error) {
                console.error('Error showing roles glossary:', error);
                alert('Error loading roles glossary: ' + error.message);
            }
        });
    }
    
    // Start the initialization process
    await initializeUserList();
});
