/**
 * search-user.js
 * Handles user search functionality for the Search User page
 * Based on old-Admin-Dashboard/js/search-user.js
 */

// Import the BrightspaceFetch function (create a helper if needed)
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

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} - ${response.statusText}`);
        }

        // Check if response is empty
        const text = await response.text();
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

// Define API endpoints for different search types
const API_ENDPOINTS = {
    UserId: '/d2l/api/lp/1.49/users/',
    Username: '/d2l/api/lp/1.46/users/?userName=',
    OrgDefinedId: '/d2l/api/lp/1.46/users/?orgDefinedId='
};

// Maximum number of users to show per page
const USERS_PER_PAGE = 10;
const ENROLLMENTS_PER_PAGE = 10;

// Current page and total users for pagination
let currentPage = 1;
let totalFilteredUsers = [];
let allCourseOfferings = [];
let filteredCourseOfferings = [];
let enrollmentCurrentPage = 1;
let currentEnrollmentUserId = null;
let currentEnrollmentDisplayName = '';
let enrollmentSearchQuery = '';
let enrollmentSemesterFilter = 'all';
let enrollmentRoleFilter = 'all';

// Format date to local string
function formatDate(dateString) {
    if (!dateString) return 'Never';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleString();
    } catch (e) {
        return 'Invalid date';
    }
}

// Cache for user data from Data Hub
let cachedUserData = null;

// Load user data from Data Hub for name-based searches
async function loadUserDataForSearch() {
    if (cachedUserData) {
        return cachedUserData;
    }
    
    try {
        console.log('Loading user data from Data Hub for name search...');
        
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
        
        // Fetch dataset extracts
        const fullDataResponse = await fetch('/d2l/api/lp/1.43/datasets/bds/b21a6414-38f8-4da8-9a65-8b5586f9fe3b/plugins/1d6d722e-b572-456f-97c1-d526570daa6b/extracts?type=full', { 
            method: 'GET',
            credentials: 'include'
        });
        
        if (!fullDataResponse.ok) {
            throw new Error(`Failed to fetch dataset extracts: ${fullDataResponse.status}`);
        }
        
        const fullDataJson = await fullDataResponse.json();
        if (!fullDataJson.Objects || fullDataJson.Objects.length === 0) {
            throw new Error('No full dataset extracts found');
        }
        
        // Get latest extract
        const sortedExtracts = fullDataJson.Objects.sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate));
        const latestExtract = sortedExtracts[0];
        const downloadUrl = latestExtract?.DownloadLink;
        
        if (!downloadUrl) throw new Error('No download URL found');
        
        // Download ZIP
        const zipResponse = await fetch(downloadUrl, { method: 'GET', credentials: 'include' });
        if (!zipResponse.ok) throw new Error(`Failed to download dataset ZIP: ${zipResponse.status}`);
        
        const zipBlob = await zipResponse.blob();
        const zip = await window.JSZip.loadAsync(zipBlob);
        const csvFile = Object.values(zip.files).find(file => file.name.endsWith('.csv'));
        
        if (!csvFile) throw new Error('No CSV file found in dataset ZIP');
        
        const csvContent = await csvFile.async('string');
        const lines = csvContent.split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        
        const users = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = line.split(',');
            if (values.length === headers.length) {
                const user = {};
                headers.forEach((header, index) => {
                    user[header] = values[index].replace(/^"|"$/g, '');
                });
                users.push(user);
            }
        }
        
        cachedUserData = users;
        console.log(`Loaded ${users.length} users from Data Hub for name search`);
        return users;
    } catch (error) {
        console.error('Error loading user data for search:', error);
        return [];
    }
}

// Search users by name (fuzzy search)
async function searchUsersByName(query) {
    try {
        const allUsers = await loadUserDataForSearch();
        if (allUsers.length === 0) {
            return [];
        }
        
        const searchTerm = query.toLowerCase().trim();
        const matchingUsers = [];
        
        // Search through users
        for (const user of allUsers) {
            const firstName = (user.FirstName || '').toLowerCase();
            const lastName = (user.LastName || '').toLowerCase();
            const fullName = `${firstName} ${lastName}`.trim();
            
            // Check if search term matches first name, last name, or full name
            if (firstName.includes(searchTerm) || 
                lastName.includes(searchTerm) || 
                fullName.includes(searchTerm)) {
                matchingUsers.push(user);
            }
        }
        
        // Fetch full user details for matching users
        const detailedUsers = [];
        for (const user of matchingUsers.slice(0, 100)) { // Limit to 100 to avoid too many API calls
            try {
                const userDetails = await BrightspaceFetch(`${API_ENDPOINTS.UserId}${user.UserId}`, 'GET');
                if (userDetails) {
                    detailedUsers.push(userDetails);
                }
            } catch (error) {
                // If we can't fetch details, use the basic user data
                detailedUsers.push(user);
            }
        }
        
        return detailedUsers;
    } catch (error) {
        console.error('Error in name search:', error);
        return [];
    }
}

// Global flag to track if name search was used
let usedNameSearch = false;

// Main search function
async function searchUser(query, searchType) {
    console.log(`Starting search with query "${query}" and type "${searchType}"`);
    usedNameSearch = false;
    
    try {
        let results = [];
        
        // Handle different search types
        switch (searchType) {
            case 'UserId':
                // Search by user ID
                if (isNaN(query)) {
                    throw new Error('User ID must be a number');
                }
                
                try {
                    const userData = await BrightspaceFetch(`${API_ENDPOINTS.UserId}${query}`, 'GET');
                    if (userData) {
                        results = [userData];
                    }
                } catch (error) {
                    console.log(`Error fetching user by ID: ${error.message}`);
                }
                break;
                
            case 'Username':
                // Search by username (exact match)
                try {
                    const userNameData = await BrightspaceFetch(`${API_ENDPOINTS.Username}${encodeURIComponent(query)}`, 'GET');
                    if (userNameData) {
                        results = Array.isArray(userNameData) ? userNameData : [userNameData];
                    }
                } catch (error) {
                    console.log(`Error fetching user by username: ${error.message}`);
                }
                
                // If no results and query looks like a name (not a typical username), try name search
                if (results.length === 0 && query.length > 2 && !query.includes('.') && !query.includes('@')) {
                    console.log('No username match found, trying name search...');
                    usedNameSearch = true;
                    const nameResults = await searchUsersByName(query);
                    if (nameResults.length > 0) {
                        results = nameResults;
                        console.log(`Found ${nameResults.length} users by name search`);
                    }
                }
                break;
                
            case 'OrgDefinedId':
                // Search by organization defined ID
                try {
                    const orgIdData = await BrightspaceFetch(`${API_ENDPOINTS.OrgDefinedId}${encodeURIComponent(query)}`, 'GET');
                    if (orgIdData) {
                        results = Array.isArray(orgIdData) ? orgIdData : [orgIdData];
                    }
                } catch (error) {
                    console.log(`Error fetching user by orgDefinedId: ${error.message}`);
                }
                break;
        }
        
        // Store results for pagination
        totalFilteredUsers = [...results];
        currentPage = 1;
        
        return results;
    } catch (error) {
        console.error("Error in search function:", error);
        throw error;
    }
}

// Function to display user results with pagination
function displayUserResults(users) {
    const resultsContainer = document.getElementById('search-results');
    
    if (!resultsContainer) {
        console.error('Search results container not found');
        return;
    }
    
    if (!users || users.length === 0) {
        resultsContainer.innerHTML = '<p class="no-results">No users found matching your search criteria.</p>';
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(totalFilteredUsers.length / USERS_PER_PAGE);
    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    const endIndex = Math.min(startIndex + USERS_PER_PAGE, totalFilteredUsers.length);
    
    // Get current page of users
    const displayUsers = totalFilteredUsers.slice(startIndex, endIndex);

    let resultsHTML = `
        <div class="card" style="margin-top: var(--spacing-lg);">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3>Search Results (${totalFilteredUsers.length} ${totalFilteredUsers.length === 1 ? 'user' : 'users'})</h3>
                ${usedNameSearch ? '<span style="font-size: 13px; color: var(--success, #28a745); font-weight: 500;"><i class="fa-solid fa-info-circle"></i> Results found by name search</span>' : ''}
            </div>
            <div class="card-body" style="padding: 0;">
                <div class="table-container" style="overflow-x: auto;">
                    <table class="data-table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                        <thead>
                            <tr style="background-color: var(--bg-secondary, #f5f5f5);">
                                <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">User ID</th>
                                <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Name</th>
                                <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Username</th>
                                <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Email</th>
                                <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">ID Number</th>
                                <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Pronouns</th>
                                <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Last Access</th>
                                <th style="padding: 12px 16px; text-align: center; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap; min-width: 120px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
    `;
    
    displayUsers.forEach((user, index) => {
        const name = `${user.FirstName || ''} ${user.MiddleName ? user.MiddleName + ' ' : ''}${user.LastName || ''}`.trim();
        const active = user.Activation && user.Activation.IsActive;
        const rowClass = !active ? 'inactive-user' : '';
        const rowStyle = !active ? 'opacity: 0.7; background-color: #f8f8f8;' : (index % 2 === 0 ? 'background-color: #fff;' : 'background-color: #fafafa;');
        
        resultsHTML += `
            <tr class="${rowClass}" style="${rowStyle}">
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">${user.UserId || user.Identifier || ''}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee); font-weight: 500;">${name || 'N/A'}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">${user.UserName || 'N/A'}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">${user.ExternalEmail || user.Email || 'N/A'}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">${user.OrgDefinedId || 'N/A'}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">${user.Pronouns || 'N/A'}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">${formatDate(user.LastAccessedDate || user.LastAccessed)}</td>
                <td class="table-actions" style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee); text-align: center;">
                    <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                        <a href="https://your-brightspace.example.edu/d2l/lp/manageUsers/admin/newedit_user.d2l?ou=1001&uid=${user.UserId || user.Identifier}" 
                           class="btn-icon-small" 
                           target="_blank" 
                           title="Edit User"
                           style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; background-color: var(--primary, #007bff); color: white; border: none; border-radius: 4px; text-decoration: none; cursor: pointer;">
                            <i class="fa-solid fa-edit"></i>
                        </a>
                        <button class="btn-icon-small view-enrollments-btn" 
                                data-userid="${user.UserId || user.Identifier}" 
                                data-username="${user.UserName || ''}"
                                data-displayname="${name}" 
                                title="View Enrollments"
                                style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; background-color: var(--success, #28a745); color: white; border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fa-solid fa-graduation-cap"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    
        resultsHTML += `
                        </tbody>
                    </table>
                </div>
            </div>
    `;
    
    // Add CSS for hover effects
    if (!document.getElementById('search-results-styles')) {
        const style = document.createElement('style');
        style.id = 'search-results-styles';
        style.textContent = `
            .data-table tbody tr:hover {
                background-color: #f0f7ff !important;
                cursor: pointer;
            }
            .data-table tbody tr.inactive-user:hover {
                background-color: #f5f5f5 !important;
            }
            .btn-icon-small:hover {
                opacity: 0.9;
                transform: scale(1.05);
                transition: all 0.2s ease;
            }
            .data-table {
                border-radius: 4px;
                overflow: hidden;
            }
            .data-table thead th:first-child {
                border-top-left-radius: 4px;
            }
            .data-table thead th:last-child {
                border-top-right-radius: 4px;
            }
            .table-container {
                max-width: 100%;
            }
            /* Enrollments table styling - matches search results */
            #enrollments-container .data-table tbody tr:hover {
                background-color: #f0f7ff !important;
                cursor: pointer;
            }
            #enrollments-container .btn-icon-small:hover {
                opacity: 0.9;
                transform: scale(1.05);
                transition: all 0.2s ease;
            }
            #enrollments-container .data-table {
                border-radius: 4px;
                overflow: hidden;
            }
            #enrollments-container .data-table thead th:first-child {
                border-top-left-radius: 4px;
            }
            #enrollments-container .data-table thead th:last-child {
                border-top-right-radius: 4px;
            }
            @media (max-width: 768px) {
                .table-container {
                    overflow-x: auto;
                    -webkit-overflow-scrolling: touch;
                }
                .data-table {
                    min-width: 800px;
                }
                .data-table th,
                .data-table td {
                    padding: 8px 12px;
                    font-size: 13px;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Add pagination controls if necessary
    if (totalPages > 1) {
        resultsHTML += `
            <div class="pagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; padding: 10px;">
                <span>Page ${currentPage} of ${totalPages}</span>
                <div style="display: flex; align-items: center; gap: 5px;">
        `;
        
        // Previous button
        if (currentPage > 1) {
            resultsHTML += `<button class="btn btn-outline btn-sm" onclick="window.prevPage()">« Previous</button>`;
        } else {
            resultsHTML += `<button class="btn btn-outline btn-sm" disabled>« Previous</button>`;
        }
        
        // Page numbers
        const maxVisiblePages = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        
        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        
        if (startPage > 1) {
            resultsHTML += `<button class="btn btn-outline btn-sm" onclick="window.goToPage(1)">1</button>`;
            if (startPage > 2) {
                resultsHTML += `<span>...</span>`;
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            if (i === currentPage) {
                resultsHTML += `<button class="btn btn-primary btn-sm">${i}</button>`;
            } else {
                resultsHTML += `<button class="btn btn-outline btn-sm" onclick="window.goToPage(${i})">${i}</button>`;
            }
        }
        
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                resultsHTML += `<span>...</span>`;
            }
            resultsHTML += `<button class="btn btn-outline btn-sm" onclick="window.goToPage(${totalPages})">${totalPages}</button>`;
        }
        
        // Next button
        if (currentPage < totalPages) {
            resultsHTML += `<button class="btn btn-outline btn-sm" onclick="window.nextPage()">Next »</button>`;
        } else {
            resultsHTML += `<button class="btn btn-outline btn-sm" disabled>Next »</button>`;
        }
        
        resultsHTML += `
                </div>
            </div>
        `;
    }
    
    resultsHTML += `
            </div>
        </div>
    `;
    
    resultsContainer.innerHTML = resultsHTML;
    
    // Add event listeners to the view enrollments buttons
    const viewEnrollmentsBtns = document.querySelectorAll('.view-enrollments-btn');
    viewEnrollmentsBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const userId = this.getAttribute('data-userid');
            const username = this.getAttribute('data-username');
            const displayName = this.getAttribute('data-displayname');
            fetchUserEnrollments(userId, displayName || username);
        });
    });
}

function filterEnrollments(query) {
    const normalizedQuery = (query || '').toLowerCase().trim();
    filteredCourseOfferings = allCourseOfferings.filter((enrollment) => {
        const orgUnit = enrollment.OrgUnit || {};
        const role = enrollment.Role || {};
        const semester = extractSemesterLabel(enrollment);
        const searchableText = [
            orgUnit.Id,
            orgUnit.Name,
            orgUnit.Code,
            role.Name,
            semester
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        const matchesSearch = !normalizedQuery || searchableText.includes(normalizedQuery);
        const matchesSemester = enrollmentSemesterFilter === 'all' || semester === enrollmentSemesterFilter;
        const matchesRole = enrollmentRoleFilter === 'all' || (role.Name || '') === enrollmentRoleFilter;

        return matchesSearch && matchesSemester && matchesRole;
    });
}

function extractSemesterLabel(enrollment) {
    const orgUnit = enrollment.OrgUnit || {};
    const candidate = `${orgUnit.Code || ''} ${orgUnit.Name || ''}`;
    const match = candidate.match(/\b\d{2}\/[A-Z]{2}\b/i);
    return match ? match[0].toUpperCase() : '';
}

function getEnrollmentFilterOptions() {
    const semesters = new Set();
    const roles = new Set();

    allCourseOfferings.forEach((enrollment) => {
        const semester = extractSemesterLabel(enrollment);
        if (semester) semesters.add(semester);
        const roleName = enrollment?.Role?.Name || '';
        if (roleName) roles.add(roleName);
    });

    const sortedSemesters = Array.from(semesters).sort((a, b) => b.localeCompare(a));
    const sortedRoles = Array.from(roles).sort((a, b) => a.localeCompare(b));

    return { sortedSemesters, sortedRoles };
}

async function fetchAllUserEnrollments(userId) {
    const allItems = [];
    let bookmark = null;
    let pageCount = 0;
    const maxPages = 250;
    const seenBookmarks = new Set();

    while (pageCount < maxPages) {
        let endpoint = `/d2l/api/lp/1.46/enrollments/users/${userId}/orgUnits/?pageSize=200`;
        if (bookmark) {
            endpoint += `&bookmark=${encodeURIComponent(bookmark)}`;
        }

        const page = await BrightspaceFetch(endpoint, 'GET');
        const items = Array.isArray(page?.Items) ? page.Items : [];
        allItems.push(...items);

        const paging = page?.PagingInfo || {};
        const hasMore = Boolean(paging.HasMoreItems || paging.hasMoreItems);
        const nextBookmark = paging.Bookmark || paging.bookmark || null;

        if (!hasMore || !nextBookmark || seenBookmarks.has(nextBookmark)) {
            break;
        }

        seenBookmarks.add(nextBookmark);
        bookmark = nextBookmark;
        pageCount += 1;
    }

    return allItems;
}

function renderEnrollmentsTable(enrollmentsContent) {
    const totalPages = Math.max(1, Math.ceil(filteredCourseOfferings.length / ENROLLMENTS_PER_PAGE));
    if (enrollmentCurrentPage > totalPages) {
        enrollmentCurrentPage = totalPages;
    }

    const startIndex = (enrollmentCurrentPage - 1) * ENROLLMENTS_PER_PAGE;
    const endIndex = Math.min(startIndex + ENROLLMENTS_PER_PAGE, filteredCourseOfferings.length);
    const displayOfferings = filteredCourseOfferings.slice(startIndex, endIndex);

    const { sortedSemesters, sortedRoles } = getEnrollmentFilterOptions();

    let enrollmentsHTML = `
        <div style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee); background: var(--bg-secondary, #fafafa);">
            <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                <input 
                    type="text" 
                    id="enrollment-search-input" 
                    class="form-control" 
                    placeholder="Search enrollments by course name, code, org unit ID, or role"
                    value="${enrollmentSearchQuery.replace(/"/g, '&quot;')}"
                    style="min-width: 280px; flex: 1;"
                />
                <select id="enrollment-semester-filter" class="form-control" style="min-width: 140px; max-width: 180px;">
                    <option value="all">All Semesters</option>
                    ${sortedSemesters.map((semester) => `<option value="${semester}" ${enrollmentSemesterFilter === semester ? 'selected' : ''}>${semester}</option>`).join('')}
                </select>
                <select id="enrollment-role-filter" class="form-control" style="min-width: 160px; max-width: 220px;">
                    <option value="all">All Roles</option>
                    ${sortedRoles.map((roleName) => `<option value="${roleName.replace(/"/g, '&quot;')}" ${enrollmentRoleFilter === roleName ? 'selected' : ''}>${roleName}</option>`).join('')}
                </select>
                <span style="font-size: 13px; color: var(--text-secondary, #666);">
                    Showing ${filteredCourseOfferings.length} of ${allCourseOfferings.length} enrollments
                </span>
            </div>
        </div>
    `;

    if (filteredCourseOfferings.length === 0) {
        enrollmentsHTML += `
            <div style="padding: 20px;">
                <p style="margin: 0;">No enrollments match your search.</p>
            </div>
        `;
        enrollmentsContent.innerHTML = enrollmentsHTML;
        return;
    }

    enrollmentsHTML += `
        <div class="table-container" style="overflow-x: auto;">
            <table class="data-table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                <thead>
                    <tr style="background-color: var(--bg-secondary, #f5f5f5);">
                        <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Org Unit ID</th>
                        <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Course Name</th>
                        <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Course Code</th>
                        <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap;">Role</th>
                        <th style="padding: 12px 16px; text-align: center; font-weight: 600; border-bottom: 2px solid var(--border-color, #ddd); white-space: nowrap; min-width: 120px;">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    displayOfferings.forEach((enrollment, index) => {
        const orgUnit = enrollment.OrgUnit || {};
        const role = enrollment.Role || {};
        const rowStyle = index % 2 === 0 ? 'background-color: #fff;' : 'background-color: #fafafa;';

        enrollmentsHTML += `
            <tr style="${rowStyle}">
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">${orgUnit.Id || 'N/A'}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee); font-weight: 500;">${orgUnit.Name || 'N/A'}</td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">
                    <a href="https://your-brightspace.example.edu/d2l/home/${orgUnit.Id}" 
                       target="_blank" 
                       style="color: var(--primary, #007bff); text-decoration: underline; font-weight: 500;">
                        ${orgUnit.Code || 'N/A'}
                    </a>
                </td>
                <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee);">${role.Name || 'N/A'}</td>
                <td class="table-actions" style="padding: 12px 16px; border-bottom: 1px solid var(--border-color, #eee); text-align: center;">
                    <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                        <a href="https://your-brightspace.example.edu/d2l/lp/manageCourses/course_offering_info_viewedit.d2l?ou=${orgUnit.Id}" 
                           class="btn-icon-small" 
                           target="_blank" 
                           title="Course Info"
                           style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; background-color: var(--primary, #007bff); color: white; border: none; border-radius: 4px; text-decoration: none; cursor: pointer;">
                            <i class="fa-solid fa-info-circle"></i>
                        </a>
                        <a href="https://your-brightspace.example.edu/d2l/lms/classlist/classlist.d2l?ou=${orgUnit.Id}" 
                           class="btn-icon-small" 
                           target="_blank" 
                           title="View Classlist"
                           style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; background-color: var(--success, #28a745); color: white; border: none; border-radius: 4px; text-decoration: none; cursor: pointer;">
                            <i class="fa-solid fa-users"></i>
                        </a>
                    </div>
                </td>
            </tr>
        `;
    });

    enrollmentsHTML += `
                </tbody>
            </table>
        </div>
    `;

    if (totalPages > 1) {
        const maxVisiblePages = 5;
        let startPage = Math.max(1, enrollmentCurrentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        enrollmentsHTML += `
            <div class="pagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; padding: 10px;">
                <span>Page ${enrollmentCurrentPage} of ${totalPages}</span>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <button class="btn btn-outline btn-sm" id="enrollment-prev-page" ${enrollmentCurrentPage === 1 ? 'disabled' : ''}>« Previous</button>
        `;

        if (startPage > 1) {
            enrollmentsHTML += `<button class="btn btn-outline btn-sm enrollment-page-btn" data-page="1">1</button>`;
            if (startPage > 2) {
                enrollmentsHTML += `<span>...</span>`;
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            if (i === enrollmentCurrentPage) {
                enrollmentsHTML += `<button class="btn btn-primary btn-sm">${i}</button>`;
            } else {
                enrollmentsHTML += `<button class="btn btn-outline btn-sm enrollment-page-btn" data-page="${i}">${i}</button>`;
            }
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                enrollmentsHTML += `<span>...</span>`;
            }
            enrollmentsHTML += `<button class="btn btn-outline btn-sm enrollment-page-btn" data-page="${totalPages}">${totalPages}</button>`;
        }

        enrollmentsHTML += `
                    <button class="btn btn-outline btn-sm" id="enrollment-next-page" ${enrollmentCurrentPage === totalPages ? 'disabled' : ''}>Next »</button>
                </div>
            </div>
        `;
    }

    enrollmentsContent.innerHTML = enrollmentsHTML;

    const searchInput = document.getElementById('enrollment-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            const query = event.target.value;
            const caretPosition = event.target.selectionStart ?? query.length;
            enrollmentSearchQuery = query;
            enrollmentCurrentPage = 1;
            filterEnrollments(query);
            renderEnrollmentsTable(enrollmentsContent);
            const refreshedInput = document.getElementById('enrollment-search-input');
            if (refreshedInput) {
                refreshedInput.focus();
                const safeCaretPosition = Math.min(caretPosition, refreshedInput.value.length);
                refreshedInput.setSelectionRange(safeCaretPosition, safeCaretPosition);
            }
        });
    }

    const semesterFilterSelect = document.getElementById('enrollment-semester-filter');
    if (semesterFilterSelect) {
        semesterFilterSelect.addEventListener('change', (event) => {
            enrollmentSemesterFilter = event.target.value;
            enrollmentCurrentPage = 1;
            filterEnrollments(enrollmentSearchQuery);
            renderEnrollmentsTable(enrollmentsContent);
        });
    }

    const roleFilterSelect = document.getElementById('enrollment-role-filter');
    if (roleFilterSelect) {
        roleFilterSelect.addEventListener('change', (event) => {
            enrollmentRoleFilter = event.target.value;
            enrollmentCurrentPage = 1;
            filterEnrollments(enrollmentSearchQuery);
            renderEnrollmentsTable(enrollmentsContent);
        });
    }

    const prevBtn = document.getElementById('enrollment-prev-page');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (enrollmentCurrentPage > 1) {
                enrollmentCurrentPage -= 1;
                renderEnrollmentsTable(enrollmentsContent);
            }
        });
    }

    const nextBtn = document.getElementById('enrollment-next-page');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (enrollmentCurrentPage < totalPages) {
                enrollmentCurrentPage += 1;
                renderEnrollmentsTable(enrollmentsContent);
            }
        });
    }

    const pageButtons = document.querySelectorAll('.enrollment-page-btn');
    pageButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const targetPage = Number(button.getAttribute('data-page'));
            if (!Number.isNaN(targetPage)) {
                enrollmentCurrentPage = targetPage;
                renderEnrollmentsTable(enrollmentsContent);
            }
        });
    });
}

// Function to fetch user enrollments
async function fetchUserEnrollments(userId, displayName) {
    console.log(`Fetching enrollments for user ${userId}`);
    
    // Create enrollments container if it doesn't exist
    let enrollmentsContainer = document.getElementById('enrollments-container');
    if (!enrollmentsContainer) {
        const resultsContainer = document.getElementById('search-results');
        if (resultsContainer) {
            enrollmentsContainer = document.createElement('div');
            enrollmentsContainer.id = 'enrollments-container';
            enrollmentsContainer.className = 'card';
            enrollmentsContainer.style.display = 'none';
            enrollmentsContainer.style.marginTop = 'var(--spacing-lg)';
            enrollmentsContainer.style.borderRadius = '8px';
            enrollmentsContainer.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            enrollmentsContainer.style.overflow = 'hidden';
            enrollmentsContainer.innerHTML = `
                <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border-color, #eee);">
                    <h3 id="enrollments-title" style="margin: 0; font-size: 18px; font-weight: 600;">User Enrollments</h3>
                    <div style="display: flex; gap: 8px;">
                        <button id="reset-enrollments" class="btn btn-outline btn-sm" style="padding: 6px 12px; font-size: 13px;">
                            <i class="fa-solid fa-sync-alt"></i> Reset
                        </button>
                        <button id="close-enrollments" class="btn btn-outline btn-sm" style="padding: 6px 12px; font-size: 13px;">
                            <i class="fa-solid fa-times"></i>
                        </button>
                    </div>
                </div>
                <div id="enrollments-content" class="card-body" style="padding: 0;"></div>
            `;
            resultsContainer.parentNode.insertBefore(enrollmentsContainer, resultsContainer.nextSibling);
        } else {
            console.error('Cannot create enrollments container - search results container not found');
            return;
        }
    }
    
    const enrollmentsContent = document.getElementById('enrollments-content');
    const enrollmentsTitle = document.getElementById('enrollments-title');
    
    // Set the title and show the container
    enrollmentsTitle.textContent = `Course Enrollments for ${displayName}`;
    enrollmentsContainer.style.display = 'block';
    
    // Scroll to the enrollments container
    enrollmentsContainer.scrollIntoView({ behavior: 'smooth' });
    
    // Show loading spinner
    enrollmentsContent.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <i class="fa-solid fa-spinner fa-spin"></i> Loading enrollments...
        </div>
    `;
    
    try {
        // Call the Brightspace API and follow bookmarks so all pages are included.
        const allEnrollmentItems = await fetchAllUserEnrollments(userId);
        console.log(`Fetched enrollments`, allEnrollmentItems.length);

        if (allEnrollmentItems.length === 0) {
            enrollmentsContent.innerHTML = '<p>No enrollments found for this user.</p>';
            return;
        }
        
        // Filter to only show Course Offerings (Type ID = 3)
        const courseOfferings = allEnrollmentItems.filter(enrollment => 
            enrollment?.OrgUnit?.Type?.Id === 3
        );
        
        if (courseOfferings.length === 0) {
            enrollmentsContent.innerHTML = '<p>No course enrollments found for this user.</p>';
            return;
        }
        
        currentEnrollmentUserId = userId;
        currentEnrollmentDisplayName = displayName;
        allCourseOfferings = [...courseOfferings];
        filteredCourseOfferings = [...courseOfferings];
        enrollmentCurrentPage = 1;
        enrollmentSearchQuery = '';
        enrollmentSemesterFilter = 'all';
        enrollmentRoleFilter = 'all';
        renderEnrollmentsTable(enrollmentsContent);
        
    } catch (error) {
        console.log(`Error fetching enrollments: ${error.message}`);
        enrollmentsContent.innerHTML = `
            <p class="text-danger">
                <i class="fa-solid fa-exclamation-triangle"></i> 
                Error loading enrollments: ${error.message}
            </p>
        `;
    }
    
    // Setup close and reset buttons
    const closeBtn = document.getElementById('close-enrollments');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            enrollmentsContainer.style.display = 'none';
        });
    }
    
    const resetBtn = document.getElementById('reset-enrollments');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (currentEnrollmentUserId) {
                fetchUserEnrollments(currentEnrollmentUserId, currentEnrollmentDisplayName);
                return;
            }
            enrollmentsContent.innerHTML = '<p>Enrollments have been reset. Click a "View Enrollments" button to load new data.</p>';
        });
    }
}

// Pagination functions
window.prevPage = function() {
    if (currentPage > 1) {
        currentPage--;
        displayUserResults(totalFilteredUsers);
    }
};

window.nextPage = function() {
    const totalPages = Math.ceil(totalFilteredUsers.length / USERS_PER_PAGE);
    if (currentPage < totalPages) {
        currentPage++;
        displayUserResults(totalFilteredUsers);
    }
};

window.goToPage = function(page) {
    currentPage = page;
    displayUserResults(totalFilteredUsers);
};

// Initialize the search form
document.addEventListener('DOMContentLoaded', function() {
    const searchForm = document.querySelector('.search-controls');
    if (searchForm) {
        // Set default search type to OrgDefinedId
        const searchTypeSelect = document.getElementById('searchType');
        if (searchTypeSelect) {
            searchTypeSelect.value = 'OrgDefinedId';
        }

        searchForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const searchTerm = document.getElementById('searchTerm').value.trim();
            const searchType = document.getElementById('searchType').value;
            
            if (!searchTerm) {
                alert('Please enter a search term');
                return;
            }
            
            const resultsContainer = document.getElementById('search-results');
            if (!resultsContainer) {
                // Create results container if it doesn't exist
                const formContainer = document.querySelector('.form-container');
                if (formContainer) {
                    const newContainer = document.createElement('div');
                    newContainer.id = 'search-results';
                    formContainer.appendChild(newContainer);
                } else {
                    console.error('Cannot create results container - form container not found');
                    return;
                }
            }
            
            const searchButton = searchForm.querySelector('button[type="submit"]');
            
            // Update UI to show loading state
            const resultsContainerEl = document.getElementById('search-results');
            resultsContainerEl.innerHTML = '<div class="card"><div class="card-body" style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div></div>';
            if (searchButton) {
                searchButton.disabled = true;
                const originalHTML = searchButton.innerHTML;
                searchButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching...';
                
                try {
                    // Hide any previously displayed enrollments
                    const enrollmentsContainer = document.getElementById('enrollments-container');
                    if (enrollmentsContainer) {
                        enrollmentsContainer.style.display = 'none';
                    }
                    
                    const users = await searchUser(searchTerm, searchType);
                    displayUserResults(users);
                } catch (error) {
                    resultsContainerEl.innerHTML = `<div class="card"><div class="card-body"><p class="text-danger"><i class="fa-solid fa-exclamation-triangle"></i> Error: ${error.message}</p></div></div>`;
                } finally {
                    // Reset search button
                    if (searchButton) {
                        searchButton.disabled = false;
                        searchButton.innerHTML = originalHTML;
                    }
                }
            }
        });
    } else {
        console.error("Search form not found");
    }
});
