const express = require("express");
const router = express.Router();
const { CREATOR } = require("../config");
const { noCache, ax } = require("../utils/http");
const { cacheMedia } = require("../utils/cache");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📸 INSTAGRAM — /api/insta
//    Response shape is UNCHANGED from before: { status, creator, thumbnail, url }
//    Internals upgraded though:
//    - Primary (fgsi.dpdns.org) + backup (rabbitapi) queried in parallel.
//      Primary wins if it found media; backup fills in only if primary
//      came back empty. For a carousel post, only the FIRST item is
//      returned here (same "single media" shape as before) — carousel
//      support isn't exposed on this route, just the reliability upgrade.
//    - The returned url/thumbnail are cloaked via cacheMedia() — the
//      real upstream host is never exposed. Where a backup single-media
//      url is also available, it's registered as that link's fallback,
//      so /media/:file itself retries the backup automatically if the
//      primary source goes dead — client never sees either real url,
//      whichever one actually serves the bytes.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const INSTA_PRIMARY_API = "https://fgsi.dpdns.org/api/downloader/instagram";
const INSTA_PRIMARY_KEY = "fgsiapi-f2eb0ec-6d";
const INSTA_BACKUP_API = "https://rabbitapi.zone.id/api/dwnall";

function instaIsVideo(item) {
  const t = (item?.type || item?.ext || "").toLowerCase();
  return t === "mp4" || t === "mov" || t === "video";
}

// Returns { url, isVideo, thumb } for one media item, or null
function instaRawMedia(item) {
  const file = item?.url?.[0];
  if (!file?.url) return null;
  return { url: file.url, isVideo: instaIsVideo(file), thumb: item.thumb || null };
}

async function instaFetchPrimary(url) {
  const { data } = await ax.get(INSTA_PRIMARY_API, {
    params: { apikey: INSTA_PRIMARY_KEY, url },
    timeout: 20000
  });
  if (!data?.status) return null;

  const items = Array.isArray(data.data) ? data.data : [data.data];
  const mediaList = items.map(instaRawMedia).filter(Boolean);
  if (!mediaList.length) return null;

  return { mediaList };
}

async function instaFetchBackup(url) {
  const { data } = await ax.get(INSTA_BACKUP_API, { params: { url }, timeout: 20000 });
  if (!data?.success || !data?.result) return null;

  const result = data.result;
  let media = null;
  if (result.hd || result.ss) media = { url: result.hd || result.ss, isVideo: true, thumb: result.thumbnail || null };
  else if (result.thumbnail) media = { url: result.thumbnail, isVideo: false, thumb: null };
  if (!media) return null;

  return { mediaList: [media] };
}

router.get("/api/insta", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const [primaryRes, backupRes] = await Promise.allSettled([
      instaFetchPrimary(url),
      instaFetchBackup(url)
    ]);

    const primary = primaryRes.status === "fulfilled" ? primaryRes.value : null;
    const backup = backupRes.status === "fulfilled" ? backupRes.value : null;

    const source = primary?.mediaList?.length ? primary : backup;
    if (!source) return res.json({ status: false, creator: CREATOR });

    const first = source.mediaList[0];

    // Only meaningful when there's exactly one media item on both
    // sides (a backup can't map onto a specific carousel slide).
    const backupForFallback =
      source === primary && primary.mediaList.length === 1 && backup?.mediaList?.[0]
        ? backup.mediaList[0].url
        : null;

    const proxy = cacheMedia(req, first.url, first.isVideo ? ".mp4" : ".jpg", 10 * 60 * 1000, "stream", null, backupForFallback);
    const thumbnail = first.thumb ? cacheMedia(req, first.thumb, ".jpg") : null;

    res.json({
      status: true,
      creator: CREATOR,
      thumbnail,
      url: proxy
    });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📘 FACEBOOK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get("/api/fb", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR, message: "Facebook URL required" });

    const { data } = await ax.get(
      `https://api-aswin-sparky.koyeb.app/api/downloader/fbdl?url=${encodeURIComponent(url)}`,
      { timeout: 120000 }
    );

    const hd = cacheMedia(req, data?.data?.high || null, ".mp4");
    const sd = cacheMedia(req, data?.data?.low || null, ".mp4");

    res.json({
      status: true,
      creator: CREATOR,
      title: data?.data?.title || null,
      thumbnail: data?.data?.thumbnail || null,
      hd,
      sd
    });
  } catch (err) {
    res.status(500).json({ status: false, creator: CREATOR, message: err.message });
  }
});

router.get("/api/fb2", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://apiskeith.top/download/fbdown?url=${encodeURIComponent(url)}`
    );

    const proxy = cacheMedia(req, data.result, ".mp4");

    res.json({ status: true, creator: CREATOR, result: proxy });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

router.get("/api/fb3", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://rabbitapi.nett.to/api/fb?url=${encodeURIComponent(url)}`
    );

    const sd = cacheMedia(req, data.sd, ".mp4");
    const hd = cacheMedia(req, data.hd, ".mp4");

    res.json({ status: true, creator: CREATOR, sd, hd });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

router.get("/api/facebook", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: CREATOR });

    const { data } = await ax.get(
      `https://apis.davidcyril.name.ng/facebook2?url=${encodeURIComponent(url)}`
    );

    const proxy = cacheMedia(req, data.video, ".mp4");

    res.json({ status: true, creator: CREATOR, result: proxy });
  } catch {
    res.json({ status: false, creator: CREATOR });
  }
});

module.exports = router;
