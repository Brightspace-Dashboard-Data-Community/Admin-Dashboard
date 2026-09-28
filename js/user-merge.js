/**
 * Merge Duplicate Users
 * Brightspace User Merge API (LP 1.62+ / July 2026): POST /d2l/api/lp/1.62/users/merge
 *
 * This combines two USER accounts (enrollments + awards). It is not a course-section
 * merge and is not related to Office Hours Chat.
 */

(function () {
    'use strict';

    const MERGE_API_VERSION = '1.62';
    const USERS_API_VERSION = '1.49';
    const ENROLL_API_VERSION = '1.46';
    const COURSE_OFFERING_TYPE_ID = 3;
    const MAX_ENROLLMENT_PAGES = 40;

    const state = {
        source: null,
        dest: null,
        sourceEnrollments: [],
        destEnrollments: [],
        merging: false
    };

    const els = {};

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        if (value == null) return '';
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    async function BrightspaceFetch(endpoint, method, body) {
        const token = localStorage.getItem('XSRF.Token');
        const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
        if (token) headers['X-CSRF-Token'] = token;
        const options = { method: method || 'GET', headers, credentials: 'include' };
        if (body != null) options.body = JSON.stringify(body);

        const response = await fetch(endpoint, options);
        const newToken = response.headers.get('x-csrf-token');
        if (newToken && newToken !== token) localStorage.setItem('XSRF.Token', newToken);

        const text = await response.text();
        if (!response.ok) {
            let detail = '';
            if (text) {
                try {
                    const parsed = JSON.parse(text);
                    detail = parsed.message || parsed.detail || parsed.Errors || JSON.stringify(parsed);
                    if (Array.isArray(detail)) detail = detail.map((e) => e.Message || e.message || e).join('; ');
                } catch {
                    detail = text.slice(0, 400);
                }
            }
            const error = new Error(`API ${response.status} ${response.statusText}${detail ? ' — ' + detail : ''}`);
            error.status = response.status;
            throw error;
        }
        if (!text || !text.trim()) return (method || 'GET').toUpperCase() === 'GET' ? [] : {};
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    function normalizeUserList(result) {
        if (!result) return [];
        if (Array.isArray(result)) return result;
        if (Array.isArray(result.Items)) return result.Items;
        if (result.UserId || result.Identifier) return [result];
        return [];
    }

    function getUserId(user) {
        const id = user && (user.UserId ?? user.Identifier);
        return id == null ? '' : String(id);
    }

    function getUserName(user) {
        return (user && (user.UserName || user.Username)) || '';
    }

    function getDisplayName(user) {
        if (!user) return '';
        return [user.FirstName, user.LastName].filter(Boolean).join(' ').trim() || getUserName(user);
    }

    function userIsActive(user) {
        const act = user && (user.Activation || user.activation);
        if (act && act.IsActive != null) return !!act.IsActive;
        if (user && user.IsActive != null) return user.IsActive === true || user.IsActive === 'true' || user.IsActive === 1;
        return null;
    }

    async function searchUsers(query, searchType) {
        const trimmed = String(query || '').trim();
        if (!trimmed) throw new Error('Enter a search value.');

        if (searchType === 'userId') {
            if (!/^\d+$/.test(trimmed)) throw new Error('UserId must be a number.');
            const user = await BrightspaceFetch(`/d2l/api/lp/${USERS_API_VERSION}/users/${encodeURIComponent(trimmed)}`);
            return user ? [user] : [];
        }
        if (searchType === 'userName') {
            const result = await BrightspaceFetch(
                `/d2l/api/lp/${USERS_API_VERSION}/users/?userName=${encodeURIComponent(trimmed)}`
            );
            return normalizeUserList(result);
        }
        const result = await BrightspaceFetch(
            `/d2l/api/lp/${USERS_API_VERSION}/users/?orgDefinedId=${encodeURIComponent(trimmed)}`
        );
        return normalizeUserList(result);
    }

    async function fetchAllUserEnrollments(userId) {
        const allItems = [];
        let bookmark = null;
        let pageCount = 0;
        const seenBookmarks = new Set();

        while (pageCount < MAX_ENROLLMENT_PAGES) {
            let endpoint = `/d2l/api/lp/${ENROLL_API_VERSION}/enrollments/users/${encodeURIComponent(userId)}/orgUnits/?pageSize=200`;
            if (bookmark) endpoint += `&bookmark=${encodeURIComponent(bookmark)}`;
            const page = await BrightspaceFetch(endpoint);
            const items = Array.isArray(page?.Items) ? page.Items : Array.isArray(page) ? page : [];
            allItems.push(...items);

            const paging = page?.PagingInfo || {};
            const hasMore = Boolean(paging.HasMoreItems || paging.hasMoreItems);
            const nextBookmark = paging.Bookmark || paging.bookmark || null;
            if (!hasMore || !nextBookmark || seenBookmarks.has(String(nextBookmark))) break;
            seenBookmarks.add(String(nextBookmark));
            bookmark = nextBookmark;
            pageCount += 1;
        }
        return allItems;
    }

    function courseOfferings(enrollments) {
        return (enrollments || []).filter((e) => e?.OrgUnit?.Type?.Id === COURSE_OFFERING_TYPE_ID);
    }

    function orgUnitKey(enrollment) {
        return String(enrollment?.OrgUnit?.Id ?? '');
    }

    function renderUserCard(container, user) {
        if (!user) {
            container.className = 'user-card empty';
            container.textContent = 'No user selected.';
            return;
        }
        const active = userIsActive(user);
        const badge = active == null
            ? ''
            : `<span class="badge ${active ? 'badge-active' : 'badge-inactive'}">${active ? 'Active' : 'Inactive'}</span>`;
        container.className = 'user-card';
        container.innerHTML = `
            <dl>
                <dt>Name</dt><dd>${escapeHtml(getDisplayName(user))} ${badge}</dd>
                <dt>UserId</dt><dd class="mono">${escapeHtml(getUserId(user))}</dd>
                <dt>Username</dt><dd class="mono">${escapeHtml(getUserName(user))}</dd>
                <dt>OrgDefinedId</dt><dd class="mono">${escapeHtml(user.OrgDefinedId || '')}</dd>
                <dt>Email</dt><dd>${escapeHtml(user.ExternalEmail || user.UniqueName || '')}</dd>
            </dl>
        `;
    }

    function renderPicker(container, users, side) {
        if (!users || users.length < 2) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }
        container.classList.remove('hidden');
        container.innerHTML = users.map((user) => {
            const label = `${getDisplayName(user)} · ${getUserName(user)} · UserId ${getUserId(user)}`;
            return `<button type="button" data-side="${side}" data-userid="${escapeHtml(getUserId(user))}">${escapeHtml(label)}</button>`;
        }).join('');
        container.querySelectorAll('button').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const chosen = users.find((u) => getUserId(u) === btn.getAttribute('data-userid'));
                await selectUser(side, chosen);
                container.classList.add('hidden');
            });
        });
    }

    function setStatus(el, message, isError) {
        el.textContent = message || '';
        el.className = isError ? 'status-line error' : 'status-line';
    }

    async function selectUser(side, user) {
        if (side === 'source') state.source = user;
        else state.dest = user;
        renderUserCard(side === 'source' ? els.sourceCard : els.destCard, user);
        await refreshPreview();
        updateMergeEnabled();
    }

    async function lookupSide(side) {
        const typeEl = side === 'source' ? els.sourceType : els.destType;
        const queryEl = side === 'source' ? els.sourceQuery : els.destQuery;
        const statusEl = side === 'source' ? els.sourceStatus : els.destStatus;
        const pickerEl = side === 'source' ? els.sourcePicker : els.destPicker;
        const btn = side === 'source' ? els.sourceFindBtn : els.destFindBtn;

        setStatus(statusEl, 'Searching…');
        btn.disabled = true;
        try {
            const users = await searchUsers(queryEl.value, typeEl.value);
            if (!users.length) {
                await selectUser(side, null);
                setStatus(statusEl, 'No matching user.', true);
                renderPicker(pickerEl, [], side);
                return;
            }
            if (users.length === 1) {
                await selectUser(side, users[0]);
                renderPicker(pickerEl, [], side);
                setStatus(statusEl, 'User loaded.');
                return;
            }
            setStatus(statusEl, `${users.length} matches — pick one.`);
            renderPicker(pickerEl, users, side);
        } catch (error) {
            setStatus(statusEl, error.message || 'Search failed.', true);
        } finally {
            btn.disabled = false;
        }
    }

    function compareCell(sourceVal, destVal) {
        const a = sourceVal == null ? '' : String(sourceVal);
        const b = destVal == null ? '' : String(destVal);
        const cls = a && b && a.toLowerCase() !== b.toLowerCase() ? ' mismatch' : '';
        return `<td class="${cls}">${escapeHtml(a)}</td><td class="${cls}">${escapeHtml(b)}</td>`;
    }

    function enrollmentMap(list) {
        const map = new Map();
        courseOfferings(list).forEach((enrollment) => {
            const key = orgUnitKey(enrollment);
            if (key) map.set(key, enrollment);
        });
        return map;
    }

    function buildEnrollmentRows() {
        const sourceMap = enrollmentMap(state.sourceEnrollments);
        const destMap = enrollmentMap(state.destEnrollments);
        const ids = new Set([...sourceMap.keys(), ...destMap.keys()]);
        const rows = [];

        ids.forEach((id) => {
            const sourceEnr = sourceMap.get(id);
            const destEnr = destMap.get(id);
            const sample = sourceEnr || destEnr;
            const cascading = Boolean(sourceEnr?.IsCascading);
            const wouldTransfer = Boolean(sourceEnr && !destEnr && !cascading);
            rows.push({
                id,
                code: sample?.OrgUnit?.Code || '',
                name: sample?.OrgUnit?.Name || '',
                role: (sourceEnr || destEnr)?.Role?.Name || '',
                onSource: Boolean(sourceEnr),
                onDest: Boolean(destEnr),
                cascading,
                wouldTransfer
            });
        });

        rows.sort((a, b) => {
            if (a.wouldTransfer !== b.wouldTransfer) return a.wouldTransfer ? -1 : 1;
            return String(a.code).localeCompare(String(b.code));
        });
        return rows;
    }

    function renderPreview() {
        if (!state.source || !state.dest) {
            els.previewCard.classList.add('hidden');
            els.optionsCard.classList.add('hidden');
            return;
        }

        els.previewCard.classList.remove('hidden');
        els.optionsCard.classList.remove('hidden');

        const warnings = [];
        if (getUserId(state.source) === getUserId(state.dest)) {
            warnings.push('<div class="danger-box">Source and destination are the same user. Choose two different accounts.</div>');
        }
        const sourceName = getDisplayName(state.source).toLowerCase();
        const destName = getDisplayName(state.dest).toLowerCase();
        if (sourceName && destName && sourceName !== destName) {
            warnings.push('<div class="warning-box"><strong>Name mismatch.</strong> Confirm these are actually the same person before merging.</div>');
        }
        const sourceOrg = String(state.source.OrgDefinedId || '').trim();
        const destOrg = String(state.dest.OrgDefinedId || '').trim();
        if (sourceOrg && destOrg && sourceOrg !== destOrg) {
            warnings.push('<div class="warning-box"><strong>OrgDefinedId mismatch.</strong> These accounts have different student/staff IDs.</div>');
        }

        els.previewWarnings.innerHTML = warnings.join('');

        const sourceActive = userIsActive(state.source);
        const destActive = userIsActive(state.dest);
        els.compareTable.innerHTML = `
            <tr><th></th><th>Source (from)</th><th>Destination (keep)</th></tr>
            <tr><th>Name</th>${compareCell(getDisplayName(state.source), getDisplayName(state.dest))}</tr>
            <tr><th>UserId</th>${compareCell(getUserId(state.source), getUserId(state.dest))}</tr>
            <tr><th>Username</th>${compareCell(getUserName(state.source), getUserName(state.dest))}</tr>
            <tr><th>OrgDefinedId</th>${compareCell(state.source.OrgDefinedId, state.dest.OrgDefinedId)}</tr>
            <tr><th>Email</th>${compareCell(state.source.ExternalEmail, state.dest.ExternalEmail)}</tr>
            <tr><th>Active</th>${compareCell(
                sourceActive == null ? '' : sourceActive ? 'Yes' : 'No',
                destActive == null ? '' : destActive ? 'Yes' : 'No'
            )}</tr>
        `;

        const rows = buildEnrollmentRows();
        const transferCount = rows.filter((r) => r.wouldTransfer).length;
        const overlapCount = rows.filter((r) => r.onSource && r.onDest).length;
        const cascadingCount = courseOfferings(state.sourceEnrollments).filter((e) => e.IsCascading).length;

        els.enrollPills.innerHTML = `
            <span class="pill">Source courses: ${courseOfferings(state.sourceEnrollments).length}</span>
            <span class="pill">Destination courses: ${courseOfferings(state.destEnrollments).length}</span>
            <span class="pill">Would transfer: ${transferCount}</span>
            <span class="pill">Already on both: ${overlapCount}</span>
            <span class="pill">Source cascading (will not transfer): ${cascadingCount}</span>
        `;

        if (!rows.length) {
            els.enrollBody.innerHTML = '<tr><td colspan="7">Neither account has course-offering enrollments.</td></tr>';
            return;
        }

        els.enrollBody.innerHTML = rows.map((row) => {
            const transferLabel = row.wouldTransfer
                ? 'Yes'
                : row.cascading && row.onSource && !row.onDest
                    ? 'No (cascading)'
                    : row.onDest
                        ? 'No (already there)'
                        : '—';
            return `<tr>
                <td class="mono">${escapeHtml(row.id)}</td>
                <td class="mono">${escapeHtml(row.code)}</td>
                <td>${escapeHtml(row.name)}</td>
                <td>${escapeHtml(row.role)}</td>
                <td>${row.onSource ? 'Yes' : ''}</td>
                <td>${row.onDest ? 'Yes' : ''}</td>
                <td>${escapeHtml(transferLabel)}</td>
            </tr>`;
        }).join('');
    }

    async function refreshPreview() {
        if (!state.source || !state.dest) {
            state.sourceEnrollments = [];
            state.destEnrollments = [];
            renderPreview();
            return;
        }
        els.enrollBody.innerHTML = '<tr><td colspan="7">Loading enrollments…</td></tr>';
        els.previewCard.classList.remove('hidden');
        try {
            const [sourceEnrollments, destEnrollments] = await Promise.all([
                fetchAllUserEnrollments(getUserId(state.source)),
                fetchAllUserEnrollments(getUserId(state.dest))
            ]);
            state.sourceEnrollments = sourceEnrollments;
            state.destEnrollments = destEnrollments;
        } catch (error) {
            els.enrollBody.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message || 'Failed to load enrollments.')}</td></tr>`;
        }
        renderPreview();
        updateMergeEnabled();
    }

    function includedTools() {
        const tools = [];
        if (els.includeEnrollments.checked) tools.push('enrollments');
        if (els.includeAwards.checked) tools.push('awards');
        return tools;
    }

    function deleteSourceUser() {
        const chosen = document.querySelector('input[name="sourceFate"]:checked');
        return chosen && chosen.value === 'delete';
    }

    function updateMergeEnabled() {
        const same = state.source && state.dest && getUserId(state.source) === getUserId(state.dest);
        const typed = (els.confirmText.value || '').trim().toLowerCase();
        const expected = getUserName(state.dest).trim().toLowerCase();
        const toolsOk = includedTools().length > 0;
        const ready = !state.merging
            && state.source
            && state.dest
            && !same
            && toolsOk
            && els.confirmCheck.checked
            && expected
            && typed === expected;
        els.mergeBtn.disabled = !ready;
    }

    function friendlyMergeError(error) {
        if (error.status === 403) {
            return 'Forbidden. Your role needs Users > Can Merge Users, and this session must be allowed to call users:merge:create.';
        }
        if (error.status === 404) {
            return 'Merge route not found. This LMS needs LP API 1.62+ (Brightspace 20.26.7 / July 2026).';
        }
        if (error.status === 400) {
            return 'The API rejected the request (invalid IncludedTools or missing fields). ' + (error.message || '');
        }
        return error.message || 'Merge failed.';
    }

    async function runMerge() {
        if (els.mergeBtn.disabled || state.merging) return;
        if (!window.confirm(
            `Merge ${getDisplayName(state.source)} (UserId ${getUserId(state.source)}) into ${getDisplayName(state.dest)} (UserId ${getUserId(state.dest)})?\n\nSource will be ${deleteSourceUser() ? 'DELETED' : 'deactivated'}.`
        )) {
            return;
        }

        state.merging = true;
        updateMergeEnabled();
        setStatus(els.mergeStatus, 'Submitting merge…');
        els.resultCard.classList.add('hidden');

        const payload = {
            SourceUserId: Number(getUserId(state.source)),
            DestinationUserId: Number(getUserId(state.dest)),
            IncludedTools: includedTools(),
            DeleteSourceUser: deleteSourceUser()
        };

        try {
            const result = await BrightspaceFetch(
                `/d2l/api/lp/${MERGE_API_VERSION}/users/merge`,
                'POST',
                payload
            );

            let sourceAfter = null;
            let destAfter = null;
            let sourceNote = '';
            try {
                destAfter = await BrightspaceFetch(`/d2l/api/lp/${USERS_API_VERSION}/users/${encodeURIComponent(payload.DestinationUserId)}`);
            } catch (error) {
                destAfter = null;
            }
            try {
                sourceAfter = await BrightspaceFetch(`/d2l/api/lp/${USERS_API_VERSION}/users/${encodeURIComponent(payload.SourceUserId)}`);
                sourceNote = userIsActive(sourceAfter) ? 'Source is still active — unexpected.' : 'Source is now inactive.';
            } catch (error) {
                sourceNote = payload.DeleteSourceUser || (error && error.status === 404)
                    ? 'Source account is no longer returned by the Users API (deleted or hidden).'
                    : (error.message || 'Could not re-read source user.');
            }

            els.resultCard.classList.remove('hidden');
            els.resultBody.innerHTML = `
                <div class="success-box">
                    Merge request completed for source UserId <span class="mono">${escapeHtml(payload.SourceUserId)}</span>
                    into destination UserId <span class="mono">${escapeHtml(payload.DestinationUserId)}</span>.
                </div>
                <p><strong>Tools:</strong> ${escapeHtml(payload.IncludedTools.join(', ') || '(none)')}</p>
                <p><strong>Source fate:</strong> ${payload.DeleteSourceUser ? 'Delete' : 'Deactivate'}. ${escapeHtml(sourceNote)}</p>
                <p><strong>Destination now:</strong> ${escapeHtml(destAfter ? getDisplayName(destAfter) + ' (' + getUserName(destAfter) + ')' : 'Could not re-read destination.')}</p>
                <p class="lookup-hint">API response: <span class="mono">${escapeHtml(typeof result === 'string' ? result : JSON.stringify(result) || '{}')}</span></p>
                <div class="info-box">
                    Direct enrollments should now sit on the destination account. Cascading enrollments and class progress do not transfer.
                    SIS/ILP may still own some enrollments — watch the next sync if these were Colleague-created sections.
                </div>
            `;
            setStatus(els.mergeStatus, 'Merge completed.');
            if (destAfter) state.dest = destAfter;
            if (sourceAfter) state.source = sourceAfter;
            else if (payload.DeleteSourceUser) state.source = sourceAfter;
            renderUserCard(els.sourceCard, state.source);
            renderUserCard(els.destCard, state.dest);
            await refreshPreview();
        } catch (error) {
            els.resultCard.classList.remove('hidden');
            els.resultBody.innerHTML = `<div class="danger-box">${escapeHtml(friendlyMergeError(error))}</div>`;
            setStatus(els.mergeStatus, friendlyMergeError(error), true);
        } finally {
            state.merging = false;
            updateMergeEnabled();
        }
    }

    async function swapUsers() {
        const tmpUser = state.source;
        state.source = state.dest;
        state.dest = tmpUser;
        const tmpEnroll = state.sourceEnrollments;
        state.sourceEnrollments = state.destEnrollments;
        state.destEnrollments = tmpEnroll;
        const tmpQuery = els.sourceQuery.value;
        els.sourceQuery.value = els.destQuery.value;
        els.destQuery.value = tmpQuery;
        const tmpType = els.sourceType.value;
        els.sourceType.value = els.destType.value;
        els.destType.value = tmpType;
        renderUserCard(els.sourceCard, state.source);
        renderUserCard(els.destCard, state.dest);
        renderPreview();
        updateMergeEnabled();
    }

    function bindEnter(input, handler) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handler();
            }
        });
    }

    function init() {
        els.sourceType = $('sourceType');
        els.sourceQuery = $('sourceQuery');
        els.sourceFindBtn = $('sourceFindBtn');
        els.sourcePicker = $('sourcePicker');
        els.sourceStatus = $('sourceStatus');
        els.sourceCard = $('sourceCard');
        els.destType = $('destType');
        els.destQuery = $('destQuery');
        els.destFindBtn = $('destFindBtn');
        els.destPicker = $('destPicker');
        els.destStatus = $('destStatus');
        els.destCard = $('destCard');
        els.swapBtn = $('swapBtn');
        els.previewCard = $('previewCard');
        els.previewWarnings = $('previewWarnings');
        els.compareTable = $('compareTable');
        els.enrollPills = $('enrollPills');
        els.enrollBody = $('enrollBody');
        els.optionsCard = $('optionsCard');
        els.includeEnrollments = $('includeEnrollments');
        els.includeAwards = $('includeAwards');
        els.confirmText = $('confirmText');
        els.confirmCheck = $('confirmCheck');
        els.refreshPreviewBtn = $('refreshPreviewBtn');
        els.mergeBtn = $('mergeBtn');
        els.mergeStatus = $('mergeStatus');
        els.resultCard = $('resultCard');
        els.resultBody = $('resultBody');

        els.sourceFindBtn.addEventListener('click', () => lookupSide('source'));
        els.destFindBtn.addEventListener('click', () => lookupSide('destination'));
        bindEnter(els.sourceQuery, () => lookupSide('source'));
        bindEnter(els.destQuery, () => lookupSide('destination'));
        els.swapBtn.addEventListener('click', swapUsers);
        els.refreshPreviewBtn.addEventListener('click', refreshPreview);
        els.mergeBtn.addEventListener('click', runMerge);
        ['includeEnrollments', 'includeAwards', 'confirmText', 'confirmCheck'].forEach((id) => {
            $(id).addEventListener('input', updateMergeEnabled);
            $(id).addEventListener('change', updateMergeEnabled);
        });
        document.querySelectorAll('input[name="sourceFate"]').forEach((radio) => {
            radio.addEventListener('change', updateMergeEnabled);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
