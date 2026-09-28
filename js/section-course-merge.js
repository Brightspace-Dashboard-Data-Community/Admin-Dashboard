/**
 * Course Section Association (merge): re-parent section org units from source course offerings
 * to a destination (main) offering — IPSIS-style section association without Enrollment API moves.
 */

const LP_VER = '1.49';

function getField(row, wanted) {
    const lw = String(wanted).toLowerCase();
    for (const k of Object.keys(row)) {
        if (String(k).toLowerCase().trim() === lw) return row[k];
    }
    return '';
}

function getDestinationCode(row) {
    const v =
        getField(row, 'MAIN_COURSE') ||
        getField(row, 'MAIN') ||
        getField(row, 'DESTINATION_COURSE') ||
        getField(row, 'DestinationCourseCode') ||
        getField(row, 'DESTINATION');
    return v != null ? String(v).trim() : '';
}

/** Accepts numeric org unit ids from CSV (including Excel-style floats). */
function parseOuId(val) {
    if (val == null || val === '') return '';
    const s0 = String(val).trim();
    if (!s0) return '';
    const n = Number(s0);
    if (!Number.isFinite(n) || n <= 0) return '';
    return String(Math.trunc(n));
}

/**
 * @returns {{ id: string, code: string }} id and/or code; prefer id at resolve time.
 */
function getDestinationRef(row) {
    const id =
        parseOuId(getField(row, 'MAIN_ORG_UNIT_ID')) ||
        parseOuId(getField(row, 'DESTINATION_ORG_UNIT_ID')) ||
        parseOuId(getField(row, 'MAIN_OU_ID')) ||
        parseOuId(getField(row, 'DESTINATION_OU_ID')) ||
        parseOuId(getField(row, 'MAIN_ORGUNITID')) ||
        parseOuId(getField(row, 'DESTINATION_ORGUNITID'));
    const code = getDestinationCode(row);
    return { id: id || '', code: code || '' };
}

/**
 * Up to two sources: secondary + optional third. Each may use org unit id and/or course code.
 * @returns {Array<{ id: string, code: string }>}
 */
function getSourceRefs(row) {
    const refs = [];
    const id1 =
        parseOuId(getField(row, 'SECONDARY_ORG_UNIT_ID')) ||
        parseOuId(getField(row, 'SOURCE_ORG_UNIT_ID')) ||
        parseOuId(getField(row, 'SECONDARY_OU_ID')) ||
        parseOuId(getField(row, 'SECONDARY_ORGUNITID'));
    const code1 =
        getField(row, 'SECONDARY_COURSE') ||
        getField(row, 'SOURCE_COURSE') ||
        getField(row, 'SourceCourseCode') ||
        getField(row, 'SECONDARY');
    const id2 =
        parseOuId(getField(row, 'THIRD_ORG_UNIT_ID')) ||
        parseOuId(getField(row, 'THIRD_OU_ID')) ||
        parseOuId(getField(row, 'THIRD_ORGUNITID'));
    const code2 = getField(row, 'THIRD_COURSE') || getField(row, 'THIRD');

    const pushIf = (id, code) => {
        const c = code != null ? String(code).trim() : '';
        if (id || c) refs.push({ id: id || '', code: c });
    };

    pushIf(id1, code1);
    pushIf(id2, code2);
    return refs;
}

/**
 * @param {{ id: string, code: string }} ref
 * @returns {Promise<{ ouId: string, label: string } | null>}
 */
async function resolveToOrgUnitId(ref) {
    if (ref.id) {
        return { ouId: ref.id, label: `OU ${ref.id}` };
    }
    if (ref.code) {
        const ou = await findOrgUnitByExactCode(ref.code);
        if (!ou) return null;
        return { ouId: String(ou.Identifier || ou.Id), label: ref.code.trim() };
    }
    return null;
}

function nowTime() {
    const d = new Date();
    const z = (n) => (n < 10 ? '0' : '') + n;
    return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
}

function logLine(msg) {
    const line = nowTime() + ' ' + msg;
    const el = document.getElementById('log');
    if (el) {
        el.textContent += (el.textContent ? '\n' : '') + line;
        el.scrollTop = el.scrollHeight;
    }
    console.log(line);
}

function resetLog() {
    const el = document.getElementById('log');
    if (el) el.textContent = '';
}

async function brightspaceRequest(url, options = {}) {
    const token = localStorage.getItem('XSRF.Token');
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
    };
    if (token) headers['X-CSRF-Token'] = token;
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    const newToken = response.headers.get('x-csrf-token');
    if (newToken) localStorage.setItem('XSRF.Token', newToken);
    const text = await response.text();
    let data = null;
    if (text && text.trim()) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }
    return { ok: response.ok, status: response.status, data };
}

function itemsFromPaged(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.Items && Array.isArray(data.Items)) return data.Items;
    if (data.Objects && Array.isArray(data.Objects)) return data.Objects;
    return [];
}

async function findOrgUnitByExactCode(code) {
    const c = String(code).trim();
    if (!c) return null;
    let bookmark = null;
    for (let guard = 0; guard < 40; guard++) {
        let url = `/d2l/api/lp/${LP_VER}/orgstructure/?exactOrgUnitCode=${encodeURIComponent(c)}&pageSize=100`;
        if (bookmark) url += `&bookmark=${encodeURIComponent(bookmark)}`;
        const res = await brightspaceRequest(url);
        if (!res.ok) {
            throw new Error(`Org lookup failed (${res.status}) for code "${c}"`);
        }
        const items = itemsFromPaged(res.data);
        const exact = items.filter((it) => String((it && it.Code) || '').trim() === c);
        if (exact.length === 1) return exact[0];
        if (exact.length > 1) {
            const course = exact.find((it) => it.Type && (it.Type.Id === 3 || it.Type.Code === 'Course Offering'));
            return course || exact[0];
        }
        const p = res.data && res.data.PagingInfo;
        const hasMore = p && p.HasMoreItems;
        bookmark = (p && p.Bookmark) || (res.data && res.data.Next);
        if (!hasMore || !bookmark) break;
    }
    return null;
}

async function getSectionsForCourseOffering(courseOfferingId) {
    const url = `/d2l/api/lp/${LP_VER}/${courseOfferingId}/sections/`;
    const res = await brightspaceRequest(url);
    if (!res.ok) {
        throw new Error(`Sections GET failed (${res.status}) for course ${courseOfferingId}`);
    }
    const raw = res.data;
    const items = raw && (raw.Items || raw.Objects || raw.items) ? raw.Items || raw.Objects || raw.items : raw;
    return Array.isArray(items) ? items : [];
}

function sectionOrgUnitId(section) {
    if (!section) return '';
    const id = section.Identifier ?? section.SectionId ?? section.Id ?? section.OrgUnitId;
    return id != null ? String(id) : '';
}

function destAlreadyHasSection(destSectionList, sectionOuId) {
    return destSectionList.some((s) => sectionOrgUnitId(s) === sectionOuId);
}

/** Brightspace returns 400 when orgstructure cannot detach Section/Group children. */
function isParentsCannotChangeError(data) {
    if (!data || typeof data !== 'object') return false;
    const errs = data.Errors;
    if (!Array.isArray(errs)) return false;
    return errs.some(
        (e) => e && e.Message && String(e.Message).includes('Parents cannot be changed')
    );
}

function stringifyApiBody(data) {
    if (typeof data === 'string') return data;
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
}

/**
 * Valence: POST body must be a single JSON number (not an object).
 */
async function linkSectionToCourse(destCourseOuId, sectionOuId) {
    const num = Number(sectionOuId);
    if (!Number.isFinite(num)) {
        return { ok: false, status: 0, data: 'Invalid section org unit id' };
    }
    const url = `/d2l/api/lp/${LP_VER}/orgstructure/${destCourseOuId}/children/`;
    return brightspaceRequest(url, { method: 'POST', body: JSON.stringify(num) });
}

async function unlinkSectionFromCourse(sourceCourseOuId, sectionOuId) {
    const url = `/d2l/api/lp/${LP_VER}/orgstructure/${sourceCourseOuId}/children/${sectionOuId}`;
    return brightspaceRequest(url, { method: 'DELETE' });
}

async function deactivateCourseOffering(courseOuId) {
    const getUrl = `/d2l/api/lp/${LP_VER}/courses/${courseOuId}`;
    const got = await brightspaceRequest(getUrl);
    if (!got.ok) {
        throw new Error(`GET course failed (${got.status}) for OU ${courseOuId}`);
    }
    const course = got.data;
    const payload = {
        Name: course.Name,
        Code: course.Code,
        Path: course.Path,
        CourseTemplateId: parseInt(course.CourseTemplate?.Identifier, 10) || 0,
        SemesterId: parseInt(course.Semester?.Identifier, 10) || 0,
        StartDate: course.StartDate,
        EndDate: course.EndDate,
        StartDateAvailabilityType: course.StartDateAvailabilityType ?? 1,
        EndDateAvailabilityType: course.EndDateAvailabilityType ?? 1,
        LocaleId: course.LocaleId ?? null,
        ForceLocale: course.ForceLocale ?? false,
        ShowAddressBook: course.ShowAddressBook ?? false,
        Description: {
            Content: course.Description?.Html || '',
            Type: 'Text|Html'
        },
        CanSelfRegister: course.CanSelfRegister ?? false,
        IsActive: false
    };
    const putUrl = `/d2l/api/lp/${LP_VER}/courses/${courseOuId}`;
    return brightspaceRequest(putUrl, { method: 'PUT', body: JSON.stringify(payload) });
}

/**
 * @param {{ ouId: string, label: string }} dest
 * @param {{ ouId: string, label: string }} source
 */
async function mergeOneSourceIntoDestination(dest, source, previewOnly) {
    const destId = dest.ouId;
    const sourceId = source.ouId;
    const destLabel = dest.label;
    const sourceLabel = source.label;

    logLine(`── Destination ${destLabel} ← source ${sourceLabel}`);

    if (destId === sourceId) {
        logLine(`ERROR: Source and destination are the same org unit (${destId}). Skipping.`);
        return;
    }

    let sourceSections = await getSectionsForCourseOffering(sourceId);
    let destSections = await getSectionsForCourseOffering(destId);

    if (sourceSections.length === 0) {
        logLine(`WARN: No sections on source course ${sourceId} (${sourceLabel}).`);
    }

    let sectionMoveFailed = false;

    for (let i = 0; i < sourceSections.length; i++) {
        const sec = sourceSections[i];
        const secId = sectionOrgUnitId(sec);
        const secCode = (sec && sec.Code) || secId;
        if (!secId) {
            logLine(`WARN: Section without identifier skipped (index ${i}).`);
            continue;
        }

        if (destAlreadyHasSection(destSections, secId)) {
            logLine(`SKIP: Section ${secCode} (OU ${secId}) already on destination — no action.`);
            continue;
        }

        if (previewOnly) {
            logLine(`PREVIEW: Would unlink ${secId} from ${sourceId}, link to ${destId}.`);
            continue;
        }

        const un = await unlinkSectionFromCourse(sourceId, secId);
        if (!un.ok) {
            sectionMoveFailed = true;
            const body = stringifyApiBody(un.data);
            logLine(`ERROR: Unlink section ${secId} from source failed (${un.status}). ${body}`);
            if (isParentsCannotChangeError(un.data)) {
                logLine(
                    `NOTE: Brightspace does not allow changing parents for Section/Group org units via orgstructure children APIs. ` +
                        `IPSIS-style section association is enforced by the platform/SIS integration, not this Valence workflow. ` +
                        `Use your SIS merge / Brightspace section-association process, or contact D2L support for supported options.`
                );
            }
            continue;
        }

        const ln = await linkSectionToCourse(destId, secId);
        if (!ln.ok) {
            sectionMoveFailed = true;
            const msg = stringifyApiBody(ln.data);
            if (ln.status === 400 || ln.status === 409) {
                logLine(`SKIP: Link section ${secId} to destination failed (${ln.status}) — may already be associated. ${msg}`);
            } else {
                logLine(`ERROR: Link section ${secId} to destination failed (${ln.status}). ${msg}`);
            }
            continue;
        }

        logLine(`OK: Section ${secCode} (OU ${secId}) moved to destination.`);
        destSections = await getSectionsForCourseOffering(destId);
    }

    if (previewOnly) {
        logLine(`PREVIEW: Would set source course ${sourceLabel} (OU ${sourceId}) IsActive=false.`);
        return;
    }

    if (sectionMoveFailed) {
        logLine(
            `WARN: Leaving source ${sourceLabel} (OU ${sourceId}) active — at least one section move failed; source was not set inactive.`
        );
        return;
    }

    const deact = await deactivateCourseOffering(sourceId);
    if (!deact.ok) {
        logLine(`ERROR: Could not deactivate source course ${sourceLabel} (${deact.status}).`);
    } else {
        logLine(`OK: Source course ${sourceLabel} (OU ${sourceId}) set to inactive.`);
    }
}

async function runMerge() {
    const fileInput = document.getElementById('csvFile');
    const previewOnly = document.getElementById('previewOnly') && document.getElementById('previewOnly').checked;
    const runBtn = document.getElementById('runBtn');

    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        alert('Choose a CSV file first.');
        return;
    }

    if (!previewOnly) {
        const ok = window.confirm(
            'This will unlink section org units from each source course, attach them to the destination (main) course, and set each source offering to inactive. Continue?'
        );
        if (!ok) return;
    }

    runBtn.disabled = true;
    resetLog();
    logLine(previewOnly ? 'Starting PREVIEW (no API changes)…' : 'Starting section association…');

    const file = fileInput.files[0];

    try {
        const rows = await new Promise((resolve, reject) => {
            // global Papa from CDN
            Papa.parse(file, {
                header: true,
                skipEmptyLines: 'greedy',
                complete: (res) => resolve(res.data || []),
                error: reject
            });
        });

        let processed = 0;
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const destRef = getDestinationRef(row);
            const sourceRefs = getSourceRefs(row);

            if (!destRef.id && !destRef.code) {
                logLine(`Row ${r + 2}: skipped — set MAIN_ORG_UNIT_ID (or DESTINATION_ORG_UNIT_ID) and/or MAIN_COURSE.`);
                continue;
            }
            if (sourceRefs.length === 0) {
                logLine(`Row ${r + 2}: skipped — no SECONDARY_ORG_UNIT_ID / THIRD_ORG_UNIT_ID and/or SECONDARY_COURSE / THIRD_COURSE.`);
                continue;
            }

            const destResolved = await resolveToOrgUnitId(destRef);
            if (!destResolved) {
                logLine(`Row ${r + 2}: ERROR — destination not found (code lookup failed for "${destRef.code || '(no code)'}").`);
                continue;
            }

            logLine(`======== Row ${r + 1} (sheet line ${r + 2}) ========`);

            for (let s = 0; s < sourceRefs.length; s++) {
                const srcResolved = await resolveToOrgUnitId(sourceRefs[s]);
                if (!srcResolved) {
                    const hint = sourceRefs[s].code || sourceRefs[s].id || '(empty)';
                    logLine(`ERROR: Source ${s + 1} not resolved — no org unit id and code lookup failed for "${hint}".`);
                    continue;
                }
                await mergeOneSourceIntoDestination(destResolved, srcResolved, previewOnly);
            }
            processed++;
        }

        logLine(`Done. Processed ${processed} data row(s).`);
    } catch (e) {
        logLine(`FATAL: ${e && e.message ? e.message : e}`);
        console.error(e);
    } finally {
        runBtn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const runBtn = document.getElementById('runBtn');
    if (runBtn) runBtn.addEventListener('click', () => runMerge());
});
