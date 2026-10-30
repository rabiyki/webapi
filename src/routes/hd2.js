const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const router = express.Router();
const { CREATOR } = require("../config");
const { noCache } = require("../utils/http");
const { cacheBufferMedia } = require("../utils/cache");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖼️ HD ENHANCER
// GET|POST /api/hd2?url=<image_url>
//   1) xrina API
//   2) fallback: unblurimage.ai scraper -> own IP first, on error -> fastest free proxy
//
// -> { status:"success", creator, result:{ url } }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const HD2_API = "https://apiii-xrina.my.id/ai-image/hd2";

// ── unblurimage.ai scraper (api.unwatermark.ai) ─────────────────────
const UNBLUR_BASE = "https://api.unwatermark.ai/api/web/unblurimage/v1/image-unblur-v2";
const UNBLUR_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
  Origin: "https://unblurimage.ai",
  Referer: "https://unblurimage.ai/",
  Accept: "*/*",
  "product-code": "067003",
  "product-serial": "uigbeo"
};

const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k] ?? o?.data?.[k] ?? o?.result?.[k];
    if (v) return v;
  }
  return null;
};

// ── free proxy pool (used only when our own IP fails) ──────────────
const PROXY_SOURCES = [
  { url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text" },
  { url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/all.txt" },
  { url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt" },
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt", proto: "http" },
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt", proto: "socks4" },
  { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", proto: "socks5" },
  { url: "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt", proto: "socks5" }
];
const PROBE_URL = "https://api.unwatermark.ai/";   // any HTTP reply = proxy works
const POOL_TTL = 10 * 60 * 1000;
const PROBE_TIMEOUT = 7000;
const PROBE_BATCH = 40;
const WANT_GOOD = 5;        // stop probing once this many working proxies found
const MAX_PROBED = 240;     // per discovery round
const MAX_ATTEMPTS = 6;     // real jobs tried via proxies
const TOTAL_BUDGET = 4 * 60 * 1000;

let pool = { list: [], ts: 0 };
let good = []; // [{ proxy, ms }] sorted fastest first

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function parseProxies(text, defProto) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^(?:(https?|socks4a?|socks5h?):\/\/)?(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/i);
    if (m) out.push(`${(m[1] || defProto || "http").toLowerCase()}://${m[2]}:${m[3]}`);
  }
  return out;
}

const agentFor = (proxy) => (proxy.startsWith("socks") ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy));

async function loadPool() {
  if (pool.list.length && Date.now() - pool.ts < POOL_TTL) return pool.list;
  const results = await Promise.allSettled(
    PROXY_SOURCES.map((s) => axios.get(s.url, { timeout: 15000, responseType: "text", transformResponse: (d) => d }).then((r) => parseProxies(r.data, s.proto)))
  );
  const all = new Set();
  results.forEach((r) => r.status === "fulfilled" && r.value.forEach((p) => all.add(p)));
  pool = { list: shuffle([...all]), ts: Date.now() };
  console.log(`[proxy] pool loaded: ${pool.list.length} proxies`);
  return pool.list;
}

async function probe(proxy) {
  const t = Date.now();
  const agent = agentFor(proxy);
  await axios.get(PROBE_URL, { httpAgent: agent, httpsAgent: agent, proxy: false, timeout: PROBE_TIMEOUT, validateStatus: () => true });
  return Date.now() - t;
}

// test many proxies in parallel batches, keep the fastest working ones
async function discoverGood() {
  const list = await loadPool();
  const known = new Set(good.map((g) => g.proxy));
  const todo = list.filter((p) => !known.has(p)).slice(0, MAX_PROBED);
  for (let i = 0; i < todo.length && good.length < WANT_GOOD; i += PROBE_BATCH) {
    const batch = todo.slice(i, i + PROBE_BATCH);
    const res = await Promise.allSettled(batch.map(async (p) => ({ proxy: p, ms: await probe(p) })));
    res.forEach((r) => r.status === "fulfilled" && good.push(r.value));
    good.sort((a, b) => a.ms - b.ms);
  }
  console.log(`[proxy] working: ${good.length}${good[0] ? ` (fastest ${good[0].ms}ms)` : ""}`);
  return good.length > 0;
}

// task(agent|null): own IP first; on any error use fastest working proxies
async function withProxyFallback(task) {
  const deadline = Date.now() + TOTAL_BUDGET;
  try {
    return await task(null);
  } catch (e) {
    console.error("[hd2] direct IP failed:", e?.response?.status || e.message);
  }

  let lastErr = new Error("no working proxy found");
  let discoveries = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && Date.now() < deadline; ) {
    if (!good.length) {
      if (discoveries++ >= 2 || !(await discoverGood())) break;
    }
    const { proxy, ms } = good[0];
    attempt++;
    try {
      console.log(`[hd2] trying proxy ${proxy} (${ms}ms)`);
      return await task(agentFor(proxy));
    } catch (e) {
      lastErr = e;
      good = good.filter((g) => g.proxy !== proxy); // bad -> next fastest
    }
  }
  throw lastErr;
}

// returns { url, agent } — same agent must be used for the whole job
async function unblurBuffer(buffer, agent = null, tries = 30, delay = 2000) {
  const net = agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : {};
  const form = new FormData();
  form.append("original_image_file", buffer, { filename: `unblur_${Date.now()}.jpg`, contentType: "image/jpeg" });

  const up = await axios.post(`${UNBLUR_BASE}/create-job`, form, {
    ...net,
    headers: { ...UNBLUR_HEADERS, ...form.getHeaders() },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000
  });

  const jobId = pick(up.data, ["job_id", "jobId"]);
  if (!jobId) throw new Error("unblur: job id not found");

  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const { data } = await axios.get(`${UNBLUR_BASE}/get-job/${jobId}`, {
        ...net,
        headers: { ...UNBLUR_HEADERS, "Content-Type": "application/json; charset=UTF-8" },
        timeout: 30000
      });
      const url = pick(data, ["output_url", "outputUrl", "image_url", "imageUrl"]);
      if (url) return { url, agent };
      const status = String(pick(data, ["status"]) || "").toLowerCase();
      if (["failed", "error", "cancelled"].includes(status)) throw new Error(`unblur: job ${status}`);
    } catch (e) {
      if (/unblur: job/.test(e.message)) throw e; // real failure; network blips just retry
    }
  }
  throw new Error("unblur: timed out");
}

// ── shared helpers ──────────────────────────────────────────────────
const download = async (url) => Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 60000 })).data);

async function finish(req, res, { url: outUrl, agent }) {
  let img;
  try {
    img = await axios.get(outUrl, { responseType: "arraybuffer", timeout: 60000 });
  } catch (e) {
    if (!agent) throw e;
    img = await axios.get(outUrl, { responseType: "arraybuffer", timeout: 60000, httpAgent: agent, httpsAgent: agent, proxy: false });
  }
  const ct = img.headers["content-type"] || "image/jpeg";
  const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpg";
  const proxy = cacheBufferMedia(req, Buffer.from(img.data), ct, ext);
  return res.json({ status: "success", creator: CREATOR, result: { url: proxy } });
}

const fail = (res, err) => {
  const message = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : err.message || "Failed to enhance image";
  return res.status(500).json({ status: false, creator: CREATOR, message });
};

const getSrc = (req) => ({ ...req.query, ...(req.body && typeof req.body === "object" ? req.body : {}) });
const validUrl = (u) => /^https?:\/\//i.test(u || "");

// ── /api/hd2 ────────────────────────────────────────────────────────
async function hd2Handler(req, res) {
  noCache(res);
  const { url } = getSrc(req);
  if (!url) return res.status(400).json({ status: false, creator: CREATOR, message: "'url' (image URL) is required" });
  if (!validUrl(url)) return res.status(400).json({ status: false, creator: CREATOR, message: "Invalid image URL" });

  try {
    let out;
    try {
      const { data } = await axios.get(HD2_API, { params: { url }, timeout: 120000 });
      if (!data?.status || !data?.data?.url) throw new Error("HD API returned no result");
      out = { url: data.data.url, agent: null };
    } catch (e) {
      console.error("[hd2] primary failed, using unblur:", e.message);
      const buf = await download(url);
      out = await withProxyFallback((agent) => unblurBuffer(buf, agent));
    }
    return await finish(req, res, out);
  } catch (err) {
    return fail(res, err);
  }
}

router.get("/api/hd2", hd2Handler);
router.post("/api/hd2", hd2Handler);

module.exports = router;
