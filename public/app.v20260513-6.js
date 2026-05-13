const state = {
  settings: null,
  user: null,
  metrics: null,
  dramas: [],
  fandom: [],
  client: null,
  view: "home",
  category: "All",
  search: "",
  selectedDramaId: null,
  selectedEpisode: 1,
  lockTarget: null,
  heroTimer: null,
  playSession: null,
  profileTab: "profile"
};

const app = document.querySelector("#app");
const drawer = document.querySelector("#drawer");
const lockSheet = document.querySelector("#lockSheet");

const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const en = {
  Episode: "Episode {n}",
  "Plot of Episode": "Plot of Episode {n}",
  SavedTab: "Saved"
};
const zh = {
  Home: "\u9996\u9875",
  Dramas: "\u77ed\u5267",
  Guides: "\u6307\u5357",
  Me: "\u6211\u7684",
  Play: "\u64ad\u653e",
  Save: "\u6536\u85cf",
  Saved: "\u5df2\u6536\u85cf",
  "Latest Uploads": "\u6700\u65b0\u4e0a\u4f20",
  "Most Popular": "\u6700\u70ed\u95e8",
  "View all": "\u5168\u90e8",
  "No dramas available": "\u6682\u65e0\u77ed\u5267",
  Search: "\u641c\u7d22",
  All: "\u5168\u90e8",
  Streaming: "\u5df2\u4e0a\u7ebf",
  Draft: "\u8349\u7a3f",
  plays: "\u64ad\u653e",
  eps: "\u96c6",
  "No results": "\u65e0\u7ed3\u679c",
  Profile: "\u8d44\u6599",
  Continue: "\u7ee7\u7eed\u770b",
  SavedTab: "\u6536\u85cf",
  Subscription: "\u8ba2\u9605",
  inactive: "\u672a\u8ba2\u9605",
  Refresh: "\u5237\u65b0",
  Authorize: "\u6388\u6743",
  Subscribe: "\u8ba2\u9605",
  "No history": "\u6682\u65e0\u5386\u53f2",
  "No saved dramas": "\u6682\u65e0\u6536\u85cf",
  Back: "\u8fd4\u56de",
  "No episodes available": "\u6682\u65e0\u5267\u96c6",
  Episode: "\u7b2c {n} \u96c6",
  "All Episodes": "\u5168\u90e8\u5267\u96c6",
  "Ready to play": "\u53ef\u64ad\u653e",
  "Unlock to continue watching": "\u89e3\u9501\u540e\u7ee7\u7eed\u89c2\u770b",
  Lock: "\u9501",
  "Plot of Episode": "\u7b2c {n} \u96c6\u5267\u60c5",
  Comments: "\u8bc4\u8bba",
  "Add comment": "\u5199\u8bc4\u8bba",
  Post: "\u53d1\u5e03",
  "No comments": "\u6682\u65e0\u8bc4\u8bba",
  Language: "\u8bed\u8a00",
  "Watch an ad to unlock": "\u89c2\u770b\u5e7f\u544a\u89e3\u9501",
  Cancel: "\u53d6\u6d88",
  "Watch Ad": "\u770b\u5e7f\u544a",
  Loading: "\u52a0\u8f7d\u4e2d"
};

function isZh() {
  return state.user?.language === "\u4e2d\u6587";
}

function t(key, vars = {}) {
  const value = isZh() ? zh[key] || en[key] || key : en[key] || key;
  return String(value).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

function weightOf(item) {
  const value = Number(item?.weight);
  return Number.isFinite(value) ? value : 1;
}

function sortByWeight(items) {
  return [...(items || [])].sort((a, b) => weightOf(b) - weightOf(a) || String(b.releaseDate || b.publishedAt || "").localeCompare(String(a.releaseDate || a.publishedAt || "")));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Request failed");
  return json;
}

async function track(type, payload = {}) {
  try {
    await api("/api/events", {
      method: "POST",
      body: {
        type,
        userId: state.user?.id,
        ...payload
      }
    });
  } catch (error) {
    console.warn("event tracking failed", error);
  }
}

function initials(text) {
  return String(text || "?").slice(0, 1).toUpperCase();
}

function isUnlocked(episode) {
  if (!episode) return false;
  return Boolean(episode.isFree || state.user?.unlockedEpisodes?.includes(episode.id));
}

function dramaById(id) {
  return state.dramas.find((item) => item.id === id);
}

function currentDrama() {
  return dramaById(state.selectedDramaId) || state.dramas[0];
}

function episodesOf(drama) {
  return [...(drama?.episodes || [])].sort((a, b) => Number(a.number) - Number(b.number));
}

function currentEpisode(drama) {
  const episodes = episodesOf(drama);
  return episodes.find((item) => item.number === state.selectedEpisode) || episodes[0] || null;
}

function navItem(view, label, iconName) {
  const active = state.view === view ? "active" : "";
  return `<button class="${active}" data-view="${view}">${icon(iconName)}<span>${t(label)}</span></button>`;
}

function topShell(inner) {
  const brand = state.settings?.brand || "VidShort";
  return `
    <header class="topbar">
      <div class="logo">${initials(brand)}</div>
      <div class="brand">${brand}</div>
      <button class="icon-btn" data-action="search">${icon("search")}</button>
      <button class="icon-btn" data-action="language">${icon("globe")}</button>
    </header>
    <nav class="tabbar">
      <button class="tab-btn ${state.view === "home" ? "active" : ""}" data-view="home">${t("Home")}</button>
      <button class="tab-btn ${state.view === "dramas" ? "active" : ""}" data-view="dramas">${t("Dramas")}</button>
      <button class="tab-btn ${state.view === "fandom" ? "active" : ""}" data-view="fandom">${t("Guides")}</button>
      <button class="tab-btn ${state.view === "profile" ? "active" : ""}" data-view="profile">${t("Me")}</button>
    </nav>
    ${inner}
    <nav class="bottom-nav">
      ${navItem("home", "Home", "home")}
      ${navItem("dramas", "Dramas", "list")}
      ${navItem("fandom", "Guides", "book")}
      ${navItem("profile", "Me", "user")}
    </nav>
  `;
}

function renderHome() {
  const published = sortByWeight(state.dramas.filter((item) => item.status === "published"));
  const carouselIds = state.settings?.homeCarouselIds || [];
  const carousel = carouselIds.map(dramaById).filter(Boolean).filter((drama) => drama.status === "published");
  const fallbackCarousel = published.slice(0, 5);
  const heroItems = (carousel.length ? carousel : fallbackCarousel.length ? fallbackCarousel : state.dramas.slice(0, 5)).slice(0, 5);
  const latest = [...published].sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""))).slice(0, 8);
  const hottest = [...published].sort((a, b) => Number(b.stats?.plays || 0) - Number(a.stats?.plays || 0)).slice(0, 8);
  const categories = (state.settings?.categories || [])
    .map((category) => ({
      category,
      dramas: sortByWeight(published.filter((drama) => drama.category === category))
    }))
    .filter((group) => group.dramas.length);
  const heroSection = heroItems.length
    ? `
      <section class="hero">
        <div class="hero-slider" data-hero-slider>
          ${heroItems
            .map(
              (item) => `
                <article class="hero-slide" data-hero-slide>
                  <button class="hero-media" data-open-drama="${item.id}" aria-label="${item.title}">
                    <img src="${item.banner || item.cover}" alt="">
                  </button>
                  <div class="hero-content">
                    <div class="hero-meta">
                      <span>${item.category}</span><span>${item.totalEpisodes} eps</span><span>${item.language}</span>
                    </div>
                    <h1>${item.title}</h1>
                    <div class="hero-actions">
                      <button class="primary-btn" data-open-drama="${item.id}">${icon("play")}${t("Play")}</button>
                      <button class="secondary-btn" data-favorite="${item.id}">${icon("star")}${state.user.favorites.includes(item.id) ? t("Saved") : t("Save")}</button>
                    </div>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
        <div class="hero-dots">
          ${heroItems.map((item, index) => `<button class="${index === 0 ? "active" : ""}" data-hero-dot="${index}" aria-label="${item.title}"></button>`).join("")}
        </div>
      </section>
    `
    : "";
  return topShell(`
    ${heroSection}
    <main class="content">
      ${renderRail(t("Latest Uploads"), latest, "releaseDate")}
      ${renderRail(t("Most Popular"), hottest, "plays")}
      ${categories
        .map(
          (group) => `
            <section class="category-section">
              <div class="section-head">
                <h2 class="section-title">${group.category}</h2>
                <button class="text-link" data-category-jump="${group.category}">${t("View all")}</button>
              </div>
              <div class="poster-rail">
                ${group.dramas.map(renderPoster).join("")}
              </div>
            </section>
          `
        )
        .join("") || `<p class="muted">${t("No dramas available")}</p>`}
    </main>
  `);
}

function renderRail(title, dramas, mode = "") {
  if (!dramas.length) return "";
  return `
    <section class="category-section">
      <div class="section-head compact-head">
        <h2 class="section-title">${title}</h2>
      </div>
      <div class="poster-rail">
        ${dramas.map((drama) => renderPoster(drama, mode)).join("")}
      </div>
    </section>
  `;
}

function renderPoster(drama, mode = "") {
  const pill = drama.status === "published" ? t("Streaming") : t("Draft");
  const selected = drama.id === state.selectedDramaId ? "selected" : "";
  const meta = mode === "releaseDate" ? (drama.releaseDate || "") : `${fmt.format(drama.stats.plays)} ${t("plays")}`;
  return `
    <button class="poster-card ${selected}" data-open-drama="${drama.id}">
      <span class="status-pill ${drama.status}">${pill}</span>
      <img src="${drama.cover}" alt="">
      <div class="poster-info">
        <h3>${drama.title}</h3>
        <div class="poster-meta"><span>${meta}</span><span>${drama.totalEpisodes} ${t("eps")}</span></div>
      </div>
    </button>
  `;
}

function renderDramas() {
  const categories = ["All", ...(state.settings?.categories || [])];
  const filtered = sortByWeight(state.dramas.filter((drama) => {
    const matchCategory = state.category === "All" || drama.category === state.category;
    const matchSearch = !state.search || drama.title.toLowerCase().includes(state.search.toLowerCase());
    return matchCategory && matchSearch;
  }));
  return topShell(`
    <main class="content">
      <div class="section-head">
        <h1 class="section-title">${t("Dramas")}</h1>
      </div>
      <input class="search-input" data-search value="${state.search}" placeholder="${t("Search")}">
      <div class="chip-row" style="margin-top:14px">
        ${categories.map((item) => `<button class="chip ${state.category === item ? "active" : ""}" data-category="${item}">${item === "All" ? t("All") : item}</button>`).join("")}
      </div>
      <div class="poster-grid" style="margin-top:12px">
        ${filtered.map(renderPoster).join("") || `<p class="muted">${t("No results")}</p>`}
      </div>
    </main>
  `);
}

function renderFandom() {
  return topShell(`
    <main class="content">
      <div class="section-head">
        <h1 class="section-title">${t("Guides")}</h1>
      </div>
      ${sortByWeight(state.fandom)
        .map((post) => {
          const drama = dramaById(post.dramaId);
          return `
            <article class="article-card">
              <img src="${drama?.banner || ""}" alt="">
              <div class="article-body">
                <span class="article-kicker">${post.type}</span>
                <h3>${post.title}</h3>
                <p>${post.excerpt}</p>
              </div>
            </article>
          `;
        })
        .join("")}
    </main>
  `);
}

function renderProfile() {
  const favoriteDramas = state.user.favorites.map(dramaById).filter(Boolean);
  const tabs = [
    ["profile", t("Profile")],
    ["continue", t("Continue")],
    ["saved", t("SavedTab")]
  ];
  const tabBar = `<div class="profile-tabs">${tabs.map(([id, label]) => `<button class="${state.profileTab === id ? "active" : ""}" data-profile-tab="${id}">${label}</button>`).join("")}</div>`;
  const panes = {
    profile: `
      <div class="profile-grid">
        <section class="profile-card wallet">
          <div>
            <div class="muted">${t("Profile")}</div>
            <div class="balance">${state.user.name}</div>
          </div>
          <button class="primary-btn" data-authorize-profile>${icon("user")}${state.user.profileAuthorized ? t("Refresh") : t("Authorize")}</button>
        </section>
        <section class="profile-card wallet">
          <div>
            <div class="muted">${t("Subscription")}</div>
            <div class="balance">${t(state.user.subscription?.status || "inactive")}</div>
          </div>
          <button class="secondary-btn" data-subscribe>${icon("star")}${t("Subscribe")}</button>
        </section>
      </div>
    `,
    continue: `
      <section class="profile-card">
        <h3>${t("Continue")}</h3>
        <div class="history-list">
          ${state.user.watchHistory
            .map((item) => {
              const drama = dramaById(item.dramaId);
              return `<button class="poster-card" data-open-drama="${item.dramaId}" style="display:grid;grid-template-columns:72px 1fr">
                <img src="${drama?.cover || ""}" alt="" style="height:92px;aspect-ratio:auto">
                <div class="poster-info"><h3>${drama?.title || ""}</h3><div class="poster-meta">${item.progress}%</div></div>
              </button>`;
            })
            .join("") || `<p class="muted">${t("No history")}</p>`}
        </div>
      </section>
    `,
    saved: `
      <section class="profile-card">
        <h3>${t("SavedTab")}</h3>
        <div class="poster-grid">
          ${favoriteDramas.map(renderPoster).join("") || `<p class="muted">${t("No saved dramas")}</p>`}
        </div>
      </section>
    `
  };
  return topShell(`
    <main class="content">
      <div class="section-head">
        <h1 class="section-title">${t("Me")}</h1>
      </div>
      ${tabBar}
      ${panes[state.profileTab] || panes.profile}
    </main>
  `);
}

function renderPlayer() {
  const drama = currentDrama();
  if (!drama) return topShell(`<main class="content"><p class="muted">${t("No dramas available")}</p></main>`);
  const episodes = episodesOf(drama);
  const episode = currentEpisode(drama);
  if (episode && state.selectedEpisode !== episode.number) state.selectedEpisode = episode.number;
  const favorite = state.user?.favorites?.includes(drama.id);
  if (!episode) {
    return `
      <main class="player-page content">
        <button class="back-btn" data-view="home">${icon("chevron")}${t("Back")}</button>
        <div class="crumb">${t("Home")} / ${drama.title}</div>
        <section class="video-frame">
          <div class="video-art" style="background-image:url('${drama.banner}')"></div>
          <div class="video-caption">${t("No episodes available")}</div>
        </section>
        <section class="episode-head">
          <h1>${drama.title}</h1>
        </section>
      </main>
    `;
  }
  const unlocked = isUnlocked(episode);
  return `
    <main class="player-page content">
      <button class="back-btn" data-view="home">${icon("chevron")}${t("Back")}</button>
      <div class="crumb">${t("Home")} / ${drama.title} / ${t("Episode", { n: episode.number })}</div>
      <section class="video-frame">
        ${
          unlocked && episode.videoUrl
            ? `<video class="real-video" src="${episode.videoUrl}" controls playsinline preload="metadata" poster="${drama.banner}"></video>`
            : `
              <div class="video-art" style="background-image:url('${drama.banner}')"></div>
              <div class="video-caption">${unlocked ? episode.plot || t("Ready to play") : t("Unlock to continue watching")}</div>
              <div class="progress"><span style="width:${unlocked ? 24 : 8}%"></span></div>
              <div class="player-controls">
                <button class="round-play" data-play-current>${icon("play")}</button>
                <span>${unlocked ? "00:04" : "00:00"} / ${episode.duration || "00:00"}</span>
                <span>1x</span>
                <span>HD</span>
                <span>auto</span>
              </div>
            `
        }
      </section>
      <section class="episode-head">
        <h1>${drama.title} - ${t("Episode", { n: episode.number })}</h1>
      </section>
      <div class="episode-ranges">
        <span>${episodes[0]?.number || 1}-${episodes[episodes.length - 1]?.number || drama.totalEpisodes}</span>
        <span>${t("All Episodes")}</span>
      </div>
      <div class="episode-list">
        ${episodes
          .map(
            (item) => `
              <button class="episode-btn ${item.number === episode.number ? "active" : ""}" data-episode="${item.number}">
                ${item.number === episode.number ? "||" : item.number}
                ${isUnlocked(item) ? "" : `<span class="lock-mark">${t("Lock")}</span>`}
              </button>
            `
          )
          .join("")}
      </div>
      <div class="stat-row">
        <div class="big-stat"><div class="circle">${icon("play")}</div><span>${fmt.format(drama.stats.plays)}</span></div>
        <button class="big-stat icon-btn" data-favorite="${drama.id}" style="width:auto;height:auto;border-radius:0">
          <div class="circle">${icon("star")}</div><span>${favorite ? t("Saved") : fmt.format(drama.stats.favorites)}</span>
        </button>
      </div>
      <section class="plot">
        <h2>${t("Plot of Episode", { n: episode.number })}</h2>
        <p>${episode.plot || drama.description || ""}</p>
      </section>
      <section class="comments">
        <h2>${t("Comments")}</h2>
        <form class="comment-form" data-comment-form>
          <input name="body" maxlength="500" placeholder="${t("Add comment")}">
          <button class="primary-btn">${t("Post")}</button>
        </form>
        ${(drama.comments || [])
          .map((comment) => `<div class="comment-item"><strong>${comment.userName}</strong><p>${comment.body}</p></div>`)
          .join("") || `<p class="muted">${t("No comments")}</p>`}
      </section>
    </main>
  `;
}

function render() {
  if (!state.settings) {
    app.innerHTML = `<main class="content"><p class="muted">${t("Loading")}</p></main>`;
    return;
  }
  if (state.view === "watch") {
    app.innerHTML = renderPlayer();
    bind();
    return;
  }
  const views = {
    home: renderHome,
    dramas: renderDramas,
    fandom: renderFandom,
    profile: renderProfile
  };
  app.innerHTML = (views[state.view] || renderHome)();
  bind();
}

function bind() {
  app.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      track("click", { label: `nav_${button.dataset.view}` });
      state.view = button.dataset.view;
      render();
    });
  });
  app.querySelectorAll("[data-open-drama]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.openDrama;
      track("click", { label: "open_drama", dramaId: id });
      const full = await api(`/api/dramas/${id}`);
      state.dramas = state.dramas.map((item) => (item.id === id ? full : item));
      state.selectedDramaId = id;
      const firstEpisode = episodesOf(full)[0];
      if (!firstEpisode) {
        render();
        return;
      }
      state.selectedEpisode = firstEpisode.number;
      state.view = "watch";
      render();
    });
  });
  app.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      render();
    });
  });
  app.querySelectorAll("[data-category-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      track("click", { label: "category_jump", meta: { category: button.dataset.categoryJump } });
      state.category = button.dataset.categoryJump;
      state.view = "dramas";
      render();
    });
  });
  app.querySelectorAll("[data-profile-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      track("click", { label: `profile_tab_${button.dataset.profileTab}` });
      state.profileTab = button.dataset.profileTab;
      render();
    });
  });
  const search = app.querySelector("[data-search]");
  if (search) {
    search.addEventListener("input", (event) => {
      state.search = event.target.value;
      render();
    });
  }
  app.querySelectorAll("[data-action='search']").forEach((button) => {
    button.addEventListener("click", () => {
      track("click", { label: "search_shortcut" });
      state.view = "dramas";
      render();
      window.setTimeout(() => app.querySelector("[data-search]")?.focus(), 0);
    });
  });
  app.querySelectorAll("[data-action='language']").forEach((button) => button.addEventListener("click", openLanguageDrawer));
  bindHeroSlider();
  app.querySelectorAll("[data-episode]").forEach((button) => {
    button.addEventListener("click", () => {
      const drama = currentDrama();
      const episode = (drama?.episodes || []).find((item) => item.number === Number(button.dataset.episode));
      if (!episode) return;
      track("click", { label: "episode_select", dramaId: drama.id, episodeId: episode.id });
      if (!isUnlocked(episode)) {
        state.lockTarget = episode;
        openLockSheet(episode);
        return;
      }
      state.selectedEpisode = episode.number;
      render();
    });
  });
  app.querySelectorAll("[data-favorite]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const result = await api("/api/favorite", { method: "POST", body: { dramaId: button.dataset.favorite, userId: state.user.id } });
      state.user = result.user;
      state.dramas = state.dramas.map((item) => (item.id === result.drama.id ? result.drama : item));
      render();
    });
  });
  const form = app.querySelector("[data-comment-form]");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = new FormData(form).get("body").trim();
      if (!body) return;
      const drama = currentDrama();
      const episode = currentEpisode(drama);
      if (!drama || !episode) return;
      await api("/api/comments", { method: "POST", body: { dramaId: drama.id, episodeId: episode.id, userId: state.user.id, userName: state.user.name, body } });
      const full = await api(`/api/dramas/${drama.id}`);
      state.dramas = state.dramas.map((item) => (item.id === drama.id ? full : item));
      form.reset();
      render();
    });
  }
  app.querySelectorAll("video.real-video").forEach((video) => {
    const drama = currentDrama();
    const episode = currentEpisode(drama);
    if (!drama || !episode) return;
    let started = false;
    let lastProgress = 0;
    video.addEventListener("play", () => {
      if (started) return;
      started = true;
      state.playSession = { dramaId: drama.id, episodeId: episode.id, startedAt: Date.now() };
      track("play_start", { dramaId: drama.id, episodeId: episode.id });
      drama.stats.plays = Number(drama.stats.plays || 0) + 1;
    });
    video.addEventListener("timeupdate", () => {
      if (!video.duration || !started) return;
      const progress = Math.floor((video.currentTime / video.duration) * 100);
      if (progress >= lastProgress + 25) {
        lastProgress = progress;
        track("play_progress", { dramaId: drama.id, episodeId: episode.id, value: progress, progress });
      }
    });
    video.addEventListener("ended", () => {
      if (!started) return;
      track("play_complete", { dramaId: drama.id, episodeId: episode.id, value: 100, progress: 100 });
    });
  });
  app.querySelectorAll("[data-authorize-profile]").forEach((button) => {
    button.addEventListener("click", async () => {
      track("click", { label: "authorize_profile" });
      const profile = await window.TTMinisAdapter.authorizeProfile(state.user);
      const result = await api("/api/auth/profile", {
        method: "POST",
        body: { userId: state.user.id, ...profile }
      });
      state.user = result.user;
      render();
    });
  });
  app.querySelectorAll("[data-subscribe]").forEach((button) => {
    button.addEventListener("click", async () => {
      track("click", { label: "subscribe" });
      await window.TTMinisAdapter.createSubscription({ planId: "monthly_default" });
      const result = await api("/api/subscriptions/mock", {
        method: "POST",
        body: { userId: state.user.id, status: "active", plan: "monthly_default" }
      });
      state.user = result.user;
      render();
    });
  });
}

function bindHeroSlider() {
  const slider = app.querySelector("[data-hero-slider]");
  if (state.heroTimer) {
    window.clearInterval(state.heroTimer);
    state.heroTimer = null;
  }
  if (!slider) return;
  const slides = [...slider.querySelectorAll("[data-hero-slide]")];
  const dots = [...app.querySelectorAll("[data-hero-dot]")];
  if (slides.length < 2) return;
  const setActive = () => {
    const index = Math.round(slider.scrollLeft / Math.max(1, slider.clientWidth));
    dots.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === index));
  };
  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const index = Number(dot.dataset.heroDot || 0);
      slider.scrollTo({ left: index * slider.clientWidth, behavior: "smooth" });
      dots.forEach((item, itemIndex) => item.classList.toggle("active", itemIndex === index));
    });
  });
  slider.addEventListener("scroll", () => window.requestAnimationFrame(setActive), { passive: true });
  let touching = false;
  slider.addEventListener("pointerdown", () => {
    touching = true;
  });
  slider.addEventListener("pointerup", () => {
    touching = false;
  });
  slider.addEventListener("pointercancel", () => {
    touching = false;
  });
  state.heroTimer = window.setInterval(() => {
    if (state.view !== "home" || touching || !document.body.contains(slider)) return;
    const current = Math.round(slider.scrollLeft / Math.max(1, slider.clientWidth));
    const next = (current + 1) % slides.length;
    slider.scrollTo({ left: next * slider.clientWidth, behavior: "smooth" });
  }, 4200);
}

function openLanguageDrawer() {
  drawer.classList.add("open");
  drawer.innerHTML = `
    <aside class="drawer">
      <div class="drawer-head">
        <button class="icon-btn" data-close-drawer>${icon("close")}</button>
        <h2>${t("Language")}</h2>
        <span></span>
      </div>
      <div class="language-list">
        ${state.settings.supportedLanguages
          .map((language) => `<button class="${state.user.language === language ? "active" : ""}" data-language="${language}">${language}</button>`)
          .join("")}
      </div>
    </aside>
  `;
  drawer.querySelector("[data-close-drawer]").addEventListener("click", closeDrawer);
  drawer.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => {
      state.user.language = button.dataset.language;
      api("/api/auth/profile", {
        method: "POST",
        body: { userId: state.user.id, language: state.user.language }
      }).catch(() => {});
      closeDrawer();
      render();
    });
  });
  drawer.addEventListener("click", (event) => {
    if (event.target === drawer) closeDrawer();
  }, { once: true });
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawer.innerHTML = "";
}

function openLockSheet(episode) {
  if (!episode) return;
  const drama = currentDrama();
  if (!drama) return;
  const adUnitId = state.client?.rewardedAdUnitId || state.settings.monetization.rewardedAdUnitId;
  lockSheet.classList.add("open");
  lockSheet.innerHTML = `
    <h3>${t("Episode", { n: episode.number })}</h3>
    <p class="muted">${t("Watch an ad to unlock")}</p>
    <div class="lock-actions">
      <button class="secondary-btn" data-close-lock>${t("Cancel")}</button>
      <button class="primary-btn" data-unlock-episode>${icon("play")}${t("Watch Ad")}</button>
    </div>
  `;
  lockSheet.querySelector("[data-close-lock]").addEventListener("click", closeLockSheet);
  lockSheet.querySelector("[data-unlock-episode]").addEventListener("click", async () => {
    track("click", { label: "rewarded_ad_unlock", dramaId: drama.id, episodeId: episode.id });
    const adResult = await window.TTMinisAdapter.showRewardedAd(adUnitId);
    if (!adResult.completed) return;
    const result = await api("/api/unlock", {
      method: "POST",
      body: { episodeId: episode.id, userId: state.user.id, method: "rewarded_ad", adCompleted: true }
    });
    state.user = result.user;
    state.selectedEpisode = episode.number;
    const full = await api(`/api/dramas/${drama.id}`);
    state.dramas = state.dramas.map((item) => (item.id === drama.id ? full : item));
    closeLockSheet();
    render();
  });
}

function closeLockSheet() {
  lockSheet.classList.remove("open");
  lockSheet.innerHTML = "";
}

async function init() {
  const config = await window.TTMinisAdapter.init();
  const loginResult = await window.TTMinisAdapter.login();
  const auth = await api("/api/auth/tiktok", { method: "POST", body: loginResult });
  const boot = await api(`/api/bootstrap?openId=${encodeURIComponent(auth.user.openId)}`);
  Object.assign(state, boot);
  state.client = config.client;
  state.selectedDramaId = state.dramas[0]?.id;
  render();
}

init().catch((error) => {
  app.innerHTML = `<main class="content"><p>${error.message}</p></main>`;
});
