/**
 * Faculty Feedback Timeliness
 *
 * Scans every course that matches the semester filter. Two flags, both only
 * after the day threshold (default 7):
 * - none: no grade, published feedback, or instructor reply, and the work is
 *   at least that many days old
 * - late: feedback exists, and it took at least that many days
 *
 * Assignments count each student once, on their latest submission in the
 * semester window. Quiz attempts and top-level discussion posts are each
 * their own row. Discussion feedback is an instructor reply in that topic.
 */

const INSTRUCTOR_ROLE_ID = 102;
const LE_CANDIDATES = ['1.86', '1.85', '1.82', '1.78', '1.71'];
const ITEM_RENDER_CAP = 200;
const CLUSTER_LIMIT = 8;
const COURSE_HOME = 'https://your-brightspace.example.edu/d2l/home/';

const TOOL_LABEL = {
    assignment: 'Assignment',
    quiz: 'Quiz',
    discussion: 'Discussion'
};

let leVersion = null;
let allCoursesForSemester = [];
let currentSemesterDates = { start: null, end: null };
let lastLoadedSemesterId = null;
let scanRunning = false;

let scanResults = [];
let scanMeta = freshMeta();
let viewMode = 'courses';
let sortKey = 'total';
let sortDir = 'desc';
let expandedCourses = new Set();
let expandedActivities = new Set();
let renderPins = [];

function freshMeta() {
    return {
        ran: false,
        matched: 0,
        scanned: 0,
        stoppedEarly: false,
        timelyDays: 7,
        issues: []
    };
}

function normId(id) {
    return String(id || '').trim();
}

function getDeptPrefixFromCode(code) {
    const raw = String(code || '').trim().toUpperCase();
    const match = raw.match(/^[A-Z]{2,4}/);
    return match ? match[0] : '';
}

function shouldExcludeCourse(course) {
    const code = String(course?.Code || '').trim().toUpperCase();
    const name = String(course?.Name || '').trim().toUpperCase();
    if (/^CXLD\s*-/.test(code) || code.includes('CXLD')) return true;
    if (name.includes('MERGED') || code.includes('MERGED')) return true;
    return false;
}

function parseUtcDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function daysBetween(a, b) {
    if (!a || !b) return null;
    return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function classifyFeedback(submittedAt, feedbackAt, hasFeedback, now, timelyDays) {
    if (!submittedAt || !now) return null;
    const threshold = Number(timelyDays);
    if (!Number.isFinite(threshold)) return null;

    if (!hasFeedback || !feedbackAt) {
        const age = daysBetween(submittedAt, now);
        if (age === null || age < threshold) return null;
        return { flagType: 'none', days: age };
    }

    const diff = daysBetween(submittedAt, feedbackAt);
    if (diff === null || diff < threshold) return null;
    return { flagType: 'late', days: diff };
}

function pickLatestSubmission(entity, ctx) {
    const submissions = Array.isArray(entity?.Submissions) ? entity.Submissions : [];
    let best = null;
    for (const sub of submissions) {
        const date = parseUtcDate(sub?.SubmissionDate);
        if (!date) continue;
        if (ctx.startDate && date < ctx.startDate) continue;
        if (ctx.endDate && date > ctx.endDate) continue;
        if (!best || date > best.date) best = { date, sub };
    }
    return best;
}

function inWindow(date, ctx) {
    if (!date) return false;
    if (ctx.startDate && date < ctx.startDate) return false;
    if (ctx.endDate && date > ctx.endDate) return false;
    return true;
}

function readInt(id, fallback, min) {
    const n = parseInt(document.getElementById(id)?.value, 10);
    if (!Number.isFinite(n)) return fallback;
    if (min != null && n < min) return min;
    return n;
}

function fmtDays(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return (Math.round(value * 10) / 10).toFixed(1);
}

function fmtDateTime(value) {
    const date = value instanceof Date ? value : parseUtcDate(value);
    if (!date) return '—';
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function activityKey(tool, id, name) {
    return [tool, String(id ?? ''), name].join('\u0001');
}

function activityDomId(orgUnitId, key) {
    let hash = 0;
    const raw = String(orgUnitId) + '\0' + key;
    for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    return 'ff-activity-' + hash;
}

function flagLabel(flagType) {
    return flagType === 'late' ? 'Late feedback' : 'No feedback';
}

function formatInstructors(names) {
    const list = Array.isArray(names) ? names.filter(Boolean) : [];
    if (!list.length) return 'Instructor not listed';
    if (list.length <= 3) return list.join(', ');
    return list.slice(0, 3).join(', ') + ` and ${list.length - 3} more`;
}

function patternPhrase(stats) {
    if (!stats.total) return '';
    let kind;
    if (stats.late === 0) kind = 'All still have no feedback';
    else if (stats.none === 0) kind = 'All were graded or replied to late';
    else if (stats.none / stats.total >= 0.75) kind = 'Mostly no feedback';
    else if (stats.late / stats.total >= 0.75) kind = 'Mostly late feedback';
    else kind = 'Mixed no feedback and late feedback';

    const tools = [
        ['assignment', 'Assignments'],
        ['quiz', 'Quizzes'],
        ['discussion', 'Discussions']
    ];
    let label = tools[0][1];
    let top = -1;
    for (const [key, name] of tools) {
        const n = stats.byTool[key].none + stats.byTool[key].late;
        if (n > top) {
            top = n;
            label = name;
        }
    }
    if (top <= 0) return kind;
    if (top === stats.total) {
        const one = { Assignments: 'an assignment', Quizzes: 'a quiz', Discussions: 'a discussion' };
        if (stats.total === 1) return `${kind}. It is ${one[label] || label.toLowerCase()}`;
        return `${kind}. All ${stats.total} flags are ${label.toLowerCase()}`;
    }
    return `${kind}. ${label} account for ${top} of ${stats.total}`;
}

function tally(items) {
    const stats = {
        none: 0,
        late: 0,
        total: 0,
        oldest: null,
        slowest: null,
        byTool: {
            assignment: { none: 0, late: 0 },
            quiz: { none: 0, late: 0 },
            discussion: { none: 0, late: 0 }
        }
    };
    for (const item of items) {
        if (item.flagType === 'none') {
            stats.none += 1;
            stats.oldest = stats.oldest === null ? item.days : Math.max(stats.oldest, item.days);
        } else {
            stats.late += 1;
            stats.slowest = stats.slowest === null ? item.days : Math.max(stats.slowest, item.days);
        }
        if (stats.byTool[item.tool]) stats.byTool[item.tool][item.flagType] += 1;
    }
    stats.total = stats.none + stats.late;
    return stats;
}

function emptyToolTotals() {
    return {
        assignment: { none: 0, late: 0 },
        quiz: { none: 0, late: 0 },
        discussion: { none: 0, late: 0 }
    };
}

function extractListPageItems(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.Objects)) return resp.Objects;
    if (Array.isArray(resp.Items)) return resp.Items;
    return [];
}

function extractPagedItems(data) {
    return extractListPageItems(data);
}

function extractNextLink(data) {
    if (!data) return null;
    if (data.Next) return data.Next;
    if (data.NextPageUrl) {
        const nextUrl = new URL(data.NextPageUrl, window.location.origin);
        return nextUrl.pathname + nextUrl.search;
    }
    return null;
}

function unpackClasslistRow(item) {
    const user = item?.User || {};
    return {
        userId: item.Identifier || item.UserId || user.Identifier || user.UserId,
        first: item.FirstName || user.FirstName,
        last: item.LastName || user.LastName,
        display: item.DisplayName || user.DisplayName,
        username: item.Username || user.Username,
        orgDefinedId: item.OrgDefinedId || user.OrgDefinedId || '',
        roleId: item.RoleId || item.Role?.Id,
        roleName: item.Role?.Name || item.ClasslistRoleDisplayName || item.RoleName || ''
    };
}

function classlistName(row) {
    if (row.display) return row.display;
    if (row.last && row.first) return `${row.last}, ${row.first}`;
    return row.last || row.first || row.username || '';
}

function isMissingTool(error) {
    return error?.status === 404 || /404/.test(String(error?.message || ''));
}

function currentFilters() {
    const semesterId = document.getElementById('semester-select')?.value || '';
    const courseCodeFilter = String(document.getElementById('course-code-filter')?.value || '').trim().toUpperCase();
    const deptPrefix = String(document.getElementById('dept-prefix-filter')?.value || '').trim().toUpperCase();
    return {
        semesterId,
        courseCodeFilter,
        deptPrefix,
        timelyDays: readInt('timely-days-input', 7, 1),
        includeAssignments: document.getElementById('include-assignments')?.checked ?? true,
        includeQuizzes: document.getElementById('include-quizzes')?.checked ?? true,
        includeDiscussions: document.getElementById('include-discussions')?.checked ?? true,
        concurrency: readInt('course-concurrency-input', 3, 1)
    };
}

function getFilteredCourses() {
    const { courseCodeFilter, deptPrefix } = currentFilters();
    const filtered = allCoursesForSemester.filter(course => {
        const code = String(course.Code || '').toUpperCase();
        const name = String(course.Name || '').toUpperCase();
        if (courseCodeFilter && !code.includes(courseCodeFilter) && !name.includes(courseCodeFilter)) return false;
        if (deptPrefix && getDeptPrefixFromCode(code) !== deptPrefix) return false;
        return true;
    });
    filtered.sort((a, b) => String(a.Code || '').localeCompare(String(b.Code || '')));
    return filtered;
}

function updateDeptPrefixOptions() {
    const prefixSelect = document.getElementById('dept-prefix-filter');
    if (!prefixSelect) return;
    const previous = prefixSelect.value;
    const prefixes = new Set();
    for (const course of allCoursesForSemester) {
        const prefix = getDeptPrefixFromCode(course.Code);
        if (prefix) prefixes.add(prefix);
    }
    const sorted = Array.from(prefixes).sort();
    prefixSelect.innerHTML = '<option value="">All</option>' + sorted.map(prefix => `<option value="${prefix}">${prefix}</option>`).join('');
    if (previous && sorted.includes(previous)) prefixSelect.value = previous;
}

function updateMatchCount() {
    const note = document.getElementById('match-count');
    const btn = document.getElementById('run-scan-btn');
    if (scanRunning) return;

    const semesterId = document.getElementById('semester-select')?.value || '';
    const loadedThisSemester = allCoursesForSemester.length && semesterId && semesterId === lastLoadedSemesterId;
    if (!loadedThisSemester) {
        if (note) {
            note.textContent = semesterId && lastLoadedSemesterId && semesterId !== lastLoadedSemesterId
                ? 'Load courses for this semester before scanning.'
                : 'Load a semester. The scan then covers every course that matches the filter. FA8 matches any code that contains FA8, including FA810 and FA820.';
        }
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Run Scan';
        }
        return;
    }

    const filters = currentFilters();
    const count = getFilteredCourses().length;
    if (note) {
        if (!count) note.textContent = 'No loaded courses match this filter.';
        else if (!filters.courseCodeFilter && !filters.deptPrefix) {
            note.textContent = `No code or department filter is set. The scan will cover all ${count} loaded courses.`;
        } else {
            note.textContent = `The scan will cover all ${count} matching course${count === 1 ? '' : 's'}, from the first code through the last.`;
        }
    }
    if (btn) {
        btn.disabled = count === 0;
        btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Run Scan${count ? ` (${count} course${count === 1 ? '' : 's'})` : ''}`;
    }
}

async function resolveLeVersionFor(orgUnitId) {
    for (const version of LE_CANDIDATES) {
        try {
            await D2LApi._fetch(`/d2l/api/le/${version}/${orgUnitId}/classlist/paged/?pageSize=1`);
            return version;
        } catch (error) {
            // try the next Learning Environment version
        }
    }
    throw new Error('No supported LE version found for endpoints.');
}

async function fetchSemesterDates(semesterId) {
    try {
        const data = await D2LApi._fetch(`/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${semesterId}`);
        const start = data?.StartDate || data?.StartDateTime || data?.StartDateUtc || null;
        const end = data?.EndDate || data?.EndDateTime || data?.EndDateUtc || null;
        return { start: parseUtcDate(start), end: parseUtcDate(end) };
    } catch (error) {
        return { start: null, end: null };
    }
}

async function loadSemestersIntoSelect() {
    const select = document.getElementById('semester-select');
    if (!select) return;
    try {
        select.innerHTML = '<option value="">Loading semesters...</option>';
        const orgInfo = await D2LApi.getOrganizationInfo();
        let semesters = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${orgInfo.Identifier}/descendants/?ouTypeId=5`
        );
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            semesters = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(semesters));
        } else {
            semesters.sort((a, b) => String(b.Name || '').localeCompare(String(a.Name || '')));
        }
        select.innerHTML = '<option value="">Select Semester...</option>';
        semesters.forEach(semester => {
            const opt = document.createElement('option');
            opt.value = semester.Identifier;
            opt.textContent = semester.Name;
            select.appendChild(opt);
        });
    } catch (error) {
        console.error('Error loading semesters:', error);
        select.innerHTML = '<option value="">Error loading semesters</option>';
    }
}

async function loadCoursesForSemester(semesterId) {
    const coursesResp = await D2LApi.fetchPaginatedData(
        `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${semesterId}/children/`
    );
    const offerings = Array.isArray(coursesResp) ? coursesResp.filter(course => course.Type?.Code === 'Course Offering') : [];
    return offerings.filter(course => !shouldExcludeCourse(course));
}

async function getCoursePeople(orgUnitId) {
    const instructorIds = new Set();
    const instructorNames = [];
    const byId = new Map();
    let url = `/d2l/api/le/${leVersion}/${orgUnitId}/classlist/paged/?pageSize=100`;
    while (url) {
        const data = await D2LApi._fetch(url);
        const items = extractPagedItems(data);
        for (const item of items) {
            const row = unpackClasslistRow(item);
            if (!row.userId) continue;
            const id = String(row.userId);
            const name = classlistName(row);
            byId.set(id, { name, orgDefinedId: row.orgDefinedId || '' });
            const isInstructor = normId(row.roleId) === normId(INSTRUCTOR_ROLE_ID) || /instructor/i.test(String(row.roleName || ''));
            if (!isInstructor) continue;
            instructorIds.add(id);
            if (name && !instructorNames.includes(name)) instructorNames.push(name);
        }
        url = items.length ? extractNextLink(data) : null;
    }
    return { instructorIds, instructorNames, byId };
}

function personFromId(id, fallbackName, byId) {
    const record = id != null ? byId.get(String(id)) : null;
    return {
        who: record?.name || fallbackName || 'Student',
        orgDefinedId: record?.orgDefinedId || ''
    };
}

function pushFlag(items, base, submittedAt, feedbackAt, hasFeedback, ctx) {
    const result = classifyFeedback(submittedAt, feedbackAt, hasFeedback, ctx.now, ctx.timelyDays);
    if (!result) return;
    items.push({
        ...base,
        activityKey: activityKey(base.tool, base.activityId, base.activityName),
        flagType: result.flagType,
        submittedAt,
        feedbackAt: result.flagType === 'late' ? feedbackAt : null,
        days: result.days
    });
}

async function scanDropboxes(orgUnitId, ctx) {
    const items = [];
    const errors = [];
    let folders;
    try {
        folders = extractListPageItems(await D2LApi._fetch(
            `/d2l/api/le/${leVersion}/${orgUnitId}/dropbox/folders/?onlyCurrentStudentsAndGroups=true`
        ));
    } catch (error) {
        if (!isMissingTool(error)) errors.push('Assignments could not be scanned.');
        console.warn('Dropbox folders failed', orgUnitId, error);
        return { items, notes: [], errors };
    }

    for (const folder of folders) {
        const folderId = folder?.Id || folder?.FolderId;
        if (!folderId) continue;
        const activityName = folder?.Name || `Assignment ${folderId}`;
        let entities = [];
        try {
            entities = await D2LApi.fetchPaginatedData(
                `/d2l/api/le/${leVersion}/${orgUnitId}/dropbox/folders/${folderId}/submissions/paged/?activeOnly=true`,
                200
            );
        } catch (error) {
            console.warn('Dropbox submissions failed', orgUnitId, folderId, error);
            errors.push(`Assignment “${activityName}” could not be scanned.`);
            continue;
        }
        if (!Array.isArray(entities)) continue;

        for (const entity of entities) {
            const latest = pickLatestSubmission(entity, ctx);
            if (!latest) continue;
            const owner = entity?.Entity || entity?.entity || {};
            const isGroup = String(owner.EntityType || '').toLowerCase() === 'group';
            const ownerId = owner.EntityId ?? owner.Identifier ?? latest.sub?.SubmittedBy?.Identifier ?? latest.sub?.SubmittedBy?.Id;
            if (!isGroup && ownerId != null && ctx.instructorIds.has(String(ownerId))) continue;
            const person = personFromId(
                ownerId,
                owner.DisplayName || latest.sub?.SubmittedBy?.DisplayName || '',
                ctx.byId
            );
            const graded = entity?.Feedback?.IsGraded === true;
            const completion = parseUtcDate(entity?.CompletionDate);
            pushFlag(items, {
                tool: 'assignment',
                activityId: folderId,
                activityName,
                who: person.who,
                orgDefinedId: person.orgDefinedId,
                attemptLabel: ''
            }, latest.date, graded ? completion : null, graded && !!completion, ctx);
        }
    }
    return { items, notes: [], errors };
}

async function scanQuizzes(orgUnitId, ctx) {
    const items = [];
    const errors = [];
    let quizzes;
    try {
        quizzes = extractListPageItems(await D2LApi._fetch(`/d2l/api/le/${leVersion}/${orgUnitId}/quizzes/`));
    } catch (error) {
        if (!isMissingTool(error)) errors.push('Quizzes could not be scanned.');
        console.warn('Quizzes failed', orgUnitId, error);
        return { items, notes: [], errors };
    }

    for (const quiz of quizzes) {
        const quizId = quiz?.QuizId || quiz?.Id;
        if (!quizId) continue;
        const activityName = quiz?.Name || quiz?.Title || `Quiz ${quizId}`;
        let attempts = [];
        try {
            const response = await D2LApi._fetch(`/d2l/api/le/${leVersion}/${orgUnitId}/quizzes/${quizId}/attempts/`);
            if (response && !Array.isArray(response) && (response.Next || response.NextPageUrl)) {
                attempts = await D2LApi.fetchPaginatedData(
                    `/d2l/api/le/${leVersion}/${orgUnitId}/quizzes/${quizId}/attempts/`,
                    200
                );
            } else {
                attempts = extractListPageItems(response);
            }
        } catch (error) {
            console.warn('Quiz attempts failed', orgUnitId, quizId, error);
            errors.push(`Quiz “${activityName}” could not be scanned.`);
            continue;
        }

        for (const attempt of attempts) {
            const completed = parseUtcDate(attempt?.Completed);
            if (!completed || !inWindow(completed, ctx)) continue;
            const userId = attempt?.UserId ?? attempt?.User?.Identifier ?? attempt?.User?.UserId;
            if (userId != null && ctx.instructorIds.has(String(userId))) continue;
            const person = personFromId(userId, attempt?.DisplayName || attempt?.User?.DisplayName || '', ctx.byId);
            const published = attempt?.IsPublished === true;
            const feedbackAt = parseUtcDate(attempt?.FeedbackLastModified);
            const attemptNumber = Number(attempt?.AttemptNumber);
            pushFlag(items, {
                tool: 'quiz',
                activityId: quizId,
                activityName,
                who: person.who,
                orgDefinedId: person.orgDefinedId,
                attemptLabel: Number.isFinite(attemptNumber) && attemptNumber > 0 ? `Attempt ${attemptNumber}` : ''
            }, completed, published ? feedbackAt : null, published && !!feedbackAt, ctx);
        }
    }
    return { items, notes: [], errors };
}

async function fetchTopicPosts(orgUnitId, forumId, topicId) {
    const posts = [];
    const seen = new Set();
    let truncated = false;
    const pageSize = 200;
    const maxPages = 10;
    for (let page = 1; page <= maxPages; page++) {
        const data = await D2LApi._fetch(
            `/d2l/api/le/${leVersion}/${orgUnitId}/discussions/forums/${forumId}/topics/${topicId}/posts/?pageSize=${pageSize}&pageNumber=${page}&threadsOnly=false&sort=creationdate`
        );
        const batch = extractListPageItems(data);
        if (!batch.length) break;
        let added = 0;
        for (const post of batch) {
            const id = post?.PostId ?? post?.PostID;
            const key = id != null ? String(id) : '';
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            posts.push(post);
            added += 1;
        }
        if (!added || batch.length < pageSize) break;
        if (page === maxPages) truncated = true;
    }
    return { posts, truncated };
}

async function scanDiscussions(orgUnitId, ctx) {
    const items = [];
    const notes = [];
    const errors = [];
    if (!ctx.instructorIds.size) {
        notes.push('Discussions were not scored because no instructor is on the classlist.');
        return { items, notes, errors };
    }

    let forums;
    try {
        forums = extractListPageItems(await D2LApi._fetch(`/d2l/api/le/${leVersion}/${orgUnitId}/discussions/forums/`));
    } catch (error) {
        if (!isMissingTool(error)) errors.push('Discussions could not be scanned.');
        console.warn('Discussion forums failed', orgUnitId, error);
        return { items, notes, errors };
    }

    let truncated = false;
    for (const forum of forums) {
        const forumId = forum?.ForumId;
        if (!forumId) continue;
        let topics = [];
        try {
            topics = extractListPageItems(await D2LApi._fetch(
                `/d2l/api/le/${leVersion}/${orgUnitId}/discussions/forums/${forumId}/topics/`
            ));
        } catch (error) {
            console.warn('Discussion topics failed', orgUnitId, forumId, error);
            errors.push(`Discussion forum “${forum?.Name || forumId}” could not be scanned.`);
            continue;
        }

        for (const topic of topics) {
            const topicId = topic?.TopicId;
            if (!topicId) continue;
            const activityName = `${forum?.Name || 'Forum'} / ${topic?.Name || 'Topic'}`;
            let posts = [];
            try {
                const fetched = await fetchTopicPosts(orgUnitId, forumId, topicId);
                posts = fetched.posts;
                if (fetched.truncated) truncated = true;
            } catch (error) {
                console.warn('Discussion posts failed', orgUnitId, forumId, topicId, error);
                errors.push(`Discussion “${activityName}” could not be scanned.`);
                continue;
            }
            posts.sort((a, b) => (parseUtcDate(a?.DatePosted)?.getTime() ?? 0) - (parseUtcDate(b?.DatePosted)?.getTime() ?? 0));

            const studentPosts = posts.filter(post => {
                if (!post?.DatePosted || post.PostingUserId == null) return false;
                if (ctx.instructorIds.has(String(post.PostingUserId))) return false;
                if (post.ParentPostId !== null && post.ParentPostId !== undefined) return false;
                return inWindow(parseUtcDate(post.DatePosted), ctx);
            });

            for (const studentPost of studentPosts) {
                const studentDate = parseUtcDate(studentPost.DatePosted);
                const studentPostId = studentPost.PostId ?? studentPost.PostID;
                let reply = null;
                for (const post of posts) {
                    if (!ctx.instructorIds.has(String(post?.PostingUserId || ''))) continue;
                    const postDate = parseUtcDate(post?.DatePosted);
                    if (!postDate || !studentDate || postDate <= studentDate) continue;
                    if (studentPostId != null && String(post?.ParentPostId) === String(studentPostId)) {
                        reply = post;
                        break;
                    }
                }
                if (!reply) {
                    for (const post of posts) {
                        if (!ctx.instructorIds.has(String(post?.PostingUserId || ''))) continue;
                        const postDate = parseUtcDate(post?.DatePosted);
                        if (!postDate || !studentDate || postDate <= studentDate) continue;
                        reply = post;
                        break;
                    }
                }
                const replyDate = reply ? parseUtcDate(reply.DatePosted) : null;
                const person = personFromId(studentPost.PostingUserId, '', ctx.byId);
                pushFlag(items, {
                    tool: 'discussion',
                    activityId: topicId,
                    activityName,
                    who: person.who,
                    orgDefinedId: person.orgDefinedId,
                    attemptLabel: ''
                }, studentDate, replyDate, !!replyDate, ctx);
            }
        }
    }
    if (truncated) notes.push('Some discussion topics were very long, so posts after the first 2,000 in a topic were not scored.');
    return { items, notes, errors };
}

async function scanOneCourse(course, ctx) {
    const orgUnitId = course.Identifier;
    const code = course.Code || '';
    const name = course.Name || '';
    const notes = [];
    const errors = [];
    let people = { instructorIds: new Set(), instructorNames: [], byId: new Map() };

    try {
        people = await getCoursePeople(orgUnitId);
    } catch (error) {
        console.warn('Classlist failed', orgUnitId, error);
        errors.push('The classlist could not be read.');
    }

    const localCtx = { ...ctx, ...people };
    let items = [];

    if (ctx.includeAssignments) {
        const part = await scanDropboxes(orgUnitId, localCtx);
        items = items.concat(part.items);
        notes.push(...part.notes);
        errors.push(...part.errors);
    }
    if (ctx.includeQuizzes) {
        const part = await scanQuizzes(orgUnitId, localCtx);
        items = items.concat(part.items);
        notes.push(...part.notes);
        errors.push(...part.errors);
    }
    if (ctx.includeDiscussions) {
        const classlistFailed = errors.some(message => message.includes('classlist'));
        if (classlistFailed) {
            notes.push('Discussions were not scored because the classlist could not be read.');
        } else {
            const part = await scanDiscussions(orgUnitId, localCtx);
            items = items.concat(part.items);
            notes.push(...part.notes);
            errors.push(...part.errors);
        }
    }

    return {
        orgUnitId,
        code,
        name,
        instructors: people.instructorNames,
        items,
        notes,
        errors
    };
}

function resetResultsView() {
    scanResults = [];
    scanMeta = freshMeta();
    expandedCourses = new Set();
    expandedActivities = new Set();
    const search = document.getElementById('results-search');
    const flagFilter = document.getElementById('flag-filter');
    const toolFilter = document.getElementById('tool-filter');
    if (search) search.value = '';
    if (flagFilter) flagFilter.value = 'all';
    if (toolFilter) toolFilter.value = 'all';
    const container = document.getElementById('results-container');
    const empty = document.getElementById('empty-message');
    const count = document.getElementById('results-count');
    if (container) container.style.display = 'none';
    if (empty) {
        empty.style.display = 'block';
        empty.innerHTML = '1) Select a semester and click <b>Load Semester Courses</b>.<br>2) Filter (for example <b>FA8</b>), then click <b>Run Scan</b>.<br>The scan includes every matching course.';
    }
    if (count) count.textContent = 'Not run yet.';
}

async function handleLoadSemesterCourses() {
    const { semesterId } = currentFilters();
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }
    const btn = document.getElementById('load-semester-btn');
    if (btn) btn.disabled = true;
    try {
        resetResultsView();
        LoadingUtils.showLoadingModal('Loading semester courses...', 'loadingModal');
        LoadingUtils.updateLoadingModal(10, 'Fetching course offerings...', 'loadingModal');
        allCoursesForSemester = await loadCoursesForSemester(semesterId);
        currentSemesterDates = await fetchSemesterDates(semesterId);
        if (allCoursesForSemester.length) {
            leVersion = await resolveLeVersionFor(allCoursesForSemester[0].Identifier);
        } else {
            leVersion = null;
        }
        lastLoadedSemesterId = semesterId;
        updateDeptPrefixOptions();
        console.log('Loaded semester courses:', {
            semesterId,
            courseCount: allCoursesForSemester.length,
            startDate: currentSemesterDates.start ? currentSemesterDates.start.toISOString() : null,
            endDate: currentSemesterDates.end ? currentSemesterDates.end.toISOString() : null
        });
        LoadingUtils.updateLoadingModal(100, 'Ready.', 'loadingModal');
        setTimeout(() => LoadingUtils.hideLoadingModal('loadingModal'), 400);
    } catch (error) {
        console.error('Failed loading semester courses', error);
        LoadingUtils.hideLoadingModal('loadingModal');
        alert('Error loading semester courses: ' + error.message);
        lastLoadedSemesterId = null;
        allCoursesForSemester = [];
    } finally {
        if (btn) btn.disabled = false;
        updateMatchCount();
    }
}

async function handleRunScan() {
    const filters = currentFilters();
    if (!filters.semesterId) {
        alert('Please select a semester.');
        return;
    }
    if (!allCoursesForSemester.length || lastLoadedSemesterId !== filters.semesterId) {
        alert('Load courses for the selected semester first.');
        return;
    }
    if (!filters.includeAssignments && !filters.includeQuizzes && !filters.includeDiscussions) {
        alert('Choose at least one of assignments, quizzes, or discussions.');
        return;
    }
    const coursesToScan = getFilteredCourses();
    if (!coursesToScan.length) {
        alert('No courses match the current filters.');
        return;
    }

    scanRunning = true;
    scanResults = [];
    scanMeta = {
        ran: true,
        matched: coursesToScan.length,
        scanned: 0,
        stoppedEarly: false,
        timelyDays: filters.timelyDays,
        issues: []
    };
    expandedCourses = new Set();
    expandedActivities = new Set();

    const loadingModalId = 'loadingModal';
    LoadingUtils.showLoadingModal(`Starting scan of ${coursesToScan.length} courses...`, loadingModalId);
    const runBtn = document.getElementById('run-scan-btn');
    const loadBtn = document.getElementById('load-semester-btn');
    if (runBtn) runBtn.disabled = true;
    if (loadBtn) loadBtn.disabled = true;

    const ctx = {
        ...filters,
        startDate: currentSemesterDates.start,
        endDate: currentSemesterDates.end,
        now: new Date()
    };
    const concurrency = Math.max(1, filters.concurrency);

    try {
        if (!leVersion) leVersion = await resolveLeVersionFor(coursesToScan[0].Identifier);
        let scanned = 0;
        for (let i = 0; i < coursesToScan.length; i += concurrency) {
            if (LoadingUtils.isCancelled(loadingModalId)) {
                scanMeta.stoppedEarly = true;
                break;
            }
            const batch = coursesToScan.slice(i, i + concurrency);
            const end = Math.min(i + concurrency, coursesToScan.length);
            LoadingUtils.updateLoadingModal(
                Math.round((scanned / coursesToScan.length) * 100),
                `Course ${i + 1}–${end} of ${coursesToScan.length}: ${batch[0].Code || batch[0].Name || ''}`,
                loadingModalId
            );
            const batchResults = await Promise.allSettled(batch.map(course => scanOneCourse(course, ctx)));
            batchResults.forEach((result, index) => {
                scanned += 1;
                const course = batch[index];
                if (result.status === 'rejected') {
                    scanMeta.issues.push({
                        code: course.Code || '',
                        name: course.Name || '',
                        message: result.reason?.message || 'Could not scan this course.'
                    });
                    return;
                }
                const value = result.value;
                if (value?.items?.length) {
                    scanResults.push(value);
                } else if (value?.errors?.length) {
                    scanMeta.issues.push({
                        code: value.code,
                        name: value.name,
                        message: value.errors.join(' ')
                    });
                }
            });
            scanMeta.scanned = scanned;
            const countEl = document.getElementById('results-count');
            if (countEl) {
                countEl.textContent = `${scanResults.length} course${scanResults.length === 1 ? '' : 's'} with flags so far. ${scanned} of ${coursesToScan.length} scanned.`;
            }
        }

        if (!LoadingUtils.isCancelled(loadingModalId)) {
            LoadingUtils.updateLoadingModal(100, 'Scan complete.', loadingModalId);
            LoadingUtils.hideLoadingModal(loadingModalId);
        }
        showScanResults(scanResults, scanMeta);
    } catch (error) {
        console.error('Run scan failed', error);
        LoadingUtils.hideLoadingModal(loadingModalId);
        alert('Error running scan: ' + error.message);
        showScanResults(scanResults, scanMeta);
    } finally {
        scanRunning = false;
        if (loadBtn) loadBtn.disabled = false;
        updateMatchCount();
    }
}

function viewFilters() {
    return {
        query: String(document.getElementById('results-search')?.value || '').trim().toUpperCase(),
        flagType: document.getElementById('flag-filter')?.value || 'all',
        tool: document.getElementById('tool-filter')?.value || 'all'
    };
}

function courseHitsQuery(course, query) {
    if (!query) return true;
    const blob = [course.code, course.name, ...(course.instructors || [])].join(' ').toUpperCase();
    return blob.includes(query);
}

function itemVisible(item, filters, course) {
    if (filters.flagType !== 'all' && item.flagType !== filters.flagType) return false;
    if (filters.tool !== 'all' && item.tool !== filters.tool) return false;
    if (!filters.query) return true;
    if (courseHitsQuery(course, filters.query)) return true;
    return `${item.activityName} ${item.who} ${item.orgDefinedId}`.toUpperCase().includes(filters.query);
}

function visibleCourseRows() {
    const filters = viewFilters();
    return scanResults
        .map(course => {
            const visibleItems = course.items.filter(item => itemVisible(item, filters, course));
            return { course, visibleItems, stats: tally(visibleItems) };
        })
        .filter(row => row.visibleItems.length);
}

function compareValues(a, b, kind) {
    if (kind === 'number') {
        const aNull = a === null || a === undefined || Number.isNaN(a);
        const bNull = b === null || b === undefined || Number.isNaN(b);
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        return sortDir === 'asc' ? a - b : b - a;
    }
    const compared = String(a || '').localeCompare(String(b || ''));
    return sortDir === 'asc' ? compared : -compared;
}

function courseSortValue(row, key) {
    if (key === 'code') return { value: row.course.code, kind: 'text' };
    if (key === 'name') return { value: row.course.name, kind: 'text' };
    if (key === 'none') return { value: row.stats.none, kind: 'number' };
    if (key === 'late') return { value: row.stats.late, kind: 'number' };
    if (key === 'oldest') return { value: row.stats.oldest, kind: 'number' };
    if (key === 'slowest') return { value: row.stats.slowest, kind: 'number' };
    return { value: row.stats.total, kind: 'number' };
}

function sortCourseRows(rows) {
    const copy = rows.slice();
    copy.sort((a, b) => {
        const left = courseSortValue(a, sortKey);
        const right = courseSortValue(b, sortKey);
        return compareValues(left.value, right.value, left.kind);
    });
    return copy;
}

function groupActivities(items) {
    const map = new Map();
    for (const item of items) {
        let group = map.get(item.activityKey);
        if (!group) {
            group = {
                key: item.activityKey,
                tool: item.tool,
                name: item.activityName,
                items: []
            };
            map.set(item.activityKey, group);
        }
        group.items.push(item);
    }
    return Array.from(map.values()).map(group => ({ ...group, stats: tally(group.items) }));
}

function pin(entry) {
    const index = renderPins.length;
    renderPins.push(entry);
    return index;
}

function metric(className, label, value, tone) {
    const toneClass = tone ? ` ff-metric--${tone}` : '';
    return `<div class="ff-metric ${className}${toneClass}"><span class="ff-metric-label">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function renderItemTable(items) {
    const ordered = items.slice().sort((a, b) => b.days - a.days);
    const capped = ordered.length > ITEM_RENDER_CAP;
    const shown = capped ? ordered.slice(0, ITEM_RENDER_CAP) : ordered;
    const rows = shown.map(item => {
        const tone = item.flagType === 'late' ? 'late' : 'none';
        const dayTitle = tone === 'none' ? 'Days waiting with no feedback' : 'Days from submission to feedback';
        const extra = [item.orgDefinedId, item.attemptLabel].filter(Boolean).join(' · ');
        return `<tr class="ff-item ff-item--${tone}">
            <td data-label="Person">${escapeHtml(item.who)}${extra ? `<span class="ff-person-sub">${escapeHtml(extra)}</span>` : ''}</td>
            <td data-label="Submitted">${escapeHtml(fmtDateTime(item.submittedAt))}</td>
            <td data-label="Feedback">${item.feedbackAt ? escapeHtml(fmtDateTime(item.feedbackAt)) : '<span class="ff-muted">None</span>'}</td>
            <td data-label="Days" class="ff-num ff-num--${tone}" title="${dayTitle}">${fmtDays(item.days)}</td>
            <td data-label="Flag"><span class="ff-badge ff-badge--${tone}">${flagLabel(item.flagType)}</span></td>
        </tr>`;
    }).join('');
    const note = capped
        ? `<p class="ff-cap-note">Showing the ${ITEM_RENDER_CAP} longest waits of ${ordered.length}. Download CSV for every row.</p>`
        : '';
    return `<div class="ff-items-wrap"><table class="ff-items"><thead><tr>
        <th>Person</th><th>Submitted</th><th>Feedback</th><th>Days</th><th>Flag</th>
    </tr></thead><tbody>${rows}</tbody></table>${note}</div>`;
}

function renderActivityBlock(orgUnitId, group) {
    const openKey = String(orgUnitId) + '\0' + group.key;
    const open = expandedActivities.has(openKey);
    const index = pin({ action: 'activity', orgUnitId, activityKey: group.key });
    return `<div class="ff-activity${open ? ' is-open' : ''}" id="${activityDomId(orgUnitId, group.key)}">
        <div class="ff-activity-row" data-pin="${index}">
            <span class="ff-chevron" tabindex="0" role="button" aria-expanded="${open ? 'true' : 'false'}" aria-label="Show or hide submissions"><i class="fa-solid fa-chevron-right"></i></span>
            <span class="ff-tool-cell"><span class="ff-tool ff-tool--${group.tool}">${TOOL_LABEL[group.tool] || group.tool}</span></span>
            <span class="ff-activity-name">${escapeHtml(group.name)}</span>
            <div class="ff-activity-counts">
                ${metric('', 'No feedback', String(group.stats.none), 'none')}
                ${metric('', 'Late feedback', String(group.stats.late), 'late')}
            </div>
        </div>
        ${open ? `<div class="ff-activity-body">${renderItemTable(group.items)}</div>` : ''}
    </div>`;
}

function renderHead(columns) {
    const buttons = columns.map(column => {
        const sorted = sortKey === column.key;
        const arrow = sorted ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
        return `<button type="button" data-sort="${column.key}" class="${sorted ? 'is-sorted' : ''}">${escapeHtml(column.label)}${arrow}</button>`;
    }).join('');
    return `<div class="ff-head"><span></span>${buttons}</div>`;
}

function renderCourseList(rows) {
    const head = renderHead([
        { key: 'code', label: 'Course' },
        { key: 'name', label: 'Name' },
        { key: 'none', label: 'No feedback' },
        { key: 'late', label: 'Late feedback' },
        { key: 'oldest', label: 'Oldest unanswered' },
        { key: 'slowest', label: 'Slowest feedback' }
    ]);
    const cards = rows.map(row => {
        const course = row.course;
        const id = String(course.orgUnitId);
        const open = expandedCourses.has(id);
        const index = pin({ action: 'course', orgUnitId: course.orgUnitId });
        const messages = [...(course.notes || []), ...(course.errors || [])];
        const groups = open ? groupActivities(row.visibleItems).sort((a, b) => b.stats.total - a.stats.total) : [];
        return `<article class="ff-course${open ? ' is-open' : ''}" id="ff-course-${escapeHtml(id)}">
            <div class="ff-course-row" data-pin="${index}">
                <span class="ff-chevron" tabindex="0" role="button" aria-expanded="${open ? 'true' : 'false'}" aria-label="Show or hide course details"><i class="fa-solid fa-chevron-right"></i></span>
                <div class="ff-code"><a href="${COURSE_HOME}${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(course.code)}</a></div>
                <div class="ff-name">
                    <div class="ff-title">${escapeHtml(course.name)}</div>
                    <div class="ff-meta">${escapeHtml(formatInstructors(course.instructors))}</div>
                    <div class="ff-pattern">${escapeHtml(patternPhrase(row.stats))}</div>
                </div>
                ${metric('ff-m-none', 'No feedback', String(row.stats.none), 'none')}
                ${metric('ff-m-late', 'Late feedback', String(row.stats.late), 'late')}
                ${metric('ff-m-oldest', 'Oldest unanswered', fmtDays(row.stats.oldest), '')}
                ${metric('ff-m-slowest', 'Slowest feedback', fmtDays(row.stats.slowest), '')}
            </div>
            ${open ? `<div class="ff-course-body">
                ${messages.map(message => `<p class="ff-note">${escapeHtml(message)}</p>`).join('')}
                ${groups.map(group => renderActivityBlock(course.orgUnitId, group)).join('')}
            </div>` : ''}
        </article>`;
    }).join('');
    return head + cards;
}

function renderActivityList(rows) {
    const flat = [];
    for (const row of rows) {
        for (const group of groupActivities(row.visibleItems)) {
            flat.push({ course: row.course, group });
        }
    }
    flat.sort((a, b) => {
        const key = sortKey === 'name' ? 'activity' : sortKey;
        const left = activitySortValue(a, key);
        const right = activitySortValue(b, key);
        return compareValues(left.value, right.value, left.kind);
    });
    const head = renderHead([
        { key: 'activity', label: 'Activity' },
        { key: 'code', label: 'Course' },
        { key: 'none', label: 'No feedback' },
        { key: 'late', label: 'Late feedback' },
        { key: 'oldest', label: 'Oldest unanswered' },
        { key: 'slowest', label: 'Slowest feedback' }
    ]);
    const cards = flat.map(row => {
        const openKey = String(row.course.orgUnitId) + '\0' + row.group.key;
        const open = expandedActivities.has(openKey);
        const index = pin({ action: 'activity', orgUnitId: row.course.orgUnitId, activityKey: row.group.key });
        return `<article class="ff-course${open ? ' is-open' : ''}" id="${activityDomId(row.course.orgUnitId, row.group.key)}">
            <div class="ff-course-row" data-pin="${index}">
                <span class="ff-chevron" tabindex="0" role="button" aria-expanded="${open ? 'true' : 'false'}" aria-label="Show or hide submissions"><i class="fa-solid fa-chevron-right"></i></span>
                <div class="ff-name">
                    <span class="ff-tool ff-tool--${row.group.tool}">${TOOL_LABEL[row.group.tool] || row.group.tool}</span>
                    <div class="ff-title">${escapeHtml(row.group.name)}</div>
                </div>
                <div class="ff-code">
                    <a href="${COURSE_HOME}${encodeURIComponent(row.course.orgUnitId)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.course.code)}</a>
                    <div class="ff-meta">${escapeHtml(row.course.name)}</div>
                </div>
                ${metric('ff-m-none', 'No feedback', String(row.group.stats.none), 'none')}
                ${metric('ff-m-late', 'Late feedback', String(row.group.stats.late), 'late')}
                ${metric('ff-m-oldest', 'Oldest unanswered', fmtDays(row.group.stats.oldest), '')}
                ${metric('ff-m-slowest', 'Slowest feedback', fmtDays(row.group.stats.slowest), '')}
            </div>
            ${open ? `<div class="ff-course-body">${renderItemTable(row.group.items)}</div>` : ''}
        </article>`;
    }).join('');
    return head + (cards || '<p class="ff-empty">Nothing in this view matches the filters.</p>');
}

function activitySortValue(row, key) {
    if (key === 'activity') return { value: row.group.name, kind: 'text' };
    if (key === 'code' || key === 'name') return { value: row.course.code, kind: 'text' };
    if (key === 'none') return { value: row.group.stats.none, kind: 'number' };
    if (key === 'late') return { value: row.group.stats.late, kind: 'number' };
    if (key === 'oldest') return { value: row.group.stats.oldest, kind: 'number' };
    if (key === 'slowest') return { value: row.group.stats.slowest, kind: 'number' };
    return { value: row.group.stats.total, kind: 'number' };
}

function renderPatterns(rows) {
    const host = document.getElementById('results-patterns');
    if (!host) return;
    const map = new Map();
    for (const row of rows) {
        for (const item of row.visibleItems) {
            const key = String(row.course.orgUnitId) + '\0' + item.activityKey;
            let cluster = map.get(key);
            if (!cluster) {
                cluster = {
                    orgUnitId: row.course.orgUnitId,
                    activityKey: item.activityKey,
                    tool: item.tool,
                    name: item.activityName,
                    code: row.course.code,
                    courseName: row.course.name,
                    none: 0,
                    late: 0
                };
                map.set(key, cluster);
            }
            cluster[item.flagType] += 1;
        }
    }
    const clusters = Array.from(map.values());
    host.innerHTML = `<div class="ff-patterns">
        ${patternColumn('No feedback clusters', clusters.filter(row => row.none > 0).sort((a, b) => b.none - a.none), 'none')}
        ${patternColumn('Late feedback clusters', clusters.filter(row => row.late > 0).sort((a, b) => b.late - a.late), 'late')}
    </div>`;
}

function patternColumn(title, rows, flagType) {
    const top = rows.slice(0, CLUSTER_LIMIT);
    const body = top.length
        ? top.map(row => {
            const index = pin({ action: 'focus', orgUnitId: row.orgUnitId, activityKey: row.activityKey });
            const count = flagType === 'none' ? row.none : row.late;
            return `<button type="button" class="ff-hit" data-pin="${index}">
                <b class="ff-num--${flagType}">${count}</b>
                <span>${escapeHtml(row.name)}<small>${escapeHtml(TOOL_LABEL[row.tool] || '')} · ${escapeHtml(row.code)}</small></span>
            </button>`;
        }).join('')
        : '<p>None in this view.</p>';
    return `<section class="ff-pattern-col"><h4>${escapeHtml(title)}</h4>${body}</section>`;
}

function renderSummary(rows) {
    const host = document.getElementById('results-summary');
    if (!host) return;
    const days = scanMeta.timelyDays;
    const allItems = rows.reduce((sum, row) => sum + row.visibleItems.length, 0);
    const stats = tally(rows.flatMap(row => row.visibleItems));
    const tools = emptyToolTotals();
    for (const row of rows) {
        for (const key of Object.keys(tools)) {
            tools[key].none += row.stats.byTool[key].none;
            tools[key].late += row.stats.byTool[key].late;
        }
    }
    const scannedText = scanMeta.stoppedEarly
        ? `Scan stopped after ${scanMeta.scanned} of ${scanMeta.matched} matching courses.`
        : `Scanned all ${scanMeta.matched} matching course${scanMeta.matched === 1 ? '' : 's'}.`;
    const courseText = `${rows.length} course${rows.length === 1 ? '' : 's'} in this view have flags.`;
    const issues = scanMeta.issues.length
        ? `<details class="ff-issues"><summary>${scanMeta.issues.length} course${scanMeta.issues.length === 1 ? '' : 's'} could not be fully scanned</summary><ul>${scanMeta.issues.map(issue => `<li>${escapeHtml(issue.code)} ${escapeHtml(issue.name)} — ${escapeHtml(issue.message)}</li>`).join('')}</ul></details>`
        : '';
    const toolChips = [
        ['assignment', 'Assignments'],
        ['quiz', 'Quizzes'],
        ['discussion', 'Discussions']
    ].map(([key, label]) => {
        return `<span class="ff-tool-chip"><span class="ff-tool ff-tool--${key}">${label}</span> <b class="ff-num--none">${tools[key].none}</b> no feedback · <b class="ff-num--late">${tools[key].late}</b> late</span>`;
    }).join('');

    host.innerHTML = `
        <p class="ff-scan-line">${escapeHtml(scannedText)} ${escapeHtml(courseText)} Flag after ${days} day${days === 1 ? '' : 's'}. Each assignment counts a student once, on their latest submission. Each completed quiz attempt and each top-level discussion post is its own row. ${allItems} flag${allItems === 1 ? '' : 's'} in this view.</p>
        ${issues}
        <div class="ff-stats">
            <div class="ff-stat ff-stat--none">
                <span class="ff-stat-value">${stats.none}</span>
                <span class="ff-stat-label">No feedback</span>
                <span class="ff-stat-help">No grade, published feedback, or instructor reply, and the work is at least ${days} days old.</span>
            </div>
            <div class="ff-stat ff-stat--late">
                <span class="ff-stat-value">${stats.late}</span>
                <span class="ff-stat-label">Late feedback</span>
                <span class="ff-stat-help">A grade, published feedback, or instructor reply exists, and it took at least ${days} days. Discussion feedback is an instructor reply in that topic.</span>
            </div>
        </div>
        <div class="ff-tool-strip">${toolChips}</div>
    `;
}

function showScanResults(results, meta) {
    scanResults = results;
    scanMeta = meta;
    renderResults();
}

function renderResults() {
    const container = document.getElementById('results-container');
    const empty = document.getElementById('empty-message');
    const countEl = document.getElementById('results-count');
    const toolbar = document.getElementById('results-toolbar');
    const list = document.getElementById('results-list');
    if (!container || !list) return;

    if (!scanMeta.ran) {
        container.style.display = 'none';
        if (empty) empty.style.display = 'block';
        return;
    }

    container.style.display = 'block';
    if (empty) empty.style.display = 'none';
    renderPins = [];

    const rows = sortCourseRows(visibleCourseRows());
    const viewStats = tally(rows.flatMap(row => row.visibleItems));
    if (countEl) {
        const stopped = scanMeta.stoppedEarly ? ` Scan stopped after ${scanMeta.scanned} of ${scanMeta.matched}.` : '';
        countEl.textContent = `${rows.length} course${rows.length === 1 ? '' : 's'} with flags, from ${scanMeta.matched} scanned.${stopped}`;
    }

    document.getElementById('view-courses')?.classList.toggle('is-active', viewMode === 'courses');
    document.getElementById('view-activities')?.classList.toggle('is-active', viewMode === 'activities');
    const expandBtn = document.getElementById('expand-courses-btn');
    if (expandBtn) expandBtn.style.display = viewMode === 'courses' ? '' : 'none';

    if (!scanResults.length) {
        if (toolbar) toolbar.style.display = 'none';
        const patterns = document.getElementById('results-patterns');
        if (patterns) patterns.innerHTML = '';
        renderSummary(rows);
        list.innerHTML = '<p class="ff-empty">No work in the scanned courses is past the day threshold.</p>';
        return;
    }

    if (toolbar) toolbar.style.display = '';
    renderSummary(rows);
    renderPatterns(rows);
    list.innerHTML = rows.length
        ? (viewMode === 'activities' ? renderActivityList(rows) : renderCourseList(rows))
        : '<p class="ff-empty">Nothing in this view matches the filters.</p>';
}

function activatePin(index) {
    const entry = renderPins[Number(index)];
    if (!entry) return;
    if (entry.action === 'course') {
        const id = String(entry.orgUnitId);
        if (expandedCourses.has(id)) expandedCourses.delete(id);
        else expandedCourses.add(id);
        renderResults();
        return;
    }
    if (entry.action === 'activity') {
        const id = String(entry.orgUnitId) + '\0' + entry.activityKey;
        if (expandedActivities.has(id)) expandedActivities.delete(id);
        else expandedActivities.add(id);
        renderResults();
        return;
    }
    if (entry.action === 'focus') {
        viewMode = 'courses';
        expandedCourses.add(String(entry.orgUnitId));
        const activityId = String(entry.orgUnitId) + '\0' + entry.activityKey;
        expandedActivities.add(activityId);
        renderResults();
        const target = document.getElementById(activityDomId(entry.orgUnitId, entry.activityKey))
            || document.getElementById('ff-course-' + entry.orgUnitId);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function toggleSort(key) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else {
        sortKey = key;
        sortDir = key === 'code' || key === 'name' || key === 'activity' ? 'asc' : 'desc';
    }
    renderResults();
}

function csvCell(value) {
    const text = String(value ?? '');
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
}

function downloadCSV() {
    const rows = sortCourseRows(visibleCourseRows());
    const items = [];
    for (const row of rows) {
        const ordered = row.visibleItems.slice().sort((a, b) => b.days - a.days);
        for (const item of ordered) items.push({ course: row.course, item });
    }
    if (!items.length) {
        alert('No results to export.');
        return;
    }
    const headers = [
        'Course Code', 'Course Name', 'Instructors', 'Org Unit Id', 'Tool', 'Activity',
        'Flag', 'Person', 'Org Defined Id', 'Attempt', 'Submitted', 'Feedback', 'Days', 'Flag After Days'
    ];
    const lines = items.map(({ course, item }) => [
        course.code,
        course.name,
        (course.instructors || []).join('; '),
        course.orgUnitId,
        TOOL_LABEL[item.tool] || item.tool,
        item.activityName,
        flagLabel(item.flagType),
        item.who,
        item.orgDefinedId,
        item.attemptLabel,
        item.submittedAt ? item.submittedAt.toISOString() : '',
        item.feedbackAt ? item.feedbackAt.toISOString() : '',
        fmtDays(item.days),
        scanMeta.timelyDays
    ].map(csvCell).join(','));
    const csv = '\uFEFF' + [headers.map(csvCell).join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `faculty_feedback_timeliness_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
    loadSemestersIntoSelect();
    document.getElementById('load-semester-btn')?.addEventListener('click', handleLoadSemesterCourses);
    document.getElementById('run-scan-btn')?.addEventListener('click', handleRunScan);
    document.getElementById('download-csv-btn')?.addEventListener('click', downloadCSV);
    document.getElementById('semester-select')?.addEventListener('change', () => {
        const semesterId = document.getElementById('semester-select')?.value || '';
        if (lastLoadedSemesterId && semesterId !== lastLoadedSemesterId) {
            allCoursesForSemester = [];
            resetResultsView();
        }
        updateMatchCount();
    });
    ['course-code-filter', 'dept-prefix-filter'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateMatchCount);
        document.getElementById(id)?.addEventListener('change', updateMatchCount);
    });

    document.getElementById('results-search')?.addEventListener('input', renderResults);
    document.getElementById('flag-filter')?.addEventListener('change', renderResults);
    document.getElementById('tool-filter')?.addEventListener('change', renderResults);
    document.getElementById('view-courses')?.addEventListener('click', () => {
        viewMode = 'courses';
        renderResults();
    });
    document.getElementById('view-activities')?.addEventListener('click', () => {
        viewMode = 'activities';
        renderResults();
    });
    document.getElementById('expand-courses-btn')?.addEventListener('click', () => {
        visibleCourseRows().forEach(row => expandedCourses.add(String(row.course.orgUnitId)));
        renderResults();
    });
    document.getElementById('collapse-courses-btn')?.addEventListener('click', () => {
        expandedCourses.clear();
        expandedActivities.clear();
        renderResults();
    });
    document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
        const search = document.getElementById('results-search');
        const flagFilter = document.getElementById('flag-filter');
        const toolFilter = document.getElementById('tool-filter');
        if (search) search.value = '';
        if (flagFilter) flagFilter.value = 'all';
        if (toolFilter) toolFilter.value = 'all';
        renderResults();
    });

    const container = document.getElementById('results-container');
    container?.addEventListener('click', event => {
        const sortButton = event.target.closest('[data-sort]');
        if (sortButton) {
            toggleSort(sortButton.getAttribute('data-sort'));
            return;
        }
        if (event.target.closest('a')) return;
        const pinEl = event.target.closest('[data-pin]');
        if (!pinEl) return;
        activatePin(pinEl.getAttribute('data-pin'));
    });
    container?.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target.closest('a, input, select, button')) return;
        const pinEl = event.target.closest('[data-pin]');
        if (!pinEl) return;
        event.preventDefault();
        activatePin(pinEl.getAttribute('data-pin'));
    });
});
