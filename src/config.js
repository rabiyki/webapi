const CREATOR = "𓋜 -𝐑ᴀ፝֟፝֟ʙʙɪᴛ/>𝟑ن𓂃";

// Browser-like headers for calls to jerrycoder.oggyapi.workers.dev —
// some Cloudflare-protected workers block plain "axios/Mozilla" UAs
// or requests missing Referer/Origin, so we mimic a real browser.
const JERRY_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://jerrycoder.oggyapi.workers.dev/",
  "Origin": "https://jerrycoder.oggyapi.workers.dev"
};

const PORT = process.env.PORT || 4000;

const MONGODB_URI = process.env.MONGODB_URI || "YOUR_MONGODB_URI_HERE";

// Telegram user-account (GramJS) — used by /api/ffgrp and /api/rabbitd.
// Env vars override these defaults.
const TG_API_ID = parseInt(process.env.TG_API_ID || "YOUR_API_ID", 10);
const TG_API_HASH = process.env.TG_API_HASH || "YOUR_API_HASH";
const TG_SESSION = process.env.TG_SESSION || "YOUR_SESSION_STRING";
const TG_EMOTE_BOT = process.env.TG_EMOTE_BOT || "FFEmoteByShadow_Bot";
const TG_INFO_BOT = process.env.TG_INFO_BOT || "@Randominsight_bot"; // /api/rabbitd

module.exports = { CREATOR, JERRY_HEADERS, PORT, MONGODB_URI, TG_API_ID, TG_API_HASH, TG_SESSION, TG_EMOTE_BOT, TG_INFO_BOT };
