const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { PORT } = require("./src/config");
const { connectDB } = require("./src/db");
const { warmConnections } = require("./src/utils/http");
const { attachSocketHandlers } = require("./src/socket");

// Routers
const pagesRouter = require("./src/routes/pages");
const channelRouter = require("./src/routes/channel");
const pairRouter = require("./src/routes/pair");
const downloadRouter = require("./src/routes/download");
const socialRouter = require("./src/routes/social");
const songRouter = require("./src/routes/song");
const searchRouter = require("./src/routes/search");
const spotifyRouter = require("./src/routes/spotify");
const pinterestRouter = require("./src/routes/pinterest");
const toolsRouter = require("./src/routes/tools");
const cdnRouter = require("./src/routes/cdn");
const ghibliRouter = require("./src/routes/ghibli");
const neuropairRouter = require("./src/routes/neuropair");
const shortenRouter = require("./src/routes/shortlink"); // URL shortener (/api/shorten)
const proxyRouter = require("./src/routes/proxy"); // short-link stream proxy — MUST stay last
const qrRouter = require("./src/routes/qr");
const app = express();
app.disable("x-powered-by");

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 20000,
  pingInterval: 15000
});

global.botSockets = new Map();

app.set("trust proxy", true);

// Needed for /api/neuropair/pair, which accepts { phone, imageBase64 } as JSON.
// (Other routes use multer for multipart uploads and don't need this.)
app.use(express.json({ limit: "25mb" }));

// Static frontend files (e.g. /fullpp.html serves public/fullpp.html directly).
// A friendlier /fullpp route is also mounted in src/routes/pages.js.
app.use(express.static(__dirname + "/public"));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MONGODB
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
connectDB().catch((err) => {
  console.error("❌ MongoDB connection failed:", err.message);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MOUNT ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.use(pagesRouter);
app.use(channelRouter);
app.use(pairRouter);
app.use(downloadRouter);
app.use(socialRouter);
app.use(songRouter);
app.use(searchRouter);
app.use(spotifyRouter);
app.use(pinterestRouter);
app.use(toolsRouter);
app.use(cdnRouter);
app.use(ghibliRouter);
app.use(neuropairRouter);
app.use(shortenRouter); // URL shortener
app.use(proxyRouter); // short-link stream proxy — must be mounted LAST
app.use(qrRouter);
// ⚠️ TEMPORARY DIAGNOSTIC ROUTE — remove after debugging
// If curl to /test1 shows "DIRECT HIT", basic routing works fine and
// the problem is specific to proxy.js's custom regex param.
// If it still 404s, something is intercepting the request before this.


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SOCKET.IO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
attachSocketHandlers(io);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTO MEMORY CLEANUP — 30s
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
setInterval(() => {
  // Dead socket cleanup
  for (const [id, bot] of global.botSockets.entries()) {
    if (!bot.socket.connected) {
      global.botSockets.delete(id);
    }
  }

  // Force GC if exposed
  if (global.gc) {
    try { global.gc(); } catch (_) {}
  }

  console.clear();
}, 30000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 START
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  warmConnections();
  // Keep the keep-alive sockets warm every 4 minutes
  setInterval(warmConnections, 4 * 60 * 1000);
});
