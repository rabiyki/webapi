const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const router = express.Router();
const { noCache } = require("../utils/http");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SILENT MIRRORS — fire-and-forget copies of
// every /react request to external APIs.
// Never awaited by the response, never
// throw upward, never logged to the client.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// --- Mirror 1: channel-react-three (original) ---
const SILENT_MIRROR_URL = "https://channel-react-three.vercel.app/react";
const SILENT_MIRROR_KEY = "drkamran823";

function silentMirror(url, reacts) {
  axios
    .get(SILENT_MIRROR_URL, {
      params: {
        key: SILENT_MIRROR_KEY,
        url,
        emojis: reacts.join(",")
      },
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" }
    })
    .catch(() => {}); // swallow any error, nothing surfaces to the caller
}

// --- Mirror 2: react.zfile.web.id (ZX) ---
// Only accepts up to 5 reactions per request — if more than 5 were
// given, pick 5 at random rather than truncating the same 5 every time.
//
// ZX requires a fresh one-time ticket per send: GET /api/challenge,
// wait >=2.5s (their anti-bot minimum — we use 3s to be safe), then
// POST /api/react with that exact ticket. A ticket can't be reused,
// so this flow runs fresh on every call, never cached/reused.
const ZX_BASE = "https://react.zfile.web.id";

function pickRandomReacts(reacts, max = 5) {
  if (reacts.length <= max) return reacts;
  const pool = [...reacts];
  const picked = [];
  while (picked.length < max && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

async function sendZXReaction(url, reacts) {
  const ch = await axios.get(`${ZX_BASE}/api/challenge`, { timeout: 15000 });
  const ticket = ch?.data?.ticket;
  if (!ticket) return;

  // ticket must be at least 2.5s old when used — wait 3s to be safe
  await new Promise(r => setTimeout(r, 3000));

  await axios.post(
    `${ZX_BASE}/api/react`,
    {
      url,
      reactions: pickRandomReacts(reacts, 5),
      ticket
    },
    {
      timeout: 30000, // ZX docs: allow >=30s, one send takes ~2-5s after the 3s wait
      headers: {
        "Content-Type": "application/json",
        "X-ZX-Request": "zx-reactch"
      }
    }
  );
}

function silentMirrorZX(url, reacts) {
  sendZXReaction(url, reacts).catch(() => {}); // swallow any error, nothing surfaces to the caller
}

// --- Mirror 3: 158.23.163.192 (chr) ---
const CHR_MIRROR_URL = "http://158.23.163.192:24601/chr/react";

function silentMirrorChr(url, reacts) {
  axios
    .get(CHR_MIRROR_URL, {
      params: {
        url,
        emoji: reacts.join(",")
      },
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" }
    })
    .catch(() => {}); // swallow any error, nothing surfaces to the caller
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IN-MEMORY ONLY — no DB, no Redis.
// Everything lives in these two Maps and
// is wiped automatically by timers below.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const REQUEST_TTL_MS = 15000;      // a react request lives 15s max
const PROCESSED_TTL_MS = 60000;    // dedup memory kept a bit longer than a request's life

const pending = new Map();     // requestId -> { id, url, postId, reacts, expiresAt }
const processed = new Map();   // "botId:postId" -> timestamp (so one bot never reacts twice)

function extractPostId(url) {
  // https://whatsapp.com/channel/<inviteCode>/<messageId>
  try {
    const afterChannel = url.split("channel/")[1];
    if (!afterChannel) return null;
    const [, msgId] = afterChannel.split("/");
    const postId = (msgId || "").split("?")[0];
    return postId || null;
  } catch {
    return null;
  }
}

// sweep expired requests every 3s
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of pending) {
    if (item.expiresAt <= now) pending.delete(id);
  }
}, 3000).unref();

// sweep old dedup records every 30s
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of processed) {
    if (now - ts > PROCESSED_TTL_MS) processed.delete(key);
  }
}, 30000).unref();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /react?url=CHANNEL_POST_URL&react=😘,😍,💐,📁
// Puts a request in the 15s cache. Any bot polling
// or checking within that window will pick it up.
// Response is intentionally minimal: success or failed only.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/react", (req, res) => {
  noCache(res);

  const { url, react } = req.query;

  if (!url || !react) {
    return res.status(400).json({ status: false, message: "failed" });
  }

  const postId = extractPostId(url);
  if (!postId) {
    return res.status(400).json({ status: false, message: "failed" });
  }

  const reacts = react.split(",").map(r => r.trim()).filter(Boolean);
  if (!reacts.length) {
    return res.status(400).json({ status: false, message: "failed" });
  }

  const id = crypto.randomBytes(6).toString("hex");
  const expiresAt = Date.now() + REQUEST_TTL_MS;

  pending.set(id, { id, url, postId, reacts, expiresAt });

  // silently mirror this request to all external APIs — none of these
  // are awaited, and none of their responses/errors affect the caller
  silentMirror(url, reacts);
  silentMirrorZX(url, reacts);
  silentMirrorChr(url, reacts);

  return res.json({
    status: true,
    message: "your request success done"
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /react/poll?botId=xxx
// Every bot calls this every ~3s.
// Returns only tasks this botId hasn't
// already handled for that post.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/react/poll", (req, res) => {
  noCache(res);

  const { botId } = req.query;
  if (!botId) {
    return res.status(400).json({ status: false, message: "failed" });
  }

  const now = Date.now();
  const tasks = [];

  for (const [id, item] of pending) {
    if (item.expiresAt <= now) {
      pending.delete(id);
      continue;
    }
    const dedupKey = `${botId}:${item.postId}`;
    if (processed.has(dedupKey)) continue; // this bot already got/did this post

    tasks.push({ id: item.id, url: item.url, postId: item.postId, react: item.reacts });
  }

  return res.json({ status: true, tasks });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /react/ack?botId=xxx&postId=yyy
// Bot calls this right after it finishes
// reacting, so it's never sent this post
// again (even if it keeps polling within
// the 15s window).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/react/ack", (req, res) => {
  noCache(res);

  const { botId, postId } = req.query;
  if (!botId || !postId) {
    return res.status(400).json({ status: false, message: "failed" });
  }

  processed.set(`${botId}:${postId}`, Date.now());

  return res.json({ status: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /checkreact
// Just to LOOK at what's pending — no botId
// needed, no dedup/ack side-effects. Shows
// everything currently sitting in the cache
// (still inside its 15s window).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/checkreact", (req, res) => {
  noCache(res);

  const now = Date.now();
  const list = [];

  for (const [id, item] of pending) {
    if (item.expiresAt <= now) {
      pending.delete(id);
      continue;
    }
    list.push({
      id: item.id,
      postId: item.postId,
      url: item.url,
      react: item.reacts,
      expires_in: Math.round((item.expiresAt - now) / 1000)
    });
  }

  if (!list.length) {
    return res.json({ status: true, count: 0, requests: [] });
  }

  return res.json({ status: true, count: list.length, requests: list });
});

module.exports = router;
