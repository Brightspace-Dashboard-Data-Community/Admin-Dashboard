/**
 * Admin Dashboard — Training PII Mask
 *
 * Training helper: click the signed-in name in the sidebar, or press
 * Alt+Shift+P, to hide or show personally identifying information on the page
 * (names, usernames, OrgDefinedId, email local-part). Masks keep the first
 * character and fill the rest with asterisks (e.g. "Justin Bamberg" →
 * "J***** B******", "jbamberg@example.edu" → "j******@example.edu"). The domain
 * portion of emails is preserved.
 *
 * Persists mask state in sessionStorage so it survives in-dashboard navigation.
 * Loaded by js/sidebar.js on every dashboard page.
 */
(function () {
  "use strict";

  if (window.AdminDashboardPiiMask) {
    return;
  }

  var STORAGE_KEY = "ad.piiMask.enabled";
  var PANEL_ID = "ad-pii-mask-panel";
  var BANNER_ID = "ad-pii-mask-banner";
  var STYLE_ID = "ad-pii-mask-styles";
  var SKIP_SELECTOR =
    "script,style,noscript,iframe,#" +
    PANEL_ID +
    ",#" +
    BANNER_ID +
    ",#sidebar,.sidebar,.skip-link";

  var EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  var PII_JSON_KEYS = {
    FirstName: "name",
    LastName: "name",
    PreferredFirstName: "name",
    PreferredLastName: "name",
    SortFirst: "name",
    SortLast: "name",
    firstName: "name",
    lastName: "name",
    DisplayName: "name",
    displayName: "name",
    PostingUserDisplayName: "name",
    UserDisplayName: "name",
    MiddleName: "name",
    middleName: "name",
    FullName: "name",
    fullName: "name",
    LegalFirstName: "name",
    LegalLastName: "name",
    PreferredName: "name",
    preferredName: "name",
    OrgDefinedId: "id",
    OrgDefinedID: "id",
    orgDefinedId: "id",
    UserName: "id",
    Username: "id",
    userName: "id",
    UniqueName: "id",
    Email: "email",
    EmailAddress: "email",
    ExternalEmail: "email",
    email: "email"
  };

  /** @type {Map<string, "name"|"id"|"email">} */
  var tokenKinds = new Map();
  /** @type {WeakMap<Node, string>} */
  var textOriginals = new WeakMap();
  /** @type {WeakMap<Element, string>} */
  var valueOriginals = new WeakMap();
  /** @type {WeakMap<Element, Object>} */
  var attrOriginals = new WeakMap();

  var MSG_SOURCE = "ad-pii-mask";
  var masking = false;
  var panelOpen = false;
  var observer = null;
  var applyTimer = null;
  var panelEl = null;
  var bannerEl = null;
  var toggleBtn = null;
  var statusEl = null;

  function isEmbeddedFrame() {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }

  /**
   * Dashboard pages own the privacy controls, including when Brightspace
   * shows the page inside its content frame. Nested tools without a sidebar
   * only apply a mask they receive from the parent page.
   */
  function ownsPrivacyUi() {
    if (document.getElementById("sidebar") || document.getElementById("nav-user-privacy-btn")) {
      return true;
    }
    if (document.querySelector(".app-container")) return true;
    return !isEmbeddedFrame();
  }

  function isEnabled() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (e) {
      return masking;
    }
  }

  function setEnabled(on) {
    masking = !!on;
    try {
      sessionStorage.setItem(STORAGE_KEY, masking ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }

  function broadcastMaskState() {
    if (!ownsPrivacyUi()) return;
    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      try {
        if (iframes[i].contentWindow) {
          iframes[i].contentWindow.postMessage(
            { source: MSG_SOURCE, type: "setEnabled", enabled: masking },
            "*"
          );
        }
      } catch (e) {
        /* cross-origin or unloaded frame */
      }
    }
  }

  function requestParentMaskState() {
    if (ownsPrivacyUi()) return;
    try {
      parent.postMessage({ source: MSG_SOURCE, type: "requestState" }, "*");
    } catch (e) {
      /* ignore */
    }
  }

  function onMaskMessage(e) {
    var d = e && e.data;
    if (!d || d.source !== MSG_SOURCE) return;

    if (d.type === "setEnabled") {
      var next = !!d.enabled;
      if (next === masking) {
        if (masking) scheduleApply();
        return;
      }
      setMasking(next, true);
      return;
    }

    if (d.type === "requestState" && ownsPrivacyUi()) {
      try {
        if (e.source) {
          e.source.postMessage(
            { source: MSG_SOURCE, type: "setEnabled", enabled: masking },
            "*"
          );
        }
      } catch (err) {
        /* ignore */
      }
    }
  }

  function watchIframeLoads() {
    if (!ownsPrivacyUi()) return;
    document.addEventListener(
      "load",
      function (ev) {
        var t = ev && ev.target;
        if (!t || t.tagName !== "IFRAME" || !t.contentWindow) return;
        try {
          t.contentWindow.postMessage(
            { source: MSG_SOURCE, type: "setEnabled", enabled: masking },
            "*"
          );
        } catch (err) {
          /* ignore */
        }
      },
      true
    );
  }

  function shouldSkipNode(node) {
    if (!node) return true;
    if (node.nodeType === 3) {
      return shouldSkipNode(node.parentElement);
    }
    if (node.nodeType !== 1) return true;
    if (node.closest && node.closest(SKIP_SELECTOR)) return true;
    return false;
  }

  function addToken(raw, kind) {
    if (raw == null) return;
    var value = String(raw).trim();
    if (!value || value === "N/A" || value === "-" || value === "—") return;
    if (kind === "name" && value.length < 2) return;
    if (kind === "id" && value.length < 3) return;

    var existing = tokenKinds.get(value);
    if (!existing || kind === "email" || (kind === "id" && existing === "name")) {
      tokenKinds.set(value, kind);
    }

    if (kind === "email") {
      var at = value.indexOf("@");
      if (at > 0) {
        var local = value.slice(0, at);
        if (local.length >= 2) {
          tokenKinds.set(local, "email-local");
        }
      }
    }
  }

  function harvestObject(value, depth) {
    if (value == null || depth > 8) return;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        harvestObject(value[i], depth + 1);
      }
      return;
    }
    if (typeof value !== "object") return;

    var firstName = null;
    var lastName = null;

    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      var child = value[key];
      var kind = PII_JSON_KEYS[key];
      if (kind && (typeof child === "string" || typeof child === "number")) {
        addToken(child, kind);
        if (
          key === "FirstName" ||
          key === "firstName" ||
          key === "PreferredFirstName" ||
          key === "LegalFirstName"
        ) {
          firstName = String(child).trim();
        }
        if (
          key === "LastName" ||
          key === "lastName" ||
          key === "PreferredLastName" ||
          key === "LegalLastName"
        ) {
          lastName = String(child).trim();
        }
      } else if (child && typeof child === "object") {
        harvestObject(child, depth + 1);
      }
    }

    // Engagement / tone UIs render "First Last" and "Last, First" — register both.
    if (firstName && lastName) {
      addToken(firstName + " " + lastName, "name");
      addToken(lastName + ", " + firstName, "name");
    }
  }

  function harvestFromTextBlob(text) {
    if (!text || typeof text !== "string") return;
    if (text.charAt(0) !== "{" && text.charAt(0) !== "[") return;
    try {
      harvestObject(JSON.parse(text), 0);
    } catch (e) {
      /* not JSON */
    }
  }

  /** First character kept; remaining characters replaced with '*'. */
  function maskAtom(value) {
    var s = String(value == null ? "" : value);
    if (s.length <= 1) return s;
    var stars = "";
    for (var i = 1; i < s.length; i++) stars += "*";
    return s.charAt(0) + stars;
  }

  /**
   * Mask each alphanumeric word in a display name, preserving spaces,
   * commas, hyphens, and apostrophes as separators.
   * "Justin Bamberg" → "J***** B******"
   * "Bamberg, Justin" → "B******, J*****"
   * "Mary-Jane" → "M***-J***"
   */
  function maskNameLike(original) {
    return String(original).replace(/[A-Za-z0-9]+/g, maskAtom);
  }

  function maskEmail(match) {
    var at = match.indexOf("@");
    if (at <= 0) return maskAtom(match);
    return maskAtom(match.slice(0, at)) + match.slice(at);
  }

  function maskForKind(kind, original) {
    var value = String(original == null ? "" : original);
    if (kind === "email") {
      return maskEmail(value);
    }
    if (kind === "email-local") {
      return maskAtom(value);
    }
    if (kind === "id") {
      // Usernames / OrgDefinedId: first letter + stars for the rest
      return maskAtom(value);
    }
    // name (and any other): mask each word
    return maskNameLike(value);
  }

  function getSortedTokens() {
    return Array.from(tokenKinds.keys()).sort(function (a, b) {
      return b.length - a.length;
    });
  }

  function maskString(input) {
    if (input == null) return input;
    var text = String(input);
    if (!text) return text;

    text = text.replace(EMAIL_RE, maskEmail);

    var tokens = getSortedTokens();
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (!token || text.indexOf(token) === -1) continue;
      var kind = tokenKinds.get(token) || "name";
      var replacement = maskForKind(kind, token);
      // Split/join avoids regex special-char issues in names/IDs
      text = text.split(token).join(replacement);
    }
    return text;
  }

  function restoreTextNodes(root) {
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (shouldSkipNode(node)) continue;
      if (textOriginals.has(node)) {
        node.nodeValue = textOriginals.get(node);
      }
    }
  }

  function rememberOriginalText(node, current) {
    if (!textOriginals.has(node)) {
      textOriginals.set(node, current);
      return current;
    }
    var stored = textOriginals.get(node);
    var maskedStored = maskString(stored);
    // Page rewrote this text node with new live data while mask was off/on
    if (current !== stored && current !== maskedStored) {
      textOriginals.set(node, current);
      return current;
    }
    return stored;
  }

  function applyTextNodes(root) {
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (shouldSkipNode(node)) continue;
      var current = node.nodeValue;
      if (current == null || current === "") continue;
      var original = rememberOriginalText(node, current);
      var masked = maskString(original);
      if (masked !== current) {
        node.nodeValue = masked;
      }
    }
  }

  function applyFormFields(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var fields = scope.querySelectorAll
      ? scope.querySelectorAll("input, textarea, option")
      : [];
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (shouldSkipNode(el)) continue;
      if (el.closest && el.closest("#" + PANEL_ID)) continue;

      var type = (el.type || "").toLowerCase();
      if (
        type === "password" ||
        type === "hidden" ||
        type === "checkbox" ||
        type === "radio" ||
        type === "file" ||
        type === "submit" ||
        type === "button"
      ) {
        continue;
      }

      if (!valueOriginals.has(el)) {
        valueOriginals.set(el, el.value);
      }
      var original = valueOriginals.get(el);
      var next = masking ? maskString(original) : original;
      if (el.value !== next) {
        el.value = next;
      }
    }
  }

  function applyAttributes(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var els = scope.querySelectorAll
      ? scope.querySelectorAll("[title],[aria-label],[placeholder],[alt]")
      : [];
    var attrs = ["title", "aria-label", "placeholder", "alt"];

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (shouldSkipNode(el)) continue;
      if (!attrOriginals.has(el)) {
        var snap = {};
        for (var a = 0; a < attrs.length; a++) {
          if (el.hasAttribute(attrs[a])) {
            snap[attrs[a]] = el.getAttribute(attrs[a]);
          }
        }
        attrOriginals.set(el, snap);
      }
      var originalSnap = attrOriginals.get(el);
      for (var key in originalSnap) {
        if (!Object.prototype.hasOwnProperty.call(originalSnap, key)) continue;
        var nextVal = masking ? maskString(originalSnap[key]) : originalSnap[key];
        if (el.getAttribute(key) !== nextVal) {
          el.setAttribute(key, nextVal);
        }
      }
    }
  }

  function harvestVisibleEmails() {
    if (!document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (shouldSkipNode(node)) continue;
      var text = node.nodeValue || "";
      var match;
      EMAIL_RE.lastIndex = 0;
      while ((match = EMAIL_RE.exec(text)) !== null) {
        addToken(match[0], "email");
      }
    }
  }

  function applyMaskToDom() {
    if (!document.body) return;
    harvestVisibleEmails();
    if (masking) {
      applyTextNodes(document.body);
      applyFormFields(document.body);
      applyAttributes(document.body);
    } else {
      restoreTextNodes(document.body);
      applyFormFields(document.body);
      applyAttributes(document.body);
    }
    updateChrome();
  }

  function scheduleApply() {
    if (applyTimer) {
      clearTimeout(applyTimer);
    }
    applyTimer = setTimeout(function () {
      applyTimer = null;
      applyMaskToDom();
    }, 80);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(function () {
      if (!masking) return;
      scheduleApply();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#" +
      BANNER_ID +
      "{position:fixed;top:0;left:0;right:0;z-index:100000;display:none;" +
      "align-items:center;justify-content:center;gap:.75rem;padding:.45rem 1rem;" +
      "background:#92400e;color:#fff;font:600 13px/1.4 system-ui,sans-serif;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.18)}" +
      "#" +
      BANNER_ID +
      ".ad-pii-visible{display:flex}" +
      "#" +
      BANNER_ID +
      " button{appearance:none;border:1px solid rgba(255,255,255,.45);background:transparent;" +
      "color:#fff;border-radius:6px;padding:.2rem .55rem;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer}" +
      "#" +
      BANNER_ID +
      " button:hover{background:rgba(255,255,255,.12)}" +
      "body.ad-pii-mask-on{padding-top:2.1rem}" +
      "body.ad-pii-mask-on .sidebar{top:2.1rem;height:calc(100vh - 2.1rem)}" +
      "body.ad-pii-embed.ad-pii-mask-on{padding-top:0}" +
      "#" +
      PANEL_ID +
      "{position:fixed;top:4.5rem;right:1.25rem;z-index:100001;width:min(22rem,calc(100vw - 2rem));" +
      "display:none;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:12px;" +
      "box-shadow:0 12px 40px rgba(15,23,42,.18);overflow:hidden;font:14px/1.45 system-ui,sans-serif}" +
      "#" +
      PANEL_ID +
      ".ad-pii-visible{display:block}" +
      "#" +
      PANEL_ID +
      " .ad-pii-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;" +
      "padding:.85rem 1rem;background:#1a5d1a;color:#fff}" +
      "#" +
      PANEL_ID +
      " .ad-pii-head h2{margin:0;font-size:15px;font-weight:700}" +
      "#" +
      PANEL_ID +
      " .ad-pii-close{appearance:none;border:0;background:transparent;color:#fff;font-size:1.25rem;" +
      "line-height:1;cursor:pointer;padding:.15rem .35rem;border-radius:4px}" +
      "#" +
      PANEL_ID +
      " .ad-pii-close:hover{background:rgba(255,255,255,.15)}" +
      "#" +
      PANEL_ID +
      " .ad-pii-body{padding:1rem}" +
      "#" +
      PANEL_ID +
      " .ad-pii-body p{margin:0 0 .85rem;color:#475569;font-size:13px}" +
      "#" +
      PANEL_ID +
      " .ad-pii-status{margin:0 0 1rem;padding:.55rem .7rem;border-radius:8px;font-size:13px;font-weight:600}" +
      "#" +
      PANEL_ID +
      " .ad-pii-status.on{background:#fef3c7;color:#92400e}" +
      "#" +
      PANEL_ID +
      " .ad-pii-status.off{background:#ecfdf5;color:#065f46}" +
      "#" +
      PANEL_ID +
      " .ad-pii-actions{display:flex;flex-wrap:wrap;gap:.5rem}" +
      "#" +
      PANEL_ID +
      " .ad-pii-actions button{appearance:none;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;" +
      "border-radius:8px;padding:.55rem .85rem;font:600 13px/1.2 system-ui,sans-serif;cursor:pointer}" +
      "#" +
      PANEL_ID +
      " .ad-pii-actions button.primary{background:#1a5d1a;border-color:#1a5d1a;color:#fff}" +
      "#" +
      PANEL_ID +
      " .ad-pii-actions button:hover{filter:brightness(0.97)}" +
      "#" +
      PANEL_ID +
      " .ad-pii-hint{margin:.9rem 0 0;color:#64748b;font-size:12px}";
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureChrome() {
    // Nested tools without a sidebar apply the mask only. The dashboard page
    // owns the banner and panel, including when Brightspace frames the page.
    if (!ownsPrivacyUi()) {
      injectStyles();
      return;
    }

    injectStyles();
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.id = BANNER_ID;
      bannerEl.setAttribute("role", "status");
      bannerEl.innerHTML =
        '<span>Training privacy mask is on — names/IDs show as J***** B******, emails as j******@example.edu</span>' +
        '<button type="button" data-ad-pii="open">Privacy controls</button>';
      document.body.appendChild(bannerEl);
      bannerEl.addEventListener("click", function (e) {
        var t = e.target;
        if (t && t.getAttribute("data-ad-pii") === "open") {
          openPanel();
        }
      });
    }

    if (!panelEl) {
      panelEl = document.createElement("div");
      panelEl.id = PANEL_ID;
      panelEl.setAttribute("role", "dialog");
      panelEl.setAttribute("aria-modal", "false");
      panelEl.setAttribute("aria-labelledby", "ad-pii-mask-title");
      panelEl.innerHTML =
        '<div class="ad-pii-head">' +
        '<h2 id="ad-pii-mask-title">Training privacy mask</h2>' +
        '<button type="button" class="ad-pii-close" data-ad-pii="close" aria-label="Close">&times;</button>' +
        "</div>" +
        '<div class="ad-pii-body">' +
        "<p>Hide names, usernames, IDs, and email addresses before sharing or projecting the Admin Dashboard for training.</p>" +
        '<p class="ad-pii-status off" data-ad-pii="status">Personal data is visible</p>' +
        '<div class="ad-pii-actions">' +
        '<button type="button" class="primary" data-ad-pii="toggle">Hide personal data</button>' +
        '<button type="button" data-ad-pii="close">Close</button>' +
        "</div>" +
        '<p class="ad-pii-hint">Open by clicking your name at the bottom of the sidebar, or press Alt+Shift+P (Option+Shift+P on Mac). You can also type mask~. Names become J***** B******, usernames and IDs j******, emails j******@example.edu (domain kept). Your name in the sidebar stays visible.</p>' +
        "</div>";
      document.body.appendChild(panelEl);
      panelEl.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        var action = t.getAttribute("data-ad-pii");
        if (action === "close") {
          closePanel();
        } else if (action === "toggle") {
          setMasking(!masking);
        }
      });
      statusEl = panelEl.querySelector('[data-ad-pii="status"]');
      toggleBtn = panelEl.querySelector('[data-ad-pii="toggle"]');
    }
  }

  function updateChrome() {
    var navBtn = document.getElementById("nav-user-privacy-btn");
    if (navBtn) navBtn.setAttribute("aria-pressed", masking ? "true" : "false");

    if (!ownsPrivacyUi()) {
      document.body.classList.toggle("ad-pii-embed", true);
      document.body.classList.toggle("ad-pii-mask-on", masking);
      return;
    }
    if (!panelEl || !bannerEl) return;
    document.body.classList.toggle("ad-pii-mask-on", masking);
    bannerEl.classList.toggle("ad-pii-visible", masking);
    panelEl.classList.toggle("ad-pii-visible", panelOpen);

    if (statusEl) {
      statusEl.className = "ad-pii-status " + (masking ? "on" : "off");
      statusEl.textContent = masking
        ? "Personal data is hidden (***)"
        : "Personal data is visible";
    }
    if (toggleBtn) {
      toggleBtn.textContent = masking ? "Show personal data" : "Hide personal data";
      toggleBtn.classList.toggle("primary", !masking);
    }
  }

  function openPanel() {
    if (!ownsPrivacyUi()) return;
    ensureChrome();
    panelOpen = true;
    updateChrome();
    var closeBtn = panelEl.querySelector(".ad-pii-close");
    if (closeBtn) closeBtn.focus();
  }

  function closePanel() {
    panelOpen = false;
    updateChrome();
  }

  function setMasking(on, fromParent) {
    ensureChrome();
    setEnabled(on);
    if (masking) {
      startObserver();
    } else {
      stopObserver();
    }
    applyMaskToDom();
    if (!fromParent) {
      broadcastMaskState();
    }
  }

  function noteResponseText(text) {
    harvestFromTextBlob(text);
    if (masking) scheduleApply();
  }

  function drainEarlyBodies() {
    var queued = window.__adPiiEarlyBodies || [];
    window.__adPiiEarlyBodies = [];
    for (var i = 0; i < queued.length; i++) {
      noteResponseText(queued[i]);
    }
  }

  function wrapFetch() {
    if (typeof window.fetch !== "function" || window.fetch.__adPiiWrapped) {
      return;
    }
    var originalFetch = window.fetch.bind(window);
    function wrappedFetch() {
      return originalFetch.apply(window, arguments).then(function (response) {
        try {
          var clone = response.clone();
          clone.text().then(function (text) {
            noteResponseText(text);
          }).catch(function () {});
        } catch (e) {
          /* ignore */
        }
        return response;
      });
    }
    wrappedFetch.__adPiiWrapped = true;
    window.fetch = wrappedFetch;
  }

  function wrapXhr() {
    if (!window.XMLHttpRequest || XMLHttpRequest.prototype.__adPiiWrapped) {
      return;
    }
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function () {
      this.__adPiiUrl = arguments[1];
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", function () {
        try {
          if (typeof this.responseText === "string") {
            noteResponseText(this.responseText);
          }
        } catch (e) {
          /* ignore */
        }
      });
      return originalSend.apply(this, arguments);
    };

    XMLHttpRequest.prototype.__adPiiWrapped = true;
  }

  var SECRET_SEQUENCE = "mask~";
  var typedBuffer = "";
  var typedTimer = null;

  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function togglePanel() {
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function isChordHotkey(e) {
    // Use e.code (physical key). On Mac, Option/Alt rewrites e.key
    // (e.g. Option+Shift+P → "∏"), so checking e.key === "p" fails.
    var code = e.code || "";
    var isP = code === "KeyP" || (e.key || "").toLowerCase() === "p";

    // Option/Alt+Shift+P (Mac + Windows)
    return e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && isP;
  }

  function noteTypedKey(e) {
    if (isTypingTarget(e.target)) {
      typedBuffer = "";
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Shift") return;

    var ch = e.key || "";
    if (ch.length !== 1) {
      typedBuffer = "";
      return;
    }

    typedBuffer = (typedBuffer + ch).slice(-SECRET_SEQUENCE.length);
    if (typedTimer) clearTimeout(typedTimer);
    typedTimer = setTimeout(function () {
      typedBuffer = "";
    }, 2500);

    if (typedBuffer.toLowerCase() === SECRET_SEQUENCE) {
      typedBuffer = "";
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape" && panelOpen) {
      closePanel();
      return;
    }

    if (isChordHotkey(e)) {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
      return;
    }

    noteTypedKey(e);
  }

  function onNavUserActivate(e) {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") {
      return;
    }
    if (e.type === "keydown") {
      e.preventDefault();
    }
    e.stopPropagation();
    openPanel();
  }

  function wireNavLauncher(root) {
    var scope = root || document;
    var btn =
      scope.querySelector("#nav-user-privacy-btn") ||
      scope.querySelector(".nav-user");
    if (!btn || btn.getAttribute("data-ad-pii-wired") === "1") {
      return !!btn;
    }

    btn.setAttribute("data-ad-pii-wired", "1");
    btn.setAttribute("type", btn.tagName === "BUTTON" ? "button" : btn.getAttribute("type") || "button");
    if (!btn.getAttribute("aria-label")) {
      btn.setAttribute("aria-label", "Open training privacy mask");
    }
    if (!btn.getAttribute("title")) {
      btn.setAttribute("title", "Training privacy mask");
    }
    if (btn.tagName !== "BUTTON" && !btn.hasAttribute("tabindex")) {
      btn.setAttribute("role", "button");
      btn.setAttribute("tabindex", "0");
    }

    btn.addEventListener("click", onNavUserActivate);
    btn.addEventListener("keydown", onNavUserActivate);
    return true;
  }

  function watchForNavLauncher() {
    if (wireNavLauncher(document)) {
      return;
    }
    if (!document.body) return;

    var navWatcher = new MutationObserver(function () {
      if (wireNavLauncher(document)) {
        navWatcher.disconnect();
      }
    });
    navWatcher.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    wrapFetch();
    wrapXhr();
    window.addEventListener("message", onMaskMessage);
    watchIframeLoads();
    ensureChrome();
    drainEarlyBodies();
    masking = isEnabled();
    if (masking) {
      startObserver();
      scheduleApply();
    } else {
      updateChrome();
    }
    if (ownsPrivacyUi()) {
      watchForNavLauncher();
      document.addEventListener("keydown", onKeydown, true);
      broadcastMaskState();
    } else {
      requestParentMaskState();
    }
  }

  window.AdminDashboardPiiMask = {
    open: openPanel,
    close: closePanel,
    enable: function () {
      setMasking(true);
    },
    disable: function () {
      setMasking(false);
    },
    toggle: function () {
      setMasking(!masking);
    },
    isEnabled: function () {
      return !!masking;
    },
    noteResponseText: noteResponseText,
    wireNavLauncher: wireNavLauncher
  };

  wrapFetch();
  wrapXhr();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
