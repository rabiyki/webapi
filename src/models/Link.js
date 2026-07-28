const mongoose = require("mongoose");

const linkSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  url:  { type: String, required: true, index: true },
  hash: { type: String, index: true, sparse: true }, // content hash, used for duplicate-file detection
  type: { type: String, enum: ["file", "redirect"], default: "file" }, // "file" = stream/proxy (old behavior), "redirect" = plain URL shortener
  hits: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Link", linkSchema);
