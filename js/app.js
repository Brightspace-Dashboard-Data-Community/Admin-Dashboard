document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    // Sidebar elements are now dynamic, fetched via ID when needed in sidebar.js active check or here if needed.
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const body = document.body;

    // Note: Desktop Sidebar toggle and Submenu logic moved to js/sidebar.js

    // Toggle Mobile Menu
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            body.classList.toggle('mobile-nav-open');
        });
    }

    // Close mobile menu when clicking outside (on the overlay)
    document.addEventListener('click', (e) => {
        if (body.classList.contains('mobile-nav-open')) {
            const sidebar = document.getElementById('sidebar'); // Get dynamically
            // If click is outside sidebar and not on the toggle button
            if (sidebar && !sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
                body.classList.remove('mobile-nav-open');
            }
        }
    });

    // Sidebar collapsed state restoration is also handled in sidebar.js now, 
    // but app.js main responsibility is content interaction.

    // Initialize mock charts (Simple CSS animation trigger)
    setTimeout(() => {
        const bars = document.querySelectorAll('.css-bar');
        bars.forEach(bar => {
            const height = bar.getAttribute('data-height');
            bar.style.height = height;
        });
        
        // Initialize horizontal bars
        const horizontalBars = document.querySelectorAll('.horizontal-bar');
        horizontalBars.forEach(bar => {
            const width = bar.getAttribute('data-width');
            bar.style.width = width;
        });
    }, 500);
});
