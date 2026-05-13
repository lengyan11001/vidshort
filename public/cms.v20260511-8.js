const cmsState = {
  settings: null,
  metrics: null,
  dramas: [],
  episodes: [],
  users: [],
  transactions: [],
  comments: [],
  fandom: [],
  section: "dramas",
  editingDramaId: null,
  editingGuideId: null,
  viewingDramaId: null,
  uploadOpen: false,
  dramaFilters: {
    q: "",
    status: "all",
    category: "all"
  }
};

const cmsRoot = document.querySelector("#cms");
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

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

function dramaById(id) {
  return cmsState.dramas.find((item) => item.id === id);
}

function guideById(id) {
  return cmsState.fandom.find((item) => item.id === id);
}

function money(value) {
  return `${Number(value || 0).toLocaleString("en")} Beans`;
}

function navButton(section, label, iconName) {
  return `<button class="${cmsState.section === section ? "active" : ""}" data-section="${section}" title="${label}"><span class="nav-icon">${icon(iconName)}</span><span>${label}</span></button>`;
}

function shell(content) {
  return `
    <div class="cms-shell">
      <aside class="cms-sidebar">
        <div class="cms-logo"><div class="logo">R</div><span>CMS</span></div>
        <nav class="cms-nav">
          ${navButton("dramas", "Dramas", "film")}
          ${navButton("upload", "Upload", "cloudUpload")}
          ${navButton("dashboard", "Dashboard", "gauge")}
          ${navButton("guides", "Guides", "book")}
          ${navButton("comments", "Comments", "messages")}
          ${navButton("users", "Users", "users")}
          ${navButton("settings", "Settings", "sliders")}
        </nav>
      </aside>
      <main class="cms-main">
        ${content}
      </main>
    </div>
  `;
}

function pageHeader(title, subtitle, action = "") {
  return `
    <div class="cms-top">
      <div class="cms-title">
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
      ${action}
    </div>
  `;
}

function dashboard() {
  const topDramas = [...cmsState.dramas].sort((a, b) => b.stats.plays - a.stats.plays).slice(0, 5);
  const maxPlays = Math.max(...topDramas.map((item) => item.stats.plays), 1);
  const unlockRows = cmsState.transactions.filter((item) => item.type === "ad_unlock").slice(0, 6);
  return `
    ${pageHeader("Dashboard", "Content, revenue, comments and user activity")}
    <section class="metrics">
      <div class="metric-card"><span>Recharge</span><strong>${money(cmsState.metrics.revenue)}</strong></div>
      <div class="metric-card"><span>Ad Unlocks</span><strong>${cmsState.metrics.adUnlocks}</strong></div>
      <div class="metric-card"><span>Plays</span><strong>${compact.format(cmsState.metrics.plays)}</strong></div>
      <div class="metric-card"><span>Pending</span><strong>${cmsState.metrics.commentsPending}</strong></div>
    </section>
    <section class="chart-grid">
      <div class="cms-panel">
        <div class="cms-panel-head"><h2>Top Dramas</h2></div>
        <div class="bar-list">
          ${topDramas
            .map(
              (drama) => `
                <div class="bar-row">
                  <span>${drama.title}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${(drama.stats.plays / maxPlays) * 100}%"></div></div>
                  <strong>${compact.format(drama.stats.plays)}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
      <div class="cms-panel">
        <div class="cms-panel-head"><h2>Recent Ad Unlocks</h2></div>
        <div class="history-list">
          ${unlockRows
            .map((txn) => {
              const episode = cmsState.episodes.find((item) => item.id === txn.episodeId);
              const drama = episode ? dramaById(episode.dramaId) : null;
              return `<div class="history-row"><span>${drama?.title || txn.channel}</span><strong>Episode ${episode?.number || ""}</strong></div>`;
            })
            .join("") || `<div class="history-row"><span>No ad unlocks yet</span><strong></strong></div>`}
        </div>
      </div>
    </section>
  `;
}

function dramas() {
  const filters = cmsState.dramaFilters;
  const statuses = ["all", "draft", "published", "hidden"];
  const categories = ["all", ...cmsState.settings.categories];
  const rows = cmsState.dramas.filter((drama) => {
    const q = filters.q.trim().toLowerCase();
    const matchesQ = !q || drama.title.toLowerCase().includes(q) || drama.id.toLowerCase().includes(q);
    const matchesStatus = filters.status === "all" || drama.status === filters.status;
    const matchesCategory = filters.category === "all" || drama.category === filters.category;
    return matchesQ && matchesStatus && matchesCategory;
  });
  return `
    ${pageHeader("Dramas", `${rows.length} / ${cmsState.dramas.length} titles`, `<button class="cms-btn" data-open-upload>${icon("cloudUpload")}Upload Package</button>`)}
    <section class="cms-panel">
      <div class="cms-toolbar">
        <input class="cms-search" data-drama-filter="q" value="${filters.q}" placeholder="Search title or ID">
        <select data-drama-filter="status">${statuses.map((item) => `<option value="${item}" ${filters.status === item ? "selected" : ""}>${item === "all" ? "All status" : item}</option>`).join("")}</select>
        <select data-drama-filter="category">${categories.map((item) => `<option value="${item}" ${filters.category === item ? "selected" : ""}>${item === "all" ? "All categories" : item}</option>`).join("")}</select>
        <button class="cms-btn-secondary" data-clear-drama-filters>Clear</button>
      </div>
      <div class="table-wrap">
        <table class="data-table compact-table">
          <thead>
            <tr>
              <th>Drama</th><th>Status</th><th>Category</th><th>Weight</th><th>Episodes</th><th>Free</th><th>Plays</th><th>Unlock</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (drama) => `
                  <tr class="click-row" data-view-drama="${drama.id}" title="Open episodes">
                    <td>
                      <div class="drama-cell">
                        <img class="tiny-cover" src="${drama.cover}" alt="">
                        <div><strong>${drama.title}</strong><span>${drama.id}</span></div>
                      </div>
                    </td>
                    <td><span class="cms-pill ${drama.status}">${drama.status}</span></td>
                    <td>${drama.category}</td>
                    <td>${drama.weight ?? 1}</td>
                    <td>${drama.episodeCount || cmsState.episodes.filter((item) => item.dramaId === drama.id).length}</td>
                    <td>${drama.freeEpisodes}</td>
                    <td>${compact.format(drama.stats.plays)}</td>
                    <td>${drama.monetization?.adUnlock === false ? "Off" : "Ad"}</td>
                    <td class="row-actions">
                      <button class="icon-action" data-edit-drama="${drama.id}" title="Edit">${icon("edit")}</button>
                    </td>
                  </tr>
                `
              )
              .join("") || `<tr><td colspan="9" class="empty-cell">No dramas</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    ${cmsState.viewingDramaId ? dramaDetailsModal(dramaById(cmsState.viewingDramaId)) : ""}
    ${cmsState.editingDramaId ? dramaModal(dramaById(cmsState.editingDramaId)) : ""}
    ${cmsState.uploadOpen ? uploadModal() : ""}
  `;
}

function episodesForDrama(dramaId) {
  return cmsState.episodes.filter((item) => item.dramaId === dramaId).sort((a, b) => Number(a.number) - Number(b.number));
}

function episodeStorage(episode) {
  if (episode.storage === "r2") return "CDN";
  if (episode.videoUrl) return "Local";
  return "Empty";
}

function dramaDetailsModal(drama) {
  if (!drama) return "";
  const episodes = episodesForDrama(drama.id);
  return `
    <div class="cms-modal-backdrop" data-close-modal>
      <section class="cms-modal wide-modal" role="dialog" aria-modal="true" data-modal-panel>
        <div class="cms-modal-head">
          <div>
            <h2>${drama.title}</h2>
            <p>${drama.id}</p>
          </div>
          <div class="modal-head-actions">
            <button class="cms-btn-secondary" data-edit-drama="${drama.id}">${icon("edit")}Edit</button>
            <button class="icon-action" data-close-modal title="Close">${icon("close")}</button>
          </div>
        </div>
        <div class="drama-detail-body">
          <div class="detail-stats">
            <span><strong>${episodes.length}</strong>Episodes</span>
            <span><strong>${drama.freeEpisodes}</strong>Free</span>
            <span><strong>${drama.weight ?? 1}</strong>Weight</span>
            <span><strong>${compact.format(drama.stats?.plays || 0)}</strong>Plays</span>
          </div>
          <div class="table-wrap">
            <table class="data-table compact-table episode-detail-table">
              <thead><tr><th>No.</th><th>Title</th><th>Access</th><th>Status</th><th>Storage</th><th>File</th><th>Video</th></tr></thead>
              <tbody>
                ${episodes
                  .map(
                    (episode) => `
                      <tr>
                        <td>${episode.number}</td>
                        <td><strong>${episode.title || `Episode ${episode.number}`}</strong></td>
                        <td>${episode.isFree ? "Free" : drama.monetization?.adUnlock === false ? "Locked" : "Ad"}</td>
                        <td><span class="cms-pill ${episode.status || "draft"}">${episode.status || "draft"}</span></td>
                        <td>${episodeStorage(episode)}</td>
                        <td class="episode-file">${episode.originalFilename || episode.objectKey || ""}</td>
                        <td>${episode.videoUrl ? `<a class="episode-link" href="${episode.videoUrl}" target="_blank" rel="noreferrer">Open</a>` : ""}</td>
                      </tr>
                    `
                  )
                  .join("") || `<tr><td colspan="7" class="empty-cell">No episodes</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function dramaModal(drama) {
  if (!drama) return "";
  return `
    <div class="cms-modal-backdrop" data-close-modal>
      <section class="cms-modal" role="dialog" aria-modal="true" data-modal-panel>
        <div class="cms-modal-head">
          <div>
            <h2>Edit Drama</h2>
            <p>${drama.title}</p>
          </div>
          <button class="icon-action" data-close-modal title="Close">${icon("close")}</button>
        </div>
        ${editForm(drama)}
      </section>
    </div>
  `;
}

function field(name, label, value = "", type = "text") {
  return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${String(value ?? "").replaceAll('"', "&quot;")}"></div>`;
}

function multiSelectField(name, label, values, options) {
  const selected = new Set(values || []);
  return `
    <div class="field full">
      <label>${label}</label>
      <select name="${name}" multiple size="6">
        ${options.map((item) => `<option value="${item.id}" ${selected.has(item.id) ? "selected" : ""}>${item.title}</option>`).join("")}
      </select>
    </div>
  `;
}

function selectField(name, label, value, options) {
  return `
    <div class="field">
      <label>${label}</label>
      <select name="${name}">
        ${options.map((item) => `<option value="${item}" ${item === value ? "selected" : ""}>${item}</option>`).join("")}
      </select>
    </div>
  `;
}

function editForm(drama = {}) {
  const isEdit = Boolean(drama.id);
  return `
    <div class="cms-panel-head form-title">
      <h2>${isEdit ? "Edit Drama" : "New Drama"}</h2>
      ${isEdit ? `<span class="cms-pill ${drama.status}">${drama.status}</span>` : ""}
    </div>
    <form data-drama-form="${isEdit ? drama.id : ""}">
      <div class="form-grid">
        ${field("title", "Title", drama.title || "")}
        ${selectField("status", "Status", drama.status || "draft", ["draft", "published", "hidden"])}
        ${selectField("category", "Category", drama.category || "Romance", cmsState.settings.categories)}
        ${selectField("language", "Language", drama.language || cmsState.settings.defaultLanguage, cmsState.settings.supportedLanguages)}
        ${selectField("region", "Region", drama.region || "US", cmsState.settings.regions)}
        ${field("totalEpisodes", "Episodes", drama.totalEpisodes || 20, "number")}
        ${field("freeEpisodes", "Free Episodes", drama.freeEpisodes || 5, "number")}
        ${field("unlockPrice", "Unlock Price", drama.unlockPrice || 35, "number")}
        ${field("weight", "Weight", drama.weight ?? 1, "number")}
        <div class="field"><label>Ad Unlock</label><select name="adUnlock"><option value="true" ${drama.monetization?.adUnlock !== false ? "selected" : ""}>On</option><option value="false" ${drama.monetization?.adUnlock === false ? "selected" : ""}>Off</option></select></div>
        ${field("cover", "Cover URL", drama.cover || "")}
        ${field("banner", "Banner URL", drama.banner || "")}
        ${field("tags", "Tags", (drama.tags || []).join(", "))}
        <div class="field"><label>Subscription</label><select name="subscriptionOnly"><option value="false" ${!drama.subscriptionOnly ? "selected" : ""}>Off</option><option value="true" ${drama.subscriptionOnly ? "selected" : ""}>On</option></select></div>
        <div class="field full"><label>Description</label><textarea name="description">${drama.description || ""}</textarea></div>
      </div>
      <div class="cms-actions">
        ${isEdit ? `<button class="cms-btn-secondary" type="button" data-close-modal>Cancel</button>` : ""}
        <button class="cms-btn" type="submit">${isEdit ? "Save" : "Create"}</button>
      </div>
    </form>
  `;
}

function uploadForm({ modal = false } = {}) {
  return `
    <form data-zip-upload-form>
      <div class="form-grid">
        ${field("title", "Title", "")}
        ${selectField("category", "Category", "Romance", cmsState.settings.categories)}
        ${field("freeEpisodes", "Free Episodes", cmsState.settings.monetization.freeEpisodesDefault || 6, "number")}
        ${field("weight", "Weight", 1, "number")}
        ${field("cover", "Cover URL", "")}
        ${field("banner", "Banner URL", "")}
        <div class="field"><label>Subscription</label><select name="subscriptionOnly"><option value="false">Off</option><option value="true">On</option></select></div>
        <div class="field full"><label>Description</label><textarea name="description"></textarea></div>
        <div class="field full">
          <label>Package</label>
          <input class="upload-file-input" id="archivePackage" name="file" type="file" accept=".zip,.rar,application/zip,application/vnd.rar,application/x-rar-compressed" data-upload-file>
          <label class="upload-picker" for="archivePackage" data-upload-drop>
            <span class="upload-picker-icon">${icon("cloudUpload")}</span>
            <span class="upload-picker-main">
              <strong data-upload-file-name>Choose or drop ZIP/RAR</strong>
              <small>01.mp4, episode-02.mp4, EP003.mov</small>
            </span>
            <span class="cms-btn-secondary upload-picker-action">Browse</span>
          </label>
        </div>
      </div>
      <div class="upload-progress" data-upload-progress hidden>
        <div class="upload-progress-bar" data-upload-progress-bar></div>
      </div>
      <div class="upload-progress-meta" data-upload-progress-text></div>
      <div class="cms-actions">
        ${modal ? `<button class="cms-btn-secondary" type="button" data-close-modal>Cancel</button>` : `<button class="cms-btn-secondary" type="reset">Clear</button>`}
        <button class="cms-btn" type="submit" data-upload-submit>Upload</button>
      </div>
    </form>
    <div id="uploadResult" class="upload-result"></div>
  `;
}

function uploadModal() {
  return `
    <div class="cms-modal-backdrop" data-close-modal>
      <section class="cms-modal" role="dialog" aria-modal="true" data-modal-panel>
        <div class="cms-modal-head">
          <div><h2>Upload Package</h2><p>Batch import episodes</p></div>
          <button class="icon-action" data-close-modal title="Close">${icon("close")}</button>
        </div>
        <div class="upload-modal-body">${uploadForm({ modal: true })}</div>
      </section>
    </div>
  `;
}

function upload() {
  return `
    ${pageHeader("Upload", "Batch import ZIP/RAR packages")}
    <section class="cms-panel upload-page-panel">
      ${uploadForm()}
    </section>
  `;
}

function comments() {
  return `
    ${pageHeader("Comments", "Review, hide or restore video comments")}
    <section class="cms-panel">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Drama</th><th>User</th><th>Comment</th><th>Status</th><th>Likes</th><th></th></tr></thead>
          <tbody>
            ${cmsState.comments
              .map((comment) => {
                const drama = dramaById(comment.dramaId);
                return `
                  <tr>
                    <td>${drama?.title || comment.dramaId}</td>
                    <td>${comment.userName}</td>
                    <td>${comment.body}</td>
                    <td><span class="cms-pill ${comment.status}">${comment.status}</span></td>
                    <td>${comment.likes}</td>
                    <td>
                      <button class="cms-btn-secondary" data-comment-status="${comment.id}" data-status="visible">Show</button>
                      <button class="cms-btn-secondary" data-comment-status="${comment.id}" data-status="hidden">Hide</button>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function guideForm(post = {}) {
  const isEdit = Boolean(post.id);
  return `
    <form data-guide-form="${isEdit ? post.id : ""}">
      <div class="form-grid">
        ${field("title", "Title", post.title || "")}
        ${selectField("status", "Status", post.status || "published", ["published", "draft", "hidden"])}
        ${field("type", "Type", post.type || "Watch Guide")}
        ${field("weight", "Weight", post.weight ?? 1, "number")}
        <div class="field">
          <label>Drama</label>
          <select name="dramaId">
            <option value="">None</option>
            ${cmsState.dramas.map((drama) => `<option value="${drama.id}" ${post.dramaId === drama.id ? "selected" : ""}>${drama.title}</option>`).join("")}
          </select>
        </div>
        ${field("image", "Image URL", post.image || "")}
        <div class="field full"><label>Excerpt</label><textarea name="excerpt">${post.excerpt || ""}</textarea></div>
      </div>
      <div class="cms-actions">
        ${isEdit ? `<button class="cms-btn-secondary" type="button" data-close-modal>Cancel</button>` : ""}
        <button class="cms-btn" type="submit">${isEdit ? "Save" : "Create"}</button>
      </div>
    </form>
  `;
}

function guideModal(post) {
  if (!post) return "";
  return `
    <div class="cms-modal-backdrop" data-close-modal>
      <section class="cms-modal" role="dialog" aria-modal="true" data-modal-panel>
        <div class="cms-modal-head">
          <div><h2>Edit Guide</h2><p>${post.title}</p></div>
          <button class="icon-action" data-close-modal title="Close">${icon("close")}</button>
        </div>
        <div style="padding:0 18px 18px">${guideForm(post)}</div>
      </section>
    </div>
  `;
}

function guides() {
  const rows = [...cmsState.fandom].sort((a, b) => Number(b.weight || 1) - Number(a.weight || 1));
  return `
    ${pageHeader("Guides", `${rows.length} items`)}
    <section class="cms-panel">
      <div class="cms-panel-head"><h2>New Guide</h2></div>
      ${guideForm()}
    </section>
    <section class="cms-panel">
      <div class="table-wrap">
        <table class="data-table compact-table">
          <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Weight</th><th>Drama</th><th></th></tr></thead>
          <tbody>
            ${rows
              .map((post) => {
                const drama = dramaById(post.dramaId);
                return `
                  <tr>
                    <td><strong>${post.title}</strong></td>
                    <td>${post.type}</td>
                    <td><span class="cms-pill ${post.status}">${post.status}</span></td>
                    <td>${post.weight ?? 1}</td>
                    <td>${drama?.title || ""}</td>
                    <td class="row-actions">
                      <button class="icon-action" data-edit-guide="${post.id}" title="Edit">${icon("edit")}</button>
                      <button class="icon-action" data-delete-guide="${post.id}" title="Delete">${icon("close")}</button>
                    </td>
                  </tr>
                `;
              })
              .join("") || `<tr><td colspan="6" class="empty-cell">No guides</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    ${cmsState.editingGuideId ? guideModal(guideById(cmsState.editingGuideId)) : ""}
  `;
}

function users() {
  return `
    ${pageHeader("Users", "Wallet, favorites, unlocked episodes and watch history")}
    <section class="cms-panel">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>User</th><th>Region</th><th>Language</th><th>Balance</th><th>Favorites</th><th>Unlocked</th></tr></thead>
          <tbody>
            ${cmsState.users
              .map(
                (user) => `
                  <tr>
                    <td>${user.name}</td><td>${user.region}</td><td>${user.language}</td><td>${money(user.balance)}</td><td>${user.favorites.length}</td><td>${user.unlockedEpisodes.length}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="cms-panel">
      <div class="cms-panel-head"><h2>Transactions</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Time</th><th>User</th><th>Type</th><th>Channel</th><th>Amount</th></tr></thead>
          <tbody>
            ${cmsState.transactions
              .map(
                (txn) => `<tr><td>${new Date(txn.createdAt).toLocaleString()}</td><td>${txn.userId}</td><td>${txn.type}</td><td>${txn.channel}</td><td>${txn.amount}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function settings() {
  return `
    ${pageHeader("Settings", "US launch, TikTok Minis and policy URLs")}
    <section class="cms-panel">
      <form data-settings-form>
        <div class="form-grid">
          ${field("brand", "Brand", cmsState.settings.brand)}
          ${field("defaultLanguage", "Default Language", cmsState.settings.defaultLanguage)}
          ${field("launchRegion", "Launch Region", cmsState.settings.launchRegion)}
          ${field("clientKey", "TikTok Client Key", cmsState.settings.tiktok.clientKey)}
          ${field("appId", "Mini App ID", cmsState.settings.tiktok.appId)}
          ${field("rewardedAdUnitId", "Rewarded Ad Unit ID", cmsState.settings.monetization.rewardedAdUnitId)}
          <div class="field"><label>Ad Unlock</label><select name="adUnlockEnabled"><option value="true" ${cmsState.settings.monetization.adUnlockEnabled ? "selected" : ""}>On</option><option value="false">Off</option></select></div>
          <div class="field"><label>Payments</label><select name="paymentsEnabled"><option value="false" selected>Off</option></select></div>
          <div class="field"><label>Subscriptions</label><select name="subscriptionsEnabled"><option value="true" ${cmsState.settings.monetization.subscriptionsEnabled ? "selected" : ""}>On</option><option value="false">Off</option></select></div>
          ${field("privacy", "Privacy Policy URL", cmsState.settings.policyUrls.privacy)}
          ${field("terms", "Terms URL", cmsState.settings.policyUrls.terms)}
          ${field("dailyAdUnlockLimit", "Daily Ad Unlock Limit", cmsState.settings.monetization.dailyAdUnlockLimit, "number")}
          ${multiSelectField("homeCarouselIds", "Home Carousel", cmsState.settings.homeCarouselIds || [], cmsState.dramas)}
          <div class="field full"><label>Categories</label><textarea readonly>${cmsState.settings.categories.join(", ")}</textarea></div>
        </div>
        <div class="cms-actions">
          <button class="cms-btn" type="submit">Save</button>
        </div>
      </form>
    </section>
  `;
}

function render() {
  if (!cmsState.settings) {
    cmsRoot.innerHTML = `<main class="cms-main"><p>Loading</p></main>`;
    return;
  }
  const sections = { dashboard, dramas, upload, guides, comments, users, settings };
  cmsRoot.innerHTML = shell(`<section class="cms-section active">${(sections[cmsState.section] || dashboard)()}</section>`);
  bind();
}

function bind() {
  cmsRoot.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.section = button.dataset.section;
      cmsState.uploadOpen = false;
      cmsState.viewingDramaId = null;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-open-upload]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.uploadOpen = true;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-edit-drama]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      cmsState.editingDramaId = button.dataset.editDrama;
      cmsState.viewingDramaId = null;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-view-drama]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea")) return;
      cmsState.viewingDramaId = row.dataset.viewDrama;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-edit-guide]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.editingGuideId = button.dataset.editGuide;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest("[data-modal-panel]") && event.currentTarget.classList.contains("cms-modal-backdrop")) return;
      cmsState.editingDramaId = null;
      cmsState.editingGuideId = null;
      cmsState.viewingDramaId = null;
      cmsState.uploadOpen = false;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-drama-filter]").forEach((control) => {
    control.addEventListener("input", () => {
      cmsState.dramaFilters[control.dataset.dramaFilter] = control.value;
    });
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") render();
    });
    control.addEventListener("change", () => {
      cmsState.dramaFilters[control.dataset.dramaFilter] = control.value;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-clear-drama-filters]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.dramaFilters = { q: "", status: "all", category: "all" };
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-drama-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const body = Object.fromEntries(formData.entries());
      body.totalEpisodes = Number(body.totalEpisodes);
      body.freeEpisodes = Number(body.freeEpisodes);
      body.unlockPrice = Number(body.unlockPrice);
      body.weight = Number(body.weight || 1);
      body.subscriptionOnly = body.subscriptionOnly === "true";
      body.monetization = {
        iapEnabled: false,
        iaaEnabled: true,
        adUnlock: body.adUnlock === "true",
        subscriptionsEnabled: body.subscriptionOnly
      };
      delete body.adUnlock;
      const id = form.dataset.dramaForm;
      if (id) {
        await api(`/api/dramas/${id}`, { method: "PATCH", body });
        cmsState.editingDramaId = null;
      } else {
        await api("/api/dramas", { method: "POST", body });
        cmsState.section = "dramas";
      }
      await load();
    });
  });
  cmsRoot.querySelectorAll("[data-guide-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      body.weight = Number(body.weight || 1);
      const id = form.dataset.guideForm;
      if (id) {
        await api(`/api/fandom/${id}`, { method: "PATCH", body });
        cmsState.editingGuideId = null;
      } else {
        await api("/api/fandom", { method: "POST", body });
      }
      await load();
    });
  });
  cmsRoot.querySelectorAll("[data-delete-guide]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/fandom/${button.dataset.deleteGuide}`, { method: "DELETE" });
      await load();
    });
  });
  cmsRoot.querySelectorAll("[data-settings-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());
      await api("/api/settings", {
        method: "PATCH",
        body: {
          brand: data.brand,
          defaultLanguage: "English",
          launchRegion: "US",
          policyUrls: { privacy: data.privacy, terms: data.terms },
          tiktok: { clientKey: data.clientKey, appId: data.appId, requireProfileAuthorization: true },
          monetization: {
            paymentsEnabled: false,
            adUnlockEnabled: data.adUnlockEnabled === "true",
            subscriptionsEnabled: data.subscriptionsEnabled === "true",
            rewardedAdUnitId: data.rewardedAdUnitId,
            dailyAdUnlockLimit: Number(data.dailyAdUnlockLimit || 8)
          },
          homeCarouselIds: formData.getAll("homeCarouselIds")
        }
      });
      await load();
    });
  });
  cmsRoot.querySelectorAll("[data-upload-file]").forEach((input) => {
    const form = input.closest("[data-zip-upload-form]");
    const drop = form?.querySelector("[data-upload-drop]");
    const name = form?.querySelector("[data-upload-file-name]");
    const setFileName = () => {
      name.textContent = input.files?.[0]?.name || "Choose or drop ZIP/RAR";
    };
    input.addEventListener("change", setFileName);
    if (!drop) return;
    ["dragenter", "dragover"].forEach((type) => {
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.remove("dragging");
      });
    });
    drop.addEventListener("drop", (event) => {
      if (!event.dataTransfer?.files?.length) return;
      const transfer = new DataTransfer();
      transfer.items.add(event.dataTransfer.files[0]);
      input.files = transfer.files;
      setFileName();
    });
  });
  cmsRoot.querySelectorAll("[data-zip-upload-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = cmsRoot.querySelector("#uploadResult");
      const progress = form.querySelector("[data-upload-progress]");
      const progressBar = form.querySelector("[data-upload-progress-bar]");
      const progressText = form.querySelector("[data-upload-progress-text]");
      const submit = form.querySelector("[data-upload-submit]");
      const formData = new FormData(form);
      formData.set("weight", String(Number(formData.get("weight") || 1)));
      if (!formData.get("file") || !formData.get("file").name) {
        result.innerHTML = `<div class="upload-message error">Choose a ZIP or RAR file</div>`;
        return;
      }
      submit.disabled = true;
      progress.hidden = false;
      progressBar.style.width = "0%";
      progressText.textContent = "Uploading 0%";
      result.innerHTML = "";
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/dramas/upload-zip");
      xhr.upload.addEventListener("progress", (uploadEvent) => {
        if (!uploadEvent.lengthComputable) {
          progressText.textContent = "Uploading";
          return;
        }
        const percent = Math.max(1, Math.round((uploadEvent.loaded / uploadEvent.total) * 100));
        progressBar.style.width = `${percent}%`;
        progressText.textContent = percent >= 100 ? "Processing" : `Uploading ${percent}%`;
      });
      xhr.addEventListener("load", async () => {
        let json = {};
        try {
          json = JSON.parse(xhr.responseText || "{}");
        } catch (error) {
          json = { error: "Upload failed" };
        }
        submit.disabled = false;
        if (xhr.status < 200 || xhr.status >= 300) {
          progressText.textContent = "";
          result.innerHTML = `<div class="upload-message error">${json.error || "Upload failed"}</div>`;
          return;
        }
        progressBar.style.width = "100%";
        progressText.textContent = "Complete";
        result.innerHTML = `
          <div class="upload-summary">
            <div>
              <strong>${json.drama.title}</strong>
              <span>${json.matched.length} episodes imported</span>
            </div>
          </div>
        `;
        const data = await api("/api/cms");
        Object.assign(cmsState, data);
        cmsState.section = "dramas";
        window.setTimeout(() => {
          cmsState.uploadOpen = false;
          cmsState.viewingDramaId = json.drama.id;
          render();
        }, 450);
      });
      xhr.addEventListener("error", () => {
        submit.disabled = false;
        progressText.textContent = "";
        result.innerHTML = `<div class="upload-message error">Network error</div>`;
      });
      xhr.send(formData);
    });
  });
  cmsRoot.querySelectorAll("[data-comment-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/comments/${button.dataset.commentStatus}`, {
        method: "PATCH",
        body: { status: button.dataset.status }
      });
      await load();
    });
  });
}

async function load() {
  const data = await api("/api/cms");
  Object.assign(cmsState, data);
  render();
}

load().catch((error) => {
  cmsRoot.innerHTML = `<main class="cms-main"><p>${error.message}</p></main>`;
});
