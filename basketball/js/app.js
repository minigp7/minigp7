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

// ---- Storage ----

const STORAGE_KEY = "bball_tactics_v1";

function defaultState() {
    return { plays: [], examplesByPlay: {}, order: [], removedPlays: [], removedExamples: {}, notesOverride: {} };
}

function loadUserState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultState();
        const parsed = JSON.parse(raw);
        return { ...defaultState(), ...parsed };
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

// ---- Filters ----

const state = {
    categories: new Set(["offense", "defense"]),
    types: new Set(),
    search: ""
};

const playGrid = document.getElementById("playGrid");
const resultCount = document.getElementById("resultCount");
const emptyState = document.getElementById("emptyState");
const typeFilterList = document.getElementById("typeFilterList");
const searchInput = document.getElementById("searchInput");
const outlineList = document.getElementById("outlineList");

function buildTypeFilters(all) {
    const types = [...new Set(all.map(p => p.type))];
    state.types = new Set(types);
    typeFilterList.innerHTML = types.map(t => `
        <label class="check">
            <input type="checkbox" class="type-filter" value="${t}" checked>
            ${typeLabel(t)}
        </label>
    `).join("");
    typeFilterList.querySelectorAll(".type-filter").forEach(el => {
        el.addEventListener("change", () => {
            if (el.checked) state.types.add(el.value);
            else state.types.delete(el.value);
            renderGrid();
        });
    });

    const datalist = document.getElementById("typeSuggestions");
    datalist.innerHTML = Object.keys(TYPE_LABELS).map(t => `<option value="${t}">${typeLabel(t)}</option>`).join("");
}

document.querySelectorAll(".category-filter").forEach(el => {
    el.addEventListener("change", () => {
        if (el.checked) state.categories.add(el.value);
        else state.categories.delete(el.value);
        renderGrid();
    });
});

searchInput.addEventListener("input", () => {
    state.search = searchInput.value.trim().toLowerCase();
    renderGrid();
});

document.getElementById("resetFilters").addEventListener("click", () => {
    document.querySelectorAll(".category-filter").forEach(el => el.checked = true);
    document.querySelectorAll(".type-filter").forEach(el => el.checked = true);
    searchInput.value = "";
    state.categories = new Set(["offense", "defense"]);
    state.types = new Set(currentAll.map(p => p.type));
    state.search = "";
    renderGrid();
});

function matchesFilter(play) {
    if (!state.categories.has(play.category)) return false;
    if (!state.types.has(play.type)) return false;
    if (state.search) {
        const haystack = [play.title, play.notes, play.team, ...(play.tags || []), ...(play.examples || []).map(e => e.label)]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        if (!haystack.includes(state.search)) return false;
    }
    return true;
}

// ---- Render: full ----

function renderAll() {
    currentAll = computePlaysList();
    buildTypeFilters(currentAll);
    renderOutline(currentAll);
    renderGrid();
}

function renderGrid() {
    const filtered = currentAll.filter(matchesFilter);
    resultCount.textContent = `${filtered.length}개의 전술`;
    emptyState.hidden = filtered.length !== 0;
    playGrid.innerHTML = filtered.map(playCardHtml).join("");

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
                <span class="badge">${typeLabel(play.type)}</span>
            </div>
            ${play.notes ? `<p class="card-notes">${escapeHtml(play.notes)}</p>` : ""}
            <div class="example-pills">
                ${examples.map((ex, i) => `<button class="pill-btn" data-idx="${i}" title="${escapeHtml(ex.label || '')}">${i + 1}</button>`).join("")}
                <button class="pill-btn pill-add" title="예시 영상 추가">+</button>
            </div>
        </article>
    `;
}

// ---- Outline / reorder panel ----

let dragId = null;

function renderOutline(all) {
    outlineList.innerHTML = all.map((play, i) => `
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
            renderGrid();
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
            renderOutline(currentAll);
        });
    });
}

function deletePlay(id) {
    if (!confirm("이 전술을 삭제할까요? (이 브라우저에서만 사라져요)")) return;
    userState.removedPlays.push(id);
    saveUserState();
    renderAll();
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
        <span class="badge">${typeLabel(play.type)}</span>
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
    const label = activePlay.examples[activeExampleIndex].label;
    currentExampleLabel.textContent = label ? `${activeExampleIndex + 1}번: ${label}` : `${activeExampleIndex + 1}번`;
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

const addPlayModal = document.getElementById("addPlayModal");
const addPlayForm = document.getElementById("addPlayForm");

document.getElementById("addPlayFab").addEventListener("click", () => addPlayModal.hidden = false);
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
            start: parsed.start,
            end: null
        }],
        dateAdded: new Date().toISOString().slice(0, 10)
    };
    userState.plays.push(play);
    userState.order.unshift(play.id);
    saveUserState();
    addPlayForm.reset();
    addPlayModal.hidden = true;
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
    const example = {
        id: uid("ex"),
        label: fd.get("exampleLabel").trim(),
        source: "youtube",
        youtubeId: parsed.videoId,
        start: parsed.start,
        end: null
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
    }
});
