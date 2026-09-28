/**
 * Course List by Semester Report
 * Displays and exports course offerings for a selected semester
 */

const semesterSelect = document.getElementById('semesterSelect');
const viewBtn = document.getElementById('viewCoursesBtn');
const downloadBtn = document.getElementById('downloadCsvBtn');
const tableCard = document.getElementById('tableCard');

let courseData = [];
let courseTable;

const INSTRUCTOR_ROLE_ID = 102;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Load semesters
    loadSemesters();
});

async function loadSemesters() {
    try {
        // Get root org unit ID
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) {
            throw new Error('Could not get organization info');
        }
        
        const rootOrgUnitId = orgInfo.Identifier;
        
        // Fetch semesters
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                data = response.Objects;
            } else if (Array.isArray(response)) {
                data = response;
            }
        }
        
        // Restrict to the canonical allowlist (see js/semester-config.js)
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.populateSelect) {
            SemesterConfig.populateSelect(semesterSelect, data);
            // Optional escape hatch: let admins pull a historical semester not in the list
            if (SemesterConfig.attachHistoricalInput) {
                SemesterConfig.attachHistoricalInput(semesterSelect);
            }
        } else {
            data.sort((a, b) => String(b.Name || '').localeCompare(String(a.Name || '')));
            semesterSelect.innerHTML = '';
            data.forEach(semester => {
                const option = document.createElement('option');
                option.value = semester.Identifier;
                option.textContent = semester.Name;
                semesterSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading semesters:', error);
    }
}

async function fetchCourseOfferings(semesterId) {
    try {
        let results = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            results = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/?pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                results = response.Objects;
            } else if (Array.isArray(response)) {
                results = response;
            }
        }
        return results.filter(entry => entry.Type?.Code === 'Course Offering');
    } catch (error) {
        console.error('❌ Failed to fetch course offerings', error);
        return [];
    }
}

async function checkCourseHasStudents(orgUnitId) {
    try {
        const results = await D2LApi._fetch(`/d2l/api/lp/1.46/enrollments/orgUnits/${orgUnitId}/users/?roleId=101&isActive=true`);
        return results.Items && results.Items.length > 0;
    } catch (error) {
        console.error(`❌ Failed to check enrollments for course ${orgUnitId}:`, error);
        return null;
    }
}

function formatDate(value) {
    if (!value) return '';
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return String(value);
    }
}

async function fetchCourseInstructors(orgUnitId) {
    try {
        const results = await D2LApi._fetch(
            `/d2l/api/lp/1.46/enrollments/orgUnits/${orgUnitId}/users/?roleId=${INSTRUCTOR_ROLE_ID}&isActive=true&pageSize=200`
        );

        const items = Array.isArray(results?.Items) ? results.Items : [];
        if (!items.length) return '—';

        const names = items.map(i => {
            const u = i.User || i;
            const first = (u.FirstName || '').trim();
            const last = (u.LastName || '').trim();
            if (first || last) return `${first} ${last}`.trim();
            return (u.DisplayName || u.Username || u.OrgDefinedId || '').trim();
        }).filter(Boolean);

        return names.length ? names.join(', ') : '—';
    } catch (error) {
        console.warn(`⚠️ Failed to fetch instructors for course ${orgUnitId}:`, error);
        return '—';
    }
}

async function fetchCourseDates(orgUnitId) {
    try {
        const details = await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${orgUnitId}`);
        return {
            startDate: details?.StartDate || details?.StartDateTime || details?.StartDateUtc || '',
            endDate: details?.EndDate || details?.EndDateTime || details?.EndDateUtc || ''
        };
    } catch (error) {
        console.warn(`⚠️ Failed to fetch course dates for ${orgUnitId}:`, error);
        return { startDate: '', endDate: '' };
    }
}

async function loadCsvForSemester(semesterId) {
    const path = `/content/enforced/2993917-D2LAPICourse/reports/${semesterId}.csv`;
    
    return fetch(path)
        .then(response => {
            if (!response.ok) {
                throw new Error('CSV file not found');
            }
            return response.text();
        })
        .then(csvText => {
            const results = Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                chunkSize: 0
            });
            
            if (results.errors && results.errors.length > 0) {
                console.warn('⚠️ CSV parse errors:', results.errors);
            }
            
            return results.data;
        })
        .catch(error => {
            console.error('❌ Failed to load CSV:', error);
            return [];
        });
}

function pickRowValue(row, candidates) {
    for (const key of candidates) {
        if (row && Object.prototype.hasOwnProperty.call(row, key)) {
            const v = row[key];
            if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
        }
    }
    return '';
}

function initTable(data) {
    if (courseTable) {
        courseTable.clear().rows.add(data).draw();
    } else {
        courseTable = $('#courseTable').DataTable({
            data: data,
            rowId: 'Identifier',
            columns: [
                { data: 'Identifier', title: 'OrgUnitId' },
                { data: 'Name', title: 'Name' },
                { data: 'Code', title: 'Code' },
                {
                    data: 'instructors',
                    title: 'Instructor(s)',
                    render: data => {
                        if (data === null || data === undefined) return 'Loading...';
                        return data || '—';
                    }
                },
                {
                    data: 'startDate',
                    title: 'Start Date',
                    render: data => formatDate(data)
                },
                {
                    data: 'endDate',
                    title: 'End Date',
                    render: data => formatDate(data)
                },
                {
                    data: 'isActive',
                    title: 'Active',
                    render: data => {
                        if (data === true) return 'Yes';
                        if (data === false) return 'No';
                        return 'Loading...';
                    }
                }
            ],
            pageLength: 25,
            lengthMenu: [[10, 25, 50, 100, 200, -1], [10, 25, 50, 100, 200, "All"]],
            order: [[0, 'asc']],
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
    }
    tableCard.style.display = 'block';
}

async function checkActiveCourses() {
    const batchSize = 10;
    const totalCourses = courseData.length;
    const totalBatches = Math.ceil(totalCourses / batchSize);
    
        for (let i = 0; i < totalCourses; i += batchSize) {
            // Check for cancellation
            if (LoadingUtils.isCancelled('loadingModal')) {
                LoadingUtils.hideLoadingModal('loadingModal');
                viewBtn.disabled = false;
                downloadBtn.disabled = false;
                return;
            }
            
            const currentBatch = Math.ceil((i + batchSize) / batchSize);
            const batch = courseData.slice(i, i + batchSize);
            
            const progressPercent = 40 + Math.floor((currentBatch / totalBatches) * 60);
            LoadingUtils.updateLoadingModal(progressPercent, `Checking active courses: batch ${currentBatch}/${totalBatches}...`, 'loadingModal');
        
        const promises = batch.map(async (course, index) => {
            try {
                const hasStudents = await checkCourseHasStudents(course.Identifier);
                courseData[i + index].isActive = hasStudents;
                
                if (courseTable) {
                    const rowIndex = courseTable.row(`#${course.Identifier}`).index();
                    if (rowIndex !== undefined) {
                        courseTable.cell(rowIndex, 6).data(hasStudents).draw(false);
                    }
                }
                
                return { id: course.Identifier, active: hasStudents };
            } catch (error) {
                console.error(`Error checking course ${course.Identifier}:`, error);
                return { id: course.Identifier, active: null, error };
            }
        });
        
        await Promise.all(promises);
        
        if (i + batchSize < totalCourses) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    if (courseTable) {
        courseTable.rows().invalidate().draw();
    }
    
    LoadingUtils.updateLoadingModal(100, 'All courses processed successfully!', 'loadingModal');
    setTimeout(() => {
        LoadingUtils.hideLoadingModal('loadingModal');
    }, 1000);
}

async function loadInstructorsForCourses() {
    const batchSize = 8;
    const totalCourses = courseData.length;
    const totalBatches = Math.ceil(totalCourses / batchSize);

    for (let i = 0; i < totalCourses; i += batchSize) {
        // Check for cancellation
        if (LoadingUtils.isCancelled('loadingModal')) {
            LoadingUtils.hideLoadingModal('loadingModal');
            viewBtn.disabled = false;
            downloadBtn.disabled = false;
            return;
        }

        const currentBatch = Math.ceil((i + batchSize) / batchSize);
        const batch = courseData.slice(i, i + batchSize);

        const progressPercent = 40 + Math.floor((currentBatch / totalBatches) * 30);
        LoadingUtils.updateLoadingModal(progressPercent, `Loading instructors: batch ${currentBatch}/${totalBatches}...`, 'loadingModal');

        const results = await Promise.all(
            batch.map(async (course) => {
                const names = await fetchCourseInstructors(course.Identifier);
                return [course.Identifier, names];
            })
        );

        results.forEach(([id, names]) => {
            const idx = courseData.findIndex(c => c.Identifier === id);
            if (idx !== -1) courseData[idx].instructors = names;
        });

        // Update the table (column 3 is Instructor(s))
        if (courseTable) {
            results.forEach(([id, names]) => {
                const rowIndex = courseTable.row(`#${id}`).index();
                if (rowIndex !== undefined) {
                    courseTable.cell(rowIndex, 3).data(names).draw(false);
                }
            });
        }

        if (i + batchSize < totalCourses) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }

    if (courseTable) {
        courseTable.rows().invalidate().draw();
    }
}

async function loadDatesForCourses() {
    const batchSize = 8;
    const totalCourses = courseData.length;
    const totalBatches = Math.ceil(totalCourses / batchSize);

    for (let i = 0; i < totalCourses; i += batchSize) {
        // Check for cancellation
        if (LoadingUtils.isCancelled('loadingModal')) {
            LoadingUtils.hideLoadingModal('loadingModal');
            viewBtn.disabled = false;
            downloadBtn.disabled = false;
            return;
        }

        const currentBatch = Math.ceil((i + batchSize) / batchSize);
        const batch = courseData.slice(i, i + batchSize);

        const progressPercent = 55 + Math.floor((currentBatch / totalBatches) * 15);
        LoadingUtils.updateLoadingModal(progressPercent, `Loading course dates: batch ${currentBatch}/${totalBatches}...`, 'loadingModal');

        const results = await Promise.all(
            batch.map(async (course) => {
                // Don't waste calls if we already have both dates (CSV match)
                if (course.startDate && course.endDate) return [course.Identifier, { startDate: course.startDate, endDate: course.endDate }];
                const dates = await fetchCourseDates(course.Identifier);
                return [course.Identifier, dates];
            })
        );

        results.forEach(([id, dates]) => {
            const idx = courseData.findIndex(c => c.Identifier === id);
            if (idx === -1) return;
            if (!courseData[idx].startDate) courseData[idx].startDate = dates.startDate || '';
            if (!courseData[idx].endDate) courseData[idx].endDate = dates.endDate || '';
        });

        // Update table columns: Start Date (4), End Date (5)
        if (courseTable) {
            results.forEach(([id, dates]) => {
                const rowIndex = courseTable.row(`#${id}`).index();
                if (rowIndex === undefined) return;
                if (dates.startDate) courseTable.cell(rowIndex, 4).data(dates.startDate).draw(false);
                if (dates.endDate) courseTable.cell(rowIndex, 5).data(dates.endDate).draw(false);
            });
        }

        if (i + batchSize < totalCourses) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }

    if (courseTable) {
        courseTable.rows().invalidate().draw();
    }
}

viewBtn.addEventListener('click', async () => {
    const semesterId = (typeof SemesterConfig !== 'undefined' && SemesterConfig.getEffectiveSemesterId)
        ? SemesterConfig.getEffectiveSemesterId(semesterSelect)
        : semesterSelect.value;
    const courseCodeFilter = document.getElementById('courseCodeFilter').value.trim();
    
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }

    // Disable buttons
    viewBtn.disabled = true;
    downloadBtn.disabled = true;
    
    // Show loading modal with cancel support
    LoadingUtils.showLoadingModal('Loading course data...', 'loadingModal', () => {
        // Cancel callback - will be checked in the loop
    });

    try {
        // Fetch course offerings
        const offerings = await fetchCourseOfferings(semesterId);
        
        // Apply code filter if provided
        const filteredOfferings = courseCodeFilter
            ? offerings.filter(course => course.Code && course.Code.toUpperCase().includes(courseCodeFilter.toUpperCase()))
            : offerings;

        LoadingUtils.updateLoadingModal(10, 'Loading CSV data...', 'loadingModal');
        
        // Try to load CSV data
        let csvData = [];
        try {
            csvData = await loadCsvForSemester(semesterId);
            console.log(`✅ Loaded ${csvData.length} rows from CSV`);
        } catch (e) {
            console.warn('⚠️ No CSV data found for semester:', semesterId);
        }

        LoadingUtils.updateLoadingModal(20, 'Processing CSV data...', 'loadingModal');
        
        // Create map for CSV data
        const csvMap = new Map();
        const csvMapById = new Map();
        csvData.forEach(row => {
            const courseCode = pickRowValue(row, ['Course Code', 'CourseCode', 'Code']);
            const orgUnitId = pickRowValue(row, ['OrgUnitId', 'Org Unit Id', 'Org UnitId', 'Org Unit ID', 'OrgUnit ID', 'Org Unit Identifier', 'OrgUnitIdentifier']);
            if (courseCode) {
                csvMap.set(courseCode, {
                    startDate: pickRowValue(row, ['Start Date', 'StartDate', 'Start']),
                    endDate: pickRowValue(row, ['End Date', 'EndDate', 'End'])
                });
            }
            if (orgUnitId) {
                csvMapById.set(String(orgUnitId), {
                    startDate: pickRowValue(row, ['Start Date', 'StartDate', 'Start']),
                    endDate: pickRowValue(row, ['End Date', 'EndDate', 'End'])
                });
            }
        });

        LoadingUtils.updateLoadingModal(30, 'Preparing data table...', 'loadingModal');
        
        // Process course offerings
        courseData = filteredOfferings.map(course => {
            const code = (course.Code || '').trim();
            const csvEntry = csvMapById.get(String(course.Identifier)) || csvMap.get(code);
            
            return {
                Identifier: course.Identifier,
                Name: course.Name,
                Code: code,
                instructors: null,
                startDate: csvEntry?.startDate || course.StartDate || '',
                endDate: csvEntry?.endDate || course.EndDate || '',
                isActive: null // set by active check
            };
        });

        // Initialize table
        initTable(courseData);
        console.log(`📋 Table initialized with ${courseData.length} rows`);
        
        // Load instructors + dates, then check active courses
        LoadingUtils.updateLoadingModal(40, 'Loading instructors...', 'loadingModal');
        await loadInstructorsForCourses();

        LoadingUtils.updateLoadingModal(55, 'Loading course dates...', 'loadingModal');
        await loadDatesForCourses();

        LoadingUtils.updateLoadingModal(70, 'Checking active courses...', 'loadingModal');
        await checkActiveCourses();
    } catch (error) {
        console.error('Error loading courses:', error);
        LoadingUtils.hideLoadingModal('loadingModal');
        alert('Error loading courses: ' + error.message);
    } finally {
        viewBtn.disabled = false;
        downloadBtn.disabled = false;
    }
});

downloadBtn.addEventListener('click', () => {
    if (courseData.length === 0) {
        alert('No data available to download.');
        return;
    }

    const headers = ['OrgUnitId', 'Name', 'Code', 'Instructor(s)', 'Start Date', 'End Date', 'Active'];
    const csvRows = [headers, ...courseData.map(item => [
        item.Identifier,
        item.Name,
        item.Code,
        item.instructors || '',
        formatDate(item.startDate),
        formatDate(item.endDate),
        item.isActive === true ? 'Yes' : (item.isActive === false ? 'No' : '')
    ])];

    const csvContent = csvRows.map(row => 
        row.map(cell => {
            const str = String(cell || '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join(',')
    ).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `course_list_by_semester_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});
