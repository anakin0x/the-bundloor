const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const { connection } = require('../core/connection');
const { getBondingCurvePDA, getBondingCurveState, calculateSellSol } = require('../core/pumpSwap');
const bundleState = require('../state/bundleState');

const POLL_INTERVAL_MS = 4000;

let _timer = null;
let _running = false;

function start() {
  if (_running) return;
  _running = true;
  _tick();
}

function stop() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

async function _tick() {
  if (!_running) return;

  const state = bundleState.getState();

  if (state && state.status === 'active') {
    await _pollPnl(state);
  }

  // Guard: stop() may have been called while _pollPnl was running
  if (_running) {
    _timer = setTimeout(_tick, POLL_INTERVAL_MS);
  }
}

async function _pollPnl(state) {
  const buyers = state.wallets.filter(w => w.bought);
  if (buyers.length === 0) return;

  const mintPk = new PublicKey(state.mint);

  // Fetch bonding curve state ONCE — all wallets share the same curve
  let curveState;
  try {
    curveState = await getBondingCurveState(connection, getBondingCurvePDA(mintPk));
  } catch {
    return;
  }
  if (!curveState || curveState.complete) return;

  // Batch: collect all ATA pubkeys for getMultipleAccountsInfo
  const ataKeys = await Promise.all(
    buyers.map(w => getAssociatedTokenAddress(mintPk, new PublicKey(w.publicKey)))
  );

  let ataInfos;
  try {
    ataInfos = await connection.getMultipleAccountsInfo(ataKeys);
  } catch {
    return;
  }

  for (let i = 0; i < buyers.length; i++) {
    const w = buyers[i];
    const ataInfo = ataInfos[i];
    if (!ataInfo) continue;

    // Parse token balance from ATA account data (offset 64, 8 bytes)
    let tokenBalance;
    try {
      tokenBalance = ataInfo.data.readBigUInt64LE(64);
    } catch {
      continue;
    }

    if (tokenBalance === 0n) {
      bundleState.updateWalletPnl(w.publicKey, {
        tokenBalance: '0',
        currentValueSol: 0,
        pnlSol: -(w.solAllocated),
        pnlPct: -100,
      });
      continue;
    }

    // Calculate value from already-fetched curve state — no extra RPC call
    let currentValueSol;
    try {
      const solOut = calculateSellSol(
        curveState.virtualSolReserves,
        curveState.virtualTokenReserves,
        tokenBalance
      );
      currentValueSol = Number(solOut) / LAMPORTS_PER_SOL;
    } catch {
      continue;
    }

    const pnlSol = currentValueSol - w.solAllocated;
    const pnlPct = (pnlSol / w.solAllocated) * 100;

    bundleState.updateWalletPnl(w.publicKey, {
      tokenBalance: tokenBalance.toString(),
      currentValueSol: Math.round(currentValueSol * 100000) / 100000,
      pnlSol: Math.round(pnlSol * 100000) / 100000,
      pnlPct: Math.round(pnlPct * 10) / 10,
    });
  }
}

module.exports = { start, stop };
