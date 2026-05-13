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
  heroTimer: null
};

const app = document.querySelector("#app");
const drawer = document.querySelector("#drawer");
const lockSheet = document.querySelector("#lockSheet");

const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

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
  return `<button class="${active}" data-view="${view}">${icon(iconName)}<span>${label}</span></button>`;
}

function topShell(inner) {
  const brand = state.settings?.brand || "ReelPilot";
  return `
    <header class="topbar">
      <div class="logo">${initials(brand)}</div>
      <div class="brand">${brand}</div>
      <button class="icon-btn" data-action="search">${icon("search")}</button>
      <button class="icon-btn" data-action="language">${icon("globe")}</button>
    </header>
    <nav class="tabbar">
      <button class="tab-btn ${state.view === "home" ? "active" : ""}" data-view="home">Home</button>
      <button class="tab-btn ${state.view === "dramas" ? "active" : ""}" data-view="dramas">Dramas</button>
      <button class="tab-btn ${state.view === "fandom" ? "active" : ""}" data-view="fandom">Guides</button>
      <button class="tab-btn ${state.view === "profile" ? "active" : ""}" data-view="profile">Me</button>
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
                      <button class="primary-btn" data-open-drama="${item.id}">${icon("play")}Play</button>
                      <button class="secondary-btn" data-favorite="${item.id}">${icon("star")}${state.user.favorites.includes(item.id) ? "Saved" : "Save"}</button>
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
      ${renderRail("Latest Uploads", latest, "releaseDate")}
      ${renderRail("Most Popular", hottest, "plays")}
      ${categories
        .map(
          (group) => `
            <section class="category-section">
              <div class="section-head">
                <h2 class="section-title">${group.category}</h2>
                <button class="text-link" data-category-jump="${group.category}">View all</button>
              </div>
              <div class="poster-rail">
                ${group.dramas.map(renderPoster).join("")}
              </div>
            </section>
          `
        )
        .join("") || `<p class="muted">No dramas available</p>`}
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
  const pill = drama.status === "published" ? "Streaming" : "Draft";
  const selected = drama.id === state.selectedDramaId ? "selected" : "";
  const meta = mode === "releaseDate" ? (drama.releaseDate || "") : `${fmt.format(drama.stats.plays)} plays`;
  return `
    <button class="poster-card ${selected}" data-open-drama="${drama.id}">
      <span class="status-pill ${drama.status}">${pill}</span>
      <img src="${drama.cover}" alt="">
      <div class="poster-info">
        <h3>${drama.title}</h3>
        <div class="poster-meta"><span>${meta}</span><span>${drama.totalEpisodes} eps</span></div>
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
        <h1 class="section-title">Dramas</h1>
      </div>
      <input class="search-input" data-search value="${state.search}" placeholder="Search">
      <div class="chip-row" style="margin-top:14px">
        ${categories.map((item) => `<button class="chip ${state.category === item ? "active" : ""}" data-category="${item}">${item}</button>`).join("")}
      </div>
      <div class="poster-grid" style="margin-top:12px">
        ${filtered.map(renderPoster).join("") || `<p class="muted">No results</p>`}
      </div>
    </main>
  `);
}

function renderFandom() {
  return topShell(`
    <main class="content">
      <div class="section-head">
        <h1 class="section-title">Guides</h1>
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
  return topShell(`
    <main class="content">
      <div class="section-head">
        <h1 class="section-title">Me</h1>
      </div>
      <div class="profile-grid">
        <section class="profile-card wallet">
          <div>
            <div class="muted">Profile</div>
            <div class="balance">${state.user.name}</div>
          </div>
          <button class="primary-btn" data-authorize-profile>${icon("user")}${state.user.profileAuthorized ? "Refresh" : "Authorize"}</button>
        </section>
        <section class="profile-card wallet">
          <div>
            <div class="muted">Subscription</div>
            <div class="balance">${state.user.subscription?.status || "inactive"}</div>
          </div>
          <button class="secondary-btn" data-subscribe>${icon("star")}Subscribe</button>
        </section>
        <section class="profile-card">
          <h3>Continue</h3>
          <div class="history-list">
            ${state.user.watchHistory
              .map((item) => {
                const drama = dramaById(item.dramaId);
                return `<button class="poster-card" data-open-drama="${item.dramaId}" style="display:grid;grid-template-columns:72px 1fr">
                  <img src="${drama?.cover || ""}" alt="" style="height:92px;aspect-ratio:auto">
                  <div class="poster-info"><h3>${drama?.title || ""}</h3><div class="poster-meta">${item.progress}%</div></div>
                </button>`;
              })
              .join("")}
          </div>
        </section>
        <section class="profile-card">
          <h3>Saved</h3>
          <div class="poster-grid">
            ${favoriteDramas.map(renderPoster).join("") || `<p class="muted">No saved dramas</p>`}
          </div>
        </section>
      </div>
    </main>
  `);
}

function renderPlayer() {
  const drama = currentDrama();
  if (!drama) return topShell(`<main class="content"><p class="muted">No dramas available</p></main>`);
  const episodes = episodesOf(drama);
  const episode = currentEpisode(drama);
  if (episode && state.selectedEpisode !== episode.number) state.selectedEpisode = episode.number;
  const favorite = state.user?.favorites?.includes(drama.id);
  if (!episode) {
    return `
      <main class="player-page content">
        <button class="back-btn" data-view="home">${icon("chevron")}Back</button>
        <div class="crumb">Home / ${drama.title}</div>
        <section class="video-frame">
          <div class="video-art" style="background-image:url('${drama.banner}')"></div>
          <div class="video-caption">No episodes available</div>
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
      <button class="back-btn" data-view="home">${icon("chevron")}Back</button>
      <div class="crumb">Home / ${drama.title} / Episode ${episode.number}</div>
      <section class="video-frame">
        ${
          unlocked && episode.videoUrl
            ? `<video class="real-video" src="${episode.videoUrl}" controls playsinline preload="metadata" poster="${drama.banner}"></video>`
            : `
              <div class="video-art" style="background-image:url('${drama.banner}')"></div>
              <div class="video-caption">${unlocked ? episode.plot || "Ready to play" : "Unlock to continue watching"}</div>
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
        <h1>${drama.title} - Episode ${episode.number}</h1>
      </section>
      <div class="episode-ranges">
        <span>${episodes[0]?.number || 1}-${episodes[episodes.length - 1]?.number || drama.totalEpisodes}</span>
        <span>All Episodes</span>
      </div>
      <div class="episode-list">
        ${episodes
          .map(
            (item) => `
              <button class="episode-btn ${item.number === episode.number ? "active" : ""}" data-episode="${item.number}">
                ${item.number === episode.number ? "||" : item.number}
                ${isUnlocked(item) ? "" : `<span class="lock-mark">Lock</span>`}
              </button>
            `
          )
          .join("")}
      </div>
      <div class="stat-row">
        <div class="big-stat"><div class="circle">${icon("play")}</div><span>${fmt.format(drama.stats.plays)}</span></div>
        <button class="big-stat icon-btn" data-favorite="${drama.id}" style="width:auto;height:auto;border-radius:0">
          <div class="circle">${icon("star")}</div><span>${favorite ? "Saved" : fmt.format(drama.stats.favorites)}</span>
        </button>
      </div>
      <section class="plot">
        <h2>Plot of Episode ${episode.number}</h2>
        <p>${episode.plot}</p>
      </section>
      <section class="comments">
        <h2>Comments</h2>
        <form class="comment-form" data-comment-form>
          <input name="body" maxlength="500" placeholder="Add comment">
          <button class="primary-btn">Post</button>
        </form>
        ${(drama.comments || [])
          .map((comment) => `<div class="comment-item"><strong>${comment.userName}</strong><p>${comment.body}</p></div>`)
          .join("") || `<p class="muted">No comments</p>`}
      </section>
    </main>
  `;
}

function render() {
  if (!state.settings) {
    app.innerHTML = `<main class="content"><p class="muted">Loading</p></main>`;
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
      state.view = button.dataset.view;
      render();
    });
  });
  app.querySelectorAll("[data-open-drama]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.openDrama;
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
      state.category = button.dataset.categoryJump;
      state.view = "dramas";
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
  app.querySelectorAll("[data-action='language']").forEach((button) => button.addEventListener("click", openLanguageDrawer));
  bindHeroSlider();
  app.querySelectorAll("[data-episode]").forEach((button) => {
    button.addEventListener("click", () => {
      const drama = currentDrama();
      const episode = (drama?.episodes || []).find((item) => item.number === Number(button.dataset.episode));
      if (!episode) return;
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
      const result = await api("/api/favorite", { method: "POST", body: { dramaId: button.dataset.favorite } });
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
      await api("/api/comments", { method: "POST", body: { dramaId: drama.id, episodeId: episode.id, body } });
      const full = await api(`/api/dramas/${drama.id}`);
      state.dramas = state.dramas.map((item) => (item.id === drama.id ? full : item));
      form.reset();
      render();
    });
  }
  app.querySelectorAll("[data-authorize-profile]").forEach((button) => {
    button.addEventListener("click", async () => {
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
        <h2>Language</h2>
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
    <h3>Episode ${episode.number}</h3>
    <p class="muted">Watch an ad to unlock</p>
    <div class="lock-actions">
      <button class="secondary-btn" data-close-lock>Cancel</button>
      <button class="primary-btn" data-unlock-episode>${icon("play")}Watch Ad</button>
    </div>
  `;
  lockSheet.querySelector("[data-close-lock]").addEventListener("click", closeLockSheet);
  lockSheet.querySelector("[data-unlock-episode]").addEventListener("click", async () => {
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
