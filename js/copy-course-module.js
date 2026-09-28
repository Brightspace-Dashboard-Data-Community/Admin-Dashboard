(function () {
    var LE_VERSION = "1.85";
    var LP_VERSION = "1.45";
    var COPY_COMPONENTS = ["Content", "Quizzes", "QuestionLibrary", "CourseFiles", "Links", "LtiLink", "LtiTP"];
    var topicCache = [];
    var cachedTopicSourceModule = null;
    var orgIdentifier = null;
    var operationLogConfigs = {
        csvLog: { downloadBtnId: "downloadCsvLogBtn", filePrefix: "module-copy-csv", page: 1, pageSize: 25, rows: [] },
        semLog: { downloadBtnId: "downloadSemLogBtn", filePrefix: "module-copy-semester", page: 1, pageSize: 25, rows: [] },
        topicLog: { downloadBtnId: "downloadTopicLogBtn", filePrefix: "module-topics-push", page: 1, pageSize: 25, rows: [] },
        delSemLog: { downloadBtnId: "downloadDelSemLogBtn", filePrefix: "module-delete-semester", page: 1, pageSize: 25, rows: [] },
        delCsvLog: { downloadBtnId: "downloadDelCsvLogBtn", filePrefix: "module-delete-csv", page: 1, pageSize: 25, rows: [] }
    };
    var reportSemRows = [];
    var reportSemPage = 1;
    var reportSemPageSize = 25;

    function byId(id) { return document.getElementById(id); }
    function normalizeTitle(v) { return String(v || "").trim().toLowerCase(); }
    function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
    function getCookie(name) {
        var value = "; " + document.cookie;
        var parts = value.split("; " + name + "=");
        if (parts.length === 2) return parts.pop().split(";").shift();
        return null;
    }
    function getCsrfToken() {
        return getCookie("XSRF.Token") || localStorage.getItem("XSRF.Token") || sessionStorage.getItem("XSRF.Token") || "";
    }
    async function d2lFetch(url, options) {
        var opts = options || {};
        var headers = opts.headers || {};
        headers.Accept = headers.Accept || "application/json";
        if (opts.body && !(opts.body instanceof FormData)) headers["Content-Type"] = headers["Content-Type"] || "application/json";
        var csrf = getCsrfToken();
        if (csrf) headers["X-Csrf-Token"] = csrf;
        var response = await fetch(url, { method: opts.method || "GET", headers: headers, body: opts.body, credentials: "include", mode: "cors" });
        var isJson = (response.headers.get("content-type") || "").indexOf("application/json") !== -1;
        if (!response.ok && response.status !== 202) {
            var details = null;
            if (isJson) {
                try { details = await response.json(); } catch (e) { details = null; }
            }
            var err = new Error("HTTP " + response.status);
            err.details = details;
            throw err;
        }
        if (!isJson) return await response.text();
        return await response.json();
    }
    function log(logId, kind, message) {
        var config = operationLogConfigs[logId];
        if (config) {
            var targetMatch = String(message || "").match(/\btarget\s+(\d+)\b/i) || String(message || "").match(/\((\d+)\)$/);
            config.rows.push({
                Timestamp: new Date().toISOString(),
                OrgUnitId: targetMatch ? targetMatch[1] : "",
                Status: String(kind || "info").toUpperCase(),
                Details: String(message || "")
            });
            renderOperationLogTable(logId);
            var downloadBtn = byId(config.downloadBtnId);
            if (downloadBtn) downloadBtn.disabled = config.rows.length === 0;
            return;
        }

        var root = byId(logId);
        var row = document.createElement("div");
        row.className = "mb-2 text-sm";
        if (kind === "ok") row.classList.add("border-l-success");
        else if (kind === "fail") row.classList.add("border-l-danger");
        else if (kind === "run") row.classList.add("border-l-warning");
        var badge = document.createElement("span");
        var badgeVariant = "badge-primary";
        if (kind === "ok") badgeVariant = "badge-success";
        if (kind === "fail") badgeVariant = "badge-danger";
        if (kind === "run") badgeVariant = "badge-warning";
        badge.className = "badge " + badgeVariant;
        badge.textContent = (kind || "info").toUpperCase();
        badge.style.marginRight = "8px";
        var text = document.createElement("span");
        text.textContent = message;
        row.appendChild(badge);
        row.appendChild(text);
        root.appendChild(row);
        root.scrollTop = root.scrollHeight;
    }
    function clearLog(logId) {
        var config = operationLogConfigs[logId];
        if (config) {
            config.rows = [];
            config.page = 1;
            var downloadBtn = byId(config.downloadBtnId);
            if (downloadBtn) downloadBtn.disabled = true;
            renderOperationLogTable(logId);
            return;
        }
        byId(logId).innerHTML = "";
    }
    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    function setReportSemStatus(message) {
        var status = byId("reportSemStatus");
        if (status) status.textContent = message;
    }
    function setCsvStatus(message) {
        var status = byId("csvStatus");
        if (status) status.textContent = message;
    }
    function setSemStatus(message) {
        var status = byId("semStatus");
        if (status) status.textContent = message;
    }
    function setTopicStatus(message) {
        var status = byId("topicStatus");
        if (status) status.textContent = message;
    }
    function setDelSemStatus(message) {
        var status = byId("delSemStatus");
        if (status) status.textContent = message;
    }
    function setDelCsvStatus(message) {
        var status = byId("delCsvStatus");
        if (status) status.textContent = message;
    }
    function downloadOperationLogCsv(logId) {
        var config = operationLogConfigs[logId];
        if (!config || !config.rows.length) return;
        var header = ["Timestamp", "OrgUnitId", "Status", "Details"];
        var lines = [header.join(",")];
        for (var i = 0; i < config.rows.length; i += 1) {
            var row = config.rows[i];
            var values = [row.Timestamp, row.OrgUnitId, row.Status, row.Details].map(function (v) {
                var text = String(v == null ? "" : v).replace(/"/g, '""');
                return '"' + text + '"';
            });
            lines.push(values.join(","));
        }
        var csv = lines.join("\n");
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = config.filePrefix + "_" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    function renderOperationLogTable(logId) {
        var config = operationLogConfigs[logId];
        var container = byId(logId);
        if (!config || !container) return;
        container.innerHTML = "";
        if (!config.rows.length) {
            container.innerHTML = '<div class="text-muted">Ready.</div>';
            return;
        }
        var totalRows = config.rows.length;
        var totalPages = Math.max(1, Math.ceil(totalRows / config.pageSize));
        if (config.page > totalPages) config.page = totalPages;
        if (config.page < 1) config.page = 1;
        var startIndex = (config.page - 1) * config.pageSize;
        var endIndex = Math.min(startIndex + config.pageSize, totalRows);
        var visibleRows = config.rows.slice(startIndex, endIndex);

        var html = '';
        html += '<div class="table-container"><table class="table">';
        html += '<thead><tr><th>Timestamp</th><th>OrgUnitId</th><th>Status</th><th>Details</th></tr></thead><tbody>';
        for (var i = 0; i < visibleRows.length; i += 1) {
            var row = visibleRows[i];
            var badgeClass = "badge-primary";
            if (row.Status === "OK" || row.Status === "SUCCESS") badgeClass = "badge-success";
            else if (row.Status === "FAIL" || row.Status === "FAILED" || row.Status === "ERROR") badgeClass = "badge-danger";
            else if (row.Status === "RUN" || row.Status === "RUNNING") badgeClass = "badge-warning";
            html += '<tr>';
            html += '<td>' + escapeHtml(row.Timestamp) + '</td>';
            html += '<td>' + escapeHtml(row.OrgUnitId) + '</td>';
            html += '<td><span class="badge ' + badgeClass + '">' + escapeHtml(row.Status) + '</span></td>';
            html += '<td>' + escapeHtml(row.Details) + '</td>';
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        html += '<div class="form-actions" style="justify-content:space-between; align-items:center;">';
        html += '<span class="text-muted text-sm">Showing ' + (startIndex + 1) + '-' + endIndex + ' of ' + totalRows + '</span>';
        html += '<div class="form-actions" style="margin-top:0;">';
        html += '<button class="btn btn-outline btn-sm op-log-page-btn" data-log-id="' + logId + '" data-page="' + (config.page - 1) + '" ' + (config.page <= 1 ? 'disabled' : '') + '>Prev</button>';
        html += '<span class="text-sm" style="padding:6px 8px;">Page ' + config.page + ' of ' + totalPages + '</span>';
        html += '<button class="btn btn-outline btn-sm op-log-page-btn" data-log-id="' + logId + '" data-page="' + (config.page + 1) + '" ' + (config.page >= totalPages ? 'disabled' : '') + '>Next</button>';
        html += '</div></div>';
        container.innerHTML = html;

        Array.prototype.slice.call(container.querySelectorAll(".op-log-page-btn")).forEach(function (btn) {
            btn.addEventListener("click", function () {
                var targetLogId = btn.getAttribute("data-log-id");
                var targetPage = Number(btn.getAttribute("data-page"));
                var cfg = operationLogConfigs[targetLogId];
                if (cfg && !isNaN(targetPage)) {
                    cfg.page = targetPage;
                    renderOperationLogTable(targetLogId);
                }
            });
        });
    }
    function downloadReportSemCsv() {
        if (!reportSemRows.length) {
            setReportSemStatus("No report rows to download yet. Run the report first.");
            return;
        }
        var header = ["OrgUnitId", "OrgUnitName", "OrgUnitCode", "Module Exists", "Module Name Match Count"];
        var lines = [header.join(",")];
        for (var i = 0; i < reportSemRows.length; i += 1) {
            var row = reportSemRows[i];
            var values = [
                row.OrgUnitId,
                row.OrgUnitName,
                row.OrgUnitCode,
                row.ModuleExists ? "Yes" : "No",
                row.ModuleNameMatchCount
            ].map(function (v) {
                var text = String(v == null ? "" : v).replace(/"/g, '""');
                return '"' + text + '"';
            });
            lines.push(values.join(","));
        }
        var csv = lines.join("\n");
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "module-presence-report_" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    function renderReportSemTable() {
        var container = byId("reportSemLog");
        if (!container) return;
        container.innerHTML = "";
        if (!reportSemRows.length) {
            container.innerHTML = '<div class="text-muted">No report rows to display.</div>';
            return;
        }

        var totalRows = reportSemRows.length;
        var totalPages = Math.max(1, Math.ceil(totalRows / reportSemPageSize));
        if (reportSemPage > totalPages) reportSemPage = totalPages;
        if (reportSemPage < 1) reportSemPage = 1;

        var startIndex = (reportSemPage - 1) * reportSemPageSize;
        var endIndex = Math.min(startIndex + reportSemPageSize, totalRows);
        var visibleRows = reportSemRows.slice(startIndex, endIndex);

        var html = '';
        html += '<div class="table-container">';
        html += '<table class="table">';
        html += '<thead><tr>';
        html += '<th>OrgUnitId</th>';
        html += '<th>OrgUnitName</th>';
        html += '<th>OrgUnitCode</th>';
        html += '<th>Module Exists</th>';
        html += '<th>Module Name Match Count</th>';
        html += '</tr></thead><tbody>';

        for (var i = 0; i < visibleRows.length; i += 1) {
            var row = visibleRows[i];
            html += '<tr>';
            html += '<td>' + escapeHtml(row.OrgUnitId) + '</td>';
            html += '<td>' + escapeHtml(row.OrgUnitName) + '</td>';
            html += '<td>' + escapeHtml(row.OrgUnitCode) + '</td>';
            html += '<td>' + (row.ModuleExists ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-warning">No</span>') + '</td>';
            html += '<td>' + escapeHtml(row.ModuleNameMatchCount) + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        html += '<div class="form-actions" style="justify-content:space-between; align-items:center;">';
        html += '<span class="text-muted text-sm">Showing ' + (startIndex + 1) + '-' + endIndex + ' of ' + totalRows + '</span>';
        html += '<div class="form-actions" style="margin-top:0;">';
        html += '<button class="btn btn-outline btn-sm report-sem-page-btn" data-page="' + (reportSemPage - 1) + '" ' + (reportSemPage <= 1 ? 'disabled' : '') + '>Prev</button>';
        html += '<span class="text-sm" style="padding:6px 8px;">Page ' + reportSemPage + ' of ' + totalPages + '</span>';
        html += '<button class="btn btn-outline btn-sm report-sem-page-btn" data-page="' + (reportSemPage + 1) + '" ' + (reportSemPage >= totalPages ? 'disabled' : '') + '>Next</button>';
        html += '</div></div>';

        container.innerHTML = html;

        Array.prototype.slice.call(container.querySelectorAll(".report-sem-page-btn")).forEach(function (btn) {
            btn.addEventListener("click", function () {
                var targetPage = Number(btn.getAttribute("data-page"));
                if (!isNaN(targetPage)) {
                    reportSemPage = targetPage;
                    renderReportSemTable();
                }
            });
        });
    }
    function parseCsvTargets(csvText) {
        var lines = csvText.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
        if (!lines.length) return [];
        var firstRow = lines[0].split(/,|;|\t/).map(function (v) { return v.trim().toLowerCase(); });
        var hasHeader = firstRow.some(function (h) { return ["orgunitid", "targetorgunitid", "target"].indexOf(h) !== -1; });
        var ids = [];
        if (hasHeader) {
            var idx = firstRow.findIndex(function (h) { return ["orgunitid", "targetorgunitid", "target"].indexOf(h) !== -1; });
            for (var i = 1; i < lines.length; i += 1) {
                var parts = lines[i].split(/,|;|\t/);
                var raw = ((parts[idx] || "").trim()).replace(/^\$/, "");
                if (/^\d+$/.test(raw)) ids.push(raw);
            }
        } else {
            lines.forEach(function (line) {
                var raw = line.replace(/^\$/, "").trim();
                if (/^\d+$/.test(raw)) ids.push(raw);
            });
        }
        return ids.filter(function (id, index, arr) { return arr.indexOf(id) === index; });
    }
    function validOrgUnit(id) { return /^\d+$/.test(String(id || "").trim()); }
    function getSourceModuleId(selectId) {
        var value = byId(selectId).value;
        return validOrgUnit(value) ? value : null;
    }
    function populateModules(selectId, modules) {
        var sel = byId(selectId);
        sel.innerHTML = "";
        if (!modules.length) {
            sel.innerHTML = '<option value="">No modules found</option>';
            return;
        }
        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select module";
        sel.appendChild(placeholder);
        modules.forEach(function (m) {
            var opt = document.createElement("option");
            opt.value = String(m.Id);
            opt.textContent = m.Title + " (" + m.Id + ")";
            sel.appendChild(opt);
        });
    }
    async function getOrgUnitInfo(ouId) {
        return await d2lFetch("/d2l/api/lp/" + LP_VERSION + "/orgstructure/" + encodeURIComponent(ouId));
    }
    async function getOrganizationInfo() {
        return await d2lFetch("/d2l/api/lp/" + LP_VERSION + "/organization/info");
    }
    async function listRootModules(courseId) {
        return await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(courseId) + "/content/root/");
    }
    async function getModuleChildren(courseId, moduleId) {
        return await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(courseId) + "/content/modules/" + encodeURIComponent(moduleId) + "/structure/");
    }
    async function collectAllModules(courseId) {
        var roots = await listRootModules(courseId);
        var modules = [];
        async function walk(mod) {
            modules.push(mod);
            var children = await getModuleChildren(courseId, mod.Id);
            for (var i = 0; i < children.length; i += 1) if (children[i].Type === 0) await walk(children[i]);
        }
        for (var j = 0; j < roots.length; j += 1) await walk(roots[j]);
        return modules;
    }
    async function hydrateSourceCourse(courseInputId, infoId, moduleSelectIds) {
        var courseId = byId(courseInputId).value.trim();
        if (!validOrgUnit(courseId)) {
            byId(infoId).textContent = "";
            moduleSelectIds.forEach(function (id) { byId(id).innerHTML = '<option value="">Enter valid source course first</option>'; });
            return;
        }
        try {
            byId(infoId).textContent = "Loading course details...";
            var info = await getOrgUnitInfo(courseId);
            var code = info.Code || info.OrgUnitCode || "";
            var name = info.Name || info.OrgUnitName || "";
            byId(infoId).textContent = code ? (code + " - " + name) : name;
            var modules = await collectAllModules(courseId);
            moduleSelectIds.forEach(function (id) { populateModules(id, modules); });
        } catch (e) {
            byId(infoId).textContent = "Unable to load course/module details.";
            moduleSelectIds.forEach(function (id) { byId(id).innerHTML = '<option value="">Unable to load modules</option>'; });
        }
    }
    async function fetchOuDescendantsByType(parentOuId, ouTypeId) {
        var base = "/d2l/api/lp/" + LP_VERSION + "/orgstructure/" + encodeURIComponent(parentOuId) + "/descendants/?ouTypeId=" + encodeURIComponent(ouTypeId);
        var all = [];
        var nextUrl = base;
        while (nextUrl) {
            var page = await d2lFetch(nextUrl);
            var items = [];
            if (Array.isArray(page)) items = page;
            else if (Array.isArray(page.Items)) items = page.Items;
            else if (Array.isArray(page.Objects)) items = page.Objects;
            all = all.concat(items);
            if (page.NextPageUrl) nextUrl = page.NextPageUrl.replace(window.location.origin, "");
            else if (page.Next) nextUrl = base + "&bookmark=" + encodeURIComponent(page.Next);
            else nextUrl = null;
        }
        return all;
    }
    function filterOutMergedAndCxld(offerings) {
        return offerings.filter(function (o) {
            var name = String(o.Name || "").toUpperCase();
            var code = String(o.Code || "").toUpperCase();
            return !name.includes("MERGED") && !code.includes("CXLD");
        });
    }
    async function loadSemestersInto(selectIds) {
        if (!orgIdentifier) {
            var org = await getOrganizationInfo();
            orgIdentifier = org.Identifier;
        }
        var semesters = await fetchOuDescendantsByType(orgIdentifier, 5);
        // Restrict to the canonical allowlist (see js/semester-config.js)
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            semesters = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(semesters));
        } else {
            semesters.sort(function (a, b) { return String(b.Name || "").localeCompare(String(a.Name || "")); });
        }
        selectIds.forEach(function (id) {
            var sel = byId(id);
            if (!sel) return;
            sel.innerHTML = '<option value="">Select semester</option>';
            semesters.forEach(function (s) {
                var opt = document.createElement("option");
                opt.value = String(s.Identifier || s.Id);
                opt.textContent = (s.Name || "Semester") + " (" + (s.Identifier || s.Id) + ")";
                sel.appendChild(opt);
            });
        });
    }
    async function getSourceModule(sourceCourseId, sourceModuleId) {
        return await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(sourceCourseId) + "/content/modules/" + encodeURIComponent(sourceModuleId));
    }
    async function getModuleById(courseId, moduleId) {
        return await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(courseId) + "/content/modules/" + encodeURIComponent(moduleId));
    }
    function toRichTextInput(description) {
        if (!description) return null;
        if (typeof description.Content === "string" && typeof description.Type === "string") {
            return {
                Content: description.Content,
                Type: description.Type
            };
        }
        if (typeof description.Html === "string") {
            return {
                Content: description.Html,
                Type: "Html"
            };
        }
        if (typeof description.Text === "string") {
            return {
                Content: description.Text,
                Type: "Text"
            };
        }
        return null;
    }
    async function updateModule(courseId, module) {
        return await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(courseId) + "/content/modules/" + encodeURIComponent(module.Id), {
            method: "PUT",
            body: JSON.stringify({
                Title: module.Title,
                ShortTitle: module.ShortTitle || "",
                Type: 0,
                ModuleStartDate: module.ModuleStartDate || null,
                ModuleEndDate: module.ModuleEndDate || null,
                ModuleDueDate: module.ModuleDueDate || null,
                IsHidden: Boolean(module.IsHidden),
                IsLocked: Boolean(module.IsLocked),
                Description: toRichTextInput(module.Description),
                Duration: module.Duration == null ? null : module.Duration
            })
        });
    }
    async function startCopyJob(sourceCourseId, targetCourseId) {
        return await d2lFetch("/d2l/api/le/" + LE_VERSION + "/import/" + encodeURIComponent(targetCourseId) + "/copy/", {
            method: "POST",
            body: JSON.stringify({ SourceOrgUnitId: Number(sourceCourseId), Components: COPY_COMPONENTS })
        });
    }
    async function pollCopyJob(targetCourseId, jobToken) {
        var url = "/d2l/api/le/" + LE_VERSION + "/import/" + encodeURIComponent(targetCourseId) + "/copy/" + encodeURIComponent(jobToken);
        while (true) {
            var data = await d2lFetch(url);
            var status = String((data && data.Status) || "UNKNOWN").toUpperCase();
            if (status === "COMPLETE" || status === "COMPLETED") return;
            if (status === "FAILED" || status === "CANCELLED" || status === "CANCELED") throw new Error("Copy status " + status);
            await sleep(2000);
        }
    }
    async function findModuleByTitle(courseId, targetTitle) {
        var roots = await listRootModules(courseId);
        var queue = roots.slice();
        while (queue.length) {
            var mod = queue.shift();
            if (normalizeTitle(mod.Title) === normalizeTitle(targetTitle)) return mod;
            var children = await getModuleChildren(courseId, mod.Id);
            for (var i = 0; i < children.length; i += 1) if (children[i].Type === 0) queue.push(children[i]);
        }
        return null;
    }
    async function findModulesByTitle(courseId, targetTitle) {
        var roots = await listRootModules(courseId);
        var queue = roots.slice();
        var matches = [];
        while (queue.length) {
            var mod = queue.shift();
            if (normalizeTitle(mod.Title) === normalizeTitle(targetTitle)) matches.push(mod);
            var children = await getModuleChildren(courseId, mod.Id);
            for (var i = 0; i < children.length; i += 1) if (children[i].Type === 0) queue.push(children[i]);
        }
        return matches;
    }
    async function copyModuleToTargets(sourceCourseId, sourceModuleId, targets, logId, options) {
        var opts = options || {};
        var concurrency = Number(opts.concurrency || 1);
        if (!Number.isFinite(concurrency) || concurrency < 1) concurrency = 1;
        concurrency = Math.floor(concurrency);

        var sourceModule = await getSourceModule(sourceCourseId, sourceModuleId);
        log(logId, "ok", "Source module: " + sourceModule.Title + " (Hidden=true enforced; preserving target description/header image)");
        if (concurrency > 1) {
            log(logId, "run", "Parallel copy enabled with " + concurrency + " worker(s).");
        }

        var okCount = 0;
        async function processOneTarget(targetId, idx) {
            log(logId, "run", "Target " + (idx + 1) + "/" + targets.length + ": " + targetId);
            try {
                var copyJob = await startCopyJob(sourceCourseId, targetId);
                if (!copyJob || !copyJob.JobToken) throw new Error("No JobToken returned");
                await pollCopyJob(targetId, copyJob.JobToken);
                var targetModules = await findModulesByTitle(targetId, sourceModule.Title);
                if (!targetModules.length) {
                    log(logId, "run", "No module title match found in target " + targetId + " after copy.");
                } else {
                    for (var m = 0; m < targetModules.length; m += 1) {
                        var targetModuleStub = targetModules[m];
                        var targetModule = await getModuleById(targetId, targetModuleStub.Id);
                        targetModule.IsHidden = true;
                        targetModule.IsLocked = sourceModule.IsLocked;
                        targetModule.ModuleStartDate = sourceModule.ModuleStartDate;
                        targetModule.ModuleEndDate = sourceModule.ModuleEndDate;
                        targetModule.ModuleDueDate = sourceModule.ModuleDueDate;
                        await updateModule(targetId, targetModule);
                    }
                    log(logId, "run", "Note: Brightspace API cannot reliably reorder existing module structure via module update; copied modules may remain in appended position.");
                }
                return {
                    ok: true,
                    targetId: targetId,
                    matchCount: targetModules.length
                };
            } catch (e) {
                return {
                    ok: false,
                    targetId: targetId,
                    error: (e && e.message) ? e.message : "unknown error"
                };
            }
        }

        if (concurrency === 1) {
            for (var i = 0; i < targets.length; i += 1) {
                var sequentialResult = await processOneTarget(targets[i], i);
                if (sequentialResult.ok) {
                    okCount += 1;
                    log(logId, "ok", "Completed target " + sequentialResult.targetId + " (hidden=true enforced on " + sequentialResult.matchCount + " matching module(s)).");
                } else {
                    log(logId, "fail", "Failed target " + sequentialResult.targetId + " - " + sequentialResult.error);
                }
            }
        } else {
            var currentConcurrency = Math.min(concurrency, targets.length);
            var maxConcurrency = currentConcurrency;
            var idxCursor = 0;
            var stableWaves = 0;

            log(logId, "run", "Auto-throttle enabled. Starting at " + currentConcurrency + " worker(s).");

            while (idxCursor < targets.length) {
                var waveStart = idxCursor;
                var waveEnd = Math.min(idxCursor + currentConcurrency, targets.length);
                var waveTargets = [];
                for (var wi = waveStart; wi < waveEnd; wi += 1) waveTargets.push({ idx: wi, targetId: targets[wi] });

                var wavePromises = waveTargets.map(function (item) {
                    return processOneTarget(item.targetId, item.idx);
                });
                var waveResults = await Promise.all(wavePromises);

                var waveFailures = 0;
                var waveRateLimited = 0;
                for (var wr = 0; wr < waveResults.length; wr += 1) {
                    var result = waveResults[wr];
                    if (result.ok) {
                        okCount += 1;
                        log(logId, "ok", "Completed target " + result.targetId + " (hidden=true enforced on " + result.matchCount + " matching module(s)).");
                    } else {
                        waveFailures += 1;
                        var errText = String(result.error || "");
                        if (/429|rate|throttl/i.test(errText)) waveRateLimited += 1;
                        log(logId, "fail", "Failed target " + result.targetId + " - " + errText);
                    }
                }

                // Auto-throttle down on heavy failure/rate-limit signal.
                if (waveRateLimited > 0 || waveFailures >= Math.max(2, Math.ceil(waveResults.length / 2))) {
                    var newConcurrency = Math.max(1, currentConcurrency - 1);
                    if (newConcurrency !== currentConcurrency) {
                        currentConcurrency = newConcurrency;
                        stableWaves = 0;
                        log(logId, "run", "Auto-throttle: reducing workers to " + currentConcurrency + " after wave failures.");
                    }
                } else if (waveFailures === 0) {
                    // Ramp back up slowly after stable waves.
                    stableWaves += 1;
                    if (stableWaves >= 2 && currentConcurrency < maxConcurrency) {
                        currentConcurrency += 1;
                        stableWaves = 0;
                        log(logId, "run", "Auto-throttle: increasing workers to " + currentConcurrency + " after stable waves.");
                    }
                } else {
                    stableWaves = 0;
                }

                idxCursor = waveEnd;
            }
        }

        log(logId, "ok", "Finished " + okCount + "/" + targets.length);
    }
    function topicPayload(topic) {
        return {
            Title: topic.Title,
            ShortTitle: topic.ShortTitle || "",
            Type: 1,
            TopicType: topic.TopicType,
            Url: topic.Url || "",
            StartDate: topic.StartDate || null,
            EndDate: topic.EndDate || null,
            DueDate: topic.DueDate || null,
            IsHidden: Boolean(topic.IsHidden),
            IsLocked: Boolean(topic.IsLocked),
            OpenAsExternalResource: topic.TopicType === 3 ? Boolean(topic.OpenAsExternalResource) : null,
            Description: topic.Description || null,
            Duration: topic.Duration == null ? null : topic.Duration
        };
    }
    async function updateTopic(courseId, topic) {
        return await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(courseId) + "/content/topics/" + encodeURIComponent(topic.Id), {
            method: "PUT",
            body: JSON.stringify(topicPayload(topic))
        });
    }
    async function createTopicUnderModule(courseId, moduleId, topic) {
        return await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(courseId) + "/content/modules/" + encodeURIComponent(moduleId) + "/structure/", {
            method: "POST",
            body: JSON.stringify(topicPayload(topic))
        });
    }
    async function collectTopicsRecursive(courseId, moduleId, pathLabel, sink) {
        var children = await getModuleChildren(courseId, moduleId);
        for (var i = 0; i < children.length; i += 1) {
            var item = children[i];
            if (item.Type === 1) {
                sink.push({
                    Id: item.Id, ParentModuleId: moduleId, Title: item.Title, ShortTitle: item.ShortTitle || "", TopicType: item.TopicType,
                    Url: item.Url || "", StartDate: item.StartDate || null, EndDate: item.EndDate || null, DueDate: item.DueDate || null,
                    IsHidden: item.IsHidden, IsLocked: item.IsLocked, OpenAsExternalResource: item.OpenAsExternalResource,
                    Description: item.Description || null, Duration: item.Duration == null ? null : item.Duration, Path: pathLabel
                });
            } else if (item.Type === 0) {
                await collectTopicsRecursive(courseId, item.Id, pathLabel + " / " + item.Title, sink);
            }
        }
    }
    async function listTopicsInModule(courseId, moduleId) {
        var list = [];
        await collectTopicsRecursive(courseId, moduleId, "Module " + moduleId, list);
        return list;
    }
    function renderTopicSelector(items) {
        var box = byId("topicsList");
        box.innerHTML = "";
        if (!items.length) {
            box.textContent = "No topics found.";
            return;
        }
        box.className = "module-list";
        items.forEach(function (topic, index) {
            var row = document.createElement("label");
            row.className = "module-link";
            var check = document.createElement("input");
            check.type = "checkbox";
            check.className = "topic-check";
            check.value = String(index);
            check.style.marginRight = "8px";
            var wrap = document.createElement("div");
            var title = document.createElement("div");
            title.textContent = topic.Title + " (Type " + topic.TopicType + ")";
            var meta = document.createElement("div");
            meta.className = "text-xs text-muted";
            meta.textContent = topic.Path + (topic.TopicType === 3 ? " | External/Link" : "");
            wrap.appendChild(title);
            wrap.appendChild(meta);
            row.appendChild(check);
            row.appendChild(wrap);
            box.appendChild(row);
        });
    }
    function selectedTopicIndexes() {
        return Array.prototype.slice.call(document.querySelectorAll(".topic-check:checked")).map(function (el) { return Number(el.value); });
    }
    async function resolveTargets(semesterSelectId, csvInputId, excludeId) {
        var targets = [];
        var semesterId = byId(semesterSelectId) ? byId(semesterSelectId).value : "";
        if (validOrgUnit(semesterId)) {
            var offerings = await fetchOuDescendantsByType(semesterId, 3);
            targets = targets.concat(filterOutMergedAndCxld(offerings).map(function (o) { return String(o.Identifier || o.Id); }));
        }
        var fileInput = byId(csvInputId);
        if (fileInput && fileInput.files && fileInput.files[0]) {
            targets = targets.concat(parseCsvTargets(await fileInput.files[0].text()));
        }
        targets = targets.filter(function (id, idx, arr) { return arr.indexOf(id) === idx; });
        if (excludeId) targets = targets.filter(function (id) { return id !== excludeId; });
        return targets;
    }
    function bindSourceCourseLookup(courseInputId, infoId, moduleSelectIds) {
        byId(courseInputId).addEventListener("change", function () {
            hydrateSourceCourse(courseInputId, infoId, moduleSelectIds);
        });
        byId(courseInputId).addEventListener("blur", function () {
            hydrateSourceCourse(courseInputId, infoId, moduleSelectIds);
        });
    }
    async function runAutoThrottleQueue(items, initialConcurrency, processFn, onAdjust) {
        var currentConcurrency = Math.max(1, Math.min(Number(initialConcurrency) || 1, items.length || 1));
        var maxConcurrency = currentConcurrency;
        var idxCursor = 0;
        var stableWaves = 0;
        var allResults = [];

        while (idxCursor < items.length) {
            var waveStart = idxCursor;
            var waveEnd = Math.min(idxCursor + currentConcurrency, items.length);
            var waveItems = [];
            for (var wi = waveStart; wi < waveEnd; wi += 1) waveItems.push(items[wi]);
            var waveResults = await Promise.all(waveItems.map(processFn));
            allResults = allResults.concat(waveResults);

            var waveFailures = 0;
            var waveRateLimited = 0;
            for (var wr = 0; wr < waveResults.length; wr += 1) {
                if (!waveResults[wr] || !waveResults[wr].ok) {
                    waveFailures += 1;
                    var errText = String(waveResults[wr] && waveResults[wr].error ? waveResults[wr].error : "");
                    if (/429|rate|throttl/i.test(errText)) waveRateLimited += 1;
                }
            }

            if (waveRateLimited > 0 || waveFailures >= Math.max(2, Math.ceil(waveResults.length / 2))) {
                var lowered = Math.max(1, currentConcurrency - 1);
                if (lowered !== currentConcurrency) {
                    currentConcurrency = lowered;
                    stableWaves = 0;
                    if (onAdjust) onAdjust(currentConcurrency, "down");
                }
            } else if (waveFailures === 0) {
                stableWaves += 1;
                if (stableWaves >= 2 && currentConcurrency < maxConcurrency) {
                    currentConcurrency += 1;
                    stableWaves = 0;
                    if (onAdjust) onAdjust(currentConcurrency, "up");
                }
            } else {
                stableWaves = 0;
            }

            idxCursor = waveEnd;
        }

        return allResults;
    }
    function tabInit() {
        var buttons = Array.prototype.slice.call(document.querySelectorAll(".tab-btn"));
        var panels = Array.prototype.slice.call(document.querySelectorAll(".tab-panel"));
        var tabMeta = {
            "tab-csv": {
                title: "CSV Copy",
                subtitle: "Copy source module components to a list of target courses via CSV."
            },
            "tab-semester": {
                title: "Semester Copy",
                subtitle: "Copy source module components to all eligible courses in a selected semester."
            },
            "tab-topics": {
                title: "Push Topic Changes",
                subtitle: "Select changed topics from the source module and push updates to semester/CSV targets."
            },
            "tab-report-sem": {
                title: "Module Presence Report",
                subtitle: "List all eligible courses in a semester that contain the selected source module name."
            },
            "tab-delete-sem": {
                title: "Delete Module by Semester",
                subtitle: "Delete the source-matched module name from all eligible semester courses."
            },
            "tab-delete-csv": {
                title: "Delete Module by CSV",
                subtitle: "Delete the source-matched module name from target courses listed in CSV."
            }
        };

        function setActive(tabId) {
            buttons.forEach(function (b) {
                var isActiveBtn = b.getAttribute("data-tab") === tabId;
                if (isActiveBtn) {
                    b.classList.add("active");
                    b.classList.add("btn-primary");
                    b.classList.remove("btn-outline");
                } else {
                    b.classList.remove("active");
                    b.classList.remove("btn-primary");
                    b.classList.add("btn-outline");
                }
            });
            panels.forEach(function (p) {
                var isActive = p.id === tabId;
                if (isActive) p.classList.add("active");
                else p.classList.remove("active");
                p.hidden = !isActive;
            });

            var tabTitle = byId("activeTabTitle");
            var tabSubtitle = byId("activeTabSubtitle");
            var meta = tabMeta[tabId];
            if (tabTitle && tabSubtitle && meta) {
                tabTitle.textContent = meta.title;
                tabSubtitle.textContent = meta.subtitle;
            }
        }

        buttons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                var id = btn.getAttribute("data-tab");
                setActive(id);
            });
        });

        var initial = null;
        for (var i = 0; i < buttons.length; i += 1) {
            if (buttons[i].classList.contains("active")) {
                initial = buttons[i];
                break;
            }
        }
        if (!initial && buttons.length) initial = buttons[0];
        if (initial) setActive(initial.getAttribute("data-tab"));
    }

    byId("csvRunBtn").addEventListener("click", async function () {
        var sourceCourseId = byId("csvSourceCourseId").value.trim();
        var sourceModuleId = getSourceModuleId("csvSourceModuleSelect");
        var file = byId("csvTargetsFile").files && byId("csvTargetsFile").files[0];
        clearLog("csvLog");
        if (!validOrgUnit(sourceCourseId) || !sourceModuleId || !file) {
            log("csvLog", "fail", "Provide source course, source module, and target CSV.");
            setCsvStatus("Provide source course, source module, and target CSV.");
            return;
        }
        byId("csvBusy").hidden = false; byId("csvRunBtn").disabled = true;
        setCsvStatus("Starting CSV copy...");
        try {
            var targets = parseCsvTargets(await file.text()).filter(function (id) { return id !== sourceCourseId; });
            if (!targets.length) throw new Error("No valid targets in CSV.");
            await copyModuleToTargets(sourceCourseId, sourceModuleId, targets, "csvLog");
            setCsvStatus("Completed CSV copy for " + targets.length + " target(s).");
        } catch (err) {
            log("csvLog", "fail", err.message || String(err));
            setCsvStatus(err.message || String(err));
        } finally {
            byId("csvBusy").hidden = true; byId("csvRunBtn").disabled = false;
        }
    });
    byId("csvResetBtn").addEventListener("click", function () {
        byId("csvSourceCourseId").value = "";
        byId("csvSourceModuleSelect").innerHTML = '<option value="">Select source course first</option>';
        byId("csvSourceInfo").textContent = "";
        byId("csvTargetsFile").value = "";
        clearLog("csvLog");
        setCsvStatus("Ready.");
    });

    byId("semLoadBtn").addEventListener("click", async function () {
        clearLog("semLog");
        var semesterId = byId("semesterSelect").value;
        if (!validOrgUnit(semesterId)) {
            log("semLog", "fail", "Select a semester.");
            setSemStatus("Select a semester.");
            return;
        }
        try {
            var offerings = await fetchOuDescendantsByType(semesterId, 3);
            var targets = filterOutMergedAndCxld(offerings);
            log("semLog", "ok", "Semester preview: " + targets.length + " eligible offerings (MERGED/CXLD skipped).");
            setSemStatus("Preview loaded: " + targets.length + " eligible offerings.");
        } catch (e) {
            log("semLog", "fail", e.message || String(e));
            setSemStatus(e.message || String(e));
        }
    });
    byId("semRunBtn").addEventListener("click", async function () {
        clearLog("semLog");
        var sourceCourseId = byId("semSourceCourseId").value.trim();
        var sourceModuleId = getSourceModuleId("semSourceModuleSelect");
        var semesterId = byId("semesterSelect").value;
        var semParallel = Number(byId("semParallelSelect").value || "1");
        if (!validOrgUnit(sourceCourseId) || !sourceModuleId || !validOrgUnit(semesterId)) {
            log("semLog", "fail", "Provide source course/module and select semester.");
            setSemStatus("Provide source course/module and select semester.");
            return;
        }
        byId("semBusy").hidden = false; byId("semRunBtn").disabled = true;
        setSemStatus("Starting semester copy...");
        try {
            var offerings = await fetchOuDescendantsByType(semesterId, 3);
            var targets = filterOutMergedAndCxld(offerings).map(function (o) { return String(o.Identifier || o.Id); }).filter(function (id) { return id !== sourceCourseId; });
            if (!targets.length) throw new Error("No eligible semester targets.");
            await copyModuleToTargets(sourceCourseId, sourceModuleId, targets, "semLog", { concurrency: semParallel });
            setSemStatus("Completed semester copy for " + targets.length + " target(s).");
        } catch (e) {
            log("semLog", "fail", e.message || String(e));
            setSemStatus(e.message || String(e));
        } finally {
            byId("semBusy").hidden = true; byId("semRunBtn").disabled = false;
        }
    });

    byId("loadTopicsBtn").addEventListener("click", async function () {
        clearLog("topicLog");
        var sourceCourseId = byId("topicSourceCourseId").value.trim();
        var sourceModuleId = getSourceModuleId("topicSourceModuleSelect");
        if (!validOrgUnit(sourceCourseId) || !sourceModuleId) {
            log("topicLog", "fail", "Provide source course and source module.");
            setTopicStatus("Provide source course and source module.");
            return;
        }
        setTopicStatus("Loading source topics...");
        try {
            cachedTopicSourceModule = await getSourceModule(sourceCourseId, sourceModuleId);
            topicCache = await listTopicsInModule(sourceCourseId, sourceModuleId);
            renderTopicSelector(topicCache);
            log("topicLog", "ok", "Loaded " + topicCache.length + " topics from source module.");
            setTopicStatus("Loaded " + topicCache.length + " topics from source module.");
        } catch (e) {
            log("topicLog", "fail", e.message || String(e));
            setTopicStatus(e.message || String(e));
        }
    });
    byId("selectAllTopicsBtn").addEventListener("click", function () {
        Array.prototype.slice.call(document.querySelectorAll(".topic-check")).forEach(function (el) { el.checked = true; });
    });
    byId("selectNoTopicsBtn").addEventListener("click", function () {
        Array.prototype.slice.call(document.querySelectorAll(".topic-check")).forEach(function (el) { el.checked = false; });
    });
    byId("pushTopicsBtn").addEventListener("click", async function () {
        clearLog("topicLog");
        var sourceCourseId = byId("topicSourceCourseId").value.trim();
        var selected = selectedTopicIndexes();
        if (!validOrgUnit(sourceCourseId) || !cachedTopicSourceModule) {
            log("topicLog", "fail", "Load source module topics first.");
            setTopicStatus("Load source module topics first.");
            return;
        }
        if (!selected.length) {
            log("topicLog", "fail", "Select at least one topic.");
            setTopicStatus("Select at least one topic.");
            return;
        }
        byId("topicBusy").hidden = false; byId("pushTopicsBtn").disabled = true;
        setTopicStatus("Starting topic push...");
        try {
            var targets = await resolveTargets("topicSemesterSelect", "topicTargetsCsv", sourceCourseId);
            if (!targets.length) throw new Error("No targets resolved from semester/CSV.");
            var chosen = selected.map(function (i) { return topicCache[i]; });
            var okCount = 0;
            for (var i = 0; i < targets.length; i += 1) {
                var courseId = targets[i];
                try {
                    var targetModule = await findModuleByTitle(courseId, cachedTopicSourceModule.Title);
                    if (!targetModule) { log("topicLog", "run", "Target " + courseId + " skipped (module not found)."); continue; }
                    var targetTopics = await listTopicsInModule(courseId, targetModule.Id);
                    var topicByTitle = {};
                    targetTopics.forEach(function (t) { topicByTitle[normalizeTitle(t.Title)] = t; });
                    for (var j = 0; j < chosen.length; j += 1) {
                        var src = Object.assign({}, chosen[j]);
                        var existing = topicByTitle[normalizeTitle(src.Title)];
                        if (existing) {
                            src.Id = existing.Id;
                            await updateTopic(courseId, src);
                        } else if (src.TopicType === 1 || src.TopicType === 3) {
                            await createTopicUnderModule(courseId, targetModule.Id, src);
                        } else {
                            log("topicLog", "run", "Target " + courseId + ": skipped '" + src.Title + "' (unsupported create type " + src.TopicType + ").");
                        }
                    }
                    okCount += 1;
                    log("topicLog", "ok", "Updated target " + courseId);
                } catch (e) {
                    log("topicLog", "fail", "Target " + courseId + " failed: " + (e.message || "error"));
                }
            }
            log("topicLog", "ok", "Topic push finished " + okCount + "/" + targets.length);
            setTopicStatus("Topic push finished " + okCount + "/" + targets.length + ".");
        } catch (e) {
            log("topicLog", "fail", e.message || String(e));
            setTopicStatus(e.message || String(e));
        } finally {
            byId("topicBusy").hidden = true; byId("pushTopicsBtn").disabled = false;
        }
    });

    byId("runReportSemBtn").addEventListener("click", async function () {
        byId("reportSemLog").innerHTML = "";
        reportSemRows = [];
        reportSemPage = 1;
        var runBtn = byId("runReportSemBtn");
        var originalRunBtnHtml = runBtn.innerHTML;
        var sourceCourseId = byId("reportSourceCourseId").value.trim();
        var sourceModuleId = getSourceModuleId("reportSourceModuleSelect");
        var semesterId = byId("reportSemesterSelect").value;
        var reportParallel = Number(byId("reportParallelSelect").value || "1");
        if (!validOrgUnit(sourceCourseId) || !sourceModuleId || !validOrgUnit(semesterId)) {
            setReportSemStatus("Provide source course/module and select semester.");
            return;
        }

        byId("reportSemBusy").hidden = false;
        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running...';
        byId("downloadReportSemBtn").disabled = true;
        try {
            var sourceModule = await getSourceModule(sourceCourseId, sourceModuleId);
            var targetName = sourceModule.Title;
            var offerings = await fetchOuDescendantsByType(semesterId, 3);
            var eligible = filterOutMergedAndCxld(offerings);
            var workItems = eligible
                .map(function (course) {
                    return {
                        course: course,
                        courseId: String(course.Identifier || course.Id || "")
                    };
                })
                .filter(function (item) { return item.courseId && item.courseId !== sourceCourseId; });

            setReportSemStatus("Starting check for " + workItems.length + " eligible course(s) using " + reportParallel + " worker(s)...");
            var processedCount = 0;
            var foundCount = 0;

            var results = await runAutoThrottleQueue(workItems, reportParallel, async function (item) {
                var course = item.course;
                var courseId = item.courseId;
                var courseLabel = (course.Code ? course.Code + " - " : "") + (course.Name || courseId);
                try {
                    var matches = await findModulesByTitle(courseId, targetName);
                    var matchCount = matches.length;
                    var exists = matchCount > 0;
                    return {
                        ok: true,
                        row: {
                            OrgUnitId: courseId,
                            OrgUnitName: course.Name || "",
                            OrgUnitCode: course.Code || "",
                            ModuleExists: exists,
                            ModuleNameMatchCount: matchCount
                        },
                        found: exists ? 1 : 0,
                        label: courseLabel
                    };
                } catch (e) {
                    return {
                        ok: false,
                        row: {
                            OrgUnitId: courseId,
                            OrgUnitName: course.Name || "",
                            OrgUnitCode: course.Code || "",
                            ModuleExists: false,
                            ModuleNameMatchCount: 0
                        },
                        found: 0,
                        label: courseLabel,
                        error: (e && e.message) ? e.message : "unknown error"
                    };
                } finally {
                    processedCount += 1;
                    if (processedCount % 10 === 0) {
                        setReportSemStatus("Checking " + processedCount + " / " + workItems.length + " | Found: " + foundCount);
                    }
                }
            }, function (newConcurrency, direction) {
                setReportSemStatus("Auto-throttle " + (direction === "down" ? "reduced" : "increased") + " workers to " + newConcurrency + ".");
            });

            for (var ri = 0; ri < results.length; ri += 1) {
                var result = results[ri];
                reportSemRows.push(result.row);
                foundCount += result.found;
            }

            renderReportSemTable();
            byId("downloadReportSemBtn").disabled = reportSemRows.length === 0;
            setReportSemStatus("Report complete. Found module in " + foundCount + " of " + reportSemRows.length + " course(s).");
        } catch (e) {
            setReportSemStatus(e.message || String(e));
        } finally {
            byId("reportSemBusy").hidden = true;
            runBtn.disabled = false;
            runBtn.innerHTML = originalRunBtnHtml;
        }
    });
    byId("downloadReportSemBtn").addEventListener("click", function () {
        downloadReportSemCsv();
    });
    byId("downloadCsvLogBtn").addEventListener("click", function () { downloadOperationLogCsv("csvLog"); });
    byId("downloadSemLogBtn").addEventListener("click", function () { downloadOperationLogCsv("semLog"); });
    byId("downloadTopicLogBtn").addEventListener("click", function () { downloadOperationLogCsv("topicLog"); });
    byId("downloadDelSemLogBtn").addEventListener("click", function () { downloadOperationLogCsv("delSemLog"); });
    byId("downloadDelCsvLogBtn").addEventListener("click", function () { downloadOperationLogCsv("delCsvLog"); });

    async function deleteByTargets(sourceCourseId, sourceModuleId, targets, logId, onProgress) {
        var sourceModule = await getSourceModule(sourceCourseId, sourceModuleId);
        var deletedCount = 0;
        var deletedModuleCount = 0;
        var skippedCount = 0;
        var failedCount = 0;
        for (var i = 0; i < targets.length; i += 1) {
            var courseId = targets[i];
            try {
                var mods = await findModulesByTitle(courseId, sourceModule.Title);
                if (!mods.length) {
                    skippedCount += 1;
                    log(logId, "run", "Target " + courseId + ": module not found, skipped.");
                    if (onProgress) onProgress(i + 1, targets.length, deletedCount, skippedCount, failedCount, courseId);
                    continue;
                }
                for (var m = 0; m < mods.length; m += 1) {
                    await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(courseId) + "/content/modules/" + encodeURIComponent(mods[m].Id), { method: "DELETE" });
                }
                deletedCount += 1;
                deletedModuleCount += mods.length;
                log(logId, "ok", "Deleted " + mods.length + " matching module(s) in target " + courseId);
            } catch (e) {
                failedCount += 1;
                log(logId, "fail", "Target " + courseId + " failed: " + (e.message || "error"));
            }
            if (onProgress) onProgress(i + 1, targets.length, deletedCount, skippedCount, failedCount, courseId);
        }
        log(logId, "ok", "Delete run finished. Deleted " + deletedModuleCount + " module(s) across " + deletedCount + " course(s).");
    }
    byId("deleteSemModuleBtn").addEventListener("click", async function () {
        clearLog("delSemLog");
        var sourceCourseId = byId("delSemSourceCourseId").value.trim();
        var sourceModuleId = getSourceModuleId("delSemSourceModuleSelect");
        var semesterId = byId("delSemesterSelect").value;
        var delSemParallel = Number(byId("delSemParallelSelect").value || "1");
        if (!validOrgUnit(sourceCourseId) || !sourceModuleId || !validOrgUnit(semesterId)) {
            log("delSemLog", "fail", "Provide source and semester selections.");
            setDelSemStatus("Provide source and semester selections.");
            return;
        }
        byId("delSemBusy").hidden = false; byId("deleteSemModuleBtn").disabled = true;
        try {
            var offerings = await fetchOuDescendantsByType(semesterId, 3);
            var targets = filterOutMergedAndCxld(offerings).map(function (o) { return String(o.Identifier || o.Id); }).filter(function (id) { return id !== sourceCourseId; });
            var delSemBusyEl = byId("delSemBusy");
            delSemBusyEl.textContent = "Starting...";
            setDelSemStatus("Starting delete for " + targets.length + " eligible course(s)...");
            if (delSemParallel > 1) {
                log("delSemLog", "run", "Auto-throttle enabled. Starting delete with " + delSemParallel + " worker(s).");
                var sourceModule = await getSourceModule(sourceCourseId, sourceModuleId);
                var deleteItems = targets.map(function (t) { return { targetId: t }; });
                var processedCount = 0;
                var deletedCount = 0;
                var skippedCount = 0;
                var failedCount = 0;
                await runAutoThrottleQueue(deleteItems, delSemParallel, async function (item) {
                    var courseId = item.targetId;
                    try {
                        var mods = await findModulesByTitle(courseId, sourceModule.Title);
                        if (!mods.length) return { ok: true, skipped: true, deletedModules: 0, targetId: courseId };
                        for (var dm = 0; dm < mods.length; dm += 1) {
                            await d2lFetch("/d2l/api/le/" + LE_VERSION + "/" + encodeURIComponent(courseId) + "/content/modules/" + encodeURIComponent(mods[dm].Id), { method: "DELETE" });
                        }
                        return { ok: true, skipped: false, deletedModules: mods.length, targetId: courseId };
                    } catch (e) {
                        return { ok: false, deletedModules: 0, targetId: courseId, error: (e && e.message) ? e.message : "unknown error" };
                    } finally {
                        // Progress counter updates as each target finishes in parallel.
                        processedCount += 1;
                        delSemBusyEl.textContent = "Processed " + processedCount + " / " + targets.length + "...";
                        setDelSemStatus("Processing " + processedCount + " / " + targets.length + "...");
                    }
                }, function (newConcurrency, direction) {
                    log("delSemLog", "run", "Auto-throttle " + (direction === "down" ? "reduced" : "increased") + " workers to " + newConcurrency + ".");
                    setDelSemStatus("Auto-throttle " + (direction === "down" ? "reduced" : "increased") + " workers to " + newConcurrency + ".");
                }).then(function (results) {
                    var deletedModuleCount = 0;
                    for (var i = 0; i < results.length; i += 1) {
                        var result = results[i];
                        if (result.ok && result.skipped) {
                            skippedCount += 1;
                            log("delSemLog", "run", "Target " + result.targetId + ": module not found, skipped.");
                        }
                        else if (result.ok) {
                            deletedCount += 1;
                            deletedModuleCount += Number(result.deletedModules || 0);
                            log("delSemLog", "ok", "Deleted " + (result.deletedModules || 0) + " matching module(s) in target " + result.targetId);
                        } else {
                            failedCount += 1;
                            log("delSemLog", "fail", "Target " + result.targetId + " failed: " + result.error);
                        }
                    }
                    delSemBusyEl.textContent = "Processed " + processedCount + " / " + targets.length + " | Deleted: " + deletedCount + " | Skipped: " + skippedCount + " | Failed: " + failedCount;
                    setDelSemStatus("Processed " + processedCount + " / " + targets.length + " | Deleted: " + deletedCount + " | Skipped: " + skippedCount + " | Failed: " + failedCount);
                    log("delSemLog", "ok", "Delete run finished. Deleted " + deletedModuleCount + " module(s) across " + deletedCount + " course(s).");
                });
            } else {
                await deleteByTargets(sourceCourseId, sourceModuleId, targets, "delSemLog", function (processed, total, deleted, skipped, failed) {
                    delSemBusyEl.textContent = "Processed " + processed + " / " + total + " | Deleted: " + deleted + " | Skipped: " + skipped + " | Failed: " + failed;
                    setDelSemStatus("Processed " + processed + " / " + total + " | Deleted: " + deleted + " | Skipped: " + skipped + " | Failed: " + failed);
                });
            }
        } catch (e) {
            log("delSemLog", "fail", e.message || String(e));
            setDelSemStatus(e.message || String(e));
        } finally {
            byId("delSemBusy").hidden = true; byId("deleteSemModuleBtn").disabled = false;
        }
    });
    byId("deleteCsvModuleBtn").addEventListener("click", async function () {
        clearLog("delCsvLog");
        var sourceCourseId = byId("delCsvSourceCourseId").value.trim();
        var sourceModuleId = getSourceModuleId("delCsvSourceModuleSelect");
        var file = byId("delCsvTargetsFile").files && byId("delCsvTargetsFile").files[0];
        if (!validOrgUnit(sourceCourseId) || !sourceModuleId || !file) {
            log("delCsvLog", "fail", "Provide source course/module and target CSV.");
            setDelCsvStatus("Provide source course/module and target CSV.");
            return;
        }
        byId("delCsvBusy").hidden = false; byId("deleteCsvModuleBtn").disabled = true;
        setDelCsvStatus("Starting delete from CSV targets...");
        try {
            var targets = parseCsvTargets(await file.text()).filter(function (id) { return id !== sourceCourseId; });
            await deleteByTargets(sourceCourseId, sourceModuleId, targets, "delCsvLog");
            setDelCsvStatus("Delete from CSV complete for " + targets.length + " target(s).");
        } catch (e) {
            log("delCsvLog", "fail", e.message || String(e));
            setDelCsvStatus(e.message || String(e));
        } finally {
            byId("delCsvBusy").hidden = true; byId("deleteCsvModuleBtn").disabled = false;
        }
    });

    tabInit();
    bindSourceCourseLookup("csvSourceCourseId", "csvSourceInfo", ["csvSourceModuleSelect"]);
    bindSourceCourseLookup("semSourceCourseId", "semSourceInfo", ["semSourceModuleSelect"]);
    bindSourceCourseLookup("topicSourceCourseId", "topicSourceInfo", ["topicSourceModuleSelect"]);
    bindSourceCourseLookup("reportSourceCourseId", "reportSourceInfo", ["reportSourceModuleSelect"]);
    bindSourceCourseLookup("delSemSourceCourseId", "delSemSourceInfo", ["delSemSourceModuleSelect"]);
    bindSourceCourseLookup("delCsvSourceCourseId", "delCsvSourceInfo", ["delCsvSourceModuleSelect"]);
    loadSemestersInto(["semesterSelect", "topicSemesterSelect", "reportSemesterSelect", "delSemesterSelect"]).catch(function () {
        byId("semesterSelect").innerHTML = '<option value="">Unable to load semesters</option>';
        byId("topicSemesterSelect").innerHTML = '<option value="">Unable to load semesters</option>';
        byId("reportSemesterSelect").innerHTML = '<option value="">Unable to load semesters</option>';
        byId("delSemesterSelect").innerHTML = '<option value="">Unable to load semesters</option>';
    });

    clearLog("csvLog");
    setCsvStatus("Ready.");
    clearLog("semLog");
    setSemStatus("Ready.");
    clearLog("topicLog");
    setTopicStatus("Ready.");
    byId("reportSemLog").innerHTML = '<div class="text-muted">Run the report to see results.</div>';
    setReportSemStatus("Ready.");
    clearLog("delSemLog");
    setDelSemStatus("Ready.");
    clearLog("delCsvLog");
    setDelCsvStatus("Ready.");
})();
