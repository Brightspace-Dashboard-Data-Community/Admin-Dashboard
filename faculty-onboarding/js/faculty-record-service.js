/**
 * Faculty Record Service
 * Shared JSON CRUD, lifecycle helpers, and priority scoring for Faculty Success Path.
 * Data stored in D2L Manage Files (course shell org unit).
 */

const FacultyRecordService = {
    ORG_UNIT_ID: '1000001',
    API_VERSION: '1.49',
    FOLDER_NEW: 'faculty-logs',
    FOLDER_IN_PROGRESS: 'inprogress-onboarding',
    FOLDER_FINISHED: 'finished-onboarding',
    FACULTY_ORIENTATION_ORG_UNIT_ID: 1000001,
    INSTRUCTOR_ROLE_ID: 102,

    _settings: null,
    _phases: null,
    _autoCheckRules: null,

    get ALL_FOLDERS() {
        return [this.FOLDER_NEW, this.FOLDER_IN_PROGRESS, this.FOLDER_FINISHED];
    },

    async loadConfig() {
        const base = this.getConfigBasePath();
        const fetchJson = async (path) => {
            const resp = await fetch(`${base}config/${path}`, { credentials: 'same-origin' });
            if (!resp.ok) throw new Error(`Failed to load config/${path}`);
            return resp.json();
        };
        if (!this._settings) {
            try {
                this._settings = await fetchJson('settings.json');
                if (this._settings.orgUnitId) this.ORG_UNIT_ID = String(this._settings.orgUnitId);
                if (this._settings.apiVersion) this.API_VERSION = String(this._settings.apiVersion);
                if (this._settings.facultyOrientationOrgUnitId) {
                    this.FACULTY_ORIENTATION_ORG_UNIT_ID = this._settings.facultyOrientationOrgUnitId;
                }
                if (this._settings.folders) {
                    this.FOLDER_NEW = this._settings.folders.new || this.FOLDER_NEW;
                    this.FOLDER_IN_PROGRESS = this._settings.folders.inProgress || this.FOLDER_IN_PROGRESS;
                    this.FOLDER_FINISHED = this._settings.folders.finished || this.FOLDER_FINISHED;
                }
            } catch (e) {
                console.warn('FacultyRecordService: using defaults for settings', e);
                this._settings = {};
            }
        }
        if (!this._phases) {
            try {
                const data = await fetchJson('phases.json');
                this._phases = data.phases || [];
            } catch (e) {
                console.warn('FacultyRecordService: using inline phase fallback', e);
                this._phases = this._getDefaultPhases();
            }
        }
        if (!this._autoCheckRules) {
            try {
                this._autoCheckRules = await fetchJson('auto-check-rules.json');
            } catch (e) {
                this._autoCheckRules = { checks: {} };
            }
        }
        return { settings: this._settings, phases: this._phases, autoCheckRules: this._autoCheckRules };
    },

    getConfigBasePath() {
        const path = window.location.pathname;
        if (path.includes('/faculty-onboarding/')) return '';
        if (path.includes('/reports/')) return '../faculty-onboarding/';
        return 'faculty-onboarding/';
    },

    getPhases() {
        return this._phases || this._getDefaultPhases();
    },

    _getDefaultPhases() {
        return [
            { key: 'phase1', title: 'Phase 1 - Pre-Teaching Setup', items: [{ label: 'Welcome email', type: 'manual' }] }
        ];
    },

    getCsrfToken() {
        const match = document.cookie.match(/(?:^|;\s*)XSRF\.Token=([^;]+)/);
        if (match && match[1]) return decodeURIComponent(match[1]);
        return localStorage.getItem('XSRF.Token') || sessionStorage.getItem('XSRF.Token');
    },

    sanitizeForFilename(value) {
        return String(value || '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    },

    buildFileName(record) {
        const orgDefinedId = String(record.orgDefinedId || '').trim();
        const first = this.sanitizeForFilename(record.firstName);
        const last = this.sanitizeForFilename(record.lastName);
        return `${orgDefinedId}-${first}-${last}.json`;
    },

    toArray(page) {
        if (Array.isArray(page)) return page;
        if (Array.isArray(page?.Items)) return page.Items;
        if (Array.isArray(page?.Objects)) return page.Objects;
        return [];
    },

    async fetchJson(url, options = {}) {
        const csrf = this.getCsrfToken();
        const headers = { ...(options.headers || {}) };
        if (csrf && options.method && options.method !== 'GET') {
            headers['X-Csrf-Token'] = csrf;
        }
        const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Request failed (${response.status}) ${url}\n${text}`);
        }
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('application/json')) return response.json();
        const text = await response.text();
        try { return JSON.parse(text); } catch { return text; }
    },

    buildDefaultLifecycle() {
        const lifecycle = {};
        this.getPhases().forEach((phase) => {
            lifecycle[phase.key] = {};
            (phase.items || []).forEach((item) => {
                const label = typeof item === 'string' ? item : item.label;
                lifecycle[phase.key][label] = false;
            });
        });
        return lifecycle;
    },

    normalizeLifecycle(existingLifecycle) {
        const base = this.buildDefaultLifecycle();
        if (!existingLifecycle || typeof existingLifecycle !== 'object') return base;
        this.getPhases().forEach((phase) => {
            const incoming = existingLifecycle[phase.key] || {};
            (phase.items || []).forEach((item) => {
                const label = typeof item === 'string' ? item : item.label;
                base[phase.key][label] = Boolean(incoming[label]);
            });
        });
        return base;
    },

    buildNewRecord(row, createdDate) {
        const orgDefinedId = String(row.OrgDefinedId || row.orgDefinedId || row.UserId || '').trim();
        const today = createdDate || new Date().toISOString().split('T')[0];
        return {
            orgDefinedId,
            firstName: String(row.FirstName || row.firstName || '').trim(),
            lastName: String(row.LastName || row.lastName || '').trim(),
            username: String(row.UserName || row.username || '').trim(),
            email: String(row.Email || row.email || row.ExternalEmail || '').trim(),
            hireDate: String(row.hireDate || row.HireDate || today).trim(),
            firstTeachingSemester: String(row.firstTeachingSemester || '').trim(),
            division: String(row.division || row.Division || '').trim(),
            employmentType: String(row.employmentType || 'adjunct').trim(),
            assignedSpecialist: String(row.assignedSpecialist || 'eLearning Office').trim(),
            createdDate: today,
            lastModified: new Date().toISOString(),
            currentPhase: 'phase1',
            lifecycle: this.buildDefaultLifecycle(),
            automatedChecks: {
                lastChecked: null,
                hasLoggedIn: false,
                lastLoginDate: null,
                orientationEnrolled: false,
                orientationComplete: false,
                sandboxExists: false,
                profileComplete: false,
                recentActivity: false,
                coursesForSemester: []
            },
            meetings: [],
            emailLog: [],
            reminders: [],
            notes: [{
                date: today,
                author: 'Admin',
                note: 'Faculty onboarding record created.'
            }],
            onboardingStatus: {
                orientationComplete: false,
                sandboxCreated: false,
                trainingComplete: false,
                profileSetupComplete: false
            },
            workflow: { currentFolder: this.FOLDER_NEW, started: false }
        };
    },

    normalizeRecord(data) {
        const record = { ...data };
        record.lifecycle = this.normalizeLifecycle(record.lifecycle);
        record.automatedChecks = record.automatedChecks || {};
        record.meetings = Array.isArray(record.meetings) ? record.meetings : [];
        record.emailLog = Array.isArray(record.emailLog) ? record.emailLog : [];
        record.reminders = Array.isArray(record.reminders) ? record.reminders : [];
        record.notes = Array.isArray(record.notes) ? record.notes : [];
        record.lastModified = new Date().toISOString();
        return record;
    },

    syncOnboardingStatus(record) {
        const p1 = record.lifecycle?.phase1 || {};
        const p2 = record.lifecycle?.phase2 || {};
        const checks = record.automatedChecks || {};
        record.onboardingStatus = {
            orientationComplete: Boolean(checks.orientationComplete || p1['Orientation course enrollment']),
            sandboxCreated: Boolean(checks.sandboxExists || p1['Sandbox course creation']),
            trainingComplete: Boolean(p2['First Week checklist']),
            profileSetupComplete: Boolean(checks.profileComplete || p1['Verify profile setup'])
        };
        return record;
    },

    getLifecycleStats(lifecycle) {
        let totalChecked = 0;
        let totalItems = 0;
        const phaseStats = this.getPhases().map((phase) => {
            const phaseMap = lifecycle[phase.key] || {};
            const items = (phase.items || []).map((i) => (typeof i === 'string' ? i : i.label));
            const checked = items.filter((label) => Boolean(phaseMap[label])).length;
            totalChecked += checked;
            totalItems += items.length;
            return {
                key: phase.key,
                title: phase.title,
                checked,
                total: items.length,
                pct: items.length ? Math.round((checked / items.length) * 100) : 0
            };
        });
        return {
            totalChecked,
            totalItems,
            overallPct: totalItems ? Math.round((totalChecked / totalItems) * 100) : 0,
            phaseStats
        };
    },

    getCurrentPhase(lifecycle) {
        const stats = this.getLifecycleStats(lifecycle);
        for (const p of stats.phaseStats) {
            if (p.checked < p.total) return p.key;
        }
        return 'phase6';
    },

    getFacultyVisibleNextSteps(record, limit = 3) {
        const lifecycle = record.lifecycle || {};
        const steps = [];
        for (const phase of this.getPhases()) {
            for (const item of phase.items || []) {
                const label = typeof item === 'string' ? item : item.label;
                const visible = typeof item === 'object' && item.facultyVisible;
                if (!visible) continue;
                if (!lifecycle[phase.key]?.[label]) {
                    steps.push({ phase: phase.key, phaseTitle: phase.title, label });
                    if (steps.length >= limit) return steps;
                }
            }
        }
        return steps;
    },

    computePriorityScore(record) {
        const weights = this._settings?.priorityWeights || {
            overdueReminder: 10,
            failedAutoCheck: 5,
            daysSinceMeeting: 3,
            noEmailIn14Days: 2
        };
        let score = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        (record.reminders || []).forEach((r) => {
            if (r.completed) return;
            const due = new Date(r.dueDate);
            if (!isNaN(due) && due < today) score += weights.overdueReminder;
        });

        const currentPhase = record.currentPhase || this.getCurrentPhase(record.lifecycle || {});
        const phase = this.getPhases().find((p) => p.key === currentPhase);
        if (phase) {
            (phase.items || []).forEach((item) => {
                if (typeof item === 'object' && item.type === 'auto' && item.check) {
                    const passed = Boolean(record.automatedChecks?.[item.check]);
                    const label = item.label;
                    const checked = record.lifecycle?.[currentPhase]?.[label];
                    if (!passed && !checked) score += weights.failedAutoCheck;
                }
            });
        }

        const meetings = record.meetings || [];
        if (meetings.length) {
            const last = meetings.map((m) => new Date(m.date)).filter((d) => !isNaN(d)).sort((a, b) => b - a)[0];
            if (last) {
                const days = Math.floor((today - last) / (86400000));
                if (days > 14) score += weights.daysSinceMeeting;
            }
        } else {
            score += weights.daysSinceMeeting;
        }

        const emails = record.emailLog || [];
        if (emails.length) {
            const lastEmail = emails.map((e) => new Date(e.date)).filter((d) => !isNaN(d)).sort((a, b) => b - a)[0];
            if (lastEmail) {
                const days = Math.floor((today - lastEmail) / 86400000);
                if (days > 14) score += weights.noEmailIn14Days;
            }
        } else {
            score += weights.noEmailIn14Days;
        }

        return score;
    },

    async listJsonFiles(folder) {
        const url = `/d2l/api/lp/${this.API_VERSION}/${this.ORG_UNIT_ID}/managefiles/?path=/${folder}`;
        const data = await this.fetchJson(url);
        return this.toArray(data)
            .map((item) => item?.FileName || item?.Name || '')
            .filter((name) => name.toLowerCase().endsWith('.json'));
    },

    async getFacultyRecord(folder, fileName) {
        const path = `/${folder}/${fileName}`;
        const url = `/d2l/api/lp/${this.API_VERSION}/${this.ORG_UNIT_ID}/managefiles/file?path=${encodeURIComponent(path)}`;
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) {
            throw new Error(`Failed reading ${fileName} (${response.status})`);
        }
        const text = await response.text();
        const data = JSON.parse(text);
        return { folder, fileName, data: this.normalizeRecord(data) };
    },

    async loadAllRecords() {
        await this.loadConfig();
        const loadedByFolder = await Promise.all(
            this.ALL_FOLDERS.map(async (folder) => {
                try {
                    const files = await this.listJsonFiles(folder);
                    const loaded = await Promise.all(
                        files.map((name) =>
                            this.getFacultyRecord(folder, name).catch((err) => {
                                console.warn(`Skipped ${folder}/${name}:`, err.message);
                                return null;
                            })
                        )
                    );
                    return loaded.filter(Boolean);
                } catch (err) {
                    console.warn(`Skipping folder ${folder}:`, err.message);
                    return [];
                }
            })
        );
        return loadedByFolder.flat();
    },

    async ensureFolderExists(folderName, csrfToken) {
        const payload = { Path: `/${folderName}` };
        const url = `/d2l/api/lp/${this.API_VERSION}/${this.ORG_UNIT_ID}/managefiles/folder`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'X-Csrf-Token': csrfToken, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            credentials: 'same-origin'
        });
        if (response.ok || response.status === 409 || response.status === 400) return;
        const text = await response.text().catch(() => '');
        throw new Error(`Could not ensure folder ${folderName} (${response.status}) ${text}`);
    },

    async uploadJsonToCourseFile(fileName, jsonObject, targetFolder) {
        const csrfToken = this.getCsrfToken();
        if (!csrfToken) throw new Error('Missing XSRF token.');
        await this.ensureFolderExists(targetFolder, csrfToken);

        const record = this.syncOnboardingStatus(this.normalizeRecord(jsonObject));
        record.currentPhase = this.getCurrentPhase(record.lifecycle);
        record.lastModified = new Date().toISOString();
        record.workflow = {
            ...(record.workflow || {}),
            currentFolder: targetFolder
        };

        const jsonText = JSON.stringify(record, null, 2);
        const fileBlob = new Blob([jsonText], { type: 'application/json' });

        const initUrl = `/d2l/api/lp/${this.API_VERSION}/${this.ORG_UNIT_ID}/managefiles/file/upload`;
        const initResp = await fetch(initUrl, {
            method: 'POST',
            headers: {
                'X-Csrf-Token': csrfToken,
                'X-Upload-Content-Type': 'application/json',
                'X-Upload-Content-Length': String(fileBlob.size),
                'X-Upload-File-Name': fileName
            },
            credentials: 'same-origin'
        });

        const locationHeader = initResp.headers.get('Location');
        const uploadLocation = locationHeader
            ? new URL(locationHeader, window.location.origin).toString()
            : initResp.url;

        if (!uploadLocation || !uploadLocation.includes('/d2l/upload/')) {
            throw new Error(`Unable to determine upload location. Init status: ${initResp.status}`);
        }

        const chunkResp = await fetch(uploadLocation, {
            method: 'POST',
            headers: {
                'X-Csrf-Token': csrfToken,
                'Content-Type': 'application/json',
                'Content-Range': `bytes 0-${fileBlob.size - 1}/${fileBlob.size}`
            },
            body: fileBlob,
            credentials: 'same-origin'
        });
        if (!chunkResp.ok) {
            const text = await chunkResp.text().catch(() => '');
            throw new Error(`Chunk upload failed (${chunkResp.status}) ${text}`);
        }

        const fileKey = uploadLocation.replace(/\/+$/, '').split('/').pop();
        const saveUrl = `/d2l/api/lp/${this.API_VERSION}/${this.ORG_UNIT_ID}/managefiles/file/save?overwriteFile=true`;
        const formData = new URLSearchParams();
        formData.set('fileKey', fileKey);
        formData.set('relativePath', targetFolder);
        formData.set('name', fileName);

        const saveResp = await fetch(saveUrl, {
            method: 'POST',
            headers: {
                'X-Csrf-Token': csrfToken,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString(),
            credentials: 'same-origin'
        });
        if (!saveResp.ok) {
            const text = await saveResp.text().catch(() => '');
            throw new Error(`Save failed (${saveResp.status}) ${text}`);
        }
        return record;
    },

    async saveRecord(record, fileName, targetFolder) {
        return this.uploadJsonToCourseFile(fileName, record, targetFolder);
    },

    logEmail(record, templateKey, sentBy) {
        record.emailLog = record.emailLog || [];
        record.emailLog.push({
            date: new Date().toISOString().split('T')[0],
            template: templateKey,
            sentBy: sentBy || 'Admin'
        });
        return record;
    },

    addMeeting(record, meeting) {
        record.meetings = record.meetings || [];
        record.meetings.push({
            date: meeting.date || new Date().toISOString().split('T')[0],
            type: meeting.type || 'general',
            duration: meeting.duration || 60,
            notes: meeting.notes || '',
            attendees: meeting.attendees || []
        });
        return record;
    },

    applyAutoCheckResults(record, results) {
        record.automatedChecks = { ...(record.automatedChecks || {}), ...results, lastChecked: new Date().toISOString().split('T')[0] };
        const rules = this._autoCheckRules?.checks || {};
        Object.entries(rules).forEach(([checkKey, rule]) => {
            const passed = Boolean(results[checkKey]);
            (rule.lifecycleMappings || []).forEach(({ phase, item }) => {
                if (!record.lifecycle[phase]) record.lifecycle[phase] = {};
                const shouldCheck = rule.invertForPass ? passed : passed;
                if (shouldCheck) record.lifecycle[phase][item] = true;
            });
        });
        return this.syncOnboardingStatus(record);
    },

    exportRecordsToCsv(records) {
        const headers = [
            'orgDefinedId', 'firstName', 'lastName', 'username', 'email', 'division',
            'firstTeachingSemester', 'currentPhase', 'overallPct', 'folder', 'assignedSpecialist',
            'priorityScore', 'lastModified'
        ];
        const rows = records.map((r) => {
            const stats = this.getLifecycleStats(r.data.lifecycle || {});
            return [
                r.data.orgDefinedId,
                r.data.firstName,
                r.data.lastName,
                r.data.username,
                r.data.email || '',
                r.data.division || '',
                r.data.firstTeachingSemester || '',
                r.data.currentPhase || this.getCurrentPhase(r.data.lifecycle || {}),
                stats.overallPct,
                r.folder,
                r.data.assignedSpecialist || '',
                this.computePriorityScore(r.data),
                r.data.lastModified || ''
            ];
        });
        const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        return [headers.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
    }
};

if (typeof window !== 'undefined') {
    window.FacultyRecordService = FacultyRecordService;
}
