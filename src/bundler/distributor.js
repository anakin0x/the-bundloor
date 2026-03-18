const { SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } = require('@solana/web3.js');
const { PublicKey } = require('@solana/web3.js');
const { connection, wallet } = require('../core/connection');
const bundleState = require('../state/bundleState');
const { CONFIG } = require('../config');

const TRANSFERS_PER_TX = 7;

// ─── Fund all sub-wallets from the funder wallet ───────────────────────────────
async function distribute() {
  const state = bundleState.getState();
  if (!state) throw new Error('No bundle');

  bundleState.setStatus('distributing');

  // Check funder balance
  const funderWallet = wallet;
  const totalNeeded = state.wallets.reduce(
    (sum, w) => sum + w.solAllocated + CONFIG.trading.feeBufferSol, 0
  ) + 0.01; // extra for distribution tx fees

  const balance = await connection.getBalance(funderWallet.publicKey);
  if (balance / LAMPORTS_PER_SOL < totalNeeded) {
    bundleState.setError(
      `Insufficient balance. Need ~${totalNeeded.toFixed(4)} SOL, have ${(balance / LAMPORTS_PER_SOL).toFixed(4)}`
    );
    throw new Error('Insufficient funder balance');
  }

  const pending = state.wallets.filter(w => !w.distributed);
  if (pending.length === 0) {
    bundleState.setStatus('distributed');
    return;
  }

  for (let i = 0; i < pending.length; i += TRANSFERS_PER_TX) {
    const batch = pending.slice(i, i + TRANSFERS_PER_TX);
    const tx = new Transaction();

    for (const w of batch) {
      const lamports = Math.floor((w.solAllocated + CONFIG.trading.feeBufferSol) * LAMPORTS_PER_SOL);
      tx.add(SystemProgram.transfer({
        fromPubkey: funderWallet.publicKey,
        toPubkey: new PublicKey(w.publicKey),
        lamports,
      }));
    }

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [funderWallet]);
      for (const w of batch) {
        bundleState.updateWallet(w.publicKey, { distributed: true, distributeTx: sig });
      }
      console.log(`  Distribution batch ${Math.floor(i / TRANSFERS_PER_TX) + 1}: ${sig}`);
    } catch (err) {
      bundleState.setError(`Distribution failed: ${err.message}`);
      throw err;
    }
  }

  bundleState.setStatus('distributed');
  console.log('Distribution complete');
}

module.exports = { distribute };
