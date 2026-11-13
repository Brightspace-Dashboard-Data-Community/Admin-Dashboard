/**
 * Yuja Panorama LMS accessibility report.
 * Joins course rows to info/programs.csv (division + discipline) by org-unit prefix.
 */
(function () {
    const COLUMNS = ["id", "name", "term", "orgId", "prefix", "code", "files", "bytes", "score", "remediations", "altDownloads", "instructors"];
    const SEASON = { WINTER: 1, SPRING: 2, SUMMER: 3, FALL: 4 };
    const SHORT_SEASON = { WI: 1, WINTER: 1, SP: 2, SPRING: 2, SU: 3, SUMMER: 3, FA: 4, FALL: 4 };
    const FIRST_FORWARD = { year: 2026, season: SEASON.FALL };
    const PAGE_SIZE = 50;

    const state = {
        report: null,
        programs: new Map(),
        rows: [],
        orgNames: new Map(),
        tab: "summary",
        page: 1,
        sort: {
            divisions: { key: "weighted", dir: "asc" },
            disciplines: { key: "weighted", dir: "asc" },
            courses: { key: "score", dir: "asc" }
        }
    };

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        bind();
        try {
            const csvText = await fetch("../info/programs.csv").then(function (res) {
                if (!res.ok) throw new Error("Division list missing");
                return res.text();
            });
            state.programs = parsePrograms(csvText);
        } catch (err) {
            setStatus("The division list did not load, so prefixes cannot be grouped yet.");
        }
        setNote("Load a Panorama LMS export (JSON or Excel). Fall 2026 and later terms are kept, including semesters that appear in a future export. The file stays in this browser session and is not saved with the dashboard.");
        if (!state.report) setStatus("No export loaded.");
    }

    function bind() {
        ["termFilter", "divisionFilter", "disciplineFilter", "hideSandbox", "hideMergedCxld", "mappedOnly"].forEach(function (id) {
            document.getElementById(id).addEventListener("change", function () {
                if (id === "divisionFilter") {
                    document.getElementById("disciplineFilter").value = "";
                }
                state.page = 1;
                render();
            });
        });

        ["searchFilter", "maxScore", "minFiles"].forEach(function (id) {
            document.getElementById(id).addEventListener("input", function () {
                state.page = 1;
                render();
            });
        });

        document.getElementById("fileInput").addEventListener("change", onFile);
        document.getElementById("exportBtn").addEventListener("click", exportView);
        document.getElementById("pdfBtn").addEventListener("click", function () {
            downloadPdf();
        });

        document.querySelectorAll(".tab-btn").forEach(function (btn) {
            btn.addEventListener("click", function () {
                state.tab = btn.dataset.tab;
                state.page = 1;
                document.querySelectorAll(".tab-btn").forEach(function (el) {
                    el.classList.toggle("active", el === btn);
                });
                render();
            });
        });
    }

    function adoptReport(report) {
        state.report = materialize(report);
        state.orgNames = new Map();
        const enriched = (state.report.courses || []).map(enrich);
        state.rows = enriched.filter(function (row) { return isForwardTerm(row.term); });
        fillTermOptions();
        const overall = report.overall || {};
        const score = overall.score != null ? formatScore(overall.score) : "—";
        const windowLabel = report.window || "the uploaded export";
        const terms = Array.from(new Set(state.rows.map(function (row) { return row.term; }))).sort(function (a, b) {
            const ra = termRank(a);
            const rb = termRank(b);
            if (ra[0] !== rb[0]) return ra[0] - rb[0];
            return ra[1] - rb[1];
        });
        setNote(
            "This file covers files Yuja processed in " + windowLabel +
            ". Courses before Fall 2026 are left out, along with Default Term and 0000-No Semester. " +
            "Kept terms: " + (terms.length ? terms.join(", ") : "none") + ". " +
            "A later export adds the next semesters on its own, such as Spring 2027, Fall 2027, and Winter 2028. " +
            "Yuja’s overall score for the whole export is " + score +
            " across " + formatInt(overall.files) + " files. The instructor column is a count of Brightspace user IDs, not names."
        );
        render();
    }

    function enrich(course) {
        const prefix = String(course.prefix || "").trim().toUpperCase();
        const program = state.programs.get(prefix);
        let division = "Not in division list";
        let discipline = prefix || "No prefix";
        let mapped = false;
        if (program) {
            division = program.division;
            discipline = program.disciplines.join(" / ");
            mapped = true;
        } else if (prefix === "SANDBOX") {
            division = "Sandbox";
            discipline = "Sandbox";
        } else if (!prefix || prefix === "-") {
            division = "Unassigned";
            discipline = "No prefix";
        }
        const lookedUp = state.orgNames.get(String(course.orgId));
        if (lookedUp && !mapped) {
            discipline = lookedUp.name || discipline;
            if (lookedUp.parent) division = lookedUp.parent;
        }
        return Object.assign({}, course, {
            prefix: prefix,
            division: division,
            discipline: discipline,
            mapped: mapped
        });
    }

    function fillTermOptions() {
        const select = document.getElementById("termFilter");
        const current = select.value;
        const terms = Array.from(new Set(state.rows.map(function (row) { return row.term; })));
        terms.sort(function (a, b) {
            const ra = termRank(a);
            const rb = termRank(b);
            if (ra[0] !== rb[0]) return rb[0] - ra[0];
            if (ra[1] !== rb[1]) return rb[1] - ra[1];
            return String(a).localeCompare(String(b));
        });
        select.innerHTML = '<option value="">All terms</option>';
        terms.forEach(function (term) {
            const option = document.createElement("option");
            option.value = term;
            option.textContent = term;
            select.appendChild(option);
        });
        if (current && terms.indexOf(current) !== -1) select.value = current;
    }

    function filters() {
        const maxRaw = document.getElementById("maxScore").value.trim();
        const minRaw = document.getElementById("minFiles").value.trim();
        return {
            term: document.getElementById("termFilter").value,
            division: document.getElementById("divisionFilter").value,
            discipline: document.getElementById("disciplineFilter").value,
            search: document.getElementById("searchFilter").value.trim().toLowerCase(),
            maxScore: maxRaw === "" ? null : Number(maxRaw),
            minFiles: minRaw === "" ? 0 : Number(minRaw),
            hideSandbox: document.getElementById("hideSandbox").checked,
            hideMergedCxld: document.getElementById("hideMergedCxld").checked,
            mappedOnly: document.getElementById("mappedOnly").checked
        };
    }

    function isMergedOrCancelled(row) {
        const text = (String(row.name || "") + " " + String(row.code || "")).toUpperCase();
        return /(^|[^A-Z0-9])MERGED([^A-Z0-9]|$)/.test(text) || /(^|[^A-Z0-9])CXLD([^A-Z0-9]|$)/.test(text);
    }

    function passesBase(row, f) {
        if (f.term && row.term !== f.term) return false;
        if (f.hideSandbox && (row.prefix === "SANDBOX" || row.term === "Sandbox")) return false;
        if (f.hideMergedCxld && isMergedOrCancelled(row)) return false;
        if (f.mappedOnly && !row.mapped) return false;
        return true;
    }

    function passesAll(row, f) {
        if (!passesBase(row, f)) return false;
        if (f.division && row.division !== f.division) return false;
        if (f.discipline && row.discipline !== f.discipline) return false;
        if (f.maxScore != null && !(row.score <= f.maxScore)) return false;
        if (row.files < (f.minFiles || 0)) return false;
        if (f.search) {
            const hay = (row.name + " " + row.code + " " + row.id + " " + row.prefix).toLowerCase();
            if (hay.indexOf(f.search) === -1) return false;
        }
        return true;
    }

    function render() {
        if (!state.report) return;
        refreshDivisionOptions(filters());
        const f = filters();
        const filtered = state.rows.filter(function (row) { return passesAll(row, f); });
        const summary = summarize(filtered);
        renderKpis(summary, filtered.length);
        const groupCount = state.tab === "divisions"
            ? rollup(filtered, function (row) { return row.division; }).length
            : state.tab === "disciplines"
                ? rollup(filtered, function (row) { return row.division + "\t" + row.discipline + "\t" + row.prefix; }).length
                : 0;
        const courseWord = filtered.length === 1 ? "course" : "courses";
        const grouped = state.tab === "divisions" || state.tab === "disciplines";
        const groupWord = state.tab === "divisions" ? (groupCount === 1 ? "division" : "divisions") : (groupCount === 1 ? "discipline" : "disciplines");
        setStatus(
            formatInt(filtered.length) + " " + courseWord +
            (grouped ? " · " + formatInt(groupCount) + " " + groupWord : "") +
            (state.report.source ? " · " + state.report.source : "")
        );
        showPanel(state.tab);
        if (state.tab === "summary") renderSummary(filtered, summary);
        if (state.tab === "divisions") renderGroup("panel-divisions", "divisions", filtered, divisionColumns());
        if (state.tab === "disciplines") renderGroup("panel-disciplines", "disciplines", filtered, disciplineColumns());
        if (state.tab === "courses") renderCourses(filtered);
    }

    function refreshDivisionOptions(f) {
        const divisionSelect = document.getElementById("divisionFilter");
        const disciplineSelect = document.getElementById("disciplineFilter");
        const divisionValue = divisionSelect.value;
        const disciplineValue = disciplineSelect.value;
        const base = state.rows.filter(function (row) { return passesBase(row, f); });
        const divisions = uniqueSorted(base.map(function (row) { return row.division; }));
        fillSelect(divisionSelect, "All divisions", divisions, divisionValue);

        const forDisciplines = base.filter(function (row) {
            return !divisionSelect.value || row.division === divisionSelect.value;
        });
        const disciplines = uniqueSorted(forDisciplines.map(function (row) { return row.discipline; }));
        fillSelect(disciplineSelect, "All disciplines", disciplines, disciplineValue);
    }

    function renderKpis(summary, courseCount) {
        const cards = [
            ["Courses", formatInt(courseCount)],
            ["Weighted score", summary.files ? formatScore(summary.weighted) : "—"],
            ["Course average", courseCount ? formatScore(summary.average) : "—"],
            ["Files", formatInt(summary.files)],
            ["Below 70", formatInt(summary.below70)],
            ["Remediations", formatInt(summary.remediations)],
            ["Alt. formats", formatInt(summary.altDownloads)],
            ["Storage", formatBytes(summary.bytes)]
        ];
        document.getElementById("kpis").innerHTML = cards.map(function (card) {
            return '<div class="kpi"><div class="kpi-label">' + escapeHtml(card[0]) + '</div><div class="kpi-value">' + escapeHtml(card[1]) + "</div></div>";
        }).join("");
    }

    function renderSummary(filtered, summary) {
        const panel = document.getElementById("panel-summary");
        const bands = [
            ["Under 50", summary.bandLow, "fill-low"],
            ["50–69", summary.bandMid, "fill-mid"],
            ["70–84", summary.bandOk, "fill-ok"],
            ["85–100", summary.bandHigh, "fill-high"]
        ];
        const bandMax = Math.max.apply(null, bands.map(function (b) { return b[1]; }).concat([1]));
        const bandHtml = bands.map(function (band) {
            const width = Math.round((band[1] / bandMax) * 100);
            return '<div class="band"><span>' + band[0] + '</span><div class="band-track"><span class="' + band[2] + '" style="width:' + width + '%"></span></div><strong>' + formatInt(band[1]) + "</strong></div>";
        }).join("");

        const divisions = sortRows(rollup(filtered, function (row) { return row.division; }).map(function (group) {
            group.label = group.key;
            return group;
        }), state.sort.divisions);

        const cumulative = (state.report.cumulative || []).slice().reverse();
        const latest = cumulative[0];
        const typeRows = latest ? [
            ["PDF", latest.pdf],
            ["Word", latest.word],
            ["Excel", latest.excel],
            ["PowerPoint", latest.powerpoint],
            ["Web", latest.web],
            ["GIF", latest.gif]
        ] : [];

        const unmapped = filtered.filter(function (row) { return !row.mapped; });
        const unmappedIds = Array.from(new Set(unmapped.map(function (row) { return row.orgId; }).filter(function (id) {
            return id && id !== "default";
        })));

        panel.innerHTML =
            '<div class="split">' +
                '<div class="card"><h2 style="font-size:16px;margin-bottom:8px;">Score bands</h2><p class="status-line" style="margin-top:0;">Course counts in the current filter. The weighted score uses files, so a large course moves the average more than a small one.</p>' + bandHtml + "</div>" +
                '<div class="card"><h2 style="font-size:16px;margin-bottom:8px;">File types in the whole export</h2>' +
                    (latest
                        ? '<p class="status-line" style="margin-top:0;">Yuja publishes these by month for the entire file, not by division. Latest month: ' + escapeHtml(latest.date) + ".</p>" + typeRows.map(function (row) {
                            const value = row[1];
                            const width = value == null ? 0 : Math.max(0, Math.min(100, value));
                            const label = value == null ? "—" : formatScore(value);
                            return '<div class="band"><span>' + row[0] + '</span><div class="band-track"><span class="' + fillClass(value) + '" style="width:' + width + '%"></span></div><strong>' + label + "</strong></div>";
                        }).join("") + monthTable(state.report.cumulative || [])
                        : '<p>This export has no monthly file-type scores.</p>') +
                "</div>" +
            "</div>" +
            '<div class="card"><h2 style="font-size:16px;margin-bottom:8px;">Divisions in this filter</h2>' +
                '<p class="status-line" style="margin-top:0;">Open a division to see its disciplines. Weighted score is files times score, divided by files.</p>' +
                groupTableHtml(divisions, divisionColumns(), "divisions") +
            "</div>" +
            '<div class="card"><h2 style="font-size:16px;margin-bottom:8px;">Prefixes not on the division list</h2>' +
                "<p>" + formatInt(unmapped.length) + " courses in this filter use an org-unit code that is not in Division Information. " +
                formatInt(unmappedIds.length) + " of those codes have a Brightspace org unit id.</p>" +
                '<p style="margin-top:10px;"><button type="button" class="btn-primary" id="lookupBtn">Look up those org units in Brightspace</button></p>' +
                '<p class="status-line" id="lookupStatus">The division list is used first. This lookup only names the leftovers, and it works when the dashboard is open on your-brightspace.example.edu while you are signed in.</p>' +
            "</div>";

        document.getElementById("lookupBtn").addEventListener("click", function () {
            lookupOrgUnits(unmappedIds);
        });
        panel.querySelectorAll("[data-open-division]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                openDivision(btn.getAttribute("data-open-division"));
            });
        });
        wireSort(panel, "divisions");
    }

    function monthTable(rows) {
        if (!rows.length) return "";
        const body = rows.map(function (row) {
            return "<tr><td>" + escapeHtml(row.date) + "</td><td>" + scoreCell(row.overall) + "</td><td>" + plainScore(row.pdf) + "</td><td>" + plainScore(row.word) + "</td><td>" + plainScore(row.excel) + "</td><td>" + plainScore(row.powerpoint) + "</td><td>" + plainScore(row.web) + "</td></tr>";
        }).join("");
        return '<div class="table-wrap" style="margin-top:12px;"><table class="data"><thead><tr><th>Month</th><th>Overall</th><th>PDF</th><th>Word</th><th>Excel</th><th>PowerPoint</th><th>Web</th></tr></thead><tbody>' + body + "</tbody></table></div>";
    }

    function divisionColumns() {
        return [
            { key: "label", label: "Division", render: function (group) {
                return '<button type="button" class="linkish" data-open-division="' + escapeHtml(group.label) + '">' + escapeHtml(group.label) + "</button>";
            }},
            { key: "courses", label: "Courses", numeric: true, render: function (g) { return formatInt(g.courses); } },
            { key: "weighted", label: "Weighted score", numeric: true, render: function (g) { return scoreBar(g.weighted); } },
            { key: "average", label: "Course average", numeric: true, render: function (g) { return formatScore(g.average); } },
            { key: "files", label: "Files", numeric: true, render: function (g) { return formatInt(g.files); } },
            { key: "below70", label: "Below 70", numeric: true, render: function (g) { return formatInt(g.below70); } },
            { key: "remediations", label: "Remediations", numeric: true, render: function (g) { return formatInt(g.remediations); } },
            { key: "altDownloads", label: "Alt. formats", numeric: true, render: function (g) { return formatInt(g.altDownloads); } },
            { key: "bytes", label: "Storage", numeric: true, render: function (g) { return formatBytes(g.bytes); } }
        ];
    }

    function disciplineColumns() {
        return [
            { key: "division", label: "Division" },
            { key: "discipline", label: "Discipline", render: function (group) {
                return '<button type="button" class="linkish" data-open-discipline="' + escapeHtml(group.discipline) + '" data-open-division="' + escapeHtml(group.division) + '">' + escapeHtml(group.discipline) + "</button>";
            }},
            { key: "prefix", label: "Prefix" },
            { key: "courses", label: "Courses", numeric: true, render: function (g) { return formatInt(g.courses); } },
            { key: "weighted", label: "Weighted score", numeric: true, render: function (g) { return scoreBar(g.weighted); } },
            { key: "average", label: "Course average", numeric: true, render: function (g) { return formatScore(g.average); } },
            { key: "files", label: "Files", numeric: true, render: function (g) { return formatInt(g.files); } },
            { key: "below70", label: "Below 70", numeric: true, render: function (g) { return formatInt(g.below70); } },
            { key: "remediations", label: "Remediations", numeric: true, render: function (g) { return formatInt(g.remediations); } },
            { key: "altDownloads", label: "Alt. formats", numeric: true, render: function (g) { return formatInt(g.altDownloads); } }
        ];
    }

    function renderGroup(panelId, sortName, filtered, columns) {
        const groups = rollup(filtered, function (row) {
            if (sortName === "divisions") return row.division;
            return row.division + "\t" + row.discipline + "\t" + row.prefix;
        }).map(function (group) {
            if (sortName === "divisions") {
                group.label = group.key;
            } else {
                const parts = group.key.split("\t");
                group.division = parts[0];
                group.discipline = parts[1];
                group.prefix = parts[2];
                group.label = group.discipline;
            }
            return group;
        });
        const sorted = sortRows(groups, state.sort[sortName]);
        const panel = document.getElementById(panelId);
        panel.innerHTML = '<div class="card">' + groupTableHtml(sorted, columns, sortName) + "</div>";
        wireSort(panel, sortName);
        panel.querySelectorAll("[data-open-division]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const division = btn.getAttribute("data-open-division");
                const discipline = btn.getAttribute("data-open-discipline");
                if (discipline) openDiscipline(division, discipline);
                else openDivision(division);
            });
        });
    }

    function groupTableHtml(groups, columns, sortName) {
        return '<div class="table-wrap"><table class="data"><thead><tr>' +
            columns.map(function (col) { return "<th>" + sortButton(sortName, col) + "</th>"; }).join("") +
            "</tr></thead><tbody>" +
            (groups.length ? groups.map(function (group) {
                return "<tr>" + columns.map(function (col) {
                    const html = col.render ? col.render(group) : escapeHtml(group[col.key] == null ? "" : String(group[col.key]));
                    return "<td>" + html + "</td>";
                }).join("") + "</tr>";
            }).join("") : '<tr><td colspan="' + columns.length + '">No courses match these filters.</td></tr>') +
            "</tbody></table></div>";
    }

    function renderCourses(filtered) {
        const columns = [
            { key: "name", label: "Course" },
            { key: "term", label: "Term" },
            { key: "division", label: "Division" },
            { key: "discipline", label: "Discipline" },
            { key: "prefix", label: "Prefix" },
            { key: "files", label: "Files", numeric: true },
            { key: "score", label: "Score", numeric: true },
            { key: "remediations", label: "Remediations", numeric: true },
            { key: "altDownloads", label: "Alt. formats", numeric: true },
            { key: "bytes", label: "Storage", numeric: true },
            { key: "instructors", label: "Instructors", numeric: true }
        ];
        const sorted = sortRows(filtered, state.sort.courses);
        const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
        if (state.page > pages) state.page = pages;
        const start = (state.page - 1) * PAGE_SIZE;
        const slice = sorted.slice(start, start + PAGE_SIZE);
        const panel = document.getElementById("panel-courses");
        panel.innerHTML =
            '<div class="card"><div class="row-actions"><div class="pager">' +
                '<button type="button" class="file-btn" id="prevPage">Previous</button>' +
                "<span>Page " + state.page + " of " + pages + "</span>" +
                '<button type="button" class="file-btn" id="nextPage">Next</button>' +
            "</div><span>" + formatInt(sorted.length) + " courses</span></div>" +
            '<div class="table-wrap"><table class="data"><thead><tr>' +
            columns.map(function (col) { return "<th>" + sortButton("courses", col) + "</th>"; }).join("") +
            "</tr></thead><tbody>" +
            (slice.length ? slice.map(courseRow).join("") : '<tr><td colspan="11">No courses match these filters.</td></tr>') +
            "</tbody></table></div></div>";
        wireSort(panel, "courses");
        document.getElementById("prevPage").addEventListener("click", function () {
            if (state.page > 1) {
                state.page -= 1;
                render();
            }
        });
        document.getElementById("nextPage").addEventListener("click", function () {
            if (state.page < pages) {
                state.page += 1;
                render();
            }
        });
    }

    function panoramaReportUrl(courseId) {
        return "https://your-brightspace.example.edu/d2l/common/dialogs/quickLink/quickLink.d2l?ou=" +
            encodeURIComponent(courseId) +
            "&type=lti&rcode=Delta-3178727&srcou=1001&launchFramed=1&framedName=Panorama";
    }

    function courseRow(row) {
        const name = '<a href="https://your-brightspace.example.edu/d2l/home/' + encodeURIComponent(row.id) + '" target="_blank" rel="noopener">' + escapeHtml(row.name) + "</a>";
        const report = '<a href="' + panoramaReportUrl(row.id) + '" target="_blank" rel="noopener">Course report</a>';
        const code = '<div class="status-line">' + (row.code && row.code !== "-" ? escapeHtml(row.code) + " · " : "") + report + "</div>";
        return "<tr><td class=\"wrap\">" + name + code + "</td><td>" + escapeHtml(row.term) + "</td><td>" + escapeHtml(row.division) +
            "</td><td>" + escapeHtml(row.discipline) + "</td><td>" + escapeHtml(row.prefix || "—") + "</td><td>" + formatInt(row.files) +
            "</td><td>" + scoreBar(row.score) + "</td><td>" + formatInt(row.remediations) + "</td><td>" + formatInt(row.altDownloads) +
            "</td><td>" + formatBytes(row.bytes) + "</td><td>" + formatInt(row.instructors) + "</td></tr>";
    }

    function sortButton(sortName, col) {
        const active = state.sort[sortName];
        const aria = active.key === col.key ? (active.dir === "asc" ? "ascending" : "descending") : "none";
        return '<button type="button" data-sort-view="' + sortName + '" data-sort-key="' + col.key + '" aria-sort="' + aria + '">' + escapeHtml(col.label) + "</button>";
    }

    function wireSort(panel, sortName) {
        panel.querySelectorAll("[data-sort-key]").forEach(function (btn) {
            if (btn.getAttribute("data-sort-view") !== sortName) return;
            btn.addEventListener("click", function () {
                const key = btn.getAttribute("data-sort-key");
                const current = state.sort[sortName];
                if (current.key === key) current.dir = current.dir === "asc" ? "desc" : "asc";
                else {
                    current.key = key;
                    current.dir = key === "name" || key === "label" || key === "division" || key === "discipline" || key === "prefix" || key === "term" ? "asc" : "desc";
                }
                state.page = 1;
                render();
            });
        });
    }

    function openDivision(division) {
        document.getElementById("divisionFilter").value = division;
        document.getElementById("disciplineFilter").value = "";
        document.getElementById("searchFilter").value = "";
        state.tab = "disciplines";
        state.page = 1;
        document.querySelectorAll(".tab-btn").forEach(function (el) {
            el.classList.toggle("active", el.dataset.tab === "disciplines");
        });
        render();
    }

    function openDiscipline(division, discipline) {
        document.getElementById("divisionFilter").value = division;
        document.getElementById("disciplineFilter").value = discipline;
        document.getElementById("searchFilter").value = "";
        state.tab = "courses";
        state.page = 1;
        document.querySelectorAll(".tab-btn").forEach(function (el) {
            el.classList.toggle("active", el.dataset.tab === "courses");
        });
        render();
    }

    async function lookupOrgUnits(ids) {
        const status = document.getElementById("lookupStatus");
        if (!ids.length) {
            status.textContent = "Every course in this filter is already on the division list, or it has no org unit id.";
            return;
        }
        if (typeof D2LApi === "undefined" || typeof D2LApi._fetch !== "function") {
            status.textContent = "The Brightspace API helper is not on this page.";
            return;
        }
        status.textContent = "Looking up " + ids.length + " org units…";
        const found = new Map();
        try {
            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                const unit = await D2LApi._fetch("/d2l/api/lp/" + D2LApi.apiVersion + "/orgstructure/" + encodeURIComponent(id));
                let parentName = "";
                try {
                    const parents = await D2LApi._fetch("/d2l/api/lp/" + D2LApi.apiVersion + "/orgstructure/" + encodeURIComponent(id) + "/parents/");
                    if (Array.isArray(parents) && parents.length) {
                        parentName = parents.map(function (parent) { return parent.Name; }).filter(Boolean).join(" → ");
                    }
                } catch (parentErr) {
                    parentName = "";
                }
                found.set(String(id), {
                    name: (unit && (unit.Name || unit.Code)) || String(id),
                    parent: parentName
                });
                status.textContent = "Looked up " + (i + 1) + " of " + ids.length + "…";
            }
        } catch (err) {
            status.textContent = "Brightspace did not return org units. Open this page from your-brightspace.example.edu while you are signed in. The division list still applies.";
            return;
        }
        state.orgNames = found;
        state.rows = (state.report.courses || []).map(enrich);
        status.textContent = "Named " + found.size + " org units from Brightspace.";
        render();
    }

    function getJsPdfCtor() {
        if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
        if (window.jsPDF) return window.jsPDF;
        return null;
    }

    function pdfSafe(value) {
        return String(value == null ? "" : value).replace(/[^\x20-\x7E]/g, function (ch) {
            if (ch === "–" || ch === "—" || ch === "−") return "-";
            if (ch === "’" || ch === "‘") return "'";
            if (ch === "“" || ch === "”") return '"';
            return " ";
        });
    }

    function scoreRgb(value) {
        const n = Number(value);
        if (n < 50) return [185, 28, 28];
        if (n < 70) return [194, 65, 12];
        if (n < 85) return [161, 98, 7];
        return [22, 101, 52];
    }

    function scorePdf(value) {
        if (value == null || Number.isNaN(Number(value))) return { text: "-", color: [51, 65, 85] };
        return { text: formatScore(value), color: scoreRgb(value) };
    }

    function filterSummary(f) {
        const parts = [];
        parts.push(f.term ? "Term: " + f.term : "All kept terms");
        if (f.division) parts.push("Division: " + f.division);
        if (f.discipline) parts.push("Discipline: " + f.discipline);
        if (f.search) parts.push('Search: "' + f.search + '"');
        if (f.maxScore != null && !Number.isNaN(f.maxScore)) parts.push("Score at or below " + f.maxScore);
        if (f.minFiles) parts.push("At least " + formatInt(f.minFiles) + " files");
        if (f.hideSandbox) parts.push("Sandboxes hidden");
        if (f.hideMergedCxld) parts.push("MERGED and CXLD hidden");
        if (f.mappedOnly) parts.push("Only prefixes on the division list");
        return parts.join(". ") + ".";
    }

    function groupsByDivision(rows) {
        return sortRows(rollup(rows, function (row) { return row.division; }).map(function (group) {
            group.label = group.key;
            return group;
        }), { key: "weighted", dir: "asc" });
    }

    function groupsByDiscipline(rows) {
        return sortRows(rollup(rows, function (row) {
            return row.division + "\t" + row.discipline + "\t" + row.prefix;
        }).map(function (group) {
            const parts = group.key.split("\t");
            group.division = parts[0];
            group.discipline = parts[1];
            group.prefix = parts[2];
            group.label = group.discipline;
            return group;
        }), { key: "weighted", dir: "asc" });
    }

    async function downloadPdf() {
        if (!state.report) {
            setStatus("Load a Panorama LMS export before downloading the branded PDF.");
            return;
        }
        const JsPDF = getJsPdfCtor();
        if (!JsPDF) {
            setStatus("The PDF library did not load. Refresh the page and try again.");
            return;
        }
        const button = document.getElementById("pdfBtn");
        if (button) button.disabled = true;
        setStatus("Building the branded PDF…");
        try {
            const Brand = window.FacultyDashboardPdfBrand;
            const duckLogo = Brand ? await Brand.loadDuckLogo() : null;
            const doc = new JsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
            const pageW = 792;
            const pageH = 612;
            const margin = 36;
            const contentW = pageW - margin * 2;
            const GREEN = [15, 91, 70];
            const PDF_TEXT = [15, 23, 42];
            const PDF_MUTED = [51, 65, 85];
            const PDF_ON_DARK = [255, 255, 255];
            const PDF_SURFACE = [226, 232, 240];
            const PDF_LINE = [100, 116, 139];
            const BANDS = [
                ["Under 50", "bandLow", [239, 68, 68]],
                ["50-69", "bandMid", [249, 115, 22]],
                ["70-84", "bandOk", [234, 179, 8]],
                ["85-100", "bandHigh", [34, 197, 94]]
            ];
            let y = 0;

            const f = filters();
            const filtered = state.rows.filter(function (row) { return passesAll(row, f); });
            const summary = summarize(filtered);
            const overall = state.report.overall || {};
            const divisions = groupsByDivision(filtered);
            const disciplines = groupsByDiscipline(filtered);
            const cumulative = state.report.cumulative || [];
            const latest = cumulative.length ? cumulative[cumulative.length - 1] : null;
            const ranked = filtered.filter(function (row) {
                return row.score != null && !Number.isNaN(Number(row.score));
            }).slice().sort(function (a, b) {
                return Number(a.score) - Number(b.score);
            });
            const lowest = ranked.slice(0, 25);
            const unmapped = filtered.filter(function (row) { return !row.mapped; }).length;
            const terms = Array.from(new Set(filtered.map(function (row) { return row.term; }))).sort(function (a, b) {
                const ra = termRank(a);
                const rb = termRank(b);
                if (ra[0] !== rb[0]) return ra[0] - rb[0];
                return ra[1] - rb[1];
            });

            function setInk(rgb, font, size) {
                doc.setTextColor(rgb[0], rgb[1], rgb[2]);
                doc.setFont("helvetica", font || "normal");
                if (size) doc.setFontSize(size);
            }

            function drawChrome(isCover) {
                const barH = isCover ? 78 : 46;
                doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
                doc.rect(0, 0, pageW, barH, "F");
                const duckH = isCover ? 46 : 28;
                const duckY = isCover ? 16 : 9;
                let textX = margin;
                if (Brand && duckLogo) {
                    const duckW = Brand.drawDuck(doc, duckLogo, margin, duckY, duckH);
                    if (duckW) textX = margin + duckW + 12;
                }
                doc.setTextColor(255, 255, 255);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(isCover ? 16 : 12);
                doc.text("Your College Admin Dashboard", textX, isCover ? 32 : 20);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(isCover ? 13 : 10);
                doc.text("Yuja Accessibility", textX, isCover ? 52 : 36);
                if (isCover) {
                    doc.setFontSize(10);
                    doc.text("Panorama LMS overview", textX, 68);
                }
            }

            function newPage() {
                doc.addPage();
                drawChrome(false);
                y = 64;
                setInk(PDF_TEXT, "normal", 9);
            }

            function need(height) {
                if (y + height > pageH - 40) newPage();
            }

            function para(text, size) {
                setInk(PDF_TEXT, "normal", size || 9);
                const lines = doc.splitTextToSize(pdfSafe(text), contentW);
                lines.forEach(function (line) {
                    need(13);
                    doc.text(line, margin, y);
                    y += 12;
                });
                y += 4;
            }

            function section(label) {
                need(34);
                y += 6;
                doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
                doc.rect(margin, y, contentW, 20, "F");
                setInk(PDF_ON_DARK, "bold", 11);
                doc.text(label, margin + 8, y + 14);
                y += 30;
                setInk(PDF_TEXT, "normal", 9);
            }

            function clip(text, width) {
                let value = pdfSafe(text);
                if (doc.getTextWidth(value) <= width) return value;
                const ellipsis = "...";
                while (value.length && doc.getTextWidth(value + ellipsis) > width) value = value.slice(0, -1);
                return value + ellipsis;
            }

            function cellText(cell) {
                if (cell && typeof cell === "object") return cell.text;
                return cell == null ? "" : String(cell);
            }

            function drawTable(headers, rows, colW) {
                const rowH = 16;
                const headerH = 18;
                function header() {
                    need(headerH + 4);
                    doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
                    doc.rect(margin, y, contentW, headerH, "F");
                    setInk(PDF_ON_DARK, "bold", 8);
                    let x = margin + 4;
                    headers.forEach(function (label, index) {
                        doc.text(clip(label, colW[index] - 8), x, y + 12);
                        x += colW[index];
                    });
                    y += headerH;
                }
                if (!rows.length) {
                    setInk(PDF_MUTED, "italic", 9);
                    doc.text("No rows in this filter.", margin, y);
                    y += 16;
                    return;
                }
                header();
                rows.forEach(function (row, index) {
                    if (y + rowH > pageH - 40) {
                        newPage();
                        header();
                    }
                    if (index % 2 === 1) {
                        doc.setFillColor(PDF_SURFACE[0], PDF_SURFACE[1], PDF_SURFACE[2]);
                        doc.rect(margin, y, contentW, rowH, "F");
                    }
                    doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
                    doc.setLineWidth(0.4);
                    doc.line(margin, y + rowH, margin + contentW, y + rowH);
                    let x = margin + 4;
                    row.forEach(function (cell, cellIndex) {
                        const color = cell && typeof cell === "object" && cell.color ? cell.color : PDF_TEXT;
                        setInk(color, "normal", 8);
                        doc.text(clip(cellText(cell), colW[cellIndex] - 8), x, y + 11);
                        x += colW[cellIndex];
                    });
                    y += rowH;
                });
                y += 8;
            }

            function hbar(label, amount, max, color, valueLabel) {
                need(18);
                setInk(PDF_TEXT, "normal", 9);
                doc.text(pdfSafe(label), margin, y + 10);
                const barX = margin + 92;
                const barW = 280;
                doc.setFillColor(238, 242, 239);
                doc.roundedRect(barX, y + 2, barW, 10, 3, 3, "F");
                const width = max ? Math.max(0, Math.min(barW, (amount / max) * barW)) : 0;
                if (width > 0) {
                    doc.setFillColor(color[0], color[1], color[2]);
                    if (width >= 8) doc.roundedRect(barX, y + 2, width, 10, 3, 3, "F");
                    else doc.rect(barX, y + 2, width, 10, "F");
                }
                setInk(PDF_TEXT, "bold", 9);
                doc.text(pdfSafe(valueLabel), barX + barW + 10, y + 11);
                y += 18;
            }

            drawChrome(true);
            y = 96;
            const generated = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
            para("Source: " + (state.report.source || "Yuja Panorama LMS export") + ".   Files processed: " + (state.report.window || "the uploaded export") + ".   Generated: " + generated + ".");
            if (overall.score != null || overall.files != null) {
                para(
                    "Yuja's overall score for the whole export is " +
                    (overall.score != null ? formatScore(overall.score) : "-") +
                    " across " + (overall.files != null ? formatInt(overall.files) : "-") +
                    " files, with " + (overall.remediations != null ? formatInt(overall.remediations) : "-") +
                    " remediations and " + (overall.altDownloads != null ? formatInt(overall.altDownloads) : "-") +
                    " alternate-format downloads. Courses before Fall 2026 are left out of the tables below."
                );
            } else {
                para("Courses before Fall 2026 are left out of the tables below. The totals in this PDF come from those courses.");
            }
            para("Kept terms in this PDF: " + (terms.length ? terms.join(", ") : "none") + ". " + filterSummary(f) + " Weighted score is files times score, divided by files. Tables are sorted with the lowest weighted score first.");
            para(formatInt(unmapped) + " courses in this filter use a prefix that is not on the division list.");

            const cards = [
                ["Courses", formatInt(filtered.length)],
                ["Weighted score", summary.files ? formatScore(summary.weighted) : "-"],
                ["Course average", filtered.length ? formatScore(summary.average) : "-"],
                ["Files", formatInt(summary.files)],
                ["Below 70", formatInt(summary.below70)],
                ["Remediations", formatInt(summary.remediations)],
                ["Alt. formats", formatInt(summary.altDownloads)],
                ["Storage", formatBytes(summary.bytes)]
            ];
            const gap = 8;
            const cardW = (contentW - gap * 3) / 4;
            const cardH = 46;
            need(cardH * 2 + 20);
            cards.forEach(function (card, index) {
                const col = index % 4;
                const row = Math.floor(index / 4);
                const x = margin + col * (cardW + gap);
                const top = y + row * (cardH + 8);
                doc.setFillColor(PDF_SURFACE[0], PDF_SURFACE[1], PDF_SURFACE[2]);
                doc.setDrawColor(PDF_LINE[0], PDF_LINE[1], PDF_LINE[2]);
                doc.roundedRect(x, top, cardW, cardH, 4, 4, "FD");
                doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
                doc.rect(x, top, cardW, 4, "F");
                setInk(PDF_MUTED, "bold", 8);
                doc.text(card[0], x + 8, top + 20);
                let valueColor = GREEN;
                if (card[0] === "Weighted score" && card[1] !== "-") valueColor = scoreRgb(summary.weighted);
                if (card[0] === "Course average" && card[1] !== "-") valueColor = scoreRgb(summary.average);
                setInk(card[1] === "-" ? PDF_MUTED : valueColor, "bold", 14);
                doc.text(pdfSafe(card[1]), x + 8, top + 36);
            });
            y += cardH * 2 + 8 + 12;

            section("Score bands");
            para("Course counts in the current filter. A large course moves the weighted score more than a small one.");
            const bandMax = Math.max.apply(null, BANDS.map(function (band) { return summary[band[1]] || 0; }).concat([1]));
            BANDS.forEach(function (band) {
                const count = summary[band[1]] || 0;
                hbar(band[0], count, bandMax, band[2], formatInt(count));
            });

            section("File types in the whole export");
            if (!latest) {
                para("This export has no monthly file-type scores.");
            } else {
                para("Yuja publishes these by month for the entire file, not by division. Latest month: " + (latest.date || "-") + ".");
                [
                    ["PDF", latest.pdf],
                    ["Word", latest.word],
                    ["Excel", latest.excel],
                    ["PowerPoint", latest.powerpoint],
                    ["Web", latest.web],
                    ["GIF", latest.gif]
                ].forEach(function (row) {
                    const value = row[1];
                    const amount = value == null ? 0 : Number(value);
                    hbar(row[0], amount, 100, value == null ? PDF_LINE : scoreRgb(value), value == null ? "-" : formatScore(value));
                });
                y += 4;
                drawTable(
                    ["Month", "Overall", "PDF", "Word", "Excel", "PowerPoint", "Web", "GIF"],
                    cumulative.map(function (row) {
                        return [row.date || "-", scorePdf(row.overall), scorePdf(row.pdf), scorePdf(row.word), scorePdf(row.excel), scorePdf(row.powerpoint), scorePdf(row.web), scorePdf(row.gif)];
                    }),
                    [122, 83, 83, 83, 83, 100, 83, 83]
                );
            }

            section("Divisions");
            para(formatInt(divisions.length) + " divisions in this filter.");
            drawTable(
                ["Division", "Courses", "Weighted", "Average", "Files", "Below 70", "Remediations", "Alt. formats", "Storage"],
                divisions.map(function (group) {
                    return [group.label, formatInt(group.courses), scorePdf(group.weighted), scorePdf(group.average), formatInt(group.files), formatInt(group.below70), formatInt(group.remediations), formatInt(group.altDownloads), formatBytes(group.bytes)];
                }),
                [150, 62, 70, 68, 62, 64, 86, 78, 80]
            );

            section("Disciplines");
            para(formatInt(disciplines.length) + " disciplines in this filter.");
            drawTable(
                ["Division", "Discipline", "Prefix", "Courses", "Weighted", "Average", "Files", "Below 70", "Remediations", "Alt. formats"],
                disciplines.map(function (group) {
                    return [group.division, group.discipline, group.prefix || "-", formatInt(group.courses), scorePdf(group.weighted), scorePdf(group.average), formatInt(group.files), formatInt(group.below70), formatInt(group.remediations), formatInt(group.altDownloads)];
                }),
                [110, 150, 46, 52, 62, 58, 50, 54, 72, 66]
            );

            section("Lowest course scores");
            para(ranked.length
                ? "Showing " + formatInt(lowest.length) + " of " + formatInt(ranked.length) + " scored courses, lowest first. The full course list is still available from Download this view."
                : "No scored courses are in this filter.");
            drawTable(
                ["Course", "Term", "Division", "Discipline", "Files", "Score", "Remediations", "Alt. formats"],
                lowest.map(function (row) {
                    return [row.name, row.term, row.division, row.discipline, formatInt(row.files), scorePdf(row.score), formatInt(row.remediations), formatInt(row.altDownloads)];
                }),
                [180, 72, 100, 110, 50, 50, 80, 78]
            );

            const pageCount = doc.getNumberOfPages();
            for (let page = 1; page <= pageCount; page++) {
                doc.setPage(page);
                doc.setFillColor(PDF_SURFACE[0], PDF_SURFACE[1], PDF_SURFACE[2]);
                doc.rect(0, pageH - 28, pageW, 28, "F");
                setInk(PDF_TEXT, "normal", 8);
                doc.text("Yuja Panorama accessibility scores. Weighted by files processed.", margin, pageH - 16);
                doc.text("Page " + page + " of " + pageCount, pageW - margin, pageH - 16, { align: "right" });
            }

            const stamp = new Date();
            const filename = "Yuja_Accessibility_" +
                stamp.getFullYear() + "-" +
                String(stamp.getMonth() + 1).padStart(2, "0") + "-" +
                String(stamp.getDate()).padStart(2, "0") + ".pdf";
            doc.save(filename);
            setStatus("Downloaded the branded PDF for " + formatInt(filtered.length) + " courses.");
        } catch (err) {
            setStatus("The branded PDF could not be built. Refresh the page and try again.");
        } finally {
            if (button) button.disabled = false;
        }
    }

    function exportView() {
        if (!state.report) {
            setStatus("Load a Panorama LMS export before downloading this view.");
            return;
        }
        const f = filters();
        const filtered = state.rows.filter(function (row) { return passesAll(row, f); });
        let csv = "";
        let filename = "yuja-accessibility-courses.csv";
        if (state.tab === "divisions") {
            filename = "yuja-accessibility-divisions.csv";
            const groups = sortRows(rollup(filtered, function (row) { return row.division; }).map(function (group) {
                group.label = group.key;
                return group;
            }), state.sort.divisions);
            csv = toCsv(["Division", "Courses", "Weighted score", "Course average", "Files", "Below 70", "Remediations", "Alt formats", "Storage bytes"], groups.map(function (g) {
                return [g.label, g.courses, round4(g.weighted), round4(g.average), g.files, g.below70, g.remediations, g.altDownloads, g.bytes];
            }));
        } else if (state.tab === "disciplines") {
            filename = "yuja-accessibility-disciplines.csv";
            const groups = sortRows(rollup(filtered, function (row) {
                return row.division + "\t" + row.discipline + "\t" + row.prefix;
            }).map(function (group) {
                const parts = group.key.split("\t");
                group.division = parts[0];
                group.discipline = parts[1];
                group.prefix = parts[2];
                return group;
            }), state.sort.disciplines);
            csv = toCsv(["Division", "Discipline", "Prefix", "Courses", "Weighted score", "Course average", "Files", "Below 70", "Remediations", "Alt formats"], groups.map(function (g) {
                return [g.division, g.discipline, g.prefix, g.courses, round4(g.weighted), round4(g.average), g.files, g.below70, g.remediations, g.altDownloads];
            }));
        } else {
            const sorted = sortRows(filtered, state.sort.courses);
            csv = toCsv(["Course", "Course ID", "Offering code", "Term", "Division", "Discipline", "Prefix", "Files", "Score", "Remediations", "Alt formats", "Storage bytes", "Instructors", "Course URL"], sorted.map(function (row) {
                return [row.name, row.id, row.code, row.term, row.division, row.discipline, row.prefix, row.files, row.score, row.remediations, row.altDownloads, row.bytes, row.instructors, "https://your-brightspace.example.edu/d2l/home/" + row.id];
            }));
        }
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    async function onFile(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = "";
        if (!file) return;
        setStatus("Reading " + file.name + "…");
        try {
            const report = await readExport(file);
            if (!report.courses || !report.courses.length) throw new Error("No course rows found");
            adoptReport(report);
        } catch (err) {
            setStatus(file.name + " could not be read. Use the Yuja JSON or the Excel workbook with a Course Accessibility sheet.");
        }
    }

    async function readExport(file) {
        const name = file.name.toLowerCase();
        if (name.endsWith(".xlsx")) {
            const buffer = await file.arrayBuffer();
            if (typeof XLSX === "undefined") throw new Error("Excel reader missing");
            const book = XLSX.read(buffer, { type: "array" });
            const courseSheet = book.Sheets["Course Accessibility"] || book.Sheets[book.SheetNames[0]];
            const courseRows = XLSX.utils.sheet_to_json(courseSheet, { defval: "" });
            const filters = sheetRecords(book, "Filters");
            const overallRows = sheetRecords(book, "Overall Totals");
            const cumulativeRows = sheetRecords(book, "Cumulative Score");
            return {
                source: file.name,
                window: filterWindow(filters),
                filters: Object.fromEntries(filters.map(function (row) { return [row.Filter, row.Value]; })),
                overall: overallFromRows(overallRows),
                cumulative: cumulativeRows.map(normalizeCumulative),
                courses: courseRows.map(normalizeCourse).filter(Boolean)
            };
        }
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.columns && Array.isArray(data.courses) && Array.isArray(data.courses[0])) {
            return {
                source: file.name,
                window: data.window || file.name,
                filters: data.filters || {},
                overall: data.overall || {},
                cumulative: data.cumulative || [],
                courses: data.courses.map(function (row) { return expandCompact(data.columns, row); })
            };
        }
        const list = data["Course Accessibility"] || data.courses || [];
        return {
            source: file.name,
            window: data.window || filterWindow(data.Filters || []),
            filters: Array.isArray(data.Filters) ? Object.fromEntries(data.Filters.map(function (row) { return [row.Filter, row.Value]; })) : (data.filters || {}),
            overall: overallFromReport(data),
            cumulative: (data["Cumulative Score"] || data.cumulative || []).map(normalizeCumulative),
            courses: list.map(normalizeCourse).filter(Boolean)
        };
    }

    function sheetRecords(book, sheetName) {
        if (!book.Sheets[sheetName]) return [];
        return XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: "" });
    }

    function filterWindow(filters) {
        const map = {};
        (filters || []).forEach(function (row) {
            if (row && row.Filter) map[row.Filter] = row.Value;
        });
        if (map["Start Month"] && map["Start Year"] && map["End Month"] && map["End Year"]) {
            return monthName(map["Start Month"]) + " " + map["Start Year"] + " through " + monthName(map["End Month"]) + " " + map["End Year"];
        }
        return "the uploaded export";
    }

    function overallFromReport(report) {
        if (report && Array.isArray(report["Overall Totals"]) && report["Overall Totals"].length) {
            return overallFromRows(report["Overall Totals"]);
        }
        if (report && report.overall && typeof report.overall === "object" && !Array.isArray(report.overall)) {
            return overallFromRows([report.overall]);
        }
        return overallFromRows([]);
    }

    function overallFromRows(rows) {
        const row = rows && rows[0] ? rows[0] : {};
        return {
            score: numberOrNull(row["Overall Accessibility Score"] != null ? row["Overall Accessibility Score"] : row.score),
            files: numberOrNull(row["Total Files Processed"] != null ? row["Total Files Processed"] : row.files),
            remediations: numberOrNull(row["Total Remediations"] != null ? row["Total Remediations"] : row.remediations),
            altDownloads: numberOrNull(row["Cumulative Alternative Formats Downloaded"] != null ? row["Cumulative Alternative Formats Downloaded"] : row.altDownloads)
        };
    }

    function normalizeCumulative(row) {
        if (row.date) return row;
        return {
            date: row.Date,
            overall: numberOrNull(row.Overall),
            word: numberOrNull(row.Word),
            powerpoint: numberOrNull(row.PowerPoint),
            web: numberOrNull(row.Web),
            excel: numberOrNull(row.Excel),
            gif: numberOrNull(row.GIF),
            pdf: numberOrNull(row.PDF)
        };
    }

    function normalizeCourse(row) {
        if (!row) return null;
        if (row.id && row.name && row.term) return row;
        const id = row["Course ID"] || row.id;
        if (!id) return null;
        return {
            id: String(id),
            name: row["Course Name"] || "",
            term: row["Term Name"] || "",
            orgId: String(row["D2L Organization Unit ID"] || ""),
            prefix: String(row["D2L Org Unit Code"] || "").trim(),
            code: row["D2L Course Offering Code"] || "",
            files: Math.round(numberOrNull(row["Total Files Processed"]) || 0),
            bytes: Math.round(numberOrNull(row["Storage Size"]) || 0),
            score: numberOrNull(row["Overall Accessibility Score"]),
            remediations: Math.round(numberOrNull(row["Total Remediations"]) || 0),
            altDownloads: Math.round(numberOrNull(row["Alternative Format Downloads"]) || 0),
            instructors: instructorCount(row.Instructors)
        };
    }

    function materialize(report) {
        if (report && report.columns && Array.isArray(report.courses) && Array.isArray(report.courses[0])) {
            return Object.assign({}, report, {
                courses: report.courses.map(function (row) { return expandCompact(report.columns, row); })
            });
        }
        if (report && Array.isArray(report["Course Accessibility"])) {
            return {
                source: report.source || "Yuja Panorama LMS report",
                window: report.window || filterWindow(report.Filters || []),
                filters: Array.isArray(report.Filters) ? Object.fromEntries(report.Filters.map(function (row) { return [row.Filter, row.Value]; })) : (report.filters || {}),
                overall: overallFromReport(report),
                cumulative: (report["Cumulative Score"] || []).map(normalizeCumulative),
                courses: report["Course Accessibility"].map(normalizeCourse).filter(Boolean)
            };
        }
        return report;
    }

    function expandCompact(columns, values) {
        const course = {};
        columns.forEach(function (key, index) {
            course[key] = values[index];
        });
        COLUMNS.forEach(function (key) {
            if (course[key] == null) course[key] = key === "name" || key === "term" || key === "prefix" || key === "code" || key === "orgId" || key === "id" ? "" : 0;
        });
        return course;
    }

    function instructorCount(raw) {
        const text = raw == null ? "" : String(raw).trim();
        if (!text || text === "-") return 0;
        return text.split(",").map(function (part) { return part.trim(); }).filter(function (part) { return /^\d+$/.test(part); }).length;
    }

    function parsePrograms(text) {
        const rows = parseCsv(text);
        const header = rows.shift() || [];
        const divIdx = header.indexOf("Division");
        const discIdx = header.indexOf("Subject/Discipline");
        const prefixIdx = header.indexOf("Prefix");
        const map = new Map();
        rows.forEach(function (row) {
            const prefix = String(row[prefixIdx] || "").trim().toUpperCase();
            const division = String(row[divIdx] || "").trim();
            const discipline = String(row[discIdx] || "").trim();
            if (!prefix || !division || !discipline) return;
            const existing = map.get(prefix);
            if (!existing) {
                map.set(prefix, { division: division, disciplines: [discipline] });
            } else if (existing.disciplines.indexOf(discipline) === -1) {
                existing.disciplines.push(discipline);
            }
        });
        return map;
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let cell = "";
        let inQuotes = false;
        const src = String(text).replace(/^\uFEFF/, "");
        for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (src[i + 1] === '"') {
                        cell += '"';
                        i += 1;
                    } else {
                        inQuotes = false;
                    }
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
                rows.push(row);
                row = [];
                cell = "";
            } else if (ch !== "\r") {
                cell += ch;
            }
        }
        if (cell.length || row.length) {
            row.push(cell);
            rows.push(row);
        }
        return rows.filter(function (item) { return item.some(function (value) { return String(value).trim() !== ""; }); });
    }

    function rollup(rows, keyFn) {
        const groups = new Map();
        rows.forEach(function (row) {
            const key = keyFn(row);
            let group = groups.get(key);
            if (!group) {
                group = { key: key, courses: 0, files: 0, scoreFiles: 0, scoreSum: 0, scored: 0, below70: 0, remediations: 0, altDownloads: 0, bytes: 0 };
                groups.set(key, group);
            }
            const files = Number(row.files) || 0;
            const hasScore = row.score != null && row.score !== "" && !Number.isNaN(Number(row.score));
            const score = hasScore ? Number(row.score) : null;
            group.courses += 1;
            group.files += files;
            if (hasScore) {
                group.scoreFiles += score * files;
                group.scoreSum += score;
                group.scored += 1;
                if (score < 70) group.below70 += 1;
            }
            group.remediations += Number(row.remediations) || 0;
            group.altDownloads += Number(row.altDownloads) || 0;
            group.bytes += Number(row.bytes) || 0;
        });
        return Array.from(groups.values()).map(function (group) {
            group.weighted = group.files ? group.scoreFiles / group.files : 0;
            group.average = group.scored ? group.scoreSum / group.scored : 0;
            return group;
        });
    }

    function summarize(rows) {
        const summary = rollup(rows, function () { return "all"; })[0] || {
            courses: 0, files: 0, weighted: 0, average: 0, below70: 0, remediations: 0, altDownloads: 0, bytes: 0
        };
        summary.bandLow = rows.filter(function (row) { return row.score < 50; }).length;
        summary.bandMid = rows.filter(function (row) { return row.score >= 50 && row.score < 70; }).length;
        summary.bandOk = rows.filter(function (row) { return row.score >= 70 && row.score < 85; }).length;
        summary.bandHigh = rows.filter(function (row) { return row.score >= 85; }).length;
        return summary;
    }

    function sortRows(rows, sort) {
        const dir = sort.dir === "asc" ? 1 : -1;
        return rows.slice().sort(function (a, b) {
            const av = a[sort.key];
            const bv = b[sort.key];
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
            return String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv), undefined, { numeric: true }) * dir;
        });
    }

    function showPanel(tab) {
        ["summary", "divisions", "disciplines", "courses"].forEach(function (name) {
            const panel = document.getElementById("panel-" + name);
            panel.hidden = name !== tab;
            if (name !== tab) panel.innerHTML = "";
        });
    }

    function fillSelect(select, placeholder, values, keep) {
        const current = keep;
        select.innerHTML = "";
        const first = document.createElement("option");
        first.value = "";
        first.textContent = placeholder;
        select.appendChild(first);
        values.forEach(function (value) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
        if (current && values.indexOf(current) !== -1) select.value = current;
    }

    function uniqueSorted(values) {
        return Array.from(new Set(values.filter(Boolean))).sort(function (a, b) {
            return a.localeCompare(b);
        });
    }

    function fullYear(value) {
        const year = Number(value);
        if (year >= 1000) return year;
        return 2000 + year;
    }

    function parseTerm(name) {
        const text = String(name || "").trim().toUpperCase();
        let match = text.match(/(WINTER|SPRING|SUMMER|FALL)\s+(\d{4})/);
        if (match) return { year: Number(match[2]), season: SEASON[match[1]] };
        match = text.match(/(\d{2,4})\s*\/\s*(WI|WINTER|SP|SPRING|SU|SUMMER|FA|FALL)/);
        if (match) return { year: fullYear(match[1]), season: SHORT_SEASON[match[2]] };
        match = text.match(/(WI|WINTER|SP|SPRING|SU|SUMMER|FA|FALL)\s*\/\s*(\d{2,4})/);
        if (match) return { year: fullYear(match[2]), season: SHORT_SEASON[match[1]] };
        match = text.match(/(?:^|[^A-Z0-9])(\d{2})(WI|SP|SU|FA)(?:[^A-Z0-9]|$)/);
        if (match) return { year: fullYear(match[1]), season: SHORT_SEASON[match[2]] };
        return null;
    }

    function isForwardTerm(name) {
        const term = parseTerm(name);
        if (!term) return false;
        if (term.year !== FIRST_FORWARD.year) return term.year > FIRST_FORWARD.year;
        return term.season >= FIRST_FORWARD.season;
    }

    function termRank(name) {
        const term = parseTerm(name);
        if (!term) return [-1, 0];
        return [term.year, term.season];
    }

    function scoreBar(value) {
        if (value == null || Number.isNaN(Number(value))) return "—";
        const width = Math.max(0, Math.min(100, Number(value)));
        return '<span class="score-bar"><span class="' + fillClass(value) + '" style="width:' + width + '%"></span></span><span class="' + scoreClass(value) + '">' + formatScore(value) + "</span>";
    }

    function scoreCell(value) {
        if (value == null) return "—";
        return '<span class="' + scoreClass(value) + '">' + formatScore(value) + "</span>";
    }

    function plainScore(value) {
        return value == null ? "—" : formatScore(value);
    }

    function scoreClass(value) {
        const n = Number(value);
        if (n < 50) return "score-low";
        if (n < 70) return "score-mid";
        if (n < 85) return "score-ok";
        return "score-high";
    }

    function fillClass(value) {
        if (value == null) return "";
        const n = Number(value);
        if (n < 50) return "fill-low";
        if (n < 70) return "fill-mid";
        if (n < 85) return "fill-ok";
        return "fill-high";
    }

    function formatScore(value) {
        return Number(value).toFixed(1);
    }

    function formatInt(value) {
        return Math.round(Number(value) || 0).toLocaleString();
    }

    function formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
        if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
        return (n / 1024).toFixed(0) + " KB";
    }

    function round4(value) {
        return Math.round(Number(value) * 10000) / 10000;
    }

    function numberOrNull(value) {
        if (value == null || value === "" || value === "-") return null;
        const n = Number(String(value).replace(/,/g, ""));
        return Number.isFinite(n) ? n : null;
    }

    function monthName(value) {
        const names = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const n = Number(value);
        return names[n] || String(value);
    }

    function toCsv(headers, rows) {
        return [headers].concat(rows).map(function (row) {
            return row.map(function (value) {
                const text = value == null ? "" : String(value);
                if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
                return text;
            }).join(",");
        }).join("\n");
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function setNote(text) {
        document.getElementById("sourceNote").textContent = text;
    }

    function setStatus(text) {
        document.getElementById("statusLine").textContent = text;
    }
})();
