const express = require("express");
const axios = require("axios");
const router = express.Router();
const { CREATOR } = require("../config");
const { noCache } = require("../utils/http");
const { cacheBufferMedia } = require("../utils/cache");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖼️ AI IMAGE EDIT  (faa editfoto)
// GET|POST /api/editimg?url=<image_url>&prompt=<text>
//
// Default  -> Server-Sent Events (SSE) stream:
//     event: start    {status:"started"}
//     event: progress {status:"processing", elapsed:<sec>, bytes:<n>}
//     event: result   {status:"success", creator, result:{url}}
//     event: error    {status:false, message}
//
// ?stream=0 -> normal JSON response (shesh e ekbar e).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FAA_ENDPOINT = "https://api-faa.my.id/faa/editfoto";
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 min overall limit
const IMG_EXT = /\.(jpe?g|png|webp|gif)(\?|#|$)/i;

// content-type bhul/missing hole o image chinte file er shuru'r bytes dekhi
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

function extFromType(ct = "") {
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  return ".jpg";
}

// Upstream response (JSON / SSE / plain text) theke image URL ba base64 ber kore.
function extractImage(text) {
  const candidates = [];
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

  const objs = [];
  const whole = tryParse(text.trim());
  if (whole) objs.push(whole);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^data:\s*/, "").trim();
    if (!line || line === "[DONE]") continue;
    const o = tryParse(line);
    if (o) objs.push(o);
  }

  const walk = (v) => {
    if (typeof v === "string") candidates.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  objs.forEach(walk);

  const b64 = candidates.find((s) => /^data:image\//.test(s));
  if (b64) {
    const m = b64.match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
    if (m) return { buffer: Buffer.from(m[2], "base64"), contentType: m[1] };
  }

  const urls = candidates.filter((s) => /^https?:\/\//i.test(s));
  const pick = urls.find((u) => IMG_EXT.test(u)) || urls[0];
  if (pick) return { url: pick };

  const m = text.match(/https?:\/\/[^\s"'<>\\]+/g);
  if (m) return { url: m.find((u) => IMG_EXT.test(u)) || m[m.length - 1] };
  return null;
}

async function runEdit({ url, prompt, signal, onChunk }) {
  const up = await axios.get(FAA_ENDPOINT, {
    params: { url, prompt },
    responseType: "stream",
    timeout: 0, // edit slow hote pare — nijer MAX_WAIT_MS diye limit kora
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "*/*"
    },
    validateStatus: () => true
  });

  const ct = String(up.headers["content-type"] || "");
  const chunks = [];
  let bytes = 0;
  await new Promise((resolve, reject) => {
    up.data.on("data", (c) => { chunks.push(c); bytes += c.length; onChunk && onChunk(bytes); });
    up.data.on("end", resolve);
    up.data.on("error", reject);
  });
  const body = Buffer.concat(chunks);

  if (up.status >= 400) {
    throw new Error(`Upstream error ${up.status}: ${body.toString("utf8").slice(0, 200)}`);
  }

  // Case 1: upstream sorasori image bytes pathay (header ba magic bytes diye check)
  const sniffed = sniffImageType(body);
  if (sniffed || ct.startsWith("image/")) {
    return { buffer: body, contentType: sniffed || ct };
  }

  // Case 2: JSON / SSE / text — modhye image URL ba base64
  const found = extractImage(body.toString("utf8"));
  if (!found) throw new Error("Upstream returned no image");
  if (found.buffer) return found;

  const img = await axios.get(found.url, { responseType: "arraybuffer", timeout: 60000, signal });
  return {
    buffer: Buffer.from(img.data),
    contentType: img.headers["content-type"] || "image/jpeg"
  };
}

async function handler(req, res) {
  noCache(res);
  const src = { ...req.query, ...(req.body && typeof req.body === "object" ? req.body : {}) };
  const { url, prompt } = src;

  if (!url || !prompt) {
    return res.status(400).json({
      status: false, creator: CREATOR,
      message: "Both 'url' (image URL) and 'prompt' are required"
    });
  }
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ status: false, creator: CREATOR, message: "Invalid image URL" });
  }

  const streaming = String(src.stream ?? "1") !== "0";
  const ac = new AbortController();
  const started = Date.now();
  let bytes = 0;
  let finished = false;

  const timeout = setTimeout(() => ac.abort(), MAX_WAIT_MS);
  res.on("close", () => { if (!finished) ac.abort(); }); // client chole gele upstream bondho

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let ticker = null;
  if (streaming) {
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no" // nginx buffering off
    });
    res.flushHeaders();
    send("start", { status: "started", creator: CREATOR });
    ticker = setInterval(() => {
      send("progress", {
        status: "processing",
        elapsed: Math.round((Date.now() - started) / 1000),
        bytes
      });
    }, 3000);
  }

  try {
    const { buffer, contentType } = await runEdit({
      url, prompt, signal: ac.signal, onChunk: (b) => { bytes = b; }
    });
    const proxy = cacheBufferMedia(req, buffer, contentType, extFromType(contentType));
    const payload = { status: "success", creator: CREATOR, result: { url: proxy } };
    finished = true;
    if (streaming) { send("result", payload); res.end(); }
    else res.json(payload);
  } catch (err) {
    finished = true;
    const message = ac.signal.aborted ? "Timed out while editing image" : (err.message || "Failed to edit image");
    if (streaming) { send("error", { status: false, creator: CREATOR, message }); res.end(); }
    else if (!res.headersSent) res.status(500).json({ status: false, creator: CREATOR, message });
  } finally {
    clearTimeout(timeout);
    if (ticker) clearInterval(ticker);
  }
}

router.get("/api/editimg", handler);
router.post("/api/editimg", handler);

module.exports = router;
