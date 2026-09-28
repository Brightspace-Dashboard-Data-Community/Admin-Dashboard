/**
 * Division CSV Splitter
 * Splits an uploaded CSV into one Excel workbook per Division value.
 * Filenames: {division_slug}_{semesterCode}.xlsx  e.g. social_sciences_26FA.xlsx
 */

let headers = [];
let divisionGroups = []; // [{ division, slug, rows, filename }]
let semesterCodeTag = ""; // e.g. 26FA

document.addEventListener("DOMContentLoaded", () => {
    if (typeof LoadingUtils !== "undefined") {
        const loadingContainer = LoadingUtils.createLoadingBar("loadingContainer");
        const card = document.querySelector(".card");
        if (card && loadingContainer) card.appendChild(loadingContainer);
    }

    initSemesterSelect();
    document.getElementById("semesterSelect").addEventListener("change", onSemesterOrFileChange);
    document.getElementById("csvFile").addEventListener("change", onSemesterOrFileChange);
    document.getElementById("splitBtn").addEventListener("click", splitByDivision);
    document.getElementById("downloadAllBtn").addEventListener("click", downloadAllFiles);
    document.getElementById("resultsWrap").addEventListener("click", onResultsClick);
});

function initSemesterSelect() {
    const sel = document.getElementById("semesterSelect");
    if (typeof SemesterConfig !== "undefined" && SemesterConfig.populateSelect) {
        SemesterConfig.populateSelect(sel, null, {
            placeholder: "- Select Semester -",
            excludeSandbox: true,
            includeCode: true
        });
    } else {
        sel.innerHTML = '<option value="">No semester config loaded</option>';
    }
    updateFilenamePreview();
}

function getSelectedSemesterCode() {
    const sel = document.getElementById("semesterSelect");
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return "";
    return (opt.dataset && opt.dataset.code) ? String(opt.dataset.code).trim() : "";
}

/** Convert "26/FA" -> "26FA" for filenames. */
function toFilenameSemesterTag(code) {
    return String(code || "").replace(/\//g, "").replace(/\s+/g, "").toUpperCase();
}

/**
 * Slugify a division name for filenames.
 * "Social Sciences" -> "social_sciences"
 * "Science & Mathematics" -> "science_mathematics"
 */
function slugifyDivision(name) {
    return String(name || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, " ")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_") || "unknown_division";
}

function buildFilename(division, semesterTag) {
    return `${slugifyDivision(division)}_${semesterTag}.xlsx`;
}

function updateFilenamePreview() {
    const code = getSelectedSemesterCode();
    const tag = toFilenameSemesterTag(code) || "26FA";
    const el = document.getElementById("filenamePreview");
    if (el) {
        el.innerHTML = `Example filename: <code>${buildFilename("Social Sciences", tag)}</code>`;
    }
}

function onSemesterOrFileChange() {
    updateFilenamePreview();
    const hasSemester = !!document.getElementById("semesterSelect").value;
    const fileInput = document.getElementById("csvFile");
    const hasFile = fileInput.files && fileInput.files.length > 0;
    document.getElementById("splitBtn").disabled = !(hasSemester && hasFile);
    // Clear previous results when inputs change
    divisionGroups = [];
    document.getElementById("downloadAllBtn").disabled = true;
    document.getElementById("resultsCard").style.display = "none";
}

function csvField(row, key) {
    const target = key.toLowerCase().trim();
    for (const k in row) {
        if (Object.prototype.hasOwnProperty.call(row, k) && String(k).toLowerCase().trim() === target) {
            return row[k];
        }
    }
    return "";
}

function findDivisionKey(fieldNames) {
    if (!fieldNames || !fieldNames.length) return null;
    const exact = fieldNames.find((h) => String(h).toLowerCase().trim() === "division");
    if (exact) return exact;
    return fieldNames.find((h) => String(h).toLowerCase().includes("division")) || null;
}

function parseCsvFile(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: "greedy",
            transformHeader: (h) => String(h || "").trim(),
            complete: (results) => {
                if (results.errors && results.errors.length) {
                    const fatal = results.errors.filter((e) => e.type === "Delimiter" || e.type === "Quotes");
                    if (fatal.length) {
                        reject(new Error(fatal[0].message || "CSV parse error"));
                        return;
                    }
                }
                resolve(results);
            },
            error: (err) => reject(err || new Error("Failed to parse CSV"))
        });
    });
}

async function splitByDivision() {
    const semesterCode = getSelectedSemesterCode();
    if (!semesterCode) {
        alert("Please select a semester.");
        return;
    }
    const fileInput = document.getElementById("csvFile");
    if (!fileInput.files || !fileInput.files.length) {
        alert("Please upload a CSV file.");
        return;
    }
    if (typeof XLSX === "undefined") {
        alert("Excel library (SheetJS) failed to load. Check your network connection and refresh.");
        return;
    }

    semesterCodeTag = toFilenameSemesterTag(semesterCode);
    const file = fileInput.files[0];

    try {
        if (typeof LoadingUtils !== "undefined") {
            LoadingUtils.showLoadingBar("loadingContainer");
            LoadingUtils.updateLoadingBar(20, "Parsing CSV...", "loadingContainer");
        }

        const parsed = await parseCsvFile(file);
        const rows = (parsed.data || []).filter((row) =>
            Object.values(row).some((v) => String(v || "").trim() !== "")
        );
        headers = parsed.meta && parsed.meta.fields ? parsed.meta.fields.slice() : [];

        const divisionKey = findDivisionKey(headers);
        if (!divisionKey) {
            throw new Error('No "Division" column found in the CSV. Expected a column named Division.');
        }

        if (typeof LoadingUtils !== "undefined") {
            LoadingUtils.updateLoadingBar(60, "Grouping by division...", "loadingContainer");
        }

        const map = new Map();
        let blankDivisionCount = 0;
        rows.forEach((row) => {
            let div = String(csvField(row, divisionKey) || "").trim();
            if (!div) {
                div = "(No Division)";
                blankDivisionCount += 1;
            }
            if (!map.has(div)) map.set(div, []);
            map.get(div).push(row);
        });

        divisionGroups = Array.from(map.entries())
            .map(([division, groupRows]) => ({
                division,
                slug: slugifyDivision(division),
                rows: groupRows,
                filename: buildFilename(division, semesterCodeTag)
            }))
            .sort((a, b) => a.division.localeCompare(b.division, undefined, { sensitivity: "base" }));

        renderResults(rows.length, blankDivisionCount);

        if (typeof LoadingUtils !== "undefined") {
            LoadingUtils.updateLoadingBar(100, "Complete!", "loadingContainer");
            setTimeout(() => LoadingUtils.hideLoadingBar("loadingContainer"), 400);
        }
    } catch (err) {
        console.error(err);
        if (typeof LoadingUtils !== "undefined") LoadingUtils.hideLoadingBar("loadingContainer");
        alert(err.message || "Failed to split CSV.");
    }
}

function renderResults(totalRows, blankDivisionCount) {
    const card = document.getElementById("resultsCard");
    const summary = document.getElementById("summaryBar");
    const wrap = document.getElementById("resultsWrap");

    summary.innerHTML =
        `<span>Total rows: <strong>${totalRows}</strong></span>` +
        `<span>Divisions: <strong>${divisionGroups.length}</strong></span>` +
        `<span>Semester tag: <strong>${semesterCodeTag}</strong></span>` +
        (blankDivisionCount
            ? `<span>Rows missing Division: <strong>${blankDivisionCount}</strong></span>`
            : "");

    let html =
        '<table class="results-table"><thead><tr>' +
        "<th>Division</th><th>Rows</th><th>Filename</th><th>Download</th>" +
        "</tr></thead><tbody>";

    divisionGroups.forEach((g, idx) => {
        html +=
            `<tr>` +
            `<td>${escapeHtml(g.division)}</td>` +
            `<td>${g.rows.length}</td>` +
            `<td><code>${escapeHtml(g.filename)}</code></td>` +
            `<td><button type="button" class="btn-download-row" data-index="${idx}">` +
            `<i class="fas fa-file-excel"></i> Download</button></td>` +
            `</tr>`;
    });
    html += "</tbody></table>";

    wrap.innerHTML = html;
    card.style.display = "block";
    document.getElementById("downloadAllBtn").disabled = divisionGroups.length === 0;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function isOrgDefinedIdHeader(name) {
    const normalized = String(name || "").toLowerCase().replace(/[\s_-]/g, "");
    return normalized === "orgdefinedid";
}

function isDeltaIdHeader(name) {
    const normalized = String(name || "").toLowerCase().replace(/[\s_-]/g, "");
    return normalized === "deltaid" || normalized === "deltaidnumber";
}

function rowsToSheetData(rows) {
    const cols = (headers.length
        ? headers
        : (rows[0] ? Object.keys(rows[0]) : [])
    ).filter((h) => !isOrgDefinedIdHeader(h) && !isDeltaIdHeader(h));
    const aoa = [cols];
    rows.forEach((row) => {
        aoa.push(cols.map((c) => {
            const v = row[c];
            return v == null ? "" : v;
        }));
    });
    return aoa;
}

function buildWorkbookBlob(group) {
    const aoa = rowsToSheetData(group.rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    const sheetName = (group.slug || "Division").slice(0, 31) || "Division";
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

function downloadGroup(group) {
    const buffer = buildWorkbookBlob(group);
    const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = group.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onResultsClick(e) {
    const btn = e.target.closest("[data-index]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-index"));
    const group = divisionGroups[idx];
    if (group) downloadGroup(group);
}

async function downloadAllFiles() {
    if (!divisionGroups.length) return;
    const btn = document.getElementById("downloadAllBtn");
    btn.disabled = true;
    try {
        for (let i = 0; i < divisionGroups.length; i++) {
            downloadGroup(divisionGroups[i]);
            // Brief pause so the browser does not collapse multiple downloads
            await new Promise((r) => setTimeout(r, 350));
        }
    } finally {
        btn.disabled = false;
    }
}
