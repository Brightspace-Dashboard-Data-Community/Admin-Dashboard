/**
 * instructor-selector.js
 * Search modal for adding instructors to a sandbox course.
 * Used by create-sandbox.html after course creation.
 * Call window.openInstructorSearch() to open; enroll uses window.processInstructorEnrollment(instructor).
 */

(function () {
    'use strict';

    function getEl(id) {
        return document.getElementById(id);
    }

    async function brightspaceFetch(method, url, data) {
        var headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Csrf-Token': localStorage.getItem('XSRF.Token') || ''
        };
        var options = { method: method, headers: headers, credentials: 'include' };
        if (data != null) options.body = JSON.stringify(data);
        var res = await fetch(url, options);
        var newToken = res.headers.get('x-csrf-token');
        if (newToken) localStorage.setItem('XSRF.Token', newToken);
        var out = { status: res.status, data: null, error: null };
        if (res.ok) {
            if (res.status !== 204) {
                var text = await res.text();
                out.data = text ? JSON.parse(text) : null;
            }
            return out;
        }
        out.error = await res.text();
        return out;
    }

    async function searchUser(query, searchType) {
        var base = window.location.origin;
        var results = [];
        if (searchType === 'userId') {
            if (!/^\d+$/.test(query)) throw new Error('User ID must be a number');
            var r = await brightspaceFetch('GET', base + '/d2l/api/lp/1.49/users/' + query, null);
            if (r.status === 200 && r.data) results = [r.data];
        } else if (searchType === 'userName') {
            var r = await brightspaceFetch('GET', base + '/d2l/api/lp/1.46/users/?userName=' + encodeURIComponent(query), null);
            if (r.status === 200 && r.data) {
                if (Array.isArray(r.data)) results = r.data;
                else if (r.data.UserId) results = [r.data];
            }
        } else {
            var r = await brightspaceFetch('GET', base + '/d2l/api/lp/1.46/users/?orgDefinedId=' + encodeURIComponent(query), null);
            if (r.status === 200 && r.data) {
                if (Array.isArray(r.data)) results = r.data;
                else if (r.data.UserId) results = [r.data];
            }
        }
        return results;
    }

    function closeModal() {
        var modal = getEl('instructor-search-modal');
        if (modal) modal.style.display = 'none';
    }

    function displayResults(users) {
        var container = getEl('modal-search-results');
        if (!container) return;
        if (!users || users.length === 0) {
            container.innerHTML = '<p class="instructor-modal-no-results">No users found matching your search.</p>';
            return;
        }
        var name = function (u) {
            return [u.FirstName || '', u.MiddleName || '', u.LastName || ''].join(' ').trim() || u.UserName || '';
        };
        var html = '<h3 class="instructor-modal-results-title">Search Results (' + users.length + ')</h3>' +
            '<p class="instructor-modal-hint"><i class="fa-solid fa-circle-info"></i> Click Enroll to add the instructor to the sandbox.</p>' +
            '<table class="instructor-modal-table"><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>ID Number</th><th>Actions</th></tr></thead><tbody>';
        users.forEach(function (u) {
            var n = name(u);
            html += '<tr><td>' + (n.replace(/</g, '&lt;')) + '</td><td>' + (u.UserName || '').replace(/</g, '&lt;') + '</td><td>' + (u.ExternalEmail || '').replace(/</g, '&lt;') + '</td><td>' + (u.OrgDefinedId || '').replace(/</g, '&lt;') + '</td><td>' +
                '<button type="button" class="btn btn-primary instructor-enroll-btn" data-userid="' + (u.UserId || '') + '" data-username="' + (u.UserName || '').replace(/"/g, '&quot;') + '" data-displayname="' + n.replace(/"/g, '&quot;') + '"><i class="fa-solid fa-user-plus"></i> Enroll</button></td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
        container.querySelectorAll('.instructor-enroll-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var instructor = {
                    userId: this.getAttribute('data-userid'),
                    username: this.getAttribute('data-username') || '',
                    displayName: this.getAttribute('data-displayname') || ''
                };
                this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enrolling...';
                this.disabled = true;
                closeModal();
                if (typeof window.processInstructorEnrollment === 'function') {
                    window.processInstructorEnrollment(instructor);
                } else {
                    alert('Enrollment not available. Please try again.');
                }
            });
        });
    }

    function openInstructorSearch() {
        var modal = getEl('instructor-search-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'instructor-search-modal';
            modal.className = 'instructor-modal-overlay';
            modal.innerHTML =
                '<div class="instructor-modal-content">' +
                '<div class="instructor-modal-header">' +
                '<h2>Search for Instructor</h2>' +
                '<button type="button" class="instructor-modal-close" aria-label="Close"><i class="fa-solid fa-times"></i></button>' +
                '</div>' +
                '<div class="instructor-modal-body">' +
                '<form id="instructor-modal-search-form">' +
                '<div class="instructor-modal-search-row">' +
                '<input type="text" id="modal-search-query" placeholder="Enter search term..." required>' +
                '<select id="modal-search-type">' +
                '<option value="orgDefinedId">ID Number</option>' +
                '<option value="userName">Username</option>' +
                '<option value="userId">User ID</option>' +
                '</select>' +
                '<button type="submit" class="btn btn-primary"><i class="fa-solid fa-search"></i> Search</button>' +
                '</div>' +
                '</form>' +
                '<p class="instructor-modal-tips"><i class="fa-solid fa-circle-info"></i> Search by ID Number (Org Defined ID), Username, or User ID.</p>' +
                '<div id="modal-search-results" class="instructor-modal-results">' +
                '<p class="instructor-modal-no-results">Enter a search term to find users.</p>' +
                '</div>' +
                '</div>' +
                '</div>';
            document.body.appendChild(modal);

            var style = document.createElement('style');
            style.textContent =
                '.instructor-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;}' +
                '.instructor-modal-overlay[style*="flex"]{display:flex!important;}' +
                '.instructor-modal-content{background:#fff;border-radius:8px;width:90%;max-width:800px;max-height:90vh;overflow:auto;box-shadow:0 4px 20px rgba(0,0,0,0.2);}' +
                '.instructor-modal-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border-color,#e0e0e0);}' +
                '.instructor-modal-header h2{margin:0;font-size:1.25rem;}' +
                '.instructor-modal-close{background:none;border:none;font-size:1.25rem;cursor:pointer;color:#666;padding:4px;}' +
                '.instructor-modal-body{padding:20px;}' +
                '.instructor-modal-search-row{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;}' +
                '.instructor-modal-search-row input{flex:1;min-width:180px;}' +
                '.instructor-modal-search-row select{min-width:140px;}' +
                '.instructor-modal-tips{font-size:0.875rem;color:#666;margin-bottom:16px;}' +
                '.instructor-modal-results{margin-top:16px;}' +
                '.instructor-modal-no-results,.instructor-modal-hint{padding:12px;color:#666;}' +
                '.instructor-modal-hint{background:#e3f2fd;border-left:4px solid var(--primary-color,#2196F3);margin-bottom:12px;}' +
                '.instructor-modal-results-title{margin:0 0 8px 0;font-size:1rem;}' +
                '.instructor-modal-table{width:100%;border-collapse:collapse;font-size:0.875rem;}' +
                '.instructor-modal-table th,.instructor-modal-table td{padding:8px 10px;text-align:left;border-bottom:1px solid #eee;}' +
                '.instructor-modal-table th{background:#f5f5f5;font-weight:600;}';
            document.head.appendChild(style);

            modal.querySelector('.instructor-modal-close').addEventListener('click', closeModal);
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeModal();
            });
            document.getElementById('instructor-modal-search-form').addEventListener('submit', function (e) {
                e.preventDefault();
                var q = (getEl('modal-search-query') && getEl('modal-search-query').value.trim()) || '';
                var t = (getEl('modal-search-type') && getEl('modal-search-type').value) || 'orgDefinedId';
                if (!q) { alert('Please enter a search term'); return; }
                var resultsEl = getEl('modal-search-results');
                var btn = this.querySelector('button[type="submit"]');
                if (resultsEl) resultsEl.innerHTML = '<p class="instructor-modal-no-results"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</p>';
                if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching...'; }
                searchUser(q, t).then(function (users) {
                    displayResults(users);
                }).catch(function (err) {
                    if (resultsEl) resultsEl.innerHTML = '<p class="instructor-modal-no-results" style="color:var(--danger-color,#c00);">' + (err.message || 'Search failed') + '</p>';
                }).finally(function () {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-search"></i> Search'; }
                });
            });
        }
        modal.style.display = 'flex';
        getEl('modal-search-results').innerHTML = '<p class="instructor-modal-no-results">Enter a search term to find users.</p>';
        var input = getEl('modal-search-query');
        if (input) { input.value = ''; setTimeout(function () { input.focus(); }, 100); }
    }

    window.openInstructorSearch = openInstructorSearch;
})();
