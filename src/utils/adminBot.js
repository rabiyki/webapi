const axios = require("axios");
const RequestLog = require("../models/RequestLog");
const cfg = require("../config");
const { ADMIN_BOT_TOKEN, ADMIN_CHAT_ID, TZ_OFFSET_HOURS } = cfg;
const { banIp, unbanIp, getBanned, setSpikeHandler, setRequestHandler } = require("./ipGuard");

const API = `https://api.telegram.org/bot${ADMIN_BOT_TOKEN}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SMALL-CAPS FONT
//   sc("Hello world")    -> "Hᴇʟʟᴏ ᴡᴏʀʟᴅ"  (first letter kept, rest small caps)
//   scAll("hello world") -> "ʜᴇʟʟᴏ ᴡᴏʀʟᴅ"  (every letter small caps)
// Only used for labels. IPs, paths and commands stay plain.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SMALL = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ғ", g: "ɢ", h: "ʜ", i: "ɪ", j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ",
  n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ", s: "s", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ"
};
const scAll = (str) => Array.from(String(str)).map((ch) => SMALL[ch.toLowerCase()] || ch).join("");
const sc = (str) => {
  const [first, ...rest] = Array.from(String(str));
  return (first || "") + scAll(rest.join(""));
};

async function send(text, extra = {}) {
  try {
    await axios.post(`${API}/sendMessage`, {
      chat_id: ADMIN_CHAT_ID, text: text.slice(0, 4000), parse_mode: "HTML",
      disable_web_page_preview: true, ...extra
    });
  } catch (e) { console.error("Telegram send error:", e.message); }
}

// Start of "today" in your timezone
function dayStart() {
  const ms = TZ_OFFSET_HOURS * 3600 * 1000;
  const local = new Date(Date.now() + ms);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - ms);
}

async function statsText() {
  const since = dayStart();
  const [tot] = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: null, total: { $sum: 1 }, errors: { $sum: { $cond: [{ $gte: ["$status", 400] }, 1, 0] } }, ips: { $addToSet: "$ip" }, avgMs: { $avg: "$ms" } } }
  ]);
  if (!tot) return `📊 ${sc("No requests yet today.")}`;
  return `📊 <b>${sc("Today's stats")}</b>\n\n` +
    `${sc("Total requests")}: <b>${tot.total}</b>\n` +
    `${sc("Errors (4xx/5xx)")}: <b>${tot.errors}</b>\n` +
    `${sc("Unique IPs")}: <b>${tot.ips.length}</b>\n` +
    `${sc("Avg response")}: <b>${Math.round(tot.avgMs)}ms</b>`;
}

async function topText(field, title, limit = 10) {
  const rows = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: dayStart() } } },
    { $group: { _id: "$" + field, c: { $sum: 1 } } },
    { $sort: { c: -1 } }, { $limit: limit }
  ]);
  if (!rows.length) return sc("No data yet.");
  return `${title}\n\n` + rows.map((r, i) => `${i + 1}. <code>${esc(r._id)}</code> — ${r.c}`).join("\n");
}

async function ipText(ip) {
  const rows = await RequestLog.aggregate([
    { $match: { ip, createdAt: { $gte: dayStart() } } },
    { $group: { _id: { p: "$path", s: "$status" }, c: { $sum: 1 } } },
    { $sort: { c: -1 } }, { $limit: 15 }
  ]);
  const total = rows.reduce((a, r) => a + r.c, 0);
  if (!rows.length) return `<code>${esc(ip)}</code> ${scAll("made no requests today.")}`;
  return `🔎 <b>${esc(ip)}</b> — ${scAll("today:")} ${total} ${scAll("requests")}\n\n` +
    rows.map((r) => `<code>${esc(r._id.p)}</code> [${r._id.s}] × ${r.c}`).join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIVE FEED — every request (IP + response) goes to Telegram
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let live = cfg.LIVE_DEFAULT !== false; // set LIVE_DEFAULT = false in config.js to start with it off

// Paths where the query string and response body are hidden (phone numbers, sessions, personal data)
const SENSITIVE = cfg.LIVE_SENSITIVE || /^\/(api\/(sessionid|pair|neuropair|info|ffgrp)|session)/i;
// Paths that never appear in the live feed (static files and bot polling would flood the group)
const SKIP = cfg.LIVE_SKIP || /(\.(js|css|png|jpe?g|gif|svg|ico|webp|woff2?|map|txt|xml)$)|^\/(react|checkreact)/i;

const queue = [];
let dropped = 0;
let pausedUntil = 0;

function onRequest(r) {
  if (!live || SKIP.test(r.path)) return;
  const sens = SENSITIVE.test(r.path);
  const emoji = r.status >= 500 ? "🔴" : r.status >= 400 ? "🟠" : r.status >= 300 ? "🔵" : "🟢";

  let target = sens ? r.path : r.url;
  if (target.length > 90) target = target.slice(0, 90) + "…";

  let line = `${emoji} <code>${esc(r.ip)}</code> ${esc(r.method)} <code>${esc(target)}</code> → <b>${r.status}</b> (${r.ms}ms)`;

  if (!sens) {
    let body = "";
    if (r.preview && /json|plain/.test(r.type)) body = r.preview.replace(/\s+/g, " ").slice(0, 120);
    else if (r.type) body = `[${r.type.split(";")[0]}${r.len ? ", " + r.len + " bytes" : ""}]`;
    if (body) line += `\n   ↳ <code>${esc(body)}</code>`;
  }

  if (queue.length >= 300) { queue.shift(); dropped++; }
  queue.push({ ip: r.ip, line });
}

// At most one message every 3.5 seconds (Telegram allows ~20 messages/minute in a group):
//  - exactly 1 request waiting -> its own message with a "Block IP" button
//  - several waiting          -> one message with all of them, plus one Block button per IP
async function flushLive() {
  if (!queue.length || Date.now() < pausedUntil) return;

  let text = "";
  let ips = [];
  let single = false;

  if (dropped) {
    text += `⚠️ ${sc(dropped + " requests not shown (high traffic)")}\n\n`;
    dropped = 0;
  }

  if (queue.length === 1 && !text) {
    const item = queue.shift();
    text = item.line;
    ips = [item.ip];
    single = true;
  } else {
    while (queue.length && text.length + queue[0].line.length + 2 < 3800) {
      const item = queue.shift();
      text += item.line + "\n";
      if (!ips.includes(item.ip)) ips.push(item.ip);
    }
  }

  const rows = ips.slice(0, 8).map((ip) => [
    { text: single ? `🚫 ${sc("Block IP")}` : `🚫 ${sc("Block")} ${ip}`, callback_data: `ban:${ip}` }
  ]);

  try {
    await axios.post(`${API}/sendMessage`, {
      chat_id: ADMIN_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true,
      disable_notification: true, reply_markup: { inline_keyboard: rows }
    });
  } catch (e) {
    const wait = e.response?.data?.parameters?.retry_after;
    if (wait) pausedUntil = Date.now() + wait * 1000; // Telegram asked us to slow down
    else console.error("Telegram live error:", e.message);
  }
}

const HELP = `<b>${sc("Commands")}</b>
/stats — ${sc("Today's summary")}
/top — ${sc("Most used endpoints")}
/ips — ${sc("Top IPs by requests")}
/ip 1.2.3.4 — ${sc("What this IP requested")}
/ban 1.2.3.4 — ${sc("Ban an IP")}
/unban 1.2.3.4 — ${sc("Remove a ban")}
/banned — ${sc("Ban list")}
/live on|off — ${sc("Live request feed")}`;

async function handleCommand(text) {
  const [cmd, arg] = text.trim().split(/\s+/);
  switch (cmd.split("@")[0]) {
    case "/start": case "/help": return send(HELP);
    case "/stats":  return send(await statsText());
    case "/top":    return send(await topText("path", `🔥 <b>${sc("Top endpoints today")}</b>`));
    case "/ips":    return send(await topText("ip", `🌐 <b>${sc("Top IPs today")}</b>`));
    case "/ip":     return arg ? send(await ipText(arg)) : send(`${sc("Usage")}: /ip 1.2.3.4`);
    case "/ban":    if (!arg) return send(`${sc("Usage")}: /ban 1.2.3.4`);
                    await banIp(arg, "manual");
                    return send(`🚫 ${sc("Banned")}: <code>${esc(arg)}</code>`);
    case "/unban":  if (!arg) return send(`${sc("Usage")}: /unban 1.2.3.4`);
                    return send((await unbanIp(arg))
                      ? `✅ ${sc("Unbanned")}: <code>${esc(arg)}</code>`
                      : sc("This IP is not in the ban list."));
    case "/live":   if (arg === "on") live = true; else if (arg === "off") live = false;
                    return send(`📡 ${sc("Live requests")}: <b>${live ? sc("ON") : sc("OFF")}</b>`);
    case "/banned": { const l = getBanned();
                    return send(l.length
                      ? `🚫 <b>${sc("Banned IPs")}</b>\n\n` + l.map((i) => `<code>${esc(i)}</code>`).join("\n")
                      : sc("No banned IPs.")); }
    default: return send(HELP);
  }
}

async function handleCallback(cb) {
  const [action, ip] = (cb.data || "").split(":");
  if (action === "ban") { await banIp(ip, "blocked from Telegram"); await send(`🚫 ${sc("Banned")}: <code>${esc(ip)}</code>`); }
  if (action === "ignore") await send(`👌 ${sc("Ignored")}: <code>${esc(ip)}</code>`);
  axios.post(`${API}/answerCallbackQuery`, {
    callback_query_id: cb.id,
    text: action === "ban" ? `🚫 ${sc("Blocked")} ${ip}` : sc("Ok")
  }).catch(() => {});
}

async function poll(offset = 0) {
  try {
    const { data } = await axios.get(`${API}/getUpdates`, {
      params: { offset, timeout: 30, allowed_updates: JSON.stringify(["message", "callback_query"]) },
      timeout: 40000
    });
    for (const u of data.result || []) {
      offset = u.update_id + 1;
      const from = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
      if (String(from) !== String(ADMIN_CHAT_ID)) continue; // only this chat / group
      const uid = u.message?.from?.id ?? u.callback_query?.from?.id;
      const allowed = (cfg.ADMIN_USER_IDS || []).map(String);
      if (allowed.length && !allowed.includes(String(uid))) continue; // if ADMIN_USER_IDS is set, only those users
      try {
        if (u.callback_query) await handleCallback(u.callback_query);
        else if (u.message?.text?.startsWith("/")) await handleCommand(u.message.text);
      } catch (e) { console.error("Telegram command error:", e.message); }
    }
  } catch (e) {
    await new Promise((r) => setTimeout(r, 5000));
  }
  setImmediate(() => poll(offset));
}

function startAdminBot() {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.log("Admin bot is off (ADMIN_BOT_TOKEN / ADMIN_CHAT_ID not set)");
    return;
  }

  // Spike alert with Ban / Ignore buttons
  setSpikeHandler((ip, n) => send(
    `⚠️ <b>${sc("Spike!")}</b>\n<code>${esc(ip)}</code> ${scAll("sent")} <b>${n}</b> ${scAll("requests in one minute.")}`,
    { reply_markup: { inline_keyboard: [[
      { text: `🚫 ${sc("Ban")}`, callback_data: `ban:${ip}` },
      { text: `👌 ${sc("Ignore")}`, callback_data: `ignore:${ip}` }
    ]] } }
  ));

  // Live per-request feed
  setRequestHandler(onRequest);
  setInterval(flushLive, 3500).unref();

  // Daily summary at 23:55 (your timezone)
  setInterval(async () => {
    const local = new Date(Date.now() + TZ_OFFSET_HOURS * 3600 * 1000);
    if (local.getUTCHours() === 23 && local.getUTCMinutes() === 55) {
      send((await statsText()) + "\n\n" + (await topText("ip", `🌐 <b>${sc("Top IPs")}</b>`, 5)));
    }
  }, 60 * 1000).unref();

  poll();
  send(`✅ ${sc("Admin bot is online.")} /help`);
}

module.exports = { startAdminBot };
