/**
 * Master Schedule Date Check
 * Compares Brightspace course dates to the master schedule CSV.
 * D2L start should match the schedule. D2L end should be 7 days later.
 */

const OPEN_DAYS_AFTER_SCHEDULE_END = 7;
const CAMPUS_TIME_ZONE = 'America/Detroit';
const LP_VERSION = '1.49';

let comparisonRows = [];
let skippedShells = [];
let activeFilter = 'mismatch';
let writing = false;
let statusBanner = '';
let sampledStartClock = null;
let sampledEndClock = null;
let sortKey = 'code';
let sortDir = 1;

document.addEventListener('DOMContentLoaded', () => {
    const loadingContainer = LoadingUtils.createLoadingBar('loadingContainer');
    document.querySelector('.card').appendChild(loadingContainer);
    loadSemesters();

    document.getElementById('compareBtn').addEventListener('click', compareSemester);
    document.getElementById('bulkStartBtn').addEventListener('click', () => applyFieldToMismatches('start'));
    document.getElementById('bulkEndBtn').addEventListener('click', () => applyFieldToMismatches('end'));
    document.getElementById('downloadBtn').addEventListener('click', downloadComparison);
    document.getElementById('summary').addEventListener('click', (event) => {
        const button = event.target.closest('[data-filter]');
        if (!button) return;
        activeFilter = button.getAttribute('data-filter');
        renderReport();
    });
    document.getElementById('report-container').addEventListener('click', onReportClick);
    document.getElementById('report-container').addEventListener('input', (event) => {
        if (event.target.id === 'rowSearch') renderTable();
    });
});

async function loadSemesters() {
    const select = document.getElementById('semesterSelect');
    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(10, 'Loading semesters...', 'loadingContainer');
        const rootOrgUnitId = 1001;
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${LP_VERSION}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/${LP_VERSION}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            data = response.Objects || response || [];
        }
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.populateSelect) {
            SemesterConfig.populateSelect(select, data, { placeholder: 'Select a semester' });
        } else {
            select.innerHTML = '<option value="">Select a semester</option>';
            data.forEach((semester) => {
                const option = document.createElement('option');
                option.value = semester.Identifier;
                option.dataset.code = semester.Code || '';
                option.textContent = semester.Name;
                select.appendChild(option);
            });
        }
        LoadingUtils.updateLoadingBar(100, 'Semesters loaded', 'loadingContainer');
    } catch (error) {
        console.error('Failed to load semesters:', error);
        select.innerHTML = '<option value="">Could not load semesters</option>';
        LoadingUtils.hideLoadingBar('loadingContainer');
    }
}

async function compareSemester() {
    const select = document.getElementById('semesterSelect');
    const semesterId = (typeof SemesterConfig !== 'undefined' && SemesterConfig.getEffectiveSemesterId)
        ? SemesterConfig.getEffectiveSemesterId(select)
        : select.value;
    const file = document.getElementById('scheduleFile').files[0];
    if (!semesterId) {
        alert('Select a semester first.');
        return;
    }
    if (!file) {
        alert('Choose the master schedule CSV first.');
        return;
    }

    const option = select.selectedOptions[0];
    const semesterCode = option && option.dataset ? (option.dataset.code || '') : '';
    const compareBtn = document.getElementById('compareBtn');
    compareBtn.disabled = true;
    comparisonRows = [];
    skippedShells = [];
    document.getElementById('summary').innerHTML = '';
    document.getElementById('report-container').innerHTML = '';
    updateActionButtons(true);
    document.getElementById('downloadBtn').style.display = 'none';

    try {
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(5, 'Reading the master schedule...', 'loadingContainer');
        const text = await file.text();
        const parsed = parseScheduleCsv(text);
        if (parsed.error) throw new Error(parsed.error);

        const filtered = filterScheduleToSemester(parsed.rows, semesterCode);
        if (!filtered.rows.length) {
            throw new Error(filtered.message || 'No schedule rows matched this semester.');
        }

        LoadingUtils.updateLoadingBar(12, 'Loading course offerings...', 'loadingContainer');
        const offerings = await fetchOfferings(semesterId);
        const included = [];
        offerings.forEach((offering) => {
            const reason = skipReason(offering.Code, offering.Name);
            if (reason) {
                skippedShells.push({
                    code: offering.Code || '',
                    name: offering.Name || '',
                    orgUnitId: offering.Identifier,
                    reason
                });
            } else {
                included.push(offering);
            }
        });

        const detailsById = new Map();
        let done = 0;
        await mapPool(included, 6, async (offering) => {
            try {
                const course = await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/courses/${offering.Identifier}`);
                detailsById.set(String(offering.Identifier), course);
            } catch (error) {
                detailsById.set(String(offering.Identifier), { error: error.message || String(error) });
            }
            done += 1;
            if (done === included.length || done % 15 === 0) {
                const pct = 15 + (done / Math.max(included.length, 1)) * 80;
                LoadingUtils.updateLoadingBar(pct, `Read dates for ${done} of ${included.length} courses...`, 'loadingContainer');
            }
        });

        comparisonRows = buildComparison({
            offerings: included,
            detailsById,
            scheduleRows: filtered.rows
        });
        comparisonRows.scheduleNote = filtered.message || '';
        activeFilter = comparisonRows.some((row) => row.kind === 'mismatch' || row.kind === 'error')
            ? 'mismatch'
            : 'all';
        LoadingUtils.updateLoadingBar(100, 'Comparison complete', 'loadingContainer');
        renderReport();
        document.getElementById('downloadBtn').style.display = 'inline-flex';
        updateActionButtons();
    } catch (error) {
        console.error(error);
        document.getElementById('report-container').innerHTML =
            `<div class="card"><p>Could not compare dates. ${escapeHtml(error.message)}</p></div>`;
        LoadingUtils.hideLoadingBar('loadingContainer');
    } finally {
        compareBtn.disabled = false;
    }
}

async function fetchOfferings(semesterId) {
    let courses = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        courses = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/children/`
        );
    } else {
        const response = await D2LApi._fetch(
            `/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/children/?pageSize=100`
        );
        courses = response.Objects || response || [];
    }
    courses = (courses || []).filter((course) => course.Type?.Id === 3 || course.Type?.Code === 'Course Offering');
    if (!courses.length && typeof D2LApi.fetchPaginatedData === 'function') {
        courses = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${LP_VERSION}/orgstructure/${semesterId}/descendants/?ouTypeId=3`
        );
        courses = courses || [];
    }
    return courses;
}

function onReportClick(event) {
    const header = event.target.closest('th[data-sort]');
    if (header) {
        const key = header.getAttribute('data-sort');
        if (sortKey === key) sortDir = -sortDir;
        else {
            sortKey = key;
            sortDir = 1;
        }
        renderTable();
        return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || writing) return;
    const id = button.getAttribute('data-id');
    const action = button.getAttribute('data-action');
    if (action === 'set-start') applyScheduleField(id, 'start');
    if (action === 'set-end') applyScheduleField(id, 'end');
    if (action === 'save-start') saveManualField(id, 'start');
    if (action === 'save-end') saveManualField(id, 'end');
}

function rowsForField(field) {
    return comparisonRows.filter((row) => {
        if (!row.orgUnitId || row.kind === 'conflict') return false;
        if (field === 'start') return row.expectedStart && row.d2lStart !== row.expectedStart;
        return row.expectedEnd && row.d2lEnd !== row.expectedEnd;
    });
}

function updateActionButtons(forceHide) {
    const startBtn = document.getElementById('bulkStartBtn');
    const endBtn = document.getElementById('bulkEndBtn');
    const startCount = forceHide ? 0 : rowsForField('start').length;
    const endCount = forceHide ? 0 : rowsForField('end').length;
    if (startBtn) {
        startBtn.style.display = startCount ? 'inline-flex' : 'none';
        startBtn.disabled = false;
        startBtn.textContent = `Set start dates (${startCount})`;
    }
    if (endBtn) {
        endBtn.style.display = endCount ? 'inline-flex' : 'none';
        endBtn.disabled = false;
        endBtn.textContent = `Set end dates (${endCount})`;
    }
}

async function applyFieldToMismatches(field) {
    const targets = rowsForField(field);
    const label = field === 'start' ? 'start' : 'end';
    if (!targets.length) {
        alert(`There are no courses with a ${label} date to update.`);
        return;
    }
    const preview = targets.slice(0, 6).map((row) => {
        if (field === 'start') {
            return `${row.code}: start ${displayDate(row.d2lStart)} → ${displayDate(row.expectedStart)}`;
        }
        return `${row.code}: end ${displayDate(row.d2lEnd)} → ${displayDate(row.expectedEnd)}`;
    }).join('\n');
    const more = targets.length > 6 ? `\n...and ${targets.length - 6} more` : '';
    const rule = field === 'start'
        ? 'Only start dates change. Each one is set to the master schedule start date.'
        : `Only end dates change. Each one is set to the schedule end date plus ${OPEN_DAYS_AFTER_SCHEDULE_END} days.`;
    const ok = confirm(`Update the ${label} date on ${targets.length} Brightspace courses?\n\n${rule}\n\n${preview}${more}`);
    if (!ok) return;

    const button = document.getElementById(field === 'start' ? 'bulkStartBtn' : 'bulkEndBtn');
    writing = true;
    if (button) button.disabled = true;
    LoadingUtils.showLoadingModal(`Updating ${label} dates...`, 'loadingModal', () => {});
    let saved = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
        if (LoadingUtils.isCancelled('loadingModal')) break;
        const row = targets[i];
        LoadingUtils.updateLoadingModal(
            Math.round(((i + 1) / targets.length) * 100),
            `Updating ${i + 1} of ${targets.length}: ${row.code}`
        );
        try {
            await writeCourseDates(row, field === 'start' ? row.expectedStart : '', field === 'end' ? row.expectedEnd : '');
            saved += 1;
        } catch (error) {
            failed += 1;
            row.rowMessage = shortApiError(error);
            row.messageTone = 'err';
        }
    }
    LoadingUtils.hideLoadingModal();
    writing = false;
    statusBanner = `Updated the ${label} date on ${saved} course(s).${failed ? ` ${failed} could not be updated.` : ''}`;
    updateActionButtons();
    renderReport();
    alert(statusBanner);
}

async function applyScheduleField(id, field) {
    const row = comparisonRows.find((item) => item.id === id);
    if (!row || !row.orgUnitId) return;
    const nextDay = field === 'start' ? row.expectedStart : row.expectedEnd;
    if (!nextDay) return;
    const current = field === 'start' ? row.d2lStart : row.d2lEnd;
    const otherLabel = field === 'start' ? 'end' : 'start';
    const otherValue = field === 'start' ? displayDate(row.d2lEnd) : displayDate(row.d2lStart);
    const detail = field === 'end'
        ? `This is the schedule end (${displayDate(row.scheduleEnd)}) plus ${OPEN_DAYS_AFTER_SCHEDULE_END} days.`
        : 'This is the master schedule start date.';
    const ok = confirm(
        `Set only the ${field} date on ${row.code}?\n\n` +
        `${field[0].toUpperCase()}${field.slice(1)}: ${displayDate(current)} → ${displayDate(nextDay)}\n` +
        `${detail}\nThe ${otherLabel} date stays ${otherValue}.`
    );
    if (!ok) return;
    await saveRow(row, field === 'start' ? nextDay : '', field === 'end' ? nextDay : '');
}

async function saveManualField(id, field) {
    const row = comparisonRows.find((item) => item.id === id);
    if (!row || !row.orgUnitId) return;
    const input = document.querySelector(`input[data-id="${CSS.escape(id)}"][data-field="${field}"]`);
    const day = input ? input.value : '';
    if (!day) {
        alert(`Enter a ${field} date first.`);
        return;
    }
    const otherDay = field === 'start' ? row.d2lEnd : row.d2lStart;
    if (otherDay && ((field === 'start' && day >= otherDay) || (field === 'end' && day <= otherDay))) {
        alert(`The ${field} date has to stay ${field === 'start' ? 'before' : 'after'} the other date (${displayDate(otherDay)}).`);
        return;
    }
    const ok = confirm(
        `Save only the ${field} date on ${row.code} as ${displayDate(day)}?\n\nThe other date will not change.`
    );
    if (!ok) return;
    await saveRow(row, field === 'start' ? day : '', field === 'end' ? day : '');
}

async function saveRow(row, startDay, endDay) {
    writing = true;
    row.rowMessage = 'Saving...';
    row.messageTone = '';
    renderReport();
    try {
        await writeCourseDates(row, startDay, endDay);
    } catch (error) {
        row.rowMessage = shortApiError(error);
        row.messageTone = 'err';
    }
    writing = false;
    updateActionButtons();
    renderReport();
}

function shortApiError(error) {
    const text = String((error && error.message) || error || 'The update failed.');
    const bracket = text.match(/\[([^\]]+)\]/);
    if (bracket) return bracket[1];
    const detail = text.split('—').pop().trim();
    return detail.length > 180 ? `${detail.slice(0, 180)}…` : detail;
}

async function writeCourseDates(row, startDay, endDay) {
    const course = await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/courses/${row.orgUnitId}`);
    const startDate = startDay ? resolveUtc(course.StartDate, startDay, false) : (course.StartDate || null);
    const endDate = endDay ? resolveUtc(course.EndDate, endDay, true) : (course.EndDate || null);
    const nextStart = startDate;
    const nextEnd = endDate;
    if (nextStart && nextEnd && new Date(nextStart).getTime() >= new Date(nextEnd).getTime()) {
        throw new Error('Start date has to be before the end date. The other date was not changed.');
    }
    const payload = {
        Name: course.Name,
        Code: course.Code,
        Path: course.Path,
        CourseTemplateId: parseInt(course.CourseTemplate?.Identifier, 10) || 0,
        SemesterId: parseInt(course.Semester?.Identifier, 10) || 0,
        StartDate: startDate,
        EndDate: endDate,
        StartDateAvailabilityType: startDay ? 1 : (course.StartDateAvailabilityType ?? 1),
        EndDateAvailabilityType: endDay ? 1 : (course.EndDateAvailabilityType ?? 1),
        LocaleId: course.LocaleId ?? null,
        ForceLocale: course.ForceLocale ?? false,
        ShowAddressBook: course.ShowAddressBook ?? false,
        Description: {
            Content: course.Description?.Html || '',
            Type: 'Text|Html'
        },
        CanSelfRegister: course.CanSelfRegister ?? false,
        IsActive: course.IsActive
    };
    await D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/courses/${row.orgUnitId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    if (startDay) {
        row.d2lStartRaw = startDate;
        row.d2lStart = calendarDateInZone(startDate, CAMPUS_TIME_ZONE);
    }
    if (endDay) {
        row.d2lEndRaw = endDate;
        row.d2lEnd = calendarDateInZone(endDate, CAMPUS_TIME_ZONE);
    }
    row.loadError = '';
    classifyRow(row);
    const changed = [startDay ? 'start' : '', endDay ? 'end' : ''].filter(Boolean).join(' and ');
    row.rowMessage = row.kind === 'match'
        ? `Saved the ${changed} date. Brightspace now matches the schedule rule.`
        : `Saved the ${changed} date.`;
    row.messageTone = 'ok';
    statusBanner = row.kind === 'match'
        ? `${row.code} ${changed} date was updated and now matches the schedule.`
        : `${row.code} ${changed} date was saved. The other date was left as it is.`;
}

function renderReport() {
    const summary = document.getElementById('summary');
    const container = document.getElementById('report-container');
    if (!comparisonRows.length && !skippedShells.length) {
        summary.innerHTML = '';
        container.innerHTML = '';
        return;
    }

    const counts = countKinds(comparisonRows);
    summary.innerHTML = `
        <div class="card">
            <div class="summary-row">
                ${summaryButton('mismatch', counts.mismatch + counts.error, 'Mismatched', true)}
                ${summaryButton('match', counts.match, 'Matching', false)}
                ${summaryButton('d2l-only', counts['d2l-only'], 'In D2L only', false)}
                ${summaryButton('schedule-only', counts['schedule-only'], 'In schedule only', false)}
                ${counts.conflict ? summaryButton('conflict', counts.conflict, 'Schedule conflicts', true) : ''}
                ${summaryButton('all', comparisonRows.length, 'All compared', false)}
            </div>
            ${statusBanner ? `<p class="note">${escapeHtml(statusBanner)}</p>` : ''}
            ${comparisonRows.scheduleNote ? `<p class="note">${escapeHtml(comparisonRows.scheduleNote)}</p>` : ''}
            ${skippedShells.length ? renderSkipped() : ''}
        </div>
    `;

    const searchValue = (document.getElementById('rowSearch') || {}).value || '';
    if (!document.getElementById('table-host')) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="toolbar">
                <div class="field" style="margin:0;">
                    <label for="rowSearch">Search</label>
                    <input id="rowSearch" type="search" value="${escapeHtml(searchValue)}" placeholder="Course code or title">
                </div>
            </div>
            <p id="table-count" class="note"></p>
            <div id="table-host" class="table-wrap"></div>
        `;
        container.innerHTML = '';
        container.appendChild(card);
    }
    renderTable();
}

function renderTable() {
    const host = document.getElementById('table-host');
    const count = document.getElementById('table-count');
    if (!host || !count) return;
    const searchValue = (document.getElementById('rowSearch') || {}).value || '';
    const visible = comparisonRows.filter((row) => {
        if (!rowMatchesFilter(row, activeFilter)) return false;
        if (!searchValue.trim()) return true;
        const haystack = `${row.code} ${row.name} ${row.issue} ${row.status}`.toLowerCase();
        return haystack.includes(searchValue.trim().toLowerCase());
    }).sort(compareSort);
    count.textContent = `Showing ${visible.length} course${visible.length === 1 ? '' : 's'}. D2L end dates are expected to be ${OPEN_DAYS_AFTER_SCHEDULE_END} days after the schedule end. Dates are the Eastern calendar day.`;
    host.innerHTML = '';
    if (!visible.length) {
        host.innerHTML = '<p>Nothing in this view.</p>';
        return;
    }
    host.appendChild(buildTable(visible));
}

function summaryButton(filter, count, label, warn) {
    const active = activeFilter === filter ? ' active' : '';
    const bad = warn && count ? ' bad' : '';
    return `<button type="button" class="summary-btn${active}${bad}" data-filter="${filter}"><strong>${count}</strong><span>${escapeHtml(label)}</span></button>`;
}

function renderSkipped() {
    const codes = skippedShells.map((item) => `${item.code || item.name} (${item.reason})`).join(', ');
    return `<details><summary>Skipped ${skippedShells.length} CXLD, MERGED, or template shell${skippedShells.length === 1 ? '' : 's'}</summary><p class="note">${escapeHtml(codes)}</p></details>`;
}

function buildTable(rows) {
    const table = document.createElement('table');
    table.className = 'schedule-table';
    table.innerHTML = `
        <thead>
            <tr>
                ${sortHeader('code', 'Course')}
                ${sortHeader('scheduleStart', 'Schedule start')}
                ${sortHeader('scheduleEnd', 'Schedule end')}
                ${sortHeader('d2lStart', 'D2L start')}
                ${sortHeader('d2lEnd', 'D2L end')}
                ${sortHeader('expectedEnd', 'Expected D2L end')}
                ${sortHeader('issue', 'Issue')}
                <th>Update one date</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    rows.forEach((row) => tbody.appendChild(buildRow(row)));
    return table;
}

function buildRow(row) {
    const tr = document.createElement('tr');
    const title = row.name ? `<div class="note">${escapeHtml(row.name)}</div>` : '';
    const meta = [row.status, row.courseType].filter(Boolean).join(' · ');
    const codeCell = row.orgUnitId
        ? `<a href="https://your-brightspace.example.edu/d2l/home/${encodeURIComponent(row.orgUnitId)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.code || row.orgUnitId)}</a>`
        : escapeHtml(row.code || '');
    const startMismatch = Boolean(row.expectedStart) && row.d2lStart !== row.expectedStart;
    const endMismatch = Boolean(row.expectedEnd) && row.d2lEnd !== row.expectedEnd;
    tr.innerHTML = `
        <td>${codeCell}${title}${meta ? `<div class="note">${escapeHtml(meta)}</div>` : ''}</td>
        <td>${escapeHtml(displayDate(row.scheduleStart))}</td>
        <td>${escapeHtml(displayDate(row.scheduleEnd))}</td>
        <td class="${startMismatch ? 'date-bad' : ''}">${escapeHtml(displayDate(row.d2lStart))}</td>
        <td class="${endMismatch ? 'date-bad' : ''}">${escapeHtml(displayDate(row.d2lEnd))}</td>
        <td class="${row.expectedEnd && !endMismatch ? 'date-ok' : ''}">${escapeHtml(displayDate(row.expectedEnd))}</td>
        <td class="issue">${escapeHtml(row.issue || '')}</td>
        <td class="actions-cell">${actionCell(row)}</td>
    `;
    return tr;
}

function sortHeader(key, label) {
    const active = sortKey === key ? (sortDir === 1 ? ' sort-asc' : ' sort-desc') : '';
    return `<th class="sortable${active}" data-sort="${key}" scope="col">${escapeHtml(label)}</th>`;
}

function compareSort(a, b) {
    const av = String(a[sortKey] || '');
    const bv = String(b[sortKey] || '');
    if (av === bv) return String(a.code).localeCompare(String(b.code), undefined, { numeric: true });
    if (!av) return 1;
    if (!bv) return -1;
    return av.localeCompare(bv, undefined, { numeric: true }) * sortDir;
}

function actionCell(row) {
    if (!row.orgUnitId) return '<span class="note">No Brightspace course to update</span>';
    if (row.kind === 'conflict') return '<span class="note">Fix the duplicate schedule rows before applying a date.</span>';
    const startValue = row.d2lStart || row.expectedStart || '';
    const endValue = row.d2lEnd || row.expectedEnd || '';
    const startDisabled = row.expectedStart && row.d2lStart !== row.expectedStart ? '' : 'disabled';
    const endDisabled = row.expectedEnd && row.d2lEnd !== row.expectedEnd ? '' : 'disabled';
    const message = row.rowMessage
        ? `<div class="row-msg ${row.messageTone || ''}">${escapeHtml(row.rowMessage)}</div>`
        : '';
    return `
        <div class="date-line">
            <span class="date-label">Start</span>
            <input type="date" data-id="${escapeHtml(row.id)}" data-field="start" value="${escapeHtml(startValue)}">
            <span class="date-actions">
                <button type="button" class="btn-secondary btn-sm" data-action="set-start" data-id="${escapeHtml(row.id)}" ${startDisabled} title="Set the start date to the master schedule. The end date stays as it is.">Set start</button>
                <button type="button" class="btn-primary btn-sm" data-action="save-start" data-id="${escapeHtml(row.id)}">Save start</button>
            </span>
        </div>
        <div class="date-line">
            <span class="date-label">End</span>
            <input type="date" data-id="${escapeHtml(row.id)}" data-field="end" value="${escapeHtml(endValue)}">
            <span class="date-actions">
                <button type="button" class="btn-secondary btn-sm" data-action="set-end" data-id="${escapeHtml(row.id)}" ${endDisabled} title="Set the end date to the schedule end plus 7 days. The start date stays as it is.">Set end</button>
                <button type="button" class="btn-primary btn-sm" data-action="save-end" data-id="${escapeHtml(row.id)}">Save end</button>
            </span>
        </div>
        ${message}
    `;
}

function downloadComparison() {
    const headers = [
        'Course Code', 'Org Unit Id', 'Title', 'Status', 'Course Type',
        'Schedule Start', 'Schedule End', 'Expected D2L Start', 'Expected D2L End',
        'D2L Start', 'D2L End', 'Result', 'Issue'
    ];
    const lines = [headers.join(',')];
    comparisonRows.forEach((row) => {
        lines.push([
            row.code, row.orgUnitId || '', row.name, row.status, row.courseType,
            displayDate(row.scheduleStart), displayDate(row.scheduleEnd),
            displayDate(row.expectedStart), displayDate(row.expectedEnd),
            displayDate(row.d2lStart), displayDate(row.d2lEnd),
            row.kind, row.issue
        ].map(csvCell).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `master-schedule-dates_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function buildComparison({ offerings, detailsById, scheduleRows }) {
    sampledStartClock = null;
    sampledEndClock = null;
    const scheduleByShell = indexSchedule(scheduleRows);
    const usedShells = new Set();
    const rows = [];

    offerings.forEach((offering) => {
        const orgUnitId = offering.Identifier;
        const detail = detailsById.get(String(orgUnitId));
        const code = (detail && detail.Code) || offering.Code || '';
        const shell = toShellCourseCode(code);
        const matches = scheduleByShell.get(shell) || [];
        if (matches.length) usedShells.add(shell);
        const row = blankRow({
            id: String(orgUnitId),
            orgUnitId,
            code,
            name: (detail && detail.Name) || offering.Name || '',
            isActive: detail ? detail.IsActive : null
        });
        if (detail && detail.error) {
            row.loadError = detail.error;
            applyScheduleSide(row, matches);
            row.kind = 'error';
            row.issue = 'Could not read this course from Brightspace. ' + detail.error;
            rows.push(row);
            return;
        }
        if (detail && !detail.error) {
            row.d2lStartRaw = detail.StartDate || '';
            row.d2lEndRaw = detail.EndDate || '';
            row.d2lStart = calendarDateInZone(detail.StartDate, CAMPUS_TIME_ZONE);
            row.d2lEnd = calendarDateInZone(detail.EndDate, CAMPUS_TIME_ZONE);
            if (!row.name) row.name = detail.Name || '';
        }
        applyScheduleSide(row, matches);
        classifyRow(row);
        rememberGoodClocks(row);
        rows.push(row);
    });

    scheduleByShell.forEach((matches, shell) => {
        if (usedShells.has(shell)) return;
        const row = blankRow({
            id: `schedule:${shell}`,
            orgUnitId: null,
            code: matches[0].code || shell,
            name: matches[0].title || ''
        });
        applyScheduleSide(row, matches);
        classifyRow(row);
        rows.push(row);
    });

    rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    return rows;
}

function blankRow(seed) {
    return Object.assign({
        id: '',
        orgUnitId: null,
        code: '',
        name: '',
        status: '',
        courseType: '',
        scheduleStart: '',
        scheduleEnd: '',
        expectedStart: '',
        expectedEnd: '',
        d2lStart: '',
        d2lEnd: '',
        d2lStartRaw: '',
        d2lEndRaw: '',
        kind: '',
        issue: '',
        loadError: '',
        rowMessage: '',
        messageTone: '',
        isActive: null,
        hasSchedule: false,
        conflictNote: ''
    }, seed);
}

function applyScheduleSide(row, matches) {
    if (!matches.length) return;
    row.hasSchedule = true;
    const dates = uniqueDatePairs(matches);
    row.status = matches[0].status || '';
    row.courseType = matches[0].courseType || '';
    row.name = row.name || matches[0].title || '';
    if (dates.length > 1) {
        row.conflictNote = dates.map((pair) => `${displayDate(pair.start)}–${displayDate(pair.end)}`).join('; ');
        return;
    }
    const pair = dates[0] || { start: '', end: '' };
    row.scheduleStart = pair.start;
    row.scheduleEnd = pair.end;
    row.expectedStart = pair.start;
    row.expectedEnd = pair.end ? addDays(pair.end, OPEN_DAYS_AFTER_SCHEDULE_END) : '';
}

function classifyRow(row) {
    if (row.loadError) {
        row.kind = 'error';
        row.issue = 'Could not read this course from Brightspace. ' + row.loadError;
        return;
    }
    if (row.conflictNote) {
        row.kind = 'conflict';
        row.issue = 'The schedule lists more than one date range for this course: ' + row.conflictNote;
        return;
    }
    if (!row.hasSchedule) {
        row.kind = 'd2l-only';
        row.issue = 'No matching row in the master schedule.';
        return;
    }
    if (!row.orgUnitId) {
        row.kind = 'schedule-only';
        row.issue = 'No matching Brightspace course in this semester.';
        return;
    }
    const issues = [];
    if (!row.scheduleStart || !row.scheduleEnd) issues.push('The schedule row is missing a start or end date.');
    if (row.expectedStart && row.d2lStart !== row.expectedStart) {
        issues.push(row.d2lStart ? 'Start date does not match the schedule.' : 'Start date is blank in D2L.');
    }
    if (row.expectedEnd && row.d2lEnd !== row.expectedEnd) {
        issues.push(row.d2lEnd
            ? `End date should be ${displayDate(row.expectedEnd)} (schedule end plus ${OPEN_DAYS_AFTER_SCHEDULE_END} days).`
            : 'End date is blank in D2L.');
    }
    row.issue = issues.join(' ');
    row.kind = issues.length ? 'mismatch' : 'match';
}

function rowMatchesFilter(row, filter) {
    if (filter === 'all') return true;
    if (filter === 'mismatch') return row.kind === 'mismatch' || row.kind === 'error';
    return row.kind === filter;
}

function countKinds(rows) {
    const counts = { mismatch: 0, match: 0, 'd2l-only': 0, 'schedule-only': 0, conflict: 0, error: 0 };
    rows.forEach((row) => {
        counts[row.kind] = (counts[row.kind] || 0) + 1;
    });
    return counts;
}

function indexSchedule(scheduleRows) {
    const map = new Map();
    scheduleRows.forEach((row) => {
        const shell = toShellCourseCode(row.code);
        if (!shell) return;
        if (!map.has(shell)) map.set(shell, []);
        map.get(shell).push(row);
    });
    return map;
}

function uniqueDatePairs(matches) {
    const seen = new Map();
    matches.forEach((row) => {
        const key = `${row.start}|${row.end}`;
        if (!seen.has(key)) seen.set(key, { start: row.start, end: row.end });
    });
    return [...seen.values()];
}

function normalizeTerm(value) {
    return String(value || '').toUpperCase().replace(/\s+/g, '');
}

function filterScheduleToSemester(rows, semesterCode) {
    const code = normalizeTerm(semesterCode);
    const terms = [...new Set(rows.map((row) => row.term).filter(Boolean))];
    if (!code) {
        if (terms.length > 1) {
            return {
                rows: [],
                message: `This file has more than one term (${terms.join(', ')}). Select a semester from the list so the matching term can be used.`
            };
        }
        return { rows, message: terms.length ? `Compared term ${terms[0]}.` : '' };
    }
    const matched = rows.filter((row) => !row.term || row.term === code);
    const other = rows.filter((row) => row.term && row.term !== code);
    if (!matched.length) {
        return {
            rows: [],
            message: `None of the schedule rows use term ${code}. The file has: ${terms.join(', ') || '(no Term column values)'}.`
        };
    }
    const message = other.length
        ? `Compared ${matched.length} row(s) for ${code}. Left out ${other.length} row(s) for other terms.`
        : `Compared ${matched.length} schedule row(s) for ${code}.`;
    return { rows: matched, message };
}

function parseScheduleCsv(text) {
    const table = parseCsv(text);
    if (!table.length) return { error: 'The CSV is empty.' };
    const headers = table[0];
    const rows = [];
    const unreadable = [];
    for (let i = 1; i < table.length; i++) {
        const record = {};
        headers.forEach((header, index) => {
            record[header] = table[i][index] == null ? '' : String(table[i][index]).trim();
        });
        if (table[i].every((cell) => !String(cell || '').trim())) continue;
        const code = getCombinedCourseCode(record);
        if (!code) continue;
        const startRaw = getCell(record, ['Start Date', 'StartDate', 'Start', 'SEC_START_DATE']);
        const endRaw = getCell(record, ['End Date', 'EndDate', 'End', 'SEC_END_DATE']);
        const start = parseScheduleDate(startRaw);
        const end = parseScheduleDate(endRaw);
        if ((startRaw && !start) || (endRaw && !end)) {
            unreadable.push(code);
        }
        rows.push({
            code,
            term: normalizeTerm(getCell(record, ['Term', 'TERM', 'Semester'])),
            status: getCell(record, ['Status', 'SEC_STATUS', 'Sec_Status']),
            title: getCell(record, ['Short Title', 'ShortTitle', 'Title', 'Course Title']),
            courseType: getCell(record, ['CourseType', 'Course Type', 'Type']),
            start,
            end
        });
    }
    if (!rows.length) {
        return { error: 'No course rows were found. The file needs a course code column such as "Combined Depts, Course Number, Section".' };
    }
    if (unreadable.length) {
        return { error: `Could not read a date for: ${unreadable.slice(0, 8).join(', ')}. Use dates like 9/1/26 or 10/20/2026.` };
    }
    return { rows };
}

function parseScheduleDate(value) {
    const raw = String(value || '').trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?$/i, '');
    if (!raw) return '';
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (match) return validIso(+match[1], +match[2], +match[3]);
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(raw);
    if (!match) return '';
    let year = +match[3];
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return validIso(year, +match[1], +match[2]);
}

function validIso(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(isoDay, days) {
    const [year, month, day] = isoDay.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function displayDate(isoDay) {
    if (!isoDay) return '—';
    const [year, month, day] = isoDay.split('-');
    if (!year || !month || !day) return isoDay;
    return `${Number(month)}/${Number(day)}/${year}`;
}

function rememberGoodClocks(row) {
    if (row.kind !== 'match') return;
    if (!sampledStartClock && row.d2lStartRaw) sampledStartClock = easternClock(row.d2lStartRaw);
    if (!sampledEndClock && row.d2lEndRaw) sampledEndClock = easternClock(row.d2lEndRaw);
}

function easternClock(iso) {
    const parts = zonedParts(new Date(iso), CAMPUS_TIME_ZONE);
    return { h: Number(parts.hour), m: Number(parts.minute), s: Number(parts.second) };
}

function resolveUtc(existingIso, desiredDay, endOfDay) {
    if (existingIso && calendarDateInZone(existingIso, CAMPUS_TIME_ZONE) === desiredDay) {
        return new Date(existingIso).toISOString();
    }
    const [year, month, day] = desiredDay.split('-').map(Number);
    const sampled = endOfDay ? sampledEndClock : sampledStartClock;
    const clock = sampled || (endOfDay ? { h: 23, m: 59, s: 0 } : { h: 0, m: 0, s: 0 });
    return wallTimeToUtc(year, month, day, clock.h, clock.m, clock.s, CAMPUS_TIME_ZONE);
}

function calendarDateInZone(value, timeZone) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = zonedParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function wallTimeToUtc(year, month, day, hour, minute, second, timeZone) {
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    let utc = desired;
    for (let i = 0; i < 4; i++) {
        const parts = zonedParts(new Date(utc), timeZone);
        const got = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
        const diff = got - desired;
        if (diff === 0) break;
        utc -= diff;
    }
    return new Date(utc).toISOString();
}

function zonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const parts = {};
    formatter.formatToParts(date).forEach((part) => {
        if (part.type !== 'literal') parts[part.type] = part.value;
    });
    if (parts.hour === '24') parts.hour = '00';
    return parts;
}

function skipReason(code, name) {
    const courseCode = String(code || '').toUpperCase();
    const courseName = String(name || '').toUpperCase();
    if (courseCode.includes('CXLD') || courseName.includes('CXLD')) return 'CXLD';
    if (courseCode.includes('MERGED') || courseName.includes('MERGED')) return 'MERGED';
    // Section offerings are coded RT-121-FA700-26/FA-COURSE. Template shells have no section token.
    if (!/[A-Z]{2}\d{3}/.test(toShellCourseCode(courseCode))) return 'template shell';
    return '';
}

function toShellCourseCode(code) {
    let full = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
    full = full.replace(/-COURSE$/, '');
    const match = /^(.+)-(\d{2})\/(WI|WN|SP|FA|SU|SM|SS)$/.exec(full);
    return match ? match[1] : full;
}

function getCombinedCourseCode(row) {
    const named = getCell(row, [
        'Combined Depts, Course Number, Section',
        'Combined Depts, Course Number, Section, Term',
        'Course Code',
        'CourseCode',
        'Code',
        'SEC_NAME',
        'Section Name'
    ]);
    if (named) return named;
    const dept = getCell(row, ['SEC_DEPTS', 'Department', 'Depts']);
    const num = getCell(row, ['SEC_COURSE_NO', 'Course Number', 'CourseNo']);
    const sec = getCell(row, ['SEC_NO', 'Section']);
    if (dept && num && sec) return `${dept}-${num}-${sec}`;
    return '';
}

function normalizeHeaderKey(value) {
    return String(value || '').replace(/^\uFEFF/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getCell(row, candidates) {
    const keys = Object.keys(row);
    const normMap = new Map();
    keys.forEach((key) => {
        const normalized = normalizeHeaderKey(key);
        if (normalized && !normMap.has(normalized)) normMap.set(normalized, key);
    });
    function valueOf(key) {
        if (!key || row[key] == null) return '';
        return String(row[key]).trim();
    }
    for (const candidate of candidates) {
        const exact = valueOf(candidate);
        if (exact) return exact;
        const named = valueOf(normMap.get(normalizeHeaderKey(candidate)));
        if (named) return named;
    }
    return '';
}

function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (inQuotes) {
            if (char === '"') {
                if (source[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(cell);
            cell = '';
        } else if (char === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }
    if (cell.length || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows.filter((item) => item.some((value) => String(value || '').trim() !== ''));
}

function csvCell(value) {
    const text = String(value == null ? '' : value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

async function mapPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function run() {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index], index);
        }
    }
    const workers = [];
    const size = Math.min(limit, items.length);
    for (let i = 0; i < size; i++) workers.push(run());
    await Promise.all(workers);
    return results;
}

window.MasterScheduleDateCheck = {
    OPEN_DAYS_AFTER_SCHEDULE_END,
    CAMPUS_TIME_ZONE,
    parseScheduleCsv,
    filterScheduleToSemester,
    buildComparison,
    addDays,
    calendarDateInZone,
    resolveUtc,
    displayDate,
    toShellCourseCode,
    skipReason
};
