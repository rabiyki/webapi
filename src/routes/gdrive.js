const express = require("express");
const router = express.Router();
const { CREATOR } = require("../config");
const { noCache, ax } = require("../utils/http");
const { cacheMedia } = require("../utils/cache");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 GOOGLE DRIVE: /api/gdrive
//    GET /api/gdrive?url=<drive share link>
//    Extracts the file ID, confirms it's downloadable (HEAD request,
//    also gets us the filename/size for free), then hands back a
//    cloaked /media/:file link — never Google's raw uc?export=download
//    url, and never the file ID either.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function extractFileId(url) {
  const match = url.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

function formatSize(bytes) {
  if (!bytes) return null;
  return `${(parseInt(bytes, 10) / 1024 / 1024).toFixed(2)} MB`;
}

router.get("/api/gdrive", async (req, res) => {
  noCache(res);
  try {
    const { url } = req.query;
    if (!url || !url.includes("drive.google.com")) {
      return res.status(400).json({
        status: false,
        creator: CREATOR,
        message: "A valid drive.google.com URL is required"
      });
    }

    const fileId = extractFileId(url.trim());
    if (!fileId) {
      return res.status(400).json({ status: false, creator: CREATOR, message: "Could not extract file ID" });
    }

    // export=download&confirm=t skips the "file too large to scan" HTML
    // warning page Google shows for bigger files, going straight to bytes.
    const directUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;

    let headers = {};
    try {
      const head = await ax.head(directUrl, { timeout: 15000, maxRedirects: 5, validateStatus: () => true });
      headers = head.headers || {};
    } catch (_) {
      // Some files reject HEAD but still GET fine — cacheMedia below
      // will surface a real error to the client if it truly is dead.
    }

    const contentType = headers["content-type"] || "";
    if (contentType.includes("text/html")) {
      return res.status(404).json({
        status: false,
        creator: CREATOR,
        message: "File not accessible — check that link sharing is set to \"Anyone with the link\""
      });
    }

    const fileName =
      (headers["content-disposition"] || "").match(/filename="?([^"]+)"?/)?.[1] || null;
    const size = formatSize(headers["content-length"]);
    const ext = fileName && fileName.includes(".") ? "." + fileName.split(".").pop() : "";

    const proxy = cacheMedia(req, directUrl, ext || ".bin", 30 * 60 * 1000, "stream", fileName);

    res.json({
      status: true,
      creator: CREATOR,
      result: {
        name: fileName,
        size,
        url: proxy
      }
    });
  } catch (err) {
    res.status(500).json({ status: false, creator: CREATOR, message: err.message || "Failed to process Google Drive link" });
  }
});

module.exports = router;
