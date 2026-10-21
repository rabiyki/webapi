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
const TG_API_ID = parseInt(process.env.TG_API_ID || "34777125", 10);
const TG_API_HASH = process.env.TG_API_HASH || "04bc8d11d6cb656379122be02439cc5e";
const TG_SESSION = process.env.TG_SESSION || "1BQANOTEuMTA4LjU2LjE0MAG7S0mq0IDt1yQKTIwOGmsMRsLaH7AZ/XppveeaQ0sllYk1FH1veWta7jQLk2Ra/8zw1iXB1nC1f+BRG2J9C4liezklibrsujXLZndLGpIcOzic5dAZbGgHuRW3dTobn8qZB/DrlQFbetBiB3uPKr8HUFJq/uVDooUmRoQ4P61MIppanPu6UVb+8HmOpnfYEyXF3cKKn7l1oAoZXOHpCxVV8EAf+bS5l7/wXnQMcf7a8SquOdpMvkvpSi5Dgk88miRY2DW3QK3JW+CnYXXzczn/RZbY6uxoS0ZAeFCFKJqn3Qnox1YiTrzxI+y1TXwOO17txNdwLNAveBZaV80GH+1p6A==";
const TG_EMOTE_BOT = process.env.TG_EMOTE_BOT || "FFEmoteByShadow_Bot";
const TG_INFO_BOT = process.env.TG_INFO_BOT || "@Randominsight_bot"; // /api/rabbitd

module.exports = { CREATOR, JERRY_HEADERS, PORT, MONGODB_URI, TG_API_ID, TG_API_HASH, TG_SESSION, TG_EMOTE_BOT, TG_INFO_BOT };
