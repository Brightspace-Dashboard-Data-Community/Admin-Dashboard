/**
 * Section overview pages (User / Course / Enrollment)
 * Light page: local semester label only. Does not load Data Hub extracts or stats APIs.
 */
(function () {
    'use strict';

    function fillSemester() {
        const el = document.getElementById('home-semester-label');
        if (!el || typeof SemesterConfig === 'undefined') return;
        const semester = SemesterConfig.getCurrent
            ? SemesterConfig.getCurrent()
            : ((SemesterConfig.getAll && SemesterConfig.getAll({ excludeSandbox: true })[0]) || null);
        if (!semester) return;
        el.textContent = semester.Code ? `${semester.Name} (${semester.Code})` : semester.Name;
    }

    function init() {
        fillSemester();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
