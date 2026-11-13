/**
 * MERGED Course Classlist → CSV Report
 * Collects all MERGED course offerings, identifies their Primary course via CRN matching,
 * pulls classlists, and exports CSV.
 */

/* ---------- CONFIG ---------- */
const ORG_TYPE_SEMESTER = 5;         // Semester
const ORG_TYPE_COURSE_OFFERING = 3;  // Course Offering
const LP_VER = "1.49";               // Org structure / Courses / Sections
const LE_VER = "1.85";               // Classlist paged

// Fixed/default behavior for this report:
// - Always union children + descendants
// - Always students only
// - Concurrency and page size use fixed defaults
let CONCURRENCY = 6;
let PAGE_SIZE = 100;
let VERBOSE = false;
let UNION_CHILDREN_DESC = true;    // always union both trees
let STUDENTS_ONLY = true;          // always students only
let LIMIT_COURSES = 0;             // 0 = all

const semesterSelect = document.getElementById('semesterSelect');
const runBtn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    loadSemesters();
    runBtn.addEventListener('click', run);
});

/* ---------- UTILS ---------- */
function logLine(msg) {
    if (!VERBOSE) {
        console.log(msg);
        return;
    }
    const p = document.createElement('div');
    p.className = 'log-line';
    p.textContent = msg;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
}

function setStatus(msg) {
    statusEl.textContent = msg;
}

function showLog() {
    logEl.classList.add('active');
}

function hideLog() {
    logEl.classList.remove('active');
}

function downloadCSV(filename, rows) {
    let csv = "";
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const line = [];
        for (let j = 0; j < row.length; j++) {
            let cell = row[j] == null ? "" : String(row[j]);
            if (cell.indexOf('"') !== -1 || cell.indexOf(',') !== -1 || cell.indexOf('\n') !== -1) {
                cell = '"' + cell.replace(/"/g, '""') + '"';
            }
            line.push(cell);
        }
        csv += line.join(",") + "\n";
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ---------- Concurrency helper ---------- */
async function mapWithConcurrency(items, limit, worker) {
    let i = 0;
    const results = new Array(items.length);
    
    async function next() {
        const idx = i++;
        if (idx >= items.length) return;
        try {
            results[idx] = await worker(items[idx], idx);
        } catch (e) {
            results[idx] = { __error: e.message };
        }
        return next();
    }
    
    const starters = [];
    const max = items.length < limit ? items.length : limit;
    for (let k = 0; k < max; k++) {
        starters.push(next());
    }
    await Promise.all(starters);
    return results;
}

/* ---------- Safe pagers (bookmark+hasMore+loop guard+repeat check) ---------- */
function nextBookmark(page) {
    const b = (page.PagingInfo && (page.PagingInfo.Bookmark || page.PagingInfo.bookmark)) ||
              page.Bookmark || page.bookmark || page.Next || page.next || "";
    return b || "";
}

function hasMore(page) {
    const h = (page.PagingInfo && (page.PagingInfo.HasMoreItems || page.PagingInfo.hasMoreItems));
    return !!h;
}

/* ---------- Load semesters ---------- */
async function loadSemesters() {
    try {
        setStatus("Loading semesters…");
        let semesters = await fetchSemesters();
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            semesters = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(semesters));
        } else {
            semesters.sort((a, b) => {
                const an = (a.Name || "").toUpperCase();
                const bn = (b.Name || "").toUpperCase();
                if (an < bn) return -1;
                if (an > bn) return 1;
                return 0;
            });
        }
        semesterSelect.innerHTML = "";

        const opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = semesters.length ? "Select a semester…" : "No semesters available";
        semesterSelect.appendChild(opt0);

        semesters.forEach(s => {
            const id = String(s.Identifier || s.Id || s.OrgUnitId || "");
            const label = (s.Code ? s.Code + " — " : "") + (s.Name || "");
            const o = document.createElement("option");
            o.value = id;
            o.textContent = label;
            semesterSelect.appendChild(o);
        });

        setStatus(semesters.length ? "Semesters ready." : "No semesters available.");
    } catch (e) {
        setStatus("Failed to load semesters.");
        logLine("ERROR (semesters): " + e.message);
    }
}

async function fetchSemesters() {
    async function pull(base) {
        const out = [];
        const seen = new Set();
        let bookmark = "";
        let guard = 0;
        const seenB = new Set();
        
        while (true) {
            const url = base + (bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : "");
            const page = await D2LApi._fetch(url);
            const items = page.Items || page.Objects || page.items || [];
            
            for (let i = 0; i < items.length; i++) {
                const x = items[i];
                const id = String(x.Identifier || x.Id || x.OrgUnitId || "");
                if (id && !seen.has(id)) {
                    seen.add(id);
                    out.push(x);
                }
            }
            
            const nb = nextBookmark(page);
            const hm = hasMore(page);
            if (!nb || seenB.has(nb) || (!hm && !nb)) break;
            seenB.add(nb);
            bookmark = nb;
            guard++;
            if (guard > 1000) break;
        }
        return out;
    }

    const orgInfo = await D2LApi.getOrganizationInfo();
    const rootOrgId = orgInfo.Identifier;

    const baseC = `/d2l/api/lp/${LP_VER}/orgstructure/${rootOrgId}/children/paged/?ouTypeId=${ORG_TYPE_SEMESTER}`;
    let semesters = await pull(baseC);

    if (semesters.length === 0) {
        const baseD = `/d2l/api/lp/${LP_VER}/orgstructure/${rootOrgId}/descendants/paged/?ouTypeId=${ORG_TYPE_SEMESTER}`;
        semesters = await pull(baseD);
    }
    return semesters;
}

/* ---------- Courses / sections / classlist ---------- */

// Find Course Offerings (Type 3) with "MERGED" in Name — UNION + DEDUP
async function getMergedCoursesForSemester(semesterId) {
    async function pull(base) {
        const out = [];
        const seen = new Set();
        let bookmark = "";
        let guard = 0;
        const seenB = new Set();
        
        while (true) {
            const url = base + (bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : "");
            const page = await D2LApi._fetch(url);
            const items = page.Items || page.Objects || page.items || [];
            
            for (let i = 0; i < items.length; i++) {
                const ou = items[i];
                const name = ou.Name || "";
                const typeId = (ou.Type && (ou.Type.Id || ou.TypeIdentifier)) || null;

                if (typeId === ORG_TYPE_COURSE_OFFERING && name && name.toUpperCase().indexOf("MERGED") !== -1) {
                    const id = String(ou.Identifier || ou.Id || "");
                    if (id && !seen.has(id)) {
                        seen.add(id);
                        out.push(ou);
                    }
                }
            }
            
            const nb = nextBookmark(page);
            const hm = hasMore(page);
            if (!nb || seenB.has(nb) || (!hm && !nb)) break;
            seenB.add(nb);
            bookmark = nb;
            guard++;
            if (guard > 2000) break;
        }
        return out;
    }

    const baseChildren = `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/children/paged/?ouTypeId=${ORG_TYPE_COURSE_OFFERING}&pageSize=${PAGE_SIZE}`;
    const listChildren = await pull(baseChildren);

    let listDesc = [];
    if (UNION_CHILDREN_DESC) {
        const baseDesc = `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/descendants/paged/?ouTypeId=${ORG_TYPE_COURSE_OFFERING}&pageSize=${PAGE_SIZE}`;
        listDesc = await pull(baseDesc);
    }

    const byId = {};
    listChildren.forEach(a => {
        const idA = String(a.Identifier || a.Id || "");
        if (idA) byId[idA] = a;
    });
    listDesc.forEach(b => {
        const idB = String(b.Identifier || b.Id || "");
        if (idB && !byId[idB]) byId[idB] = b;
    });

    const merged = Object.values(byId);
    console.log("MERGED courses — children:", listChildren.length, "descendants:", listDesc.length, "union:", merged.length);
    return merged;
}

// Pull ALL course offerings (Type 3) for semester (no MERGED filter)
async function getAllCourseOfferingsForSemester(semesterId) {
    async function pull(base) {
        const out = [];
        const seen = new Set();
        let bookmark = "";
        let guard = 0;
        const seenB = new Set();
        
        while (true) {
            const url = base + (bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : "");
            const page = await D2LApi._fetch(url);
            const items = page.Items || page.Objects || page.items || [];
            
            for (let i = 0; i < items.length; i++) {
                const ou = items[i];
                const typeId = (ou.Type && (ou.Type.Id || ou.TypeIdentifier)) || null;
                if (typeId === ORG_TYPE_COURSE_OFFERING) {
                    const id = String(ou.Identifier || ou.Id || "");
                    if (id && !seen.has(id)) {
                        seen.add(id);
                        out.push(ou);
                    }
                }
            }
            
            const nb = nextBookmark(page);
            const hm = hasMore(page);
            if (!nb || seenB.has(nb) || (!hm && !nb)) break;
            seenB.add(nb);
            bookmark = nb;
            guard++;
            if (guard > 2000) break;
        }
        return out;
    }

    const baseChildren = `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/children/paged/?ouTypeId=${ORG_TYPE_COURSE_OFFERING}&pageSize=${PAGE_SIZE}`;
    const listChildren = await pull(baseChildren);

    let listDesc = [];
    if (UNION_CHILDREN_DESC) {
        const baseDesc = `/d2l/api/lp/${LP_VER}/orgstructure/${semesterId}/descendants/paged/?ouTypeId=${ORG_TYPE_COURSE_OFFERING}&pageSize=${PAGE_SIZE}`;
        listDesc = await pull(baseDesc);
    }

    // union & dedup
    const byId = {};
    listChildren.forEach(a => {
        const idA = String(a.Identifier || a.Id || "");
        if (idA) byId[idA] = a;
    });
    listDesc.forEach(b => {
        const idB = String(b.Identifier || b.Id || "");
        if (idB && !byId[idB]) byId[idB] = b;
    });

    return Object.values(byId);
}

// /lp/{ver}/{courseOfferingId}/sections/
async function getSectionsForCourseOffering(courseOfferingId) {
    const url = `/d2l/api/lp/${LP_VER}/${courseOfferingId}/sections/`;
    try {
        const data = await D2LApi._fetch(url);
        const items = data && (data.Items || data.Objects || data.items) ? (data.Items || data.Objects || data.items) : data;
        return Array.isArray(items) ? items : [];
    } catch (e) {
        logLine(`WARN: Failed to get sections for ${courseOfferingId}: ${e.message}`);
        return [];
    }
}

function getSectionCRNsFromSections(sections) {
    const crns = [];
    for (let i = 0; i < sections.length; i++) {
        const code = String(sections[i] && sections[i].Code ? sections[i].Code : "");
        if (code) crns.push(code);
    }
    return crns;
}

function isMergedOfferingName(name) {
    name = (name || "").toUpperCase();
    return name.indexOf("MERGED") !== -1;
}

// Pull active classlist (paged) with strict dedupe per org unit
async function getActiveClasslist(orgUnitId) {
    const out = [];
    const seenKeys = new Set(); // dedupe users inside same org unit

    let qs = `?pageSize=${PAGE_SIZE}`;
    if (STUDENTS_ONLY) qs += "&roleId=101";

    const base = `/d2l/api/le/${LE_VER}/${orgUnitId}/classlist/paged/${qs}`;

    let bookmark = "";
    let guard = 0;
    const seenB = new Set();
    
    while (true) {
        const url = base + (bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : "");
        try {
            const page = await D2LApi._fetch(url);
            const items = page.Items || page.Objects || page.items || [];
            
            for (let i = 0; i < items.length; i++) {
                const v = items[i];
                const userId = v.UserId || (v.User && (v.User.Identifier || v.User.Id)) || v.Identifier || v.Id || "";
                const orgDefinedId = v.OrgDefinedId || (v.User && v.User.OrgDefinedId) || "";
                const key = (userId ? String(userId) : "ODI:" + String(orgDefinedId));

                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    const roleName = v.RoleName || v.ClasslistRoleName || v.ClasslistRoleDisplayName
                                    || (v.Roles && v.Roles[0] && (v.Roles[0].DisplayName || v.Roles[0].Name)) || "";
                    out.push({ role_name: roleName, orgDefinedId: orgDefinedId });
                }
            }

            const nb = nextBookmark(page);
            const hm = hasMore(page);
            if (!nb || seenB.has(nb) || (!hm && !nb)) break;
            seenB.add(nb);
            bookmark = nb;
            guard++;
            if (guard > 2000) break;
        } catch (e) {
            logLine(`WARN: Failed to get classlist for ${orgUnitId}: ${e.message}`);
            break;
        }
    }

    return out;
}

// Hydrate Code if missing (courses/{orgUnitId})
async function hydrateCourseCodeIfMissing(ouLite) {
    const code = ouLite.Code || "";
    if (code) return code;
    const id = String(ouLite.Identifier || ouLite.Id || "");
    if (!id) return "";
    try {
        const url = `/d2l/api/lp/${LP_VER}/courses/${id}`;
        const course = await D2LApi._fetch(url);
        const c = (course && (course.Code || (course.CourseOffering && course.CourseOffering.Code))) || "";
        return c || "";
    } catch (e) {
        return "";
    }
}

/* ---------- MAIN RUN ---------- */
async function run() {
    // Clear log
    logEl.innerHTML = "";
    // VERBOSE remains false; advanced options are fixed in code

    const semesterId = semesterSelect.value;
    if (!semesterId) {
        alert("Please select a semester first.");
        return;
    }

    runBtn.disabled = true;
    const rows = [];
    rows.push(["active", "role_name", "person_id", "course_section_merged", "course_section_merged_name", "primary_section", "primary_section_name"]);

    try {
        setStatus("Scanning MERGED courses…");
        let merged = await getMergedCoursesForSemester(semesterId);

        if (LIMIT_COURSES > 0 && merged.length > LIMIT_COURSES) {
            merged = merged.slice(0, LIMIT_COURSES);
        }
        if (merged.length === 0) {
            setStatus("No MERGED courses found.");
            runBtn.disabled = false;
            return;
        }

        setStatus("Reading CRNs from MERGED courses…");
        logLine(`Found ${merged.length} MERGED courses`);

        // 1) For each MERGED offering, read its CRN(s) from /sections/
        const mergedInfo = await mapWithConcurrency(merged, CONCURRENCY, async (ou) => {
            const mergedOfferingId = String(ou.Identifier || ou.Id || "");
            let mergedCode = ou.Code || "";
            if (!mergedCode) mergedCode = await hydrateCourseCodeIfMissing(ou);

            const mergedName = ou.Name || "";

            const sections = await getSectionsForCourseOffering(mergedOfferingId);
            const crns = getSectionCRNsFromSections(sections);

            return {
                mergedOfferingId: mergedOfferingId,
                mergedCode: mergedCode,
                mergedName: mergedName,
                crns: crns
            };
        });

        // Build CRN set for only merged CRNs
        const mergedCRNSet = {};
        for (let i = 0; i < mergedInfo.length; i++) {
            const mi = mergedInfo[i];
            if (!mi || mi.__error) continue;
            for (let c = 0; c < (mi.crns || []).length; c++) {
                mergedCRNSet[mi.crns[c]] = true;
            }
        }
        const mergedCRNs = Object.keys(mergedCRNSet);

        if (mergedCRNs.length === 0) {
            setStatus("MERGED courses found, but no CRNs returned from /sections/. Check permissions.");
            runBtn.disabled = false;
            return;
        }

        setStatus("Scanning semester courses to match Primary by CRN…");
        logLine(`Found ${mergedCRNs.length} unique CRNs from MERGED courses`);

        // 2) Get all offerings for semester (then scan only non-merged candidates)
        const allOfferings = await getAllCourseOfferingsForSemester(semesterId);

        const primaryCandidates = [];
        for (let p = 0; p < allOfferings.length; p++) {
            const oup = allOfferings[p];
            if (!isMergedOfferingName(oup.Name || "")) {
                primaryCandidates.push(oup);
            }
        }

        logLine(`Scanning ${primaryCandidates.length} non-merged course offerings for CRN matches`);

        // 3) Build map CRN -> Primary offering
        const crnToPrimary = {}; // crn => { id, code, name }
        await mapWithConcurrency(primaryCandidates, CONCURRENCY, async (ou) => {
            // soft short-circuit
            if (Object.keys(crnToPrimary).length >= mergedCRNs.length) return;

            const offeringId = String(ou.Identifier || ou.Id || "");
            const offeringName = ou.Name || "";

            let offeringCode = ou.Code || "";
            if (!offeringCode) offeringCode = await hydrateCourseCodeIfMissing(ou);

            const secs = await getSectionsForCourseOffering(offeringId);
            if (!secs.length) return;

            for (let s = 0; s < secs.length; s++) {
                const crn = String(secs[s] && secs[s].Code ? secs[s].Code : "");
                if (!crn) continue;

                if (mergedCRNSet[crn] && !crnToPrimary[crn]) {
                    crnToPrimary[crn] = { id: offeringId, code: offeringCode || "", name: offeringName || "" };
                }
            }
        });

        logLine(`Matched ${Object.keys(crnToPrimary).length} CRNs to primary courses`);

        setStatus("Generating rows from MERGED classlists…");

        // 4) For each merged offering, pull classlist and stamp primary by CRN match
        let processed = 0;
        const total = mergedInfo.length;

        const resultChunks = await mapWithConcurrency(mergedInfo, CONCURRENCY, async (mi) => {
            if (!mi || mi.__error) return [];

            const mergedOfferingId = mi.mergedOfferingId;
            const mergedCode = mi.mergedCode || "";
            const mergedName = mi.mergedName || "";

            let primaryCode = "";
            let primaryName = "";

            for (let k = 0; k < (mi.crns || []).length; k++) {
                const crn = mi.crns[k];
                if (crnToPrimary[crn]) {
                    primaryCode = crnToPrimary[crn].code || "";
                    primaryName = crnToPrimary[crn].name || "";
                    break;
                }
            }

            const users = await getActiveClasslist(mergedOfferingId);

            const localRows = [];
            for (let j = 0; j < users.length; j++) {
                const urow = users[j];
                localRows.push([
                    "active",
                    urow.role_name || "",
                    urow.orgDefinedId || "",
                    mergedCode || "",
                    mergedName || "",
                    primaryCode || "",
                    primaryName || ""
                ]);
            }

            processed++;
            if (processed % 5 === 0 || processed === total) {
                setStatus(`Processed ${processed} / ${total} merged courses…`);
            }

            return localRows;
        });

        // flatten
        for (let r = 0; r < resultChunks.length; r++) {
            const chunk = resultChunks[r];
            if (!chunk || chunk.__error) continue;
            for (let x = 0; x < chunk.length; x++) {
                rows.push(chunk[x]);
            }
        }

        setStatus(`Building CSV (${rows.length - 1} rows) …`);
        downloadCSV("merged-classlist-with-primary-" + semesterId + ".csv", rows);
        setStatus("Done. CSV downloaded.");
        
        logLine("FINAL:");
        logLine(`  Merged courses: ${mergedInfo.length}`);
        logLine(`  Rows: ${rows.length - 1}`);
        logLine(`  Mapped CRNs: ${Object.keys(crnToPrimary).length}`);
        
        console.log("FINAL:", {
            mergedCourses: mergedInfo.length,
            rows: rows.length - 1,
            mappedCRNs: Object.keys(crnToPrimary).length
        });

    } catch (e) {
        setStatus("Error. See log/console.");
        logLine("ERROR (run): " + e.message);
        console.error(e);
    } finally {
        runBtn.disabled = false;
    }
}