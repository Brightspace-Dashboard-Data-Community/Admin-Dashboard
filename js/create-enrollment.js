/**
 * Create Enrollment - Single enrollment form logic
 * Uses D2LApi when available; fallback to BrightspaceFetch-style fetch for same-origin D2L.
 */
(function () {
    'use strict';

    function getBaseUrl() {
        if (typeof window !== 'undefined' && window.location && window.location.origin) {
            return window.location.origin;
        }
        return '';
    }

    async function BrightspaceFetch(endpoint, method = 'GET', body = null) {
        const url = endpoint.startsWith('http') ? endpoint : getBaseUrl() + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
        if (typeof D2LApi !== 'undefined' && D2LApi && typeof D2LApi._fetch === 'function') {
            return D2LApi._fetch(url, {
                method,
                body: body ? JSON.stringify(body) : undefined
            });
        }
        const options = {
            method,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-CSRF-Token': localStorage.getItem('XSRF.Token') || ''
            },
            credentials: 'include'
        };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(url, options);
        if (!res.ok) throw new Error('API Error: ' + res.status + ' ' + res.statusText);
        const text = await res.text();
        if (!text || !text.trim()) return method === 'GET' ? [] : {};
        try {
            return JSON.parse(text);
        } catch (_) {
            return text;
        }
    }

    let selectedUser = null;
    let selectedCourse = null;
    let rootOrgUnitId = null;

    async function getRootOrgUnitId() {
        const response = await BrightspaceFetch('/d2l/api/lp/1.49/organization/info');
        rootOrgUnitId = response.Identifier;
    }

    async function loadSemesters() {
        if (!rootOrgUnitId) return;
        const response = await BrightspaceFetch(`/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`);
        const specialSemester = { Identifier: '0000', Name: '0000-No Semester' };
        let filteredSemesters;
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            filteredSemesters = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(response || []));
        } else {
            const minSemesterIdentifier = 2966924;
            filteredSemesters = (response || []).filter(function (semester) {
                const semesterId = semester.Identifier;
                return parseInt(semesterId, 10) >= minSemesterIdentifier || semesterId === specialSemester.Identifier;
            });
            filteredSemesters.sort(function (a, b) { return b.Name.localeCompare(a.Name); });
        }
        if (!filteredSemesters.some(function (sem) { return sem.Identifier === specialSemester.Identifier; })) {
            filteredSemesters.push(specialSemester);
        }
        const termSelect = document.getElementById('term');
        if (!termSelect) return;
        termSelect.innerHTML = '<option value="">Select a Semester</option>';
        filteredSemesters.forEach(function (semester) {
            const option = document.createElement('option');
            option.value = semester.Identifier;
            option.textContent = semester.Name;
            termSelect.appendChild(option);
        });
    }

    function loadRoles() {
        var commonRoles = [
            { Identifier: 100, DisplayName: 'Admin' },
            { Identifier: 101, DisplayName: 'Student' },
            { Identifier: 102, DisplayName: 'Instructor' },
            { Identifier: 107, DisplayName: 'Incomplete Student' },
            { Identifier: 139, DisplayName: 'Faculty Member' },
            { Identifier: 151, DisplayName: 'Faculty' },
            { Identifier: 138, DisplayName: 'Course Evaluator' },
            { Identifier: 112, DisplayName: 'Student View' },
            { Identifier: 122, DisplayName: 'Trainer' },
            { Identifier: 135, DisplayName: 'Master Trainer' }
        ];
        var roleSelect = document.getElementById('enrollmentRole');
        if (!roleSelect) return;
        roleSelect.innerHTML = '<option value="">Select Role</option>';
        commonRoles.forEach(function (role) {
            var option = document.createElement('option');
            option.value = role.Identifier;
            option.textContent = role.DisplayName;
            roleSelect.appendChild(option);
        });
    }

    function getRoleName(roleId) {
        var roles = [
            { Identifier: 100, DisplayName: 'Admin' },
            { Identifier: 101, DisplayName: 'Student' },
            { Identifier: 102, DisplayName: 'Instructor' },
            { Identifier: 107, DisplayName: 'Incomplete Student' },
            { Identifier: 139, DisplayName: 'Faculty Member' },
            { Identifier: 151, DisplayName: 'Faculty' },
            { Identifier: 138, DisplayName: 'Course Evaluator' },
            { Identifier: 112, DisplayName: 'Student View' },
            { Identifier: 122, DisplayName: 'Trainer' },
            { Identifier: 135, DisplayName: 'Master Trainer' }
        ];
        var role = roles.find(function (r) { return r.Identifier === parseInt(roleId, 10); });
        return role ? role.DisplayName : 'Unknown Role';
    }

    async function handleUserSearch() {
        var query = document.getElementById('userSearch').value.trim();
        if (!query) {
            alert('Please enter a user search term');
            return;
        }
        var userResults = document.getElementById('userResults');
        userResults.style.display = 'block';
        userResults.innerHTML = '<div>Loading users...</div>';
        var users = [];
        try {
            try {
                var orgIdResponse = await BrightspaceFetch('/d2l/api/lp/1.46/users/?orgDefinedId=' + encodeURIComponent(query));
                users = Array.isArray(orgIdResponse) ? orgIdResponse : (orgIdResponse ? [orgIdResponse] : []);
            } catch (e) {}
            if (!users.length) {
                try {
                    var usernameResponse = await BrightspaceFetch('/d2l/api/lp/1.46/users/?userName=' + encodeURIComponent(query));
                    users = Array.isArray(usernameResponse) ? usernameResponse : (usernameResponse ? [usernameResponse] : []);
                } catch (e) {}
            }
            if (!users.length && !isNaN(query)) {
                try {
                    var userIdResponse = await BrightspaceFetch('/d2l/api/lp/1.49/users/' + query);
                    if (userIdResponse) users = [userIdResponse];
                } catch (e) {}
            }
            displayUserResults(users);
        } catch (error) {
            userResults.innerHTML = '<div>Error: ' + (error.message || 'Search failed') + '</div>';
        }
    }

    function displayUserResults(users) {
        var userResults = document.getElementById('userResults');
        if (!users || users.length === 0) {
            userResults.innerHTML = '<div>No users found</div>';
            return;
        }
        var table = document.createElement('table');
        table.className = 'data-table enrollment-results-table';
        table.innerHTML = '<thead><tr><th></th><th>Name</th><th>Email</th><th>Username</th><th>ID</th></tr></thead><tbody>' +
            users.map(function (user) {
                var fullName = (user.FirstName + ' ' + user.LastName).trim();
                var idValue = (user.OrgDefinedId || user.UserId || '').toString();
                return '<tr>' +
                    '<td class="enrollment-select-cell"><input type="radio" name="userSelect" value="' + user.UserId + '"></td>' +
                    '<td><div class="enroll-user-name">' + fullName + '</div></td>' +
                    '<td><div class="enroll-user-meta">' + (user.ExternalEmail || '') + '</div></td>' +
                    '<td><div class="enroll-user-meta">' + (user.UserName || '') + '</div></td>' +
                    '<td><div class="enroll-user-meta">' + idValue + '</div></td>' +
                    '</tr>';
            }).join('') + '</tbody>';
        userResults.innerHTML = '';
        userResults.appendChild(table);
        table.querySelectorAll('input[type="radio"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                var u = users.find(function (x) { return x.UserId === parseInt(radio.value, 10); });
                if (u) selectUser(u);
            });
        });
    }

    function selectUser(user) {
        selectedUser = user;
        var selectedUserDiv = document.getElementById('selectedUser');
        selectedUserDiv.style.display = 'block';
        selectedUserDiv.innerHTML = '<div class="selected-item-content"><div class="selected-item-details"><h4>' +
            (user.FirstName + ' ' + user.LastName) + '</h4><p>' + (user.ExternalEmail || '') + '</p><p>Username: ' +
            (user.UserName || 'N/A') + '</p><p>ID: ' + (user.OrgDefinedId || user.UserId) + '</p></div></div><button type="button" class="btn btn-outline clear-selection-btn"><i class="fa-solid fa-xmark"></i></button>';
        selectedUserDiv.querySelector('.clear-selection-btn').addEventListener('click', function () {
            selectedUser = null;
            selectedUserDiv.style.display = 'none';
            document.getElementById('userResults').style.display = 'block';
        });
        document.getElementById('userResults').style.display = 'none';
    }

    async function fetchCoursesBySemester(semesterId) {
        try {
            var childrenResponse = await BrightspaceFetch('/d2l/api/lp/1.49/orgstructure/' + semesterId + '/children/');
            return childrenResponse.filter(function (item) {
                return item.Type && (item.Type.Code === 'Course Offering' || item.Type.Name === 'Course Offering' || item.Type.Id === 3);
            });
        } catch (err) {
            var descendantsResponse = await BrightspaceFetch('/d2l/api/lp/1.49/orgstructure/' + semesterId + '/descendants/');
            return descendantsResponse.filter(function (c) {
                return c.Type && c.Type.Code === 'Course Offering';
            });
        }
    }

    async function handleCourseSearch() {
        var query = document.getElementById('courseSearch').value.trim();
        var semesterId = document.getElementById('term').value;
        if (!semesterId) {
            alert('Please select a semester');
            return;
        }
        if (!query) {
            alert('Please enter a course search term');
            return;
        }
        var courseResults = document.getElementById('courseResults');
        courseResults.style.display = 'block';
        courseResults.innerHTML = '<div>Loading courses...</div>';
        try {
            var courses = await fetchCoursesBySemester(semesterId);
            var filteredCourses = courses.filter(function (course) {
                return (course.Code && course.Code.toLowerCase().indexOf(query.toLowerCase()) !== -1) ||
                    (course.Name && course.Name.toLowerCase().indexOf(query.toLowerCase()) !== -1);
            });
            displayCourseResults(filteredCourses);
        } catch (error) {
            courseResults.innerHTML = '<div>Error: ' + (error.message || 'Search failed') + '</div>';
        }
    }

    function displayCourseResults(courses) {
        var courseResults = document.getElementById('courseResults');
        if (!courses || courses.length === 0) {
            courseResults.innerHTML = '<div>No courses found</div>';
            return;
        }
        var table = document.createElement('table');
        table.className = 'data-table';
        table.innerHTML = '<thead><tr><th></th><th>Code</th><th>Name</th></tr></thead><tbody>' +
            courses.map(function (course) {
                return '<tr><td><input type="radio" name="courseSelect" value="' + course.Identifier + '"></td><td>' + (course.Code || '') + '</td><td>' + (course.Name || '') + '</td></tr>';
            }).join('') + '</tbody>';
        courseResults.innerHTML = '';
        courseResults.appendChild(table);
        table.querySelectorAll('input[type="radio"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                var c = courses.find(function (x) { return String(x.Identifier) === radio.value; });
                if (c) selectCourse(c);
            });
        });
    }

    function selectCourse(course) {
        selectedCourse = course;
        var selectedCourseDiv = document.getElementById('selectedCourse');
        selectedCourseDiv.style.display = 'block';
        selectedCourseDiv.innerHTML = '<div class="selected-item-content"><div class="selected-item-details"><h4>' + (course.Name || '') + '</h4><p>' + (course.Code || '') + '</p></div></div><button type="button" class="btn btn-outline clear-selection-btn"><i class="fa-solid fa-xmark"></i></button>';
        selectedCourseDiv.querySelector('.clear-selection-btn').addEventListener('click', function () {
            selectedCourse = null;
            selectedCourseDiv.style.display = 'none';
            document.getElementById('courseResults').style.display = 'block';
        });
        document.getElementById('courseResults').style.display = 'none';
    }

    async function handleEnrollmentSubmit(event) {
        event.preventDefault();
        if (!selectedUser || !selectedCourse) {
            alert('Please select both a user and a course');
            return;
        }
        var roleId = document.getElementById('enrollmentRole').value;
        if (!roleId) {
            alert('Please select a role');
            return;
        }
        var enrollmentData = {
            OrgUnitId: parseInt(selectedCourse.Identifier, 10),
            UserId: selectedUser.UserId,
            RoleId: parseInt(roleId, 10),
            IsCascading: false
        };
        try {
            await BrightspaceFetch('/d2l/api/lp/1.46/enrollments/', 'POST', enrollmentData);
            var confirmationBox = document.getElementById('enrollmentConfirmation');
            var confirmationMessage = document.getElementById('confirmationMessage');
            var courseLink = document.getElementById('courseLink');
            var roleName = getRoleName(roleId);
            confirmationMessage.innerHTML = '<strong>User:</strong> ' + (selectedUser.FirstName + ' ' + selectedUser.LastName) + ' (' + (selectedUser.ExternalEmail || 'No email') + ')<br><strong>Course:</strong> ' + (selectedCourse.Name || '') + ' (' + (selectedCourse.Code || '') + ')<br><strong>Role:</strong> ' + roleName;
            courseLink.href = getBaseUrl() + '/d2l/home/' + selectedCourse.Identifier;
            confirmationBox.style.display = 'block';
            selectedUser = null;
            selectedCourse = null;
            document.getElementById('selectedUser').style.display = 'none';
            document.getElementById('selectedCourse').style.display = 'none';
            document.getElementById('enrollmentRole').value = '';
            document.getElementById('userSearch').value = '';
            document.getElementById('courseSearch').value = '';
        } catch (error) {
            console.error('Error creating enrollment:', error);
            alert('Failed to create enrollment: ' + (error.message || 'Unknown error'));
        }
    }

    function init() {
        var userSearchBtn = document.getElementById('userSearchBtn');
        var courseSearchBtn = document.getElementById('courseSearchBtn');
        var form = document.getElementById('single-enrollment-form');
        var closeConfirmation = document.getElementById('closeConfirmation');
        if (userSearchBtn) userSearchBtn.addEventListener('click', handleUserSearch);
        if (courseSearchBtn) courseSearchBtn.addEventListener('click', handleCourseSearch);
        if (form) form.addEventListener('submit', handleEnrollmentSubmit);
        if (closeConfirmation) closeConfirmation.addEventListener('click', function () {
            document.getElementById('enrollmentConfirmation').style.display = 'none';
        });
        getRootOrgUnitId().then(function () {
            loadSemesters();
        }).catch(function (err) {
            console.error('Error fetching organization info:', err);
        });
        loadRoles();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
