/**
 * Dual Enrollment Last Access
 * CSV of OrgDefinedIds × semester → 7xx/8xx course last access + branded student PDFs.
 */
(function () {
  "use strict";

  var API = window.BrightspaceApi;
  var Report = window.LdaaReport;
  var COURSE_OFFERING_TYPE_ID = 3;
  var STUDENT_ROLE_ID = 101;
  var FALL_2026_ID = "3010530";
  var CONCURRENCY = 3;

  var BRAND = {
    green: [0, 87, 73],
    greenLight: [0, 149, 122],
    mint: [154, 216, 206],
    tan: [200, 198, 183],
    black: [25, 51, 48],
    cream: [244, 243, 239],
    white: [255, 255, 255],
    muted: [90, 98, 94],
    line: [214, 220, 216],
    alert: [153, 27, 27],
    alertBg: [254, 242, 242],
    successBg: [232, 245, 240],
    recencyOk: [0, 149, 122],
    recencyWarn: [180, 83, 9],
    recencyLate: [153, 27, 27]
  };

  var state = {
    rows: [],
    students: [],
    cancelled: false,
    table: null,
    courseDateIndex: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg) {
    var el = $("statusLine");
    if (el) el.textContent = msg || "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function orgDefinedIdCandidates(raw) {
    var digits = String(raw || "").replace(/\D/g, "");
    if (!digits) {
      var trimmed = String(raw || "").trim();
      return trimmed ? [trimmed] : [];
    }
    var unpadded = digits.replace(/^0+/, "") || "0";
    var set = new Set([String(raw).trim(), digits, unpadded]);
    [7, 8, 9, 10].forEach(function (len) {
      if (unpadded.length <= len) set.add(unpadded.padStart(len, "0"));
    });
    return Array.from(set).filter(Boolean);
  }

  function daysAgo(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtCourseDate(iso) {
    if (!iso) return "—";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (m) {
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric" }
      );
    }
    return fmtDate(iso);
  }

  function fmtDateLong(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function recencyLabel(iso) {
    var n = daysAgo(iso);
    if (n == null) return "";
    if (n === 0) return "today";
    if (n === 1) return "1 day ago";
    return n + " days ago";
  }

  function recencyColor(iso) {
    var n = daysAgo(iso);
    if (n == null) return BRAND.muted;
    if (n <= 7) return BRAND.recencyOk;
    if (n <= 13) return BRAND.recencyWarn;
    return BRAND.recencyLate;
  }

  function parseTerm(termRaw) {
    var t = String(termRaw || "").toUpperCase().replace(/\s/g, "");
    var m = t.match(/^(\d{2})\/?(FA|WI|SP|SU)$/);
    if (!m) return null;
    return { yy: m[1], season: m[2], display: m[1] + "/" + m[2] };
  }

  function normalizeHeaderKey(s) {
    return String(s || "").replace(/^\uFEFF/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  }

  function getCell(row, candidates) {
    if (!row || typeof row !== "object") return "";
    var keys = Object.keys(row);
    var normMap = {};
    keys.forEach(function (k) {
      var nk = normalizeHeaderKey(k);
      if (nk && !normMap[nk]) normMap[nk] = k;
    });
    function valueOf(orig) {
      if (orig === undefined) return "";
      var v = row[orig];
      if (v === undefined || v === null) return "";
      return String(v).trim();
    }
    for (var i = 0; i < candidates.length; i++) {
      var exact = valueOf(candidates[i]);
      if (exact) return exact;
      var nk = normalizeHeaderKey(candidates[i]);
      var named = valueOf(normMap[nk]);
      if (named) return named;
      if (nk.length >= 6) {
        for (var hn in normMap) {
          if (!Object.prototype.hasOwnProperty.call(normMap, hn)) continue;
          if (hn !== nk && hn.length >= nk.length && hn.slice(-nk.length) === nk) {
            var suffixed = valueOf(normMap[hn]);
            if (suffixed) return suffixed;
          }
        }
      }
    }
    return "";
  }

  function stripTimeParts(s) {
    if (!s) return "";
    return String(s)
      .replace(/\s+12:00:00\s*AM$/i, "")
      .replace(/\s+00:00:00$/, "")
      .replace(/\s+0:00$/, "")
      .trim();
  }

  function parseCourseDate(raw) {
    var s = stripTimeParts(raw);
    if (!s) return null;
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (m) {
      var yy = parseInt(m[3], 10);
      if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
      return new Date(yy, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }
    var dt = new Date(s);
    if (isNaN(dt.getTime())) return null;
    return dt;
  }

  function dateToIso(d) {
    if (!d || isNaN(d.getTime())) return null;
    var y = d.getFullYear();
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var da = ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + da;
  }

  function toShellCourseCode(code) {
    var full = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
    var m = /^(.+)-(\d{2})\/(WI|SP|FA|SU|SM|SS)$/.exec(full);
    return m ? m[1] : full;
  }

  function stripCourseSuffix(code) {
    return String(code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/-COURSE$/i, "");
  }

  function getCombinedCourseCode(row) {
    var named = getCell(row, [
      "Combined Depts, Course Number, Section, Term",
      "COURSE_CODE",
      "Course Code",
      "CourseCode",
      "course_code",
      "SEC_NAME",
      "Sec_Name",
      "Section Name"
    ]);
    if (named) return named;
    var keys = Object.keys(row || {});
    for (var i = 0; i < keys.length; i++) {
      if (/combined/i.test(keys[i])) {
        var v = String(row[keys[i]] || "").trim();
        if (v) return v;
      }
    }
    var dept = getCell(row, ["SEC_DEPTS", "Sec_Depts", "DEPT", "Department", "Depts"]);
    var num = getCell(row, ["SEC_COURSE_NO", "Sec_Course_No", "COURSE_NO", "CourseNo", "Course Number"]);
    var sec = getCell(row, ["SEC_NO", "Sec_No", "SECTION", "Section"]);
    if (dept && num && sec) return dept + "-" + num + "-" + sec;
    return "";
  }

  function addDateIndexKey(index, key, entry) {
    var k = String(key || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!k) return;
    var existing = index[k];
    if (!existing) {
      index[k] = {
        start: entry.start,
        end: entry.end,
        startMs: entry.startMs,
        endMs: entry.endMs
      };
      return;
    }
    if (entry.startMs != null && (existing.startMs == null || entry.startMs < existing.startMs)) {
      existing.start = entry.start;
      existing.startMs = entry.startMs;
    }
    if (entry.endMs != null && (existing.endMs == null || entry.endMs > existing.endMs)) {
      existing.end = entry.end;
      existing.endMs = entry.endMs;
    }
  }

  function buildCourseDateIndex(rows) {
    var index = {};
    (rows || []).forEach(function (row) {
      var combined = getCombinedCourseCode(row);
      if (!combined) return;
      var startRaw = getCell(row, ["SEC_START_DATE", "Sec_Start_Date", "Start Date", "Start", "StartDate"]);
      var endRaw = getCell(row, ["SEC_END_DATE", "Sec_End_Date", "End Date", "End", "EndDate"]);
      var startDt = parseCourseDate(startRaw);
      var endDt = parseCourseDate(endRaw);
      var entry = {
        start: dateToIso(startDt),
        end: dateToIso(endDt),
        startMs: startDt ? startDt.getTime() : null,
        endMs: endDt ? endDt.getTime() : null
      };
      var cleaned = stripCourseSuffix(combined);
      var shell = toShellCourseCode(cleaned);
      addDateIndexKey(index, combined, entry);
      addDateIndexKey(index, cleaned, entry);
      addDateIndexKey(index, shell, entry);
      var term = parseTerm(getCell(row, ["Term", "TERM", "Semester"]));
      if (!term) {
        var tm = String(combined).toUpperCase().match(/(\d{2})\/(FA|WI|SP|SU)/);
        if (tm) term = { yy: tm[1], season: tm[2], display: tm[1] + "/" + tm[2] };
      }
      var secMatch = String(shell).match(/(FA|WI|SP|SU)(\d{3})$/i);
      if (secMatch && term) {
        addDateIndexKey(index, secMatch[0].toUpperCase() + "|" + term.display, entry);
        addDateIndexKey(index, secMatch[0].toUpperCase() + "-" + term.display, entry);
      }
    });
    return index;
  }

  function lookupCourseDates(courseCode, courseName, sectionLabel, term, index) {
    if (!index) return { start: null, end: null };
    var keys = [];
    var cleaned = stripCourseSuffix(courseCode);
    keys.push(cleaned);
    keys.push(toShellCourseCode(cleaned));
    String(sectionLabel || "")
      .split(/\s*\/\s*/)
      .forEach(function (sec) {
        var token = String(sec || "").trim().toUpperCase();
        if (!token) return;
        if (term) {
          keys.push(token + "|" + term.display);
          keys.push(token + "-" + term.display);
        }
        keys.push(token);
      });
    var nameCodes = String(courseName || "").toUpperCase().match(/[A-Z]{2,5}-[A-Z0-9]+-(?:FA|WI|SP|SU)\d{3}(?:-\d{2}\/(?:FA|WI|SP|SU))?/g);
    if (nameCodes) {
      nameCodes.forEach(function (code) {
        keys.push(code);
        keys.push(toShellCourseCode(code));
      });
    }
    var startMs = null;
    var endMs = null;
    var start = null;
    var end = null;
    keys.forEach(function (key) {
      var hit = index[String(key || "").trim().toUpperCase().replace(/\s+/g, "")];
      if (!hit) return;
      if (hit.startMs != null && (startMs == null || hit.startMs < startMs)) {
        startMs = hit.startMs;
        start = hit.start;
      }
      if (hit.endMs != null && (endMs == null || hit.endMs > endMs)) {
        endMs = hit.endMs;
        end = hit.end;
      }
    });
    return { start: start, end: end };
  }

  function isMergedOffering(name) {
    return /^\s*MERGED\b/i.test(String(name || ""));
  }

  function textHasTerm(text, term) {
    if (!term) return false;
    var up = String(text || "").toUpperCase();
    return up.indexOf(term.display) !== -1 || up.indexOf(term.yy + term.season) !== -1;
  }

  function dualSectionsFromText(text, season, include7, include8) {
    var up = String(text || "").toUpperCase();
    var re = new RegExp("(?:^|[^A-Z0-9])" + season + "([78]\\d{2})(?![0-9])", "g");
    var found = [];
    var seen = {};
    var m;
    while ((m = re.exec(up))) {
      var num = m[1];
      var band = num.charAt(0);
      if (band === "7" && !include7) continue;
      if (band === "8" && !include8) continue;
      var token = season + num;
      if (seen[token]) continue;
      seen[token] = true;
      found.push(token);
    }
    return found;
  }

  function sectionsForOffering(name, code, term, include7, include8) {
    if (isMergedOffering(name)) return [];
    var fromName = textHasTerm(name, term)
      ? dualSectionsFromText(name, term.season, include7, include8)
      : [];
    if (fromName.length) return fromName;
    if (!textHasTerm(code, term)) return [];
    return dualSectionsFromText(code, term.season, include7, include8);
  }

  function isStudentEnrollment(enr) {
    if (!enr) return false;
    var roleId = enr.Role && enr.Role.Id != null ? parseInt(enr.Role.Id, 10) : NaN;
    if (roleId === STUDENT_ROLE_ID) return true;
    var name = (enr.Role && (enr.Role.Name || "")) || "";
    if (/instructor|designer|admin|grader|faculty|teacher|ta\b/i.test(name)) return false;
    if (/student|learner/i.test(name)) return true;
    return roleId === STUDENT_ROLE_ID;
  }

  function displayName(user) {
    if (!user) return "Unknown student";
    var last = user.LastName || "";
    var first = user.FirstName || "";
    if (last && first) return last + ", " + first;
    return (user.DisplayName || [first, last].filter(Boolean).join(" ") || "Unknown student").trim();
  }

  function sortName(user) {
    return ((user && user.LastName) || "") + "\t" + ((user && user.FirstName) || "");
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
            if (state.cancelled) throw new Error("Cancelled");
            var idx = i++;
            results[idx] = await mapper(items[idx], idx);
          }
        })()
      );
    }
    if (!workers.length && items.length) {
      results[0] = await mapper(items[0], 0);
    } else {
      await Promise.all(workers);
    }
    return results;
  }

  function csvField(row, names) {
    var keys = Object.keys(row || {});
    for (var n = 0; n < names.length; n++) {
      var want = names[n].toLowerCase().replace(/[\s_]/g, "");
      for (var k = 0; k < keys.length; k++) {
        var got = keys[k].toLowerCase().replace(/[\s_]/g, "").replace(/^\ufeff/, "");
        if (got === want) {
          var v = String(row[keys[k]] == null ? "" : row[keys[k]]).trim();
          if (v) return v;
        }
      }
    }
    return "";
  }

  function parseOrgDefinedIds(fileText) {
    var text = String(fileText || "").replace(/^\uFEFF/, "");
    var parsed = window.Papa
      ? window.Papa.parse(text, { header: true, skipEmptyLines: "greedy" })
      : { data: [] };
    var ids = [];
    var rows = parsed.data || [];
    rows.forEach(function (row) {
      var id = csvField(row, [
        "OrgDefinedId",
        "OrgDefinedID",
        "person_id",
        "Person_ID",
        "Student ID",
        "StudentID",
        "Delta ID",
        "ID"
      ]);
      if (!id) {
        var vals = Object.keys(row || {}).map(function (k) {
          return String(row[k] == null ? "" : row[k]).trim();
        }).filter(Boolean);
        id = vals[0] || "";
      }
      if (id && !/^(orgdefinedid|person_id|studentid|id)$/i.test(id)) ids.push(id);
    });
    if (!ids.length) {
      text.split(/\r?\n/).forEach(function (line, idx) {
        var token = line.split(/[,;\t]/)[0].trim().replace(/^"|"$/g, "");
        if (!token) return;
        if (idx === 0 && /orgdefinedid|person_id|student/i.test(token)) return;
        ids.push(token);
      });
    }
    var seen = new Set();
    var unique = [];
    ids.forEach(function (id) {
      var key = String(id).trim();
      if (!key || seen.has(key.toLowerCase())) return;
      seen.add(key.toLowerCase());
      unique.push(key);
    });
    return unique;
  }

  async function fetchUserByOrgDefinedId(orgDefinedId) {
    var candidates = orgDefinedIdCandidates(orgDefinedId);
    for (var i = 0; i < candidates.length; i++) {
      try {
        var user = await API.findUserByOrgDefinedId(candidates[i]);
        if (user && (user.UserId || user.Identifier)) return user;
      } catch (e) {
        /* try next */
      }
    }
    return null;
  }

  async function fetchUserById(userId) {
    try {
      return await API.raw("/d2l/api/lp/" + API.LP + "/users/" + encodeURIComponent(userId));
    } catch (e) {
      return null;
    }
  }

  async function fetchAllEnrollmentsForUser(userId) {
    var items = [];
    var bookmark = "";
    var guard = 0;
    do {
      var url =
        "/d2l/api/lp/" +
        API.LP +
        "/enrollments/users/" +
        encodeURIComponent(userId) +
        "/orgUnits/?pageSize=200";
      if (bookmark) url += "&bookmark=" + encodeURIComponent(bookmark);
      var page = await API.raw(url);
      var pageItems = Array.isArray(page) ? page : (page && page.Items) || [];
      items.push.apply(items, pageItems);
      var more = !!(page && page.PagingInfo && page.PagingInfo.HasMoreItems);
      bookmark = (page && page.PagingInfo && page.PagingInfo.Bookmark) || "";
      if (!more || !bookmark) break;
    } while (++guard < 50);
    return items;
  }

  async function courseLastAccess(orgUnitId, userId) {
    try {
      var access = await API.lastAccess(orgUnitId, userId);
      var iso =
        access &&
        (access.LastAccessed || access.LastAccess || access.DateLastAccessed || access.LastAccessedDate);
      if (iso) return iso;
    } catch (e) {
      /* fall through */
    }
    try {
      var cl = await API.classlist(orgUnitId);
      var members = Report ? Report.normalizeClasslist(cl) : Array.isArray(cl) ? cl : [];
      for (var i = 0; i < members.length; i++) {
        var m = members[i];
        if (String(m.Identifier || m.UserId) === String(userId) && m.LastAccessed) {
          return m.LastAccessed;
        }
      }
    } catch (e2) {
      /* ignore */
    }
    return null;
  }

  function orgLastAccess(user) {
    if (!user) return null;
    return user.LastAccessedDate || user.LastAccessed || null;
  }

  function flagsFor(row, inactiveDays) {
    var flags = [];
    if (row.notInD2L) {
      flags.push("missing");
      return flags;
    }
    if (row.noDualCourses) {
      flags.push("none");
      return flags;
    }
    if (!row.courseLastAccess) flags.push("never-course");
    if (!row.d2lLastLogin) flags.push("never-d2l");
    if (row.courseLastAccess && row.daysSinceCourse != null && row.daysSinceCourse >= inactiveDays) {
      flags.push("stale");
    }
    if (!flags.length) flags.push("ok");
    return flags;
  }

  function isFlagged(flags) {
    return flags.some(function (f) {
      return f !== "ok";
    });
  }

  function flagHtml(flags) {
    var labels = {
      ok: "OK",
      "never-course": "Never accessed course",
      "never-d2l": "Never logged into D2L",
      stale: "Inactive (course)",
      none: "No 7xx/8xx courses",
      missing: "Not in D2L"
    };
    return flags
      .map(function (f) {
        return '<span class="flag flag-' + f + '">' + escapeHtml(labels[f] || f) + "</span>";
      })
      .join(" ");
  }

  async function scanStudent(orgDefinedId, options) {
    var user = await fetchUserByOrgDefinedId(orgDefinedId);
    if (!user) {
      return [
        {
          orgDefinedId: orgDefinedId,
          userId: "",
          firstName: "",
          lastName: "",
          displayName: "",
          userName: "",
          email: "",
          courseCode: "",
          courseName: "",
          orgUnitId: "",
          section: "",
          courseStart: null,
          courseEnd: null,
          courseLastAccess: null,
          daysSinceCourse: null,
          d2lLastLogin: null,
          daysSinceD2L: null,
          notInD2L: true,
          noDualCourses: false,
          user: null
        }
      ];
    }

    var userId = user.UserId || user.Identifier;
    var full = (await fetchUserById(userId)) || user;
    var d2lLogin = orgLastAccess(full);
    var enrollments = await fetchAllEnrollmentsForUser(userId);
    var matches = [];

    enrollments.forEach(function (enr) {
      var ou = enr && enr.OrgUnit;
      if (!ou) return;
      var typeId = ou.Type && (ou.Type.Id || ou.Type.Identifier);
      var typeCode = (ou.Type && ou.Type.Code) || "";
      if (Number(typeId) !== COURSE_OFFERING_TYPE_ID && typeCode !== "Course Offering") return;
      if (!isStudentEnrollment(enr)) return;
      var code = ou.Code || "";
      var name = ou.Name || "";
      if (isMergedOffering(name)) return;
      var sections = sectionsForOffering(name, code, options.term, options.include7, options.include8);
      if (!sections.length) return;
      matches.push({
        orgUnitId: String(ou.Id || ou.Identifier || ""),
        courseCode: code,
        courseName: name,
        section: sections.join(" / ")
      });
    });

    var base = {
      orgDefinedId: full.OrgDefinedId || orgDefinedId,
      userId: String(userId),
      firstName: full.FirstName || "",
      lastName: full.LastName || "",
      displayName: displayName(full),
      userName: full.UserName || "",
      email: full.ExternalEmail || full.Email || "",
      d2lLastLogin: d2lLogin,
      daysSinceD2L: daysAgo(d2lLogin),
      notInD2L: false,
      user: full
    };

    if (!matches.length) {
      return [
        Object.assign({}, base, {
          courseCode: "",
          courseName: "",
          orgUnitId: "",
          section: "",
          courseStart: null,
          courseEnd: null,
          courseLastAccess: null,
          daysSinceCourse: null,
          noDualCourses: true
        })
      ];
    }

    var rows = [];
    for (var i = 0; i < matches.length; i++) {
      var c = matches[i];
      var last = c.orgUnitId ? await courseLastAccess(c.orgUnitId, userId) : null;
      var dates = lookupCourseDates(
        c.courseCode,
        c.courseName,
        c.section,
        options.term,
        state.courseDateIndex
      );
      rows.push(
        Object.assign({}, base, {
          courseCode: c.courseCode,
          courseName: c.courseName,
          orgUnitId: c.orgUnitId,
          section: c.section,
          courseStart: dates.start,
          courseEnd: dates.end,
          courseLastAccess: last,
          daysSinceCourse: daysAgo(last),
          noDualCourses: false
        })
      );
    }
    return rows;
  }

  function uniqueStudents(rows) {
    var map = new Map();
    rows.forEach(function (r) {
      if (r.notInD2L) return;
      var key = r.userId || r.orgDefinedId;
      if (!map.has(key)) {
        map.set(key, {
          key: key,
          orgDefinedId: r.orgDefinedId,
          userId: r.userId,
          displayName: r.displayName,
          firstName: r.firstName,
          lastName: r.lastName,
          userName: r.userName,
          email: r.email,
          d2lLastLogin: r.d2lLastLogin,
          user: r.user,
          courses: []
        });
      }
      var stu = map.get(key);
      if (r.orgUnitId) {
        stu.courses.push(r);
      }
    });
    return Array.from(map.values()).sort(function (a, b) {
      return sortName(a).localeCompare(sortName(b), undefined, { sensitivity: "base" });
    });
  }

  function applyColor(doc, method, rgb) {
    doc[method].apply(doc, rgb);
  }

  function fillTriangle(doc, x1, y1, x2, y2, x3, y3) {
    if (typeof doc.triangle === "function") {
      doc.triangle(x1, y1, x2, y2, x3, y3, "F");
      return;
    }
    doc.lines(
      [
        [x2 - x1, y2 - y1],
        [x3 - x2, y3 - y2],
        [x1 - x3, y1 - y3]
      ],
      x1,
      y1,
      [1, 1],
      "F",
      true
    );
  }

  async function renderStudentPdf(student, options) {
    var jsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDF) throw new Error("jsPDF library not loaded");
    var Brand = window.FacultyDashboardPdfBrand;
    var duckLogo = Brand ? await Brand.loadDuckLogo() : null;
    var doc = new jsPDF({ unit: "pt", format: "letter" });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 40;
    var contentW = pageW - margin * 2;
    var y = 0;
    var pageNum = 1;
    var generatedAt = new Date();
    var studentName = student.displayName || "Unknown student";
    var studentId = student.orgDefinedId || "—";
    var termLabel = (options && options.termDisplay) || "";

    doc.setProperties({
      title: "Dual Enrollment Last Access — " + studentName,
      subject: "Dual enrollment course access and academic activity",
      author: "Your College Admin Dashboard",
      creator: "Your College eLearning Office",
      keywords: "Dual Enrollment, FERPA, Your College"
    });

    function drawPageBase() {
      applyColor(doc, "setFillColor", BRAND.cream);
      doc.rect(0, 0, pageW, pageH, "F");
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, 7, pageH, "F");
    }

    function drawDeltaMark(cx, cy, radius) {
      applyColor(doc, "setFillColor", BRAND.white);
      doc.circle(cx, cy, radius, "F");
      applyColor(doc, "setFillColor", BRAND.green);
      fillTriangle(
        doc,
        cx,
        cy - radius * 0.62,
        cx + radius * 0.62,
        cy + radius * 0.48,
        cx - radius * 0.62,
        cy + radius * 0.48
      );
    }

    function placeDuck(x, yy, height) {
      if (!Brand || !duckLogo) return 0;
      return Brand.drawDuck(doc, duckLogo, x, yy, height);
    }

    function drawCoverHeader() {
      drawPageBase();
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, pageW, 88, "F");
      applyColor(doc, "setFillColor", BRAND.greenLight);
      doc.rect(0, 88, pageW, 5, "F");
      applyColor(doc, "setFillColor", BRAND.mint);
      doc.rect(0, 93, pageW, 2, "F");
      var duckH = 52;
      var duckW = placeDuck(margin, 18, duckH);
      var textX = duckW ? margin + duckW + 10 : margin + 46;
      if (!duckW) drawDeltaMark(margin + 18, 44, 18);
      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("DELTA COLLEGE", textX, 38);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      applyColor(doc, "setTextColor", BRAND.mint);
      doc.text("eLearning Office  ·  Dual Enrollment", textX, 54);
      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("CONFIDENTIAL", pageW - margin, 32, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      applyColor(doc, "setTextColor", BRAND.mint);
      doc.text("FERPA-protected education record", pageW - margin, 46, { align: "right" });
      doc.text("University Center, Michigan", pageW - margin, 58, { align: "right" });
    }

    function drawContinuedHeader() {
      drawPageBase();
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(0, 0, pageW, 32, "F");
      applyColor(doc, "setFillColor", BRAND.greenLight);
      doc.rect(0, 32, pageW, 3, "F");
      var duckW = placeDuck(margin, 5, 22);
      var textX = duckW ? margin + duckW + 8 : margin;
      applyColor(doc, "setTextColor", BRAND.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("DELTA COLLEGE  ·  Dual Enrollment Last Access", textX, 20);
      applyColor(doc, "setTextColor", BRAND.mint);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      var cont = studentName + (termLabel ? "  ·  " + termLabel : "");
      if (doc.getTextWidth(cont) > 240) cont = doc.splitTextToSize(cont, 240)[0];
      doc.text(cont, pageW - margin, 20, { align: "right" });
    }

    function drawFooter() {
      var fy = pageH - 28;
      applyColor(doc, "setDrawColor", BRAND.greenLight);
      doc.setLineWidth(1.1);
      doc.line(margin, fy, pageW - margin, fy);
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text("Your College  ·  eLearning Office  ·  Dual Enrollment Last Access", margin, fy + 12);
      doc.text("Page " + pageNum, pageW - margin, fy + 12, { align: "right" });
    }

    function ensureSpace(needed) {
      if (y + needed <= pageH - 46) return;
      drawFooter();
      doc.addPage();
      pageNum += 1;
      drawContinuedHeader();
      y = 50;
    }

    function sectionTitle(text) {
      ensureSpace(28);
      applyColor(doc, "setFillColor", BRAND.green);
      doc.rect(margin, y, 4, 14, "F");
      applyColor(doc, "setTextColor", BRAND.green);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(text, margin + 12, y + 11);
      y += 22;
    }

    drawCoverHeader();
    y = 114;
    applyColor(doc, "setTextColor", BRAND.green);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Dual Enrollment Last Access", margin, y);
    y += 16;
    applyColor(doc, "setTextColor", BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("7xx / 8xx course access, D2L login, and submitted work", margin, y);
    var genStamp =
      generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      "  ·  " +
      generatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    doc.text(genStamp, pageW - margin, y, { align: "right" });
    y += 18;

    var idH = 72;
    ensureSpace(idH + 8);
    applyColor(doc, "setFillColor", BRAND.white);
    doc.roundedRect(margin, y, contentW, idH, 6, 6, "F");
    applyColor(doc, "setFillColor", BRAND.greenLight);
    doc.rect(margin, y, 6, idH, "F");
    var col1 = margin + 18;
    var col2 = margin + contentW / 2 + 8;
    applyColor(doc, "setTextColor", BRAND.greenLight);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("STUDENT", col1, y + 16);
    doc.text("TERM", col2, y + 16);
    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(doc.splitTextToSize(studentName, contentW / 2 - 28)[0], col1, y + 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    applyColor(doc, "setTextColor", BRAND.muted);
    doc.text("ID  " + studentId, col1, y + 50);
    if (student.email) doc.text(String(student.email), col1, y + 62);
    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(termLabel || "Selected semester", col2, y + 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    applyColor(doc, "setTextColor", BRAND.muted);
    doc.text((student.courses || []).length + " dual-enrollment course(s)", col2, y + 50);
    y += idH + 16;

    var hasD2l = !!student.d2lLastLogin;
    var boxH = 62;
    ensureSpace(boxH + 8);
    applyColor(doc, "setFillColor", hasD2l ? BRAND.successBg : BRAND.alertBg);
    doc.roundedRect(margin, y, contentW, boxH, 6, 6, "F");
    applyColor(doc, "setFillColor", hasD2l ? BRAND.green : BRAND.alert);
    doc.rect(margin, y, 7, boxH, "F");
    applyColor(doc, "setTextColor", hasD2l ? BRAND.green : BRAND.alert);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("D2L LAST LOGIN (ORG-LEVEL)", margin + 20, y + 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(hasD2l ? 15 : 13);
    doc.text(hasD2l ? fmtDateLong(student.d2lLastLogin) : "No D2L login on record", margin + 20, y + 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    applyColor(doc, "setTextColor", BRAND.muted);
    doc.text(
      hasD2l ? recencyLabel(student.d2lLastLogin) + "  ·  Same LastAccessedDate as Search User" : "Student account exists but has never accessed Brightspace",
      margin + 20,
      y + 54
    );
    y += boxH + 16;

    sectionTitle("Dual-enrollment courses");
    var courses = student.courses || [];
    var rowH = 34;
    ensureSpace(20 + Math.max(courses.length, 1) * rowH);
    applyColor(doc, "setFillColor", BRAND.green);
    doc.rect(margin, y, contentW, 20, "F");
    applyColor(doc, "setTextColor", BRAND.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("COURSE NAME", margin + 10, y + 13);
    doc.text("LAST COURSE ACCESS", pageW - margin - 10, y + 13, { align: "right" });
    y += 20;
    if (!courses.length) {
      applyColor(doc, "setFillColor", BRAND.white);
      doc.rect(margin, y, contentW, 22, "F");
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text("No 7xx / 8xx enrollments found for this term.", margin + 10, y + 14);
      y += 34;
    }
    for (var r = 0; r < courses.length; r++) {
      ensureSpace(rowH);
      var cr = courses[r];
      applyColor(doc, "setFillColor", r % 2 === 0 ? BRAND.white : [236, 242, 239]);
      doc.rect(margin, y, contentW, rowH, "F");
      applyColor(doc, "setTextColor", BRAND.black);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      var nameClip = doc.splitTextToSize(cr.courseName || cr.courseCode || "Course", contentW - 160);
      doc.text(nameClip[0], margin + 10, y + 13);
      var iso = cr.courseLastAccess;
      applyColor(doc, "setTextColor", iso ? recencyColor(iso) : BRAND.alert);
      doc.setFont("helvetica", iso ? "bold" : "italic");
      var dateStr = iso ? fmtDate(iso) + "  (" + recencyLabel(iso) + ")" : "Never accessed";
      doc.text(dateStr, pageW - margin - 10, y + 13, { align: "right" });
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      var range =
        cr.courseStart || cr.courseEnd
          ? fmtCourseDate(cr.courseStart) + "  –  " + fmtCourseDate(cr.courseEnd)
          : "Course dates not in uploaded file";
      var sub = cr.section ? range + "  ·  " + cr.section : range;
      doc.text(sub, margin + 10, y + 26);
      y += rowH;
    }
    y += 14;

    var details = student.details || [];
    for (var d = 0; d < details.length; d++) {
      var pack = details[d];
      var detail = pack.detail || {};
      var lda = Report && Report.overallLda ? Report.overallLda(detail) : null;
      sectionTitle((pack.courseName || pack.courseCode || "Course") + "  ·  academic activity");
      var ldaH = 56;
      ensureSpace(ldaH + 8);
      applyColor(doc, "setFillColor", lda ? BRAND.successBg : BRAND.alertBg);
      doc.roundedRect(margin, y, contentW, ldaH, 5, 5, "F");
      applyColor(doc, "setFillColor", lda ? BRAND.green : BRAND.alert);
      doc.rect(margin, y, 5, ldaH, "F");
      applyColor(doc, "setTextColor", lda ? BRAND.green : BRAND.alert);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("LAST DATE OF ACADEMIC ACTIVITY", margin + 16, y + 16);
      doc.setFontSize(13);
      doc.text(lda ? fmtDateLong(lda) : "No academic activity on record", margin + 16, y + 34);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      applyColor(doc, "setTextColor", BRAND.muted);
      doc.text(
        lda
          ? recencyLabel(lda) + "  ·  Discussions, assignments, quizzes (login is not counted)"
          : "No discussion, assignment, or quiz activity was found in this course.",
        margin + 16,
        y + 48
      );
      y += ldaH + 12;

      var tableRows = [
        ["Last discussion post", detail.lastDiscussion],
        ["Last assignment submitted", detail.lastAssignment],
        ["Last quiz submitted", detail.lastQuiz],
        ["Last course access (login)", detail.lastLogin]
      ];
      ensureSpace(18 + tableRows.length * 18);
      for (var tr = 0; tr < tableRows.length; tr++) {
        ensureSpace(18);
        applyColor(doc, "setFillColor", tr % 2 === 0 ? BRAND.white : [236, 242, 239]);
        doc.rect(margin, y, contentW, 16, "F");
        applyColor(doc, "setTextColor", BRAND.black);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.text(tableRows[tr][0], margin + 10, y + 11);
        var tIso = tableRows[tr][1];
        applyColor(doc, "setTextColor", tIso ? recencyColor(tIso) : BRAND.muted);
        doc.setFont("helvetica", tIso ? "bold" : "italic");
        doc.text(tIso ? fmtDate(tIso) : "None on record", pageW - margin - 10, y + 11, { align: "right" });
        y += 16;
      }
      y += 8;

      function drawItemTable(title, items, nameFn) {
        if (!items || !items.length) return;
        ensureSpace(36);
        applyColor(doc, "setTextColor", BRAND.green);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(title, margin, y + 10);
        y += 16;
        var sorted = items.slice().sort(function (a, b) {
          return new Date(b.date || 0) - new Date(a.date || 0);
        });
        var shown = sorted.slice(0, 8);
        for (var i = 0; i < shown.length; i++) {
          ensureSpace(16);
          applyColor(doc, "setFillColor", i % 2 === 0 ? BRAND.white : [236, 242, 239]);
          doc.rect(margin, y, contentW, 14, "F");
          applyColor(doc, "setTextColor", BRAND.black);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          var label = nameFn(shown[i]);
          doc.text(doc.splitTextToSize(label, contentW - 110)[0], margin + 8, y + 10);
          applyColor(doc, "setTextColor", recencyColor(shown[i].date));
          doc.setFont("helvetica", "bold");
          doc.text(fmtDate(shown[i].date), pageW - margin - 8, y + 10, { align: "right" });
          y += 14;
        }
        if (sorted.length > shown.length) {
          ensureSpace(14);
          applyColor(doc, "setTextColor", BRAND.muted);
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.text("And " + (sorted.length - shown.length) + " more in Brightspace.", margin + 8, y + 10);
          y += 14;
        }
        y += 8;
      }

      drawItemTable("Assignments submitted", detail.assignments, function (item) {
        return item.name || "Assignment";
      });
      drawItemTable("Quiz attempts", detail.quizzes, function (item) {
        return item.score ? (item.name || "Quiz") + "  ·  score " + item.score : item.name || "Quiz";
      });
      drawItemTable("Discussion posts", detail.discussions, function (item) {
        return [item.forum, item.topic].filter(Boolean).join(" — ") || "Discussion post";
      });
    }

    ensureSpace(58);
    applyColor(doc, "setFillColor", BRAND.white);
    doc.roundedRect(margin, y, contentW, 52, 5, 5, "F");
    applyColor(doc, "setFillColor", BRAND.tan);
    doc.rect(margin, y, 5, 52, "F");
    applyColor(doc, "setTextColor", BRAND.green);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("FERPA NOTICE", margin + 14, y + 14);
    applyColor(doc, "setTextColor", BRAND.black);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    var ferpa =
      "This report contains education records protected under the Family Educational Rights and Privacy Act. " +
      "Use only for legitimate Dual Enrollment follow-up at Your College. Do not share outside authorized " +
      "college personnel without consent or as otherwise permitted by law.";
    doc.text(doc.splitTextToSize(ferpa, contentW - 28), margin + 14, y + 26);

    drawFooter();
    var filename =
      "DualEnrollment_LastAccess_" +
      (student.lastName || "student") +
      "_" +
      (student.firstName || "") +
      "_" +
      (student.orgDefinedId || "id") +
      ".pdf";
    doc.save(filename.replace(/[^\w.-]+/g, "_"));
  }

  function toCsvValue(value) {
    var text = value == null ? "" : String(value);
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function downloadResultsCsv(rows, inactiveDays) {
    var headers = [
      "OrgDefinedId",
      "LastName",
      "FirstName",
      "Username",
      "UserId",
      "CourseCode",
      "CourseName",
      "OrgUnitId",
      "Section",
      "CourseStartDate",
      "CourseEndDate",
      "CourseLastAccess",
      "DaysSinceCourseAccess",
      "D2LLastLogin",
      "DaysSinceD2LLogin",
      "NeverAccessedCourse",
      "NeverLoggedIntoD2L",
      "InactiveCourseDays",
      "NoDualEnrollmentCourses",
      "NotInD2L"
    ];
    var lines = [headers.join(",")];
    rows.forEach(function (r) {
      var flags = flagsFor(r, inactiveDays);
      lines.push(
        [
          r.orgDefinedId,
          r.lastName,
          r.firstName,
          r.userName,
          r.userId,
          r.courseCode,
          r.courseName,
          r.orgUnitId,
          r.section,
          r.courseStart || "",
          r.courseEnd || "",
          r.courseLastAccess || "",
          r.daysSinceCourse == null ? "" : r.daysSinceCourse,
          r.d2lLastLogin || "",
          r.daysSinceD2L == null ? "" : r.daysSinceD2L,
          flags.indexOf("never-course") >= 0 ? "Y" : "N",
          flags.indexOf("never-d2l") >= 0 ? "Y" : "N",
          flags.indexOf("stale") >= 0 ? "Y" : "N",
          r.noDualCourses ? "Y" : "N",
          r.notInD2L ? "Y" : "N"
        ]
          .map(toCsvValue)
          .join(",")
      );
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "dual-enrollment-last-access.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderTable(rows, inactiveDays, flaggedOnly) {
    var shown = flaggedOnly
      ? rows.filter(function (r) {
          return isFlagged(flagsFor(r, inactiveDays));
        })
      : rows;

    if (state.table) {
      state.table.destroy();
      state.table = null;
    }

    var html = shown
      .map(function (r) {
        var flags = flagsFor(r, inactiveDays);
        var pdfBtn = r.notInD2L
          ? "—"
          : '<button type="button" class="btn-secondary de-pdf-row" data-key="' +
            escapeHtml(r.userId || r.orgDefinedId) +
            '" style="padding:6px 10px;font-size:12px;"><i class="fa-solid fa-file-pdf"></i></button>';
        return (
          "<tr>" +
          "<td>" +
          escapeHtml(r.orgDefinedId) +
          "</td>" +
          "<td>" +
          escapeHtml(r.displayName || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(r.courseName || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(r.section || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(fmtCourseDate(r.courseStart)) +
          "</td>" +
          "<td>" +
          escapeHtml(fmtCourseDate(r.courseEnd)) +
          "</td>" +
          "<td>" +
          escapeHtml(r.courseCode || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(fmtDate(r.courseLastAccess)) +
          "</td>" +
          "<td>" +
          (r.daysSinceCourse == null ? "—" : String(r.daysSinceCourse)) +
          "</td>" +
          "<td>" +
          escapeHtml(fmtDate(r.d2lLastLogin)) +
          "</td>" +
          "<td>" +
          (r.daysSinceD2L == null ? "—" : String(r.daysSinceD2L)) +
          "</td>" +
          "<td>" +
          flagHtml(flags) +
          "</td>" +
          "<td>" +
          pdfBtn +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    document.querySelector("#resultsTable tbody").innerHTML = html;
    state.table = window.jQuery("#resultsTable").DataTable({
      pageLength: 25,
      order: [[1, "asc"]],
      columnDefs: [{ targets: [11, 12], orderable: false }]
    });
    $("resultsCard").hidden = false;
  }

  function fillStudentPicker(students) {
    var list = $("studentNameList");
    var input = $("studentFilter");
    if (!list || !input) return;
    list.innerHTML = students
      .map(function (s) {
        return (
          '<option value="' +
          escapeHtml(s.displayName) +
          " (" +
          escapeHtml(s.orgDefinedId) +
          ')"></option>'
        );
      })
      .join("");
    input.value = "";
    $("pdfCard").hidden = students.length === 0;
  }

  function findStudentFromInput() {
    var q = (($("studentFilter") && $("studentFilter").value) || "").trim().toLowerCase();
    if (!q) return null;
    var students = state.students;
    for (var i = 0; i < students.length; i++) {
      var s = students[i];
      var label = (s.displayName + " (" + s.orgDefinedId + ")").toLowerCase();
      if (label === q || s.displayName.toLowerCase() === q || String(s.orgDefinedId).toLowerCase() === q) {
        return s;
      }
    }
    var hits = students.filter(function (s) {
      return (
        s.displayName.toLowerCase().indexOf(q) !== -1 ||
        String(s.orgDefinedId).toLowerCase().indexOf(q) !== -1
      );
    });
    return hits.length === 1 ? hits[0] : hits[0] || null;
  }

  async function generatePdfForStudent(student) {
    var status = $("pdfStatus");
    if (!student) {
      if (status) status.textContent = "Choose a student by name first.";
      return;
    }
    if (!Report || !Report.collectStudentDetail) {
      if (status) status.textContent = "Activity engine is not loaded.";
      return;
    }
    if (status) status.textContent = "Collecting submitted work for " + student.displayName + "…";
    if (window.LoadingUtils) {
      window.LoadingUtils.showLoadingModal("Building PDF for " + student.displayName + "…", "dePdfModal");
    }
    try {
      var details = [];
      for (var i = 0; i < student.courses.length; i++) {
        var c = student.courses[i];
        if (window.LoadingUtils) {
          window.LoadingUtils.updateLoadingModal(
            Math.round(((i + 0.4) / Math.max(student.courses.length, 1)) * 100),
            "Scanning " + (c.courseName || c.courseCode || "course") + "…",
            "dePdfModal"
          );
        }
        var detail = await Report.collectStudentDetail({
          orgUnitId: c.orgUnitId,
          userId: student.userId,
          lastAccessedHint: c.courseLastAccess,
          onProgress: function (msg) {
            if (status) status.textContent = (c.courseName || c.courseCode || "Course") + ": " + msg;
          }
        });
        details.push({
          courseCode: c.courseCode,
          courseName: c.courseName,
          orgUnitId: c.orgUnitId,
          detail: detail
        });
      }
      student.details = details;
      var termEl = $("termCode");
      await renderStudentPdf(student, { termDisplay: termEl ? termEl.value.trim() : "" });
      if (status) status.textContent = "Downloaded PDF for " + student.displayName + ".";
    } catch (e) {
      if (status) status.textContent = "Could not build PDF: " + (e.message || e);
    } finally {
      if (window.LoadingUtils) window.LoadingUtils.hideLoadingModal("dePdfModal");
    }
  }

  function updateSummary(rows, inactiveDays) {
    var pills = $("summaryPills");
    if (!pills) return;
    var students = uniqueStudents(rows);
    var neverCourse = 0;
    var neverD2l = 0;
    var stale = 0;
    var missing = 0;
    var noDe = 0;
    rows.forEach(function (r) {
      var f = flagsFor(r, inactiveDays);
      if (f.indexOf("never-course") >= 0) neverCourse += 1;
      if (f.indexOf("never-d2l") >= 0) neverD2l += 1;
      if (f.indexOf("stale") >= 0) stale += 1;
      if (f.indexOf("missing") >= 0) missing += 1;
      if (f.indexOf("none") >= 0) noDe += 1;
    });
    pills.innerHTML =
      '<span class="pill">' +
      students.length +
      " students</span>" +
      '<span class="pill">' +
      rows.length +
      " rows</span>" +
      '<span class="pill">Never course: ' +
      neverCourse +
      "</span>" +
      '<span class="pill">Never D2L: ' +
      neverD2l +
      "</span>" +
      '<span class="pill">Inactive: ' +
      stale +
      "</span>" +
      '<span class="pill">No 7xx/8xx: ' +
      noDe +
      "</span>" +
      '<span class="pill">Not in D2L: ' +
      missing +
      "</span>";
  }

  function currentInactiveDays() {
    var n = parseInt(($("inactiveDays") && $("inactiveDays").value) || "14", 10);
    return isNaN(n) || n < 1 ? 14 : n;
  }

  function refreshView() {
    if (!state.rows.length) return;
    var days = currentInactiveDays();
    var flaggedOnly = !!($("flaggedOnly") && $("flaggedOnly").checked);
    renderTable(state.rows, days, flaggedOnly);
    updateSummary(state.rows, days);
  }

  async function populateSemester() {
    var select = $("semesterSelect");
    if (!select || !window.SemesterConfig) return;
    var data = [];
    try {
      var orgInfo = await window.D2LApi.getOrganizationInfo();
      if (orgInfo && orgInfo.Identifier) {
        data = await window.D2LApi.fetchPaginatedData(
          "/d2l/api/lp/" + window.D2LApi.apiVersion + "/orgstructure/" + orgInfo.Identifier + "/descendants/?ouTypeId=5"
        );
      }
    } catch (e) {
      data = [];
    }
    window.SemesterConfig.populateSelect(select, data, {
      placeholder: "Select a semester",
      excludeSandbox: true,
      selectedId: FALL_2026_ID
    });
    if (window.SemesterConfig.attachHistoricalInput) {
      window.SemesterConfig.attachHistoricalInput(select);
    }
    syncTermFromSemester();
  }

  function syncTermFromSemester() {
    var select = $("semesterSelect");
    var term = $("termCode");
    if (!select || !term) return;
    var opt = select.options[select.selectedIndex];
    var code = (opt && opt.dataset && opt.dataset.code) || "";
    if (code && code !== "Sandbox") term.value = code;
  }

  function applyCourseDatesToRows(rows, term) {
    (rows || []).forEach(function (r) {
      if (!r || r.notInD2L || r.noDualCourses) {
        if (r) {
          r.courseStart = r.courseStart || null;
          r.courseEnd = r.courseEnd || null;
        }
        return;
      }
      var dates = lookupCourseDates(
        r.courseCode,
        r.courseName,
        r.section,
        term,
        state.courseDateIndex
      );
      r.courseStart = dates.start;
      r.courseEnd = dates.end;
    });
  }

  async function loadCoursesCsvFile() {
    var input = $("coursesCsvFile");
    var file = input && input.files && input.files[0];
    if (!file) {
      state.courseDateIndex = null;
      return 0;
    }
    var text = await file.text();
    var parsed = window.Papa
      ? window.Papa.parse(text.replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: "greedy" })
      : { data: [] };
    state.courseDateIndex = buildCourseDateIndex(parsed.data || []);
    return Object.keys(state.courseDateIndex).length;
  }

  async function runReport() {
    var fileInput = $("csvFile");
    var file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      setStatus("Upload a CSV of OrgDefinedIds first.");
      return;
    }
    var term = parseTerm($("termCode") && $("termCode").value);
    if (!term) {
      setStatus("Enter a term like 26/FA (it should appear in the Course Name).");
      return;
    }
    var include7 = !!($("include7xx") && $("include7xx").checked);
    var include8 = !!($("include8xx") && $("include8xx").checked);
    if (!include7 && !include8) {
      setStatus("Select 7xx and/or 8xx sections.");
      return;
    }
    if (!API || !API.findUserByOrgDefinedId) {
      setStatus("Brightspace API helpers did not load.");
      return;
    }

    state.cancelled = false;
    $("runBtn").disabled = true;
    $("csvBtn").disabled = true;
    setStatus("Parsing CSV…");
    if (window.LoadingUtils) {
      window.LoadingUtils.showLoadingModal("Parsing CSV…", "deRunModal", function () {
        state.cancelled = true;
      });
      window.LoadingUtils.showLoadingBar("loadingContainer");
      window.LoadingUtils.updateLoadingBar(2, "Parsing CSV…", "loadingContainer");
    }

    try {
      var dateKeys = await loadCoursesCsvFile();
      if (dateKeys) {
        setStatus("Loaded " + dateKeys + " course-date keys. Parsing student CSV…");
        if (window.LoadingUtils) {
          window.LoadingUtils.updateLoadingModal(4, "Loaded course dates…", "deRunModal");
        }
      }
      var text = await file.text();
      var ids = parseOrgDefinedIds(text);
      if (!ids.length) throw new Error("No OrgDefinedIds found in that CSV.");
      setStatus("Looking up " + ids.length + " student(s)…");
      var allRows = [];
      var done = 0;
      await pMap(
        ids,
        async function (id) {
          var rows = await scanStudent(id, { term: term, include7: include7, include8: include8 });
          allRows.push.apply(allRows, rows);
          done += 1;
          var pct = Math.round((done / ids.length) * 100);
          setStatus("Scanned " + done + " of " + ids.length + " students…");
          if (window.LoadingUtils) {
            window.LoadingUtils.updateLoadingModal(pct, "Scanned " + done + " of " + ids.length, "deRunModal");
            window.LoadingUtils.updateLoadingBar(pct, "Scanned " + done + " of " + ids.length, "loadingContainer");
          }
        },
        CONCURRENCY
      );

      state.rows = allRows;
      state.students = uniqueStudents(allRows);
      refreshView();
      fillStudentPicker(state.students);
      $("csvBtn").disabled = false;
      setStatus(
        "Done. " +
          state.students.length +
          " students with dual-enrollment rows (plus any missing / no-course records). Use flags or the PDF picker to follow up by name." +
          (dateKeys
            ? " Course dates matched from the simplified courses CSV."
            : " Upload the simplified courses CSV to add start and end dates.")
      );
    } catch (e) {
      if (String(e.message) === "Cancelled") {
        setStatus("Cancelled.");
      } else {
        setStatus(e.message || "Report failed.");
      }
    } finally {
      $("runBtn").disabled = false;
      if (window.LoadingUtils) {
        window.LoadingUtils.hideLoadingModal("deRunModal");
        window.LoadingUtils.updateLoadingBar(100, "Done", "loadingContainer");
      }
    }
  }

  function wire() {
    populateSemester().catch(function (e) {
      setStatus("Could not load semesters: " + (e.message || e));
    });
    $("semesterSelect").addEventListener("change", syncTermFromSemester);
    $("runBtn").addEventListener("click", runReport);
    $("csvBtn").addEventListener("click", function () {
      downloadResultsCsv(state.rows, currentInactiveDays());
    });
    $("flaggedOnly").addEventListener("change", refreshView);
    $("inactiveDays").addEventListener("change", refreshView);
    $("coursesCsvFile").addEventListener("change", async function () {
      try {
        var dateKeys = await loadCoursesCsvFile();
        if (!state.rows.length) {
          setStatus(
            dateKeys
              ? "Loaded " + dateKeys + " course-date keys. Upload student IDs and run."
              : "Upload a student CSV and choose a semester, then run."
          );
          return;
        }
        var term = parseTerm($("termCode") && $("termCode").value);
        applyCourseDatesToRows(state.rows, term);
        state.students = uniqueStudents(state.rows);
        refreshView();
        fillStudentPicker(state.students);
        setStatus(
          dateKeys
            ? "Applied course dates from the simplified courses CSV."
            : "Course dates cleared. Upload the simplified courses CSV to fill start and end dates."
        );
      } catch (e) {
        setStatus("Could not read the courses CSV: " + (e.message || e));
      }
    });
    $("pdfBtn").addEventListener("click", function () {
      generatePdfForStudent(findStudentFromInput());
    });
    $("studentFilter").addEventListener("keydown", function (e) {
      if (e.key === "Enter") generatePdfForStudent(findStudentFromInput());
    });
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest && ev.target.closest(".de-pdf-row");
      if (!btn) return;
      var key = btn.getAttribute("data-key");
      var student = state.students.find(function (s) {
        return s.key === key || s.userId === key;
      });
      if (student && $("studentFilter")) {
        $("studentFilter").value = student.displayName + " (" + student.orgDefinedId + ")";
      }
      generatePdfForStudent(student);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
