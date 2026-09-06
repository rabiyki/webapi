const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { noCache } = require("../utils/http");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IN-MEMORY ONLY — no DB, no Redis.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const REQUEST_TTL_MS = 15000;
const PROCESSED_TTL_MS = 60000;

const pending = new Map();     // requestId -> { id, url, postId, reacts, expiresAt }
const processed = new Map();   // "botId:postId" -> timestamp

function extractPostId(url) {
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

setInterval(() => {
  const now = Date.now();
  for (const [id, item] of pending) {
    if (item.expiresAt <= now) pending.delete(id);
  }
}, 3000).unref();

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of processed) {
    if (now - ts > PROCESSED_TTL_MS) processed.delete(key);
  }
}, 30000).unref();

// GET /react?url=CHANNEL_POST_URL&react=😘,😍,💐,📁
router.get("/react", (req, res) => {
  noCache(res);

  const { url, react } = req.query;
  if (!url || !react) {
    return res.status(400).json({ status: false, message: "url & react are required" });
  }

  const postId = extractPostId(url);
  if (!postId) {
    return res.status(400).json({ status: false, message: "Invalid channel post URL" });
  }

  const reacts = react.split(",").map(r => r.trim()).filter(Boolean);
  if (!reacts.length) {
    return res.status(400).json({ status: false, message: "At least one emoji required in react" });
  }

  const id = crypto.randomBytes(6).toString("hex");
  const expiresAt = Date.now() + REQUEST_TTL_MS;

  pending.set(id, { id, url, postId, reacts, expiresAt });

  return res.json({
    status: true,
    message: "Queued",
    id,
    postId,
    expires_in_seconds: REQUEST_TTL_MS / 1000
  });
});

// GET /react/poll?botId=xxx
router.get("/react/poll", (req, res) => {
  noCache(res);

  const { botId } = req.query;
  if (!botId) {
    return res.status(400).json({ status: false, message: "botId required" });
  }

  const now = Date.now();
  const tasks = [];

  for (const [id, item] of pending) {
    if (item.expiresAt <= now) {
      pending.delete(id);
      continue;
    }
    const dedupKey = `${botId}:${item.postId}`;
    if (processed.has(dedupKey)) continue;

    tasks.push({ id: item.id, url: item.url, postId: item.postId, react: item.reacts });
  }

  return res.json({ status: true, tasks });
});

// GET /react/ack?botId=xxx&postId=yyy
router.get("/react/ack", (req, res) => {
  noCache(res);

  const { botId, postId } = req.query;
  if (!botId || !postId) {
    return res.status(400).json({ status: false, message: "botId & postId required" });
  }

  processed.set(`${botId}:${postId}`, Date.now());

  return res.json({ status: true });
});

module.exports = router;
