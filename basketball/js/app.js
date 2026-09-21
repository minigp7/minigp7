const CATEGORY_LABELS = {
    offense: "공격",
    defense: "수비"
};

const TYPE_LABELS = {
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

let clips = [];
let ytApiReady = false;
let ytPlayer = null;
let activeClip = null;

const state = {
    categories: new Set(["offense", "defense"]),
    types: new Set(),
    search: ""
};

const clipGrid = document.getElementById("clipGrid");
const resultCount = document.getElementById("resultCount");
const emptyState = document.getElementById("emptyState");
const typeFilterList = document.getElementById("typeFilterList");
const searchInput = document.getElementById("searchInput");

fetch("data/clips.json")
    .then(res => res.json())
    .then(data => {
        clips = data;
        buildTypeFilters();
        render();
    })
    .catch(err => {
        clipGrid.innerHTML = `<p style="color:#9aa4b5">clips.json을 불러오지 못했어요. 로컬 서버(예: python3 -m http.server)로 열어보세요.</p>`;
        console.error(err);
    });

function buildTypeFilters() {
    const types = [...new Set(clips.map(c => c.type))];
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
            render();
        });
    });
}

document.querySelectorAll(".category-filter").forEach(el => {
    el.addEventListener("change", () => {
        if (el.checked) state.categories.add(el.value);
        else state.categories.delete(el.value);
        render();
    });
});

searchInput.addEventListener("input", () => {
    state.search = searchInput.value.trim().toLowerCase();
    render();
});

document.getElementById("resetFilters").addEventListener("click", () => {
    document.querySelectorAll(".category-filter").forEach(el => el.checked = true);
    document.querySelectorAll(".type-filter").forEach(el => el.checked = true);
    searchInput.value = "";
    state.categories = new Set(["offense", "defense"]);
    state.types = new Set(clips.map(c => c.type));
    state.search = "";
    render();
});

function matchesFilter(clip) {
    if (!state.categories.has(clip.category)) return false;
    if (!state.types.has(clip.type)) return false;
    if (state.search) {
        const haystack = [clip.title, clip.notes, clip.team, ...(clip.tags || [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        if (!haystack.includes(state.search)) return false;
    }
    return true;
}

function render() {
    const filtered = clips.filter(matchesFilter);
    resultCount.textContent = `${filtered.length}개의 클립`;
    emptyState.hidden = filtered.length !== 0;
    clipGrid.innerHTML = filtered.map(clipCardHtml).join("");
    clipGrid.querySelectorAll(".clip-card").forEach(card => {
        card.addEventListener("click", () => openClip(card.dataset.id));
    });
}

function clipCardHtml(clip) {
    const thumbStyle = clip.source === "youtube"
        ? `style="background-image:url('https://img.youtube.com/vi/${clip.youtubeId}/mqdefault.jpg')"`
        : "";
    const thumbContent = clip.source === "youtube" ? "" : "🎬";
    return `
        <article class="clip-card" data-id="${clip.id}">
            <div class="clip-thumb" ${thumbStyle}>
                ${thumbContent}
                <div class="play-badge">▶</div>
            </div>
            <div class="clip-body">
                <h3 class="clip-title">${escapeHtml(clip.title)}</h3>
                <div class="badges">
                    <span class="badge cat-${clip.category}">${CATEGORY_LABELS[clip.category] || clip.category}</span>
                    <span class="badge">${typeLabel(clip.type)}</span>
                </div>
            </div>
        </article>
    `;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

// ---- Modal / Player ----

const clipModal = document.getElementById("clipModal");
const modalTitle = document.getElementById("modalTitle");
const modalBadges = document.getElementById("modalBadges");
const modalNotes = document.getElementById("modalNotes");
const youtubePlayerEl = document.getElementById("youtubePlayer");
const localPlayerEl = document.getElementById("localPlayer");
const replayBtn = document.getElementById("replayBtn");

function openClip(id) {
    const clip = clips.find(c => c.id === id);
    if (!clip) return;
    activeClip = clip;

    modalTitle.textContent = clip.title;
    modalBadges.innerHTML = `
        <span class="badge cat-${clip.category}">${CATEGORY_LABELS[clip.category] || clip.category}</span>
        <span class="badge">${typeLabel(clip.type)}</span>
        ${(clip.tags || []).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join("")}
        ${clip.team ? `<span class="badge">${escapeHtml(clip.team)}</span>` : ""}
    `;
    modalNotes.textContent = clip.notes || "";

    clipModal.hidden = false;

    if (clip.source === "youtube") {
        localPlayerEl.hidden = true;
        localPlayerEl.pause();
        youtubePlayerEl.hidden = false;
        playYoutubeClip(clip);
    } else {
        youtubePlayerEl.hidden = true;
        if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
        localPlayerEl.hidden = false;
        playLocalClip(clip);
    }
}

function closeClipModal() {
    clipModal.hidden = true;
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    localPlayerEl.pause();
    activeClip = null;
}

document.getElementById("closeModal").addEventListener("click", closeClipModal);
document.getElementById("modalBackdrop").addEventListener("click", closeClipModal);

replayBtn.addEventListener("click", () => {
    if (!activeClip) return;
    if (activeClip.source === "youtube") {
        playYoutubeClip(activeClip);
    } else {
        playLocalClip(activeClip);
    }
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

// ---- Guide modal ----

const guideModal = document.getElementById("guideModal");
document.getElementById("guideBtn").addEventListener("click", () => guideModal.hidden = false);
document.getElementById("closeGuide").addEventListener("click", () => guideModal.hidden = true);
document.getElementById("guideBackdrop").addEventListener("click", () => guideModal.hidden = true);

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeClipModal();
        guideModal.hidden = true;
    }
});
