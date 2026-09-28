/**
 * User Data Service
 * Fetches user data from D2L DataHub full dataset (pulled once a week)
 * Similar to old dashboard's datahub-integration.js but simplified for dashboard stats
 */

const UserDataService = {
    // Dataset ID for Users dataset
    USERS_DATASET_ID: 'b21a6414-38f8-4da8-9a65-8b5586f9fe3b',
    USERS_PLUGIN_ID: '1d6d722e-b572-456f-97c1-d526570daa6b',
    API_VERSION: '1.43',
    _userIndex: null,

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
     * Fetch the latest full user dataset
     * Returns CSV content and timestamp
     */
    async fetchLatestFullDataset() {
        try {
            console.log('📥 Fetching latest full user dataset...');
            
            // Get dataset extracts
            const url = `/d2l/api/lp/${this.API_VERSION}/datasets/bds/${this.USERS_DATASET_ID}/plugins/${this.USERS_PLUGIN_ID}/extracts?type=full`;
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
            console.log('📅 Latest dataset created:', latestExtract.CreatedDate);

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
            
            console.log('✅ Dataset downloaded and extracted successfully');
            return { csvContent, timestamp };
        } catch (error) {
            console.error('❌ Error fetching full user dataset:', error);
            throw error;
        }
    },

    /**
     * Parse CSV content and count users by role
     * Returns counts for students, instructors, admins, and inactive users
     */
    parseUserCounts(csvContent) {
        try {
            const lines = csvContent.split('\n').filter(line => line.trim());
            if (lines.length < 2) {
                throw new Error('CSV file is empty or has no data rows');
            }

            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            console.log('📋 CSV Headers:', headers);

            // Find column indices
            const orgRoleIdIndex = headers.findIndex(h => 
                h.toLowerCase().includes('orgroleid') || h.toLowerCase().includes('role')
            );
            const lastAccessedIndex = headers.findIndex(h => 
                h.toLowerCase().includes('lastaccessed') || h.toLowerCase().includes('last_accessed')
            );

            if (orgRoleIdIndex === -1) {
                throw new Error('Could not find OrgRoleId column in CSV');
            }

            // Initialize counts
            const counts = {
                students: 0,
                instructors: 0,
                admins: 0,
                inactive: 0
            };

            // Calculate one year ago for inactive check
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

            // Process each user row
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;

                // Parse CSV line (handling quoted values)
                const values = this.parseCSVLine(line);
                
                if (values.length <= orgRoleIdIndex) continue;

                const orgRoleId = String(values[orgRoleIdIndex] || '').trim();
                
                // Check if inactive (if LastAccessed column exists)
                let isInactive = false;
                if (lastAccessedIndex !== -1 && values[lastAccessedIndex]) {
                    try {
                        const lastAccessed = new Date(values[lastAccessedIndex]);
                        if (!isNaN(lastAccessed.getTime()) && lastAccessed < oneYearAgo) {
                            isInactive = true;
                            counts.inactive++;
                            continue; // Skip role counting for inactive users
                        }
                    } catch (e) {
                        // Ignore date parsing errors
                    }
                }

                // Count by role
                switch (orgRoleId) {
                    case '101':
                        counts.students++;
                        break;
                    case '102':
                        counts.instructors++;
                        break;
                    case '100':
                        counts.admins++;
                        break;
                }
            }

            const total = counts.students + counts.instructors + counts.admins;
            console.log('📊 User counts:', {
                students: counts.students,
                instructors: counts.instructors,
                admins: counts.admins,
                inactive: counts.inactive,
                total: total
            });

            return counts;
        } catch (error) {
            console.error('❌ Error parsing user counts:', error);
            throw error;
        }
    },

    /**
     * Parse a CSV line handling quoted values
     */
    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim()); // Add last value
        
        return values;
    },

    /**
     * Get user counts from the latest full dataset
     * This is the main method to call from the dashboard
     */
    async getUserCounts() {
        try {
            // Check if we have cached data from today
            const today = new Date().toISOString().split('T')[0];
            const cachedDate = localStorage.getItem('userCountsDate');
            const cachedCounts = localStorage.getItem('userCounts');

            if (cachedDate === today && cachedCounts) {
                console.log('📦 Using cached user counts from today');
                return JSON.parse(cachedCounts);
            }

            // Fetch fresh data
            console.log('🔄 Fetching fresh user data from dataset...');
            const { csvContent, timestamp } = await this.fetchLatestFullDataset();
            const counts = this.parseUserCounts(csvContent);

            // Cache the results
            localStorage.setItem('userCounts', JSON.stringify(counts));
            localStorage.setItem('userCountsDate', today);
            localStorage.setItem('userCountsTimestamp', timestamp.toISOString());

            return counts;
        } catch (error) {
            console.error('❌ Error getting user counts:', error);
            
            // Return cached data if available, even if old
            const cachedCounts = localStorage.getItem('userCounts');
            if (cachedCounts) {
                console.warn('⚠️ Using cached user counts due to error');
                return JSON.parse(cachedCounts);
            }

            // Return zeros if no data available
            return {
                students: 0,
                instructors: 0,
                admins: 0,
                inactive: 0
            };
        }
    },

    /**
     * Build (and cache in-memory) an index of user details keyed by UserId.
     * Used for detail pages like Orientation Not Enrolled.
     * Fields: OrgDefinedId, FirstName, LastName, Email, DateCreated.
     * NOTE: This parses the Users dataset once per page load; it is not stored in localStorage
     * to avoid very large payloads.
     */
    async getUserIndex() {
        if (this._userIndex) {
            return this._userIndex;
        }

        try {
            console.log('📥 Building user index from Users dataset for detail lookups...');
            const { csvContent } = await this.fetchLatestFullDataset();
            const lines = csvContent.split('\n').filter(line => line.trim());
            if (lines.length < 2) {
                console.warn('UserDataService.getUserIndex: dataset is empty');
                this._userIndex = {};
                return this._userIndex;
            }

            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            const lower = headers.map(h => h.toLowerCase());

            const userIdIndex = lower.findIndex(h => h === 'userid' || h === 'user_id');
            const orgDefinedIdIndex = lower.findIndex(h => h === 'orgdefinedid' || h === 'org_defined_id');
            const firstNameIndex = lower.findIndex(h => h === 'firstname' || h === 'first_name');
            const lastNameIndex = lower.findIndex(h => h === 'lastname' || h === 'last_name');
            const emailIndex = lower.findIndex(h => h === 'email' || h === 'externalemail' || h === 'external_email');
            const createdIndex = lower.findIndex(h => h === 'datecreated' || h === 'createddate' || h === 'created_date');

            if (userIdIndex === -1) {
                console.warn('UserDataService.getUserIndex: UserId column not found; index will be empty.');
                this._userIndex = {};
                return this._userIndex;
            }

            const index = {};

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                const values = this.parseCSVLine(line);
                if (values.length <= userIdIndex) continue;

                const userId = String(values[userIdIndex] || '').trim();
                if (!userId) continue;

                index[userId] = {
                    orgDefinedId: orgDefinedIdIndex !== -1 ? String(values[orgDefinedIdIndex] || '').trim() : '',
                    firstName: firstNameIndex !== -1 ? String(values[firstNameIndex] || '').trim() : '',
                    lastName: lastNameIndex !== -1 ? String(values[lastNameIndex] || '').trim() : '',
                    email: emailIndex !== -1 ? String(values[emailIndex] || '').trim() : '',
                    dateCreated: createdIndex !== -1 ? String(values[createdIndex] || '').trim() : ''
                };
            }

            this._userIndex = index;
            console.log(`✅ User index built with ${Object.keys(index).length} entries`);
            return this._userIndex;
        } catch (error) {
            console.error('❌ UserDataService.getUserIndex error:', error);
            this._userIndex = {};
            return this._userIndex;
        }
    },

    /**
     * Get user detail records for the specified Brightspace UserIds.
     * @param {string[]} userIds
     * @returns {Promise<Array<{userId, orgDefinedId, firstName, lastName, email, dateCreated}>>}
     */
    async getUserDetailsByIds(userIds) {
        if (!Array.isArray(userIds) || userIds.length === 0) return [];
        const index = await this.getUserIndex();
        return userIds.map(id => {
            const key = String(id || '').trim();
            const details = index[key] || {};
            return {
                userId: key,
                orgDefinedId: details.orgDefinedId || '',
                firstName: details.firstName || '',
                lastName: details.lastName || '',
                email: details.email || '',
                dateCreated: details.dateCreated || ''
            };
        });
    }
};

