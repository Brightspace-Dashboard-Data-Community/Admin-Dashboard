const LP_VERSION = "1.49";
const LE_VERSION = "1.75";

const state = {
    orgUnitId: null,
    activeTab: "grades",
    tabItems: {},
    selectedItem: null,
    editorMode: "form",
    gradeMeta: {
        categories: [],
        schemes: []
    },
    quizMeta: {
        categories: []
    }
};

const tabConfigs = {
    grades: {
        label: "Grades",
        list: (ou) => `/d2l/api/le/${LE_VERSION}/${ou}/grades/`,
        detail: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/grades/${id}`,
        update: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/grades/${id}`,
        remove: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/grades/${id}`
    },
    quizzes: {
        label: "Quizzes",
        list: (ou) => `/d2l/api/le/${LE_VERSION}/${ou}/quizzes/`,
        detail: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/quizzes/${id}`,
        update: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/quizzes/${id}`,
        remove: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/quizzes/${id}`
    },
    assignments: {
        label: "Assignments",
        list: (ou) => `/d2l/api/le/${LE_VERSION}/${ou}/dropbox/folders/`,
        detail: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/dropbox/folders/${id}`,
        update: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/dropbox/folders/${id}`,
        remove: (ou, id) => `/d2l/api/le/${LE_VERSION}/${ou}/dropbox/folders/${id}`
    },
    discussions: {
        label: "Discussions",
        list: (ou) => `/d2l/api/le/${LE_VERSION}/${ou}/discussions/forums/`,
        detail: (ou, id, kind, parentId) => kind === "Topic"
            ? `/d2l/api/le/${LE_VERSION}/${ou}/discussions/forums/${parentId}/topics/${id}`
            : `/d2l/api/le/${LE_VERSION}/${ou}/discussions/forums/${id}`,
        update: (ou, id, kind, parentId) => kind === "Topic"
            ? `/d2l/api/le/${LE_VERSION}/${ou}/discussions/forums/${parentId}/topics/${id}`
            : `/d2l/api/le/${LE_VERSION}/${ou}/discussions/forums/${id}`,
        remove: (ou, id, kind, parentId) => kind === "Topic"
            ? `/d2l/api/le/${LE_VERSION}/${ou}/discussions/forums/${parentId}/topics/${id}`
            : `/d2l/api/le/${LE_VERSION}/${ou}/discussions/forums/${id}`
    },
    content: {
        label: "Content",
        list: (ou) => `/d2l/api/le/${LE_VERSION}/${ou}/content/toc`,
        detail: (ou, id, kind) => kind === "Topic"
            ? `/d2l/api/le/${LE_VERSION}/${ou}/content/topics/${id}`
            : `/d2l/api/le/${LE_VERSION}/${ou}/content/modules/${id}`,
        update: (ou, id, kind) => kind === "Topic"
            ? `/d2l/api/le/${LE_VERSION}/${ou}/content/topics/${id}`
            : `/d2l/api/le/${LE_VERSION}/${ou}/content/modules/${id}`,
        remove: (ou, id, kind) => kind === "Topic"
            ? `/d2l/api/le/${LE_VERSION}/${ou}/content/topics/${id}`
            : `/d2l/api/le/${LE_VERSION}/${ou}/content/modules/${id}`
    }
};

const el = {};

document.addEventListener("DOMContentLoaded", () => {
    el.orgUnitInput = document.getElementById("orgunit-id-input");
    el.loadBtn = document.getElementById("load-course-btn");
    el.loadStatus = document.getElementById("load-status");
    el.courseName = document.getElementById("course-name");
    el.courseCode = document.getElementById("course-code");
    el.courseInstructors = document.getElementById("course-instructors");
    el.tabButtons = document.getElementById("tab-buttons");
    el.refreshBtn = document.getElementById("refresh-tab-btn");
    el.itemsList = document.getElementById("items-list");
    el.editorTitle = document.getElementById("editor-title");
    el.editor = document.getElementById("item-json-editor");
    el.saveBtn = document.getElementById("save-item-btn");
    el.deleteBtn = document.getElementById("delete-item-btn");
    el.itemStatus = document.getElementById("item-status");
    el.modeWrap = document.getElementById("editor-mode-wrap");
    el.modeFormBtn = document.getElementById("mode-form-btn");
    el.modeJsonBtn = document.getElementById("mode-json-btn");
    el.gradeForm = document.getElementById("grade-form-editor");
    el.gradeName = document.getElementById("grade-form-name");
    el.gradeType = document.getElementById("grade-form-type");
    el.gradeCategoryId = document.getElementById("grade-form-category-id");
    el.gradeShortName = document.getElementById("grade-form-short-name");
    el.gradeMaxPoints = document.getElementById("grade-form-max-points");
    el.gradeWeight = document.getElementById("grade-form-weight");
    el.gradeDescription = document.getElementById("grade-form-description");
    el.gradeHidden = document.getElementById("grade-form-hidden");
    el.gradeCanExceed = document.getElementById("grade-form-can-exceed");
    el.gradeAssociated = document.getElementById("grade-form-associated");
    el.gradeAssociatedToolId = document.getElementById("grade-form-associated-tool-id");
    el.gradeAssociatedId = document.getElementById("grade-form-associated-id");
    el.gradeIsBonus = document.getElementById("grade-form-is-bonus");
    el.gradeExcludeFinal = document.getElementById("grade-form-exclude-final");
    el.gradeSchemeId = document.getElementById("grade-form-scheme-id");
    el.quizForm = document.getElementById("quiz-form-editor");
    el.quizName = document.getElementById("quiz-form-name");
    el.quizCategoryId = document.getElementById("quiz-form-category-id");
    el.quizAttempts = document.getElementById("quiz-form-attempts");
    el.quizStart = document.getElementById("quiz-form-start");
    el.quizEnd = document.getElementById("quiz-form-end");
    el.quizDue = document.getElementById("quiz-form-due");
    el.quizHidden = document.getElementById("quiz-form-hidden");
    el.assignmentForm = document.getElementById("assignment-form-editor");
    el.assignmentName = document.getElementById("assignment-form-name");
    el.assignmentCategory = document.getElementById("assignment-form-category");
    el.assignmentGradeItemId = document.getElementById("assignment-form-grade-item-id");
    el.assignmentGroupTypeId = document.getElementById("assignment-form-group-type-id");
    el.assignmentPoints = document.getElementById("assignment-form-points");
    el.assignmentStart = document.getElementById("assignment-form-start");
    el.assignmentEnd = document.getElementById("assignment-form-end");
    el.assignmentDue = document.getElementById("assignment-form-due");
    el.assignmentSubmissionType = document.getElementById("assignment-form-submission-type");
    el.assignmentCompletionType = document.getElementById("assignment-form-completion-type");
    el.assignmentNotificationEmail = document.getElementById("assignment-form-notification-email");
    el.assignmentInstructions = document.getElementById("assignment-form-instructions");
    el.assignmentDisplayInCalendar = document.getElementById("assignment-form-display-in-calendar");
    el.assignmentAnonymous = document.getElementById("assignment-form-anonymous");
    el.assignmentSpecialAccess = document.getElementById("assignment-form-special-access");
    el.assignmentRemoveGradeAssociation = document.getElementById("assignment-form-remove-grade-association");
    el.assignmentHidden = document.getElementById("assignment-form-hidden");
    el.discussionForm = document.getElementById("discussion-form-editor");
    el.discussionName = document.getElementById("discussion-form-name");
    el.discussionDesc = document.getElementById("discussion-form-desc");
    el.discussionHidden = document.getElementById("discussion-form-hidden");
    el.contentForm = document.getElementById("content-form-editor");
    el.contentTitle = document.getElementById("content-form-title");
    el.contentShortTitle = document.getElementById("content-form-short-title");
    el.contentStart = document.getElementById("content-form-start");
    el.contentEnd = document.getElementById("content-form-end");
    el.contentDue = document.getElementById("content-form-due");
    el.contentDesc = document.getElementById("content-form-desc");
    el.contentHidden = document.getElementById("content-form-hidden");

    el.loadBtn.addEventListener("click", handleLoadCourse);
    el.refreshBtn.addEventListener("click", () => loadActiveTab(true));
    el.saveBtn.addEventListener("click", handleSaveItem);
    el.deleteBtn.addEventListener("click", handleDeleteItem);
    el.modeFormBtn.addEventListener("click", () => setEditorMode("form"));
    el.modeJsonBtn.addEventListener("click", () => setEditorMode("json"));

    renderTabButtons();
    initializeGradeSelects();
    initializeQuizSelects();
    applyEditorCapabilities();
    updateEditorModeUi();
});

function renderTabButtons() {
    el.tabButtons.innerHTML = "";
    Object.keys(tabConfigs).forEach((key) => {
        const btn = document.createElement("button");
        btn.className = `tab-btn ${key === state.activeTab ? "active" : ""}`;
        btn.textContent = tabConfigs[key].label;
        btn.addEventListener("click", async () => {
            state.activeTab = key;
            state.selectedItem = null;
            state.editorMode = "form";
            renderTabButtons();
            applyEditorCapabilities();
            updateEditorModeUi();
            await loadActiveTab(false);
        });
        el.tabButtons.appendChild(btn);
    });
}

async function handleLoadCourse() {
    const orgUnitId = (el.orgUnitInput.value || "").trim();
    if (!orgUnitId) {
        setStatus(el.loadStatus, "Enter an OrgUnitId first.", true);
        return;
    }

    setStatus(el.loadStatus, "Loading course verification...");
    el.loadBtn.disabled = true;

    try {
        const [course, enrollments] = await Promise.all([
            D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/orgstructure/${orgUnitId}`),
            D2LApi._fetch(`/d2l/api/lp/${LP_VERSION}/enrollments/orgUnits/${orgUnitId}/users/`)
        ]);

        state.orgUnitId = orgUnitId;
        state.tabItems = {};
        state.selectedItem = null;
        state.editorMode = "form";
        state.gradeMeta = { categories: [], schemes: [] };
        state.quizMeta = { categories: [] };
        el.courseName.textContent = course?.Name || "-";
        el.courseCode.textContent = course?.Code || "-";

        const users = normalizeListResponse(enrollments);
        const instructors = users
            .filter((u) => {
                const roleName = (u?.Role?.Name || u?.RoleName || "").toLowerCase();
                return roleName.includes("instructor") || roleName.includes("faculty");
            })
            .map((u) => {
                const display = u?.User?.DisplayName || `${u?.User?.FirstName || ""} ${u?.User?.LastName || ""}`.trim();
                return display || `User ${u?.User?.Identifier || ""}`.trim();
            });

        el.courseInstructors.textContent = instructors.length ? instructors.join(", ") : "No instructor enrollment found";
        setStatus(el.loadStatus, "Course loaded. Select a tab to review and edit data.");
        await loadGradeMetadata(orgUnitId);
        await loadQuizMetadata(orgUnitId);

        await loadActiveTab(true);
    } catch (error) {
        setStatus(el.loadStatus, `Load failed: ${error.message}`, true);
    } finally {
        el.loadBtn.disabled = false;
    }
}

async function loadActiveTab(force) {
    if (!state.orgUnitId) {
        renderItems([]);
        return;
    }

    if (!force && state.tabItems[state.activeTab]) {
        renderItems(state.tabItems[state.activeTab]);
        return;
    }

    const cfg = tabConfigs[state.activeTab];
    setStatus(el.loadStatus, `Loading ${cfg.label}...`);
    el.refreshBtn.disabled = true;

    try {
        let items;
        if (state.activeTab === "discussions") {
            items = await loadDiscussions(state.orgUnitId);
        } else if (state.activeTab === "content") {
            items = await loadContent(state.orgUnitId);
        } else {
            const raw = await D2LApi._fetch(cfg.list(state.orgUnitId));
            items = normalizeListResponse(raw);
        }

        const normalized = items.map((item) => toSelectableItem(item, cfg));
        state.tabItems[state.activeTab] = normalized;
        renderItems(normalized);
        setStatus(el.loadStatus, `${cfg.label} loaded (${normalized.length} item(s)).`);
    } catch (error) {
        renderItems([]);
        setStatus(el.loadStatus, `Could not load ${cfg.label}: ${error.message}`, true);
    } finally {
        el.refreshBtn.disabled = false;
    }
}

async function loadDiscussions(orgUnitId) {
    const forumsRaw = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/discussions/forums/`);
    const forums = normalizeListResponse(forumsRaw);
    const items = [];

    for (const forum of forums) {
        items.push({ ...forum, _kind: "Forum", _title: forum.Name || forum.Title || `Forum ${forum.ForumId || forum.Id}` });
        const forumId = getEntityId(forum);
        if (!forumId) continue;
        try {
            const topicsRaw = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/discussions/forums/${forumId}/topics/`);
            const topics = normalizeListResponse(topicsRaw);
            topics.forEach((topic) => {
                items.push({
                    ...topic,
                    _kind: "Topic",
                    _title: topic.Name || topic.Title || `Topic ${topic.TopicId || topic.Id}`,
                    _forumName: forum.Name || forum.Title || "",
                    _forumId: forumId
                });
            });
        } catch (error) {
            console.warn("Could not load forum topics", forumId, error);
        }
    }

    return items;
}

async function loadContent(orgUnitId) {
    const toc = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/content/toc`);
    const out = [];

    function walkModules(modules, parentTitle) {
        if (!Array.isArray(modules)) return;
        modules.forEach((module) => {
            out.push({
                ...module,
                _kind: "Module",
                _title: module.Title || module.Name || `Module ${module.Identifier || ""}`.trim(),
                _parent: parentTitle || ""
            });
            if (Array.isArray(module.Topics)) {
                module.Topics.forEach((topic) => {
                    out.push({
                        ...topic,
                        _kind: "Topic",
                        _title: topic.Title || topic.Name || `Topic ${topic.TopicId || ""}`.trim(),
                        _parent: module.Title || module.Name || ""
                    });
                });
            }
            walkModules(module.Modules, module.Title || module.Name || "");
        });
    }

    walkModules(toc?.Modules || [], "");
    return out;
}

function renderItems(items) {
    el.itemsList.innerHTML = "";

    if (!items.length) {
        el.itemsList.innerHTML = `<div style="padding:12px; color: var(--text-secondary);">No items loaded for this tab.</div>`;
        el.editorTitle.textContent = "Select an item";
        el.editor.value = "";
        state.selectedItem = null;
        applyEditorCapabilities();
        updateEditorModeUi();
        return;
    }

    items.forEach((item) => {
        const btn = document.createElement("button");
        btn.className = `item-row ${state.selectedItem && state.selectedItem._id === item._id ? "active" : ""}`;
        btn.innerHTML = `<div class="title">${escapeHtml(item._display)}</div><div class="meta">${escapeHtml(item._meta)}</div>`;
        btn.addEventListener("click", async () => {
            state.selectedItem = item;
            el.editorTitle.textContent = `${item._display} (${item._id || "no id"})`;
            await populateEditorFromItem(item);
            renderItems(items);
            applyEditorCapabilities();
            updateEditorModeUi();
        });
        el.itemsList.appendChild(btn);
    });
}

async function populateEditorFromItem(item) {
    const cfg = tabConfigs[state.activeTab];
    const id = item._id;

    if (cfg.detail && id) {
        try {
            const detail = await D2LApi._fetch(cfg.detail(state.orgUnitId, id, item._kind, item._parentId));
            state.selectedItem = { ...item, _full: detail };
            el.editor.value = JSON.stringify(detail, null, 2);
            syncActiveFormFromPayload(detail);
            return;
        } catch (error) {
            console.warn("Detail fetch failed, showing list payload", error);
        }
    }

    el.editor.value = JSON.stringify(item._raw, null, 2);
    syncActiveFormFromPayload(item._raw);
}

async function handleSaveItem() {
    if (!state.orgUnitId || !state.selectedItem) return;
    const cfg = tabConfigs[state.activeTab];
    if (!cfg.update) {
        setStatus(el.itemStatus, "This tab is currently read-only in this workbench.", true);
        return;
    }
    if (!state.selectedItem._id) {
        setStatus(el.itemStatus, "No stable API id found for selected item.", true);
        return;
    }

    let payload;
    if (state.editorMode === "form") {
        payload = buildPayloadFromForm();
        if (!payload) return;
        el.editor.value = JSON.stringify(payload, null, 2);
    } else {
        try {
            payload = JSON.parse(el.editor.value || "{}");
        } catch (error) {
            setStatus(el.itemStatus, `Invalid JSON: ${error.message}`, true);
            return;
        }
    }

    setStatus(el.itemStatus, "Saving changes...");
    el.saveBtn.disabled = true;
    try {
        const updateEndpoint = cfg.update(state.orgUnitId, state.selectedItem._id, state.selectedItem._kind, state.selectedItem._parentId);
        await saveWithGradeFallback(updateEndpoint, payload, state.activeTab);
        setStatus(el.itemStatus, "Save successful.");
        await loadActiveTab(true);
    } catch (error) {
        setStatus(el.itemStatus, `Save failed: ${error.message}`, true);
    } finally {
        el.saveBtn.disabled = false;
    }
}

async function saveWithGradeFallback(endpoint, payload, tabName) {
    try {
        await requestWithDetails(endpoint, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    } catch (error) {
        const msg = String(error?.message || "");
        const shouldRetryWrapped = ["grades", "quizzes", "assignments", "discussions", "content"].includes(tabName) && msg.includes("JSON Binding Error");
        if (!shouldRetryWrapped) throw error;

        let wrapped = payload;
        if (tabName === "grades") wrapped = { GradeObject: payload };
        if (tabName === "quizzes") wrapped = { QuizData: payload };
        if (tabName === "assignments") wrapped = { DropboxFolderUpdateData: payload };
        if (tabName === "discussions") {
            wrapped = state.selectedItem?._kind === "Forum"
                ? { ForumData: payload }
                : { CreateTopicData: payload };
        }
        if (tabName === "content") wrapped = { ContentObjectData: payload };
        await requestWithDetails(endpoint, {
            method: "PUT",
            body: JSON.stringify(wrapped)
        });
    }
}

async function handleDeleteItem() {
    if (!state.orgUnitId || !state.selectedItem) return;
    const cfg = tabConfigs[state.activeTab];
    if (!cfg.remove) {
        setStatus(el.itemStatus, "Delete is not enabled for this tab.", true);
        return;
    }
    if (!state.selectedItem._id) {
        setStatus(el.itemStatus, "No stable API id found for selected item.", true);
        return;
    }

    if (!window.confirm(`Delete "${state.selectedItem._display}"? This cannot be undone.`)) {
        return;
    }

    setStatus(el.itemStatus, "Deleting item...");
    el.deleteBtn.disabled = true;
    try {
        const removeEndpoint = cfg.remove(state.orgUnitId, state.selectedItem._id, state.selectedItem._kind, state.selectedItem._parentId);
        await requestWithDetails(removeEndpoint, { method: "DELETE" });
        setStatus(el.itemStatus, "Delete successful.");
        state.selectedItem = null;
        el.editor.value = "";
        el.editorTitle.textContent = "Select an item";
        await loadActiveTab(true);
    } catch (error) {
        setStatus(el.itemStatus, `Delete failed: ${error.message}`, true);
    } finally {
        el.deleteBtn.disabled = false;
    }
}

function applyEditorCapabilities() {
    const cfg = tabConfigs[state.activeTab];
    const canUpdate = !!cfg.update;
    const canDelete = !!cfg.remove;

    el.saveBtn.disabled = !canUpdate;
    el.deleteBtn.disabled = !canDelete;
}

function setEditorMode(mode) {
    state.editorMode = mode;
    updateEditorModeUi();
}

function updateEditorModeUi() {
    const canUseForm = true;

    el.modeWrap.style.display = canUseForm ? "flex" : "none";
    if (!canUseForm) state.editorMode = "json";

    const isForm = state.editorMode === "form" && canUseForm;
    el.modeFormBtn.classList.toggle("active", isForm);
    el.modeJsonBtn.classList.toggle("active", !isForm);
    el.editor.style.display = isForm ? "none" : "block";
    el.gradeForm.style.display = isForm && state.activeTab === "grades" ? "grid" : "none";
    el.quizForm.style.display = isForm && state.activeTab === "quizzes" ? "grid" : "none";
    el.assignmentForm.style.display = isForm && state.activeTab === "assignments" ? "grid" : "none";
    el.discussionForm.style.display = isForm && state.activeTab === "discussions" ? "grid" : "none";
    el.contentForm.style.display = isForm && state.activeTab === "content" ? "grid" : "none";
}

function syncActiveFormFromPayload(payload) {
    if (!payload) return;
    if (state.activeTab === "grades") {
        syncGradeFormFromPayload(payload);
        return;
    }
    if (state.activeTab === "quizzes") {
        syncQuizFormFromPayload(payload);
        return;
    }
    if (state.activeTab === "assignments") {
        syncAssignmentFormFromPayload(payload);
        return;
    }
    if (state.activeTab === "discussions") {
        syncDiscussionFormFromPayload(payload);
        return;
    }
    if (state.activeTab === "content") {
        syncContentFormFromPayload(payload);
    }
}

function syncGradeFormFromPayload(payload) {
    const associatedObj = payload.AssociatedTool || payload.Association || null;
    const associatedItemId =
        payload.AssociatedToolId ??
        payload.AssociatedObjectId ??
        associatedObj?.ToolItemId ??
        associatedObj?.Identifier ??
        associatedObj?.Id ??
        "";
    const associatedToolId = associatedObj?.ToolId ?? "";

    ensureSelectOption(el.gradeCategoryId, payload.CategoryId == null ? 0 : payload.CategoryId, `Category ${payload.CategoryId}`);
    ensureSelectOption(el.gradeSchemeId, payload.GradeSchemeId == null ? "" : payload.GradeSchemeId, `Scheme ${payload.GradeSchemeId}`);
    el.gradeName.value = payload.Name || "";
    el.gradeType.value = payload.GradeType || "Numeric";
    el.gradeCategoryId.value = payload.CategoryId == null ? 0 : payload.CategoryId;
    el.gradeShortName.value = payload.ShortName || "";
    el.gradeMaxPoints.value = payload.MaxPoints ?? payload.Points ?? "";
    el.gradeWeight.value = payload.Weight ?? "";
    el.gradeDescription.value = payload?.Description?.Content || payload?.Description?.Html || "";
    el.gradeHidden.checked = Boolean(payload.IsHidden ?? payload.Hidden ?? false);
    el.gradeCanExceed.checked = Boolean(payload.CanExceedMaxPoints ?? payload.CanExceed ?? false);
    el.gradeIsBonus.checked = Boolean(payload.IsBonus ?? false);
    el.gradeExcludeFinal.checked = Boolean(payload.ExcludeFromFinalGradeCalculation ?? false);
    el.gradeSchemeId.value = payload.GradeSchemeId == null ? "" : String(payload.GradeSchemeId);
    el.gradeAssociated.checked = Boolean(associatedItemId || associatedToolId);
    el.gradeAssociatedToolId.value = associatedToolId ? String(associatedToolId) : "";
    el.gradeAssociatedId.value = associatedItemId ? String(associatedItemId) : "";
}

function ensureSelectOption(selectEl, value, label) {
    const normalized = String(value ?? "");
    if (!Array.from(selectEl.options).some((opt) => opt.value === normalized)) {
        const opt = document.createElement("option");
        opt.value = normalized;
        opt.textContent = `${label} (${normalized})`;
        selectEl.appendChild(opt);
    }
}

function syncQuizFormFromPayload(payload) {
    ensureSelectOption(el.quizCategoryId, payload.CategoryId == null ? "" : payload.CategoryId, `Category ${payload.CategoryId}`);
    el.quizName.value = payload.Name || payload.Title || "";
    el.quizCategoryId.value = payload.CategoryId == null ? "" : String(payload.CategoryId);
    const attempts = payload?.AttemptsAllowed?.IsUnlimited ? "" : (
        payload?.AttemptsAllowed?.NumberOfAttemptsAllowed ??
        payload.NumberOfAttemptsAllowed ??
        ""
    );
    el.quizAttempts.value = attempts;
    el.quizStart.value = isoToLocal(payload.StartDate);
    el.quizEnd.value = isoToLocal(payload.EndDate);
    el.quizDue.value = isoToLocal(payload.DueDate);
    el.quizHidden.checked = !Boolean(payload.IsActive ?? true);
}

function syncAssignmentFormFromPayload(payload) {
    el.assignmentName.value = payload.Name || payload.Title || "";
    el.assignmentCategory.value = payload.Category || payload.CategoryName || "";
    el.assignmentGradeItemId.value = payload.GradeItemId ?? "";
    el.assignmentGroupTypeId.value = payload.GroupTypeId ?? "";
    el.assignmentPoints.value = payload.OutOf ?? payload.MaxPoints ?? "";
    el.assignmentStart.value = isoToLocal(payload.StartDate);
    el.assignmentEnd.value = isoToLocal(payload.EndDate);
    el.assignmentDue.value = isoToLocal(payload.DueDate);
    ensureSelectOption(el.assignmentSubmissionType, payload.SubmissionType ?? "", `Current: ${payload.SubmissionType}`);
    ensureSelectOption(el.assignmentCompletionType, payload.CompletionType ?? "", `Current: ${payload.CompletionType}`);
    el.assignmentSubmissionType.value = payload.SubmissionType ?? "";
    el.assignmentCompletionType.value = payload.CompletionType ?? "";
    el.assignmentNotificationEmail.value = payload.NotificationEmail || "";
    el.assignmentInstructions.value = payload?.CustomInstructions?.Content || payload?.CustomInstructions?.Html || "";
    el.assignmentDisplayInCalendar.checked = Boolean(payload.DisplayInCalendar ?? false);
    el.assignmentAnonymous.checked = Boolean(payload.IsAnonymous ?? false);
    el.assignmentSpecialAccess.checked = Boolean(payload.AllowOnlyUsersWithSpecialAccess ?? false);
    el.assignmentRemoveGradeAssociation.checked = false;
    el.assignmentHidden.checked = Boolean(payload.IsHidden ?? payload.Hidden ?? false);
}

function syncDiscussionFormFromPayload(payload) {
    el.discussionName.value = payload.Name || payload.Title || "";
    el.discussionDesc.value = payload?.Description?.Content || payload?.Description || "";
    el.discussionHidden.checked = Boolean(payload.IsHidden ?? payload.Hidden ?? false);
}

function syncContentFormFromPayload(payload) {
    el.contentTitle.value = payload.Title || payload.Name || "";
    el.contentShortTitle.value = payload.ShortTitle || "";
    el.contentStart.value = isoToLocal(payload.ModuleStartDate || payload.StartDate);
    el.contentEnd.value = isoToLocal(payload.ModuleEndDate || payload.EndDate);
    el.contentDue.value = isoToLocal(payload.ModuleDueDate || payload.DueDate);
    el.contentDesc.value = payload?.Description?.Content || payload?.Description?.Html || "";
    el.contentHidden.checked = Boolean(payload.IsHidden ?? payload.Hidden ?? false);
}

function buildPayloadFromForm() {
    if (state.activeTab === "grades") return buildGradePayloadFromForm();
    if (state.activeTab === "quizzes") return buildQuizPayloadFromForm();
    if (state.activeTab === "assignments") return buildAssignmentPayloadFromForm();
    if (state.activeTab === "discussions") return buildDiscussionPayloadFromForm();
    if (state.activeTab === "content") return buildContentPayloadFromForm();
    return null;
}

function buildGradePayloadFromForm() {
    if (!state.selectedItem) {
        setStatus(el.itemStatus, "Select a grade item first.", true);
        return null;
    }

    const source = { ...(state.selectedItem._full || state.selectedItem._raw || {}) };
    const maxPointsValue = Number(el.gradeMaxPoints.value);
    if (el.gradeMaxPoints.value && Number.isNaN(maxPointsValue)) {
        setStatus(el.itemStatus, "Max points must be a valid number.", true);
        return null;
    }

    const categoryRaw = String(el.gradeCategoryId.value || "").trim();
    const schemeRaw = String(el.gradeSchemeId.value || "").trim();
    const weightRaw = String(el.gradeWeight.value || "").trim();
    const payload = {
        Name: el.gradeName.value.trim(),
        ShortName: el.gradeShortName.value.trim(),
        GradeType: el.gradeType.value || source.GradeType || "Numeric",
        CategoryId: categoryRaw === "" ? 0 : Number(categoryRaw),
        IsHidden: el.gradeHidden.checked,
        Description: {
            Content: el.gradeDescription.value || "",
            Type: "Html"
        },
        IsBonus: el.gradeIsBonus.checked,
        ExcludeFromFinalGradeCalculation: el.gradeExcludeFinal.checked,
        GradeSchemeId: schemeRaw === "" ? null : Number(schemeRaw)
    };
    if (weightRaw !== "") payload.Weight = Number(weightRaw);

    const gradeValidationError = validateGradePayload(payload);
    if (gradeValidationError) {
        setStatus(el.itemStatus, gradeValidationError, true);
        return null;
    }

    const gradeType = String(payload.GradeType || "").toLowerCase();
    if (gradeType === "numeric" || gradeType === "passfail" || gradeType === "selectbox") {
        if (el.gradeMaxPoints.value !== "") payload.MaxPoints = maxPointsValue;
    }
    if (gradeType === "numeric") {
        payload.CanExceedMaxPoints = el.gradeCanExceed.checked;
    }
    if (gradeType !== "numeric") delete payload.CanExceedMaxPoints;

    const srcAssoc = source.AssociatedTool && typeof source.AssociatedTool === "object" ? source.AssociatedTool : null;
    if (!el.gradeAssociated.checked) {
        payload.AssociatedTool = null;
    } else {
        const assocToolRaw = (el.gradeAssociatedToolId.value || "").trim();
        const assoc = (el.gradeAssociatedId.value || "").trim();
        const assocTool = {
            ToolId: assocToolRaw !== "" ? Number(assocToolRaw) : (srcAssoc?.ToolId ?? null),
            ToolItemId: srcAssoc?.ToolItemId ?? null
        };
        if (assoc) {
            assocTool.ToolItemId = /^\d+$/.test(assoc) ? Number(assoc) : null;
        }
        payload.AssociatedTool = assocTool;
    }

    return payload;
}

function validateGradePayload(payload) {
    if (!payload.Name) return "Grade name is required.";
    if (payload.Name.length > 128) return "Grade name must be 128 characters or fewer.";
    if (payload.ShortName && payload.ShortName.length > 128) return "Short name must be 128 characters or fewer.";
    if (/[\/"*\<\>\+=\|,%]/.test(payload.Name)) return "Grade name contains invalid characters.";
    if (payload.MaxPoints != null && (payload.MaxPoints < 0.01 || payload.MaxPoints > 9999999999)) {
        return "Max points must be between 0.01 and 9,999,999,999.";
    }
    if (payload.Weight != null && Number.isNaN(payload.Weight)) return "Weight must be a valid number.";
    return null;
}

function initializeGradeSelects() {
    el.gradeCategoryId.innerHTML = '<option value="0">No Category (0)</option>';
    el.gradeSchemeId.innerHTML = '<option value="">None (null)</option>';
}

function initializeQuizSelects() {
    el.quizCategoryId.innerHTML = '<option value="">None (null)</option>';
}

async function loadGradeMetadata(orgUnitId) {
    try {
        const [categoriesRaw, schemesRaw] = await Promise.all([
            D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/grades/categories/`),
            D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/grades/schemes/`)
        ]);
        state.gradeMeta.categories = normalizeListResponse(categoriesRaw);
        state.gradeMeta.schemes = normalizeListResponse(schemesRaw);
        populateGradeMetadataSelects();
    } catch (error) {
        console.warn("Could not load grade categories/schemes", error);
        initializeGradeSelects();
    }
}

function populateGradeMetadataSelects() {
    const categoryOptions = ['<option value="0">No Category (0)</option>']
        .concat(state.gradeMeta.categories.map((c) => {
            const id = c.Id ?? c.Identifier ?? "";
            const name = c.Name || c.ShortName || `Category ${id}`;
            return `<option value="${escapeHtml(String(id))}">${escapeHtml(name)} (${escapeHtml(String(id))})</option>`;
        }));
    el.gradeCategoryId.innerHTML = categoryOptions.join("");

    const schemeOptions = ['<option value="">None (null)</option>']
        .concat(state.gradeMeta.schemes.map((s) => {
            const id = s.Id ?? s.Identifier ?? "";
            const name = s.Name || s.ShortName || `Scheme ${id}`;
            return `<option value="${escapeHtml(String(id))}">${escapeHtml(name)} (${escapeHtml(String(id))})</option>`;
        }));
    el.gradeSchemeId.innerHTML = schemeOptions.join("");
}

async function loadQuizMetadata(orgUnitId) {
    try {
        const categoriesRaw = await D2LApi._fetch(`/d2l/api/le/${LE_VERSION}/${orgUnitId}/quizzes/categories/`);
        state.quizMeta.categories = normalizeListResponse(categoriesRaw);
        populateQuizMetadataSelects();
    } catch (error) {
        console.warn("Could not load quiz categories", error);
        initializeQuizSelects();
    }
}

function populateQuizMetadataSelects() {
    const options = ['<option value="">None (null)</option>']
        .concat(state.quizMeta.categories.map((c) => {
            const id = c.CategoryId ?? c.Id ?? c.Identifier ?? "";
            const name = c.Name || `Category ${id}`;
            return `<option value="${escapeHtml(String(id))}">${escapeHtml(name)} (${escapeHtml(String(id))})</option>`;
        }));
    el.quizCategoryId.innerHTML = options.join("");
}

function buildQuizPayloadFromForm() {
    if (!state.selectedItem) return null;
    const source = { ...(state.selectedItem._full || state.selectedItem._raw || {}) };
    const payload = toQuizUpdatePayload(source);
    payload.Name = el.quizName.value.trim();
    const categoryRaw = String(el.quizCategoryId.value || "").trim();
    payload.CategoryId = categoryRaw === "" ? null : Number(categoryRaw);
    payload.IsActive = !el.quizHidden.checked;
    const attemptsRaw = String(el.quizAttempts.value || "").trim();
    payload.NumberOfAttemptsAllowed = attemptsRaw === "" ? null : Number(attemptsRaw);
    payload.StartDate = localToIsoOrNull(el.quizStart.value);
    payload.EndDate = localToIsoOrNull(el.quizEnd.value);
    payload.DueDate = localToIsoOrNull(el.quizDue.value);

    return payload;
}

function toQuizUpdatePayload(source) {
    const payload = {
        Name: el.quizName.value.trim(),
        IsActive: Boolean(source.IsActive ?? true),
        SortOrder: Number(source.SortOrder ?? 0),
        AutoExportToGrades: source.AutoExportToGrades ?? null,
        GradeItemId: source.GradeItemId ?? null,
        IsAutoSetGraded: Boolean(source.IsAutoSetGraded ?? false),
        Instructions: {
            Text: toRichTextInput(source?.Instructions?.Text || source?.Instructions),
            IsDisplayed: Boolean(source?.Instructions?.IsDisplayed ?? false)
        },
        Description: {
            Text: toRichTextInput(source?.Description?.Text || source?.Description),
            IsDisplayed: Boolean(source?.Description?.IsDisplayed ?? false)
        },
        StartDate: source.StartDate ?? null,
        EndDate: source.EndDate ?? null,
        DueDate: source.DueDate ?? null,
        DisplayInCalendar: Boolean(source.DisplayInCalendar ?? false),
        NumberOfAttemptsAllowed: source?.AttemptsAllowed?.IsUnlimited ? null : (
            source?.AttemptsAllowed?.NumberOfAttemptsAllowed ??
            source.NumberOfAttemptsAllowed ??
            1
        ),
        LateSubmissionInfo: {
            LateSubmissionOption: Number(source?.LateSubmissionInfo?.LateSubmissionOption ?? 0),
            LateLimitMinutes: source?.LateSubmissionInfo?.LateLimitMinutes ?? null
        },
        SubmissionTimeLimit: {
            IsEnforced: Boolean(source?.SubmissionTimeLimit?.IsEnforced ?? false),
            ShowClock: Boolean(source?.SubmissionTimeLimit?.ShowClock ?? false),
            TimeLimitValue: Number(source?.SubmissionTimeLimit?.TimeLimitValue ?? 0)
        },
        SubmissionGracePeriod: source.SubmissionGracePeriod ?? null,
        Password: source.Password ?? null,
        Header: {
            Text: toRichTextInput(source?.Header?.Text || source?.Header),
            IsDisplayed: Boolean(source?.Header?.IsDisplayed ?? false)
        },
        Footer: {
            Text: toRichTextInput(source?.Footer?.Text || source?.Footer),
            IsDisplayed: Boolean(source?.Footer?.IsDisplayed ?? false)
        },
        AllowHints: Boolean(source.AllowHints ?? false),
        DisableRightClick: Boolean(source.DisableRightClick ?? false),
        DisablePagerAndAlerts: Boolean(source.DisablePagerAndAlerts ?? false),
        NotificationEmail: source.NotificationEmail ?? null,
        CalcTypeId: Number(source.CalcTypeId ?? 1),
        RestrictIPAddressRange: source.RestrictIPAddressRange ?? null,
        CategoryId: source.CategoryId ?? 0,
        PreventMovingBackwards: Boolean(source.PreventMovingBackwards ?? false),
        Shuffle: Boolean(source.Shuffle ?? false),
        AllowOnlyUsersWithSpecialAccess: Boolean(source.AllowOnlyUsersWithSpecialAccess ?? false),
        IsRetakeIncorrectOnly: Boolean(source.IsRetakeIncorrectOnly ?? false),
        PagingTypeId: source.PagingTypeId ?? 0,
        IsSynchronous: Boolean(source.IsSynchronous ?? false),
        DeductionPercentage: source.DeductionPercentage ?? null,
        HideQuestionPoints: Boolean(source.HideQuestionPoints ?? false),
        IsSingleSession: Boolean(source.IsSingleSession ?? false)
    };
    return payload;
}

function buildAssignmentPayloadFromForm() {
    if (!state.selectedItem) return null;
    const source = { ...(state.selectedItem._full || state.selectedItem._raw || {}) };
    const submissionTypeRaw = String(el.assignmentSubmissionType.value || "").trim();
    const completionTypeRaw = String(el.assignmentCompletionType.value || "").trim();
    const payload = {
        CategoryId: source.CategoryId ?? null,
        Name: el.assignmentName.value.trim(),
        CustomInstructions: toRichTextInput({ Html: el.assignmentInstructions.value || "" }),
        Availability: {
            StartDate: localToIsoOrNull(el.assignmentStart.value),
            EndDate: localToIsoOrNull(el.assignmentEnd.value),
            StartDateAvailabilityType: source?.Availability?.StartDateAvailabilityType ?? null,
            EndDateAvailabilityType: source?.Availability?.EndDateAvailabilityType ?? null
        },
        GroupTypeId: source.GroupTypeId ?? null,
        DueDate: localToIsoOrNull(el.assignmentDue.value),
        DisplayInCalendar: el.assignmentDisplayInCalendar.checked,
        NotificationEmail: (el.assignmentNotificationEmail.value || "").trim() || null,
        IsHidden: el.assignmentHidden.checked,
        Assessment: source.Assessment ? { ScoreDenominator: source.Assessment.ScoreDenominator ?? null } : null,
        IsAnonymous: el.assignmentAnonymous.checked,
        DropboxType: source.DropboxType ?? null,
        SubmissionType: submissionTypeRaw || source.SubmissionType || null,
        CompletionType: completionTypeRaw || source.CompletionType || null,
        GradeItemId: source.GradeItemId ?? null,
        AllowOnlyUsersWithSpecialAccess: el.assignmentSpecialAccess.checked
    };
    const categoryText = el.assignmentCategory.value.trim();
    if (/^\d+$/.test(categoryText)) payload.CategoryId = Number(categoryText);
    const gradeItemRaw = String(el.assignmentGradeItemId.value || "").trim();
    if (el.assignmentRemoveGradeAssociation.checked) {
        payload.GradeItemId = null;
    } else if (gradeItemRaw === "") {
        payload.GradeItemId = source.GradeItemId ?? null;
    } else {
        payload.GradeItemId = Number(gradeItemRaw);
    }
    const groupTypeRaw = String(el.assignmentGroupTypeId.value || "").trim();
    payload.GroupTypeId = groupTypeRaw === "" ? null : Number(groupTypeRaw);
    const pointsRaw = String(el.assignmentPoints.value || "").trim();
    if (pointsRaw !== "") {
        payload.Assessment = payload.Assessment || {};
        payload.Assessment.ScoreDenominator = Number(pointsRaw);
    }
    return payload;
}

function buildDiscussionPayloadFromForm() {
    if (!state.selectedItem) return null;
    const source = { ...(state.selectedItem._full || state.selectedItem._raw || {}) };
    const isForum = state.selectedItem?._kind === "Forum";
    if (isForum) {
        return {
            Name: el.discussionName.value.trim(),
            Description: {
                Text: toRichText(source.Description),
                Html: el.discussionDesc.value || "",
                Content: el.discussionDesc.value || "",
                Type: "Html"
            },
            ShowDescriptionInTopics: source.ShowDescriptionInTopics ?? false,
            StartDate: source.StartDate ?? null,
            EndDate: source.EndDate ?? null,
            PostStartDate: source.PostStartDate ?? null,
            PostEndDate: source.PostEndDate ?? null,
            AllowAnonymous: source.AllowAnonymous ?? false,
            IsLocked: source.IsLocked ?? false,
            IsHidden: el.discussionHidden.checked,
            RequiresApproval: source.RequiresApproval ?? false,
            MustPostToParticipate: source.MustPostToParticipate ?? false,
            DisplayInCalendar: source.DisplayInCalendar ?? false,
            DisplayPostDatesInCalendar: source.DisplayPostDatesInCalendar ?? false,
            StartDateAvailabilityType: source.StartDateAvailabilityType ?? null,
            EndDateAvailabilityType: source.EndDateAvailabilityType ?? null
        };
    }
    return {
        Name: el.discussionName.value.trim(),
        Description: toRichTextInput({ Html: el.discussionDesc.value || "" }),
        AllowAnonymousPosts: source.AllowAnonymousPosts ?? false,
        StartDate: source.StartDate ?? null,
        EndDate: source.EndDate ?? null,
        IsHidden: el.discussionHidden.checked,
        UnlockStartDate: source.UnlockStartDate ?? null,
        UnlockEndDate: source.UnlockEndDate ?? null,
        RequiresApproval: source.RequiresApproval ?? false,
        ScoreOutOf: source.ScoreOutOf ?? null,
        IsAutoScore: source.IsAutoScore ?? false,
        IncludeNonScoredValues: source.IncludeNonScoredValues ?? false,
        ScoringType: source.ScoringType ?? null,
        IsLocked: source.IsLocked ?? false,
        MustPostToParticipate: source.MustPostToParticipate ?? false,
        RatingType: source.RatingType ?? null,
        DisplayInCalendar: source.DisplayInCalendar ?? false,
        DisplayUnlockDatesInCalendar: source.DisplayUnlockDatesInCalendar ?? false,
        GroupTypeId: source.GroupTypeId ?? null,
        StartDateAvailabilityType: source.StartDateAvailabilityType ?? null,
        EndDateAvailabilityType: source.EndDateAvailabilityType ?? null,
        DueDate: source.DueDate ?? null
    };
}

function buildContentPayloadFromForm() {
    if (!state.selectedItem) return null;
    const source = { ...(state.selectedItem._full || state.selectedItem._raw || {}) };
    const isTopic = state.selectedItem?._kind === "Topic";
    if (isTopic) {
        return {
            Title: el.contentTitle.value.trim(),
            ShortTitle: el.contentShortTitle.value.trim(),
            Type: 1,
            TopicType: source.TopicType ?? 1,
            Url: source.Url || "",
            StartDate: localToIsoOrNull(el.contentStart.value),
            EndDate: localToIsoOrNull(el.contentEnd.value),
            DueDate: localToIsoOrNull(el.contentDue.value),
            IsHidden: el.contentHidden.checked,
            IsLocked: source.IsLocked ?? false,
            OpenAsExternalResource: source.OpenAsExternalResource ?? null,
            Description: toRichTextInput({ Html: el.contentDesc.value || "" }),
            MajorUpdate: source.MajorUpdate ?? null,
            MajorUpdateText: source.MajorUpdateText ?? null,
            ResetCompletionTracking: source.ResetCompletionTracking ?? null,
            Duration: source.Duration ?? null
        };
    }
    return {
        Title: el.contentTitle.value.trim(),
        ShortTitle: el.contentShortTitle.value.trim(),
        Type: 0,
        ModuleStartDate: localToIsoOrNull(el.contentStart.value),
        ModuleEndDate: localToIsoOrNull(el.contentEnd.value),
        ModuleDueDate: localToIsoOrNull(el.contentDue.value),
        IsHidden: el.contentHidden.checked,
        IsLocked: source.IsLocked ?? false,
        Description: toRichTextInput({ Html: el.contentDesc.value || "" }),
        Duration: source.Duration ?? null
    };
}

function toSelectableItem(raw) {
    const id = getEntityId(raw);
    const type = raw?._kind || raw?.TypeName || raw?.Type || "Item";
    const title = raw?._title || raw?.Name || raw?.Title || raw?.Text || `${type} ${id || ""}`.trim();
    const metaParts = [];
    if (type) metaParts.push(type);
    if (id) metaParts.push(`ID ${id}`);
    if (raw?._forumName) metaParts.push(`Forum: ${raw._forumName}`);
    if (raw?._parent) metaParts.push(`Parent: ${raw._parent}`);

    return {
        _id: id,
        _display: title,
        _meta: metaParts.join(" | "),
        _raw: raw,
        _kind: raw?._kind || null,
        _parentId: raw?._forumId || raw?._parentId || null
    };
}

function getEntityId(item) {
    return (
        item?.Identifier ??
        item?.Id ??
        item?.ID ??
        item?.GradeObjectId ??
        item?.QuizId ??
        item?.FolderId ??
        item?.ForumId ??
        item?.TopicId ??
        null
    );
}

function normalizeListResponse(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.Objects)) return raw.Objects;
    if (Array.isArray(raw?.Items)) return raw.Items;
    return raw ? [raw] : [];
}

function setStatus(target, message, isError = false) {
    target.textContent = message;
    target.style.color = isError ? "var(--danger-color)" : "var(--text-secondary)";
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function isoToLocal(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIsoOrNull(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}

function toRichTextInput(value) {
    if (!value) return { Content: "", Type: "Html" };
    if (typeof value.Content === "string" && typeof value.Type === "string") {
        return { Content: value.Content, Type: value.Type };
    }
    if (typeof value.Html === "string") return { Content: value.Html, Type: "Html" };
    if (typeof value.Text === "string") return { Content: value.Text, Type: "Text" };
    return { Content: "", Type: "Html" };
}

function toRichText(value) {
    if (!value) return { Text: "", Html: "" };
    if (typeof value.Html === "string" || typeof value.Text === "string") {
        return { Text: value.Text || "", Html: value.Html || "" };
    }
    if (typeof value.Content === "string") {
        if (String(value.Type || "").toLowerCase() === "text") return { Text: value.Content, Html: "" };
        return { Text: "", Html: value.Content };
    }
    return { Text: "", Html: "" };
}

async function requestWithDetails(endpoint, options = {}) {
    const headers = typeof D2LApi._getAuthHeaders === "function"
        ? D2LApi._getAuthHeaders()
        : { "Accept": "application/json", "Content-Type": "application/json" };
    const response = await fetch(endpoint, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
        credentials: "include"
    });

    const newToken = response.headers.get("x-csrf-token");
    if (newToken) localStorage.setItem("XSRF.Token", newToken);

    const text = await response.text();
    if (!response.ok) {
        const details = text && text.trim() ? ` - ${text.trim().slice(0, 300)}` : "";
        throw new Error(`API Error: ${response.status} ${response.statusText}${details}`);
    }

    if (!text || !text.trim()) return {};
    try {
        return JSON.parse(text);
    } catch (error) {
        return text;
    }
}

