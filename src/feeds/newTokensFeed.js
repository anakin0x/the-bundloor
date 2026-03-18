const WebSocket = require('ws');

const PUMP_WS = 'wss://pumpportal.fun/api/data';
const MAX_TOKENS = 50;

let _ws = null;
let _reconnect = true;
let _broadcast = null;
const _tokens = []; // newest first

function start(broadcastFn) {
  _broadcast = broadcastFn;
  _reconnect = true;
  _connect();
}

function stop() {
  _reconnect = false;
  if (_ws) { _ws.removeAllListeners(); _ws.close(); _ws = null; }
}

function getTokens() { return _tokens.slice(); }

function _connect() {
  _ws = new WebSocket(PUMP_WS);

  _ws.on('open', () => {
    console.log('PumpPortal WS connected');
    _ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
  });

  _ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.txType === 'create') _handleNewToken(msg);
    } catch {}
  });

  _ws.on('error', (err) => console.error(`PumpPortal WS error: ${err.message}`));

  _ws.on('close', (code) => {
    _ws = null;
    if (_reconnect) {
      console.log(`PumpPortal WS closed (${code}), reconnecting in 5s...`);
      setTimeout(_connect, 5000);
    }
  });
}

function _handleNewToken(data) {
  const token = {
    mint: data.mint,
    name: data.name || 'Unknown',
    symbol: data.symbol || '???',
    creator: data.traderPublicKey || '',
    marketCapSol: data.marketCapSol || data.vSolInBondingCurve || 0,
    initialBuy: data.initialBuy || 0,
    timestamp: Date.now(),
  };

  _tokens.unshift(token);
  if (_tokens.length > MAX_TOKENS) _tokens.pop();

  if (_broadcast) _broadcast('new_token', token);
}

module.exports = { start, stop, getTokens };
