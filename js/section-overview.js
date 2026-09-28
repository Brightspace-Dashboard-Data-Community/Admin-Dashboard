/**
 * Section overview pages (User / Course / Enrollment)
 * Light page: local semester label only. Does not load Data Hub extracts or stats APIs.
 */
(function () {
    'use strict';

    function fillSemester() {
        const el = document.getElementById('home-semester-label');
        if (!el || typeof SemesterConfig === 'undefined' || !SemesterConfig.getAll) return;
        const list = SemesterConfig.getAll({ excludeSandbox: true });
        const semester = list && list.length ? list[0] : null;
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
