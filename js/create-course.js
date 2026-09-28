/**
 * create-course.js
 * Create course shells in D2L with optional ZZStudent and Add Instructors step.
 */

(function () {
    'use strict';

    async function BrightspaceFetch(fetchMethod, fetchUrl, fetchData) {
        var headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Csrf-Token': localStorage.getItem('XSRF.Token') || ''
        };
        var options = { method: fetchMethod, headers: headers, credentials: 'include' };
        if (fetchData != null) options.body = JSON.stringify(fetchData);
        try {
            var res = await fetch(fetchUrl, options);
            var newToken = res.headers.get('x-csrf-token');
            if (newToken) localStorage.setItem('XSRF.Token', newToken);
            var result = { status: res.status, data: {} };
            if (res.ok) {
                if (res.status !== 204) {
                    var text = await res.text();
                    result.data = text ? JSON.parse(text) : {};
                }
                return result;
            }
            result.error = await res.text();
            return result;
        } catch (err) {
            console.error('BrightspaceFetch exception:', err);
            return { status: 500, error: String(err) };
        }
    }

    function getEl(id) {
        return document.getElementById(id);
    }

    function updateProcessStep(stepNumber) {
        [1, 2, 3].forEach(function (n) {
            var el = getEl('course-step-' + n);
            if (el) el.classList.remove('active');
        });
        var current = getEl('course-step-' + stepNumber);
        if (current) current.classList.add('active');
    }

    function showInstructorSection(show) {
        var section = getEl('course-instructor-section');
        var btn = getEl('course-enroll-instructor-btn');
        if (section) section.style.display = show ? 'block' : 'none';
        if (btn) btn.disabled = !show;
    }

    async function createCourse() {
        var createBtn = getEl('create-course-btn');
        var resetBtn = getEl('create-course-reset-btn');
        var successEl = getEl('create-course-success');
        var form = document.getElementById('create-course-form');

        if (!form || !createBtn) return;

        var courseCode = (getEl('course-code') && getEl('course-code').value.trim()) || '';
        var courseName = (getEl('course-name') && getEl('course-name').value.trim()) || '';
        var description = (getEl('course-description') && getEl('course-description').value.trim()) || '';
        var templateId = parseInt((getEl('course-template-id') && getEl('course-template-id').value) || '6607', 10) || 6607;
        var addZZStudent = getEl('add-zzstudent') ? getEl('add-zzstudent').checked : false;

        if (!courseCode) {
            alert('Please enter a course code.');
            return;
        }
        if (!courseName) {
            alert('Please enter a course name.');
            return;
        }

        var originalHtml = createBtn.innerHTML;
        createBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
        createBtn.disabled = true;
        if (successEl) successEl.innerHTML = '';

        try {
            var whoamiResult = await BrightspaceFetch('GET', window.location.origin + '/d2l/api/lp/1.47/users/whoami', null);
            if (whoamiResult.status !== 200) {
                throw new Error('Failed to verify user. Please refresh and try again.');
            }

            var courseData = {
                Name: courseName,
                Code: courseCode,
                CourseTemplateId: templateId,
                Path: '',
                StartDate: null,
                EndDate: null,
                SemesterId: null,
                Department: null,
                LocaleId: null,
                ForceLocale: false,
                ShowAddressBook: true,
                Description: { Content: description || '', Type: 'Text' },
                CanSelfRegister: false,
                IsActive: true
            };

            var createUrl = window.location.origin + '/d2l/api/lp/1.49/courses/';
            var result = await BrightspaceFetch('POST', createUrl, courseData);

            if (result.status === 200 && result.data && result.data.Identifier) {
                var courseId = result.data.Identifier;
                var courseLink = window.location.origin + '/d2l/home/' + courseId;
                var classListLink = window.location.origin + '/d2l/lms/classlist/classlist.d2l?ou=' + courseId;

                var courseIdField = getEl('course-id');
                if (courseIdField) courseIdField.value = courseId;

                showInstructorSection(true);
                updateProcessStep(2);

                createBtn.style.display = 'none';
                if (resetBtn) resetBtn.style.display = 'inline-block';

                var selectedEl = getEl('course-selected-instructors');
                if (selectedEl) selectedEl.innerHTML = '<p style="margin:0;color:#666;">No additional instructors enrolled yet.</p>';

                var zzStatusHtml = addZZStudent
                    ? '<p id="course-zz-status" style="margin:8px 0 0 0;"><i class="fa-solid fa-spinner fa-spin"></i> Creating and enrolling Demo Student (ZZStudent)...</p>'
                    : '';

                if (successEl) {
                    successEl.innerHTML =
                        '<div class="form-section" style="background:#e8f5e9;border:1px solid var(--success-color,#4caf50);border-radius:4px;padding:12px;margin-bottom:16px;">' +
                        '<p style="margin:0 0 8px 0;"><strong>Success!</strong> Course "' + (courseName.replace(/</g, '&lt;')) + '" was created.</p>' +
                        zzStatusHtml +
                        '<p style="margin:8px 0 0 0;">You can add instructors below or open the course.</p>' +
                        '<p style="margin:12px 0 0 0;">' +
                        '<a href="' + courseLink + '" target="_blank" class="btn btn-primary" style="margin-right:8px;"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open course</a> ' +
                        '<a href="' + classListLink + '" target="_blank" class="btn btn-outline">Manage class list</a>' +
                        '</p></div>';
                }

                form.querySelectorAll('input:not([type="hidden"]), textarea').forEach(function (f) {
                    if (f.id !== 'course-id') f.disabled = true;
                });

                if (addZZStudent && window.ZZStudentManager && typeof window.ZZStudentManager.createAndEnrollZZStudent === 'function') {
                    window.ZZStudentManager.createAndEnrollZZStudent(courseId, function (success, message) {
                        var el = getEl('course-zz-status');
                        if (el) {
                            el.innerHTML = success
                                ? '<span style="color:var(--success-color,#4caf50);"><i class="fa-solid fa-check-circle"></i> ' + (message || 'ZZStudent created and enrolled.') + '</span>'
                                : '<span style="color:var(--danger-color,#f44336);"><i class="fa-solid fa-exclamation-triangle"></i> ' + (message || 'ZZStudent could not be added.') + '</span>';
                        }
                    });
                } else if (addZZStudent) {
                    var el = getEl('course-zz-status');
                    if (el) el.innerHTML = '<span style="color:#666;">ZZStudent manager not available. Use Manage class list to add a demo student.</span>';
                }
            } else {
                var errMsg = (result.error && result.error.substring(0, 200)) || 'Unknown error';
                if (successEl) successEl.innerHTML = '<div class="form-section" style="background:#ffebee;border:1px solid var(--danger-color,#f44336);border-radius:4px;padding:12px;"><strong>Error:</strong> Could not create course. ' + errMsg + '</div>';
            }
        } catch (err) {
            console.error('Create course error:', err);
            if (successEl) successEl.innerHTML = '<div class="form-section" style="background:#ffebee;border:1px solid var(--danger-color,#f44336);border-radius:4px;padding:12px;"><strong>Error:</strong> ' + (err.message || 'An error occurred.') + '</div>';
        } finally {
            createBtn.innerHTML = originalHtml;
            createBtn.disabled = false;
        }
    }

    function resetCourseForm() {
        var form = getEl('create-course-form');
        var createBtn = getEl('create-course-btn');
        var resetBtn = getEl('create-course-reset-btn');
        var successEl = getEl('create-course-success');
        var courseIdField = getEl('course-id');
        var selectedEl = getEl('course-selected-instructors');

        if (courseIdField) courseIdField.value = '';
        if (form) {
            form.reset();
            form.querySelectorAll('input, textarea').forEach(function (f) { f.disabled = false; });
        }
        showInstructorSection(false);
        updateProcessStep(1);
        if (successEl) successEl.innerHTML = '';
        if (createBtn) { createBtn.style.display = 'inline-block'; createBtn.disabled = false; }
        if (resetBtn) resetBtn.style.display = 'none';
        if (selectedEl) selectedEl.innerHTML = '<p style="margin:0;color:#666;">No additional instructors enrolled yet.</p>';
    }

    async function processInstructorEnrollment(instructor) {
        var courseIdField = getEl('course-id');
        var courseId = courseIdField ? courseIdField.value : '';
        if (!courseId) {
            alert('No course ID found. Please create a course first.');
            return;
        }

        var enrollBtn = getEl('course-enroll-instructor-btn');
        var originalHtml = enrollBtn ? enrollBtn.innerHTML : '';
        if (enrollBtn) {
            enrollBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enrolling...';
            enrollBtn.disabled = true;
        }

        try {
            var enrollData = {
                OrgUnitId: parseInt(courseId, 10),
                UserId: parseInt(instructor.userId, 10),
                RoleId: 102,
                IsCascading: false
            };
            var enrollUrl = window.location.origin + '/d2l/api/lp/1.45/enrollments/';
            var result = await BrightspaceFetch('POST', enrollUrl, enrollData);

            if (result.status === 200) {
                var container = getEl('course-selected-instructors');
                if (container) {
                    var noMsg = container.querySelector('p');
                    if (noMsg && noMsg.textContent.indexOf('No additional') !== -1) container.innerHTML = '';
                    var div = document.createElement('div');
                    div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee;';
                    div.innerHTML = '<div><strong>' + (instructor.displayName || '').replace(/</g, '&lt;') + '</strong> <span style="color:#666;">' + (instructor.username || '').replace(/</g, '&lt;') + '</span></div>' +
                        '<span style="color:var(--success-color,#4caf50);font-size:0.875rem;"><i class="fa-solid fa-check-circle"></i> Enrolled</span>';
                    container.appendChild(div);
                }
            } else {
                alert('Enrollment failed: ' + (result.error || result.status));
            }
        } catch (err) {
            console.error('Enroll instructor error:', err);
            alert('Enrollment failed: ' + (err.message || ''));
        } finally {
            if (enrollBtn) {
                enrollBtn.innerHTML = originalHtml;
                enrollBtn.disabled = false;
            }
        }
    }

    function onDoneInstructors() {
        updateProcessStep(3);
        var successEl = getEl('create-course-success');
        if (successEl && successEl.innerHTML.indexOf('Course ready') === -1) {
            var wrap = successEl.querySelector('div');
            if (wrap) {
                var p = document.createElement('p');
                p.style.marginTop = '12px';
                p.innerHTML = '<strong>Course ready.</strong> You can open the course or create another.';
                wrap.appendChild(p);
            }
        }
    }

    function onEnrollInstructorClick() {
        var courseIdField = getEl('course-id');
        if (!courseIdField || !courseIdField.value) {
            alert('Please create a course first.');
            return;
        }
        if (typeof window.openInstructorSearch === 'function') {
            window.openInstructorSearch();
        } else {
            alert('Instructor search is not available.');
        }
    }

    function init() {
        var form = getEl('create-course-form');
        if (!form) return;

        window.processInstructorEnrollment = processInstructorEnrollment;

        var createBtn = getEl('create-course-btn');
        var resetBtn = getEl('create-course-reset-btn');
        var enrollBtn = getEl('course-enroll-instructor-btn');
        var doneBtn = getEl('course-done-instructors-btn');

        if (createBtn) createBtn.addEventListener('click', createCourse);
        if (resetBtn) resetBtn.addEventListener('click', resetCourseForm);
        if (enrollBtn) enrollBtn.addEventListener('click', onEnrollInstructorClick);
        if (doneBtn) doneBtn.addEventListener('click', onDoneInstructors);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
