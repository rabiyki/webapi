// hd2.js — context: routes/hd2.js, Node.js 18+, Express
// axios ^1.x, form-data ^4.x, multer ^1.x, https-proxy-agent ^7.x, socks-proxy-agent ^8.x

const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const multer = require("multer");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const router = express.Router();
const { CREATOR } = require("../config");
const { noCache } = require("../utils/http");
const { cacheBufferMedia } = require("../utils/cache");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HD ENHANCER — /api/hd2
// Three providers race in parallel; fastest non-erroring result wins.
// Phase 1: all three on direct IP  (Promise.any)
// Phase 2: all three × top-N proxies if Phase 1 fully fails (Promise.any)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── provider endpoints ──────────────────────────────────────────────
const HD2_API    = "https://apiii-xrina.my.id/ai-image/hd2";

const UNBLUR_BASE    = "https://api.unwatermark.ai/api/web/unblurimage/v1/image-unblur-v2";
const UNBLUR_HEADERS = {
  "User-Agent"     : "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
  "Origin"         : "https://unblurimage.ai",
  "Referer"        : "https://unblurimage.ai/",
  "Accept"         : "*/*",
  "product-code"   : "067003",
  "product-serial" : "uigbeo",
};

const EZENHANCER_BASE    = "https://api.ezenhancer.ai/api/web/v1/image-enhance";
const EZENHANCER_HEADERS = {
  "User-Agent"     : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept"         : "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Origin"         : "https://ezenhancer.ai",
  "Referer"        : "https://ezenhancer.ai/",
};

// ── proxy pool ──────────────────────────────────────────────────────
const PROXY_SOURCES = [
  { url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text" },
  { url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/all.txt" },
  { url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt" },
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",   proto: "http"   },
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt", proto: "socks4" },
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", proto: "socks5" },
  { url: "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",   proto: "socks5" },
];

const PROBE_URL    = "https://api.unwatermark.ai/";
const POOL_TTL     = 10 * 60 * 1000;
const PROBE_TIMEOUT = 7_000;
const PROBE_BATCH  = 40;
const WANT_GOOD    = 6;   // collect this many working proxies
const MAX_PROBED   = 240;
const PROXY_RACE_N = 3;   // use top-N proxies in Phase 2 race

let pool = { list: [], ts: 0 };
let good = [];             // [{ proxy, ms }] sorted fastest-first

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function parseProxies(text, defProto) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(
      /^(?:(https?|socks4a?|socks5h?):\/\/)?(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/i
    );
    if (m) out.push(`${(m[1] || defProto || "http").toLowerCase()}://${m[2]}:${m[3]}`);
  }
  return out;
}

const agentFor = (proxy) =>
  proxy.startsWith("socks") ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy);

async function loadPool() {
  if (pool.list.length && Date.now() - pool.ts < POOL_TTL) return pool.list;
  const results = await Promise.allSettled(
    PROXY_SOURCES.map((s) =>
      axios
        .get(s.url, { timeout: 15_000, responseType: "text", transformResponse: (d) => d })
        .then((r) => parseProxies(r.data, s.proto))
    )
  );
  const all = new Set();
  results.forEach((r) => r.status === "fulfilled" && r.value.forEach((p) => all.add(p)));
  pool = { list: shuffle([...all]), ts: Date.now() };
  console.log(`[proxy] pool: ${pool.list.length}`);
  return pool.list;
}

async function probe(proxy) {
  const t = Date.now();
  const agent = agentFor(proxy);
  await axios.get(PROBE_URL, {
    httpAgent: agent, httpsAgent: agent, proxy: false,
    timeout: PROBE_TIMEOUT, validateStatus: () => true,
  });
  return Date.now() - t;
}

async function discoverGood() {
  const list  = await loadPool();
  const known = new Set(good.map((g) => g.proxy));
  const todo  = list.filter((p) => !known.has(p)).slice(0, MAX_PROBED);

  for (let i = 0; i < todo.length && good.length < WANT_GOOD; i += PROBE_BATCH) {
    const batch = todo.slice(i, i + PROBE_BATCH);
    const res   = await Promise.allSettled(
      batch.map(async (p) => ({ proxy: p, ms: await probe(p) }))
    );
    res.forEach((r) => r.status === "fulfilled" && good.push(r.value));
    good.sort((a, b) => a.ms - b.ms);
  }
  console.log(`[proxy] working: ${good.length}${good[0] ? ` (fastest ${good[0].ms}ms)` : ""}`);
  return good.length > 0;
}

// ── shared utilities ────────────────────────────────────────────────
const netFor = (agent) =>
  agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : {};

const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k] ?? o?.data?.[k] ?? o?.result?.[k];
    if (v) return v;
  }
  return null;
};

const download = (url) =>
  axios.get(url, { responseType: "arraybuffer", timeout: 60_000 })
    .then((r) => Buffer.from(r.data));

// ── provider: xrina (URL-based) ─────────────────────────────────────
async function xrinaEnhance(url, agent = null) {
  const { data } = await axios.get(HD2_API, {
    params: { url },
    timeout: 120_000,
    ...netFor(agent),
  });
  if (!data?.status || !data?.data?.url) throw new Error("xrina: no result");
  return { url: data.data.url, agent };
}

// ── provider: unblurimage.ai (buffer scraper) ───────────────────────
async function unblurEnhance(buffer, agent = null, tries = 30, delay = 2_000) {
  const net  = netFor(agent);
  const form = new FormData();
  form.append("original_image_file", buffer, {
    filename    : `unblur_${Date.now()}.jpg`,
    contentType : "image/jpeg",
  });

  const up = await axios.post(`${UNBLUR_BASE}/create-job`, form, {
    ...net,
    headers          : { ...UNBLUR_HEADERS, ...form.getHeaders() },
    maxContentLength : Infinity,
    maxBodyLength    : Infinity,
    timeout          : 120_000,
  });

  const jobId = pick(up.data, ["job_id", "jobId"]);
  if (!jobId) throw new Error("unblur: job id missing");

  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const { data } = await axios.get(`${UNBLUR_BASE}/get-job/${jobId}`, {
        ...net,
        headers : { ...UNBLUR_HEADERS, "Content-Type": "application/json; charset=UTF-8" },
        timeout : 30_000,
      });
      const url = pick(data, ["output_url", "outputUrl", "image_url", "imageUrl"]);
      if (url) return { url, agent };
      const status = String(pick(data, ["status"]) || "").toLowerCase();
      if (["failed", "error", "cancelled"].includes(status))
        throw new Error(`unblur: job ${status}`);
    } catch (e) {
      if (/unblur: job/.test(e.message)) throw e;
    }
  }
  throw new Error("unblur: timed out");
}

// ── provider: ezenhancer.ai (buffer scraper) ────────────────────────
async function ezenhancerEnhance(buffer, agent = null, tries = 60, delay = 3_000) {
  const net  = netFor(agent);
  const form = new FormData();
  form.append("original_image_file", buffer, {
    filename    : `ez_${Date.now()}.jpg`,
    contentType : "image/jpeg",
  });

  const up = await axios.post(`${EZENHANCER_BASE}/create-job`, form, {
    ...net,
    headers          : { ...EZENHANCER_HEADERS, ...form.getHeaders() },
    maxContentLength : Infinity,
    maxBodyLength    : Infinity,
    timeout          : 120_000,
  });

  // ezenhancer nests result under .result
  const jobId = up.data?.result?.job_id ?? pick(up.data, ["job_id", "jobId"]);
  if (!jobId) throw new Error("ezenhancer: job id missing");

  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const { data } = await axios.get(`${EZENHANCER_BASE}/get-job/${jobId}`, {
        ...net,
        headers : { ...EZENHANCER_HEADERS, "Content-Type": "application/json; charset=UTF-8" },
        timeout : 30_000,
      });
      const res = data?.result ?? data;
      // status 1 = done
      if (res?.status === 1) {
        const url = res?.image_url ?? res?.url ?? res?.output_url;
        if (url) return { url, agent };
        throw new Error("ezenhancer: success but no url");
      }
      if (res?.status !== 0 && res?.status !== undefined)
        throw new Error(`ezenhancer: job status ${res.status}`);
    } catch (e) {
      if (/ezenhancer:/.test(e.message)) throw e;
    }
  }
  throw new Error("ezenhancer: timed out");
}

// ── core: race all three providers on a given agent ─────────────────
// Returns whichever resolves first; rejects only if all three fail.
function raceAll(buf, url, agent) {
  return Promise.any([
    xrinaEnhance(url, agent),
    unblurEnhance(buf, agent),
    ezenhancerEnhance(buf, agent),
  ]);
}

// ── two-phase enhance ───────────────────────────────────────────────
// Phase 1: race on direct IP.
// Phase 2: race across top-N proxies simultaneously (each proxy races all 3 providers).
async function enhanceWithFallback(buf, url) {
  // Phase 1 — direct
  try {
    console.log("[hd2] phase 1: direct race");
    return await raceAll(buf, url, null);
  } catch (e) {
    console.error("[hd2] phase 1 failed:", e?.errors?.map((x) => x.message) ?? e.message);
  }

  // Phase 2 — proxy race
  console.log("[hd2] phase 2: discovering proxies...");
  const found = await discoverGood();
  if (!found) throw new Error("phase 2: no working proxies found");

  const agents = good.slice(0, PROXY_RACE_N).map(({ proxy }) => agentFor(proxy));
  console.log(`[hd2] phase 2: racing ${agents.length} proxies × 3 providers`);

  return Promise.any(agents.map((agent) => raceAll(buf, url, agent)));
}

// ── finish: download result image + cache it ────────────────────────
async function finish(req, res, { url: outUrl, agent }) {
  let img;
  try {
    img = await axios.get(outUrl, { responseType: "arraybuffer", timeout: 60_000 });
  } catch (e) {
    if (!agent) throw e;
    img = await axios.get(outUrl, {
      responseType: "arraybuffer", timeout: 60_000,
      httpAgent: agent, httpsAgent: agent, proxy: false,
    });
  }
  const ct  = img.headers["content-type"] || "image/jpeg";
  const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpg";
  const proxy = cacheBufferMedia(req, Buffer.from(img.data), ct, ext);
  return res.json({ status: "success", creator: CREATOR, result: { url: proxy } });
}

const fail = (res, err) => {
  const msg =
    err?.response?.data
      ? JSON.stringify(err.response.data).slice(0, 200)
      : err?.message ?? "Failed to enhance image";
  return res.status(500).json({ status: false, creator: CREATOR, message: msg });
};

const getSrc = (req) => ({ ...req.query, ...(req.body && typeof req.body === "object" ? req.body : {}) });
const validUrl = (u) => /^https?:\/\//i.test(u || "");

// ── handler ─────────────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function hd2Handler(req, res) {
  noCache(res);
  let { url } = getSrc(req);
  let buf = null;

  if (req.file) {
    if (!/^image\//.test(req.file.mimetype || ""))
      return res.status(400).json({ status: false, creator: CREATOR, message: "Uploaded file is not an image" });
    buf = req.file.buffer;
    const ct = req.file.mimetype;
    url = cacheBufferMedia(req, buf, ct, ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpg");
  } else {
    if (!url)
      return res.status(400).json({ status: false, creator: CREATOR, message: "'url' or 'file' is required" });
    if (!validUrl(url))
      return res.status(400).json({ status: false, creator: CREATOR, message: "Invalid image URL" });
  }

  try {
    const b   = buf ?? (await download(url));
    const out = await enhanceWithFallback(b, url);
    return await finish(req, res, out);
  } catch (err) {
    return fail(res, err);
  }
}

router.get("/api/hd2", hd2Handler);
router.post("/api/hd2", upload.single("file"), hd2Handler);

module.exports = router;
