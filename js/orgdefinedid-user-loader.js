(function () {
    "use strict";

    const CHECK_ENDPOINT = "/d2l/api/lp/1.46/users/?orgDefinedId=";
    const CREATE_ENDPOINT = "/d2l/api/lp/1.45/users/";

    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    const orgDefinedIdsInput = document.getElementById("orgDefinedIdsInput");
    const orgDefinedIdFile = document.getElementById("orgDefinedIdFile");
    const runCheckBtn = document.getElementById("runCheckBtn");
    const downloadMissingBtn = document.getElementById("downloadMissingBtn");
    const checkStatus = document.getElementById("checkStatus");
    const checkResultsWrap = document.getElementById("checkResultsWrap");
    const checkResultsBody = document.getElementById("checkResultsBody");

    const bulkCreateFile = document.getElementById("bulkCreateFile");
    const runCreateBtn = document.getElementById("runCreateBtn");
    const downloadCreateResultsBtn = document.getElementById("downloadCreateResultsBtn");
    const createStatus = document.getElementById("createStatus");
    const createResultsWrap = document.getElementById("createResultsWrap");
    const createResultsBody = document.getElementById("createResultsBody");

    let missingRows = [];
    let createResultRows = [];

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function toCsvValue(value) {
        const s = value === null || value === undefined ? "" : String(value);
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

    function parseSimpleCsv(text) {
        const lines = String(text || "").replace(/\r/g, "").split("\n");
        if (!lines.length) return [];

        const rows = [];
        const headers = lines[0].split(",").map((h) => h.trim());

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;

            const parts = line.split(",").map((p) => p.trim());
            const row = {};

            for (let j = 0; j < headers.length; j++) {
                row[headers[j]] = parts[j] || "";
            }

            rows.push(row);
        }

        return rows;
    }

    function parseIdsFromInput(text) {
        const tokens = String(text || "")
            .split(/[\n,;\t ]+/)
            .map((token) => token.trim())
            .filter(Boolean);

        return [...new Set(tokens)];
    }

    function firstNonEmptyField(obj) {
        const values = Object.values(obj || {});
        for (let i = 0; i < values.length; i++) {
            const value = String(values[i] || "").trim();
            if (value) return value;
        }
        return "";
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

            if (!user) {
                return { found: false, orgDefinedId: orgDefinedId };
            }

            return {
                found: true,
                orgDefinedId: orgDefinedId,
                userId: user.UserId || "",
                userName: user.UserName || "",
                fullName: `${user.FirstName || ""} ${user.LastName || ""}`.trim()
            };
        } catch (error) {
            const message = error && error.message ? error.message : "";
            if (message.includes("404")) {
                return { found: false, orgDefinedId: orgDefinedId };
            }

            return {
                found: false,
                orgDefinedId: orgDefinedId,
                error: message || "Lookup failed"
            };
        }
    }

    function setStatus(target, html) {
        if (!html) {
            target.style.display = "none";
            return;
        }
        target.innerHTML = html;
        target.style.display = "block";
    }

    function setButtonsDisabled(disabled) {
        runCheckBtn.disabled = disabled;
        runCreateBtn.disabled = disabled;
    }

    function buildMissingCsv(rows) {
        const lines = ["OrgDefinedId,Status"];
        rows.forEach((row) => {
            lines.push(`${toCsvValue(row.orgDefinedId)},${toCsvValue(row.status)}`);
        });
        return lines.join("\n");
    }

    function buildCreateResultsCsv(rows) {
        const lines = ["OrgDefinedId,UserName,Status,UserId,Message"];
        rows.forEach((row) => {
            lines.push([
                toCsvValue(row.orgDefinedId),
                toCsvValue(row.userName),
                toCsvValue(row.status),
                toCsvValue(row.userId),
                toCsvValue(row.message)
            ].join(","));
        });
        return lines.join("\n");
    }

    async function handleOrgDefinedIdFileUpload() {
        const file = orgDefinedIdFile.files && orgDefinedIdFile.files[0];
        if (!file) return;

        const text = await file.text();
        const rows = parseSimpleCsv(text);
        const ids = rows.map(firstNonEmptyField).filter(Boolean);

        orgDefinedIdsInput.value = ids.join("\n");
    }

    async function runCheck() {
        downloadMissingBtn.disabled = true;
        missingRows = [];
        checkResultsBody.innerHTML = "";
        checkResultsWrap.style.display = "none";

        const ids = parseIdsFromInput(orgDefinedIdsInput.value);
        if (!ids.length) {
            alert("Enter at least one OrgDefinedId.");
            return;
        }

        setButtonsDisabled(true);
        setStatus(checkStatus, `Checking <b>${ids.length}</b> OrgDefinedIds...`);

        let foundCount = 0;
        let missingCount = 0;
        let errorCount = 0;

        try {
            for (let i = 0; i < ids.length; i++) {
                const result = await fetchUserByOrgDefinedId(ids[i]);
                const tr = document.createElement("tr");

                if (result.found) {
                    foundCount++;
                    tr.innerHTML = `<td>${result.orgDefinedId}</td><td>Found</td><td>${result.userId}</td><td>${result.userName}</td><td>${result.fullName}</td>`;
                } else {
                    const status = result.error ? "Lookup Error" : "Not Found";
                    if (result.error) {
                        errorCount++;
                    } else {
                        missingCount++;
                        missingRows.push({ orgDefinedId: result.orgDefinedId, status: "Not Found" });
                    }

                    tr.innerHTML = `<td>${result.orgDefinedId}</td><td>${status}</td><td></td><td></td><td>${result.error || ""}</td>`;
                }

                checkResultsBody.appendChild(tr);
                await sleep(120);
            }

            checkResultsWrap.style.display = "block";
            if (missingRows.length) {
                downloadMissingBtn.disabled = false;
            }

            setStatus(
                checkStatus,
                `<b>Check complete.</b> Found: ${foundCount} | Missing: ${missingCount} | Errors: ${errorCount}`
            );
        } finally {
            setButtonsDisabled(false);
        }
    }

    function parseBool(value, fallbackValue) {
        const normalized = String(value || "").trim().toLowerCase();
        if (!normalized) return fallbackValue;
        if (["true", "1", "yes", "y"].includes(normalized)) return true;
        if (["false", "0", "no", "n"].includes(normalized)) return false;
        return fallbackValue;
    }

    function normalizeCreateRow(row) {
        return {
            orgDefinedId: String(row.OrgDefinedId || row.orgdefinedid || "").trim(),
            firstName: String(row.FirstName || row.firstname || "").trim(),
            lastName: String(row.LastName || row.lastname || "").trim(),
            userName: String(row.UserName || row.username || "").trim(),
            externalEmail: String(row.ExternalEmail || row.externalemail || "").trim(),
            roleId: Number(String(row.RoleId || row.roleid || "101").trim() || 101),
            isActive: parseBool(row.IsActive || row.isactive, true),
            sendCreationEmail: parseBool(row.SendCreationEmail || row.sendcreationemail, false)
        };
    }

    async function createUser(user) {
        const payload = {
            OrgDefinedId: user.orgDefinedId,
            FirstName: user.firstName,
            MiddleName: "",
            LastName: user.lastName,
            ExternalEmail: user.externalEmail || null,
            UserName: user.userName,
            RoleId: Number.isNaN(user.roleId) ? 101 : user.roleId,
            IsActive: user.isActive,
            SendCreationEmail: user.sendCreationEmail,
            Pronouns: ""
        };

        try {
            const response = await D2LApi._fetch(CREATE_ENDPOINT, {
                method: "POST",
                body: JSON.stringify(payload)
            });

            return {
                orgDefinedId: user.orgDefinedId,
                userName: user.userName,
                status: "Created",
                userId: response && response.UserId ? response.UserId : "",
                message: "Success"
            };
        } catch (error) {
            return {
                orgDefinedId: user.orgDefinedId,
                userName: user.userName,
                status: "Failed",
                userId: "",
                message: error && error.message ? error.message : "Create failed"
            };
        }
    }

    async function runBulkCreate() {
        downloadCreateResultsBtn.disabled = true;
        createResultRows = [];
        createResultsBody.innerHTML = "";
        createResultsWrap.style.display = "none";

        const file = bulkCreateFile.files && bulkCreateFile.files[0];
        if (!file) {
            alert("Upload a CSV file first.");
            return;
        }

        const text = await file.text();
        const rawRows = parseSimpleCsv(text);
        const users = rawRows.map(normalizeCreateRow);

        if (!users.length) {
            alert("CSV has no data rows.");
            return;
        }

        setButtonsDisabled(true);
        setStatus(createStatus, `Processing <b>${users.length}</b> rows...`);

        let createdCount = 0;
        let failedCount = 0;
        let skippedCount = 0;

        try {
            for (let i = 0; i < users.length; i++) {
                const user = users[i];
                const missingRequired =
                    !user.orgDefinedId || !user.firstName || !user.lastName || !user.userName;

                let result;
                if (missingRequired) {
                    skippedCount++;
                    result = {
                        orgDefinedId: user.orgDefinedId,
                        userName: user.userName,
                        status: "Skipped",
                        userId: "",
                        message: "Missing required fields"
                    };
                } else {
                    result = await createUser(user);
                    if (result.status === "Created") createdCount++;
                    else failedCount++;
                }

                createResultRows.push(result);
                const tr = document.createElement("tr");
                tr.innerHTML = `<td>${result.orgDefinedId}</td><td>${result.userName}</td><td>${result.status}</td><td>${result.userId}</td><td>${result.message}</td>`;
                createResultsBody.appendChild(tr);
                await sleep(140);
            }

            createResultsWrap.style.display = "block";
            if (createResultRows.length) {
                downloadCreateResultsBtn.disabled = false;
            }

            setStatus(
                createStatus,
                `<b>Bulk create complete.</b> Created: ${createdCount} | Failed: ${failedCount} | Skipped: ${skippedCount}`
            );
        } finally {
            setButtonsDisabled(false);
        }
    }

    function handleDownloadMissing() {
        if (!missingRows.length) return;
        const csv = buildMissingCsv(missingRows);
        const filename = `missing-orgdefinedids-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadTextFile(filename, csv);
    }

    function handleDownloadCreateResults() {
        if (!createResultRows.length) return;
        const csv = buildCreateResultsCsv(createResultRows);
        const filename = `bulk-create-results-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadTextFile(filename, csv);
    }

    function switchTab(tabName) {
        tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
        tabContents.forEach((tab) => tab.classList.toggle("active", tab.id === `tab-${tabName}`));
    }

    function attachEvents() {
        tabButtons.forEach((btn) => {
            btn.addEventListener("click", () => switchTab(btn.dataset.tab));
        });

        orgDefinedIdFile.addEventListener("change", handleOrgDefinedIdFileUpload);
        runCheckBtn.addEventListener("click", runCheck);
        downloadMissingBtn.addEventListener("click", handleDownloadMissing);
        runCreateBtn.addEventListener("click", runBulkCreate);
        downloadCreateResultsBtn.addEventListener("click", handleDownloadCreateResults);
    }

    document.addEventListener("DOMContentLoaded", attachEvents);
})();
