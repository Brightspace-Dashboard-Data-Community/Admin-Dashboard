/**
 * Faculty Profile Widget Audit by Semester
 * Audits course offerings to check if the Faculty Profile Widget has been filled in
 */

// ====================== Config & Globals ======================
const LP_VERSION = "1.49";
const DISPLAY_NAME_PLACEHOLDER = "Display Name";
const DEFAULT_HEADING_TEXT = "Heading";
const DEFAULT_ABOUT_HEADING = "About Me";
const DEFAULT_BIO_TEXT = "Please enter information about yourself here. You can include details such as office hours, contact information, etc.";
const PROFILE_WIDGET_FOLDER = "/custom_widgets/teacher_profile";
const IMAGE_FILE_RE = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
/**
 * Stable org widget ID for the Single Profile Widget (Homepage Widget Expansion Pack).
 * Paste from DevTools: find <d2l-single-profile context="..."> and copy "widgetId".
 * When set, every course can call widgetdata even if homepage HTML is a shell.
 * Also auto-filled during an audit run when any course HTML exposes the ID.
 */
const PROFILE_WIDGET_ID = "";
/**
 * When true, courses with no HTML signal still count as HasProfileWidget=Yes
 * (org shared/default homepage includes the widget on every course).
 */
const ASSUME_SHARED_HOMEPAGE = true;

/** Runtime cache: widgetId discovered from HTML during this audit run. */
let discoveredWidgetId = "";

let allResults = [];
let isRunning = false;
let shouldStop = false;

let statusEl, progressEl, logEl, resultTbody, semesterSelect, sectionFilterSelect, runBtn, stopBtn, downloadBtn, tableCard;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    statusEl = document.getElementById('status');
    progressEl = document.getElementById('progress');
    logEl = document.getElementById('log');
    resultTbody = document.querySelector('#resultTable tbody');
    semesterSelect = document.getElementById('semesterSelect');
    sectionFilterSelect = document.getElementById('sectionFilter');
    runBtn = document.getElementById('runBtn');
    stopBtn = document.getElementById('stopBtn');
    downloadBtn = document.getElementById('downloadBtn');
    tableCard = document.getElementById('tableCard');
    
    // Check if D2LApi is available
    if (typeof D2LApi === 'undefined') {
        setStatus('Error: D2LApi not loaded. Please refresh the page.');
        logMsg('ERROR: D2LApi is not defined. Make sure d2l-api.js is loaded before this script.');
        if (semesterSelect) {
            semesterSelect.innerHTML = '<option value="">Error: D2LApi not loaded</option>';
        }
        return;
    }
    
    attachEvents();
    loadSemesters().catch(function(err) {
        setStatus('Failed to load semesters. See log.');
        logMsg('ERROR loadSemesters: ' + (err.message || err));
        console.error('Error loading semesters:', err);
    });
});

// ====================== Utilities ======================
function logMsg(msg) {
    console.log('[FacultyProfileAudit] ' + msg);
    if (!logEl) return;
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent += '[' + timestamp + '] ' + msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(t) {
    if (!statusEl) return;
    statusEl.textContent = 'Status: ' + t;
}

function setProgress(current, total) {
    if (!progressEl) return;
    if (total > 0) {
        progressEl.textContent = 'Checked ' + current + ' of ' + total + ' courses';
    } else {
        progressEl.textContent = '';
    }
}

// ====================== BrightspaceFetch Helper ======================
/**
 * Fetch HTML content from a Brightspace page
 * @param {string} url - Page URL
 * @returns {Promise<string>} - HTML content as text
 */
async function fetchHTML(url) {
    const token = localStorage.getItem('XSRF.Token');
    const headers = {};
    
    if (token) {
        headers['X-CSRF-Token'] = token;
    }
    
    const res = await fetch(url, {
        headers: headers,
        credentials: 'include'
    });
    
    // Check for new XSRF token
    const newToken = res.headers.get('x-csrf-token');
    if (newToken && newToken !== token) {
        localStorage.setItem('XSRF.Token', newToken);
    }
    
    if (!res.ok) {
        throw new Error('HTTP error ' + res.status + ' - ' + url);
    }
    
    return await res.text();
}

/**
 * Fetch a URL and return status + body without throwing on 404/403.
 * @param {string} url
 * @returns {Promise<{ok: boolean, status: number, text: string, json: *}>}
 */
async function fetchOptional(url) {
    const token = localStorage.getItem('XSRF.Token');
    const headers = { 'Accept': 'application/json, text/plain, */*' };

    if (token) {
        headers['X-CSRF-Token'] = token;
    }

    const res = await fetch(url, {
        headers: headers,
        credentials: 'include'
    });

    const newToken = res.headers.get('x-csrf-token');
    if (newToken && newToken !== token) {
        localStorage.setItem('XSRF.Token', newToken);
    }

    const text = await res.text();
    let json = null;
    if (text && text.trim()) {
        try {
            json = JSON.parse(text);
        } catch (e) {
            json = null;
        }
    }

    return {
        ok: res.ok,
        status: res.status,
        text: text || '',
        json: json
    };
}

// ====================== Event Handlers ======================
function attachEvents() {
    if (runBtn) {
        runBtn.addEventListener('click', handleRunAudit);
    }
    if (stopBtn) {
        stopBtn.addEventListener('click', handleStop);
    }
    if (downloadBtn) {
        downloadBtn.addEventListener('click', handleDownloadCSV);
    }
}

async function handleRunAudit() {
    const semesterId = semesterSelect ? semesterSelect.value : '';
    if (!semesterId) {
        alert('Please select a semester first.');
        return;
    }
    
    if (isRunning) {
        alert('Audit is already running. Please wait or click Stop.');
        return;
    }
    
    // Reset state
    allResults = [];
    shouldStop = false;
    isRunning = true;
    discoveredWidgetId = PROFILE_WIDGET_ID || '';
    
    // Clear previous results
    if (resultTbody) {
        resultTbody.innerHTML = '';
    }
    if (tableCard) {
        tableCard.style.display = 'none';
    }
    
    // Update UI
    if (runBtn) runBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (downloadBtn) downloadBtn.disabled = true;
    
    setStatus('Running audit...');
    logMsg('Starting faculty profile audit for semester: ' + semesterId +
        ' (section filter: ' + getSectionFilterLabel() + ')');
    
    try {
        await runAudit(semesterId);
        setStatus('Audit complete.');
        logMsg('Audit completed successfully. Total courses checked: ' + allResults.length);
    } catch (error) {
        setStatus('Audit failed. See log for details.');
        logMsg('ERROR: ' + (error.message || error));
        console.error('Audit error:', error);
    } finally {
        isRunning = false;
        shouldStop = false;
        if (runBtn) runBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = false;
        setProgress(0, 0);
    }
}

function handleStop() {
    if (isRunning) {
        shouldStop = true;
        setStatus('Stopping audit...');
        logMsg('Stop requested by user.');
    }
}

function handleDownloadCSV() {
    if (!allResults || allResults.length === 0) {
        alert('No results to download. Please run an audit first.');
        return;
    }
    
    downloadCSV(allResults);
}

// ====================== API: Semesters & Courses ======================
/**
 * Load semesters from org structure
 */
async function loadSemesters() {
    setStatus('Loading semesters...');
    logMsg('Fetching semesters (ouTypeId=5)...');
    
    try {
        // Get root org unit ID
        const orgInfo = await D2LApi.getOrganizationInfo();
        if (!orgInfo || !orgInfo.Identifier) {
            throw new Error('Could not get organization info');
        }
        
        const rootOrgUnitId = orgInfo.Identifier;
        
        // Fetch semesters
        let data = [];
        if (typeof D2LApi.fetchPaginatedData === 'function') {
            data = await D2LApi.fetchPaginatedData(
                '/d2l/api/lp/' + LP_VERSION + '/orgstructure/' + rootOrgUnitId + '/descendants/?ouTypeId=5'
            );
        } else {
            const response = await D2LApi._fetch(
                '/d2l/api/lp/' + LP_VERSION + '/orgstructure/' + rootOrgUnitId + '/descendants/?ouTypeId=5&pageSize=100'
            );
            if (response.Objects && Array.isArray(response.Objects)) {
                data = response.Objects;
            } else if (Array.isArray(response)) {
                data = response;
            }
        }
        
        if (!semesterSelect) {
            logMsg('ERROR: semesterSelect element not found');
            return;
        }
        
        if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
            data = SemesterConfig.sortByRecency(SemesterConfig.filterAllowed(data || []));
        } else {
            data = (data || []).sort(function(a, b) {
                return String(b.Name || '').localeCompare(String(a.Name || ''));
            });
        }
        
        semesterSelect.innerHTML = '';
        
        if (!data.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No semesters available';
            semesterSelect.appendChild(opt);
            setStatus('No semesters available.');
            logMsg('Semester dropdown is empty (allowlist returned nothing).');
            return;
        }
        
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a semester…';
        semesterSelect.appendChild(placeholder);
        
        for (let i = 0; i < data.length; i++) {
            const ou = data[i];
            const o = document.createElement('option');
            o.value = ou.Identifier || ou.Id || ou.OrgUnitId || '';
            o.textContent = ou.Name || ('Semester ' + o.value);
            semesterSelect.appendChild(o);
        }
        
        setStatus('Semesters loaded.');
        logMsg('Loaded ' + data.length + ' semesters.');
    } catch (error) {
        console.error('Error loading semesters:', error);
        setStatus('Error loading semesters. See log.');
        logMsg('ERROR: ' + (error.message || String(error)));
        if (semesterSelect) {
            semesterSelect.innerHTML = '<option value="">Error loading semesters</option>';
        }
    }
}

/**
 * Load course offerings for a semester
 * @param {string} semesterId - Semester org unit ID
 * @returns {Promise<Array>} - Array of course offering objects
 */
async function loadCoursesForSemester(semesterId) {
    logMsg('Fetching course offerings for semester: ' + semesterId);
    
    const url = '/d2l/api/lp/' + LP_VERSION + '/orgstructure/' + semesterId + '/children/';
    
    let items = [];
    if (typeof D2LApi.fetchPaginatedData === 'function') {
        items = await D2LApi.fetchPaginatedData(url);
    } else {
        const response = await D2LApi._fetch(url);
        if (response.Objects && Array.isArray(response.Objects)) {
            items = response.Objects;
        } else if (Array.isArray(response)) {
            items = response;
        }
    }
    
    // Filter only course offerings (Type.Id = 3 OR Type.Code = "Course Offering")
    const courses = [];
    if (items && items.length) {
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const typ = it.Type || {};
            const typeId = (typeof typ.Id !== 'undefined' ? typ.Id : null);
            const typeCode = typ.Code || '';
            
            if (typeId === 3 || typeCode === 'Course Offering') {
                courses.push(it);
            }
        }
    }
    
    logMsg('Found ' + courses.length + ' course offerings.');
    return courses;
}

// ====================== Optional section filter (7xx / 8xx) ======================
/**
 * Delta section tokens are two letters + three digits in the course code or name,
 * e.g. FA810 in CST-133W-FA810-26/FA, or FA820/FA830 in a merged name.
 * 8xx is primarily online; 7xx is also used for some online / dual-enrollment sections.
 */
const SECTION_TOKEN_RE = /(?:^|[^A-Z0-9])[A-Z]{2}([78]\d{2})(?![0-9])/g;

const SECTION_FILTER_LABELS = {
    all: 'All courses',
    '8xx': '8xx only (online)',
    '7xx': '7xx only',
    '7xx8xx': '7xx and 8xx'
};

function getSectionFilterValue() {
    const value = sectionFilterSelect ? String(sectionFilterSelect.value || 'all').trim() : 'all';
    return SECTION_FILTER_LABELS[value] ? value : 'all';
}

function getSectionFilterLabel() {
    return SECTION_FILTER_LABELS[getSectionFilterValue()] || SECTION_FILTER_LABELS.all;
}

/**
 * Collect 7/8 hundreds-digit bands from a course code and name.
 * @param {Object} course
 * @returns {{'7': boolean, '8': boolean}}
 */
function getSectionBands(course) {
    const text = String((course && course.Code) || '') + ' ' + String((course && course.Name) || '');
    const up = text.toUpperCase();
    const bands = { '7': false, '8': false };
    const re = new RegExp(SECTION_TOKEN_RE.source, 'g');
    let m;
    while ((m = re.exec(up))) {
        const band = m[1].charAt(0);
        if (band === '7' || band === '8') bands[band] = true;
    }
    return bands;
}

function courseMatchesSectionFilter(course, filter) {
    if (!filter || filter === 'all') return true;
    const bands = getSectionBands(course);
    if (filter === '8xx') return bands['8'];
    if (filter === '7xx') return bands['7'];
    if (filter === '7xx8xx') return bands['7'] || bands['8'];
    return true;
}

function applySectionFilter(courses, filter) {
    if (!filter || filter === 'all') return courses || [];
    return (courses || []).filter(function (course) {
        return courseMatchesSectionFilter(course, filter);
    });
}

// ====================== Faculty Profile Parsing ======================
/**
 * Fetch course homepage HTML page
 * @param {string} orgUnitId - Course org unit ID
 * @returns {Promise<string>} - HTML content
 */
async function fetchHomepageHTML(orgUnitId) {
    const url = '/d2l/home/' + orgUnitId;
    return await fetchHTML(url);
}

function emptyProfileResult() {
    return {
        hasProfileWidget: false,
        hasName: false,
        hasImage: false,
        hasContent: false,
        displayName: '',
        error: null,
        context: null,
        detectionMethod: '',
        widgetIdUsed: '',
        contentChecked: false,
        contentSource: ''
    };
}

/**
 * Extract widget context from raw homepage HTML when the custom element
 * may not be queryable (shell markup, attribute encoding, etc.).
 * @param {string} htmlText
 * @returns {Object|null}
 */
function extractContextFromHtml(htmlText) {
    if (!htmlText) return null;
    const tagMatch = htmlText.match(/<d2l-single-profile\b[^>]*>/i);
    if (tagMatch) {
        const ctxAttr = tagMatch[0].match(/context\s*=\s*(["'])([\s\S]*?)\1/i);
        if (ctxAttr && ctxAttr[2]) {
            const decoded = ctxAttr[2]
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');
            return parseWidgetContext(decoded);
        }
    }
    const widgetIdMatch = htmlText.match(/"widgetId"\s*:\s*"([^"]+)"/);
    if (widgetIdMatch) {
        return parseWidgetContext(htmlText.slice(Math.max(0, widgetIdMatch.index - 200), widgetIdMatch.index + 800));
    }
    return null;
}

/**
 * Broader presence signals: custom element, title, path tokens, placeholders.
 * @param {string} htmlText
 * @param {Document} doc
 * @returns {{found: boolean, method: string, context: Object|null}}
 */
function detectProfileWidgetPresence(htmlText, doc) {
    const raw = String(htmlText || '');
    const lower = raw.toLowerCase();

    const widgetEl = doc ? doc.querySelector('d2l-single-profile') : null;
    if (widgetEl) {
        return {
            found: true,
            method: 'html_element',
            context: parseWidgetContext(widgetEl.getAttribute('context') || '')
        };
    }

    if (/d2l-single-profile/i.test(raw)) {
        return {
            found: true,
            method: 'html_element',
            context: extractContextFromHtml(raw)
        };
    }

    const headingEls = doc
        ? doc.querySelectorAll('h2.d2l-heading, h2.vui-heading-4, .d2l-widget-header h2, h2')
        : [];
    for (let i = 0; i < headingEls.length; i++) {
        const headingText = (headingEls[i].textContent || '').trim().toLowerCase();
        if (headingText === 'single profile widget' || headingText.indexOf('profile widget') >= 0) {
            return {
                found: true,
                method: 'html_title',
                context: extractContextFromHtml(raw)
            };
        }
    }

    if (lower.indexOf('single profile widget') >= 0) {
        return {
            found: true,
            method: 'html_title',
            context: extractContextFromHtml(raw)
        };
    }

    if (lower.indexOf('custom_widgets/teacher_profile') >= 0 ||
        lower.indexOf('/teacher_profile') >= 0 ||
        /["']teacher_profile["']/.test(lower)) {
        return {
            found: true,
            method: 'html_path',
            context: extractContextFromHtml(raw)
        };
    }

    // Placeholder markers unique to this widget (present but unconfigured).
    if (raw.indexOf(DISPLAY_NAME_PLACEHOLDER) >= 0 ||
        raw.indexOf(DEFAULT_BIO_TEXT) >= 0 ||
        lower.indexOf('please enter information about yourself') >= 0) {
        return {
            found: true,
            method: 'html_placeholder',
            context: extractContextFromHtml(raw)
        };
    }

    return { found: false, method: '', context: null };
}

function isPlaceholderName(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    const lower = text.toLowerCase();
    return text === DISPLAY_NAME_PLACEHOLDER ||
        lower === 'display name' ||
        lower === 'user name' ||
        lower === 'user profile';
}

function isPlaceholderHeading(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    const lower = text.toLowerCase();
    // "Heading" often remains even on filled widgets (see Lauren Collison example).
    return text === DEFAULT_HEADING_TEXT || lower === 'heading' || lower === 'user profile';
}

function isPlaceholderBio(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    const lower = text.toLowerCase();
    if (text === DEFAULT_BIO_TEXT) return true;
    if (lower.indexOf('please enter information about yourself') >= 0) return true;
    if (isPlaceholderAboutHeading(text)) return true;
    return false;
}

function isPlaceholderAboutHeading(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    return text === DEFAULT_ABOUT_HEADING || text.toLowerCase() === 'about me';
}

/**
 * Default silhouette / missing avatar vs a real upload (emoji, photo, data URI).
 * Empty widget uses a gray person silhouette (often d2l-icon / profile-default).
 */
function looksLikeImagePath(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    const lower = text.toLowerCase();
    if (lower.indexOf('profile-default') >= 0) return false;
    if (lower.indexOf('tier3:profile-default') >= 0) return false;
    if (lower.indexOf('no-image') >= 0 || lower.indexOf('noimage') >= 0) return false;
    if (lower.indexOf('avatar-default') >= 0 || lower.indexOf('default-avatar') >= 0) return false;
    if (lower.indexOf('silhouette') >= 0) return false;
    if (lower === 'null' || lower === 'undefined' || lower === 'none') return false;
    if (text.indexOf('data:image') === 0) return true;
    if (/^https?:\/\//i.test(text)) return true;
    if (text.charAt(0) === '/' && IMAGE_FILE_RE.test(text)) return true;
    return IMAGE_FILE_RE.test(text) || /\/img\//i.test(text) || /\/teacher_profile\//i.test(text);
}

function resolveWidgetId(context) {
    return (context && context.widgetId) ||
        discoveredWidgetId ||
        PROFILE_WIDGET_ID ||
        '';
}

function rememberWidgetId(widgetId) {
    if (!widgetId) return;
    const id = String(widgetId).trim();
    if (!id) return;
    if (!discoveredWidgetId) {
        discoveredWidgetId = id;
        logMsg('Cached Single Profile widgetId for this run: ' + id);
    }
}

function pickFirstString(obj, keys) {
    if (!obj || typeof obj !== 'object') return '';
    for (let i = 0; i < keys.length; i++) {
        const val = obj[keys[i]];
        if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return '';
}

/**
 * Unwrap Brightspace WidgetData: { Data: "<json string>" } or { Data: {...} }.
 */
function unwrapWidgetDataPayload(data) {
    if (!data || typeof data !== 'object') return null;
    let obj = data;

    function mergeDataLayer(current) {
        if (!current || typeof current !== 'object') return current;
        if (typeof current.Data === 'string' && current.Data.trim()) {
            try {
                const parsed = JSON.parse(current.Data);
                if (parsed && typeof parsed === 'object') {
                    return Object.assign({}, current, parsed);
                }
            } catch (e) {
                return current;
            }
        } else if (current.Data && typeof current.Data === 'object') {
            return Object.assign({}, current, current.Data);
        }
        return current;
    }

    obj = mergeDataLayer(obj);
    // Double-encoded Data is common.
    obj = mergeDataLayer(obj);

    const nestedKeys = ['profile', 'widget', 'settings', 'config', 'properties', 'data', 'value'];
    for (let i = 0; i < nestedKeys.length; i++) {
        const nested = obj[nestedKeys[i]];
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            obj = Object.assign({}, nested, obj);
        }
    }
    return obj;
}

/**
 * Walk an object for string values that look like profile fields.
 * Used when widgetdata keys don't match expected names.
 */
function deepCollectStrings(node, out, depth) {
    if (depth > 6 || node == null) return;
    if (typeof node === 'string') {
        const t = node.trim();
        if (t) out.push(t);
        return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) deepCollectStrings(node[i], out, depth + 1);
        return;
    }
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
        deepCollectStrings(node[keys[i]], out, depth + 1);
    }
}

function fieldsFromObject(data) {
    if (!data || typeof data !== 'object') return null;

    const obj = unwrapWidgetDataPayload(data) || data;

    let displayName = pickFirstString(obj, [
        'displayName', 'DisplayName', 'display_name', 'fullName', 'FullName',
        'userName', 'UserName', 'name', 'Name', 'titleName'
    ]);
    let bio = pickFirstString(obj, [
        'biography', 'Biography', 'bio', 'Bio', 'aboutMeText', 'aboutMe', 'AboutMe',
        'description', 'Description', 'officeHours', 'OfficeHours', 'body', 'Body', 'text', 'Text'
    ]);
    let image = pickFirstString(obj, [
        'image', 'imageUrl', 'imageSrc', 'img', 'photo', 'picture',
        'profileImage', 'profileImg', 'src', 'avatar', 'avatarUrl', 'imagePath', 'ImagePath'
    ]);
    const emailOrSocial = pickFirstString(obj, [
        'email', 'Email', 'mail', 'Mail', 'instagram', 'Instagram', 'linkedin', 'LinkedIn',
        'facebook', 'Facebook', 'twitter', 'Twitter', 'x', 'X', 'youtube', 'YouTube',
        'cellPhone', 'CellPhone', 'phone', 'Phone'
    ]);

    // Deep fallback: scan all strings for a real name / bio / image when keys are unknown.
    if (!displayName || isPlaceholderName(displayName) || !bio || isPlaceholderBio(bio) || !image) {
        const strings = [];
        deepCollectStrings(obj, strings, 0);
        for (let i = 0; i < strings.length; i++) {
            const s = strings[i];
            const lower = s.toLowerCase();
            if (!image && looksLikeImagePath(s)) {
                image = s;
            }
            if ((!displayName || isPlaceholderName(displayName)) &&
                !isPlaceholderName(s) &&
                !isPlaceholderHeading(s) &&
                !isPlaceholderAboutHeading(s) &&
                !isPlaceholderBio(s) &&
                !looksLikeImagePath(s) &&
                s.length >= 3 && s.length <= 80 &&
                lower.indexOf('http') !== 0 &&
                lower.indexOf('teacher_profile') < 0 &&
                lower.indexOf('single profile') < 0 &&
                /^[A-Za-z][A-Za-z0-9 .'\-]+$/.test(s) &&
                s.indexOf(' ') >= 0) {
                // Prefer multi-word person names (e.g. "Lauren Collison").
                displayName = s;
            }
            if ((!bio || isPlaceholderBio(bio)) &&
                !isPlaceholderBio(s) &&
                !isPlaceholderAboutHeading(s) &&
                !isPlaceholderName(s) &&
                !isPlaceholderHeading(s) &&
                !looksLikeImagePath(s) &&
                s.length >= 12 &&
                (lower.indexOf('office') >= 0 || lower.indexOf('phone') >= 0 ||
                    lower.indexOf('email') >= 0 || lower.indexOf('appointment') >= 0 ||
                    lower.indexOf('@') >= 0 || s.length >= 40)) {
                bio = s;
            }
        }
    }

    const ignoredNames = {
        teacher_profile: true,
        single_profile: true,
        'single profile widget': true,
        heading: true
    };
    const cleanName = displayName && ignoredNames[displayName.toLowerCase()] ? '' : displayName;
    const cleanBio = isPlaceholderAboutHeading(bio) ? '' : bio;
    const contentText = (!isPlaceholderBio(cleanBio) && cleanBio) || emailOrSocial || '';

    return {
        displayName: cleanName || '',
        bio: contentText,
        image: image || '',
        hasImage: looksLikeImagePath(image)
    };
}

/**
 * Classify against known empty defaults vs filled examples:
 * Empty: Display Name + silhouette + default "Please enter information..." bio
 * Filled: real name (e.g. Lauren Collison) + custom image + office hours/phone/email
 * Note: "Heading" alone is NOT treated as incomplete — filled widgets often keep it.
 */
function applyProfileFields(result, fields) {
    if (!fields) return result;

    if (fields.displayName) {
        result.displayName = fields.displayName;
        result.hasName = !isPlaceholderName(fields.displayName);
    }
    if (fields.bio) {
        result.hasContent = !isPlaceholderBio(fields.bio);
    } else if (fields.hasContent === true) {
        result.hasContent = true;
    }
    if (fields.image) {
        result.hasImage = looksLikeImagePath(fields.image);
    }
    if (fields.hasImage === true) {
        result.hasImage = true;
    }
    if (fields.contentChecked === true) {
        result.contentChecked = true;
    }
    if (fields.source) {
        result.contentSource = fields.source;
    }
    return result;
}

function parseWidgetContext(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let text = raw.trim();
    if (!text) return null;

    // The injected context can include JS expressions that are not valid JSON.
    text = text
        .replace(/window\.location\.origin/g, '""')
        .replace(/document\.documentElement\.lang/g, '""');

    let parsed = null;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        parsed = null;
    }

    const widgetIdMatch = text.match(/"widgetId"\s*:\s*"([^"]+)"/);
    const instanceIdMatch = text.match(/"id"\s*:\s*"([^"]+)"/);
    const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
    const pathMatch = text.match(/"path"\s*:\s*"([^"]+)"/);
    const orgUnitIdMatch = text.match(/"orgUnit"\s*:\s*\{[\s\S]*?"id"\s*:\s*"([^"]+)"/);

    return {
        widgetId: (parsed && parsed.widgetId) || (widgetIdMatch ? widgetIdMatch[1] : ''),
        instanceId: (parsed && parsed.id) || (instanceIdMatch ? instanceIdMatch[1] : ''),
        name: (parsed && parsed.name) || (nameMatch ? nameMatch[1] : ''),
        path: (parsed && parsed.orgUnit && parsed.orgUnit.path) || (pathMatch ? pathMatch[1] : ''),
        orgUnitId: (parsed && parsed.orgUnit && parsed.orgUnit.id) || (orgUnitIdMatch ? orgUnitIdMatch[1] : '')
    };
}

function interpretLegacyHtml(doc, result) {
    const profileNameElement = doc.querySelector('h3.d2l-profile-name, .d2l-profile-name');
    if (profileNameElement) {
        result.hasProfileWidget = true;
        const nameText = (profileNameElement.textContent || profileNameElement.innerText || '').trim();
        applyProfileFields(result, { displayName: nameText });
    }

    const profileImage = doc.querySelector('img.d2l-profile-image, img#profile-img');
    if (profileImage) {
        result.hasProfileWidget = true;
        const src = profileImage.getAttribute('src') || '';
        applyProfileFields(result, { image: src });
    }

    const profileIcon = doc.querySelector('d2l-icon.d2l-profile-image');
    if (profileIcon) {
        result.hasProfileWidget = true;
        result.hasImage = false;
    }

    const profileBio = doc.querySelector('pre.d2l-profile-bio, .d2l-profile-bio');
    if (profileBio) {
        result.hasProfileWidget = true;
        const bioText = (profileBio.textContent || profileBio.innerText || '').trim();
        applyProfileFields(result, { bio: bioText });
    }

    return result;
}

/**
 * Detect the Single Profile Widget on a homepage.
 * Presence uses multiple HTML signals; content loads later from widgetdata / Manage Files.
 * @param {string} htmlText
 * @returns {Object}
 */
function parseFacultyProfile(htmlText) {
    const result = emptyProfileResult();

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText || '', 'text/html');
        const detection = detectProfileWidgetPresence(htmlText, doc);

        if (detection.found) {
            result.hasProfileWidget = true;
            result.detectionMethod = detection.method;
            result.context = detection.context;
        } else {
            interpretLegacyHtml(doc, result);
            if (result.hasProfileWidget) {
                result.detectionMethod = 'html_legacy';
            }
        }

        if (!result.hasProfileWidget && ASSUME_SHARED_HOMEPAGE) {
            result.hasProfileWidget = true;
            result.detectionMethod = 'assumed_shared';
            result.context = extractContextFromHtml(htmlText);
        }

        if (!result.hasProfileWidget) {
            result.error = 'Profile widget not found on homepage';
            return result;
        }

        // Merge any legacy rendered markup still present on older homepages.
        interpretLegacyHtml(doc, result);
        result.hasProfileWidget = true;

        if (!result.context) {
            result.context = extractContextFromHtml(htmlText);
        }

        if (result.context && result.context.widgetId) {
            rememberWidgetId(result.context.widgetId);
        }

        const widgetId = resolveWidgetId(result.context);
        if (widgetId) {
            result.context = Object.assign({}, result.context || {}, { widgetId: widgetId });
        }
        result.widgetIdUsed = widgetId;
    } catch (error) {
        result.error = 'Parse error: ' + (error.message || error);
        console.error('Error parsing homepage HTML:', error);
    }

    return result;
}

function listResponseItems(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.Objects)) return payload.Objects;
    if (Array.isArray(payload.Items)) return payload.Items;
    return [];
}

function itemName(item) {
    return String((item && (item.Name || item.FileName || item.name)) || '');
}

function isFolderItem(item) {
    const type = item && item.FileSystemObjectType;
    return type === 1 || type === '1' || type === 'Folder';
}

function isFileItem(item) {
    const type = item && item.FileSystemObjectType;
    return type === 2 || type === '2' || type === 'File' || (!isFolderItem(item) && !!itemName(item));
}

async function listManageFiles(orgUnitId, path) {
    const url = '/d2l/api/lp/' + LP_VERSION + '/' + orgUnitId +
        '/managefiles/?path=' + encodeURIComponent(path);
    return await fetchOptional(url);
}

async function getManageFileText(orgUnitId, path) {
    const url = '/d2l/api/lp/' + LP_VERSION + '/' + orgUnitId +
        '/managefiles/file?path=' + encodeURIComponent(path);
    return await fetchOptional(url);
}

async function fetchWidgetData(orgUnitId, widgetId) {
    if (!widgetId) return null;
    const url = '/d2l/api/lp/' + LP_VERSION + '/' + orgUnitId + '/widgetdata/' + widgetId;
    return await fetchOptional(url);
}

function joinContentPath(basePath, relativePath) {
    const base = String(basePath || '').replace(/\/+$/, '');
    const rel = String(relativePath || '').replace(/^\/+/, '');
    if (!base) return '/' + rel;
    return base + '/' + rel;
}

/**
 * Load saved Single Profile Widget data from widgetdata (primary) + Manage Files (legacy).
 * Empty default (screenshot): no widgetdata / no files → Display Name + silhouette + default bio.
 * Filled example (Lauren Collison): real name + uploaded img under teacher_profile/img + bio/contact text.
 * @param {string} orgUnitId
 * @param {Object} context
 * @returns {Promise<Object>}
 */
async function loadSavedProfileData(orgUnitId, context) {
    const fields = {
        displayName: '',
        bio: '',
        image: '',
        hasImage: false,
        source: '',
        contentChecked: false
    };

    const instanceId = context && context.instanceId ? context.instanceId : '';
    let contentPath = context && context.path ? context.path : '';
    const widgetId = resolveWidgetId(context);

    // Primary: Org Unit Custom Widget Data API
    if (widgetId) {
        const widgetDataResp = await fetchWidgetData(orgUnitId, widgetId);
        if (widgetDataResp) {
            fields.contentChecked = true;
            if (widgetDataResp.ok && widgetDataResp.json) {
                const fromWidget = fieldsFromObject(widgetDataResp.json);
                if (fromWidget) {
                    if (fromWidget.displayName) fields.displayName = fromWidget.displayName;
                    if (fromWidget.bio) fields.bio = fromWidget.bio;
                    if (fromWidget.image) fields.image = fromWidget.image;
                    if (fromWidget.hasImage) fields.hasImage = true;
                    if (fromWidget.displayName || fromWidget.bio || fromWidget.image || fromWidget.hasImage) {
                        fields.source = 'widgetdata';
                    }
                }
                // 200 with empty/default payload still counts as checked (configured-or-default known).
                if (!fields.displayName && !fields.bio && !fields.image && !fields.hasImage) {
                    fields.displayName = DISPLAY_NAME_PLACEHOLDER;
                    fields.bio = DEFAULT_BIO_TEXT;
                    fields.source = fields.source || 'widgetdata_empty';
                }
            } else if (widgetDataResp.status === 404) {
                // No saved config → Brightspace shows the default empty template.
                fields.displayName = DISPLAY_NAME_PLACEHOLDER;
                fields.bio = DEFAULT_BIO_TEXT;
                fields.hasImage = false;
                fields.source = 'widgetdata_404';
            }
        }
    }

    // Legacy: Manage Files under custom_widgets/teacher_profile (config.txt, json, images)
    const folderResp = await listManageFiles(orgUnitId, PROFILE_WIDGET_FOLDER);

    // Always probe the img folder when parent exists OR when parent 404 (cheap confirm of empty).
    const foldersToScanForImages = [PROFILE_WIDGET_FOLDER + '/img'];
    const jsonToRead = [PROFILE_WIDGET_FOLDER + '/config.txt'];

    if (folderResp.status === 404) {
        // No legacy folder. If widgetdata already checked, we're done (empty defaults).
        // Still try img path once in case files exist without a listable parent (rare).
        const imgOnly = await listManageFiles(orgUnitId, PROFILE_WIDGET_FOLDER + '/img');
        if (imgOnly.ok) {
            fields.contentChecked = true;
            const imgItems = listResponseItems(imgOnly.json);
            for (let j = 0; j < imgItems.length; j++) {
                if (IMAGE_FILE_RE.test(itemName(imgItems[j]))) {
                    fields.hasImage = true;
                    fields.source = fields.source || 'managefiles_img';
                    break;
                }
            }
        } else if (!fields.contentChecked) {
            // No widgetId and no files → treat as default empty (shared homepage, never configured).
            fields.contentChecked = true;
            fields.displayName = fields.displayName || DISPLAY_NAME_PLACEHOLDER;
            fields.bio = fields.bio || DEFAULT_BIO_TEXT;
            fields.source = fields.source || 'no_saved_data';
        }
        return fields;
    }

    fields.contentChecked = true;

    if (folderResp.ok) {
        const items = listResponseItems(folderResp.json);
        for (let i = 0; i < items.length; i++) {
            const name = itemName(items[i]);
            if (!name) continue;
            const lower = name.toLowerCase();
            if (isFileItem(items[i]) && (lower.slice(-5) === '.json' || lower.slice(-4) === '.txt' || lower.slice(-5) === '.html')) {
                const path = PROFILE_WIDGET_FOLDER + '/' + name;
                if (jsonToRead.indexOf(path) < 0) {
                    jsonToRead.push(path);
                }
            }
            if (isFolderItem(items[i])) {
                if (lower === 'img' || lower === 'image' || lower === 'images') {
                    foldersToScanForImages.push(PROFILE_WIDGET_FOLDER + '/' + name);
                }
                if (instanceId && name === instanceId) {
                    foldersToScanForImages.push(PROFILE_WIDGET_FOLDER + '/' + name + '/img');
                    const nested = await listManageFiles(orgUnitId, PROFILE_WIDGET_FOLDER + '/' + name);
                    if (nested.ok) {
                        const nestedItems = listResponseItems(nested.json);
                        for (let j = 0; j < nestedItems.length; j++) {
                            const nestedName = itemName(nestedItems[j]);
                            const nestedLower = nestedName.toLowerCase();
                            if (isFileItem(nestedItems[j]) && (nestedLower.slice(-5) === '.json' || nestedLower.slice(-4) === '.txt')) {
                                jsonToRead.push(PROFILE_WIDGET_FOLDER + '/' + name + '/' + nestedName);
                            }
                            if (IMAGE_FILE_RE.test(nestedName)) {
                                fields.hasImage = true;
                            }
                        }
                    }
                }
            }
            if (IMAGE_FILE_RE.test(name)) {
                fields.hasImage = true;
            }
        }
    } else if (folderResp.status === 403) {
        const guesses = ['config.txt', 'data.json', 'profile.json', 'config.json'];
        if (instanceId) guesses.push(instanceId + '.json');
        for (let g = 0; g < guesses.length; g++) {
            const path = PROFILE_WIDGET_FOLDER + '/' + guesses[g];
            if (jsonToRead.indexOf(path) < 0) {
                jsonToRead.push(path);
            }
        }
    }

    for (let i = 0; i < jsonToRead.length; i++) {
        const fileResp = await getManageFileText(orgUnitId, jsonToRead[i]);
        let parsed = fileResp.json;
        if (!parsed && fileResp.ok && fileResp.text) {
            try {
                parsed = JSON.parse(fileResp.text);
            } catch (e) {
                parsed = null;
            }
        }
        if (parsed) {
            const fromFile = fieldsFromObject(parsed);
            if (fromFile) {
                if ((!fields.displayName || isPlaceholderName(fields.displayName)) && fromFile.displayName) {
                    fields.displayName = fromFile.displayName;
                    fields.source = fields.source || 'managefiles';
                }
                if ((!fields.bio || isPlaceholderBio(fields.bio)) && fromFile.bio) {
                    fields.bio = fromFile.bio;
                    fields.source = fields.source || 'managefiles';
                }
                if (!fields.image && fromFile.image) {
                    fields.image = fromFile.image;
                    fields.source = fields.source || 'managefiles';
                }
                if (fromFile.hasImage) fields.hasImage = true;
            }
        } else if (fileResp.ok && fileResp.text) {
            const text = fileResp.text;
            // Legacy config.txt may be JSON-like or contain field labels.
            const nameMatch = text.match(/"displayName"\s*:\s*"([^"]+)"/i) ||
                text.match(/Display Name["'\s:=]+([^\n\r"<]+)/i);
            const bioMatch = text.match(/"biography"\s*:\s*"([^"]+)"/i) ||
                text.match(/"bio"\s*:\s*"([^"]+)"/i);
            if (nameMatch && (!fields.displayName || isPlaceholderName(fields.displayName))) {
                fields.displayName = nameMatch[1].trim();
                fields.source = fields.source || 'managefiles';
            }
            if (bioMatch && (!fields.bio || isPlaceholderBio(fields.bio))) {
                fields.bio = bioMatch[1].trim();
                fields.source = fields.source || 'managefiles';
            }
            if (text.indexOf(DISPLAY_NAME_PLACEHOLDER) >= 0 && !fields.displayName) {
                fields.displayName = DISPLAY_NAME_PLACEHOLDER;
                fields.source = fields.source || 'managefiles';
            }
            if (text.indexOf(DEFAULT_BIO_TEXT) >= 0 && !fields.bio) {
                fields.bio = DEFAULT_BIO_TEXT;
                fields.source = fields.source || 'managefiles';
            }
            if (!fields.image) {
                const imgMatch = text.match(/"(?:image|imageUrl|imageSrc|src|photo)"\s*:\s*"([^"]+)"/i);
                if (imgMatch && looksLikeImagePath(imgMatch[1])) {
                    fields.image = imgMatch[1];
                    fields.hasImage = true;
                    fields.source = fields.source || 'managefiles';
                }
            }
        }
    }

    for (let i = 0; i < foldersToScanForImages.length; i++) {
        const imgResp = await listManageFiles(orgUnitId, foldersToScanForImages[i]);
        if (!imgResp.ok) continue;
        const imgItems = listResponseItems(imgResp.json);
        for (let j = 0; j < imgItems.length; j++) {
            if (IMAGE_FILE_RE.test(itemName(imgItems[j]))) {
                fields.hasImage = true;
                fields.source = fields.source || 'managefiles_img';
                break;
            }
        }
    }

    // Resolve course content path if missing (for direct content-file reads).
    if (!contentPath) {
        try {
            const courseResp = await fetchOptional('/d2l/api/lp/' + LP_VERSION + '/courses/' + orgUnitId);
            if (courseResp.ok && courseResp.json && courseResp.json.Path) {
                contentPath = courseResp.json.Path;
            }
        } catch (e) {
            // ignore
        }
    }

    if ((!fields.displayName || isPlaceholderName(fields.displayName)) &&
        (!fields.bio || isPlaceholderBio(fields.bio)) &&
        !fields.hasImage && contentPath) {
        const guesses = ['config.txt', 'data.json', 'profile.json', 'config.json'];
        if (instanceId) guesses.unshift(instanceId + '.json');
        for (let i = 0; i < guesses.length; i++) {
            const url = joinContentPath(contentPath, 'custom_widgets/teacher_profile/' + guesses[i]);
            const resp = await fetchOptional(url);
            if (resp.ok && (resp.json || resp.text)) {
                const fromFile = fieldsFromObject(resp.json || {});
                if (fromFile && (fromFile.displayName || fromFile.bio || fromFile.image)) {
                    if (fromFile.displayName) fields.displayName = fromFile.displayName;
                    if (fromFile.bio) fields.bio = fromFile.bio;
                    if (fromFile.image) fields.image = fromFile.image;
                    if (fromFile.hasImage) fields.hasImage = true;
                    fields.source = fields.source || 'contentpath';
                } else if (resp.text) {
                    try {
                        const parsed = JSON.parse(resp.text);
                        const fromText = fieldsFromObject(parsed);
                        if (fromText) {
                            if (fromText.displayName) fields.displayName = fromText.displayName;
                            if (fromText.bio) fields.bio = fromText.bio;
                            if (fromText.image) fields.image = fromText.image;
                            fields.source = fields.source || 'contentpath';
                        }
                    } catch (e2) {
                        // ignore
                    }
                }
            }
        }
    }

    return fields;
}

/**
 * Detect widget on the homepage, then load saved profile fields if needed.
 * @param {string} orgUnitId
 * @param {string} htmlText
 * @returns {Promise<Object>}
 */
async function auditFacultyProfile(orgUnitId, htmlText) {
    const parsed = parseFacultyProfile(htmlText);

    if (!parsed.hasProfileWidget) {
        return parsed;
    }

    const widgetId = resolveWidgetId(parsed.context);
    const context = Object.assign(
        { orgUnitId: orgUnitId },
        parsed.context || {},
        { widgetId: widgetId }
    );
    parsed.widgetIdUsed = widgetId;
    if (widgetId) rememberWidgetId(widgetId);

    const saved = await loadSavedProfileData(orgUnitId, context);
    applyProfileFields(parsed, saved);
    parsed.contentChecked = !!saved.contentChecked;
    parsed.contentSource = saved.source || '';

    // Normalize display for the empty template (screenshot 1).
    if (!parsed.displayName || isPlaceholderName(parsed.displayName)) {
        parsed.displayName = DISPLAY_NAME_PLACEHOLDER;
        parsed.hasName = false;
    }
    if (!parsed.hasContent && saved.bio && isPlaceholderBio(saved.bio)) {
        parsed.hasContent = false;
    }

    if (!parsed.contentChecked && !widgetId) {
        parsed.error = (parsed.error ? parsed.error + '; ' : '') +
            'Profile fields not fully verified — set PROFILE_WIDGET_ID from DevTools context.widgetId';
    }

    return parsed;
}

// ====================== Main Audit Logic ======================
/**
 * Run the faculty profile audit for a semester
 * @param {string} semesterId - Semester org unit ID
 */
async function runAudit(semesterId) {
    // Load courses
    const loadedCourses = await loadCoursesForSemester(semesterId);
    const sectionFilter = getSectionFilterValue();
    const courses = applySectionFilter(loadedCourses, sectionFilter);
    
    if (!loadedCourses || loadedCourses.length === 0) {
        logMsg('No course offerings found for this semester.');
        return;
    }

    if (sectionFilter !== 'all') {
        const skipped = loadedCourses.length - courses.length;
        logMsg(
            'Section filter “' + getSectionFilterLabel() + '”: ' +
            courses.length + ' of ' + loadedCourses.length + ' offerings matched' +
            (skipped ? ' (' + skipped + ' skipped)' : '') + '.'
        );
    }
    
    if (!courses.length) {
        logMsg('No course offerings matched the section filter. Try “All courses” or a different band.');
        setStatus('No courses matched the section filter.');
        return;
    }
    
    const totalCourses = courses.length;
    logMsg('Starting audit of ' + totalCourses + ' courses...');
    logMsg('Config: ASSUME_SHARED_HOMEPAGE=' + ASSUME_SHARED_HOMEPAGE +
        ', PROFILE_WIDGET_ID=' + (PROFILE_WIDGET_ID || '(not set — paste from DevTools for widgetdata)'));
    
    // Process each course sequentially
    for (let i = 0; i < courses.length; i++) {
        if (shouldStop) {
            logMsg('Audit stopped by user.');
            break;
        }
        
        const course = courses[i];
        const orgUnitId = course.Identifier || course.Id || course.OrgUnitId || '';
        const courseName = course.Name || '';
        const courseCode = course.Code || '';
        
        setProgress(i, totalCourses);
        logMsg('Checking course ' + (i + 1) + '/' + totalCourses + ': ' + courseCode + ' (' + orgUnitId + ')');
        
        let result = {
            OrgUnitId: orgUnitId,
            CourseName: courseName,
            CourseCode: courseCode,
            HasProfileWidget: 'No',
            HasName: 'No',
            HasImage: 'No',
            HasContent: 'No',
            DisplayName: '',
            DetectionMethod: '',
            WidgetId: '',
            HomepageURL: '/d2l/home/' + orgUnitId,
            Error: null
        };
        
        try {
            const html = await fetchHomepageHTML(orgUnitId);
            const parsed = await auditFacultyProfile(orgUnitId, html);
            
            result.HasProfileWidget = parsed.hasProfileWidget ? 'Yes' : 'No';
            result.HasName = parsed.hasName ? 'Yes' : 'No';
            result.HasImage = parsed.hasImage ? 'Yes' : 'No';
            result.HasContent = parsed.hasContent ? 'Yes' : 'No';
            result.DisplayName = parsed.displayName || '';
            result.DetectionMethod = parsed.detectionMethod || '';
            result.WidgetId = parsed.widgetIdUsed || '';
            
            if (parsed.hasProfileWidget) {
                logMsg('  Widget found (' + (parsed.detectionMethod || 'unknown') +
                    '). widgetId=' + (parsed.widgetIdUsed || 'none') +
                    ', source=' + (parsed.contentSource || 'n/a') +
                    ', Name=' + (parsed.hasName ? parsed.displayName : 'Display Name (default)') +
                    ', Image=' + (parsed.hasImage ? 'Yes' : 'No (silhouette)') +
                    ', Content=' + (parsed.hasContent ? 'Yes' : 'No (placeholder)'));
            }
            
            if (parsed.error) {
                result.Error = parsed.error;
                logMsg('  Warning: ' + parsed.error);
            }
            
        } catch (error) {
            const errorMsg = error.message || String(error);
            result.Error = errorMsg;
            result.HasProfileWidget = 'ERROR';
            logMsg('  ERROR: ' + errorMsg);
        }
        
        // Add result
        allResults.push(result);
        
        // Render results table incrementally
        renderResultsTable([result]);
        
        // Small delay to avoid rate limiting
        await new Promise(function(resolve) {
            setTimeout(resolve, 150);
        });
    }
    
    setProgress(totalCourses, totalCourses);
    logMsg('Audit complete. Processed ' + allResults.length + ' courses.');
}

// ====================== Results Display ======================
/**
 * Render results in the table
 * @param {Array} results - Array of result objects to add
 */
function renderResultsTable(results) {
    if (!resultTbody) return;
    
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const row = document.createElement('tr');
        
        // Add error class if there's an error
        if (result.Error) {
            row.className = 'error-row';
        }
        
        // Add warning class if widget exists but missing name, image, or content
        if (result.HasProfileWidget === 'Yes' && 
            (result.HasName === 'No' || result.HasImage === 'No' || result.HasContent === 'No')) {
            row.className = 'warning-row';
        }
        
        // Build cells
        const cells = [
            result.OrgUnitId || '',
            result.CourseName || '',
            result.CourseCode || '',
            result.HasProfileWidget || 'No',
            result.HasName || 'No',
            result.HasImage || 'No',
            result.HasContent || 'No',
            result.DisplayName || '',
            result.DetectionMethod || '',
            '<a href="' + (result.HomepageURL || '') + '" target="_blank" class="homepage-link">View Homepage</a>'
        ];
        
        for (let j = 0; j < cells.length; j++) {
            const cell = document.createElement('td');
            cell.innerHTML = cells[j];
            row.appendChild(cell);
        }
        
        resultTbody.appendChild(row);
    }
    
    // Show table if hidden
    if (tableCard) {
        tableCard.style.display = 'block';
    }
}

// ====================== CSV Download ======================
/**
 * Download results as CSV
 * @param {Array} results - Array of result objects
 */
function downloadCSV(results) {
    if (!results || results.length === 0) {
        alert('No results to download.');
        return;
    }
    
    // CSV headers
    const headers = [
        'OrgUnitId',
        'CourseName',
        'CourseCode',
        'HasProfileWidget',
        'HasName',
        'HasImage',
        'HasContent',
        'DisplayName',
        'DetectionMethod',
        'WidgetId',
        'HomepageURL',
        'Error'
    ];
    
    // Build CSV content
    let csvContent = headers.join(',') + '\n';
    
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const row = [
            escapeCSV(r.OrgUnitId || ''),
            escapeCSV(r.CourseName || ''),
            escapeCSV(r.CourseCode || ''),
            escapeCSV(r.HasProfileWidget || 'No'),
            escapeCSV(r.HasName || 'No'),
            escapeCSV(r.HasImage || 'No'),
            escapeCSV(r.HasContent || 'No'),
            escapeCSV(r.DisplayName || ''),
            escapeCSV(r.DetectionMethod || ''),
            escapeCSV(r.WidgetId || ''),
            escapeCSV(r.HomepageURL || ''),
            escapeCSV(r.Error || '')
        ];
        csvContent += row.join(',') + '\n';
    }
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    // Generate filename with timestamp
    const now = new Date();
    const timestamp = now.getFullYear() + 
        ('0' + (now.getMonth() + 1)).slice(-2) + 
        ('0' + now.getDate()).slice(-2) + '_' +
        ('0' + now.getHours()).slice(-2) +
        ('0' + now.getMinutes()).slice(-2) +
        ('0' + now.getSeconds()).slice(-2);
    const filename = 'faculty-profile-audit_' + timestamp + '.csv';
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    logMsg('CSV downloaded: ' + filename);
}

/**
 * Escape CSV field value
 * @param {string} value - Value to escape
 * @returns {string} - Escaped value
 */
function escapeCSV(value) {
    if (value === null || value === undefined) {
        return '';
    }
    
    const str = String(value);
    
    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\n') >= 0) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    
    return str;
}
