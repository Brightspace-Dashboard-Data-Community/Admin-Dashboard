/**
 * Watermark course evaluations.
 * One combined CSV in. Course prefix joins info/programs.csv for division and discipline.
 * An optional faculty list joins on email, then name, for full-time versus adjunct.
 */
(function () {
    const LIKERT_MAX = 22;
    const PAGE_SIZE = 40;
    const LOW_LINE = 4;

    const state = {
        programs: new Map(),
        courses: [],
        facultyByEmail: new Map(),
        facultyByName: new Map(),
        facultyLoaded: false,
        questionLabels: {},
        tab: "summary",
        page: 1,
        selected: "",
        sourceName: "",
        sort: {
            divisions: { key: "average", dir: "asc" },
            disciplines: { key: "average", dir: "asc" },
            courses: { key: "mean", dir: "asc" }
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
        setNote("Load watermark-evaluations.csv from the combiner. Means use questions 1–22. Clear “Mean at or below” to see every course. Add a faculty list with Email and Role when you want full-time and adjunct.");
    }

    function bind() {
        ["divisionFilter", "disciplineFilter", "roleFilter", "hideSandbox", "hideMergedCxld", "mappedOnly"].forEach(function (id) {
            document.getElementById(id).addEventListener("change", function () {
                if (id === "divisionFilter") document.getElementById("disciplineFilter").value = "";
                if (id === "divisionFilter" || id === "disciplineFilter" || id === "roleFilter") state.selected = "";
                state.page = 1;
                render();
            });
        });
        ["searchFilter", "maxMean", "minResponses"].forEach(function (id) {
            document.getElementById(id).addEventListener("input", function () {
                state.page = 1;
                render();
            });
        });
        document.getElementById("fileInput").addEventListener("change", onEvaluations);
        document.getElementById("facultyInput").addEventListener("change", onFaculty);
        document.getElementById("exportBtn").addEventListener("click", exportView);
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

    function onEvaluations(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function (result) {
                state.sourceName = file.name;
                state.courses = buildCourses(result.data || []);
                applyFaculty();
                state.selected = "";
                state.page = 1;
                const scored = state.courses.filter(function (course) { return course.mean != null; }).length;
                setNote(file.name + " · " + formatInt(state.courses.length) + " courses · " + formatInt(scored) + " with a score. The faculty list is separate and can be loaded after this file.");
                render();
            },
            error: function () {
                setStatus("That file could not be read as a CSV.");
            }
        });
    }

    function onFaculty(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function (result) {
                const parsed = parseFaculty(result.data || []);
                state.facultyByEmail = parsed.byEmail;
                state.facultyByName = parsed.byName;
                state.facultyLoaded = parsed.count > 0;
                applyFaculty();
                setStatus(state.facultyLoaded
                    ? "Faculty list loaded: " + formatInt(parsed.count) + " people from " + file.name + "."
                    : "That faculty file needs Email or Name, and Role.");
                render();
            }
        });
    }

    function buildCourses(rows) {
        const groups = new Map();
        const labels = {};
        rows.forEach(function (row) {
            const code = String(row.CourseCode || "").trim();
            if (!code) return;
            if (!groups.has(code)) groups.set(code, []);
            groups.get(code).push(row);
            Object.keys(row).forEach(function (key) {
                const number = questionNumber(key);
                if (number && !labels[number]) labels[number] = questionLabel(key);
            });
        });
        state.questionLabels = labels;
        return Array.from(groups.values()).map(courseFromRows);
    }

    function courseFromRows(rows) {
        const first = rows[0];
        const prefix = String(first.CoursePrefix || coursePrefix(first.CourseCode)).trim().toUpperCase();
        const questions = {};
        for (let n = 1; n <= LIKERT_MAX; n++) questions[n] = { sum: 0, count: 0 };
        const comments = { 23: [], 24: [], 25: [] };
        rows.forEach(function (row) {
            Object.keys(row).forEach(function (key) {
                const number = questionNumber(key);
                if (!number) return;
                const text = String(row[key] == null ? "" : row[key]).trim();
                if (!text) return;
                if (number <= LIKERT_MAX) {
                    const value = Number(text);
                    if (!isFinite(value)) return;
                    questions[number].sum += value;
                    questions[number].count += 1;
                } else if (comments[number]) {
                    comments[number].push(text);
                }
            });
        });
        const questionRows = [];
        let lowest = null;
        Object.keys(questions).forEach(function (key) {
            const number = Number(key);
            const item = questions[number];
            const mean = item.count ? item.sum / item.count : null;
            const record = {
                number: number,
                label: state.questionLabels[number] || ("Question " + number),
                mean: mean,
                count: item.count
            };
            questionRows.push(record);
            if (mean != null && (lowest == null || mean < lowest.mean)) lowest = record;
        });
        const satisfaction = questions[22].count ? questions[22].sum / questions[22].count : null;
        const answered = questionRows.filter(function (item) { return item.mean != null; });
        const courseMean = answered.length
            ? answered.reduce(function (total, item) { return total + item.mean; }, 0) / answered.length
            : null;
        const program = state.programs.get(prefix);
        let division = "Not in division list";
        let discipline = prefix || "No prefix";
        let mapped = false;
        if (program) {
            division = program.division;
            discipline = program.disciplines.join(" / ");
            mapped = true;
        }
        const title = String(first.CourseTitle || "");
        return {
            code: String(first.CourseCode || ""),
            name: courseName(title),
            title: title,
            prefix: prefix,
            uniqueId: String(first.UniqueID || "").trim(),
            instructor: String(first.InstructorName || first.InstructorFromTitle || "").trim(),
            email: String(first.InstructorEmail || "").trim(),
            division: division,
            discipline: discipline,
            mapped: mapped,
            enrollments: numberOrZero(first.Enrollments),
            respondents: numberOrZero(first.Respondents) || rows.length,
            responseRate: numberOrNull(first.ResponseRate),
            mean: courseMean,
            satisfaction: satisfaction,
            lowestLabel: lowest ? lowest.label : "",
            lowestMean: lowest ? lowest.mean : null,
            questions: questionRows,
            comments: comments,
            role: "Not listed"
        };
    }

    function applyFaculty() {
        state.courses.forEach(function (course) {
            course.role = lookupRole(course);
        });
    }

    function lookupRole(course) {
        if (!state.facultyLoaded) return "Not listed";
        const email = course.email.toLowerCase();
        if (email && state.facultyByEmail.has(email)) return state.facultyByEmail.get(email);
        const name = nameKey(course.instructor);
        if (name && state.facultyByName.has(name)) return state.facultyByName.get(name);
        return "Not listed";
    }

    function parseFaculty(rows) {
        const byEmail = new Map();
        const byName = new Map();
        let count = 0;
        if (!rows.length) return { byEmail: byEmail, byName: byName, count: 0 };
        const headers = Object.keys(rows[0]);
        const emailKey = findHeader(headers, ["email", "instructoremail", "facultyemail", "e-mail"]);
        const nameKeyHeader = findHeader(headers, ["name", "instructor", "instructorname", "faculty", "facultyname"]);
        const roleKey = findHeader(headers, ["role", "status", "appointment", "facultytype", "type"]);
        rows.forEach(function (row) {
            const role = normalizeRole(roleKey ? row[roleKey] : "");
            if (!role) return;
            const email = emailKey ? String(row[emailKey] || "").trim().toLowerCase() : "";
            const person = nameKeyHeader ? nameKey(row[nameKeyHeader]) : "";
            if (!email && !person) return;
            if (email) byEmail.set(email, role);
            if (person) byName.set(person, role);
            count += 1;
        });
        return { byEmail: byEmail, byName: byName, count: count };
    }

    function filters() {
        const maxRaw = document.getElementById("maxMean").value.trim();
        const minRaw = document.getElementById("minResponses").value.trim();
        return {
            division: document.getElementById("divisionFilter").value,
            discipline: document.getElementById("disciplineFilter").value,
            role: document.getElementById("roleFilter").value,
            search: document.getElementById("searchFilter").value.trim().toLowerCase(),
            maxMean: maxRaw === "" ? null : Number(maxRaw),
            minResponses: minRaw === "" ? 0 : Number(minRaw),
            hideSandbox: document.getElementById("hideSandbox").checked,
            hideMergedCxld: document.getElementById("hideMergedCxld").checked,
            mappedOnly: document.getElementById("mappedOnly").checked
        };
    }

    function passesBase(course, f) {
        if (f.hideSandbox && (course.prefix === "SANDBOX" || /sandbox/i.test(course.code))) return false;
        if (f.hideMergedCxld && isMergedOrCancelled(course)) return false;
        if (f.mappedOnly && !course.mapped) return false;
        if (course.respondents < (f.minResponses || 0)) return false;
        if (f.search) {
            const hay = (course.name + " " + course.code + " " + course.instructor + " " + course.email + " " + course.prefix).toLowerCase();
            if (hay.indexOf(f.search) === -1) return false;
        }
        return true;
    }

    function passesSlice(course, f) {
        if (!passesBase(course, f)) return false;
        if (f.division && course.division !== f.division) return false;
        if (f.discipline && course.discipline !== f.discipline) return false;
        if (f.role && course.role !== f.role) return false;
        return true;
    }

    function passesAll(course, f) {
        if (!passesSlice(course, f)) return false;
        if (f.maxMean != null) {
            if (course.mean == null || course.mean > f.maxMean) return false;
        }
        return true;
    }

    function render() {
        if (!state.courses.length) return;
        const f = filters();
        refreshOptions(f);
        const slice = state.courses.filter(function (course) { return passesSlice(course, f); });
        const filtered = slice.filter(function (course) { return passesAll(course, f); });
        if (state.selected && !filtered.some(function (course) { return course.code === state.selected; })) {
            state.selected = "";
        }
        renderKpis(slice, filtered, f);
        const scored = slice.filter(function (course) { return course.mean != null; });
        const cutoffLabel = f.maxMean == null ? "any mean" : "mean at or below " + formatMean(f.maxMean);
        setStatus(formatInt(filtered.length) + " " + plural(filtered.length, "course") + " with " + cutoffLabel + " · " + formatInt(scored.length) + " scored in this division, discipline, and role.");
        showPanel(state.tab);
        if (state.tab === "summary") renderSummary(slice, filtered, f);
        if (state.tab === "divisions") renderGroup("panel-divisions", "divisions", filtered);
        if (state.tab === "disciplines") renderGroup("panel-disciplines", "disciplines", filtered);
        if (state.tab === "courses") renderCourses(filtered);
    }

    function renderKpis(slice, filtered, f) {
        const means = filtered.map(function (course) { return course.mean; }).filter(function (mean) { return mean != null; });
        const average = means.length ? means.reduce(function (sum, mean) { return sum + mean; }, 0) / means.length : null;
        const lowest = means.length ? Math.min.apply(null, means) : null;
        const responses = filtered.reduce(function (sum, course) { return sum + course.respondents; }, 0);
        const line = f.maxMean == null ? LOW_LINE : f.maxMean;
        const below = slice.filter(function (course) { return course.mean != null && course.mean <= line; }).length;
        const cards = [
            ["In this view", formatInt(filtered.length)],
            ["Mean", average == null ? "—" : formatMean(average)],
            ["Lowest", lowest == null ? "—" : formatMean(lowest)],
            ["Responses", formatInt(responses)],
            ["At or below " + formatMean(line), formatInt(below)],
            ["Faculty list", state.facultyLoaded ? "Loaded" : "Not loaded"]
        ];
        document.getElementById("kpis").innerHTML = cards.map(function (card) {
            return '<div class="kpi"><div class="kpi-label">' + escapeHtml(card[0]) + '</div><div class="kpi-value">' + escapeHtml(String(card[1])) + "</div></div>";
        }).join("");
    }

    function renderSummary(slice, filtered, f) {
        const panel = document.getElementById("panel-summary");
        const bands = [
            ["Under 3.50", countBand(slice, null, 3.5), "fill-low"],
            ["3.50–3.99", countBand(slice, 3.5, 4), "fill-mid"],
            ["4.00–4.49", countBand(slice, 4, 4.5), "fill-ok"],
            ["4.50–5.00", countBand(slice, 4.5, 5.01), "fill-high"]
        ];
        const bandMax = Math.max.apply(null, bands.map(function (band) { return band[1]; }).concat([1]));
        const bandHtml = bands.map(function (band) {
            const width = Math.round((band[1] / bandMax) * 100);
            return '<div class="band"><span>' + band[0] + '</span><div class="band-track"><span class="' + band[2] + '" style="width:' + width + '%"></span></div><strong>' + formatInt(band[1]) + "</strong></div>";
        }).join("");
        const lowest = slice.filter(function (course) { return course.mean != null; })
            .sort(function (a, b) { return a.mean - b.mean; })
            .slice(0, 8);
        const lowestHtml = lowest.length
            ? '<div class="table-wrap"><table class="data"><thead><tr><th>Course</th><th>Instructor</th><th>Mean</th><th>Responses</th></tr></thead><tbody>' +
                lowest.map(function (course) {
                    return "<tr><td class=\"wrap\"><button type=\"button\" class=\"linkish\" data-open-course=\"" + escapeHtml(course.code) + "\">" + escapeHtml(course.name) + "</button><div class=\"status-line\">" + escapeHtml(course.discipline) + "</div></td><td>" + escapeHtml(course.instructor || "—") + "</td><td>" + scoreText(course.mean) + "</td><td>" + formatInt(course.respondents) + "/" + formatInt(course.enrollments) + "</td></tr>";
                }).join("") + "</tbody></table></div>"
            : "<p>No scored courses in this slice.</p>";
        const divisions = sortRows(rollup(filtered, function (course) { return course.division; }).map(function (group) {
            group.label = group.key;
            return group;
        }), state.sort.divisions);
        panel.innerHTML =
            '<div class="split">' +
                '<div class="card"><h2 style="font-size:16px;margin-bottom:8px;">Score bands</h2><p class="status-line" style="margin-top:0;">Course counts before the mean cutoff, inside the division, discipline, and role filters. 1 is low and 5 is high.</p>' + bandHtml + "</div>" +
                '<div class="card"><h2 style="font-size:16px;margin-bottom:8px;">Lowest courses in this slice</h2><p class="status-line" style="margin-top:0;">These ignore the mean cutoff so a strict cutoff does not hide the bottom of the list.</p>' + lowestHtml + "</div>" +
            "</div>" +
            '<div class="card"><h2 style="font-size:16px;margin-bottom:8px;">Divisions at or below the cutoff</h2>' +
                groupTableHtml(divisions, divisionColumns(), "divisions") +
            "</div>";
        panel.querySelectorAll("[data-open-course]").forEach(function (btn) {
            btn.addEventListener("click", function () { openCourse(btn.getAttribute("data-open-course")); });
        });
        panel.querySelectorAll("[data-open-division]").forEach(function (btn) {
            btn.addEventListener("click", function () { openDivision(btn.getAttribute("data-open-division")); });
        });
        wireSort(panel, "divisions");
    }

    function renderGroup(panelId, sortName, filtered) {
        const groups = rollup(filtered, function (course) {
            if (sortName === "divisions") return course.division;
            return course.division + "\t" + course.discipline + "\t" + course.prefix;
        }).map(function (group) {
            if (sortName === "divisions") group.label = group.key;
            else {
                const parts = group.key.split("\t");
                group.division = parts[0];
                group.discipline = parts[1];
                group.prefix = parts[2];
                group.label = group.discipline;
            }
            return group;
        });
        const columns = sortName === "divisions" ? divisionColumns() : disciplineColumns();
        const panel = document.getElementById(panelId);
        panel.innerHTML = '<div class="card">' + groupTableHtml(sortRows(groups, state.sort[sortName]), columns, sortName) + "</div>";
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

    function renderCourses(filtered) {
        const columns = courseColumns();
        const sorted = sortRows(filtered, state.sort.courses);
        const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
        if (state.page > pages) state.page = pages;
        const start = (state.page - 1) * PAGE_SIZE;
        const slice = sorted.slice(start, start + PAGE_SIZE);
        const panel = document.getElementById("panel-courses");
        const selected = filtered.find(function (course) { return course.code === state.selected; });
        panel.innerHTML =
            (selected ? detailHtml(selected) : "") +
            '<div class="card"><div class="row-actions"><div class="pager">' +
                '<button type="button" class="file-btn" id="prevPage">Previous</button>' +
                "<span>Page " + state.page + " of " + pages + "</span>" +
                '<button type="button" class="file-btn" id="nextPage">Next</button>' +
            "</div><span>" + formatInt(sorted.length) + " courses</span></div>" +
            '<div class="table-wrap"><table class="data"><thead><tr>' +
            columns.map(function (col) { return "<th>" + sortButton("courses", col) + "</th>"; }).join("") +
            "</tr></thead><tbody>" +
            (slice.length ? slice.map(courseRow).join("") : '<tr><td colspan="' + columns.length + '">No courses match these filters.</td></tr>') +
            "</tbody></table></div></div>";
        wireSort(panel, "courses");
        panel.querySelectorAll("[data-open-course]").forEach(function (btn) {
            btn.addEventListener("click", function () { openCourse(btn.getAttribute("data-open-course")); });
        });
        const close = panel.querySelector("#closeDetail");
        if (close) close.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            state.selected = "";
            render();
        });
        document.getElementById("prevPage").addEventListener("click", function () {
            if (state.page > 1) { state.page -= 1; render(); }
        });
        document.getElementById("nextPage").addEventListener("click", function () {
            if (state.page < pages) { state.page += 1; render(); }
        });
    }

    function detailHtml(course) {
        const questions = course.questions.slice().sort(function (a, b) {
            if (a.mean == null) return 1;
            if (b.mean == null) return -1;
            return a.mean - b.mean;
        });
        const questionTable = '<div class="table-wrap"><table class="data"><thead><tr><th>Question</th><th>Mean</th><th>Answers</th></tr></thead><tbody>' +
            questions.map(function (item) {
                return "<tr><td class=\"wrap\">" + escapeHtml(item.label) + "</td><td>" + (item.mean == null ? "—" : scoreText(item.mean)) + "</td><td>" + formatInt(item.count) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        const commentBlocks = [23, 24, 25].map(function (number) {
            const texts = course.comments[number] || [];
            const label = state.questionLabels[number] || ("Question " + number);
            const body = texts.length
                ? texts.map(function (text) { return '<p class="comment">• ' + escapeHtml(text) + "</p>"; }).join("")
                : '<p class="status-line">No written comments.</p>';
            return "<h3 style=\"font-size:14px;margin:14px 0 6px;\">" + escapeHtml(label) + " · " + formatInt(texts.length) + "</h3>" + body;
        }).join("");
        const link = course.uniqueId
            ? ' · <a href="https://your-brightspace.example.edu/d2l/home/' + encodeURIComponent(course.uniqueId) + '" target="_blank" rel="noopener">Open in Brightspace</a>'
            : "";
        return '<div class="card"><div class="row-actions"><h2 style="font-size:18px;margin:0;">' + escapeHtml(course.name) + '</h2><button type="button" class="file-btn" id="closeDetail">Close</button></div>' +
            '<p class="status-line" style="margin-top:0;">' + escapeHtml(course.code) + " · " + escapeHtml(course.instructor || "No instructor") + " · " + escapeHtml(course.role) + " · " + escapeHtml(course.division) + " / " + escapeHtml(course.discipline) + link + "</p>" +
            "<p>Mean " + scoreText(course.mean) + " · Satisfaction " + (course.satisfaction == null ? "—" : scoreText(course.satisfaction)) + " · Responses " + formatInt(course.respondents) + "/" + formatInt(course.enrollments) + (course.responseRate == null ? "" : " (" + formatMean(course.responseRate) + "%)") + "</p>" +
            questionTable + commentBlocks + "</div>";
    }

    function courseRow(course) {
        const brightspace = course.uniqueId
            ? ' · <a href="https://your-brightspace.example.edu/d2l/home/' + encodeURIComponent(course.uniqueId) + '" target="_blank" rel="noopener">Brightspace</a>'
            : "";
        return '<tr class="' + (course.code === state.selected ? "selected" : "") + '"><td class="wrap"><button type="button" class="linkish" data-open-course="' + escapeHtml(course.code) + '">' + escapeHtml(course.name) + '</button><div class="status-line">' + escapeHtml(course.code) + brightspace + "</div></td><td>" +
            escapeHtml(course.instructor || "—") + "</td><td>" + escapeHtml(course.role) + "</td><td>" + escapeHtml(course.division) + "</td><td>" + escapeHtml(course.discipline) + "</td><td>" +
            formatInt(course.respondents) + "/" + formatInt(course.enrollments) + "</td><td>" + scoreBar(course.mean) + "</td><td>" + (course.satisfaction == null ? "—" : scoreText(course.satisfaction)) + "</td><td class=\"wrap\">" + escapeHtml(shortLabel(course.lowestLabel)) + (course.lowestMean == null ? "" : " · " + formatMean(course.lowestMean)) + "</td></tr>";
    }

    function divisionColumns() {
        return [
            { key: "label", label: "Division", render: function (group) {
                return '<button type="button" class="linkish" data-open-division="' + escapeHtml(group.label) + '">' + escapeHtml(group.label) + "</button>";
            }},
            { key: "courses", label: "Courses", numeric: true },
            { key: "average", label: "Mean", numeric: true, render: function (group) { return scoreText(group.average); } },
            { key: "lowest", label: "Lowest", numeric: true, render: function (group) { return group.lowest == null ? "—" : formatMean(group.lowest); } },
            { key: "responses", label: "Responses", numeric: true }
        ];
    }

    function disciplineColumns() {
        return [
            { key: "division", label: "Division" },
            { key: "discipline", label: "Discipline", render: function (group) {
                return '<button type="button" class="linkish" data-open-discipline="' + escapeHtml(group.discipline) + '" data-open-division="' + escapeHtml(group.division) + '">' + escapeHtml(group.discipline) + "</button>";
            }},
            { key: "prefix", label: "Prefix" },
            { key: "courses", label: "Courses", numeric: true },
            { key: "average", label: "Mean", numeric: true, render: function (group) { return scoreText(group.average); } },
            { key: "lowest", label: "Lowest", numeric: true, render: function (group) { return group.lowest == null ? "—" : formatMean(group.lowest); } },
            { key: "responses", label: "Responses", numeric: true }
        ];
    }

    function courseColumns() {
        return [
            { key: "name", label: "Course" },
            { key: "instructor", label: "Instructor" },
            { key: "role", label: "Role" },
            { key: "division", label: "Division" },
            { key: "discipline", label: "Discipline" },
            { key: "respondents", label: "Responses", numeric: true },
            { key: "mean", label: "Mean", numeric: true },
            { key: "satisfaction", label: "Satisfaction", numeric: true },
            { key: "lowestMean", label: "Lowest question", numeric: true }
        ];
    }

    function rollup(courses, keyFn) {
        const groups = new Map();
        courses.forEach(function (course) {
            const key = keyFn(course);
            if (!groups.has(key)) groups.set(key, { key: key, courses: 0, meanSum: 0, scored: 0, lowest: null, responses: 0 });
            const group = groups.get(key);
            group.courses += 1;
            group.responses += course.respondents;
            if (course.mean != null) {
                group.meanSum += course.mean;
                group.scored += 1;
                if (group.lowest == null || course.mean < group.lowest) group.lowest = course.mean;
            }
        });
        return Array.from(groups.values()).map(function (group) {
            group.average = group.scored ? group.meanSum / group.scored : null;
            return group;
        });
    }

    function refreshOptions(f) {
        const divisionSelect = document.getElementById("divisionFilter");
        const disciplineSelect = document.getElementById("disciplineFilter");
        const divisionValue = divisionSelect.value;
        const disciplineValue = disciplineSelect.value;
        const base = state.courses.filter(function (course) { return passesBase(course, f); });
        fillSelect(divisionSelect, "All divisions", uniqueSorted(base.map(function (course) { return course.division; })), divisionValue);
        const forDisciplines = base.filter(function (course) { return !divisionSelect.value || course.division === divisionSelect.value; });
        fillSelect(disciplineSelect, "All disciplines", uniqueSorted(forDisciplines.map(function (course) { return course.discipline; })), disciplineValue);
    }

    function exportView() {
        const f = filters();
        const rows = state.courses.filter(function (course) { return passesAll(course, f); });
        if (!rows.length) return;
        const header = ["Course", "Code", "Instructor", "Email", "Role", "Division", "Discipline", "Prefix", "Enrollments", "Respondents", "Response rate", "Mean", "Satisfaction", "Lowest question", "Lowest mean", "Org unit"];
        const body = rows.map(function (course) {
            return [course.name, course.code, course.instructor, course.email, course.role, course.division, course.discipline, course.prefix, course.enrollments, course.respondents, course.responseRate == null ? "" : course.responseRate, course.mean == null ? "" : round2(course.mean), course.satisfaction == null ? "" : round2(course.satisfaction), course.lowestLabel, course.lowestMean == null ? "" : round2(course.lowestMean), course.uniqueId];
        });
        const csv = Papa.unparse({ fields: header, data: body });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "watermark-low-scores.csv";
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function openDivision(division) {
        state.selected = "";
        document.getElementById("divisionFilter").value = division;
        document.getElementById("disciplineFilter").value = "";
        switchTab("disciplines");
    }

    function openDiscipline(division, discipline) {
        state.selected = "";
        document.getElementById("divisionFilter").value = division;
        document.getElementById("disciplineFilter").value = discipline;
        document.getElementById("searchFilter").value = "";
        switchTab("courses");
    }

    function openCourse(code) {
        state.selected = code;
        switchTab("courses");
    }

    function switchTab(tab) {
        state.tab = tab;
        state.page = 1;
        document.querySelectorAll(".tab-btn").forEach(function (el) {
            el.classList.toggle("active", el.dataset.tab === tab);
        });
        render();
    }

    function showPanel(tab) {
        ["summary", "divisions", "disciplines", "courses"].forEach(function (name) {
            document.getElementById("panel-" + name).hidden = name !== tab;
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
                    current.dir = key === "name" || key === "label" || key === "division" || key === "discipline" || key === "prefix" || key === "instructor" || key === "role" ? "asc" : "desc";
                }
                state.page = 1;
                render();
            });
        });
    }

    function sortRows(rows, sort) {
        const dir = sort.dir === "asc" ? 1 : -1;
        return rows.slice().sort(function (a, b) {
            const av = a[sort.key];
            const bv = b[sort.key];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
            return String(av).localeCompare(String(bv)) * dir;
        });
    }

    function countBand(courses, min, max) {
        return courses.filter(function (course) {
            if (course.mean == null) return false;
            if (min != null && course.mean < min) return false;
            return course.mean < max;
        }).length;
    }

    function parsePrograms(text) {
        const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data || [];
        const map = new Map();
        rows.forEach(function (row) {
            const prefix = String(row.Prefix || "").trim().toUpperCase();
            const division = String(row.Division || "").trim();
            const discipline = String(row["Subject/Discipline"] || "").trim();
            if (!prefix || !division || !discipline) return;
            const existing = map.get(prefix);
            if (!existing) map.set(prefix, { division: division, disciplines: [discipline] });
            else if (existing.disciplines.indexOf(discipline) === -1) existing.disciplines.push(discipline);
        });
        return map;
    }

    function fillSelect(select, placeholder, values, current) {
        select.innerHTML = '<option value="">' + escapeHtml(placeholder) + "</option>";
        values.forEach(function (value) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
        if (current && values.indexOf(current) !== -1) select.value = current;
    }

    function findHeader(headers, names) {
        const wanted = names.map(function (name) { return name.toLowerCase().replace(/[^a-z]/g, ""); });
        for (let i = 0; i < headers.length; i++) {
            const key = String(headers[i] || "").toLowerCase().replace(/[^a-z]/g, "");
            if (wanted.indexOf(key) !== -1) return headers[i];
        }
        return "";
    }

    function normalizeRole(value) {
        const text = String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
        if (!text) return "";
        if (text.indexOf("adjunct") !== -1 || text === "pt" || text === "parttime") return "Adjunct";
        if (text.indexOf("full") !== -1 || text === "ft" || text === "regular") return "Full-time";
        return "";
    }

    function nameKey(value) {
        return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
    }

    function questionNumber(key) {
        const match = /^Q(\d+)/i.exec(String(key || "").trim());
        return match ? Number(match[1]) : 0;
    }

    function questionLabel(key) {
        const text = String(key || "");
        const parts = text.split("|");
        return (parts.length > 1 ? parts.slice(1).join("|") : text).trim();
    }

    function shortLabel(label) {
        return String(label || "").replace(/^\d+\.\s*/, "");
    }

    function courseName(title) {
        const parts = String(title || "").split(" : ");
        return (parts.length > 1 ? parts.slice(0, -1).join(" : ") : title).trim();
    }

    function coursePrefix(code) {
        return String(code || "").split("-")[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    }

    function isMergedOrCancelled(course) {
        const text = (course.name + " " + course.code).toUpperCase();
        return /(^|[^A-Z0-9])MERGED([^A-Z0-9]|$)/.test(text) || /(^|[^A-Z0-9])CXLD([^A-Z0-9]|$)/.test(text);
    }

    function scoreBar(mean) {
        if (mean == null) return "—";
        const width = Math.max(0, Math.min(100, (mean / 5) * 100));
        const band = scoreBand(mean);
        return '<span class="score-bar"><span class="fill-' + band + '" style="width:' + width + '%"></span></span><span class="score-' + band + '">' + formatMean(mean) + "</span>";
    }

    function scoreText(mean) {
        if (mean == null) return "—";
        return '<span class="score-' + scoreBand(mean) + '">' + formatMean(mean) + "</span>";
    }

    function scoreBand(mean) {
        if (mean < 3.5) return "low";
        if (mean < 4) return "mid";
        if (mean < 4.5) return "ok";
        return "high";
    }

    function formatMean(value) {
        return round2(value).toFixed(2);
    }

    function round2(value) {
        return Math.round(Number(value) * 100) / 100;
    }

    function formatInt(value) {
        return Math.round(Number(value) || 0).toLocaleString("en-US");
    }

    function plural(count, word) {
        return count === 1 ? word : word + "s";
    }

    function numberOrZero(value) {
        const number = Number(value);
        return isFinite(number) ? number : 0;
    }

    function numberOrNull(value) {
        if (value == null || String(value).trim() === "") return null;
        const number = Number(value);
        return isFinite(number) ? number : null;
    }

    function uniqueSorted(values) {
        return Array.from(new Set(values.filter(Boolean))).sort(function (a, b) { return String(a).localeCompare(String(b)); });
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
