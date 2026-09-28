/**
 * Orientation Not Enrolled list page
 * Displays students (role 101) who are not yet enrolled in the Orientation course.
 * Data is loaded from cache (populated by Enrollment Dashboard) or by refreshing from API.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const loadingEl = document.getElementById('loading-message');
    const emptyEl = document.getElementById('empty-message');
    const tableContainer = document.getElementById('table-container');
    const tbody = document.getElementById('tbody');
    const countBadge = document.getElementById('count-badge');
    const refreshBtn = document.getElementById('refresh-btn');
    const downloadCsvBtn = document.getElementById('download-csv-btn');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const pageInfoEl = document.getElementById('page-info');
    const paginationControls = document.getElementById('pagination-controls');

    const PAGE_SIZE = 50;
    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let sortKey = 'orgDefinedId';
    let sortDir = 'asc';
    let searchQuery = '';
    let emailFilter = 'all';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function compare(a, b, key) {
        const va = a[key] ?? '';
        const vb = b[key] ?? '';
        const na = Number(va);
        const nb = Number(vb);
        if (key === 'userId' && !Number.isNaN(na) && !Number.isNaN(nb)) {
            return na - nb;
        }
        if (key === 'orgDefinedId' && !Number.isNaN(na) && !Number.isNaN(nb)) {
            return na - nb;
        }
        return String(va).localeCompare(String(vb), undefined, { numeric: true });
    }

    function applySort() {
        if (!filteredRows || filteredRows.length === 0) return;
        const dir = sortDir === 'asc' ? 1 : -1;
        filteredRows.sort((a, b) => dir * compare(a, b, sortKey));
    }

    function applyFilters() {
        const query = searchQuery.trim().toLowerCase();
        filteredRows = allRows.filter((row) => {
            const hasEmail = Boolean((row.email || '').trim());
            const matchesEmailFilter =
                emailFilter === 'all' ||
                (emailFilter === 'with-email' && hasEmail) ||
                (emailFilter === 'missing-email' && !hasEmail);

            if (!matchesEmailFilter) return false;
            if (!query) return true;

            const haystack = [
                row.userId,
                row.orgDefinedId,
                row.firstName,
                row.lastName,
                row.email,
                row.dateCreated
            ].join(' ').toLowerCase();

            return haystack.includes(query);
        });
    }

    function updateSortHeaders() {
        document.querySelectorAll('.sortable-th .sort-icon').forEach(span => {
            span.innerHTML = '';
        });
        const active = document.querySelector(`.sortable-th[data-sort="${sortKey}"] .sort-icon`);
        if (active) {
            active.innerHTML = sortDir === 'asc'
                ? '<i class="fa-solid fa-arrow-up"></i>'
                : '<i class="fa-solid fa-arrow-down"></i>';
        }
    }

    function renderPage(page) {
        if (!filteredRows || filteredRows.length === 0) {
            tbody.innerHTML = '';
            if (pageInfoEl) pageInfoEl.textContent = 'Page 0';
            if (prevPageBtn) prevPageBtn.disabled = true;
            if (nextPageBtn) nextPageBtn.disabled = true;
            renderPaginationButtons(0);
            return;
        }

        const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE);
        currentPage = Math.min(Math.max(1, page), totalPages);

        const start = (currentPage - 1) * PAGE_SIZE;
        const pageRows = filteredRows.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = pageRows.map((row, i) => `
            <tr>
                <td>${start + i + 1}</td>
                <td>${escapeHtml(row.userId || '')}</td>
                <td>${escapeHtml(row.orgDefinedId || '')}</td>
                <td>${escapeHtml(row.firstName || '')}</td>
                <td>${escapeHtml(row.lastName || '')}</td>
                <td>${escapeHtml(row.email || '')}</td>
                <td>${escapeHtml(row.dateCreated || '')}</td>
            </tr>
        `).join('');

        if (pageInfoEl) {
            pageInfoEl.textContent = `Page ${currentPage} of ${totalPages}`;
        }
        if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
        if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
        renderPaginationButtons(totalPages);
    }

    function renderPaginationButtons(totalPages) {
        const oldButtons = paginationControls?.querySelector('.page-number-buttons');
        if (oldButtons) oldButtons.remove();
        if (!paginationControls || totalPages <= 1) return;

        const wrap = document.createElement('div');
        wrap.className = 'page-number-buttons';
        wrap.style.display = 'flex';
        wrap.style.gap = '6px';
        wrap.style.alignItems = 'center';

        const maxVisiblePages = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        function addBtn(pageNum, active) {
            const btn = document.createElement('button');
            btn.className = active ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
            btn.textContent = String(pageNum);
            if (!active) btn.addEventListener('click', () => renderPage(pageNum));
            wrap.appendChild(btn);
        }

        if (startPage > 1) {
            addBtn(1, currentPage === 1);
            if (startPage > 2) {
                const dots = document.createElement('span');
                dots.textContent = '...';
                wrap.appendChild(dots);
            }
        }
        for (let i = startPage; i <= endPage; i++) addBtn(i, i === currentPage);
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const dots = document.createElement('span');
                dots.textContent = '...';
                wrap.appendChild(dots);
            }
            addBtn(totalPages, currentPage === totalPages);
        }

        const rightControls = paginationControls.querySelector('div:last-child');
        if (rightControls) rightControls.prepend(wrap);
    }

    function ensureToolbar() {
        if (document.getElementById('orientation-search-input')) return;
        const tableContainerEl = document.getElementById('table-container');
        const cardBody = tableContainerEl?.parentElement;
        if (!cardBody) return;

        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.gap = '8px';
        toolbar.style.alignItems = 'center';
        toolbar.style.marginBottom = '12px';
        toolbar.style.flexWrap = 'wrap';
        toolbar.innerHTML = `
            <input id="orientation-search-input" type="text" class="form-control" placeholder="Search by ID, name, email..." style="min-width:240px; max-width:360px;">
            <select id="orientation-email-filter" class="form-control" style="max-width:220px;">
                <option value="all">All Email Status</option>
                <option value="with-email">With Email</option>
                <option value="missing-email">Missing Email</option>
            </select>
            <button id="orientation-clear-filters" class="btn btn-outline btn-sm"><i class="fa-solid fa-xmark"></i> Clear</button>
        `;
        cardBody.insertBefore(toolbar, tableContainerEl);

        const searchInput = document.getElementById('orientation-search-input');
        const emailSelect = document.getElementById('orientation-email-filter');
        const clearBtn = document.getElementById('orientation-clear-filters');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value || '';
                applyFilters();
                applySort();
                renderPage(1);
            });
        }
        if (emailSelect) {
            emailSelect.addEventListener('change', (e) => {
                emailFilter = e.target.value || 'all';
                applyFilters();
                applySort();
                renderPage(1);
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                searchQuery = '';
                emailFilter = 'all';
                if (searchInput) searchInput.value = '';
                if (emailSelect) emailSelect.value = 'all';
                applyFilters();
                applySort();
                renderPage(1);
            });
        }
    }

    async function loadList() {
        loadingEl.style.display = 'block';
        emptyEl.style.display = 'none';
        tableContainer.style.display = 'none';

        try {
            const { count, users } = await EnrollmentDataService.getOrientationNotEnrolled();
            loadingEl.style.display = 'none';
            if (countBadge) countBadge.textContent = count.toString();

            if (!users || users.length === 0) {
                allRows = [];
                emptyEl.style.display = 'block';
                renderPage(1);
                return;
            }

            // Default rows: minimal info with just userId
            allRows = users.map(u => ({
                userId: u.userId,
                orgDefinedId: '',
                firstName: '',
                lastName: '',
                email: '',
                dateCreated: ''
            }));

            // Try to look up richer user details from Users dataset.
            // If this fails (dataset permissions / network / etc.), we silently
            // fall back to the minimal list instead of showing an error.
            try {
                if (typeof UserDataService !== 'undefined') {
                    const userIds = users.map(u => u.userId);
                    const details = await UserDataService.getUserDetailsByIds(userIds);
                    if (Array.isArray(details) && details.length === allRows.length) {
                        allRows = details;
                    }
                } else {
                    console.warn('UserDataService is not available; showing user IDs only.');
                }
            } catch (detailError) {
                console.warn('User detail lookup failed; falling back to userId-only list.', detailError);
            }

            applyFilters();
            applySort();
            updateSortHeaders();
            tableContainer.style.display = 'block';
            renderPage(1);
        } catch (e) {
            console.error('Load orientation not enrolled error:', e);
            loadingEl.style.display = 'none';
            loadingEl.innerHTML = '<p style="color: #c62828;">Error loading list. Open the Enrollment Dashboard first to load data, then try again.</p>';
            loadingEl.style.display = 'block';
        }
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            localStorage.removeItem('orientation_not_enrolled');
            localStorage.removeItem('orientation_not_enrolled_time');
            localStorage.removeItem('orientation_not_enrolled_details');
            loadList();
        });
    }

    const tableEl = document.getElementById('students-table');
    if (tableEl) {
        tableEl.querySelector('thead').addEventListener('click', (e) => {
            const th = e.target.closest('.sortable-th');
            if (!th || !th.dataset.sort) return;
            const key = th.dataset.sort;
            if (sortKey === key) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortKey = key;
                sortDir = 'asc';
            }
            applySort();
            updateSortHeaders();
            renderPage(currentPage);
        });
    }

    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            renderPage(currentPage - 1);
        });
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            renderPage(currentPage + 1);
        });
    }

    if (downloadCsvBtn) {
        downloadCsvBtn.addEventListener('click', () => {
            if (!allRows || allRows.length === 0) return;
            const header = ['UserId', 'OrgDefinedId', 'FirstName', 'LastName', 'Email', 'DateCreated'];
            const lines = [header.join(',')];
            allRows.forEach(row => {
                const cols = [
                    row.userId || '',
                    row.orgDefinedId || '',
                    row.firstName || '',
                    row.lastName || '',
                    row.email || '',
                    row.dateCreated || ''
                ].map(value => {
                    const v = String(value ?? '');
                    if (v.includes('"') || v.includes(',') || v.includes('\n')) {
                        return `"${v.replace(/"/g, '""')}"`;
                    }
                    return v;
                });
                lines.push(cols.join(','));
            });

            const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const stamp = new Date().toISOString().split('T')[0];
            a.download = `orientation-not-enrolled-${stamp}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    ensureToolbar();
    await loadList();
});
