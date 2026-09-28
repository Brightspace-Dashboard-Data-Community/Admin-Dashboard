/**
 * course-list.js
 * View and manage course offerings by semester (Course Management - View Course List).
 * Uses D2LApi; loads semesters and courses from D2L API (no demo content).
 */

(function () {
    'use strict';

    var rootOrgUnitId = null;
    var allCourses = [];
    var allCourseDetails = {};
    var lastRenderedCourses = [];
    var currentPage = 1;
    var pageSize = 50;

    function getEl(id) {
        return document.getElementById(id);
    }

    function setError(msg) {
        var el = getEl('error-container');
        if (el) el.innerHTML = msg ? '<div class="form-section" style="background:#ffebee;border:1px solid var(--danger-color,#f44336);border-radius:4px;padding:12px;">' + msg + '</div>' : '';
    }

    function setInfo(msg) {
        var el = getEl('info-container');
        if (el) el.innerHTML = msg ? '<div class="info-bar">' + msg + '</div>' : '';
    }

    function setTableLoading(msg) {
        var table = getEl('course-list');
        if (!table) return;
        var tbody = table.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;">' + (msg || 'Loading...') + '</td></tr>';
        }
    }

    async function fetchCourseDetails(courseId) {
        try {
            if (typeof D2LApi !== 'undefined' && D2LApi && typeof D2LApi._fetch === 'function') {
                return await D2LApi._fetch('/d2l/api/lp/1.49/courses/' + courseId);
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async function getRootOrgUnitId() {
        setError('');
        setTableLoading('Fetching organization data...');
        try {
            if (typeof D2LApi === 'undefined' || !D2LApi.getOrganizationInfo) {
                throw new Error('D2L API not available.');
            }
            var org = await D2LApi.getOrganizationInfo();
            if (!org || !org.Identifier) throw new Error('Invalid organization data.');
            rootOrgUnitId = org.Identifier;
            await getSemesters();
        } catch (err) {
            console.error('getRootOrgUnitId error:', err);
            setError('<strong>Error:</strong> ' + (err.message || 'Could not load organization.') + ' Try refreshing or log in to D2L.');
            setTableLoading('Error loading data');
            var sel = getEl('semester-filter');
            if (sel) {
                sel.disabled = true;
                sel.innerHTML = '<option value="">Error loading semesters</option>';
            }
        }
    }

    async function getSemesters() {
        var sel = getEl('semester-filter');
        if (!sel) return;
        sel.disabled = true;
        sel.innerHTML = '<option value="">Loading semesters...</option>';
        setTableLoading('Loading semesters...');

        try {
            var data = [];
            if (typeof D2LApi.fetchPaginatedData === 'function') {
                data = await D2LApi.fetchPaginatedData(
                    '/d2l/api/lp/1.49/orgstructure/' + rootOrgUnitId + '/descendants/?ouTypeId=5'
                );
            } else {
                var res = await D2LApi._fetch(
                    '/d2l/api/lp/1.49/orgstructure/' + rootOrgUnitId + '/descendants/?ouTypeId=5&pageSize=100'
                );
                if (res && Array.isArray(res)) data = res;
                else if (res && res.Objects && Array.isArray(res.Objects)) data = res.Objects;
            }

            if (!data || data.length === 0) {
                sel.innerHTML = '<option value="">No semesters available</option>';
                setTableLoading('No semesters found');
                sel.disabled = false;
                return;
            }

            if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
                data = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data));
            } else {
                data.sort(function (a, b) {
                    return String(b.Name || '').localeCompare(String(a.Name || ''));
                });
            }
            sel.innerHTML = '<option value="">Select a semester</option>' +
                data.map(function (s) {
                    return '<option value="' + s.Identifier + '">' + (s.Name || '') + '</option>';
                }).join('');
            sel.disabled = false;

            var firstId = data[0] && data[0].Identifier;
            if (firstId) {
                sel.value = firstId;
                getCoursesForSemester(firstId);
            } else {
                setTableLoading('Select a semester');
            }
        } catch (err) {
            console.error('getSemesters error:', err);
            setError('Could not load semesters: ' + (err.message || ''));
            sel.innerHTML = '<option value="">Error loading semesters</option>';
            sel.disabled = true;
            setTableLoading('Error loading semesters');
        }
    }

    async function getCoursesForSemester(semesterOrgUnitId) {
        var table = getEl('course-list');
        if (!table || !semesterOrgUnitId) {
            setTableLoading('Select a semester');
            return;
        }

        setError('');
        setTableLoading('Loading courses...');
        var sel = getEl('semester-filter');
        if (sel) sel.disabled = true;

        try {
            var children = [];
            if (typeof D2LApi.fetchPaginatedData === 'function') {
                children = await D2LApi.fetchPaginatedData(
                    '/d2l/api/lp/1.49/orgstructure/' + semesterOrgUnitId + '/children/'
                );
            } else {
                var res = await D2LApi._fetch(
                    '/d2l/api/lp/1.49/orgstructure/' + semesterOrgUnitId + '/children/?pageSize=100'
                );
                if (res && Array.isArray(res)) children = res;
                else if (res && res.Objects && Array.isArray(res.Objects)) children = res.Objects;
            }

            var courses = (children || []).filter(function (item) {
                return item && (item.Name || item.Code || item.Identifier);
            });

            allCourses = courses.slice();
            allCourseDetails = {};

            var details = await Promise.all(courses.map(function (c) { return fetchCourseDetails(c.Identifier); }));
            courses.forEach(function (c, idx) {
                allCourseDetails[c.Identifier] = details[idx] || {};
            });

            renderCourses(allCourses);
            setInfo('Found ' + courses.length + ' course(s) for this semester');
        } catch (err) {
            console.error('getCoursesForSemester error:', err);
            setError('Could not load courses: ' + (err.message || ''));
            setTableLoading('Error loading courses');
        } finally {
            if (sel) sel.disabled = false;
        }
    }

    function formatDate(val) {
        if (!val) return 'N/A';
        try {
            var d = new Date(val);
            if (isNaN(d.getTime())) return 'N/A';
            return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (e) {
            return 'N/A';
        }
    }

    function renderCourses(courses) {
        var table = getEl('course-list');
        if (!table) return;

        if (!courses || courses.length === 0) {
            var tbody = table.querySelector('tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;">No courses available for this semester</td></tr>';
            }
            return;
        }

        courses.sort(function (a, b) {
            return String(a.Name || '').localeCompare(String(b.Name || ''));
        });

        var totalPages = Math.max(1, Math.ceil(courses.length / pageSize));
        currentPage = Math.min(Math.max(1, currentPage), totalPages);
        var startIndex = (currentPage - 1) * pageSize;
        var pageCourses = courses.slice(startIndex, startIndex + pageSize);

        var base = window.location.origin || '';
        lastRenderedCourses = courses.slice();

        var rows = pageCourses.map(function (course) {
            var d = allCourseDetails[course.Identifier] || {};
            var startDate = formatDate(d.StartDate);
            var endDate = formatDate(d.EndDate);
            var homeLink = base + '/d2l/home/' + course.Identifier;
            var offeringLink = base + '/d2l/lp/manageCourses/course_offering_info_viewedit.d2l?ou=' + course.Identifier;
            var classListLink = base + '/d2l/lms/classlist/classlist.d2l?ou=' + course.Identifier;
            var code = course.Code || course.Name || course.Identifier;
            var name = course.Name || code || '';
            return (
                '<tr>' +
                '<td>' + (course.Identifier || '') + '</td>' +
                '<td>' + (name.replace(/</g, '&lt;')) + '</td>' +
                '<td><a href="' + homeLink + '" target="_blank" class="action-link">' + (String(code).replace(/</g, '&lt;')) + ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a></td>' +
                '<td>' + startDate + '</td>' +
                '<td>' + endDate + '</td>' +
                '<td class="table-actions">' +
                '<a href="' + offeringLink + '" target="_blank" class="btn-icon-small" title="Course info"><i class="fa-solid fa-circle-info" style="color:var(--primary-color)"></i></a> ' +
                '<a href="' + classListLink + '" target="_blank" class="btn-icon-small" title="Class list"><i class="fa-solid fa-user-group" style="color:var(--primary-color)"></i></a>' +
                '</td></tr>'
            );
        });

        var thead = table.querySelector('thead');
        var tbody = table.querySelector('tbody');
        if (thead && tbody) {
            tbody.innerHTML =
                '<tr><td colspan="6" style="text-align:center;background:#e3fae3;font-weight:600;">Found ' + courses.length + ' course(s) for this semester</td></tr>' +
                rows.join('');
        }

        renderPaginationControls(totalPages);
    }

    function renderPaginationControls(totalPages) {
        var container = getEl('course-list-pagination');
        if (!container) {
            var tableContainer = document.querySelector('.table-container');
            if (!tableContainer) return;
            container = document.createElement('div');
            container.id = 'course-list-pagination';
            container.style.display = 'flex';
            container.style.justifyContent = 'space-between';
            container.style.alignItems = 'center';
            container.style.marginTop = '12px';
            tableContainer.insertAdjacentElement('afterend', container);
        }

        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        var maxVisiblePages = 5;
        var startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        var endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        var pageButtons = '';
        if (startPage > 1) {
            pageButtons += '<button class="btn btn-outline btn-sm course-list-page-btn" data-page="1">1</button>';
            if (startPage > 2) pageButtons += '<span>...</span>';
        }
        for (var i = startPage; i <= endPage; i++) {
            if (i === currentPage) pageButtons += '<button class="btn btn-primary btn-sm">' + i + '</button>';
            else pageButtons += '<button class="btn btn-outline btn-sm course-list-page-btn" data-page="' + i + '">' + i + '</button>';
        }
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) pageButtons += '<span>...</span>';
            pageButtons += '<button class="btn btn-outline btn-sm course-list-page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';
        }

        container.innerHTML =
            '<span>Page ' + currentPage + ' of ' + totalPages + '</span>' +
            '<div style="display:flex; gap:6px; align-items:center;">' +
            '<button class="btn btn-outline btn-sm" id="course-list-prev" ' + (currentPage === 1 ? 'disabled' : '') + '>« Previous</button>' +
            pageButtons +
            '<button class="btn btn-outline btn-sm" id="course-list-next" ' + (currentPage === totalPages ? 'disabled' : '') + '>Next »</button>' +
            '</div>';

        var prevBtn = getEl('course-list-prev');
        if (prevBtn) prevBtn.addEventListener('click', function () {
            if (currentPage > 1) {
                currentPage -= 1;
                renderCourses(lastRenderedCourses);
            }
        });

        var nextBtn = getEl('course-list-next');
        if (nextBtn) nextBtn.addEventListener('click', function () {
            if (currentPage < totalPages) {
                currentPage += 1;
                renderCourses(lastRenderedCourses);
            }
        });

        document.querySelectorAll('.course-list-page-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var pageNum = Number(btn.getAttribute('data-page'));
                if (!Number.isNaN(pageNum)) {
                    currentPage = pageNum;
                    renderCourses(lastRenderedCourses);
                }
            });
        });
    }

    function applySearch() {
        var input = getEl('course-search-input');
        if (!input) return;
        var term = input.value.trim().toLowerCase();
        var list = allCourses || [];
        if (term) {
            list = list.filter(function (c) {
                var name = (c.Name || '').toLowerCase();
                var code = (c.Code || '').toLowerCase();
                var id = String(c.Identifier || '').toLowerCase();
                return name.indexOf(term) !== -1 || code.indexOf(term) !== -1 || id.indexOf(term) !== -1;
            });
        }
        currentPage = 1;
        renderCourses(list);
        if (term) {
            setInfo('Found ' + list.length + ' matching course(s) out of ' + (allCourses.length || 0));
        } else {
            setInfo('Found ' + (allCourses.length || 0) + ' course(s) for this semester');
        }
    }

    function downloadCsv() {
        var data = lastRenderedCourses && lastRenderedCourses.length ? lastRenderedCourses : allCourses;
        if (!data || !data.length) {
            alert('No course data available to download.');
            return;
        }
        var header = ['OrgUnitCode', 'CourseName', 'CourseCode', 'StartDate', 'EndDate', 'CourseHomeUrl'];
        var base = window.location.origin || '';

        function esc(v) {
            var s = v == null ? '' : String(v);
            if (/[",\n]/.test(s)) {
                s = '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        }

        var lines = [header.join(',')];
        data.forEach(function (c) {
            var d = allCourseDetails[c.Identifier] || {};
            var row = [
                c.Identifier || '',
                c.Name || '',
                c.Code || '',
                d.StartDate || '',
                d.EndDate || '',
                base + '/d2l/home/' + (c.Identifier || '')
            ];
            lines.push(row.map(esc).join(','));
        });

        var csv = lines.join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'course-list.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function onSemesterChange() {
        var sel = getEl('semester-filter');
        if (!sel) return;
        var val = sel.value;
        if (val) getCoursesForSemester(parseInt(val, 10));
        else setTableLoading('Select a semester');
    }

    function onRefresh() {
        var sel = getEl('semester-filter');
        if (sel && sel.value) {
            currentPage = 1;
            getCoursesForSemester(parseInt(sel.value, 10));
        } else {
            getRootOrgUnitId();
        }
    }

    function init() {
        var sel = getEl('semester-filter');
        var refreshBtn = getEl('refresh-btn');
        var searchInput = getEl('course-search-input');
        var searchClear = getEl('course-search-clear');
        var downloadBtn = getEl('download-csv-btn');

        if (sel) sel.addEventListener('change', onSemesterChange);
        if (refreshBtn) refreshBtn.addEventListener('click', onRefresh);
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                applySearch();
            });
        }
        if (searchClear) {
            searchClear.addEventListener('click', function () {
                if (searchInput) {
                    searchInput.value = '';
                }
                applySearch();
            });
        }
        if (downloadBtn) {
            downloadBtn.addEventListener('click', downloadCsv);
        }
        getRootOrgUnitId();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
