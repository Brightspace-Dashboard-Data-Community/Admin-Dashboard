/**
 * Issued awards report: course by Org Unit ID, student classlist (role 101),
 * BAS issued per UserId, optional ignore list from info/award-ignore-list.csv.
 */

const LP_VER = '1.49';
const LE_VER = '1.82';
const BAS_VER = '1.4';
const STUDENT_ROLE_ID = 101;
const FETCH_CONCURRENCY = 5;
const BETWEEN_BATCH_MS = 40;
const IGNORE_LIST_PATH = '../info/award-ignore-list.csv';

const DETROIT_TZ = 'America/Detroit';

/** Add new rows here when you add awards in Brightspace. value = `${AwardId}|${AwardType}` */
const AWARD_OPTIONS = [{ value: '1|1', label: 'Delta Orientation Completion' }];

let lastResultRows = [];
/** @type {Set<string>} */
let ignoreUserIds = new Set();

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(str) {
    if (str == null || str === '') return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function logLine(msg) {
    const log = document.getElementById('log');
    if (!log) {
        console.log(msg);
        return;
    }
    const p = document.createElement('p');
    p.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    console.log(msg);
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

/**
 * Value for datetime-local inputs: UTC wall clock matching Brightspace IssuedDate
 * (so the range filter lines up with API timestamps).
 */
function toDatetimeLocalValueFromUtcInstant(d) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function populateAwardSelect() {
    const sel = document.getElementById('awardSelect');
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i < AWARD_OPTIONS.length; i++) {
        const o = AWARD_OPTIONS[i];
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
    }
}

function setDefaultIssuedRange() {
    const end = new Date();
    const start = new Date(end.getTime() - 72 * 3600000);
    const startEl = document.getElementById('issuedStart');
    const endEl = document.getElementById('issuedEnd');
    if (startEl) startEl.value = toDatetimeLocalValueFromUtcInstant(start);
    if (endEl) endEl.value = toDatetimeLocalValueFromUtcInstant(end);
}

/**
 * Parse ignore file: one UserId per line; optional header line skipped if non-numeric.
 * @param {string} text
 * @returns {Set<string>}
 */
function parseIgnoreListText(text) {
    const set = new Set();
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].replace(/^\uFEFF/, '').trim();
        if (!line || line.startsWith('#')) continue;
        if (line.includes(',')) {
            const first = line.split(',')[0].trim();
            if (/^\d+$/.test(first)) line = first;
        }
        if (/^\d+$/.test(line)) set.add(line);
    }
    return set;
}

async function loadIgnoreListFromFile() {
    const status = document.getElementById('ignoreListStatus');
    try {
        const res = await fetch(IGNORE_LIST_PATH, { credentials: 'same-origin' });
        if (!res.ok) {
            throw new Error(`${res.status} ${res.statusText}`);
        }
        const text = await res.text();
        ignoreUserIds = parseIgnoreListText(text);
        if (status) {
            status.textContent = `Loaded ${ignoreUserIds.size} user ID(s) to skip from award-ignore-list.csv`;
            status.classList.add('is-ok');
            status.classList.remove('is-warn');
        }
    } catch (e) {
        ignoreUserIds = new Set();
        if (status) {
            status.textContent = `Could not load ${IGNORE_LIST_PATH}: ${e && e.message ? e.message : e}. No IDs will be skipped.`;
            status.classList.add('is-warn');
            status.classList.remove('is-ok');
        }
        console.warn(e);
    }
}

async function fetchOrgUnit(orgUnitId) {
    const id = String(orgUnitId).trim();
    return D2LApi._fetch(`/d2l/api/lp/${LP_VER}/orgstructure/${encodeURIComponent(id)}`);
}

async function refreshCourseNameDisplay() {
    const input = document.getElementById('orgUnitId');
    const out = document.getElementById('courseNameDisplay');
    if (!input || !out) return;
    const raw = String(input.value || '').trim();
    out.textContent = '';
    out.classList.remove('is-ok');
    if (!/^\d+$/.test(raw)) {
        if (raw) out.textContent = 'Enter a numeric Org Unit ID.';
        return;
    }
    out.textContent = 'Loading course…';
    try {
        const ou = await fetchOrgUnit(raw);
        const name = ou.Name || ou.name || '';
        const code = ou.Code || ou.code || '';
        const parts = [name, code].filter(Boolean);
        out.textContent = parts.length ? parts.join(' — ') : `Org unit ${raw}`;
        out.classList.add('is-ok');
    } catch (e) {
        out.textContent = `Could not load org unit: ${e && e.message ? e.message : e}`;
        out.classList.remove('is-ok');
    }
}

async function getClasslistStudents101(ou) {
    const roleQs = `roleId=${STUDENT_ROLE_ID}`;
    const vers = [LE_VER, '1.78', '1.70', '1.65'];
    for (const v of vers) {
        const base = `/d2l/api/le/${v}/${ou}/classlist`;
        try {
            const url1 = `${base}/?pageSize=1000&${roleQs}`;
            const data = await D2LApi._fetch(url1);
            if (Array.isArray(data) && data.length) {
                return data;
            }
            if (data && data.Items && data.Items.length) {
                return data.Items;
            }
            if (data && data.Objects && data.Objects.length) {
                return data.Objects;
            }
        } catch {
            /* paged */
        }

        try {
            let acc = [];
            let bookmark = '';
            for (let i = 0; i < 200; i++) {
                const url2 =
                    `${base}/paged/?pageSize=100&${roleQs}` +
                    (bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : '');
                const page = await D2LApi._fetch(url2);
                const chunk = (page && (page.Items || page.Objects)) || [];
                if (chunk.length) {
                    acc = acc.concat(chunk);
                }
                if (!page || !page.PagingInfo || !page.PagingInfo.Bookmark) {
                    break;
                }
                bookmark = page.PagingInfo.Bookmark;
                await sleep(80);
            }
            if (acc.length) {
                return acc;
            }
        } catch {
            /* next LE version */
        }
    }
    return [];
}

function filterStudentRole101Only(members) {
    return members.filter((u) => {
        const userId = u.UserId ?? u.Identifier;
        if (userId == null || userId === '') return false;
        const rid = Number(u.RoleId ?? u.Role?.Id);
        if (!Number.isFinite(rid)) return false;
        return rid === STUDENT_ROLE_ID;
    });
}

function classlistMemberName(user) {
    if (user.FirstName || user.LastName) {
        return `${user.FirstName || ''} ${user.LastName || ''}`.trim();
    }
    return user.DisplayName || user.Name || user.UserName || user.Username || 'Unknown';
}

function classlistEmail(user) {
    return user.Email || user.ExternalEmail || user.EmailAddress || '';
}

/**
 * BAS IssuedDate / Brightspace API: values like U2026-05-13T20:01:00.827 are UTC
 * (ISO 8601 without offset). ECMAScript parses those as *local* unless Z or offset is present,
 * which skews Eastern display — append Z so the instant is correct.
 * @param {string|Date} raw
 * @returns {Date|null}
 */
function parseBASIssuedUtc(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : raw;
    }
    let s = String(raw).replace(/^U/i, '').trim();
    if (!s) return null;
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
        s += 'Z';
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Range bounds: components interpreted as UTC. For end, optionally include rest of that minute. */
function parseRangeBoundUtc(datetimeLocalValue, opts) {
    const endOfMinute = opts && opts.endOfMinute;
    const m = String(datetimeLocalValue || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
    if (endOfMinute) t += 59999;
    return new Date(t);
}

function formatIssuedDetroit(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : parseBASIssuedUtc(isoOrDate);
    if (!d) return '';
    try {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: DETROIT_TZ,
            dateStyle: 'medium',
            timeStyle: 'medium'
        }).format(d);
    } catch {
        return d.toLocaleString('en-US', { timeZone: DETROIT_TZ });
    }
}

/** Inclusive range on correct UTC instants. */
function isIssuedWithinRange(issuedRaw, start, end) {
    const t = parseBASIssuedUtc(issuedRaw);
    if (!t || !start || !end) return false;
    const a = start.getTime();
    const b = end.getTime();
    if (a > b) return false;
    const x = t.getTime();
    return x >= a && x <= b;
}

function normalizeNextUrl(next) {
    if (!next) return null;
    if (typeof next !== 'string') return null;
    const s = next.trim();
    if (!s) return null;
    if (s.startsWith('/')) return s;
    try {
        const u = new URL(s, window.location.origin);
        return u.pathname + u.search;
    } catch {
        return null;
    }
}

async function fetchAllIssuedForUser(userId) {
    const out = [];
    let url = `/d2l/api/bas/${BAS_VER}/issued/users/${encodeURIComponent(String(userId))}/`;
    let guard = 0;
    while (url && guard < 80) {
        guard++;
        let page;
        try {
            page = await D2LApi._fetch(url);
        } catch {
            break;
        }
        const objs = (page && page.Objects) || [];
        for (let i = 0; i < objs.length; i++) {
            out.push(objs[i]);
        }
        const nextRaw = page && page.Next;
        url = normalizeNextUrl(nextRaw);
        if (url) await sleep(20);
    }
    return out;
}

function issuedMatchesCourse(obj, courseOrgUnitId) {
    if (!courseOrgUnitId) return true;
    const oid = obj.OrgUnitId;
    if (oid == null) return true;
    return String(oid) === String(courseOrgUnitId);
}

function issuedMatchesAwardType(obj, awardId, awardType) {
    const award = obj.Award;
    if (!award) return false;
    return Number(award.AwardId) === Number(awardId) && Number(award.AwardType) === Number(awardType);
}

function csvEscape(val) {
    const s = val == null ? '' : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function buildCsv(rows) {
    const headers = [
        'StudentName',
        'OrgDefinedId',
        'Email',
        'UserId',
        'IssuedDateRaw',
        'IssuedDateAmericaDetroit',
        'AwardTitle',
        'IssuedId',
        'OrgUnitId'
    ];
    const lines = [headers.join(',')];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        lines.push(
            [
                csvEscape(r.StudentName),
                csvEscape(r.OrgDefinedId),
                csvEscape(r.Email),
                csvEscape(r.UserId),
                csvEscape(r.IssuedDateRaw),
                csvEscape(r.IssuedDateAmericaDetroit),
                csvEscape(r.AwardTitle),
                csvEscape(r.IssuedId),
                csvEscape(r.OrgUnitId)
            ].join(',')
        );
    }
    return lines.join('\r\n');
}

function setBusy(busy) {
    const btn = document.getElementById('runBtn');
    const dl = document.getElementById('downloadCsvBtn');
    if (btn) btn.disabled = busy;
    if (dl) dl.disabled = busy || !lastResultRows.length;
    const el = document.getElementById('busyLabel');
    if (el) el.hidden = !busy;
}

function updateProgress(done, total, hits) {
    const el = document.getElementById('progressText');
    if (el) {
        el.textContent = `BAS checks: ${done} / ${total} · ${hits} match(es) so far`;
    }
}

async function runReport() {
    const orgRaw = (document.getElementById('orgUnitId') && document.getElementById('orgUnitId').value) || '';
    const orgUnitId = String(orgRaw).trim();
    const startVal = document.getElementById('issuedStart') && document.getElementById('issuedStart').value;
    const endVal = document.getElementById('issuedEnd') && document.getElementById('issuedEnd').value;
    const awardVal = (document.getElementById('awardSelect') && document.getElementById('awardSelect').value) || '';
    const matchCourseEl = document.getElementById('matchCourseOrg');
    const matchCourseOu = !matchCourseEl || matchCourseEl.checked;

    const log = document.getElementById('log');
    if (log) log.innerHTML = '';
    const results = document.getElementById('results');
    if (results) results.innerHTML = '';

    lastResultRows = [];

    if (!/^\d+$/.test(orgUnitId)) {
        logLine('Enter a numeric course Org Unit ID.');
        return;
    }
    if (!startVal || !endVal) {
        logLine('Choose both start and end date/time for the issued range.');
        return;
    }
    const rangeStart = parseRangeBoundUtc(startVal, null);
    const rangeEnd = parseRangeBoundUtc(endVal, { endOfMinute: true });
    if (!rangeStart || !rangeEnd || Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
        logLine('Invalid start or end date/time.');
        return;
    }
    if (rangeStart > rangeEnd) {
        logLine('Start must be on or before end.');
        return;
    }

    const parts = awardVal.split('|');
    const awardId = Number(parts[0]);
    const awardType = Number(parts[1]);
    if (!Number.isFinite(awardId) || !Number.isFinite(awardType)) {
        logLine('Select an award.');
        return;
    }

    setBusy(true);
    try {
        logLine(`Course Org Unit ID ${orgUnitId} · issued UTC range ${startVal} → ${endVal} · award ${awardId}/${awardType}`);
        logLine(`Ignore list: ${ignoreUserIds.size} user ID(s).`);

        logLine('Loading student classlist (role 101, paged)…');
        const rawList = await getClasslistStudents101(orgUnitId);
        const students = filterStudentRole101Only(rawList);
        logLine(`Classlist: ${rawList.length} row(s) from API, ${students.length} with role ${STUDENT_ROLE_ID}.`);

        if (!students.length) {
            logLine('No students on the classlist for this course.');
            return;
        }

        let skippedIgnore = 0;
        const toScan = [];
        for (let i = 0; i < students.length; i++) {
            const m = students[i];
            const uid = String(m.UserId ?? m.Identifier ?? '');
            if (ignoreUserIds.has(uid)) {
                skippedIgnore++;
                continue;
            }
            toScan.push(m);
        }

        logLine(`BAS queue: ${toScan.length} student(s) (${skippedIgnore} skipped via ignore list).`);

        if (!toScan.length) {
            logLine('Everyone is on the ignore list or the classlist is empty.');
            return;
        }

        const hits = [];
        let processed = 0;

        for (let i = 0; i < toScan.length; i += FETCH_CONCURRENCY) {
            const slice = toScan.slice(i, i + FETCH_CONCURRENCY);
            const batchResults = await Promise.all(
                slice.map(async (m) => {
                    const userId = m.UserId ?? m.Identifier;
                    const name = classlistMemberName(m);
                    const orgDefinedId = m.OrgDefinedId != null ? String(m.OrgDefinedId) : '';
                    const email = classlistEmail(m);
                    try {
                        const issued = await fetchAllIssuedForUser(userId);
                        const rowObjs = [];
                        for (let j = 0; j < issued.length; j++) {
                            const obj = issued[j];
                            if (!issuedMatchesCourse(obj, matchCourseOu ? orgUnitId : null)) continue;
                            if (!issuedMatchesAwardType(obj, awardId, awardType)) continue;
                            const rawDate = obj.IssuedDate;
                            if (!isIssuedWithinRange(rawDate, rangeStart, rangeEnd)) continue;
                            rowObjs.push({
                                StudentName: name,
                                OrgDefinedId: orgDefinedId,
                                Email: email,
                                UserId: String(userId),
                                IssuedDateRaw: rawDate != null ? String(rawDate) : '',
                                IssuedDateAmericaDetroit: formatIssuedDetroit(rawDate),
                                AwardTitle: (obj.Award && obj.Award.Title) || '',
                                IssuedId: obj.IssuedId != null ? String(obj.IssuedId) : '',
                                OrgUnitId: obj.OrgUnitId != null ? String(obj.OrgUnitId) : ''
                            });
                        }
                        return rowObjs;
                    } catch (e) {
                        console.warn('issued fetch failed', userId, e);
                        return [];
                    }
                })
            );
            for (let b = 0; b < batchResults.length; b++) {
                hits.push(...batchResults[b]);
            }
            processed += slice.length;
            updateProgress(processed, toScan.length, hits.length);
            if (BETWEEN_BATCH_MS > 0) await sleep(BETWEEN_BATCH_MS);
        }

        hits.sort((a, b) => {
            const da = parseBASIssuedUtc(a.IssuedDateRaw);
            const db = parseBASIssuedUtc(b.IssuedDateRaw);
            return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
        });
        lastResultRows = hits;

        logLine(`Done. ${hits.length} issue(s) in range.`);

        if (results) {
            if (!hits.length) {
                results.innerHTML =
                    '<p class="text-muted text-sm">No matching issued awards for the selected award, course filter, date range, and classlist.</p>';
            } else {
                let html = `<p class="text-sm awards-report-meta"><strong>${hits.length}</strong> row(s). Displayed issue time: <code>${DETROIT_TZ}</code> (US Eastern for Michigan).</p>`;
                html += '<div class="table-container"><table class="table"><thead><tr>';
                html +=
                    '<th scope="col">Student</th><th scope="col">Org Defined ID</th><th scope="col">Email</th><th scope="col">Issued (Detroit)</th><th scope="col">Award</th>';
                html += '</tr></thead><tbody>';
                for (let r = 0; r < hits.length; r++) {
                    const row = hits[r];
                    html += '<tr>';
                    html += `<td>${escapeHtml(row.StudentName)}</td>`;
                    html += `<td>${escapeHtml(row.OrgDefinedId)}</td>`;
                    html += `<td>${escapeHtml(row.Email)}</td>`;
                    html += `<td>${escapeHtml(row.IssuedDateAmericaDetroit)}</td>`;
                    html += `<td>${escapeHtml(row.AwardTitle)}</td>`;
                    html += '</tr>';
                }
                html += '</tbody></table></div>';
                results.innerHTML = html;
            }
        }

        const dl = document.getElementById('downloadCsvBtn');
        if (dl) dl.disabled = !hits.length;
    } catch (e) {
        logLine(`Error: ${e && e.message ? e.message : e}`);
        console.error(e);
    } finally {
        setBusy(false);
    }
}

function downloadCsv() {
    if (!lastResultRows.length) return;
    const blob = new Blob([buildCsv(lastResultRows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `issued-awards-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

document.addEventListener('DOMContentLoaded', () => {
    populateAwardSelect();
    setDefaultIssuedRange();
    loadIgnoreListFromFile();

    const runBtn = document.getElementById('runBtn');
    if (runBtn) runBtn.addEventListener('click', () => runReport());
    const dl = document.getElementById('downloadCsvBtn');
    if (dl) dl.addEventListener('click', () => downloadCsv());

    const orgInput = document.getElementById('orgUnitId');
    if (orgInput) {
        orgInput.addEventListener('blur', () => {
            refreshCourseNameDisplay();
        });
        orgInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                refreshCourseNameDisplay();
            }
        });
        orgInput.addEventListener('input', () => {
            const out = document.getElementById('courseNameDisplay');
            if (out && !String(orgInput.value || '').trim()) {
                out.textContent = '';
                out.classList.remove('is-ok');
            }
        });
    }
});
