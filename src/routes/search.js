const express = require("express");
const router = express.Router();
const cheerio = require("cheerio");
const { CREATOR } = require("../config");
const { noCache, ax } = require("../utils/http");
const { cacheMedia } = require("../utils/cache");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ▶️ YOUTUBE SEARCH  (direct youtubei scrape — no 3rd-party API)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const YT_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"; // public web-client key used by youtube.com itself

async function youtubeScrape(query, limit = 10) {
  const { data } = await ax.post(
    `https://www.youtube.com/youtubei/v1/search?key=${YT_API_KEY}`,
    {
      query,
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
          hl: "en",
          gl: "US"
        }
      }
    },
    {
      timeout: 15000,
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    }
  );

  const sections =
    data?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer?.contents || [];

  const items = [];
  for (const section of sections) {
    const contents = section?.itemSectionRenderer?.contents || [];
    for (const c of contents) {
      if (c.videoRenderer) items.push(c.videoRenderer);
    }
  }

  const videos = items.slice(0, limit).map((v) => {
    const thumbs = v.thumbnail?.thumbnails || [];
    const bestThumb = thumbs[thumbs.length - 1]?.url || null;

    const channelRun = v.ownerText?.runs?.[0];
    const channelId =
      channelRun?.navigationEndpoint?.browseEndpoint?.browseId || null;

    return {
      title: v.title?.runs?.[0]?.text || null,
      url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : null,
      videoId: v.videoId || null,
      duration: v.lengthText?.simpleText || null,
      views:
        v.viewCountText?.simpleText ||
        v.shortViewCountText?.simpleText ||
        null,
      uploaded: v.publishedTimeText?.simpleText || null,
      thumbnail: bestThumb,
      author: {
        name: channelRun?.text || null,
        url: channelId ? `https://www.youtube.com/channel/${channelId}` : null
      }
    };
  });

  return videos;
}

router.get("/search/youtube", async (req, res) => {
  noCache(res);
  try {
    const { query, q, limit } = req.query;
    const searchQuery = query || q;
    const searchLimit = parseInt(limit) || 10;

    if (!searchQuery) return res.status(400).json({
      status: false, creator: CREATOR, message: "Enter query",
      example: "/search/youtube?q=alan walker&limit=5"
    });

    let videos = await youtubeScrape(searchQuery, searchLimit);

    if (!videos.length) {
      return res.status(404).json({
        status: false,
        creator: CREATOR,
        message: "No results found"
      });
    }

    videos = videos.map((v, i) => ({
      id: i + 1,
      ...v,
      thumbnail: v.thumbnail ? cacheMedia(req, v.thumbnail, ".jpg") : null
    }));

    res.json({
      status: true,
      creator: CREATOR,
      query: searchQuery,
      total: videos.length,
      limit: searchLimit,
      result: videos
    });
  } catch (e) {
    res.status(500).json({ status: false, creator: CREATOR, message: "Search failed", error: e.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖼️ IMAGE SEARCH — Google (primary) + DuckDuckGo (fallback)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Google Images embeds real image URLs inside inline JSON as
// ["https://...jpg", width, height] — pull those out directly
// instead of relying on <img src> (which is mostly base64 placeholders).
async function googleScrape(query, limit = 10) {
  const { data } = await ax.get(
    `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`,
    {
      timeout: 8000,
      headers: { "user-agent": UA }
    }
  );

  const results = [];
  const regex = /\["(https:\/\/[^"]+?)",\d+,\d+\]/g;
  let match;
  while ((match = regex.exec(data)) !== null) {
    const url = match[1];
    if (
      !url.includes("gstatic.com") &&
      !url.includes("google.com") &&
      !results.includes(url)
    ) {
      results.push(url);
    }
  }

  // fallback: plain <img> tags with real http(s) src, in case the
  // JSON blob pattern above didn't match (Google changes markup often)
  if (!results.length) {
    const $ = cheerio.load(data);
    $("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src && src.startsWith("http") && !results.includes(src)) {
        results.push(src);
      }
    });
  }

  return results.slice(0, limit);
}

// DuckDuckGo image search: needs a "vqd" token pulled from the
// normal search page first, then hits the i.js JSON endpoint.
async function duckduckgoScrape(query, limit = 10) {
  const { data: html } = await ax.get("https://duckduckgo.com/", {
    params: { q: query, iax: "images", ia: "images" },
    timeout: 8000,
    headers: { "user-agent": UA }
  });

  const vqdMatch =
    html.match(/vqd=['"]?([\d-]+)['"&]/) || html.match(/vqd=([\d-]+)/);

  if (!vqdMatch) throw new Error("vqd token not found");
  const vqd = vqdMatch[1];

  const { data } = await ax.get("https://duckduckgo.com/i.js", {
    params: {
      l: "us-en",
      o: "json",
      q: query,
      vqd,
      f: ",,,",
      p: "1"
    },
    timeout: 8000,
    headers: {
      "user-agent": UA,
      referer: "https://duckduckgo.com/"
    }
  });

  const items = data?.results || [];
  return items.map((r) => r.image).filter((u) => u && u.startsWith("http")).slice(0, limit);
}

router.get("/api/image", async (req, res) => {
  noCache(res);
  try {
    const { q, query, limit } = req.query;
    const searchQ = q || query;
    if (!searchQ) return res.status(400).json({ status: false, creator: CREATOR, message: "Query required" });

    const searchLimit = Number(limit) || 10;
    let result = [];
    let source = "google";

    try {
      result = await googleScrape(searchQ, searchLimit);
      if (!result.length) throw new Error("No results");
    } catch {
      try {
        source = "duckduckgo";
        result = await duckduckgoScrape(searchQ, searchLimit);
      } catch (e2) {
        return res.status(500).json({ status: false, creator: CREATOR, error: e2.message });
      }
    }

    res.json({
      status: true,
      creator: CREATOR,
      query: searchQ,
      source,
      total: result.length,
      result
    });
  } catch (e) {
    res.status(500).json({ status: false, creator: CREATOR, error: e.message });
  }
});

module.exports = router;
