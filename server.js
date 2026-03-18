require('dotenv').config();
const http = require('http');
const express = require('express');
const path = require('path');
const { CONFIG } = require('./src/config');

const broadcaster = require('./src/ws/broadcaster');
const bundleState = require('./src/state/bundleState');
const pnlTracker = require('./src/bundler/pnlTracker');
const newTokensFeed = require('./src/feeds/newTokensFeed');
const trendingFeed = require('./src/feeds/trendingFeed');
const { flushSync } = require('./src/state/persistence');
const apiRoutes = require('./src/api/routes');

// ─── Express Setup ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);

// ─── HTTP + WebSocket Server ──────────────────────────────────────────────────
const server = http.createServer(app);
broadcaster.init(server);

// ─── Wire broadcast into state ────────────────────────────────────────────────
bundleState.init((type, data) => broadcaster.broadcast(type, data));

// ─── Start feeds ──────────────────────────────────────────────────────────────
newTokensFeed.start((type, data) => broadcaster.broadcast(type, data));
trendingFeed.start((type, data) => broadcaster.broadcast(type, data));

// ─── Start PNL tracker ────────────────────────────────────────────────────────
pnlTracker.start();

// ─── Listen ───────────────────────────────────────────────────────────────────
server.listen(CONFIG.port, () => {
  console.log(`\nThe Bundloor running at http://localhost:${CONFIG.port}\n`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown() {
  console.log('\nShutting down...');
  newTokensFeed.stop();
  trendingFeed.stop();
  pnlTracker.stop();
  flushSync();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
