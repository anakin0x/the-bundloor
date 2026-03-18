const axios = require('axios');

const PUMP_API = 'https://frontend-api.pump.fun';
const POLL_INTERVAL_MS = 10000;
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://pump.fun',
  'Referer': 'https://pump.fun/',
};

let _timer = null;
let _running = false;
let _broadcast = null;
let _tokens = [];

function start(broadcastFn) {
  _broadcast = broadcastFn;
  _running = true;
  _poll();
}

function stop() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

function getTokens() { return _tokens.slice(); }

async function _poll() {
  if (!_running) return;

  try {
    const res = await axios.get(
      `${PUMP_API}/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false`,
      { headers: BROWSER_HEADERS, timeout: 8000 }
    );

    if (res.status === 200 && Array.isArray(res.data)) {
      _tokens = res.data.map(t => ({
        mint: t.mint,
        name: t.name || 'Unknown',
        symbol: t.symbol || '???',
        marketCapSol: t.virtual_sol_reserves
          ? Math.round(t.virtual_sol_reserves / 1e9 * 100) / 100
          : 0,
        usdMarketCap: t.usd_market_cap || 0,
        complete: t.complete || false,
        replies: t.reply_count || 0,
        timestamp: t.last_trade_timestamp || 0,
      }));

      if (_broadcast) _broadcast('trending_update', _tokens.slice(0, 50));
    }
  } catch (err) {
    // Silently fail — pump.fun API can be flaky
    if (err.response?.status !== 403 && err.response?.status !== 429) {
      console.error(`Trending feed error: ${err.message}`);
    }
  }

  if (_running) _timer = setTimeout(_poll, POLL_INTERVAL_MS);
}

module.exports = { start, stop, getTokens };
