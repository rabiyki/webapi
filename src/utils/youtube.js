const { ax } = require("./http");
const { JERRY_HEADERS } = require("../config");
const CryptoJS = require("crypto-js");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━
// FAST YOUTUBE SEARCH
// Races yt-search against a second
// source, and caches repeat queries
// so the same song returns instantly
// ━━━━━━━━━━━━━━━━━━━━━━━━━━

const searchCache = new Map();
const SEARCH_CACHE_TTL = 20 * 60 * 1000;

function normalizeVideo(v) {
  return {
    title: v.title,
    url: v.url,
    videoId: v.videoId,
    duration: v.duration || v.timestamp,
    views: v.views,
    uploaded: v.uploaded || v.ago,
    thumbnail: v.thumbnail,
    author: { name: v.author?.name }
  };
}

async function searchViaDanzy(query) {
  const { data } = await ax.get(
    `https://api.danzy.web.id/api/search/yts?q=${encodeURIComponent(query)}`,
    { timeout: 8000 }
  );
  const v = data?.result?.[0];
  if (!data?.status || !v) throw new Error("no result");
  return normalizeVideo(v);
}

async function searchViaRabbit(query) {
  const { data } = await ax.get(
    `https://rabbitapi.nett.to/search/youtube?q=${encodeURIComponent(query)}&limit=1`,
    { timeout: 8000 }
  );
  const v = data?.result?.[0];
  if (!v) throw new Error("no result");
  return normalizeVideo(v);
}

// Direct YouTube scrape — no middleman API at all,
// parses ytInitialData straight off the results page
async function searchViaDirect(query) {
  const { data } = await ax.get("https://www.youtube.com/results", {
    params: { search_query: query },
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    timeout: 8000
  });

  const match = data.match(/var ytInitialData = (.*?);<\/script>/s);
  if (!match) throw new Error("parse failed");

  const ytInitialData = JSON.parse(match[1]);
  const contents = ytInitialData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  if (!contents) throw new Error("no contents");

  const section = contents.find(c => c.itemSectionRenderer)?.itemSectionRenderer?.contents;
  if (!section) throw new Error("no section");

  const first = section.find(i => i.videoRenderer && i.videoRenderer.lengthText);
  if (!first) throw new Error("no result");

  const v = first.videoRenderer;

  return {
    title: v.title?.runs?.[0]?.text || "No Title",
    url: `https://youtu.be/${v.videoId}`,
    videoId: v.videoId,
    duration: v.lengthText?.simpleText || null,
    views: v.viewCountText?.simpleText || null,
    uploaded: v.publishedTimeText?.simpleText || null,
    thumbnail: v.thumbnail?.thumbnails?.slice(-1)[0]?.url || null,
    author: { name: null }
  };
}

async function fastYoutubeSearch(query) {
  const key = query.trim().toLowerCase();
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.time < SEARCH_CACHE_TTL) {
    return cached.video;
  }

  const video = await Promise.any([
    searchViaDanzy(query),
    searchViaRabbit(query),
    searchViaDirect(query)
  ]);

  searchCache.set(key, { video, time: Date.now() });
  return video;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━
// SONG BACKENDS
//
// David, Savetube, Vidssave, and Jerexd are all raced
// together via Promise.any() — whichever responds
// successfully FIRST is used immediately.
//
// Jerry is kept as the FINAL fallback, only called if
// every single one of the raced backends fails.
//
// Both /api/song and /api/play call getSongResult() so
// any backend added here automatically applies to both.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchSongDavid(url) {
  const { data } = await ax.get(
    `https://apis.davidcyril.name.ng/download/savetube?url=${encodeURIComponent(url)}&format=mp3`,
    { timeout: 10000 }
  );

  if (!data?.success || !data?.data?.download_url) {
    throw new Error("source unavailable");
  }

  return {
    title: data.data.title,
    duration: data.data.duration,
    quality: data.data.quality,
    thumbnail: data.data.cover,
    downloadUrl: data.data.download_url,
    source: "david"
  };
}

// --- Savetube (media.savetube.vip) ---
const SAVETUBE_KEY = "C5D58EF67A7584E4A29F6C35BBC4EB12";

function savetubeDecrypt(base64) {
  const raw = Buffer.from(base64, "base64");
  const iv = raw.slice(0, 16);
  const encrypted = raw.slice(16);
  const key = CryptoJS.enc.Hex.parse(SAVETUBE_KEY);
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.lib.WordArray.create(encrypted) },
    key,
    {
      iv: CryptoJS.lib.WordArray.create(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    }
  );
  return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
}

async function fetchSongSavetube(url) {
  const { data: cdnData } = await ax.get(
    "https://media.savetube.vip/api/random-cdn",
    { timeout: 8000 }
  );
  const cdn = cdnData?.cdn;
  if (!cdn) throw new Error("no savetube cdn");

  const { data: infoRes } = await ax.post(
    `https://${cdn}/v2/info`,
    { url },
    { timeout: 10000 }
  );
  if (!infoRes?.status) throw new Error(infoRes?.message || "savetube info failed");

  const info = savetubeDecrypt(infoRes.data);

  const { data: dlRes } = await ax.post(
    `https://${cdn}/download`,
    { downloadType: "audio", quality: "128", key: info.key },
    { timeout: 10000 }
  );

  const downloadUrl = dlRes?.data?.downloadUrl;
  if (!downloadUrl) throw new Error("no savetube download url");

  return {
    title: info.title,
    duration: info.durationLabel,
    quality: "128kbps",
    thumbnail: info.thumbnail,
    downloadUrl,
    source: "savetube"
  };
}

// --- Vidssave (vidssave.com) ---
const VIDSSAVE_URL = "https://api.vidssave.com/api/contentsite_api/media/parse";
const VIDSSAVE_AUTH = "20250901majwlqo";
const VIDSSAVE_DOMAIN = "api-ak.vidssave.com";

function pickAudioResourceVidssave(mediaArr, preferredKbps = 128) {
  const audioMedia = (mediaArr || []).find(m => m.media_id === "audio");
  if (!audioMedia) return null;
  const resources = (audioMedia.resources || []).filter(r => r.download_url);
  if (!resources.length) return null;
  const exact = resources.find(r => parseInt(r.quality, 10) === preferredKbps);
  if (exact) return exact;
  resources.sort((a, b) => parseInt(b.quality, 10) - parseInt(a.quality, 10));
  return resources[0];
}

async function fetchSongVidssave(url) {
  const params = new URLSearchParams();
  params.append("auth", VIDSSAVE_AUTH);
  params.append("domain", VIDSSAVE_DOMAIN);
  params.append("origin", "source");
  params.append("link", url);

  const { data } = await ax.post(VIDSSAVE_URL, params, {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://vidssave.com",
      referer: "https://vidssave.com/"
    },
    timeout: 12000
  });

  const result = data?.data;
  if (!result) throw new Error("invalid vidssave response");

  const audioRes = pickAudioResourceVidssave(result.media, 128);
  if (!audioRes) throw new Error("no vidssave audio resource");

  return {
    title: result.title,
    duration: result.duration,
    quality: `${audioRes.quality}kbps`,
    thumbnail: result.thumbnail,
    downloadUrl: audioRes.download_url,
    source: "vidssave"
  };
}

// --- Jerexd (api.jerexd.my.id) ---
const JEREXD_API_KEY = "jere_xMwutZzgpBcl";

async function fetchSongJerexd(url) {
  const { data } = await ax.get(
    `https://api.jerexd.my.id/api/downloader/youtube?apikey=${JEREXD_API_KEY}&url=${encodeURIComponent(url)}&format=mp3`,
    { timeout: 12000 }
  );

  if (!data?.status || !data?.result?.download) {
    throw new Error("jerexd source unavailable");
  }

  return {
    title: data.result.title,
    duration: null,
    quality: null,
    thumbnail: null,
    downloadUrl: data.result.download,
    source: "jerexd"
  };
}

async function fetchSongJerry(url) {
  const { data } = await ax.get(
    `https://jerrycoder.oggyapi.workers.dev/down/ytmp3?url=${encodeURIComponent(url)}`,
    { timeout: 15000, headers: JERRY_HEADERS }
  );

  if (data?.status !== "success" || !data?.url) {
    throw new Error("jerry source unavailable");
  }

  return {
    title: data.title,
    duration: data.duration,
    quality: data.quality,
    thumbnail: null,
    downloadUrl: data.url,
    source: "jerry"
  };
}

// David, Savetube, Vidssave, and Jerexd race together —
// first successful response wins. Jerry is the last-resort
// fallback, only tried if all four of those fail.
async function getSongResult(videoUrl) {
  try {
    return await Promise.any([
      fetchSongDavid(videoUrl),
      fetchSongSavetube(videoUrl),
      fetchSongVidssave(videoUrl),
      fetchSongJerexd(videoUrl)
    ]);
  } catch (_) {}

  try {
    return await fetchSongJerry(videoUrl);
  } catch (_) {}

  throw new Error("all sources failed");
}

module.exports = {
  fastYoutubeSearch,
  getSongResult,
  fetchSongDavid,
  fetchSongSavetube,
  fetchSongVidssave,
  fetchSongJerexd,
  fetchSongJerry
};
