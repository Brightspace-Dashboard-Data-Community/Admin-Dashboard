/**
 * Course Module Completion Report
 * Single learner (Org Defined ID) or entire classlist — LE Content completion APIs.
 */

const LP_VER = '1.46';
const LE_VER = '1.85';
const TOPIC_COMPLETION_DELAY_MS = 35;
const TOPIC_FETCH_CONCURRENCY = 5;

/** Brightspace default role IDs: skip these when "Learners only" is selected */
const INSTRUCTOR_DESIGNER_ROLE_IDS = new Set([105, 106]);

let lastExportBundle = null;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(str) {
    if (str == null || str === '') return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function formatCompletionDate(value) {
    if (value == null || value === '') return '';
    try {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleString();
    } catch {
        return String(value);
    }
}

function logMessage(msg) {
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

function getReportMode() {
    const el = document.querySelector('input[name="reportMode"]:checked');
    return el && el.value === 'classlist' ? 'classlist' : 'single';
}

function syncModeUI() {
    const mode = getReportMode();
    const studentField = document.getElementById('studentId');
    const classlistOpts = document.getElementById('classlistOptions');
    const singleGroup = document.getElementById('singleStudentFieldGroup');
    if (studentField) {
        studentField.disabled = mode === 'classlist';
    }
    if (singleGroup) {
        singleGroup.classList.toggle('text-muted', mode === 'classlist');
        singleGroup.style.opacity = mode === 'classlist' ? '0.72' : '1';
    }
    if (classlistOpts) {
        classlistOpts.hidden = mode !== 'classlist';
    }
}

async function getUserByStudentId(studentId) {
    logMessage('Looking up student…');
    const users = await D2LApi._fetch(
        `/d2l/api/lp/${LP_VER}/users/?orgDefinedId=${encodeURIComponent(studentId)}`
    );
    if (!users || users.length === 0) {
        throw new Error('Student not found for that Org Defined ID.');
    }
    return users[0];
}

async function getCourseTOC(orgUnitId) {
    logMessage('Loading course content structure…');
    return D2LApi._fetch(`/d2l/api/le/${LE_VER}/${orgUnitId}/content/toc`);
}

async function getClasslist(ou) {
    const vers = ['1.82', '1.78', '1.70', '1.65'];
    for (const v of vers) {
        const base = `/d2l/api/le/${v}/${ou}/classlist`;
        try {
            const url1 = `${base}/?pageSize=1000`;
            const data = await D2LApi._fetch(url1);
            if (Array.isArray(data) && data.length) {
                return data;
            }
            if (data && data.Items && data.Items.length) {
                return data.Items;
            }
        } catch (e) {
            /* try paged */
        }

        try {
            let acc = [];
            let bookmark = '';
            for (let i = 0; i < 80; i++) {
                const url2 =
                    `${base}/paged/?pageSize=100` + (bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : '');
                const page = await D2LApi._fetch(url2);
                if (page && page.Items && page.Items.length) {
                    acc = acc.concat(page.Items);
                }
                if (!page || !page.PagingInfo || !page.PagingInfo.Bookmark) {
                    break;
                }
                bookmark = page.PagingInfo.Bookmark;
                await sleep(120);
            }
            if (acc.length) {
                return acc;
            }
        } catch (e) {
            /* next version */
        }
    }
    return [];
}

function classlistMemberName(user) {
    if (user.FirstName || user.LastName) {
        return `${user.FirstName || ''} ${user.LastName || ''}`.trim();
    }
    return user.DisplayName || user.Name || user.UserName || user.Username || 'Unknown';
}

function filterClasslistMembers(members, roleFilter) {
    return members.filter((u) => {
        const userId = u.UserId ?? u.Identifier;
        if (userId == null || userId === '') {
            return false;
        }
        if (roleFilter === 'all') {
            return true;
        }
        const rid = Number(u.RoleId ?? u.Role?.Id);
        if (!Number.isFinite(rid)) {
            return true;
        }
        return !INSTRUCTOR_DESIGNER_ROLE_IDS.has(rid);
    });
}

function flattenModules(modules, parentTitle = '') {
    let output = [];
    modules.forEach((module) => {
        const moduleTitle = parentTitle ? `${parentTitle} > ${module.Title}` : module.Title;
        if (module.Topics && module.Topics.length > 0) {
            module.Topics.forEach((topic) => {
                output.push({
                    ModuleTitle: moduleTitle,
                    TopicTitle: topic.Title,
                    TopicId: topic.TopicId
                });
            });
        }
        if (module.Modules && module.Modules.length > 0) {
            output = output.concat(flattenModules(module.Modules, moduleTitle));
        }
    });
    return output;
}

async function getTopicCompletion(orgUnitId, topicId, userId) {
    try {
        return await D2LApi._fetch(
            `/d2l/api/le/${LE_VER}/${orgUnitId}/content/topics/${topicId}/completion/${userId}`
        );
    } catch (e) {
        console.warn('Topic completion unavailable:', topicId, userId, e);
        return null;
    }
}

function parseCompletionRecord(completion) {
    let completed = false;
    let completionDate = '';
    if (!completion) {
        return { completed, completionDate };
    }
    completed =
        completion.IsCompleted === true ||
        completion.Completed === true ||
        completion.isCompleted === true;
    const rawDate =
        completion.CompletionDate ||
        completion.CompletedDate ||
        completion.completionDate ||
        '';
    completionDate = rawDate ? formatCompletionDate(rawDate) : '';
    return { completed, completionDate };
}

function buildModuleSummary(reportRows) {
    const moduleSummary = {};
    reportRows.forEach((row) => {
        if (!moduleSummary[row.Module]) {
            moduleSummary[row.Module] = { total: 0, completed: 0 };
        }
        moduleSummary[row.Module].total++;
        if (row.Completed) {
            moduleSummary[row.Module].completed++;
        }
    });
    return moduleSummary;
}

async function buildReportRowsForUser(orgUnitId, topics, userId) {
    const reportRows = [];
    for (let i = 0; i < topics.length; i += TOPIC_FETCH_CONCURRENCY) {
        const slice = topics.slice(i, i + TOPIC_FETCH_CONCURRENCY);
        const completions = await Promise.all(
            slice.map((topic) => getTopicCompletion(orgUnitId, topic.TopicId, userId))
        );
        for (let j = 0; j < slice.length; j++) {
            const topic = slice[j];
            const { completed, completionDate } = parseCompletionRecord(completions[j]);
            reportRows.push({
                Module: topic.ModuleTitle,
                Topic: topic.TopicTitle,
                Completed: completed,
                CompletionDate: completionDate
            });
        }
        if (TOPIC_COMPLETION_DELAY_MS > 0 && i + TOPIC_FETCH_CONCURRENCY < topics.length) {
            await sleep(TOPIC_COMPLETION_DELAY_MS);
        }
    }
    return reportRows;
}

function renderSingleStudentResults(user, orgUnitId, moduleSummary, reportRows) {
    const studentName = `${user.FirstName} ${user.LastName}`;
    let html = '';
    html += '<div class="module-report-meta">';
    html += '<h3 class="module-report-heading">Student</h3>';
    html += '<table class="display module-report-table" style="width:100%">';
    html += '<tbody>';
    html += `<tr><th scope="row">Name</th><td>${escapeHtml(studentName)}</td></tr>`;
    html += `<tr><th scope="row">Org Defined ID</th><td>${escapeHtml(user.OrgDefinedId)}</td></tr>`;
    html += `<tr><th scope="row">User ID</th><td>${escapeHtml(String(user.UserId))}</td></tr>`;
    html += `<tr><th scope="row">Course OrgUnit ID</th><td>${escapeHtml(orgUnitId)}</td></tr>`;
    html += '</tbody></table></div>';

    html += '<h3 class="module-report-heading">Module summary</h3>';
    html += '<div class="table-container"><table class="display module-report-table" style="width:100%">';
    html += '<thead><tr>';
    html += '<th>Module</th><th>Completed topics</th><th>Total topics</th><th>Status</th><th>Percent</th>';
    html += '</tr></thead><tbody>';

    Object.keys(moduleSummary).forEach((module) => {
        const data = moduleSummary[module];
        const percent = data.total ? Math.round((data.completed / data.total) * 100) : 0;
        const status = data.completed === data.total ? 'Complete' : 'Incomplete';
        const statusClass = data.completed === data.total ? 'status-ok' : 'status-warn';
        html += '<tr>';
        html += `<td>${escapeHtml(module)}</td>`;
        html += `<td>${data.completed}</td><td>${data.total}</td>`;
        html += `<td><span class="${statusClass}">${escapeHtml(status)}</span></td>`;
        html += `<td>${percent}%</td>`;
        html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<h3 class="module-report-heading module-report-heading-spaced">Topic detail</h3>';
    html +=
        '<div class="table-container"><table class="display module-report-table" id="topicDetailTable" style="width:100%">';
    html += '<thead><tr><th>Module</th><th>Topic</th><th>Completed</th><th>Completion date</th></tr></thead><tbody>';

    reportRows.forEach((row) => {
        const doneLabel = row.Completed ? 'Yes' : 'No';
        const doneClass = row.Completed ? 'status-ok' : 'status-warn';
        html += '<tr>';
        html += `<td>${escapeHtml(row.Module)}</td>`;
        html += `<td>${escapeHtml(row.Topic)}</td>`;
        html += `<td><span class="${doneClass}">${escapeHtml(doneLabel)}</span></td>`;
        html += `<td>${escapeHtml(row.CompletionDate || '—')}</td>`;
        html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
}

function renderClasslistResults(orgUnitId, topicCount, studentSummaries) {
    let html = '';
    html += '<div class="module-report-meta">';
    html += '<h3 class="module-report-heading">Course</h3>';
    html += '<table class="display module-report-table" style="width:100%"><tbody>';
    html += `<tr><th scope="row">Course OrgUnit ID</th><td>${escapeHtml(orgUnitId)}</td></tr>`;
    html += `<tr><th scope="row">Topics per learner</th><td>${escapeHtml(String(topicCount))}</td></tr>`;
    html += `<tr><th scope="row">Learners in this table</th><td>${escapeHtml(String(studentSummaries.length))}</td></tr>`;
    html += '</tbody></table></div>';

    html += '<p class="text-muted text-sm">Topic-by-topic rows for every learner are included in the CSV export (this page shows one summary row per learner).</p>';

    html += '<h3 class="module-report-heading module-report-heading-spaced">Per-learner summary</h3>';
    html += '<div class="table-container"><table class="display module-report-table" style="width:100%">';
    html += '<thead><tr>';
    html +=
        '<th>Student</th><th>Org Defined ID</th><th>User ID</th><th>Topics completed</th><th>Topics total</th><th>Percent</th>';
    html += '</tr></thead><tbody>';

    studentSummaries.forEach((s) => {
        const pctClass = s.percent >= 100 ? 'status-ok' : s.percent > 0 ? '' : 'status-warn';
        html += '<tr>';
        html += `<td>${escapeHtml(s.studentName)}</td>`;
        html += `<td>${escapeHtml(s.orgDefinedId || '—')}</td>`;
        html += `<td>${escapeHtml(String(s.userId))}</td>`;
        html += `<td>${s.completedCount}</td><td>${s.totalCount}</td>`;
        html += `<td><span class="${pctClass}">${s.percent}%</span></td>`;
        html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
}

async function generateModuleCompletionReport() {
    const orgUnitId = document.getElementById('orgUnitId').value.trim();
    const studentId = document.getElementById('studentId').value.trim();
    const resultsDiv = document.getElementById('results');
    const generateBtn = document.getElementById('generateBtn');
    const exportBtn = document.getElementById('exportBtn');
    const mode = getReportMode();
    const roleFilterEl = document.getElementById('classlistRoleFilter');
    const roleFilter = roleFilterEl && roleFilterEl.value === 'all' ? 'all' : 'learners';

    resultsDiv.innerHTML = '';
    lastExportBundle = null;
    if (exportBtn) {
        exportBtn.disabled = true;
    }

    if (!orgUnitId) {
        logMessage('Enter Course OrgUnit ID.');
        return;
    }
    if (mode === 'single' && !studentId) {
        logMessage('Enter Student Org Defined ID, or switch to Entire classlist.');
        return;
    }

    if (generateBtn) {
        generateBtn.disabled = true;
    }

    try {
        logMessage(
            mode === 'single'
                ? 'Starting module completion report (single learner)…'
                : 'Starting module completion report (classlist)…'
        );

        const toc = await getCourseTOC(orgUnitId);
        if (!toc.Modules || toc.Modules.length === 0) {
            throw new Error('No modules found in this course TOC.');
        }

        const topics = flattenModules(toc.Modules);
        logMessage(`Found ${topics.length} topics to check.`);

        if (topics.length === 0) {
            throw new Error('No topics found under modules (empty content tree).');
        }

        if (mode === 'single') {
            const user = await getUserByStudentId(studentId);
            logMessage(`Student found: ${user.FirstName} ${user.LastName}`);

            const reportRows = await buildReportRowsForUser(orgUnitId, topics, user.UserId);
            const moduleSummary = buildModuleSummary(reportRows);
            const studentName = `${user.FirstName} ${user.LastName}`;

            lastExportBundle = {
                mode: 'single',
                studentName,
                orgDefinedId: user.OrgDefinedId || '',
                userId: user.UserId,
                orgUnitId,
                moduleSummary,
                reportRows
            };

            resultsDiv.innerHTML = renderSingleStudentResults(user, orgUnitId, moduleSummary, reportRows);
        } else {
            logMessage('Loading classlist…');
            const rawClasslist = await getClasslist(orgUnitId);
            const members = filterClasslistMembers(rawClasslist, roleFilter);
            if (!members.length) {
                throw new Error(
                    'No classlist members matched. Try "Everyone on the classlist" or confirm API access.'
                );
            }
            logMessage(`Processing ${members.length} classlist member(s)…`);

            const studentSummaries = [];
            const topicDetailRows = [];

            for (let m = 0; m < members.length; m++) {
                const member = members[m];
                const userId = member.UserId ?? member.Identifier;
                const studentName = classlistMemberName(member);
                const orgDef = member.OrgDefinedId != null ? String(member.OrgDefinedId) : '';

                logMessage(`(${m + 1} / ${members.length}) ${studentName} (User ${userId})…`);

                const reportRows = await buildReportRowsForUser(orgUnitId, topics, userId);
                const completedCount = reportRows.filter((r) => r.Completed).length;
                const totalCount = reportRows.length;
                const percent = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

                studentSummaries.push({
                    studentName,
                    orgDefinedId: orgDef,
                    userId,
                    completedCount,
                    totalCount,
                    percent
                });

                reportRows.forEach((row) => {
                    topicDetailRows.push({
                        studentName,
                        orgDefinedId: orgDef,
                        userId,
                        Module: row.Module,
                        Topic: row.Topic,
                        Completed: row.Completed,
                        CompletionDate: row.CompletionDate
                    });
                });
            }

            lastExportBundle = {
                mode: 'classlist',
                orgUnitId,
                topicCount: topics.length,
                roleFilter,
                studentSummaries,
                topicDetailRows
            };

            resultsDiv.innerHTML = renderClasslistResults(orgUnitId, topics.length, studentSummaries);
        }

        logMessage('Report completed successfully.');
        if (exportBtn) {
            exportBtn.disabled = false;
        }
    } catch (error) {
        logMessage(`Error: ${error.message}`);
        console.error(error);
        resultsDiv.innerHTML = `<div class="module-report-error" role="alert"><strong>Error</strong><p>${escapeHtml(error.message)}</p></div>`;
    } finally {
        if (generateBtn) {
            generateBtn.disabled = false;
        }
    }
}

function csvEscape(cell) {
    const s = cell == null ? '' : String(cell);
    return `"${s.replace(/"/g, '""')}"`;
}

function exportResultsToCSV() {
    if (!lastExportBundle) {
        alert('Generate a report first, then export CSV.');
        return;
    }

    const lines = [];
    lines.push([csvEscape('Course Module Completion Report')].join(','));
    lines.push([csvEscape('Course OrgUnit ID'), csvEscape(lastExportBundle.orgUnitId)].join(','));

    if (lastExportBundle.mode === 'single') {
        const { studentName, orgDefinedId, userId, moduleSummary, reportRows } = lastExportBundle;
        lines.push([csvEscape('Student'), csvEscape(studentName)].join(','));
        lines.push([csvEscape('Org Defined ID'), csvEscape(orgDefinedId)].join(','));
        lines.push([csvEscape('User ID'), csvEscape(userId)].join(','));
        lines.push([]);
        lines.push([csvEscape('Module summary')].join(','));
        lines.push(
            [csvEscape('Module'), csvEscape('Completed topics'), csvEscape('Total topics'), csvEscape('Percent')].join(
                ','
            )
        );
        Object.keys(moduleSummary).forEach((module) => {
            const data = moduleSummary[module];
            const percent = data.total ? Math.round((data.completed / data.total) * 100) : 0;
            lines.push(
                [csvEscape(module), csvEscape(data.completed), csvEscape(data.total), csvEscape(`${percent}%`)].join(
                    ','
                )
            );
        });
        lines.push([]);
        lines.push([csvEscape('Topic detail')].join(','));
        lines.push(
            [csvEscape('Module'), csvEscape('Topic'), csvEscape('Completed'), csvEscape('Completion date')].join(',')
        );
        reportRows.forEach((row) => {
            lines.push(
                [
                    csvEscape(row.Module),
                    csvEscape(row.Topic),
                    csvEscape(row.Completed ? 'Yes' : 'No'),
                    csvEscape(row.CompletionDate || '')
                ].join(',')
            );
        });
    } else {
        const { topicCount, roleFilter, studentSummaries, topicDetailRows } = lastExportBundle;
        lines.push([csvEscape('Mode'), csvEscape('classlist')].join(','));
        lines.push([csvEscape('Classlist filter'), csvEscape(roleFilter)].join(','));
        lines.push([csvEscape('Topics per learner'), csvEscape(topicCount)].join(','));
        lines.push([]);
        lines.push([csvEscape('Per-learner summary')].join(','));
        lines.push(
            [
                csvEscape('Student'),
                csvEscape('Org Defined ID'),
                csvEscape('User ID'),
                csvEscape('Topics completed'),
                csvEscape('Topics total'),
                csvEscape('Percent')
            ].join(',')
        );
        studentSummaries.forEach((s) => {
            lines.push(
                [
                    csvEscape(s.studentName),
                    csvEscape(s.orgDefinedId),
                    csvEscape(s.userId),
                    csvEscape(s.completedCount),
                    csvEscape(s.totalCount),
                    csvEscape(`${s.percent}%`)
                ].join(',')
            );
        });
        lines.push([]);
        lines.push([csvEscape('Topic detail (all learners)')].join(','));
        lines.push(
            [
                csvEscape('Student'),
                csvEscape('Org Defined ID'),
                csvEscape('User ID'),
                csvEscape('Module'),
                csvEscape('Topic'),
                csvEscape('Completed'),
                csvEscape('Completion date')
            ].join(',')
        );
        topicDetailRows.forEach((row) => {
            lines.push(
                [
                    csvEscape(row.studentName),
                    csvEscape(row.orgDefinedId),
                    csvEscape(row.userId),
                    csvEscape(row.Module),
                    csvEscape(row.Topic),
                    csvEscape(row.Completed ? 'Yes' : 'No'),
                    csvEscape(row.CompletionDate || '')
                ].join(',')
            );
        });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const suffix = lastExportBundle.mode === 'classlist' ? '_classlist' : '';
    link.setAttribute('download', `course_module_completion_report${suffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
    const gen = document.getElementById('generateBtn');
    const exp = document.getElementById('exportBtn');
    if (gen) {
        gen.addEventListener('click', generateModuleCompletionReport);
    }
    if (exp) {
        exp.addEventListener('click', exportResultsToCSV);
        exp.disabled = true;
    }

    document.querySelectorAll('input[name="reportMode"]').forEach((radio) => {
        radio.addEventListener('change', syncModeUI);
    });
    syncModeUI();
});
