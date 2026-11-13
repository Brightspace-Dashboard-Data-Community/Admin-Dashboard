/**
 * Broken / Missing Links
 * Scans course offerings for topics Brightspace marks broken, and for file
 * topics with an empty path. Reads only. Does not request the external URL.
 *
 * IsBroken is part of the Learning Environment content contract from API 1.72.
 */
const LE_VERSION = '1.75';
let resultsTable = null;
let allResults = [];

function computeHiddenFlag(entity) {
    if (!entity || typeof entity !== 'object') return null;

    const booleanKeys = ['IsHidden', 'Hidden', 'hidden', 'isHidden', 'is_hidden', 'IsHIDDEN'];
    for (const key of booleanKeys) {
        if (Object.prototype.hasOwnProperty.call(entity, key)) {
            const v = entity[key];
            if (typeof v === 'boolean') return v;
        }
    }

    if (entity.IsVisible === false || entity.Visible === false) return true;
    if (entity.IsVisible === true || entity.Visible === true) return false;

    const visibility = entity.Visibility ?? entity.visibility ?? entity.state ?? null;
    if (typeof visibility === 'string') {
        const v = visibility.toLowerCase();
        if (v.includes('hidden') || v.includes('invisible')) return true;
        if (v.includes('visible')) return false;
    }

    return null;
}

function formatHiddenLabel(hiddenFlag) {
    if (hiddenFlag === true) return 'Yes';
    if (hiddenFlag === false) return 'No';
    return 'Unknown';
}

function isCourseOffering(orgUnit) {
    const code = orgUnit && orgUnit.Type && orgUnit.Type.Code;
    const id = orgUnit && orgUnit.Type && orgUnit.Type.Id;
    return code === 'Course Offering' || id === 3;
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('run-scan-btn').addEventListener('click', handleRunScan);
    document.getElementById('download-csv-btn').addEventListener('click', handleDownloadCSV);
    setupTopicReviewModal();
    await loadSession();
});

function setSessionBanner(kind, message) {
    const banner = document.getElementById('session-status');
    if (!banner) return;
    banner.className = 'session-banner ' + (kind || '');
    banner.textContent = message;
}

async function loadSession() {
    if (window.location.protocol === 'file:') {
        setSessionBanner('error', 'This page was opened from your computer. Upload the folder to Brightspace and open it from that site while you are signed in. The scan uses your Brightspace session and cannot run from a downloaded file.');
        const select = document.getElementById('semester-select');
        if (select) select.innerHTML = '<option value="">Open this page on Brightspace</option>';
        return;
    }

    try {
        const me = await D2LApi.getWhoAmI();
        const name = [me && me.FirstName, me && me.LastName].filter(Boolean).join(' ') || (me && me.UniqueName) || 'signed-in user';
        let orgName = '';
        try {
            const org = await D2LApi.getOrganizationInfo();
            orgName = org && org.Name ? org.Name : '';
        } catch (orgError) {
            console.warn('Organization name unavailable', orgError);
        }
        setSessionBanner('ok', orgName
            ? 'Signed in as ' + name + ' at ' + orgName + '.'
            : 'Signed in as ' + name + '.');
        await loadSemesters();
    } catch (error) {
        console.error('Session check failed', error);
        setSessionBanner('error', 'Brightspace did not accept this session (' + error.message + '). Stay signed in, and open this file from your Brightspace address so the page can call /d2l/api on the same site.');
        const select = document.getElementById('semester-select');
        if (select) select.innerHTML = '<option value="">Not signed in</option>';
    }
}

function setupTopicReviewModal() {
    const overlay = document.getElementById('topic-review-overlay');
    const closeBtn = document.getElementById('topic-review-close');
    if (!overlay || !closeBtn) return;

    const setOpen = (isOpen) => {
        overlay.classList.toggle('show', isOpen);
        overlay.setAttribute('aria-hidden', String(!isOpen));
    };

    closeBtn.addEventListener('click', () => setOpen(false));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setOpen(false);
    });

    const table = document.getElementById('results-table');
    if (!table) return;

    table.addEventListener('click', (e) => {
        const target = e.target.closest('.topic-review-link');
        if (!target) return;
        e.preventDefault();

        const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value ?? '';
        };

        setValue('review-course-code', target.dataset.courseCode);
        setValue('review-orgunitid', target.dataset.orgUnitId);
        setValue('review-topic-title', target.dataset.topicTitle);
        setValue('review-module-title', target.dataset.moduleTitle);
        setValue('review-topic-hidden', target.dataset.topicHidden);
        setValue('review-module-hidden', target.dataset.moduleHidden);
        setValue('review-topic-id', target.dataset.topicId);
        setValue('review-link-type', target.dataset.linkType);
        setValue('review-link-url', target.dataset.linkUrl);
        setValue('review-status', target.dataset.status);
        setValue('review-error-details', target.dataset.errorDetails);

        const courseLink = document.getElementById('review-course-link');
        if (courseLink) {
            const orgUnitId = target.dataset.orgUnitId || '';
            courseLink.href = orgUnitId ? '/d2l/home/' + encodeURIComponent(orgUnitId) : '#';
        }

        setOpen(true);
    });
}

async function loadSemesters() {
    const select = document.getElementById('semester-select');
    try {
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) {
            throw new Error('Could not get organization info');
        }

        select.innerHTML = '<option value="">Loading semesters...</option>';
        const semesters = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${orgInfo.Identifier}/descendants/?ouTypeId=5`
        );

        if (!Array.isArray(semesters) || semesters.length === 0) {
            throw new Error('No semesters found');
        }

        semesters.sort((a, b) => {
            const idA = Number(a.Identifier) || 0;
            const idB = Number(b.Identifier) || 0;
            if (idA !== idB) return idB - idA;
            return String(b.Name || '').localeCompare(String(a.Name || ''));
        });

        select.innerHTML = '<option value="">Select Semester...</option>';
        semesters.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.Identifier;
            const code = semester.Code ? ' (' + semester.Code + ')' : '';
            option.textContent = (semester.Name || 'Semester ' + semester.Identifier) + code;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading semesters:', error);
        if (select) select.innerHTML = '<option value="">Error loading semesters</option>';
        setSessionBanner('error', 'Semesters could not be loaded. ' + error.message);
    }
}

async function handleRunScan() {
    const semesterId = document.getElementById('semester-select').value;
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }

    const scanLimitValue = document.getElementById('scan-limit').value;
    const scanLimit = scanLimitValue === '0' ? null : parseInt(scanLimitValue, 10) || 100;
    const runBtn = document.getElementById('run-scan-btn');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text');
    const resultsContainer = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');
    const resultsCount = document.getElementById('results-count');

    if (scanLimit && scanLimit > 1000) {
        if (!confirm('You are about to scan ' + scanLimit.toLocaleString() + ' courses. This may take a while. Continue?')) {
            return;
        }
    } else if (scanLimit === null) {
        if (!confirm('You are about to scan ALL courses in this semester. This may take a very long time. Continue?')) {
            return;
        }
    }

    runBtn.disabled = true;
    runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
    loadingIndicator.style.display = 'block';
    resultsContainer.style.display = 'none';
    emptyMessage.style.display = 'none';
    resultsCount.textContent = 'Starting scan...';

    try {
        loadingText.textContent = 'Loading courses...';
        let courses = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${semesterId}/children/`
        );
        if (!Array.isArray(courses)) courses = [];

        let courseOfferings = courses.filter(isCourseOffering);
        if (courseOfferings.length === 0) {
            loadingText.textContent = 'No offerings directly under this semester. Looking one level deeper...';
            const descendants = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${semesterId}/descendants/?ouTypeId=3`
            );
            courseOfferings = Array.isArray(descendants) ? descendants.filter(isCourseOffering) : [];
        }

        if (scanLimit !== null) {
            courseOfferings = courseOfferings.slice(0, scanLimit);
        }

        const totalCourses = courseOfferings.length;
        allResults = [];

        if (totalCourses === 0) {
            resultsCount.textContent = 'No course offerings found under this semester.';
            emptyMessage.style.display = 'block';
            emptyMessage.textContent = 'No course offerings were found under the selected semester.';
            return;
        }

        const batchSize = totalCourses > 1000 ? 10 : 5;
        for (let i = 0; i < courseOfferings.length; i += batchSize) {
            const batch = courseOfferings.slice(i, i + batchSize);
            const currentEnd = Math.min(i + batchSize, courseOfferings.length);
            loadingText.textContent = 'Scanning courses ' + (i + 1).toLocaleString() + '-' + currentEnd.toLocaleString() + ' of ' + totalCourses.toLocaleString() + '...';
            const progressPercent = Math.round((i / courseOfferings.length) * 100);
            resultsCount.textContent = 'Scanning... ' + progressPercent + '% (' + (i + 1).toLocaleString() + '/' + totalCourses.toLocaleString() + ')';

            const batchResults = await Promise.allSettled(batch.map(course => scanCourseLinks(course)));
            batchResults.forEach((result, idx) => {
                if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
                    allResults.push(...result.value);
                } else if (result.status === 'rejected') {
                    console.warn('Error scanning course ' + batch[idx].Identifier + ':', result.reason);
                }
            });
        }

        resultsCount.textContent = 'Scan complete: ' + allResults.length.toLocaleString() + ' broken/missing link(s) found in ' + totalCourses.toLocaleString() + ' course(s)';
        filterAndDisplayResults();
    } catch (error) {
        console.error('Error running scan:', error);
        alert('Error running scan: ' + error.message);
        loadingIndicator.style.display = 'none';
        emptyMessage.style.display = 'block';
        emptyMessage.textContent = 'Error running scan. Please try again.';
    } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = '<i class="fa-solid fa-play"></i> Run Link Scan';
        loadingIndicator.style.display = 'none';
    }
}

async function scanCourseLinks(course) {
    const orgUnitId = course.Identifier;
    const results = [];

    let tocData;
    try {
        tocData = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/content/toc`);
    } catch (error) {
        console.warn('Could not fetch TOC for course ' + orgUnitId + ':', error.message);
        return [];
    }

    if (!tocData || !tocData.Modules || !Array.isArray(tocData.Modules) || tocData.Modules.length === 0) {
        return [];
    }

    const scanModules = (modules) => {
        if (!Array.isArray(modules)) return;

        for (const module of modules) {
            const nextContext = {
                moduleTitle: module.Title || module.Name || module.DisplayName || module.Identifier || 'Untitled Module',
                moduleId: module.Identifier || module.ModuleId || '',
                moduleHidden: computeHiddenFlag(module)
            };

            if (module.Topics && Array.isArray(module.Topics)) {
                for (const topic of module.Topics) {
                    if (topic.IsBroken === true) {
                        results.push({
                            orgUnitId: orgUnitId,
                            code: course.Code || '',
                            name: course.Name || '',
                            moduleTitle: nextContext.moduleTitle,
                            moduleId: nextContext.moduleId,
                            topicHidden: computeHiddenFlag(topic),
                            moduleHidden: nextContext.moduleHidden,
                            linkType: getTopicTypeName(topic.ActivityType),
                            linkUrl: topic.Url || 'N/A',
                            topicId: topic.TopicId || topic.Identifier,
                            topicTitle: topic.Title || 'Untitled',
                            status: 'broken',
                            errorDetails: 'Activity for this topic cannot be found (IsBroken=true)'
                        });
                    } else if (topic.TopicType === 1 && (!topic.Url || !String(topic.Url).trim())) {
                        results.push({
                            orgUnitId: orgUnitId,
                            code: course.Code || '',
                            name: course.Name || '',
                            moduleTitle: nextContext.moduleTitle,
                            moduleId: nextContext.moduleId,
                            topicHidden: computeHiddenFlag(topic),
                            moduleHidden: nextContext.moduleHidden,
                            linkType: 'File Attachment',
                            linkUrl: topic.Url || 'Missing',
                            topicId: topic.TopicId || topic.Identifier,
                            topicTitle: topic.Title || 'Untitled',
                            status: 'missing_file',
                            errorDetails: 'File path is missing or empty'
                        });
                    }
                }
            }

            if (module.Modules && Array.isArray(module.Modules)) {
                scanModules(module.Modules);
            }
        }
    };

    scanModules(tocData.Modules);
    return results;
}

function getTopicTypeName(activityType) {
    const activityTypes = {
        1: 'File',
        2: 'Link',
        3: 'Dropbox',
        4: 'Quiz',
        5: 'Discussion Forum',
        6: 'Discussion Topic',
        7: 'LTI',
        9: 'Schedule',
        10: 'Checklist',
        11: 'Self Assessment',
        12: 'Survey',
        14: 'Course Link',
        20: 'SCORM 1.3',
        21: 'SCORM 1.3 Root',
        22: 'SCORM 1.2',
        23: 'SCORM 1.2 Root',
        24: 'SCORM',
        25: 'LOR',
        26: 'LOR SCORM',
        27: 'LTI Advantage',
        28: 'Org Unit',
        29: 'Activity Instance'
    };
    return activityTypes[activityType] || ('Activity Type ' + activityType);
}

function filterAndDisplayResults() {
    document.getElementById('results-count').textContent = allResults.length + ' broken/missing link(s) found';

    if (window.jQuery && $.fn.DataTable && $.fn.DataTable.isDataTable('#results-table')) {
        try {
            $('#results-table').DataTable().clear().destroy();
        } catch (e) {
            console.warn('DataTables destroy failed, continuing:', e);
        }
    }
    resultsTable = null;

    const resultsContainer = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');

    if (allResults.length === 0) {
        resultsContainer.style.display = 'none';
        emptyMessage.style.display = 'block';
        emptyMessage.textContent = 'No broken or missing links found in the courses that were scanned.';
        return;
    }

    resultsContainer.style.display = 'block';
    emptyMessage.style.display = 'none';

    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    allResults.forEach(result => {
        const row = tbody.insertRow();
        row.insertCell(0).textContent = result.orgUnitId;

        const codeCell = row.insertCell(1);
        const courseLink = document.createElement('a');
        courseLink.className = 'course-home-link';
        courseLink.href = '/d2l/home/' + encodeURIComponent(result.orgUnitId);
        courseLink.target = '_blank';
        courseLink.rel = 'noopener';
        courseLink.textContent = result.code || result.orgUnitId;
        codeCell.appendChild(courseLink);

        const topicTitleCell = row.insertCell(2);
        const topicLink = document.createElement('a');
        topicLink.href = '#';
        topicLink.className = 'topic-review-link';
        topicLink.textContent = result.topicTitle || 'N/A';
        topicLink.dataset.courseCode = result.code || '';
        topicLink.dataset.orgUnitId = result.orgUnitId || '';
        topicLink.dataset.topicId = result.topicId || '';
        topicLink.dataset.topicTitle = result.topicTitle || '';
        topicLink.dataset.moduleTitle = result.moduleTitle || '';
        topicLink.dataset.topicHidden = formatHiddenLabel(result.topicHidden);
        topicLink.dataset.moduleHidden = formatHiddenLabel(result.moduleHidden);
        topicLink.dataset.linkType = result.linkType || '';
        topicLink.dataset.linkUrl = result.linkUrl || 'N/A';
        topicLink.dataset.status = result.status || '';
        topicLink.dataset.errorDetails = result.errorDetails || '-';
        topicTitleCell.appendChild(topicLink);

        row.insertCell(3).textContent = result.linkType || 'N/A';
        row.insertCell(4).textContent = result.linkUrl || 'N/A';

        const statusCell = row.insertCell(5);
        const statusBadge = document.createElement('span');
        if (result.status === 'broken') {
            statusBadge.className = 'badge badge-danger';
            statusBadge.textContent = 'Broken';
        } else if (result.status === 'missing_file') {
            statusBadge.className = 'badge badge-danger';
            statusBadge.textContent = 'Missing File';
        } else if (result.status === 'needs_manual_check') {
            statusBadge.className = 'badge badge-warning';
            statusBadge.textContent = 'Needs Check';
        } else {
            statusBadge.className = 'badge badge-success';
            statusBadge.textContent = 'OK';
        }
        statusCell.appendChild(statusBadge);

        row.insertCell(6).textContent = result.errorDetails || '-';
    });

    if (window.jQuery && $.fn.DataTable) {
        resultsTable = $('#results-table').DataTable({
            pageLength: 25,
            order: [[1, 'asc']],
            columnDefs: [
                { targets: [0], visible: false },
                { targets: [5], orderable: false },
                { targets: [2, 4, 6], className: 'cell-wrap' }
            ],
            destroy: true,
            autoWidth: false,
            responsive: false
        });
    }
}

function handleDownloadCSV() {
    if (allResults.length === 0) {
        alert('No data to export. Please run a scan first.');
        return;
    }

    const headers = ['OrgUnitId', 'Course Code', 'Course Name', 'Module', 'Topic Title', 'Link Type', 'Link URL / File', 'Status', 'Error Details'];
    const rows = allResults.map(r => [
        r.orgUnitId,
        r.code,
        r.name || '',
        r.moduleTitle || '',
        r.topicTitle || '',
        r.linkType || '',
        r.linkUrl || '',
        r.status,
        r.errorDetails || ''
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'broken-links_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
