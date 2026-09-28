/**
 * Faculty Success Path — Command Center page logic
 */

const CommandCenter = {
    state: {
        records: [],
        filtered: [],
        selected: null,
        selectedFileName: '',
        selectedFolder: '',
        notes: [],
        lifecycle: {}
    },

    async init() {
        const slot = document.getElementById('loadingSlot');
        if (slot && typeof LoadingUtils !== 'undefined') {
            slot.appendChild(LoadingUtils.createLoadingBar());
        }
        await FacultyRecordService.loadConfig();
        await FacultyEmailTemplates.loadTemplates();
        this.bindEvents();
        await this.refresh();
    },

    bindEvents() {
        document.getElementById('refreshBtn')?.addEventListener('click', () => this.refresh());
        document.getElementById('searchInput')?.addEventListener('input', () => this.renderResults());
        document.getElementById('stageFilter')?.addEventListener('change', () => this.renderResults());
        document.getElementById('addNoteBtn')?.addEventListener('click', () => this.addNote());
        document.getElementById('saveBtn')?.addEventListener('click', () => this.saveToInProgress());
        document.getElementById('toFinishedBtn')?.addEventListener('click', () => this.moveToFinished());
        document.getElementById('runAutoCheckBtn')?.addEventListener('click', () => this.runSingleAutoCheck());
        document.getElementById('addMeetingBtn')?.addEventListener('click', () => this.addMeeting());
    },

    showStatus(msg, type) {
        const el = document.getElementById('status');
        if (!el) return;
        el.className = `status-message show ${type || 'info'}`;
        el.innerHTML = msg;
    },

    setLoading(isLoading, message = 'Loading faculty records…') {
        if (typeof LoadingUtils === 'undefined') return;
        if (isLoading) {
            LoadingUtils.updateLoadingBar(18, message);
        } else {
            LoadingUtils.hideLoadingBar();
        }
    },

    async refresh() {
        this.setLoading(true);
        this.showStatus('Loading faculty records…', 'info');
        try {
            this.state.records = await FacultyRecordService.loadAllRecords();
            this.state.filtered = this.state.records.slice();
            this.renderDashboard();
            this.renderResults();
            document.getElementById('recordCount').textContent = `${this.state.records.length} record(s)`;
            this.showStatus(`Loaded ${this.state.records.length} faculty record(s).`, 'success');
        } catch (err) {
            this.showStatus(`Could not load records: ${err.message}`, 'error');
        } finally {
            this.setLoading(false);
        }
    },

    renderDashboard() {
        const active = this.state.records.filter(
            (r) => r.folder !== FacultyRecordService.FOLDER_FINISHED
        );
        const funnel = OnboardingQueueService.getFunnelStats(this.state.records);
        const phaseCounts = funnel.phaseCounts;

        document.getElementById('statNew').textContent = funnel.newCount;
        document.getElementById('statInProgress').textContent = funnel.inProgress;
        document.getElementById('statFinished').textContent = funnel.finished;

        const phaseBoard = document.getElementById('phaseBoard');
        if (phaseBoard) {
            phaseBoard.innerHTML = FacultyRecordService.getPhases().map((p) => `
                <div class="fsp-stat">
                    <div class="fsp-stat-value">${phaseCounts[p.key] || 0}</div>
                    <div class="fsp-stat-label">${p.title.split('-')[0].trim()}</div>
                </div>
            `).join('');
        }

        const queueEl = document.getElementById('actionQueue');
        if (queueEl) {
            const top = active
                .map((r) => ({ ...r, score: FacultyRecordService.computePriorityScore(r.data) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 8);
            queueEl.innerHTML = top.length
                ? top.map((r) => `
                    <div class="fsp-queue-item" data-file="${r.fileName}" data-folder="${r.folder}">
                        <strong>${r.data.firstName} ${r.data.lastName}</strong>
                        ${r.score > 5 ? '<span class="fsp-tag priority">priority</span>' : ''}
                        <div class="fsp-meta">Score ${r.score} · ${r.folder}</div>
                    </div>
                `).join('')
                : '<div class="fsp-meta">No active records.</div>';
            queueEl.querySelectorAll('.fsp-queue-item').forEach((el) => {
                el.addEventListener('click', () => {
                    const rec = this.state.records.find(
                        (r) => r.fileName === el.dataset.file && r.folder === el.dataset.folder
                    );
                    if (rec) this.selectRecord(rec);
                });
            });
        }

        const remindersEl = document.getElementById('remindersList');
        if (remindersEl) {
            const reminders = OnboardingQueueService.getUpcomingReminders(active, 14);
            remindersEl.innerHTML = reminders.length
                ? reminders.slice(0, 6).map((r) => `
                    <div class="fsp-meta ${r.overdue ? 'fsp-reminder-overdue' : ''}">
                        ${r.overdue ? '⚠ ' : ''}${r.name} — ${r.type} (${r.dueDate})
                    </div>
                `).join('')
                : '<div class="fsp-meta">No reminders due in the next 14 days.</div>';
        }
    },

    filterRecords() {
        const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
        const stage = document.getElementById('stageFilter')?.value || 'all';
        const startedIds = new Set(
            this.state.records
                .filter((r) => r.folder === FacultyRecordService.FOLDER_IN_PROGRESS)
                .map((r) => String(r.data.orgDefinedId || '').trim())
                .filter(Boolean)
        );

        const matches = ({ data }) =>
            String(data.firstName || '').toLowerCase().includes(q) ||
            String(data.lastName || '').toLowerCase().includes(q) ||
            String(data.orgDefinedId || '').toLowerCase().includes(q) ||
            String(data.username || '').toLowerCase().includes(q);

        let list = this.state.records.slice();
        if (stage === 'new') {
            list = list.filter((r) => r.folder === FacultyRecordService.FOLDER_NEW && !startedIds.has(String(r.data.orgDefinedId || '').trim()));
        } else if (stage === 'started') {
            list = list.filter((r) => r.folder === FacultyRecordService.FOLDER_IN_PROGRESS);
        } else if (stage === 'finished') {
            list = list.filter((r) => r.folder === FacultyRecordService.FOLDER_FINISHED);
        }
        if (q) list = list.filter(matches);
        list.sort((a, b) => (Date.parse(b.data.createdDate) || 0) - (Date.parse(a.data.createdDate) || 0));
        return list;
    },

    renderResults() {
        this.state.filtered = this.filterRecords();
        const el = document.getElementById('results');
        if (!el) return;
        if (!this.state.filtered.length) {
            el.innerHTML = '<div class="fsp-result-item">No matching records.</div>';
            return;
        }
        el.innerHTML = this.state.filtered.map((record, index) => {
            const d = record.data;
            const active = this.state.selectedFileName === record.fileName ? 'active' : '';
            const score = FacultyRecordService.computePriorityScore(d);
            const stats = FacultyRecordService.getLifecycleStats(d.lifecycle || {});
            return `
                <div class="fsp-result-item ${active}" data-index="${index}">
                    <strong>${d.firstName || ''} ${d.lastName || ''}</strong>
                    ${score > 5 ? '<span class="fsp-tag priority">!</span>' : ''}
                    <div class="fsp-meta">${d.orgDefinedId} · ${stats.overallPct}% · ${record.folder}</div>
                </div>
            `;
        }).join('');
        el.querySelectorAll('.fsp-result-item[data-index]').forEach((item) => {
            item.addEventListener('click', () => {
                const idx = Number(item.dataset.index);
                this.selectRecord(this.state.filtered[idx]);
            });
        });
    },

    selectRecord(record) {
        this.state.selected = record.data;
        this.state.selectedFileName = record.fileName;
        this.state.selectedFolder = record.folder;
        this.state.notes = Array.isArray(record.data.notes) ? record.data.notes.slice() : [];
        this.state.lifecycle = FacultyRecordService.normalizeLifecycle(record.data.lifecycle);

        document.getElementById('firstName').value = record.data.firstName || '';
        document.getElementById('lastName').value = record.data.lastName || '';
        document.getElementById('username').value = record.data.username || '';
        document.getElementById('orgDefinedId').value = record.data.orgDefinedId || '';
        document.getElementById('email').value = record.data.email || '';
        document.getElementById('division').value = record.data.division || '';
        document.getElementById('assignedSpecialist').value = record.data.assignedSpecialist || '';
        document.getElementById('firstTeachingSemester').value = record.data.firstTeachingSemester || '';
        document.getElementById('createdDate').value = record.data.createdDate || '';

        this.renderLifecycleChecklist();
        this.renderNotes();
        this.renderAutoChecks(record.data.automatedChecks || {});
        this.renderResults();
        this.showStatus(`Selected <strong>${record.fileName}</strong>`, 'success');
    },

    renderAutoChecks(checks) {
        const el = document.getElementById('autoChecksPanel');
        if (!el) return;
        const keys = ['hasLoggedIn', 'orientationEnrolled', 'orientationComplete', 'sandboxExists', 'profileComplete', 'recentActivity'];
        el.innerHTML = keys.map((k) => {
            const ok = checks[k];
            return `<span class="fsp-meta">${k}: ${ok ? '✓' : '✗'}</span>`;
        }).join(' · ');
    },

    renderLifecycleChecklist() {
        const el = document.getElementById('phaseChecklist');
        const stats = FacultyRecordService.getLifecycleStats(this.state.lifecycle);
        document.getElementById('overallProgressText').textContent = `${stats.overallPct}%`;
        document.getElementById('overallProgressFill').style.width = `${stats.overallPct}%`;

        if (!this.state.selectedFileName) {
            el.innerHTML = '<div class="fsp-meta">Select a faculty record.</div>';
            return;
        }

        el.innerHTML = FacultyRecordService.getPhases().map((phase) => {
            const ps = stats.phaseStats.find((s) => s.key === phase.key);
            const itemsHtml = (phase.items || []).map((item, idx) => {
                const label = typeof item === 'string' ? item : item.label;
                const type = typeof item === 'object' ? item.type : 'manual';
                const checked = this.state.lifecycle[phase.key]?.[label] ? 'checked' : '';
                const badge = type === 'auto' ? '<span class="fsp-badge-auto">auto</span>'
                    : type === 'email' ? '<span class="fsp-badge-email">email</span>'
                    : '<span class="fsp-badge-manual">manual</span>';
                return `<label><input type="checkbox" data-phase="${phase.key}" data-item="${encodeURIComponent(label)}" ${checked} /> ${badge} <span>${label}</span></label>`;
            }).join('');
            return `
                <details class="fsp-phase" open>
                    <summary>${phase.title} (${ps.checked}/${ps.total})</summary>
                    <div class="fsp-phase-items">${itemsHtml}</div>
                </details>
            `;
        }).join('');

        el.querySelectorAll('input[type=checkbox]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const phase = cb.dataset.phase;
                const item = decodeURIComponent(cb.dataset.item || '');
                if (!this.state.lifecycle[phase]) this.state.lifecycle[phase] = {};
                this.state.lifecycle[phase][item] = cb.checked;
                this.renderLifecycleChecklist();
            });
        });
    },

    renderNotes() {
        const el = document.getElementById('notesList');
        if (!this.state.notes.length) {
            el.innerHTML = '<div class="fsp-meta">No notes yet.</div>';
            return;
        }
        el.innerHTML = this.state.notes.map((n) =>
            `<div><strong>${n.date}</strong> | ${n.author}<br>${n.note}</div>`
        ).join('');
    },

    buildRecordFromForm() {
        return FacultyRecordService.syncOnboardingStatus({
            ...this.state.selected,
            orgDefinedId: document.getElementById('orgDefinedId').value.trim(),
            firstName: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim(),
            username: document.getElementById('username').value.trim(),
            email: document.getElementById('email').value.trim(),
            division: document.getElementById('division').value.trim(),
            assignedSpecialist: document.getElementById('assignedSpecialist').value.trim(),
            firstTeachingSemester: document.getElementById('firstTeachingSemester').value.trim(),
            createdDate: document.getElementById('createdDate').value,
            notes: this.state.notes.slice(),
            lifecycle: FacultyRecordService.normalizeLifecycle(this.state.lifecycle),
            workflow: { ...(this.state.selected?.workflow || {}), started: true }
        });
    },

    addNote() {
        const text = document.getElementById('newNote')?.value.trim();
        if (!text || !this.state.selectedFileName) return;
        this.state.notes.push({ date: new Date().toISOString().split('T')[0], author: 'Admin', note: text });
        document.getElementById('newNote').value = '';
        this.renderNotes();
    },

    addMeeting() {
        const date = document.getElementById('meetingDate')?.value;
        const notes = document.getElementById('meetingNotes')?.value.trim();
        if (!date || !this.state.selected) return;
        this.state.selected = FacultyRecordService.addMeeting(this.state.selected, { date, notes, type: 'check-in' });
        document.getElementById('meetingNotes').value = '';
        this.showStatus('Meeting logged (save to persist).', 'success');
    },

    async saveToInProgress() {
        try {
            if (!this.state.selectedFileName) throw new Error('Select a record first.');
            const record = this.buildRecordFromForm();
            await FacultyRecordService.saveRecord(record, this.state.selectedFileName, FacultyRecordService.FOLDER_IN_PROGRESS);
            this.showStatus('Saved to in-progress.', 'success');
            await this.refresh();
        } catch (err) {
            this.showStatus(err.message, 'error');
        }
    },

    async moveToFinished() {
        try {
            if (!this.state.selectedFileName) throw new Error('Select a record first.');
            const record = this.buildRecordFromForm();
            await FacultyRecordService.saveRecord(record, this.state.selectedFileName, FacultyRecordService.FOLDER_FINISHED);
            this.showStatus('Moved to finished.', 'success');
            await this.refresh();
        } catch (err) {
            this.showStatus(err.message, 'error');
        }
    },

    async runSingleAutoCheck() {
        if (!this.state.selected) {
            this.showStatus('Select a record first.', 'error');
            return;
        }
        try {
            this.showStatus('Running auto-checks…', 'success');
            const checks = await FacultyAutomationChecks.runAllChecks(this.state.selected);
            const updated = FacultyRecordService.applyAutoCheckResults(this.buildRecordFromForm(), checks);
            await FacultyRecordService.saveRecord(updated, this.state.selectedFileName, this.state.selectedFolder);
            this.showStatus('Auto-checks complete and saved.', 'success');
            await this.refresh();
            const rec = this.state.records.find((r) => r.fileName === this.state.selectedFileName);
            if (rec) this.selectRecord(rec);
        } catch (err) {
            this.showStatus(err.message, 'error');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => CommandCenter.init());
