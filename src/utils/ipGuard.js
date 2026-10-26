const RequestLog = require("../models/RequestLog");
const BannedIP = require("../models/BannedIP");
const { SPIKE_PER_MIN } = require("../config");

// In-memory cache so we never hit the DB on every request
const banned = new Set();
const minuteHits = new Map(); // ip -> request count in the current minute
const alerted = new Set();    // IPs already alerted (cleared every hour)
let onSpike = null;           // set by the admin bot: spike alert callback
let onRequest = null;         // set by the admin bot: live per-request callback

function cleanIp(ip) {
  return String(ip || "").replace(/^::ffff:/, "");
}

async function loadBans() {
  const list = await BannedIP.find({}).lean();
  banned.clear();
  list.forEach((b) => banned.add(b.ip));
  console.log("Banned IPs loaded:", banned.size);
}

async function banIp(ip, reason = "") {
  ip = cleanIp(ip);
  banned.add(ip);
  await BannedIP.updateOne({ ip }, { $set: { ip, reason } }, { upsert: true });
}

async function unbanIp(ip) {
  ip = cleanIp(ip);
  banned.delete(ip);
  const r = await BannedIP.deleteOne({ ip });
  return r.deletedCount > 0;
}

// Mount this first: banned IPs get a 403 immediately
function banMiddleware(req, res, next) {
  const ip = cleanIp(req.ip);
  if (banned.has(ip)) {
    return res.status(403).json({ success: false, error: "Your IP is banned" });
  }
  next();
}

// Logs every request once the response is finished, and checks for spikes
function logMiddleware(req, res, next) {
  const start = Date.now();
  const ip = cleanIp(req.ip);

  // Keep the first part of the response body (shown in the Telegram live feed)
  let preview = "";
  const origSend = res.send;
  res.send = function (body) {
    try {
      if (!preview && typeof body === "string") preview = body.slice(0, 200);
      else if (!preview && Buffer.isBuffer(body) && /json|plain/.test(String(res.get("Content-Type")))) preview = body.toString("utf8", 0, 200);
    } catch (_) {}
    return origSend.call(this, body);
  };

  res.on("finish", () => {
    RequestLog.create({
      ip,
      method: req.method,
      path: (req.originalUrl || req.url).split("?")[0].slice(0, 200),
      status: res.statusCode,
      ms: Date.now() - start
    }).catch(() => {});

    if (onRequest) {
      try {
        onRequest({
          ip, method: req.method, url: req.originalUrl || req.url,
          path: (req.originalUrl || req.url).split("?")[0],
          status: res.statusCode, ms: Date.now() - start, preview,
          type: String(res.get("Content-Type") || ""), len: res.get("Content-Length")
        });
      } catch (_) {}
    }

    const n = (minuteHits.get(ip) || 0) + 1;
    minuteHits.set(ip, n);
    if (n >= SPIKE_PER_MIN && !alerted.has(ip) && onSpike) {
      alerted.add(ip);
      onSpike(ip, n);
    }
  });

  next();
}

setInterval(() => minuteHits.clear(), 60 * 1000).unref();
setInterval(() => alerted.clear(), 60 * 60 * 1000).unref();

module.exports = {
  banMiddleware, logMiddleware, loadBans, banIp, unbanIp, cleanIp,
  getBanned: () => [...banned],
  setSpikeHandler: (fn) => { onSpike = fn; },
  setRequestHandler: (fn) => { onRequest = fn; }
};
