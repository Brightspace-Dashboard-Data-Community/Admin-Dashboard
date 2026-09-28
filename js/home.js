/**
 * Admin Dashboard home hub
 * Light page: WhoAmI for the greeting, local semester config, first-visit walkthrough.
 * Does not load Data Hub extracts or dashboard analytics APIs.
 */
(function () {
    'use strict';

    const INTRO_KEY = 'admin-home-intro-seen';

    function currentSemester() {
        if (typeof SemesterConfig === 'undefined' || !SemesterConfig.getAll) return null;
        const list = SemesterConfig.getAll({ excludeSandbox: true });
        return list && list.length ? list[0] : null;
    }

    function fillSemester() {
        const el = document.getElementById('home-semester-label');
        const semester = currentSemester();
        if (!el || !semester) return;
        el.textContent = semester.Code ? `${semester.Name} (${semester.Code})` : semester.Name;
    }

    function fillWelcome() {
        const welcome = document.getElementById('welcome-message');
        if (!welcome || typeof D2LApi === 'undefined' || !D2LApi.getWhoAmI) return;
        D2LApi.getWhoAmI().then((user) => {
            if (user && user.FirstName) {
                welcome.textContent = `Welcome back, ${user.FirstName}`;
            } else {
                welcome.textContent = 'Welcome back';
            }
        }).catch(() => {});
    }

    function showIntroModal() {
        const modal = document.getElementById('home-intro-modal');
        if (!modal) return;
        modal.classList.add('show');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        const startBtn = document.getElementById('home-intro-start');
        if (startBtn) startBtn.focus();
    }

    function hideIntroModal() {
        const modal = document.getElementById('home-intro-modal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.style.display = 'none';
        document.body.style.overflow = '';
        try {
            localStorage.setItem(INTRO_KEY, 'true');
        } catch (e) {}
    }

    function initIntroModal() {
        const modal = document.getElementById('home-intro-modal');
        if (!modal) return;

        const skipBtn = document.getElementById('home-intro-skip');
        const startBtn = document.getElementById('home-intro-start');
        const closeBtn = document.getElementById('home-intro-close');

        if (skipBtn) skipBtn.addEventListener('click', hideIntroModal);
        if (closeBtn) closeBtn.addEventListener('click', hideIntroModal);
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                try {
                    localStorage.setItem(INTRO_KEY, 'true');
                } catch (e) {}
            });
        }

        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideIntroModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) {
                hideIntroModal();
            }
        });

        let seen = false;
        try {
            seen = localStorage.getItem(INTRO_KEY) === 'true';
        } catch (e) {}

        if (!seen) {
            setTimeout(showIntroModal, 350);
        }
    }

    function init() {
        fillSemester();
        fillWelcome();
        initIntroModal();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
