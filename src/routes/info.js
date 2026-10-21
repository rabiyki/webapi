"use strict";

// Reusable "Telegram bot → file → lines" endpoints.
// Add a new endpoint = add ONE line in ENDPOINTS below. Everything else is shared.
//   path    → URL, e.g. "/api/info"
//   command → what is sent to the bot; {q} is replaced with the user's input
//   bot     → (optional) Telegram bot username, default TG_INFO_BOT from config
//   pattern → (optional) allowed input regex, default digits only (5-20)
//   upper   → (optional) true = send input to the bot in CAPITAL letters
// Usage: GET|POST <path>?number=VALUE   (also accepts ?id= or ?q=)
// Response: { success, Owner, id, info } — info = array of lines (credit line removed).

const express = require("express");
const { TG_INFO_BOT } = require("../config");
const { enqueue, converse } = require("../utils/telegram");

const router = express.Router();

const TOTAL_TIMEOUT = 45000;
const TEXT_GRACE = 6000;              // final-looking text with no file → wait this long for a file
const FILE_GRACE = 2500;              // after a file → wait this long for more files/messages
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const OWNER = "MR RABBIT";
const NO_RESULT = "No result found";

const ENDPOINTS = [
  { path: "/api/info",       command: "/num {q}" },                                                       // mobile number
  { path: "/api/familyinfo",  command: "/familyinfo {q}", pattern: /^\d{12}$/ },                           // aadhar (12 digits)
  { path: "/api/aadhar",      command: "/aadhar {q}",     pattern: /^\d{12}$/ },                            // aadhar UID (12 digits)
  { path: "/api/vnum",        command: "/vnum {q}",       pattern: /^[A-Za-z0-9]{4,15}$/, upper: true },   // vehicle plate
  { path: "/api/paknum",      command: "/paknum {q}" },                                                    // pakistan number
  { path: "/api/pincode",     command: "/pincode {q}",    pattern: /^\d{6}$/ },                             // pincode (6 digits)
  { path: "/api/advpan",      command: "/advpan {q}",     pattern: /^[A-Za-z]{5}\d{4}[A-Za-z]$/, upper: true }, // PAN
  { path: "/api/tgnum",       command: "/tgnum {q}" },                                                     // telegram id
  { path: "/api/ifsc",        command: "/ifsc {q}",       pattern: /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, upper: true }, // IFSC
  { path: "/api/gst",         command: "/gst {q}",        pattern: /^[A-Za-z0-9]{15}$/, upper: true },     // GSTIN
  { path: "/api/lpg",         command: "/lpg {q}" },                                                       // lpg number
  { path: "/api/bharatgas",   command: "/bharatgas {q}" },                                                 // bharat gas number
  { path: "/api/voter",       command: "/voter {q}",      pattern: /^[A-Za-z0-9]{6,20}$/, upper: true },  // EPIC
  { path: "/api/ration",      command: "/ration {q}",     pattern: /^[A-Za-z0-9-]{5,25}$/, upper: true }, // ration card
  { path: "/api/mpnum",       command: "/mpnum {q}" },                                                     // number
  { path: "/api/hpgas",       command: "/hpgas {q}" },                                                     // hp gas number
];
const DEFAULT_PATTERN = /^\d{5,20}$/;
// Whole line containing the bot's credit, e.g. "⚡ Powered by @DuXxZx_info"
const CREDIT = /^.*powered\s*by.*@?DuXxZx_info.*$\r?\n?/gim;
const INTERIM = /search|wait|processing|loading|fetching|please/i;

function looksBinary(buf) {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function fileNameOf(m) {
  const attrs = (m.document && m.document.attributes) || [];
  const a = attrs.find((x) => x.fileName);
  return a ? a.fileName : "file";
}

function askBot(bot, command) {
  const texts = new Map();   // message id → latest text (edits replace the old text)
  const files = [];
  const seenFiles = new Set();
  let timer = null;

  return converse(bot, command, {
    timeout: TOTAL_TIMEOUT,
    includeEdits: true,
    onMessage: async (m, { client, finish }) => {
      const done = () => finish(null, { messages: [...texts.values()], files });
      const text = m.message || "";
      if (text) texts.set(m.id, text);

      if ((m.document || m.file) && !seenFiles.has(m.id)) {
        seenFiles.add(m.id);
        clearTimeout(timer);
        const buf = await client.downloadMedia(m, {});
        if (!buf || !buf.length) return finish(new Error("File download failed"));
        if (buf.length > MAX_FILE_BYTES) return finish(new Error("File too large"));
        files.push({ name: fileNameOf(m), mime: (m.file && m.file.mimeType) || null, buf });
        timer = setTimeout(done, FILE_GRACE);
        return;
      }

      if (!files.length && text && !INTERIM.test(text)) {
        clearTimeout(timer);
        timer = setTimeout(done, TEXT_GRACE);
      }
    },
  }).finally(() => clearTimeout(timer));
}

const makeHandler = (ep) => async (req, res) => {
  const src = { ...(req.body || {}), ...req.query };
  let id = String(src.number || src.id || src.q || "").trim();
  if (ep.upper) id = id.toUpperCase();
  const pattern = ep.pattern || DEFAULT_PATTERN;

  if (!pattern.test(id)) {
    return res.status(400).json({ success: false, error: ep.pattern ? "Invalid input" : "Invalid id. Digits only" });
  }

  try {
    const r = await enqueue("info", () => askBot(ep.bot || TG_INFO_BOT, ep.command.replace("{q}", () => id)));

    if (!r.files.length) {
      // Whatever the bot says (not found, error, etc.) → always the same message.
      return res.status(404).json({ success: false, id, error: NO_RESULT });
    }

    // Binary file (image etc.) → can't be shown as text, return it as base64.
    const bin = r.files.find((f) => looksBinary(f.buf));
    if (bin) {
      return res.json({
        success: true, Owner: OWNER, id,
        file: { name: bin.name, mime: bin.mime, size: bin.buf.length, encoding: "base64", content: bin.buf.toString("base64") },
      });
    }

    // Everything in the file stays exactly as-is; only the "Powered by @DuXxZx_info" credit is removed.
    const info = r.files
      .map((f) => f.buf.toString("utf8").replace(/^\uFEFF/, ""))
      .join("\n")
      .replace(CREDIT, "")
      .trim();

    // JSON can't show real line breaks inside a string (they appear as "\\n"),
    // so every line of the file is returned as its own array item, in the same order.
    const lines = info.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
    return res
      .type("application/json")
      .send(JSON.stringify({ success: true, Owner: OWNER, id, info: lines }, null, 2));
  } catch (e) {
    // Bot never replied → also "no result".
    if (/did not reply in time/i.test(e.message || "")) {
      return res.status(404).json({ success: false, id, error: NO_RESULT });
    }
    return res.status(500).json({ success: false, error: e.message || "Request failed" });
  }
};

for (const ep of ENDPOINTS) {
  const h = makeHandler(ep);
  router.get(ep.path, h);
  router.post(ep.path, h);
}

module.exports = router;
