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

const MONGODB_URI = "mongodb+srv://mrrabbit:sreejan900@cluster0.we4bxzg.mongodb.net/?appName=Cluster0";

// Telegram user-account (GramJS) — used by /api/ffgrp to talk to the emote bot.
// Env vars override these defaults.
const TG_API_ID = parseInt(process.env.TG_API_ID || "34777125", 10);
const TG_API_HASH = process.env.TG_API_HASH || "04bc8d11d6cb656379122be02439cc5e";
const TG_SESSION = process.env.TG_SESSION || "1BQANOTEuMTA4LjU2LjEwNwG7D0zrczyM27A78O/51N8naF2YCqQKDO3K9Ed3aM4UcF2Nj00cKSbP0ktfu3ZvTBJc6g8j/lyjiauZonbOlLq4XlciKAe978efM5oO3dWiRhmJlmBZZuYvxu3+p7Jem1Sek4zoFP8LCHr/g0mY4u+8okXR/qEzarBMzGANWkZz92PqZgLGEWgOCRmUm8+wI8sDqB/6gjfp7wnRWy6QYH1AudexzUdTdWu+kp01HQqRKK/R9/IegRQ1u/ygQ0CYBwMiPK9h9m7/POSK5x2/u5cUKIDDplv3vn8jPM+mKlCFiC4PMwalePxYPwY6iL2E1YQy/+Ftc9QeG1AEMw/bZmHcDw==";
const TG_EMOTE_BOT = process.env.TG_EMOTE_BOT || "FFEmoteByShadow_Bot";

module.exports = { CREATOR, JERRY_HEADERS, PORT, MONGODB_URI, TG_API_ID, TG_API_HASH, TG_SESSION, TG_EMOTE_BOT };
