const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const { CONFIG } = require('../config');

// ─── Generate N wallets with random SOL allocation (broken-stick method) ───────
function createWallets(count, totalSol) {
  if (count < 1 || count > CONFIG.trading.maxWallets) {
    throw new Error(`Wallet count must be 1-${CONFIG.trading.maxWallets}`);
  }

  const allocations = randomAllocations(count, totalSol);
  const keypairMap = new Map();
  const wallets = [];

  for (let i = 0; i < count; i++) {
    const kp = Keypair.generate();
    const pk = kp.publicKey.toBase58();
    keypairMap.set(pk, kp);
    wallets.push({
      index: i + 1,
      publicKey: pk,
      secretKeyB58: bs58.encode(kp.secretKey),
      solAllocated: allocations[i],
      distributed: false,
      bought: false,
      reclaimed: false,
      tokenBalance: null,
      currentValueSol: null,
      pnlSol: null,
      pnlPct: null,
      buyTx: null,
      distributeTx: null,
      reclaimTx: null,
    });
  }

  return { wallets, keypairMap };
}

// Broken-stick: generates N random allocations that sum to totalSol
// with a minimum floor per wallet
function randomAllocations(count, total) {
  const minPerWallet = 0.001;
  const distributable = total - minPerWallet * count;

  if (distributable <= 0) {
    return new Array(count).fill(Math.round(total / count * 10000) / 10000);
  }

  const breaks = Array.from({ length: count - 1 }, () => Math.random()).sort((a, b) => a - b);
  const intervals = [breaks[0]];
  for (let i = 1; i < breaks.length; i++) intervals.push(breaks[i] - breaks[i - 1]);
  intervals.push(1 - breaks[breaks.length - 1]);

  return intervals.map(f => Math.round((minPerWallet + f * distributable) * 10000) / 10000);
}

module.exports = { createWallets };
