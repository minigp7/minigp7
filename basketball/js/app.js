const CATEGORY_LABELS = {
    offense: "공격",
    defense: "수비"
};

// ---- Password gate ----

const APP_PASSWORD = "1357";

const passwordGate = document.getElementById("passwordGate");
const passwordForm = document.getElementById("passwordForm");
const passwordInput = document.getElementById("passwordInput");
const passwordError = document.getElementById("passwordError");

passwordForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (passwordInput.value === APP_PASSWORD) {
        passwordGate.hidden = true;
    } else {
        passwordError.hidden = false;
        passwordInput.value = "";
        passwordInput.focus();
    }
});
passwordInput.focus();

function confirmWithPassword(message) {
    if (!confirm(message)) return false;
    const pw = prompt("삭제하려면 비밀번호를 입력하세요");
    if (pw === null) return false;
    if (pw !== APP_PASSWORD) {
        alert("비밀번호가 틀렸어요.");
        return false;
    }
    return true;
}

// Only used to prettify old English folder-name keys when migrating legacy data.
const TYPE_LABELS = {
    "horns": "혼즈",
    "pick-and-roll": "픽앤롤",
    "motion-offense": "모션 오펜스",
    "isolation": "아이솔레이션",
    "fast-break": "속공",
    "set-play": "세트 플레이",
    "post-up": "포스트업",
    "zone-defense": "존 디펜스",
    "man-to-man": "맨투맨 디펜스",
    "trap": "트랩/더블팀",
    "switch": "스위치 디펜스",
    "press": "프레스"
};

function typeLabel(type) {
    if (!type) return "미분류";
    return TYPE_LABELS[type] || type;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---- YouTube URL parsing ----

function parseTimeParam(t) {
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (!m) return 0;
    const h = parseInt(m[1] || 0, 10), mi = parseInt(m[2] || 0, 10), s = parseInt(m[3] || 0, 10);
    return h * 3600 + mi * 60 + s;
}

function extractYoutube(url) {
    const raw = (url || "").trim();
    if (/^[\w-]{11}$/.test(raw)) return { videoId: raw, start: 0 };
    try {
        const u = new URL(raw);
        let id = null;
        if (u.hostname.includes("youtu.be")) {
            id = u.pathname.slice(1).split("/")[0];
        } else if (u.hostname.includes("youtube.com")) {
            if (u.pathname.startsWith("/watch")) id = u.searchParams.get("v");
            else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2];
            else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2];
        }
        if (!id) return null;
        const t = u.searchParams.get("t") || u.searchParams.get("start");
        return { videoId: id, start: t ? parseTimeParam(t) : 0 };
    } catch (e) {
        return null;
    }
}

function parseFlexibleTime(input) {
    const raw = (input || "").trim();
    if (!raw) return null;
    if (raw.includes(":")) {
        const parts = raw.split(":").map(p => parseInt(p, 10) || 0);
        return parts.reduce((sec, p) => sec * 60 + p, 0);
    }
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    return parseTimeParam(raw);
}

function formatTime(sec) {
    if (sec === null || sec === undefined) return null;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

// ---- Storage ----

const STORAGE_KEY = "bball_tactics_v1";

function defaultState() {
    return {
        plays: [],
        examplesByPlay: {},
        order: [],
        removedPlays: [],
        removedExamples: {},
        playOverrides: {},
        exampleOverrides: {},
        folders: {},
        folderOrderByParent: {},
        notes: []
    };
}

// Converts older saved shapes (flat type-string folders, notesOverride) into
// the id-based folder registry, without losing anything a user already added.
function migrateState(old) {
    const next = defaultState();
    next.plays = old.plays || [];
    next.examplesByPlay = old.examplesByPlay || {};
    next.order = old.order || [];
    next.removedPlays = old.removedPlays || [];
    next.removedExamples = old.removedExamples || {};
    next.notes = old.notes || (old.scratchpad ? [{ id: uid("note"), content: old.scratchpad, updatedAt: Date.now() }] : []);
    next.exampleOverrides = { ...(old.exampleOverrides || {}) };
    next.playOverrides = { ...(old.playOverrides || {}) };
    next.folders = { ...(old.folders || {}) };
    next.folderOrderByParent = { ...(old.folderOrderByParent || {}) };

    if (old.notesOverride) {
        Object.entries(old.notesOverride).forEach(([id, notes]) => {
            next.playOverrides[id] = { ...(next.playOverrides[id] || {}), notes };
        });
    }

    function findOrCreateRootFolder(category, name) {
        const dup = Object.entries(next.folders).find(([, f]) => f.category === category && !f.parentId && f.name === name);
        if (dup) return dup[0];
        const id = uid("folder");
        next.folders[id] = { category, parentId: null, name };
        const key = `${category}::root`;
        if (!next.folderOrderByParent[key]) next.folderOrderByParent[key] = [];
        next.folderOrderByParent[key].push(id);
        return id;
    }

    if (old.customFolders) {
        ["offense", "defense"].forEach(category => {
            const names = old.customFolders[category] || [];
            const orderNames = (old.folderOrder && old.folderOrder[category]) || [];
            const seq = [...orderNames, ...names.filter(n => !orderNames.includes(n))];
            seq.forEach(name => { if (name) findOrCreateRootFolder(category, name); });
        });
    }

    next.plays = next.plays.map(p => {
        if (p.folderId !== undefined || !p.type) return p;
        return { ...p, folderId: findOrCreateRootFolder(p.category, typeLabel(p.type)) };
    });

    return next;
}

function loadUserState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultState();
        return migrateState(JSON.parse(raw));
    } catch (e) {
        return defaultState();
    }
}

function saveUserState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(userState));
    } catch (e) {
        console.error("저장 실패", e);
    }
}

let basePlays = [];
let userState = loadUserState();
saveUserState();
let currentAll = [];
let activePlay = null;
let activeExampleIndex = 0;
let nav = { category: null, path: [] };

// ---- Folder registry helpers ----

function orderKey(category, parentId) {
    return `${category}::${parentId || "root"}`;
}

function foldersAt(category, parentId) {
    const key = orderKey(category, parentId);
    const ids = Object.keys(userState.folders).filter(id => {
        const f = userState.folders[id];
        return f.category === category && (f.parentId || null) === (parentId || null);
    });
    const orderArr = userState.folderOrderByParent[key] || [];
    const existing = orderArr.filter(id => ids.includes(id));
    const missing = ids.filter(id => !existing.includes(id));
    userState.folderOrderByParent[key] = [...existing, ...missing];
    saveUserState();
    return userState.folderOrderByParent[key];
}

function playsAt(category, parentId) {
    return currentAll.filter(p => p.category === category && (p.folderId || null) === (parentId || null));
}

function folderName(folderId) {
    if (!folderId) return "미분류";
    return userState.folders[folderId] ? userState.folders[folderId].name : "미분류";
}

function pathToFolder(folderId) {
    const path = [];
    let cur = folderId;
    while (cur) {
        path.unshift(cur);
        cur = userState.folders[cur] ? userState.folders[cur].parentId : null;
    }
    return path;
}

function currentFolderId() {
    return nav.path.length ? nav.path[nav.path.length - 1] : null;
}

function flattenFolders(category, parentId, depth) {
    const result = [];
    foldersAt(category, parentId).forEach(id => {
        result.push({ id, name: userState.folders[id].name, depth });
        result.push(...flattenFolders(category, id, depth + 1));
    });
    return result;
}

function populateFolderSelect(selectEl, category, selectedId) {
    const options = [`<option value="">(미분류 - 폴더 없음)</option>`];
    flattenFolders(category, null, 0).forEach(f => {
        const indent = "　".repeat(f.depth);
        options.push(`<option value="${f.id}">${indent}${escapeHtml(f.name)}</option>`);
    });
    selectEl.innerHTML = options.join("");
    selectEl.value = selectedId || "";
}

// ---- Merge base + user data ----

function computePlaysList() {
    const raw = [
        ...basePlays.filter(p => !userState.removedPlays.includes(p.id)),
        ...userState.plays.filter(p => !userState.removedPlays.includes(p.id))
    ].map(p => {
        const ov = userState.playOverrides[p.id] || {};
        return {
            ...p,
            title: ov.title !== undefined ? ov.title : p.title,
            category: ov.category !== undefined ? ov.category : p.category,
            folderId: ov.folderId !== undefined ? ov.folderId : (p.folderId || null),
            notes: ov.notes !== undefined ? ov.notes : p.notes,
            examples: [
                ...(p.examples || []).filter(ex => !(userState.removedExamples[p.id] || []).includes(ex.id)),
                ...(userState.examplesByPlay[p.id] || [])
            ].map(ex => ({ ...ex, ...(userState.exampleOverrides[ex.id] || {}) }))
        };
    });

    const allIds = raw.map(p => p.id);
    const existingOrder = userState.order.filter(id => allIds.includes(id));
    const missing = allIds.filter(id => !existingOrder.includes(id));
    userState.order = [...existingOrder, ...missing];
    saveUserState();

    const orderIdx = id => userState.order.indexOf(id);
    raw.sort((a, b) => orderIdx(a.id) - orderIdx(b.id));
    return raw;
}

// ---- Fetch base data ----

fetch("data/plays.json")
    .then(res => res.json())
    .then(data => {
        basePlays = data.plays || [];
        const baseFolders = data.folders || [];
        baseFolders.forEach(f => {
            if (!userState.folders[f.id]) {
                userState.folders[f.id] = { category: f.category, parentId: f.parentId || null, name: f.name };
            }
            const key = orderKey(f.category, f.parentId || null);
            if (!userState.folderOrderByParent[key]) userState.folderOrderByParent[key] = [];
            if (!userState.folderOrderByParent[key].includes(f.id)) userState.folderOrderByParent[key].push(f.id);
        });
        saveUserState();
        renderAll();
    })
    .catch(err => {
        document.getElementById("playGrid").innerHTML =
            `<p style="color:#9298c0">plays.json을 불러오지 못했어요. 로컬 서버(예: python3 -m http.server)로 열어보세요.</p>`;
        console.error(err);
    });

// ---- Elements ----

const state = { search: "" };

const playGrid = document.getElementById("playGrid");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const outlineList = document.getElementById("outlineList");
const breadcrumbEl = document.getElementById("breadcrumb");

searchInput.addEventListener("input", () => {
    state.search = searchInput.value.trim().toLowerCase();
    renderMain();
});

function clearSearch() {
    state.search = "";
    searchInput.value = "";
}

function matchesSearch(play) {
    if (!state.search) return true;
    const haystack = [play.title, play.notes, play.team, folderName(play.folderId), ...(play.tags || []), ...(play.examples || []).map(e => e.label)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return haystack.includes(state.search);
}

// ---- Render: dispatcher ----

function renderAll() {
    currentAll = computePlaysList();
    renderMain();
}

function renderMain() {
    renderBreadcrumb();
    if (state.search) {
        renderSearchResults();
    } else if (!nav.category) {
        renderCategoryRoot();
    } else {
        renderFolderView(nav.category, currentFolderId());
    }
    renderOutlinePanel();
}

function renderBreadcrumb() {
    const parts = [`<button class="crumb" data-nav-root>전체</button>`];
    if (state.search) {
        parts.push(`<span class="crumb-sep">/</span><span class="crumb current">"${escapeHtml(searchInput.value)}" 검색 결과</span>`);
    } else if (nav.category) {
        parts.push(`<span class="crumb-sep">/</span><button class="crumb" data-nav-depth="0">${CATEGORY_LABELS[nav.category]}</button>`);
        nav.path.forEach((folderId, i) => {
            const isLast = i === nav.path.length - 1;
            const name = folderName(folderId);
            parts.push(`<span class="crumb-sep">/</span>` + (isLast
                ? `<span class="crumb current">${escapeHtml(name)}</span>`
                : `<button class="crumb" data-nav-depth="${i + 1}">${escapeHtml(name)}</button>`));
        });
    }
    breadcrumbEl.innerHTML = parts.join("");
    breadcrumbEl.querySelector("[data-nav-root]")?.addEventListener("click", () => {
        clearSearch();
        nav = { category: null, path: [] };
        renderMain();
    });
    breadcrumbEl.querySelectorAll("[data-nav-depth]").forEach(btn => {
        btn.addEventListener("click", () => {
            clearSearch();
            nav.path = nav.path.slice(0, parseInt(btn.dataset.navDepth, 10));
            expandToNav();
            renderMain();
        });
    });
}

// ---- Render: category root ----

function renderCategoryRoot() {
    emptyState.hidden = true;
    playGrid.classList.add("category-grid");
    const cats = ["offense", "defense"];
    playGrid.innerHTML = cats.map(c => {
        const plays = currentAll.filter(p => p.category === c);
        const folderCount = foldersAt(c, null).length;
        return `
            <article class="folder-card category-card" data-category="${c}">
                <h3 class="folder-name">${CATEGORY_LABELS[c]}</h3>
                <p class="folder-meta">폴더 ${folderCount}개 · 전술 ${plays.length}개</p>
            </article>
        `;
    }).join("");

    playGrid.querySelectorAll(".category-card").forEach(card => {
        card.addEventListener("click", () => {
            nav.category = card.dataset.category;
            nav.path = [];
            expandToNav();
            renderMain();
        });
    });
}

// ---- Render: folders + plays at the current level ----

function renderFolderView(category, parentId) {
    playGrid.classList.remove("category-grid");
    const folders = foldersAt(category, parentId);
    const plays = playsAt(category, parentId);
    emptyState.hidden = !(folders.length === 0 && plays.length === 0);
    emptyState.textContent = "여기엔 아직 아무것도 없어요. '+ 새 폴더'를 만들거나 전술을 추가해보세요.";

    const folderCards = folders.map(id => {
        const f = userState.folders[id];
        const subCount = foldersAt(category, id).length;
        const playCount = playsAt(category, id).length;
        const canDelete = subCount === 0 && playCount === 0;
        return `
            <article class="folder-card" data-folder-id="${id}">
                <div class="folder-card-actions">
                    <button class="icon-btn folder-rename" title="이름 수정">✎</button>
                    <button class="icon-btn folder-delete" title="삭제" ${canDelete ? "" : "hidden"}>&times;</button>
                </div>
                <h3 class="folder-name">${escapeHtml(f.name)}</h3>
                <p class="folder-meta">${subCount > 0 ? `하위 폴더 ${subCount}개 · ` : ""}전술 ${playCount}개</p>
            </article>
        `;
    }).join("");

    const addCard = `
        <button type="button" class="folder-card folder-add" id="addFolderCard">
            <h3 class="folder-name">+ 새 폴더</h3>
        </button>
    `;

    playGrid.innerHTML = folderCards + plays.map(playCardHtml).join("") + addCard;

    playGrid.querySelectorAll(".folder-card[data-folder-id]").forEach(card => {
        const id = card.dataset.folderId;
        card.addEventListener("click", (e) => {
            if (e.target.closest(".folder-rename") || e.target.closest(".folder-delete")) return;
            nav.path = [...nav.path, id];
            expandToNav();
            renderMain();
        });
        card.querySelector(".folder-rename").addEventListener("click", (e) => {
            e.stopPropagation();
            renameFolder(id);
        });
        card.querySelector(".folder-delete").addEventListener("click", (e) => {
            e.stopPropagation();
            deleteFolder(id);
        });
    });

    attachPlayCardHandlers();
    document.getElementById("addFolderCard").addEventListener("click", () => openAddFolder(category, parentId));
}

function renameFolder(id) {
    const f = userState.folders[id];
    if (!f) return;
    const name = prompt("폴더 이름", f.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    f.name = trimmed;
    saveUserState();
    renderMain();
}

function deleteFolder(id) {
    const f = userState.folders[id];
    if (!f) return;
    if (foldersAt(f.category, id).length > 0 || playsAt(f.category, id).length > 0) {
        alert("폴더 안에 하위 폴더나 전술이 있어서 삭제할 수 없어요. 먼저 비워주세요.");
        return;
    }
    if (!confirmWithPassword("이 폴더를 삭제할까요?")) return;
    delete userState.folders[id];
    Object.keys(userState.folderOrderByParent).forEach(key => {
        userState.folderOrderByParent[key] = userState.folderOrderByParent[key].filter(x => x !== id);
    });
    saveUserState();
    if (nav.path.includes(id)) nav.path = nav.path.slice(0, nav.path.indexOf(id));
    renderMain();
}

// ---- Render: search results ----

function renderSearchResults() {
    playGrid.classList.remove("category-grid");
    const list = currentAll.filter(matchesSearch);
    emptyState.hidden = list.length !== 0;
    emptyState.textContent = "검색 결과가 없어요.";
    playGrid.innerHTML = list.map(playCardHtml).join("");
    attachPlayCardHandlers();
}

function attachPlayCardHandlers() {
    playGrid.querySelectorAll(".play-card").forEach(card => {
        const id = card.dataset.id;
        card.addEventListener("click", (e) => {
            if (e.target.closest(".pill-btn") || e.target.closest(".icon-btn")) return;
            openPlay(id, 0);
        });
        card.querySelectorAll(".pill-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                openPlay(id, parseInt(btn.dataset.idx, 10));
            });
        });
        card.querySelector(".pill-add")?.addEventListener("click", (e) => {
            e.stopPropagation();
            openAddExample(id);
        });
        card.querySelector(".delete-play")?.addEventListener("click", (e) => {
            e.stopPropagation();
            deletePlay(id);
        });
    });
}

function playCardHtml(play) {
    const examples = play.examples || [];
    return `
        <article class="play-card" data-id="${play.id}">
            <div class="play-card-head">
                <h3 class="play-title">${escapeHtml(play.title)}</h3>
                <button class="icon-btn delete-play" title="전술 삭제">&times;</button>
            </div>
            <div class="badges">
                <span class="badge cat-${play.category}">${CATEGORY_LABELS[play.category] || play.category}</span>
                <span class="badge">${escapeHtml(folderName(play.folderId))}</span>
            </div>
            ${play.notes ? `<p class="card-notes">${escapeHtml(play.notes)}</p>` : ""}
            <div class="example-pills">
                ${examples.map((ex, i) => `<button class="pill-btn" data-idx="${i}" title="${escapeHtml(ex.label || '')}">${i + 1}</button>`).join("")}
                <button class="pill-btn pill-add" title="예시 영상 추가">+</button>
            </div>
        </article>
    `;
}

function deletePlay(id) {
    if (!confirmWithPassword("이 전술을 삭제할까요? (이 브라우저에서만 사라져요)")) return;
    userState.removedPlays.push(id);
    saveUserState();
    renderAll();
}

// ---- Right-side outline panel: a persistent expandable tree ----

let treeExpanded = { offense: false, defense: false, folders: {} };

function expandToNav() {
    if (!nav.category) return;
    treeExpanded[nav.category] = true;
    nav.path.forEach(id => { treeExpanded.folders[id] = true; });
}

function renderOutlinePanel() {
    renderTree();
}

function renderTree() {
    outlineList.innerHTML = ["offense", "defense"].map(categoryNodeHtml).join("");
    wireTree();
}

function categoryNodeHtml(category) {
    const expanded = treeExpanded[category];
    const totalPlays = currentAll.filter(p => p.category === category).length;
    const topFolders = foldersAt(category, null);
    const topPlays = playsAt(category, null);
    const hasChildren = topFolders.length > 0 || topPlays.length > 0;
    const childrenHtml = expanded && hasChildren ? `
        <ul class="tree-children">
            ${topFolders.map(id => folderNodeHtml(category, id)).join("")}
            ${topPlays.map(p => playNodeHtml(p)).join("")}
        </ul>
    ` : "";
    return `
        <li class="tree-node">
            <div class="tree-row">
                <button class="tree-toggle ${hasChildren ? "" : "leaf"}" data-toggle="cat" data-category="${category}">${expanded ? "▾" : "▸"}</button>
                <span class="tree-label" data-nav-cat="${category}">${CATEGORY_LABELS[category]}</span>
                <span class="tree-count">${totalPlays}</span>
            </div>
            ${childrenHtml}
        </li>
    `;
}

function folderNodeHtml(category, folderId) {
    const f = userState.folders[folderId];
    if (!f) return "";
    const expanded = !!treeExpanded.folders[folderId];
    const subfolders = foldersAt(category, folderId);
    const plays = playsAt(category, folderId);
    const hasChildren = subfolders.length > 0 || plays.length > 0;
    const childrenHtml = expanded && hasChildren ? `
        <ul class="tree-children">
            ${subfolders.map(id => folderNodeHtml(category, id)).join("")}
            ${plays.map(p => playNodeHtml(p)).join("")}
        </ul>
    ` : "";
    return `
        <li class="tree-node tree-folder" draggable="true" data-category="${category}" data-parent="${f.parentId || ""}" data-folder-id="${folderId}">
            <div class="tree-row">
                <button class="tree-toggle ${hasChildren ? "" : "leaf"}" data-toggle="folder" data-folder-id="${folderId}">${expanded ? "▾" : "▸"}</button>
                <span class="drag-handle">⋮⋮</span>
                <span class="tree-label" data-nav-folder-id="${folderId}">${escapeHtml(f.name)}</span>
                <span class="tree-count">${plays.length}</span>
                <button class="icon-btn tree-rename" data-rename-folder="${folderId}" title="이름 수정">✎</button>
                <button class="icon-btn tree-delete" data-delete-folder="${folderId}" title="삭제" ${(subfolders.length === 0 && plays.length === 0) ? "" : "hidden"}>&times;</button>
            </div>
            ${childrenHtml}
        </li>
    `;
}

function playNodeHtml(play) {
    return `
        <li class="tree-node tree-play" draggable="true" data-category="${play.category}" data-folder="${play.folderId || ""}" data-id="${play.id}">
            <div class="tree-row tree-play-row">
                <span class="tree-toggle leaf"></span>
                <span class="drag-handle">⋮⋮</span>
                <span class="tree-label" data-nav-play="${play.id}">${escapeHtml(play.title)}</span>
            </div>
        </li>
    `;
}

let dragInfo = null;

function wireTree() {
    outlineList.querySelectorAll("[data-toggle]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (btn.dataset.toggle === "cat") {
                treeExpanded[btn.dataset.category] = !treeExpanded[btn.dataset.category];
            } else {
                const id = btn.dataset.folderId;
                treeExpanded.folders[id] = !treeExpanded.folders[id];
            }
            renderTree();
        });
    });

    outlineList.querySelectorAll("[data-nav-cat]").forEach(el => {
        el.addEventListener("click", () => {
            clearSearch();
            nav.category = el.dataset.navCat;
            nav.path = [];
            treeExpanded[nav.category] = true;
            renderMain();
        });
    });

    outlineList.querySelectorAll("[data-nav-folder-id]").forEach(el => {
        el.addEventListener("click", () => {
            clearSearch();
            const id = el.dataset.navFolderId;
            const f = userState.folders[id];
            if (!f) return;
            nav.category = f.category;
            nav.path = pathToFolder(id);
            expandToNav();
            renderMain();
        });
    });

    outlineList.querySelectorAll("[data-nav-play]").forEach(el => {
        el.addEventListener("click", () => openPlay(el.dataset.navPlay, 0));
    });

    outlineList.querySelectorAll("[data-rename-folder]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            renameFolder(btn.dataset.renameFolder);
        });
    });

    outlineList.querySelectorAll("[data-delete-folder]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteFolder(btn.dataset.deleteFolder);
        });
    });

    outlineList.querySelectorAll('.tree-folder[draggable="true"]').forEach(li => {
        const category = li.dataset.category;
        const parent = li.dataset.parent || null;
        const id = li.dataset.folderId;

        li.addEventListener("dragstart", (e) => {
            e.stopPropagation();
            dragInfo = { type: "folder", category, parent, id };
            li.classList.add("dragging");
        });

        li.addEventListener("dragend", () => {
            li.classList.remove("dragging");
            dragInfo = null;
            saveUserState();
            renderMain();
        });

        li.addEventListener("dragover", (e) => {
            if (!dragInfo || dragInfo.type !== "folder" || dragInfo.category !== category || (dragInfo.parent || null) !== (parent || null)) return;
            e.preventDefault();
            e.stopPropagation();
            if (dragInfo.id === id) return;
            const key = orderKey(category, parent);
            const arr = userState.folderOrderByParent[key];
            const from = arr.indexOf(dragInfo.id);
            const to = arr.indexOf(id);
            if (from === -1 || to === -1 || from === to) return;
            arr.splice(from, 1);
            arr.splice(to, 0, dragInfo.id);
            renderTree();
        });
    });

    outlineList.querySelectorAll('.tree-play[draggable="true"]').forEach(li => {
        const id = li.dataset.id;
        const category = li.dataset.category;
        const folder = li.dataset.folder || null;

        li.addEventListener("dragstart", (e) => {
            e.stopPropagation();
            dragInfo = { type: "play", id, category, folder };
            li.classList.add("dragging");
        });

        li.addEventListener("dragend", () => {
            li.classList.remove("dragging");
            dragInfo = null;
            saveUserState();
            renderMain();
        });

        li.addEventListener("dragover", (e) => {
            if (!dragInfo || dragInfo.type !== "play" || dragInfo.category !== category || (dragInfo.folder || null) !== (folder || null)) return;
            e.preventDefault();
            e.stopPropagation();
            if (dragInfo.id === id) return;
            const from = userState.order.indexOf(dragInfo.id);
            const to = userState.order.indexOf(id);
            if (from === -1 || to === -1 || from === to) return;
            userState.order.splice(from, 1);
            userState.order.splice(to, 0, dragInfo.id);
            const fromIdx = currentAll.findIndex(p => p.id === dragInfo.id);
            const [moved] = currentAll.splice(fromIdx, 1);
            const toIdx = currentAll.findIndex(p => p.id === id);
            currentAll.splice(toIdx, 0, moved);
            renderTree();
        });
    });
}

// ---- Modal / Player ----

const clipModal = document.getElementById("clipModal");
const modalTitle = document.getElementById("modalTitle");
const modalBadges = document.getElementById("modalBadges");
const modalNotes = document.getElementById("modalNotes");
const youtubePlayerEl = document.getElementById("youtubePlayer");
const localPlayerEl = document.getElementById("localPlayer");
const playerFallback = document.getElementById("playerFallback");
const playerFallbackLink = document.getElementById("playerFallbackLink");
const replayBtn = document.getElementById("replayBtn");

function showPlayerFallback(clip, message) {
    playerFallback.querySelector("p").innerHTML = message;
    playerFallbackLink.href = `https://www.youtube.com/watch?v=${clip.youtubeId}${clip.start ? `&t=${clip.start}s` : ""}`;
    playerFallback.hidden = false;
}

function hidePlayerFallback() {
    playerFallback.hidden = true;
}
const exampleSwitcher = document.getElementById("exampleSwitcher");
const currentExampleLabel = document.getElementById("currentExampleLabel");
const editNotesBtn = document.getElementById("editNotesBtn");
const modalNotesEdit = document.getElementById("modalNotesEdit");
const notesEditActions = document.getElementById("notesEditActions");
const saveNotesBtn = document.getElementById("saveNotesBtn");
const cancelNotesBtn = document.getElementById("cancelNotesBtn");

let ytApiReady = false;
let ytPlayer = null;

function openPlay(id, exampleIndex) {
    const play = currentAll.find(p => p.id === id);
    if (!play || !(play.examples || []).length) return;
    activePlay = play;
    activeExampleIndex = Math.min(exampleIndex, play.examples.length - 1);

    modalTitle.textContent = play.title;
    modalBadges.innerHTML = `
        <span class="badge cat-${play.category}">${CATEGORY_LABELS[play.category] || play.category}</span>
        <span class="badge">${escapeHtml(folderName(play.folderId))}</span>
        ${(play.tags || []).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join("")}
    `;
    modalNotes.textContent = play.notes || "";
    exitNotesEditMode();

    renderExampleSwitcher();
    clipModal.hidden = false;
    playActiveExample();
}

function exitNotesEditMode() {
    modalNotesEdit.hidden = true;
    notesEditActions.hidden = true;
    modalNotes.hidden = false;
}

editNotesBtn.addEventListener("click", () => {
    if (!activePlay) return;
    modalNotesEdit.value = activePlay.notes || "";
    modalNotes.hidden = true;
    modalNotesEdit.hidden = false;
    notesEditActions.hidden = false;
    modalNotesEdit.focus();
});

cancelNotesBtn.addEventListener("click", exitNotesEditMode);

saveNotesBtn.addEventListener("click", () => {
    if (!activePlay) return;
    const val = modalNotesEdit.value.trim();
    userState.playOverrides[activePlay.id] = { ...(userState.playOverrides[activePlay.id] || {}), notes: val };
    saveUserState();
    activePlay.notes = val;
    modalNotes.textContent = val;
    exitNotesEditMode();
    renderAll();
});

function renderExampleSwitcher() {
    exampleSwitcher.innerHTML = activePlay.examples.map((ex, i) => `
        <button class="pill-btn ${i === activeExampleIndex ? "active" : ""}" data-idx="${i}">${i + 1}</button>
    `).join("");
    exampleSwitcher.querySelectorAll(".pill-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            activeExampleIndex = parseInt(btn.dataset.idx, 10);
            renderExampleSwitcher();
            playActiveExample();
        });
    });
    const ex = activePlay.examples[activeExampleIndex];
    const base = ex.label ? `${activeExampleIndex + 1}번: ${ex.label}` : `${activeExampleIndex + 1}번`;
    const startStr = formatTime(ex.start || 0);
    const endStr = formatTime(ex.end);
    const range = (ex.start || ex.end) ? ` (${startStr}~${endStr || ""})` : "";
    currentExampleLabel.textContent = base + range;
}

function playActiveExample() {
    hidePlayerFallback();
    const clip = activePlay.examples[activeExampleIndex];
    if (clip.source === "local") {
        youtubePlayerEl.hidden = true;
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
        localPlayerEl.hidden = false;
        playLocalClip(clip);
    } else {
        localPlayerEl.hidden = true;
        localPlayerEl.pause();
        youtubePlayerEl.hidden = false;
        playYoutubeClip(clip);
    }
}

function closeClipModal() {
    clipModal.hidden = true;
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    localPlayerEl.pause();
    hidePlayerFallback();
    activePlay = null;
}

document.getElementById("closeModal").addEventListener("click", closeClipModal);
document.getElementById("modalBackdrop").addEventListener("click", closeClipModal);

replayBtn.addEventListener("click", () => {
    if (activePlay) playActiveExample();
});

document.getElementById("addExampleBtn").addEventListener("click", () => {
    if (activePlay) openAddExample(activePlay.id);
});

document.getElementById("editPlayBtn").addEventListener("click", () => {
    if (activePlay) openEditPlay(activePlay);
});

document.getElementById("editExampleBtn").addEventListener("click", () => {
    if (activePlay) openEditExample(activePlay.id, activePlay.examples[activeExampleIndex]);
});

function onYouTubeIframeAPIReady() {
    ytApiReady = true;
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

let ytErrorHandlerClip = null;

function playYoutubeClip(clip, attempt) {
    attempt = attempt || 0;
    ytErrorHandlerClip = clip;
    if (!ytApiReady || typeof YT === "undefined") {
        if (attempt >= 25) {
            showPlayerFallback(clip, "유튜브 플레이어를 불러오지 못했어요.<br>광고 차단 확장 프로그램이나 추적 방지 기능을 꺼보시거나, 아래 링크로 직접 열어보세요.");
            return;
        }
        setTimeout(() => playYoutubeClip(clip, attempt + 1), 200);
        return;
    }
    if (ytPlayer) {
        ytPlayer.loadVideoById({
            videoId: clip.youtubeId,
            startSeconds: clip.start || 0,
            endSeconds: clip.end || undefined
        });
    } else {
        ytPlayer = new YT.Player("youtubePlayer", {
            width: "100%",
            height: "100%",
            videoId: clip.youtubeId,
            playerVars: {
                start: clip.start || 0,
                end: clip.end || undefined,
                autoplay: 1,
                playsinline: 1,
                rel: 0
            },
            events: {
                onError: () => showPlayerFallback(
                    ytErrorHandlerClip,
                    "이 영상은 재생할 수 없어요 (비공개/삭제되었거나 임베드가 막혀 있을 수 있어요).<br>아래 링크로 직접 열어보세요."
                )
            }
        });
    }
}

function playLocalClip(clip) {
    localPlayerEl.src = `videos/${clip.file}`;
    localPlayerEl.currentTime = clip.start || 0;

    const onLoaded = () => {
        localPlayerEl.currentTime = clip.start || 0;
        localPlayerEl.play();
        localPlayerEl.removeEventListener("loadedmetadata", onLoaded);
    };
    localPlayerEl.addEventListener("loadedmetadata", onLoaded);

    localPlayerEl.ontimeupdate = () => {
        if (clip.end && localPlayerEl.currentTime >= clip.end) {
            localPlayerEl.pause();
        }
    };
}

// ---- Add / Edit Play ----

function resolveClipTiming(fd, fallbackStart) {
    const startInput = parseFlexibleTime(fd.get("startTime"));
    const endInput = parseFlexibleTime(fd.get("endTime"));
    const start = startInput !== null ? startInput : fallbackStart;
    if (endInput !== null && endInput <= start) {
        alert("종료 시간은 시작 시간보다 커야 해요.");
        return null;
    }
    return { start, end: endInput };
}

const addPlayModal = document.getElementById("addPlayModal");
const addPlayForm = document.getElementById("addPlayForm");
const addPlayTitleEl = document.getElementById("addPlayTitle");
const addPlaySubmitEl = document.getElementById("addPlaySubmit");
const addPlayVideoFields = document.getElementById("addPlayVideoFields");
const addPlayCategorySelect = document.getElementById("addPlayCategory");
const addPlayFolderSelect = document.getElementById("addPlayFolder");
let editPlayTargetId = null;

function openAddPlay() {
    editPlayTargetId = null;
    addPlayForm.reset();
    addPlayTitleEl.textContent = "새 전술 추가";
    addPlaySubmitEl.textContent = "추가하기";
    addPlayVideoFields.hidden = false;
    const category = nav.category || "offense";
    addPlayCategorySelect.value = category;
    populateFolderSelect(addPlayFolderSelect, category, currentFolderId());
    addPlayModal.hidden = false;
}

function openEditPlay(play) {
    editPlayTargetId = play.id;
    addPlayForm.reset();
    addPlayTitleEl.textContent = "전술 정보 수정";
    addPlaySubmitEl.textContent = "저장하기";
    addPlayVideoFields.hidden = true;
    addPlayForm.title.value = play.title;
    addPlayForm.notes.value = play.notes || "";
    addPlayCategorySelect.value = play.category;
    populateFolderSelect(addPlayFolderSelect, play.category, play.folderId || "");
    addPlayModal.hidden = false;
}

document.getElementById("addPlayFab").addEventListener("click", openAddPlay);
document.getElementById("closeAddPlay").addEventListener("click", () => addPlayModal.hidden = true);
document.getElementById("addPlayBackdrop").addEventListener("click", () => addPlayModal.hidden = true);

addPlayCategorySelect.addEventListener("change", () => {
    populateFolderSelect(addPlayFolderSelect, addPlayCategorySelect.value, "");
});

addPlayForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(addPlayForm);
    const title = fd.get("title").trim();
    const category = fd.get("category");
    const folderId = fd.get("folderId") || null;
    const notes = fd.get("notes").trim();

    if (editPlayTargetId) {
        userState.playOverrides[editPlayTargetId] = {
            ...(userState.playOverrides[editPlayTargetId] || {}),
            title, category, folderId, notes
        };
        saveUserState();
        addPlayModal.hidden = true;
        nav.category = category;
        nav.path = pathToFolder(folderId);
        expandToNav();
        clearSearch();
        renderAll();
        if (activePlay && activePlay.id === editPlayTargetId) {
            const refreshed = currentAll.find(p => p.id === editPlayTargetId);
            if (refreshed) openPlay(editPlayTargetId, activeExampleIndex);
        }
        return;
    }

    const parsed = extractYoutube(fd.get("videoUrl"));
    if (!parsed) {
        alert("유튜브 링크를 확인해주세요.");
        return;
    }
    const timing = resolveClipTiming(fd, parsed.start);
    if (!timing) return;
    const play = {
        id: uid("play"),
        title,
        category,
        folderId,
        tags: [],
        team: "",
        notes,
        examples: [{
            id: uid("ex"),
            label: fd.get("exampleLabel").trim(),
            source: "youtube",
            youtubeId: parsed.videoId,
            start: timing.start,
            end: timing.end
        }],
        dateAdded: new Date().toISOString().slice(0, 10)
    };
    userState.plays.push(play);
    userState.order.unshift(play.id);
    saveUserState();
    addPlayForm.reset();
    addPlayModal.hidden = true;
    nav.category = category;
    nav.path = pathToFolder(folderId);
    expandToNav();
    clearSearch();
    renderAll();
});

// ---- Add / Edit Example ----

const addExampleModal = document.getElementById("addExampleModal");
const addExampleForm = document.getElementById("addExampleForm");
const addExampleTitleEl = document.getElementById("addExampleTitle");
const addExampleSubmitEl = document.getElementById("addExampleSubmit");
let addExampleTargetId = null;
let editExampleTargetId = null;

function openAddExample(playId) {
    editExampleTargetId = null;
    addExampleTargetId = playId;
    addExampleForm.reset();
    addExampleTitleEl.textContent = "예시 영상 추가";
    addExampleSubmitEl.textContent = "추가하기";
    addExampleModal.hidden = false;
}

function openEditExample(playId, example) {
    editExampleTargetId = example.id;
    addExampleTargetId = playId;
    addExampleForm.reset();
    addExampleTitleEl.textContent = "영상 정보 수정";
    addExampleSubmitEl.textContent = "저장하기";
    addExampleForm.videoUrl.value = example.youtubeId ? `https://www.youtube.com/watch?v=${example.youtubeId}` : "";
    addExampleForm.startTime.value = example.start ? formatTime(example.start) : "";
    addExampleForm.endTime.value = example.end ? formatTime(example.end) : "";
    addExampleForm.exampleLabel.value = example.label || "";
    addExampleModal.hidden = false;
}

document.getElementById("closeAddExample").addEventListener("click", () => addExampleModal.hidden = true);
document.getElementById("addExampleBackdrop").addEventListener("click", () => addExampleModal.hidden = true);

addExampleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(addExampleForm);
    const parsed = extractYoutube(fd.get("videoUrl"));
    if (!parsed) {
        alert("유튜브 링크를 확인해주세요.");
        return;
    }
    const timing = resolveClipTiming(fd, parsed.start);
    if (!timing) return;

    if (editExampleTargetId) {
        userState.exampleOverrides[editExampleTargetId] = {
            label: fd.get("exampleLabel").trim(),
            source: "youtube",
            youtubeId: parsed.videoId,
            start: timing.start,
            end: timing.end
        };
        saveUserState();
        addExampleModal.hidden = true;
        renderAll();
        if (activePlay && activePlay.id === addExampleTargetId) {
            const refreshed = currentAll.find(p => p.id === addExampleTargetId);
            if (refreshed) openPlay(addExampleTargetId, activeExampleIndex);
        }
        return;
    }

    const example = {
        id: uid("ex"),
        label: fd.get("exampleLabel").trim(),
        source: "youtube",
        youtubeId: parsed.videoId,
        start: timing.start,
        end: timing.end
    };
    if (!userState.examplesByPlay[addExampleTargetId]) userState.examplesByPlay[addExampleTargetId] = [];
    userState.examplesByPlay[addExampleTargetId].push(example);
    saveUserState();
    addExampleModal.hidden = true;

    renderAll();
    if (activePlay && activePlay.id === addExampleTargetId) {
        const refreshed = currentAll.find(p => p.id === addExampleTargetId);
        if (refreshed) openPlay(addExampleTargetId, refreshed.examples.length - 1);
    }
});

// ---- Add Folder ----

const addFolderModal = document.getElementById("addFolderModal");
const addFolderForm = document.getElementById("addFolderForm");
const addFolderCategorySelect = document.getElementById("addFolderCategory");
const addFolderCategoryField = document.getElementById("addFolderCategoryField");
const addFolderHint = document.getElementById("addFolderHint");
let addFolderParent = null;
let addFolderLockedCategory = null;

function openAddFolder(category, parentId) {
    addFolderParent = parentId || null;
    addFolderLockedCategory = category || null;
    addFolderForm.reset();
    addFolderCategorySelect.value = category || "offense";
    addFolderCategoryField.hidden = !!category;
    addFolderHint.textContent = addFolderParent
        ? `"${folderName(addFolderParent)}" 폴더 안에 추가돼요.`
        : (category ? `${CATEGORY_LABELS[category]} 최상위 폴더로 추가돼요.` : "최상위 폴더로 추가돼요.");
    addFolderModal.hidden = false;
}

document.getElementById("addFolderFab").addEventListener("click", () => {
    openAddFolder(nav.category, currentFolderId());
});

document.getElementById("closeAddFolder").addEventListener("click", () => addFolderModal.hidden = true);
document.getElementById("addFolderBackdrop").addEventListener("click", () => addFolderModal.hidden = true);

addFolderForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(addFolderForm);
    const name = fd.get("folderName").trim();
    if (!name) return;
    const category = addFolderLockedCategory || fd.get("category");
    const id = uid("folder");
    userState.folders[id] = { category, parentId: addFolderParent, name };
    const key = orderKey(category, addFolderParent);
    if (!userState.folderOrderByParent[key]) userState.folderOrderByParent[key] = [];
    userState.folderOrderByParent[key].unshift(id);
    saveUserState();
    addFolderModal.hidden = true;
    nav.category = category;
    nav.path = pathToFolder(id);
    expandToNav();
    renderAll();
});

// ---- Notepad (multiple notes, browsable list) ----

const notepadModal = document.getElementById("notepadModal");
const notepadText = document.getElementById("notepadText");
const notepadList = document.getElementById("notepadList");
const deleteNoteBtn = document.getElementById("deleteNoteBtn");
let notepadSaveTimer = null;
let activeNoteId = null;

function sortedNotes() {
    return [...userState.notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

function noteLabel(note) {
    const firstLine = (note.content || "").split("\n")[0].trim();
    return (firstLine || "새 메모").slice(0, 28);
}

function renderNotepadList() {
    notepadList.innerHTML = sortedNotes().map(n => `
        <li class="notepad-item ${n.id === activeNoteId ? "active" : ""}" data-id="${n.id}">${escapeHtml(noteLabel(n))}</li>
    `).join("");
    notepadList.querySelectorAll(".notepad-item").forEach(li => {
        li.addEventListener("click", () => selectNote(li.dataset.id));
    });
}

function selectNote(id) {
    activeNoteId = id;
    const note = userState.notes.find(n => n.id === id);
    notepadText.value = note ? note.content : "";
    notepadText.disabled = !note;
    deleteNoteBtn.hidden = !note;
    renderNotepadList();
}

function createNote() {
    const note = { id: uid("note"), content: "", updatedAt: Date.now() };
    userState.notes.push(note);
    saveUserState();
    selectNote(note.id);
    notepadText.focus();
}

document.getElementById("notepadBtn").addEventListener("click", () => {
    notepadModal.hidden = false;
    if (userState.notes.length === 0) createNote();
    else selectNote(sortedNotes()[0].id);
    notepadText.focus();
});
document.getElementById("closeNotepad").addEventListener("click", () => notepadModal.hidden = true);
document.getElementById("notepadBackdrop").addEventListener("click", () => notepadModal.hidden = true);
document.getElementById("newNoteBtn").addEventListener("click", createNote);

deleteNoteBtn.addEventListener("click", () => {
    if (!activeNoteId || !confirm("이 메모를 삭제할까요?")) return;
    userState.notes = userState.notes.filter(n => n.id !== activeNoteId);
    saveUserState();
    const rest = sortedNotes();
    if (rest.length) selectNote(rest[0].id);
    else {
        activeNoteId = null;
        notepadText.value = "";
        notepadText.disabled = true;
        deleteNoteBtn.hidden = true;
        renderNotepadList();
    }
});

notepadText.addEventListener("input", () => {
    clearTimeout(notepadSaveTimer);
    notepadSaveTimer = setTimeout(() => {
        const note = userState.notes.find(n => n.id === activeNoteId);
        if (!note) return;
        note.content = notepadText.value;
        note.updatedAt = Date.now();
        saveUserState();
        renderNotepadList();
    }, 400);
});

// ---- Export ----

document.getElementById("exportBtn").addEventListener("click", () => {
    const foldersArr = Object.entries(userState.folders).map(([id, f]) => ({ id, category: f.category, parentId: f.parentId, name: f.name }));
    const plays = currentAll.map(({ id, title, category, folderId, tags, team, notes, examples, dateAdded }) => ({
        id, title, category, folderId: folderId || null, tags, team, notes,
        examples: examples.map(({ id, label, source, youtubeId, file, start, end }) => ({ id, label, source, youtubeId, file, start, end })),
        dateAdded
    }));
    const blob = new Blob([JSON.stringify({ folders: foldersArr, plays }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "plays.json";
    a.click();
    URL.revokeObjectURL(a.href);
});

// ---- Guide modal ----

const guideModal = document.getElementById("guideModal");
document.getElementById("guideBtn").addEventListener("click", () => guideModal.hidden = false);
document.getElementById("closeGuide").addEventListener("click", () => guideModal.hidden = true);
document.getElementById("guideBackdrop").addEventListener("click", () => guideModal.hidden = true);

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeClipModal();
        guideModal.hidden = true;
        addPlayModal.hidden = true;
        addExampleModal.hidden = true;
        addFolderModal.hidden = true;
        notepadModal.hidden = true;
    }
});
