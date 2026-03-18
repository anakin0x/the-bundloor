const { connection, wallet } = require('../core/connection');
const { buildBuyTransaction, executeBuy } = require('../core/pumpSwap');
const { submitJitoBundle } = require('../core/jitoBundle');
const bundleState = require('../state/bundleState');
const { CONFIG } = require('../config');

const WALLETS_PER_BUNDLE = 4; // +1 tip tx = 5 max per Jito bundle

// ─── Execute buys for all wallets ─────────────────────────────────────────────
// mode: 'jito' (atomic bundle) | 'sequential' (one by one, safer)
async function executeBuys(mode = 'jito') {
  const state = bundleState.getState();
  if (!state) throw new Error('No bundle');

  const undistributed = state.wallets.filter(w => !w.distributed);
  if (undistributed.length > 0) {
    throw new Error(`${undistributed.length} wallets not funded. Run distribute first.`);
  }

  bundleState.setStatus('buying');

  const pending = state.wallets.filter(w => !w.bought);
  if (pending.length === 0) {
    bundleState.setStatus('active');
    return;
  }

  let successes = 0;

  if (mode === 'jito') {
    successes = await executeJitoBuys(pending, state.mint);
  } else {
    successes = await executeSequentialBuys(pending, state.mint);
  }

  if (successes === 0) {
    bundleState.setError('All buys failed');
  } else {
    console.log(`Buys complete: ${successes}/${pending.length}`);
    bundleState.setStatus('active');
  }
}

// ─── Jito bundle mode ─────────────────────────────────────────────────────────
async function executeJitoBuys(wallets, mint) {
  let successes = 0;
  const funderWallet = wallet;

  // Chunk into groups of WALLETS_PER_BUNDLE
  for (let i = 0; i < wallets.length; i += WALLETS_PER_BUNDLE) {
    const chunk = wallets.slice(i, i + WALLETS_PER_BUNDLE);
    const transactions = [];
    const chunkWallets = [];

    // Fetch ONE blockhash for the whole chunk
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    for (const w of chunk) {
      const kp = bundleState.getKeypair(w.publicKey);
      if (!kp) {
        console.error(`  Missing keypair for ${w.publicKey.slice(0, 8)}`);
        continue;
      }

      const { tx, error } = await buildBuyTransaction(
        connection, kp, mint, w.solAllocated, CONFIG.trading.slippagePct
      );

      if (!tx) {
        console.error(`  Build buy failed for ${w.publicKey.slice(0, 8)}: ${error}`);
        continue;
      }

      tx.recentBlockhash = blockhash;
      tx.feePayer = kp.publicKey;
      tx.sign(kp);

      transactions.push(tx);
      chunkWallets.push(w);
    }

    if (transactions.length === 0) continue;

    try {
      const { confirmed } = await submitJitoBundle(connection, transactions, funderWallet);
      for (const w of chunkWallets) {
        bundleState.updateWallet(w.publicKey, { bought: true, buyTx: 'jito-bundle' });
        successes++;
      }
      console.log(`  Jito chunk ${Math.floor(i / WALLETS_PER_BUNDLE) + 1}: ${confirmed ? 'confirmed' : 'pending'}`);
    } catch (err) {
      console.error(`  Jito chunk failed: ${err.message} — falling back to sequential`);
      // Fallback: try each wallet individually
      for (let j = 0; j < chunkWallets.length; j++) {
        const w = chunkWallets[j];
        const kp = bundleState.getKeypair(w.publicKey);
        if (!kp) continue;
        const { sig, error } = await executeBuy(connection, kp, mint, w.solAllocated, CONFIG.trading.slippagePct);
        if (sig) {
          bundleState.updateWallet(w.publicKey, { bought: true, buyTx: sig });
          successes++;
        } else {
          console.error(`  Sequential fallback failed for ${w.publicKey.slice(0, 8)}: ${error}`);
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  return successes;
}

// ─── Sequential mode ──────────────────────────────────────────────────────────
async function executeSequentialBuys(wallets, mint) {
  let successes = 0;

  for (const w of wallets) {
    const kp = bundleState.getKeypair(w.publicKey);
    if (!kp) {
      console.error(`  Missing keypair for ${w.publicKey.slice(0, 8)}`);
      continue;
    }

    const { sig, error } = await executeBuy(connection, kp, mint, w.solAllocated, CONFIG.trading.slippagePct);

    if (sig) {
      bundleState.updateWallet(w.publicKey, { bought: true, buyTx: sig });
      successes++;
      console.log(`  ${w.publicKey.slice(0, 8)} bought: ${sig.slice(0, 16)}...`);
    } else {
      console.error(`  ${w.publicKey.slice(0, 8)} buy failed: ${error}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  return successes;
}

module.exports = { executeBuys };
