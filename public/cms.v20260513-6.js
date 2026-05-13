const cmsState = {
  adminToken: localStorage.getItem("vidshort_admin_token") || "",
  currentAdmin: null,
  authRequired: false,
  loginError: "",
  loginLoading: false,
  settings: null,
  metrics: null,
  dramas: [],
  episodes: [],
  users: [],
  transactions: [],
  comments: [],
  events: [],
  dashboard: null,
  fandom: [],
  section: "dramas",
  editingDramaId: null,
  editingGuideId: null,
  editingEpisodeId: null,
  viewingDramaId: null,
  uploadOpen: false,
  dashboardDate: "",
  userTab: "users",
  userFilters: {
    q: "",
    subscription: "all",
    activity: "all"
  },
  transactionFilters: {
    q: "",
    type: "all"
  },
  eventFilters: {
    q: "",
    type: "all"
  },
  commentFilters: {
    q: "",
    status: "all"
  },
  dramaFilters: {
    q: "",
    status: "all",
    category: "all"
  }
};

const cmsRoot = document.querySelector("#cms");
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function yesterdayKey() {
  return new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (cmsState.adminToken) headers.Authorization = `Bearer ${cmsState.adminToken}`;
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? (options.body instanceof FormData ? options.body : JSON.stringify(options.body)) : undefined
  });
  const json = await response.json();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      cmsState.authRequired = true;
      cmsState.currentAdmin = null;
      if (response.status === 401) {
        cmsState.adminToken = "";
        localStorage.removeItem("vidshort_admin_token");
      }
    }
    throw new Error(json.error || "Request failed");
  }
  return json;
}

const UPLOAD_CHUNK_SIZE = 32 * 1024 * 1024;

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function chunkBytes(index, totalChunks, chunkSize, fileSize) {
  return index === totalChunks - 1 ? fileSize - chunkSize * index : chunkSize;
}

function uploadedBytes(received, totalChunks, chunkSize, fileSize) {
  return received.reduce((sum, index) => sum + chunkBytes(index, totalChunks, chunkSize, fileSize), 0);
}

function uploadChunk(uploadId, index, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/uploads/chunked/${encodeURIComponent(uploadId)}/${index}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    if (cmsState.adminToken) xhr.setRequestHeader("Authorization", `Bearer ${cmsState.adminToken}`);
    xhr.upload.addEventListener("progress", (event) => {
      onProgress(event.lengthComputable ? event.loaded : 0);
    });
    xhr.addEventListener("load", () => {
      let json = {};
      try {
        json = JSON.parse(xhr.responseText || "{}");
      } catch (error) {
        json = { error: "Upload failed" };
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(json.error || "Upload failed"));
        return;
      }
      resolve(json);
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.send(blob);
  });
}

function dramaById(id) {
  return cmsState.dramas.find((item) => item.id === id);
}

function guideById(id) {
  return cmsState.fandom.find((item) => item.id === id);
}

function episodeById(id) {
  return cmsState.episodes.find((item) => item.id === id);
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
        <div class="cms-userbar">
          <div><strong>${cmsState.currentAdmin?.name || "Admin"}</strong><span>${cmsState.currentAdmin?.openId || cmsState.currentAdmin?.id || ""}</span></div>
          <button class="cms-btn-secondary" data-admin-logout>Logout</button>
        </div>
      </aside>
      <main class="cms-main">
        ${content}
      </main>
    </div>
  `;
}

function loginView() {
  return `
    <main class="cms-login-wrap">
      <form class="cms-login-card" data-admin-login-form>
        <div class="cms-logo login-logo"><div class="logo">V</div><span>VidShort CMS</span></div>
        <h1>Admin Login</h1>
        <label>
          <span>OpenID / User ID</span>
          <input name="login" autocomplete="username" required>
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autocomplete="current-password">
        </label>
        ${cmsState.loginError ? `<div class="cms-error">${cmsState.loginError}</div>` : ""}
        <button class="cms-btn" type="submit" ${cmsState.loginLoading ? "disabled" : ""}>${cmsState.loginLoading ? "Logging in" : "Login"}</button>
      </form>
    </main>
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
  const report = cmsState.dashboard || { date: cmsState.dashboardDate || yesterdayKey(), metrics: {}, topDramas: [], recentEvents: [] };
  const metrics = report.metrics || {};
  const topDramas = report.topDramas || [];
  const maxPlays = Math.max(...topDramas.map((item) => item.plays), 1);
  const eventLabels = {
    user_register: "Registration",
    click: "Click",
    play_start: "Play",
    play_progress: "Progress",
    play_complete: "Complete",
    unlock: "Unlock",
    comment: "Comment",
    favorite: "Favorite",
    unfavorite: "Unfavorite",
    subscription: "Subscription"
  };
  return `
    ${pageHeader("Dashboard", "Daily acquisition, engagement and monetization", `
      <form class="date-filter" data-dashboard-date-form>
        <input type="date" name="date" value="${report.date}">
        <button class="cms-btn" type="submit">Query</button>
      </form>
    `)}
    <section class="metrics">
      <div class="metric-card"><span>Registrations</span><strong>${compact.format(metrics.registrations || 0)}</strong></div>
      <div class="metric-card"><span>Clicks</span><strong>${compact.format(metrics.clicks || 0)}</strong></div>
      <div class="metric-card"><span>Plays</span><strong>${compact.format(metrics.plays || 0)}</strong></div>
      <div class="metric-card"><span>Unlocks</span><strong>${compact.format(metrics.unlocks || 0)}</strong></div>
      <div class="metric-card"><span>Comments</span><strong>${compact.format(metrics.comments || 0)}</strong></div>
      <div class="metric-card"><span>Favorites</span><strong>${compact.format(metrics.favorites || 0)}</strong></div>
      <div class="metric-card"><span>Subscriptions</span><strong>${compact.format(metrics.subscriptions || 0)}</strong></div>
      <div class="metric-card"><span>Active Users</span><strong>${compact.format(metrics.activeUsers || 0)}</strong></div>
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
                  <div class="bar-track"><div class="bar-fill" style="width:${(drama.plays / maxPlays) * 100}%"></div></div>
                  <strong>${compact.format(drama.plays)}</strong>
                </div>
              `
            )
            .join("") || `<div class="history-row"><span>No play data</span><strong></strong></div>`}
        </div>
      </div>
      <div class="cms-panel">
        <div class="cms-panel-head"><h2>Recent Events</h2></div>
        <div class="history-list">
          ${(report.recentEvents || [])
            .map((event) => {
              const drama = event.dramaId ? dramaById(event.dramaId) : null;
              const episode = event.episodeId ? cmsState.episodes.find((item) => item.id === event.episodeId) : null;
              return `<div class="history-row"><span>${eventLabels[event.type] || event.type} · ${drama?.title || event.label || event.userId || ""}</span><strong>${episode ? `Episode ${episode.number}` : new Date(event.createdAt).toLocaleTimeString()}</strong></div>`;
            })
            .join("") || `<div class="history-row"><span>No events</span><strong></strong></div>`}
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
              <thead><tr><th>No.</th><th>Title</th><th>Description</th><th>Access</th><th>Status</th><th>Storage</th><th>File</th><th>Video</th><th></th></tr></thead>
              <tbody>
                ${episodes
                  .map(
                    (episode) => `
                      <tr>
                        <td>${episode.number}</td>
                        <td><strong>${episode.title || `Episode ${episode.number}`}</strong></td>
                        <td class="episode-plot">${episode.plot || ""}</td>
                        <td>${episode.isFree ? "Free" : drama.monetization?.adUnlock === false ? "Locked" : "Ad"}</td>
                        <td><span class="cms-pill ${episode.status || "draft"}">${episode.status || "draft"}</span></td>
                        <td>${episodeStorage(episode)}</td>
                        <td class="episode-file">${episode.originalFilename || episode.objectKey || ""}</td>
                        <td>${episode.videoUrl ? `<a class="episode-link" href="${episode.videoUrl}" target="_blank" rel="noreferrer">Open</a>` : ""}</td>
                        <td class="row-actions"><button class="icon-action" data-edit-episode="${episode.id}" title="Edit episode">${icon("edit")}</button></td>
                      </tr>
                    `
                  )
                  .join("") || `<tr><td colspan="9" class="empty-cell">No episodes</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
    ${cmsState.editingEpisodeId ? episodeModal(episodeById(cmsState.editingEpisodeId)) : ""}
  `;
}

function episodeModal(episode) {
  if (!episode) return "";
  const drama = dramaById(episode.dramaId);
  return `
    <div class="cms-modal-backdrop" data-close-episode-modal>
      <section class="cms-modal" role="dialog" aria-modal="true" data-modal-panel>
        <div class="cms-modal-head">
          <div>
            <h2>Episode ${episode.number}</h2>
            <p>${drama?.title || episode.dramaId}</p>
          </div>
          <button class="icon-action" data-close-episode-modal title="Close">${icon("close")}</button>
        </div>
        <form data-episode-form="${episode.id}">
          <div class="form-grid">
            ${field("title", "Title", episode.title || `Episode ${episode.number}`)}
            ${field("duration", "Duration", episode.duration || "")}
            ${selectField("status", "Status", episode.status || "draft", ["ready", "draft", "hidden"])}
            ${field("videoUrl", "Video URL", episode.videoUrl || "")}
            <div class="field full"><label>Plot</label><textarea name="plot">${episode.plot || ""}</textarea></div>
          </div>
          <div class="cms-actions">
            <button class="cms-btn-secondary" type="button" data-close-episode-modal>Cancel</button>
            <button class="cms-btn" type="submit">Save</button>
          </div>
        </form>
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
              <small>Resumable chunks, 01.mp4, EP002.mov</small>
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
  const filters = cmsState.commentFilters;
  const statuses = ["all", "visible", "pending", "hidden"];
  const rows = cmsState.comments.filter((comment) => {
    const q = filters.q.trim().toLowerCase();
    const drama = dramaById(comment.dramaId);
    const matchesQ = !q || comment.body.toLowerCase().includes(q) || comment.userName.toLowerCase().includes(q) || (drama?.title || "").toLowerCase().includes(q);
    const matchesStatus = filters.status === "all" || comment.status === filters.status;
    return matchesQ && matchesStatus;
  });
  return `
    ${pageHeader("Comments", `${rows.length} / ${cmsState.comments.length} comments`)}
    <section class="cms-panel">
      <div class="cms-toolbar compact-toolbar">
        <input class="cms-search" data-comment-filter="q" value="${filters.q}" placeholder="Search comment, user or drama">
        <select data-comment-filter="status">${statuses.map((item) => `<option value="${item}" ${filters.status === item ? "selected" : ""}>${item === "all" ? "All status" : item}</option>`).join("")}</select>
        <button class="cms-btn-secondary" data-clear-comment-filters>Clear</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Drama</th><th>User</th><th>Comment</th><th>Status</th><th>Likes</th><th></th></tr></thead>
          <tbody>
            ${rows
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
              .join("") || `<tr><td colspan="6" class="empty-cell">No comments</td></tr>`}
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
  const filters = cmsState.userFilters;
  const userRows = cmsState.users.filter((user) => {
    const q = filters.q.trim().toLowerCase();
    const matchesQ = !q || user.name.toLowerCase().includes(q) || user.id.toLowerCase().includes(q) || String(user.openId || "").toLowerCase().includes(q);
    const matchesSubscription = filters.subscription === "all" || (user.subscription?.status || "inactive") === filters.subscription;
    const hasActivity = (cmsState.events || []).some((event) => event.userId === user.id);
    const matchesActivity = filters.activity === "all" || (filters.activity === "active" ? hasActivity : !hasActivity);
    return matchesQ && matchesSubscription && matchesActivity;
  });
  const tabs = [
    ["users", "Users"],
    ["transactions", "Transactions"],
    ["events", "Events"]
  ];
  const tabBar = `<div class="sub-tabs">${tabs.map(([id, label]) => `<button class="${cmsState.userTab === id ? "active" : ""}" data-user-tab="${id}">${label}</button>`).join("")}</div>`;
  const userToolbar = `
    <div class="cms-toolbar compact-toolbar">
      <input class="cms-search" data-user-filter="q" value="${filters.q}" placeholder="Search user, ID or openid">
      <select data-user-filter="subscription">
        ${["all", "active", "inactive"].map((item) => `<option value="${item}" ${filters.subscription === item ? "selected" : ""}>${item === "all" ? "All subscriptions" : item}</option>`).join("")}
      </select>
      <select data-user-filter="activity">
        ${[["all", "All activity"], ["active", "Has events"], ["inactive", "No events"]].map(([value, label]) => `<option value="${value}" ${filters.activity === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
      <button class="cms-btn-secondary" data-clear-user-filters>Clear</button>
    </div>
  `;
  const txnFilters = cmsState.transactionFilters;
  const transactionRows = cmsState.transactions.filter((txn) => {
    const q = txnFilters.q.trim().toLowerCase();
    const matchesQ = !q || String(txn.userId || "").toLowerCase().includes(q) || String(txn.channel || "").toLowerCase().includes(q) || String(txn.episodeId || "").toLowerCase().includes(q);
    const matchesType = txnFilters.type === "all" || txn.type === txnFilters.type;
    return matchesQ && matchesType;
  });
  const eventFilters = cmsState.eventFilters;
  const eventTypes = ["all", ...new Set((cmsState.events || []).map((event) => event.type))];
  const eventRows = (cmsState.events || []).filter((event) => {
    const drama = event.dramaId ? dramaById(event.dramaId) : null;
    const q = eventFilters.q.trim().toLowerCase();
    const matchesQ = !q || String(event.userId || "").toLowerCase().includes(q) || String(event.label || "").toLowerCase().includes(q) || (drama?.title || "").toLowerCase().includes(q);
    const matchesType = eventFilters.type === "all" || event.type === eventFilters.type;
    return matchesQ && matchesType;
  });
  const usersTable = `
    <section class="cms-panel">
      ${userToolbar}
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>User</th><th>OpenID</th><th>Role</th><th>Subscription</th><th>Registered</th><th>Favorites</th><th>Unlocked</th><th></th></tr></thead>
          <tbody>
            ${userRows
              .map(
                (user) => `
                  <tr>
                    <td><strong>${user.name}</strong><br><span class="cell-sub">${user.id}</span></td>
                    <td><span class="cell-sub">${user.openId || ""}</span></td>
                    <td><span class="cms-pill ${user.isAdmin ? "admin" : "inactive"}">${user.isAdmin ? "Admin" : "User"}</span></td>
                    <td><span class="cms-pill ${user.subscription?.status || "inactive"}">${user.subscription?.status || "inactive"}</span></td>
                    <td>${user.registeredAt ? new Date(user.registeredAt).toLocaleString() : ""}</td>
                    <td>${user.favorites.length}</td>
                    <td>${user.unlockedEpisodes.length}</td>
                    <td class="row-actions">
                      <button class="cms-btn-secondary small-btn" data-admin-toggle="${user.id}" data-admin-value="${user.isAdmin ? "false" : "true"}" ${cmsState.currentAdmin?.id === user.id && user.isAdmin ? "disabled" : ""}>${user.isAdmin ? "Revoke" : "Grant"}</button>
                    </td>
                  </tr>
                `
              )
              .join("") || `<tr><td colspan="8" class="empty-cell">No users</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
  const transactionsTable = `
    <section class="cms-panel">
      <div class="cms-toolbar compact-toolbar">
        <input class="cms-search" data-transaction-filter="q" value="${txnFilters.q}" placeholder="Search user, channel or episode">
        <select data-transaction-filter="type">
          ${["all", ...new Set(cmsState.transactions.map((txn) => txn.type))].map((item) => `<option value="${item}" ${txnFilters.type === item ? "selected" : ""}>${item === "all" ? "All types" : item}</option>`).join("")}
        </select>
        <button class="cms-btn-secondary" data-clear-transaction-filters>Clear</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Time</th><th>User</th><th>Type</th><th>Channel</th><th>Episode</th><th>Amount</th></tr></thead>
          <tbody>
            ${transactionRows
              .map((txn) => {
                const episode = cmsState.episodes.find((item) => item.id === txn.episodeId);
                return `<tr><td>${new Date(txn.createdAt).toLocaleString()}</td><td>${txn.userId}</td><td>${txn.type}</td><td>${txn.channel}</td><td>${episode ? `Episode ${episode.number}` : ""}</td><td>${txn.amount}</td></tr>`;
              })
              .join("") || `<tr><td colspan="6" class="empty-cell">No transactions</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
  const eventsTable = `
    <section class="cms-panel">
      <div class="cms-toolbar compact-toolbar">
        <input class="cms-search" data-event-filter="q" value="${eventFilters.q}" placeholder="Search user, drama or label">
        <select data-event-filter="type">
          ${eventTypes.map((item) => `<option value="${item}" ${eventFilters.type === item ? "selected" : ""}>${item === "all" ? "All events" : item}</option>`).join("")}
        </select>
        <button class="cms-btn-secondary" data-clear-event-filters>Clear</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Time</th><th>Type</th><th>User</th><th>Drama</th><th>Episode</th><th>Label</th></tr></thead>
          <tbody>
            ${eventRows
              .map((event) => {
                const drama = event.dramaId ? dramaById(event.dramaId) : null;
                const episode = event.episodeId ? cmsState.episodes.find((item) => item.id === event.episodeId) : null;
                return `<tr><td>${new Date(event.createdAt).toLocaleString()}</td><td>${event.type}</td><td>${event.userId || ""}</td><td>${drama?.title || event.dramaId || ""}</td><td>${episode ? `Episode ${episode.number}` : ""}</td><td>${event.label || ""}</td></tr>`;
              })
              .join("") || `<tr><td colspan="6" class="empty-cell">No events</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
  const panes = { users: usersTable, transactions: transactionsTable, events: eventsTable };
  return `
    ${pageHeader("Users", `${userRows.length} / ${cmsState.users.length} users`)}
    ${tabBar}
    ${panes[cmsState.userTab] || usersTable}
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
  if (cmsState.authRequired || !cmsState.adminToken) {
    cmsRoot.innerHTML = loginView();
    bindLogin();
    return;
  }
  if (!cmsState.settings) {
    cmsRoot.innerHTML = `<main class="cms-main"><p>Loading</p></main>`;
    return;
  }
  const sections = { dashboard, dramas, upload, guides, comments, users, settings };
  cmsRoot.innerHTML = shell(`<section class="cms-section active">${(sections[cmsState.section] || dashboard)()}</section>`);
  bind();
}

function bindLogin() {
  cmsRoot.querySelectorAll("[data-admin-login-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      cmsState.loginLoading = true;
      cmsState.loginError = "";
      cmsRoot.innerHTML = loginView();
      bindLogin();
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const result = await api("/api/cms/login", { method: "POST", body: data });
        cmsState.adminToken = result.token;
        cmsState.currentAdmin = result.user;
        cmsState.authRequired = false;
        localStorage.setItem("vidshort_admin_token", result.token);
        cmsState.loginLoading = false;
        await load();
      } catch (error) {
        cmsState.loginLoading = false;
        cmsState.loginError = error.message;
        cmsState.authRequired = true;
        render();
      }
    });
  });
}

function bind() {
  cmsRoot.querySelectorAll("[data-admin-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api("/api/cms/logout", { method: "POST", body: {} });
      } catch (error) {
        // Local logout should still clear an expired token.
      }
      cmsState.adminToken = "";
      cmsState.currentAdmin = null;
      cmsState.authRequired = true;
      localStorage.removeItem("vidshort_admin_token");
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.section = button.dataset.section;
      cmsState.uploadOpen = false;
      cmsState.viewingDramaId = null;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-dashboard-date-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      cmsState.dashboardDate = new FormData(form).get("date") || yesterdayKey();
      await load();
    });
  });
  cmsRoot.querySelectorAll("[data-user-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.userTab = button.dataset.userTab;
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
  cmsRoot.querySelectorAll("[data-edit-episode]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      cmsState.editingEpisodeId = button.dataset.editEpisode;
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
      cmsState.editingEpisodeId = null;
      cmsState.viewingDramaId = null;
      cmsState.uploadOpen = false;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-close-episode-modal]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest("[data-modal-panel]") && event.currentTarget.classList.contains("cms-modal-backdrop")) return;
      cmsState.editingEpisodeId = null;
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
  cmsRoot.querySelectorAll("[data-comment-filter]").forEach((control) => {
    control.addEventListener("input", () => {
      cmsState.commentFilters[control.dataset.commentFilter] = control.value;
    });
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") render();
    });
    control.addEventListener("change", () => {
      cmsState.commentFilters[control.dataset.commentFilter] = control.value;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-clear-comment-filters]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.commentFilters = { q: "", status: "all" };
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-user-filter]").forEach((control) => {
    control.addEventListener("input", () => {
      cmsState.userFilters[control.dataset.userFilter] = control.value;
    });
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") render();
    });
    control.addEventListener("change", () => {
      cmsState.userFilters[control.dataset.userFilter] = control.value;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-transaction-filter]").forEach((control) => {
    control.addEventListener("input", () => {
      cmsState.transactionFilters[control.dataset.transactionFilter] = control.value;
    });
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") render();
    });
    control.addEventListener("change", () => {
      cmsState.transactionFilters[control.dataset.transactionFilter] = control.value;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-event-filter]").forEach((control) => {
    control.addEventListener("input", () => {
      cmsState.eventFilters[control.dataset.eventFilter] = control.value;
    });
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") render();
    });
    control.addEventListener("change", () => {
      cmsState.eventFilters[control.dataset.eventFilter] = control.value;
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-clear-user-filters]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.userFilters = { q: "", subscription: "all", activity: "all" };
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-clear-transaction-filters]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.transactionFilters = { q: "", type: "all" };
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-clear-event-filters]").forEach((button) => {
    button.addEventListener("click", () => {
      cmsState.eventFilters = { q: "", type: "all" };
      render();
    });
  });
  cmsRoot.querySelectorAll("[data-admin-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      await api(`/api/cms/users/${button.dataset.adminToggle}/admin`, {
        method: "PATCH",
        body: { isAdmin: button.dataset.adminValue === "true" }
      });
      await load();
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
  cmsRoot.querySelectorAll("[data-episode-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      await api(`/api/episodes/${form.dataset.episodeForm}`, { method: "PATCH", body });
      cmsState.editingEpisodeId = null;
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
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = form.parentElement?.querySelector("#uploadResult") || cmsRoot.querySelector("#uploadResult");
      const progress = form.querySelector("[data-upload-progress]");
      const progressBar = form.querySelector("[data-upload-progress-bar]");
      const progressText = form.querySelector("[data-upload-progress-text]");
      const submit = form.querySelector("[data-upload-submit]");
      const formData = new FormData(form);
      formData.set("weight", String(Number(formData.get("weight") || 1)));
      const file = formData.get("file");
      if (!file || !file.name) {
        result.innerHTML = `<div class="upload-message error">Choose a ZIP or RAR file</div>`;
        return;
      }
      submit.disabled = true;
      progress.hidden = false;
      progressBar.style.width = "0%";
      progressText.textContent = "Uploading 0%";
      result.innerHTML = "";
      try {
        const init = await api("/api/uploads/chunked/init", {
          method: "POST",
          body: {
            filename: file.name,
            fileSize: file.size,
            lastModified: file.lastModified,
            chunkSize: UPLOAD_CHUNK_SIZE,
            title: formData.get("title") || file.name.replace(/\.[^.]+$/, ""),
            category: formData.get("category") || "Romance",
            freeEpisodes: formData.get("freeEpisodes") || 6,
            weight: formData.get("weight") || 1,
            cover: formData.get("cover") || "",
            banner: formData.get("banner") || "",
            description: formData.get("description") || "",
            subscriptionOnly: formData.get("subscriptionOnly") || "false"
          }
        });
        const received = new Set(init.received || []);
        let uploaded = uploadedBytes([...received], init.totalChunks, init.chunkSize, file.size);
        const updateProgress = (activeBytes = 0) => {
          const percent = Math.max(0, Math.min(99, Math.round(((uploaded + activeBytes) / file.size) * 100)));
          progressBar.style.width = `${percent}%`;
          progressText.textContent = uploaded > 0 ? `Resuming ${percent}%` : `Uploading ${percent}%`;
        };
        updateProgress();
        for (let index = 0; index < init.totalChunks; index += 1) {
          if (received.has(index)) continue;
          const start = index * init.chunkSize;
          const end = Math.min(file.size, start + init.chunkSize);
          const chunk = file.slice(start, end);
          await uploadChunk(init.uploadId, index, chunk, (loaded) => updateProgress(loaded));
          received.add(index);
          uploaded += chunk.size;
          const percent = Math.min(99, Math.round((uploaded / file.size) * 100));
          progressBar.style.width = `${percent}%`;
          progressText.textContent = `Uploading ${percent}% (${index + 1}/${init.totalChunks})`;
        }
        progressBar.style.width = "100%";
        progressText.textContent = "Processing";
        let status = await api(`/api/uploads/chunked/${encodeURIComponent(init.uploadId)}/complete`, {
          method: "POST",
          body: {}
        });
        while (status.status !== "done" && status.status !== "error") {
          progressText.textContent = status.status === "queued" ? "Queued" : "Processing";
          await sleep(2000);
          status = await api(`/api/uploads/chunked/${encodeURIComponent(init.uploadId)}`);
        }
        if (status.status === "error") throw new Error(status.error || "Archive import failed");
        const drama = status.drama;
        const matched = status.matched || [];
        if (!drama) throw new Error("Archive import finished without drama data");
        submit.disabled = false;
        progressText.textContent = "Complete";
        result.innerHTML = `
          <div class="upload-summary">
            <div>
              <strong>${drama.title}</strong>
              <span>${matched.length} episodes imported</span>
            </div>
          </div>
        `;
        const data = await api(`/api/cms?date=${encodeURIComponent(cmsState.dashboardDate || yesterdayKey())}`);
        Object.assign(cmsState, data);
        cmsState.section = "dramas";
        window.setTimeout(() => {
          cmsState.uploadOpen = false;
          cmsState.viewingDramaId = drama.id;
          render();
        }, 450);
      } catch (error) {
        submit.disabled = false;
        progressText.textContent = "";
        result.innerHTML = `<div class="upload-message error">${error.message || "Upload failed"}</div>`;
      }
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
  if (!cmsState.adminToken) {
    cmsState.authRequired = true;
    render();
    return;
  }
  if (!cmsState.dashboardDate) cmsState.dashboardDate = yesterdayKey();
  const data = await api(`/api/cms?date=${encodeURIComponent(cmsState.dashboardDate)}`);
  Object.assign(cmsState, data);
  cmsState.currentAdmin = data.currentAdmin || cmsState.currentAdmin;
  cmsState.authRequired = false;
  cmsState.loginError = "";
  cmsState.dashboardDate = data.dashboard?.date || cmsState.dashboardDate;
  render();
}

load().catch((error) => {
  cmsState.loginError = error.message;
  render();
});
