const axios = require("axios");
const RequestLog = require("../models/RequestLog");
const { ADMIN_BOT_TOKEN, ADMIN_CHAT_ID, TZ_OFFSET_HOURS } = require("../config");
const { banIp, unbanIp, getBanned, setSpikeHandler } = require("./ipGuard");

const API = `https://api.telegram.org/bot${ADMIN_BOT_TOKEN}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function send(text, extra = {}) {
  try {
    await axios.post(`${API}/sendMessage`, {
      chat_id: ADMIN_CHAT_ID, text: text.slice(0, 4000), parse_mode: "HTML",
      disable_web_page_preview: true, ...extra
    });
  } catch (e) { console.error("TG send error:", e.message); }
}

// আজকের শুরু (আপনার timezone অনুযায়ী)
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
  if (!tot) return "📊 আজ এখনো কোনো request আসেনি।";
  return `📊 <b>আজকের Stats</b>\n\nমোট request: <b>${tot.total}</b>\nError (4xx/5xx): <b>${tot.errors}</b>\nUnique IP: <b>${tot.ips.length}</b>\nগড় response: <b>${Math.round(tot.avgMs)}ms</b>`;
}

async function topText(field, title, limit = 10) {
  const rows = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: dayStart() } } },
    { $group: { _id: "$" + field, c: { $sum: 1 } } },
    { $sort: { c: -1 } }, { $limit: limit }
  ]);
  if (!rows.length) return "কোনো data নেই।";
  return `${title}\n\n` + rows.map((r, i) => `${i + 1}. <code>${esc(r._id)}</code> — ${r.c}`).join("\n");
}

async function ipText(ip) {
  const rows = await RequestLog.aggregate([
    { $match: { ip, createdAt: { $gte: dayStart() } } },
    { $group: { _id: { p: "$path", s: "$status" }, c: { $sum: 1 } } },
    { $sort: { c: -1 } }, { $limit: 15 }
  ]);
  const total = rows.reduce((a, r) => a + r.c, 0);
  if (!rows.length) return `<code>${esc(ip)}</code> আজ কোনো request করেনি।`;
  return `🔎 <b>${esc(ip)}</b> — আজ ${total} request\n\n` +
    rows.map((r) => `<code>${esc(r._id.p)}</code> [${r._id.s}] × ${r.c}`).join("\n");
}

const HELP = `<b>Commands</b>
/stats — আজকের summary
/top — সবচেয়ে বেশি চলা endpoint
/ips — সবচেয়ে বেশি request করা IP
/ip 1.2.3.4 — ওই IP কী কী hit করেছে
/ban 1.2.3.4 — IP ban
/unban 1.2.3.4 — ban তোলা
/banned — ban list`;

async function handleCommand(text) {
  const [cmd, arg] = text.trim().split(/\s+/);
  switch (cmd.split("@")[0]) {
    case "/start": case "/help": return send(HELP);
    case "/stats":  return send(await statsText());
    case "/top":    return send(await topText("path", "🔥 <b>আজকের Top Endpoint</b>"));
    case "/ips":    return send(await topText("ip", "🌐 <b>আজকের Top IP</b>"));
    case "/ip":     return arg ? send(await ipText(arg)) : send("ব্যবহার: /ip 1.2.3.4");
    case "/ban":    if (!arg) return send("ব্যবহার: /ban 1.2.3.4");
                    await banIp(arg, "manual"); return send(`🚫 Banned: <code>${esc(arg)}</code>`);
    case "/unban":  if (!arg) return send("ব্যবহার: /unban 1.2.3.4");
                    return send((await unbanIp(arg)) ? `✅ Unbanned: <code>${esc(arg)}</code>` : "এই IP ban list-এ নেই।");
    case "/banned": { const l = getBanned(); return send(l.length ? "🚫 <b>Banned</b>\n\n" + l.map((i) => `<code>${esc(i)}</code>`).join("\n") : "কেউ banned নেই।"); }
    default: return send(HELP);
  }
}

async function handleCallback(cb) {
  const [action, ip] = (cb.data || "").split(":");
  if (action === "ban") { await banIp(ip, "spike alert"); await send(`🚫 Banned: <code>${esc(ip)}</code>`); }
  if (action === "ignore") await send(`👌 Ignored: <code>${esc(ip)}</code>`);
  axios.post(`${API}/answerCallbackQuery`, { callback_query_id: cb.id }).catch(() => {});
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
      if (String(from) !== String(ADMIN_CHAT_ID)) continue; // শুধু আপনি
      try {
        if (u.callback_query) await handleCallback(u.callback_query);
        else if (u.message?.text?.startsWith("/")) await handleCommand(u.message.text);
      } catch (e) { console.error("TG cmd error:", e.message); }
    }
  } catch (e) {
    await new Promise((r) => setTimeout(r, 5000));
  }
  setImmediate(() => poll(offset));
}

function startAdminBot() {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.log("ℹ️ Admin bot off (ADMIN_BOT_TOKEN / ADMIN_CHAT_ID set করেননি)");
    return;
  }
  // spike alert — বাটনসহ
  setSpikeHandler((ip, n) => send(
    `⚠️ <b>Spike!</b>\n<code>${esc(ip)}</code> এক মিনিটে <b>${n}</b> request করেছে।`,
    { reply_markup: { inline_keyboard: [[
      { text: "🚫 Ban", callback_data: `ban:${ip}` },
      { text: "👌 Ignore", callback_data: `ignore:${ip}` }
    ]] } }
  ));

  // প্রতিদিন রাত ১১:৫৫-এ (আপনার সময়) summary
  setInterval(async () => {
    const local = new Date(Date.now() + TZ_OFFSET_HOURS * 3600 * 1000);
    if (local.getUTCHours() === 23 && local.getUTCMinutes() === 55) {
      send((await statsText()) + "\n\n" + (await topText("ip", "🌐 <b>Top IP</b>", 5)));
    }
  }, 60 * 1000).unref();

  poll();
  send("✅ Admin bot চালু হয়েছে। /help লিখুন।");
}

module.exports = { startAdminBot };
