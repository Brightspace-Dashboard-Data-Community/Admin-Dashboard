/**
 * Semester Config (shared)
 * -----------------------------------------------------------------------------
 * Canonical list of semesters that should appear in EVERY semester dropdown
 * across the Admin Dashboard. This is the single source of truth.
 *
 * If a semester needs to be referenced that is NOT in this list (e.g. pulling
 * historical records), use the optional "Historical Semester (OrgUnitId)" input
 * which `SemesterConfig.attachHistoricalInput()` can inject next to a dropdown.
 *
 * To add/remove a semester for ALL dashboards, edit ALLOWED below.
 *
 * Source: semester_list_2026-05-12.csv
 */
(function (global) {
    'use strict';

    // ---- Canonical allowlist (edit here to change globally) --------------------
    const ALLOWED = [
        { Identifier: 2966924, Name: 'WINTER 2024', Code: '24/WI' },
        { Identifier: 2973234, Name: 'SPRING 2024', Code: '24/SP' },
        { Identifier: 2976713, Name: 'FALL 2024',   Code: '24/FA' },
        { Identifier: 2983671, Name: 'WINTER 2025', Code: '25/WI' },
        { Identifier: 2990154, Name: 'SPRING 2025', Code: '25/SP' },
        { Identifier: 2993337, Name: 'Sandbox',     Code: 'Sandbox' },
        { Identifier: 2993948, Name: 'FALL 2025',   Code: '25/FA' },
        { Identifier: 3000199, Name: 'WINTER 2026', Code: '26/WI' },
        { Identifier: 3007631, Name: 'SPRING 2026', Code: '26/SP' },
        { Identifier: 3010530, Name: 'FALL 2026',   Code: '26/FA' }
    ];

    // ---- Derived lookups -------------------------------------------------------
    const idIndex = new Map();      // String(Identifier) -> entry
    const nameIndex = new Map();    // upper(Name)        -> entry
    const codeIndex = new Map();    // upper(Code)        -> entry
    for (const s of ALLOWED) {
        idIndex.set(String(s.Identifier), s);
        nameIndex.set(s.Name.toUpperCase(), s);
        codeIndex.set(s.Code.toUpperCase(), s);
    }

    // Term ordering for "recency" sorts (higher = newer). Sandbox sorts last.
    const TERM_RANK = { WI: 1, SP: 2, FA: 3 };
    function recencyKey(entry) {
        if (!entry) return -Infinity;
        if (entry.Code === 'Sandbox') return -1; // always last
        const m = /(\d{2})\/(WI|SP|FA)/.exec(entry.Code || '');
        if (!m) return Number(entry.Identifier) || 0;
        const yr = parseInt(m[1], 10);
        const term = TERM_RANK[m[2]] || 0;
        return yr * 10 + term;
    }

    // ---- Public helpers --------------------------------------------------------

    /**
     * Match a raw API semester object (or string) against the canonical list.
     * Returns the canonical entry, or null if it isn't allowed.
     * Match order: Identifier -> Name (case-insensitive) -> Code (case-insensitive).
     */
    function match(item) {
        if (item == null) return null;
        if (typeof item === 'number' || typeof item === 'string') {
            const s = String(item).trim();
            if (idIndex.has(s)) return idIndex.get(s);
            const up = s.toUpperCase();
            if (nameIndex.has(up)) return nameIndex.get(up);
            if (codeIndex.has(up)) return codeIndex.get(up);
            return null;
        }
        const id = item.Identifier ?? item.Id ?? item.OrgUnitId ?? item.identifier;
        if (id != null && idIndex.has(String(id))) return idIndex.get(String(id));
        const name = (item.Name || item.name || '').toString().toUpperCase().trim();
        if (name && nameIndex.has(name)) return nameIndex.get(name);
        const code = (item.Code || item.code || '').toString().toUpperCase().trim();
        if (code && codeIndex.has(code)) return codeIndex.get(code);
        return null;
    }

    /**
     * Filter an array of API semester objects to ONLY those in the allowlist.
     * Each surviving item is replaced by the canonical entry (so labels/ids are
     * consistent), but the original API Identifier is preserved when present
     * (API ids are authoritative for downstream API calls).
     */
    function filterAllowed(items) {
        if (!Array.isArray(items)) return [];
        const out = [];
        const seen = new Set();
        for (const raw of items) {
            const canon = match(raw);
            if (!canon) continue;
            const apiId = raw && (raw.Identifier ?? raw.Id ?? raw.OrgUnitId);
            const id = apiId != null ? String(apiId) : String(canon.Identifier);
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({
                Identifier: apiId != null ? apiId : canon.Identifier,
                Name: canon.Name,
                Code: canon.Code,
                Type: (raw && raw.Type) || { Id: 5, Code: 'Semester' }
            });
        }
        return out;
    }

    /** Sort a list of canonical semesters newest-first. Sandbox is forced last. */
    function sortByRecency(items) {
        return (items || []).slice().sort((a, b) => recencyKey(b) - recencyKey(a));
    }

    /** Return the full canonical list (cloned), newest first. */
    function getAll(options) {
        const opts = options || {};
        const list = ALLOWED.map(s => ({ ...s }));
        const sorted = sortByRecency(list);
        if (opts.excludeSandbox) return sorted.filter(s => s.Code !== 'Sandbox');
        return sorted;
    }

    /**
     * Populate a <select> with semester options.
     * @param {HTMLSelectElement} select
     * @param {Array} items  Array from the D2L API (will be filtered). If
     *                       omitted/empty, the canonical list itself is used.
     * @param {Object} [options]
     *   - placeholder: string|null. Adds a leading disabled option (default null = none)
     *   - includeCode: boolean. Append code like "WINTER 2026 (26/WI)" (default true)
     *   - selectedId: any. Pre-select this Identifier
     *   - excludeSandbox: boolean
     */
    function populateSelect(select, items, options) {
        if (!select) return [];
        const opts = options || {};
        const includeCode = opts.includeCode !== false;
        let list = (items && items.length) ? filterAllowed(items) : getAll({ excludeSandbox: opts.excludeSandbox });
        if (opts.excludeSandbox) list = list.filter(s => s.Code !== 'Sandbox');
        list = sortByRecency(list);

        select.innerHTML = '';
        if (opts.placeholder) {
            const ph = document.createElement('option');
            ph.value = '';
            ph.textContent = opts.placeholder;
            ph.disabled = false;
            select.appendChild(ph);
        }
        for (const s of list) {
            const o = document.createElement('option');
            o.value = String(s.Identifier);
            o.dataset.code = s.Code;
            o.dataset.name = s.Name;
            o.textContent = includeCode && s.Code && s.Code !== s.Name ? `${s.Name} (${s.Code})` : s.Name;
            select.appendChild(o);
        }
        if (opts.selectedId != null) {
            const want = String(opts.selectedId);
            if (Array.from(select.options).some(o => o.value === want)) {
                select.value = want;
            }
        }
        return list;
    }

    /**
     * Inject a small "Historical Semester (OrgUnitId)" input next to a select,
     * giving admins an escape hatch to query semesters NOT in the allowlist.
     *
     * The input writes its value into a hidden field that consumer code can
     * read via SemesterConfig.getEffectiveSemesterId(select).
     *
     * @param {HTMLSelectElement} select  The dropdown to enhance.
     * @param {Object} [options]
     *   - label: override the label text
     *   - placeholder: override the placeholder
     *   - containerClass: CSS class on the wrapper (default 'sc-historical-wrap')
     */
    function attachHistoricalInput(select, options) {
        if (!select || select.dataset.scHistoricalAttached === '1') return null;
        const opts = options || {};
        select.dataset.scHistoricalAttached = '1';

        const wrap = document.createElement('div');
        wrap.className = opts.containerClass || 'sc-historical-wrap';
        wrap.style.cssText = 'margin-top:8px;font-size:13px;color:#444;';

        const toggleId = 'scHistToggle_' + Math.random().toString(36).slice(2, 8);
        const inputId  = 'scHistInput_'  + Math.random().toString(36).slice(2, 8);

        wrap.innerHTML =
            '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">' +
            '  <input type="checkbox" id="' + toggleId + '" />' +
            '  Use a historical semester not in the list' +
            '</label>' +
            '<div id="' + inputId + '_row" style="display:none;margin-top:6px;">' +
            '  <input type="text" id="' + inputId + '" ' +
            '         placeholder="' + (opts.placeholder || 'Enter OrgUnitId (e.g. 2966924)') + '" ' +
            '         style="width:240px;padding:6px 8px;border:1px solid #ccc;border-radius:4px;" />' +
            '  <span style="margin-left:8px;color:#666;">Overrides the dropdown above.</span>' +
            '</div>';

        select.parentNode.insertBefore(wrap, select.nextSibling);

        const toggle = wrap.querySelector('#' + toggleId);
        const row    = wrap.querySelector('#' + inputId + '_row');
        const input  = wrap.querySelector('#' + inputId);

        toggle.addEventListener('change', () => {
            row.style.display = toggle.checked ? '' : 'none';
            if (!toggle.checked) input.value = '';
            select.disabled = toggle.checked;
        });

        // Tag the select so getEffectiveSemesterId can find its companion input.
        select.dataset.scHistoricalInputId = inputId;
        return { wrap, toggle, input };
    }

    /**
     * Read the "effective" semester ID for a select: either the user-typed
     * historical OrgUnitId (if the toggle is enabled and non-empty), or the
     * dropdown's current value.
     */
    function getEffectiveSemesterId(select) {
        if (!select) return '';
        const histId = select.dataset && select.dataset.scHistoricalInputId;
        if (histId) {
            const inp = document.getElementById(histId);
            if (inp && inp.value && inp.value.trim()) return inp.value.trim();
        }
        return select.value || '';
    }

    // ---- Export ---------------------------------------------------------------
    global.SemesterConfig = {
        ALLOWED,
        match,
        filterAllowed,
        sortByRecency,
        getAll,
        populateSelect,
        attachHistoricalInput,
        getEffectiveSemesterId
    };
})(typeof window !== 'undefined' ? window : globalThis);
