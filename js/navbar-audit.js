/**
 * Navigation Bar Audit by Semester
 * Audits course offerings to identify which navigation bar is active (-- Default -- or other)
 */

// ====================== Config & Globals ======================
const LP_VERSION = "1.49";
const DEFAULT_NAVBAR_TEXT = "-- Default --";

let allResults = [];
let isRunning = false;
let shouldStop = false;

let statusEl, progressEl, logEl, resultTbody, semesterSelect, runBtn, stopBtn, downloadBtn, tableCard;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    statusEl = document.getElementById('status');
    progressEl = document.getElementById('progress');
    logEl = document.getElementById('log');
    resultTbody = document.querySelector('#resultTable tbody');
    semesterSelect = document.getElementById('semesterSelect');
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
    if (!logEl) return;
    const timestamp = new Date().toLocaleTimeString();
    logEl.textContent += '[' + timestamp + '] ' + msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[NavbarAudit] ' + msg);
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
    logMsg('Starting navbar audit for semester: ' + semesterId);
    
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

// ====================== Navbar Parsing ======================
/**
 * Fetch navbar settings HTML page for a course
 * @param {string} orgUnitId - Course org unit ID
 * @returns {Promise<string>} - HTML content
 */
async function fetchNavbarSettingsHTML(orgUnitId) {
    const url = '/d2l/lp/navbars/' + orgUnitId + '/list';
    return await fetchHTML(url);
}

/**
 * Parse navbar settings HTML to extract active navbar information
 * @param {string} htmlText - HTML content from navbar settings page
 * @returns {Object} - Parsed navbar information
 */
function parseNavbarSettings(htmlText) {
    const result = {
        activeNavbarText: '',
        isDefaultNavbar: false,
        error: null
    };
    
    try {
        // Parse HTML using DOMParser
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        
        // Strategy 1: Look for navbar marked as "Active" with checkmark
        // Find all list items, table rows, or divs that might contain navbar entries
        const allElements = doc.querySelectorAll('li, tr, div[class*="navbar"], div[class*="list"]');
        let foundActive = false;
        
        for (let i = 0; i < allElements.length; i++) {
            const elem = allElements[i];
            const text = elem.textContent || elem.innerText || '';
            
            // Check if this element contains "Active" text (case-insensitive)
            if (text.toLowerCase().indexOf('active') >= 0) {
                // Look for checkmark icon or symbol
                const hasCheckmark = elem.querySelector('i.fa-check, i.fa-check-circle, i[class*="check"], .fa-check, .fa-check-circle, [class*="check"], svg[class*="check"]') ||
                                     text.indexOf('✓') >= 0 || text.indexOf('✔') >= 0;
                
                if (hasCheckmark) {
                    // Try to find the navbar name - it's usually the main text before "Active"
                    // Look for text nodes or spans that might contain the name
                    const nameElements = elem.querySelectorAll('span, div, a, strong, b');
                    let navbarName = '';
                    
                    // First, try to find text that looks like a navbar name
                    for (let j = 0; j < nameElements.length; j++) {
                        const nameElem = nameElements[j];
                        const nameText = (nameElem.textContent || nameElem.innerText || '').trim();
                        
                        // Skip if it's "Active", "Shared from", or other metadata
                        if (nameText && 
                            nameText.toLowerCase().indexOf('active') < 0 &&
                            nameText.toLowerCase().indexOf('shared from') < 0 &&
                            nameText.toLowerCase().indexOf('default') < 0 &&
                            nameText.length > 2 &&
                            nameText.length < 100) {
                            navbarName = nameText;
                            break;
                        }
                    }
                    
                    // If no name found in child elements, extract from full text
                    if (!navbarName) {
                        // Remove "Active", checkmarks, and other metadata
                        const cleaned = text.replace(/Active/gi, '')
                                           .replace(/✓|✔/g, '')
                                           .replace(/Shared from.*/gi, '')
                                           .replace(/Default/gi, '')
                                           .trim();
                        
                        // Split by common separators and take the first meaningful part
                        const parts = cleaned.split(/\s+/);
                        if (parts.length > 0 && parts[0].length > 0) {
                            navbarName = parts[0];
                        }
                    }
                    
                    if (navbarName && navbarName.length > 0) {
                        result.activeNavbarText = navbarName;
                        foundActive = true;
                        
                        // Check if it's default
                        if (navbarName.trim() === DEFAULT_NAVBAR_TEXT) {
                            result.isDefaultNavbar = true;
                        }
                        break;
                    }
                }
            }
        }
        
        // Strategy 2: If not found, look for the "Active Navbar" dropdown
        if (!foundActive) {
            const selects = doc.querySelectorAll('select');
            
            for (let i = 0; i < selects.length; i++) {
                const select = selects[i];
                const label = select.previousElementSibling || select.parentElement;
                const labelText = label ? (label.textContent || label.innerText || '') : '';
                
                // Check if this select is related to "Active Navbar"
                if (labelText.toLowerCase().indexOf('active') >= 0 && 
                    labelText.toLowerCase().indexOf('navbar') >= 0) {
                    
                    const options = select.querySelectorAll('option');
                    
                    for (let j = 0; j < options.length; j++) {
                        const option = options[j];
                        if (option.selected || option.getAttribute('selected') !== null) {
                            const optionText = (option.textContent || option.innerText || '').trim();
                            result.activeNavbarText = optionText;
                            foundActive = true;
                            
                            if (optionText === DEFAULT_NAVBAR_TEXT) {
                                result.isDefaultNavbar = true;
                            }
                            break;
                        }
                    }
                    
                    if (foundActive) break;
                }
            }
        }
        
        // Strategy 3: Look for any select with "-- Default --" as selected
        if (!foundActive) {
            const selects = doc.querySelectorAll('select');
            
            for (let i = 0; i < selects.length; i++) {
                const select = selects[i];
                const options = select.querySelectorAll('option');
                
                for (let j = 0; j < options.length; j++) {
                    const option = options[j];
                    if (option.selected || option.getAttribute('selected') !== null) {
                        const optionText = (option.textContent || option.innerText || '').trim();
                        
                        // If we find a selected option, use it
                        if (optionText && optionText.length > 0) {
                            result.activeNavbarText = optionText;
                            foundActive = true;
                            
                            if (optionText === DEFAULT_NAVBAR_TEXT) {
                                result.isDefaultNavbar = true;
                            }
                            break;
                        }
                    }
                }
                
                if (foundActive) break;
            }
        }
        
        // If still not found, mark as error
        if (!foundActive) {
            result.error = 'Could not find active navbar selection';
        }
        
    } catch (error) {
        result.error = 'Parse error: ' + (error.message || error);
        console.error('Error parsing navbar HTML:', error);
    }
    
    return result;
}

// ====================== Main Audit Logic ======================
/**
 * Run the navbar audit for a semester
 * @param {string} semesterId - Semester org unit ID
 */
async function runAudit(semesterId) {
    // Load courses
    const courses = await loadCoursesForSemester(semesterId);
    
    if (!courses || courses.length === 0) {
        logMsg('No course offerings found for this semester.');
        return;
    }
    
    const totalCourses = courses.length;
    logMsg('Starting audit of ' + totalCourses + ' courses...');
    
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
            ActiveNavbarText: '',
            IsDefaultNavbar: 'No',
            NavbarSettingsURL: '/d2l/lp/navbars/' + orgUnitId + '/list',
            Error: null
        };
        
        try {
            // Fetch navbar settings HTML
            const html = await fetchNavbarSettingsHTML(orgUnitId);
            
            // Parse the HTML
            const parsed = parseNavbarSettings(html);
            
            result.ActiveNavbarText = parsed.activeNavbarText || '';
            result.IsDefaultNavbar = parsed.isDefaultNavbar ? 'Yes' : 'No';
            
            if (parsed.error) {
                result.Error = parsed.error;
                logMsg('  Warning: ' + parsed.error);
            }
            
        } catch (error) {
            const errorMsg = error.message || String(error);
            result.Error = errorMsg;
            result.ActiveNavbarText = 'ERROR';
            logMsg('  ERROR: ' + errorMsg);
        }
        
        // Add result
        allResults.push(result);
        
        // Render results table incrementally
        renderResultsTable([result]);
        
        // Small delay to avoid rate limiting
        await new Promise(function(resolve) {
            setTimeout(resolve, 100);
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
        
        // Build cells
        const cells = [
            result.OrgUnitId || '',
            result.CourseName || '',
            result.CourseCode || '',
            result.ActiveNavbarText || '',
            result.IsDefaultNavbar || 'No',
            '<a href="' + (result.NavbarSettingsURL || '') + '" target="_blank" class="navbar-link">View Settings</a>'
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
        'ActiveNavbarText',
        'IsDefaultNavbar',
        'NavbarSettingsURL',
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
            escapeCSV(r.ActiveNavbarText || ''),
            escapeCSV(r.IsDefaultNavbar || 'No'),
            escapeCSV(r.NavbarSettingsURL || ''),
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
    const filename = 'navbar-audit_' + timestamp + '.csv';
    
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
