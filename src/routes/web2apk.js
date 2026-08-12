const express = require("express");
const router = express.Router();
const multer = require("multer");
const FormData = require("form-data");
const { CREATOR } = require("../config");
const { noCache, ax } = require("../utils/http");
const { cacheMedia } = require("../utils/cache");

const upload = multer({ storage: multer.memoryStorage() });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📱 WEB2APK: /api/web2apk
//    POST multipart: url, appName, packageName? (optional),
//                     icon (file field) OR iconUrl (field, fetched server-side)
//    Wraps webappcreator.amethystlab.org's build-apk endpoint. The
//    resulting APK download link is cloaked via cacheMedia() same as
//    every other route here — client gets a /media/:file link, never
//    the amethystlab.org url directly.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BUILD_API = "https://webappcreator.amethystlab.org/api/build-apk";
const BASE_URL = "https://webappcreator.amethystlab.org";

function isValidUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function buildPackageName(appName) {
  const cleaned = (appName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `com.${cleaned || "app"}.web2apk`;
}

router.post("/api/web2apk", upload.single("icon"), async (req, res) => {
  noCache(res);
  try {
    const url = req.query.url || req.body?.url;
    const appName = req.query.appName || req.body?.appName;
    const packageName = req.query.packageName || req.body?.packageName;
    const iconUrl = req.query.iconUrl || req.body?.iconUrl;

    if (!isValidUrl(url)) {
      return res.status(400).json({ status: false, creator: CREATOR, message: "A valid website url is required" });
    }
    if (!appName) {
      return res.status(400).json({ status: false, creator: CREATOR, message: "appName is required" });
    }

    let iconBuffer = req.file?.buffer || null;
    let iconFilename = req.file?.originalname || "icon.png";

    // Allow passing an image url instead of a multipart upload
    if (!iconBuffer && iconUrl) {
      const iconRes = await ax.get(iconUrl, { responseType: "arraybuffer", timeout: 20000 });
      iconBuffer = Buffer.from(iconRes.data);
    }

    if (!iconBuffer) {
      return res.status(400).json({ status: false, creator: CREATOR, message: "App icon required — send as multipart field \"icon\" or as \"iconUrl\"" });
    }

    const finalPackageName = packageName || buildPackageName(appName);

    const form = new FormData();
    form.append("websiteUrl", url);
    form.append("appName", appName);
    form.append("icon", iconBuffer, iconFilename);
    form.append("packageName", finalPackageName);
    form.append("versionName", "1.0.0");
    form.append("versionCode", "1");

    const { data } = await ax.post(BUILD_API, form, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Origin: BASE_URL,
        Referer: BASE_URL + "/",
        ...form.getHeaders()
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000
    });

    if (!data?.success) {
      return res.status(502).json({ status: false, creator: CREATOR, message: data?.message || "Failed to build APK" });
    }

    const rawDownloadUrl = BASE_URL + data.downloadUrl;
    const proxy = cacheMedia(req, rawDownloadUrl, ".apk", 60 * 60 * 1000, "stream", `${appName}.apk`);

    res.json({
      status: true,
      creator: CREATOR,
      result: {
        appName,
        packageName: finalPackageName,
        url: proxy
      }
    });
  } catch (err) {
    res.status(500).json({ status: false, creator: CREATOR, message: err.message || "Failed to build APK" });
  }
});

module.exports = router;
