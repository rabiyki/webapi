const express = require("express");
const router = express.Router();
const axios = require("axios");
const { CREATOR } = require("../config");
const { noCache, ax, safeDestroy } = require("../utils/http");
const { cacheMedia, mediaCache } = require("../utils/cache");
const {
  fastYoutubeSearch,
  getSongResult,
  fetchSongDavid,
  fetchSongSavetube,
  fetchSongVidssave,
  fetchSongJerexd,
  fetchSongJerry
} = require("../utils/youtube");

// Priority order used by /media/:file when a song stream needs to
// live-fallback to another backend. "jerry" stays last on purpose —
// it's the slowest/backup source, same as everywhere else in this file.
const SONG_BACKENDS = {
  david: fetchSongDavid,
  savetube: fetchSongSavetube,
  vidssave: fetchSongVidssave,
  jerexd: fetchSongJerexd,
  jerry: fetchSongJerry
};
const SONG_BACKEND_ORDER = ["david", "savetube", "vidssave", "jerexd", "jerry"];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ▶️ PLAY API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/play", async (req, res) => {
  noCache(res);
  try {
    const { q, url } = req.query;
    const input = q || url;

    if (!input) return res.status(400).json({
      status: false, creator: CREATOR, message: "Enter song name or YouTube URL"
    });

    let video;

    if (input.includes("youtube.com") || input.includes("youtu.be")) {
      video = { title: "YouTube Audio", url: input, videoId: null, duration: null, views: null, uploaded: null, thumbnail: null, author: { name: null } };
    } else {
      try {
        video = await fastYoutubeSearch(input);
      } catch {
        return res.json({ status: false, creator: CREATOR, message: "No result found" });
      }
    }

    if (!video) return res.json({ status: false, creator: CREATOR, message: "No result found" });

    // Reuse the exact same backend logic as /api/song
    let songResult;
    try {
      songResult = await getSongResult(video.url);
    } catch {
      return res.json({ status: false, creator: CREATOR, message: "Audio fetch failed" });
    }

    // "song-fallback" mode: /media/:file streams songResult.downloadUrl
    // first. If that stream errors out before any bytes reach the
    // client, it live-resolves the next backend in SONG_BACKEND_ORDER
    // (skipping songResult.source, already tried) and retries — all
    // inside the same request, same link. Only redirects once every
    // backend has failed to stream.
    const proxy = cacheMedia(
      req,
      songResult.downloadUrl,
      ".mp3",
      10 * 60 * 1000,
      "song-fallback",
      video.title || songResult.title,
      null,
      { videoUrl: video.url, triedSource: songResult.source }
    );
    const thumbnail = cacheMedia(req, video.thumbnail, ".jpg");

    res.json({
      status: true,
      creator: CREATOR,
      query: input,
      result: {
        title: video.title,
        videoId: video.videoId,
        duration: video.duration,
        views: video.views,
        uploaded: video.uploaded,
        thumbnail,
        url: proxy,
        author: { name: video.author?.name }
      }
    });
  } catch (e) {
    res.status(500).json({ status: false, creator: CREATOR, message: "Something went wrong" });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎵 For testing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/aud/:id", async (req, res) => {
  try {
    const response = await axios({
      method: "GET",
      url: `https://api.sayan-nexuswork.workers.dev/stream?v=${req.params.id}`,
      responseType: "stream",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive"
      },
      maxRedirects: 5
    });

    res.status(response.status);

    Object.entries(response.headers).forEach(([key, value]) => {
      if (
        ![
          "content-encoding",
          "transfer-encoding",
          "connection"
        ].includes(key.toLowerCase())
      ) {
        res.setHeader(key, value);
      }
    });

    response.data.pipe(res);

  } catch (err) {
    console.error(err.response?.status, err.response?.data);

    res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      status: err.response?.status
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎵 SONG / YTMP3
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/song1", async (req, res) => {
  noCache(res);

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        creator: CREATOR,
        message: "YouTube URL required"
      });
    }

    const { data } = await ax.get(
      `https://api.sayan-nexuswork.workers.dev/play?query=${encodeURIComponent(url)}`
    );

    if (!data?.status || !data?.url) {
      return res.status(404).json({
        success: false,
        creator: CREATOR,
        message: "Song not found"
      });
    }

    const videoId =
      new URL(data.url).searchParams.get("v");

    const proxyUrl =
      `${req.protocol}://${req.get("host")}/audio/${videoId}`;

    res.json({
      success: true,
      creator: CREATOR,

      result: {
        title: data.title,
        format: "MP3",

        url: proxyUrl,
        mp3: proxyUrl,
        audio: proxyUrl,
        download: proxyUrl
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      creator: CREATOR,
      error: err.message
    });
  }
});

router.get("/audio1/:id", async (req, res) => {
  try {
    const target =
      `https://api.sayan-nexuswork.workers.dev/stream?v=${req.params.id}`;

    return res.redirect(target);

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get("/api/song", async (req, res) => {
  noCache(res);

  try {
    const { q, url } = req.query;
    const input = q || url;

    if (!input) {
      return res.status(400).json({
        success: false,
        creator: CREATOR,
        message: "Enter song name or YouTube URL"
      });
    }

    let videoUrl;
    let searchMeta = null;

    if (input.includes("youtube.com") || input.includes("youtu.be")) {
      // Direct URL — skip search, go straight to the backend
      videoUrl = input;
    } else {
      // Plain query — search first, then use the top result's URL
      try {
        searchMeta = await fastYoutubeSearch(input);
      } catch {
        return res.json({
          success: false,
          creator: CREATOR,
          message: "No result found"
        });
      }
      videoUrl = searchMeta.url;
    }

    let result;
    try {
      result = await getSongResult(videoUrl);
    } catch {
      return res.status(404).json({
        success: false,
        creator: CREATOR,
        message: "Song not found"
      });
    }

    // "song-fallback" mode: /media/:file streams result.downloadUrl
    // first. If that stream errors out before any bytes reach the
    // client, it live-resolves the next backend in SONG_BACKEND_ORDER
    // (skipping result.source, already tried) and retries — all inside
    // the same request, same link. Only redirects once every backend
    // has failed to stream.
    const proxy = cacheMedia(
      req,
      result.downloadUrl,
      ".mp3",
      10 * 60 * 1000,
      "song-fallback",
      result.title || searchMeta?.title,
      null,
      { videoUrl, triedSource: result.source }
    );
    const thumbnail = cacheMedia(req, result.thumbnail || searchMeta?.thumbnail || null, ".jpg");

    return res.json({
      success: true,
      creator: CREATOR,
      query: input,
      result: {
        title: result.title || searchMeta?.title,
        videoId: searchMeta?.videoId || null,
        duration: result.duration,
        quality: result.quality,
        thumbnail,
        format: "MP3",
        url: proxy,
        mp3: proxy,
        audio: proxy,
        download: proxy
      }
    });

  } catch (err) {
    return res.status(404).json({
      success: false,
      creator: CREATOR,
      message: "Song not found"
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔁 SHARED MEDIA PROXY
// Serves anything cached via cacheMedia
// / cacheBufferMedia across all routes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Streams `url` to the client. Resolves true once piping has begun
// (headers received, response is OK) — resolves false / throws if the
// upstream request itself fails, so the caller can try the next
// candidate. Once piping actually starts, errors are terminal (can't
// switch source mid-stream to an already-flushed response).
async function streamUrlToClient(req, res, url, filename) {
  const response = await ax({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 15000 // per-candidate connect/response timeout while probing
  });

  // Got a response — commit to this source. From here on, timeout: 0
  // effectively applies since we just needed headers fast; the pipe
  // itself has no timeout.
  res.setHeader(
    "Content-Type",
    response.headers["content-type"] || "audio/mpeg"
  );
  if (filename) {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  }

  response.data.on("error", () => {
    if (!res.headersSent) {
      res.status(502).json({ success: false, error: "Upstream stream error" });
    } else {
      res.end();
    }
  });

  req.on("close", () => safeDestroy(response.data));

  response.data.pipe(res);
}

// Walks the song backend list live, trying to stream each candidate
// in turn. `alreadyTried` is skipped since cacheMedia's stored `url`
// is that backend's result and gets tried first, separately.
async function streamSongWithFallback(req, res, entry) {
  const { url: primaryUrl, meta, filename } = entry;
  const order = SONG_BACKEND_ORDER.filter(name => name !== meta?.triedSource);

  // 1) Try the already-resolved primary URL first — cheapest option,
  //    no re-resolving needed.
  try {
    await streamUrlToClient(req, res, primaryUrl, filename);
    return;
  } catch (err) {
    console.error(`[SONG STREAM] primary (${meta?.triedSource || "unknown"}) failed:`, err?.message || err);
    if (res.headersSent) return; // already committed, nothing more to do
  }

  // 2) Walk the remaining backends live, resolving + streaming each.
  let lastResolvedUrl = null;

  for (const name of order) {
    const fetchFn = SONG_BACKENDS[name];
    if (!fetchFn || !meta?.videoUrl) continue;

    let candidate;
    try {
      candidate = await fetchFn(meta.videoUrl);
    } catch (err) {
      console.error(`[SONG STREAM] resolve ${name} failed:`, err?.message || err);
      continue;
    }
    if (!candidate?.downloadUrl) continue;

    lastResolvedUrl = candidate.downloadUrl;

    try {
      await streamUrlToClient(req, res, candidate.downloadUrl, filename);
      return;
    } catch (err) {
      console.error(`[SONG STREAM] stream ${name} failed:`, err?.message || err);
      if (res.headersSent) return;
    }
  }

  // 3) Every backend failed to stream. Last resort: redirect to
  //    whatever URL we last managed to resolve (best effort), or the
  //    original primary URL if nothing else ever resolved.
  if (!res.headersSent) {
    const fallbackUrl = lastResolvedUrl || primaryUrl;
    if (fallbackUrl) {
      return res.redirect(fallbackUrl);
    }
    return res.status(502).json({ success: false, message: "All sources failed" });
  }
}

router.get("/media/:file", async (req, res) => {
  try {

    const entry = mediaCache.get(req.params.file);

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Link expired"
      });
    }

    // Buffer-based entry — serve directly, no upstream fetch needed
    if (Buffer.isBuffer(entry?.buffer)) {
      res.setHeader("Content-Type", entry.contentType || "application/octet-stream");
      res.setHeader("Content-Length", entry.buffer.length);
      return res.end(entry.buffer);
    }

    // Redirect-mode entry — send client straight to the original URL
    if (entry?.mode === "redirect") {
      return res.redirect(entry.url);
    }

    // Song-fallback entry — try to stream the resolved backend first;
    // on failure, live-resolve + stream the next backend in priority
    // order, all within this same request. Redirects only once every
    // backend has failed to stream.
    if (entry?.mode === "song-fallback") {
      return await streamSongWithFallback(req, res, entry);
    }

    // Default "stream" mode — proxy stream from the original source,
    // with a single backupUrl retry if the primary fails outright.
    let url = entry.url;
    let response;
    try {
      response = await ax({
        url,
        method: "GET",
        responseType: "stream",
        timeout: 0 // override global 30s timeout — long audio needs more time
      });
    } catch (err) {
      if (!entry.backupUrl) throw err;
      url = entry.backupUrl;
      response = await ax({
        url,
        method: "GET",
        responseType: "stream",
        timeout: 0
      });
    }

    res.setHeader(
      "Content-Type",
      response.headers["content-type"] || "audio/mpeg"
    );

    // Content-Length intentionally NOT forwarded here: decompress:true on
    // the shared `ax` instance means the byte count after decompression
    // can differ from the upstream's compressed Content-Length, causing
    // players to cut playback short. Left as chunked transfer instead.

    if (entry.filename) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${entry.filename}"`
      );
    }

    response.data.on("error", () => {
      if (!res.headersSent) {
        res.status(502).json({ success: false, error: "Upstream stream error" });
      } else {
        res.end();
      }
    });

    req.on("close", () => safeDestroy(response.data));

    response.data.pipe(res);

  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: e.message
      });
    } else {
      res.end();
    }
  }
});

router.get("/api/ytmp3", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, creator: CREATOR, message: "YouTube URL required" });

    const { data } = await ax.get(
      `https://ytmp333-chama-woad.vercel.app/api/ytdl?url=${encodeURIComponent(url)}&format=mp3&_chm=ofc`
    );

    if (!data?.status || !data?.url) {
      return res.status(404).json({
        success: false,
        creator: CREATOR,
        message: "Song not found"
      });
    }

    res.json({
      success: true,
      creator: CREATOR,
      result: {
        title: data.title,

        url: data.url,
        mp3: data.url,
        audio: data.url,
        download: data.url
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, creator: CREATOR, error: err.message });
  }
});

module.exports = router;
