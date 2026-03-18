const { loadBundle, saveBundle } = require('./persistence');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

// ─── In-Memory Bundle State ────────────────────────────────────────────────────
// Status machine: idle → distributing → distributed → buying → active → selling → idle
//                                                         └──────────────→ error

let _state = null;         // BundleState object (with secretKeyB58 in wallets)
let _keypairs = new Map(); // publicKey (string) → Keypair
let _broadcast = null;     // (type, data) => void

// Restore state from disk on startup
function init(broadcastFn) {
  _broadcast = broadcastFn;
  const saved = loadBundle();
  if (saved && saved.status !== 'idle') {
    _state = saved;
    _rehydrateKeypairs();
    console.log(`Bundle restored: ${saved.mint} (${saved.status}, ${saved.wallets.length} wallets)`);
  }
}

function _rehydrateKeypairs() {
  if (!_state) return;
  _keypairs.clear();
  for (const w of _state.wallets) {
    try {
      _keypairs.set(w.publicKey, Keypair.fromSecretKey(bs58.decode(w.secretKeyB58)));
    } catch (err) {
      console.error(`Failed to rehydrate keypair ${w.publicKey}: ${err.message}`);
    }
  }
}

function _persist() {
  if (_state) _state.updatedAt = Date.now();
  saveBundle(_state);
}

function _emit() {
  if (_broadcast) _broadcast('bundle_state', getPublicState());
}

function setStatus(status) {
  if (!_state) return;
  _state.status = status;
  _state.error = undefined;
  _persist();
  _emit();
}

function setError(msg) {
  if (!_state) return;
  _state.status = 'error';
  _state.error = msg;
  _persist();
  _emit();
}

function getState() { return _state; }

function getKeypair(publicKey) { return _keypairs.get(publicKey); }

// Returns state without private keys (safe to send to frontend)
function getPublicState() {
  if (!_state) return null;
  return {
    ..._state,
    wallets: _state.wallets.map(({ secretKeyB58, ...rest }) => rest),
  };
}

function createBundle(mint, walletCount, totalSol, wallets, keypairMap) {
  _keypairs = keypairMap;
  _state = {
    mint,
    status: 'idle',
    totalSol,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wallets,
  };
  _persist();
  _emit();
}

function updateWallet(publicKey, updates) {
  if (!_state) return;
  const w = _state.wallets.find(w => w.publicKey === publicKey);
  if (w) Object.assign(w, updates);
  _persist();
  _emit();
}

function updateWalletPnl(publicKey, pnl) {
  if (!_state) return;
  const w = _state.wallets.find(w => w.publicKey === publicKey);
  if (w) {
    w.currentValueSol = pnl.currentValueSol;
    w.pnlSol = pnl.pnlSol;
    w.pnlPct = pnl.pnlPct;
    w.tokenBalance = pnl.tokenBalance;
  }
  // PNL updates don't need full persist — only broadcast
  _emit();
}

function clearBundle() {
  _state = null;
  _keypairs.clear();
  saveBundle(null);
  _emit();
}

module.exports = {
  init,
  setStatus,
  setError,
  getState,
  getKeypair,
  getPublicState,
  createBundle,
  updateWallet,
  updateWalletPnl,
  clearBundle,
};
