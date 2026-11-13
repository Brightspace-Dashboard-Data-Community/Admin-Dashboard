/**
 * zzstudent-manager.js
 * Create and enroll ZZStudent (Demo Student) in a course.
 * Used by Create Sandbox and Create Course Shell.
 */

(function () {
    'use strict';

    var base = typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : '';

    function brightspaceFetch(method, url, data) {
        var headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Csrf-Token': (typeof localStorage !== 'undefined' && localStorage.getItem('XSRF.Token')) || ''
        };
        var options = { method: method, headers: headers, credentials: 'include' };
        if (data != null) options.body = JSON.stringify(data);
        return fetch(url, options).then(function (res) {
            var newToken = res.headers.get('x-csrf-token');
            if (newToken && typeof localStorage !== 'undefined') localStorage.setItem('XSRF.Token', newToken);
            var out = { status: res.status, data: null, error: null };
            if (res.ok) {
                if (res.status !== 204) {
                    return res.text().then(function (text) {
                        out.data = text ? JSON.parse(text) : {};
                        return out;
                    });
                }
                return Promise.resolve(out);
            }
            return res.text().then(function (text) {
                out.error = text;
                return out;
            });
        }).catch(function (err) {
            return { status: 500, error: String(err) };
        });
    }

    function getUserIdFromResponse(data) {
        if (!data) return null;
        if (data.UserId != null) return data.UserId;
        if (data.Items && data.Items.length > 0 && data.Items[0].UserId != null) return data.Items[0].UserId;
        if (Array.isArray(data) && data.length > 0 && data[0].UserId != null) return data[0].UserId;
        return null;
    }

    window.ZZStudentManager = {
        /**
         * Create and enroll a ZZStudent in a course.
         * @param {string|number} courseId - Course org unit ID
         * @param {function(boolean, string)} callback - callback(success, message)
         */
        createAndEnrollZZStudent: function (courseId, callback) {
            if (!courseId) {
                if (callback) callback(false, 'No course ID provided');
                return Promise.resolve(false);
            }

            var demoStudentUserName = 'ZZDemoStudent-' + courseId;

            return brightspaceFetch('GET', base + '/d2l/api/lp/1.45/users/?userName=' + encodeURIComponent(demoStudentUserName), null)
                .then(function (checkRes) {
                    var userId = null;
                    if (checkRes.status === 200 && checkRes.data) {
                        userId = getUserIdFromResponse(checkRes.data);
                    }

                    if (userId != null) {
                        // User exists, enroll in course
                        var enrollData = {
                            OrgUnitId: parseInt(courseId, 10),
                            UserId: userId,
                            RoleId: 112,
                            IsCascading: false
                        };
                        return brightspaceFetch('POST', base + '/d2l/api/lp/1.45/enrollments/', enrollData)
                            .then(function (enrollRes) {
                                if (enrollRes.status === 200) {
                                    if (callback) callback(true, 'ZZStudent enrolled in the course.');
                                    return true;
                                }
                                if (callback) callback(false, enrollRes.error || 'Failed to enroll ZZStudent.');
                                return false;
                            });
                    }

                    // Create new demo user
                    var demoStudentData = {
                        OrgDefinedId: '',
                        FirstName: 'ZZDemo',
                        MiddleName: '',
                        LastName: 'ZZStudent',
                        ExternalEmail: null,
                        UserName: demoStudentUserName,
                        RoleId: 112,
                        IsActive: true,
                        SendCreationEmail: false,
                        Pronouns: ''
                    };

                    return brightspaceFetch('POST', base + '/d2l/api/lp/1.45/users/', demoStudentData)
                        .then(function (createRes) {
                            if (createRes.status !== 200 || !createRes.data || createRes.data.UserId == null) {
                                if (callback) callback(false, createRes.error || 'Failed to create ZZStudent user.');
                                return false;
                            }
                            var newUserId = createRes.data.UserId;
                            var enrollData = {
                                OrgUnitId: parseInt(courseId, 10),
                                UserId: newUserId,
                                RoleId: 112,
                                IsCascading: false
                            };
                            return brightspaceFetch('POST', base + '/d2l/api/lp/1.45/enrollments/', enrollData)
                                .then(function (enrollRes) {
                                    if (enrollRes.status === 200) {
                                        if (callback) callback(true, 'ZZStudent created and enrolled in the course.');
                                        return true;
                                    }
                                    if (callback) callback(false, enrollRes.error || 'Failed to enroll ZZStudent.');
                                    return false;
                                });
                        });
                })
                .catch(function (err) {
                    if (callback) callback(false, err.message || 'Unknown error');
                    return false;
                });
        }
    };
})();
