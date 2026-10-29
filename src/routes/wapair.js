/**
 * src/routes/wapair.js
 *
 * GET /pair?number=91XXXXXXXXXX   → { "code": "ABCD-1234" }
 * GET /qr                         → { "qr": "data:image/png;base64,..." }
 *
 * Both routes discover live WA session servers via Ably Presence on the
 * shared "servers" channel, pick the one with the fewest active sessions,
 * and relay the command through Ably's cmd:/evt: channel pair.
 */

"use strict";

const express  = require("express");
const router   = express.Router();
const Ably     = require("ably");
const QRCode   = require("qrcode");
const crypto   = require("crypto");
const { noCache } = require("../utils/http");
const { CREATOR }  = require("../config");

// ─── Ably config ──────────────────────────────────────────────────────────────
const ABLY_API_KEY = (
  process.env.ABLY_API_KEY ||
  "iKE8dA.E5G_Lg:-SQGFkkDApAglNb8J-DDeggINoPDUsydNfpSo370X_E"
).trim();

const VALID_KEY = /^[\w-]+\.[\w-]+:[\w-]+$/;

// ─── Singleton Ably Realtime client ───────────────────────────────────────────
// One client, reused across all requests — avoids per-request handshake cost.
let _ablyClient = null;
function getClient() {
  if (_ablyClient) return _ablyClient;
  if (!ABLY_API_KEY || !VALID_KEY.test(ABLY_API_KEY)) {
    throw new Error("ABLY_API_KEY not configured or invalid");
  }
  _ablyClient = new Ably.Realtime({
    key:      ABLY_API_KEY,
    clientId: `webapi-${crypto.randomBytes(4).toString("hex")}`,
  });
  return _ablyClient;
}

// ─── Ensure the "servers" presence channel is attached ───────────────────────
async function ensureServersAttached(client) {
  const ch = client.channels.get("servers");
  if (ch.state === "attached") return ch;
  await new Promise((res, rej) => ch.attach((err) => (err ? rej(err) : res())));
  return ch;
}

// ─── Pick server with fewest sessions from Ably Presence ─────────────────────
async function pickLeastLoaded() {
  const client = getClient();
  const ch = await ensureServersAttached(client);

  const members = await new Promise((res, rej) =>
    ch.presence.get((err, list) => (err ? rej(err) : res(list || [])))
  );

  if (!members.length) throw new Error("No pairing servers online");

  const best = members.reduce((min, m) => {
    const ms  = Number(m.data?.sessions ?? Infinity);
    const mns = Number(min.data?.sessions ?? Infinity);
    return ms < mns ? m : min;
  });

  return best.clientId;
}

// ─── Terminal event names (same set as ablyBridge.js) ────────────────────────
const TERMINAL = new Set([
  "pair-code-result",
  "paired",
  "stopped",
  "logged-out",
  "status",
  "list",
  "qr-timeout",
]);

// ─── Generic command → event bridge ──────────────────────────────────────────
// onProgress(type, data) is called for every non-terminal event that matches
// the requestId.  Resolves with { type, data } on the first terminal event.
async function callServer(action, payload = {}, { onProgress, timeoutMs = 120_000 } = {}) {
  const client    = getClient();
  const serverId  = await pickLeastLoaded();
  const requestId = crypto.randomBytes(8).toString("hex");
  const cmdCh     = client.channels.get(`cmd:${serverId}`);
  const evtCh     = client.channels.get(`evt:${serverId}`);

  return new Promise(async (resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      evtCh.unsubscribe("event", onEvt);
      reject(new Error("Request timed out"));
    }, timeoutMs);

    function onEvt(msg) {
      const ev   = msg.data || {};
      if (ev.requestId !== requestId) return;
      const type = ev.type || "";
      const data = ev.data || {};

      if (type === "error") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        evtCh.unsubscribe("event", onEvt);
        reject(new Error(data.message || "Session server returned an error"));
        return;
      }

      if (type === "qr-timeout") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        evtCh.unsubscribe("event", onEvt);
        reject(new Error("QR code timed out without being scanned"));
        return;
      }

      if (TERMINAL.has(type)) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        evtCh.unsubscribe("event", onEvt);
        resolve({ type, data });
        return;
      }

      // Non-terminal progress (e.g. "qr" frames, "status" updates)
      try { onProgress?.(type, data); } catch {}
    }

    try {
      await evtCh.subscribe("event", onEvt);
      await cmdCh.publish("cmd", { requestId, action, payload });
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      evtCh.unsubscribe("event", onEvt);
      reject(err);
    }
  });
}

// ─── QR helper: resolves on the FIRST QR frame, does not wait for scan ───────
async function getFirstQrString(timeoutMs = 60_000) {
  const client    = getClient();
  const serverId  = await pickLeastLoaded();
  const requestId = crypto.randomBytes(8).toString("hex");
  const cmdCh     = client.channels.get(`cmd:${serverId}`);
  const evtCh     = client.channels.get(`evt:${serverId}`);

  return new Promise(async (resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      evtCh.unsubscribe("event", onEvt);
      reject(new Error("Timed out waiting for QR code"));
    }, timeoutMs);

    function onEvt(msg) {
      const ev   = msg.data || {};
      if (ev.requestId !== requestId) return;
      const type = ev.type || "";
      const data = ev.data || {};

      // First QR frame — resolve immediately
      if (type === "qr" && data.qr) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        evtCh.unsubscribe("event", onEvt);
        resolve(String(data.qr));
        return;
      }

      if (type === "error" || type === "qr-timeout") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        evtCh.unsubscribe("event", onEvt);
        reject(new Error(data.message || type));
      }
    }

    try {
      await evtCh.subscribe("event", onEvt);
      await cmdCh.publish("cmd", { requestId, action: "pair-qr", payload: {} });
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      evtCh.unsubscribe("event", onEvt);
      reject(err);
    }
  });
}

// ─── QRCode.toDataURL wrapper (callback → Promise) ───────────────────────────
function toDataURL(text) {
  return new Promise((res, rej) =>
    QRCode.toDataURL(
      text,
      { width: 512, margin: 2, errorCorrectionLevel: "M" },
      (err, url) => (err ? rej(err) : res(url))
    )
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /pair?number=91XXXXXXXXXX
// Returns: { "code": "ABCD-1234" }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/pair", async (req, res) => {
  noCache(res);

  const number = String(req.query.number || "").replace(/\D/g, "");
  if (!number || !/^[0-9]{6,15}$/.test(number)) {
    return res.status(400).json({
      success: false,
      creator: CREATOR,
      message: "Valid number required (digits only, E.164 without +)",
    });
  }

  try {
    const { data } = await callServer(
      "pair-code",
      { phone: number },
      { timeoutMs: 120_000 }
    );

    if (!data?.code) {
      return res.status(502).json({
        success: false,
        creator: CREATOR,
        message: "Session server returned no code",
      });
    }

    return res.json({ code: String(data.code) });

  } catch (err) {
    const status = err.message?.includes("No pairing servers") ? 503 : 500;
    return res.status(status).json({
      success: false,
      creator: CREATOR,
      message: err.message || "Failed to generate pair code",
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /qr
// Returns: { "qr": "data:image/png;base64,..." }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/qr", async (req, res) => {
  noCache(res);

  try {
    const qrString = await getFirstQrString(60_000);
    const dataUrl  = await toDataURL(qrString);

    return res.json({ qr: dataUrl });

  } catch (err) {
    const status = err.message?.includes("No pairing servers") ? 503 : 500;
    return res.status(status).json({
      success: false,
      creator: CREATOR,
      message: err.message || "Failed to generate QR code",
    });
  }
});

module.exports = router;
