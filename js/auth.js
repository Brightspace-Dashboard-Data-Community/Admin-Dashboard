/**
 * auth.js - Handles authentication and API communication with D2L Brightspace
 * Used by manage-enrollment module scripts.
 */

export async function BrightspaceFetch(endpoint, method = "GET", body = null) {
    const token = localStorage.getItem("XSRF.Token");
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    };
    if (token) headers["X-CSRF-Token"] = token;
    const options = { method, headers, credentials: "include" };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(endpoint, options);
    const newToken = response.headers.get('x-csrf-token');
    if (newToken) localStorage.setItem("XSRF.Token", newToken);

    if (!response.ok)
        throw new Error(`API Error: ${response.status} - ${response.statusText}`);

    const text = await response.text();
    if (!text || !text.trim()) return method === "GET" ? [] : {};
    try {
        return JSON.parse(text);
    } catch (_) {
        return text;
    }
}

export async function fetchWhoAmI() {
    try {
        return await BrightspaceFetch('/d2l/api/lp/1.49/users/whoami');
    } catch (_) {
        return null;
    }
}

export async function hasRole(roleId) {
    try {
        const user = await fetchWhoAmI();
        if (!user || !user.Identifier) return false;
        const roles = await BrightspaceFetch(`/d2l/api/lp/1.49/users/${user.Identifier}/roles/`);
        if (Array.isArray(roles)) return roles.some(r => r.Id === roleId);
        if (roles && roles.Items && Array.isArray(roles.Items)) return roles.Items.some(r => r.Id === roleId);
        return false;
    } catch (_) {
        return false;
    }
}
