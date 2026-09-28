/**
 * Enrollment Checker — Ellucian Insights edition (User Adds & Drops Audit)
 *
 * Same logic as enrollment-checker.js; only the CSV column names differ.
 * Insights exports use lowercase snake_case (person_id, sec_name, etc.) and may
 * drop leading zeros from person_id — handled via orgDefinedIdCandidates.
 */

// ---- Config (mirrors enrollment-checker.js) --------------------------------
const ENROLL_CODES = new Set(['A', 'N']);
const DROP_CODES = new Set(['D', 'X', 'NP', 'C']);
const DEDUPE_INCLUDE_TERM = true;
const STUDENT_ROLE_ID = 101;
const COURSE_OFFERING_TYPE_ID = 3;
/** Terms always listed in the dropdown and used by the "Current terms" filter. */
const CURRENT_AUDIT_TERMS = ['26/FA', '26/SP'];
const CURRENT_TERMS_VALUE = '__current__';

// ---- Utilities -------------------------------------------------------------
const norm = (s) => String(s ?? '').toUpperCase();
const txt = (v) => String(v ?? '').trim();

const toDate = (d) => {
    const dt = new Date(d);
    if (!isNaN(dt)) return dt;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(String(d).trim());
    if (m) {
        const mm = parseInt(m[1], 10) - 1;
        const dd = parseInt(m[2], 10);
        const yy = parseInt(m[3], 10);
        const year = yy + (yy >= 70 ? 1900 : 2000);
        return new Date(year, mm, dd);
    }
    return new Date(0);
};

const expectedFromStatus = (status) => {
    const s = String(status || '').toUpperCase().trim();
    if (ENROLL_CODES.has(s)) return true;
    if (DROP_CODES.has(s)) return false;
    return null;
};

/** person_id may lack leading zeros — try common pad lengths for API lookup. */
function orgDefinedIdCandidates(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) return [];
    const trimmed = digits.replace(/^0+/, '') || '0';
    const set = new Set([digits, trimmed]);
    for (const len of [7, 8, 9, 10]) {
        set.add(trimmed.padStart(len, '0'));
    }
    return [...set];
}

/** Resolve header keys from the Insights CSV (supports current and legacy column names). */
function resolveColumns(headerRow) {
    const keys = Object.keys(headerRow || {});
    const find = (pred) => keys.find(pred) || null;
    const lc = (k) => String(k).toLowerCase();

    return {
        term: find(k => lc(k) === 'term') || find(k => lc(k) === 'stc_term') || find(k => lc(k).includes('term')),
        personId: find(k => lc(k) === 'person_id') || find(k => lc(k) === 'stc_person_id'),
        status: find(k => lc(k) === 'status') || find(k => lc(k) === 'stc_current_status') ||
            find(k => lc(k).includes('status') && !lc(k).includes('date')),
        statusDate: find(k => lc(k) === 'stc_status_date') ||
            find(k => lc(k).includes('status') && lc(k).includes('date')),
        title: find(k => lc(k) === 'sec_title') || find(k => lc(k) === 'stc_title') || find(k => lc(k).includes('title')),
        courseName: find(k => lc(k) === 'course_name') || find(k => lc(k) === 'stc_course_name'),
        sectionNo: find(k => lc(k) === 'section') || find(k => lc(k) === 'stc_section_no'),
        sectionName: find(k => lc(k) === 'sec_name') || find(k => lc(k) === 'section_name'),
        combined: find(k => lc(k).startsWith('combined')),
        firstName: find(k => lc(k) === 'first_name') || find(k => lc(k).includes('first_name')),
        lastName: find(k => lc(k) === 'last_name') || find(k => lc(k).includes('last_name')),
        email: find(k => lc(k) === 'delta_email') || find(k => lc(k).includes('email'))
    };
}

/** Section key for D2L matching — sec_name is the Section_Name equivalent. */
function sectionNameForRow(row, cols) {
    if (cols.combined && txt(row[cols.combined])) return txt(row[cols.combined]);
    if (cols.sectionName && txt(row[cols.sectionName])) return txt(row[cols.sectionName]);
    const cn = cols.courseName ? txt(row[cols.courseName]) : '';
    const sn = cols.sectionNo ? txt(row[cols.sectionNo]) : '';
    if (cn && sn) return `${cn}-${sn}`;
    return '';
}

/** Map an Insights CSV row to the canonical shape used by enrollment-checker.js. */
function normalizeRow(r, cols) {
    return {
        Term: cols.term ? txt(r[cols.term]) : '',
        STATUS: cols.status ? txt(r[cols.status]) : '',
        STC_STATUS_DATE: cols.statusDate ? txt(r[cols.statusDate]) : '',
        FIRST_NAME: cols.firstName ? txt(r[cols.firstName]) : '',
        LAST_NAME: cols.lastName ? txt(r[cols.lastName]) : '',
        Person_ID: cols.personId ? txt(r[cols.personId]) : '',
        Email_Address: cols.email ? txt(r[cols.email]) : '',
        Section_Name: sectionNameForRow(r, cols),
        Course_Name: cols.courseName ? txt(r[cols.courseName]) : '',
        Section: cols.sectionNo ? txt(r[cols.sectionNo]) : '',
        SEC_TITLE: cols.title ? txt(r[cols.title]) : ''
    };
}

// ---- API helpers (same pattern as enrollment-checker.js) -------------------
async function fetchUserByOrgDefinedId(orgDefinedId) {
    for (const id of orgDefinedIdCandidates(orgDefinedId)) {
        try {
            const out = await D2LApi._fetch(
                `/d2l/api/lp/1.46/users/?orgDefinedId=${encodeURIComponent(id)}`
            );
            const user = out?.[0];
            if (user?.UserId) {
                return { user, orgDefinedId: user.OrgDefinedId || id };
            }
        } catch (_) {
            /* try next candidate */
        }
    }
    return null;
}

async function fetchAllEnrollmentsForUser(userId) {
    const items = [];
    let url = `/d2l/api/lp/1.51/enrollments/users/${userId}/orgUnits/`;
    let guard = 0;

    do {
        const page = await D2LApi._fetch(url);
        const pageItems = Array.isArray(page) ? page : (page?.Items || []);
        items.push(...pageItems);

        const hasMore = !!(page?.PagingInfo?.HasMoreItems || page?.PagingInfo?.MoreItems);
        const bookmark = page?.PagingInfo?.Bookmark || page?.Bookmark;
        url = hasMore && bookmark
            ? `/d2l/api/lp/1.51/enrollments/users/${userId}/orgUnits/?bookmark=${encodeURIComponent(bookmark)}`
            : null;
    } while (url && ++guard < 50);

    return items;
}

/** Same matching logic as enrollment-checker.js — Code prefix + term token. */
function findEnrollmentForSection(enrollments, sectionNameRaw, termRaw) {
    const targetSection = norm(sectionNameRaw).trim();
    const termToken = norm(termRaw).trim();
    const sectionPrefix = `${targetSection}-`;

    const candidates = enrollments.filter(e =>
        e?.Role?.Id === STUDENT_ROLE_ID &&
        e?.OrgUnit?.Type?.Id === COURSE_OFFERING_TYPE_ID
    );

    for (const e of candidates) {
        const code = norm(e?.OrgUnit?.Code || '');
        if (!code) continue;
        if (!code.startsWith(sectionPrefix)) continue;
        if (termToken && !code.includes(termToken)) continue;
        return e;
    }

    for (const e of candidates) {
        const name = norm(e?.OrgUnit?.Name || '');
        if (name.startsWith(targetSection + ' ')) {
            if (!termToken || name.includes(termToken)) return e;
        }
    }

    return null;
}

// ---- Dedup (same as enrollment-checker.js) ---------------------------------
function latestRows(rows) {
    const groups = new Map();
    for (const r of rows) {
        const pid = (r.Person_ID || '').trim();
        const sec = (r.Section_Name || '').trim();
        const term = (r.Term || '').trim();
        if (!pid || !sec) continue;
        const key = DEDUPE_INCLUDE_TERM ? `${pid}|${sec}|${term}` : `${pid}|${sec}`;
        const arr = groups.get(key) || [];
        arr.push(r);
        groups.set(key, arr);
    }

    const latest = [];
    for (const arr of groups.values()) {
        arr.sort((a, b) => toDate(b.STC_STATUS_DATE) - toDate(a.STC_STATUS_DATE));
        latest.push(arr[0]);
    }
    return latest;
}

// ---- UI --------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const tableEl = $('#resultsTable');
const tbodyEl = $('#resultsTable tbody');
const downloadBtn = $('#downloadBtn');
const termFilter = $('#termFilter');
const auditSummaryEl = $('#auditSummary');

function renderAuditSummary(stats) {
    if (!auditSummaryEl || !stats) return;
    const cards = [
        { label: 'CSV Rows', value: stats.csvRows },
        { label: 'Term-Scoped Rows', value: stats.scopedRows },
        { label: 'Latest Actions Checked', value: stats.latestRows },
        { label: 'Compared Against D2L', value: stats.processedRows },
        { label: 'Mismatches Found', value: stats.mismatches },
        { label: 'Matched Expectations', value: stats.matched },
        { label: 'Expected Enroll', value: stats.expectedEnroll },
        { label: 'Expected Remove', value: stats.expectedDrop },
        { label: 'Skipped Missing Fields', value: stats.skippedMissingFields },
        { label: 'Skipped Unknown Status', value: stats.skippedUnknownStatus },
        { label: 'API Lookup Errors', value: stats.apiErrors }
    ];

    auditSummaryEl.innerHTML = cards.map((card) => `
        <div class="audit-summary-item">
            <div class="audit-summary-label">${card.label}</div>
            <div class="audit-summary-value">${card.value}</div>
        </div>
    `).join('');
    auditSummaryEl.style.display = 'grid';
}

function termRecency(code) {
    const m = /(\d{2})\/(WI|SP|FA)/i.exec(String(code || ''));
    if (!m) return 0;
    const rank = { WI: 1, SP: 2, FA: 3 };
    return parseInt(m[1], 10) * 10 + (rank[m[2].toUpperCase()] || 0);
}

function collectTermsFromRows(rows) {
    const terms = new Set(CURRENT_AUDIT_TERMS);
    for (const r of rows || []) {
        const t = (r.Term || '').trim();
        if (t) terms.add(t);
    }
    return [...terms].sort((a, b) => termRecency(b) - termRecency(a) || a.localeCompare(b));
}

function rowMatchesTermFilter(row, selectedTerm) {
    const term = String(row.Term || '').trim();
    if (!selectedTerm) return true;
    if (selectedTerm === CURRENT_TERMS_VALUE) return CURRENT_AUDIT_TERMS.includes(term);
    return term === selectedTerm;
}

function populateTermDropdown(rows, selectedTerm = CURRENT_TERMS_VALUE) {
    const sorted = collectTermsFromRows(rows);
    if (!termFilter) return;
    const currentLabel = `Current terms (${CURRENT_AUDIT_TERMS.join(', ')})`;
    termFilter.innerHTML =
        `<option value="${CURRENT_TERMS_VALUE}">${currentLabel}</option>` +
        `<option value="">All Terms</option>` +
        sorted.map(t => `<option value="${t}">${t}</option>`).join('');
    const valid = selectedTerm === CURRENT_TERMS_VALUE
        || selectedTerm === ''
        || sorted.includes(selectedTerm);
    termFilter.value = valid ? selectedTerm : CURRENT_TERMS_VALUE;
}

let resultsTable = null;

function render(rows, stats = null) {
    tbodyEl.innerHTML = '';

    for (const row of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.orgDefinedId}</td>
            <td>${row.firstName}</td>
            <td>${row.lastName}</td>
            <td>${row.email}</td>
            <td>${row.term}</td>
            <td>${row.section}</td>
            <td>${row.course}</td>
            <td>${row.d2lStatus}</td>
            <td>${row.sisStatus}</td>
            <td>${row.action}</td>
            <td>${row.statusDate || ''}</td>
        `;
        tbodyEl.appendChild(tr);
    }

    if (resultsTable) resultsTable.destroy();
    if (window.jQuery?.fn?.DataTable) {
        resultsTable = window.jQuery(tableEl).DataTable({
            pageLength: 25,
            dom: '<"top"if>rt<"bottom"lp><"clear">',
            order: [[9, 'asc'], [5, 'asc']],
            autoWidth: false,
            columnDefs: [{ targets: [3, 5], className: 'cell-wrap' }],
            language: { emptyTable: 'No mismatches found. 🎉' }
        });
    } else {
        resultsTable = null;
    }

    tableEl.style.display = 'table';
    downloadBtn.style.display = 'inline-block';
    renderAuditSummary(stats);

    $('#totalStudents').textContent = rows.length;
    $('#coursesScanned').textContent = new Set(rows.map(r => r.section)).size;

    downloadBtn.onclick = () => {
        const csvRows = rows.map(r => ({
            OrgDefinedId: r.orgDefinedId,
            First_Name: r.firstName,
            Last_Name: r.lastName,
            Email: r.email,
            Term: r.term,
            Section: r.section,
            Course: r.course,
            D2L_Status: r.d2lStatus,
            SIS_Status: r.sisStatus,
            Action_Needed: r.action,
            Status_Date: r.statusDate || '',
            D2L_OrgUnitId: r.orgUnitId || ''
        }));
        const blob = new Blob([Papa.unparse(csvRows)], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'adds-drops-changes-for-oit.csv';
        a.click();
        URL.revokeObjectURL(url);
    };
}

// ---- Core audit (same flow as enrollment-checker.js) -----------------------
async function runAudit(file) {
    const startBtn = $('#startAuditBtn');
    startBtn.disabled = true;
    statusEl.style.display = 'block';
    statusEl.textContent = '⏳ Parsing CSV…';
    LoadingUtils.showLoadingBar('loadingContainer');
    LoadingUtils.updateLoadingBar(5, 'Parsing CSV...', 'loadingContainer');

    const stats = {
        csvRows: 0,
        scopedRows: 0,
        latestRows: 0,
        processedRows: 0,
        mismatches: 0,
        matched: 0,
        expectedEnroll: 0,
        expectedDrop: 0,
        skippedMissingFields: 0,
        skippedUnknownStatus: 0,
        apiErrors: 0
    };

    const parsed = await new Promise((resolve, reject) => {
        Papa.parse(file, { header: true, skipEmptyLines: true, complete: resolve, error: reject });
    });

    const rawData = parsed.data || [];
    if (!rawData.length) {
        render([], stats);
        statusEl.textContent = '✅ Audit complete. CSV had no data rows.';
        startBtn.disabled = false;
        LoadingUtils.hideLoadingBar('loadingContainer');
        return;
    }

    const cols = resolveColumns(rawData[0]);
    if (!cols.personId || (!cols.sectionName && !(cols.courseName && cols.sectionNo))) {
        alert('Could not find required columns. Expected at minimum "person_id" and either "sec_name" or both "course_name" and "section".');
        startBtn.disabled = false;
        LoadingUtils.hideLoadingBar('loadingContainer');
        return;
    }

    const data = rawData.map(r => normalizeRow(r, cols));
    stats.csvRows = data.length;

    const prevTerm = termFilter?.value ?? CURRENT_TERMS_VALUE;
    populateTermDropdown(data, prevTerm);
    const selectedTerm = termFilter?.value ?? CURRENT_TERMS_VALUE;

    const scoped = data.filter(r => rowMatchesTermFilter(r, selectedTerm));
    stats.scopedRows = scoped.length;

    const latest = latestRows(scoped);
    stats.latestRows = latest.length;
    statusEl.textContent = `🔎 Checking ${latest.length} latest add/drop actions against D2L…`;
    LoadingUtils.updateLoadingBar(10, `Checking ${latest.length} actions...`, 'loadingContainer');

    if (!latest.length) {
        render([], stats);
        statusEl.textContent = '✅ Audit complete. No rows to verify.';
        startBtn.disabled = false;
        LoadingUtils.hideLoadingBar('loadingContainer');
        return;
    }

    const userCache = new Map();
    const results = [];
    let processed = 0;

    for (const r of latest) {
        const orgDefinedId = (r.Person_ID || '').trim();
        const sectionName = (r.Section_Name || '').trim();
        const statusCode = (r.STATUS || '').trim();
        const firstName = (r.FIRST_NAME || '').trim();
        const lastName = (r.LAST_NAME || '').trim();
        const email = (r.Email_Address || '').trim();
        const term = (r.Term || '').trim();
        const dateChange = (r.STC_STATUS_DATE || '').trim();
        const course = (r.Course_Name || '').trim();

        if (!orgDefinedId || !sectionName || !statusCode) {
            stats.skippedMissingFields++;
            continue;
        }

        const expected = expectedFromStatus(statusCode);
        if (expected === null) {
            stats.skippedUnknownStatus++;
            continue;
        }
        if (expected) stats.expectedEnroll++;
        else stats.expectedDrop++;

        try {
            let cached = userCache.get(orgDefinedId);
            if (!cached) {
                const found = await fetchUserByOrgDefinedId(orgDefinedId);
                if (!found?.user?.UserId) throw new Error('User not found');
                const enrollments = await fetchAllEnrollmentsForUser(found.user.UserId);
                cached = {
                    userId: found.user.UserId,
                    orgDefinedId: found.orgDefinedId,
                    enrollments
                };
                userCache.set(orgDefinedId, cached);
            }

            const match = findEnrollmentForSection(
                cached.enrollments,
                sectionName,
                term
            );
            const isEnrolled = !!match;

            if (expected !== isEnrolled) {
                stats.mismatches++;
                results.push({
                    orgDefinedId: cached.orgDefinedId,
                    firstName,
                    lastName,
                    email,
                    term,
                    section: sectionName,
                    course,
                    sisStatus: statusCode,
                    d2lStatus: isEnrolled ? 'Enrolled' : 'Not Enrolled',
                    statusDate: dateChange,
                    action: expected ? 'Enroll' : 'Remove',
                    orgUnitId: match?.OrgUnit?.Id || ''
                });
            } else {
                stats.matched++;
            }
        } catch (err) {
            console.error('Verify error for', orgDefinedId, sectionName, err);
            stats.apiErrors++;
            stats.mismatches++;
            results.push({
                orgDefinedId,
                firstName,
                lastName,
                email,
                term,
                section: sectionName,
                course,
                sisStatus: statusCode,
                d2lStatus: 'Error',
                statusDate: dateChange,
                action: err?.message || 'Lookup error',
                orgUnitId: ''
            });
        }

        stats.processedRows++;
        processed++;
        LoadingUtils.updateLoadingBar(
            10 + Math.floor((processed / latest.length) * 85),
            `Checking ${processed}/${latest.length} actions...`,
            'loadingContainer'
        );
        if (processed % 10 === 0) {
            statusEl.textContent = `🔎 Checking ${latest.length} actions… ${processed}/${latest.length} done`;
        }
    }

    LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
    render(results, stats);
    statusEl.textContent = `✅ Audit complete. ${results.length} issue(s) found.`;
    startBtn.disabled = false;
    setTimeout(() => LoadingUtils.hideLoadingBar('loadingContainer'), 500);
}

// ---- Init ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const loadingContainer = LoadingUtils.createLoadingBar('loadingContainer');
    const card = document.querySelector('.card');
    if (card) card.appendChild(loadingContainer);

    populateTermDropdown([], CURRENT_TERMS_VALUE);

    $('#csvFile')?.addEventListener('change', () => {
        const file = $('#csvFile').files[0];
        if (!file) {
            populateTermDropdown([], CURRENT_TERMS_VALUE);
            return;
        }
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: ({ data }) => {
                if (!data.length) return;
                const cols = resolveColumns(data[0]);
                const normalized = data.map(r => normalizeRow(r, cols));
                populateTermDropdown(normalized, termFilter?.value ?? CURRENT_TERMS_VALUE);
            },
            error: () => {
                populateTermDropdown([], CURRENT_TERMS_VALUE);
            }
        });
    });

    $('#startAuditBtn')?.addEventListener('click', async () => {
        const file = $('#csvFile').files[0];
        if (!file) return alert('Please upload a CSV file.');
        try {
            await runAudit(file);
        } catch (err) {
            console.error('Audit error:', err);
            statusEl.style.display = 'block';
            statusEl.textContent = '❌ Error during audit: ' + (err?.message || err);
            $('#startAuditBtn').disabled = false;
            LoadingUtils.hideLoadingBar('loadingContainer');
        }
    });
});
