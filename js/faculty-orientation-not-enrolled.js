/**
 * Faculty Orientation Not Enrolled
 * Instructors (role 102) not enrolled in the Faculty Orientation course.
 */

const FacultyOrientationNotEnrolled = {
    ORIENTATION_OU: null,
    INSTRUCTOR_ROLE: 102,

    async getOrientationOrgUnitId() {
        if (this.ORIENTATION_OU) return this.ORIENTATION_OU;
        if (typeof FacultyRecordService !== 'undefined') {
            await FacultyRecordService.loadConfig();
            this.ORIENTATION_OU = FacultyRecordService.FACULTY_ORIENTATION_ORG_UNIT_ID;
        } else {
            this.ORIENTATION_OU = 1000001;
        }
        return this.ORIENTATION_OU;
    },

    async getEnrolledUserIds(orgUnitId) {
        const version = typeof D2LApi !== 'undefined' ? D2LApi.apiVersion : '1.49';
        const enrolled = new Set();
        let bookmark = '';
        while (true) {
            let url = `/d2l/api/lp/${version}/enrollments/orgUnits/${orgUnitId}/users/?pageSize=100`;
            if (bookmark) url += `&bookmark=${encodeURIComponent(bookmark)}`;
            const page = await D2LApi._fetch(url);
            const items = page.Items || page.Objects || page || [];
            (Array.isArray(items) ? items : []).forEach((e) => {
                const uid = e.User?.Identifier || e.UserId || e.User?.UserId;
                if (uid) enrolled.add(String(uid));
            });
            bookmark = page.PagingInfo?.Bookmark;
            if (!page.PagingInfo?.HasMoreItems || !bookmark) break;
        }
        return enrolled;
    },

    async getInstructorsFromOnboardingRecords() {
        if (typeof FacultyRecordService === 'undefined') return [];
        await FacultyRecordService.loadConfig();
        const records = await FacultyRecordService.loadAllRecords();
        return records
            .filter((r) => r.folder !== FacultyRecordService.FOLDER_FINISHED)
            .map((r) => ({
                orgDefinedId: r.data.orgDefinedId,
                firstName: r.data.firstName,
                lastName: r.data.lastName,
                email: r.data.email || '',
                userId: null,
                dateCreated: r.data.createdDate || '',
                folder: r.folder
            }));
    },

    async lookupUserId(orgDefinedId) {
        try {
            const data = await D2LApi._fetch(
                `/d2l/api/lp/${D2LApi.apiVersion}/users/?orgDefinedId=${encodeURIComponent(orgDefinedId)}`
            );
            const users = data.Items || data || [];
            const u = Array.isArray(users) ? users[0] : users;
            return u?.Identifier || u?.UserId || null;
        } catch {
            return null;
        }
    },

    async getNotEnrolled() {
        const orientationOu = await this.getOrientationOrgUnitId();
        const enrolledIds = await this.getEnrolledUserIds(orientationOu);
        const candidates = await this.getInstructorsFromOnboardingRecords();
        const notEnrolled = [];

        for (const c of candidates) {
            let userId = c.userId;
            if (!userId && c.orgDefinedId) {
                userId = await this.lookupUserId(c.orgDefinedId);
            }
            if (userId && enrolledIds.has(String(userId))) continue;
            notEnrolled.push({ ...c, userId: userId || '' });
        }

        return { count: notEnrolled.length, users: notEnrolled, orientationOrgUnitId: orientationOu };
    }
};

if (typeof window !== 'undefined') {
    window.FacultyOrientationNotEnrolled = FacultyOrientationNotEnrolled;
}
