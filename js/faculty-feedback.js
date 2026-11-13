/**
 * Faculty Feedback Check Page
 * Manages course flags for faculty feedback follow-up using Supabase
 */

const INSTRUCTOR_ROLE_ID = 102;
const LE_VERSION = "1.78";
let resultsTable = null;
let allFlags = [];
let courseCache = {}; // Cache course data from D2L

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📊 Initializing Faculty Feedback page...');

    // Check Supabase connection
    if (!window.supabaseClient) {
        console.error('❌ Supabase client not available');
        document.getElementById('loading-indicator').innerHTML = 
            '<div style="color: var(--danger-color);">Error: Supabase not configured. Please check your configuration.</div>';
        return;
    }

    // Set up event handlers
    document.getElementById('add-flag-btn').addEventListener('click', handleAddFlag);
    document.getElementById('download-csv-btn').addEventListener('click', handleDownloadCSV);
    document.getElementById('refresh-data-btn').addEventListener('click', loadFlags);
    document.getElementById('status-filter').addEventListener('change', filterAndDisplayResults);
    document.getElementById('bulk-complete-btn').addEventListener('click', handleBulkComplete);
    document.getElementById('select-all-checkbox').addEventListener('change', handleSelectAll);

    // Load flags
    await loadFlags();
});

/**
 * Load all flags from Supabase
 */
async function loadFlags() {
    const loadingIndicator = document.getElementById('loading-indicator');
    const resultsContainer = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');
    const resultsCount = document.getElementById('results-count');

    loadingIndicator.style.display = 'block';
    resultsContainer.style.display = 'none';
    emptyMessage.style.display = 'none';
    resultsCount.textContent = 'Loading...';

    try {
        const { data, error } = await window.supabaseClient
            .from('faculty_feedback')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        allFlags = data || [];
        console.log(`✅ Loaded ${allFlags.length} flags from Supabase`);

        // Enrich with D2L course data
        await enrichFlagsWithCourseData();

        filterAndDisplayResults();

    } catch (error) {
        console.error('❌ Error loading flags:', error);
        loadingIndicator.innerHTML = 
            '<div style="color: var(--danger-color);">Error loading flags. The faculty_feedback table may not exist yet. Please run the SQL setup script.</div>';
        resultsCount.textContent = 'Error';
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

/**
 * Enrich flags with course data from D2L API
 */
async function enrichFlagsWithCourseData() {
    console.log('📚 Enriching flags with D2L course data...');
    
    for (const flag of allFlags) {
        try {
            // Get course info from D2L
            if (!courseCache[flag.org_unit_id]) {
                const courseInfo = await getCourseInfo(flag.org_unit_id);
                courseCache[flag.org_unit_id] = courseInfo;
            }

            // Get instructor info if instructor_id is provided
            if (flag.instructor_id && !courseCache[flag.org_unit_id].instructors) {
                const instructorInfo = await getInstructorInfo(flag.org_unit_id, flag.instructor_id);
                if (courseCache[flag.org_unit_id]) {
                    courseCache[flag.org_unit_id].instructors = instructorInfo.names || '';
                    courseCache[flag.org_unit_id].instructorEmails = instructorInfo.emails || '';
                }
            } else if (!flag.instructor_id) {
                // Get all instructors if no specific instructor_id
                const instructorInfo = await getInstructorInfo(flag.org_unit_id);
                if (courseCache[flag.org_unit_id]) {
                    courseCache[flag.org_unit_id].instructors = instructorInfo.names || '';
                    courseCache[flag.org_unit_id].instructorEmails = instructorInfo.emails || '';
                }
            }
        } catch (error) {
            console.warn(`⚠️ Error enriching flag ${flag.id}:`, error);
        }
    }
}

/**
 * Get course information from D2L API
 */
async function getCourseInfo(orgUnitId) {
    try {
        const course = await D2LApi._fetch(
            `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${orgUnitId}`
        );
        return {
            code: course.Code || '',
            name: course.Name || '',
            instructors: '',
            instructorEmails: ''
        };
    } catch (error) {
        console.warn(`⚠️ Error fetching course ${orgUnitId}:`, error);
        return {
            code: 'N/A',
            name: 'Error loading course',
            instructors: '',
            instructorEmails: ''
        };
    }
}

/**
 * Get instructor information for a course
 */
async function getInstructorInfo(orgUnitId, specificInstructorId = null) {
    const names = [];
    const emails = [];
    const seenN = {};
    const seenE = {};
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
            
            // If specific instructor requested, filter
            if (specificInstructorId && normId(r.userId) !== normId(specificInstructorId)) {
                continue;
            }
            
            const fullName = (r.first && r.last) ? (r.first + ' ' + r.last) : (r.display || (r.username || String(r.userId || '')));
            const email = r.email || (r.username ? (r.username + '@example.edu') : '');
            
            if (fullName && !seenN[fullName]) {
                names.push(fullName);
                seenN[fullName] = true;
            }
            if (email && !seenE[email]) {
                emails.push(email);
                seenE[email] = true;
            }
        }
        url = extractNextLink(data);
    }
    
    return {
        names: names.join('; '),
        emails: emails.join('; ')
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
    return {
        userId: item.Identifier || item.UserId || item.User?.Identifier,
        first: item.ProfileIdentifier || item.FirstName || item.User?.FirstName,
        last: item.LastName || item.User?.LastName,
        display: item.DisplayName || item.User?.DisplayName,
        username: item.Username || item.User?.Username,
        email: item.EmailAddress || item.User?.EmailAddress,
        roleId: item.RoleId || item.Role?.Id,
        roleName: item.Role?.Name
    };
}

/**
 * Normalize ID for comparison
 */
function normId(id) {
    return String(id || '').trim();
}

/**
 * Handle Add Flag button click
 */
async function handleAddFlag() {
    const orgUnitId = document.getElementById('new-orgunit-id').value.trim();
    const instructorId = document.getElementById('new-instructor-id').value.trim();

    if (!orgUnitId) {
        alert('Please enter a Course OrgUnitId.');
        return;
    }

    const addBtn = document.getElementById('add-flag-btn');
    addBtn.disabled = true;
    addBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';

    try {
        // Verify course exists
        const courseInfo = await getCourseInfo(orgUnitId);
        if (courseInfo.name === 'Error loading course') {
            throw new Error('Course not found. Please verify the OrgUnitId.');
        }

        // Insert into Supabase
        const { data, error } = await window.supabaseClient
            .from('faculty_feedback')
            .insert({
                org_unit_id: parseInt(orgUnitId),
                instructor_id: instructorId ? parseInt(instructorId) : null,
                status: 'open'
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error('This course is already flagged.');
            }
            throw error;
        }

        console.log('✅ Flag added:', data);

        // Clear form
        document.getElementById('new-orgunit-id').value = '';
        document.getElementById('new-instructor-id').value = '';

        // Reload flags
        await loadFlags();

    } catch (error) {
        console.error('❌ Error adding flag:', error);
        alert('Error adding flag: ' + error.message);
    } finally {
        addBtn.disabled = false;
        addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Flag';
    }
}

/**
 * Filter and display results
 */
function filterAndDisplayResults() {
    const statusFilter = document.getElementById('status-filter').value;
    let filteredFlags = allFlags;

    // Apply status filter
    if (statusFilter !== 'all') {
        filteredFlags = allFlags.filter(flag => flag.status === statusFilter);
    }

    // Update count
    document.getElementById('results-count').textContent = `${filteredFlags.length} flag(s)`;

    // Destroy existing DataTable
    if (resultsTable) {
        resultsTable.destroy();
        resultsTable = null;
    }

    // Show results
    const resultsContainer = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');
    
    if (filteredFlags.length === 0) {
        resultsContainer.style.display = 'none';
        emptyMessage.style.display = 'block';
        return;
    }

    resultsContainer.style.display = 'block';
    emptyMessage.style.display = 'none';

    // Populate table
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    filteredFlags.forEach(flag => {
        const courseInfo = courseCache[flag.org_unit_id] || {
            code: 'Loading...',
            name: 'Loading...',
            instructors: '',
            instructorEmails: ''
        };

        const row = tbody.insertRow();
        row.dataset.flagId = flag.id;
        
        // Checkbox
        const checkboxCell = row.insertCell(0);
        checkboxCell.innerHTML = `<input type="checkbox" class="flag-checkbox" data-flag-id="${flag.id}">`;
        
        row.insertCell(1).textContent = flag.org_unit_id;
        row.insertCell(2).textContent = courseInfo.code;
        row.insertCell(3).textContent = courseInfo.name;
        row.insertCell(4).textContent = courseInfo.instructors || 'N/A';
        row.insertCell(5).textContent = courseInfo.instructorEmails || 'N/A';
        
        // Status
        const statusCell = row.insertCell(6);
        const statusBadge = document.createElement('span');
        statusBadge.className = flag.status === 'open' ? 'badge badge-warning' : 'badge badge-success';
        statusBadge.textContent = flag.status === 'open' ? 'Open' : 'Completed';
        statusCell.appendChild(statusBadge);
        
        row.insertCell(7).textContent = formatDate(flag.created_at);
        row.insertCell(8).textContent = formatDate(flag.updated_at);
        
        // Actions
        const actionsCell = row.insertCell(9);
        if (flag.status === 'open') {
            const completeBtn = document.createElement('button');
            completeBtn.className = 'btn btn-sm btn-outline';
            completeBtn.innerHTML = '<i class="fa-solid fa-check"></i> Complete';
            completeBtn.addEventListener('click', () => handleCompleteFlag(flag.id));
            actionsCell.appendChild(completeBtn);
        } else {
            actionsCell.textContent = '-';
        }
    });

    // Initialize DataTable
    if (window.jQuery && $.fn.DataTable) {
        resultsTable = $('#results-table').DataTable({
            pageLength: 25,
            order: [[7, 'desc']], // Sort by created date
            columnDefs: [
                { targets: [0], orderable: false }
            ]
        });
    }
}

/**
 * Handle Complete Flag
 */
async function handleCompleteFlag(flagId) {
    try {
        const { error } = await window.supabaseClient
            .from('faculty_feedback')
            .update({ 
                status: 'completed',
                updated_at: new Date().toISOString()
            })
            .eq('id', flagId);

        if (error) throw error;

        console.log('✅ Flag marked as completed:', flagId);
        await loadFlags();

    } catch (error) {
        console.error('❌ Error completing flag:', error);
        alert('Error completing flag: ' + error.message);
    }
}

/**
 * Handle Bulk Complete
 */
async function handleBulkComplete() {
    const checkboxes = document.querySelectorAll('.flag-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('Please select at least one flag to complete.');
        return;
    }

    if (!confirm(`Mark ${checkboxes.length} flag(s) as completed?`)) {
        return;
    }

    const flagIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.flagId));

    try {
        const { error } = await window.supabaseClient
            .from('faculty_feedback')
            .update({ 
                status: 'completed',
                updated_at: new Date().toISOString()
            })
            .in('id', flagIds);

        if (error) throw error;

        console.log(`✅ Marked ${flagIds.length} flags as completed`);
        await loadFlags();

    } catch (error) {
        console.error('❌ Error bulk completing flags:', error);
        alert('Error completing flags: ' + error.message);
    }
}

/**
 * Handle Select All checkbox
 */
function handleSelectAll(e) {
    const checkboxes = document.querySelectorAll('.flag-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
    });
}

/**
 * Handle Download CSV
 */
function handleDownloadCSV() {
    if (allFlags.length === 0) {
        alert('No data to export.');
        return;
    }

    const statusFilter = document.getElementById('status-filter').value;
    let filteredFlags = allFlags;

    if (statusFilter !== 'all') {
        filteredFlags = allFlags.filter(flag => flag.status === statusFilter);
    }

    // Create CSV
    const headers = ['OrgUnitId', 'Course Code', 'Course Name', 'Instructor(s)', 'Instructor Email(s)', 'Status', 'Created', 'Updated'];
    const rows = filteredFlags.map(flag => {
        const courseInfo = courseCache[flag.org_unit_id] || {
            code: '',
            name: '',
            instructors: '',
            instructorEmails: ''
        };
        return [
            flag.org_unit_id,
            courseInfo.code,
            courseInfo.name,
            courseInfo.instructors || '',
            courseInfo.instructorEmails || '',
            flag.status,
            formatDate(flag.created_at),
            formatDate(flag.updated_at)
        ];
    });

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `faculty-feedback_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

/**
 * Format date for display
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
