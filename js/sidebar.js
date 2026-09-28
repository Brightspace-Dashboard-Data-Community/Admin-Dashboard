/**
 * Universal Sidebar Component
 * Injects the sidebar navigation into the page and handles active states/interactions.
 */

const sidebarHTML = `
<nav class="sidebar" id="sidebar">
    <div class="sidebar-header">
        <div class="logo">
            <i class="fa-solid fa-layer-group"></i>
            <span class="logo-text">Admin Dash</span>
        </div>
        <button id="sidebar-toggle" class="sidebar-toggle">
            <i class="fa-solid fa-bars"></i>
        </button>
    </div>

    <ul class="nav-links">
        <li class="nav-item" id="nav-dashboard">
            <a href="index.html" class="nav-link">
                <i class="fa-solid fa-house"></i>
                <span class="link-text">Dashboard</span>
            </a>
        </li>
        <li class="nav-item has-submenu" id="nav-user-mgt">
            <a href="#" class="nav-link">
                <i class="fa-solid fa-users"></i>
                <span class="link-text">User Mgt</span>
                <i class="fa-solid fa-chevron-down submenu-icon"></i>
            </a>
            <ul class="submenu">
                <li><a href="user-management-stats.html" class="submenu-link" id="link-stats">Overview</a></li>
                <li><a href="create-user.html" class="submenu-link" id="link-create">Create User</a></li>
                <li><a href="search-user.html" class="submenu-link" id="link-search">Search User</a></li>
                <li><a href="reports/user-merge.html" class="submenu-link" id="link-user-merge">Merge Users</a></li>
                <li><a href="user-list.html" class="submenu-link" id="link-list">User List</a></li>
            </ul>
        </li>
        <li class="nav-item has-submenu" id="nav-course-mgt">
            <a href="#" class="nav-link">
                <i class="fa-solid fa-chalkboard-user"></i>
                <span class="link-text">Course Mgt</span>
                <i class="fa-solid fa-chevron-down submenu-icon"></i>
            </a>
            <ul class="submenu">
                <li><a href="course-management-stats.html" class="submenu-link" id="link-course-stats">Overview</a></li>
                <li><a href="search-course.html" class="submenu-link" id="link-course-search">Search for Courses</a></li>
                <li><a href="create-sandbox.html" class="submenu-link" id="link-create-sandbox">Create a Sandbox</a></li>
                <li><a href="create-course.html" class="submenu-link" id="link-create-course">Create a Course Shell</a></li>
                <li><a href="course-list.html" class="submenu-link" id="link-course-list">View Course List</a></li>
            </ul>
        </li>
        <li class="nav-item has-submenu" id="nav-enrollment-mgt">
            <a href="#" class="nav-link">
                <i class="fa-solid fa-user-graduate"></i>
                <span class="link-text">Enroll Mgt</span>
                <i class="fa-solid fa-chevron-down submenu-icon"></i>
            </a>
            <ul class="submenu">
                <li><a href="enrollment-management-stats.html" class="submenu-link" id="link-enrollment-stats">Overview</a></li>
                <li><a href="create-enrollment.html" class="submenu-link" id="link-create-enrollment">Create Enrollment</a></li>
                <li><a href="manage-enrollment.html" class="submenu-link" id="link-manage-enrollment">Manage Enrollment</a></li>
                <li><a href="batch-enrollment.html" class="submenu-link" id="link-bulk-enrollment">Bulk Enrollment</a></li>
            </ul>
        </li>
        <li class="nav-item has-submenu" id="nav-faculty-success">
            <a href="#" class="nav-link">
                <i class="fa-solid fa-route"></i>
                <span class="link-text">Faculty Success <span class="beta-badge">Beta</span></span>
                <i class="fa-solid fa-chevron-down submenu-icon"></i>
            </a>
            <ul class="submenu">
                <li><a href="faculty-onboarding/command-center.html" class="submenu-link" id="link-fsp-command">Command Center</a></li>
                <li><a href="faculty-onboarding/new-instructor-intake.html" class="submenu-link" id="link-fsp-intake">New Instructor Intake</a></li>
                <li><a href="faculty-onboarding/communication-hub.html" class="submenu-link" id="link-fsp-email">Communication Hub</a></li>
                <li><a href="faculty-onboarding/automation-runner.html" class="submenu-link" id="link-fsp-auto">Automation Runner</a></li>
                <li><a href="faculty-onboarding/leadership-report.html" class="submenu-link" id="link-fsp-leadership">Leadership Report</a></li>
                <li><a href="faculty-orientation-not-enrolled.html" class="submenu-link" id="link-fsp-orient">Faculty Not in Orientation</a></li>
                <li><a href="onboarding-instructors.html" class="submenu-link" id="link-fsp-queue">Action Queue</a></li>
            </ul>
        </li>
        <li class="nav-item" id="nav-reports">
            <a href="reports-tools.html" class="nav-link">
                <i class="fa-solid fa-chart-line"></i>
                <span class="link-text">Reports</span>
            </a>
        </li>
        <li class="nav-item" id="nav-admin-guide">
            <a href="admin-guide.html" class="nav-link">
                <i class="fa-solid fa-calendar-check"></i>
                <span class="link-text">Admin Guide</span>
            </a>
        </li>
        <li class="nav-item" id="nav-division-info">
            <a href="division-info.html" class="nav-link">
                <i class="fa-solid fa-building"></i>
                <span class="link-text">Division Info</span>
            </a>
        </li>
        <li class="nav-item" id="nav-tutorials">
            <a href="tutorials.html" class="nav-link">
                <i class="fa-solid fa-book-open"></i>
                <span class="link-text">Tutorials</span>
            </a>
        </li>
    </ul>


    <div class="sidebar-footer">
        <div class="user-info">
            <div class="avatar" id="user-avatar">AD</div>
            <div class="user-details">
                <span class="user-name" id="user-name">Admin User</span>
                <span class="user-role" id="user-role">Administrator</span>
            </div>
        </div>

    </div>
</nav>
    `;

// Function to initialize the sidebar
function initSidebar() {
    const appContainer = document.querySelector('.app-container');
    if (!appContainer) return;

    // Detect if we're in a subdirectory (like /reports/)
    const path = window.location.pathname;
    const isInSubdirectory = path.includes('/reports/') || path.includes('/faculty-onboarding/');
    const basePath = isInSubdirectory ? '../' : '';

    // Create sidebar HTML with corrected paths
    let sidebarHTMLWithPaths = sidebarHTML;
    
    // Replace all relative hrefs (that don't start with /, #, or http) with base-relative paths
    sidebarHTMLWithPaths = sidebarHTMLWithPaths.replace(/href="([^#/h].*?\.html)"/g, (match, file) => {
        return `href="${basePath}${file}"`;
    });

    // Insert Sidebar at the beginning of app-container
    appContainer.insertAdjacentHTML('afterbegin', sidebarHTMLWithPaths);

    // Determines active page
    setActiveState();

    // Initialize Event Listeners (Toggle & Submenu)
    initSidebarEvents();
}

function setActiveState() {
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'index.html';
    const fullPath = path.toLowerCase();

    // Helper to set active class
    const setActive = (id) => document.getElementById(id)?.classList.add('active');
    const setOpen = (id) => document.getElementById(id)?.classList.add('open');
    const setLinkColor = (id) => {
        const el = document.getElementById(id);
        if (el) {
            el.style.color = 'var(--primary-color)';
            el.style.fontWeight = '500';
        }
    };

    // Initialize APIs if available and update profile
    if (typeof D2LApi !== 'undefined') {
        D2LApi.getWhoAmI().then(user => {
            // Update Sidebar Footer
            const nameElement = document.getElementById('user-name');
            const roleElement = document.getElementById('user-role'); // JSON doesn't have role, keeping static or default
            const avatarElement = document.getElementById('user-avatar');

            if (nameElement) nameElement.textContent = `${user.FirstName} ${user.LastName}`;

            // Initials logic
            if (avatarElement && user.FirstName && user.LastName) {
                avatarElement.textContent = (user.FirstName[0] + user.LastName[0]).toUpperCase();
            }
        });
    }

    if (page === 'index.html' || page === '' || page === 'dashboard-orientation.html') {
        setActive('nav-dashboard');
    } else if (page === 'user-management-stats.html') {
        setActive('nav-user-mgt');
        setOpen('nav-user-mgt');
        setLinkColor('link-stats');
    } else if (page === 'create-user.html') {
        setActive('nav-user-mgt');
        setOpen('nav-user-mgt');
        setLinkColor('link-create');
    } else if (page === 'search-user.html') {
        setActive('nav-user-mgt');
        setOpen('nav-user-mgt');
        setLinkColor('link-search');
    } else if (page === 'user-merge.html') {
        setActive('nav-user-mgt');
        setOpen('nav-user-mgt');
        setLinkColor('link-user-merge');
    } else if (page === 'user-list.html') {
        setActive('nav-user-mgt');
        setOpen('nav-user-mgt');
        setLinkColor('link-list');
    } else if (page === 'course-management-stats.html') {
        setActive('nav-course-mgt');
        setOpen('nav-course-mgt');
        setLinkColor('link-course-stats');
    } else if (page === 'search-course.html') {
        setActive('nav-course-mgt');
        setOpen('nav-course-mgt');
        setLinkColor('link-course-search');
    } else if (page === 'create-sandbox.html') {
        setActive('nav-course-mgt');
        setOpen('nav-course-mgt');
        setLinkColor('link-create-sandbox');
    } else if (page === 'create-course.html') {
        setActive('nav-course-mgt');
        setOpen('nav-course-mgt');
        setLinkColor('link-create-course');
    } else if (page === 'course-list.html') {
        setActive('nav-course-mgt');
        setOpen('nav-course-mgt');
        setLinkColor('link-course-list');
    } else if (page === 'enrollment-management-stats.html') {
        setActive('nav-enrollment-mgt');
        setOpen('nav-enrollment-mgt');
        setLinkColor('link-enrollment-stats');
    } else if (page === 'create-enrollment.html') {
        setActive('nav-enrollment-mgt');
        setOpen('nav-enrollment-mgt');
        setLinkColor('link-create-enrollment');
    } else if (page === 'manage-enrollment.html') {
        setActive('nav-enrollment-mgt');
        setOpen('nav-enrollment-mgt');
        setLinkColor('link-manage-enrollment');
    } else if (page === 'batch-enrollment.html') {
        setActive('nav-enrollment-mgt');
        setOpen('nav-enrollment-mgt');
        setLinkColor('link-bulk-enrollment');
    } else if (page === 'onboarding-instructors.html') {
        setActive('nav-faculty-success');
        setOpen('nav-faculty-success');
        setLinkColor('link-fsp-queue');
    } else if (page === 'faculty-orientation-not-enrolled.html') {
        setActive('nav-faculty-success');
        setOpen('nav-faculty-success');
        setLinkColor('link-fsp-orient');
    } else if (fullPath.includes('/faculty-onboarding/')) {
        setActive('nav-faculty-success');
        setOpen('nav-faculty-success');
        if (page === 'command-center.html') setLinkColor('link-fsp-command');
        else if (page === 'new-instructor-intake.html') setLinkColor('link-fsp-intake');
        else if (page === 'communication-hub.html') setLinkColor('link-fsp-email');
        else if (page === 'automation-runner.html') setLinkColor('link-fsp-auto');
        else if (page === 'leadership-report.html') setLinkColor('link-fsp-leadership');
    } else if (page === 'admin-guide.html') {
        setActive('nav-admin-guide');
    } else if (page === 'reports-tools.html' || fullPath.includes('/reports/') || (page.includes('report') && page.endsWith('.html'))) {
        setActive('nav-reports');
        // No submenu to open or specific link color needed for main item, active class handles it
    } else if (page === 'division-info.html') {
        setActive('nav-division-info');
    } else if (page === 'tutorials.html') {
        setActive('nav-tutorials');
    }
}

function initSidebarEvents() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const body = document.body;

    // Restore state from local storage on load
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState === 'true') {
        body.classList.add('sidebar-collapsed');
    }

    // Toggle Sidebar on Desktop
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            body.classList.toggle('sidebar-collapsed');

            // Save state
            const isCollapsed = body.classList.contains('sidebar-collapsed');
            localStorage.setItem('sidebarCollapsed', isCollapsed);
        });
    }

    // Sidebar Submenu Toggle
    const submenuToggles = document.querySelectorAll('.has-submenu > .nav-link');
    submenuToggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            const parent = toggle.parentElement;
            parent.classList.toggle('open');
        });
    });
}

// Run immediately
initSidebar();

// We also need to fix the mobile menu toggle connection since the button is in the main content header (not this injected sidebar)
// but the functionality interacts with the body class.
// The main app.js handles the button click, but we need to ensure the sidebar element is available for the click-outside check.
