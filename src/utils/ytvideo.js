// utils/ytvideo.js
// YouTube MP4 link resolver — same backends as the WhatsApp plugin
// (davidcyril + convert1s), raced against each other. Returns only the
// resolved link + metadata (no download to disk), so the API can hand it
// out through cacheMedia and never expose the real source.
const axios = require("axios");

const DAVIDCYRIL_VIDEO_BASE = "https://apis.davidcyril.name.ng/download/savetube";
const CONVERT1S_API = "https://hub.convert1s.com/api/download";
const CONVERT1S_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: "https://media.ytmp3.gg",
  Referer: "https://media.ytmp3.gg/"
};

// Auto mode: 720p first, 1080p intentionally skipped (same as plugin)
const AUTO_ORDER = ["720p", "480p", "360p", "240p", "144p"];
const QUALITY_REGEX = /^(144|240|360|480|720|1080)p?$/i;

function normalizeQuality(q) {
  if (!q) return null;
  const s = String(q).trim().toLowerCase();
  if (!QUALITY_REGEX.test(s)) return null;
  return `${s.replace("p", "")}p`;
}

function extractVideoId(url) {
  const m = String(url).match(/(?:youtube\.com\/.*[?&]v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function davidcyril(youtubeUrl, qualityP) {
  const qNum = qualityP.replace("p", "");
  const { data } = await axios.get(
    `${DAVIDCYRIL_VIDEO_BASE}?url=${encodeURIComponent(youtubeUrl)}&format=${qNum}`,
    { timeout: 25000 }
  );
  if (!data?.success || !data?.data?.download_url) {
    throw new Error(`davidcyril failed @${qualityP}`);
  }
  const d = data.data;
  return {
    downloadUrl: d.download_url,
    quality: d.quality ? `${d.quality}p` : qualityP,
    title: d.title || null,
    thumbnail: d.cover || null,
    duration: d.duration || null
  };
}

async function convert1sPoll(statusUrl, { intervalMs = 2000, timeoutMs = 90000 } = {}) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > timeoutMs) throw new Error("convert1s: polling timed out");
    const { data } = await axios.get(statusUrl, {
      headers: { Accept: "application/json" },
      timeout: 15000
    });
    if (data?.status === "completed") {
      if (!data.downloadUrl) throw new Error("convert1s: no downloadUrl");
      return data;
    }
    if (data?.status === "failed" || data?.status === "error") {
      throw new Error(`convert1s: job ${data.status}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function convert1s(youtubeUrl, qualityP) {
  const { data } = await axios.post(
    CONVERT1S_API,
    {
      url: youtubeUrl,
      os: "android",
      output: { type: "video", format: "mp4", quality: qualityP }
    },
    { headers: CONVERT1S_HEADERS, timeout: 20000 }
  );
  if (!data?.statusUrl) throw new Error(`convert1s: no statusUrl @${qualityP}`);
  const r = await convert1sPoll(data.statusUrl);
  return {
    downloadUrl: r.downloadUrl,
    quality: r.selectedQuality || qualityP,
    title: null,
    thumbnail: null,
    duration: null
  };
}

// Race both backends at one quality — first valid link wins.
async function fetchAtQuality(youtubeUrl, qualityP) {
  return Promise.any([
    davidcyril(youtubeUrl, qualityP),
    convert1s(youtubeUrl, qualityP)
  ]);
}

/**
 * getVideoResult(youtubeUrl, requestedQuality?)
 *  - no quality  -> AUTO: 720p -> 480p -> 360p -> 240p -> 144p
 *  - quality set -> exactly that quality (e.g. 1080p)
 * Throws if everything fails.
 */
async function getVideoResult(youtubeUrl, requestedQuality = null) {
  const wanted = normalizeQuality(requestedQuality);
  const order = wanted ? [wanted] : AUTO_ORDER;

  let lastErr;
  for (const q of order) {
    try {
      const r = await fetchAtQuality(youtubeUrl, q);
      return { ...r, videoId: extractVideoId(youtubeUrl) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `All video qualities (${order.join("/")}) failed: ${lastErr?.errors?.map((e) => e.message).join(" | ") || lastErr?.message}`
  );
}

module.exports = { getVideoResult, normalizeQuality };
