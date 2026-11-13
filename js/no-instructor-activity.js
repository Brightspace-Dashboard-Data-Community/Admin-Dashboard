/**
 * No Instructor Activity Page
 * Lists courses where instructors have not accessed or had no activity in the last 14+ days
 */

const INSTRUCTOR_ROLE_ID = 102;
const LE_VERSION = "1.78";
let resultsTable = null;
let allResults = [];

function getD2LBaseUrl() {
    const origin = String(window.location?.origin || '').trim();
    if (origin && origin !== 'null') return origin;
    return 'https://your-brightspace.example.edu';
}

function shouldExcludeCourse(course) {
    const code = String(course?.Code || '').trim().toUpperCase();
    const name = String(course?.Name || '').trim().toUpperCase();

    // CXLD: cancelled courses are prefixed with "CXLD -" (and sometimes include CXLD elsewhere)
    if (/^CXLD\s*-/.test(code) || code.includes('CXLD')) return true;

    // MERGED: merged shells often contain MERGED in name and/or code
    if (name.includes('MERGED') || code.includes('MERGED')) return true;

    return false;
}

async function fetchCourseDetails(orgUnitId) {
    const sanitizedId = String(orgUnitId || '').trim();
    if (!sanitizedId) return { endDate: null };

    try {
        const data = await D2LApi._fetch(`/d2l/api/lp/${D2LApi.apiVersion}/courses/${sanitizedId}`);
        return { endDate: data?.EndDate || null };
    } catch (error) {
        console.warn(`⚠️ Error fetching course details for ${sanitizedId}:`, error);
        return { endDate: null };
    }
}

function isCourseOfferingExpired(endDate) {
    if (!endDate) return false;
    const end = new Date(endDate);
    if (Number.isNaN(end.getTime())) return false;
    return end.getTime() < Date.now();
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📊 Initializing No Instructor Activity page...');

    // Set up event handlers
    document.getElementById('run-audit-btn').addEventListener('click', handleRunAudit);
    document.getElementById('download-csv-btn').addEventListener('click', handleDownloadCSV);
    document.getElementById('refresh-data-btn').addEventListener('click', handleRunAudit);
    document.getElementById('days-filter').addEventListener('change', () => {
        if (allResults.length > 0) {
            filterAndDisplayResults();
        }
    });

    // Load semesters
    await loadSemesters();
});

/**
 * Load semesters dropdown
 */
async function loadSemesters() {
    try {
        // Get root org unit ID
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) {
            throw new Error('Could not get organization info');
        }
        
        const rootOrgUnitId = orgInfo.Identifier;
        const select = document.getElementById('semester-select');
        
        // Show loading state
        select.innerHTML = '<option value="">Loading semesters...</option>';
        
        // Fetch semesters (org units with type 5)
        let semesters = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            semesters = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            // Fallback: use _fetch directly
            const response = await D2LApi._fetch(
                `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                semesters = response.Objects;
            } else if (Array.isArray(response)) {
                semesters = response;
            }
        }
        
        if (!Array.isArray(semesters) || semesters.length === 0) {
            throw new Error('No semesters found');
        }
        
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            semesters = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(semesters));
        } else {
            semesters.sort((a, b) => {
                const nameA = (a.Name || '').toLowerCase();
                const nameB = (b.Name || '').toLowerCase();
                return nameB.localeCompare(nameA);
            });
        }
        
        select.innerHTML = '<option value="">Select Semester...</option>';
        semesters.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.Identifier;
            option.textContent = semester.Name;
            select.appendChild(option);
        });
        
        console.log(`✅ Loaded ${semesters.length} semesters`);
    } catch (error) {
        console.error('❌ Error loading semesters:', error);
        const select = document.getElementById('semester-select');
        if (select) {
            select.innerHTML = '<option value="">Error loading semesters</option>';
        }
    }
}

/**
 * Handle Run Audit button click
 */
async function handleRunAudit() {
    const semesterId = document.getElementById('semester-select').value;
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }

    const runBtn = document.getElementById('run-audit-btn');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text');
    const resultsContainer = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');
    const resultsCount = document.getElementById('results-count');

    // Show loading
    runBtn.disabled = true;
    runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running...';
    loadingIndicator.style.display = 'block';
    resultsContainer.style.display = 'none';
    emptyMessage.style.display = 'none';
    resultsCount.textContent = 'Running audit...';

    try {
        loadingText.textContent = 'Loading courses...';
        const courses = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${semesterId}/children/`
        );

        // Filter to Course Offerings only
        const courseOfferings = courses.filter(c => c.Type?.Code === 'Course Offering');
        const filteredOfferings = courseOfferings.filter(c => !shouldExcludeCourse(c));
        console.log(`📚 Found ${courseOfferings.length} course offerings (${filteredOfferings.length} after MERGED/CXLD exclusion)`);

        loadingText.textContent = `Checking ${filteredOfferings.length} courses for instructor activity...`;
        allResults = [];

        // Process courses in batches to avoid overwhelming the API
        const batchSize = 10;
        for (let i = 0; i < filteredOfferings.length; i += batchSize) {
            const batch = filteredOfferings.slice(i, i + batchSize);
            loadingText.textContent = `Checking courses ${i + 1}-${Math.min(i + batchSize, filteredOfferings.length)} of ${filteredOfferings.length}...`;

            const batchResults = await Promise.allSettled(
                batch.map(course => checkCourseInstructorActivity(course))
            );

            batchResults.forEach((result, idx) => {
                if (result.status === 'fulfilled' && result.value) {
                    allResults.push(result.value);
                } else if (result.status === 'rejected') {
                    console.warn(`⚠️ Error checking course ${batch[idx].Identifier}:`, result.reason);
                }
            });
        }

        console.log(`✅ Audit complete. Found ${allResults.length} courses with no instructor activity`);
        filterAndDisplayResults();

    } catch (error) {
        console.error('❌ Error running audit:', error);
        alert('Error running audit: ' + error.message);
        loadingIndicator.style.display = 'none';
        emptyMessage.style.display = 'block';
        emptyMessage.textContent = 'Error running audit. Please try again.';
    } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = '<i class="fa-solid fa-play"></i> Run Audit';
        loadingIndicator.style.display = 'none';
    }
}

/**
 * Check instructor activity for a single course
 */
async function checkCourseInstructorActivity(course) {
    if (shouldExcludeCourse(course)) return null;

    const orgUnitId = course.Identifier;
    const daysThreshold = parseInt(document.getElementById('days-filter').value) || 14;

    try {
        // Skip expired course offerings (EndDate in the past)
        const { endDate } = await fetchCourseDetails(orgUnitId);
        if (isCourseOfferingExpired(endDate)) return null;

        // Get instructor info (reuse logic from empty-course-audit.js)
        const instructorInfo = await getInstructorInfo(orgUnitId);

        // Check if no instructors found
        if (!instructorInfo.names || instructorInfo.names.trim() === '') {
            return {
                orgUnitId: orgUnitId,
                orgDefinedIds: '',
                code: course.Code || '',
                instructors: '',
                instructorEmails: '',
                lastAccess: 'Never',
                lastAccessDate: null,
                daysSinceAccess: null
            };
        }

        // Check last access date
        let lastAccessDate = null;
        if (instructorInfo.lastAccessISO) {
            lastAccessDate = new Date(instructorInfo.lastAccessISO);
        }

        // Determine if meets criteria
        let meetsCriteria = false;
        let daysSinceAccess = null;

        if (!lastAccessDate) {
            // Never accessed
            meetsCriteria = (document.getElementById('days-filter').value === 'never' || daysThreshold >= 14);
            daysSinceAccess = 'Never';
        } else {
            daysSinceAccess = Math.floor((new Date() - lastAccessDate) / (1000 * 60 * 60 * 24));
            meetsCriteria = daysSinceAccess >= daysThreshold;
        }

        if (meetsCriteria) {
            return {
                orgUnitId: orgUnitId,
                orgDefinedIds: instructorInfo.orgDefinedIds || '',
                code: course.Code || '',
                instructors: instructorInfo.names || '',
                instructorEmails: instructorInfo.emails || '',
                lastAccess: instructorInfo.lastAccessISO ? formatDate(instructorInfo.lastAccessISO) : 'Never',
                lastAccessDate: lastAccessDate,
                daysSinceAccess: daysSinceAccess
            };
        }

        return null; // Doesn't meet criteria
    } catch (error) {
        console.warn(`⚠️ Error checking course ${orgUnitId}:`, error);
        return null;
    }
}

/**
 * Get instructor information for a course
 * Reuses logic from empty-course-audit.js
 */
async function getInstructorInfo(orgUnitId) {
    const names = [];
    const emails = [];
    const orgDefinedIds = [];
    const seenN = {};
    const seenE = {};
    const seenO = {};
    let mostRecent = null;
    let url = `/d2l/api/le/${LE_VERSION}/${orgUnitId}/classlist/paged/?pageSize=100`;
    
    while (url) {
        let data;
        try {
            data = await D2LApi._fetch(url);
        } catch (e) {
            console.warn('WARN classlist/paged failed for OU ' + orgUnitId + ': ' + e.message);
            break;
        }

        const items = extractPagedItems(data);
        if (!items.length) {
            url = extractNextLink(data);
            if (!url) break;
            continue;
        }
        
        for (let i = 0; i < items.length; i++) {
            const r = unpackClasslistRow(items[i]);
            const isInstructor = (normId(r.roleId) === normId(INSTRUCTOR_ROLE_ID)) || (/instructor/i.test(String(r.roleName || '')));
            if (!isInstructor) continue;
            
            const fullName = (r.first && r.last) ? (r.first + ' ' + r.last) : (r.display || (r.username || String(r.userId || '')));
            const email = r.email || (r.username ? (r.username + '@example.edu') : '');
            const orgDefinedId = String(r.orgDefinedId || '').trim();
            
            if (r.lastAccessRaw) {
                const d = new Date(r.lastAccessRaw);
                if (!isNaN(d.getTime()) && (mostRecent === null || d > mostRecent)) {
                    mostRecent = d;
                }
            }
            
            if (fullName && !seenN[fullName]) {
                names.push(fullName);
                seenN[fullName] = true;
            }
            if (email && !seenE[email]) {
                emails.push(email);
                seenE[email] = true;
            }
            if (orgDefinedId && !seenO[orgDefinedId]) {
                orgDefinedIds.push(orgDefinedId);
                seenO[orgDefinedId] = true;
            }
        }
        url = extractNextLink(data);
    }
    
    return {
        names: names.join('; '),
        emails: emails.join('; '),
        orgDefinedIds: orgDefinedIds.join('; '),
        lastAccessISO: (mostRecent ? toISODate(mostRecent) : '')
    };
}

/**
 * Extract paged items from D2L API response
 */
function extractPagedItems(data) {
    if (Array.isArray(data)) return data;
    if (data.Items && Array.isArray(data.Items)) return data.Items;
    if (data.Objects && Array.isArray(data.Objects)) return data.Objects;
    return [];
}

/**
 * Extract next link from D2L API response
 */
function extractNextLink(data) {
    if (data.Next) return data.Next;
    if (data.NextPageUrl) {
        const nextUrl = new URL(data.NextPageUrl, window.location.origin);
        return nextUrl.pathname + nextUrl.search;
    }
    return null;
}

/**
 * Unpack classlist row
 */
function unpackClasslistRow(item) {
    const user = item?.User || {};
    return {
        userId: item.Identifier || item.UserId || user.Identifier,
        first: item.FirstName || user.FirstName,
        last: item.LastName || user.LastName,
        display: item.DisplayName || user.DisplayName,
        username: item.Username || user.Username,
        email: item.Email || item.EmailAddress || user.Email || user.EmailAddress || user.ExternalEmail,
        orgDefinedId: item.OrgDefinedId || user.OrgDefinedId,
        roleId: item.RoleId || item.Role?.Id || item.RoleId,
        roleName: item.Role?.Name,
        lastAccessRaw: item.LastAccessed || item.LastAccessDate || user.LastAccessed
    };
}

/**
 * Normalize ID for comparison
 */
function normId(id) {
    return String(id || '').trim();
}

/**
 * Convert date to ISO string (YYYY-MM-DD)
 */
function toISODate(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = ('0' + (dt.getMonth() + 1)).slice(-2);
    const da = ('0' + dt.getDate()).slice(-2);
    return y + '-' + m + '-' + da;
}

/**
 * Format date for display
 */
function formatDate(dateString) {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Never';
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Filter and display results based on current filter
 */
function filterAndDisplayResults() {
    const daysThreshold = parseInt(document.getElementById('days-filter').value) || 14;
    const filterValue = document.getElementById('days-filter').value;

    let filteredResults = allResults;

    // Apply filter
    if (filterValue === 'never') {
        filteredResults = allResults.filter(r => r.daysSinceAccess === 'Never' || r.daysSinceAccess === null);
    } else {
        filteredResults = allResults.filter(r => {
            if (r.daysSinceAccess === 'Never' || r.daysSinceAccess === null) {
                return daysThreshold >= 14; // Include "never" if threshold is 14+
            }
            return r.daysSinceAccess >= daysThreshold;
        });
    }

    // Update count
    document.getElementById('results-count').textContent = `${filteredResults.length} course(s) found`;

    // Destroy existing DataTable
    if (resultsTable) {
        resultsTable.destroy();
        resultsTable = null;
    }

    // Show results
    const resultsContainer = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');
    
    if (filteredResults.length === 0) {
        resultsContainer.style.display = 'none';
        emptyMessage.style.display = 'block';
        emptyMessage.textContent = 'No courses found matching the criteria.';
        return;
    }

    resultsContainer.style.display = 'block';
    emptyMessage.style.display = 'none';

    // Populate table
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    const baseUrl = getD2LBaseUrl();

    filteredResults.forEach(result => {
        const row = tbody.insertRow();
        row.insertCell(0).textContent = result.orgUnitId;
        row.insertCell(1).textContent = result.orgDefinedIds || '';

        const codeCell = row.insertCell(2);
        const a = document.createElement('a');
        a.href = `${baseUrl}/d2l/home/${encodeURIComponent(result.orgUnitId)}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = result.code;
        codeCell.appendChild(a);

        row.insertCell(3).textContent = result.instructors || 'N/A';
        row.insertCell(4).textContent = result.instructorEmails || 'N/A';
        row.insertCell(5).textContent = result.lastAccess;
        row.insertCell(6).textContent = result.daysSinceAccess === 'Never' ? 'Never' : `${result.daysSinceAccess} days`;
    });

    // Initialize DataTable
    if (window.jQuery && $.fn.DataTable) {
        resultsTable = $('#results-table').DataTable({
            pageLength: 25,
            order: [[6, 'desc']], // Sort by days since access
            columnDefs: [
                { targets: [0], visible: false } // Hide OrgUnitId by default
            ]
        });
    }
}

/**
 * Handle Download CSV button click
 */
function handleDownloadCSV() {
    if (allResults.length === 0) {
        alert('No data to export. Please run the audit first.');
        return;
    }

    const daysThreshold = parseInt(document.getElementById('days-filter').value) || 14;
    const filterValue = document.getElementById('days-filter').value;
    let filteredResults = allResults;

    // Apply same filter as display
    if (filterValue === 'never') {
        filteredResults = allResults.filter(r => r.daysSinceAccess === 'Never' || r.daysSinceAccess === null);
    } else {
        filteredResults = allResults.filter(r => {
            if (r.daysSinceAccess === 'Never' || r.daysSinceAccess === null) {
                return daysThreshold >= 14;
            }
            return r.daysSinceAccess >= daysThreshold;
        });
    }

    // Create CSV
    const headers = ['OrgUnitId', 'OrgDefinedId', 'Course Code', 'Instructor(s)', 'Email', 'Last Access', 'Days Since Access'];
    const rows = filteredResults.map(r => [
        r.orgUnitId,
        r.orgDefinedIds || '',
        r.code,
        r.instructors || '',
        r.instructorEmails || '',
        r.lastAccess,
        r.daysSinceAccess === 'Never' ? 'Never' : r.daysSinceAccess
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `no-instructor-activity_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
