/**
 * Automation Checks — D2L API verification for Faculty Success Path lifecycle items.
 */

const FacultyAutomationChecks = {
    SANDBOX_NAME_PATTERN: /sandbox|zzdemo|practice|dev/i,

    async runAllChecks(record) {
        const orgDefinedId = String(record.orgDefinedId || '').trim();
        if (!orgDefinedId) throw new Error('Record missing orgDefinedId');

        const user = await this.lookupUser(orgDefinedId);
        if (!user) {
            return {
                hasLoggedIn: false,
                lastLoginDate: null,
                orientationEnrolled: false,
                orientationComplete: false,
                sandboxExists: false,
                profileComplete: false,
                recentActivity: false,
                coursesForSemester: [],
                _userId: null
            };
        }

        const userId = user.Identifier || user.UserId;
        const [enrollments, profileOk] = await Promise.all([
            this.getUserEnrollments(userId),
            this.checkProfileComplete(user)
        ]);

        const orientationOu = FacultyRecordService.FACULTY_ORIENTATION_ORG_UNIT_ID;
        const orientationEnrolled = enrollments.some(
            (e) => String(e.OrgUnit?.Id || e.OrgUnitId) === String(orientationOu)
        );

        const sandboxExists = enrollments.some((e) => {
            const name = e.OrgUnit?.Name || e.CourseName || '';
            const code = e.OrgUnit?.Code || e.CourseCode || '';
            return this.SANDBOX_NAME_PATTERN.test(name) || this.SANDBOX_NAME_PATTERN.test(code);
        });

        const teachingCourses = enrollments.filter((e) => {
            const type = e.OrgUnit?.Type?.Code || e.OrgUnitTypeId;
            return type === 'Course Offering' || type === 3 || String(type) === '3';
        }).map((e) => ({
            ouId: e.OrgUnit?.Id || e.OrgUnitId,
            code: e.OrgUnit?.Code || e.CourseCode || '',
            name: e.OrgUnit?.Name || e.CourseName || '',
            isEmpty: null
        }));

        const lastAccess = user.LastAccessedDate || user.LastLoginDate || null;
        const hasLoggedIn = Boolean(lastAccess);
        const recentActivity = hasLoggedIn && this.isWithinDays(lastAccess, 14);

        let orientationComplete = false;
        if (orientationEnrolled && orientationOu) {
            orientationComplete = await this.checkOrientationComplete(userId, orientationOu);
        }

        const coursesNotEmpty = teachingCourses.length === 0 || teachingCourses.some((c) => c.isEmpty === false);

        return {
            hasLoggedIn,
            lastLoginDate: lastAccess ? String(lastAccess).split('T')[0] : null,
            orientationEnrolled,
            orientationComplete,
            sandboxExists,
            profileComplete: profileOk,
            recentActivity,
            coursesNotEmpty,
            coursesForSemester: teachingCourses,
            _userId: userId
        };
    },

    isWithinDays(dateStr, days) {
        const d = new Date(dateStr);
        if (isNaN(d)) return false;
        return (Date.now() - d.getTime()) < days * 86400000;
    },

    async lookupUser(orgDefinedId) {
        const version = FacultyRecordService.API_VERSION;
        try {
            const data = await FacultyRecordService.fetchJson(
                `/d2l/api/lp/${version}/users/?orgDefinedId=${encodeURIComponent(orgDefinedId)}`
            );
            const users = FacultyRecordService.toArray(data);
            return users[0] || null;
        } catch {
            return null;
        }
    },

    async getUserEnrollments(userId) {
        const version = FacultyRecordService.API_VERSION;
        const all = [];
        let bookmark = '';
        while (true) {
            let url = `/d2l/api/lp/${version}/enrollments/users/${userId}/orgUnits/?pageSize=100`;
            if (bookmark) url += `&bookmark=${encodeURIComponent(bookmark)}`;
            const page = await FacultyRecordService.fetchJson(url);
            all.push(...FacultyRecordService.toArray(page));
            bookmark = page.PagingInfo?.Bookmark;
            if (!page.PagingInfo?.HasMoreItems || !bookmark) break;
        }
        return all;
    },

    checkProfileComplete(user) {
        const first = String(user.FirstName || '').trim();
        const last = String(user.LastName || '').trim();
        const email = String(user.ExternalEmail || user.Email || '').trim();
        return Boolean(first && last && email);
    },

    async checkOrientationComplete(userId, orgUnitId) {
        try {
            const version = '1.82';
            const url = `/d2l/api/le/${version}/${orgUnitId}/grades/${userId}/values/`;
            const grades = await FacultyRecordService.fetchJson(url);
            const items = FacultyRecordService.toArray(grades);
            return items.some((g) => g.GradeObjectType === 11 || g.DisplayedGrade);
        } catch {
            return false;
        }
    },

    async runBatch(records, onProgress) {
        const results = [];
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            if (onProgress) onProgress(i + 1, records.length, rec);
            try {
                const checks = await this.runAllChecks(rec.data);
                const updated = FacultyRecordService.applyAutoCheckResults({ ...rec.data }, checks);
                await FacultyRecordService.saveRecord(updated, rec.fileName, rec.folder);
                results.push({ fileName: rec.fileName, success: true, checks });
            } catch (err) {
                results.push({ fileName: rec.fileName, success: false, error: err.message });
            }
        }
        return results;
    }
};

if (typeof window !== 'undefined') {
    window.FacultyAutomationChecks = FacultyAutomationChecks;
}
