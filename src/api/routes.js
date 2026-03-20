const express = require('express');
const { connection, wallet } = require('../core/connection');
const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createWallets } = require('../bundler/walletFactory');
const { distribute } = require('../bundler/distributor');
const { executeBuys } = require('../bundler/buyExecutor');
const { sellWallet, sellAll, reclaimAll } = require('../bundler/sellExecutor');
const bundleState = require('../state/bundleState');
const newTokensFeed = require('../feeds/newTokensFeed');
const trendingFeed = require('../feeds/trendingFeed');

const router = express.Router();

// ─── Health ───────────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    const w = wallet;
    const balance = await connection.getBalance(w.publicKey);
    res.json({
      ok: true,
      wallet: w.publicKey.toBase58(),
      balanceSol: Math.round(balance / LAMPORTS_PER_SOL * 10000) / 10000,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Bundle Status ────────────────────────────────────────────────────────────
router.get('/bundle/status', (req, res) => {
  res.json({ bundle: bundleState.getPublicState() });
});

// ─── Create Bundle ────────────────────────────────────────────────────────────
// Body: { ca: string, solAmount: number, walletCount: number }
router.post('/bundle/create', async (req, res) => {
  try {
    const { ca, solAmount, walletCount } = req.body;

    if (!ca || typeof ca !== 'string' || ca.length < 32) {
      return res.status(400).json({ error: 'Invalid contract address' });
    }
    if (!solAmount || isNaN(solAmount) || solAmount <= 0) {
      return res.status(400).json({ error: 'Invalid SOL amount' });
    }
    if (!walletCount || isNaN(walletCount) || walletCount < 1 || walletCount > 30) {
      return res.status(400).json({ error: 'Wallet count must be 1-30' });
    }

    // Check for existing active bundle
    const existing = bundleState.getState();
    if (existing && existing.status !== 'idle' && existing.status !== 'error') {
      return res.status(409).json({
        error: `Bundle already active (${existing.status}). Cancel it first.`,
      });
    }

    const { wallets, keypairMap } = createWallets(parseInt(walletCount), parseFloat(solAmount));
    bundleState.createBundle(ca, parseInt(walletCount), parseFloat(solAmount), wallets, keypairMap);

    res.json({ ok: true, bundle: bundleState.getPublicState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Distribute SOL ───────────────────────────────────────────────────────────
router.post('/bundle/distribute', (req, res) => {
  res.json({ ok: true, message: 'Distribution started' });
  distribute().catch(err => {
    console.error(`Distribute error: ${err.message}`);
    bundleState.setError(err.message);
  });
});

// ─── Execute Buys ─────────────────────────────────────────────────────────────
// Body: { mode: 'jito' | 'sequential' }
router.post('/bundle/buy', (req, res) => {
  const mode = req.body?.mode === 'sequential' ? 'sequential' : 'jito';
  res.json({ ok: true, message: `Buys started (${mode} mode)` });
  executeBuys(mode).catch(err => {
    console.error(`Buy error: ${err.message}`);
    bundleState.setError(err.message);
  });
});

// ─── Sell (single or all) ─────────────────────────────────────────────────────
// Body: { walletPublicKey?: string }  — omit for sell-all
router.post('/bundle/sell', (req, res) => {
  const { walletPublicKey } = req.body || {};

  if (walletPublicKey) {
    res.json({ ok: true, message: 'Sell started' });
    sellWallet(walletPublicKey)
      .then(sig => console.log(`Sold wallet ${walletPublicKey.slice(0, 8)}: ${sig}`))
      .catch(err => {
        console.error(`Sell error: ${err.message}`);
        bundleState.setError(err.message);
      });
  } else {
    res.json({ ok: true, message: 'Sell all started' });
    sellAll()
      .then(result => console.log(`Sell all: ${result.sold} sold, ${result.failed} failed`))
      .catch(err => {
        console.error(`Sell all error: ${err.message}`);
        bundleState.setError(err.message);
      });
  }
});

// ─── Reclaim SOL & clear bundle ───────────────────────────────────────────────
router.post('/bundle/reclaim', (req, res) => {
  res.json({ ok: true, message: 'Reclaim started' });
  reclaimAll().catch(err => {
    console.error(`Reclaim error: ${err.message}`);
    bundleState.setError(err.message);
  });
});

// ─── Cancel / Delete bundle ───────────────────────────────────────────────────
router.delete('/bundle', async (req, res) => {
  try {
    bundleState.clearBundle();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Feeds ────────────────────────────────────────────────────────────────────
router.get('/feeds/new', (req, res) => {
  res.json({ tokens: newTokensFeed.getTokens() });
});

router.get('/feeds/trending', (req, res) => {
  res.json({ tokens: trendingFeed.getTokens() });
});

module.exports = router;
