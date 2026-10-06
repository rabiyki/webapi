"use strict";

// ═══════════════════════════════════════════════════════════════
//  RabbitXMD Session-ID generator
//  GET /api/sessionid?number=91XXXXXXXXXX  → { code: "RABB-ITXD" }
//  Pairing hole WhatsApp e creds.json MEGA te upload hoy ebong
//  user ke "RabbitXMD~<id>" session-id pathano hoy.
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const fs = require("fs");
const pino = require("pino");
const axios = require("axios");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
  DisconnectReason,
  generateWAMessageFromContent,
  proto,
} = require("@whiskeysockets/baileys");
const crypto = require("crypto");
const Session = require("../models/Session");
const { CREATOR } = require("../config");

// awesome-phonenumber v5 (CJS: default function) / v7 (ESM-only) dui version e kaj korar jonno
let parsePhone;
try {
  const apn = require("awesome-phonenumber");
  parsePhone = (n) => {
    if (typeof apn === "function") {
      const p = apn(n);
      return { valid: p.isValid(), e164: p.getNumber("e164") };
    }
    const fn = apn.parsePhoneNumber || apn.default;
    const p = fn(n);
    return { valid: p.valid, e164: p.number && p.number.e164 };
  };
} catch (_) {
  parsePhone = (n) => ({ valid: /^\+\d{7,15}$/.test(n), e164: n });
}

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_DELAY = 5000;
const AUTH_BASE = "./auth_info_baileys";

const MESSAGE = `*🍁 ʜᴇʟʟᴏ ʀᴀʙʙɪᴛxᴍᴅ ᴜsᴇʀ !*

*🔅ᴅᴏ ɴᴏᴛ sʜᴀʀᴇ ʏᴏᴜʀ sᴇssɪᴏɴ-ɪᴅ ᴡɪᴛʜ ᴀɴʏᴏɴᴇ.ᴛʜɪs ɪs ʏᴏᴜʀ sᴇssɪᴏɴ-ɪᴅ ᴜsᴇ ɪᴛ ᴏɴʟʏ ғᴏʀ ʙᴏᴛ ᴅᴇᴘʟᴏʏᴍᴇɴᴛ.🐚*

*🔐ᴛʜᴀɴᴋs ғᴏʀ ᴜsᴇɪɴɢ ʀᴀʙʙɪᴛXᴍᴅ !*`;

async function removeFile(p) {
  try {
    if (!fs.existsSync(p)) return false;
    await fs.promises.rm(p, { recursive: true, force: true });
    return true;
  } catch (e) { console.error("Error removing file:", e); return false; }
}

function randomSid() {
  return crypto.randomBytes(9).toString("base64url"); // 12 char, unguessable
}

router.get("/api/sessionid", async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ code: "Phone number is required" });

  num = String(num).replace(/[^0-9]/g, "");
  const phone = parsePhone("+" + num);
  if (!phone.valid) return res.status(400).send({ code: "Invalid phone number." });
  num = phone.e164.replace("+", "");

  const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
  const dirs = `${AUTH_BASE}/session_${sessionId}`;

  let pairingCodeSent = false, sessionCompleted = false, isCleaningUp = false;
  let responseSent = false, reconnectAttempts = 0, currentSocket = null, timeoutHandle = null;

  async function cleanup(reason = "unknown") {
    if (isCleaningUp) return;
    isCleaningUp = true;
    console.log(`🧹 Cleanup ${sessionId} (${num}) - ${reason}`);
    if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
    if (currentSocket) {
      try { currentSocket.ev.removeAllListeners(); await currentSocket.end(); } catch (e) {}
      currentSocket = null;
    }
    setTimeout(async () => { await removeFile(dirs); }, CLEANUP_DELAY);
  }

  async function initiateSession() {
    if (sessionCompleted || isCleaningUp) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      if (!responseSent && !res.headersSent) { responseSent = true; res.status(503).send({ code: "Connection failed after multiple attempts" }); }
      await cleanup("max_reconnects"); return;
    }
    try {
      if (!fs.existsSync(dirs)) await fs.promises.mkdir(dirs, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(dirs);
      const { version } = await fetchLatestBaileysVersion();

      if (currentSocket) {
        try { currentSocket.ev.removeAllListeners(); await currentSocket.end(); } catch (e) {}
      }

      currentSocket = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })) },
        printQRInTerminal: false, logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Chrome"), markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false, defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000, keepAliveIntervalMs: 30000, retryRequestDelayMs: 250, maxRetries: 3,
      });

      const sock = currentSocket;

      sock.ev.on("connection.update", async (update) => {
        if (isCleaningUp) return;
        const { connection, lastDisconnect, isNewLogin } = update;

        if (connection === "open") {
          if (sessionCompleted) return;
          sessionCompleted = true;
          try {
            const credsFile = `${dirs}/creds.json`;
            if (fs.existsSync(credsFile)) {
              const megaSessionId = randomSid(); // (variable name rakha holo, ekhon MongoDB id)
              await Session.create({
                sid: megaSessionId,
                creds: (await fs.promises.readFile(credsFile)).toString("utf-8"),
              });
              const userJid = jidNormalizedUser(num + "@s.whatsapp.net");

              const { data: thumb } = await axios.get(
                "https://rabbitapi.zone.id/8jLAG.jpg",
                { responseType: "arraybuffer" }
              );

              const interactiveMsg = generateWAMessageFromContent(
                userJid,
                {
                  viewOnceMessage: {
                    message: {
                      interactiveMessage: proto.Message.InteractiveMessage.create({
                        header: proto.Message.InteractiveMessage.Header.create({
                          title: "ʀᴀʙʙɪᴛxᴍᴅ-sᴇssɪᴏɴ",
                          hasMediaAttachment: false,
                        }),
                        body: proto.Message.InteractiveMessage.Body.create({ text: MESSAGE }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                          buttons: [{ name: "inapp_signup", buttonParamsJson: "{}" }],
                        }),
                        contextInfo: {
                          participant: "0@s.whatsapp.net",
                          quotedMessage: {
                            orderMessage: {
                              orderId: "ʀᴀʙʙɪᴛxᴍᴅ",
                              itemCount: 1,
                              status: 1,
                              surface: 1,
                              message: "ʀᴀʙʙɪᴛxᴍᴅ",
                              sellerJid: "0@s.whatsapp.net",
                              thumbnail: Buffer.from(thumb),
                            },
                          },
                        },
                      }),
                    },
                  },
                },
                {}
              );

              await sock.relayMessage(userJid, interactiveMsg.message, { messageId: interactiveMsg.key.id });

              // ===== Session ID message with prefix + copy button =====
              const prefixedSessionId = `ʀᴀʙʙɪᴛxᴍᴅ~${megaSessionId}`;

              const sessionText = `*🔖ʏᴏᴜʀ sᴇssɪᴏɴ-ɪᴅ ɢᴀɴᴀʀᴀᴛᴇ sᴜᴄᴇssғᴜʟʟ !*

*${prefixedSessionId}*

*🗃️- ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʀᴀʙʙɪᴛxᴍᴅ !*`;

              const sessionMsg = generateWAMessageFromContent(
                userJid,
                {
                  viewOnceMessage: {
                    message: {
                      messageContextInfo: { deviceListMetadata: {} },
                      interactiveMessage: proto.Message.InteractiveMessage.create({
                        body: proto.Message.InteractiveMessage.Body.create({ text: sessionText }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                          buttons: [
                            {
                              name: "cta_copy",
                              buttonParamsJson: JSON.stringify({
                                display_text: "❒ ᴄᴏᴘʏ ᴄᴏᴅᴇ",
                                copy_code: prefixedSessionId,
                              }),
                            },
                          ],
                        }),
                        contextInfo: {
                          stanzaId: interactiveMsg.key.id,
                          participant: userJid,
                          quotedMessage: interactiveMsg.message,
                        },
                      }),
                    },
                  },
                },
                {}
              );

              await sock.relayMessage(userJid, sessionMsg.message, { messageId: sessionMsg.key.id });
              await delay(1000);
            }
          } catch (err) { console.error("Error sending session:", err); }
          finally { await cleanup("session_complete"); }
        }

        if (isNewLogin) console.log(`🔐 New login via pair code for ${num}`);

        if (connection === "close") {
          if (sessionCompleted || isCleaningUp) { await cleanup("already_complete"); return; }
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            if (!responseSent && !res.headersSent) { responseSent = true; res.status(401).send({ code: "Invalid pairing code or session expired" }); }
            await cleanup("logged_out");
          } else if (pairingCodeSent && !sessionCompleted) {
            reconnectAttempts++;
            await delay(2000); await initiateSession();
          } else { await cleanup("connection_closed"); }
        }
      });

      if (!sock.authState.creds.registered && !pairingCodeSent && !isCleaningUp) {
        await delay(1500);
        try {
          pairingCodeSent = true;
          const customPairingCode = "RABBITXD"; // must be 8 alphanumeric uppercase chars
          let code = await sock.requestPairingCode(num, customPairingCode);
          code = code?.match(/.{1,4}/g)?.join("-") || code;
          console.log("🔗 Pairing code:", code);
          if (!responseSent && !res.headersSent) { responseSent = true; res.send({ code }); }
        } catch (error) {
          pairingCodeSent = false;
          if (!responseSent && !res.headersSent) { responseSent = true; res.status(503).send({ code: "Failed to get pairing code" }); }
          await cleanup("pairing_code_error");
        }
      }

      sock.ev.on("creds.update", saveCreds);

      timeoutHandle = setTimeout(async () => {
        if (!sessionCompleted && !isCleaningUp) {
          if (!responseSent && !res.headersSent) { responseSent = true; res.status(408).send({ code: "Pairing timeout" }); }
          await cleanup("timeout");
        }
      }, SESSION_TIMEOUT);

    } catch (err) {
      console.error(`❌ Error initializing session for ${num}:`, err);
      if (!responseSent && !res.headersSent) { responseSent = true; res.status(503).send({ code: "Service Unavailable" }); }
      await cleanup("init_error");
    }
  }

  await initiateSession();
});

// Bot er jonno: GET /api/session/<id> → creds.json (24h por MongoDB auto-delete kore dey)
router.get("/api/session/:sid", async (req, res) => {
  try {
    const sid = String(req.params.sid || "").replace(/^ʀᴀʙʙɪᴛxᴍᴅ~/, "");
    const doc = await Session.findOne({ sid }).lean();
    if (!doc) return res.status(404).json({ success: false, creator: CREATOR, message: "Session not found or expired (24h)" });
    res.set("Cache-Control", "no-store");
    return res.type("application/json").send(doc.creds);
  } catch (e) {
    return res.status(500).json({ success: false, creator: CREATOR, error: e.message });
  }
});

// Purane session folder 10 min por por clean
setInterval(async () => {
  try {
    if (!fs.existsSync(AUTH_BASE)) return;
    const sessions = await fs.promises.readdir(AUTH_BASE);
    const now = Date.now();
    for (const s of sessions) {
      try {
        const stats = await fs.promises.stat(`${AUTH_BASE}/${s}`);
        if (now - stats.mtimeMs > 10 * 60 * 1000) await removeFile(`${AUTH_BASE}/${s}`);
      } catch (e) {}
    }
  } catch (e) { console.error("Error in cleanup interval:", e); }
}, 60000);

module.exports = router;
