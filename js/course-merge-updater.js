const LP_VERSION = "1.49";
const LE_VERSION = "1.75";

let semesterIdToShortCode = {};
let courseByCode = {};
let previewRows = [];
let updateLogRows = [];
let mergedAuditRows = [];

document.addEventListener("DOMContentLoaded", () => {
    const loadingContainer = LoadingUtils.createLoadingBar("loadingContainer");
    document.querySelector(".card").appendChild(loadingContainer);

    loadSemesters();
    document.getElementById("semesterSelect").addEventListener("change", onSemesterChange);
    document.getElementById("previewBtn").addEventListener("click", runPreview);
    document.getElementById("processBtn").addEventListener("click", processUpdates);
    document.getElementById("downloadLogBtn").addEventListener("click", downloadLogCsv);
    document.getElementById("previewMergedBtn").addEventListener("click", runMergedSemesterPreview);
    document.getElementById("processMergedBulkBtn").addEventListener("click", processMergedBulkUpdates);
    document.getElementById("resultsWrap").addEventListener("click", onResultsWrapClick);
});

function csvField(row, key) {
    const target = key.toLowerCase().trim();
    for (const k in row) {
        if (Object.prototype.hasOwnProperty.call(row, k) && String(k).toLowerCase().trim() === target) {
            return row[k];
        }
    }
    return "";
}

function cleanCode(value) {
    return String(value || "").toUpperCase().trim();
}

function parseCourseCodeParts(code) {
    const c = cleanCode(code).replace(/-COURSE$/, "");
    const m = c.match(/^([A-Z]{2,5}-\d{2,4}[A-Z]*)-([A-Z]{2}\d{3})-(\d{2}\/(?:WI|WN|SP|SU|FA|SS))$/);
    if (!m) return null;
    return { subjectNumber: m[1], termSection: m[2], semester: m[3] };
}

function splitNameAndCode(courseName) {
    const text = String(courseName || "").trim();
    const codePattern = /([A-Z]{2,5}-\d{2,4}[A-Z]*(?:\/[A-Z]{2,5}-\d{2,4}[A-Z]*)*-[A-Z]{2}\d{3}(?:\/[A-Z]{2}\d{3})?-\d{2}\/(?:WI|WN|SP|SU|FA|SS))(?:-COURSE)?$/i;
    const match = text.match(codePattern);
    if (!match) return { baseName: text, trailingCode: "" };
    const trailingCode = match[0];
    const baseName = text.slice(0, text.length - trailingCode.length).replace(/\s*-\s*$/, "").trim();
    return { baseName, trailingCode };
}

function buildMainDisplayCode(masterCode, mergeCodes) {
    const master = parseCourseCodeParts(masterCode);
    if (!master) return cleanCode(masterCode).replace(/-COURSE$/, "");

    const parsedMerge = mergeCodes.map(parseCourseCodeParts).filter(Boolean);
    const all = [master].concat(parsedMerge);
    const subjectNumbers = [];
    const termSections = [];

    all.forEach((p) => {
        if (subjectNumbers.indexOf(p.subjectNumber) === -1) subjectNumbers.push(p.subjectNumber);
        if (termSections.indexOf(p.termSection) === -1) termSections.push(p.termSection);
    });

    const sameSubjectFamily = subjectNumbers.length === 1;
    if (sameSubjectFamily) {
        return `${subjectNumbers[0]}-${termSections.join("/")}-${master.semester}`;
    }
    return `${subjectNumbers.join("/")}-${master.termSection}-${master.semester}`;
}

/** Semesters for this calendar year and next only: YY/TERM or YYYY/TERM with WI, SP, FA. */
function isCurrentOrNextYearSemester(it) {
    const y = new Date().getFullYear();
    const allowedYears = [y, y + 1];
    const allowedTerms = ["WI", "SP", "FA"];
    const semesterText = `${(it && it.Name) || ""} ${(it && it.Code) || ""}`.toUpperCase();
    return allowedYears.some(function (year) {
        const yy = String(year).slice(-2);
        return allowedTerms.some(function (term) {
            const yyPat = new RegExp("\\b" + yy + "\\s*[\\/-]\\s*" + term + "\\b");
            const yyyyPat = new RegExp("\\b" + year + "\\s*[\\/-]\\s*" + term + "\\b");
            return yyPat.test(semesterText) || yyyyPat.test(semesterText);
        });
    });
}

async function loadSemesters() {
    try {
        LoadingUtils.showLoadingBar("loadingContainer");
        LoadingUtils.updateLoadingBar(10, "Loading semesters...", "loadingContainer");
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;

        const data = await D2LApi.fetchPaginatedData(`/d2l/api/lp/${LP_VERSION}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`);
        const filtered = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
            ? SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data || []))
            : (data || []).filter(isCurrentOrNextYearSemester);
        if (typeof SemesterConfig === 'undefined') {
            filtered.sort((a, b) => ((a && (a.Code || a.Name)) || "").localeCompare((b && (b.Code || b.Name)) || "")).reverse();
        }

        const sel = document.getElementById("semesterSelect");
        const auditSel = document.getElementById("auditSemesterSelect");
        sel.innerHTML = '<option value="">- Select Semester -</option>';
        auditSel.innerHTML = '<option value="">- Select Semester -</option>';
        if (!filtered.length) {
            sel.innerHTML = '<option value="">No semesters available</option>';
            auditSel.innerHTML = '<option value="">No semesters available</option>';
            LoadingUtils.updateLoadingBar(100, "Complete!", "loadingContainer");
            setTimeout(() => LoadingUtils.hideLoadingBar("loadingContainer"), 400);
            return;
        }
        filtered.forEach((it) => {
            const opt = document.createElement("option");
            opt.value = it.Identifier;
            opt.textContent = `${it.Code || ""} - ${it.Name || it.Identifier}`;
            sel.appendChild(opt);
            auditSel.appendChild(opt.cloneNode(true));
            const m = String((it.Code || it.Name || "")).toUpperCase().match(/\d{2}\/(?:WI|WN|SP|SU|FA|SS)/);
            if (m) semesterIdToShortCode[it.Identifier] = m[0];
        });

        LoadingUtils.updateLoadingBar(100, "Complete!", "loadingContainer");
        setTimeout(() => LoadingUtils.hideLoadingBar("loadingContainer"), 400);
    } catch (e) {
        console.error(e);
        LoadingUtils.hideLoadingBar("loadingContainer");
        alert("Failed to load semesters.");
    }
}

async function onSemesterChange() {
    const semesterId = document.getElementById("semesterSelect").value;
    courseByCode = {};
    if (!semesterId) return;

    LoadingUtils.showLoadingBar("loadingContainer");
    LoadingUtils.updateLoadingBar(15, "Loading semester courses...", "loadingContainer");
    try {
        const offerings = await D2LApi.fetchPaginatedData(`/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/children/?pageSize=200`);
        offerings.forEach((it) => {
            if (it && it.Type && Number(it.Type.Id) === 3) {
                courseByCode[cleanCode(it.Code)] = it;
            }
        });
        LoadingUtils.updateLoadingBar(100, "Courses indexed.", "loadingContainer");
    } catch (e) {
        console.error(e);
        alert("Failed to load semester courses.");
    } finally {
        setTimeout(() => LoadingUtils.hideLoadingBar("loadingContainer"), 300);
    }
}

function parseMergeRequestRows(csvRows) {
    const rows = [];
    csvRows.forEach((r) => {
        const masterCourse = cleanCode(csvField(r, "Master course"));
        if (!masterCourse) return;
        const mergeCodes = [
            cleanCode(csvField(r, "Merging course 1")),
            cleanCode(csvField(r, "Merging course 2")),
            cleanCode(csvField(r, "Merging course 3")),
            cleanCode(csvField(r, "Merging course 4"))
        ].filter(Boolean);
        if (!mergeCodes.length) return;

        rows.push({
            Name: csvField(r, "Name"),
            Email: csvField(r, "Email"),
            Division: csvField(r, "Division"),
            masterCourse,
            mergeCodes
        });
    });
    return rows;
}

async function runPreview() {
    const semesterId = document.getElementById("semesterSelect").value;
    const file = document.getElementById("csvFile").files[0];
    if (!semesterId || !file) {
        alert("Select a semester and upload CSV first.");
        return;
    }
    if (!Object.keys(courseByCode).length) {
        alert("Load semester courses first by selecting semester again.");
        return;
    }

    LoadingUtils.showLoadingModal("Building merge preview...");
    previewRows = [];
    updateLogRows = [];
    document.getElementById("downloadLogBtn").disabled = true;

    try {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const requests = parseMergeRequestRows(parsed.data || []);

        for (let i = 0; i < requests.length; i++) {
            const req = requests[i];
            LoadingUtils.updateLoadingModal(Math.floor(((i + 1) / requests.length) * 100), `Preview ${i + 1}/${requests.length}`);

            const masterItem = courseByCode[req.masterCourse];
            const masterOrgUnitId = masterItem ? masterItem.Identifier : "";
            const mergeItems = req.mergeCodes.map((code) => ({ code, item: courseByCode[code] }));
            const missing = [];
            if (!masterItem) missing.push("Master not found in selected semester");
            mergeItems.forEach((m) => { if (!m.item) missing.push(`Merge not found: ${m.code}`); });

            let targetMasterName = "";
            if (masterItem) {
                const currentName = String(masterItem.Name || "");
                const split = splitNameAndCode(currentName);
                targetMasterName = `${split.baseName} - ${buildMainDisplayCode(req.masterCourse, req.mergeCodes)}`;
            }

            previewRows.push({
                requestor: req.Name || req.Email || "",
                email: req.Email || "",
                masterCourse: req.masterCourse,
                masterOrgUnitId,
                targetMasterName,
                mergeCourses: req.mergeCodes.join(" | "),
                mergeOrgUnitIds: mergeItems.map((m) => (m.item ? m.item.Identifier : "")).filter(Boolean).join(" | "),
                status: missing.length ? `BLOCKED: ${missing.join("; ")}` : "READY"
            });
        }
        renderRows(previewRows, false);
        document.getElementById("processBtn").disabled = previewRows.every((r) => r.status !== "READY");
    } catch (e) {
        console.error(e);
        alert("Preview failed: " + e.message);
    } finally {
        LoadingUtils.hideLoadingModal();
    }
}

async function upsertMergeNews(mergeOu, masterOu, masterCode) {
    const title = "This Course Has Been Merged";
    let existing = [];
    try {
        existing = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${mergeOu}/news/`);
    } catch (e) {
        existing = [];
    }
    if (Array.isArray(existing) && existing.some((n) => n.Title === title)) return "News exists";

    const courseUrl = `${window.location.origin}/d2l/home/${masterOu}`;
    await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${mergeOu}/news/`, {
        method: "POST",
        body: JSON.stringify({
            Title: title,
            Body: {
                Text: `This course was merged and set inactive. Teach and grade from main course ${masterCode}: ${courseUrl}`,
                Html: `<p>This course has been merged and set inactive.</p><p>Please teach and grade from the main course: <strong>${masterCode}</strong>.</p><p><a href="${courseUrl}" target="_blank">Open Main Course</a></p>`
            },
            StartDate: new Date().toISOString(),
            EndDate: null,
            IsGlobal: false,
            IsPublished: true,
            ShowOnlyInCourseOfferings: false,
            IsAuthorInfoShown: false,
            IsPinned: false,
            IsStartDateShown: false,
            SortOrder: null
        })
    });
    return "News posted";
}

async function ensureMergedNewsAndInactive(orgUnitId) {
    const result = [];
    const course = await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/courses/${orgUnitId}`);
    if (course.IsActive) {
        await updateCourseNameAndActive(orgUnitId, course.Name, true);
        result.push("Set inactive");
    } else {
        result.push("Already inactive");
    }

    const newsResult = await upsertGenericMergedNews(orgUnitId);
    result.push(newsResult);
    return result.join("; ");
}

async function upsertGenericMergedNews(courseOu) {
    const title = "This Course Has Been Merged";
    let existing = [];
    try {
        existing = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${courseOu}/news/`);
    } catch (e) {
        existing = [];
    }
    if (Array.isArray(existing) && existing.some((n) => n.Title === title)) return "News exists";

    await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${courseOu}/news/`, {
        method: "POST",
        body: JSON.stringify({
            Title: title,
            Body: {
                Text: "This course has been merged and set inactive. Please use your active merged-into course for teaching and grading.",
                Html: "<p>This course has been merged and set inactive.</p><p>Please use your active merged-into course for teaching and grading.</p>"
            },
            StartDate: new Date().toISOString(),
            EndDate: null,
            IsGlobal: false,
            IsPublished: true,
            ShowOnlyInCourseOfferings: false,
            IsAuthorInfoShown: false,
            IsPinned: false,
            IsStartDateShown: false,
            SortOrder: null
        })
    });
    return "News posted";
}

async function updateCourseNameAndActive(orgUnitId, nextName, makeInactive) {
    const course = await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/courses/${orgUnitId}`);
    const payload = {
        Name: nextName || course.Name,
        Code: course.Code,
        Path: course.Path,
        CourseTemplateId: parseInt(course.CourseTemplate?.Identifier, 10) || 0,
        SemesterId: parseInt(course.Semester?.Identifier, 10) || 0,
        StartDate: course.StartDate,
        EndDate: course.EndDate,
        LocaleId: course.LocaleId ?? null,
        ForceLocale: course.ForceLocale ?? false,
        ShowAddressBook: course.ShowAddressBook ?? false,
        Description: {
            Content: course.Description?.Html || "",
            Type: "Text|Html"
        },
        CanSelfRegister: course.CanSelfRegister ?? false,
        IsActive: makeInactive ? false : (course.IsActive ?? true)
    };
    await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/courses/${orgUnitId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
    });
    return course;
}

function getMergedAuditStatus(isActive, hasMergedNews) {
    if (!isActive && hasMergedNews) return "READY";
    if (isActive && !hasMergedNews) return "Needs inactive + merged post";
    if (isActive) return "Needs inactive";
    return "Needs merged post";
}

function renderMergedAuditRows(rows) {
    const card = document.getElementById("resultsCard");
    const wrap = document.getElementById("resultsWrap");
    card.style.display = "block";
    const actionableCount = rows.filter((r) => r.status !== "READY").length;

    let html = '<table class="results-table"><thead><tr>';
    ["Course Name", "Course Code", "Org Unit", "Active", "Merged News", "Status", "Action"].forEach((h) => {
        html += `<th>${h}</th>`;
    });
    html += "</tr></thead><tbody>";

    rows.forEach((r) => {
        const statusClass = r.status === "READY" ? "ok" : "danger";
        html += "<tr>";
        html += `<td>${r.courseName || ""}</td>`;
        html += `<td>${r.courseCode || ""}</td>`;
        html += `<td>${r.orgUnitId || ""}</td>`;
        html += `<td>${r.isActive ? "Yes" : "No"}</td>`;
        html += `<td>${r.hasMergedNews ? "Yes" : "No"}</td>`;
        html += `<td class="${statusClass}">${r.status}</td>`;
        if (r.status === "READY") {
            html += "<td><span class=\"ok\">No action needed</span></td>";
        } else {
            html += `<td><button class="btn-secondary single-merged-update-btn" data-ou="${r.orgUnitId}"><i class="fas fa-wrench"></i> Update Course</button></td>`;
        }
        html += "</tr>";
    });

    html += "</tbody></table>";
    wrap.innerHTML = html;
    document.getElementById("processMergedBulkBtn").disabled = actionableCount === 0;
}

async function runMergedSemesterPreview() {
    const semesterId = document.getElementById("auditSemesterSelect").value;
    if (!semesterId) {
        alert("Select a semester first.");
        return;
    }

    LoadingUtils.showLoadingModal("Finding MERGED courses...");
    mergedAuditRows = [];
    document.getElementById("processMergedBulkBtn").disabled = true;
    try {
        const offerings = await D2LApi.fetchPaginatedData(`/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/children/?pageSize=200`);
        const mergedCandidates = (offerings || []).filter((it) => it && it.Type && Number(it.Type.Id) === 3 && /merged/i.test(String(it.Name || "")));

        for (let i = 0; i < mergedCandidates.length; i++) {
            const item = mergedCandidates[i];
            LoadingUtils.updateLoadingModal(Math.floor(((i + 1) / mergedCandidates.length) * 100), `Checking ${i + 1}/${mergedCandidates.length}`);
            const course = await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/courses/${item.Identifier}`);
            let newsItems = [];
            try {
                newsItems = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${item.Identifier}/news/`);
            } catch (e) {
                newsItems = [];
            }

            const hasMergedNews = Array.isArray(newsItems) && newsItems.some((n) => String(n.Title || "").trim() === "This Course Has Been Merged");
            const isActive = Boolean(course.IsActive);
            mergedAuditRows.push({
                orgUnitId: item.Identifier,
                courseCode: course.Code || item.Code || "",
                courseName: course.Name || item.Name || "",
                isActive,
                hasMergedNews,
                status: getMergedAuditStatus(isActive, hasMergedNews)
            });
        }

        renderMergedAuditRows(mergedAuditRows);
        if (!mergedAuditRows.length) {
            document.getElementById("resultsCard").style.display = "block";
            document.getElementById("resultsWrap").innerHTML = "<p>No courses with MERGED in the title were found for this semester.</p>";
        }
    } catch (e) {
        console.error(e);
        alert("MERGED preview failed: " + (e.message || String(e)));
    } finally {
        LoadingUtils.hideLoadingModal();
    }
}

async function processSingleMergedUpdate(orgUnitId) {
    LoadingUtils.showLoadingModal("Updating selected course...");
    try {
        const details = await ensureMergedNewsAndInactive(orgUnitId);
        mergedAuditRows = mergedAuditRows.map((r) => {
            if (String(r.orgUnitId) !== String(orgUnitId)) return r;
            return { ...r, isActive: false, hasMergedNews: true, status: "READY", details };
        });
        renderMergedAuditRows(mergedAuditRows);
    } catch (e) {
        alert(`Update failed for ${orgUnitId}: ${e.message || String(e)}`);
    } finally {
        LoadingUtils.hideLoadingModal();
    }
}

async function processMergedBulkUpdates() {
    const rows = mergedAuditRows.filter((r) => r.status !== "READY");
    if (!rows.length) {
        alert("No MERGED courses need updates.");
        return;
    }
    LoadingUtils.showLoadingModal("Bulk updating MERGED courses...");
    try {
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            LoadingUtils.updateLoadingModal(Math.floor(((i + 1) / rows.length) * 100), `Updating ${i + 1}/${rows.length}`);
            try {
                const details = await ensureMergedNewsAndInactive(row.orgUnitId);
                mergedAuditRows = mergedAuditRows.map((r) => {
                    if (String(r.orgUnitId) !== String(row.orgUnitId)) return r;
                    return { ...r, isActive: false, hasMergedNews: true, status: "READY", details };
                });
            } catch (e) {
                mergedAuditRows = mergedAuditRows.map((r) => {
                    if (String(r.orgUnitId) !== String(row.orgUnitId)) return r;
                    return { ...r, status: `FAILED: ${e.message || String(e)}` };
                });
            }
        }
        renderMergedAuditRows(mergedAuditRows);
    } finally {
        LoadingUtils.hideLoadingModal();
    }
}

function onResultsWrapClick(event) {
    const btn = event.target.closest(".single-merged-update-btn");
    if (!btn) return;
    const orgUnitId = btn.getAttribute("data-ou");
    if (!orgUnitId) return;
    processSingleMergedUpdate(orgUnitId);
}

async function processUpdates() {
    const ready = previewRows.filter((r) => r.status === "READY");
    if (!ready.length) {
        alert("No READY rows to process.");
        return;
    }

    LoadingUtils.showLoadingModal("Processing merge updates...");
    updateLogRows = [];
    try {
        for (let i = 0; i < ready.length; i++) {
            const row = ready[i];
            LoadingUtils.updateLoadingModal(Math.floor(((i + 1) / ready.length) * 100), `Processing ${i + 1}/${ready.length}`);

            const logs = [];
            try {
                await updateCourseNameAndActive(row.masterOrgUnitId, row.targetMasterName, false);
                logs.push("Main name updated");

                const mergeCodes = row.mergeCourses.split(" | ").filter(Boolean);
                for (const code of mergeCodes) {
                    const mergeItem = courseByCode[cleanCode(code)];
                    if (!mergeItem) continue;
                    const mergeCourse = await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/courses/${mergeItem.Identifier}`);
                    const mergedName = String(mergeCourse.Name || "").startsWith("MERGED - ") ? mergeCourse.Name : `MERGED - ${mergeCourse.Name}`;
                    await updateCourseNameAndActive(mergeItem.Identifier, mergedName, true);
                    const newsResult = await upsertMergeNews(mergeItem.Identifier, row.masterOrgUnitId, row.masterCourse);
                    logs.push(`${code}: inactivated + renamed + ${newsResult}`);
                }

                updateLogRows.push({ ...row, status: "UPDATED", details: logs.join("; ") });
            } catch (e) {
                updateLogRows.push({ ...row, status: "FAILED", details: e.message || String(e) });
            }
        }
        renderRows(updateLogRows, true);
        document.getElementById("downloadLogBtn").disabled = updateLogRows.length === 0;
    } finally {
        LoadingUtils.hideLoadingModal();
    }
}

function openTab(tabId) {
    document.querySelectorAll(".tab-content").forEach((div) => {
        div.classList.remove("active");
        div.style.display = "none";
    });
    document.querySelectorAll(".tab-button").forEach((btn) => btn.classList.remove("active"));
    const activeTab = document.getElementById(tabId);
    activeTab.classList.add("active");
    activeTab.style.display = "block";
    const tabButton = document.querySelector(`.tab-button[onclick="openTab('${tabId}')"]`);
    if (tabButton) tabButton.classList.add("active");
}

function renderRows(rows, finalMode) {
    const card = document.getElementById("resultsCard");
    const wrap = document.getElementById("resultsWrap");
    card.style.display = "block";

    const headers = ["Requestor", "Email", "Master Course", "Master OU", "New Main Name", "Merge Courses", "Merge OUs", finalMode ? "Result" : "Status", finalMode ? "Details" : ""].filter(Boolean);
    let html = '<table class="results-table"><thead><tr>';
    headers.forEach((h) => { html += `<th>${h}</th>`; });
    html += "</tr></thead><tbody>";

    rows.forEach((r) => {
        const status = finalMode ? r.status : r.status;
        const statusClass = String(status).indexOf("READY") === 0 || status === "UPDATED" ? "ok" : "danger";
        html += "<tr>";
        html += `<td>${r.requestor || ""}</td>`;
        html += `<td>${r.email || ""}</td>`;
        html += `<td>${r.masterCourse || ""}</td>`;
        html += `<td>${r.masterOrgUnitId || ""}</td>`;
        html += `<td>${r.targetMasterName || ""}</td>`;
        html += `<td>${r.mergeCourses || ""}</td>`;
        html += `<td>${r.mergeOrgUnitIds || ""}</td>`;
        html += `<td class="${statusClass}">${status || ""}</td>`;
        if (finalMode) html += `<td>${r.details || ""}</td>`;
        html += "</tr>";
    });
    html += "</tbody></table>";
    wrap.innerHTML = html;
}

function downloadLogCsv() {
    if (!updateLogRows.length) return;
    const csv = Papa.unparse(updateLogRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `course-merge-updater-log_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

window.openTab = openTab;
