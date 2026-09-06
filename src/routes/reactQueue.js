const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { noCache } = require("../utils/http");

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
