/**
 * Report windows for the admin guide.
 * Dates follow the academic calendar (catalog catoid 16) and the approved
 * college calendar for 7-week sessions. Add the next year as a new term
 * when the college publishes it. Ranges are approximate run windows.
 */
(function () {
    var LIST_LABEL = {
        "#before": "Open the before-the-term list",
        "#week-one": "Open the first-week list",
        "#mid": "Open the mid-semester list",
        "#end": "Open the end-of-term list",
        "#periodic": "Open the between-terms list"
    };

    var TERMS = [
        {
            id: "fa26",
            name: "Fall 2026",
            classStart: "2026-08-29",
            gradesDue: "2026-12-22",
            facts: "Classes Aug 29–Dec 20. Grades due Dec 22 by 2pm. No classes Sep 5–8 and Nov 25–29. First 7-week ends Oct 20. Second 7-week begins Oct 28.",
            windows: [
                {
                    id: "before",
                    href: "#before",
                    start: "2026-08-10",
                    end: "2026-08-28",
                    title: "Before classes begin",
                    text: "Run the before-the-term list: course gap, dates, cancellations, merges, empty shells, homepage and profile audits, and new accounts. Fall Learning Days are Aug 24–26."
                },
                {
                    id: "week-one",
                    href: "#week-one",
                    start: "2026-08-29",
                    end: "2026-09-11",
                    title: "First week",
                    text: "Classes start Aug 29. No classes Sep 5–8, and classes resume Sep 9. Keep the daily enrollment scans going, and add course access, no instructor activity, and a second empty-course pass. Roster changes matter through the Pell date, Sep 15."
                },
                {
                    id: "mid",
                    href: "#mid",
                    start: "2026-10-13",
                    end: "2026-10-27",
                    title: "Mid-semester",
                    text: "About halfway through the 15 weeks. Run no instructor activity, course access, and the incomplete list for anyone still on role 107 from last term. Enrollment scans can drop to a few times a week."
                },
                {
                    id: "seven-grades",
                    href: "#end",
                    start: "2026-10-20",
                    end: "2026-10-27",
                    title: "First 7-week grades",
                    text: "Seven-week courses ended Oct 20 at 11pm. Grades for those courses are due Tuesday, Oct 27, by 2pm. Run grade submission and incompletes for the 7-week sections. Full-term courses stay in session."
                },
                {
                    id: "second",
                    href: "#week-one",
                    start: "2026-10-28",
                    end: "2026-11-06",
                    title: "Second 7-week opens",
                    text: "Second 7-week classes begin Oct 28. Repeat the before-the-term checks that still apply (merges, empty shells, cancellations) and the first-week list for late-start courses."
                },
                {
                    id: "end",
                    href: "#end",
                    start: "2026-12-14",
                    end: "2026-12-22",
                    title: "End of the semester",
                    text: "Classes end Dec 20 at 11pm. Grades are due Dec 22 by 2pm. Run grade submission, incompletes, completion, and the end-of-semester course report. Close the daily enrollment scans once rosters stop moving."
                },
                {
                    id: "between",
                    href: "#periodic",
                    start: "2026-12-23",
                    end: "2027-01-08",
                    title: "Between Fall and Winter",
                    text: "Retirement sequence and account cleanup. Winter before-the-term work overlaps this stretch when the shells are already out."
                }
            ]
        },
        {
            id: "wi27",
            name: "Winter 2027",
            classStart: "2027-01-09",
            gradesDue: "2027-05-04",
            facts: "Classes Jan 9–Apr 30. Grades due May 4 by 2pm. No classes Jan 18, Mar 1–6, and Mar 28. First 7-week ends Feb 26. Second 7-week begins Mar 13. Winter Learning Day is Feb 12.",
            windows: [
                {
                    id: "before",
                    href: "#before",
                    start: "2026-12-14",
                    end: "2027-01-08",
                    title: "Before classes begin",
                    text: "Winter is already on the semester list (27/WI). Run the before-the-term list during the last week of Fall and the days after Fall grades, through Jan 8."
                },
                {
                    id: "week-one",
                    href: "#week-one",
                    start: "2027-01-09",
                    end: "2027-01-22",
                    title: "First week",
                    text: "Classes start Jan 9. No classes Jan 18 (MLK Day). Keep daily scans going and add the first-week access checks. The Pell recalculation date is Jan 26."
                },
                {
                    id: "mid",
                    href: "#mid",
                    start: "2027-02-16",
                    end: "2027-03-06",
                    title: "Mid-semester",
                    text: "First 7-week courses end Feb 26. Run the mid-semester list before the Mar 1–6 break, and finish anything still open during the break."
                },
                {
                    id: "seven-grades",
                    href: "#end",
                    start: "2027-02-26",
                    end: "2027-03-02",
                    title: "First 7-week grades",
                    text: "Grades for courses that ended Feb 26 are due Tuesday, Mar 2, by 2pm. The college is on mid-semester break Mar 1–6, so this window is short."
                },
                {
                    id: "second",
                    href: "#week-one",
                    start: "2027-03-07",
                    end: "2027-03-20",
                    title: "Second 7-week opens",
                    text: "Classes resume Mar 7. Second 7-week classes begin Mar 13. Repeat the first-week list for those courses. No classes Mar 28."
                },
                {
                    id: "end",
                    href: "#end",
                    start: "2027-04-26",
                    end: "2027-05-04",
                    title: "End of the semester",
                    text: "Classes end Apr 30 at 11pm. Grades are due May 4 by 2pm. Run grade submission, incompletes, completion, and the end-of-semester course report."
                },
                {
                    id: "between",
                    href: "#periodic",
                    start: "2027-05-05",
                    end: "2027-05-09",
                    title: "Between Winter and Spring",
                    text: "A short gap. Spring classes start May 10, so the before-the-term list for Spring should already be underway."
                }
            ]
        },
        {
            id: "sp27",
            name: "Spring 2027",
            classStart: "2027-05-10",
            gradesDue: "2027-08-24",
            facts: "Classes May 10–Aug 19. Grades due Aug 24 by 2pm. No classes May 31 and Jul 2–5. Summer Starts is Jun 28. The 2027 spring calendar does not list a separate 7-week start.",
            windows: [
                {
                    id: "before",
                    href: "#before",
                    start: "2027-04-19",
                    end: "2027-05-09",
                    title: "Before classes begin",
                    text: "Run the before-the-term list in the last two weeks of Winter and the few days after Winter grades. Classes start May 10."
                },
                {
                    id: "week-one",
                    href: "#week-one",
                    start: "2027-05-10",
                    end: "2027-05-21",
                    title: "First week",
                    text: "Classes start May 10. Keep daily scans going and add the first-week access checks. The Pell recalculation date is May 27. No classes May 31."
                },
                {
                    id: "mid",
                    href: "#mid",
                    start: "2027-06-21",
                    end: "2027-07-06",
                    title: "Mid-semester",
                    text: "The calendar marks Summer Starts on Jun 28. Use this stretch for the mid-semester list and for any late-start sections opening then. No classes Jul 2–5."
                },
                {
                    id: "end",
                    href: "#end",
                    start: "2027-08-16",
                    end: "2027-08-24",
                    title: "End of the semester",
                    text: "Classes end Aug 19 at 11pm. Grades are due Aug 24 by 2pm. Run grade submission, incompletes, completion, and the end-of-semester course report."
                },
                {
                    id: "between",
                    href: "#periodic",
                    start: "2027-08-25",
                    end: "2027-08-27",
                    title: "Between Spring and Fall",
                    text: "Fall 2027 classes start Aug 28. Before-the-term work for Fall belongs in the two weeks before that."
                }
            ]
        },
        {
            id: "fa27",
            name: "Fall 2027",
            classStart: "2027-08-28",
            gradesDue: "2027-12-21",
            facts: "Dates are from the approved college calendar. The 2026–2027 catalog page ends with Spring 2027. Classes Aug 28–Dec 19. Grades due Dec 21 by 2pm. No classes Sep 4–7 and Nov 24–28. Learning Days are Aug 23–25. First 7-week ends Oct 19. Second 7-week begins Oct 27.",
            windows: [
                {
                    id: "before",
                    href: "#before",
                    start: "2027-08-09",
                    end: "2027-08-27",
                    title: "Before classes begin",
                    text: "Run the before-the-term list in the two weeks before Aug 28. Fall Learning Days are Aug 23–25."
                },
                {
                    id: "week-one",
                    href: "#week-one",
                    start: "2027-08-28",
                    end: "2027-09-10",
                    title: "First week",
                    text: "Classes start Aug 28. No classes Sep 4–7, and classes resume Sep 8. Keep daily scans going and add the first-week access checks."
                },
                {
                    id: "mid",
                    href: "#mid",
                    start: "2027-10-11",
                    end: "2027-10-26",
                    title: "Mid-semester",
                    text: "About halfway through the 15 weeks, and the week the first 7-week courses end (Oct 19). Run no instructor activity, course access, and open incompletes."
                },
                {
                    id: "seven-grades",
                    href: "#end",
                    start: "2027-10-19",
                    end: "2027-10-26",
                    title: "First 7-week grades",
                    text: "Seven-week courses end Oct 19. Grades for those courses are due Tuesday, Oct 26, by 2pm. Full-term courses stay in session."
                },
                {
                    id: "second",
                    href: "#week-one",
                    start: "2027-10-27",
                    end: "2027-11-05",
                    title: "Second 7-week opens",
                    text: "Second 7-week classes begin Oct 27. Repeat the first-week list for late-start courses. Thanksgiving break is Nov 24–28."
                },
                {
                    id: "end",
                    href: "#end",
                    start: "2027-12-13",
                    end: "2027-12-21",
                    title: "End of the semester",
                    text: "Classes end Dec 19. Grades are due Dec 21 by 2pm. Run grade submission, incompletes, completion, and the end-of-semester course report."
                },
                {
                    id: "between",
                    href: "#periodic",
                    start: "2027-12-22",
                    end: "2028-01-07",
                    title: "Between Fall and Winter",
                    text: "Retirement sequence and account cleanup. Winter 2028 classes start Jan 8, so start that before-the-term list during this break."
                }
            ]
        }
    ];

    function parseYmd(ymd) {
        var parts = ymd.split("-");
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }

    function startOfToday() {
        var n = new Date();
        return new Date(n.getFullYear(), n.getMonth(), n.getDate());
    }

    function formatDay(date) {
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    function formatRange(startYmd, endYmd) {
        var start = parseYmd(startYmd);
        var end = parseYmd(endYmd);
        var sameYear = start.getFullYear() === end.getFullYear();
        var sameMonth = sameYear && start.getMonth() === end.getMonth();
        if (sameMonth) {
            var month = start.toLocaleDateString("en-US", { month: "short" });
            return month + " " + start.getDate() + "–" + end.getDate() + ", " + start.getFullYear();
        }
        if (sameYear) {
            var left = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            var right = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            return left + " – " + right + ", " + start.getFullYear();
        }
        return formatDay(start) + " – " + formatDay(end);
    }

    function statusOf(entry, today) {
        var start = parseYmd(entry.start);
        var end = parseYmd(entry.end);
        if (today < start) return "upcoming";
        if (today > end) return "past";
        return "now";
    }

    function flatten() {
        var rows = [];
        TERMS.forEach(function (term) {
            term.windows.forEach(function (window) {
                rows.push({
                    term: term,
                    window: window,
                    start: window.start,
                    end: window.end
                });
            });
        });
        return rows;
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function pill(label, kind) {
        var node = el("span", "guide-pill" + (kind ? " guide-pill-" + kind : ""), label);
        return node;
    }

    function renderCard(entry, today, options) {
        var state = statusOf(entry, today);
        var card = el("article", "guide-window" + (state === "now" ? " is-now" : "") + (state === "past" ? " is-past" : ""));
        if (options.next) card.classList.add("is-next");
        card.id = "guide-win-" + entry.term.id + "-" + entry.window.id;

        var when = el("div", "guide-window-when", formatRange(entry.start, entry.end));
        card.appendChild(when);

        var body = el("div");
        if (options.showTerm) body.appendChild(el("span", "guide-window-term", entry.term.name));

        var title = el("h3", "guide-window-title", entry.window.title);
        if (state === "now") title.appendChild(pill("Now", ""));
        else if (options.next) title.appendChild(pill("Next", "next"));
        else if (state === "past") title.appendChild(pill("Done", "past"));
        body.appendChild(title);

        body.appendChild(el("p", "guide-window-text", entry.window.text));

        var link = el("a", "", LIST_LABEL[entry.window.href] || "Open the list");
        link.href = entry.window.href;
        body.appendChild(link);

        card.appendChild(body);
        return card;
    }

    function toYmd(date) {
        var month = String(date.getMonth() + 1);
        var day = String(date.getDate());
        if (month.length < 2) month = "0" + month;
        if (day.length < 2) day = "0" + day;
        return date.getFullYear() + "-" + month + "-" + day;
    }

    function earliestUpcoming(rows, today) {
        var next = null;
        rows.forEach(function (entry) {
            if (statusOf(entry, today) !== "upcoming") return;
            if (!next || entry.start < next.start) next = entry;
        });
        return next;
    }

    function isNext(entry, next) {
        return !!(next && statusOf(entry, startOfToday()) === "upcoming" && entry.start === next.start);
    }

    function comingRows(rows, today) {
        var horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 120);
        var horizonYmd = toYmd(horizon);
        var inSession = {};
        var nextTerm = null;
        TERMS.forEach(function (term) {
            if (today >= parseYmd(term.classStart) && today <= parseYmd(term.gradesDue)) inSession[term.id] = true;
            if (!nextTerm && parseYmd(term.classStart) > today) nextTerm = term;
        });
        return rows.filter(function (entry) {
            if (statusOf(entry, today) === "past") return false;
            if (inSession[entry.term.id]) return true;
            if (nextTerm && entry.term.id === nextTerm.id) return true;
            return entry.start <= horizonYmd;
        });
    }

    function renderBanner(today, rows) {
        var banner = el("div", "guide-now");
        banner.appendChild(el("p", "guide-now-date", today.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
        })));

        var open = rows.filter(function (entry) { return statusOf(entry, today) === "now"; });
        var next = earliestUpcoming(rows, today);
        var nextGroup = next ? rows.filter(function (entry) {
            return statusOf(entry, today) === "upcoming" && entry.start === next.start;
        }) : [];
        var inSession = TERMS.filter(function (term) {
            return today >= parseYmd(term.classStart) && today <= parseYmd(term.gradesDue);
        });

        var heading = "Nothing is scheduled this week";
        if (open.length) heading = "Open this week";
        else if (inSession.length) heading = "Daily scans are the job right now";
        banner.appendChild(el("h3", "", heading));

        if (open.length) {
            var list = el("ul");
            open.forEach(function (entry) {
                var item = el("li");
                var link = el("a", "", entry.window.title);
                link.href = entry.window.href;
                item.appendChild(link);
                item.appendChild(document.createTextNode(" · " + entry.term.name + ", through " + formatDay(parseYmd(entry.end))));
                list.appendChild(item);
            });
            banner.appendChild(list);
        } else if (!inSession.length && !next) {
            banner.appendChild(el("p", "guide-now-next", "These dates run through Fall 2027. Add the next academic year in js/admin-guide-calendar.js when the college publishes it."));
        }

        if (nextGroup.length) {
            var nextText = nextGroup.map(function (entry) {
                return entry.window.title + " (" + entry.term.name + "), " + formatRange(entry.start, entry.end);
            }).join("; ");
            banner.appendChild(el("p", "guide-now-next", "Next up: " + nextText + "."));
        }

        if (inSession.length) {
            var names = inSession.map(function (term) {
                return term.name + " through " + formatDay(parseYmd(term.gradesDue));
            }).join("; ");
            banner.appendChild(el("p", "guide-now-daily", "Daily enrollment scans stay on for " + names + "."));
        }

        return banner;
    }

    function renderTabs(activeId) {
        var bar = el("div", "guide-tabs");
        bar.setAttribute("role", "tablist");
        bar.setAttribute("aria-label", "Semester");

        var tabs = [{ id: "upcoming", label: "Coming up" }].concat(TERMS.map(function (term) {
            return { id: term.id, label: term.name };
        }));

        tabs.forEach(function (tab) {
            var button = el("button", "guide-tab", tab.label);
            button.type = "button";
            button.setAttribute("role", "tab");
            button.setAttribute("aria-selected", tab.id === activeId ? "true" : "false");
            button.setAttribute("data-guide-tab", tab.id);
            button.id = "guide-tab-" + tab.id;
            bar.appendChild(button);
        });
        return bar;
    }

    function renderPanel(activeId, today) {
        var panel = el("div");
        panel.setAttribute("role", "tabpanel");
        panel.id = "guide-calendar-panel";
        var rows = flatten();
        var next = earliestUpcoming(rows, today);

        if (activeId === "upcoming") {
            var coming = comingRows(rows, today);
            coming.sort(function (a, b) {
                if (a.start === b.start) return a.end < b.end ? -1 : a.end > b.end ? 1 : 0;
                return a.start < b.start ? -1 : 1;
            });
            if (!coming.length) {
                panel.appendChild(el("p", "guide-empty", "Every window on this calendar is in the past. Add the next academic year in js/admin-guide-calendar.js."));
                return panel;
            }
            var list = el("div", "guide-windows");
            coming.forEach(function (entry) {
                list.appendChild(renderCard(entry, today, { showTerm: true, next: isNext(entry, next) }));
            });
            panel.appendChild(list);
            var laterTerms = [];
            TERMS.forEach(function (term) {
                var hasLater = rows.some(function (entry) {
                    return entry.term.id === term.id && statusOf(entry, today) !== "past" && coming.indexOf(entry) === -1;
                });
                if (hasLater) laterTerms.push(term.name);
            });
            if (laterTerms.length) {
                panel.appendChild(el("p", "guide-sources", laterTerms.join(" and ") + (laterTerms.length > 1 ? " are" : " is") + " on the semester tabs."));
            }
            return panel;
        }

        var term = TERMS.filter(function (item) { return item.id === activeId; })[0];
        if (!term) return panel;
        panel.appendChild(el("p", "guide-term-facts", term.facts));
        var termRows = rows.filter(function (entry) { return entry.term.id === term.id; });
        var termNext = earliestUpcoming(termRows, today);
        var list = el("div", "guide-windows");
        termRows.forEach(function (entry) {
            list.appendChild(renderCard(entry, today, { showTerm: false, next: isNext(entry, termNext) }));
        });
        panel.appendChild(list);
        return panel;
    }

    function mount(activeId) {
        var root = document.getElementById("guide-calendar");
        if (!root) return;
        var today = startOfToday();
        var rows = flatten();
        root.textContent = "";
        root.appendChild(renderBanner(today, rows));
        root.appendChild(renderTabs(activeId));
        root.appendChild(renderPanel(activeId, today));
    }

    function init() {
        var root = document.getElementById("guide-calendar");
        if (!root) return;
        mount("upcoming");
        root.addEventListener("click", function (event) {
            var target = event.target;
            if (!target || !target.closest) return;
            var button = target.closest("[data-guide-tab]");
            if (!button || !root.contains(button)) return;
            var id = button.getAttribute("data-guide-tab");
            mount(id);
            var active = root.querySelector('[data-guide-tab="' + id + '"]');
            if (active) active.focus();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
