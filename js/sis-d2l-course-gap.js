/**
 * SIS vs D2L Course Gap — finds SIS CSV sections that have no matching
 * course offering under the selected D2L semester org unit.
 */

(function () {
    'use strict';

    const LP_VERSION = '1.49';

    const semesterSelect = document.getElementById('semesterSelect');
    const runBtn = document.getElementById('runBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const excludeCancelledEl = document.getElementById('excludeCancelled');
    const resultsCard = document.getElementById('resultsCard');
    const statusMsg = document.getElementById('statusMsg');

    let lastMissing = [];
    let lastMissingFullRows = [];
    let lastCsvHeaders = [];
    let gapTable = null;

    document.addEventListener('DOMContentLoaded', () => {
        loadSemesters().catch(err => console.error(err));
        runBtn.addEventListener('click', onRun);
        downloadBtn.addEventListener('click', onDownload);
    });

    /** Case- and spacing-insensitive cell lookup */
    function getCell(row, candidates) {
        if (!row || typeof row !== 'object') return '';
        const keys = Object.keys(row);
        const normMap = new Map();
        for (const k of keys) {
            const nk = k.replace(/\s+/g, '').toLowerCase();
            if (!normMap.has(nk)) normMap.set(nk, k);
        }
        for (const c of candidates) {
            const raw = row[c];
            if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
                return String(raw).trim();
            }
            const nk = c.replace(/\s+/g, '').toLowerCase();
            const orig = normMap.get(nk);
            if (orig !== undefined) {
                const v = row[orig];
                if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
            }
        }
        return '';
    }

    function isCancelledStatus(status) {
        const s = String(status || '').trim().toUpperCase();
        return s === 'C' || s === 'CANCELLED' || s === 'CANCELED';
    }

    /** Normalized offering-style code (no spaces, upper) */
    function stripNorm(s) {
        return String(s || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '');
    }

    /**
     * All SIS keys to try against D2L offering Code (and optional OrgUnitId).
     * UAT list uses COURSE_CODE (often "SECTION-TERM") plus SEC_NAME (section shell).
     */
    function deriveSisKeys(row) {
        const keys = [];
        const seen = new Set();

        function addStr(s) {
            const k = stripNorm(s);
            if (!k || seen.has(k)) return;
            seen.add(k);
            keys.push(k);
        }

        const courseCode = getCell(row, [
            'COURSE_CODE',
            'Course Code',
            'CourseCode',
            'course_code',
            'Course_Section',
            'CourseSection',
            'SectionKey',
            'course_section'
        ]);
        const secTerm = getCell(row, ['SEC_TERM', 'Sec_Term', 'TERM', 'Term']);
        const secName = getCell(row, ['SEC_NAME', 'Sec_Name']);

        if (courseCode) {
            addStr(courseCode);
            const full = stripNorm(courseCode);
            if (secTerm) {
                const t = stripNorm(secTerm);
                if (t && full.length > t.length + 1) {
                    const suffix = '-' + t;
                    if (full.endsWith(suffix)) {
                        addStr(full.slice(0, -suffix.length));
                    }
                }
            }
            const termTail = /^(.+)-(\d{2})\/(WI|SP|FA)$/.exec(full);
            if (termTail && termTail[1]) {
                addStr(termTail[1]);
            }
        }

        if (secName) {
            addStr(secName);
        }

        const dept = getCell(row, ['SEC_DEPTS', 'Sec_Depts', 'DEPT', 'Department', 'Subject']);
        const num = getCell(row, ['SEC_COURSE_NO', 'Sec_Course_No', 'COURSE_NO', 'CourseNo', 'Course Number']);
        const sec = getCell(row, ['SEC_NO', 'Sec_No', 'SECTION', 'Section', 'Sec']);
        if (dept && num && sec) {
            addStr(`${dept}-${num}-${sec}`.replace(/\s+/g, ''));
        }

        if (!courseCode) {
            const single = getCell(row, ['Course Code', 'CourseCode', 'course_code']);
            if (single) addStr(single);
        }

        return keys;
    }

    /** Primary label for tables / export (prefer SIS COURSE_CODE) */
    function deriveDisplayMatchKey(row, sisKeys) {
        const cc = getCell(row, ['COURSE_CODE', 'Course Code', 'CourseCode', 'course_code']);
        if (cc) return cc.trim();
        if (sisKeys && sisKeys.length) return sisKeys[0];
        return '';
    }

    function deriveOrgUnitId(row) {
        return getCell(row, [
            'OrgUnitId',
            'Org Unit Id',
            'OrgUnit ID',
            'Org Unit ID',
            'OrgUnitIdentifier',
            'BrightspaceOrgUnitId',
            'D2LOrgUnitId',
            'D2L OrgUnitId'
        ]);
    }

    function deriveTitle(row) {
        return getCell(row, [
            'SEC_NAME',
            'Sec_Name',
            'Course Name',
            'CourseName',
            'SEC_TITLE',
            'Sec_Title',
            'Title',
            'Description',
            'Course Long Title'
        ]);
    }

    async function loadSemesters() {
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) {
            throw new Error('Could not get organization info');
        }
        const rootOrgUnitId = orgInfo.Identifier;
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${LP_VERSION}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/${LP_VERSION}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) data = response.Objects;
            else if (Array.isArray(response)) data = response;
        }
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.populateSelect) {
            SemesterConfig.populateSelect(semesterSelect, data);
            if (SemesterConfig.attachHistoricalInput) {
                SemesterConfig.attachHistoricalInput(semesterSelect);
            }
        } else {
            semesterSelect.innerHTML = '';
            (data || []).forEach(sem => {
                const o = document.createElement('option');
                o.value = String(sem.Identifier);
                o.textContent = sem.Name || sem.Code || o.value;
                semesterSelect.appendChild(o);
            });
        }
    }

    async function fetchCourseOfferings(semesterId) {
        let results = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            results = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/children/`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/children/?pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) results = response.Objects;
            else if (Array.isArray(response)) results = response;
        }
        return (results || []).filter(entry => {
            const t = entry.Type || {};
            return t.Id === 3 || t.Code === 'Course Offering';
        });
    }

    function codeMatchesD2l(sisKeyNorm, d2lCodeRaw) {
        const c = stripNorm(d2lCodeRaw);
        const k = stripNorm(sisKeyNorm);
        if (!k || !c) return false;
        if (c === k) return true;
        // D2L shell longer than SIS key (e.g. merged suffix)
        if (c.startsWith(k) && (c.length === k.length || c[k.length] === '-')) return true;
        // SIS key longer (e.g. COURSE_CODE ends with -26/FA; D2L Code is section shell only)
        if (k.startsWith(c) && (k.length === c.length || k[c.length] === '-')) return true;
        return false;
    }

    function findD2lMatch(sisKeys, sisOrgId, offerings) {
        if (sisOrgId) {
            const id = String(sisOrgId).trim();
            for (let i = 0; i < offerings.length; i++) {
                if (String(offerings[i].Identifier) === id) {
                    return { via: 'OrgUnitId', course: offerings[i] };
                }
            }
        }
        if (!sisKeys || !sisKeys.length) return null;
        for (let j = 0; j < offerings.length; j++) {
            const d2lCode = offerings[j].Code;
            for (let ki = 0; ki < sisKeys.length; ki++) {
                if (codeMatchesD2l(sisKeys[ki], d2lCode)) {
                    return { via: 'Code', course: offerings[j] };
                }
            }
        }
        return null;
    }

    function initOrReloadTable(rows) {
        const data = rows.map((r, i) => [
            i + 1,
            r.sisKey || '—',
            r.sisOrgId || '—',
            r.title || '—',
            r.secStatus || '—'
        ]);
        if (gapTable) {
            gapTable.clear();
            gapTable.rows.add(data);
            gapTable.draw();
        } else {
            gapTable = $('#gapTable').DataTable({
                data,
                columns: [
                    { title: '#' },
                    { title: 'COURSE_CODE' },
                    { title: 'SIS OrgUnitId' },
                    { title: 'Title / name' },
                    { title: 'SEC_STATUS' }
                ],
                pageLength: 25,
                order: [[0, 'asc']],
                dom: '<"top"lf>rt<"bottom"ip><"clear">'
            });
        }
    }

    async function onRun() {
        const semesterId =
            typeof SemesterConfig !== 'undefined' && SemesterConfig.getEffectiveSemesterId
                ? SemesterConfig.getEffectiveSemesterId(semesterSelect)
                : semesterSelect.value;
        const fileInput = document.getElementById('sisCsv');
        const file = fileInput.files && fileInput.files[0];

        if (!semesterId) {
            alert('Please select a D2L semester.');
            return;
        }
        if (!file) {
            alert('Please choose a CSV file from your SIS export.');
            return;
        }

        runBtn.disabled = true;
        downloadBtn.disabled = true;
        LoadingUtils.showLoadingModal('Reading CSV and loading D2L courses…', 'loadingModal');

        try {
            const parsed = await new Promise((resolve, reject) => {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: 'greedy',
                    complete: res => resolve(res),
                    error: err => reject(err)
                });
            });

            const rows = parsed.data || [];
            lastCsvHeaders = parsed.meta && parsed.meta.fields ? parsed.meta.fields.slice() : [];

            LoadingUtils.updateLoadingModal(40, 'Loading course offerings for semester…', 'loadingModal');
            const offerings = await fetchCourseOfferings(semesterId);

            const excludeCancelled = !!(excludeCancelledEl && excludeCancelledEl.checked);
            let skipped = 0;
            let analyzed = 0;
            let matched = 0;
            const missing = [];
            const missingFull = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const secStatus = getCell(row, ['SEC_STATUS', 'Sec_Status', 'Status']);
                if (excludeCancelled && isCancelledStatus(secStatus)) {
                    skipped++;
                    continue;
                }

                const sisOrgId = deriveOrgUnitId(row);
                const sisKeys = deriveSisKeys(row);
                if (!sisOrgId && !sisKeys.length) {
                    const empty = !Object.keys(row).some(k => {
                        const v = row[k];
                        return v !== undefined && v !== null && String(v).trim() !== '';
                    });
                    if (empty) {
                        skipped++;
                        continue;
                    }
                    skipped++;
                    continue;
                }

                analyzed++;
                const hit = findD2lMatch(sisKeys, sisOrgId, offerings);
                if (hit) {
                    matched++;
                } else {
                    const title = deriveTitle(row);
                    const displayKey = deriveDisplayMatchKey(row, sisKeys);
                    missing.push({
                        sisKey: displayKey || (sisKeys[0] || ''),
                        sisOrgId: sisOrgId || '',
                        title,
                        secStatus: secStatus || '',
                        rowIndex: i + 1
                    });
                    missingFull.push(row);
                }
            }

            lastMissing = missing;
            lastMissingFullRows = missingFull;

            document.getElementById('statTotal').textContent = String(analyzed);
            document.getElementById('statMatched').textContent = String(matched);
            document.getElementById('statMissing').textContent = String(missing.length);
            document.getElementById('statSkipped').textContent = String(skipped);

            statusMsg.textContent =
                `Loaded ${offerings.length} D2L offering(s) under semester org unit ${semesterId}. ` +
                (missing.length
                    ? 'Rows below are in your SIS file but did not match any of those offerings.'
                    : 'Every analyzable SIS row matched a D2L offering.');

            resultsCard.style.display = 'block';
            initOrReloadTable(missing);
            downloadBtn.disabled = missing.length === 0;
        } catch (e) {
            console.error(e);
            alert('Error: ' + (e.message || String(e)));
        } finally {
            LoadingUtils.hideLoadingModal('loadingModal');
            runBtn.disabled = false;
        }
    }

    function onDownload() {
        if (!lastMissingFullRows.length) {
            alert('Nothing to download. Run a compare with missing courses first.');
            return;
        }
        const headers = lastCsvHeaders.length
            ? lastCsvHeaders.slice()
            : Object.keys(lastMissingFullRows[0] || {});
        if (headers.indexOf('GapReport_MatchKey') === -1) headers.push('GapReport_MatchKey');
        if (headers.indexOf('GapReport_MissingFromD2L') === -1) headers.push('GapReport_MissingFromD2L');

        const lines = [headers.join(',')];
        for (let i = 0; i < lastMissingFullRows.length; i++) {
            const row = lastMissingFullRows[i];
            const meta = lastMissing[i];
            const obj = {};
            headers.forEach(h => {
                if (h === 'GapReport_MatchKey') obj[h] = meta ? meta.sisKey : '';
                else if (h === 'GapReport_MissingFromD2L') obj[h] = 'Yes';
                else obj[h] = row[h] !== undefined && row[h] !== null ? row[h] : '';
            });
            lines.push(
                headers
                    .map(h => {
                        let cell = obj[h];
                        if (cell === null || typeof cell === 'undefined') cell = '';
                        const str = String(cell);
                        if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
                        return str;
                    })
                    .join(',')
            );
        }

        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sis_missing_from_d2l_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
})();
