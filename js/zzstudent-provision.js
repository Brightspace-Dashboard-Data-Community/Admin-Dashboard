/**
 * ZZStudent Provision Tool
 * Creates unique per-course demo student accounts without enrolling them
 */

(function () {
    'use strict';

    const ROLE_ID_DEMO = 112;
    const OU_TYPE_COURSE_OFFERING = 3;

    let reportRows = [];
    let lastReportCsv = "";

    const semesterSelect = document.getElementById("semesterSelect");
    const previewBtn = document.getElementById("previewBtn");
    const runBtn = document.getElementById("runBtn");
    const deleteBtn = document.getElementById("deleteBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const statusEl = document.getElementById("status");
    const logEl = document.getElementById("log");
    const debugEl = document.getElementById("debug");

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        loadSemesters();
        attachEventListeners();
    });

    function attachEventListeners() {
        previewBtn.addEventListener("click", previewCourses);
        runBtn.addEventListener("click", runProvision);
        deleteBtn.addEventListener("click", runDelete);
        downloadBtn.addEventListener("click", downloadReport);
    }

    function logLine(msg) {
        logEl.textContent = (logEl.textContent ? logEl.textContent + "\n" : "") + msg;
        logEl.scrollTop = logEl.scrollHeight;
    }

    function setStatus(html) {
        if (html) {
            statusEl.innerHTML = html;
            statusEl.style.display = 'block';
        } else {
            statusEl.style.display = 'none';
        }
    }

    function setDebug(obj) {
        try {
            debugEl.textContent = JSON.stringify(obj, null, 2);
        } catch (e) {
            debugEl.textContent = String(obj);
        }
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /** Only semesters for this calendar year and next, YY/TERM or YYYY/TERM with WI, SP, FA. */
    function isCurrentOrNextYearSemester(semester) {
        const y = new Date().getFullYear();
        const allowedYears = [y, y + 1];
        const allowedTerms = ['WI', 'SP', 'FA'];
        const it = semester;
        const ou = it.OrgUnit || it;
        const semesterText = `${ou.Name || it.Name || ''} ${ou.Code || it.Code || ''} ${it.Code || ''}`.toUpperCase();

        return allowedYears.some(function (year) {
            const yy = String(year).slice(-2);
            return allowedTerms.some(function (term) {
                const yyPat = new RegExp('\\b' + yy + '\\s*[\\/-]\\s*' + term + '\\b');
                const yyyyPat = new RegExp('\\b' + year + '\\s*[\\/-]\\s*' + term + '\\b');
                return yyPat.test(semesterText) || yyyyPat.test(semesterText);
            });
        });
    }

    // -----------------------------
    // 1) Load semesters for dropdown
    // -----------------------------
    async function loadSemesters() {
        semesterSelect.innerHTML = '<option value="">Loading semesters...</option>';

        try {
            // Get root org unit ID
            const orgInfo = await D2LApi.getOrganizationInfo();
            if (!orgInfo || !orgInfo.Identifier) {
                throw new Error('Could not get organization info');
            }

            const rootOrgUnitId = orgInfo.Identifier;

            // Fetch semesters (OU Type 5)
            let data = [];
            if (typeof D2LApi.fetchPaginatedData === 'function') {
                data = await D2LApi.fetchPaginatedData(
                    `/d2l/api/lp/1.45/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
                );
            } else {
                const response = await D2LApi._fetch(
                    `/d2l/api/lp/1.45/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
                );
                if (response.Objects && Array.isArray(response.Objects)) {
                    data = response.Objects;
                } else if (Array.isArray(response)) {
                    data = response;
                } else if (response.Items && Array.isArray(response.Items)) {
                    data = response.Items;
                }
            }

            const filtered = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
                ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data || []))
                : (data || []).filter(isCurrentOrNextYearSemester);

            // Build options
            semesterSelect.innerHTML = '<option value="">-- Select a semester --</option>';

            if (!filtered.length) {
                semesterSelect.innerHTML = '<option value="">No semesters available</option>';
                setStatus("No semesters available.");
                logLine("Semester dropdown is empty (allowlist returned nothing).");
                return;
            }

            if (typeof SemesterConfig === 'undefined') {
                filtered.sort((a, b) => {
                    const nameA = (a.Name || a.OrgUnit?.Name || '').toUpperCase();
                    const nameB = (b.Name || b.OrgUnit?.Name || '').toUpperCase();
                    return nameB.localeCompare(nameA);
                });
            }

            for (let i = 0; i < filtered.length; i++) {
                const it = filtered[i];
                const ou = it.OrgUnit || it;
                const ouId = ou.Identifier || ou.Id || it.Identifier || it.Id;
                const name = ou.Name || it.Name || ("Semester " + ouId);

                if (!ouId) continue;

                const opt = document.createElement("option");
                opt.value = String(ouId);
                opt.textContent = name + " (" + ouId + ")";
                semesterSelect.appendChild(opt);
            }

            setStatus("Semesters loaded.");
            logLine("Loaded semesters into dropdown.");
        } catch (error) {
            console.error('Error loading semesters:', error);
            semesterSelect.innerHTML = '<option value="">Failed to load semesters</option>';
            setStatus("Failed to load semesters. Check console for details.");
            logLine("ERROR loading semesters: " + error.message);
        }
    }

    // -----------------------------------------
    // 2) Get courses under selected semester
    // -----------------------------------------
    async function getCoursesForSemester(semesterId) {
        try {
            let results = [];
            if (typeof D2LApi.fetchPaginatedData === 'function') {
                results = await D2LApi.fetchPaginatedData(
                    `/d2l/api/lp/1.45/orgstructure/${semesterId}/children/`
                );
            } else {
                const response = await D2LApi._fetch(
                    `/d2l/api/lp/1.45/orgstructure/${semesterId}/children/?pageSize=100`
                );
                if (response.Objects && Array.isArray(response.Objects)) {
                    results = response.Objects;
                } else if (Array.isArray(response)) {
                    results = response;
                } else if (response.Items && Array.isArray(response.Items)) {
                    results = response.Items;
                }
            }

            // Filter to Course Offering OU Type = 3
            const courses = [];
            for (let i = 0; i < results.length; i++) {
                const it = results[i];
                const ou = it.OrgUnit || it;

                const ouId = ou.Identifier || ou.Id || it.Identifier || it.Id;
                const ouName = ou.Name || it.Name || "";
                let typeId = null;

                // Try different ways to get the type ID
                if (ou.Type && typeof ou.Type.Id !== "undefined") typeId = ou.Type.Id;
                else if (it.Type && typeof it.Type.Id !== "undefined") typeId = it.Type.Id;
                else if (typeof ou.TypeId !== "undefined") typeId = ou.TypeId;
                else if (typeof it.TypeId !== "undefined") typeId = it.TypeId;
                else if (ou.Type && typeof ou.Type.Identifier !== "undefined") typeId = ou.Type.Identifier;
                else if (it.Type && typeof it.Type.Identifier !== "undefined") typeId = it.Type.Identifier;
                // Check by Code as well
                else if (ou.Type && ou.Type.Code === 'Course Offering') typeId = OU_TYPE_COURSE_OFFERING;
                else if (it.Type && it.Type.Code === 'Course Offering') typeId = OU_TYPE_COURSE_OFFERING;

                if (String(typeId) === String(OU_TYPE_COURSE_OFFERING) || 
                    (ou.Type && ou.Type.Code === 'Course Offering') ||
                    (it.Type && it.Type.Code === 'Course Offering')) {
                    courses.push({ id: String(ouId), name: ouName, typeId: typeId });
                }
            }

            return { ok: true, status: 200, courses: courses };
        } catch (error) {
            console.error('Error fetching courses:', error);
            return { ok: false, status: error.status || 500, courses: [], error: error.message };
        }
    }

    // -----------------------------------------
    // 3) Create ZZDemoStudent per course (no enroll)
    // -----------------------------------------
    async function userExistsByUsername(username) {
        try {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.45/users/?userName=${encodeURIComponent(username)}`
            );

            // API might return an array or a single object
            let user = null;
            if (Array.isArray(response)) {
                user = response.length > 0 ? response[0] : null;
            } else if (response && response.UserId) {
                user = response;
            }

            if (user && user.UserId) {
                return { exists: true, userId: user.UserId };
            }
            return { exists: false, userId: null };
        } catch (error) {
            // 404 means user doesn't exist, which is fine
            // Check if error message contains 404 or if it's a 404 status
            const is404 = error.message && (
                error.message.includes('404') || 
                error.message.includes('Not Found') ||
                error.status === 404
            );
            
            if (is404) {
                return { exists: false, userId: null };
            }
            
            // Other errors are problematic
            console.error('Error checking user existence:', error);
            return { exists: false, userId: null, error: true, status: 500 };
        }
    }

    async function createDemoUserForCourse(courseOrgUnitId) {
        const username = "ZZDemoStudent-" + courseOrgUnitId;
        const email = "zzdemostudent-" + courseOrgUnitId + "@example.edu";

        // Check if user exists
        const check = await userExistsByUsername(username);

        if (check.error) {
            return {
                courseOrgUnitId: courseOrgUnitId,
                username: username,
                email: email,
                action: "check_failed",
                status: check.status || 500,
                userId: "",
                message: "Failed to check user existence"
            };
        }

        if (check.exists) {
            return {
                courseOrgUnitId: courseOrgUnitId,
                username: username,
                email: email,
                action: "skipped_exists",
                status: 200,
                userId: check.userId,
                message: "User already exists"
            };
        }

        // Create user only
        const payload = {
            "OrgDefinedId": "",
            "FirstName": "ZZDemo",
            "MiddleName": "",
            "LastName": "ZZStudent",
            "ExternalEmail": email,
            "UserName": username,
            "RoleId": ROLE_ID_DEMO,
            "IsActive": true,
            "SendCreationEmail": false,
            "Pronouns": ""
        };

        try {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.45/users/`,
                {
                    method: 'POST',
                    body: JSON.stringify(payload)
                }
            );

            // Store response for debugging
            setDebug(response);

            if (response && response.UserId) {
                return {
                    courseOrgUnitId: courseOrgUnitId,
                    username: username,
                    email: email,
                    action: "created",
                    status: 200,
                    userId: response.UserId,
                    message: "Created"
                };
            }

            return {
                courseOrgUnitId: courseOrgUnitId,
                username: username,
                email: email,
                action: "create_failed",
                status: 500,
                userId: "",
                message: "Create failed - no UserId in response"
            };
        } catch (error) {
            // Store error for debugging
            setDebug(error);

            let msg = "Create failed";
            if (error.message) {
                msg = error.message;
            }

            // Try to extract error message from response if available
            try {
                if (error.response) {
                    const errorData = await error.response.json();
                    if (errorData.Errors && errorData.Errors.length && errorData.Errors[0].Message) {
                        msg = errorData.Errors[0].Message;
                    }
                }
            } catch (e) {
                // Ignore JSON parse errors
            }

            return {
                courseOrgUnitId: courseOrgUnitId,
                username: username,
                email: email,
                action: "create_failed",
                status: error.status || 500,
                userId: "",
                message: msg
            };
        }
    }

    // -----------------------------------------
    // CSV export
    // -----------------------------------------
    function toCsvValue(v) {
        const s = (v === null || v === undefined) ? "" : String(v);
        if (s.indexOf('"') !== -1 || s.indexOf(",") !== -1 || s.indexOf("\n") !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function buildReportCsv(rows) {
        const headers = [
            "SemesterOrgUnitId",
            "CourseOrgUnitId",
            "UserName",
            "ExternalEmail",
            "Action",
            "Status",
            "UserId",
            "Message"
        ];

        const out = [];
        out.push(headers.join(","));

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            out.push([
                toCsvValue(r.semesterOrgUnitId),
                toCsvValue(r.courseOrgUnitId),
                toCsvValue(r.username),
                toCsvValue(r.email),
                toCsvValue(r.action),
                toCsvValue(r.status),
                toCsvValue(r.userId || ""),
                toCsvValue(r.message || "")
            ].join(","));
        }

        return out.join("\n");
    }

    function downloadTextFile(filename, content) {
        const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // -----------------------------------------
    // Actions
    // -----------------------------------------
    async function previewCourses() {
        reportRows = [];
        lastReportCsv = "";
        downloadBtn.disabled = true;

        logEl.textContent = "";
        debugEl.textContent = "";

        const semesterId = semesterSelect.value;
        if (!semesterId) {
            alert("Select a semester first.");
            return;
        }

        setStatus("Loading courses for semester " + semesterId + "...");
        logLine("Fetching children for semester " + semesterId + "...");

        const c = await getCoursesForSemester(semesterId);

        if (!c.ok) {
            setStatus("Failed to load courses. Status: " + c.status);
            logLine("ERROR loading courses: " + c.status + (c.error ? " - " + c.error : ""));
            return;
        }

        setStatus("<b>Preview:</b> Found " + c.courses.length + " course offerings (OU Type 3).");
        logLine("Preview complete. Course offerings found: " + c.courses.length);

        // show a sample in log
        for (let i = 0; i < Math.min(10, c.courses.length); i++) {
            logLine(" - " + c.courses[i].id + " " + (c.courses[i].name || ""));
        }
        if (c.courses.length > 10) logLine(" - ...");
    }

    async function runProvision() {
        reportRows = [];
        lastReportCsv = "";
        downloadBtn.disabled = true;

        logEl.textContent = "";
        debugEl.textContent = "";

        const semesterId = semesterSelect.value;
        if (!semesterId) {
            alert("Select a semester first.");
            return;
        }

        setStatus("Loading courses for semester " + semesterId + "...");
        logLine("Fetching course offerings for semester " + semesterId + "...");

        const c = await getCoursesForSemester(semesterId);

        if (!c.ok) {
            setStatus("Failed to load courses. Status: " + c.status);
            logLine("ERROR loading courses: " + c.status + (c.error ? " - " + c.error : ""));
            return;
        }

        if (!c.courses.length) {
            setStatus("No course offerings found (OU Type 3). Nothing to do.");
            logLine("No courses found.");
            return;
        }

        setStatus("Running... (" + c.courses.length + " courses)");
        logLine("Starting provisioning for " + c.courses.length + " courses...");

        let createdCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        // Disable buttons during processing
        previewBtn.disabled = true;
        runBtn.disabled = true;

        try {
            for (let i = 0; i < c.courses.length; i++) {
                const courseId = c.courses[i].id;

                logLine("[" + (i + 1) + "/" + c.courses.length + "] " + courseId + " → checking/creating user...");

                const result = await createDemoUserForCourse(courseId);
                result.semesterOrgUnitId = String(semesterId);

                reportRows.push(result);

                if (result.action === "created") createdCount++;
                else if (result.action === "skipped_exists") skippedCount++;
                else failedCount++;

                logLine("   Result: " + result.action + " (status " + result.status + ") " + 
                    (result.userId ? ("UserId " + result.userId + " ") : "") + 
                    (result.message ? ("- " + result.message) : ""));

                // Throttle API calls
                await sleep(200);
            }

            lastReportCsv = buildReportCsv(reportRows);
            downloadBtn.disabled = false;

            setStatus(
                "<b>Done.</b> Created: " + createdCount +
                " | Skipped (exists): " + skippedCount +
                " | Failed: " + failedCount
            );

            logLine("Finished. Created=" + createdCount + ", Skipped=" + skippedCount + ", Failed=" + failedCount);
        } finally {
            // Re-enable buttons
            previewBtn.disabled = false;
            runBtn.disabled = false;
        }
    }

    // -----------------------------------------
    // Delete functionality
    // -----------------------------------------
    async function deleteUser(userId) {
        try {
            const response = await fetch(`/d2l/api/lp/1.31/users/${userId}`, {
                method: 'DELETE',
                headers: D2LApi._getAuthHeaders(),
                credentials: 'include'
            });

            // Check for new XSRF token
            const newToken = response.headers.get('x-csrf-token');
            if (newToken) {
                localStorage.setItem('XSRF.Token', newToken);
            }

            // DELETE requests typically return 204 No Content (success) or 200 OK
            if (response.status === 204 || response.status === 200) {
                return { ok: true, status: response.status };
            }

            // Handle error responses
            if (!response.ok) {
                let errorText = '';
                try {
                    errorText = await response.text();
                } catch (e) {
                    errorText = response.statusText;
                }
                throw new Error(`Delete failed: ${response.status} ${response.statusText}${errorText ? ' - ' + errorText : ''}`);
            }

            return { ok: true, status: response.status };
        } catch (error) {
            console.error('Error deleting user:', error);
            return { ok: false, status: error.status || 500, error: error.message };
        }
    }

    async function runDelete() {
        const semesterId = semesterSelect.value;
        if (!semesterId) {
            alert("Select a semester first.");
            return;
        }

        // Confirmation dialog
        const confirmMessage = `⚠️ WARNING: This will DELETE all ZZDemoStudent accounts for courses in this semester.\n\n` +
            `This action cannot be undone!\n\n` +
            `Are you absolutely sure you want to proceed?`;
        
        if (!confirm(confirmMessage)) {
            return;
        }

        // Double confirmation
        if (!confirm("Final confirmation: Delete all ZZDemoStudent accounts for this semester?")) {
            return;
        }

        reportRows = [];
        lastReportCsv = "";
        downloadBtn.disabled = true;

        logEl.textContent = "";
        debugEl.textContent = "";

        setStatus("Loading courses for semester " + semesterId + "...");
        logLine("Fetching course offerings for semester " + semesterId + "...");

        const c = await getCoursesForSemester(semesterId);

        if (!c.ok) {
            setStatus("Failed to load courses. Status: " + c.status);
            logLine("ERROR loading courses: " + c.status + (c.error ? " - " + c.error : ""));
            return;
        }

        if (!c.courses.length) {
            setStatus("No course offerings found (OU Type 3). Nothing to do.");
            logLine("No courses found.");
            return;
        }

        setStatus("Deleting... (" + c.courses.length + " courses)");
        logLine("Starting deletion for " + c.courses.length + " courses...");

        let deletedCount = 0;
        let notFoundCount = 0;
        let failedCount = 0;

        // Disable buttons during processing
        previewBtn.disabled = true;
        runBtn.disabled = true;
        deleteBtn.disabled = true;

        try {
            for (let i = 0; i < c.courses.length; i++) {
                const courseId = c.courses[i].id;
                const username = "ZZDemoStudent-" + courseId;

                logLine("[" + (i + 1) + "/" + c.courses.length + "] " + courseId + " → checking/deleting user...");

                // Check if user exists
                const check = await userExistsByUsername(username);

                if (check.error) {
                    const result = {
                        courseOrgUnitId: courseId,
                        username: username,
                        email: "zzdemostudent-" + courseId + "@example.edu",
                        action: "check_failed",
                        status: check.status || 500,
                        userId: "",
                        message: "Failed to check user existence",
                        semesterOrgUnitId: String(semesterId)
                    };
                    reportRows.push(result);
                    failedCount++;
                    logLine("   Result: check_failed (status " + result.status + ") - " + result.message);
                    continue;
                }

                if (!check.exists) {
                    const result = {
                        courseOrgUnitId: courseId,
                        username: username,
                        email: "zzdemostudent-" + courseId + "@example.edu",
                        action: "not_found",
                        status: 200,
                        userId: "",
                        message: "User does not exist",
                        semesterOrgUnitId: String(semesterId)
                    };
                    reportRows.push(result);
                    notFoundCount++;
                    logLine("   Result: not_found - User does not exist");
                    continue;
                }

                // Delete the user
                const deleteResult = await deleteUser(check.userId);
                setDebug(deleteResult);

                if (deleteResult.ok) {
                    const result = {
                        courseOrgUnitId: courseId,
                        username: username,
                        email: "zzdemostudent-" + courseId + "@example.edu",
                        action: "deleted",
                        status: deleteResult.status,
                        userId: check.userId,
                        message: "Deleted successfully",
                        semesterOrgUnitId: String(semesterId)
                    };
                    reportRows.push(result);
                    deletedCount++;
                    logLine("   Result: deleted (status " + result.status + ") UserId " + result.userId);
                } else {
                    const result = {
                        courseOrgUnitId: courseId,
                        username: username,
                        email: "zzdemostudent-" + courseId + "@example.edu",
                        action: "delete_failed",
                        status: deleteResult.status,
                        userId: check.userId,
                        message: deleteResult.error || "Delete failed",
                        semesterOrgUnitId: String(semesterId)
                    };
                    reportRows.push(result);
                    failedCount++;
                    logLine("   Result: delete_failed (status " + result.status + ") - " + result.message);
                }

                // Throttle API calls
                await sleep(200);
            }

            lastReportCsv = buildReportCsv(reportRows);
            downloadBtn.disabled = false;

            setStatus(
                "<b>Done.</b> Deleted: " + deletedCount +
                " | Not Found: " + notFoundCount +
                " | Failed: " + failedCount
            );

            logLine("Finished. Deleted=" + deletedCount + ", Not Found=" + notFoundCount + ", Failed=" + failedCount);
        } finally {
            // Re-enable buttons
            previewBtn.disabled = false;
            runBtn.disabled = false;
            deleteBtn.disabled = false;
        }
    }

    function downloadReport() {
        if (!lastReportCsv) return;
        const semesterId = semesterSelect.value || "unknown";
        const actionType = reportRows.length > 0 && reportRows[0].action === "deleted" ? "delete" : "provision";
        const filename = "zzstudent-" + actionType + "-" + semesterId + "-" + new Date().toISOString().slice(0, 10) + ".csv";
        downloadTextFile(filename, lastReportCsv);
    }
})();
