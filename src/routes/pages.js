const express = require("express");
const path = require("path");
const router = express.Router();
const { noCache } = require("../utils/http");

router.get("/", (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, "..", "..", "index.html"));
});

router.get("/ads.txt", (req, res) => {
  res.type("text/plain");
  res.send(
    "google.com, pub-1090659711705372, DIRECT, f08c47fec0942fa0"
  );
});

router.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`
User-agent: *
Allow: /

Sitemap: https://rabbitapi.zone.id/sitemap.xml
`);
});

router.get("/sitemap.xml", (req, res) => {
  res.type("application/xml");

  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url>
<loc>https://rabbitapi.zone.id/</loc>
<priority>1.0</priority>
</url>
</urlset>`);
});

router.get("/terabox", (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, "..", "..", "public", "terabox.html"));
});
router.get("/shorten", (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, "..", "..", "public", "shorten.html"));
});

router.get("/upload", (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, "..", "..", "public", "upload.html"));
});

router.get("/category/downloader", (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, "..", "..", "public", "category", "downloader.html"));
});

router.get("/fullpp", (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, "..", "..", "public", "fullpp.html"));
});

router.get("/removebg", (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, "..", "..", "public", "removebg.html"));
});

router.get("/api.html", (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, "..", "..", "public", "api.html"));
});

module.exports = router;
