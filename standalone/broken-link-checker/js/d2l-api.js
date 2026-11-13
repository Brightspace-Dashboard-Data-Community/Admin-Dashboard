/**
 * Brightspace API client for the standalone broken-link checker.
 * Calls same-origin /d2l/api routes with the signed-in session.
 * Read methods only. No college-specific ids or keys.
 */
const D2LApi = {
    apiVersion: '1.49',

    _getCookie(name) {
        const value = '; ' + document.cookie;
        const parts = value.split('; ' + name + '=');
        if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift() || '');
        return '';
    },

    _getAuthHeaders() {
        const token = this._getCookie('XSRF.Token')
            || localStorage.getItem('XSRF.Token')
            || sessionStorage.getItem('XSRF.Token')
            || '';
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        if (token) headers['X-CSRF-Token'] = token;
        return headers;
    },

    async _fetch(endpoint, options = {}) {
        const headers = this._getAuthHeaders();
        const response = await fetch(endpoint, {
            ...options,
            headers: { ...headers, ...options.headers },
            credentials: 'include'
        });

        const newToken = response.headers.get('x-csrf-token');
        if (newToken) localStorage.setItem('XSRF.Token', newToken);

        if (!response.ok) {
            let detail = '';
            try {
                detail = (await response.text()).trim();
            } catch (e) {
                detail = '';
            }
            const looksLikeHtml = /^\s*</.test(detail);
            const suffix = detail && !looksLikeHtml ? ` — ${detail.slice(0, 240)}` : '';
            const error = new Error(`API Error: ${response.status} ${response.statusText}${suffix}`.trim());
            error.status = response.status;
            throw error;
        }

        const text = await response.text();
        if (!text || text.trim() === '') {
            return (!options.method || options.method.toUpperCase() === 'GET') ? [] : {};
        }

        try {
            return JSON.parse(text);
        } catch (jsonError) {
            console.warn('D2LApi: Response is not valid JSON, returning as text', jsonError);
            return text;
        }
    },

    async getWhoAmI() {
        return await this._fetch(`/d2l/api/lp/${this.apiVersion}/users/whoami`);
    },

    async getOrganizationInfo() {
        return await this._fetch(`/d2l/api/lp/${this.apiVersion}/organization/info`);
    },

    async fetchPaginatedData(endpoint, pageSize = 100) {
        const allItems = [];
        let bookmark = null;
        let hasMore = true;
        let pageCount = 0;
        const maxPages = 1000;

        while (hasMore && pageCount < maxPages) {
            pageCount++;
            const separator = endpoint.includes('?') ? '&' : '?';
            let url = `${endpoint}${separator}pageSize=${pageSize}`;
            if (bookmark) url += `&bookmark=${encodeURIComponent(bookmark)}`;

            const response = await this._fetch(url);
            let items = [];
            if (response && response.Objects && Array.isArray(response.Objects)) {
                items = response.Objects;
            } else if (Array.isArray(response)) {
                items = response;
            } else if (response && response.Items && Array.isArray(response.Items)) {
                items = response.Items;
            }
            allItems.push(...items);

            if (response && response.Next) {
                bookmark = response.Next;
            } else if (response && response.NextPageUrl) {
                const nextUrl = new URL(response.NextPageUrl, window.location.origin);
                bookmark = nextUrl.searchParams.get('bookmark');
                if (!bookmark) hasMore = false;
            } else {
                hasMore = false;
            }
        }

        if (pageCount >= maxPages) {
            console.warn('D2LApi: Reached max pages limit, some data may be missing');
        }

        return allItems;
    }
};
