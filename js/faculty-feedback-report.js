/**
 * Faculty Feedback Timeliness Report
 *
 * Scans:
 * - Dropbox submissions (Assignments): uses EntityDropbox.CompletionDate + Feedback.IsGraded
 * - Quiz attempts: uses FeedbackLastModified + IsPublished
 * - Discussion posts (discussion boards): uses instructor replies (first instructor post after student post)
 *
 * Note: discussion "instructor feedback" is inferred as instructor-authored replies.
 */

const INSTRUCTOR_ROLE_ID = 102;
const LE_CANDIDATES = ['1.86', '1.85', '1.82', '1.78', '1.71'];

let leVersion = null;
let allCoursesForSemester = [];
let currentSemesterDates = { start: null, end: null };

let resultsTable = null;
let scanResults = [];

let lastLoadedSemesterId = null;

function normId(id) {
    return String(id || '').trim();
}

function getDeptPrefixFromCode(code) {
    const raw = String(code || '').trim().toUpperCase();
    const m = raw.match(/^[A-Z]{2,4}/);
    return m ? m[0] : '';
}

function shouldExcludeCourse(course) {
    const code = String(course?.Code || '').trim().toUpperCase();
    const name = String(course?.Name || '').trim().toUpperCase();

    // CXLD: cancelled courses are prefixed with "CXLD -" (and sometimes include CXLD elsewhere)
    if (/^CXLD\s*-/.test(code) || code.includes('CXLD')) return true;

    // MERGED: merged shells often contain MERGED in name and/or code
    if (name.includes('MERGED') || code.includes('MERGED')) return true;

    return false;
}

function parseUtcDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function daysBetween(a, b) {
    if (!a || !b) return null;
    const ms = b.getTime() - a.getTime();
    return ms / (1000 * 60 * 60 * 24);
}

function fmtDateTime(d) {
    if (!d) return 'N/A';
    const dd = d instanceof Date ? d : parseUtcDate(d);
    if (!dd) return 'N/A';
    return dd.toLocaleDateString() + ' ' + dd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getD2LBaseUrl() {
    const origin = String(window.location?.origin || '').trim();
    if (origin && origin !== 'null') return origin;
    return 'https://your-brightspace.example.edu';
}

function extractListPageItems(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.Objects)) return resp.Objects;
    if (Array.isArray(resp.Items)) return resp.Items;
    // Some endpoints return a single property list; last resort
    return [];
}

async function resolveLeVersionFor(orgUnitId) {
    for (const v of LE_CANDIDATES) {
        try {
            await D2LApi._fetch(`/d2l/api/le/${v}/${orgUnitId}/classlist/paged/?pageSize=1`);
            return v;
        } catch (e) {
            // try next
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
    } catch (e) {
        return { start: null, end: null };
    }
}

async function loadSemestersIntoSelect() {
    const select = document.getElementById('semester-select');
    if (!select) return;

    try {
        select.innerHTML = '<option value="">Loading semesters...</option>';
        const orgInfo = await D2LApi.getOrganizationInfo();
        const rootOrgUnitId = orgInfo.Identifier;

        let semesters = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
        );

        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            semesters = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(semesters));
        } else {
            semesters.sort((a, b) => String(b.Name || '').localeCompare(String(a.Name || '')));
        }

        select.innerHTML = '<option value="">Select Semester...</option>';
        semesters.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.Identifier;
            opt.textContent = s.Name;
            select.appendChild(opt);
        });
    } catch (error) {
        console.error('Error loading semesters:', error);
        select.innerHTML = '<option value="">Error loading semesters</option>';
    }
}

function currentFilters() {
    const semesterId = document.getElementById('semester-select')?.value || '';
    const courseCodeFilter = String(document.getElementById('course-code-filter')?.value || '').trim().toUpperCase();
    const deptPrefix = String(document.getElementById('dept-prefix-filter')?.value || '').trim().toUpperCase();
    const timelyDays = parseInt(document.getElementById('timely-days-input')?.value, 10) || 7;

    const includeAssignments = document.getElementById('include-assignments')?.checked ?? true;
    const includeQuizzes = document.getElementById('include-quizzes')?.checked ?? true;
    const includeDiscussions = document.getElementById('include-discussions')?.checked ?? true;

    const maxCourses = parseInt(document.getElementById('max-courses-input')?.value, 10) || 25;
    const concurrency = parseInt(document.getElementById('course-concurrency-input')?.value, 10) || 3;

    return {
        semesterId,
        courseCodeFilter,
        deptPrefix,
        timelyDays,
        includeAssignments,
        includeQuizzes,
        includeDiscussions,
        maxCourses,
        concurrency,
    };
}

function updateDeptPrefixOptions() {
    const prefixSelect = document.getElementById('dept-prefix-filter');
    if (!prefixSelect) return;

    const prefixes = new Set();
    for (const c of allCoursesForSemester) {
        const p = getDeptPrefixFromCode(c.Code);
        if (p) prefixes.add(p);
    }

    const sorted = Array.from(prefixes).sort();
    prefixSelect.innerHTML = '<option value="">All</option>' + sorted.map(p => `<option value="${p}">${p}</option>`).join('');
}

function getFilteredCourses() {
    const { courseCodeFilter, deptPrefix, maxCourses } = currentFilters();

    const filtered = allCoursesForSemester.filter(c => {
        const code = String(c.Code || '').toUpperCase();
        const name = String(c.Name || '').toUpperCase();

        if (courseCodeFilter) {
            if (!code.includes(courseCodeFilter) && !name.includes(courseCodeFilter)) return false;
        }

        if (deptPrefix) {
            const p = getDeptPrefixFromCode(code);
            if (p !== deptPrefix) return false;
        }

        return true;
    });

    return filtered.slice(0, Math.max(1, maxCourses));
}

function destroyResultsTableIfNeeded() {
    if (resultsTable) {
        resultsTable.destroy();
        resultsTable = null;
    }
}

function renderResultsTable() {
    const container = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');
    const countEl = document.getElementById('results-count');

    const tbody = document.querySelector('#results-table tbody');
    if (!tbody) return;

    destroyResultsTableIfNeeded();
    tbody.innerHTML = '';

    if (!scanResults.length) {
        if (container) container.style.display = 'none';
        if (emptyMessage) {
            emptyMessage.style.display = 'block';
            emptyMessage.innerHTML = 'No feedback flags found for the current filters.';
        }
        if (countEl) countEl.textContent = '0 result(s).';
        return;
    }

    scanResults.forEach(r => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="display:none;">${r.orgUnitId}</td>
            <td>${escapeHtml(r.code)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${r.assignmentsLateMissing}</td>
            <td>${r.quizzesLateMissing}</td>
            <td>${r.discussionsLateMissing}</td>
            <td><b>${r.totalLateMissing}</b></td>
            <td>${r.worstLatenessDays === null ? 'N/A' : r.worstLatenessDays.toFixed(1)}</td>
        `;
        tbody.appendChild(row);
    });

    if (container) container.style.display = 'block';
    if (emptyMessage) emptyMessage.style.display = 'none';
    if (countEl) countEl.textContent = `${scanResults.length} course(s) processed.`;

    if (window.jQuery && $.fn.DataTable) {
        resultsTable = $('#results-table').DataTable({
            pageLength: 25,
            order: [[6, 'desc']],
            columnDefs: [
                { targets: [0], visible: false }
            ]
        });
    }
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function getInstructorUserIdSetForCourse(orgUnitId) {
    const ids = new Set();
    try {
        let url = `/d2l/api/le/${leVersion}/${orgUnitId}/classlist/paged/?pageSize=100`;
        while (url) {
            const data = await D2LApi._fetch(url);
            const items = extractPagedItems(data);
            if (!items.length) {
                url = extractNextLink(data);
                if (!url) break;
                continue;
            }

            for (const it of items) {
                const r = unpackClasslistRow(it);
                const isInstructor = (normId(r.roleId) === normId(INSTRUCTOR_ROLE_ID)) || (/instructor/i.test(String(r.roleName || '')));
                if (!isInstructor) continue;
                if (r.userId) ids.add(String(r.userId));
            }
            url = extractNextLink(data);
        }
    } catch (e) {
        console.warn('Failed to fetch instructor IDs for course', orgUnitId, e);
    }
    return ids;
}

function extractPagedItems(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.Items)) return data.Items;
    if (Array.isArray(data.Objects)) return data.Objects;
    return [];
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
        email: item.Email || item.EmailAddress || user.Email || user.EmailAddress || user.ExternalEmail,
        orgDefinedId: item.OrgDefinedId || user.OrgDefinedId,
        roleId: item.RoleId || item.Role?.Id || item.RoleId,
        roleName: item.Role?.Name,
    };
}

async function scanDropboxesForTimelyFeedback(orgUnitId, timelyDays, ctx) {
    let lateMissing = 0;
    let missing = 0;
    let late = 0;
    let worstDays = null;
    let scannedSubmissions = 0;

    const dropboxFolders = await D2LApi._fetch(`/d2l/api/le/${leVersion}/${orgUnitId}/dropbox/folders/?onlyCurrentStudentsAndGroups=true`);
    if (!Array.isArray(dropboxFolders) || dropboxFolders.length === 0) {
        return { lateMissing, missing, late, worstDays };
    }

    // Caps: avoid runaway calls for very large courses
    const MAX_FOLDERS = 25;
    const MAX_SUBMISSIONS = 500; // per course
    const folders = dropboxFolders.slice(0, MAX_FOLDERS);

    for (const folder of folders) {
        if (scannedSubmissions >= MAX_SUBMISSIONS) break;

        const folderId = folder?.Id;
        if (!folderId) continue;

        let entities = [];
        try {
            entities = await D2LApi.fetchPaginatedData(
                `/d2l/api/le/${leVersion}/${orgUnitId}/dropbox/folders/${folderId}/submissions/paged/?activeOnly=true`,
                100
            );
        } catch (e) {
            console.warn('Dropbox submissions paged failed', orgUnitId, folderId, e);
            continue;
        }

        if (!Array.isArray(entities) || entities.length === 0) continue;

        for (const ent of entities) {
            const isGraded = ent?.Feedback?.IsGraded === true;
            const completionDate = parseUtcDate(ent?.CompletionDate);

            const submissions = Array.isArray(ent?.Submissions) ? ent.Submissions : [];
            for (const sub of submissions) {
                if (scannedSubmissions >= MAX_SUBMISSIONS) break;
                if (!sub?.SubmissionDate) continue;

                const submissionDate = parseUtcDate(sub.SubmissionDate);
                if (!submissionDate) continue;

                if (ctx.startDate && submissionDate < ctx.startDate) continue;
                if (ctx.endDate && submissionDate > ctx.endDate) continue;

                scannedSubmissions++;
                lateMissing++;

                if (!isGraded || !completionDate) {
                    missing++;
                    continue;
                }

                const diff = daysBetween(submissionDate, completionDate);
                if (diff === null) continue;

                if (diff > timelyDays) {
                    late++;
                    worstDays = worstDays === null ? diff : Math.max(worstDays, diff);
                } else {
                    // Not late: remove from flagged total
                    lateMissing--;
                }
            }
        }
    }

    return { lateMissing, missing, late, worstDays };
}

async function scanQuizzesForTimelyFeedback(orgUnitId, timelyDays, ctx) {
    let lateMissing = 0;
    let missing = 0;
    let late = 0;
    let worstDays = null;
    let scannedAttempts = 0;

    const quizzesResp = await D2LApi._fetch(`/d2l/api/le/${leVersion}/${orgUnitId}/quizzes/`);
    const quizzes = extractListPageItems(quizzesResp);
    if (!Array.isArray(quizzes) || quizzes.length === 0) return { lateMissing, missing, late, worstDays };

    const MAX_QUIZZES = 50;
    const MAX_ATTEMPTS = 1200; // per course

    for (const q of quizzes.slice(0, MAX_QUIZZES)) {
        if (scannedAttempts >= MAX_ATTEMPTS) break;
        const quizId = q?.QuizId;
        if (!quizId) continue;

        let attemptsResp = null;
        try {
            attemptsResp = await D2LApi._fetch(`/d2l/api/le/${leVersion}/${orgUnitId}/quizzes/${quizId}/attempts/`);
        } catch (e) {
            console.warn('Quiz attempts failed', orgUnitId, quizId, e);
            continue;
        }

        const attempts = extractListPageItems(attemptsResp);
        if (!Array.isArray(attempts) || attempts.length === 0) continue;

        for (const a of attempts) {
            if (scannedAttempts >= MAX_ATTEMPTS) break;
            if (!a?.Completed) continue;

            const completed = parseUtcDate(a.Completed);
            if (!completed) continue;
            if (ctx.startDate && completed < ctx.startDate) continue;
            if (ctx.endDate && completed > ctx.endDate) continue;

            scannedAttempts++;
            lateMissing++;

            const feedbackLastModified = parseUtcDate(a?.FeedbackLastModified);
            const isPublished = a?.IsPublished === true;

            if (!isPublished || !feedbackLastModified) {
                missing++;
                continue;
            }

            const diff = daysBetween(completed, feedbackLastModified);
            if (diff === null) continue;

            if (diff > timelyDays) {
                late++;
                worstDays = worstDays === null ? diff : Math.max(worstDays, diff);
            } else {
                // Not late/missing
                lateMissing--;
            }
        }
    }

    return { lateMissing, missing, late, worstDays };
}

async function scanDiscussionsForTimelyFeedback(orgUnitId, timelyDays, ctx) {
    let lateMissing = 0;
    let missing = 0;
    let late = 0;
    let worstDays = null;

    const instructorIds = await getInstructorUserIdSetForCourse(orgUnitId);
    if (!instructorIds.size) {
        // Without instructor IDs, we can't infer feedback; treat as 0 flagged.
        return { lateMissing, missing, late, worstDays };
    }

    const forums = await D2LApi._fetch(`/d2l/api/le/${leVersion}/${orgUnitId}/discussions/forums/`);
    if (!Array.isArray(forums) || forums.length === 0) return { lateMissing, missing, late, worstDays };

    const MAX_FORUMS = 8;
    const MAX_TOPICS_PER_FORUM = 20;
    const MAX_STUDENT_POSTS_PER_COURSE = 250;

    let scannedStudentPosts = 0;

    for (const forum of forums.slice(0, MAX_FORUMS)) {
        if (scannedStudentPosts >= MAX_STUDENT_POSTS_PER_COURSE) break;
        const forumId = forum?.ForumId;
        if (!forumId) continue;

        let topics = [];
        try {
            topics = await D2LApi._fetch(`/d2l/api/le/${leVersion}/${orgUnitId}/discussions/forums/${forumId}/topics/`);
        } catch (e) {
            console.warn('Discussion topics failed', orgUnitId, forumId, e);
            continue;
        }

        if (!Array.isArray(topics) || topics.length === 0) continue;
        const topicSlice = topics.slice(0, MAX_TOPICS_PER_FORUM);

        for (const topic of topicSlice) {
            if (scannedStudentPosts >= MAX_STUDENT_POSTS_PER_COURSE) break;
            const topicId = topic?.TopicId;
            if (!topicId) continue;

            // Pull posts; discussions endpoint supports pagination.
            // For timeliness we only need enough to find instructor replies to student posts.
            let posts = [];
            try {
                posts = await D2LApi._fetch(
                    `/d2l/api/le/${leVersion}/${orgUnitId}/discussions/forums/${forumId}/topics/${topicId}/posts/?pageSize=1000&pageNumber=1&threadsOnly=false&sort=creationdate`
                );
            } catch (e) {
                console.warn('Discussion posts failed', orgUnitId, forumId, topicId, e);
                continue;
            }

            if (!Array.isArray(posts) || posts.length === 0) continue;

            // Sort ascending to compute first instructor reply after each student post
            posts.sort((p1, p2) => {
                const d1 = parseUtcDate(p1?.DatePosted)?.getTime() ?? 0;
                const d2 = parseUtcDate(p2?.DatePosted)?.getTime() ?? 0;
                return d1 - d2;
            });

            const studentSubmissions = posts.filter(p => {
                // treat top-level student posts as "submission"
                if (!p?.DatePosted) return false;
                const authorId = p?.PostingUserId;
                if (!authorId) return false;
                if (instructorIds.has(String(authorId))) return false;
                if (p?.ParentPostId !== null && p?.ParentPostId !== undefined) return false;

                const postDate = parseUtcDate(p.DatePosted);
                if (!postDate) return false;
                if (ctx.startDate && postDate < ctx.startDate) return false;
                if (ctx.endDate && postDate > ctx.endDate) return false;

                return true;
            });

            for (const studentPost of studentSubmissions) {
                if (scannedStudentPosts >= MAX_STUDENT_POSTS_PER_COURSE) break;

                scannedStudentPosts++;
                lateMissing++;

                const studentDate = parseUtcDate(studentPost.DatePosted);
                const studentPostId = studentPost.PostId || studentPost.PostID || studentPost?.PostId;

                // Find earliest instructor post after student post.
                // Prefer direct replies: ParentPostId == studentPostId
                let instructorReply = null;
                for (const post of posts) {
                    if (!post?.DatePosted) continue;
                    const authorId = post?.PostingUserId;
                    if (!authorId) continue;
                    if (!instructorIds.has(String(authorId))) continue;

                    const postDate = parseUtcDate(post.DatePosted);
                    if (!postDate) continue;
                    if (studentDate && postDate <= studentDate) continue;

                    const parentId = post?.ParentPostId;
                    const isDirectReply = studentPostId ? String(parentId) === String(studentPostId) : false;
                    if (isDirectReply) {
                        instructorReply = post;
                        break;
                    }
                }

                if (!instructorReply) {
                    for (const post of posts) {
                        if (!post?.DatePosted) continue;
                        const authorId = post?.PostingUserId;
                        if (!authorId) continue;
                        if (!instructorIds.has(String(authorId))) continue;

                        const postDate = parseUtcDate(post.DatePosted);
                        if (!postDate) continue;
                        if (studentDate && postDate <= studentDate) continue;

                        instructorReply = post;
                        break;
                    }
                }

                if (!instructorReply) {
                    missing++;
                    continue;
                }

                const replyDate = parseUtcDate(instructorReply.DatePosted);
                const diff = daysBetween(studentDate, replyDate);
                if (diff === null) continue;

                if (diff > timelyDays) {
                    late++;
                    worstDays = worstDays === null ? diff : Math.max(worstDays, diff);
                } else {
                    // Not late/missing
                    lateMissing--;
                }
            }
        }
    }

    return { lateMissing, missing, late, worstDays };
}

async function scanOneCourse(course, ctx) {
    const orgUnitId = course.Identifier;
    const code = course.Code || '';
    const name = course.Name || '';

    const includeAssignments = ctx.includeAssignments;
    const includeQuizzes = ctx.includeQuizzes;
    const includeDiscussions = ctx.includeDiscussions;

    let assignmentRes = { lateMissing: 0, worstDays: null };
    let quizRes = { lateMissing: 0, worstDays: null };
    let discussionRes = { lateMissing: 0, worstDays: null };

    if (includeAssignments) {
        assignmentRes = await scanDropboxesForTimelyFeedback(orgUnitId, ctx.timelyDays, ctx);
    }
    if (includeQuizzes) {
        quizRes = await scanQuizzesForTimelyFeedback(orgUnitId, ctx.timelyDays, ctx);
    }
    if (includeDiscussions) {
        discussionRes = await scanDiscussionsForTimelyFeedback(orgUnitId, ctx.timelyDays, ctx);
    }

    const assignmentsLateMissing = assignmentRes?.lateMissing ?? 0;
    const quizzesLateMissing = quizRes?.lateMissing ?? 0;
    const discussionsLateMissing = discussionRes?.lateMissing ?? 0;

    const totalLateMissing = assignmentsLateMissing + quizzesLateMissing + discussionsLateMissing;

    const candidates = [
        assignmentRes?.worstDays,
        quizRes?.worstDays,
        discussionRes?.worstDays
    ].filter(v => typeof v === 'number' && !Number.isNaN(v));

    const worstLatenessDays = candidates.length ? Math.max(...candidates) : null;

    return {
        orgUnitId,
        code,
        name,
        assignmentsLateMissing,
        quizzesLateMissing,
        discussionsLateMissing,
        totalLateMissing,
        worstLatenessDays
    };
}

async function loadCoursesForSemester(semesterId) {
    const coursesResp = await D2LApi.fetchPaginatedData(
        `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${semesterId}/children/`
    );

    const courseOfferings = Array.isArray(coursesResp) ? coursesResp.filter(c => c.Type?.Code === 'Course Offering') : [];
    const filteredOfferings = courseOfferings.filter(c => !shouldExcludeCourse(c));

    return filteredOfferings;
}

async function handleLoadSemesterCourses() {
    const { semesterId } = currentFilters();
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }

    const btn = document.getElementById('load-semester-btn');
    const runBtn = document.getElementById('run-scan-btn');
    if (btn) btn.disabled = true;

    try {
        scanResults = [];
        renderResultsTable();

        LoadingUtils.showLoadingModal('Loading semester courses...', 'loadingModal');
        LoadingUtils.updateLoadingModal(10, 'Fetching course offerings...', 'loadingModal');

        allCoursesForSemester = await loadCoursesForSemester(semesterId);

        currentSemesterDates = await fetchSemesterDates(semesterId);
        if (!leVersion) {
            if (allCoursesForSemester.length) {
                leVersion = await resolveLeVersionFor(allCoursesForSemester[0].Identifier);
            } else {
                leVersion = null;
            }
        }

        console.log('Loaded semester courses:', {
            semesterId,
            courseCount: allCoursesForSemester.length,
            startDate: currentSemesterDates.start ? currentSemesterDates.start.toISOString() : null,
            endDate: currentSemesterDates.end ? currentSemesterDates.end.toISOString() : null,
        });

        updateDeptPrefixOptions();

        if (runBtn) runBtn.disabled = false;

        const countEl = document.getElementById('results-count');
        if (countEl) countEl.textContent = `Loaded ${allCoursesForSemester.length} course(s). Apply filters and run scan.`;

        LoadingUtils.updateLoadingModal(100, 'Ready.', 'loadingModal');
        setTimeout(() => LoadingUtils.hideLoadingModal('loadingModal'), 500);
    } catch (e) {
        console.error('Failed loading semester courses', e);
        LoadingUtils.hideLoadingModal('loadingModal');
        alert('Error loading semester courses: ' + e.message);
    } finally {
        if (btn) btn.disabled = false;
        lastLoadedSemesterId = semesterId;
    }
}

async function handleRunScan() {
    const filters = currentFilters();

    if (!filters.semesterId) {
        alert('Please select a semester.');
        return;
    }
    if (!allCoursesForSemester.length) {
        alert('Load semester courses first.');
        return;
    }
    if (lastLoadedSemesterId !== filters.semesterId) {
        alert('Semester changed. Load courses again for the selected semester.');
        return;
    }

    const coursesToScan = getFilteredCourses();
    if (!coursesToScan.length) {
        alert('No courses match the current filters.');
        return;
    }

    scanResults = [];
    renderResultsTable();

    const loadingModalId = 'loadingModal';
    LoadingUtils.showLoadingModal('Starting feedback scan...', loadingModalId);
    document.getElementById('loading-indicator') && (document.getElementById('loading-indicator').style.display = 'block');

    const concurrency = Math.max(1, filters.concurrency);
    const batchSize = concurrency;

    try {
        if (!leVersion) {
            leVersion = await resolveLeVersionFor(coursesToScan[0].Identifier);
        }

        const ctx = {
            ...filters,
            startDate: currentSemesterDates.start,
            endDate: currentSemesterDates.end,
        };

        let processed = 0;
        for (let i = 0; i < coursesToScan.length; i += batchSize) {
            if (LoadingUtils.isCancelled(loadingModalId)) break;

            const batch = coursesToScan.slice(i, i + batchSize);
            LoadingUtils.updateLoadingModal(
                Math.round(10 + (processed / coursesToScan.length) * 80),
                `Processing courses ${i + 1}-${Math.min(i + batchSize, coursesToScan.length)} of ${coursesToScan.length}...`,
                loadingModalId
            );

            const batchResults = await Promise.allSettled(batch.map(c => scanOneCourse(c, ctx)));
            for (const r of batchResults) {
                if (r.status === 'fulfilled' && r.value) {
                    processed++;
                    // Only keep courses with at least one flag
                    if ((r.value.totalLateMissing ?? 0) > 0) {
                        scanResults.push(r.value);
                    }
                }
            }

            // Allow UI paint
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        scanResults.sort((a, b) => (b.totalLateMissing || 0) - (a.totalLateMissing || 0));
        LoadingUtils.updateLoadingModal(100, 'Scan complete.', loadingModalId);
        LoadingUtils.hideLoadingModal(loadingModalId);

        const countEl = document.getElementById('results-count');
        if (countEl) countEl.textContent = `${scanResults.length} course(s) with late/missing feedback flags (of ${coursesToScan.length} scanned).`;

        renderResultsTable();
    } catch (e) {
        console.error('Run scan failed', e);
        LoadingUtils.hideLoadingModal(loadingModalId);
        alert('Error running scan: ' + e.message);
    } finally {
        document.getElementById('loading-indicator') && (document.getElementById('loading-indicator').style.display = 'none');
    }
}

function downloadCSV() {
    if (!scanResults.length) {
        alert('No results to export.');
        return;
    }

    const headers = [
        'SemesterStartDate',
        'SemesterEndDate',
        'OrgUnitId',
        'Course Code',
        'Course Name',
        'Assignments Late/Missing',
        'Quizzes Late/Missing',
        'Discussions Late/Missing',
        'Total Late/Missing',
        'Worst Lateness (days)'
    ];

    const rows = scanResults.map(r => [
        currentSemesterDates.start ? currentSemesterDates.start.toISOString() : '',
        currentSemesterDates.end ? currentSemesterDates.end.toISOString() : '',
        r.orgUnitId,
        r.code,
        r.name,
        r.assignmentsLateMissing,
        r.quizzesLateMissing,
        r.discussionsLateMissing,
        r.totalLateMissing,
        r.worstLatenessDays === null ? '' : r.worstLatenessDays.toFixed(1)
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row =>
            row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
        )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `faculty_feedback_timeliness_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
    loadSemestersIntoSelect();

    document.getElementById('load-semester-btn')?.addEventListener('click', handleLoadSemesterCourses);
    document.getElementById('run-scan-btn')?.addEventListener('click', handleRunScan);
    document.getElementById('download-csv-btn')?.addEventListener('click', downloadCSV);
});

