const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");

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
const MEDIA_DIR = path.join(ROOT, "media");

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
  brand: "ReelPilot",
  defaultLanguage: "English",
  launchRegion: "US",
  supportedLanguages: ["English", "Spanish", "Portuguese", "Indonesian", "Japanese", "Korean", "Thai", "French"],
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

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(seedData(), null, 2));
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (normalizeDb(db)) writeDb(db);
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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

  if (db.settings.defaultLanguage !== "English") {
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

  db.users = db.users || [];
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
    user.language = "English";
    user.region = "US";
  });

  db.dramas = db.dramas || [];
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
        subtitleLanguages: drama.language === "English" ? ["English", "Portuguese", "Spanish"] : [drama.language],
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
        profileAuthorized: true,
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
    <title>ReelPilot CMS</title>
    <link rel="stylesheet" href="/api/assets/styles.v20260511-2.css">
  </head>
  <body class="cms-body">
    <div id="cms"></div>
    <script src="/api/assets/icons.v20260511-2.js"></script>
    <script src="/api/assets/cms.v20260511-2.js"></script>
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

function episodeNumberFromName(filename, fallback) {
  const base = path.basename(filename, path.extname(filename));
  const patterns = [
    /(?:ep|episode|e|第)\s*0*(\d{1,5})(?:\s*集)?/i,
    /(^|[^0-9])0*(\d{1,5})([^0-9]|$)/
  ];
  for (const pattern of patterns) {
    const match = base.match(pattern);
    if (match) return Number(match[2] || match[1]);
  }
  return fallback;
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

function signingKey(secret, dateStamp, region) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

async function putR2Object(objectKey, filePath, contentType) {
  const config = runtimeR2Config();
  if (!isR2Configured()) throw new Error("R2 storage is not configured");

  const body = fs.readFileSync(filePath);
  const payloadHash = sha256(body);
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
      "Content-Length": String(body.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    },
    body
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

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    const quotePsPath = (value) => `'${String(value).replace(/'/g, "''")}'`;
    childProcess.execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath ${quotePsPath(zipPath)} -DestinationPath ${quotePsPath(destDir)} -Force`
      ],
      { stdio: "pipe" }
    );
    return;
  }
  try {
    childProcess.execFileSync("unzip", ["-q", "-o", zipPath, "-d", destDir], { stdio: "pipe" });
  } catch (error) {
    try {
      childProcess.execFileSync("python3", ["-m", "zipfile", "-e", zipPath, destDir], { stdio: "pipe" });
    } catch (pythonError) {
      throw new Error("ZIP extraction failed. Upload a valid ZIP file.");
    }
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
    profileAuthorized: Boolean(profile.profileAuthorized),
    subscription: { status: "inactive", expiresAt: "" },
    favorites: [],
    unlockedEpisodes: [],
    watchHistory: []
  };
  db.users.push(user);
  return user;
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
    writeDb(db);
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
    writeDb(db);
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
    user.profileAuthorized = true;
    writeDb(db);
    return sendJson(res, { ok: true, user });
  }

  if (method === "GET" && url.pathname === "/api/cms") {
    return sendJson(res, {
      settings: db.settings,
      metrics: publicMetrics(db),
      dramas: sortDramas(db.dramas).map((drama) => ({
        ...drama,
        episodeCount: db.episodes.filter((episode) => episode.dramaId === drama.id).length
      })),
      episodes: db.episodes,
      users: db.users,
      transactions: db.transactions,
      comments: db.comments,
      fandom: sortFandom(db.fandom)
    });
  }

  if (method === "GET" && segments[1] === "dramas" && segments[2]) {
    const drama = db.dramas.find((item) => item.id === segments[2] || item.slug === segments[2]);
    if (!drama) return sendJson(res, { error: "Drama not found" }, 404);
    return sendJson(res, hydrateDrama(db, drama));
  }

  if (method === "POST" && url.pathname === "/api/dramas") {
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
    writeDb(db);
    return sendJson(res, { ok: true, drama: hydrateDrama(db, drama) }, 201);
  }

  if (method === "POST" && url.pathname === "/api/dramas/upload-zip") {
    const raw = await readRawBody(req, (db.settings.media?.maxUploadMb || 2048) * 1024 * 1024);
    const parts = parseMultipart(req, raw);
    const file = parts.file;
    if (!file || !file.data?.length) return sendJson(res, { error: "ZIP file is required" }, 400);
    if (!file.filename.toLowerCase().endsWith(".zip")) return sendJson(res, { error: "Only .zip is supported" }, 400);

    const id = uid("drama");
    const title = String(parts.title || path.basename(file.filename, path.extname(file.filename)) || "Untitled Drama").trim();
    const freeEpisodes = Number(parts.freeEpisodes || db.settings.monetization.freeEpisodesDefault || 6);
    const category = String(parts.category || "Romance");
    const uploadRoot = path.join(MEDIA_DIR, "uploads", id);
    const extractRoot = path.join(uploadRoot, "extract");
    fs.rmSync(uploadRoot, { recursive: true, force: true });
    fs.mkdirSync(uploadRoot, { recursive: true });

    const zipPath = path.join(uploadRoot, safeName(file.filename));
    try {
      fs.writeFileSync(zipPath, file.data);
      extractZip(zipPath, extractRoot);
    } catch (error) {
      fs.rmSync(uploadRoot, { recursive: true, force: true });
      return sendJson(res, { error: error.message || "ZIP extraction failed" }, 400);
    }

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
    if (!discovered.length) {
      fs.rmSync(uploadRoot, { recursive: true, force: true });
      return sendJson(res, { error: "No video files found in ZIP" }, 400);
    }

    const numbered = discovered
      .map((full, index) => ({ full, number: episodeNumberFromName(path.basename(full), index + 1) }))
      .sort((a, b) => a.number - b.number || a.full.localeCompare(b.full));

    const used = new Set();
    const episodes = [];
    try {
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
    } catch (error) {
      fs.rmSync(uploadRoot, { recursive: true, force: true });
      return sendJson(res, { error: error.message || "Video upload failed" }, 500);
    }

    const drama = {
      id,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || id,
      status: String(parts.status || "draft"),
      category,
      language: db.settings.defaultLanguage,
      region: db.settings.launchRegion,
      tags: String(parts.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      cover: String(parts.cover || "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=80"),
      banner: String(parts.banner || parts.cover || "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80"),
      description: String(parts.description || ""),
      totalEpisodes: episodes.length,
      freeEpisodes,
      unlockPrice: 0,
      weight: numberValue(parts.weight, 1),
      subscriptionOnly: String(parts.subscriptionOnly || "false") === "true",
      releaseDate: new Date().toISOString().slice(0, 10),
      stats: { plays: 0, favorites: 0, comments: 0, completionRate: 0 },
      monetization: { iapEnabled: false, iaaEnabled: true, adUnlock: true, subscriptionsEnabled: String(parts.subscriptionOnly || "false") === "true" },
      upload: {
        type: "zip",
        filename: safeName(file.filename),
        uploadedAt: new Date().toISOString(),
        matchedEpisodes: episodes.map((episode) => ({ number: episode.number, originalFilename: episode.originalFilename, videoUrl: episode.videoUrl }))
      }
    };

    db.dramas.unshift(drama);
    db.episodes.push(...episodes);
    writeDb(db);
    return sendJson(res, { ok: true, drama: hydrateDrama(db, drama), matched: drama.upload.matchedEpisodes }, 201);
  }

  if (method === "PATCH" && segments[1] === "dramas" && segments[2]) {
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
    writeDb(db);
    return sendJson(res, { ok: true, drama: hydrateDrama(db, drama) });
  }

  if (method === "POST" && url.pathname === "/api/fandom") {
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
    writeDb(db);
    return sendJson(res, { ok: true, post }, 201);
  }

  if (method === "PATCH" && segments[1] === "fandom" && segments[2]) {
    const body = await readBody(req);
    const post = db.fandom.find((item) => item.id === segments[2]);
    if (!post) return sendJson(res, { error: "Guide not found" }, 404);
    ["type", "status", "title", "dramaId", "image", "excerpt", "publishedAt"].forEach((field) => {
      if (field in body) post[field] = body[field];
    });
    if ("weight" in body) post.weight = numberValue(body.weight, 1);
    writeDb(db);
    return sendJson(res, { ok: true, post });
  }

  if (method === "DELETE" && segments[1] === "fandom" && segments[2]) {
    const before = db.fandom.length;
    db.fandom = db.fandom.filter((item) => item.id !== segments[2]);
    if (db.fandom.length === before) return sendJson(res, { error: "Guide not found" }, 404);
    writeDb(db);
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
    }
    writeDb(db);
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
    writeDb(db);
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
    writeDb(db);
    return sendJson(res, { ok: true, user, drama });
  }

  if (method === "POST" && url.pathname === "/api/comments") {
    const body = await readBody(req);
    const comment = {
      id: uid("cmt"),
      dramaId: body.dramaId,
      episodeId: body.episodeId,
      userId: body.userId || "user_demo",
      userName: body.userName || "Avery",
      body: String(body.body || "").slice(0, 500),
      status: "pending",
      likes: 0,
      createdAt: new Date().toISOString()
    };
    db.comments.unshift(comment);
    const drama = db.dramas.find((item) => item.id === comment.dramaId);
    if (drama) drama.stats.comments += 1;
    writeDb(db);
    return sendJson(res, { ok: true, comment }, 201);
  }

  if (method === "PATCH" && segments[1] === "comments" && segments[2]) {
    const body = await readBody(req);
    const comment = db.comments.find((item) => item.id === segments[2]);
    if (!comment) return sendJson(res, { error: "Comment not found" }, 404);
    if (body.status) comment.status = body.status;
    writeDb(db);
    return sendJson(res, { ok: true, comment });
  }

  if (method === "PATCH" && url.pathname === "/api/settings") {
    const body = await readBody(req);
    db.settings = {
      ...db.settings,
      ...body,
      tiktok: { ...db.settings.tiktok, ...(body.tiktok || {}) },
      monetization: { ...db.settings.monetization, ...(body.monetization || {}) },
      policyUrls: { ...db.settings.policyUrls, ...(body.policyUrls || {}) }
    };
    db.settings.defaultLanguage = "English";
    db.settings.launchRegion = "US";
    db.settings.regions = ["US"];
    db.settings.monetization.paymentsEnabled = false;
    writeDb(db);
    return sendJson(res, { ok: true, settings: db.settings });
  }

  return sendJson(res, { error: "Not found" }, 404);
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/cms") pathname = "/cms.html";
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

ensureDb();

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

server.listen(PORT, () => {
  console.log(`Drama Mini Suite running at http://localhost:${PORT}`);
  console.log(`CMS running at http://localhost:${PORT}/cms`);
});
