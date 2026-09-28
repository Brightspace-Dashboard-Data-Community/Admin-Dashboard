/**
 * Brightspace Advanced Data Sets (Data Hub) — same-origin create / poll / unzip.
 * Used to load Content Progress and Learner Usage, then aggregate without names.
 *
 * ADS (filterable by org unit) — not Brightspace Data Sets (org-wide BDS extracts).
 * Admin Dashboard Work-in-Progress. Faculty accounts typically cannot execute these data sets.
 */
(function (global) {
  "use strict";

  var LP = "1.51";
  var CONTENT_PROGRESS_ID = "29a9192a-dd54-4beb-ad6d-4c1c8f6802fb";
  var LEARNER_USAGE_ID = "c195aa85-b2be-4444-aa52-570e19bfee9e";
  var STUDENT_ROLES = "101,107,112,3,5";
  var POLL_MS = 4000;
  var POLL_MAX = 75;

  var STATUS_QUEUED = 0;
  var STATUS_PROCESSING = 1;
  var STATUS_COMPLETE = 2;
  var STATUS_ERROR = 3;

  function token() {
    try {
      return localStorage.getItem("XSRF.Token") || "";
    } catch (e) {
      return "";
    }
  }

  function headers(json) {
    var h = {
      "X-CSRF-Token": token(),
      Accept: json ? "application/json" : "*/*"
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async function rawJson(url, options) {
    var opts = options || {};
    var res = await fetch(url, {
      credentials: "include",
      method: opts.method || "GET",
      headers: headers(true),
      body: opts.body
    });
    if (!res.ok) {
      var err = new Error("HTTP " + res.status + " - " + url);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    var ct = res.headers.get("content-type") || "";
    if (ct.indexOf("application/json") >= 0) return res.json();
    return null;
  }

  async function rawBlob(url) {
    var res = await fetch(url, {
      credentials: "include",
      method: "GET",
      headers: headers(false),
      redirect: "follow"
    });
    if (!res.ok) {
      var err = new Error("HTTP " + res.status + " - " + url);
      err.status = res.status;
      throw err;
    }
    return res.blob();
  }

  function normalizeHeader(name) {
    return String(name || "")
      .replace(/^\uFEFF/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function parseCsv(text) {
    var src = String(text || "").replace(/^\uFEFF/, "");
    var rows = [];
    var row = [];
    var cell = "";
    var inQuotes = false;
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      var next = src.charAt(i + 1);
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        if (row.length > 1 || (row[0] && row[0].trim())) rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") {
        cell += ch;
      }
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    if (!rows.length) return [];
    var headers = rows[0].map(normalizeHeader);
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        if (headers[c]) obj[headers[c]] = rows[r][c] != null ? String(rows[r][c]).trim() : "";
      }
      out.push(obj);
    }
    return out;
  }

  function cell(row, keys) {
    if (!row) return "";
    for (var i = 0; i < keys.length; i++) {
      var k = normalizeHeader(keys[i]);
      if (row[k] != null && row[k] !== "") return row[k];
    }
    return "";
  }

  function toIsoDate(value, endOfDay) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10) + (endOfDay ? "T23:59:59.000Z" : "T00:00:00.000Z");
    }
    var t = new Date(value).getTime();
    if (isNaN(t)) return "";
    return new Date(t).toISOString();
  }

  async function unzipFirstCsv(blob) {
    if (!global.JSZip) throw new Error("JSZip is not loaded.");
    var zip = await global.JSZip.loadAsync(blob);
    var names = Object.keys(zip.files || {});
    var csvName = "";
    for (var i = 0; i < names.length; i++) {
      if (zip.files[names[i]].dir) continue;
      if (/\.csv$/i.test(names[i])) {
        csvName = names[i];
        break;
      }
    }
    if (!csvName && names.length) csvName = names[0];
    if (!csvName) throw new Error("Data Hub zip did not contain a CSV file.");
    return zip.files[csvName].async("string");
  }

  function jobIdOf(job) {
    if (!job) return "";
    return job.ExportJobId || job.JobId || job.Id || "";
  }

  function jobStatusOf(job) {
    if (!job || job.Status == null) return null;
    return parseInt(job.Status, 10);
  }

  async function createJob(dataSetId, filters) {
    return rawJson("/d2l/api/lp/" + LP + "/dataExport/create", {
      method: "POST",
      body: JSON.stringify({
        DataSetId: dataSetId,
        Filters: filters
      })
    });
  }

  async function getJob(id) {
    return rawJson("/d2l/api/lp/" + LP + "/dataExport/jobs/" + encodeURIComponent(id));
  }

  async function waitForJob(id, onProgress) {
    for (var n = 0; n < POLL_MAX; n++) {
      var job = await getJob(id);
      var status = jobStatusOf(job);
      if (status === STATUS_COMPLETE) return job;
      if (status === STATUS_ERROR) throw new Error("Data Hub export failed.");
      if (status === 4) throw new Error("Data Hub export file was deleted.");
      if (onProgress) {
        onProgress(
          "Data Hub export " +
            (status === STATUS_PROCESSING ? "processing" : "queued") +
            "… (" +
            (n + 1) +
            ")"
        );
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, POLL_MS);
      });
    }
    throw new Error("Data Hub export timed out. Try again in a few minutes.");
  }

  function standardFilters(orgUnitId, startIso, endIso) {
    var filters = [{ Name: "parentOrgUnitId", Value: String(orgUnitId) }];
    if (startIso) filters.push({ Name: "startDate", Value: startIso });
    if (endIso) filters.push({ Name: "endDate", Value: endIso });
    filters.push({ Name: "roles", Value: STUDENT_ROLES });
    return filters;
  }

  function rowMatchesCourse(row, courseId) {
    var ou = cell(row, ["Course Offering ID", "Course Offering Id", "Org Unit Id", "OrgUnitId"]);
    return !ou || String(ou) === String(courseId);
  }

  function isStudentRoleName(name) {
    var r = String(name || "").toLowerCase();
    if (!r) return true;
    if (/instructor|designer|admin|faculty|teacher/.test(r) && r.indexOf("student") < 0) return false;
    return true;
  }

  async function runDataset(dataSetId, orgUnitId, startIso, endIso, onProgress) {
    var created = await createJob(dataSetId, standardFilters(orgUnitId, startIso, endIso));
    var id = jobIdOf(created);
    if (!id) throw new Error("Data Hub did not return an export job id.");
    if (jobStatusOf(created) !== STATUS_COMPLETE) {
      await waitForJob(id, onProgress);
    }
    if (onProgress) onProgress("Downloading Data Hub file…");
    var blob = await rawBlob("/d2l/api/lp/" + LP + "/dataExport/download/" + encodeURIComponent(id));
    if (onProgress) onProgress("Unzipping Data Hub file…");
    var csv = await unzipFirstCsv(blob);
    return parseCsv(csv);
  }

  async function findSemesterAncestor(courseId) {
    try {
      var data = await rawJson(
        "/d2l/api/lp/" + LP + "/orgstructure/" + encodeURIComponent(courseId) + "/ancestors/"
      );
      var items = Array.isArray(data) ? data : data && (data.Items || data.Objects) || [];
      for (var i = 0; i < items.length; i++) {
        var type = ((items[i].Type && (items[i].Type.Code || items[i].Type.Name)) || items[i].Type || "").toString();
        if (/semester/i.test(type)) {
          var id = items[i].Identifier || items[i].Id || (items[i].OrgUnit && items[i].OrgUnit.Id);
          if (id != null) return String(id);
        }
      }
    } catch (e) {
      /* course-level parent is enough for Content Progress */
    }
    return String(courseId);
  }

  function aggregateContentProgress(rows, courseId, studentSet) {
    var visitUsers = {};
    var extraTopics = {};
    var matchedRows = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!rowMatchesCourse(row, courseId)) continue;
      if (!isStudentRoleName(cell(row, ["Role Name"]))) continue;
      var uid = cell(row, ["User ID", "User Id"]);
      if (studentSet && uid && !studentSet[uid]) continue;
      var tid = cell(row, ["Content Topic ID", "Content Topic Id"]);
      if (!tid) continue;
      var visits = parseFloat(cell(row, ["Content Topic Visits"])) || 0;
      var last = cell(row, ["Last Visited Date"]);
      if (visits <= 0 && !last) continue;
      matchedRows++;
      if (!visitUsers[tid]) visitUsers[tid] = {};
      if (uid) visitUsers[tid][uid] = true;
      if (!extraTopics[tid]) {
        extraTopics[tid] = {
          id: tid,
          title: cell(row, ["Content Topic Name"]) || "Topic " + tid,
          module: cell(row, ["Module Name"]) || ""
        };
      }
    }
    var visitMap = {};
    var topicIds = Object.keys(visitUsers);
    for (var t = 0; t < topicIds.length; t++) {
      var users = visitUsers[topicIds[t]];
      var n = 0;
      for (var u in users) {
        if (Object.prototype.hasOwnProperty.call(users, u)) n++;
      }
      visitMap[topicIds[t]] = n;
    }
    return { visitMap: visitMap, extraTopics: extraTopics, matchedRows: matchedRows };
  }

  function aggregateLearnerUsage(rows, courseId, studentSet) {
    var seen = {};
    var completed = [];
    var required = [];
    var timeSec = [];
    var withVisit = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!rowMatchesCourse(row, courseId)) continue;
      if (!isStudentRoleName(cell(row, ["Role Name"]))) continue;
      var uid = cell(row, ["User Id", "User ID"]);
      if (uid && seen[uid]) continue;
      if (studentSet && uid && !studentSet[uid]) continue;
      if (uid) seen[uid] = true;
      var c = parseFloat(cell(row, ["Content Completed"]));
      var req = parseFloat(cell(row, ["Content Required"]));
      var sec = parseFloat(cell(row, ["Total Time Spent In Content"]));
      if (!isNaN(c)) completed.push(c);
      if (!isNaN(req)) required.push(req);
      if (!isNaN(sec)) timeSec.push(sec);
      if (cell(row, ["Last Visited Date"])) withVisit++;
    }
    function avg(nums) {
      if (!nums.length) return null;
      var t = 0;
      for (var i = 0; i < nums.length; i++) t += nums[i];
      return t / nums.length;
    }
    var learners = 0;
    for (var k in seen) {
      if (Object.prototype.hasOwnProperty.call(seen, k)) learners++;
    }
    return {
      learners: learners,
      avgCompleted: avg(completed),
      avgRequired: avg(required),
      avgTimeSec: avg(timeSec),
      withVisit: withVisit
    };
  }

  async function loadForCourse(options) {
    options = options || {};
    var courseId = String(options.courseId || "");
    var studentSet = options.studentSet || null;
    var onProgress = options.onProgress || function () {};
    var startIso = toIsoDate(options.startDate, false) || toIsoDate(new Date(Date.now() - 240 * 86400000).toISOString(), false);
    var endIso = toIsoDate(options.endDate, true) || new Date().toISOString();
    var out = {
      ok: false,
      reason: "",
      visitMap: {},
      extraTopics: {},
      learnerUsage: null
    };
    if (!courseId) {
      out.reason = "missing-course";
      return out;
    }
    if (!global.JSZip) {
      out.reason = "jszip-missing";
      return out;
    }

    var parentId = courseId;
    try {
      parentId = await findSemesterAncestor(courseId);
    } catch (e) {
      parentId = courseId;
    }

    try {
      onProgress("Requesting Content Progress from Data Hub…");
      var progressRows = await runDataset(CONTENT_PROGRESS_ID, courseId, startIso, endIso, onProgress);
      var progress = aggregateContentProgress(progressRows, courseId, studentSet);
      out.visitMap = progress.visitMap;
      out.extraTopics = progress.extraTopics;
      out.ok = progress.matchedRows > 0 || progressRows.length === 0;
      if (!progress.matchedRows && progressRows.length) {
        var retry = aggregateContentProgress(progressRows, courseId, null);
        if (retry.matchedRows) {
          out.visitMap = retry.visitMap;
          out.extraTopics = retry.extraTopics;
          out.ok = true;
        }
      }
      if (progress.matchedRows) out.ok = true;
    } catch (e) {
      out.reason = e && e.status === 403 ? "forbidden" : (e && e.message) || "content-progress-failed";
      if (e && e.status === 403) return out;
    }

    try {
      onProgress("Requesting Learner Usage from Data Hub…");
      var usageParent = parentId || courseId;
      var usageRows = await runDataset(LEARNER_USAGE_ID, usageParent, startIso, endIso, onProgress);
      out.learnerUsage = aggregateLearnerUsage(usageRows, courseId, studentSet);
    } catch (e) {
      if (!out.reason) {
        out.reason = e && e.status === 403 ? "forbidden" : (e && e.message) || "learner-usage-failed";
      }
    }

    if (!out.ok && !out.reason) out.reason = "empty";
    return out;
  }

  global.AdminDashboardDataHub = {
    loadForCourse: loadForCourse,
    parseCsv: parseCsv
  };
  global.FacultyDashboardDataHub = global.AdminDashboardDataHub;
})(window);
