/**
 * Admin Dashboard — System Access Log
 * Stream a Data Hub System Access Log CSV, filter to one user, export OrgDefinedId instead of UserId.
 */
(function () {
    "use strict";

    const DETROIT_TZ = "America/Detroit";
    const STREAM_YIELD_EVERY = 10000;
    const CANONICAL_COLUMNS = [
        "SessionId",
        "Timestamp",
        "State",
        "Source",
        "AppVersion",
        "Device",
        "IsOfflineMode",
        "IPAddress"
    ];
    const DETROIT_HEADER = "Timestamp (Detroit)";
    const EXPORT_DETROIT_HEADER = "TimestampDetroit";

    const state = {
        csvFiles: [],
        filteredRows: [],
        displayRows: [],
        exportRows: [],
        displayHeaders: [],
        exportHeaders: [],
        totalScanned: 0,
        uniqueSessions: 0,
        pulseRows: 0,
        brightspaceRows: 0,
        dataTable: null,
        resolvedUser: null,
        searching: false,
        searchId: 0
    };

    const els = {
        fileInput: document.getElementById("salCsvUpload"),
        fileStatus: document.getElementById("salFileStatus"),
        fileList: document.getElementById("salFileList"),
        clearFilesBtn: document.getElementById("salClearFilesBtn"),
        idType: document.getElementById("salIdType"),
        userInput: document.getElementById("salUserInput"),
        startDate: document.getElementById("salStartDate"),
        endDate: document.getElementById("salEndDate"),
        source: document.getElementById("salSource"),
        searchBtn: document.getElementById("salSearchBtn"),
        downloadBtn: document.getElementById("salDownloadBtn"),
        status: document.getElementById("salStatus"),
        resolved: document.getElementById("salResolved"),
        resultsCard: document.getElementById("salResultsCard"),
        totalRows: document.getElementById("salTotalRows"),
        fileCount: document.getElementById("salFileCount"),
        matchRows: document.getElementById("salMatchRows"),
        sessionCount: document.getElementById("salSessionCount"),
        pulseRows: document.getElementById("salPulseRows"),
        brightspaceRows: document.getElementById("salBrightspaceRows"),
        resolvedOrgId: document.getElementById("salResolvedOrgId")
    };

    function setStatus(message, type) {
        const element = els.status;
        if (!element) return;
        if (!message) {
            element.style.display = "none";
            element.textContent = "";
            element.className = "status-box";
            return;
        }
        element.textContent = message;
        element.className = "status-box status-" + (type || "info");
        element.style.display = "block";
    }

    function setFileStatus(message, type) {
        const element = els.fileStatus;
        if (!element) return;
        element.textContent = message;
        element.className = "form-hint";
        if (type === "ready") element.classList.add("file-status-ready");
        else if (type === "loading") element.classList.add("file-status-loading");
        else if (type === "error") element.classList.add("file-status-error");
    }

    function setResolvedUser(user) {
        const element = els.resolved;
        if (!element) return;
        if (!user) {
            element.innerHTML = "";
            return;
        }
        const parts = [
            user.orgDefinedId ? "<strong>OrgDefinedId:</strong> " + escapeHtml(user.orgDefinedId) : "",
            "<strong>UserId:</strong> " + escapeHtml(user.userId),
            user.userName ? "<strong>Username:</strong> " + escapeHtml(user.userName) : "",
            user.fullName ? "<strong>Name:</strong> " + escapeHtml(user.fullName) : ""
        ].filter(Boolean);
        element.innerHTML = parts.join(" &nbsp;|&nbsp; ");
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
        });
    }

    function normalizeKey(key) {
        return String(key || "").trim().toLowerCase();
    }

    function cleanHeader(header) {
        return String(header || "").replace(/^\uFEFF/, "").trim();
    }

    function getFieldValue(row, fieldNames) {
        const keys = Object.keys(row || {});
        for (let i = 0; i < fieldNames.length; i++) {
            const target = normalizeKey(fieldNames[i]);
            const match = keys.find(function (key) {
                return normalizeKey(key) === target;
            });
            if (match !== undefined) {
                return String(row[match] == null ? "" : row[match]).trim();
            }
        }
        return "";
    }

    function toCsvValue(value) {
        const text = value === null || value === undefined ? "" : String(value);
        if (text.indexOf('"') >= 0 || text.indexOf(",") >= 0 || text.indexOf("\n") >= 0) {
            return '"' + text.replace(/"/g, '""') + '"';
        }
        return text;
    }

    function downloadCsv(filename, headers, rows) {
        const lines = [headers.map(toCsvValue).join(",")];
        rows.forEach(function (row) {
            lines.push(headers.map(function (header) {
                return toCsvValue(row[header]);
            }).join(","));
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

    function rowHasData(row) {
        if (!row || typeof row !== "object") return false;
        return Object.keys(row).some(function (key) {
            if (key === "__parsed_extra") return false;
            return String(row[key] == null ? "" : row[key]).trim() !== "";
        });
    }

    function asValueArray(data) {
        if (Array.isArray(data)) return data.slice();
        if (data && typeof data === "object") {
            return Object.keys(data)
                .filter(function (key) { return key !== "__parsed_extra"; })
                .map(function (key) { return data[key]; });
        }
        return [];
    }

    function looksLikeHeaderRow(values) {
        var joined = values.map(function (value) {
            return normalizeKey(value);
        }).join(" ");
        return joined.indexOf("userid") >= 0 && joined.indexOf("sessionid") >= 0;
    }

    function looksLikeAppleDevice(value) {
        return /^(iphone|ipad|ipod|imac|macbook|macmini|macpro|mac|watch|appletv)\d*$/i.test(
            String(value || "").trim()
        );
    }

    function looksLikeDeviceSuffix(value) {
        return /^\d+[A-Za-z]?$/.test(String(value || "").trim());
    }

    function looksLikeIp(value) {
        var raw = String(value || "").trim();
        return /^\d{1,3}(\.\d{1,3}){3}$/.test(raw) || raw.indexOf(":") >= 0;
    }

    function headerIndex(headers, name) {
        var target = normalizeKey(name);
        for (var i = 0; i < headers.length; i++) {
            if (normalizeKey(headers[i]) === target) return i;
        }
        return -1;
    }

    function repairRowValues(headers, values) {
        var cells = values.map(function (value) {
            return value == null ? "" : String(value);
        });
        var deviceIdx = headerIndex(headers, "Device");
        var expected = headers.length;

        while (
            deviceIdx >= 0 &&
            cells.length > expected &&
            looksLikeAppleDevice(cells[deviceIdx]) &&
            looksLikeDeviceSuffix(cells[deviceIdx + 1])
        ) {
            cells[deviceIdx] = String(cells[deviceIdx]).trim() + "," + String(cells[deviceIdx + 1]).trim();
            cells.splice(deviceIdx + 1, 1);
        }

        if (cells.length < expected) {
            var sourceIdx = headerIndex(headers, "Source");
            var ipIdx = headerIndex(headers, "IPAddress");
            if (
                sourceIdx >= 0 &&
                ipIdx > sourceIdx &&
                cells.length === sourceIdx + 2 &&
                looksLikeIp(cells[cells.length - 1])
            ) {
                var aligned = cells.slice(0, sourceIdx + 1);
                while (aligned.length < ipIdx) aligned.push("");
                aligned.push(cells[cells.length - 1]);
                cells = aligned;
            }
            while (cells.length < expected) cells.push("");
        }

        if (cells.length > expected) {
            cells[expected - 1] = cells.slice(expected - 1).join(",").replace(/^,+|,+$/g, "");
            cells = cells.slice(0, expected);
        }

        return cells;
    }

    function rowFromValues(headers, values) {
        var repaired = repairRowValues(headers, values);
        var row = {};
        headers.forEach(function (header, index) {
            row[header] = repaired[index] == null ? "" : String(repaired[index]).trim();
        });
        return row;
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes < 1024) return (bytes || 0) + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    }

    function fileKey(file) {
        return [file.name, file.size, file.lastModified].join(":");
    }

    function sortFilesForScan(files) {
        return files.slice().sort(function (a, b) {
            return (b.size || 0) - (a.size || 0);
        });
    }

    function totalFileBytes(files) {
        return files.reduce(function (sum, file) {
            return sum + (file.size || 0);
        }, 0);
    }

    function rowDedupeKey(row) {
        return [
            getFieldValue(row, ["SessionId", "sessionid"]),
            getFieldValue(row, ["Timestamp", "timestamp"]),
            getFieldValue(row, ["State", "state"]),
            getFieldValue(row, ["Source", "source"]),
            normalizeUserId(getFieldValue(row, ["UserId", "userid"]))
        ].join("|");
    }

    function mergeMatchedRows(existingRows, incomingRows, seenKeys) {
        incomingRows.forEach(function (row) {
            const key = rowDedupeKey(row);
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
            existingRows.push(row);
        });
    }

    function renderFileList() {
        const list = els.fileList;
        if (!list) return;
        list.innerHTML = "";
        if (!state.csvFiles.length) {
            list.hidden = true;
            return;
        }
        list.hidden = false;
        state.csvFiles.forEach(function (file) {
            const item = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = file.name;
            const size = document.createElement("span");
            size.className = "file-size";
            size.textContent = formatFileSize(file.size);
            item.appendChild(name);
            item.appendChild(size);
            list.appendChild(item);
        });
    }

    function describeSelectedFiles() {
        const files = state.csvFiles;
        if (!files.length) {
            return "Add the Sunday full extract and any daily differential CSVs, then enter an OrgDefinedId and click Search.";
        }
        const countLabel = files.length === 1 ? "1 file" : files.length + " files";
        return (
            "Ready: " + countLabel + " (" + formatFileSize(totalFileBytes(files)) +
            "). Largest file is scanned first. Enter an OrgDefinedId and click Search."
        );
    }

    function addSelectedFiles(fileList) {
        const incoming = Array.prototype.slice.call(fileList || []);
        const existing = {};
        state.csvFiles.forEach(function (file) {
            existing[fileKey(file)] = true;
        });
        incoming.forEach(function (file) {
            if (!file || existing[fileKey(file)]) return;
            existing[fileKey(file)] = true;
            state.csvFiles.push(file);
        });
        state.csvFiles = sortFilesForScan(state.csvFiles);
    }

    function clearSelectedFiles() {
        state.csvFiles = [];
        if (els.fileInput) els.fileInput.value = "";
        renderFileList();
        if (els.clearFilesBtn) {
            els.clearFilesBtn.disabled = true;
            els.clearFilesBtn.setAttribute("disabled", "disabled");
        }
        setFileStatus(
            "Add the Sunday full extract and any daily differential CSVs, then enter an OrgDefinedId and click Search.",
            ""
        );
    }

    function normalizeUserId(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const asNumber = Number(raw);
        if (Number.isFinite(asNumber)) return String(Math.trunc(asNumber));
        return raw;
    }

    function orgDefinedIdCandidates(raw) {
        const trimmed = String(raw || "").trim();
        const digits = trimmed.replace(/\D/g, "");
        if (!digits) return trimmed ? [trimmed] : [];
        const unpadded = digits.replace(/^0+/, "") || "0";
        const set = new Set([trimmed, digits, unpadded]);
        [7, 8, 9, 10].forEach(function (len) {
            if (unpadded.length <= len) set.add(unpadded.padStart(len, "0"));
        });
        return Array.from(set).filter(Boolean);
    }

    function parseDateInputValue(value) {
        const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        return {
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3])
        };
    }

    function parseUtcTimestamp(value) {
        const raw = String(value || "").trim();
        if (!raw) return 0;
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }

    function detroitYmd(timestamp) {
        if (!timestamp) return "";
        try {
            const parts = new Intl.DateTimeFormat("en-CA", {
                timeZone: DETROIT_TZ,
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).formatToParts(new Date(timestamp));
            const year = parts.find(function (part) { return part.type === "year"; });
            const month = parts.find(function (part) { return part.type === "month"; });
            const day = parts.find(function (part) { return part.type === "day"; });
            return (year && month && day) ? year.value + "-" + month.value + "-" + day.value : "";
        } catch (error) {
            return "";
        }
    }

    function formatUtcToDetroit(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const timestamp = parseUtcTimestamp(raw);
        if (!timestamp) return raw;
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

    function formatOffline(value) {
        const raw = String(value || "").trim().toLowerCase();
        if (raw === "true" || raw === "1" || raw === "yes") return "Yes";
        if (raw === "false" || raw === "0" || raw === "no") return "No";
        return String(value || "").trim();
    }

    function safeFilePart(value) {
        const cleaned = String(value || "user").replace(/[^A-Za-z0-9._-]+/g, "_");
        return cleaned || "user";
    }

    function firstUser(result) {
        if (Array.isArray(result)) return result[0] || null;
        if (result && result.Items && result.Items[0]) return result.Items[0];
        if (result && (result.UserId || result.Identifier)) return result;
        return null;
    }

    function mapUser(user, fallbackOrgDefinedId) {
        if (!user) return null;
        const userId = user.UserId != null ? user.UserId : user.Identifier;
        if (userId == null || userId === "") return null;
        return {
            userId: String(userId),
            userName: user.UserName || "",
            fullName: ((user.FirstName || "") + " " + (user.LastName || "")).trim(),
            orgDefinedId: user.OrgDefinedId || user.OrgDefinedID || fallbackOrgDefinedId || ""
        };
    }

    async function fetchUserByUserId(userId) {
        const response = await D2LApi._fetch("/d2l/api/lp/1.46/users/" + encodeURIComponent(userId));
        const mapped = mapUser(response);
        if (!mapped) throw new Error("No user found for UserId: " + userId);
        return mapped;
    }

    async function fetchUserByUserName(userName) {
        const response = await D2LApi._fetch(
            "/d2l/api/lp/1.46/users/?userName=" + encodeURIComponent(userName)
        );
        const mapped = mapUser(firstUser(response) || response);
        if (!mapped) throw new Error("No user found for username: " + userName);
        return mapped;
    }

    async function fetchUserByOrgDefinedId(orgDefinedId) {
        const candidates = orgDefinedIdCandidates(orgDefinedId);
        for (let i = 0; i < candidates.length; i++) {
            try {
                const response = await D2LApi._fetch(
                    "/d2l/api/lp/1.46/users/?orgDefinedId=" + encodeURIComponent(candidates[i])
                );
                const mapped = mapUser(firstUser(response) || response, candidates[i]);
                if (mapped) return mapped;
            } catch (error) {
                /* try next padding / format */
            }
        }
        throw new Error("No user found for OrgDefinedId: " + orgDefinedId);
    }

    async function resolveUser(identifierType, identifier) {
        const trimmed = String(identifier || "").trim();
        if (!trimmed) throw new Error("Enter a user identifier.");
        if (identifierType === "userId") return fetchUserByUserId(trimmed);
        if (identifierType === "userName") return fetchUserByUserName(trimmed);
        return fetchUserByOrgDefinedId(trimmed);
    }

    function rowMatches(row, userId, filters) {
        if (normalizeUserId(getFieldValue(row, ["UserId", "userid"])) !== userId) {
            return false;
        }

        if (filters.source) {
            const source = getFieldValue(row, ["Source", "source"]);
            if (source.toLowerCase() !== filters.source.toLowerCase()) {
                return false;
            }
        }

        if (!filters.startYmd && !filters.endYmd) {
            return true;
        }

        const timestamp = parseUtcTimestamp(getFieldValue(row, ["Timestamp", "timestamp"]));
        const ymd = detroitYmd(timestamp);
        if (!ymd) return false;
        if (filters.startYmd && ymd < filters.startYmd) return false;
        if (filters.endYmd && ymd > filters.endYmd) return false;
        return true;
    }

    function streamFilterCsvFile(file, shouldKeepRow, onProgress) {
        return new Promise(function (resolve, reject) {
            const matchedRows = [];
            const errors = [];
            const headerSet = [];
            let headers = [];
            let totalScanned = 0;
            let sawUserIdColumn = false;
            let settled = false;

            function finish(callback) {
                if (settled) return;
                settled = true;
                callback();
            }

            function rememberHeaders(nextHeaders) {
                nextHeaders.forEach(function (header) {
                    if (!header) return;
                    if (headerSet.some(function (existing) {
                        return normalizeKey(existing) === normalizeKey(header);
                    })) return;
                    headerSet.push(header);
                });
            }

            Papa.parse(file, {
                header: false,
                skipEmptyLines: "greedy",
                delimiter: ",",
                quoteChar: '"',
                fastMode: false,
                step: function (results, parser) {
                    if (results.errors && results.errors.length) {
                        errors.push.apply(errors, results.errors);
                    }

                    const values = asValueArray(results.data).map(function (value) {
                        return value == null ? "" : String(value).replace(/^\uFEFF/, "").trim();
                    });
                    if (!values.some(function (value) { return value !== ""; })) return;

                    if (!headers.length) {
                        if (values.length === 1 && /^sep=/i.test(values[0])) return;
                        if (!looksLikeHeaderRow(values)) {
                            parser.abort();
                            finish(function () {
                                reject(new Error(
                                    "CSV does not look like a System Access Log. The first row should include SessionId and UserId."
                                ));
                            });
                            return;
                        }
                        headers = values.map(cleanHeader);
                        rememberHeaders(headers);
                        sawUserIdColumn = headers.some(function (header) {
                            return normalizeKey(header) === "userid";
                        });
                        return;
                    }

                    const row = rowFromValues(headers, values);
                    if (!rowHasData(row)) return;

                    totalScanned += 1;
                    rememberHeaders(Object.keys(row));

                    if (shouldKeepRow(row)) {
                        matchedRows.push(row);
                    }

                    if (onProgress && (totalScanned % STREAM_YIELD_EVERY === 0 || totalScanned === 1)) {
                        const percent = file.size && results.meta && results.meta.cursor
                            ? Math.min(99, Math.round((results.meta.cursor / file.size) * 100))
                            : null;
                        onProgress({
                            percent: percent,
                            totalScanned: totalScanned,
                            matched: matchedRows.length
                        });
                        parser.pause();
                        setTimeout(function () {
                            parser.resume();
                        }, 0);
                    }
                },
                complete: function () {
                    CANONICAL_COLUMNS.forEach(function (header) {
                        rememberHeaders([header]);
                    });
                    finish(function () {
                        resolve({
                            matchedRows: matchedRows,
                            headers: headerSet.length ? headerSet : headers,
                            totalScanned: totalScanned,
                            errors: errors,
                            sawUserIdColumn: sawUserIdColumn
                        });
                    });
                },
                error: function (error) {
                    finish(function () {
                        reject(error);
                    });
                }
            });
        });
    }

    function isUserIdHeader(header) {
        return normalizeKey(header) === "userid";
    }

    function isTimestampHeader(header) {
        return normalizeKey(header) === "timestamp";
    }

    function isOfflineHeader(header) {
        return normalizeKey(header) === "isofflinemode";
    }

    function buildColumnPlan(csvHeaders) {
        const seen = {};
        const sourceHeaders = [];

        function addHeader(header) {
            if (!header || isUserIdHeader(header)) return;
            const key = normalizeKey(header);
            if (!key || seen[key]) return;
            seen[key] = true;
            sourceHeaders.push(header);
        }

        CANONICAL_COLUMNS.forEach(addHeader);
        (csvHeaders || []).forEach(addHeader);

        const displayHeaders = ["OrgDefinedId", "Username"];
        const exportHeaders = ["OrgDefinedId", "Username"];

        sourceHeaders.forEach(function (header) {
            displayHeaders.push(header);
            exportHeaders.push(header);
            if (isTimestampHeader(header)) {
                displayHeaders.push(DETROIT_HEADER);
                exportHeaders.push(EXPORT_DETROIT_HEADER);
            }
        });

        return {
            sourceHeaders: sourceHeaders,
            displayHeaders: displayHeaders,
            exportHeaders: exportHeaders
        };
    }

    function displayCellText(header, value) {
        if (isOfflineHeader(header)) {
            const formatted = formatOffline(value);
            return formatted || "—";
        }
        return value ? value : "—";
    }

    function buildDisplayAndExportRows(rawRows, csvHeaders, userInfo) {
        const plan = buildColumnPlan(csvHeaders);
        const sortedRows = rawRows.slice().sort(function (rowA, rowB) {
            const timeA = parseUtcTimestamp(getFieldValue(rowA, ["Timestamp", "timestamp"]));
            const timeB = parseUtcTimestamp(getFieldValue(rowB, ["Timestamp", "timestamp"]));
            return timeB - timeA;
        });

        const sessions = new Set();
        const displayRows = [];
        const exportRows = [];
        const orgDefinedId = userInfo.orgDefinedId || "";
        const username = userInfo.userName || "";
        let pulseRows = 0;
        let brightspaceRows = 0;

        sortedRows.forEach(function (row) {
            const timestampRaw = getFieldValue(row, ["Timestamp", "timestamp"]);
            const timestampDetroit = formatUtcToDetroit(timestampRaw);
            const sessionId = getFieldValue(row, ["SessionId", "sessionid"]);
            const source = getFieldValue(row, ["Source", "source"]);
            if (sessionId) sessions.add(sessionId);
            if (/^pulse$/i.test(source)) pulseRows += 1;
            else if (/^brightspace$/i.test(source)) brightspaceRows += 1;

            const displayRow = {
                OrgDefinedId: orgDefinedId,
                Username: username,
                _timestampSort: parseUtcTimestamp(timestampRaw)
            };
            const exportRow = {
                OrgDefinedId: orgDefinedId,
                Username: username
            };

            plan.sourceHeaders.forEach(function (header) {
                const aliases = [header];
                if (normalizeKey(header) === "device") {
                    aliases.push("DeviceId", "DeviceName", "DeviceType");
                }
                const value = getFieldValue(row, aliases);
                displayRow[header] = value;
                exportRow[header] = value;
                if (isTimestampHeader(header)) {
                    displayRow[DETROIT_HEADER] = timestampDetroit;
                    exportRow[EXPORT_DETROIT_HEADER] = timestampDetroit;
                }
            });

            displayRows.push(displayRow);
            exportRows.push(exportRow);
        });

        return {
            displayHeaders: plan.displayHeaders,
            exportHeaders: plan.exportHeaders,
            displayRows: displayRows,
            exportRows: exportRows,
            uniqueSessions: sessions.size,
            pulseRows: pulseRows,
            brightspaceRows: brightspaceRows
        };
    }

    function destroyDataTable() {
        const table = document.getElementById("systemAccessTable");
        if (!table) return;
        const $table = $(table);
        if ($.fn.DataTable.isDataTable($table)) {
            $table.DataTable().destroy();
        }
        table.innerHTML = "<thead></thead><tbody></tbody>";
        state.dataTable = null;
    }

    function renderTable(headers, rows) {
        destroyDataTable();

        const table = document.getElementById("systemAccessTable");
        const thead = table.querySelector("thead");
        const tbody = table.querySelector("tbody");

        const headerRow = document.createElement("tr");
        headers.forEach(function (header) {
            const th = document.createElement("th");
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);

        rows.forEach(function (row) {
            const tr = document.createElement("tr");
            headers.forEach(function (header) {
                const td = document.createElement("td");
                td.textContent = displayCellText(header, row[header]);
                if ((header === DETROIT_HEADER || isTimestampHeader(header)) && row._timestampSort) {
                    td.setAttribute("data-order", String(row._timestampSort));
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        els.resultsCard.style.display = "block";

        const detroitIndex = headers.indexOf(DETROIT_HEADER);
        const timestampIndex = headers.findIndex(isTimestampHeader);
        const sortIndex = detroitIndex >= 0 ? detroitIndex : timestampIndex;

        state.dataTable = $("#systemAccessTable").DataTable({
            pageLength: 25,
            order: sortIndex >= 0 ? [[sortIndex, "desc"]] : [],
            autoWidth: true,
            deferRender: true
        });
        state.dataTable.columns.adjust().draw(false);
    }

    function readDateFilters() {
        const start = parseDateInputValue(els.startDate.value);
        const end = parseDateInputValue(els.endDate.value);
        if (start && end) {
            const startStamp = Date.UTC(start.year, start.month - 1, start.day);
            const endStamp = Date.UTC(end.year, end.month - 1, end.day);
            if (endStamp < startStamp) {
                throw new Error("End date must be on or after the start date.");
            }
        }
        return {
            startYmd: els.startDate.value || "",
            endYmd: els.endDate.value || "",
            source: String(els.source.value || "").trim()
        };
    }

    function updateSearchButtonState() {
        const hasFile = state.csvFiles.length > 0;
        const hasIdentifier = Boolean(String(els.userInput.value || "").trim());
        const shouldEnable = hasFile && hasIdentifier && !state.searching;
        els.searchBtn.disabled = !shouldEnable;
        if (shouldEnable) els.searchBtn.removeAttribute("disabled");
        else els.searchBtn.setAttribute("disabled", "disabled");
        if (els.clearFilesBtn) {
            els.clearFilesBtn.disabled = !state.csvFiles.length || state.searching;
            if (els.clearFilesBtn.disabled) els.clearFilesBtn.setAttribute("disabled", "disabled");
            else els.clearFilesBtn.removeAttribute("disabled");
        }
    }

    function resetResults() {
        state.filteredRows = [];
        state.displayRows = [];
        state.exportRows = [];
        state.displayHeaders = [];
        state.exportHeaders = [];
        state.totalScanned = 0;
        state.uniqueSessions = 0;
        state.pulseRows = 0;
        state.brightspaceRows = 0;
        els.downloadBtn.disabled = true;
        els.resultsCard.style.display = "none";
        destroyDataTable();
    }

    async function runSearch() {
        if (state.searching) {
            setStatus("A search is already running. Please wait for it to finish.", "warning");
            return;
        }

        const identifier = String(els.userInput.value || "").trim();
        if (!identifier) {
            setStatus("Enter an OrgDefinedId (or another identifier) to search.", "warning");
            return;
        }
        if (!state.csvFiles.length) {
            setStatus("Upload the Sunday full extract and/or differential CSVs before searching.", "warning");
            return;
        }

        let filters;
        try {
            filters = readDateFilters();
        } catch (error) {
            setStatus(error.message || "Invalid date range.", "error");
            return;
        }

        state.searchId += 1;
        const searchId = state.searchId;
        state.searching = true;
        els.searchBtn.disabled = true;
        els.downloadBtn.disabled = true;
        els.resultsCard.style.display = "none";
        setStatus("", "");
        setResolvedUser(null);

        try {
            setStatus("Resolving user in Brightspace...", "info");
            const resolvedUser = await resolveUser(els.idType.value, identifier);
            if (searchId !== state.searchId) return;

            state.resolvedUser = resolvedUser;
            setResolvedUser(resolvedUser);

            const files = sortFilesForScan(state.csvFiles);
            const userId = normalizeUserId(resolvedUser.userId);
            const matchedRows = [];
            const seenKeys = new Set();
            const allHeaders = [];
            let totalScanned = 0;
            let sawUserIdColumn = false;
            let parseErrors = 0;
            let bytesDone = 0;
            const bytesTotal = totalFileBytes(files) || 1;

            for (let i = 0; i < files.length; i++) {
                if (searchId !== state.searchId) return;
                const file = files[i];
                const fileLabel = file.name + " (" + (i + 1) + " of " + files.length + ")";
                setStatus("Scanning " + fileLabel + " for UserId " + userId + "...", "info");
                setFileStatus("Scanning " + fileLabel + "...", "loading");

                const scanResult = await streamFilterCsvFile(
                    file,
                    function (row) {
                        return rowMatches(row, userId, filters);
                    },
                    function (progress) {
                        if (searchId !== state.searchId) return;
                        const filePercent = progress.percent === null ? 0 : progress.percent;
                        const overall = Math.min(
                            99,
                            Math.round(((bytesDone + ((file.size || 0) * filePercent) / 100) / bytesTotal) * 100)
                        );
                        const progressText =
                            "Scanning " + fileLabel + "..." +
                            (progress.percent === null ? "" : " " + progress.percent + "%") +
                            " · overall " + overall + "%" +
                            " (" + (totalScanned + progress.totalScanned).toLocaleString() +
                            " rows scanned, " +
                            (matchedRows.length + progress.matched).toLocaleString() + " matched)";
                        setStatus(progressText, "info");
                        setFileStatus(progressText, "loading");
                    }
                );

                if (searchId !== state.searchId) return;

                totalScanned += scanResult.totalScanned;
                parseErrors += scanResult.errors.length;
                sawUserIdColumn = sawUserIdColumn || scanResult.sawUserIdColumn;
                scanResult.headers.forEach(function (header) {
                    if (!header) return;
                    if (allHeaders.some(function (existing) {
                        return normalizeKey(existing) === normalizeKey(header);
                    })) return;
                    allHeaders.push(header);
                });
                mergeMatchedRows(matchedRows, scanResult.matchedRows, seenKeys);
                bytesDone += file.size || 0;
            }

            if (!sawUserIdColumn) {
                throw new Error("CSV is missing a UserId column. This report expects the Data Hub System Access Log.");
            }
            if (totalScanned === 0) {
                const parseHint = parseErrors
                    ? " Parser reported " + parseErrors + " issue(s)."
                    : "";
                throw new Error("No data rows were found in the CSV file(s)." + parseHint);
            }

            const built = buildDisplayAndExportRows(
                matchedRows,
                allHeaders,
                resolvedUser
            );
            state.filteredRows = matchedRows;
            state.displayRows = built.displayRows;
            state.exportRows = built.exportRows;
            state.displayHeaders = built.displayHeaders;
            state.exportHeaders = built.exportHeaders;
            state.totalScanned = totalScanned;
            state.uniqueSessions = built.uniqueSessions;
            state.pulseRows = built.pulseRows;
            state.brightspaceRows = built.brightspaceRows;

            els.totalRows.textContent = String(state.totalScanned.toLocaleString());
            if (els.fileCount) els.fileCount.textContent = String(files.length);
            els.matchRows.textContent = String(state.filteredRows.length.toLocaleString());
            els.sessionCount.textContent = String(state.uniqueSessions.toLocaleString());
            if (els.pulseRows) els.pulseRows.textContent = String(state.pulseRows.toLocaleString());
            if (els.brightspaceRows) els.brightspaceRows.textContent = String(state.brightspaceRows.toLocaleString());
            els.resolvedOrgId.textContent = resolvedUser.orgDefinedId || "—";

            renderTable(state.displayHeaders, state.displayRows);
            els.downloadBtn.disabled = state.exportRows.length === 0;

            const filesLabel = files.length === 1 ? "1 file" : files.length + " files";
            setFileStatus(
                "Finished scanning " + filesLabel + ". " +
                    state.totalScanned.toLocaleString() + " row(s) scanned, " +
                    state.filteredRows.length.toLocaleString() + " unique matched rows.",
                state.filteredRows.length ? "ready" : "error"
            );

            if (state.filteredRows.length === 0) {
                setStatus(
                    "No matching rows for OrgDefinedId " + (resolvedUser.orgDefinedId || identifier) +
                        " (UserId " + userId + ") after scanning " +
                        state.totalScanned.toLocaleString() + " row(s) in " + filesLabel + ".",
                    "warning"
                );
            } else {
                var statusText =
                    "Found " + state.filteredRows.length.toLocaleString() +
                    " matching row(s) from " + filesLabel + ": " +
                    state.brightspaceRows.toLocaleString() +
                    " Brightspace, " + state.pulseRows.toLocaleString() +
                    " Pulse, across " + state.uniqueSessions.toLocaleString() + " session(s).";
                if (state.pulseRows === 0) {
                    statusText +=
                        " Device, AppVersion, and IsOfflineMode are filled only on Pulse (mobile) rows.";
                }
                setStatus(statusText, "success");
            }
        } catch (error) {
            resetResults();
            const message = error && error.message ? error.message : "Search failed.";
            setStatus(message, "error");
            setFileStatus(message, "error");
        } finally {
            if (searchId === state.searchId) {
                state.searching = false;
                updateSearchButtonState();
            }
        }
    }

    els.fileInput.addEventListener("change", function () {
        const incoming = els.fileInput.files;
        resetResults();
        setResolvedUser(null);
        setStatus("", "");
        if (incoming && incoming.length) {
            addSelectedFiles(incoming);
        }
        els.fileInput.value = "";
        renderFileList();
        if (!state.csvFiles.length) {
            clearSelectedFiles();
            updateSearchButtonState();
            return;
        }
        setFileStatus(describeSelectedFiles(), "ready");
        updateSearchButtonState();
    });

    if (els.clearFilesBtn) {
        els.clearFilesBtn.addEventListener("click", function () {
            if (state.searching) return;
            resetResults();
            setResolvedUser(null);
            setStatus("", "");
            clearSelectedFiles();
            updateSearchButtonState();
        });
    }

    els.userInput.addEventListener("input", updateSearchButtonState);
    els.userInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            event.preventDefault();
            if (!els.searchBtn.disabled) runSearch();
        }
    });
    els.searchBtn.addEventListener("click", runSearch);
    els.downloadBtn.addEventListener("click", function () {
        if (!state.exportRows.length) return;
        const orgId = (state.resolvedUser && state.resolvedUser.orgDefinedId) || "user";
        downloadCsv(
            "system-access-log-" + safeFilePart(orgId) + ".csv",
            state.exportHeaders,
            state.exportRows
        );
    });

    updateSearchButtonState();
})();
