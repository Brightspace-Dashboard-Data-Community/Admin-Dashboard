/**
 * Enrollment Data Service
 * Fetches enrollment data from D2L DataHub full and differential datasets
 * Filters to Winter 26 courses only
 */

const EnrollmentDataService = {
    // Dataset IDs for Enrollments (using the regular enrollment dataset that works without CORS issues)
    ENROLLMENTS_DATASET_ID: '5ced736e-4c4c-4b01-96c8-1c7d404ac5c2',
    ENROLLMENTS_FULL_PLUGIN_ID: '533f84c8-b2ad-4688-94dc-c839952e9c4f',
    ENROLLMENTS_DIFF_PLUGIN_ID: 'a78735f2-7210-4a57-aac1-e0f6bd714349',
    API_VERSION: '1.50',
    
    // Cache for Winter 26 course IDs
    _winter26CourseIds: null,
    _winter26CourseIdsCacheTime: null,
    _winter26Courses: null, // Cache full course objects (with Name, Code, etc.)
    _courseIdsBySemester: {}, // { '26/WI': { ids, courses, time }, '26/SP': { ... } }
    CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours

    /**
     * Get course IDs for a given semester code (e.g. '26/WI', '26/SP')
     * Caches per semester. For 26/WI applies WN7xx/WN8xx section filter; for 26/SP includes all non-MERGED, non-CXLD.
     * @param {string} semesterCode - '26/WI' or '26/SP'
     * @returns {Promise<number[]>}
     */
    async getCourseIdsForSemester(semesterCode) {
        const code = semesterCode && String(semesterCode).trim() || '26/WI';
        const cacheKey = `courses_${code.replace('/', '_')}`;
        const cacheTimeKey = `${cacheKey}_time`;
        const cached = this._courseIdsBySemester[code];
        if (cached && (Date.now() - cached.time) < this.CACHE_DURATION) {
            console.log(`📦 Using cached course IDs for ${code}`);
            return cached.ids;
        }
        const stored = localStorage.getItem(cacheKey);
        const storedTime = localStorage.getItem(cacheTimeKey);
        if (stored && storedTime && (Date.now() - parseInt(storedTime, 10)) < this.CACHE_DURATION) {
            console.log(`📦 Using cached course IDs for ${code} from localStorage`);
            const data = JSON.parse(stored);
            this._courseIdsBySemester[code] = { ids: data.ids, courses: data.courses || [], time: parseInt(storedTime, 10) };
            return data.ids;
        }

        try {
            console.log(`🔍 Fetching course IDs for semester ${code}...`);
            if (typeof D2LApi === 'undefined') {
                throw new Error('D2LApi is not defined');
            }
            const orgInfo = await D2LApi.getOrganizationInfo();
            if (!orgInfo) throw new Error('Could not get organization info');
            const rootOrgUnitId = orgInfo.Identifier;

            let semesters = [];
            if (typeof D2LApi.fetchPaginatedData === 'function') {
                semesters = await D2LApi.fetchPaginatedData(
                    `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5`
                );
            } else {
                const response = await D2LApi._fetch(
                    `/d2l/api/lp/1.49/orgstructure/${rootOrgUnitId}/descendants/?ouTypeId=5&pageSize=100`
                );
                if (response.Objects && Array.isArray(response.Objects)) semesters = response.Objects;
                else if (Array.isArray(response)) semesters = response;
            }

            if (!Array.isArray(semesters) || semesters.length === 0) {
                throw new Error('No semesters found');
            }

            const upper = code.toUpperCase();
            // Prefer the canonical allowlist when available (handles all WI/SP/FA terms uniformly).
            let targetSemester = null;
            if (typeof SemesterConfig !== 'undefined' && SemesterConfig.match) {
                const canon = SemesterConfig.match(upper);
                if (canon) {
                    targetSemester = semesters.find(s => String(s.Identifier) === String(canon.Identifier))
                        || semesters.find(s => (s.Name || '').toUpperCase() === canon.Name.toUpperCase());
                }
            }
            if (!targetSemester) {
                targetSemester = semesters.find(semester => {
                    const name = (semester.Name || '').toUpperCase();
                    const compact = upper.replace('/', '');
                    if (compact === '26WI') return name.includes('26/WI') || name.includes('WINTER 2026') || name.includes('WI 26');
                    if (compact === '26SP') return name.includes('26/SP') || name.includes('SPRING 2026') || name.includes('SP 26');
                    if (compact === '26FA') return name.includes('26/FA') || name.includes('FALL 2026') || name.includes('FA 26');
                    if (compact === '25WI') return name.includes('25/WI') || name.includes('WINTER 2025');
                    if (compact === '25SP') return name.includes('25/SP') || name.includes('SPRING 2025');
                    if (compact === '25FA') return name.includes('25/FA') || name.includes('FALL 2025');
                    if (compact === '24WI') return name.includes('24/WI') || name.includes('WINTER 2024');
                    if (compact === '24SP') return name.includes('24/SP') || name.includes('SPRING 2024');
                    if (compact === '24FA') return name.includes('24/FA') || name.includes('FALL 2024');
                    return name.includes(upper);
                });
            }

            if (!targetSemester) {
                console.warn(`EnrollmentDataService: Semester ${code} not found`);
                return [];
            }

            console.log(`✅ Found semester: ${targetSemester.Name} (ID: ${targetSemester.Identifier})`);

            let courses = [];
            if (typeof D2LApi.fetchPaginatedData === 'function') {
                courses = await D2LApi.fetchPaginatedData(
                    `/d2l/api/lp/1.49/orgstructure/${targetSemester.Identifier}/children/`
                );
                courses = courses.filter(c => c.Type?.Id === 3);
                if (courses.length === 0) {
                    const allDesc = await D2LApi.fetchPaginatedData(
                        `/d2l/api/lp/1.49/orgstructure/${targetSemester.Identifier}/descendants/?ouTypeId=3`
                    );
                    courses = allDesc;
                }
            } else {
                const response = await D2LApi._fetch(
                    `/d2l/api/lp/1.49/orgstructure/${targetSemester.Identifier}/children/?pageSize=100`
                );
                if (response.Objects && Array.isArray(response.Objects)) courses = response.Objects.filter(c => c.Type?.Id === 3);
                else if (Array.isArray(response)) courses = response.filter(c => c.Type?.Id === 3);
                if (courses.length === 0) {
                    const descResponse = await D2LApi._fetch(
                        `/d2l/api/lp/1.49/orgstructure/${targetSemester.Identifier}/descendants/?ouTypeId=3&pageSize=100`
                    );
                    if (descResponse.Objects && Array.isArray(descResponse.Objects)) courses = descResponse.Objects;
                    else if (Array.isArray(descResponse)) courses = descResponse;
                }
            }

            const isWinter = upper === '26/WI' || upper === '26WI';
            const activeCourses = courses.filter(c => {
                if (c.Type?.Code !== 'Course Offering') return false;
                const courseName = (c.Name || '').toUpperCase();
                const courseCode = (c.Code || '').toUpperCase();
                if (courseName.includes('MERGED')) return false;
                if (courseCode.includes('CXLD')) return false;
                if (isWinter) {
                    const wnPattern = /WN[78]\d{2}/;
                    if (!wnPattern.test(courseCode)) return false;
                }
                return true;
            });

            const courseIds = activeCourses.map(c => c.Identifier);
            this._courseIdsBySemester[code] = { ids: courseIds, courses: activeCourses, time: Date.now() };
            localStorage.setItem(cacheKey, JSON.stringify({ ids: courseIds, courses: activeCourses }));
            localStorage.setItem(cacheTimeKey, Date.now().toString());
            console.log(`✅ Found ${courseIds.length} courses for ${code}`);
            return courseIds;
        } catch (error) {
            console.error(`❌ Error fetching course IDs for ${code}:`, error);
            return [];
        }
    },

    /**
     * Get top enrollment course templates (course-level, not sections) for a semester.
     * Groups offerings by template (e.g. ET-120 from "ET-120-WN801-26/WI-COURSE"), sums enrollments per section.
     * @param {string} semesterCode - e.g. '26/WI'
     * @param {number} topN - Number of top templates to return (default 5)
     * @returns {Promise<Array<{template: string, enrollment: number}>>}
     */
    async getTopEnrollmentTemplates(semesterCode = '26/WI', topN = 5) {
        if (typeof D2LApi === 'undefined') {
            console.error('D2LApi is not defined');
            return [];
        }
        const code = String(semesterCode).trim() || '26/WI';
        const cacheKey = `top_enrollment_templates_${code.replace('/', '_')}`;
        const cacheTimeKey = `${cacheKey}_time`;
        const cached = localStorage.getItem(cacheKey);
        const cachedTime = localStorage.getItem(cacheTimeKey);
        if (cached && cachedTime && (Date.now() - parseInt(cachedTime, 10)) < 60 * 60 * 1000) {
            try {
                return JSON.parse(cached);
            } catch (_) { /* ignore */ }
        }

        try {
            console.log(`🔍 getTopEnrollmentTemplates(${code})...`);
            const offeringsUrl = `/d2l/api/lp/1.49/orgstructure/?orgUnitType=3&pageSize=200`;
            const response = await D2LApi._fetch(offeringsUrl);
            const items = response.Items || response.Objects || (Array.isArray(response) ? response : []);
            const allOfferings = Array.isArray(items) ? items : [];

            const templateGroups = {};
            allOfferings.forEach(offering => {
                const offeringCode = (offering.Code || '').trim();
                if (!offeringCode || offeringCode.indexOf(code) === -1) return;
                const parts = offeringCode.split('-');
                if (parts.length < 2) return;
                const templateId = `${parts[0]}-${parts[1]}`;
                if (!templateGroups[templateId]) {
                    templateGroups[templateId] = { name: templateId, sectionIds: [] };
                }
                templateGroups[templateId].sectionIds.push(offering.Identifier);
            });

            const results = await Promise.all(
                Object.values(templateGroups).map(async (group) => {
                    let totalEnrollment = 0;
                    for (const id of group.sectionIds) {
                        try {
                            const countUrl = `/d2l/api/lp/1.49/enrollments/orgUnits/${id}/users/`;
                            const countRes = await D2LApi._fetch(countUrl);
                            const total = countRes.PagingInfo?.TotalCount ?? countRes.TotalCount ?? (Array.isArray(countRes.Items) ? countRes.Items.length : 0);
                            totalEnrollment += Number(total) || 0;
                        } catch (err) {
                            console.warn(`Enrollment count for org ${id} failed:`, err);
                        }
                    }
                    return { template: group.name, enrollment: totalEnrollment };
                })
            );

            const top = results
                .sort((a, b) => b.enrollment - a.enrollment)
                .slice(0, topN);

            localStorage.setItem(cacheKey, JSON.stringify(top));
            localStorage.setItem(cacheTimeKey, Date.now().toString());
            console.log(`✅ Top ${topN} enrollment templates for ${code}:`, top);
            return top;
        } catch (error) {
            console.error('❌ getTopEnrollmentTemplates error:', error);
            return [];
        }
    },

    /**
     * Load JSZip library if not already loaded
     */
    async loadJSZip() {
        if (window.JSZip) {
            return window.JSZip;
        }
        
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            script.onload = () => resolve(window.JSZip);
            script.onerror = () => reject(new Error('JSZip script load failed'));
            document.head.appendChild(script);
        });
    },

    /**
     * Get Winter 26 course IDs
     * Caches the result for 24 hours. Delegates to getCourseIdsForSemester('26/WI').
     */
    async getWinter26CourseIds() {
        const ids = await this.getCourseIdsForSemester('26/WI');
        this._winter26CourseIds = ids;
        this._winter26CourseIdsCacheTime = Date.now();
        const cached = this._courseIdsBySemester['26/WI'];
        if (cached) this._winter26Courses = cached.courses;
        return ids;
    },

    /**
     * Fetch the latest full enrollment dataset
     * Returns CSV content and timestamp
     */
    async fetchLatestFullDataset() {
        try {
            console.log('📥 Fetching latest full enrollment dataset...');
            
            const url = `/d2l/api/lp/${this.API_VERSION}/datasets/bds/${this.ENROLLMENTS_DATASET_ID}/plugins/${this.ENROLLMENTS_FULL_PLUGIN_ID}/extracts?type=full`;
            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch dataset extracts: ${response.status}`);
            }

            const datasetResponse = await response.json();
            
            if (!datasetResponse.Objects || datasetResponse.Objects.length === 0) {
                throw new Error('No full dataset extracts found');
            }

            // Sort by CreatedDate (newest first)
            const sortedExtracts = datasetResponse.Objects.sort(
                (a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate)
            );
            
            const latestExtract = sortedExtracts[0];
            console.log('📅 Latest full dataset created:', latestExtract.CreatedDate);

            // Download the ZIP file
            const downloadUrl = latestExtract.DownloadLink;
            if (!downloadUrl) {
                throw new Error('No download URL found for the full extract');
            }

            console.log('⬇️ Downloading dataset ZIP...');
            const zipResponse = await fetch(downloadUrl, {
                method: 'GET',
                credentials: 'include'
            });

            if (!zipResponse.ok) {
                throw new Error(`Failed to download dataset ZIP: ${zipResponse.status}`);
            }

            // Extract CSV from ZIP
            const zipBlob = await zipResponse.blob();
            const JSZip = await this.loadJSZip();
            const zip = await JSZip.loadAsync(zipBlob);
            
            const csvFile = Object.values(zip.files).find(file => file.name.endsWith('.csv'));
            if (!csvFile) {
                throw new Error('No CSV file found in the dataset ZIP');
            }

            const csvContent = await csvFile.async('string');
            const timestamp = new Date(latestExtract.CreatedDate);
            
            console.log('✅ Full enrollment dataset downloaded and extracted successfully');
            return { csvContent, timestamp };
        } catch (error) {
            console.error('❌ Error fetching full enrollment dataset:', error);
            throw error;
        }
    },

    /**
     * Fetch differential enrollment dataset for a specific date
     * @param {Date} date - Date to fetch differential for (defaults to today)
     */
    async fetchDifferentialDataset(date = new Date()) {
        try {
            const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
            console.log(`📥 Fetching differential enrollment dataset for ${dateStr}...`);
            
            const url = `/d2l/api/lp/${this.API_VERSION}/datasets/bds/${this.ENROLLMENTS_DATASET_ID}/plugins/${this.ENROLLMENTS_DIFF_PLUGIN_ID}/extracts?type=differential`;
            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch differential extracts: ${response.status}`);
            }

            const datasetResponse = await response.json();
            
            if (!datasetResponse.Objects || datasetResponse.Objects.length === 0) {
                console.log(`No differential extracts found for ${dateStr}`);
                return null;
            }

            // Find differentials created on or after the target date
            const targetDate = new Date(date);
            targetDate.setHours(0, 0, 0, 0);
            
            const matchingExtracts = datasetResponse.Objects
                .filter(extract => {
                    const extractDate = new Date(extract.CreatedDate);
                    extractDate.setHours(0, 0, 0, 0);
                    return extractDate >= targetDate;
                })
                .sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate));

            if (matchingExtracts.length === 0) {
                console.log(`No differential extracts found for ${dateStr}`);
                return null;
            }

            const latestExtract = matchingExtracts[0];
            console.log(`📅 Differential dataset created: ${latestExtract.CreatedDate}`);

            // Download the ZIP file
            const downloadUrl = latestExtract.DownloadLink;
            if (!downloadUrl) {
                throw new Error('No download URL found for the differential extract');
            }

            console.log('⬇️ Downloading differential dataset ZIP...');
            const zipResponse = await fetch(downloadUrl, {
                method: 'GET',
                credentials: 'include'
            });

            if (!zipResponse.ok) {
                throw new Error(`Failed to download differential dataset ZIP: ${zipResponse.status}`);
            }

            // Extract CSV from ZIP
            const zipBlob = await zipResponse.blob();
            const JSZip = await this.loadJSZip();
            const zip = await JSZip.loadAsync(zipBlob);
            
            const csvFile = Object.values(zip.files).find(file => file.name.endsWith('.csv'));
            if (!csvFile) {
                throw new Error('No CSV file found in the differential dataset ZIP');
            }

            const csvContent = await csvFile.async('string');
            const timestamp = new Date(latestExtract.CreatedDate);
            
            console.log('✅ Differential enrollment dataset downloaded and extracted successfully');
            return { csvContent, timestamp };
        } catch (error) {
            console.error(`❌ Error fetching differential enrollment dataset for ${date.toISOString().split('T')[0]}:`, error);
            return null;
        }
    },

    /**
     * Parse enrollment CSV content
     * @param {string} csvContent - CSV content string
     * @param {Set<number>} winter26CourseIds - Set of Winter 26 course IDs to filter by
     * @param {boolean} isDifferential - Whether this is a differential dataset (has EnrollmentType field)
     * @returns {Object} Object with 'adds' and 'drops' arrays
     */
    parseEnrollmentData(csvContent, winter26CourseIds, isDifferential = false) {
        try {
            const lines = csvContent.split('\n').filter(line => line.trim());
            if (lines.length === 0) {
                return { adds: [], drops: [] };
            }

            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            console.log('📋 Enrollment CSV Headers:', headers);

            // Find required columns (case-insensitive, handle quoted headers)
            const orgUnitIdIndex = headers.findIndex(h => h.toLowerCase() === 'orgunitid');
            const userIdIndex = headers.findIndex(h => h.toLowerCase() === 'userid');
            const roleIdIndex = headers.findIndex(h => h.toLowerCase() === 'roleid');
            const enrollmentTypeIndex = headers.findIndex(h => h.toLowerCase() === 'enrollmenttype');
            const enrollmentDateIndex = headers.findIndex(h => h.toLowerCase() === 'enrollmentdate');
            // Some datasets expose an explicit enrollment status/active flag; detect it flexibly
            const statusIndex = headers.findIndex(h => {
                const lh = h.toLowerCase();
                return lh === 'enrollmentstatus' || lh === 'status' || lh === 'isenrollmentactive' || lh === 'active';
            });

            console.log('📋 Column indices:', {
                orgUnitId: orgUnitIdIndex,
                userId: userIdIndex,
                roleId: roleIdIndex,
                enrollmentType: enrollmentTypeIndex,
                enrollmentDate: enrollmentDateIndex,
                status: statusIndex
            });

            if (orgUnitIdIndex === -1) {
                throw new Error('OrgUnitId column not found in enrollment CSV');
            }

            const adds = [];
            const drops = [];
            const courseIdSet = new Set(winter26CourseIds.map(id => String(id)));

            // Track samples of different roleIds for debugging
            const roleIdSamples = {};
            let processedCount = 0;
            let winter26Count = 0;

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const values = this._parseCSVLine(line);
                if (values.length < headers.length) continue;

                const orgUnitId = String(values[orgUnitIdIndex] || '').trim();
                
                // Filter to Winter 26 courses only (if courseIdSet is provided and not empty)
                if (courseIdSet.size > 0 && !courseIdSet.has(orgUnitId)) {
                    continue;
                }
                if (courseIdSet.size > 0) {
                    winter26Count++;
                }

                // Parse roleId - handle both string and number formats
                let roleId = null;
                if (roleIdIndex !== -1 && values[roleIdIndex]) {
                    const roleIdValue = String(values[roleIdIndex]).trim();
                    if (roleIdValue) {
                        roleId = parseInt(roleIdValue, 10);
                        if (isNaN(roleId)) {
                            // If parseInt fails, try to extract number from string
                            const match = roleIdValue.match(/\d+/);
                            roleId = match ? parseInt(match[0], 10) : null;
                        }
                    }
                }

                // Collect samples of different roleIds (first 3 of each)
                if (roleId !== null && (!roleIdSamples[roleId] || roleIdSamples[roleId].length < 3)) {
                    if (!roleIdSamples[roleId]) {
                        roleIdSamples[roleId] = [];
                    }
                    roleIdSamples[roleId].push({
                        orgUnitId: orgUnitId,
                        userId: userIdIndex !== -1 ? String(values[userIdIndex] || '').trim() : null,
                        roleId: roleId,
                        rawRoleIdValue: values[roleIdIndex]
                    });
                }
                processedCount++;

                let enrollmentDate = null;
                if (enrollmentDateIndex !== -1) {
                    const rawDate = String(values[enrollmentDateIndex] || '').trim();
                    if (rawDate) {
                        enrollmentDate = rawDate;
                    }
                }

                let status = null;
                if (statusIndex !== -1) {
                    status = String(values[statusIndex] || '').trim();
                }

                const enrollment = {
                    orgUnitId: orgUnitId,
                    userId: userIdIndex !== -1 ? String(values[userIdIndex] || '').trim() : null,
                    roleId: roleId,
                    enrollmentDate: enrollmentDate,
                    status: status
                };

                // For differential datasets, check EnrollmentType to determine if it's an add or drop
                if (isDifferential && enrollmentTypeIndex !== -1) {
                    const enrollmentType = String(values[enrollmentTypeIndex] || '').trim().toUpperCase();
                    // Common D2L values: "ENROLLED", "ADD", "UNENROLLED", "DROP", "REMOVE", etc.
                    if (enrollmentType.includes('DROP') || 
                        enrollmentType.includes('UNENROLL') || 
                        enrollmentType.includes('REMOVE') ||
                        enrollmentType === '0' || 
                        enrollmentType === 'FALSE') {
                        drops.push(enrollment);
                    } else {
                        // Default to add for "ENROLLED", "ADD", or any other value
                        adds.push(enrollment);
                    }
                } else {
                    // For full datasets, all records are adds
                    adds.push(enrollment);
                }
            }

            console.log(`📊 Parsed ${adds.length} adds, ${drops.length} drops from CSV`);
            console.log(`📊 Processed ${processedCount} Winter 26 enrollments (${winter26Count} matched course filter)`);
            console.log('📊 RoleId samples found:', Object.keys(roleIdSamples).map(id => ({
                roleId: id,
                count: roleIdSamples[id].length,
                samples: roleIdSamples[id]
            })));
            
            return { adds, drops };
        } catch (error) {
            console.error('❌ Error parsing enrollment CSV:', error);
            throw error;
        }
    },

    /**
     * Parse a CSV line handling quoted values
     */
    _parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);
        
        return values.map(v => v.trim().replace(/^"|"$/g, ''));
    },

    /**
     * Count enrollments by role
     * @param {Array} enrollments - Array of enrollment objects
     * @returns {Object} Counts by role
     */
    countEnrollments(enrollments) {
        const counts = {
            students: 0,
            instructors: 0,
            admins: 0,
            incompleteStudents: 0,
            total: 0
        };

        // Track role IDs for debugging
        const roleIdCounts = {};
        const roleId107Samples = [];

        enrollments.forEach(enrollment => {
            const roleId = enrollment.roleId;
            
            // Track all role IDs for debugging
            const roleIdKey = String(roleId || 'null');
            roleIdCounts[roleIdKey] = (roleIdCounts[roleIdKey] || 0) + 1;
            
            // Collect samples of roleId 107 for debugging
            if (roleId === 107 || roleId === '107' || String(roleId) === '107') {
                if (roleId107Samples.length < 5) {
                    roleId107Samples.push(enrollment);
                }
            }
            
            // Handle both number and string comparisons
            if (roleId === 101 || roleId === '101' || String(roleId) === '101') {
                counts.students++;
            } else if (roleId === 102 || roleId === '102' || String(roleId) === '102') {
                counts.instructors++;
            } else if (roleId === 100 || roleId === '100' || String(roleId) === '100') {
                counts.admins++;
            } else if (roleId === 107 || roleId === '107' || String(roleId) === '107') {
                counts.incompleteStudents++;
            }
            counts.total++;
        });

        // Log role ID distribution for debugging
        console.log('📊 Role ID distribution:', roleIdCounts);
        if (roleId107Samples.length > 0) {
            console.log('✅ Found RoleId 107 samples:', roleId107Samples);
        } else {
            console.log('⚠️ No RoleId 107 enrollments found in dataset');
        }

        return counts;
    },

    /**
     * Get count of ZZStudents/Student View (RoleId 112) system-wide
     * This counts ALL ZZStudents across all courses, not just Winter 26
     * @returns {Promise<number>} Count of ZZStudents
     */
    async getZZStudentsCount() {
        try {
            console.log('🔍 EnrollmentDataService.getZZStudentsCount() called (system-wide)');
            
            // Check cache (cache for 1 hour)
            const cacheKey = 'zz_students_count_systemwide';
            const cacheTimeKey = 'zz_students_count_systemwide_time';
            const cached = localStorage.getItem(cacheKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);
            
            if (cached && cachedTime) {
                const cacheAge = Date.now() - parseInt(cachedTime, 10);
                if (cacheAge < 60 * 60 * 1000) { // 1 hour
                    console.log('📦 Using cached ZZStudents count');
                    return parseInt(cached, 10);
                } else {
                    console.log('📦 Cache expired, fetching fresh data');
                }
            }

            // Fetch full dataset (no course filtering)
            const { csvContent: fullCsv } = await this.fetchLatestFullDataset();
            
            // Parse without course filtering - pass empty array to include all courses
            const fullData = this.parseEnrollmentData(fullCsv, [], false);
            
            // Build enrollment map from full dataset (userId + orgUnitId -> enrollment)
            // Use a Set to track unique userIds with roleId 112
            const zzStudentUserIds = new Set();
            fullData.adds.forEach(enrollment => {
                const roleId = enrollment.roleId;
                if (roleId === 112 || roleId === '112' || String(roleId) === '112') {
                    // Count unique users, not enrollments (a user can be enrolled in multiple courses)
                    if (enrollment.userId) {
                        zzStudentUserIds.add(enrollment.userId);
                    }
                }
            });

            console.log(`📊 Full dataset: ${fullData.adds.length} total enrollments`);
            console.log(`📊 Found ${zzStudentUserIds.size} unique ZZStudents (RoleId 112)`);

            // Process yesterday's differential
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayDiff = await this.fetchDifferentialDataset(yesterday);
            if (yesterdayDiff) {
                const yesterdayData = this.parseEnrollmentData(yesterdayDiff.csvContent, [], true);
                console.log(`📊 Yesterday's differential: ${yesterdayData.adds.length} adds, ${yesterdayData.drops.length} drops`);
                
                // Apply adds (new ZZStudent enrollments)
                yesterdayData.adds.forEach(enrollment => {
                    const roleId = enrollment.roleId;
                    if (roleId === 112 || roleId === '112' || String(roleId) === '112') {
                        if (enrollment.userId) {
                            zzStudentUserIds.add(enrollment.userId);
                        }
                    }
                });
            }

            // Process today's differential
            const todayDiff = await this.fetchDifferentialDataset(new Date());
            if (todayDiff) {
                const todayData = this.parseEnrollmentData(todayDiff.csvContent, [], true);
                console.log(`📊 Today's differential: ${todayData.adds.length} adds, ${todayData.drops.length} drops`);
                
                // Apply adds
                todayData.adds.forEach(enrollment => {
                    const roleId = enrollment.roleId;
                    if (roleId === 112 || roleId === '112' || String(roleId) === '112') {
                        if (enrollment.userId) {
                            zzStudentUserIds.add(enrollment.userId);
                        }
                    }
                });
            }

            const count = zzStudentUserIds.size;

            // Cache the result
            localStorage.setItem(cacheKey, count.toString());
            localStorage.setItem(cacheTimeKey, Date.now().toString());

            console.log(`📊 Total unique ZZStudents (system-wide): ${count}`);
            return count;
        } catch (error) {
            console.error('❌ Error getting ZZStudents count:', error);
            return 0;
        }
    },

    /**
     * Get count of Incomplete Students (RoleId 107) system-wide
     * This counts ALL incomplete students across all courses, not just Winter 26
     * @returns {Promise<number>} Count of incomplete students
     */
    async getIncompleteStudentsCount() {
        try {
            console.log('🔍 EnrollmentDataService.getIncompleteStudentsCount() called (system-wide)');
            
            // Check cache (cache for 1 hour)
            const cacheKey = 'incomplete_students_count_systemwide';
            const cacheTimeKey = 'incomplete_students_count_systemwide_time';
            const cached = localStorage.getItem(cacheKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);
            
            if (cached && cachedTime) {
                const cacheAge = Date.now() - parseInt(cachedTime, 10);
                if (cacheAge < 60 * 60 * 1000) { // 1 hour
                    console.log('📦 Using cached incomplete students count');
                    return parseInt(cached, 10);
                } else {
                    console.log('📦 Cache expired, fetching fresh data');
                }
            }

            // Fetch full dataset (no course filtering)
            const { csvContent: fullCsv } = await this.fetchLatestFullDataset();
            
            // Parse without course filtering - pass empty array to include all courses
            const fullData = this.parseEnrollmentData(fullCsv, [], false);
            
            // Build enrollment map from full dataset (userId + orgUnitId -> enrollment)
            // Use a Set to track unique userIds with roleId 107
            const incompleteStudentUserIds = new Set();
            fullData.adds.forEach(enrollment => {
                const roleId = enrollment.roleId;
                if (roleId === 107 || roleId === '107' || String(roleId) === '107') {
                    // Count unique users, not enrollments (a user can be enrolled in multiple courses)
                    if (enrollment.userId) {
                        incompleteStudentUserIds.add(enrollment.userId);
                    }
                }
            });

            console.log(`📊 Full dataset: ${fullData.adds.length} total enrollments`);
            console.log(`📊 Found ${incompleteStudentUserIds.size} unique incomplete students (RoleId 107)`);

            // Process yesterday's differential
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayDiff = await this.fetchDifferentialDataset(yesterday);
            if (yesterdayDiff) {
                const yesterdayData = this.parseEnrollmentData(yesterdayDiff.csvContent, [], true);
                console.log(`📊 Yesterday's differential: ${yesterdayData.adds.length} adds, ${yesterdayData.drops.length} drops`);
                
                // Apply adds (new incomplete student enrollments)
                yesterdayData.adds.forEach(enrollment => {
                    const roleId = enrollment.roleId;
                    if (roleId === 107 || roleId === '107' || String(roleId) === '107') {
                        if (enrollment.userId) {
                            incompleteStudentUserIds.add(enrollment.userId);
                        }
                    }
                });
                
                // Note: We don't remove from set on drops because a user might still be
                // enrolled as incomplete in other courses. For accurate count, we'd need
                // to check all enrollments, but for simplicity, we'll just count adds.
            }

            // Process today's differential
            const todayDiff = await this.fetchDifferentialDataset(new Date());
            if (todayDiff) {
                const todayData = this.parseEnrollmentData(todayDiff.csvContent, [], true);
                console.log(`📊 Today's differential: ${todayData.adds.length} adds, ${todayData.drops.length} drops`);
                
                // Apply adds
                todayData.adds.forEach(enrollment => {
                    const roleId = enrollment.roleId;
                    if (roleId === 107 || roleId === '107' || String(roleId) === '107') {
                        if (enrollment.userId) {
                            incompleteStudentUserIds.add(enrollment.userId);
                        }
                    }
                });
            }

            const count = incompleteStudentUserIds.size;

            // Cache the result
            localStorage.setItem(cacheKey, count.toString());
            localStorage.setItem(cacheTimeKey, Date.now().toString());

            console.log(`📊 Total unique incomplete students (system-wide): ${count}`);
            return count;
        } catch (error) {
            console.error('❌ Error getting incomplete students count:', error);
            return 0;
        }
    },

    /**
     * Get current enrollment count for a semester
     * Combines full dataset with yesterday's and today's differentials
     * @param {string} [semesterCode='26/WI'] - Semester code (e.g. '26/WI', '26/SP')
     * @returns {Promise<Object>} Enrollment counts
     */
    async getEnrollmentCounts(semesterCode = '26/WI') {
        try {
            const code = semesterCode && String(semesterCode).trim() || '26/WI';
            console.log('🔍 EnrollmentDataService.getEnrollmentCounts() called for', code);

            const cacheKey = `enrollment_counts_${code.replace('/', '_')}`;
            const cacheTimeKey = `${cacheKey}_time`;
            const cached = localStorage.getItem(cacheKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);

            if (cached && cachedTime) {
                const cacheAge = Date.now() - parseInt(cachedTime, 10);
                if (cacheAge < 60 * 60 * 1000) { // 1 hour
                    console.log('📦 Using cached enrollment counts for', code);
                    return JSON.parse(cached);
                }
            }

            const courseIds = await this.getCourseIdsForSemester(code);
            if (courseIds.length === 0) {
                console.warn(`⚠️ No courses found for semester ${code}`);
                return { students: 0, instructors: 0, admins: 0, incompleteStudents: 0, total: 0 };
            }

            // Start with full dataset as the base
            const { csvContent: fullCsv, timestamp: fullTimestamp } = await this.fetchLatestFullDataset();
            const fullData = this.parseEnrollmentData(fullCsv, courseIds, false);
            
            const enrollmentMap = new Map();
            fullData.adds.forEach(enrollment => {
                const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                enrollmentMap.set(key, enrollment);
            });

            console.log(`📊 Full dataset: ${fullData.adds.length} enrollments`);

            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayDiff = await this.fetchDifferentialDataset(yesterday);
            if (yesterdayDiff) {
                const yesterdayData = this.parseEnrollmentData(yesterdayDiff.csvContent, courseIds, true);
                yesterdayData.adds.forEach(enrollment => {
                    const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                    enrollmentMap.set(key, enrollment);
                });
                yesterdayData.drops.forEach(enrollment => {
                    const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                    enrollmentMap.delete(key);
                });
            }

            const todayDiff = await this.fetchDifferentialDataset(new Date());
            if (todayDiff) {
                const todayData = this.parseEnrollmentData(todayDiff.csvContent, courseIds, true);
                todayData.adds.forEach(enrollment => {
                    const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                    enrollmentMap.set(key, enrollment);
                });
                todayData.drops.forEach(enrollment => {
                    const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                    enrollmentMap.delete(key);
                });
            }

            const uniqueEnrollments = Array.from(enrollmentMap.values());
            const counts = this.countEnrollments(uniqueEnrollments);

            localStorage.setItem(cacheKey, JSON.stringify(counts));
            localStorage.setItem(cacheTimeKey, Date.now().toString());

            console.log('📊 Enrollment counts for', code, ':', counts);
            return counts;
        } catch (error) {
            console.error('❌ Error getting enrollment counts:', error);
            return { students: 0, instructors: 0, admins: 0, incompleteStudents: 0, total: 0 };
        }
    },

    /**
     * Deduplicate enrollments by userId + orgUnitId
     */
    _deduplicateEnrollments(enrollments) {
        const seen = new Set();
        const unique = [];

        enrollments.forEach(enrollment => {
            const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(enrollment);
            }
        });

        return unique;
    },

    /**
     * Get count of withdrawals (drops) for this week
     * Reads from local CSV file in data-hub folder: EnrollmentsAndWithdrawals *.csv
     * @returns {Promise<number>} Count of withdrawals this week
     */
    async getWithdrawalsCount() {
        try {
            console.log('🔍 EnrollmentDataService.getWithdrawalsCount() called');
            
            // Check cache (cache for 1 hour, but don't trust 0 values - always verify)
            const cacheKey = 'withdrawals_count_this_week';
            const cacheTimeKey = 'withdrawals_count_this_week_time';
            const cached = localStorage.getItem(cacheKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);
            
            if (cached && cachedTime) {
                const cachedValue = parseInt(cached, 10);
                const cacheAge = Date.now() - parseInt(cachedTime, 10);
                
                // For non-zero values, use 1 hour cache
                if (cachedValue > 0 && cacheAge < 60 * 60 * 1000) {
                    console.log(`📦 Using cached withdrawals count: ${cachedValue}`);
                    return cachedValue;
                } else if (cachedValue === 0) {
                    // For 0 values, always fetch fresh data (don't trust cached 0)
                    console.log('📦 Cached value is 0, fetching fresh data to verify');
                } else {
                    console.log('📦 Cache expired, fetching fresh data');
                }
            }

            // Get Winter 26 course IDs
            const winter26CourseIds = await this.getWinter26CourseIds();
            if (winter26CourseIds.length === 0) {
                console.warn('⚠️ No Winter 26 courses found');
                return 0;
            }

            // Calculate date range for this week (last 7 days)
            const today = new Date();
            today.setHours(23, 59, 59, 999); // End of today
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            weekAgo.setHours(0, 0, 0, 0); // Start of week ago

            console.log(`📅 Looking for withdrawals between ${weekAgo.toISOString()} and ${today.toISOString()}`);

            // Find and read ALL EnrollmentsAndWithdrawals CSV files in data-hub folder
            const csvFiles = await this._findAndReadAllEnrollmentsAndWithdrawalsFiles();
            if (csvFiles.length === 0) {
                console.warn('⚠️ No EnrollmentsAndWithdrawals CSV files found in data-hub folder');
                return 0;
            }

            console.log(`📄 Found ${csvFiles.length} file(s): ${csvFiles.map(f => f.name).join(', ')}`);

            // Parse headers from first file (all files should have same structure)
            const firstFileContent = csvFiles[0].content;
            const firstFileLines = firstFileContent.split('\n').filter(line => line.trim());
            if (firstFileLines.length < 2) {
                console.warn('⚠️ CSV file is empty or has no data rows');
                return 0;
            }

            const headers = firstFileLines[0].split(',').map(h => h.trim());
            const orgUnitIdIndex = headers.findIndex(h => h.toLowerCase() === 'orgunitid');
            const roleIdIndex = headers.findIndex(h => h.toLowerCase() === 'roleid');
            const actionIndex = headers.findIndex(h => h.toLowerCase() === 'action');
            const enrollmentDateIndex = headers.findIndex(h => h.toLowerCase() === 'enrollmentdate');

            if (orgUnitIdIndex === -1 || actionIndex === -1 || roleIdIndex === -1 || enrollmentDateIndex === -1) {
                console.error('❌ Required columns not found in CSV:', { orgUnitIdIndex, actionIndex, roleIdIndex, enrollmentDateIndex });
                return 0;
            }

            // Convert Winter 26 course IDs to Set for fast lookup
            const winter26CourseIdSet = new Set(winter26CourseIds.map(id => String(id)));

            // Process all files and group withdrawals by date
            const withdrawalsByDate = new Map(); // Map<dateString, count>
            let totalWithdrawals = 0;

            for (const csvFile of csvFiles) {
                const lines = csvFile.content.split('\n').filter(line => line.trim());
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const values = this._parseCSVLine(line);
                    if (values.length < headers.length) continue;

                    const orgUnitId = String(values[orgUnitIdIndex] || '').trim();
                    const roleId = String(values[roleIdIndex] || '').trim();
                    const action = String(values[actionIndex] || '').trim();
                    const enrollmentDateStr = String(values[enrollmentDateIndex] || '').trim();

                    // Filter: Must be Unenroll action, student role (101), Winter 26 course
                    if (action.toLowerCase() !== 'unenroll') continue;
                    if (roleId !== '101') continue;
                    if (!winter26CourseIdSet.has(orgUnitId)) continue;

                    // Parse enrollment date
                    try {
                        const enrollmentDate = new Date(enrollmentDateStr);
                        
                        // Check if within date range
                        if (enrollmentDate >= weekAgo && enrollmentDate <= today) {
                            // Get date string (YYYY-MM-DD) for grouping
                            const dateStr = enrollmentDate.toISOString().split('T')[0];
                            
                            // Increment count for this date
                            withdrawalsByDate.set(dateStr, (withdrawalsByDate.get(dateStr) || 0) + 1);
                            totalWithdrawals++;
                        }
                    } catch (error) {
                        console.warn(`⚠️ Could not parse enrollment date: ${enrollmentDateStr}`);
                    }
                }
            }

            // Calculate day-over-day changes
            const dailyBreakdown = [];
            const sortedDates = Array.from(withdrawalsByDate.keys()).sort();
            
            for (let i = 0; i < sortedDates.length; i++) {
                const date = sortedDates[i];
                const count = withdrawalsByDate.get(date);
                const prevDate = i > 0 ? sortedDates[i - 1] : null;
                const prevCount = prevDate ? withdrawalsByDate.get(prevDate) : null;
                
                const dayOverDay = prevCount !== null ? count - prevCount : null;
                const dayOverDayPercent = prevCount && prevCount > 0 
                    ? ((count - prevCount) / prevCount * 100).toFixed(1) 
                    : null;

                dailyBreakdown.push({
                    date: date,
                    count: count,
                    dayOverDay: dayOverDay,
                    dayOverDayPercent: dayOverDayPercent
                });
            }

            // Log daily breakdown
            console.log(`📊 Total withdrawals this week: ${totalWithdrawals}`);
            if (dailyBreakdown.length > 0) {
                console.log('📅 Daily breakdown:');
                dailyBreakdown.forEach(day => {
                    const change = day.dayOverDay !== null 
                        ? ` (${day.dayOverDay >= 0 ? '+' : ''}${day.dayOverDay}${day.dayOverDayPercent ? `, ${day.dayOverDayPercent}%` : ''})`
                        : '';
                    console.log(`  ${day.date}: ${day.count}${change}`);
                });
            }

            // Cache the result (just the total for now)
            localStorage.setItem(cacheKey, totalWithdrawals.toString());
            localStorage.setItem(cacheTimeKey, Date.now().toString());

            return totalWithdrawals;
        } catch (error) {
            console.error('❌ Error getting withdrawals count:', error);
            return 0;
        }
    },

    /**
     * Get enrollment change summary from adds/drops CSV (same source as withdrawals).
     * Returns adds/drops today and this week, and net change.
     * @returns {Promise<{addsToday: number, addsWeek: number, dropsToday: number, dropsWeek: number, netChange: number}>}
     */
    async getEnrollmentChangeSummary() {
        try {
            const winter26CourseIds = await this.getWinter26CourseIds();
            if (winter26CourseIds.length === 0) {
                return { addsToday: 0, addsWeek: 0, dropsToday: 0, dropsWeek: 0, netChange: 0 };
            }

            const csvFiles = await this._findAndReadAllEnrollmentsAndWithdrawalsFiles();
            if (csvFiles.length === 0) {
                return { addsToday: 0, addsWeek: 0, dropsToday: 0, dropsWeek: 0, netChange: 0 };
            }

            const now = new Date();
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(now);
            todayEnd.setHours(23, 59, 59, 999);
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - 7);
            weekStart.setHours(0, 0, 0, 0);

            const winter26Set = new Set(winter26CourseIds.map(id => String(id)));
            let addsToday = 0, addsWeek = 0, dropsToday = 0, dropsWeek = 0;

            for (const csvFile of csvFiles) {
                const lines = csvFile.content.split('\n').filter(line => line.trim());
                if (lines.length < 2) continue;
                const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                const orgUnitIdIndex = headers.findIndex(h => h === 'orgunitid');
                const roleIdIndex = headers.findIndex(h => h === 'roleid');
                const actionIndex = headers.findIndex(h => h === 'action');
                const enrollmentDateIndex = headers.findIndex(h => h === 'enrollmentdate');
                if (actionIndex === -1 || enrollmentDateIndex === -1) continue;

                for (let i = 1; i < lines.length; i++) {
                    const values = this._parseCSVLine(lines[i].trim());
                    if (values.length < headers.length) continue;
                    const orgUnitId = String(values[orgUnitIdIndex] || '').trim();
                    if (winter26Set.size > 0 && !winter26Set.has(orgUnitId)) continue;
                    const roleId = String(values[roleIdIndex] || '').trim();
                    if (roleId !== '101') continue; // student only
                    const action = String(values[actionIndex] || '').trim().toLowerCase();
                    const dateStr = String(values[enrollmentDateIndex] || '').trim();
                    let enrollmentDate;
                    try {
                        enrollmentDate = new Date(dateStr);
                    } catch (_) {
                        continue;
                    }
                    if (enrollmentDate >= weekStart && enrollmentDate <= todayEnd) {
                        const inWeek = true;
                        const inToday = enrollmentDate >= todayStart && enrollmentDate <= todayEnd;
                        if (action === 'unenroll' || action === 'drop') {
                            if (inToday) dropsToday++;
                            dropsWeek++;
                        } else {
                            if (inToday) addsToday++;
                            addsWeek++;
                        }
                    }
                }
            }

            const netChange = addsWeek - dropsWeek;
            return { addsToday, addsWeek, dropsToday, dropsWeek, netChange };
        } catch (error) {
            console.error('❌ getEnrollmentChangeSummary error:', error);
            return { addsToday: 0, addsWeek: 0, dropsToday: 0, dropsWeek: 0, netChange: 0 };
        }
    },

    /**
     * Find and read ALL EnrollmentsAndWithdrawals CSV files in data-hub folder
     * Tries to read files directly (avoids HEAD requests that cause redirect loops)
     * @returns {Promise<Array>} Array of file objects with name, path, and content
     */
    async _findAndReadAllEnrollmentsAndWithdrawalsFiles() {
        try {
            // Try common file patterns - user can have files like:
            // - EnrollmentsAndWithdrawals 3.csv
            // - EnrollmentsAndWithdrawals.csv
            // - EnrollmentsAndWithdrawals 1.csv, 2.csv, etc.
            const possibleFiles = [];
            
            // Try numbered versions (10 down to 1) - higher numbers are likely more recent
            for (let i = 10; i >= 1; i--) {
                possibleFiles.push(`data-hub/EnrollmentsAndWithdrawals ${i}.csv`);
            }
            possibleFiles.push('data-hub/EnrollmentsAndWithdrawals.csv');
            
            // Also try without data-hub prefix (in case file is in root)
            for (let i = 10; i >= 1; i--) {
                possibleFiles.push(`EnrollmentsAndWithdrawals ${i}.csv`);
            }
            possibleFiles.push('EnrollmentsAndWithdrawals.csv');

            const foundFiles = [];

            // Try to read each file directly (collect all that exist)
            for (const filePath of possibleFiles) {
                try {
                    const response = await fetch(filePath);
                    if (response.ok) {
                        const csvContent = await response.text();
                        if (csvContent && csvContent.trim().length > 0) {
                            console.log(`✅ Found and read file: ${filePath}`);
                            foundFiles.push({
                                name: filePath.split('/').pop(), // Just filename
                                path: filePath,
                                content: csvContent
                            });
                        }
                    }
                    // Silently ignore 404s - file doesn't exist, which is expected
                    // Don't log or throw for 404s to avoid console noise
                } catch (error) {
                    // Silently ignore fetch errors (including 404s)
                    // This is expected when files don't exist
                }
            }

            if (foundFiles.length === 0) {
                console.warn('⚠️ No EnrollmentsAndWithdrawals CSV files found. Tried:', possibleFiles.slice(0, 5).join(', '), '...');
            }

            return foundFiles;
        } catch (error) {
            console.error('❌ Error finding EnrollmentsAndWithdrawals files:', error);
            return [];
        }
    },

    /**
     * Verify actual student count for a course by checking the classlist API
     * @param {number|string} courseId - Course OrgUnitId
     * @returns {Promise<number>} Actual count of students (roleId 101) in the course
     */
    async _verifyCourseStudentCount(courseId) {
        if (typeof D2LApi === 'undefined') {
            throw new Error('D2LApi is not available');
        }

        // Fetch classlist using the classlist API
        const classlistUrl = `/d2l/api/le/1.78/${courseId}/classlist/paged/`;
        const allUsers = [];
        let nextUrl = classlistUrl;
        let pageCount = 0;

        try {
            while (nextUrl) {
                pageCount++;
                const response = await D2LApi._fetch(nextUrl);
                
                // Handle different response formats
                let users = [];
                if (response.Objects && Array.isArray(response.Objects)) {
                    users = response.Objects;
                } else if (response.Items && Array.isArray(response.Items)) {
                    users = response.Items;
                } else if (Array.isArray(response)) {
                    users = response;
                } else {
                    console.warn(`      ⚠️ Unexpected response format for course ${courseId}:`, response);
                }

                allUsers.push(...users);

                // Check for next page
                nextUrl = response.Next || null;
            }

            // Count students (roleId 101)
            const studentCount = allUsers.filter(user => {
                const roleId = user.RoleId || user.Role?.Id;
                return roleId === 101 || roleId === '101' || String(roleId) === '101';
            }).length;

            return studentCount;
        } catch (error) {
            console.error(`      ❌ API Error verifying course ${courseId} (page ${pageCount}):`, error);
            throw error;
        }
    },

    /**
     * Get count of courses with zero student enrollments
     * Counts Winter 26 courses that have no students (roleId 101) enrolled
     * Also stores course details for the detail page
     * VERIFICATION: Always verifies via classlist API to catch dataset errors
     * @returns {Promise<number>} Count of courses with 0 student enrollments
     */
    async getCoursesWithZeroStudentEnrollments() {
        console.log('🔍 getCoursesWithZeroStudentEnrollments() called - WITH VERIFICATION v2');
        try {
            console.log('🔍 EnrollmentDataService.getCoursesWithZeroStudentEnrollments() called');
            console.log('📋 DATA SOURCES:');
            console.log('   ✅ Course list: D2L API (getWinter26CourseIds)');
            console.log('   ✅ Enrollment counts: Enrollment dataset (full + differentials)');
            console.log('   ❌ NOT using: EnrollmentsAndWithdrawals CSV files (those are only for withdrawals)');
            
            // Check cache (cache for 1 hour)
            // BUT: Always verify via API to catch dataset errors, so we don't use cache for final result
            const cacheKey = 'courses_zero_students_winter26';
            const cacheTimeKey = 'courses_zero_students_winter26_time';
            const cached = localStorage.getItem(cacheKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);
            
            if (cached && cachedTime) {
                const cacheAge = Date.now() - parseInt(cachedTime, 10);
                if (cacheAge < 60 * 60 * 1000) { // 1 hour
                    console.log('📦 Found cached courses with zero students count');
                    console.log('⚠️ BUT: Will still verify via API to catch dataset errors');
                    // Don't return early - always verify via API
                } else {
                    console.log('📦 Cache expired, fetching fresh data');
                }
            }

            // Get Winter 26 course IDs
            console.log('📥 Step 1: Fetching course list from D2L API...');
            const winter26CourseIds = await this.getWinter26CourseIds();
            if (winter26CourseIds.length === 0) {
                console.warn('⚠️ No Winter 26 courses found');
                return 0;
            }
            console.log(`✅ Found ${winter26CourseIds.length} Winter 26 courses from D2L API`);

            // Start with full dataset as the base
            console.log('📥 Step 2: Fetching enrollment data from Enrollment dataset (full)...');
            const { csvContent: fullCsv, timestamp: fullTimestamp } = await this.fetchLatestFullDataset();
            console.log(`📅 Full dataset created: ${new Date(fullTimestamp).toLocaleString()}`);
            const fullData = this.parseEnrollmentData(fullCsv, winter26CourseIds, false);
            
            // Build enrollment map from full dataset (userId + orgUnitId -> enrollment)
            const enrollmentMap = new Map();
            fullData.adds.forEach(enrollment => {
                const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                enrollmentMap.set(key, enrollment);
            });

            console.log(`📊 Full dataset: ${fullData.adds.length} enrollments`);

            // Process yesterday's differential
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayDiff = await this.fetchDifferentialDataset(yesterday);
            if (yesterdayDiff) {
                const yesterdayData = this.parseEnrollmentData(yesterdayDiff.csvContent, winter26CourseIds, true);
                console.log(`📊 Yesterday's differential: ${yesterdayData.adds.length} adds, ${yesterdayData.drops.length} drops`);
                
                // Apply adds
                yesterdayData.adds.forEach(enrollment => {
                    const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                    enrollmentMap.set(key, enrollment);
                });
                
                // Apply drops
                yesterdayData.drops.forEach(enrollment => {
                    const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                    enrollmentMap.delete(key);
                });
            }

            // Process today's differential
            const todayDiff = await this.fetchDifferentialDataset(new Date());
            if (todayDiff) {
                const todayData = this.parseEnrollmentData(todayDiff.csvContent, winter26CourseIds, true);
                console.log(`📊 Today's differential: ${todayData.adds.length} adds, ${todayData.drops.length} drops`);
                
                // Apply adds
                todayData.adds.forEach(enrollment => {
                    const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                    enrollmentMap.set(key, enrollment);
                });
                
                // Apply drops
                todayData.drops.forEach(enrollment => {
                    const key = `${enrollment.userId || 'unknown'}_${enrollment.orgUnitId}`;
                    enrollmentMap.delete(key);
                });
            }

            // Convert map to array
            const uniqueEnrollments = Array.from(enrollmentMap.values());
            console.log(`📊 Total unique enrollments after processing: ${uniqueEnrollments.length}`);

            // Group enrollments by course (orgUnitId) and filter to students only (roleId 101)
            const courseStudentCounts = new Map();
            uniqueEnrollments.forEach(enrollment => {
                const roleId = enrollment.roleId;
                // Only count student enrollments (roleId 101)
                if (roleId === 101 || roleId === '101' || String(roleId) === '101') {
                    const orgUnitId = enrollment.orgUnitId;
                    const currentCount = courseStudentCounts.get(orgUnitId) || 0;
                    courseStudentCounts.set(orgUnitId, currentCount + 1);
                }
            });

            // Get course details (names, codes) for courses with 0 enrollments
            // Use cached course objects if available
            const courseDetails = this._winter26Courses || [];
            const courseDetailsMap = new Map();
            courseDetails.forEach(course => {
                courseDetailsMap.set(String(course.Identifier), {
                    id: course.Identifier,
                    name: course.Name || 'Unknown',
                    code: course.Code || 'Unknown',
                    path: course.Path || ''
                });
            });

            // Find courses with 0 student enrollments and store their details
            const zeroEnrollmentCourses = [];
            const coursesToVerify = [];
            
            winter26CourseIds.forEach(courseId => {
                const studentCount = courseStudentCounts.get(String(courseId)) || 0;
                if (studentCount === 0) {
                    const courseInfo = courseDetailsMap.get(String(courseId)) || {
                        id: courseId,
                        name: `Course ${courseId}`,
                        code: `Unknown`,
                        path: ''
                    };
                    coursesToVerify.push(courseInfo);
                }
            });

            // ALWAYS verify courses by checking actual classlist API
            console.log(`🔍 VERIFICATION START: Checking ${coursesToVerify.length} courses via classlist API...`);
            console.log(`   This will verify each course has 0 students by calling the D2L API directly.`);
            
            if (typeof D2LApi === 'undefined') {
                console.error('❌ D2LApi is not available - cannot verify courses!');
                console.warn('⚠️ Falling back to dataset results (may be inaccurate)');
                // If D2LApi isn't available, just use dataset results
                coursesToVerify.forEach(courseInfo => zeroEnrollmentCourses.push(courseInfo));
            } else {
                // Double-check each course by fetching its actual classlist
                let verifiedCount = 0;
                let discrepancyCount = 0;
                
                for (const courseInfo of coursesToVerify) {
                    try {
                        console.log(`   🔎 [${verifiedCount + discrepancyCount + 1}/${coursesToVerify.length}] Checking ${courseInfo.code} (ID: ${courseInfo.id})...`);
                        const actualStudentCount = await this._verifyCourseStudentCount(courseInfo.id);
                        
                        if (actualStudentCount === 0) {
                            // Confirmed: course has 0 students
                            console.log(`      ✅ CONFIRMED: ${courseInfo.code} has 0 students`);
                            zeroEnrollmentCourses.push(courseInfo);
                            verifiedCount++;
                        } else {
                            // Discrepancy found: dataset says 0, but classlist shows students
                            console.warn(`      ⚠️ DISCREPANCY: ${courseInfo.code} (${courseInfo.id})`);
                            console.warn(`         Dataset says: 0 students`);
                            console.warn(`         Classlist API says: ${actualStudentCount} students`);
                            console.warn(`         ❌ REMOVING from zero-enrollment list`);
                            
                            // Don't add to zeroEnrollmentCourses if it actually has students
                            discrepancyCount++;
                        }
                    } catch (error) {
                        console.error(`      ❌ ERROR verifying ${courseInfo.code} (${courseInfo.id}):`, error);
                        console.warn(`      ⚠️ Will include in list (verification failed)`);
                        // If verification fails, include it but mark as unverified
                        courseInfo.verificationFailed = true;
                        courseInfo.verificationError = error.message;
                        zeroEnrollmentCourses.push(courseInfo);
                    }
                }
                
                console.log(`✅ VERIFICATION COMPLETE:`);
                console.log(`   - ${verifiedCount} courses confirmed with 0 students`);
                console.log(`   - ${discrepancyCount} courses REMOVED (had students)`);
                if (discrepancyCount > 0) {
                    console.warn(`   ⚠️ ${discrepancyCount} course(s) were removed because they actually have students (dataset was incorrect)`);
                }
            }

            console.log(`📊 Courses with 0 student enrollments: ${zeroEnrollmentCourses.length} out of ${winter26CourseIds.length} total courses`);
            console.log('═══════════════════════════════════════════════════════════');
            console.log('📋 DATA SOURCE SUMMARY FOR COURSES WITH 0 ENROLLMENTS:');
            console.log('═══════════════════════════════════════════════════════════');
            console.log(`✅ Course list source: D2L API (${winter26CourseIds.length} courses)`);
            console.log(`✅ Enrollment count source: Enrollment dataset`);
            console.log(`   - Full dataset timestamp: ${new Date(fullTimestamp).toLocaleString()}`);
            if (yesterdayDiff) {
                console.log(`   - Yesterday differential: ${new Date(yesterdayDiff.timestamp).toLocaleString()}`);
            }
            if (todayDiff) {
                console.log(`   - Today differential: ${new Date(todayDiff.timestamp).toLocaleString()}`);
            }
            console.log(`❌ NOT using: EnrollmentsAndWithdrawals CSV files`);
            console.log(`   (Those CSV files are ONLY used for withdrawals count)`);
            console.log(`📊 Result: ${zeroEnrollmentCourses.length} courses with 0 student enrollments`);
            if (zeroEnrollmentCourses.length > 0 && zeroEnrollmentCourses.length <= 10) {
                console.log(`📋 All courses: ${zeroEnrollmentCourses.map(c => c.code).join(', ')}`);
            } else if (zeroEnrollmentCourses.length > 10) {
                console.log(`📋 Sample courses: ${zeroEnrollmentCourses.slice(0, 5).map(c => c.code).join(', ')}... (${zeroEnrollmentCourses.length} total)`);
            }
            console.log('═══════════════════════════════════════════════════════════');

            // Cache both count and course details for the detail page
            localStorage.setItem(cacheKey, zeroEnrollmentCourses.length.toString());
            localStorage.setItem(cacheTimeKey, Date.now().toString());
            localStorage.setItem('courses_zero_students_details', JSON.stringify(zeroEnrollmentCourses));

            return zeroEnrollmentCourses.length;
        } catch (error) {
            console.error('❌ Error getting courses with zero student enrollments:', error);
            return 0;
        }
    },

    /** Orientation course org unit ID (self-registration target) */
    ORIENTATION_ORG_UNIT_ID: 2920769,

    /**
     * Get NEW students (role 101) who have not self-registered in the Orientation course.
     *
     * Definition (per requirements):
     * - Must have an enrollment in the main org unit 1001 (Your College).
     * - Must NOT be enrolled in ANY other org unit except:
     *   - 1001 (institution-level) and
     *   - Orientation course (2920769).
     * - Must NOT be enrolled in the Orientation org unit (2920769).
     * - "New" = first enrollment date within the last year (based on EnrollmentDate column).
     *
     * This intentionally excludes students who are already taking classes (course enrollments),
     * and focuses on brand-new students who only exist at the institution level.
     *
     * @returns {Promise<{count: number, users: Array<{userId: string}>}>}
     */
    async getOrientationNotEnrolled() {
        const cacheKey = 'orientation_not_enrolled';
        const cacheTimeKey = 'orientation_not_enrolled_time';
        const cacheDetailsKey = 'orientation_not_enrolled_details';
        if (typeof D2LApi === 'undefined') {
            return { count: 0, users: [] };
        }
        try {
            const cached = localStorage.getItem(cacheKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);
            if (cached != null && cachedTime && (Date.now() - parseInt(cachedTime, 10)) < 30 * 60 * 1000) {
                const details = localStorage.getItem(cacheDetailsKey);
                const users = details ? JSON.parse(details) : [];
                return { count: parseInt(cached, 10), users };
            }

            console.log('🔍 getOrientationNotEnrolled: loading from full enrollment dataset (system-wide)...');

            const { csvContent: fullCsv } = await this.fetchLatestFullDataset();
            const fullData = this.parseEnrollmentData(fullCsv, [], false);

            const ORG_UNIT_INSTITUTION = '1001';
            const orientationOrgIdStr = String(this.ORIENTATION_ORG_UNIT_ID);

            // Track per-user enrollment info for students
            const userMap = new Map();

            fullData.adds.forEach(enrollment => {
                const roleId = enrollment.roleId;
                const uid = enrollment.userId ? String(enrollment.userId).trim() : '';
                if (!uid) return;

                // Only consider student role 101 for "new student" logic
                if (!(roleId === 101 || roleId === '101' || String(roleId) === '101')) {
                    return;
                }

                // Ignore clearly INACTIVE enrollments when determining "new" status
                const status = (enrollment.status || '').toString().toUpperCase();
                if (status &&
                    (status.includes('INACTIVE') ||
                     status === '0' ||
                     status === 'FALSE')) {
                    return;
                }

                const orgIdStr = enrollment.orgUnitId != null ? String(enrollment.orgUnitId).trim() : '';
                if (!orgIdStr) return;

                const info = userMap.get(uid) || {
                    hasInstitutionEnrollment: false,
                    hasOrientationEnrollment: false,
                    hasOtherEnrollment: false,
                    firstEnrollmentDate: null
                };

                if (orgIdStr === ORG_UNIT_INSTITUTION) {
                    info.hasInstitutionEnrollment = true;
                } else if (orgIdStr === orientationOrgIdStr) {
                    info.hasOrientationEnrollment = true;
                } else {
                    // Any other org unit (courses, sandboxes, etc.) means they're "taking classes"
                    info.hasOtherEnrollment = true;
                }

                if (enrollment.enrollmentDate) {
                    const d = new Date(enrollment.enrollmentDate);
                    if (!isNaN(d.getTime())) {
                        if (!info.firstEnrollmentDate || d < info.firstEnrollmentDate) {
                            info.firstEnrollmentDate = d;
                        }
                    }
                }

                userMap.set(uid, info);
            });

            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

            const notEnrolledIds = [];
            for (const [uid, info] of userMap.entries()) {
                // Must have a 1001 enrollment (Your College institution)
                if (!info.hasInstitutionEnrollment) continue;
                // Must NOT be enrolled in Orientation
                if (info.hasOrientationEnrollment) continue;
                // Must NOT be taking any other courses/orgs
                if (info.hasOtherEnrollment) continue;
                // Must be "new" within the last year
                if (!info.firstEnrollmentDate || info.firstEnrollmentDate < oneYearAgo) continue;
                notEnrolledIds.push(uid);
            }

            const count = notEnrolledIds.length;

            localStorage.setItem(cacheKey, count.toString());
            localStorage.setItem(cacheTimeKey, Date.now().toString());
            localStorage.setItem(cacheDetailsKey, JSON.stringify(notEnrolledIds.map(userId => ({ userId }))));

            console.log(`✅ Orientation: ${count} students (role 101) not yet in Orientation`);
            return { count, users: notEnrolledIds.map(userId => ({ userId })) };
        } catch (error) {
            console.error('❌ getOrientationNotEnrolled error:', error);
            return { count: 0, users: [] };
        }
    }
};

