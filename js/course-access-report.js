/**
 * Course Access Report
 * Tracks student access to courses and identifies inactive students
 */

// DOM Elements
const semesterSelect = document.getElementById('semesterSelect');
const orgUnitCodeInput = document.getElementById('orgUnitCode');
const generateReportBtn = document.getElementById('generateReportBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const tableCard = document.getElementById('tableCard');
const totalStudentsEl = document.getElementById('totalStudents');
const inactiveStudentsEl = document.getElementById('inactiveStudents');
const coursesScannedEl = document.getElementById('coursesScanned');
const statusMessage = document.getElementById('statusMessage');

// Filter checkboxes
const filterNeverAccessed = document.getElementById('filterNeverAccessed');
const filter7days = document.getElementById('filter7days');
const filter14days = document.getElementById('filter14days');
const filter30days = document.getElementById('filter30days');

// Data storage
let accessReportTable;
let reportData = [];
let allStudentsData = [];

// Initialize the application
async function initialize() {
    try {
        // Apply filter from URL (e.g. ?filter=never from dashboard Course Access links)
        const urlParams = new URLSearchParams(window.location.search);
        const filterParam = urlParams.get('filter');
        if (filterParam === 'never') {
            if (filterNeverAccessed) filterNeverAccessed.checked = true;
            if (filter7days) filter7days.checked = false;
            if (filter14days) filter14days.checked = false;
            if (filter30days) filter30days.checked = false;
        } else if (filterParam === '7days') {
            if (filterNeverAccessed) filterNeverAccessed.checked = false;
            if (filter7days) filter7days.checked = true;
            if (filter14days) filter14days.checked = true;
            if (filter30days) filter30days.checked = false;
        } else if (filterParam === '14days') {
            if (filterNeverAccessed) filterNeverAccessed.checked = false;
            if (filter7days) filter7days.checked = true;
            if (filter14days) filter14days.checked = true;
            if (filter30days) filter30days.checked = false;
        } else if (filterParam === '30days') {
            if (filterNeverAccessed) filterNeverAccessed.checked = false;
            if (filter7days) filter7days.checked = true;
            if (filter14days) filter14days.checked = true;
            if (filter30days) filter30days.checked = true;
        }

        // Set up tabs
        setupTabs();
        
        // Load semesters
        await loadSemesters();
        
        // Set up event listeners
        setupEventListeners();
        
        // Initialize loading container
        const loadingContainer = LoadingUtils.createLoadingBar('loadingContainer');
        document.querySelector('#report-tab .card').appendChild(loadingContainer);
        
        console.log('✅ Course Access Report initialized');
    } catch (error) {
        console.error('❌ Failed to initialize:', error);
        showStatusMessage('Error initializing the application. Please try again.', 'error');
    }
}

// Set up tab functionality
function setupTabs() {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });
}

// Load semester list into dropdown
async function loadSemesters() {
    try {
        // Show loading indicator
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(10, 'Loading semesters...', 'loadingContainer');
        
        // Get root org unit ID
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) {
            throw new Error('Could not get organization info');
        }
        
        const rootOrgUnitId = orgInfo.Identifier;
        LoadingUtils.updateLoadingBar(30, 'Fetching semester data...', 'loadingContainer');
        
        // Fetch semesters (org units with type 5)
        let semesters = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            semesters = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            // Fallback: use _fetch directly
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
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
        
        LoadingUtils.updateLoadingBar(70, 'Processing semester data...', 'loadingContainer');
        
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            semesters = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(semesters));
        } else {
            semesters.sort((a, b) => {
                const nameA = a.Name.toLowerCase();
                const nameB = b.Name.toLowerCase();
                return nameB.localeCompare(nameA);
            });
        }
        
        semesters.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.Identifier;
            option.textContent = semester.Name;
            semesterSelect.appendChild(option);
        });
        
        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
        console.log(`✅ Loaded ${semesters.length} semesters`);
        
        // Hide loading after a moment
        setTimeout(() => {
            LoadingUtils.hideLoadingBar('loadingContainer');
        }, 500);
    } catch (error) {
        console.error('❌ Failed to load semesters:', error);
        LoadingUtils.hideLoadingBar('loadingContainer');
        showStatusMessage(`Failed to load semesters: ${error.message || 'Please check your connection.'}`, 'error');
    }
}

// Set up event listeners for UI controls
function setupEventListeners() {
    generateReportBtn.addEventListener('click', handleGenerateReport);
    downloadCsvBtn.addEventListener('click', handleDownloadCsv);
}

// Show status message to the user
function showStatusMessage(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    statusMessage.classList.add(`status-${type}`);
    statusMessage.style.display = 'block';
    
    // Auto-hide info messages after 5 seconds
    if (type === 'info') {
        setTimeout(() => {
            statusMessage.style.display = 'none';
        }, 5000);
    }
}

// Format date in a user-friendly way
function formatDate(dateString) {
    if (!dateString) return 'Never';
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Never';
    
    return moment(date).format('MMM D, YYYY h:mm A');
}

// Calculate days since last access
function daysSinceAccess(dateString) {
    if (!dateString) return null;
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
}

// Sanitize OrgUnitId (remove $ prefix if present)
function sanitizeOrgUnitId(orgUnitId) {
    if (typeof orgUnitId === 'string' && orgUnitId.startsWith('$')) {
        return orgUnitId.slice(1);
    }
    return orgUnitId;
}

// Initialize or refresh the data table
function initTable(data) {
    if (accessReportTable) {
        accessReportTable.clear().rows.add(data).draw();
    } else {
        accessReportTable = $('#accessReportTable').DataTable({
            data: data,
            columns: [
                { data: 'orgUnitId', title: 'OrgUnitId' },
                { data: 'courseCode', title: 'Course Code' },
                { data: 'courseName', title: 'Course Name' },
                { 
                    data: 'courseStartDate', 
                    title: 'Course Start',
                    render: data => formatDate(data)
                },
                { 
                    data: 'courseEndDate', 
                    title: 'Course End',
                    render: data => formatDate(data)
                },
                { data: 'firstName', title: 'First Name' },
                { data: 'lastName', title: 'Last Name' },
                { data: 'username', title: 'Username' },
                { data: 'orgDefinedId', title: 'OrgDefinedId' },
                { data: 'email', title: 'Email' },
                { 
                    data: 'lastAccessed', 
                    title: 'Last Accessed',
                    render: data => formatDate(data)
                },
                { 
                    data: 'daysSinceAccess', 
                    title: 'Days Since Access',
                    render: data => data === null ? 'Never' : data
                }
            ],
            order: [[11, 'desc']], // Sort by days since access by default
            pageLength: 25,
            dom: '<"top"if>rt<"bottom"lp><"clear">'
        });
    }
    tableCard.style.display = 'block';
    downloadCsvBtn.disabled = data.length === 0;
}

// Apply access filters based on user selection
function applyAccessFilters(data) {
    // Get selected filters
    const neverAccessed = filterNeverAccessed.checked;
    const days7 = filter7days.checked;
    const days14 = filter14days.checked;
    const days30 = filter30days.checked;
    
    // If no filters selected, return all data
    if (!neverAccessed && !days7 && !days14 && !days30) {
        return data;
    }
    
    return data.filter(student => {
        const daysSince = student.daysSinceAccess;
        
        if (neverAccessed && daysSince === null) {
            return true;
        }
        
        if (daysSince !== null) {
            if (days7 && daysSince >= 7) return true;
            if (days14 && daysSince >= 14) return true;
            if (days30 && daysSince >= 30) return true;
        }
        
        return false;
    });
}

// Fetch all courses for a semester with optional filters
async function fetchCoursesForSemester(semesterId, codeFilter = '') {
    try {
        LoadingUtils.updateLoadingBar(10, 'Fetching courses for semester...', 'loadingContainer');
        
        // Get all children of the semester org unit (courses)
        const results = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/`
        );
        
        // Filter for course offerings only
        let courses = results.filter(entry => entry.Type?.Code === 'Course Offering');
        
        // Apply code filter if provided
        if (codeFilter) {
            const codeFilterUpper = codeFilter.toUpperCase();
            courses = courses.filter(course => course.Code && course.Code.toUpperCase().includes(codeFilterUpper));
        }
        
        // Apply MERGED filter
        const mergedSelection = document.querySelector('input[name="includeMerged"]:checked').value;
        
        if (mergedSelection === 'onlyMerged') {
            courses = courses.filter(course => course.Name && course.Name.toUpperCase().includes('MERGED'));
        } else if (mergedSelection === 'noMerged') {
            courses = courses.filter(course => !(course.Name && course.Name.toUpperCase().includes('MERGED')));
        }
        
        LoadingUtils.updateLoadingBar(20, `Found ${courses.length} courses matching criteria`, 'loadingContainer');
        return courses;
    } catch (error) {
        console.error('❌ Failed to fetch courses:', error);
        showStatusMessage('Failed to fetch courses. Please try again.', 'error');
        return [];
    }
}

// Fetch classlist for a course
async function fetchClasslist(orgUnitId) {
    const sanitizedId = sanitizeOrgUnitId(orgUnitId);
    
    try {
        const data = await D2LApi._fetch(`/d2l/api/le/1.49/${sanitizedId}/classlist/`);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error(`❌ Error fetching classlist for course ${sanitizedId}:`, error);
        return [];
    }
}

// Fetch course details to get start and end dates
async function fetchCourseDetails(orgUnitId) {
    const sanitizedId = sanitizeOrgUnitId(orgUnitId);
    
    try {
        const data = await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${sanitizedId}`);
        return {
            startDate: data.StartDate || null,
            endDate: data.EndDate || null
        };
    } catch (error) {
        console.error(`❌ Error fetching course details for ${sanitizedId}:`, error);
        return {
            startDate: null,
            endDate: null
        };
    }
}

// Process a single course's classlist
async function processCourseClasslist(course) {
    try {
        // Get enrolled students
        const classlist = await fetchClasslist(course.Identifier);
        
        if (!Array.isArray(classlist) || classlist.length === 0) {
            console.log(`ℹ️ No students found in course ${course.Code}`);
            return [];
        }
        
        // Fetch course details for start and end dates
        const courseDetails = await fetchCourseDetails(course.Identifier);
        
        // Process each student's access data
        return classlist
            .filter(user => user.RoleId === 101) // Filter for students only (RoleId 101)
            .map(student => {
                // Calculate days since last access
                const days = student.LastAccessed ? daysSinceAccess(student.LastAccessed) : null;
                
                return {
                    orgUnitId: course.Identifier,
                    courseCode: course.Code || '',
                    courseName: course.Name || '',
                    courseStartDate: courseDetails.startDate,
                    courseEndDate: courseDetails.endDate,
                    userId: student.Identifier,
                    firstName: student.FirstName || '',
                    lastName: student.LastName || '',
                    username: student.Username || '',
                    orgDefinedId: student.OrgDefinedId || '',
                    email: student.Email || student.ExternalEmail || '',
                    lastAccessed: student.LastAccessed || null,
                    daysSinceAccess: days
                };
            });
    } catch (error) {
        console.error(`❌ Error processing classlist for course ${course.Identifier}:`, error);
        return [];
    }
}

// Generate the access report based on selected options
async function handleGenerateReport() {
    const semesterId = semesterSelect.value;
    if (!semesterId) {
        showStatusMessage('Please select a semester.', 'warning');
        return;
    }
    
    // Disable buttons during processing
    generateReportBtn.disabled = true;
    downloadCsvBtn.disabled = true;
    
    // Show loading modal
    LoadingUtils.showLoadingModal('Preparing to generate report...');
    
    // Reset data arrays
    reportData = [];
    allStudentsData = [];
    
    try {
        // Get filter values
        const codeFilter = orgUnitCodeInput.value.trim();
        
        // Step 1: Fetch all courses matching criteria
        const courses = await fetchCoursesForSemester(semesterId, codeFilter);
        
        if (courses.length === 0) {
            showStatusMessage('No courses found matching the criteria.', 'warning');
            generateReportBtn.disabled = false;
            LoadingUtils.hideLoadingModal();
            return;
        }
        
        // Step 2: Process courses in batches
        const totalCourses = courses.length;
        const batchSize = 5; // Process 5 courses at a time to avoid overwhelming the API
        let processedCount = 0;
        
        LoadingUtils.updateLoadingBar(25, `Processing ${totalCourses} courses...`, 'loadingContainer');
        LoadingUtils.updateLoadingModal(25, `Processing ${totalCourses} courses...`);
        
        for (let i = 0; i < totalCourses; i += batchSize) {
            const batch = courses.slice(i, Math.min(i + batchSize, totalCourses));
            
            // Process courses in parallel within each batch
            const batchPromises = batch.map(course => processCourseClasslist(course));
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Collect successful results
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value && result.value.length) {
                    allStudentsData = [...allStudentsData, ...result.value];
                }
            });
            
            // Update progress
            processedCount += batch.length;
            const progressPercent = 25 + Math.floor((processedCount / totalCourses) * 65);
            LoadingUtils.updateLoadingBar(progressPercent, `Processed ${processedCount} of ${totalCourses} courses...`, 'loadingContainer');
            LoadingUtils.updateLoadingModal(progressPercent, `Processed ${processedCount} of ${totalCourses} courses...`);
            
            // Small delay between batches to avoid rate limiting
            if (i + batchSize < totalCourses) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        // Step 3: Apply access filters
        LoadingUtils.updateLoadingBar(90, 'Applying filters...', 'loadingContainer');
        LoadingUtils.updateLoadingModal(90, 'Applying filters...');
        reportData = applyAccessFilters(allStudentsData);
        
        // Step 4: Update UI and display data
        LoadingUtils.updateLoadingBar(95, 'Updating display...', 'loadingContainer');
        LoadingUtils.updateLoadingModal(95, 'Updating display...');
        
        // Update summary counts
        totalStudentsEl.textContent = allStudentsData.length;
        
        // Count inactive students (never accessed)
        const inactiveCount = allStudentsData.filter(student => student.daysSinceAccess === null).length;
        inactiveStudentsEl.textContent = inactiveCount;
        
        // Update courses scanned
        coursesScannedEl.textContent = processedCount;
        
        // Initialize table with filtered data
        initTable(reportData);
        
        // Complete processing
        LoadingUtils.updateLoadingBar(100, 'Report generation complete', 'loadingContainer');
        LoadingUtils.updateLoadingModal(100, 'Report generation complete');
        
        if (reportData.length === 0) {
            showStatusMessage('No students match the selected access criteria.', 'info');
        } else {
            showStatusMessage(`Found ${reportData.length} students matching criteria.`, 'info');
        }
    } catch (error) {
        console.error('❌ Error generating report:', error);
        showStatusMessage('Error generating report. Please try again.', 'error');
    } finally {
        // Re-enable the generate button
        generateReportBtn.disabled = false;
        downloadCsvBtn.disabled = reportData.length === 0;
        
        // Hide loading modal
        setTimeout(() => {
            LoadingUtils.hideLoadingModal();
        }, 1000);
    }
}

// Handle CSV download
function handleDownloadCsv() {
    if (reportData.length === 0) {
        showStatusMessage('No data available to download.', 'warning');
        return;
    }
    
    // Define CSV headers
    const headers = [
        'OrgUnitId', 
        'Course Code', 
        'Course Name',
        'Course Start Date',
        'Course End Date',
        'First Name', 
        'Last Name', 
        'Username', 
        'OrgDefinedId', 
        'Email', 
        'Last Accessed', 
        'Days Since Access'
    ];
    
    // Format data for CSV
    const csvRows = [
        headers,
        ...reportData.map(item => [
            item.orgUnitId,
            item.courseCode,
            item.courseName,
            item.courseStartDate ? formatDate(item.courseStartDate) : 'N/A',
            item.courseEndDate ? formatDate(item.courseEndDate) : 'N/A',
            item.firstName,
            item.lastName,
            item.username,
            item.orgDefinedId,
            item.email,
            item.lastAccessed ? formatDate(item.lastAccessed) : 'Never',
            item.daysSinceAccess === null ? 'Never' : item.daysSinceAccess
        ])
    ];
    
    // Create CSV content
    const csvContent = csvRows.map(row => 
        row.map(cell => 
            // Escape quotes and wrap in quotes if contains comma or quote
            typeof cell === 'string' && (cell.includes(',') || cell.includes('"')) 
                ? `"${cell.replace(/"/g, '""')}"` 
                : cell
        ).join(',')
    ).join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const timestamp = moment().format('YYYY-MM-DD_HH-mm');
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `course_access_report_${timestamp}.csv`;
    a.click();
    
    // Clean up
    URL.revokeObjectURL(url);
    
    showStatusMessage('Download started.', 'info');
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);
