"use strict";

// GET|POST /api/ffgrp?command=5g&number=1234567
// GET|POST /api/ffgrp?command=6g&number=123456789012345
// API → Telegram user account (session string) → emote bot → JSON { success } | { error }

const express = require("express");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { TG_API_ID, TG_API_HASH, TG_SESSION, TG_EMOTE_BOT } = require("../config");

const router = express.Router();

const COMMANDS = new Set(["5g", "6g"]);
const REPLY_TIMEOUT = 20000;

let client = null;
let connecting = null;

async function getClient() {
  if (client && client.connected) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const c = new TelegramClient(new StringSession(TG_SESSION), TG_API_ID, TG_API_HASH, {
      connectionRetries: 5,
      autoReconnect: true,
    });
    c.setLogLevel("none");
    await c.connect();
    client = c;
    return c;
  })();
  try { return await connecting; }
  catch (e) { client = null; throw e; }
  finally { connecting = null; }
}

// Requests are serialized so each bot reply is matched to the right command.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function sendToBot(text) {
  const c = await getClient();
  const bot = await c.getEntity(TG_EMOTE_BOT);

  return new Promise(async (resolve, reject) => {
    let done = false;
    const handler = (event) => {
      const m = event.message;
      if (!m || m.out || done) return;
      finish(null, m.message || "");
    };
    const evt = new NewMessage({ incoming: true, fromUsers: [bot] });
    const timer = setTimeout(() => finish(new Error("Bot did not reply in time")), REPLY_TIMEOUT);

    function finish(err, reply) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { c.removeEventHandler(handler, evt); } catch (_) {}
      err ? reject(err) : resolve(reply);
    }

    c.addEventHandler(handler, evt);
    try { await c.sendMessage(bot, { message: text }); }
    catch (e) { finish(e); }
  });
}

function isSuccess(reply) {
  const t = String(reply || "");
  return /✅/.test(t) || /\bSENT\b/i.test(t) && !/(fail|error|invalid|not\s+found|limit|wait)/i.test(t);
}

async function handle(req, res) {
  const src = { ...(req.body || {}), ...req.query };
  const command = String(src.command || "").toLowerCase().trim();
  const number = String(src.number || "").trim();

  if (!COMMANDS.has(command)) {
    return res.status(400).json({ success: false, error: "Invalid command. Use 5g or 6g" });
  }
  if (!/^\d{5,20}$/.test(number)) {
    return res.status(400).json({ success: false, error: "Invalid number. Digits only" });
  }

  try {
    const reply = await enqueue(() => sendToBot(`/${command} ${number}`));
    if (isSuccess(reply)) {
      return res.json({ success: true, message: `${command === "5g" ? "5" : "6"}-player group request sent` });
    }
    return res.status(502).json({ success: false, error: "Request failed" });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || "Request failed" });
  }
}

router.get("/api/ffgrp", handle);
router.post("/api/ffgrp", handle);

module.exports = router;
