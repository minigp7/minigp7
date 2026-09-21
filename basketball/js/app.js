const CATEGORY_LABELS = {
    offense: "공격",
    defense: "수비"
};

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
        notesOverride: {},
        customFolders: { offense: [], defense: [] },
        folderOrder: { offense: [], defense: [] }
    };
}

function loadUserState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultState();
        const parsed = JSON.parse(raw);
        const merged = { ...defaultState(), ...parsed };
        merged.customFolders = { ...defaultState().customFolders, ...(parsed.customFolders || {}) };
        merged.folderOrder = { ...defaultState().folderOrder, ...(parsed.folderOrder || {}) };
        return merged;
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
let currentAll = [];
let activePlay = null;
let activeExampleIndex = 0;
let nav = { category: null, folder: null };

// ---- Merge base + user data ----

function computePlaysList() {
    const raw = [
        ...basePlays.filter(p => !userState.removedPlays.includes(p.id)),
        ...userState.plays.filter(p => !userState.removedPlays.includes(p.id))
    ].map(p => ({
        ...p,
        notes: userState.notesOverride[p.id] !== undefined ? userState.notesOverride[p.id] : p.notes,
        examples: [
            ...(p.examples || []).filter(ex => !(userState.removedExamples[p.id] || []).includes(ex.id)),
            ...(userState.examplesByPlay[p.id] || [])
        ]
    }));

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
        basePlays = data;
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
const outlinePanel = document.getElementById("outlinePanel");
const outlineTitle = document.getElementById("outlineTitle");
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
    const haystack = [play.title, play.notes, play.team, typeLabel(play.type), ...(play.tags || []), ...(play.examples || []).map(e => e.label)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return haystack.includes(state.search);
}

// ---- Folder helpers ----

function foldersForCategory(category) {
    const fromPlays = new Set(currentAll.filter(p => p.category === category && p.type).map(p => p.type));
    const custom = userState.customFolders[category] || [];
    const names = new Set([...fromPlays, ...custom]);
    const orderArr = userState.folderOrder[category] || [];
    const existing = orderArr.filter(n => names.has(n));
    const missing = [...names].filter(n => !existing.includes(n));
    userState.folderOrder[category] = [...existing, ...missing];
    saveUserState();
    return userState.folderOrder[category];
}

function unfiledCount(category) {
    return currentAll.filter(p => p.category === category && !p.type).length;
}

function playsInFolder(category, folder) {
    return currentAll.filter(p => p.category === category && (p.type || "") === (folder || ""));
}

function populateFolderDatalist() {
    const names = new Set([...Object.keys(TYPE_LABELS), ...currentAll.map(p => p.type).filter(Boolean)]);
    document.getElementById("typeSuggestions").innerHTML =
        [...names].map(t => `<option value="${escapeHtml(t)}">${escapeHtml(typeLabel(t))}</option>`).join("");
}

// ---- Render: dispatcher ----

function renderAll() {
    currentAll = computePlaysList();
    populateFolderDatalist();
    renderMain();
}

function renderMain() {
    renderBreadcrumb();
    if (state.search) {
        renderSearchResults();
    } else if (!nav.category) {
        renderCategoryRoot();
    } else if (!nav.folder) {
        renderFolderList(nav.category);
    } else {
        renderPlaysInFolder(nav.category, nav.folder);
    }
    renderOutlinePanel();
}

function renderBreadcrumb() {
    const parts = [`<button class="crumb" data-nav="root">전체</button>`];
    if (state.search) {
        parts.push(`<span class="crumb-sep">/</span><span class="crumb current">"${escapeHtml(searchInput.value)}" 검색 결과</span>`);
    } else if (nav.category) {
        parts.push(`<span class="crumb-sep">/</span><button class="crumb" data-nav="category">${CATEGORY_LABELS[nav.category]}</button>`);
        if (nav.folder !== null) {
            parts.push(`<span class="crumb-sep">/</span><span class="crumb current">${escapeHtml(typeLabel(nav.folder))}</span>`);
        }
    }
    breadcrumbEl.innerHTML = parts.join("");
    breadcrumbEl.querySelectorAll(".crumb[data-nav]").forEach(btn => {
        btn.addEventListener("click", () => {
            clearSearch();
            if (btn.dataset.nav === "root") nav = { category: null, folder: null };
            else if (btn.dataset.nav === "category") nav.folder = null;
            renderMain();
        });
    });
}

// ---- Render: category root ----

function renderCategoryRoot() {
    emptyState.hidden = true;
    const cats = ["offense", "defense"];
    playGrid.innerHTML = cats.map(c => {
        const plays = currentAll.filter(p => p.category === c);
        const folderCount = foldersForCategory(c).length + (unfiledCount(c) > 0 ? 1 : 0);
        return `
            <article class="folder-card category-card" data-category="${c}">
                <div class="folder-icon">${c === "offense" ? "🧡" : "💙"}</div>
                <h3 class="folder-name">${CATEGORY_LABELS[c]}</h3>
                <p class="folder-meta">폴더 ${folderCount}개 · 전술 ${plays.length}개</p>
            </article>
        `;
    }).join("");

    playGrid.querySelectorAll(".category-card").forEach(card => {
        card.addEventListener("click", () => {
            nav.category = card.dataset.category;
            nav.folder = null;
            renderMain();
        });
    });
}

// ---- Render: folder list within a category ----

function renderFolderList(category) {
    const folders = foldersForCategory(category);
    const unfiled = unfiledCount(category);
    emptyState.hidden = !(folders.length === 0 && unfiled === 0);
    emptyState.textContent = "아직 폴더가 없어요. '+ 새 폴더'로 만들어보세요.";

    const folderCards = folders.map(f => {
        const count = playsInFolder(category, f).length;
        return `
            <article class="folder-card" data-folder="${escapeHtml(f)}">
                <button class="icon-btn folder-delete" title="폴더 삭제" ${count > 0 ? "hidden" : ""}>&times;</button>
                <div class="folder-icon">📁</div>
                <h3 class="folder-name">${escapeHtml(typeLabel(f))}</h3>
                <p class="folder-meta">전술 ${count}개</p>
            </article>
        `;
    }).join("");

    const unfiledCard = unfiled > 0 ? `
        <article class="folder-card" data-folder="">
            <div class="folder-icon">📂</div>
            <h3 class="folder-name">미분류</h3>
            <p class="folder-meta">전술 ${unfiled}개</p>
        </article>
    ` : "";

    const addCard = `
        <button type="button" class="folder-card folder-add" id="addFolderCard">
            <div class="folder-icon">+</div>
            <h3 class="folder-name">새 폴더</h3>
        </button>
    `;

    playGrid.innerHTML = folderCards + unfiledCard + addCard;

    playGrid.querySelectorAll(".folder-card[data-folder]").forEach(card => {
        card.addEventListener("click", (e) => {
            if (e.target.closest(".folder-delete")) return;
            nav.folder = card.dataset.folder;
            renderMain();
        });
        card.querySelector(".folder-delete")?.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteFolder(category, card.dataset.folder);
        });
    });

    document.getElementById("addFolderCard").addEventListener("click", () => openAddFolder(category));
}

function deleteFolder(category, name) {
    if (playsInFolder(category, name).length > 0) {
        alert("폴더 안에 전술이 있어서 삭제할 수 없어요. 먼저 전술을 옮기거나 삭제해주세요.");
        return;
    }
    if (!confirm("이 폴더를 삭제할까요?")) return;
    userState.customFolders[category] = (userState.customFolders[category] || []).filter(n => n !== name);
    userState.folderOrder[category] = (userState.folderOrder[category] || []).filter(n => n !== name);
    saveUserState();
    renderMain();
}

// ---- Render: plays inside a folder / search results ----

function renderPlaysInFolder(category, folder) {
    const list = playsInFolder(category, folder);
    emptyState.hidden = list.length !== 0;
    emptyState.textContent = "이 폴더에는 아직 전술이 없어요.";
    playGrid.innerHTML = list.map(playCardHtml).join("");
    attachPlayCardHandlers();
}

function renderSearchResults() {
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
                <span class="badge">${escapeHtml(typeLabel(play.type))}</span>
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
    if (!confirm("이 전술을 삭제할까요? (이 브라우저에서만 사라져요)")) return;
    userState.removedPlays.push(id);
    saveUserState();
    renderAll();
}

// ---- Right-side outline panel (folders or plays, depending on nav) ----

function renderOutlinePanel() {
    if (state.search || !nav.category) {
        outlinePanel.hidden = true;
        return;
    }
    outlinePanel.hidden = false;
    if (!nav.folder) {
        renderFolderOutline(nav.category);
    } else {
        renderPlayOutline(nav.category, nav.folder);
    }
}

let dragFolderName = null;

function renderFolderOutline(category) {
    outlineTitle.innerHTML = `폴더 목록 <span class="hint">드래그해서 순서 변경</span>`;
    const folders = foldersForCategory(category);
    outlineList.innerHTML = folders.map((f, i) => `
        <li class="outline-item" draggable="true" data-folder="${escapeHtml(f)}">
            <span class="drag-handle">⋮⋮</span>
            <span class="outline-index">${i + 1}</span>
            <span class="outline-title">${escapeHtml(typeLabel(f))}</span>
            <button class="icon-btn outline-delete" title="삭제" ${playsInFolder(category, f).length > 0 ? "hidden" : ""}>&times;</button>
        </li>
    `).join("");

    outlineList.querySelectorAll(".outline-item").forEach(li => {
        const name = li.dataset.folder;

        li.addEventListener("click", (e) => {
            if (e.target.closest(".outline-delete")) return;
            nav.folder = name;
            renderMain();
        });

        li.querySelector(".outline-delete")?.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteFolder(category, name);
        });

        li.addEventListener("dragstart", () => {
            dragFolderName = name;
            li.classList.add("dragging");
        });

        li.addEventListener("dragend", () => {
            li.classList.remove("dragging");
            dragFolderName = null;
            saveUserState();
            renderFolderList(category);
        });

        li.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (!dragFolderName || dragFolderName === name) return;
            const arr = userState.folderOrder[category];
            const from = arr.indexOf(dragFolderName);
            const to = arr.indexOf(name);
            if (from === -1 || to === -1 || from === to) return;
            arr.splice(from, 1);
            arr.splice(to, 0, dragFolderName);
            renderFolderOutline(category);
        });
    });
}

let dragId = null;

function renderPlayOutline(category, folder) {
    outlineTitle.innerHTML = `전술 목록 <span class="hint">드래그해서 순서 변경</span>`;
    const list = playsInFolder(category, folder);
    outlineList.innerHTML = list.map((play, i) => `
        <li class="outline-item" draggable="true" data-id="${play.id}">
            <span class="drag-handle">⋮⋮</span>
            <span class="outline-index">${i + 1}</span>
            <span class="outline-title">${escapeHtml(play.title)}</span>
            <button class="icon-btn outline-delete" title="삭제">&times;</button>
        </li>
    `).join("");

    outlineList.querySelectorAll(".outline-item").forEach(li => {
        const id = li.dataset.id;

        li.addEventListener("click", (e) => {
            if (e.target.closest(".outline-delete")) return;
            openPlay(id, 0);
        });

        li.querySelector(".outline-delete").addEventListener("click", (e) => {
            e.stopPropagation();
            deletePlay(id);
        });

        li.addEventListener("dragstart", () => {
            dragId = id;
            li.classList.add("dragging");
        });

        li.addEventListener("dragend", () => {
            li.classList.remove("dragging");
            dragId = null;
            saveUserState();
            renderPlaysInFolder(category, folder);
        });

        li.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (!dragId || dragId === id) return;
            const from = userState.order.indexOf(dragId);
            const to = userState.order.indexOf(id);
            if (from === -1 || to === -1 || from === to) return;
            userState.order.splice(from, 1);
            userState.order.splice(to, 0, dragId);
            const fromIdx = currentAll.findIndex(p => p.id === dragId);
            const [moved] = currentAll.splice(fromIdx, 1);
            const toIdx = currentAll.findIndex(p => p.id === id);
            currentAll.splice(toIdx, 0, moved);
            renderPlayOutline(category, folder);
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
const replayBtn = document.getElementById("replayBtn");
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
        <span class="badge">${escapeHtml(typeLabel(play.type))}</span>
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
    userState.notesOverride[activePlay.id] = val;
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

function onYouTubeIframeAPIReady() {
    ytApiReady = true;
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function playYoutubeClip(clip) {
    if (!ytApiReady || typeof YT === "undefined") {
        setTimeout(() => playYoutubeClip(clip), 200);
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
            videoId: clip.youtubeId,
            playerVars: {
                start: clip.start || 0,
                end: clip.end || undefined,
                autoplay: 1,
                rel: 0
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

// ---- Add Play ----

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
const addPlayCategorySelect = document.getElementById("addPlayCategory");
const addPlayFolderInput = document.getElementById("addPlayFolder");

document.getElementById("addPlayFab").addEventListener("click", () => {
    addPlayForm.reset();
    if (nav.category) addPlayCategorySelect.value = nav.category;
    if (nav.folder) addPlayFolderInput.value = nav.folder;
    addPlayModal.hidden = false;
});
document.getElementById("closeAddPlay").addEventListener("click", () => addPlayModal.hidden = true);
document.getElementById("addPlayBackdrop").addEventListener("click", () => addPlayModal.hidden = true);

addPlayForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(addPlayForm);
    const parsed = extractYoutube(fd.get("videoUrl"));
    if (!parsed) {
        alert("유튜브 링크를 확인해주세요.");
        return;
    }
    const timing = resolveClipTiming(fd, parsed.start);
    if (!timing) return;
    const play = {
        id: uid("play"),
        title: fd.get("title").trim(),
        category: fd.get("category"),
        type: fd.get("type").trim(),
        tags: [],
        team: "",
        notes: fd.get("notes").trim(),
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
    nav.category = play.category;
    nav.folder = play.type || "";
    clearSearch();
    renderAll();
});

// ---- Add Example (to existing play) ----

const addExampleModal = document.getElementById("addExampleModal");
const addExampleForm = document.getElementById("addExampleForm");
let addExampleTargetId = null;

function openAddExample(playId) {
    addExampleTargetId = playId;
    addExampleForm.reset();
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
let addFolderCategory = null;

function openAddFolder(category) {
    addFolderCategory = category;
    addFolderForm.reset();
    addFolderModal.hidden = false;
}

document.getElementById("closeAddFolder").addEventListener("click", () => addFolderModal.hidden = true);
document.getElementById("addFolderBackdrop").addEventListener("click", () => addFolderModal.hidden = true);

addFolderForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(addFolderForm);
    const name = fd.get("folderName").trim();
    if (!name) return;
    if (!userState.customFolders[addFolderCategory].includes(name)) {
        userState.customFolders[addFolderCategory].push(name);
    }
    if (!userState.folderOrder[addFolderCategory].includes(name)) {
        userState.folderOrder[addFolderCategory].unshift(name);
    }
    saveUserState();
    addFolderModal.hidden = true;
    nav.category = addFolderCategory;
    nav.folder = name;
    renderAll();
});

// ---- Export ----

document.getElementById("exportBtn").addEventListener("click", () => {
    const merged = currentAll.map(({ id, title, category, type, tags, team, notes, examples, dateAdded }) => ({
        id, title, category, type, tags, team, notes,
        examples: examples.map(({ id, label, source, youtubeId, file, start, end }) => ({ id, label, source, youtubeId, file, start, end })),
        dateAdded
    }));
    const blob = new Blob([JSON.stringify(merged, null, 2)], { type: "application/json" });
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
    }
});
