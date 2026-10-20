"use strict";

// GET|POST /api/ffgrp?command=5g&region=bd&number=8775567777
// GET|POST /api/ffgrp?command=6g&region=bd&number=8775567777
// API → Telegram user account (session string) → emote bot → JSON { success } | { error }
// Bot receives:  /5g bd 8775567777   (region optional → "/5g 8775567777")

const express = require("express");
const { TG_EMOTE_BOT } = require("../config");
const { enqueue, converse } = require("../utils/telegram");

const router = express.Router();

const COMMANDS = new Set(["5g", "6g"]);
const REPLY_TIMEOUT = 20000;

function sendToBot(text) {
  return converse(TG_EMOTE_BOT, text, {
    timeout: REPLY_TIMEOUT,
    onMessage: (m, { finish }) => finish(null, m.message || ""),
  });
}

function isSuccess(reply) {
  const t = String(reply || "");
  return /✅/.test(t) || /\bSENT\b/i.test(t) && !/(fail|error|invalid|not\s+found|limit|wait)/i.test(t);
}

async function handle(req, res) {
  const src = { ...(req.body || {}), ...req.query };
  const command = String(src.command || "").toLowerCase().trim();
  const region = String(src.region || "").toLowerCase().trim();
  const number = String(src.number || "").trim();

  if (!COMMANDS.has(command)) {
    return res.status(400).json({ success: false, error: "Invalid command. Use 5g or 6g" });
  }
  if (region && !/^[a-z]{2,5}$/.test(region)) {
    return res.status(400).json({ success: false, error: "Invalid region. Letters only (e.g. bd, ind, sg)" });
  }
  if (!/^\d{5,20}$/.test(number)) {
    return res.status(400).json({ success: false, error: "Invalid number. Digits only" });
  }

  const text = region ? `/${command} ${region} ${number}` : `/${command} ${number}`;

  try {
    const reply = await enqueue("emote", () => sendToBot(text));
    if (isSuccess(reply)) {
      return res.json({
        success: true,
        command,
        ...(region && { region }),
        number,
        message: `${command === "5g" ? "5" : "6"}-player group request sent`,
      });
    }
    return res.status(502).json({ success: false, error: "Request failed" });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || "Request failed" });
  }
}

router.get("/api/ffgrp", handle);
router.post("/api/ffgrp", handle);

module.exports = router;
