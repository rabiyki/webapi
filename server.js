const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { PORT } = require("./src/config");
const { connectDB } = require("./src/db");
const { banMiddleware, logMiddleware, loadBans } = require("./src/utils/ipGuard");
const { startAdminBot } = require("./src/utils/adminBot");
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
const editImgRouter = require("./src/routes/editimg"); // NEW: GET|POST /api/editimg (streamed AI image edit)
const hd2Router = require("./src/routes/hd2"); // GET|POST /api/hd2?url= (HD image enhance)
const neuropairRouter = require("./src/routes/neuropair");
const shortenRouter = require("./src/routes/shortlink"); // URL shortener (/api/shorten)
const sessionIdRouter = require("./src/routes/sessionid"); // GET /api/sessionid?number= (RabbitXMD session-id)
const ffGroupRouter = require("./src/routes/ffgrp"); // GET|POST /api/ffgrp?command=5g|6g&number=UID (Telegram emote bot)
const infoRouter = require("./src/routes/info"); // GET|POST /api/info?number=ID (Telegram info bot → file content)
const proxyRouter = require("./src/routes/proxy"); // short-link stream proxy — MUST stay last
const qrRouter = require("./src/routes/qr");
const wapairRouter = require("./src/routes/wapair"); // GET /pair  GET /qr (Ably-backed, least-sessions)
const gdriveRouter = require("./src/routes/gdrive");
const web2apkRouter = require("./src/routes/web2apk");
const reactQueueRouter = require("./src/routes/reactQueue"); // GET /react, /react/poll, /react/ack, /checkreact (in-memory only)

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

// IP ban + request log: must come before all routes
app.use(banMiddleware);
app.use(logMiddleware);

// Needed for /api/neuropair/pair, which accepts { phone, imageBase64 } as JSON.
// (Other routes use multer for multipart uploads and don't need this.)
app.use(express.json({ limit: "25mb" }));

// Static frontend files (e.g. /fullpp.html serves public/fullpp.html directly).
// A friendlier /fullpp route is also mounted in src/routes/pages.js.
app.use(express.static(__dirname + "/public"));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MONGODB
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
connectDB()
  .then(async () => {
    await loadBans();
    startAdminBot();
  })
  .catch((err) => {
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
app.use(editImgRouter); // NEW
app.use(hd2Router); // HD enhance
app.use(neuropairRouter);
app.use(shortenRouter); // URL shortener
app.use(reactQueueRouter); // must be BEFORE proxyRouter, or its /:code catch-all swallows /react & /checkreact
app.use(qrRouter);
app.use(gdriveRouter);
app.use(web2apkRouter);
app.use(sessionIdRouter);
app.use(ffGroupRouter);
app.use(infoRouter);
app.use(wapairRouter); // GET /pair  GET /qr  — Ably multi-server, least-sessions
app.use(proxyRouter); // short-link stream proxy — must be mounted LAST

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
