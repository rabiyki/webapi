const mongoose = require("mongoose");

// WhatsApp creds.json — MongoDB nijei 24 ghonta por auto-delete kore (TTL index)
const sessionSchema = new mongoose.Schema({
  sid:       { type: String, required: true, unique: true, index: true },
  creds:     { type: String, required: true }, // creds.json er raw text
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 } // 24h
});

module.exports = mongoose.model("Session", sessionSchema);
