/**
 * D2L API Wrapper
 * Handles fetching data from D2L Brightspace APIs.
 * Supports fallback to mock data for local development.
 */

const D2LApi = {
    // Base API version path
    apiBase: '/d2l/api/lp/1.45',
    apiVersion: '1.49', // Use newer API version for stats

    /**
     * Get authentication token from localStorage or cookies
     */
    _getAuthHeaders() {
        const token = localStorage.getItem('XSRF.Token');
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        
        if (token) {
            headers['X-CSRF-Token'] = token;
        }
        
        return headers;
    },

    /**
     * Make authenticated API request
     */
    async _fetch(endpoint, options = {}) {
        const headers = this._getAuthHeaders();
        const response = await fetch(endpoint, {
            ...options,
            headers: { ...headers, ...options.headers },
            credentials: 'include'
        });

        // Check for new XSRF token
        const newToken = response.headers.get('x-csrf-token');
        if (newToken) {
            localStorage.setItem('XSRF.Token', newToken);
        }

        if (!response.ok) {
            let detail = '';
            try {
                detail = (await response.text()).trim();
            } catch (e) {
                detail = '';
            }
            const suffix = detail ? ` — ${detail.slice(0, 400)}` : '';
            const error = new Error(`API Error: ${response.status} ${response.statusText}${suffix}`.trim());
            error.status = response.status;
            throw error;
        }

        // Handle empty responses (e.g., 204 No Content or empty body)
        const text = await response.text();
        if (!text || text.trim() === '') {
            // Return empty object for PUT/POST requests that don't return data
            // Return empty array for GET requests that return empty lists
            return (!options.method || options.method.toUpperCase() === 'GET') ? [] : {};
        }

        // Try to parse as JSON
        try {
            return JSON.parse(text);
        } catch (jsonError) {
            // If parsing fails, return the text as-is
            console.warn('D2LApi: Response is not valid JSON, returning as text', jsonError);
            return text;
        }
    },

    /**
     * Fetch user information from WhoAmI endpoint
     * @returns {Promise<{FirstName: string, LastName: string, Identifier: string}>}
     */
    async getWhoAmI() {
        try {
            return await this._fetch(`${this.apiBase}/users/whoami`);
        } catch (error) {
            console.warn('D2LApi: Failed to fetch WhoAmI data, using fallback.', error);
            return {
                "Identifier": "12345",
                "FirstName": "Not",
                "LastName": "Authenticated",
                "Pronouns": "",
                "UniqueName": "unknownname",
                "ProfileIdentifier": "notvalid"
            };
        }
    },

    /**
     * Get organization information
     * @returns {Promise<{Identifier: number, Name: string}>}
     */
    async getOrganizationInfo() {
        try {
            return await this._fetch(`/d2l/api/lp/${this.apiVersion}/organization/info`);
        } catch (error) {
            console.error('D2LApi: Failed to fetch organization info', error);
            throw error;
        }
    },

    /**
     * Fetch paginated data from D2L API
     * Handles pagination automatically
     * @param {string} endpoint - API endpoint
     * @param {number} pageSize - Items per page (default 100)
     * @returns {Promise<Array>} All items from all pages
     */
    async fetchPaginatedData(endpoint, pageSize = 100) {
        try {
            const allItems = [];
            let bookmark = null;
            let hasMore = true;
            let pageCount = 0;
            const maxPages = 100; // Safety limit

            while (hasMore && pageCount < maxPages) {
                pageCount++;
                let url = endpoint;
                
                // Build URL with pagination
                const separator = endpoint.includes('?') ? '&' : '?';
                url += `${separator}pageSize=${pageSize}`;
                
                if (bookmark) {
                    url += `&bookmark=${encodeURIComponent(bookmark)}`;
                }

                const response = await this._fetch(url);
                
                // Handle different response formats
                let items = [];
                if (response.Objects && Array.isArray(response.Objects)) {
                    items = response.Objects;
                } else if (Array.isArray(response)) {
                    items = response;
                } else if (response.Items && Array.isArray(response.Items)) {
                    items = response.Items;
                }

                allItems.push(...items);

                // Check if there's more data
                // D2L API typically uses Next or NextPageUrl
                if (response.Next) {
                    bookmark = response.Next;
                } else if (response.NextPageUrl) {
                    // Extract bookmark from NextPageUrl if needed
                    const nextUrl = new URL(response.NextPageUrl, window.location.origin);
                    bookmark = nextUrl.searchParams.get('bookmark');
                    if (!bookmark) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }
            }

            if (pageCount >= maxPages) {
                console.warn('D2LApi: Reached max pages limit, some data may be missing');
            }

            return allItems;
        } catch (error) {
            console.error('D2LApi: Error fetching paginated data:', error);
            throw error;
        }
    },

    /**
     * Get total count of users by role
     * Note: D2L doesn't have a direct endpoint for this, so we'll need to use datasets or paginate
     * For now, we'll use a simplified approach that may need adjustment
     * @param {number} roleId - Role ID (101=Student, 102=Instructor, 100=Admin)
     * @returns {Promise<number>}
     */
    async getUserCountByRole(roleId) {
        try {
            // Try to get users dataset first (more efficient)
            const datasets = await this._fetch(`/d2l/api/lp/${this.apiVersion}/datasets/bds`);
            const usersDataset = datasets.Objects?.find(d => 
                d.Full?.Name?.toLowerCase() === 'users'
            );

            if (usersDataset) {
                // Use dataset approach if available
                const extracts = await this._fetch(usersDataset.Full.ExtractsLink);
                // This would require processing the dataset, which is complex
                // For now, return a placeholder that indicates we need a different approach
                console.log('Users dataset found, but counting requires dataset processing');
            }

            // Fallback: This is a simplified approach - in production you'd want to use datasets
            // or paginate through users endpoint
            console.warn(`getUserCountByRole: Direct counting not implemented. RoleId: ${roleId}`);
            return 0;
        } catch (error) {
            console.error(`D2LApi: Failed to get user count for role ${roleId}`, error);
            return 0;
        }
    },

    /**
     * Get total active courses count from the current target semesters
     * (defaults to WINTER/SPRING/FALL of the most recent academic year, per
     * the canonical allowlist in js/semester-config.js).
     * When semesterCode is provided, returns count for that semester only.
     * @param {string|null} semesterCode - Optional: e.g. '26/WI', '26/SP', '26/FA'
     * @returns {Promise<number>}
     */
    async getActiveCoursesCount(semesterCode = null) {
        try {
            const orgInfo = await this.getOrganizationInfo();

            const semestersRaw = await this.fetchPaginatedData(
                `/d2l/api/lp/${this.apiVersion}/orgstructure/${orgInfo.Identifier}/descendants/?ouTypeId=5`
            );
            const semesters = Array.isArray(semestersRaw) ? semestersRaw : [];

            if (semesters.length === 0) {
                return 0;
            }

            // Filter against the canonical allowlist when available so the
            // counter stays in sync with every dropdown across the dashboard.
            const allowed = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
                ? SemesterConfig.filterAllowed(semesters)
                : semesters;

            const wantCode = semesterCode != null
                ? String(semesterCode).toUpperCase().replace(/\s/g, '').replace('/', '')
                : null;

            const targetSemesters = allowed.filter(semester => {
                const upName = (semester.Name || '').toUpperCase();
                const upCode = (semester.Code || '').toUpperCase().replace('/', '');
                if (wantCode) return upCode === wantCode || upName.includes(wantCode);
                // No code requested → use the newest WI/SP/FA from the allowlist.
                // (Sandbox excluded.)
                return upCode !== 'SANDBOX';
            });

            if (targetSemesters.length === 0) {
                console.warn(`D2LApi: No matching semesters found${semesterCode ? ` for ${semesterCode}` : ''}`);
                console.log('Available semesters:', semesters.map(s => s.Name));
                return 0;
            }

            console.log(`D2LApi: Found ${targetSemesters.length} target semester(s):`,
                targetSemesters.map(s => s.Name));

            let totalCourses = 0;
            for (const semester of targetSemesters) {
                try {
                    let courses = await this.fetchPaginatedData(
                        `/d2l/api/lp/${this.apiVersion}/orgstructure/${semester.Identifier}/children/`
                    );
                    courses = Array.isArray(courses) ? courses.filter(c => c.Type?.Id === 3 || c.Type?.Code === 'Course Offering') : [];

                    if (courses.length === 0) {
                        courses = await this.fetchPaginatedData(
                            `/d2l/api/lp/${this.apiVersion}/orgstructure/${semester.Identifier}/descendants/?ouTypeId=3`
                        );
                        courses = Array.isArray(courses) ? courses : [];
                    }

                    if (Array.isArray(courses)) {
                        const activeCourses = courses.filter(c => {
                            if (c.Type?.Code !== 'Course Offering') return false;
                            const courseName = (c.Name || '').toUpperCase();
                            const courseCode = (c.Code || '').toUpperCase();
                            if (courseName.includes('MERGED')) return false;
                            if (courseCode.includes('CXLD')) return false;
                            return true;
                        });
                        console.log(`D2LApi: ${semester.Name}: ${activeCourses.length} active courses`);
                        totalCourses += activeCourses.length;
                    }
                } catch (err) {
                    console.warn(`Failed to fetch courses for semester ${semester.Name}`, err);
                }
            }

            console.log(`D2LApi: Total active courses${semesterCode ? ` (${semesterCode})` : ' (allowlist)'}: ${totalCourses}`);
            return totalCourses;
        } catch (error) {
            console.error('D2LApi: Failed to get active courses count', error);
            return 0;
        }
    },

    /**
     * Get total enrollments count
     * This is an approximation - getting exact count would require iterating all courses
     * @returns {Promise<number>}
     */
    async getTotalEnrollmentsCount() {
        try {
            // This is a placeholder - actual implementation would need to:
            // 1. Get all courses
            // 2. For each course, get enrollments
            // 3. Sum them up
            // This is expensive, so we might want to cache this or use datasets
            console.warn('getTotalEnrollmentsCount: Not fully implemented - requires iterating all courses');
            return 0;
        } catch (error) {
            console.error('D2LApi: Failed to get enrollments count', error);
            return 0;
        }
    },

    /**
     * Get count of Sandbox courses (courses with "Sandbox" in the title)
     * @returns {Promise<number>}
     */
    async getSandboxCoursesCount() {
        try {
            const orgInfo = await this.getOrganizationInfo();
            
            const semestersRaw = await this._fetch(
                `/d2l/api/lp/${this.apiVersion}/orgstructure/${orgInfo.Identifier}/descendants/?ouTypeId=5`
            );

            if (!Array.isArray(semestersRaw) || semestersRaw.length === 0) {
                return 0;
            }

            const semesters = (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed)
                ? SemesterConfig.filterAllowed(semestersRaw)
                : semestersRaw;

            let totalCourses = 0;
            for (const semester of semesters) {
                try {
                    const courses = await this._fetch(
                        `/d2l/api/lp/${this.apiVersion}/orgstructure/${semester.Identifier}/children/`
                    );

                    if (Array.isArray(courses)) {
                        const sandboxCourses = courses.filter(c => {
                            // Must be a Course Offering
                            if (c.Type?.Code !== 'Course Offering') {
                                return false;
                            }

                            const courseName = (c.Name || '').toUpperCase();
                            // Include if "SANDBOX" appears anywhere in the name
                            return courseName.includes('SANDBOX');
                        });
                        totalCourses += sandboxCourses.length;
                    }
                } catch (err) {
                    console.warn(`Failed to fetch courses for semester ${semester.Name}`, err);
                }
            }

            console.log(`D2LApi: Total sandbox courses: ${totalCourses}`);
            return totalCourses;
        } catch (error) {
            console.error('D2LApi: Failed to get sandbox courses count', error);
            return 0;
        }
    },

    /**
     * Get count of Merged courses (courses with "Merged" in the title)
     * @param {string|null} semesterCode - Optional: '26/FA', '26/SP', '26/WI' to filter to one semester; null = all semesters
     * @returns {Promise<number>}
     */
    async getMergedCoursesCount(semesterCode = null) {
        try {
            const orgInfo = await this.getOrganizationInfo();
            let semesters = await this._fetch(
                `/d2l/api/lp/${this.apiVersion}/orgstructure/${orgInfo.Identifier}/descendants/?ouTypeId=5`
            );
            if (!Array.isArray(semesters)) semesters = [];

            if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
                semesters = SemesterConfig.filterAllowed(semesters);
            }

            if (semesterCode != null) {
                const code = String(semesterCode).toUpperCase().replace(/\s/g, '').replace('/', '');
                semesters = semesters.filter(s => {
                    const upCode = (s.Code || '').toUpperCase().replace('/', '');
                    const upName = (s.Name || '').toUpperCase();
                    return upCode === code || upName.includes(code);
                });
            }

            if (semesters.length === 0) {
                return 0;
            }

            let totalCourses = 0;
            for (const semester of semesters) {
                try {
                    const courses = await this._fetch(
                        `/d2l/api/lp/${this.apiVersion}/orgstructure/${semester.Identifier}/children/`
                    );

                    if (Array.isArray(courses)) {
                        const mergedCourses = courses.filter(c => {
                            if (c.Type?.Code !== 'Course Offering') return false;
                            return (c.Name || '').toUpperCase().includes('MERGED');
                        });
                        totalCourses += mergedCourses.length;
                    }
                } catch (err) {
                    console.warn(`Failed to fetch courses for semester ${semester.Name}`, err);
                }
            }

            console.log(`D2LApi: Total merged courses${semesterCode ? ` (${semesterCode})` : ''}: ${totalCourses}`);
            return totalCourses;
        } catch (error) {
            console.error('D2LApi: Failed to get merged courses count', error);
            return 0;
        }
    },

    /**
     * Get count of Cancelled courses (courses with "CXLD" in the course code)
     * @param {string|null} semesterCode - Optional: '26/FA', '26/SP', '26/WI' to filter to one semester; null = all semesters
     * @returns {Promise<number>}
     */
    async getCancelledCoursesCount(semesterCode = null) {
        try {
            const orgInfo = await this.getOrganizationInfo();
            let semesters = await this._fetch(
                `/d2l/api/lp/${this.apiVersion}/orgstructure/${orgInfo.Identifier}/descendants/?ouTypeId=5`
            );
            if (!Array.isArray(semesters)) semesters = [];

            if (typeof SemesterConfig !== 'undefined' && SemesterConfig.filterAllowed) {
                semesters = SemesterConfig.filterAllowed(semesters);
            }

            if (semesterCode != null) {
                const code = String(semesterCode).toUpperCase().replace(/\s/g, '').replace('/', '');
                semesters = semesters.filter(s => {
                    const upCode = (s.Code || '').toUpperCase().replace('/', '');
                    const upName = (s.Name || '').toUpperCase();
                    return upCode === code || upName.includes(code);
                });
            }

            if (semesters.length === 0) {
                return 0;
            }

            let totalCourses = 0;
            for (const semester of semesters) {
                try {
                    const courses = await this._fetch(
                        `/d2l/api/lp/${this.apiVersion}/orgstructure/${semester.Identifier}/children/`
                    );

                    if (Array.isArray(courses)) {
                        const cancelledCourses = courses.filter(c => {
                            if (c.Type?.Code !== 'Course Offering') return false;
                            return (c.Code || '').toUpperCase().includes('CXLD');
                        });
                        totalCourses += cancelledCourses.length;
                    }
                } catch (err) {
                    console.warn(`Failed to fetch courses for semester ${semester.Name}`, err);
                }
            }

            console.log(`D2LApi: Total cancelled courses${semesterCode ? ` (${semesterCode})` : ''}: ${totalCourses}`);
            return totalCourses;
        } catch (error) {
            console.error('D2LApi: Failed to get cancelled courses count', error);
            return 0;
        }
    }
};
