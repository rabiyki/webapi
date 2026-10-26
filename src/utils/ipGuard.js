const RequestLog = require("../models/RequestLog");
const BannedIP = require("../models/BannedIP");
const { SPIKE_PER_MIN } = require("../config");

// memory cache — প্রতি request-এ DB hit হবে না
const banned = new Set();
const minuteHits = new Map(); // ip -> count (প্রতি ১ মিনিটে reset)
const alerted = new Set();    // একই IP-র alert বারবার না যেতে (প্রতি ঘণ্টায় reset)
let onSpike = null;           // bot এখানে alert function বসাবে

function cleanIp(ip) {
  return String(ip || "").replace(/^::ffff:/, "");
}

async function loadBans() {
  const list = await BannedIP.find({}).lean();
  banned.clear();
  list.forEach((b) => banned.add(b.ip));
  console.log("🚫 Banned IPs loaded:", banned.size);
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

// সবার আগে বসবে — banned IP হলে সাথে সাথে 403
function banMiddleware(req, res, next) {
  const ip = cleanIp(req.ip);
  if (banned.has(ip)) {
    return res.status(403).json({ success: false, error: "Your IP is banned" });
  }
  next();
}

// response শেষ হলে log সেভ + spike চেক
function logMiddleware(req, res, next) {
  const start = Date.now();
  const ip = cleanIp(req.ip);

  res.on("finish", () => {
    RequestLog.create({
      ip,
      method: req.method,
      path: (req.originalUrl || req.url).split("?")[0].slice(0, 200),
      status: res.statusCode,
      ms: Date.now() - start
    }).catch(() => {});

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
  setSpikeHandler: (fn) => { onSpike = fn; }
};
