/**
 * New Student Audit
 * Upload a new-students CSV, check each id against D2L OrgDefinedId, then create missing accounts.
 */

(function () {
    "use strict";

    const CHECK_ENDPOINT = "/d2l/api/lp/1.46/users/?orgDefinedId=";
    const CREATE_ENDPOINT = "/d2l/api/lp/1.45/users/";
    const STUDENT_ROLE_ID = 101;
    const LOADING_BAR_ID = "newStudentAuditLoadingBar";

    const csvFileInput = document.getElementById("csvFile");
    const sendCreationEmailCheckbox = document.getElementById("sendCreationEmail");
    const runAuditBtn = document.getElementById("runAuditBtn");
    const createMissingBtn = document.getElementById("createMissingBtn");
    const downloadResultsBtn = document.getElementById("downloadResultsBtn");
    const clearBtn = document.getElementById("clearBtn");
    const summaryEl = document.getElementById("summary");
    const resultsCard = document.getElementById("resultsCard");
    const resultsBody = document.getElementById("resultsBody");

    let parsedStudents = [];
    let auditResults = [];

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function escapeHtml(value) {
        if (value == null) return "";
        const div = document.createElement("div");
        div.textContent = String(value);
        return div.innerHTML;
    }

    function toCsvValue(value) {
        const s = value == null ? "" : String(value);
        if (s.includes('"') || s.includes(",") || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
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

    function getColumn(row, allowedNames) {
        const keys = Object.keys(row || {});
        const lowerAllowed = allowedNames.map((n) => n.toLowerCase());
        for (const key of keys) {
            if (lowerAllowed.includes(String(key || "").toLowerCase())) {
                return key;
            }
        }
        return null;
    }

    function getField(row, allowedNames) {
        const key = getColumn(row, allowedNames);
        if (!key) return "";
        const value = row[key];
        return value == null ? "" : String(value).trim();
    }

    function deriveUserName(email) {
        const trimmed = String(email || "").trim().toLowerCase();
        if (!trimmed) return "";
        const at = trimmed.indexOf("@");
        return at > 0 ? trimmed.slice(0, at) : trimmed;
    }

    function normalizeStudentRow(row) {
        const id = getField(row, ["id", "person_id", "orgdefinedid", "student_id"]);
        const preferredEmail = getField(row, [
            "preferred_email_address",
            "email_address",
            "email",
            "external_email"
        ]);
        const firstName = getField(row, ["first_name", "firstname"]);
        const lastName = getField(row, ["last_name", "lastname"]);
        const middleName = getField(row, ["middle_name", "middlename"]);
        const personOriginDate = getField(row, ["person_origin_date", "origin_date"]);

        return {
            orgDefinedId: id,
            preferredEmail,
            firstName,
            lastName,
            middleName,
            personOriginDate,
            userName: deriveUserName(preferredEmail)
        };
    }

    function parseStudentsCsv(text) {
        const parsed = Papa.parse(String(text || ""), {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => String(header || "").trim()
        });

        if (parsed.errors && parsed.errors.length) {
            console.warn("CSV parse warnings:", parsed.errors);
        }

        const rows = (parsed.data || [])
            .map(normalizeStudentRow)
            .filter((row) => row.orgDefinedId);

        return rows;
    }

    function setSummary(html) {
        summaryEl.innerHTML = html;
    }

    function getMissingResults() {
        return auditResults.filter((row) => row.status !== "Found" && row.status !== "Created");
    }

    function setButtonsDisabled(disabled) {
        runAuditBtn.disabled = disabled || !parsedStudents.length;
        createMissingBtn.disabled = disabled || !auditResults.some((row) => row.status === "Not Found");
        downloadResultsBtn.disabled = disabled || !getMissingResults().length;
    }

    function updateProgress(current, total, message) {
        const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
        LoadingUtils.updateLoadingBar(percent, message, LOADING_BAR_ID);
    }

    function renderResults() {
        resultsBody.innerHTML = "";
        const missingResults = getMissingResults();

        missingResults.forEach((result) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="mono">${escapeHtml(result.orgDefinedId)}</td>
                <td>${escapeHtml(result.firstName)} ${escapeHtml(result.lastName)}</td>
                <td class="mono">${escapeHtml(result.userName)}</td>
                <td>${escapeHtml(result.preferredEmail)}</td>
                <td>${escapeHtml(result.status)}</td>
                <td>${escapeHtml(result.message || "")}</td>
            `;
            resultsBody.appendChild(tr);
        });

        resultsCard.style.display = missingResults.length ? "block" : "none";
    }

    async function fetchUserByOrgDefinedId(orgDefinedId) {
        try {
            const response = await D2LApi._fetch(CHECK_ENDPOINT + encodeURIComponent(orgDefinedId));
            let user = null;

            if (Array.isArray(response)) {
                user = response[0] || null;
            } else if (response && response.UserId) {
                user = response;
            }

            if (!user || !user.UserId) {
                return { found: false, orgDefinedId };
            }

            return {
                found: true,
                orgDefinedId,
                userId: user.UserId,
                d2lUserName: user.UserName || "",
                fullName: `${user.FirstName || ""} ${user.LastName || ""}`.trim()
            };
        } catch (error) {
            const message = error && error.message ? error.message : "";
            if (message.includes("404")) {
                return { found: false, orgDefinedId };
            }

            return {
                found: false,
                orgDefinedId,
                error: message || "Lookup failed"
            };
        }
    }

    async function createStudent(student) {
        const payload = {
            OrgDefinedId: student.orgDefinedId,
            FirstName: student.firstName,
            MiddleName: student.middleName || "",
            LastName: student.lastName,
            ExternalEmail: student.preferredEmail || null,
            UserName: student.userName,
            RoleId: STUDENT_ROLE_ID,
            IsActive: true,
            SendCreationEmail: !!sendCreationEmailCheckbox.checked,
            Pronouns: ""
        };

        try {
            const response = await D2LApi._fetch(CREATE_ENDPOINT, {
                method: "POST",
                body: JSON.stringify(payload)
            });

            return {
                status: "Created",
                userId: response && response.UserId ? response.UserId : "",
                message: "User created successfully"
            };
        } catch (error) {
            return {
                status: "Create Failed",
                userId: "",
                message: error && error.message ? error.message : "Create failed"
            };
        }
    }

    function buildResultsCsv(rows) {
        const headers = [
            "OrgDefinedId",
            "FirstName",
            "LastName",
            "UserName",
            "PreferredEmail",
            "Status",
            "UserId",
            "D2LUserName",
            "Message"
        ];

        const lines = [headers.join(",")];
        rows.forEach((row) => {
            lines.push([
                toCsvValue(row.orgDefinedId),
                toCsvValue(row.firstName),
                toCsvValue(row.lastName),
                toCsvValue(row.userName),
                toCsvValue(row.preferredEmail),
                toCsvValue(row.status),
                toCsvValue(row.userId),
                toCsvValue(row.d2lUserName),
                toCsvValue(row.message)
            ].join(","));
        });

        return lines.join("\n");
    }

    async function handleFileChange() {
        auditResults = [];
        parsedStudents = [];
        resultsCard.style.display = "none";
        createMissingBtn.disabled = true;
        downloadResultsBtn.disabled = true;

        const file = csvFileInput.files && csvFileInput.files[0];
        if (!file) {
            runAuditBtn.disabled = true;
            setSummary("Upload a new-students CSV to begin.");
            return;
        }

        try {
            const text = await file.text();
            parsedStudents = parseStudentsCsv(text);

            if (!parsedStudents.length) {
                runAuditBtn.disabled = true;
                setSummary("<strong>No valid rows found.</strong> Expected columns include <code>id</code>, <code>preferred_email_address</code>, <code>first_name</code>, and <code>last_name</code>.");
                return;
            }

            runAuditBtn.disabled = false;
            setSummary(`Loaded <strong>${parsedStudents.length}</strong> student row(s) from <strong>${escapeHtml(file.name)}</strong>. Click <strong>Run Audit</strong> to check D2L.`);
        } catch (error) {
            runAuditBtn.disabled = true;
            setSummary(`<strong>Failed to read CSV:</strong> ${escapeHtml(error.message || error)}`);
        }
    }

    async function runAudit() {
        if (!parsedStudents.length) {
            alert("Upload a CSV with at least one student first.");
            return;
        }

        auditResults = [];
        setButtonsDisabled(true);
        LoadingUtils.showLoadingBar(LOADING_BAR_ID);
        LoadingUtils.updateLoadingBar(0, "Starting audit...", LOADING_BAR_ID);

        let foundCount = 0;
        let missingCount = 0;
        let errorCount = 0;

        try {
            for (let i = 0; i < parsedStudents.length; i++) {
                const student = parsedStudents[i];
                updateProgress(
                    i + 1,
                    parsedStudents.length,
                    `Checking ${i + 1} / ${parsedStudents.length}: ${student.orgDefinedId}`
                );

                const lookup = await fetchUserByOrgDefinedId(student.orgDefinedId);

                let status;
                let message = "";
                let userId = "";
                let d2lUserName = "";

                if (lookup.found) {
                    foundCount++;
                    status = "Found";
                    userId = lookup.userId;
                    d2lUserName = lookup.d2lUserName;
                    message = lookup.fullName || "Already exists in D2L";
                } else if (lookup.error) {
                    errorCount++;
                    status = "Lookup Error";
                    message = lookup.error;
                } else {
                    missingCount++;
                    status = "Not Found";
                    message = "No D2L account for this OrgDefinedId";
                }

                auditResults.push({
                    ...student,
                    status,
                    userId,
                    d2lUserName,
                    message
                });

                renderResults();
                await sleep(120);
            }

            createMissingBtn.disabled = missingCount === 0;
            downloadResultsBtn.disabled = getMissingResults().length === 0;

            LoadingUtils.updateLoadingBar(100, "Audit complete!", LOADING_BAR_ID);

            const allFoundMessage = missingCount === 0 && errorCount === 0
                ? " All students already exist in D2L."
                : "";

            setSummary(
                `<strong>Audit complete.</strong> Found: ${foundCount} | Missing: ${missingCount} | Lookup errors: ${errorCount}${allFoundMessage}`
            );
        } finally {
            setButtonsDisabled(false);
            createMissingBtn.disabled = !auditResults.some((row) => row.status === "Not Found");
        }
    }

    async function createMissingStudents() {
        const missingRows = auditResults.filter((row) => row.status === "Not Found");
        if (!missingRows.length) {
            alert("No missing students to create. Run the audit first.");
            return;
        }

        const invalidRows = missingRows.filter((row) =>
            !row.orgDefinedId || !row.firstName || !row.lastName || !row.userName
        );

        if (invalidRows.length) {
            alert(
                `${invalidRows.length} missing row(s) are missing required fields (id, first_name, last_name, or preferred_email_address for username). Fix the CSV and re-run the audit.`
            );
            return;
        }

        const confirmMessage =
            `Create ${missingRows.length} missing student account(s) in D2L?\n\n` +
            "This uses RoleId 101 (Student) and derives the username from the email address.";
        if (!confirm(confirmMessage)) {
            return;
        }

        setButtonsDisabled(true);
        LoadingUtils.showLoadingBar(LOADING_BAR_ID);
        LoadingUtils.updateLoadingBar(0, "Starting user creation...", LOADING_BAR_ID);

        let createdCount = 0;
        let failedCount = 0;
        let processedCount = 0;

        try {
            for (let i = 0; i < auditResults.length; i++) {
                const row = auditResults[i];
                if (row.status !== "Not Found") {
                    continue;
                }

                processedCount++;
                updateProgress(
                    processedCount,
                    missingRows.length,
                    `Creating ${processedCount} / ${missingRows.length}: ${row.orgDefinedId}`
                );

                const createResult = await createStudent(row);
                row.status = createResult.status;
                row.userId = createResult.userId;
                row.message = createResult.message;

                if (createResult.status === "Created") {
                    createdCount++;
                } else {
                    failedCount++;
                }

                renderResults();
                await sleep(140);
            }

            createMissingBtn.disabled = true;
            downloadResultsBtn.disabled = getMissingResults().length === 0;
            LoadingUtils.updateLoadingBar(100, "Create complete!", LOADING_BAR_ID);

            setSummary(
                `<strong>Create complete.</strong> Created: ${createdCount} | Failed: ${failedCount}` +
                (failedCount === 0 ? " All missing students are now in D2L." : "")
            );
        } finally {
            setButtonsDisabled(false);
            createMissingBtn.disabled = !auditResults.some((row) => row.status === "Not Found");
        }
    }

    function downloadResults() {
        const missingResults = getMissingResults();
        if (!missingResults.length) return;
        const csv = buildResultsCsv(missingResults);
        const filename = `new-student-audit-missing-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadTextFile(filename, csv);
    }

    function clearAll() {
        csvFileInput.value = "";
        parsedStudents = [];
        auditResults = [];
        resultsBody.innerHTML = "";
        resultsCard.style.display = "none";
        runAuditBtn.disabled = true;
        createMissingBtn.disabled = true;
        downloadResultsBtn.disabled = true;
        LoadingUtils.hideLoadingBar(LOADING_BAR_ID);
        setSummary("Upload a new-students CSV to begin.");
    }

    function initLoadingBar() {
        if (document.getElementById(LOADING_BAR_ID)) {
            return;
        }

        const loadingBar = LoadingUtils.createLoadingBar(LOADING_BAR_ID);
        summaryEl.parentNode.insertBefore(loadingBar, summaryEl);
    }

    function attachEvents() {
        csvFileInput.addEventListener("change", handleFileChange);
        runAuditBtn.addEventListener("click", runAudit);
        createMissingBtn.addEventListener("click", createMissingStudents);
        downloadResultsBtn.addEventListener("click", downloadResults);
        clearBtn.addEventListener("click", clearAll);
    }

    document.addEventListener("DOMContentLoaded", () => {
        initLoadingBar();
        attachEvents();
    });
})();
