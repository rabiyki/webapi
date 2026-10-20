"use strict";

// GET|POST /api/rabbitd?number=9867887667
// API → Telegram user account → @Randotrabbitxmd_bot  ("/rabbitd <id>")
// Bot sends "searching…" text, then a file (info.txt or any file).
// Response: { success, Owner, id, info } — info = full file content (credit line removed).

const express = require("express");
const { TG_INFO_BOT } = require("../config");
const { enqueue, converse } = require("../utils/telegram");

const router = express.Router();

const TOTAL_TIMEOUT = 45000;
const TEXT_GRACE = 6000;              // final-looking text with no file → wait this long for a file
const FILE_GRACE = 2500;              // after a file → wait this long for more files/messages
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const OWNER = "MR RABBIT";
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

function askBot(id) {
  const texts = new Map();   // message id → latest text (edits replace the old text)
  const files = [];
  const seenFiles = new Set();
  let timer = null;

  return converse(TG_INFO_BOT, `/num ${id}`, {
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

async function handle(req, res) {
  const src = { ...(req.body || {}), ...req.query };
  const id = String(src.number || src.id || "").trim();

  if (!/^\d{5,20}$/.test(id)) {
    return res.status(400).json({ success: false, error: "Invalid id. Digits only" });
  }

  try {
    const r = await enqueue("info", () => askBot(id));

    if (!r.files.length) {
      const reply = r.messages.filter((t) => !INTERIM.test(t)).join("\n").trim();
      return res.status(404).json({ success: false, id, error: reply || "No data received", messages: r.messages });
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

    return res.json({ success: true, Owner: OWNER, id, info });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || "Request failed" });
  }
}

router.get("/api/rabbitd", handle);
router.post("/api/rabbitd", handle);

module.exports = router;
