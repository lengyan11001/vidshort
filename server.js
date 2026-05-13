const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");
const { Pool } = require("pg");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const JSON_DB_FILE = DB_FILE;
const MEDIA_DIR = path.join(ROOT, "media");
const CHUNK_UPLOAD_DIR = path.join(MEDIA_DIR, "chunk-uploads");
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const chunkProcessing = new Set();
const DATABASE_URL = process.env.DATABASE_URL || "";
const USE_POSTGRES = Boolean(DATABASE_URL);
const POSTGRES_COLLECTIONS = ["settings", "dramas", "episodes", "users", "transactions", "comments", "events", "fandom", "adminSessions"];
let pgPool = null;
let cachedDb = null;
let persistedDb = null;
let dbWriteChain = Promise.resolve();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t"
};

function staticCacheControl(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "no-store";
  if ([".js", ".css"].includes(ext)) return "public, max-age=300, must-revalidate";
  if (filePath.includes(`${path.sep}media${path.sep}`)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

function withoutTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function runtimeR2Config() {
  return {
    endpoint: withoutTrailingSlash(process.env.R2_ENDPOINT || ""),
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    region: process.env.R2_REGION || process.env.AWS_DEFAULT_REGION || "auto",
    bucket: process.env.VIDSHORT_CDN_BUCKET || "vidshort-cdn",
    publicBaseUrl: withoutTrailingSlash(process.env.VIDSHORT_CDN_DOMAIN || "https://cdn.vidshort.uk")
  };
}

function isR2Configured() {
  const config = runtimeR2Config();
  return Boolean(config.endpoint && config.accessKeyId && config.secretAccessKey && config.bucket && config.publicBaseUrl);
}

const DEFAULT_SETTINGS = {
  brand: "VidShort",
  defaultLanguage: "English",
  launchRegion: "US",
  supportedLanguages: ["English", "\u4e2d\u6587"],
  categories: ["Romance", "Fantasy", "Action", "Revenge", "Comedy", "Mystery"],
  regions: ["US"],
  currencyName: "Beans",
  policyUrls: {
    privacy: "https://vidshort.uk/privacy",
    terms: "https://vidshort.uk/terms"
  },
  tiktok: {
    appId: "replace_with_tiktok_mini_app_id",
    clientKey: "replace_with_client_key",
    requireProfileAuthorization: true
  },
  monetization: {
    paymentsEnabled: false,
    adUnlockEnabled: true,
    subscriptionsEnabled: true,
    rewardedAdUnitId: "replace_with_rewarded_ad_unit_id",
    interstitialAdUnitId: "",
    defaultUnlockMode: "rewarded_ad",
    freeEpisodesDefault: 6,
    dailyAdUnlockLimit: 8
  },
  homeCarouselIds: ["drama_mer", "drama_blade", "drama_boss"],
  media: {
    storage: isR2Configured() ? "r2" : "local",
    mediaBaseUrl: isR2Configured() ? runtimeR2Config().publicBaseUrl : "/media",
    cdnBucket: process.env.VIDSHORT_CDN_BUCKET || "",
    maxUploadMb: 2048,
    allowedVideoExtensions: [".mp4", ".m4v", ".mov", ".webm"]
  }
};

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function getPgPool() {
  if (!USE_POSTGRES) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }
  return pgPool;
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  if (!fs.existsSync(CHUNK_UPLOAD_DIR)) fs.mkdirSync(CHUNK_UPLOAD_DIR, { recursive: true });
  if (!USE_POSTGRES && !fs.existsSync(JSON_DB_FILE)) fs.writeFileSync(JSON_DB_FILE, JSON.stringify(seedData(), null, 2));
}

function readJsonDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(JSON_DB_FILE, "utf8"));
  if (normalizeDb(db)) writeJsonDb(db);
  return db;
}

function writeJsonDb(db) {
  fs.writeFileSync(JSON_DB_FILE, JSON.stringify(db, null, 2));
}

function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

function buildEntityMap(rows = []) {
  const map = new Map();
  rows.forEach((item) => {
    const id = collectionId(item, "row");
    map.set(id, JSON.stringify(item));
  });
  return map;
}

function changedEntities(previousRows = [], nextRows = []) {
  const previous = buildEntityMap(previousRows);
  const next = buildEntityMap(nextRows);
  const deletes = [...previous.keys()].filter((id) => !next.has(id));
  const upserts = [];
  for (const item of nextRows) {
    const id = collectionId(item, "row");
    if (previous.get(id) !== next.get(id)) upserts.push({ id, item });
  }
  return { deletes, upserts };
}

function readDb() {
  ensureDb();
  if (!cachedDb) cachedDb = readJsonDb();
  return cachedDb;
}

async function writeDb(db) {
  if (normalizeDb(db)) {
    // normalizeDb mutates in place; callers expect the normalized data to be saved.
  }
  cachedDb = db;
  if (!USE_POSTGRES) {
    writeJsonDb(db);
    return;
  }
  const snapshot = cloneDb(db);
  const writePromise = dbWriteChain.then(async () => {
    const previous = persistedDb ? cloneDb(persistedDb) : null;
    await savePostgresDb(snapshot, previous);
    persistedDb = cloneDb(snapshot);
  });
  dbWriteChain = writePromise.catch((error) => {
    console.error("PostgreSQL write failed", error);
  });
  await writePromise;
}

async function ensurePostgresSchema() {
  if (!USE_POSTGRES) return;
  const pool = getPgPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_collections (
      name text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_entities (
      collection text NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (collection, id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_entities_collection_updated ON app_entities (collection, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_entities_data_date ON app_entities ((data->>'date'));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_entities_data_drama ON app_entities ((data->>'dramaId'));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_entities_data_user ON app_entities ((data->>'userId'));`);
}

function collectionId(item, fallbackPrefix) {
  if (item?.id) return String(item.id);
  if (item?.token) return String(item.token);
  return uid(fallbackPrefix);
}

function dbFromPostgresRows(entityRows, collectionRows) {
  const db = seedData();
  for (const key of POSTGRES_COLLECTIONS) {
    db[key] = key === "settings" ? { ...DEFAULT_SETTINGS } : [];
  }
  for (const row of collectionRows) {
    if (row.name === "settings") db.settings = row.data || {};
  }
  for (const key of POSTGRES_COLLECTIONS.filter((item) => item !== "settings")) {
    db[key] = entityRows.filter((row) => row.collection === key).map((row) => row.data);
  }
  sortDbCollections(db);
  return db;
}

function sortDbCollections(db) {
  db.dramas = sortDramas(db.dramas || []);
  db.episodes = [...(db.episodes || [])].sort((a, b) => String(a.dramaId || "").localeCompare(String(b.dramaId || "")) || Number(a.number || 0) - Number(b.number || 0));
  db.users = [...(db.users || [])].sort((a, b) => String(b.registeredAt || "").localeCompare(String(a.registeredAt || "")));
  db.transactions = [...(db.transactions || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  db.comments = [...(db.comments || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  db.events = [...(db.events || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  db.fandom = sortFandom(db.fandom || []);
  db.adminSessions = [...(db.adminSessions || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return db;
}

async function loadPostgresDb() {
  await ensurePostgresSchema();
  const pool = getPgPool();
  const [{ rows: collectionRows }, { rows: entityRows }] = await Promise.all([
    pool.query("SELECT name, data FROM app_collections"),
    pool.query("SELECT collection, id, data FROM app_entities ORDER BY updated_at DESC")
  ]);
  if (!collectionRows.length && !entityRows.length) {
    const seed = fs.existsSync(JSON_DB_FILE) ? JSON.parse(fs.readFileSync(JSON_DB_FILE, "utf8")) : seedData();
    normalizeDb(seed);
    await savePostgresDb(seed);
    persistedDb = cloneDb(seed);
    return seed;
  }
  const db = dbFromPostgresRows(entityRows, collectionRows);
  if (normalizeDb(db)) await savePostgresDb(db);
  persistedDb = cloneDb(db);
  return db;
}

async function savePostgresDb(db, previousDb = null) {
  await ensurePostgresSchema();
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const settingsChanged = !previousDb || JSON.stringify(previousDb.settings || {}) !== JSON.stringify(db.settings || {});
    if (settingsChanged) {
      await client.query(
        `INSERT INTO app_collections (name, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        ["settings", JSON.stringify(db.settings || {})]
      );
    }
    for (const collection of POSTGRES_COLLECTIONS.filter((item) => item !== "settings")) {
      const rows = Array.isArray(db[collection]) ? db[collection] : [];
      if (!previousDb) {
        await client.query("DELETE FROM app_entities WHERE collection = $1", [collection]);
      }
      const diff = previousDb ? changedEntities(previousDb[collection] || [], rows) : { deletes: [], upserts: rows.map((item) => ({ id: collectionId(item, collection.slice(0, 3)), item })) };
      for (const id of diff.deletes) {
        await client.query("DELETE FROM app_entities WHERE collection = $1 AND id = $2", [collection, id]);
      }
      for (const { id, item } of diff.upserts) {
        if (!item.id && collection !== "adminSessions") item.id = id;
        await client.query(
          `INSERT INTO app_entities (collection, id, data, updated_at)
           VALUES ($1, $2, $3::jsonb, now())
           ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [collection, id, JSON.stringify(item)]
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function flushDbWrites() {
  await dbWriteChain;
}

async function initializeStorage() {
  ensureDb();
  if (USE_POSTGRES) {
    cachedDb = await loadPostgresDb();
    persistedDb = cloneDb(cachedDb);
    console.log("PostgreSQL storage enabled");
  } else {
    cachedDb = readJsonDb();
    persistedDb = cloneDb(cachedDb);
    console.log("JSON file storage enabled");
  }
}

function normalizeDb(db) {
  let changed = false;
  db.settings = db.settings || {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof value === "object" && !Array.isArray(value)) {
      db.settings[key] = { ...value, ...(db.settings[key] || {}) };
    } else if (!(key in db.settings)) {
      db.settings[key] = value;
    }
  }

  if (db.settings.brand !== "VidShort") {
    db.settings.brand = "VidShort";
    changed = true;
  }
  if (!["English", "\u4e2d\u6587"].includes(db.settings.defaultLanguage)) {
    db.settings.defaultLanguage = "English";
    changed = true;
  }
  if (db.settings.launchRegion !== "US") {
    db.settings.launchRegion = "US";
    changed = true;
  }
  if (JSON.stringify(db.settings.regions) !== JSON.stringify(["US"])) {
    db.settings.regions = ["US"];
    changed = true;
  }
  if (JSON.stringify(db.settings.supportedLanguages) !== JSON.stringify(DEFAULT_SETTINGS.supportedLanguages)) {
    db.settings.supportedLanguages = [...DEFAULT_SETTINGS.supportedLanguages];
    changed = true;
  }
  if (!Array.isArray(db.settings.homeCarouselIds)) {
    db.settings.homeCarouselIds = [...DEFAULT_SETTINGS.homeCarouselIds];
    changed = true;
  }
  if (db.settings.monetization?.paymentsEnabled !== false) {
    db.settings.monetization.paymentsEnabled = false;
    changed = true;
  }
  if (db.settings.monetization?.adUnlockEnabled !== true) {
    db.settings.monetization.adUnlockEnabled = true;
    changed = true;
  }
  if (db.settings.monetization?.subscriptionsEnabled !== true) {
    db.settings.monetization.subscriptionsEnabled = true;
    changed = true;
  }
  if (isR2Configured()) {
    const r2Config = runtimeR2Config();
    if (db.settings.media?.storage !== "r2" || db.settings.media?.mediaBaseUrl !== r2Config.publicBaseUrl || db.settings.media?.cdnBucket !== r2Config.bucket) {
      db.settings.media = {
        ...(db.settings.media || {}),
        storage: "r2",
        mediaBaseUrl: r2Config.publicBaseUrl,
        cdnBucket: r2Config.bucket
      };
      changed = true;
    }
  }

  db.events = Array.isArray(db.events) ? db.events : [];
  db.events.forEach((event) => {
    if (!event.id) {
      event.id = uid("evt");
      changed = true;
    }
    if (!event.createdAt) {
      event.createdAt = new Date().toISOString();
      changed = true;
    }
    if (!event.date) {
      event.date = dateKey(event.createdAt);
      changed = true;
    }
    event.userId = event.userId || "";
    event.dramaId = event.dramaId || "";
    event.episodeId = event.episodeId || "";
    event.label = event.label || "";
    event.value = numberValue(event.value, 1);
    event.meta = event.meta || {};
  });

  db.transactions = Array.isArray(db.transactions) ? db.transactions : [];
  db.comments = Array.isArray(db.comments) ? db.comments : [];
  db.adminSessions = Array.isArray(db.adminSessions) ? db.adminSessions : [];
  const now = Date.now();
  const activeSessions = db.adminSessions.filter((session) => session?.token && session.userId && new Date(session.expiresAt).getTime() > now);
  if (activeSessions.length !== db.adminSessions.length) {
    db.adminSessions = activeSessions;
    changed = true;
  }

  db.users = db.users || [];
  const defaultAdminOpenId = process.env.CMS_DEFAULT_ADMIN_OPENID || "admin";
  const defaultAdmin = db.users.find((user) => user.id === "admin" || user.openId === defaultAdminOpenId);
  if (defaultAdmin) {
    if (defaultAdmin.id !== "admin") {
      defaultAdmin.id = "admin";
      changed = true;
    }
    if (defaultAdmin.openId !== defaultAdminOpenId) {
      defaultAdmin.openId = defaultAdminOpenId;
      changed = true;
    }
    if (!defaultAdmin.isAdmin) {
      defaultAdmin.isAdmin = true;
      changed = true;
    }
    defaultAdmin.name = defaultAdmin.name || "Admin";
    defaultAdmin.avatar = defaultAdmin.avatar || "A";
  } else {
    db.users.unshift({
      id: "admin",
      openId: defaultAdminOpenId,
      name: "Admin",
      avatar: "A",
      language: "English",
      region: "US",
      registeredAt: new Date().toISOString(),
      profileAuthorized: true,
      isAdmin: true,
      subscription: { status: "inactive", expiresAt: "" },
      balance: 0,
      favorites: [],
      unlockedEpisodes: [],
      watchHistory: []
    });
    changed = true;
  }
  db.users.forEach((user) => {
    if (!user.openId) {
      user.openId = user.id === "user_demo" ? "mock_openid_demo" : user.id;
      changed = true;
    }
    if (!("profileAuthorized" in user)) {
      user.profileAuthorized = user.id === "user_demo";
      changed = true;
    }
    if (!user.subscription) {
      user.subscription = { status: "inactive", expiresAt: "" };
      changed = true;
    }
    if (!("registeredAt" in user)) {
      user.registeredAt = user.createdAt || "";
      changed = true;
    }
    user.favorites = Array.isArray(user.favorites) ? user.favorites : [];
    user.unlockedEpisodes = Array.isArray(user.unlockedEpisodes) ? user.unlockedEpisodes : [];
    user.watchHistory = Array.isArray(user.watchHistory) ? user.watchHistory : [];
    if (!("isAdmin" in user)) {
      user.isAdmin = user.id === "user_demo";
      changed = true;
    }
    if (!["English", "\u4e2d\u6587"].includes(user.language)) {
      user.language = "English";
      changed = true;
    }
    user.region = "US";
  });
  if (db.users.length && !db.users.some((user) => user.isAdmin)) {
    const bootstrapOpenId = process.env.CMS_BOOTSTRAP_ADMIN_OPENID || "";
    const fallbackAdmin = db.users.find((user) => user.id === "user_demo" || (bootstrapOpenId && user.openId === bootstrapOpenId));
    if (fallbackAdmin) {
      fallbackAdmin.isAdmin = true;
      changed = true;
    }
  }

  db.dramas = db.dramas || [];
  db.episodes = db.episodes || [];
  db.dramas.forEach((drama) => {
    drama.language = "English";
    drama.region = "US";
    if (!Number.isFinite(Number(drama.weight))) {
      drama.weight = 1;
      changed = true;
    } else {
      drama.weight = Number(drama.weight);
    }
    drama.monetization = {
      iapEnabled: false,
      iaaEnabled: true,
      adUnlock: true,
      subscriptionsEnabled: Boolean(drama.subscriptionOnly),
      ...(drama.monetization || {})
    };
    if (drama.monetization.iapEnabled !== false) {
      drama.monetization.iapEnabled = false;
      changed = true;
    }
    if (drama.monetization.iaaEnabled !== true || drama.monetization.adUnlock !== true) {
      drama.monetization.iaaEnabled = true;
      drama.monetization.adUnlock = true;
      changed = true;
    }
  });
  if (normalizeUploadedEpisodeNumbers(db)) changed = true;
  db.fandom = db.fandom || [];
  db.fandom.forEach((post) => {
    if (!Number.isFinite(Number(post.weight))) {
      post.weight = 1;
      changed = true;
    } else {
      post.weight = Number(post.weight);
    }
    if (!post.status) {
      post.status = "published";
      changed = true;
    }
  });

  return changed;
}

function seedData() {
  const dramas = [
    {
      id: "drama_mer",
      title: "Blood Pearl of the Mer",
      slug: "blood-pearl-of-the-mer",
      status: "published",
      category: "Fantasy",
      language: "English",
      region: "US",
      tags: ["Mermaid", "Revenge", "Romance"],
      cover: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
      banner: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
      description: "A tideborn heir trades everything for a pearl that can rewrite her clan's fate.",
      totalEpisodes: 20,
      freeEpisodes: 6,
      unlockPrice: 35,
      weight: 8,
      subscriptionOnly: false,
      releaseDate: "2026-05-09",
      stats: { plays: 63800, favorites: 21300, comments: 1248, completionRate: 62 },
      monetization: { iapEnabled: true, iaaEnabled: true, adUnlock: true }
    },
    {
      id: "drama_blade",
      title: "The Blade of Lost Justice",
      slug: "the-blade-of-lost-justice",
      status: "published",
      category: "Action",
      language: "English",
      region: "US",
      tags: ["Dubbed", "Justice", "Comeback"],
      cover: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=900&q=80",
      banner: "https://images.unsplash.com/photo-1520637836862-4d197d17c55a?auto=format&fit=crop&w=1200&q=80",
      description: "A betrayed captain returns under a new name and cuts through a city of lies.",
      totalEpisodes: 72,
      freeEpisodes: 18,
      unlockPrice: 45,
      weight: 10,
      subscriptionOnly: false,
      releaseDate: "2026-05-08",
      stats: { plays: 245000, favorites: 81800, comments: 4906, completionRate: 57 },
      monetization: { iapEnabled: true, iaaEnabled: true, adUnlock: false }
    },
    {
      id: "drama_boss",
      title: "The Billionaire Don's Secret Boss",
      slug: "billionaire-don-secret-boss",
      status: "draft",
      category: "Romance",
      language: "English",
      region: "CA",
      tags: ["Marriage", "Billionaire", "Secret"],
      cover: "https://images.unsplash.com/photo-1523438885200-e635ba2c371e?auto=format&fit=crop&w=900&q=80",
      banner: "https://images.unsplash.com/photo-1519167758481-83f29c8a8d4b?auto=format&fit=crop&w=1200&q=80",
      description: "A contract wedding turns into a boardroom war when the quiet groom reveals his empire.",
      totalEpisodes: 42,
      freeEpisodes: 8,
      unlockPrice: 39,
      weight: 1,
      subscriptionOnly: true,
      releaseDate: "2026-05-10",
      stats: { plays: 98100, favorites: 27300, comments: 1560, completionRate: 70 },
      monetization: { iapEnabled: true, iaaEnabled: true, adUnlock: true }
    }
  ];

  const episodes = dramas.flatMap((drama) =>
    Array.from({ length: drama.totalEpisodes }, (_, index) => {
      const number = index + 1;
      return {
        id: `${drama.id}_ep_${number}`,
        dramaId: drama.id,
        number,
        title: `Episode ${number}`,
        duration: number % 4 === 0 ? "03:56" : number % 3 === 0 ? "02:24" : "01:08",
        price: number <= drama.freeEpisodes ? 0 : drama.unlockPrice,
        isFree: number <= drama.freeEpisodes,
        resolution: number % 5 === 0 ? "720p" : "540p",
        status: "ready",
        videoUrl: "",
        subtitleLanguages: [drama.language],
        plot: number === 1 ? drama.description : `The conflict sharpens as ${drama.title} reaches turn ${number}.`
      };
    })
  );

  return {
    settings: {
      ...DEFAULT_SETTINGS
    },
    dramas,
    episodes,
    users: [
      {
        id: "user_demo",
        openId: "mock_openid_demo",
        name: "Avery",
        avatar: "A",
        language: "English",
        region: "US",
        registeredAt: "2026-05-09T09:30:00Z",
        profileAuthorized: true,
        isAdmin: true,
        subscription: { status: "inactive", expiresAt: "" },
        balance: 1280,
        favorites: ["drama_mer"],
        unlockedEpisodes: ["drama_mer_ep_7", "drama_mer_ep_8", "drama_blade_ep_19"],
        watchHistory: [
          { dramaId: "drama_mer", episodeId: "drama_mer_ep_1", progress: 41, updatedAt: "2026-05-11T05:35:00Z" },
          { dramaId: "drama_blade", episodeId: "drama_blade_ep_19", progress: 75, updatedAt: "2026-05-10T21:18:00Z" }
        ]
      }
    ],
    transactions: [
      { id: "txn_1001", userId: "user_demo", type: "recharge", amount: 1200, channel: "TikTok Beans", createdAt: "2026-05-09T10:00:00Z" },
      { id: "txn_1002", userId: "user_demo", type: "consume", amount: -35, channel: "Episode unlock", episodeId: "drama_mer_ep_7", createdAt: "2026-05-10T12:11:00Z" },
      { id: "txn_1003", userId: "user_demo", type: "consume", amount: -45, channel: "Episode unlock", episodeId: "drama_blade_ep_19", createdAt: "2026-05-10T21:16:00Z" }
    ],
    events: [
      { id: "evt_1001", type: "user_register", userId: "user_demo", date: "2026-05-09", createdAt: "2026-05-09T09:30:00Z" },
      { id: "evt_1002", type: "play_start", userId: "user_demo", dramaId: "drama_mer", episodeId: "drama_mer_ep_1", date: "2026-05-10", createdAt: "2026-05-10T13:10:00Z" },
      { id: "evt_1003", type: "click", userId: "user_demo", dramaId: "drama_blade", label: "open_drama", date: "2026-05-10", createdAt: "2026-05-10T21:12:00Z" },
      { id: "evt_1004", type: "unlock", userId: "user_demo", dramaId: "drama_blade", episodeId: "drama_blade_ep_19", date: "2026-05-10", createdAt: "2026-05-10T21:16:00Z" }
    ],
    comments: [
      { id: "cmt_1", dramaId: "drama_mer", episodeId: "drama_mer_ep_1", userId: "user_demo", userName: "Avery", body: "The opening hook is strong.", status: "visible", likes: 42, createdAt: "2026-05-10T13:20:00Z" },
      { id: "cmt_2", dramaId: "drama_blade", episodeId: "drama_blade_ep_19", userId: "user_demo", userName: "Avery", body: "Need the next episode.", status: "pending", likes: 9, createdAt: "2026-05-10T22:05:00Z" }
    ],
    fandom: [
      {
        id: "post_1",
        type: "Watch Guide",
        status: "published",
        weight: 5,
        title: "The Billionaire Don's Secret Boss: Full Guide & Streaming Options",
        dramaId: "drama_boss",
        excerpt: "A fast route through the setup, character turns, and when to start spending Beans.",
        publishedAt: "2026-05-09T16:05:00Z"
      },
      {
        id: "post_2",
        type: "Character Profiles",
        status: "published",
        weight: 3,
        title: "Blood Pearl of the Mer: Mira and the Tideborn Court",
        dramaId: "drama_mer",
        excerpt: "The alliances that matter before the first paid arc begins.",
        publishedAt: "2026-05-08T11:42:00Z"
      }
    ]
  };
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, value, status = 200, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(value);
}

function sendRedirect(res, location, status = 308) {
  res.writeHead(status, {
    Location: location,
    "Cache-Control": "no-store"
  });
  res.end();
}

function sendHtml(res, value, status = 200, headOnly = false) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(headOnly ? undefined : value);
}

function sendFile(res, filePath, status = 200, headOnly = false) {
  fs.readFile(filePath, (error, data) => {
    if (error) return sendText(res, "Not found", 404);
    const contentType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(status, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": staticCacheControl(filePath)
    });
    res.end(headOnly ? undefined : data);
  });
}

function cmsHtmlWithApiAssets() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>VidShort CMS</title>
    <link rel="stylesheet" href="/api/assets/styles.v20260513-6.css">
  </head>
  <body class="cms-body">
    <div id="cms"></div>
    <script src="/api/assets/icons.v20260513-6.js"></script>
    <script src="/api/assets/cms.v20260513-6.js"></script>
  </body>
</html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readRawBody(req, limitBytes = 3 * 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Upload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(req, body) {
  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("Missing multipart boundary");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = {};
  let start = body.indexOf(boundary);
  while (start !== -1) {
    start += boundary.length;
    if (body[start] === 45 && body[start + 1] === 45) break;
    if (body[start] === 13 && body[start + 1] === 10) start += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;
    const header = body.slice(start, headerEnd).toString("utf8");
    let partEnd = body.indexOf(boundary, headerEnd + 4);
    if (partEnd === -1) break;
    let content = body.slice(headerEnd + 4, partEnd - 2);
    const name = (header.match(/name="([^"]+)"/) || [])[1];
    const filename = (header.match(/filename="([^"]*)"/) || [])[1];
    if (name) {
      if (filename) {
        parts[name] = { filename, contentType: (header.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || "", data: content };
      } else {
        parts[name] = content.toString("utf8");
      }
    }
    start = partEnd;
  }
  return parts;
}

function safeName(value) {
  return String(value || "")
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 160);
}

function numberValue(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function offsetDateKey(offsetDays) {
  return dateKey(new Date(Date.now() + offsetDays * 86400 * 1000));
}

function dramaWeight(drama) {
  return numberValue(drama?.weight, 1);
}

function sortDramas(dramas) {
  return [...(dramas || [])].sort((a, b) => {
    const byWeight = dramaWeight(b) - dramaWeight(a);
    if (byWeight) return byWeight;
    return String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")) || String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function sortFandom(posts) {
  return [...(posts || [])].sort((a, b) => numberValue(b.weight, 1) - numberValue(a.weight, 1) || String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
}

function logEvent(db, type, payload = {}, createdAt = new Date().toISOString()) {
  const event = {
    id: uid("evt"),
    type,
    userId: payload.userId || "",
    dramaId: payload.dramaId || "",
    episodeId: payload.episodeId || "",
    label: payload.label || "",
    value: numberValue(payload.value, 1),
    meta: payload.meta || {},
    date: dateKey(createdAt),
    createdAt
  };
  db.events.unshift(event);
  if (db.events.length > 50000) db.events.length = 50000;
  return event;
}

function eventsForDate(db, date) {
  const target = date || offsetDateKey(-1);
  return (db.events || []).filter((event) => event.date === target);
}

function countEvents(events, type) {
  return events.filter((event) => event.type === type).length;
}

function dashboardForDate(db, date) {
  const target = date || offsetDateKey(-1);
  const events = eventsForDate(db, target);
  const registerUserIds = new Set([
    ...events.filter((event) => event.type === "user_register").map((event) => event.userId).filter(Boolean),
    ...db.users
      .filter((user) => {
        const registeredAt = user.registeredAt || user.createdAt;
        return registeredAt && dateKey(registeredAt) === target;
      })
      .map((user) => user.id)
  ]);
  const playEvents = events.filter((event) => event.type === "play_start");
  const unlockEvents = events.filter((event) => event.type === "unlock");
  const clickEvents = events.filter((event) => event.type === "click");
  const commentEvents = events.filter((event) => event.type === "comment");
  const topDramas = [...playEvents.reduce((map, event) => {
    if (!event.dramaId) return map;
    map.set(event.dramaId, (map.get(event.dramaId) || 0) + 1);
    return map;
  }, new Map())]
    .map(([dramaId, plays]) => ({ dramaId, title: db.dramas.find((drama) => drama.id === dramaId)?.title || dramaId, plays }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 8);
  const recentEvents = events.slice(0, 20);
  return {
    date: target,
    metrics: {
      registrations: registerUserIds.size,
      clicks: clickEvents.length,
      plays: playEvents.length,
      unlocks: unlockEvents.length,
      comments: commentEvents.length,
      favorites: countEvents(events, "favorite"),
      subscriptions: countEvents(events, "subscription"),
      activeUsers: new Set(events.map((event) => event.userId).filter(Boolean)).size
    },
    topDramas,
    recentEvents
  };
}

function episodeNumberFromName(filename, fallback) {
  const base = path.basename(filename, path.extname(filename)).normalize("NFKC");
  const explicit = base.match(/(?:^|[^a-z0-9])(?:ep|episode|e)\s*0*(\d{1,5})(?=$|[^0-9])/i);
  if (explicit) return Number(explicit[1]);
  const cn = base.match(/\u7b2c\s*0*(\d{1,5})\s*\u96c6/);
  if (cn) return Number(cn[1]);
  const numbers = [...base.matchAll(/\d{1,5}/g)].map((match) => Number(match[0]));
  if (numbers.length) return numbers[numbers.length - 1];
  return fallback;
}

function rewriteEpisodeReferences(db, oldId, newId) {
  if (oldId === newId) return;
  db.users.forEach((user) => {
    user.unlockedEpisodes = (user.unlockedEpisodes || []).map((id) => (id === oldId ? newId : id));
    (user.watchHistory || []).forEach((item) => {
      if (item.episodeId === oldId) item.episodeId = newId;
    });
  });
  db.transactions.forEach((txn) => {
    if (txn.episodeId === oldId) txn.episodeId = newId;
  });
  db.comments.forEach((comment) => {
    if (comment.episodeId === oldId) comment.episodeId = newId;
  });
}

function normalizeUploadedEpisodeNumbers(db) {
  let changed = false;
  for (const drama of db.dramas) {
    const uploaded = db.episodes.filter((episode) => episode.dramaId === drama.id && episode.originalFilename);
    if (!uploaded.length) continue;
    const untouchedNumbers = new Set(
      db.episodes.filter((episode) => episode.dramaId === drama.id && !episode.originalFilename).map((episode) => Number(episode.number))
    );
    const nextNumbers = new Map();
    let canRewrite = true;
    uploaded.forEach((episode) => {
      const nextNumber = episodeNumberFromName(episode.originalFilename, Number(episode.number));
      if (!Number.isFinite(nextNumber) || nextNumber < 1 || nextNumbers.has(nextNumber) || untouchedNumbers.has(nextNumber)) canRewrite = false;
      nextNumbers.set(episode, nextNumber);
    });
    if (!canRewrite) continue;
    for (const [episode, nextNumber] of nextNumbers.entries()) {
      if (Number(episode.number) === nextNumber) continue;
      const oldId = episode.id;
      episode.number = nextNumber;
      episode.id = `${drama.id}_ep_${nextNumber}`;
      if (!episode.title || /^Episode \d+$/i.test(episode.title)) episode.title = `Episode ${nextNumber}`;
      episode.isFree = nextNumber <= Number(drama.freeEpisodes || 0);
      episode.price = episode.isFree ? 0 : Number(drama.unlockPrice || 0);
      rewriteEpisodeReferences(db, oldId, episode.id);
      changed = true;
    }
    const byName = new Map(uploaded.map((episode) => [episode.originalFilename, episode]));
    (drama.upload?.matchedEpisodes || []).forEach((item) => {
      const episode = byName.get(item.originalFilename);
      if (!episode) return;
      if (item.number !== episode.number) {
        item.number = episode.number;
        changed = true;
      }
      if (item.videoUrl !== episode.videoUrl) item.videoUrl = episode.videoUrl;
    });
  }
  return changed;
}

function publicMediaUrl(dramaId, filename) {
  return `/media/dramas/${dramaId}/${encodeURIComponent(filename).replace(/%2F/g, "/")}`;
}

function encodeObjectKey(key) {
  return String(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function sha256(value, encoding = "hex") {
  return crypto.createHash("sha256").update(value).digest(encoding);
}

function fileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function signingKey(secret, dateStamp, region) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

async function putR2Object(objectKey, filePath, contentType) {
  const config = runtimeR2Config();
  if (!isR2Configured()) throw new Error("R2 storage is not configured");

  const stat = fs.statSync(filePath);
  const payloadHash = fileSha256(filePath);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(config.endpoint).host;
  const encodedKey = encodeObjectKey(objectKey);
  const canonicalUri = `/${config.bucket}/${encodedKey}`;
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`
  ].join("\n") + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp, config.region), stringToSign, "hex");
  const response = await fetch(`${config.endpoint}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    },
    body: fs.createReadStream(filePath),
    duplex: "half"
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2 upload failed: ${response.status} ${text.slice(0, 180)}`.trim());
  }
  return `${config.publicBaseUrl}/${encodeObjectKey(objectKey)}`;
}

async function storeEpisodeVideo(dramaId, number, sourcePath, filename) {
  const ext = path.extname(filename).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  if (isR2Configured()) {
    const objectKey = `dramas/${dramaId}/${filename}`;
    const videoUrl = await putR2Object(objectKey, sourcePath, contentType);
    return { videoUrl, storage: "r2", objectKey, bucket: runtimeR2Config().bucket };
  }
  const publicRoot = path.join(MEDIA_DIR, "dramas", dramaId);
  fs.mkdirSync(publicRoot, { recursive: true });
  fs.copyFileSync(sourcePath, path.join(publicRoot, filename));
  return { videoUrl: publicMediaUrl(dramaId, filename), storage: "local", objectKey: `media/dramas/${dramaId}/${filename}`, bucket: "" };
}

function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(archivePath).toLowerCase();
  if (![".zip", ".rar"].includes(ext)) {
    throw new Error("Only .zip and .rar packages are supported.");
  }
  if (ext === ".rar") {
    const attempts =
      process.platform === "win32"
        ? [
            ["tar.exe", ["-xf", archivePath, "-C", destDir]],
            ["7z.exe", ["x", "-y", `-o${destDir}`, archivePath]],
            ["7za.exe", ["x", "-y", `-o${destDir}`, archivePath]]
          ]
        : [
            ["unar", ["-quiet", "-force-overwrite", "-output-directory", destDir, archivePath]],
            ["7z", ["x", "-y", `-o${destDir}`, archivePath]],
            ["7za", ["x", "-y", `-o${destDir}`, archivePath]],
            ["unrar", ["x", "-o+", "-idq", archivePath, destDir]]
          ];
    for (const [command, args] of attempts) {
      try {
        childProcess.execFileSync(command, args, { stdio: "pipe" });
        return;
      } catch (error) {
        // Try the next available extractor.
      }
    }
    throw new Error("RAR extraction failed. Install unar, 7z or unrar on the server, or upload a valid RAR file.");
  }
  if (process.platform === "win32") {
    const quotePsPath = (value) => `'${String(value).replace(/'/g, "''")}'`;
    childProcess.execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath ${quotePsPath(archivePath)} -DestinationPath ${quotePsPath(destDir)} -Force`
      ],
      { stdio: "pipe" }
    );
    return;
  }
  try {
    childProcess.execFileSync("unzip", ["-q", "-o", archivePath, "-d", destDir], { stdio: "pipe" });
  } catch (error) {
    try {
      childProcess.execFileSync("python3", ["-m", "zipfile", "-e", archivePath, destDir], { stdio: "pipe" });
    } catch (pythonError) {
      throw new Error("ZIP extraction failed. Upload a valid ZIP file.");
    }
  }
}

function discoverVideos(db, extractRoot) {
  const allowed = new Set(db.settings.media.allowedVideoExtensions || [".mp4", ".m4v", ".mov", ".webm"]);
  const discovered = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("__MACOSX")) walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (allowed.has(ext)) discovered.push(full);
      }
    }
  };
  walk(extractRoot);
  return discovered;
}

async function importDramaArchive(db, archivePath, options = {}) {
  const archiveExt = path.extname(archivePath).toLowerCase();
  if (![".zip", ".rar"].includes(archiveExt)) throw new Error("Only .zip and .rar are supported");
  const id = options.id || uid("drama");
  const title = String(options.title || path.basename(options.filename || archivePath, archiveExt) || "Untitled Drama").trim();
  const freeEpisodes = Number(options.freeEpisodes || db.settings.monetization.freeEpisodesDefault || 6);
  const category = String(options.category || "Romance");
  const uploadRoot = options.uploadRoot || path.join(MEDIA_DIR, "uploads", id);
  const extractRoot = path.join(uploadRoot, "extract");
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(uploadRoot, { recursive: true });
  extractArchive(archivePath, extractRoot);

  const discovered = discoverVideos(db, extractRoot);
  if (!discovered.length) throw new Error("No video files found in archive");

  const numbered = discovered
    .map((full, index) => ({ full, number: episodeNumberFromName(path.basename(full), index + 1) }))
    .sort((a, b) => a.number - b.number || a.full.localeCompare(b.full));

  const used = new Set();
  const episodes = [];
  for (const [index, item] of numbered.entries()) {
    let number = item.number || index + 1;
    while (used.has(number)) number += 1;
    used.add(number);
    const ext = path.extname(item.full).toLowerCase();
    const filename = `episode-${String(number).padStart(3, "0")}${ext}`;
    const stored = await storeEpisodeVideo(id, number, item.full, filename);
    episodes.push({
      id: `${id}_ep_${number}`,
      dramaId: id,
      number,
      title: `Episode ${number}`,
      duration: "",
      price: number <= freeEpisodes ? 0 : 0,
      isFree: number <= freeEpisodes,
      resolution: "",
      status: "ready",
      originalFilename: path.basename(item.full),
      videoUrl: stored.videoUrl,
      storage: stored.storage,
      objectKey: stored.objectKey,
      bucket: stored.bucket,
      subtitleLanguages: [db.settings.defaultLanguage],
      plot: ""
    });
  }

  const drama = {
    id,
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || id,
    status: String(options.status || "draft"),
    category,
    language: db.settings.defaultLanguage,
    region: db.settings.launchRegion,
    tags: String(options.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    cover: String(options.cover || "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80"),
    banner: String(options.banner || options.cover || "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80"),
    description: String(options.description || ""),
    totalEpisodes: episodes.length,
    freeEpisodes,
    unlockPrice: 0,
    weight: numberValue(options.weight, 1),
    subscriptionOnly: String(options.subscriptionOnly || "false") === "true",
    releaseDate: new Date().toISOString().slice(0, 10),
    stats: { plays: 0, favorites: 0, comments: 0, completionRate: 0 },
    monetization: { iapEnabled: false, iaaEnabled: true, adUnlock: true, subscriptionsEnabled: String(options.subscriptionOnly || "false") === "true" },
    upload: {
      type: archiveExt.slice(1),
      filename: safeName(options.filename || path.basename(archivePath)),
      uploadedAt: new Date().toISOString(),
      matchedEpisodes: episodes.map((episode) => ({ number: episode.number, originalFilename: episode.originalFilename, videoUrl: episode.videoUrl }))
    }
  };

  db.dramas.unshift(drama);
  db.episodes.push(...episodes);
  return { drama, episodes, matched: drama.upload.matchedEpisodes };
}

function uploadSessionDir(uploadId) {
  return path.join(CHUNK_UPLOAD_DIR, safeName(uploadId));
}

function uploadMetaPath(uploadId) {
  return path.join(uploadSessionDir(uploadId), "meta.json");
}

function readUploadMeta(uploadId) {
  const metaPath = uploadMetaPath(uploadId);
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, "utf8"));
}

function writeUploadMeta(meta) {
  const dir = uploadSessionDir(meta.uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(uploadMetaPath(meta.uploadId), JSON.stringify(meta, null, 2));
}

function chunkPath(uploadId, index) {
  return path.join(uploadSessionDir(uploadId), "chunks", `${String(index).padStart(6, "0")}.part`);
}

function receivedChunks(meta) {
  const received = [];
  for (let index = 0; index < meta.totalChunks; index += 1) {
    if (fs.existsSync(chunkPath(meta.uploadId, index))) received.push(index);
  }
  return received;
}

function uploadStatus(meta) {
  return {
    uploadId: meta.uploadId,
    status: meta.status || "uploading",
    received: receivedChunks(meta),
    totalChunks: meta.totalChunks,
    chunkSize: meta.chunkSize,
    fileSize: meta.fileSize,
    error: meta.error || "",
    drama: meta.drama || null,
    matched: meta.matched || []
  };
}

async function completeChunkUpload(uploadId) {
  if (chunkProcessing.has(uploadId)) return;
  chunkProcessing.add(uploadId);
  try {
    const meta = readUploadMeta(uploadId);
    if (!meta) return;
    meta.status = "processing";
    meta.error = "";
    writeUploadMeta(meta);

    const dir = uploadSessionDir(uploadId);
    const archivePath = path.join(dir, safeName(meta.filename));
    fs.rmSync(archivePath, { force: true });
    const output = fs.createWriteStream(archivePath);
    for (let index = 0; index < meta.totalChunks; index += 1) {
      const part = chunkPath(uploadId, index);
      if (!fs.existsSync(part)) throw new Error(`Missing chunk ${index + 1}`);
      await new Promise((resolve, reject) => {
        const input = fs.createReadStream(part);
        const cleanup = () => {
          input.off("error", onError);
          input.off("end", onEnd);
          output.off("error", onError);
        };
        const onError = (error) => {
          cleanup();
          reject(error);
        };
        const onEnd = () => {
          cleanup();
          resolve();
        };
        input.once("error", onError);
        output.once("error", onError);
        input.once("end", onEnd);
        input.pipe(output, { end: false });
      });
    }
    await new Promise((resolve, reject) => {
      output.once("finish", resolve);
      output.once("error", reject);
      output.end();
    });
    if (fs.statSync(archivePath).size !== Number(meta.fileSize)) throw new Error("Merged file size mismatch");

    const db = readDb();
    const result = await importDramaArchive(db, archivePath, {
      ...meta.form,
      id: uid("drama"),
      filename: meta.filename,
      uploadRoot: path.join(MEDIA_DIR, "uploads", uploadId)
    });
    await writeDb(db);
    meta.status = "done";
    meta.drama = result.drama;
    meta.matched = result.matched;
    writeUploadMeta(meta);
  } catch (error) {
    const meta = readUploadMeta(uploadId);
    if (meta) {
      meta.status = "error";
      meta.error = error.message || "Import failed";
      writeUploadMeta(meta);
    }
  } finally {
    chunkProcessing.delete(uploadId);
  }
}

function publicMetrics(db) {
  const revenue = db.transactions
    .filter((item) => item.type === "recharge")
    .reduce((sum, item) => sum + item.amount, 0);
  const adUnlocks = db.transactions.filter((item) => item.type === "ad_unlock").length;
  const plays = db.dramas.reduce((sum, item) => sum + item.stats.plays, 0);
  const favorites = db.dramas.reduce((sum, item) => sum + item.stats.favorites, 0);
  return {
    revenue,
    adUnlocks,
    plays,
    favorites,
    users: db.users.length,
    dramas: db.dramas.length,
    published: db.dramas.filter((item) => item.status === "published").length,
    commentsPending: db.comments.filter((item) => item.status === "pending").length
  };
}

function hydrateDrama(db, drama) {
  const episodes = db.episodes.filter((episode) => episode.dramaId === drama.id);
  const comments = db.comments.filter((comment) => comment.dramaId === drama.id && comment.status === "visible");
  return { ...drama, episodes, comments };
}

function getOrCreateUserByOpenId(db, openId, profile = {}) {
  let user = db.users.find((item) => item.openId === openId);
  if (user) return user;
  user = {
    id: uid("user"),
    openId,
    name: profile.name || "Guest",
    avatar: profile.avatar || "G",
    language: db.settings.defaultLanguage,
    region: db.settings.launchRegion,
    balance: 0,
    registeredAt: new Date().toISOString(),
    profileAuthorized: Boolean(profile.profileAuthorized),
    isAdmin: false,
    subscription: { status: "inactive", expiresAt: "" },
    favorites: [],
    unlockedEpisodes: [],
    watchHistory: []
  };
  db.users.push(user);
  logEvent(db, "user_register", { userId: user.id });
  return user;
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    openId: user.openId,
    name: user.name,
    avatar: user.avatar,
    isAdmin: Boolean(user.isAdmin)
  };
}

function adminTokenFromReq(req) {
  const authorization = req.headers.authorization || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  return bearer?.[1] || req.headers["x-admin-token"] || "";
}

function getAdminUserFromReq(db, req) {
  const token = adminTokenFromReq(req);
  if (!token) return null;
  const session = (db.adminSessions || []).find((item) => item.token === token);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const user = db.users.find((item) => item.id === session.userId);
  if (!user?.isAdmin) return null;
  session.lastSeenAt = new Date().toISOString();
  return user;
}

function requireAdmin(db, req, res) {
  const admin = getAdminUserFromReq(db, req);
  if (!admin) {
    sendJson(res, { error: "Admin login required" }, 401);
    return null;
  }
  return admin;
}

function createAdminSession(db, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  db.adminSessions = [
    { token, userId: user.id, createdAt, expiresAt, lastSeenAt: createdAt },
    ...(db.adminSessions || []).filter((session) => session.userId !== user.id)
  ].slice(0, 100);
  return { token, expiresAt };
}

function isLocalRequest(req) {
  const host = String(req.headers.host || "").split(":")[0].replace(/^\[|\]$/g, "");
  return ["localhost", "127.0.0.1", "::1"].includes(host);
}

async function handleApi(req, res, url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const method = req.method;
  const isRead = method === "GET" || method === "HEAD";

  if (isRead && url.pathname === "/api/cms-ui") {
    return sendHtml(res, cmsHtmlWithApiAssets(), 200, method === "HEAD");
  }

  if (isRead && segments[1] === "assets" && segments[2]) {
    const assetName = path.basename(segments[2]);
    const filePath = path.join(PUBLIC_DIR, assetName);
    if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, "Forbidden", 403);
    return sendFile(res, filePath, 200, method === "HEAD");
  }

  const db = readDb();

  if (method === "POST" && url.pathname === "/api/cms/login") {
    const body = await readBody(req);
    const login = String(body.login || body.openId || body.userId || "").trim();
    const requiredPassword = process.env.CMS_ADMIN_PASSWORD || "";
    const passwordRequired = Boolean(requiredPassword) || !isLocalRequest(req);
    if (!login) return sendJson(res, { error: "Admin account is required" }, 400);
    if (!requiredPassword && passwordRequired) {
      return sendJson(res, { error: "CMS admin password is not configured" }, 503);
    }
    if (passwordRequired && body.password !== requiredPassword) {
      return sendJson(res, { error: "Invalid admin credentials" }, 403);
    }
    const user = db.users.find((item) => item.id === login || item.openId === login);
    if (!user?.isAdmin) return sendJson(res, { error: "Admin access denied" }, 403);
    const session = createAdminSession(db, user);
    await writeDb(db);
    return sendJson(res, { ok: true, token: session.token, expiresAt: session.expiresAt, user: safeUser(user) });
  }

  if (method === "GET" && url.pathname === "/api/cms/session") {
    const admin = getAdminUserFromReq(db, req);
    if (!admin) return sendJson(res, { error: "Admin login required" }, 401);
    await writeDb(db);
    return sendJson(res, { ok: true, user: safeUser(admin) });
  }

  if (method === "POST" && url.pathname === "/api/cms/logout") {
    const token = adminTokenFromReq(req);
    db.adminSessions = (db.adminSessions || []).filter((session) => session.token !== token);
    await writeDb(db);
    return sendJson(res, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/config") {
    return sendJson(res, {
      settings: db.settings,
      client: {
        appId: db.settings.tiktok.appId,
        clientKey: db.settings.tiktok.clientKey,
        rewardedAdUnitId: db.settings.monetization.rewardedAdUnitId,
        interstitialAdUnitId: db.settings.monetization.interstitialAdUnitId
      }
    });
  }

  if (method === "GET" && url.pathname === "/api/bootstrap") {
    const openId = url.searchParams.get("openId") || "mock_openid_demo";
    const user = getOrCreateUserByOpenId(db, openId);
    await writeDb(db);
    return sendJson(res, {
      settings: db.settings,
      user,
      metrics: publicMetrics(db),
      dramas: sortDramas(db.dramas).map((drama) => ({
        ...drama,
        episodeCount: db.episodes.filter((episode) => episode.dramaId === drama.id).length
      })),
      fandom: sortFandom(db.fandom).filter((post) => post.status !== "hidden")
    });
  }

  if (method === "POST" && url.pathname === "/api/auth/tiktok") {
    const body = await readBody(req);
    const openId = body.openId || `mock_openid_${String(body.code || "local").slice(0, 12)}`;
    const user = getOrCreateUserByOpenId(db, openId);
    await writeDb(db);
    return sendJson(res, {
      ok: true,
      user,
      session: {
        token: Buffer.from(`${user.id}:${Date.now()}`).toString("base64url"),
        expiresIn: 86400
      }
    });
  }

  if (method === "POST" && url.pathname === "/api/auth/profile") {
    const body = await readBody(req);
    const user = db.users.find((item) => item.id === body.userId || item.openId === body.openId);
    if (!user) return sendJson(res, { error: "User not found" }, 404);
    user.name = body.name || user.name;
    user.avatar = body.avatar || user.avatar;
    if (["English", "\u4e2d\u6587"].includes(body.language)) user.language = body.language;
    user.profileAuthorized = true;
    await writeDb(db);
    return sendJson(res, { ok: true, user });
  }

  if (method === "GET" && url.pathname === "/api/cms") {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    await writeDb(db);
    const dashboardDate = url.searchParams.get("date") || offsetDateKey(-1);
    return sendJson(res, {
      currentAdmin: safeUser(admin),
      settings: db.settings,
      metrics: publicMetrics(db),
      dashboard: dashboardForDate(db, dashboardDate),
      dramas: sortDramas(db.dramas).map((drama) => ({
        ...drama,
        episodeCount: db.episodes.filter((episode) => episode.dramaId === drama.id).length
      })),
      episodes: db.episodes,
      users: db.users,
      transactions: db.transactions,
      comments: db.comments,
      events: (db.events || []).slice(0, 500),
      fandom: sortFandom(db.fandom)
    });
  }

  if (method === "GET" && segments[1] === "dramas" && segments[2]) {
    const drama = db.dramas.find((item) => item.id === segments[2] || item.slug === segments[2]);
    if (!drama) return sendJson(res, { error: "Drama not found" }, 404);
    return sendJson(res, hydrateDrama(db, drama));
  }

  if (method === "POST" && url.pathname === "/api/dramas") {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    const totalEpisodes = Number(body.totalEpisodes || 20);
    const freeEpisodes = Number(body.freeEpisodes || 5);
    const unlockPrice = Number(body.unlockPrice || 35);
    const id = uid("drama");
    const title = String(body.title || "Untitled Drama").trim();
    const drama = {
      id,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || id,
      status: body.status || "draft",
      category: body.category || "Romance",
      language: body.language || db.settings.defaultLanguage,
      region: body.region || "US",
      tags: String(body.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      cover: body.cover || "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80",
      banner: body.banner || body.cover || "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80",
      description: body.description || "New drama description.",
      totalEpisodes,
      freeEpisodes,
      unlockPrice,
      weight: numberValue(body.weight, 1),
      subscriptionOnly: Boolean(body.subscriptionOnly),
      releaseDate: body.releaseDate || new Date().toISOString().slice(0, 10),
      stats: { plays: 0, favorites: 0, comments: 0, completionRate: 0 },
      monetization: {
        iapEnabled: false,
        iaaEnabled: Boolean(body.iaaEnabled ?? true),
        adUnlock: Boolean(body.adUnlock ?? true),
        subscriptionsEnabled: Boolean(body.subscriptionOnly)
      }
    };
    db.dramas.unshift(drama);
    for (let index = 1; index <= totalEpisodes; index += 1) {
      db.episodes.push({
        id: `${id}_ep_${index}`,
        dramaId: id,
        number: index,
        title: `Episode ${index}`,
        duration: body.duration || "01:30",
        price: index <= freeEpisodes ? 0 : unlockPrice,
        isFree: index <= freeEpisodes,
        resolution: body.resolution || "540p",
        status: "draft",
        videoUrl: body.videoUrl || "",
        subtitleLanguages: [drama.language],
        plot: body.description || ""
      });
    }
    await writeDb(db);
    return sendJson(res, { ok: true, drama: hydrateDrama(db, drama) }, 201);
  }

  if (method === "POST" && url.pathname === "/api/uploads/chunked/init") {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    const filename = safeName(body.filename || "");
    const fileSize = Number(body.fileSize || 0);
    const archiveExt = path.extname(filename).toLowerCase();
    if (!filename || ![".zip", ".rar"].includes(archiveExt)) return sendJson(res, { error: "Only .zip and .rar are supported" }, 400);
    if (!Number.isFinite(fileSize) || fileSize <= 0) return sendJson(res, { error: "Invalid file size" }, 400);
    const maxBytes = (db.settings.media?.maxUploadMb || 2048) * 1024 * 1024;
    if (fileSize > maxBytes) return sendJson(res, { error: `Upload exceeds ${db.settings.media?.maxUploadMb || 2048} MB` }, 400);
    const requestedChunkSize = Number(body.chunkSize || 32 * 1024 * 1024);
    const chunkSize = Math.max(1024 * 1024, Math.min(MAX_CHUNK_BYTES, requestedChunkSize));
    const totalChunks = Math.ceil(fileSize / chunkSize);
    const fingerprint = sha256(`${filename}:${fileSize}:${body.lastModified || ""}:${body.title || ""}`);
    const uploadId = `upl_${fingerprint.slice(0, 24)}`;
    const existing = readUploadMeta(uploadId);
    const form = {
      title: body.title || path.basename(filename, archiveExt),
      category: body.category || "Romance",
      freeEpisodes: body.freeEpisodes || db.settings.monetization.freeEpisodesDefault || 6,
      weight: body.weight || 1,
      cover: body.cover || "",
      banner: body.banner || "",
      description: body.description || "",
      subscriptionOnly: String(body.subscriptionOnly || "false")
    };
    const meta =
      existing && existing.filename === filename && Number(existing.fileSize) === fileSize
        ? { ...existing, form, chunkSize, totalChunks }
        : {
            uploadId,
            filename,
            fileSize,
            chunkSize,
            totalChunks,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: "uploading",
            form
          };
    writeUploadMeta(meta);
    return sendJson(res, { ok: true, ...uploadStatus(meta) });
  }

  if (method === "GET" && segments[1] === "uploads" && segments[2] === "chunked" && segments[3]) {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const meta = readUploadMeta(segments[3]);
    if (!meta) return sendJson(res, { error: "Upload not found" }, 404);
    return sendJson(res, { ok: true, ...uploadStatus(meta) });
  }

  if (method === "PUT" && segments[1] === "uploads" && segments[2] === "chunked" && segments[3] && segments[4]) {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const meta = readUploadMeta(segments[3]);
    if (!meta) return sendJson(res, { error: "Upload not found" }, 404);
    if (meta.status === "done") return sendJson(res, { ok: true, ...uploadStatus(meta) });
    const index = Number(segments[4]);
    if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) return sendJson(res, { error: "Invalid chunk index" }, 400);
    const expectedSize = index === meta.totalChunks - 1 ? meta.fileSize - meta.chunkSize * index : meta.chunkSize;
    const raw = await readRawBody(req, Math.min(MAX_CHUNK_BYTES, expectedSize + 1024 * 1024));
    if (raw.length !== expectedSize) return sendJson(res, { error: "Chunk size mismatch" }, 400);
    const chunksDir = path.join(uploadSessionDir(meta.uploadId), "chunks");
    fs.mkdirSync(chunksDir, { recursive: true });
    fs.writeFileSync(chunkPath(meta.uploadId, index), raw);
    meta.updatedAt = new Date().toISOString();
    meta.status = "uploading";
    writeUploadMeta(meta);
    return sendJson(res, { ok: true, ...uploadStatus(meta) });
  }

  if (method === "POST" && segments[1] === "uploads" && segments[2] === "chunked" && segments[3] && segments[4] === "complete") {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const meta = readUploadMeta(segments[3]);
    if (!meta) return sendJson(res, { error: "Upload not found" }, 404);
    const received = receivedChunks(meta);
    if (received.length !== meta.totalChunks) return sendJson(res, { error: "Missing chunks", ...uploadStatus(meta) }, 400);
    if (meta.status !== "done" && meta.status !== "processing") {
      meta.status = "queued";
      meta.error = "";
      meta.updatedAt = new Date().toISOString();
      writeUploadMeta(meta);
      completeChunkUpload(meta.uploadId).catch(() => {});
    }
    const nextMeta = readUploadMeta(meta.uploadId) || meta;
    return sendJson(res, { ok: true, ...uploadStatus(nextMeta) });
  }

  if (method === "POST" && url.pathname === "/api/dramas/upload-zip") {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const raw = await readRawBody(req, (db.settings.media?.maxUploadMb || 2048) * 1024 * 1024);
    const parts = parseMultipart(req, raw);
    const file = parts.file;
    if (!file || !file.data?.length) return sendJson(res, { error: "Archive file is required" }, 400);
    const archiveExt = path.extname(file.filename).toLowerCase();
    if (![".zip", ".rar"].includes(archiveExt)) return sendJson(res, { error: "Only .zip and .rar are supported" }, 400);

    const id = uid("drama");
    const uploadRoot = path.join(MEDIA_DIR, "uploads", id);
    fs.rmSync(uploadRoot, { recursive: true, force: true });
    fs.mkdirSync(uploadRoot, { recursive: true });

    const archivePath = path.join(uploadRoot, safeName(file.filename));
    try {
      fs.writeFileSync(archivePath, file.data);
      const result = await importDramaArchive(db, archivePath, {
        id,
        title: parts.title,
        status: parts.status,
        category: parts.category,
        tags: parts.tags,
        freeEpisodes: parts.freeEpisodes,
        weight: parts.weight,
        cover: parts.cover,
        banner: parts.banner,
        description: parts.description,
        subscriptionOnly: parts.subscriptionOnly,
        filename: file.filename,
        uploadRoot
      });
      await writeDb(db);
      return sendJson(res, { ok: true, drama: hydrateDrama(db, result.drama), matched: result.matched }, 201);
    } catch (error) {
      fs.rmSync(uploadRoot, { recursive: true, force: true });
      return sendJson(res, { error: error.message || "Archive import failed" }, 500);
    }
  }

  if (method === "PATCH" && segments[1] === "dramas" && segments[2]) {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    const drama = db.dramas.find((item) => item.id === segments[2]);
    if (!drama) return sendJson(res, { error: "Drama not found" }, 404);
    const editable = [
      "title",
      "status",
      "category",
      "language",
      "region",
      "cover",
      "banner",
      "description",
      "freeEpisodes",
      "unlockPrice",
      "weight",
      "subscriptionOnly",
      "monetization"
    ];
    editable.forEach((field) => {
      if (field in body) drama[field] = body[field];
    });
    drama.freeEpisodes = Number(drama.freeEpisodes);
    drama.unlockPrice = Number(drama.unlockPrice);
    drama.weight = numberValue(drama.weight, 1);
    db.episodes
      .filter((episode) => episode.dramaId === drama.id)
      .forEach((episode) => {
        episode.isFree = episode.number <= drama.freeEpisodes;
        episode.price = episode.isFree ? 0 : drama.unlockPrice;
      });
    await writeDb(db);
    return sendJson(res, { ok: true, drama: hydrateDrama(db, drama) });
  }

  if (method === "PATCH" && segments[1] === "episodes" && segments[2]) {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    const episode = db.episodes.find((item) => item.id === segments[2]);
    if (!episode) return sendJson(res, { error: "Episode not found" }, 404);
    ["title", "duration", "status", "videoUrl", "plot", "resolution"].forEach((field) => {
      if (field in body) episode[field] = String(body[field] || "");
    });
    await writeDb(db);
    return sendJson(res, { ok: true, episode });
  }

  if (method === "POST" && url.pathname === "/api/fandom") {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    const post = {
      id: uid("post"),
      type: body.type || "Watch Guide",
      status: body.status || "published",
      weight: numberValue(body.weight, 1),
      title: String(body.title || "Untitled Guide").trim(),
      dramaId: body.dramaId || "",
      image: body.image || "",
      excerpt: body.excerpt || "",
      publishedAt: body.publishedAt || new Date().toISOString()
    };
    db.fandom.unshift(post);
    await writeDb(db);
    return sendJson(res, { ok: true, post }, 201);
  }

  if (method === "PATCH" && segments[1] === "fandom" && segments[2]) {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    const post = db.fandom.find((item) => item.id === segments[2]);
    if (!post) return sendJson(res, { error: "Guide not found" }, 404);
    ["type", "status", "title", "dramaId", "image", "excerpt", "publishedAt"].forEach((field) => {
      if (field in body) post[field] = body[field];
    });
    if ("weight" in body) post.weight = numberValue(body.weight, 1);
    await writeDb(db);
    return sendJson(res, { ok: true, post });
  }

  if (method === "DELETE" && segments[1] === "fandom" && segments[2]) {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const before = db.fandom.length;
    db.fandom = db.fandom.filter((item) => item.id !== segments[2]);
    if (db.fandom.length === before) return sendJson(res, { error: "Guide not found" }, 404);
    await writeDb(db);
    return sendJson(res, { ok: true });
  }

  if (method === "POST" && url.pathname === "/api/unlock") {
    const body = await readBody(req);
    const user = db.users.find((item) => item.id === (body.userId || "user_demo"));
    const episode = db.episodes.find((item) => item.id === body.episodeId);
    if (!user || !episode) return sendJson(res, { error: "Invalid unlock request" }, 400);
    if (body.method !== "rewarded_ad") return sendJson(res, { error: "Only rewarded ad unlock is enabled" }, 400);
    if (!body.adCompleted) return sendJson(res, { error: "Rewarded ad was not completed" }, 400);
    if (!episode.isFree && !user.unlockedEpisodes.includes(episode.id)) {
      user.unlockedEpisodes.push(episode.id);
      db.transactions.unshift({
        id: uid("txn"),
        userId: user.id,
        type: "ad_unlock",
        amount: 0,
        channel: "Rewarded ad unlock",
        episodeId: episode.id,
        adUnitId: db.settings.monetization.rewardedAdUnitId,
        createdAt: new Date().toISOString()
      });
      logEvent(db, "unlock", { userId: user.id, dramaId: episode.dramaId, episodeId: episode.id, label: "rewarded_ad" });
    }
    await writeDb(db);
    return sendJson(res, { ok: true, user, episode });
  }

  if (method === "POST" && url.pathname === "/api/subscriptions/mock") {
    const body = await readBody(req);
    const user = db.users.find((item) => item.id === (body.userId || "user_demo"));
    if (!user) return sendJson(res, { error: "User not found" }, 404);
    user.subscription = {
      status: body.status || "active",
      plan: body.plan || "monthly",
      expiresAt: body.expiresAt || new Date(Date.now() + 30 * 86400 * 1000).toISOString()
    };
    logEvent(db, "subscription", { userId: user.id, label: user.subscription.plan || "monthly" });
    await writeDb(db);
    return sendJson(res, { ok: true, user });
  }

  if (method === "POST" && url.pathname === "/api/favorite") {
    const body = await readBody(req);
    const user = db.users.find((item) => item.id === (body.userId || "user_demo"));
    const drama = db.dramas.find((item) => item.id === body.dramaId);
    if (!user || !drama) return sendJson(res, { error: "Invalid favorite request" }, 400);
    const exists = user.favorites.includes(drama.id);
    user.favorites = exists ? user.favorites.filter((item) => item !== drama.id) : [...user.favorites, drama.id];
    drama.stats.favorites += exists ? -1 : 1;
    logEvent(db, exists ? "unfavorite" : "favorite", { userId: user.id, dramaId: drama.id });
    await writeDb(db);
    return sendJson(res, { ok: true, user, drama });
  }

  if (method === "POST" && url.pathname === "/api/events") {
    const body = await readBody(req);
    const userId = body.userId || "user_demo";
    const type = String(body.type || "").trim();
    const allowed = new Set(["click", "play_start", "play_progress", "play_complete"]);
    if (!allowed.has(type)) return sendJson(res, { error: "Unsupported event" }, 400);
    const drama = body.dramaId ? db.dramas.find((item) => item.id === body.dramaId) : null;
    const episode = body.episodeId ? db.episodes.find((item) => item.id === body.episodeId) : null;
    if ((body.dramaId && !drama) || (body.episodeId && !episode)) return sendJson(res, { error: "Invalid event target" }, 400);
    const event = logEvent(db, type, {
      userId,
      dramaId: body.dramaId || episode?.dramaId || "",
      episodeId: body.episodeId || "",
      label: body.label || "",
      value: body.value,
      meta: body.meta || {}
    });
    if (type === "play_start") {
      const targetDrama = drama || db.dramas.find((item) => item.id === episode?.dramaId);
      if (targetDrama) targetDrama.stats.plays = Number(targetDrama.stats.plays || 0) + 1;
      const user = db.users.find((item) => item.id === userId);
      if (user && episode) {
        user.watchHistory = user.watchHistory || [];
        user.watchHistory = user.watchHistory.filter((item) => item.episodeId !== episode.id);
        user.watchHistory.unshift({ dramaId: episode.dramaId, episodeId: episode.id, progress: 1, updatedAt: event.createdAt });
        user.watchHistory = user.watchHistory.slice(0, 50);
      }
    }
    if (type === "play_progress") {
      const user = db.users.find((item) => item.id === userId);
      const progress = Math.max(0, Math.min(100, Number(body.progress || body.value || 0)));
      const history = user?.watchHistory?.find((item) => item.episodeId === body.episodeId);
      if (history) {
        history.progress = progress;
        history.updatedAt = event.createdAt;
      }
    }
    await writeDb(db);
    return sendJson(res, { ok: true, event });
  }

  if (method === "POST" && url.pathname === "/api/comments") {
    const body = await readBody(req);
    const comment = {
      id: uid("cmt"),
      dramaId: body.dramaId,
      episodeId: body.episodeId,
      userId: body.userId || "user_demo",
      userName: body.userName || db.users.find((item) => item.id === body.userId)?.name || "Avery",
      body: String(body.body || "").slice(0, 500),
      status: "visible",
      likes: 0,
      createdAt: new Date().toISOString()
    };
    db.comments.unshift(comment);
    const drama = db.dramas.find((item) => item.id === comment.dramaId);
    if (drama) drama.stats.comments += 1;
    logEvent(db, "comment", { userId: comment.userId, dramaId: comment.dramaId, episodeId: comment.episodeId });
    await writeDb(db);
    return sendJson(res, { ok: true, comment }, 201);
  }

  if (method === "PATCH" && segments[1] === "comments" && segments[2]) {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    const comment = db.comments.find((item) => item.id === segments[2]);
    if (!comment) return sendJson(res, { error: "Comment not found" }, 404);
    if (body.status) comment.status = body.status;
    await writeDb(db);
    return sendJson(res, { ok: true, comment });
  }

  if (method === "PATCH" && segments[1] === "cms" && segments[2] === "users" && segments[3] && segments[4] === "admin") {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    const user = db.users.find((item) => item.id === segments[3]);
    if (!user) return sendJson(res, { error: "User not found" }, 404);
    const nextIsAdmin = Boolean(body.isAdmin);
    if (!nextIsAdmin && user.isAdmin && db.users.filter((item) => item.isAdmin).length <= 1) {
      return sendJson(res, { error: "At least one admin is required" }, 400);
    }
    user.isAdmin = nextIsAdmin;
    await writeDb(db);
    return sendJson(res, { ok: true, user });
  }

  if (method === "PATCH" && url.pathname === "/api/settings") {
    const admin = requireAdmin(db, req, res);
    if (!admin) return;
    const body = await readBody(req);
    db.settings = {
      ...db.settings,
      ...body,
      tiktok: { ...db.settings.tiktok, ...(body.tiktok || {}) },
      monetization: { ...db.settings.monetization, ...(body.monetization || {}) },
      policyUrls: { ...db.settings.policyUrls, ...(body.policyUrls || {}) },
      homeCarouselIds: Array.isArray(body.homeCarouselIds) ? body.homeCarouselIds : db.settings.homeCarouselIds
    };
    db.settings.brand = "VidShort";
    db.settings.defaultLanguage = "English";
    db.settings.supportedLanguages = [...DEFAULT_SETTINGS.supportedLanguages];
    db.settings.launchRegion = "US";
    db.settings.regions = ["US"];
    db.settings.monetization.paymentsEnabled = false;
    await writeDb(db);
    return sendJson(res, { ok: true, settings: db.settings });
  }

  return sendJson(res, { error: "Not found" }, 404);
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/cms") return sendRedirect(res, "https://cms.vidshort.uk/");
  if (pathname === "/") pathname = "/index.html";
  if (!path.extname(pathname)) pathname += ".html";

  const baseDir = pathname.startsWith("/media/") ? ROOT : PUBLIC_DIR;
  const filePath = path.normalize(path.join(baseDir, pathname));
  if (!filePath.startsWith(baseDir)) return sendText(res, "Forbidden", 403);

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (indexError, indexData) => {
        if (indexError) return sendText(res, "Not found", 404);
        return sendText(res, indexData, 200, "text/html; charset=utf-8");
      });
      return;
    }
    const contentType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": staticCacheControl(filePath) });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    sendJson(res, { error: error.message || "Server error" }, 500);
  }
});

initializeStorage()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Drama Mini Suite running at http://localhost:${PORT}`);
      console.log(`CMS running at http://localhost:${PORT}/cms`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage", error);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  try {
    await flushDbWrites();
    if (pgPool) await pgPool.end();
  } finally {
    process.exit(0);
  }
});
