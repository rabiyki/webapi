const mongoose = require("mongoose");

// One document per request. MongoDB deletes them automatically after 14 days (TTL index).
const schema = new mongoose.Schema({
  ip:     { type: String, index: true },
  method: String,
  path:   { type: String, index: true },
  status: Number,
  ms:     Number,
  createdAt: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 14 }
});

module.exports = mongoose.model("RequestLog", schema);
