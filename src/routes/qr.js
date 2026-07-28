const express = require("express");
const router = express.Router();
const QRCode = require("qrcode"); // npm i qrcode
const { CREATOR } = require("../config");
const { noCache } = require("../utils/http");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🐇 QR CODE GENERATOR: /api/qr
//    - GET /api/qr?text=...                    -> returns a PNG image directly
//                                                  (embeddable: <img src="/api/qr?text=...">)
//    - GET /api/qr?text=...&json=true           -> returns JSON with base64 data URI
//    - GET /api/qr?text=...&format=svg          -> returns an SVG image directly
//
//    Optional params: size (default 300), margin (default 2),
//    color (foreground, hex, default "000000"), bgcolor (hex, default "ffffff"),
//    ecc (error correction: L, M, Q, H — default "M")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseOptions(req) {
  const size = Math.min(Math.max(parseInt(req.query.size) || 300, 50), 2000);
  const margin = Math.min(Math.max(parseInt(req.query.margin) ?? 2, 0), 10);
  const ecc = ["L", "M", "Q", "H"].includes((req.query.ecc || "").toUpperCase())
    ? req.query.ecc.toUpperCase()
    : "M";

  const fg = /^[0-9a-fA-F]{6}$/.test(req.query.color || "") ? `#${req.query.color}` : "#000000";
  const bg = /^[0-9a-fA-F]{6}$/.test(req.query.bgcolor || "") ? `#${req.query.bgcolor}` : "#ffffff";

  return {
    width: size,
    margin,
    errorCorrectionLevel: ecc,
    color: { dark: fg, light: bg }
  };
}

router.all("/api/qr", async (req, res) => {
  noCache(res);
  const text = req.query.text || (req.body && req.body.text);

  if (!text) {
    return res.status(400).json({
      success: false,
      code: 400,
      creator: CREATOR,
      message: "Provide a ?text= parameter (the content to encode)"
    });
  }

  if (text.length > 2000) {
    return res.status(400).json({
      success: false,
      code: 400,
      creator: CREATOR,
      message: "Text is too long to encode as a QR code (max 2000 characters)"
    });
  }

  const opts = parseOptions(req);
  const wantsSvg = (req.query.format || "").toLowerCase() === "svg";
  const wantsJson = req.query.json === "true" || req.query.json === "1";

  try {
    if (wantsJson) {
      const dataUrl = await QRCode.toDataURL(text, opts);
      return res.json({
        success: true,
        code: 200,
        creator: CREATOR,
        result: {
          text,
          image: dataUrl,
          size: opts.width
        }
      });
    }

    if (wantsSvg) {
      const svg = await QRCode.toString(text, { ...opts, type: "svg" });
      res.setHeader("Content-Type", "image/svg+xml");
      return res.send(svg);
    }

    const buffer = await QRCode.toBuffer(text, opts);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);

  } catch (e) {
    console.error("[qr] generation failed:", e.message);
    return res.status(500).json({
      success: false,
      code: 500,
      creator: CREATOR,
      message: "Could not generate QR code. Please try again.",
      debug: e.message // ⚠️ TEMPORARY — remove after debugging
    });
  }
});

module.exports = router;
