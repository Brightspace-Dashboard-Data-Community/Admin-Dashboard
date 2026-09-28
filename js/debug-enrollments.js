/**
 * Enrollments Debug Report
 * Inspects enrollments in a single course by OrgUnitId, grouped by role.
 * Also supports semester-wide review and a "random roles" (OTHER) tab.
 */

// Role categorization
const ignoredRoleIds = [100, 130, 133, 134, 139, 145, 146, 147, 149, 150, 151, 155, 161, 162, 165, 167, 168, 174];

function getCategoryLabel(roleId) {
    roleId = parseInt(roleId, 10);
    if (roleId === 101) return 'STUDENT';
    if (roleId === 102) return 'FACULTY';
    if (ignoredRoleIds.indexOf(roleId) !== -1) return 'IGNORED';
    return 'OTHER';
}

// Paging-safe enrollments fetch
async function getAllEnrollments(courseId) {
    const allItems = [];
    let bookmark = null;
    let hasMore = true;
    
    while (hasMore) {
        let url = `/d2l/api/lp/1.49/enrollments/orgUnits/${encodeURIComponent(courseId)}/users/`;
        if (bookmark) {
            url = url + '?bookmark=' + encodeURIComponent(bookmark);
        }
        
        const res = await D2LApi._fetch(url);
        
        if (res.Items && res.Items.length) {
            allItems.push(...res.Items);
        }
        
        hasMore = (res.PagingInfo && res.PagingInfo.HasMoreItems) ? true : false;
        bookmark = (res.PagingInfo && res.PagingInfo.Bookmark) ? res.PagingInfo.Bookmark : null;
    }
    
    return allItems;
}

// CSV export helper
function toCsv(rows) {
    if (!rows || !rows.length) return '';
    const headers = Object.keys(rows[0]);
    const out = [headers.join(',')];
    rows.forEach(r => {
        const line = headers.map(h => {
            let v = (r[h] == null ? '' : String(r[h]));
            // CSV escaping
            if (v.indexOf('"') !== -1) {
                v = v.replace(/"/g, '""');
            }
            if (v.indexOf(',') !== -1 || v.indexOf('\n') !== -1) {
                v = '"' + v + '"';
            }
            return v;
        }).join(',');
        out.push(line);
    });
    return out.join('\n');
}

// DataTables instances
let dtSummary = null;
let dtUsers = null;
let dtSemesterCourses = null;
let dtRandomRoles = null;

// Semester report data for CSV export
let semesterCoursesData = [];
let randomRolesData = [];

function setStatus(msg, show) {
    const box = document.getElementById('status');
    const txt = document.getElementById('statusText');
    if (txt) txt.textContent = msg;
    if (box) box.style.display = show ? 'flex' : 'none';
}

function setSemesterStatus(msg, show) {
    const box = document.getElementById('semesterStatus');
    const txt = document.getElementById('semesterStatusText');
    if (txt) txt.textContent = msg;
    if (box) box.style.display = show ? 'flex' : 'none';
}

// Load semesters into dropdown (ouTypeId=5 = semester)
async function loadSemesters() {
    const sel = document.getElementById('semesterSelect');
    if (!sel) return;
    try {
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;
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
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            data = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data));
        } else {
            data.sort((a, b) => String(b.Name).localeCompare(String(a.Name)));
        }
        sel.innerHTML = '<option value="">Select a semester</option>';
        data.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.Identifier;
            option.textContent = semester.Name;
            sel.appendChild(option);
        });
    } catch (err) {
        console.error('Error loading semesters:', err);
        sel.innerHTML = '<option value="">Error loading semesters</option>';
    }
}

// Get courses (children) for a semester
async function getCoursesForSemester(semesterId) {
    if (!semesterId) return [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        return await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/`
        );
    }
    const response = await D2LApi._fetch(
        `/d2l/api/lp/1.49/orgstructure/${semesterId}/children/?pageSize=100`
    );
    if (response.Objects && Array.isArray(response.Objects)) {
        return response.Objects;
    }
    if (Array.isArray(response)) {
        return response;
    }
    return [];
}

document.addEventListener('DOMContentLoaded', () => {
    // Tab switching
    document.querySelectorAll('.debug-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.debug-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.debug-panel').forEach(p => { p.hidden = true; });
            btn.classList.add('active');
            const panel = document.getElementById('panel-' + tab);
            if (panel) panel.hidden = false;
            if (tab === 'semester' && document.getElementById('semesterSelect').options.length <= 1) {
                loadSemesters();
            }
        });
    });

    // Ensure semester panel status is visible when that tab is shown
    const semesterStatusEl = document.getElementById('semesterStatus');
    if (semesterStatusEl) semesterStatusEl.style.display = 'flex';

    const runBtn = document.getElementById('runBtn');
    const downloadBtn = document.getElementById('downloadCsvBtn');
    
    if (!runBtn || !downloadBtn) {
        console.error('Required buttons not found');
        return;
    }
    
    runBtn.addEventListener('click', async function() {
        const ou = document.getElementById('orgUnitId').value;
        if (!ou) {
            setStatus('Please enter a valid OrgUnitId.', true);
            return;
        }
        
        // Disable buttons during fetch
        runBtn.disabled = true;
        downloadBtn.disabled = true;
        setStatus('Fetching enrollments for OrgUnitId ' + ou + ' …', true);
        
        // Show loading
        LoadingUtils.showLoadingModal('Fetching enrollments...');
        
        try {
            const enrollments = await getAllEnrollments(ou);
            
            LoadingUtils.updateLoadingModal(50, 'Processing enrollment data...');
            
            // Build buckets + flattened users
            const buckets = {}; // roleId -> { roleName, category, users: [...] }
            const users = [];   // flat rows for users table
            
            enrollments.forEach(e => {
                const roleId = e.Role && e.Role.Id ? parseInt(e.Role.Id, 10) : NaN;
                const roleName = (e.Role && e.Role.Name) ? e.Role.Name : 'Unknown';
                const category = getCategoryLabel(roleId);
                
                if (!buckets[roleId]) {
                    buckets[roleId] = { roleName: roleName, category: category, users: [] };
                }
                
                const row = {
                    name: (e.User && e.User.DisplayName) ? e.User.DisplayName : '',
                    username: (e.User && e.User.UserName) ? e.User.UserName : '',
                    email: (e.User && e.User.EmailAddress) ? e.User.EmailAddress : '',
                    roleId: roleId,
                    roleName: roleName,
                    category: category
                };
                
                buckets[roleId].users.push(row);
                users.push(row);
            });
            
            LoadingUtils.updateLoadingModal(80, 'Populating tables...');
            
            // Populate Summary table
            const summaryBody = document.querySelector('#summaryTable tbody');
            summaryBody.innerHTML = '';
            Object.keys(buckets).forEach(roleId => {
                const b = buckets[roleId];
                const tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + roleId + '</td>' +
                    '<td>' + b.roleName + '</td>' +
                    '<td>' + b.category + '</td>' +
                    '<td>' + b.users.length + '</td>';
                summaryBody.appendChild(tr);
            });
            
            // Populate Users table
            const usersBody = document.querySelector('#usersTable tbody');
            usersBody.innerHTML = '';
            users.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + (u.name || '') + '</td>' +
                    '<td>' + (u.username || '') + '</td>' +
                    '<td>' + (u.email || '') + '</td>' +
                    '<td>' + (u.roleId || '') + '</td>' +
                    '<td>' + (u.roleName || '') + '</td>' +
                    '<td>' + (u.category || '') + '</td>';
                usersBody.appendChild(tr);
            });
            
            // Init/refresh DataTables
            if (window.jQuery && $.fn.DataTable) {
                if (dtSummary) dtSummary.destroy();
                if (dtUsers) dtUsers.destroy();
                dtSummary = $('#summaryTable').DataTable({
                    pageLength: 25,
                    dom: '<"top"if>rt<"bottom"lp><"clear">'
                });
                dtUsers = $('#usersTable').DataTable({
                    pageLength: 25,
                    dom: '<"top"if>rt<"bottom"lp><"clear">'
                });
            }
            
            // Enable CSV download
            downloadBtn.disabled = users.length === 0;
            downloadBtn.onclick = function() {
                const csv = toCsv(users);
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'enrollments_' + ou + '_' + new Date().toISOString().slice(0, 10) + '.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            };
            
            LoadingUtils.updateLoadingModal(100, 'Complete!');
            setStatus('Loaded ' + enrollments.length + ' enrollment records.', true);
        } catch (err) {
            console.error(err);
            setStatus('Error: ' + err.message, true);
        } finally {
            runBtn.disabled = false;
            setTimeout(() => {
                LoadingUtils.hideLoadingModal();
            }, 500);
        }
    });

    // --- Semester report tab ---
    const runSemesterBtn = document.getElementById('runSemesterBtn');
    const downloadSemesterCsvBtn = document.getElementById('downloadSemesterCsvBtn');
    const downloadRandomRolesCsvBtn = document.getElementById('downloadRandomRolesCsvBtn');

    if (runSemesterBtn) {
        runSemesterBtn.addEventListener('click', async function() {
            const semesterId = document.getElementById('semesterSelect').value;
            if (!semesterId) {
                setSemesterStatus('Please select a semester.', true);
                return;
            }

            runSemesterBtn.disabled = true;
            downloadSemesterCsvBtn.disabled = true;
            downloadRandomRolesCsvBtn.disabled = true;
            setSemesterStatus('Loading courses...', true);

            LoadingUtils.showLoadingModal('Loading semester courses...');

            try {
                const courses = await getCoursesForSemester(semesterId);
                // Only course offerings (Type.Id === 3)
                const courseOfferings = (courses || []).filter(c => c.Type && parseInt(c.Type.Id, 10) === 3);
                const total = courseOfferings.length;

                semesterCoursesData = [];
                randomRolesData = [];

                for (let i = 0; i < courseOfferings.length; i++) {
                    const course = courseOfferings[i];
                    const courseId = course.Identifier;
                    const courseName = (course.Name || '').toString();
                    const code = (course.Code || '').toString();

                    if (LoadingUtils.isCancelled && LoadingUtils.isCancelled()) {
                        setSemesterStatus('Report cancelled.', true);
                        break;
                    }

                    const pct = 10 + Math.floor((i / total) * 88);
                    LoadingUtils.updateLoadingModal(pct, `Enrollments: ${i + 1}/${total} — ${code || courseId}`);

                    let enrollments = [];
                    try {
                        enrollments = await getAllEnrollments(courseId);
                    } catch (e) {
                        console.warn('Failed to get enrollments for course ' + courseId, e);
                    }

                    let students = 0, faculty = 0, other = 0, ignored = 0;
                    enrollments.forEach(e => {
                        const roleId = e.Role && e.Role.Id ? parseInt(e.Role.Id, 10) : NaN;
                        const category = getCategoryLabel(roleId);
                        const name = (e.User && e.User.DisplayName) ? e.User.DisplayName : '';
                        const username = (e.User && e.User.UserName) ? e.User.UserName : '';
                        const email = (e.User && e.User.EmailAddress) ? e.User.EmailAddress : '';
                        const roleName = (e.Role && e.Role.Name) ? e.Role.Name : '';

                        if (category === 'STUDENT') students++;
                        else if (category === 'FACULTY') faculty++;
                        else if (category === 'IGNORED') ignored++;
                        else { other++; randomRolesData.push({ courseId, courseName, code, name, username, email, roleId, roleName }); }
                    });

                    semesterCoursesData.push({
                        courseId,
                        courseName,
                        code,
                        students,
                        faculty,
                        other,
                        ignored,
                        total: enrollments.length
                    });
                }

                LoadingUtils.updateLoadingModal(98, 'Building tables...');

                // Populate semester courses table
                const coursesBody = document.querySelector('#semesterCoursesTable tbody');
                coursesBody.innerHTML = '';
                semesterCoursesData.forEach(r => {
                    const tr = document.createElement('tr');
                    tr.innerHTML =
                        '<td>' + r.courseId + '</td>' +
                        '<td>' + escapeHtml(r.courseName) + '</td>' +
                        '<td>' + escapeHtml(r.code) + '</td>' +
                        '<td>' + r.students + '</td>' +
                        '<td>' + r.faculty + '</td>' +
                        '<td>' + r.other + '</td>' +
                        '<td>' + r.ignored + '</td>' +
                        '<td>' + r.total + '</td>';
                    coursesBody.appendChild(tr);
                });

                // Populate random roles table
                const randomBody = document.querySelector('#randomRolesTable tbody');
                randomBody.innerHTML = '';
                randomRolesData.forEach(r => {
                    const tr = document.createElement('tr');
                    tr.innerHTML =
                        '<td>' + r.courseId + '</td>' +
                        '<td>' + escapeHtml(r.courseName) + '</td>' +
                        '<td>' + escapeHtml(r.name || '') + '</td>' +
                        '<td>' + escapeHtml(r.username || '') + '</td>' +
                        '<td>' + escapeHtml(r.email || '') + '</td>' +
                        '<td>' + r.roleId + '</td>' +
                        '<td>' + escapeHtml(r.roleName || '') + '</td>';
                    randomBody.appendChild(tr);
                });

                if (window.jQuery && $.fn.DataTable) {
                    if (dtSemesterCourses) dtSemesterCourses.destroy();
                    if (dtRandomRoles) dtRandomRoles.destroy();
                    dtSemesterCourses = $('#semesterCoursesTable').DataTable({
                        pageLength: 25,
                        dom: '<"top"if>rt<"bottom"lp><"clear">'
                    });
                    dtRandomRoles = $('#randomRolesTable').DataTable({
                        pageLength: 25,
                        dom: '<"top"if>rt<"bottom"lp><"clear">'
                    });
                }

                downloadSemesterCsvBtn.disabled = semesterCoursesData.length === 0;
                downloadRandomRolesCsvBtn.disabled = randomRolesData.length === 0;

                downloadSemesterCsvBtn.onclick = function() {
                    const csv = toCsv(semesterCoursesData);
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'enrollments_semester_courses_' + new Date().toISOString().slice(0, 10) + '.csv';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                };

                downloadRandomRolesCsvBtn.onclick = function() {
                    const csv = toCsv(randomRolesData);
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'enrollments_random_roles_' + new Date().toISOString().slice(0, 10) + '.csv';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                };

                setSemesterStatus(
                    'Done. ' + semesterCoursesData.length + ' courses; ' + randomRolesData.length + ' random (OTHER) role enrollments.',
                    true
                );
            } catch (err) {
                console.error(err);
                setSemesterStatus('Error: ' + err.message, true);
            } finally {
                runSemesterBtn.disabled = false;
                setTimeout(() => LoadingUtils.hideLoadingModal(), 500);
            }
        });
    }
});

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}
