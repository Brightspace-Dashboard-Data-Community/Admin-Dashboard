/**
 * Admin Dashboard — Student Activity Log
 * One student, one course: every timestamped record Brightspace APIs will return.
 * Not an LDAA last-date summary. Content rows are last-visited / completion aggregates,
 * not a click-by-click view/download audit trail.
 */
(function () {
  "use strict";

  var API = window.BrightspaceApi;
  var DETROIT_TZ = "America/Detroit";
  var LOGS_LP = "1.61";
  var BAS_VER = "1.4";
  var MAX_TRACKING_MS = 31 * 24 * 60 * 60 * 1000 - 1000;
  var MAX_LOGIN_WINDOWS = 18;
  var CONCURRENCY = 4;
  var MODAL = "loadingModal";

  var TYPE_META = {
    "course-access": { label: "Course access", academic: false },
    login: { label: "System login", academic: false },
    enrollment: { label: "Enrollment", academic: false },
    assignment: { label: "Assignment", academic: true },
    quiz: { label: "Quiz attempt", academic: true },
    discussion: { label: "Discussion", academic: true },
    content: { label: "Content", academic: false },
    grade: { label: "Grade", academic: false },
    award: { label: "Award", academic: true }
  };

  var FILTERS = [
    { id: "all", label: "All" },
    { id: "academic", label: "Academic only" },
    { id: "assignment", label: "Assignments" },
    { id: "quiz", label: "Quizzes" },
    { id: "discussion", label: "Discussions" },
    { id: "content", label: "Content" },
    { id: "login", label: "Logins" },
    { id: "enrollment", label: "Enrollment" },
    { id: "grade", label: "Grades" },
    { id: "award", label: "Awards" },
    { id: "course-access", label: "Course access" }
  ];

  var state = {
    course: null,
    students: [],
    selectedStudent: null,
    events: [],
    warnings: [],
    scan: {},
    filter: "all",
    dataTable: null,
    busy: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function setStatus(msg) {
    var el = $("salStatus");
    if (el) el.textContent = msg || "";
  }

  function normalizeOuId(raw) {
    var value = String(raw || "").trim();
    return /^\d+$/.test(value) ? value : "";
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    if (Array.isArray(data.Objects)) return data.Objects;
    if (Array.isArray(data.Items)) return data.Items;
    if (Array.isArray(data.PagedResultSet)) return data.PagedResultSet;
    if (Array.isArray(data.Quizzes)) return data.Quizzes;
    if (Array.isArray(data.Forums)) return data.Forums;
    if (Array.isArray(data.Folders)) return data.Folders;
    return [];
  }

  function normalizeNextUrl(next) {
    if (!next) return null;
    if (typeof next !== "string") return null;
    var s = next.trim();
    if (!s) return null;
    if (s.indexOf("/d2l/api/") >= 0) {
      var parts = s.split("/d2l/api/");
      return "/d2l/api/" + parts[1];
    }
    if (s.charAt(0) === "/") return s;
    try {
      var u = new URL(s, window.location.origin);
      return u.pathname + u.search;
    } catch (e) {
      return null;
    }
  }

  function httpMessage(err, fallback) {
    if (!err) return fallback;
    if (err.status === 403) return fallback + " (HTTP 403 — permission denied)";
    if (err.status === 404) return fallback + " (HTTP 404)";
    return err.message || fallback;
  }

  function throwIfCancelled() {
    if (window.LoadingUtils && LoadingUtils.isCancelled(MODAL)) {
      var err = new Error("Cancelled");
      err.name = "CancelledError";
      throw err;
    }
  }

  async function pMap(items, mapper, concurrency) {
    var results = new Array(items.length);
    var i = 0;
    var n = Math.min(concurrency || CONCURRENCY, items.length || 1);
    var workers = [];
    for (var w = 0; w < n; w++) {
      workers.push(
        (async function () {
          while (i < items.length) {
            throwIfCancelled();
            var idx = i++;
            try {
              results[idx] = await mapper(items[idx], idx);
            } catch (e) {
              if (e && e.name === "CancelledError") throw e;
              results[idx] = null;
            }
          }
        })()
      );
    }
    await Promise.all(workers);
    return results;
  }

  async function rawRetry(url) {
    var last = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      throwIfCancelled();
      try {
        return await API.raw(url);
      } catch (e) {
        last = e;
        if (e && e.status === 429 && attempt < 3) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        throw e;
      }
    }
    throw last;
  }

  function parseTime(iso) {
    if (!iso) return 0;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function formatDetroit(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("en-US", {
      timeZone: DETROIT_TZ,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function formatDuration(seconds) {
    var n = Number(seconds);
    if (!isFinite(n) || n < 0) return "";
    var m = Math.floor(n / 60);
    var s = Math.round(n % 60);
    if (m >= 60) {
      var h = Math.floor(m / 60);
      m = m % 60;
      return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }
    return m + ":" + String(s).padStart(2, "0");
  }

  function eventRecord(iso, type, item, detail, extra) {
    extra = extra || {};
    var meta = TYPE_META[type] || { label: type, academic: false };
    return {
      iso: iso,
      type: type,
      typeLabel: extra.typeLabel || meta.label,
      item: item || "",
      detail: detail || "",
      academic: extra.academic != null ? extra.academic : meta.academic,
      source: extra.source || ""
    };
  }

  function entityUserId(entityWrap) {
    var entity = (entityWrap && (entityWrap.Entity || entityWrap.entity)) || entityWrap || {};
    var id =
      entity.EntityId != null
        ? entity.EntityId
        : entity.Identifier != null
          ? entity.Identifier
          : entity.Id != null
            ? entity.Id
            : entity.UserId != null
              ? entity.UserId
              : null;
    if (id == null && entity.SubmittedBy) {
      id = entity.SubmittedBy.Identifier || entity.SubmittedBy.Id || entity.SubmittedBy.UserId;
    }
    if (id == null && entityWrap && entityWrap.UserId != null) id = entityWrap.UserId;
    return id != null ? String(id) : null;
  }

  function matchesUser(wrap, uid) {
    var id = entityUserId(wrap);
    if (id == null) return true;
    return id === String(uid);
  }

  function isStudentRole(member) {
    var role = (member.Role && (member.Role.Name || member.RoleName)) || member.ClasslistRoleName || "";
    if (!role) return true;
    if (/^student|learner/i.test(role)) return true;
    if (/instructor|designer|admin|grader|ta\b|faculty|teacher/i.test(role)) return false;
    return true;
  }

  function normalizeClasslist(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.Items)) return data.Items;
    if (data && Array.isArray(data.Objects)) return data.Objects;
    return [];
  }

  function displayNameFromRecord(u) {
    if (!u) return "User";
    var last = u.LastName || "";
    var first = u.FirstName || "";
    if (last && first) return last + ", " + first;
    return u.DisplayName || u.UniqueName || u.UserName || "User";
  }

  function studentFromClasslist(s) {
    var last = s.LastName || "";
    var first = s.FirstName || "";
    return {
      UserId: s.Identifier || s.UserId,
      OrgDefinedId: s.OrgDefinedId || s.OrgDefinedID || "",
      DisplayName: s.DisplayName || (last && first ? last + ", " + first : last || first) || "Student",
      Email: s.Email || s.EmailAddress || "",
      UserName: s.Username || s.UserName || "",
      LastAccessed: s.LastAccessed || null
    };
  }

  function studentFromUser(u) {
    if (!u) return null;
    return {
      UserId: u.UserId || u.Identifier,
      OrgDefinedId: u.OrgDefinedId || u.OrgDefinedID || "",
      DisplayName: displayNameFromRecord(u),
      Email: (u.ExternalEmail || u.InternalEmail || u.Email || "") + "",
      UserName: u.UserName || u.UniqueName || "",
      LastAccessed: u.LastAccessedDate || u.LastAccessed || null
    };
  }

  function courseLabelFromInfo(info, ouId) {
    if (!info) return "OrgUnit " + ouId;
    var name = info.Name || "";
    var code = info.Code || "";
    if (name && code) return name + " (" + code + ")";
    return name || code || "OrgUnit " + ouId;
  }

  async function resolveCourse(ouId) {
    var info = null;
    try {
      info = await API.courseInfo(ouId);
    } catch (e) {
      info = await API.raw("/d2l/api/lp/" + API.LP + "/orgstructure/" + encodeURIComponent(ouId));
    }
    return {
      id: String(ouId),
      label: courseLabelFromInfo(info, ouId),
      code: (info && info.Code) || "",
      name: (info && info.Name) || "",
      startDate: (info && info.StartDate) || null,
      endDate: (info && info.EndDate) || null
    };
  }

  function trackingWindows(startIso, endIso) {
    var end = endIso ? new Date(endIso) : new Date();
    var start = startIso ? new Date(startIso) : new Date(end.getTime() - 180 * 24 * 60 * 60 * 1000);
    if (isNaN(start.getTime())) start = new Date(end.getTime() - 180 * 24 * 60 * 60 * 1000);
    if (isNaN(end.getTime()) || end.getTime() > Date.now()) end = new Date();
    if (start.getTime() > end.getTime()) start = new Date(end.getTime() - 31 * 24 * 60 * 60 * 1000);
    var windows = [];
    var cursor = start.getTime();
    var endMs = end.getTime();
    while (cursor < endMs && windows.length < MAX_LOGIN_WINDOWS) {
      var winEnd = Math.min(cursor + MAX_TRACKING_MS, endMs);
      windows.push({
        startDateTime: new Date(cursor).toISOString(),
        endDateTime: new Date(winEnd).toISOString()
      });
      cursor = winEnd + 1;
    }
    return windows;
  }

  function flattenTopics(toc) {
    var out = [];
    function walk(modules, parentTitle) {
      if (!modules) return;
      for (var i = 0; i < modules.length; i++) {
        var mod = modules[i];
        if (!mod) continue;
        var title = parentTitle ? parentTitle + " > " + (mod.Title || "Module") : mod.Title || "Module";
        var topics = mod.Topics || [];
        for (var t = 0; t < topics.length; t++) {
          var topic = topics[t];
          if (!topic) continue;
          out.push({
            moduleTitle: title,
            topicTitle: topic.Title || topic.ShortTitle || "Topic",
            topicId: topic.TopicId != null ? topic.TopicId : topic.Id,
            url: topic.Url || "",
            typeId: topic.TypeIdentifier || ""
          });
        }
        if (mod.Modules) walk(mod.Modules, title);
      }
    }
    if (!toc) return out;
    if (Array.isArray(toc)) walk(toc, "");
    else walk(toc.Modules || [], "");
    return out;
  }

  function progressList(data) {
    var list = asArray(data);
    if (list.length) return list;
    if (data && (data.UserId != null || data.TopicId != null || data.ObjectId != null)) return [data];
    var nested = [];
    function walkTopics(nodes) {
      if (!nodes) return;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n) continue;
        if (n.TopicId != null || n.ObjectId != null || n.LastVisited || n.CompletedDate) nested.push(n);
        if (n.Topics) walkTopics(n.Topics);
        if (n.Modules) walkTopics(n.Modules);
      }
    }
    if (data && data.Modules) walkTopics(data.Modules);
    if (data && data.Topics) walkTopics(data.Topics);
    return nested;
  }

  function recordUserId(rec) {
    if (!rec) return null;
    var id = rec.UserId != null ? rec.UserId : rec.Identifier != null ? rec.Identifier : rec.Id;
    return id != null ? String(id) : null;
  }

  function lastVisitedFrom(rec) {
    if (!rec) return null;
    return rec.LastVisited || rec.LastAccessed || rec.DateLastVisited || rec.VisitedDate || null;
  }

  function completedFrom(rec) {
    if (!rec) return { done: false, date: null };
    var date = rec.CompletionDate || rec.CompletedDate || rec.DateCompleted || null;
    var done = rec.IsCompleted === true || rec.Completed === true || rec.isCompleted === true || !!date;
    return { done: done, date: date };
  }

  function visitDetail(rec) {
    if (!rec) return "";
    var parts = [];
    var real = rec.NumRealVisits != null ? rec.NumRealVisits : rec.NumVisits;
    var fake = rec.NumFakeVisits;
    if (real != null && real !== "") parts.push(real + " visit" + (Number(real) === 1 ? "" : "s"));
    if (fake != null && Number(fake) > 0) parts.push(fake + " Pulse/system visit" + (Number(fake) === 1 ? "" : "s"));
    if (rec.TotalTime != null && rec.TotalTime !== "") {
      var dur = formatDuration(rec.TotalTime);
      if (dur) parts.push("total time " + dur);
    }
    if (rec.IsRead === true) parts.push("marked read");
    return parts.join(" · ");
  }

  async function collectLogins(userId, course, events, warnings, onProgress) {
    var windows = trackingWindows(course.startDate, course.endDate);
    var collected = 0;
    for (var i = 0; i < windows.length; i++) {
      throwIfCancelled();
      onProgress(
        "Reading system logins " + (i + 1) + "/" + windows.length + "…",
        12 + Math.round((i / Math.max(windows.length, 1)) * 10)
      );
      var w = windows[i];
      var url =
        "/d2l/api/lp/" +
        LOGS_LP +
        "/users/" +
        encodeURIComponent(userId) +
        "/usertrackinglogs/?startDateTime=" +
        encodeURIComponent(w.startDateTime) +
        "&endDateTime=" +
        encodeURIComponent(w.endDateTime);
      try {
        var logs = asArray(await rawRetry(url));
        for (var j = 0; j < logs.length; j++) {
          var entry = logs[j] || {};
          var when = entry.LoginDate || entry.AttemptDate || entry.Date || null;
          if (!when) continue;
          events.push(
            eventRecord(when, "login", "Brightspace login", entry.IpAddress ? "IP " + entry.IpAddress : "Org-wide login", {
              source: "User tracking logs (org-wide, not course-specific)"
            })
          );
          collected++;
        }
      } catch (e) {
        warnings.push(httpMessage(e, "Could not read system login history"));
        break;
      }
    }
    return collected;
  }

  async function fetchAllPages(path) {
    var out = [];
    var nextUrl = path;
    var seen = {};
    var safety = 200;
    var bookmarkSep = path.indexOf("?") >= 0 ? "&" : "?";
    while (nextUrl && safety-- > 0) {
      throwIfCancelled();
      if (seen[nextUrl]) break;
      seen[nextUrl] = true;
      var page = await rawRetry(nextUrl);
      var items = asArray(page);
      for (var i = 0; i < items.length; i++) out.push(items[i]);
      var nxt = normalizeNextUrl(page && page.Next);
      if (!nxt) {
        var pi = (page && page.PagingInfo) || {};
        if ((pi.HasMoreItems || pi.hasMoreItems) && (pi.Bookmark || pi.bookmark)) {
          nxt = path + bookmarkSep + "bookmark=" + encodeURIComponent(pi.Bookmark || pi.bookmark);
        }
      }
      if (!nxt && items.length && page && page.PagingInfo && items[items.length - 1] && items[items.length - 1].LogId) {
        var more = page.PagingInfo.HasMoreItems || page.PagingInfo.hasMoreItems;
        if (more) nxt = path + bookmarkSep + "bookmark=" + encodeURIComponent(items[items.length - 1].LogId);
      }
      nextUrl = nxt;
    }
    return out;
  }

  async function collectEnrollments(userId, courseId, course, events, warnings) {
    var versions = [API.LP, LOGS_LP];
    var logs = null;
    var lastErr = null;
    for (var v = 0; v < versions.length; v++) {
      var path =
        "/d2l/api/lp/" +
        versions[v] +
        "/users/" +
        encodeURIComponent(userId) +
        "/enrollmentlogs/?orgUnitId=" +
        encodeURIComponent(courseId);
      try {
        logs = await fetchAllPages(path);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      warnings.push(httpMessage(lastErr, "Could not read enrollment logs"));
      return;
    }
    var n = 0;
    for (var i = 0; i < (logs || []).length; i++) {
      var log = logs[i] || {};
      if (log.OrgUnitId != null && String(log.OrgUnitId) !== String(courseId)) continue;
      var when = log.Date || log.ActionDate || log.Timestamp || null;
      if (!when) continue;
      var actionNum = Number(log.Action);
      var action =
        actionNum === 1 ? "Enrolled" : actionNum === 0 ? "Unenrolled" : "Enrollment action " + (log.Action != null ? log.Action : "");
      events.push(
        eventRecord(
          when,
          "enrollment",
          action,
          "Role " + (log.RoleName || log.RoleId || "unknown") + (log.OrgUnitCode ? " · " + log.OrgUnitCode : ""),
          { source: "Enrollment logs" }
        )
      );
      n++;
    }
    state.scan.enrollmentLogs = n;
  }

  function pushAssignmentFromWrap(folderName, wrap, uid, events, requireUserMatch) {
    if (!wrap) return false;
    if (requireUserMatch && entityUserId(wrap) && entityUserId(wrap) !== uid) return false;
    if (!requireUserMatch && !matchesUser(wrap, uid)) return false;
    var submissions = wrap.Submissions || wrap.submissions || [];
    var pushed = false;
    if (Array.isArray(submissions) && submissions.length) {
      for (var i = 0; i < submissions.length; i++) {
        var sub = submissions[i] || {};
        var when =
          sub.SubmissionDate ||
          sub.SubmittedDate ||
          sub.DateSubmitted ||
          sub.CreationDate ||
          sub.CreatedDate ||
          null;
        if (!when) continue;
        var files = [];
        var fileList = sub.Files || [];
        for (var f = 0; f < fileList.length; f++) {
          var name = fileList[f] && (fileList[f].FileName || fileList[f].Name);
          if (name) files.push(name);
        }
        var bits = ["Submission " + (i + 1) + " of " + submissions.length];
        if (files.length) bits.push(files.join(", "));
        if (sub.Comment) bits.push("comment included");
        events.push(
          eventRecord(when, "assignment", folderName, bits.join(" · "), {
            source: "Dropbox submissions"
          })
        );
        pushed = true;
      }
      return pushed;
    }
    var fallback =
      wrap.CompletionDate ||
      wrap.completionDate ||
      wrap.SubmissionDate ||
      wrap.SubmittedDate ||
      wrap.DateSubmitted ||
      wrap.CreatedDate ||
      null;
    if (fallback) {
      events.push(
        eventRecord(fallback, "assignment", folderName, "Submission on record", {
          source: "Dropbox submissions"
        })
      );
      return true;
    }
    return false;
  }

  async function collectAssignments(ouId, uid, events, warnings, onProgress) {
    var folders = [];
    try {
      folders = asArray(await rawRetry("/d2l/api/le/" + API.LE + "/" + ouId + "/dropbox/folders/"));
    } catch (e) {
      warnings.push(httpMessage(e, "Could not list assignments"));
      return;
    }
    state.scan.assignmentFolders = folders.length;
    onProgress("Scanning " + folders.length + " assignment folder(s)…", 28);
    var hits = 0;
    await pMap(
      folders,
      async function (folder) {
        var folderId = folder.Id != null ? folder.Id : folder.FolderId;
        if (folderId == null) return;
        var folderName = folder.Name || "Assignment";
        var before = events.length;
        try {
          var one = await rawRetry(
            "/d2l/api/le/" + API.LE + "/" + ouId + "/dropbox/folders/" + folderId + "/submissions/" + encodeURIComponent(uid)
          );
          if (one) {
            var wraps = asArray(one);
            if (!wraps.length) wraps = [one];
            for (var w = 0; w < wraps.length; w++) {
              pushAssignmentFromWrap(folderName, wraps[w], uid, events, false);
            }
          }
        } catch (e) {
          /* try class list of submissions */
        }
        if (events.length === before) {
          try {
            var subs = asArray(
              await rawRetry(
                "/d2l/api/le/" + API.LE + "/" + ouId + "/dropbox/folders/" + folderId + "/submissions/?activeOnly=true"
              )
            );
            for (var i = 0; i < subs.length; i++) {
              pushAssignmentFromWrap(folderName, subs[i], uid, events, true);
            }
          } catch (e2) {
            /* none */
          }
        }
        hits += events.length > before ? 1 : 0;
      },
      CONCURRENCY
    );
    state.scan.assignmentFoldersWithWork = hits;
  }

  function attemptDate(att) {
    if (!att) return null;
    return (
      att.Completed ||
      att.Started ||
      att.SubmittedDate ||
      att.SubmissionDate ||
      att.CompletionDate ||
      att.EndDate ||
      att.StartDate ||
      null
    );
  }

  function quizUserId(att) {
    if (!att) return null;
    if (att.UserId != null) return String(att.UserId);
    var u = att.User || att.Student || {};
    if (u.Identifier != null) return String(u.Identifier);
    if (u.Id != null) return String(u.Id);
    if (u.UserId != null) return String(u.UserId);
    return null;
  }

  async function collectQuizzes(ouId, uid, events, warnings, onProgress) {
    var quizList = [];
    try {
      quizList = asArray(await rawRetry("/d2l/api/le/" + API.LE + "/" + ouId + "/quizzes/"));
    } catch (e) {
      warnings.push(httpMessage(e, "Could not list quizzes"));
      return;
    }
    state.scan.quizzes = quizList.length;
    onProgress("Scanning " + quizList.length + " quiz(zes)…", 48);
    await pMap(
      quizList,
      async function (quiz) {
        var qid = quiz.QuizId != null ? quiz.QuizId : quiz.Id;
        if (qid == null) return;
        var qname = quiz.Name || "Quiz";
        var attempts = [];
        try {
          attempts = asArray(
            await rawRetry("/d2l/api/le/" + API.LE + "/" + ouId + "/quizzes/" + qid + "/attempts/")
          );
        } catch (e) {
          return;
        }
        var n = 0;
        for (var i = 0; i < attempts.length; i++) {
          var att = attempts[i];
          var attUid = quizUserId(att);
          if (attUid && attUid !== uid) continue;
          if (!attUid) continue;
          n++;
          var when = attemptDate(att);
          if (!when) continue;
          var bits = [];
          if (att.AttemptNumber != null) bits.push("Attempt " + att.AttemptNumber);
          else bits.push("Attempt " + n);
          if (att.Started) bits.push("started " + formatDetroit(att.Started));
          if (att.Completed) bits.push("completed " + formatDetroit(att.Completed));
          if (att.Score != null && att.Score !== "") bits.push("score " + att.Score);
          events.push(
            eventRecord(when, "quiz", qname, bits.join(" · "), {
              source: "Quiz attempts"
            })
          );
        }
      },
      CONCURRENCY
    );
  }

  function posterId(post) {
    if (!post) return null;
    if (post.PostingUserId != null) return String(post.PostingUserId);
    if (post.UserId != null) return String(post.UserId);
    if (post.UserIdentifier != null) return String(post.UserIdentifier);
    var u = post.PostingUser || post.User || {};
    if (u.Identifier != null) return String(u.Identifier);
    if (u.UserId != null) return String(u.UserId);
    if (u.Id != null) return String(u.Id);
    return null;
  }

  async function collectDiscussions(ouId, uid, events, warnings, onProgress) {
    var forums = [];
    try {
      forums = asArray(await rawRetry("/d2l/api/le/" + API.LE + "/" + ouId + "/discussions/forums/"));
    } catch (e) {
      warnings.push(httpMessage(e, "Could not list discussion forums"));
      return;
    }
    state.scan.forums = forums.length;
    onProgress("Scanning discussions…", 62);
    for (var fi = 0; fi < forums.length; fi++) {
      throwIfCancelled();
      var forum = forums[fi];
      var fid = forum.ForumId != null ? forum.ForumId : forum.Id;
      if (fid == null) continue;
      var forumName = forum.Name || "Forum";
      var topics = [];
      try {
        topics = asArray(await API.forumTopics(ouId, fid));
      } catch (e) {
        continue;
      }
      for (var ti = 0; ti < topics.length; ti++) {
        throwIfCancelled();
        var topic = topics[ti];
        var tid = topic.TopicId != null ? topic.TopicId : topic.Id;
        if (tid == null) continue;
        var topicName = topic.Name || "Topic";
        try {
          var posts = asArray(await API.topicPosts(ouId, fid, tid));
          for (var pi = 0; pi < posts.length; pi++) {
            var post = posts[pi];
            var poster = posterId(post);
            if (poster !== uid) continue;
            var pDate = post.PostDate || post.DatePosted;
            if (!pDate) continue;
            var kind = post.IsReply || post.ParentPostId ? "Reply" : "Thread post";
            var subject = post.Subject || "";
            events.push(
              eventRecord(pDate, "discussion", forumName + " / " + topicName, kind + (subject ? " · " + subject : ""), {
                source: "Discussion posts"
              })
            );
          }
        } catch (e2) {
          /* skip topic */
        }
      }
    }
  }

  async function collectGrades(ouId, uid, events, warnings) {
    try {
      var grades = asArray(await rawRetry("/d2l/api/le/" + API.LE + "/" + ouId + "/grades/values/" + encodeURIComponent(uid) + "/"));
      state.scan.gradeItems = grades.length;
      for (var i = 0; i < grades.length; i++) {
        var g = grades[i];
        if (!g) continue;
        var when = g.LastModified || g.GradedDate || g.DateLastGraded || (g.Comments && g.Comments.LastModified) || null;
        if (!when) continue;
        var name = g.GradeObjectName || "Grade item";
        var score = g.PointsNumerator != null ? String(g.PointsNumerator) : "";
        var isLti = /lti|publisher|external|mindtap|cengage|pearson|mcgraw|wiley/i.test(String(name));
        events.push(
          eventRecord(when, "grade", name, (score ? "Score " + score + " · " : "") + "Last modified (may be instructor grading)", {
            academic: isLti,
            source: "Gradebook values"
          })
        );
      }
    } catch (e) {
      warnings.push(httpMessage(e, "Could not read gradebook values"));
    }
  }

  function topicKey(topic) {
    return String(topic.topicId != null ? topic.topicId : topic.TopicId || "");
  }

  function progressObjectId(rec) {
    if (!rec) return null;
    var id = rec.ObjectId != null ? rec.ObjectId : rec.TopicId != null ? rec.TopicId : rec.ContentObjectId;
    return id != null ? String(id) : null;
  }

  function emitContentRecord(events, rec, titleById, ltiById, uid) {
    if (!rec) return;
    if (recordUserId(rec) && recordUserId(rec) !== String(uid)) return;
    var id = progressObjectId(rec);
    var last = lastVisitedFrom(rec);
    var done = completedFrom(rec);
    if (!last && !done.date) return;
    var visits = visitDetail(rec);
    var lti = !!(id && ltiById[id]);
    var item = (id && titleById[id]) || (id ? "Content topic " + id : "Content topic");
    if (last) {
      var detail = (visits ? visits + " · " : "") + "Last visited" + (lti ? " · LTI/external" : "");
      var academic = !!(done.date && done.date === last);
      events.push(
        eventRecord(last, "content", item, academic ? detail + " · Completed" : detail, {
          typeLabel: academic ? "Content completed" : "Content last visited",
          academic: academic,
          source: "Content user progress"
        })
      );
    }
    if (done.date && done.date !== last) {
      events.push(
        eventRecord(done.date, "content", item, "Completed" + (lti ? " · LTI/external" : ""), {
          typeLabel: "Content completed",
          academic: true,
          source: "Content user progress"
        })
      );
    }
  }

  async function collectContent(ouId, uid, events, warnings, onProgress) {
    onProgress("Loading content progress…", 82);
    var titleById = {};
    var ltiById = {};
    var topics = [];
    try {
      var toc = await rawRetry(
        "/d2l/api/le/" + API.LE + "/" + ouId + "/content/toc?ignoreModuleDateRestrictions=true"
      );
      topics = flattenTopics(toc);
    } catch (e1) {
      try {
        var toc2 = await rawRetry("/d2l/api/le/" + API.LE + "/" + ouId + "/content/toc");
        topics = flattenTopics(toc2);
      } catch (e) {
        warnings.push(httpMessage(e, "Could not load content table of contents; content rows will use topic IDs"));
      }
    }
    for (var t = 0; t < topics.length; t++) {
      var topic = topics[t];
      if (topic.topicId == null) continue;
      var key = String(topic.topicId);
      titleById[key] = topic.moduleTitle ? topic.moduleTitle + " / " + topic.topicTitle : topic.topicTitle;
      ltiById[key] = /lti|external/i.test(String(topic.url || "") + " " + String(topic.typeId || ""));
    }
    state.scan.contentTitles = titleById;
    state.scan.contentTopics = topics.length;
    state.scan.contentTopicIds = topics
      .map(function (topic) {
        return topic.topicId != null ? String(topic.topicId) : "";
      })
      .filter(Boolean);

    var recs = [];
    var listFailed = false;
    try {
      recs = await fetchAllPages(
        "/d2l/api/le/" + API.LE + "/" + ouId + "/content/userprogress/?userId=" + encodeURIComponent(uid) + "&pageSize=100"
      );
    } catch (e) {
      try {
        recs = await fetchAllPages(
          "/d2l/api/le/" + API.LE + "/" + ouId + "/content/userprogress/?userId=" + encodeURIComponent(uid)
        );
      } catch (e2) {
        listFailed = true;
        warnings.push(
          httpMessage(e2, "Could not read content user progress") +
            ". Upload the Content User Progress Data Hub CSV to get last-visited data."
        );
      }
    }

    var byId = {};
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      if (recordUserId(rec) && recordUserId(rec) !== uid) continue;
      var id = progressObjectId(rec);
      if (!id) continue;
      byId[id] = rec;
    }

    // Per-topic live calls 404 on this LMS when the list route is missing. Skip that storm.
    if (!listFailed && Object.keys(byId).length === 0) {
      var missing = topics.filter(function (topic) {
        return topic.topicId != null && !byId[String(topic.topicId)];
      });
      if (missing.length) {
        onProgress("Checking " + missing.length + " content topic(s)…", 88);
        await pMap(
          missing.slice(0, 300),
          async function (topic) {
            try {
              var page = await rawRetry(
                "/d2l/api/le/" +
                  API.LE +
                  "/" +
                  ouId +
                  "/content/userprogress/" +
                  encodeURIComponent(topic.topicId) +
                  "?userId=" +
                  encodeURIComponent(uid)
              );
              var list = progressList(page);
              if (!list.length && page && (page.ObjectId != null || page.LastVisited || page.Visited)) list = [page];
              for (var p = 0; p < list.length; p++) {
                if (recordUserId(list[p]) && recordUserId(list[p]) !== uid) continue;
                var oid = progressObjectId(list[p]) || String(topic.topicId);
                byId[oid] = list[p];
              }
            } catch (e) {
              /* skip topic */
            }
          },
          CONCURRENCY
        );
      }
    }

    var visited = 0;
    Object.keys(byId).forEach(function (id) {
      var rec = byId[id];
      var before = events.length;
      emitContentRecord(events, rec, titleById, ltiById, uid);
      if (events.length > before) visited++;
    });
    state.scan.contentVisited = visited;

    if (!topics.length && !Object.keys(byId).length) {
      warnings.push("No content topics or user-progress rows were returned for this course.");
    }
  }

  async function collectAwards(userId, courseId, events, warnings) {
    var url = "/d2l/api/bas/" + BAS_VER + "/issued/users/" + encodeURIComponent(String(userId)) + "/";
    var guard = 0;
    try {
      while (url && guard < 40) {
        throwIfCancelled();
        guard++;
        var page = await rawRetry(url);
        var objs = (page && page.Objects) || asArray(page);
        for (var i = 0; i < objs.length; i++) {
          var obj = objs[i] || {};
          if (obj.OrgUnitId != null && String(obj.OrgUnitId) !== String(courseId)) continue;
          var when = obj.IssuedDate || obj.DateIssued || null;
          if (!when) continue;
          var title = (obj.Award && (obj.Award.Title || obj.Award.Name)) || "Award";
          events.push(eventRecord(when, "award", title, "Issued in this course", { source: "Awards issued" }));
        }
        var next = page && page.Next;
        if (!next) break;
        if (typeof next === "string" && next.indexOf("/d2l/api/") >= 0) {
          var parts = next.split("/d2l/api/");
          url = "/d2l/api/" + parts[1];
        } else if (typeof next === "string" && next.charAt(0) === "/") {
          url = next;
        } else {
          break;
        }
      }
    } catch (e) {
      warnings.push(httpMessage(e, "Could not read issued awards"));
    }
  }

  async function collectCourseAccess(ouId, uid, hintIso, events) {
    var when = hintIso || null;
    if (!when) {
      try {
        var access = await API.lastAccess(ouId, uid);
        when = access && (access.LastAccessed || access.LastAccess || access.DateLastAccessed);
      } catch (e) {
        when = null;
      }
    }
    if (when) {
      events.push(
        eventRecord(when, "course-access", "Last course access", "Classlist / course access API (latest only, not a visit history)", {
          source: "Course last access"
        })
      );
    }
  }

  function csvField(row, names) {
    var keys = Object.keys(row || {});
    for (var n = 0; n < names.length; n++) {
      var target = String(names[n] || "").trim().toLowerCase();
      for (var k = 0; k < keys.length; k++) {
        if (String(keys[k] || "").replace(/^\uFEFF/, "").trim().toLowerCase() === target) {
          return String(row[keys[k]] == null ? "" : row[keys[k]]).trim();
        }
      }
    }
    return "";
  }

  function csvDateToIso(raw) {
    if (!raw) return "";
    var text = String(raw).trim();
    if (!text || text === "null") return "";
    var d = new Date(text);
    if (!isNaN(d.getTime())) return d.toISOString();
    return text;
  }

  function idsMatch(a, b) {
    return String(a || "").trim() !== "" && String(a).trim() === String(b || "").trim();
  }

  function studentCsvMatch(row, student) {
    var uid = csvField(row, ["UserId", "User ID", "Identifier"]);
    if (uid && idsMatch(uid, student.UserId)) return true;
    var org = csvField(row, ["OrgDefinedId", "Org Defined ID", "OrgDefinedID"]);
    if (org && student.OrgDefinedId && idsMatch(org, student.OrgDefinedId)) return true;
    var un = csvField(row, ["UserName", "Username", "UniqueName"]);
    if (un && student.UserName && idsMatch(un, student.UserName)) return true;
    return false;
  }

  function streamFilterCsv(file, shouldKeep, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!window.Papa) {
        reject(new Error("PapaParse did not load. Refresh the page and try again."));
        return;
      }
      var matched = [];
      var total = 0;
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: function (h) {
          return String(h || "").replace(/^\uFEFF/, "").trim();
        },
        delimitersToGuess: [",", "\t", "|", ";"],
        step: function (results, parser) {
          var row = results.data || {};
          var has = Object.keys(row).some(function (key) {
            return key !== "__parsed_extra" && String(row[key] == null ? "" : row[key]).trim() !== "";
          });
          if (!has) return;
          total += 1;
          if (shouldKeep(row)) matched.push(row);
          if (onProgress && total % 20000 === 0) {
            var pct =
              file.size && results.meta && results.meta.cursor
                ? Math.min(99, Math.round((results.meta.cursor / file.size) * 100))
                : null;
            onProgress(pct, total, matched.length);
            parser.pause();
            setTimeout(function () {
              parser.resume();
            }, 0);
          }
        },
        complete: function () {
          resolve({ rows: matched, total: total });
        },
        error: function (err) {
          reject(err);
        }
      });
    });
  }

  function dedupeEvents(events) {
    var seen = {};
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var key = [ev.type, ev.iso, ev.item, ev.detail].join("\t");
      if (seen[key]) continue;
      seen[key] = true;
      out.push(ev);
    }
    return out;
  }

  async function mergeHubCsvs(course, student, events, warnings, onProgress) {
    var loginsFile = $("salCsvLogins") && $("salCsvLogins").files && $("salCsvLogins").files[0];
    var accessFile = $("salCsvCourseAccess") && $("salCsvCourseAccess").files && $("salCsvCourseAccess").files[0];
    var contentFile = $("salCsvContent") && $("salCsvContent").files && $("salCsvContent").files[0];
    if (!loginsFile && !accessFile && !contentFile) return;

    var topicIds = {};
    (state.scan.contentTopicIds || []).forEach(function (id) {
      topicIds[String(id)] = true;
    });

    if (loginsFile) {
      onProgress("Filtering User Logins CSV…", 92);
      try {
        var loginResult = await streamFilterCsv(
          loginsFile,
          function (row) {
            return studentCsvMatch(row, student);
          },
          function (pct, total, matched) {
            onProgress("User Logins CSV: " + total.toLocaleString() + " rows (" + matched + " matches)…", 92);
          }
        );
        for (var i = 0; i < loginResult.rows.length; i++) {
          var row = loginResult.rows[i];
          var when = csvDateToIso(csvField(row, ["AttemptDate", "LoginDate", "Attempt Date", "Date"]));
          if (!when) continue;
          var ip = csvField(row, ["IP", "IpAddress", "IPAddress"]);
          events.push(
            eventRecord(when, "login", "Brightspace login", ip ? "IP " + ip : "Org-wide login", {
              source: "Data Hub User Logins"
            })
          );
        }
        state.scan.hubLogins = loginResult.rows.length;
      } catch (e) {
        warnings.push("User Logins CSV: " + (e.message || e));
      }
    }

    if (accessFile) {
      onProgress("Filtering Course Access CSV…", 94);
      try {
        var accessResult = await streamFilterCsv(
          accessFile,
          function (row) {
            if (!studentCsvMatch(row, student)) return false;
            var ou = csvField(row, ["OrgUnitId", "Org Unit Id", "OrgUnitID"]);
            return !ou || idsMatch(ou, course.id);
          },
          function (pct, total, matched) {
            onProgress("Course Access CSV: " + total.toLocaleString() + " rows (" + matched + " matches)…", 94);
          }
        );
        for (var a = 0; a < accessResult.rows.length; a++) {
          var arow = accessResult.rows[a];
          var day = csvDateToIso(csvField(arow, ["DayAccessed", "Day Accessed", "DateAccessed", "Date"]));
          if (!day) continue;
          events.push(
            eventRecord(day, "course-access", "Course accessed that day", "Data Hub Course Access (one row per day in this course)", {
              source: "Data Hub Course Access"
            })
          );
        }
        state.scan.hubCourseAccess = accessResult.rows.length;
      } catch (e2) {
        warnings.push("Course Access CSV: " + (e2.message || e2));
      }
    }

    if (contentFile) {
      onProgress("Filtering Content User Progress CSV…", 96);
      try {
        var contentResult = await streamFilterCsv(
          contentFile,
          function (row) {
            return studentCsvMatch(row, student);
          },
          function (pct, total, matched) {
            onProgress("Content User Progress CSV: " + total.toLocaleString() + " rows (" + matched + " matches)…", 96);
          }
        );
        var contentRows = contentResult.rows;
        if (Object.keys(topicIds).length) {
          var inCourse = contentRows.filter(function (row) {
            var objectId = csvField(row, ["ContentObjectId", "ObjectId", "TopicId"]);
            return objectId && topicIds[objectId];
          });
          if (inCourse.length) {
            contentRows = inCourse;
          } else if (contentRows.length) {
            warnings.push(
              "Content User Progress rows for this student did not match this course's topic IDs. Showing all of this student's content progress."
            );
          }
        }
        var added = 0;
        for (var c = 0; c < contentRows.length; c++) {
          var crow = contentRows[c];
          var rec = {
            UserId: csvField(crow, ["UserId"]),
            ObjectId: csvField(crow, ["ContentObjectId", "ObjectId", "TopicId"]),
            LastVisited: csvField(crow, ["LastVisited", "Last Visited"]),
            CompletedDate: csvField(crow, ["CompletedDate", "Completed Date", "DateCompleted"]),
            NumRealVisits: csvField(crow, ["NumRealVisits", "NumVisits"]),
            NumFakeVisits: csvField(crow, ["NumFakeVisits"]),
            TotalTime: csvField(crow, ["TotalTime", "Total Time"]),
            IsVisited: csvField(crow, ["IsVisited"]),
            IsRead: csvField(crow, ["IsRead"])
          };
          var id = rec.ObjectId;
          var item = id && state.scan.contentTitles && state.scan.contentTitles[id] ? state.scan.contentTitles[id] : id ? "Content topic " + id : "Content topic";
          var last = csvDateToIso(rec.LastVisited);
          var done = csvDateToIso(rec.CompletedDate);
          var visits = visitDetail(rec);
          if (!last && !done) continue;
          if (last) {
            events.push(
              eventRecord(last, "content", item, (visits ? visits + " · " : "") + "Last visited", {
                typeLabel: "Content last visited",
                source: "Data Hub Content User Progress"
              })
            );
            added++;
          }
          if (done && done !== last) {
            events.push(
              eventRecord(done, "content", item, "Completed", {
                typeLabel: "Content completed",
                academic: true,
                source: "Data Hub Content User Progress"
              })
            );
            added++;
          }
        }
        state.scan.hubContent = added;
      } catch (e3) {
        warnings.push("Content User Progress CSV: " + (e3.message || e3));
      }
    }
  }

  function sortEvents(events) {
    events.sort(function (a, b) {
      return parseTime(b.iso) - parseTime(a.iso);
    });
  }

  function filteredEvents() {
    var filter = state.filter;
    return state.events.filter(function (ev) {
      if (filter === "all") return true;
      if (filter === "academic") return !!ev.academic;
      return ev.type === filter;
    });
  }

  function countByType(type) {
    var n = 0;
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].type === type) n++;
    }
    return n;
  }

  function toCsvValue(value) {
    var text = value == null ? "" : String(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function downloadCsv() {
    var rows = filteredEvents();
    var student = state.selectedStudent || {};
    var course = state.course || {};
    var headers = [
      "WhenDetroit",
      "WhenUtc",
      "Type",
      "Item",
      "Detail",
      "Academic",
      "Source",
      "StudentName",
      "OrgDefinedId",
      "UserId",
      "Course",
      "OrgUnitId"
    ];
    var lines = [headers.join(",")];
    for (var i = 0; i < rows.length; i++) {
      var ev = rows[i];
      lines.push(
        [
          toCsvValue(formatDetroit(ev.iso)),
          toCsvValue(ev.iso || ""),
          toCsvValue(ev.typeLabel || ev.type),
          toCsvValue(ev.item),
          toCsvValue(ev.detail),
          toCsvValue(ev.academic ? "Yes" : "No"),
          toCsvValue(ev.source),
          toCsvValue(student.DisplayName),
          toCsvValue(student.OrgDefinedId),
          toCsvValue(student.UserId),
          toCsvValue(course.label),
          toCsvValue(course.id)
        ].join(",")
      );
    }
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download =
      "StudentActivityLog_" +
      (student.OrgDefinedId || student.UserId || "student") +
      "_" +
      (course.id || "course") +
      "_" +
      stamp +
      ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function destroyTable() {
    var jq = window.jQuery;
    if (state.dataTable && jq && jq.fn.DataTable && jq.fn.DataTable.isDataTable("#activityTable")) {
      state.dataTable.clear().destroy();
    }
    state.dataTable = null;
  }

  function renderTable() {
    destroyTable();
    var tbody = document.querySelector("#activityTable tbody");
    if (!tbody) return;
    var rows = filteredEvents();
    tbody.innerHTML = rows
      .map(function (ev) {
        var badgeClass = "type-badge type-" + ev.type;
        return (
          "<tr>" +
          '<td class="when-cell">' +
          escapeHtml(formatDetroit(ev.iso)) +
          "</td>" +
          "<td><span class=\"" +
          badgeClass +
          '">' +
          escapeHtml(ev.typeLabel || ev.type) +
          "</span></td>" +
          '<td class="item-cell">' +
          escapeHtml(ev.item) +
          "</td>" +
          '<td class="detail-cell">' +
          escapeHtml(ev.detail) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    var jq = window.jQuery;
    if (jq && jq.fn.DataTable) {
      state.dataTable = jq("#activityTable").DataTable({
        pageLength: 50,
        order: [],
        autoWidth: false,
        deferRender: true
      });
    }
    $("salCsvBtn").disabled = rows.length === 0;
  }

  function renderKpis() {
    var host = $("salKpis");
    var items = [
      ["Events", state.events.length],
      ["Assignments", countByType("assignment")],
      ["Quiz attempts", countByType("quiz")],
      ["Discussions", countByType("discussion")],
      ["Content", countByType("content")],
      ["Logins", countByType("login")]
    ];
    host.innerHTML = items
      .map(function (item) {
        return (
          '<div class="sal-kpi"><div class="sal-kpi-label">' +
          escapeHtml(item[0]) +
          '</div><div class="sal-kpi-value">' +
          item[1] +
          "</div></div>"
        );
      })
      .join("");
  }

    function renderWarnings() {
    var host = $("salWarnings");
    if (!state.warnings.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML =
      '<div class="warnings-box"><strong>Some sources were unavailable</strong><ul>' +
      state.warnings
        .map(function (w) {
          return "<li>" + escapeHtml(w) + "</li>";
        })
        .join("") +
      "</ul></div>";
  }

  function renderScan() {
    var host = $("salScan");
    if (!host) return;
    var s = state.scan || {};
    var bits = [];
    if (s.contentTopics != null) bits.push(s.contentTopics + " content topics in TOC");
    if (s.contentVisited != null) bits.push(s.contentVisited + " with visit/completion dates");
    if (s.assignmentFolders != null) bits.push(s.assignmentFolders + " assignment folders scanned");
    if (s.quizzes != null) bits.push(s.quizzes + " quizzes scanned");
    if (s.forums != null) bits.push(s.forums + " discussion forums scanned");
    if (s.gradeItems != null) bits.push(s.gradeItems + " grade items returned");
    if (s.enrollmentLogs != null) bits.push(s.enrollmentLogs + " enrollment log rows");
    if (s.hubLogins != null) bits.push(s.hubLogins + " User Logins CSV rows");
    if (s.hubCourseAccess != null) bits.push(s.hubCourseAccess + " Course Access CSV days");
    if (s.hubContent != null) bits.push(s.hubContent + " Content User Progress CSV events");
    if (!bits.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = '<p class="tool-meta" style="margin-bottom:14px;">Scanned: ' + escapeHtml(bits.join(" · ")) + "</p>";
  }

  function renderBanner() {
    var student = state.selectedStudent || {};
    var course = state.course || {};
    $("salBanner").innerHTML =
      '<div class="sal-banner"><div>' +
      '<div style="font-weight:600;color:var(--primary-color)">' +
      escapeHtml(student.DisplayName || "") +
      (student.OrgDefinedId
        ? ' <span style="color:#64748b;font-weight:400">(' + escapeHtml(student.OrgDefinedId) + ")</span>"
        : "") +
      "</div>" +
      '<div style="font-size:0.86rem;color:#64748b;margin-top:2px">' +
      escapeHtml(course.label || "") +
      " · OrgUnit " +
      escapeHtml(course.id || "") +
      (student.UserName ? " · " + escapeHtml(student.UserName) : "") +
      "</div></div></div>";
  }

  function renderChips() {
    var host = $("salChips");
    host.innerHTML = FILTERS.map(function (f) {
      var count =
        f.id === "all"
          ? state.events.length
          : f.id === "academic"
            ? state.events.filter(function (ev) {
                return ev.academic;
              }).length
            : countByType(f.id);
      var active = state.filter === f.id ? " active" : "";
      return (
        '<button type="button" class="type-chip' +
        active +
        '" data-type="' +
        f.id +
        '">' +
        escapeHtml(f.label) +
        " (" +
        count +
        ")</button>"
      );
    }).join("");
    host.querySelectorAll(".type-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.filter = btn.getAttribute("data-type") || "all";
        renderChips();
        renderTable();
      });
    });
  }

  function renderResults() {
    $("salResults").hidden = false;
    renderBanner();
    renderKpis();
    renderWarnings();
    renderScan();
    renderChips();
    renderTable();
  }

  function updateRunButton() {
    $("salRunBtn").disabled = !state.course || !state.selectedStudent || state.busy;
  }

  async function loadStudentsForCourse(ouId) {
    state.selectedStudent = null;
    state.events = [];
    $("salResults").hidden = true;
    var studentSelect = $("salStudent");
    studentSelect.innerHTML = '<option value="">Loading classlist…</option>';
    studentSelect.disabled = true;
    updateRunButton();
    if (!ouId) {
      studentSelect.innerHTML = '<option value="">Load a course first…</option>';
      return;
    }
    try {
      var raw = await API.classlist(ouId);
      var list = normalizeClasslist(raw).filter(isStudentRole);
      list.sort(function (a, b) {
        return ((a.LastName || "") + (a.FirstName || "")).localeCompare((b.LastName || "") + (b.FirstName || ""));
      });
      state.students = list;
      studentSelect.innerHTML = "";
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = list.length ? "Select a student…" : "No students in classlist";
      studentSelect.appendChild(placeholder);
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var uid = s.Identifier || s.UserId;
        var opt = document.createElement("option");
        opt.value = String(uid);
        opt.textContent =
          displayNameFromRecord(s) + (s.OrgDefinedId ? " (" + s.OrgDefinedId + ")" : "");
        studentSelect.appendChild(opt);
      }
      studentSelect.disabled = !list.length;
      setStatus(list.length + " student(s) loaded.");
    } catch (e) {
      studentSelect.innerHTML = '<option value="">Failed to load classlist</option>';
      setStatus(httpMessage(e, "Could not load classlist."));
    }
    updateRunButton();
  }

  function getSelectedFromDropdown() {
    var uid = $("salStudent").value;
    if (!uid) return null;
    for (var i = 0; i < state.students.length; i++) {
      var s = state.students[i];
      if (String(s.Identifier || s.UserId) === String(uid)) return studentFromClasslist(s);
    }
    return null;
  }

  async function onLoadCourse() {
    var ouId = normalizeOuId($("salCourseOu").value);
    var meta = $("salCourseMeta");
    if (!ouId) {
      state.course = null;
      if (meta) meta.textContent = "Enter a numeric OrgUnit ID.";
      setStatus("");
      await loadStudentsForCourse("");
      return;
    }
    if (meta) meta.textContent = "Loading course " + ouId + "…";
    setStatus("");
    try {
      state.course = await resolveCourse(ouId);
      if (meta) meta.textContent = state.course.label + " · OrgUnit " + state.course.id;
      await loadStudentsForCourse(state.course.id);
    } catch (e) {
      state.course = null;
      if (meta) meta.textContent = httpMessage(e, "Could not find that OrgUnit ID.");
      await loadStudentsForCourse("");
    }
  }

  async function onFindOrgDefinedId() {
    var orgId = String($("salOrgDefinedId").value || "").trim();
    if (!orgId) {
      setStatus("Enter an OrgDefinedId to find.");
      return;
    }
    setStatus("Looking up " + orgId + "…");
    try {
      var user = await API.findUserByOrgDefinedId(orgId);
      var student = studentFromUser(user);
      if (!student || !student.UserId) {
        setStatus("No user found for that OrgDefinedId.");
        return;
      }
      state.selectedStudent = student;
      var match = null;
      for (var i = 0; i < state.students.length; i++) {
        if (String(state.students[i].Identifier || state.students[i].UserId) === String(student.UserId)) {
          match = state.students[i];
          break;
        }
      }
      if (match) {
        $("salStudent").value = String(student.UserId);
        setStatus("Selected " + student.DisplayName + " from the classlist.");
      } else {
        $("salStudent").value = "";
        setStatus(
          student.DisplayName +
            " is not on this classlist. You can still collect activity; some tools may return less after unenrollment."
        );
      }
      updateRunButton();
    } catch (e) {
      setStatus(httpMessage(e, "Could not look up that OrgDefinedId."));
    }
  }

  async function collectAll(course, student, onProgress) {
    var events = [];
    var warnings = [];
    state.scan = {};
    var uid = String(student.UserId);
    var ouId = course.id;

    onProgress("Loading course access…", 6);
    await collectCourseAccess(ouId, uid, student.LastAccessed, events);

    onProgress("Reading enrollment history…", 10);
    await collectEnrollments(uid, ouId, course, events, warnings);

    onProgress("Reading system logins…", 14);
    await collectLogins(uid, course, events, warnings, onProgress);

    onProgress("Scanning assignments…", 26);
    await collectAssignments(ouId, uid, events, warnings, onProgress);

    onProgress("Scanning quizzes…", 46);
    await collectQuizzes(ouId, uid, events, warnings, onProgress);

    onProgress("Scanning discussions…", 60);
    await collectDiscussions(ouId, uid, events, warnings, onProgress);

    onProgress("Loading gradebook…", 76);
    await collectGrades(ouId, uid, events, warnings);

    onProgress("Scanning content topics…", 82);
    await collectContent(ouId, uid, events, warnings, onProgress);

    onProgress("Checking awards…", 90);
    await collectAwards(uid, ouId, events, warnings);

    onProgress("Merging Data Hub CSVs…", 92);
    await mergeHubCsvs(course, student, events, warnings, onProgress);

    events = dedupeEvents(events);
    sortEvents(events);
    onProgress("Done", 100);
    return { events: events, warnings: warnings };
  }

  async function onRun() {
    if (!state.course) return;
    var student = state.selectedStudent || getSelectedFromDropdown();
    if (!student) return;
    state.selectedStudent = student;
    state.busy = true;
    state.filter = "all";
    updateRunButton();
    $("salResults").hidden = true;

    if (window.LoadingUtils) {
      LoadingUtils.showLoadingModal("Collecting student activity…", MODAL);
    }

    try {
      var result = await collectAll(state.course, student, function (msg, pct) {
        if (window.LoadingUtils) LoadingUtils.updateLoadingModal(pct, msg, MODAL);
        setStatus(msg);
      });
      state.events = result.events;
      state.warnings = result.warnings;
      renderResults();
      setStatus(state.events.length + " record(s) collected.");
    } catch (e) {
      if (e && e.name === "CancelledError") {
        setStatus("Collection cancelled.");
      } else {
        console.error("[StudentActivityLog]", e);
        setStatus(httpMessage(e, "Could not collect activity."));
      }
    } finally {
      state.busy = false;
      updateRunButton();
      if (window.LoadingUtils) LoadingUtils.hideLoadingModal(MODAL);
    }
  }

  function bind() {
    if (!API) {
      setStatus("Brightspace API helper did not load.");
      return;
    }
    $("salLoadCourseBtn").addEventListener("click", onLoadCourse);
    $("salCourseOu").addEventListener("keydown", function (e) {
      if (e.key === "Enter") onLoadCourse();
    });
    $("salStudent").addEventListener("change", function () {
      state.selectedStudent = getSelectedFromDropdown();
      updateRunButton();
    });
    $("salFindBtn").addEventListener("click", onFindOrgDefinedId);
    $("salOrgDefinedId").addEventListener("keydown", function (e) {
      if (e.key === "Enter") onFindOrgDefinedId();
    });
    $("salRunBtn").addEventListener("click", onRun);
    $("salCsvBtn").addEventListener("click", downloadCsv);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
