const express = require("express");
const router = express.Router();
const { CREATOR } = require("../config");
const { noCache, ax } = require("../utils/http");
const { cacheMedia } = require("../utils/cache");
const { fastYoutubeSearch } = require("../utils/youtube");
const { getVideoResult, normalizeQuality } = require("../utils/ytvideo");





// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📸 ALL DOWNLOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/dwnall", async (req, res) => {
  noCache(res);

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        creator: CREATOR,
        message: "URL required"
      });
    }

    const api = `https://nayan-video-downloader.vercel.app/alldown?url=${encodeURIComponent(url)}`;

    const response = await ax.get(api, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const data = response.data;

    if (!data?.status || !data?.data) {
      return res.status(404).json({
        success: false,
        creator: CREATOR,
        message: "Media not found"
      });
    }

    const result = data.data;

    const ss = cacheMedia(req, result.low || null, ".mp4");
    const hd = cacheMedia(req, result.high || null, ".mp4");
    const thumbnail = cacheMedia(req, result.thumbnail || null, ".jpg");

    return res.json({
      success: true,
      creator: CREATOR,

      result: {
        title: result.title || "Unknown",
        thumbnail,

        ss,
        hd
      }
    });

  } catch (err) {

    if (err.code === "ECONNABORTED") {
      return res.status(408).json({
        success: false,
        creator: CREATOR,
        message: "Request timeout"
      });
    }

    return res.status(500).json({
      success: false,
      creator: CREATOR,
      error: err.message
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🐇 TERABOX V2 — STREAM / DOWNLOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/teraboxv2", async (req, res) => {
  noCache(res);

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        status: "error",
        creator: CREATOR,
        message: "URL required"
      });
    }

    const api = `https://nayan-video-downloader.vercel.app/teraboxv2?url=${encodeURIComponent(url)}`;

    const response = await ax.get(api, {
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const data = response.data;

    if (!data?.status || data.status !== "success" || !Array.isArray(data.videos) || !data.videos.length) {
      return res.status(404).json({
        status: "error",
        creator: CREATOR,
        message: "No videos found in this link"
      });
    }

    const videos = data.videos.map((v) => {
      // Re-cache every quality inside fast_stream_url under our own domain
      const fastStream = {};
      if (v.fast_stream_url) {
        for (const [quality, link] of Object.entries(v.fast_stream_url)) {
          fastStream[quality] = cacheMedia(req, link || null, ".m3u8");
        }
      }

      const cachedDownload = cacheMedia(req, v.normal_dlink || null, ".mp4");

      return {
        fs_id: v.fs_id,
        name: v.name,
        file_path: v.file_path,
        size: v.size,
        size_formatted: v.size_formatted,
        type: v.type,
        is_dir: v.is_dir,
        duration: v.duration || null,
        quality: v.quality || null,
        normal_dlink: cachedDownload,
        download_link: cachedDownload,
        stream_url: cacheMedia(req, v.stream_url || null, ".m3u8"),
        fast_stream_url: fastStream,
        subtitle_url: cacheMedia(req, v.subtitle_url || null, ".vtt"),
        thumbnail: cacheMedia(req, v.thumbnail || null, ".webp"),
        folder: v.folder || "root"
      };
    });

    return res.json({
      status: "success",
      creator: CREATOR,
      total_files: data.total_files ?? videos.length,
      total_folders: data.total_folders ?? 0,
      videos
    });

  } catch (err) {
    if (err.code === "ECONNABORTED") {
      return res.status(408).json({
        status: "error",
        creator: CREATOR,
        message: "Request timeout"
      });
    }

    return res.status(500).json({
      status: "error",
      creator: CREATOR,
      message: "Internal Server Error",
      error: err.message
    });
  }
});





// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎥 YOUTUBE MP4 (search + link, like /api/song)
//   /api/ytmp4?q=name | ?url=link  [&quality=144..1080]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/ytmp4", async (req, res) => {
  noCache(res);

  try {
    const { q, url, quality } = req.query;
    const input = q || url;

    if (!input) {
      return res.status(400).json({
        success: false,
        creator: CREATOR,
        message: "Enter video name or YouTube URL"
      });
    }

    if (quality && !normalizeQuality(quality)) {
      return res.status(400).json({
        success: false,
        creator: CREATOR,
        message: "Invalid quality. Use 144/240/360/480/720/1080"
      });
    }

    let videoUrl;
    let searchMeta = null;

    if (input.includes("youtube.com") || input.includes("youtu.be")) {
      // Direct URL — skip search
      videoUrl = input;
    } else {
      // Plain query — search first, use top result
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
      result = await getVideoResult(videoUrl, quality || null);
    } catch (e) {
      console.error("[YTMP4] backend failed:", e?.message || e);
      return res.status(404).json({
        success: false,
        creator: CREATOR,
        message: "Video not found",
        ...(req.query.debug ? { debug: e?.message || String(e) } : {})
      });
    }

    const title = result.title || searchMeta?.title || "video";

    // "redirect" mode: /media/:file 302-redirects to the real link,
    // so the original source never shows up in the response.
    const proxy = cacheMedia(
      req,
      result.downloadUrl,
      ".mp4",
      10 * 60 * 1000,
      "redirect",
      title
    );
    const thumbnail = cacheMedia(
      req,
      result.thumbnail || searchMeta?.thumbnail || null,
      ".jpg",
      10 * 60 * 1000,
      "redirect"
    );

    return res.json({
      success: true,
      creator: CREATOR,
      query: input,
      result: {
        title,
        videoId: searchMeta?.videoId || result.videoId || null,
        duration: result.duration || searchMeta?.duration || null,
        quality: result.quality,
        thumbnail,
        format: "MP4",
        url: proxy,
        mp4: proxy,
        video: proxy,
        download: proxy
      }
    });

  } catch (err) {
    console.error("[YTMP4] route error:", err?.stack || err);
    return res.status(404).json({
      success: false,
      creator: CREATOR,
      message: "Video not found",
      ...(req.query.debug ? { debug: err?.message || String(err) } : {})
    });
  }
});

module.exports = router;
