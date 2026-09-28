/**
 * Course Search (v2)
 * Reimplements the old tabbed course search using the new D2LApi wrapper.
 */

// Lightweight wrapper around D2LApi._fetch to mirror old BrightspaceFetch behavior
async function BrightspaceFetch(endpoint, method = 'GET', body = null) {
    if (typeof D2LApi !== 'undefined' && D2LApi && typeof D2LApi._fetch === 'function') {
        return D2LApi._fetch(endpoint, {
            method,
            body: body ? JSON.stringify(body) : undefined
        });
    }

    // Fallback direct fetch (should normally not be used in production)
    const options = {
        method,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-Token': localStorage.getItem('XSRF.Token') || ''
        },
        credentials: 'include'
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const res = await fetch(endpoint, options);
    if (!res.ok) {
        throw new Error('Fetch failed: ' + endpoint + ' (' + res.status + ')');
    }
    const ct = res.headers.get('content-type');
    if (ct && ct.indexOf('application/json') !== -1) return res.json();
    if (ct) return res.text();
    return null;
}

let rootOrgUnitId = null;
const COURSE_RESULTS_PAGE_SIZE = 25;
let currentCourseResults = [];
let currentCourseResultsPage = 1;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('✅ search-course.js loaded');

    setupTabs();
    await initializeCourseSearch();
    initializeCourseIdSearch();
});

function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', function () {
            const tabName = this.dataset.tab;
            if (!tabName) return;

            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            this.classList.add('active');
            const target = document.getElementById(`${tabName}-tab`);
            if (target) target.classList.add('active');

            const errorContainer = document.getElementById('error-container');
            const infoContainer = document.getElementById('info-container');
            if (errorContainer) errorContainer.innerHTML = '';
            if (infoContainer) infoContainer.innerHTML = '';
        });
    });
}

async function initializeCourseSearch() {
    await getRootOrgUnitId();
    await loadSemesters();

    const courseSearchForm = document.getElementById('course-search-form');
    if (courseSearchForm) {
        courseSearchForm.addEventListener('submit', handleCourseSearch);
    }

    const resetButton = document.querySelector('#course-tab button[type="reset"]');
    if (resetButton) {
        resetButton.addEventListener('click', () =>
            clearSearchResults('courseSearchResults', 'Use the search box and select a semester to find courses.')
        );
    }
}

function initializeCourseIdSearch() {
    const courseIdForm = document.getElementById('course-id-search-form');
    if (courseIdForm) {
        courseIdForm.addEventListener('submit', handleCourseIdSearch);
    }

    const resetButton = document.querySelector('#id-tab button[type="reset"]');
    if (resetButton) {
        resetButton.addEventListener('click', () =>
            clearSearchResults('idSearchResults', 'Enter a Course ID above to search.')
        );
    }
}

async function getRootOrgUnitId() {
    try {
        const response = await BrightspaceFetch('/d2l/api/lp/1.49/organization/info');
        if (!response.Identifier) {
            throw new Error('Invalid organization data received');
        }
        rootOrgUnitId = response.Identifier;
        console.log('Root OrgUnitId:', rootOrgUnitId);
    } catch (error) {
        console.error('Error fetching organization info:', error);
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.innerHTML =
                "<div class='error'><i class='fas fa-exclamation-circle'></i> Error fetching organization details.</div>";
        }
    }
}

async function loadSemesters() {
    if (!rootOrgUnitId) {
        console.error('Root OrgUnitId is not available.');
        return;
    }

    try {
        const response = await BrightspaceFetch(
            `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
        );

        const specialSemester = { Identifier: '0000', Name: '0000-No Semester' };

        const filteredSemesters = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
            ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(response || []))
            : (response || [])
                .filter(semester => {
                    const semesterId = semester.Identifier || semester.Id;
                    return parseInt(semesterId, 10) >= 2966924 || semesterId === specialSemester.Identifier;
                })
                .sort((a, b) => (b.Name || '').localeCompare(a.Name || ''));

        if (!filteredSemesters.some(sem => (sem.Identifier || sem.Id) === specialSemester.Identifier)) {
            filteredSemesters.push(specialSemester);
        }

        const termSelect = document.getElementById('term');
        if (!termSelect) return;
        termSelect.innerHTML = '<option value="">Select a Semester</option>';

        filteredSemesters.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.Identifier || semester.Id;
            option.textContent = semester.Name;
            termSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading semesters:', error);
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.innerHTML =
                "<div class='error'><i class='fas fa-exclamation-circle'></i> Error loading semesters. Try again later.</div>";
        }
    }
}

async function handleCourseSearch(event) {
    event.preventDefault();

    const errorContainer = document.getElementById('error-container');
    const infoContainer = document.getElementById('info-container');
    if (errorContainer) errorContainer.innerHTML = '';
    if (infoContainer) infoContainer.innerHTML = '';

    const searchInput = document.getElementById('searchQuery');
    const termSelect = document.getElementById('term');
    const searchQuery = (searchInput?.value || '').toLowerCase();
    const semesterId = termSelect?.value || '';

    if (!semesterId) {
        if (errorContainer) {
            errorContainer.innerHTML =
                "<div class='error'><i class='fas fa-exclamation-circle'></i> Please select a semester.</div>";
        }
        return;
    }

    const resultsContainer = document.getElementById('courseSearchResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = `
            <tr>
                <td colspan="7" class="text-center">
                    <span class="loading-spinner"></span> Loading courses...
                </td>
            </tr>
        `;
    }

    try {
        const courses = await fetchCoursesBySemester(semesterId);

        if (!courses.length) {
            if (resultsContainer) {
                resultsContainer.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center">
                            <p class="initial-message">No courses found for this semester.</p>
                        </td>
                    </tr>
                `;
            }
            return;
        }

        const searchTerms = searchQuery
            .toLowerCase()
            .split(/[\s-]+/)
            .filter(term => term.length > 0);

        const filteredCourses = courses.filter(course => {
            if (!course.Code) return false;
            const courseCode = course.Code.toLowerCase();
            return searchTerms.length === 0 || searchTerms.every(term => courseCode.includes(term));
        });

        const enhancedCourses = await Promise.all(
            filteredCourses.map(async course => {
                try {
                    const details = await fetchCourseDetails(course.Identifier || course.Id);
                    return { ...course, ...(details || {}) };
                } catch (error) {
                    console.warn(`Could not fetch additional details for course ${course.Name}:`, error);
                    return course;
                }
            })
        );

        await displayCourseSearchResults(enhancedCourses);
    } catch (error) {
        console.error('Error fetching courses:', error);
        if (errorContainer) {
            errorContainer.innerHTML =
                "<div class='error'><i class='fas fa-exclamation-circle'></i> Error retrieving courses. Try again later.</div>";
        }
        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center">
                        <p class="initial-message">Error retrieving courses. Please try again.</p>
                    </td>
                </tr>
            `;
        }
    }
}

async function handleCourseIdSearch(event) {
    event.preventDefault();

    const errorContainer = document.getElementById('error-container');
    const infoContainer = document.getElementById('info-container');
    if (errorContainer) errorContainer.innerHTML = '';
    if (infoContainer) infoContainer.innerHTML = '';

    const courseIdInput = document.getElementById('courseId');
    const courseId = courseIdInput?.value.trim();
    if (!courseId) {
        if (errorContainer) {
            errorContainer.innerHTML =
                "<div class='error'><i class='fas fa-exclamation-circle'></i> Please enter a Course ID.</div>";
        }
        return;
    }

    const resultsContainer = document.getElementById('idSearchResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = `
            <tr>
                <td colspan="7" class="text-center">
                    <span class="loading-spinner"></span> Searching for course ID ${courseId}...
                </td>
            </tr>
        `;
    }

    try {
        const apiVersion = '1.49';
        const apiUrl = `/d2l/api/lp/${apiVersion}/courses/${courseId}`;
        console.log(`📡 API Call: ${apiUrl}`);

        const course = await BrightspaceFetch(apiUrl);
        console.log('📥 Course Data:', course);

        if (!course || !course.Identifier) {
            throw new Error('Invalid course data received');
        }

        const startDate = formatDate(course.StartDate);
        const endDate = formatDate(course.EndDate);

        const courseHomeLink = `https://your-brightspace.example.edu/d2l/home/${course.Identifier}`;
        const courseOfferingLink = `https://your-brightspace.example.edu/d2l/lp/manageCourses/course_offering_info_viewedit.d2l?ou=${course.Identifier}`;
        const classListLink = `https://your-brightspace.example.edu/d2l/lms/classlist/classlist.d2l?ou=${course.Identifier}`;

        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center">
                        <span class="loading-spinner"></span> Loading instructor...
                    </td>
                </tr>
            `;
        }

        const instructorNames = await fetchClasslistInstructors(course.Identifier);

        if (infoContainer) {
            infoContainer.innerHTML = `
                <div class="info">
                    <i class="fas fa-info-circle"></i> Course with ID ${courseId} was found successfully.
                </div>
            `;
        }

        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center" style="background-color: #f0f8ff; font-weight: bold;">
                        Found course with ID ${courseId}
                    </td>
                </tr>
                <tr>
                    <td>${course.Identifier}</td>
                    <td>${escapeHtml(course.Name || '')}</td>
                    <td>
                        <a href="${courseHomeLink}" target="_blank">
                            ${escapeHtml(course.Code || '')}
                            <i class="fas fa-external-link-alt" style="margin-left: 5px; font-size: 0.8em;"></i>
                        </a>
                    </td>
                    <td>${startDate}</td>
                    <td>${endDate}</td>
                    <td>${escapeHtml(instructorNames)}</td>
                    <td>
                        <div class="action-buttons" style="display: flex; gap: 5px;">
                            <a href="${courseOfferingLink}" target="_blank" class="btn btn-sm btn-info" title="Course Offering Info" style="padding: 4px 8px;">
                                <i class="fas fa-info-circle"></i>
                            </a>
                            <a href="${classListLink}" target="_blank" class="btn btn-sm btn-primary" title="Class List" style="padding: 4px 8px;">
                                <i class="fas fa-users"></i>
                            </a>
                        </div>
                    </td>
                </tr>
            `;
        }
    } catch (error) {
        console.error('❌ Error fetching course:', error);
        const errorContainer = document.getElementById('error-container');
        const resultsContainer = document.getElementById('idSearchResults');
        if (errorContainer) {
            errorContainer.innerHTML = `<div class='error'><i class='fas fa-exclamation-circle'></i> Error: ${error.message}</div>`;
        }
        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center">
                        <p class="initial-message">No course found with ID ${courseId}. Please verify the ID and try again.</p>
                    </td>
                </tr>
            `;
        }
    }
}

async function fetchCoursesBySemester(semesterId) {
    try {
        const childrenResponse = await BrightspaceFetch(
            `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/`
        );

        return (childrenResponse || []).filter(item =>
            item.Type &&
            (item.Type.Code === 'Course Offering' ||
                item.Type.Name === 'Course Offering' ||
                item.Type.Id === 3)
        );
    } catch (error) {
        console.error('Error fetching courses for semester:', error);

        try {
            const descendantsResponse = await BrightspaceFetch(
                `/d2l/api/lp/1.49/orgstructure/${semesterId}/descendants/`
            );
            return (descendantsResponse || []).filter(course =>
                course.Type && course.Type.Code === 'Course Offering'
            );
        } catch (err) {
            console.error('Error with fallback approach:', err);
            return [];
        }
    }
}

async function fetchCourseDetails(courseId) {
    try {
        return await BrightspaceFetch(`/d2l/api/lp/1.49/courses/${courseId}`);
    } catch (error) {
        console.warn(`Could not fetch details for course ${courseId}:`, error);
        return null;
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        console.warn('Invalid date:', e);
        return 'N/A';
    }
}

/** Instructor role ID in D2L classlist */
const INSTRUCTOR_ROLE_ID = 102;

/**
 * Fetch classlist for a course and return display names for users with role Instructor (102).
 * Uses LE classlist paged API.
 * @param {number} courseId - Course org unit id
 * @returns {Promise<string>} Comma-separated list of instructor names, or "—" if none
 */
async function fetchClasslistInstructors(courseId) {
    try {
        const allUsers = [];
        let nextUrl = `/d2l/api/le/1.78/${courseId}/classlist/paged/`;

        while (nextUrl) {
            const response = await BrightspaceFetch(nextUrl);
            let users = [];
            if (response.Objects && Array.isArray(response.Objects)) {
                users = response.Objects;
            } else if (response.Items && Array.isArray(response.Items)) {
                users = response.Items;
            } else if (Array.isArray(response)) {
                users = response;
            }
            allUsers.push(...users);
            nextUrl = response.Next || null;
        }

        const instructors = allUsers.filter(u => Number(u.RoleId) === INSTRUCTOR_ROLE_ID);
        if (!instructors.length) return '—';

        const names = instructors.map(u => {
            const first = (u.FirstName || '').trim();
            const last = (u.LastName || '').trim();
            if (first || last) return `${first} ${last}`.trim();
            return u.Username || u.OrgDefinedId || '—';
        }).filter(Boolean);

        return names.length ? names.join(', ') : '—';
    } catch (err) {
        console.warn(`Could not fetch classlist for course ${courseId}:`, err);
        return '—';
    }
}

/**
 * Fetch instructors for multiple courses in batches to avoid overwhelming the API.
 * @param {Array<{Identifier?: number, Id?: number}>} courses
 * @param {number} batchSize
 * @returns {Promise<Map<number, string>>} courseId -> instructor names
 */
async function fetchInstructorsForCourses(courses, batchSize = 5) {
    const map = new Map();
    for (let i = 0; i < courses.length; i += batchSize) {
        const batch = courses.slice(i, i + batchSize);
        const results = await Promise.all(
            batch.map(async (course) => {
                const id = course.Identifier ?? course.Id;
                const names = await fetchClasslistInstructors(id);
                return [id, names];
            })
        );
        results.forEach(([id, names]) => map.set(id, names));
    }
    return map;
}

async function displayCourseSearchResults(courses) {
    const resultsContainer = document.getElementById('courseSearchResults');
    const infoContainer = document.getElementById('info-container');

    if (!resultsContainer) return;

    if (!courses || !courses.length) {
        resultsContainer.innerHTML = `
            <tr>
                <td colspan="7" class="text-center">
                    <p class="initial-message">No matching courses found.</p>
                </td>
            </tr>
        `;
        return;
    }

    courses.sort((a, b) => {
        if (a.Code && b.Code) {
            return a.Code.localeCompare(b.Code);
        }
        return 0;
    });

    // Show loading state while fetching instructors
    resultsContainer.innerHTML = `
        <tr>
            <td colspan="7" class="text-center" style="padding: var(--spacing-lg);">
                <span class="loading-spinner"></span> Loading instructors...
            </td>
        </tr>
    `;

    const instructorMap = await fetchInstructorsForCourses(courses);

    currentCourseResults = courses.slice();
    currentCourseResultsPage = 1;
    renderCourseResultsPage();

    if (infoContainer) {
        infoContainer.innerHTML = `
            <div class="info">
                <i class="fas fa-info-circle"></i> Successfully found ${courses.length} course(s) matching your search criteria.
            </div>
        `;
    }
}

function renderCourseResultsPage(page = currentCourseResultsPage) {
    const resultsContainer = document.getElementById('courseSearchResults');
    if (!resultsContainer) return;

    if (!currentCourseResults || currentCourseResults.length === 0) {
        resultsContainer.innerHTML = `
            <tr>
                <td colspan="7" class="text-center">
                    <p class="initial-message">No matching courses found.</p>
                </td>
            </tr>
        `;
        return;
    }

    const totalPages = Math.ceil(currentCourseResults.length / COURSE_RESULTS_PAGE_SIZE);
    currentCourseResultsPage = Math.min(Math.max(1, page), totalPages);

    const startIndex = (currentCourseResultsPage - 1) * COURSE_RESULTS_PAGE_SIZE;
    const pageRows = currentCourseResults.slice(startIndex, startIndex + COURSE_RESULTS_PAGE_SIZE);

    const rows = pageRows
        .map(course => {
            const courseId = course.Identifier || course.Id;
            const courseCode = course.Code || 'N/A';
            const courseName = course.Name || 'Unnamed Course';
            const instructorNames = instructorMap.get(courseId) ?? '—';

            const startDate = formatDate(course.StartDate);
            const endDate = formatDate(course.EndDate);

            const courseHomeLink = `https://your-brightspace.example.edu/d2l/home/${courseId}`;
            const courseOfferingLink = `https://your-brightspace.example.edu/d2l/lp/manageCourses/course_offering_info_viewedit.d2l?ou=${courseId}`;
            const classListLink = `https://your-brightspace.example.edu/d2l/lms/classlist/classlist.d2l?ou=${courseId}`;

            return `
                <tr>
                    <td>${courseId}</td>
                    <td>${courseName}</td>
                    <td>
                        <a href="${courseHomeLink}" target="_blank">
                            ${courseCode}
                            <i class="fas fa-external-link-alt" style="margin-left: 5px; font-size: 0.8em;"></i>
                        </a>
                    </td>
                    <td>${startDate}</td>
                    <td>${endDate}</td>
                    <td>${escapeHtml(instructorNames)}</td>
                    <td>
                        <div class="action-buttons" style="display: flex; gap: 5px;">
                            <a href="${courseOfferingLink}" target="_blank" class="btn btn-sm btn-info" title="Course Offering Info" style="padding: 4px 8px;">
                                <i class="fas fa-info-circle"></i>
                            </a>
                            <a href="${classListLink}" target="_blank" class="btn btn-sm btn-primary" title="Class List" style="padding: 4px 8px;">
                                <i class="fas fa-users"></i>
                            </a>
                        </div>
                    </td>
                </tr>
            `;
        })
        .join('');

    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentCourseResultsPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    let paginationHtml = '';
    if (totalPages > 1) {
        paginationHtml = `
            <tr>
                <td colspan="7" style="padding: 10px;">
                    <div class="pagination" style="display:flex; justify-content:space-between; align-items:center;">
                        <span>Page ${currentCourseResultsPage} of ${totalPages}</span>
                        <div style="display:flex; gap:5px; align-items:center;">
                            <button class="btn btn-outline btn-sm" id="course-results-prev" ${currentCourseResultsPage === 1 ? 'disabled' : ''}>« Previous</button>
        `;

        if (startPage > 1) {
            paginationHtml += `<button class="btn btn-outline btn-sm course-results-page" data-page="1">1</button>`;
            if (startPage > 2) paginationHtml += `<span>...</span>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            if (i === currentCourseResultsPage) {
                paginationHtml += `<button class="btn btn-primary btn-sm">${i}</button>`;
            } else {
                paginationHtml += `<button class="btn btn-outline btn-sm course-results-page" data-page="${i}">${i}</button>`;
            }
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) paginationHtml += `<span>...</span>`;
            paginationHtml += `<button class="btn btn-outline btn-sm course-results-page" data-page="${totalPages}">${totalPages}</button>`;
        }

        paginationHtml += `
                            <button class="btn btn-outline btn-sm" id="course-results-next" ${currentCourseResultsPage === totalPages ? 'disabled' : ''}>Next »</button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    resultsContainer.innerHTML = `
        <tr>
            <td colspan="7" class="text-center" style="background-color: #f0f8ff; font-weight: bold;">
                Found ${currentCourseResults.length} course(s) matching your search
            </td>
        </tr>
        ${rows}
        ${paginationHtml}
    `;

    const prevBtn = document.getElementById('course-results-prev');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => renderCourseResultsPage(currentCourseResultsPage - 1));
    }

    const nextBtn = document.getElementById('course-results-next');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => renderCourseResultsPage(currentCourseResultsPage + 1));
    }

    document.querySelectorAll('.course-results-page').forEach((btn) => {
        btn.addEventListener('click', () => {
            const pageNum = Number(btn.getAttribute('data-page'));
            if (!Number.isNaN(pageNum)) renderCourseResultsPage(pageNum);
        });
    });
}

function escapeHtml(text) {
    if (text == null || text === '') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clearSearchResults(resultsElementId, message) {
    const errorContainer = document.getElementById('error-container');
    const infoContainer = document.getElementById('info-container');
    if (errorContainer) errorContainer.innerHTML = '';
    if (infoContainer) infoContainer.innerHTML = '';

    const resultsContainer = document.getElementById(resultsElementId);
    if (!resultsContainer) return;

    resultsContainer.innerHTML = `
        <tr>
            <td colspan="7" class="text-center">
                <p class="initial-message">${message}</p>
            </td>
        </tr>
    `;
}

