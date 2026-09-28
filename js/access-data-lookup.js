(function () {
    "use strict";

    const DETROIT_TZ = "America/Detroit";
    const USER_TRACKING_API_VERSION = "1.61";
    const MAX_API_RANGE_DAYS = 31;
    const SYSTEM_LOGIN_DISPLAY_HEADERS = [
        "Student ID",
        "Username",
        "IP",
        "Attempt Date (Detroit)"
    ];
    const COURSE_ACCESS_DISPLAY_HEADERS = [
        "OrgUnitId",
        "OrgDefinedId",
        "Username",
        "DayAccessed (Detroit)"
    ];

    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    const STREAM_YIELD_EVERY = 10000;

    const state = {
        systemLogin: {
            sourceMode: "api",
            csvFile: null,
            filteredRows: [],
            displayRows: [],
            headers: SYSTEM_LOGIN_DISPLAY_HEADERS.slice(),
            totalScanned: 0,
            dataTable: null,
            resolvedUser: null,
            searching: false,
            searchId: 0,
            fileName: ""
        },
        courseAccess: {
            sourceMode: "csv",
            csvFile: null,
            filteredRows: [],
            displayRows: [],
            headers: COURSE_ACCESS_DISPLAY_HEADERS.slice(),
            totalScanned: 0,
            dataTable: null,
            resolvedUser: null,
            searching: false,
            searchId: 0,
            fileName: ""
        }
    };

    function setStatus(element, message, type) {
        if (!element) return;
        if (!message) {
            element.style.display = "none";
            element.textContent = "";
            element.className = "status-box";
            return;
        }
        element.textContent = message;
        element.className = `status-box status-${type || "info"}`;
        element.style.display = "block";
    }

    function setResolvedUser(element, user) {
        if (!element) return;
        if (!user) {
            element.innerHTML = "";
            return;
        }
        const parts = [
            `<strong>UserId:</strong> ${user.userId}`,
            user.userName ? `<strong>Username:</strong> ${user.userName}` : "",
            user.fullName ? `<strong>Name:</strong> ${user.fullName}` : "",
            user.orgDefinedId ? `<strong>OrgDefinedId:</strong> ${user.orgDefinedId}` : ""
        ].filter(Boolean);
        element.innerHTML = parts.join(" &nbsp;|&nbsp; ");
    }

    function normalizeKey(key) {
        return String(key || "").trim().toLowerCase();
    }

    function getFieldValue(row, ...fieldNames) {
        const keys = Object.keys(row || {});
        for (const name of fieldNames) {
            const target = normalizeKey(name);
            const match = keys.find((key) => normalizeKey(key) === target);
            if (match !== undefined) {
                return String(row[match] ?? "").trim();
            }
        }
        return "";
    }

    function toCsvValue(value) {
        const text = value === null || value === undefined ? "" : String(value);
        if (text.includes('"') || text.includes(",") || text.includes("\n")) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }

    function downloadCsv(filename, headers, rows) {
        const lines = [headers.map(toCsvValue).join(",")];
        rows.forEach((row) => {
            lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
        });
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function cleanHeader(header) {
        return String(header || "").replace(/^\uFEFF/, "").trim();
    }

    function rowHasData(row) {
        if (!row || typeof row !== "object") {
            return false;
        }

        return Object.entries(row).some(([key, value]) => {
            if (key === "__parsed_extra") {
                return false;
            }
            return String(value ?? "").trim() !== "";
        });
    }

    function normalizeParsedRow(row) {
        const normalized = {};
        Object.entries(row || {}).forEach(([key, value]) => {
            if (key === "__parsed_extra") {
                return;
            }
            normalized[cleanHeader(key)] = value;
        });
        return normalized;
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes < 1024) {
            return `${bytes || 0} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        if (bytes < 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function formatDateInputValue(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function parseDateInputValue(value) {
        const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            return null;
        }
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== day
        ) {
            return null;
        }
        return date;
    }

    function inclusiveDaySpan(startDate, endDate) {
        const msPerDay = 24 * 60 * 60 * 1000;
        return Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay) + 1;
    }

    function buildUtcDayWindow(startValue, endValue) {
        const startDate = parseDateInputValue(startValue);
        const endDate = parseDateInputValue(endValue);

        if (!startDate || !endDate) {
            throw new Error("Select both a start date and an end date.");
        }

        if (endDate.getTime() < startDate.getTime()) {
            throw new Error("End date must be on or after the start date.");
        }

        const daySpan = inclusiveDaySpan(startDate, endDate);
        if (daySpan > MAX_API_RANGE_DAYS) {
            throw new Error(
                `The live API allows a maximum of ${MAX_API_RANGE_DAYS} days. ` +
                    `Your range is ${daySpan} days.`
            );
        }

        return {
            startDateTime: `${startValue}T00:00:00.000Z`,
            endDateTime: `${endValue}T23:59:59.999Z`,
            daySpan
        };
    }

    function setDefaultSystemLoginDates() {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 6);
        systemLoginStartDate.value = formatDateInputValue(start);
        systemLoginEndDate.value = formatDateInputValue(end);
    }

    function streamFilterCsvFile(file, shouldKeepRow, onProgress) {
        return new Promise((resolve, reject) => {
            const matchedRows = [];
            const errors = [];
            let headers = [];
            let totalScanned = 0;
            let sawUserIdColumn = false;

            Papa.parse(file, {
                header: true,
                skipEmptyLines: "greedy",
                transformHeader: cleanHeader,
                delimitersToGuess: [",", "\t", "|", ";"],
                step: (results, parser) => {
                    if (results.errors?.length) {
                        errors.push(...results.errors);
                    }

                    const row = normalizeParsedRow(results.data);
                    if (!rowHasData(row)) {
                        return;
                    }

                    totalScanned += 1;

                    if (!headers.length) {
                        headers = Object.keys(row);
                        sawUserIdColumn = headers.some((header) => normalizeKey(header) === "userid");
                    }

                    if (shouldKeepRow(row)) {
                        matchedRows.push(row);
                    }

                    if (onProgress && (totalScanned % STREAM_YIELD_EVERY === 0 || totalScanned === 1)) {
                        const percent = file.size && results.meta?.cursor
                            ? Math.min(99, Math.round((results.meta.cursor / file.size) * 100))
                            : null;

                        onProgress({
                            percent,
                            totalScanned,
                            matched: matchedRows.length
                        });

                        parser.pause();
                        setTimeout(() => parser.resume(), 0);
                    }
                },
                complete: () => {
                    resolve({
                        matchedRows,
                        headers,
                        totalScanned,
                        errors,
                        sawUserIdColumn
                    });
                },
                error: (error) => reject(error)
            });
        });
    }

    function setFileStatus(element, message, type) {
        if (!element) return;
        element.textContent = message;
        element.className = "form-hint";
        if (type === "ready") {
            element.classList.add("file-status-ready");
        } else if (type === "loading") {
            element.classList.add("file-status-loading");
        } else if (type === "error") {
            element.classList.add("file-status-error");
        }
    }

    function resetTabSearchState(tabState) {
        tabState.filteredRows = [];
        tabState.displayRows = [];
        tabState.headers = [];
        tabState.totalScanned = 0;
        tabState.searching = false;
    }

    function bindCsvUpload(tabKey, fileInput, fileStatusEl, updateButtonState, defaultMessage) {
        if (!fileInput) {
            return;
        }

        fileInput.addEventListener("change", () => {
            const tabState = state[tabKey];
            const selectedFile = fileInput.files && fileInput.files[0];
            if (!selectedFile) {
                tabState.csvFile = null;
                tabState.fileName = "";
                resetTabSearchState(tabState);
                setFileStatus(fileStatusEl, defaultMessage, "");
                updateButtonState();
                return;
            }

            tabState.csvFile = selectedFile;
            tabState.fileName = selectedFile.name;
            resetTabSearchState(tabState);
            setFileStatus(
                fileStatusEl,
                `Ready: ${selectedFile.name} (${formatFileSize(selectedFile.size)}). Enter a user identifier and click Search.`,
                "ready"
            );
            updateButtonState();
        });
    }

    function getHeaders(rows) {
        const seen = new Set();
        const headers = [];
        rows.forEach((row) => {
            Object.keys(row).forEach((key) => {
                if (!seen.has(key)) {
                    seen.add(key);
                    headers.push(key);
                }
            });
        });
        return headers;
    }

    function parseUtcTimestamp(value) {
        const raw = String(value || "").trim();
        if (!raw) {
            return 0;
        }

        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }

    function formatUtcToDetroit(value) {
        const raw = String(value || "").trim();
        if (!raw) {
            return "";
        }

        const timestamp = parseUtcTimestamp(raw);
        if (!timestamp) {
            return raw;
        }

        const date = new Date(timestamp);

        try {
            return new Intl.DateTimeFormat("en-US", {
                timeZone: DETROIT_TZ,
                dateStyle: "medium",
                timeStyle: "medium"
            }).format(date);
        } catch (error) {
            return date.toLocaleString("en-US", { timeZone: DETROIT_TZ });
        }
    }

    async function fetchUserByUserId(userId) {
        const response = await D2LApi._fetch(
            `/d2l/api/lp/1.46/users/${encodeURIComponent(userId)}`
        );
        if (!response || !response.UserId) {
            throw new Error(`No user found for UserId: ${userId}`);
        }
        return {
            userId: String(response.UserId),
            userName: response.UserName || "",
            fullName: `${response.FirstName || ""} ${response.LastName || ""}`.trim(),
            orgDefinedId: response.OrgDefinedId || ""
        };
    }

    async function resolveUserId(identifierType, identifier) {
        const trimmed = String(identifier || "").trim();
        if (!trimmed) {
            throw new Error("Enter a user identifier.");
        }

        if (identifierType === "userId") {
            return fetchUserByUserId(trimmed);
        }

        if (identifierType === "userName") {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.46/users/?userName=${encodeURIComponent(trimmed)}`
            );
            if (!response || !response.UserId) {
                throw new Error(`No user found for username: ${trimmed}`);
            }
            return {
                userId: String(response.UserId),
                userName: response.UserName || "",
                fullName: `${response.FirstName || ""} ${response.LastName || ""}`.trim(),
                orgDefinedId: response.OrgDefinedId || ""
            };
        }

        if (identifierType === "orgDefinedId") {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/1.46/users/?orgDefinedId=${encodeURIComponent(trimmed)}`
            );
            const user = Array.isArray(response) ? response[0] : response;
            if (!user || !user.UserId) {
                throw new Error(`No user found for OrgDefinedId: ${trimmed}`);
            }
            return {
                userId: String(user.UserId),
                userName: user.UserName || "",
                fullName: `${user.FirstName || ""} ${user.LastName || ""}`.trim(),
                orgDefinedId: user.OrgDefinedId || trimmed
            };
        }

        throw new Error("Unknown identifier type.");
    }

    async function fetchUserTrackingLogs(userId, startDateTime, endDateTime) {
        const endpoint =
            `/d2l/api/lp/${USER_TRACKING_API_VERSION}/users/${encodeURIComponent(userId)}/usertrackinglogs/` +
            `?startDateTime=${encodeURIComponent(startDateTime)}` +
            `&endDateTime=${encodeURIComponent(endDateTime)}`;

        try {
            const response = await D2LApi._fetch(endpoint);
            if (!Array.isArray(response)) {
                throw new Error("Unexpected response from user tracking logs API.");
            }
            return response;
        } catch (error) {
            const message = String(error?.message || "");
            if (message.includes("400")) {
                throw new Error(
                    "Invalid date range for user tracking logs. Keep the window to 31 days or fewer."
                );
            }
            if (message.includes("403")) {
                throw new Error(
                    "Permission denied reading user tracking logs for this user."
                );
            }
            if (message.includes("404")) {
                throw new Error(`No such user for UserId ${userId}.`);
            }
            throw error;
        }
    }

    function mapTrackingLogsToSystemLoginRows(logs) {
        return logs.map((entry) => ({
            UserId: "",
            UserName: "",
            IP: entry?.IpAddress || "",
            AttemptDate: entry?.LoginDate || ""
        }));
    }

    function systemLoginRowMatches(row, userId) {
        return getFieldValue(row, "UserId", "userid") === String(userId);
    }

    function courseAccessRowMatches(row, userId, orgUnitId) {
        if (getFieldValue(row, "UserId", "userid") !== String(userId)) {
            return false;
        }
        if (!orgUnitId) {
            return true;
        }
        return getFieldValue(row, "OrgUnitId", "orgunitid") === orgUnitId;
    }

    function destroyDataTable(tableId, tableState) {
        const $table = $(`#${tableId}`);
        if ($.fn.DataTable.isDataTable($table)) {
            $table.DataTable().clear().destroy();
        }
        tableState.dataTable = null;
    }

    function renderDataTable(tableId, tableState, rows) {
        destroyDataTable(tableId, tableState);

        const table = document.getElementById(tableId);
        const thead = table.querySelector("thead");
        const tbody = table.querySelector("tbody");

        thead.innerHTML = "";
        tbody.innerHTML = "";

        const headerRow = document.createElement("tr");
        tableState.headers.forEach((header) => {
            const th = document.createElement("th");
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            tableState.headers.forEach((header) => {
                const td = document.createElement("td");
                td.textContent = row[header] ?? "";
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        tableState.dataTable = $(`#${tableId}`).DataTable({
            pageLength: 25,
            order: [],
            autoWidth: false,
            deferRender: true,
            scrollX: true
        });
        tableState.dataTable.columns.adjust().draw(false);
    }

    function buildSystemLoginDisplayRows(rawRows, userInfo) {
        const sortedRows = rawRows.slice().sort((rowA, rowB) => {
            const timeA = parseUtcTimestamp(getFieldValue(rowA, "AttemptDate", "attemptdate", "LoginDate"));
            const timeB = parseUtcTimestamp(getFieldValue(rowB, "AttemptDate", "attemptdate", "LoginDate"));
            return timeB - timeA;
        });

        return sortedRows.map((row) => ({
            "Student ID": userInfo.orgDefinedId || "",
            Username: getFieldValue(row, "UserName", "username") || userInfo.userName || "",
            IP: getFieldValue(row, "IP", "ip", "IpAddress"),
            "Attempt Date (Detroit)": formatUtcToDetroit(
                getFieldValue(row, "AttemptDate", "attemptdate", "LoginDate")
            )
        }));
    }

    function buildCourseAccessDisplayRows(rawRows, userInfo) {
        const sortedRows = rawRows.slice().sort((rowA, rowB) => {
            const timeA = parseUtcTimestamp(getFieldValue(rowA, "DayAccessed", "dayaccessed"));
            const timeB = parseUtcTimestamp(getFieldValue(rowB, "DayAccessed", "dayaccessed"));
            return timeB - timeA;
        });

        return sortedRows.map((row) => {
            const dayAccessedRaw = getFieldValue(row, "DayAccessed", "dayaccessed");
            return {
                OrgUnitId: getFieldValue(row, "OrgUnitId", "orgunitid"),
                OrgDefinedId: userInfo.orgDefinedId || "",
                Username: userInfo.userName || "",
                "DayAccessed (Detroit)": formatUtcToDetroit(dayAccessedRaw),
                _dayAccessedSort: parseUtcTimestamp(dayAccessedRaw)
            };
        });
    }

    function renderSystemLoginTable(tableState, rows) {
        const tableId = "systemLoginTable";
        destroyDataTable(tableId, tableState);

        const tbody = document.querySelector(`#${tableId} tbody`);
        tbody.innerHTML = "";

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            SYSTEM_LOGIN_DISPLAY_HEADERS.forEach((header) => {
                const td = document.createElement("td");
                td.textContent = row[header] ?? "";
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        tableState.dataTable = $(`#${tableId}`).DataTable({
            pageLength: 25,
            order: [],
            autoWidth: false,
            deferRender: true,
            columnDefs: [
                { targets: 0, width: "18%" },
                { targets: 1, width: "22%" },
                { targets: 2, width: "20%" },
                { targets: 3, width: "40%" }
            ]
        });
    }

    function renderCourseAccessTable(tableState, rows) {
        const tableId = "courseAccessTable";
        destroyDataTable(tableId, tableState);

        const tbody = document.querySelector(`#${tableId} tbody`);
        tbody.innerHTML = "";

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            COURSE_ACCESS_DISPLAY_HEADERS.forEach((header) => {
                const td = document.createElement("td");
                td.textContent = row[header] ?? "";
                if (header === "DayAccessed (Detroit)" && row._dayAccessedSort) {
                    td.setAttribute("data-order", String(row._dayAccessedSort));
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        tableState.dataTable = $(`#${tableId}`).DataTable({
            pageLength: 25,
            order: [[3, "desc"]],
            autoWidth: false,
            deferRender: true,
            columnDefs: [
                { targets: 0, width: "15%" },
                { targets: 1, width: "20%" },
                { targets: 2, width: "20%" },
                { targets: 3, width: "45%", type: "num" }
            ]
        });
    }

    function setSystemLoginSourceMode(mode) {
        const tabState = state.systemLogin;
        tabState.sourceMode = mode === "csv" ? "csv" : "api";

        systemLoginSourceApi.classList.toggle("active", tabState.sourceMode === "api");
        systemLoginSourceCsv.classList.toggle("active", tabState.sourceMode === "csv");
        systemLoginApiPanel.classList.toggle("active", tabState.sourceMode === "api");
        systemLoginCsvPanel.classList.toggle("active", tabState.sourceMode === "csv");

        if (systemLoginTotalLabel) {
            systemLoginTotalLabel.textContent =
                tabState.sourceMode === "api" ? "Rows Returned" : "Rows Scanned";
        }

        updateSystemLoginSearchButtonState();
    }

    function updateSystemLoginSearchButtonState() {
        const tabState = state.systemLogin;
        const hasIdentifier = Boolean(String(systemLoginUserInput.value || "").trim());
        let shouldEnable = hasIdentifier && !tabState.searching;

        if (tabState.sourceMode === "api") {
            shouldEnable =
                shouldEnable &&
                Boolean(systemLoginStartDate.value) &&
                Boolean(systemLoginEndDate.value);
        } else {
            shouldEnable = shouldEnable && Boolean(tabState.csvFile);
        }

        systemLoginSearchBtn.disabled = !shouldEnable;
        if (shouldEnable) {
            systemLoginSearchBtn.removeAttribute("disabled");
        }
    }

    function updateCourseAccessSearchButtonState() {
        const tabState = state.courseAccess;
        const hasFile = Boolean(tabState.csvFile);
        const hasIdentifier = Boolean(String(courseAccessUserInput.value || "").trim());
        const shouldEnable = hasFile && hasIdentifier && !tabState.searching;

        courseAccessSearchBtn.disabled = !shouldEnable;
        if (shouldEnable) {
            courseAccessSearchBtn.removeAttribute("disabled");
        }
    }

    async function runSystemLoginApiSearch(config) {
        const {
            searchBtn,
            idTypeInput,
            userInput,
            startDateInput,
            endDateInput,
            statusEl,
            resolvedEl,
            resultsCard,
            totalRowsEl,
            matchRowsEl,
            resolvedIdEl,
            downloadBtn
        } = config;

        const tabState = state.systemLogin;
        const windowInfo = buildUtcDayWindow(startDateInput.value, endDateInput.value);

        setStatus(
            statusEl,
            `Fetching login history from ${windowInfo.startDateTime} to ${windowInfo.endDateTime}...`,
            "info"
        );

        const logs = await fetchUserTrackingLogs(
            tabState.resolvedUser.userId,
            windowInfo.startDateTime,
            windowInfo.endDateTime
        );

        const matchedRows = mapTrackingLogsToSystemLoginRows(logs);
        tabState.filteredRows = matchedRows;
        tabState.headers = ["IP", "AttemptDate"];
        tabState.totalScanned = matchedRows.length;
        tabState.displayRows = buildSystemLoginDisplayRows(matchedRows, tabState.resolvedUser);

        totalRowsEl.textContent = String(tabState.totalScanned);
        matchRowsEl.textContent = String(tabState.filteredRows.length);
        resolvedIdEl.textContent = tabState.resolvedUser.userId;

        renderSystemLoginTable(tabState, tabState.displayRows);
        resultsCard.style.display = "block";
        downloadBtn.disabled = tabState.filteredRows.length === 0;

        if (tabState.filteredRows.length === 0) {
            setStatus(
                statusEl,
                `No login events found for UserId ${tabState.resolvedUser.userId} between ` +
                    `${startDateInput.value} and ${endDateInput.value} (${windowInfo.daySpan} day window).`,
                "warning"
            );
        } else {
            setStatus(
                statusEl,
                `Found ${tabState.filteredRows.length.toLocaleString()} login event(s) via live API ` +
                    `(${windowInfo.daySpan} day window).`,
                "success"
            );
        }
    }

    async function runCsvSearch(config) {
        const {
            tabKey,
            fileStatusEl,
            searchBtn,
            idTypeInput,
            userInput,
            orgUnitInput,
            statusEl,
            resolvedEl,
            resultsCard,
            totalRowsEl,
            matchRowsEl,
            resolvedIdEl,
            tableId,
            downloadBtn,
            rowMatches,
            buildDisplayRows,
            renderResults
        } = config;

        const tabState = state[tabKey];
        const file = tabState.csvFile;
        const orgUnitId = orgUnitInput ? String(orgUnitInput.value || "").trim() : "";
        const sourceLabel = tabState.fileName || file.name;

        setStatus(
            statusEl,
            `Scanning ${sourceLabel} for UserId ${tabState.resolvedUser.userId}... 0%`,
            "info"
        );
        setFileStatus(fileStatusEl, `Scanning ${sourceLabel}... 0%`, "loading");

        const scanResult = await streamFilterCsvFile(
            file,
            (row) => rowMatches(row, tabState.resolvedUser.userId, orgUnitId),
            ({ percent, totalScanned, matched }) => {
                if (config.searchId !== tabState.searchId) {
                    return;
                }

                const percentLabel = percent === null ? "" : ` ${percent}%`;
                const progressText =
                    `Scanning ${sourceLabel}...${percentLabel} ` +
                    `(${totalScanned.toLocaleString()} rows scanned, ${matched.toLocaleString()} matched)`;

                setStatus(statusEl, progressText, "info");
                setFileStatus(fileStatusEl, progressText, "loading");
            }
        );

        if (config.searchId !== tabState.searchId) {
            return false;
        }

        if (!scanResult.sawUserIdColumn) {
            throw new Error("CSV is missing a UserId column.");
        }

        if (scanResult.totalScanned === 0) {
            const parseHint = scanResult.errors.length
                ? ` Parser reported ${scanResult.errors.length} issue(s).`
                : "";
            throw new Error(`No data rows were found in the CSV.${parseHint}`);
        }

        tabState.filteredRows = scanResult.matchedRows;
        tabState.headers = scanResult.headers.length
            ? scanResult.headers
            : getHeaders(scanResult.matchedRows);
        tabState.totalScanned = scanResult.totalScanned;
        tabState.displayRows = buildDisplayRows
            ? buildDisplayRows(tabState.filteredRows, tabState.resolvedUser)
            : [];

        totalRowsEl.textContent = String(tabState.totalScanned);
        matchRowsEl.textContent = String(tabState.filteredRows.length);
        resolvedIdEl.textContent = tabState.resolvedUser.userId;

        if (renderResults) {
            renderResults(tabState);
        } else {
            renderDataTable(tableId, tabState, tabState.filteredRows);
        }

        resultsCard.style.display = "block";
        downloadBtn.disabled = tabState.filteredRows.length === 0;

        setFileStatus(
            fileStatusEl,
            `Finished scanning ${sourceLabel}. ` +
                `${tabState.totalScanned.toLocaleString()} row(s) scanned, ` +
                `${tabState.filteredRows.length.toLocaleString()} matched.`,
            tabState.filteredRows.length ? "ready" : "error"
        );

        if (tabState.filteredRows.length === 0) {
            const orgUnitMessage = orgUnitId ? ` and OrgUnitId ${orgUnitId}` : "";
            setStatus(
                statusEl,
                `No matching rows found after scanning ${tabState.totalScanned.toLocaleString()} row(s) for UserId ${tabState.resolvedUser.userId}${orgUnitMessage}.`,
                "warning"
            );
        } else {
            setStatus(
                statusEl,
                `Found ${tabState.filteredRows.length.toLocaleString()} matching row(s) after scanning ${tabState.totalScanned.toLocaleString()} row(s).`,
                "success"
            );
        }

        return true;
    }

    async function runSearch(config) {
        const {
            tabKey,
            fileStatusEl,
            searchBtn,
            idTypeInput,
            userInput,
            statusEl,
            resolvedEl,
            resultsCard,
            downloadBtn,
            updateButtonState
        } = config;

        const tabState = state[tabKey];

        setStatus(statusEl, "", "");
        setResolvedUser(resolvedEl, null);

        if (tabState.searching) {
            setStatus(statusEl, "A search is already running. Please wait for it to finish.", "warning");
            return;
        }

        const identifier = userInput.value.trim();
        if (!identifier) {
            setStatus(statusEl, "Enter a user identifier to search.", "warning");
            return;
        }

        const usingApi = tabKey === "systemLogin" && tabState.sourceMode === "api";

        if (!usingApi && !tabState.csvFile) {
            setStatus(statusEl, "Upload a CSV file before searching.", "warning");
            return;
        }

        tabState.searchId += 1;
        const searchId = tabState.searchId;
        config.searchId = searchId;
        tabState.searching = true;
        searchBtn.disabled = true;
        searchBtn.setAttribute("disabled", "disabled");
        downloadBtn.disabled = true;
        resultsCard.style.display = "none";

        try {
            setStatus(statusEl, "Resolving user...", "info");
            const resolvedUser = await resolveUserId(idTypeInput.value, identifier);

            if (searchId !== tabState.searchId) {
                return;
            }

            tabState.resolvedUser = resolvedUser;
            setResolvedUser(resolvedEl, resolvedUser);

            if (usingApi) {
                await runSystemLoginApiSearch(config);
            } else {
                const continued = await runCsvSearch(config);
                if (!continued) {
                    return;
                }
            }
        } catch (error) {
            tabState.filteredRows = [];
            tabState.displayRows = [];
            setStatus(statusEl, error.message || "Search failed.", "error");
            if (fileStatusEl && !usingApi) {
                setFileStatus(fileStatusEl, error.message || "Search failed.", "error");
            }
        } finally {
            if (searchId === tabState.searchId) {
                tabState.searching = false;
                updateButtonState();
            }
        }
    }

    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            tabButtons.forEach((btn) => btn.classList.remove("active"));
            tabContents.forEach((content) => content.classList.remove("active"));
            button.classList.add("active");
            document.getElementById(`tab-${button.dataset.tab}`).classList.add("active");
        });
    });

    const systemLoginSearchBtn = document.getElementById("systemLoginSearchBtn");
    const systemLoginFileStatus = document.getElementById("systemLoginFileStatus");
    const systemLoginUserInput = document.getElementById("systemLoginUserInput");
    const systemLoginStartDate = document.getElementById("systemLoginStartDate");
    const systemLoginEndDate = document.getElementById("systemLoginEndDate");
    const systemLoginSourceApi = document.getElementById("systemLoginSourceApi");
    const systemLoginSourceCsv = document.getElementById("systemLoginSourceCsv");
    const systemLoginApiPanel = document.getElementById("systemLoginApiPanel");
    const systemLoginCsvPanel = document.getElementById("systemLoginCsvPanel");
    const systemLoginTotalLabel = document.getElementById("systemLoginTotalLabel");
    const courseAccessSearchBtn = document.getElementById("courseAccessSearchBtn");
    const courseAccessFileStatus = document.getElementById("courseAccessFileStatus");
    const courseAccessUserInput = document.getElementById("courseAccessUserInput");

    const SYSTEM_LOGIN_FILE_HINT =
        "Upload a User Logins CSV export, then enter a user identifier and click Search.";
    const COURSE_ACCESS_FILE_HINT =
        "Upload a Course Access CSV export, then enter a user identifier and click Search.";

    systemLoginUserInput.addEventListener("input", updateSystemLoginSearchButtonState);
    systemLoginStartDate.addEventListener("change", updateSystemLoginSearchButtonState);
    systemLoginEndDate.addEventListener("change", updateSystemLoginSearchButtonState);
    courseAccessUserInput.addEventListener("input", updateCourseAccessSearchButtonState);

    systemLoginSourceApi.addEventListener("click", () => setSystemLoginSourceMode("api"));
    systemLoginSourceCsv.addEventListener("click", () => setSystemLoginSourceMode("csv"));

    const systemLoginCsvUpload = document.getElementById("systemLoginCsvUpload");
    const courseAccessCsvUpload = document.getElementById("courseAccessCsvUpload");

    bindCsvUpload(
        "systemLogin",
        systemLoginCsvUpload,
        systemLoginFileStatus,
        updateSystemLoginSearchButtonState,
        SYSTEM_LOGIN_FILE_HINT
    );
    bindCsvUpload(
        "courseAccess",
        courseAccessCsvUpload,
        courseAccessFileStatus,
        updateCourseAccessSearchButtonState,
        COURSE_ACCESS_FILE_HINT
    );

    setDefaultSystemLoginDates();
    setSystemLoginSourceMode("api");
    updateCourseAccessSearchButtonState();

    document.getElementById("systemLoginSearchBtn").addEventListener("click", () => {
        runSearch({
            tabKey: "systemLogin",
            fileStatusEl: systemLoginFileStatus,
            searchBtn: systemLoginSearchBtn,
            idTypeInput: document.getElementById("systemLoginIdType"),
            userInput: document.getElementById("systemLoginUserInput"),
            startDateInput: systemLoginStartDate,
            endDateInput: systemLoginEndDate,
            statusEl: document.getElementById("systemLoginStatus"),
            resolvedEl: document.getElementById("systemLoginResolved"),
            resultsCard: document.getElementById("systemLoginResultsCard"),
            totalRowsEl: document.getElementById("systemLoginTotalRows"),
            matchRowsEl: document.getElementById("systemLoginMatchRows"),
            resolvedIdEl: document.getElementById("systemLoginResolvedId"),
            tableId: "systemLoginTable",
            downloadBtn: document.getElementById("systemLoginDownloadBtn"),
            rowMatches: (row, userId) => systemLoginRowMatches(row, userId),
            buildDisplayRows: buildSystemLoginDisplayRows,
            renderResults: (tabState) => renderSystemLoginTable(tabState, tabState.displayRows),
            updateButtonState: updateSystemLoginSearchButtonState
        });
    });

    document.getElementById("courseAccessSearchBtn").addEventListener("click", () => {
        runSearch({
            tabKey: "courseAccess",
            fileStatusEl: courseAccessFileStatus,
            searchBtn: courseAccessSearchBtn,
            idTypeInput: document.getElementById("courseAccessIdType"),
            userInput: document.getElementById("courseAccessUserInput"),
            orgUnitInput: document.getElementById("courseAccessOrgUnitInput"),
            statusEl: document.getElementById("courseAccessStatus"),
            resolvedEl: document.getElementById("courseAccessResolved"),
            resultsCard: document.getElementById("courseAccessResultsCard"),
            totalRowsEl: document.getElementById("courseAccessTotalRows"),
            matchRowsEl: document.getElementById("courseAccessMatchRows"),
            resolvedIdEl: document.getElementById("courseAccessResolvedId"),
            tableId: "courseAccessTable",
            downloadBtn: document.getElementById("courseAccessDownloadBtn"),
            rowMatches: (row, userId, orgUnitId) => courseAccessRowMatches(row, userId, orgUnitId),
            buildDisplayRows: buildCourseAccessDisplayRows,
            renderResults: (tabState) => renderCourseAccessTable(tabState, tabState.displayRows),
            updateButtonState: updateCourseAccessSearchButtonState
        });
    });

    document.getElementById("systemLoginDownloadBtn").addEventListener("click", () => {
        const tabState = state.systemLogin;
        if (!tabState.displayRows.length) return;
        downloadCsv(
            "system-login-matches.csv",
            SYSTEM_LOGIN_DISPLAY_HEADERS,
            tabState.displayRows
        );
    });

    document.getElementById("courseAccessDownloadBtn").addEventListener("click", () => {
        const tabState = state.courseAccess;
        if (!tabState.displayRows.length) return;
        downloadCsv(
            "course-access-matches.csv",
            COURSE_ACCESS_DISPLAY_HEADERS,
            tabState.displayRows
        );
    });
})();
