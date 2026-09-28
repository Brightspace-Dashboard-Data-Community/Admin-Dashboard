/**
 * Onboarding Queue Service — JSON-based action queue (replaces Supabase onboarding_actions).
 */

const OnboardingQueueService = {
    async getActiveRecords() {
        await FacultyRecordService.loadConfig();
        const all = await FacultyRecordService.loadAllRecords();
        return all.filter(
            (r) => r.folder === FacultyRecordService.FOLDER_NEW ||
                   r.folder === FacultyRecordService.FOLDER_IN_PROGRESS
        );
    },

    async getTopUsersNeedingAction(limit = 10) {
        const records = await this.getActiveRecords();
        const scored = records.map((r) => ({
            ...r,
            priorityScore: FacultyRecordService.computePriorityScore(r.data),
            stats: FacultyRecordService.getLifecycleStats(r.data.lifecycle || {})
        }));
        scored.sort((a, b) => b.priorityScore - a.priorityScore);
        return scored.slice(0, limit);
    },

    async getAllUsersNeedingAction() {
        const records = await this.getActiveRecords();
        return records
            .map((r) => ({
                record: r,
                priorityScore: FacultyRecordService.computePriorityScore(r.data),
                stats: FacultyRecordService.getLifecycleStats(r.data.lifecycle || {}),
                pendingActions: this.getPendingActions(r.data)
            }))
            .sort((a, b) => b.priorityScore - a.priorityScore);
    },

    getPendingActions(record) {
        const actions = [];
        const lifecycle = record.lifecycle || {};
        const checks = record.automatedChecks || {};

        const actionMap = [
            { key: 'welcome_email_sent', phase: 'phase1', item: 'Welcome email' },
            { key: 'login_nudge_sent', check: 'hasLoggedIn', phase: 'phase1', item: 'D2L account verification' },
            { key: 'orientation_course_registered', check: 'orientationEnrolled', phase: 'phase1', item: 'Orientation course enrollment' },
            { key: 'scheduled_call_or_walkin', phase: 'phase1', item: 'Intro meeting with eLearning team' },
            { key: 'faculty_orientation_completed', check: 'orientationComplete', phase: 'phase1', item: 'Orientation course enrollment' }
        ];

        actionMap.forEach(({ key, check, phase, item }) => {
            const done = check ? Boolean(checks[check]) : Boolean(lifecycle[phase]?.[item]);
            if (!done) actions.push({ key, label: item });
        });

        return actions;
    },

    getPhaseBoardCounts(records) {
        const counts = {};
        FacultyRecordService.getPhases().forEach((p) => { counts[p.key] = 0; });
        records.forEach((r) => {
            const phase = r.data.currentPhase || FacultyRecordService.getCurrentPhase(r.data.lifecycle || {});
            if (counts[phase] !== undefined) counts[phase]++;
            else counts.phase1++;
        });
        return counts;
    },

    getUpcomingReminders(records, daysAhead = 14) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const end = new Date(today);
        end.setDate(end.getDate() + daysAhead);
        const items = [];
        records.forEach((r) => {
            (r.data.reminders || []).forEach((rem) => {
                if (rem.completed) return;
                const due = new Date(rem.dueDate);
                if (isNaN(due) || due > end) return;
                items.push({
                    orgDefinedId: r.data.orgDefinedId,
                    name: `${r.data.firstName} ${r.data.lastName}`,
                    dueDate: rem.dueDate,
                    type: rem.type,
                    overdue: due < today,
                    fileName: r.fileName,
                    folder: r.folder
                });
            });
        });
        items.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        return items;
    },

    getFunnelStats(records) {
        const newCount = records.filter((r) => r.folder === FacultyRecordService.FOLDER_NEW).length;
        const inProgress = records.filter((r) => r.folder === FacultyRecordService.FOLDER_IN_PROGRESS).length;
        const finished = records.filter((r) => r.folder === FacultyRecordService.FOLDER_FINISHED).length;
        const phaseCounts = this.getPhaseBoardCounts(
            records.filter((r) => r.folder !== FacultyRecordService.FOLDER_FINISHED)
        );
        return { newCount, inProgress, finished, total: records.length, phaseCounts };
    },

    ACTION_MAP: {
        welcome_email_sent: { phase: 'phase1', item: 'Welcome email' },
        login_nudge_sent: { phase: 'phase1', item: 'D2L account verification' },
        scheduled_call_or_walkin: { phase: 'phase1', item: 'Intro meeting with eLearning team' },
        orientation_course_registered: { phase: 'phase1', item: 'Orientation course enrollment' },
        faculty_orientation_completed: { phase: 'phase1', item: 'Orientation course enrollment', useCheck: 'orientationComplete' }
    },

    getActionState(record, actionKey) {
        const map = this.ACTION_MAP[actionKey];
        if (!map) return false;
        if (map.useCheck) return Boolean(record.automatedChecks?.[map.useCheck]);
        return Boolean(record.lifecycle?.[map.phase]?.[map.item]);
    },

    isRecordComplete(record) {
        return Object.keys(this.ACTION_MAP).every((key) => this.getActionState(record, key));
    },

    recordToQueueRow(entry) {
        const r = entry.record;
        const data = r.data;
        return {
            fileName: r.fileName,
            folder: r.folder,
            orgDefinedId: data.orgDefinedId,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email || '',
            priority_score: entry.priorityScore,
            welcome_email_sent: this.getActionState(data, 'welcome_email_sent'),
            login_nudge_sent: this.getActionState(data, 'login_nudge_sent'),
            scheduled_call_or_walkin: this.getActionState(data, 'scheduled_call_or_walkin'),
            orientation_course_registered: this.getActionState(data, 'orientation_course_registered'),
            faculty_orientation_completed: this.getActionState(data, 'faculty_orientation_completed'),
            is_completed: r.folder === FacultyRecordService.FOLDER_FINISHED || this.isRecordComplete(data),
            updated_at: data.lastModified || data.createdDate
        };
    },

    async updateAction(fileName, folder, actionKey, value) {
        const map = this.ACTION_MAP[actionKey];
        if (!map) return false;
        const rec = await FacultyRecordService.getFacultyRecord(folder, fileName);
        if (!rec) return false;
        if (map.useCheck && value) {
            rec.data.automatedChecks = rec.data.automatedChecks || {};
            rec.data.automatedChecks[map.useCheck] = true;
        } else if (!map.useCheck) {
            if (!rec.data.lifecycle[map.phase]) rec.data.lifecycle[map.phase] = {};
            rec.data.lifecycle[map.phase][map.item] = value;
        }
        await FacultyRecordService.saveRecord(rec.data, fileName, folder);
        return true;
    },

    async markRecordComplete(fileName, folder) {
        const rec = await FacultyRecordService.getFacultyRecord(folder, fileName);
        Object.entries(this.ACTION_MAP).forEach(([key, map]) => {
            if (map.useCheck) {
                rec.data.automatedChecks = rec.data.automatedChecks || {};
                rec.data.automatedChecks[map.useCheck] = true;
            } else {
                if (!rec.data.lifecycle[map.phase]) rec.data.lifecycle[map.phase] = {};
                rec.data.lifecycle[map.phase][map.item] = true;
            }
        });
        await FacultyRecordService.saveRecord(rec.data, fileName, FacultyRecordService.FOLDER_FINISHED);
        return true;
    }
};

if (typeof window !== 'undefined') {
    window.OnboardingQueueService = OnboardingQueueService;
}
