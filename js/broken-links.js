/**
 * Broken / Missing Links Page
 * Scans courses for broken external links and missing file attachments
 * Note: This is a stretch goal implementation with placeholder functionality
 */

const LP_VERSION = "1.49";
let resultsTable = null;
let allResults = [];

function computeHiddenFlag(entity) {
    // D2L/LE topic/module visibility properties vary by API version.
    // We try common boolean/string patterns and return null when indeterminate.
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

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📊 Initializing Broken Links page...');

    // Set up event handlers
    document.getElementById('run-scan-btn').addEventListener('click', handleRunScan);
    document.getElementById('download-csv-btn').addEventListener('click', handleDownloadCSV);

    // Load semesters
    await loadSemesters();

    // Setup topic review modal
    setupTopicReviewModal();
});

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

    // Event delegation: rows are recreated by DataTables
    const table = document.getElementById('results-table');
    if (!table) return;

    table.addEventListener('click', (e) => {
        const target = e.target.closest('.topic-review-link');
        if (!target) return;

        e.preventDefault();

        const getText = (id) => document.getElementById(id);
        const setValue = (id, value) => {
            const el = getText(id);
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

        setOpen(true);
    });
}

/**
 * Load semesters dropdown
 */
async function loadSemesters() {
    try {
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) {
            throw new Error('Could not get organization info');
        }
        
        const rootOrgUnitId = orgInfo.Identifier;
        const select = document.getElementById('semester-select');
        
        select.innerHTML = '<option value="">Loading semesters...</option>';
        
        let semesters = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            semesters = await D2LApi.fetchPaginatedData(
                `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
            );
        } else {
            const response = await D2LApi._fetch(
                `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                semesters = response.Objects;
            } else if (Array.isArray(response)) {
                semesters = response;
            }
        }
        
        if (!Array.isArray(semesters) || semesters.length === 0) {
            throw new Error('No semesters found');
        }
        
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            semesters = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(semesters));
        } else {
            semesters.sort((a, b) => {
                const nameA = (a.Name || '').toLowerCase();
                const nameB = (b.Name || '').toLowerCase();
                return nameB.localeCompare(nameA);
            });
        }
        
        select.innerHTML = '<option value="">Select Semester...</option>';
        semesters.forEach(semester => {
            const option = document.createElement('option');
            option.value = semester.Identifier;
            option.textContent = semester.Name;
            select.appendChild(option);
        });
        
        console.log(`✅ Loaded ${semesters.length} semesters`);
    } catch (error) {
        console.error('❌ Error loading semesters:', error);
        const select = document.getElementById('semester-select');
        if (select) {
            select.innerHTML = '<option value="">Error loading semesters</option>';
        }
    }
}

/**
 * Handle Run Scan button click
 */
async function handleRunScan() {
    const semesterId = document.getElementById('semester-select').value;
    if (!semesterId) {
        alert('Please select a semester.');
        return;
    }

    const scanLimitValue = document.getElementById('scan-limit').value;
    const scanLimit = scanLimitValue === '0' ? null : parseInt(scanLimitValue) || 100;
    const runBtn = document.getElementById('run-scan-btn');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text');
    const resultsContainer = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');
    const resultsCount = document.getElementById('results-count');

    // Warn user if scanning a large number of courses
    if (scanLimit && scanLimit > 1000) {
        if (!confirm(`You are about to scan ${scanLimit.toLocaleString()} courses. This may take a while. Continue?`)) {
            return;
        }
    } else if (scanLimit === null) {
        if (!confirm('You are about to scan ALL courses in this semester. This may take a very long time. Continue?')) {
            return;
        }
    }

    // Show loading
    runBtn.disabled = true;
    runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
    loadingIndicator.style.display = 'block';
    resultsContainer.style.display = 'none';
    emptyMessage.style.display = 'none';
    resultsCount.textContent = 'Starting scan...';

    try {
        loadingText.textContent = 'Loading courses...';
        const courses = await D2LApi.fetchPaginatedData(
            `/d2l/api/lp/${D2LApi.apiVersion}/orgstructure/${semesterId}/children/`
        );

        // Filter to Course Offerings only
        let courseOfferings = courses.filter(c => c.Type?.Code === 'Course Offering');
        
        // Apply limit if specified (null means scan all)
        if (scanLimit !== null) {
            courseOfferings = courseOfferings.slice(0, scanLimit);
        }
        
        const totalCourses = courseOfferings.length;
        console.log(`📚 Will scan ${totalCourses.toLocaleString()} course(s)`);

        console.log(`📚 Scanning ${totalCourses.toLocaleString()} courses for broken links`);
        allResults = [];

        // Process courses in batches
        // Use larger batches for better performance, but keep reasonable size
        const batchSize = totalCourses > 1000 ? 10 : 5;
        for (let i = 0; i < courseOfferings.length; i += batchSize) {
            const batch = courseOfferings.slice(i, i + batchSize);
            const currentEnd = Math.min(i + batchSize, courseOfferings.length);
            loadingText.textContent = `Scanning courses ${(i + 1).toLocaleString()}-${currentEnd.toLocaleString()} of ${totalCourses.toLocaleString()}...`;
            
            // Update progress percentage
            const progressPercent = Math.round((i / courseOfferings.length) * 100);
            resultsCount.textContent = `Scanning... ${progressPercent}% (${(i + 1).toLocaleString()}/${totalCourses.toLocaleString()})`;

            const batchResults = await Promise.allSettled(
                batch.map(course => scanCourseLinks(course))
            );

            batchResults.forEach((result, idx) => {
                if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
                    allResults.push(...result.value);
                } else if (result.status === 'rejected') {
                    console.warn(`⚠️ Error scanning course ${batch[idx].Identifier}:`, result.reason);
                }
            });
        }

        console.log(`✅ Scan complete. Found ${allResults.length.toLocaleString()} broken/missing links`);
        resultsCount.textContent = `Scan complete: ${allResults.length.toLocaleString()} broken/missing link(s) found`;
        filterAndDisplayResults();

    } catch (error) {
        console.error('❌ Error running scan:', error);
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

/**
 * Scan a single course for broken links
 * Uses D2L API's IsBroken property and content structure
 */
async function scanCourseLinks(course) {
    const orgUnitId = course.Identifier;
    const results = [];

    try {
        console.log(`🔍 Scanning course ${orgUnitId} for broken links...`);

        // Use Table of Contents endpoint which includes IsBroken property
        // This endpoint provides a cleaner structure than content/root
        const tocUrl = `/d2l/api/le/${LP_VERSION}/${orgUnitId}/content/toc`;
        
        let tocData;
        try {
            tocData = await D2LApi._fetch(tocUrl);
        } catch (error) {
            console.warn(`⚠️ Could not fetch TOC for course ${orgUnitId}:`, error.message);
            return [];
        }

        // Check if course has content
        if (!tocData || !tocData.Modules || !Array.isArray(tocData.Modules) || tocData.Modules.length === 0) {
            console.log(`📋 Course ${orgUnitId} has no content modules`);
            return [];
        }

        // Recursively scan modules and topics
        const scanModules = (modules, moduleContext = null) => {
            if (!Array.isArray(modules)) return;

            for (const module of modules) {
                const thisModuleTitle =
                    module.Title || module.Name || module.DisplayName || module.Identifier || 'Untitled Module';
                const thisModuleId = module.Identifier || module.ModuleId || '';
                const thisModuleHidden = computeHiddenFlag(module);
                const nextContext = {
                    moduleTitle: thisModuleTitle,
                    moduleId: thisModuleId,
                    moduleHidden: thisModuleHidden
                };

                // Scan topics in this module
                if (module.Topics && Array.isArray(module.Topics)) {
                    for (const topic of module.Topics) {
                        // Check IsBroken property (available in LE API 1.72+)
                        if (topic.IsBroken === true) {
                            results.push({
                                orgUnitId: orgUnitId,
                                code: course.Code || '',
                                name: course.Name || '',
                                moduleTitle: nextContext.moduleTitle,
                                moduleId: nextContext.moduleId,
                                topicHidden: computeHiddenFlag(topic),
                                moduleHidden: nextContext.moduleHidden,
                                linkType: getTopicTypeName(topic.ActivityType, topic.TopicId),
                                linkUrl: topic.Url || 'N/A',
                                topicId: topic.TopicId || topic.Identifier,
                                topicTitle: topic.Title || 'Untitled',
                                status: 'broken',
                                errorDetails: 'Activity for this topic cannot be found (IsBroken=true)'
                            });
                        } else if (topic.TopicType === 1) {
                            // File-type topic (TopicType 1)
                            // Check if URL/path exists (basic validation)
                            if (!topic.Url || !topic.Url.trim()) {
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
                }

                // Recursively scan child modules
                if (module.Modules && Array.isArray(module.Modules)) {
                    scanModules(module.Modules, nextContext);
                }
            }
        };

        scanModules(tocData.Modules, null);

        console.log(`✅ Course ${orgUnitId}: Found ${results.length} broken/missing links`);
        return results;

    } catch (error) {
        console.warn(`⚠️ Error scanning course ${orgUnitId}:`, error);
        return [];
    }
}

/**
 * Get human-readable topic type name
 */
function getTopicTypeName(activityType, topicId) {
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
    
    return activityTypes[activityType] || `Activity Type ${activityType}`;
}

/**
 * Filter and display results
 */
function filterAndDisplayResults() {
    // Update count
    document.getElementById('results-count').textContent = `${allResults.length} broken/missing link(s) found`;

    // Destroy existing DataTable (must happen before touching tbody)
    if (window.jQuery && $.fn.DataTable && $.fn.DataTable.isDataTable('#results-table')) {
        try {
            $('#results-table').DataTable().clear().destroy(true);
        } catch (e) {
            console.warn('⚠️ DataTables destroy failed, continuing:', e);
        }
    }
    resultsTable = null;

    // Show results
    const resultsContainer = document.getElementById('results-container');
    const emptyMessage = document.getElementById('empty-message');
    
    if (allResults.length === 0) {
        resultsContainer.style.display = 'none';
        emptyMessage.style.display = 'block';
        emptyMessage.textContent = 'No broken or missing links found. This may mean the scan has not been fully implemented yet, or all links are valid.';
        return;
    }

    resultsContainer.style.display = 'block';
    emptyMessage.style.display = 'none';

    // Populate table
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';

    allResults.forEach(result => {
        const row = tbody.insertRow();
        row.insertCell(0).textContent = result.orgUnitId;
        row.insertCell(1).textContent = result.code;

        // Topic title as clickable review link
        const topicTitleCell = row.insertCell(2);
        const topicLink = document.createElement('a');
        topicLink.href = '#';
        topicLink.className = 'topic-review-link';
        topicLink.textContent = result.topicTitle || 'N/A';
        topicLink.dataset.courseCode = result.code || '';
        topicLink.dataset.orgUnitId = result.orgUnitId || '';
        topicLink.dataset.topicId = result.topicId || result.topicIdentifier || '';
        topicLink.dataset.topicTitle = result.topicTitle || '';
        topicLink.dataset.moduleTitle = result.moduleTitle || '';
        topicLink.dataset.topicHidden = formatHiddenLabel(result.topicHidden);
        topicLink.dataset.moduleHidden = formatHiddenLabel(result.moduleHidden);
        topicLink.dataset.linkType = result.linkType || '';
        topicLink.dataset.linkUrl = result.linkUrl || result.fileName || 'N/A';
        topicLink.dataset.status = result.status || '';
        topicLink.dataset.errorDetails = result.errorDetails || '-';
        topicTitleCell.appendChild(topicLink);

        row.insertCell(3).textContent = result.linkType || 'N/A';
        row.insertCell(4).textContent = result.linkUrl || result.fileName || 'N/A';
        
        // Status with badge
        const statusCell = row.insertCell(5);
        const statusBadge = document.createElement('span');
        if (result.status === 'broken') {
            statusBadge.className = 'badge badge-danger';
            statusBadge.textContent = 'Broken';
        } else if (result.status === 'needs_manual_check') {
            statusBadge.className = 'badge badge-warning';
            statusBadge.textContent = 'Needs Check';
        } else if (result.status === 'missing_file') {
            statusBadge.className = 'badge badge-danger';
            statusBadge.textContent = 'Missing File';
        } else {
            statusBadge.className = 'badge badge-success';
            statusBadge.textContent = 'OK';
        }
        statusCell.appendChild(statusBadge);
        
        row.insertCell(6).textContent = result.errorDetails || '-';
    });

    // Initialize DataTable
    if (window.jQuery && $.fn.DataTable) {
        resultsTable = $('#results-table').DataTable({
            pageLength: 25,
            order: [[1, 'asc']], // Sort by Course Code
            columnDefs: [
                { targets: [0], visible: false }, // Hide OrgUnitId by default
                { targets: [5], orderable: false }, // Make Status column non-sortable (contains HTML badge)
                { targets: [2, 4, 6], className: 'cell-wrap' } // Long text columns
            ],
            destroy: true,
            autoWidth: false,
            responsive: false
        });
    }
}

/**
 * Handle Download CSV button click
 */
function handleDownloadCSV() {
    if (allResults.length === 0) {
        alert('No data to export. Please run a scan first.');
        return;
    }

    // Create CSV
    const headers = ['OrgUnitId', 'Course Code', 'Topic Title', 'Link Type', 'Link URL / File', 'Status', 'Error Details'];
    const rows = allResults.map(r => [
        r.orgUnitId,
        r.code,
        r.topicTitle || '',
        r.linkType || '',
        r.linkUrl || r.fileName || '',
        r.status,
        r.errorDetails || ''
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `broken-links_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
