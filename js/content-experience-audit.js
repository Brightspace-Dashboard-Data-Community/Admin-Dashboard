/**
 * Content Experience Audit by Semester
 * Detects New vs Classic content experience by probing Lessons URL.
 */

const LP_VERSION = "1.49";
const LESSONS_URL_PREFIX = "/d2l/le/lessons/";
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 150;

let statusEl, progressEl, summaryEl, logEl, resultTbody, semesterSelect, runBtn, stopBtn, downloadBtn, tableCard;
let isRunning = false;
let shouldStop = false;
let allResults = [];

document.addEventListener("DOMContentLoaded", async function () {
    statusEl = document.getElementById("status");
    progressEl = document.getElementById("progress");
    summaryEl = document.getElementById("summary");
    logEl = document.getElementById("log");
    resultTbody = document.querySelector("#resultTable tbody");
    semesterSelect = document.getElementById("semesterSelect");
    runBtn = document.getElementById("runBtn");
    stopBtn = document.getElementById("stopBtn");
    downloadBtn = document.getElementById("downloadBtn");
    tableCard = document.getElementById("tableCard");

    if (typeof D2LApi === "undefined") {
        setStatus("Error: D2LApi not loaded.");
        return;
    }

    runBtn.addEventListener("click", handleRunAudit);
    stopBtn.addEventListener("click", handleStop);
    downloadBtn.addEventListener("click", handleDownloadCSV);

    try {
        await loadSemesters();
    } catch (error) {
        logMsg("Initialization warning: " + (error.message || error));
    }
});

function logMsg(msg) {
    if (!logEl) return;
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent += "[" + timestamp + "] " + msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = "Status: " + text;
}

function setProgress(current, total) {
    if (!progressEl) return;
    progressEl.textContent = total > 0 ? ("Checked " + current + " of " + total + " courses") : "";
}

function setSummary(results) {
    if (!summaryEl) return;
    if (!results || !results.length) {
        summaryEl.textContent = "";
        return;
    }

    const counts = { New: 0, Classic: 0 };
    for (let i = 0; i < results.length; i++) {
        const v = results[i].ContentExperience;
        if (v === "New Content Experience") counts.New++;
        else counts.Classic++;
    }
    summaryEl.textContent = "Summary: New = " + counts.New + ", Classic = " + counts.Classic;
}

async function loadSemesters() {
    setStatus("Loading semesters...");
    const orgInfo = await D2LApi.getOrganizationInfo();
    const rootOrgUnitId = orgInfo?.Identifier;
    if (!rootOrgUnitId) throw new Error("Could not get root org unit id.");

    let semesters = [];
    if (typeof D2LApi.fetchPaginatedData === "function") {
        semesters = await D2LApi.fetchPaginatedData("/d2l/api/lp/" + LP_VERSION + "/orgstructure/" + rootOrgUnitId + "/descendants/?ouTypeId=5");
    } else {
        const raw = await D2LApi._fetch("/d2l/api/lp/" + LP_VERSION + "/orgstructure/" + rootOrgUnitId + "/descendants/?ouTypeId=5&pageSize=100");
        semesters = Array.isArray(raw?.Objects) ? raw.Objects : (Array.isArray(raw) ? raw : []);
    }

    if (typeof SemesterConfig !== 'undefined' && SemesterConfig.populateSelect) {
        const populated = SemesterConfig.populateSelect(semesterSelect, semesters, { placeholder: 'Select a semester…' });
        setStatus("Semesters loaded.");
        logMsg("Loaded " + populated.length + " semesters (filtered to canonical list).");
        return;
    }

    semesters.sort(function (a, b) {
        return String(b.Name || "").localeCompare(String(a.Name || ""));
    });

    semesterSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a semester…";
    semesterSelect.appendChild(placeholder);

    for (let i = 0; i < semesters.length; i++) {
        const sem = semesters[i];
        const option = document.createElement("option");
        option.value = sem.Identifier || sem.Id || "";
        option.textContent = sem.Name || ("Semester " + option.value);
        semesterSelect.appendChild(option);
    }

    setStatus("Semesters loaded.");
    logMsg("Loaded " + semesters.length + " semesters.");
}

async function loadCoursesForSemester(semesterId) {
    let items = [];
    if (typeof D2LApi.fetchPaginatedData === "function") {
        items = await D2LApi.fetchPaginatedData("/d2l/api/lp/" + LP_VERSION + "/orgstructure/" + semesterId + "/children/");
    } else {
        const response = await D2LApi._fetch("/d2l/api/lp/" + LP_VERSION + "/orgstructure/" + semesterId + "/children/?pageSize=200");
        items = Array.isArray(response?.Objects) ? response.Objects : (Array.isArray(response) ? response : []);
    }

    return items.filter(function (it) {
        const type = it.Type || {};
        return type.Id === 3 || type.Code === "Course Offering";
    });
}

async function detectExperience(orgUnitId) {
    const url = LESSONS_URL_PREFIX + orgUnitId;
    try {
        const response = await fetch(url, {
            method: "GET",
            redirect: "manual",
            credentials: "include"
        });

        if (response.status >= 200 && response.status < 300) {
            return {
                experience: "New Content Experience",
                statusCode: response.status,
                error: ""
            };
        }

        return {
            experience: "Classic Content",
            statusCode: response.status || 0,
            error: ""
        };
    } catch (error) {
        return {
            experience: "Classic Content",
            statusCode: 0,
            error: ""
        };
    }
}

function renderResultsTable(results) {
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const tr = document.createElement("tr");
        if (r.Error) tr.className = "error-row";
        const url = "/d2l/le/content/" + r.OrgUnitId + "/Home";
        const cells = [
            r.OrgUnitId || "",
            r.CourseName || "",
            r.CourseCode || "",
            r.ContentExperience || "Classic Content",
            r.StatusCode || "",
            r.DetectionURL || "",
            '<a href="' + url + '" target="_blank" rel="noopener">Open Content</a>',
            r.Error || ""
        ];
        for (let j = 0; j < cells.length; j++) {
            const td = document.createElement("td");
            td.innerHTML = cells[j];
            tr.appendChild(td);
        }
        resultTbody.appendChild(tr);
    }
    tableCard.style.display = "block";
}

async function runAudit(semesterId) {
    const courses = await loadCoursesForSemester(semesterId);
    if (!courses.length) {
        logMsg("No course offerings found for this semester.");
        return;
    }

    logMsg("Starting content experience audit for " + courses.length + " courses (batch size: " + BATCH_SIZE + ").");
    let processed = 0;

    for (let start = 0; start < courses.length; start += BATCH_SIZE) {
        if (shouldStop) {
            logMsg("Audit stopped by user.");
            break;
        }

        const batch = courses.slice(start, start + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async function (c, idx) {
            const orgUnitId = c.Identifier || c.Id || c.OrgUnitId || "";
            const absoluteIndex = start + idx + 1;
            const result = {
                OrgUnitId: orgUnitId,
                CourseName: c.Name || "",
                CourseCode: c.Code || "",
                ContentExperience: "Classic Content",
                StatusCode: "",
                DetectionURL: LESSONS_URL_PREFIX + orgUnitId,
                Error: ""
            };

            logMsg("Checking " + absoluteIndex + "/" + courses.length + ": " + (result.CourseCode || result.CourseName) + " (" + orgUnitId + ")");

            try {
                const details = await detectExperience(orgUnitId);
                result.ContentExperience = details.experience;
                result.StatusCode = details.statusCode;
                result.Error = details.error || "";
            } catch (error) {
                result.Error = error.message || String(error);
            }
            return result;
        }));

        allResults.push.apply(allResults, batchResults);
        renderResultsTable(batchResults);
        setSummary(allResults);

        processed += batchResults.length;
        setProgress(processed, courses.length);

        if (processed < courses.length && !shouldStop) {
            await new Promise(function (resolve) {
                setTimeout(resolve, BATCH_DELAY_MS);
            });
        }
    }
}

async function handleRunAudit() {
    const semesterId = semesterSelect.value;
    if (!semesterId) {
        alert("Please select a semester first.");
        return;
    }
    if (isRunning) {
        alert("Audit is already running.");
        return;
    }

    isRunning = true;
    shouldStop = false;
    allResults = [];
    resultTbody.innerHTML = "";
    tableCard.style.display = "none";
    setSummary([]);
    setProgress(0, 0);
    setStatus("Running audit...");
    runBtn.disabled = true;
    stopBtn.disabled = false;
    downloadBtn.disabled = true;

    try {
        await runAudit(semesterId);
        setStatus(shouldStop ? "Stopped." : "Audit complete.");
    } catch (error) {
        setStatus("Audit failed.");
        logMsg("ERROR: " + (error.message || error));
    } finally {
        isRunning = false;
        shouldStop = false;
        runBtn.disabled = false;
        stopBtn.disabled = true;
        downloadBtn.disabled = allResults.length === 0;
    }
}

function handleStop() {
    if (!isRunning) return;
    shouldStop = true;
    setStatus("Stopping...");
}

function escapeCSV(value) {
    const text = String(value === null || value === undefined ? "" : value);
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
        return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
}

function handleDownloadCSV() {
    if (!allResults.length) {
        alert("No results to download.");
        return;
    }

    const headers = ["OrgUnitId", "CourseName", "CourseCode", "ContentExperience", "StatusCode", "DetectionURL", "Error"];
    let csv = headers.join(",") + "\n";
    for (let i = 0; i < allResults.length; i++) {
        const r = allResults[i];
        csv += [
            escapeCSV(r.OrgUnitId),
            escapeCSV(r.CourseName),
            escapeCSV(r.CourseCode),
            escapeCSV(r.ContentExperience),
            escapeCSV(r.StatusCode),
            escapeCSV(r.DetectionURL),
            escapeCSV(r.Error)
        ].join(",") + "\n";
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "content-experience-audit_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
