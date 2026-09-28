/**
 * Courses with Zero Enrollments Page
 * Displays a list of Winter 26 courses that have no student enrollments
 */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📊 Initializing Courses with Zero Enrollments page...');

    // Set up refresh button
    const refreshBtn = document.getElementById('refresh-data-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', handleRefresh);
    }

    // Load courses
    await loadCoursesWithZeroEnrollments();
});

/**
 * Handle refresh button click
 */
async function handleRefresh() {
    const refreshBtn = document.getElementById('refresh-data-btn');
    if (!refreshBtn) return;

    // Disable button and show loading state
    refreshBtn.disabled = true;
    const originalHTML = refreshBtn.innerHTML;
    refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing...';

    try {
        // Clear cache to force fresh fetch
        localStorage.removeItem('courses_zero_students_winter26');
        localStorage.removeItem('courses_zero_students_winter26_time');
        localStorage.removeItem('courses_zero_students_details');

        // Reload courses
        await loadCoursesWithZeroEnrollments();

        // Show success feedback
        refreshBtn.innerHTML = '<i class="fa-solid fa-check"></i> Refreshed!';
        setTimeout(() => {
            refreshBtn.innerHTML = originalHTML;
            refreshBtn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('❌ Error during refresh:', error);
        refreshBtn.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Error';
        setTimeout(() => {
            refreshBtn.innerHTML = originalHTML;
            refreshBtn.disabled = false;
        }, 3000);
    }
}

/**
 * Load and display courses with zero student enrollments
 */
async function loadCoursesWithZeroEnrollments() {
    const loadingMessage = document.getElementById('loading-message');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const coursesTableContainer = document.getElementById('courses-table-container');
    const emptyMessage = document.getElementById('empty-message');
    const coursesTbody = document.getElementById('courses-tbody');
    const courseCount = document.getElementById('course-count');

    try {
        // Show loading
        loadingMessage.style.display = 'block';
        errorMessage.style.display = 'none';
        coursesTableContainer.style.display = 'none';
        emptyMessage.style.display = 'none';

        // Get course details from localStorage (stored by getCoursesWithZeroStudentEnrollments)
        const coursesData = localStorage.getItem('courses_zero_students_details');
        
        if (!coursesData) {
            // If no cached data, fetch it by calling the function
            console.log('📥 No cached course details, fetching fresh data...');
            await EnrollmentDataService.getCoursesWithZeroStudentEnrollments();
            
            // Try again after fetching
            const updatedData = localStorage.getItem('courses_zero_students_details');
            if (!updatedData) {
                throw new Error('Could not load course details. Please refresh the enrollment stats page first.');
            }
            
            const courses = JSON.parse(updatedData);
            displayCourses(courses);
        } else {
            const courses = JSON.parse(coursesData);
            displayCourses(courses);
        }

    } catch (error) {
        console.error('❌ Error loading courses:', error);
        loadingMessage.style.display = 'none';
        errorMessage.style.display = 'block';
        errorText.textContent = error.message || 'Failed to load courses. Please try refreshing.';
        coursesTableContainer.style.display = 'none';
        emptyMessage.style.display = 'none';
    }
}

/**
 * Display courses in the table
 */
function displayCourses(courses) {
    const loadingMessage = document.getElementById('loading-message');
    const errorMessage = document.getElementById('error-message');
    const coursesTableContainer = document.getElementById('courses-table-container');
    const emptyMessage = document.getElementById('empty-message');
    const coursesTbody = document.getElementById('courses-tbody');
    const courseCount = document.getElementById('course-count');

    loadingMessage.style.display = 'none';
    errorMessage.style.display = 'none';

    if (!courses || courses.length === 0) {
        emptyMessage.style.display = 'block';
        coursesTableContainer.style.display = 'none';
        courseCount.textContent = '0';
        return;
    }

    // Update count
    courseCount.textContent = courses.length.toLocaleString();

    // Clear table
    coursesTbody.innerHTML = '';

    // Sort courses by code for easier reading
    courses.sort((a, b) => {
        const codeA = (a.code || '').toUpperCase();
        const codeB = (b.code || '').toUpperCase();
        return codeA.localeCompare(codeB);
    });

    // Add courses to table
    courses.forEach(course => {
        const row = document.createElement('tr');
        
        const codeCell = document.createElement('td');
        codeCell.textContent = course.code || 'Unknown';
        codeCell.style.fontWeight = '500';
        
        const nameCell = document.createElement('td');
        nameCell.textContent = course.name || 'Unknown';
        
        const idCell = document.createElement('td');
        idCell.textContent = course.id || 'Unknown';
        idCell.style.fontFamily = 'monospace';
        idCell.style.fontSize = '13px';
        idCell.style.color = '#666';
        
        const actionsCell = document.createElement('td');
        const viewLink = document.createElement('a');
        viewLink.href = `https://your-brightspace.example.edu/d2l/le/content/${course.id}/Home`;
        viewLink.target = '_blank';
        viewLink.className = 'action-link';
        viewLink.innerHTML = '<i class="fa-solid fa-external-link"></i> View in D2L';
        viewLink.title = 'Open course in D2L';
        actionsCell.appendChild(viewLink);
        
        row.appendChild(codeCell);
        row.appendChild(nameCell);
        row.appendChild(idCell);
        row.appendChild(actionsCell);
        
        coursesTbody.appendChild(row);
    });

    coursesTableContainer.style.display = 'block';
    emptyMessage.style.display = 'none';
}
