const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  ip:     { type: String, required: true, unique: true, index: true },
  reason: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("BannedIP", schema);
