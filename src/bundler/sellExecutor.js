const { PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
const { connection, wallet } = require('../core/connection');
const { executeSell } = require('../core/pumpSwap');
const bundleState = require('../state/bundleState');
const { CONFIG } = require('../config');

// ─── Sell a single wallet's position ──────────────────────────────────────────
async function sellWallet(publicKey) {
  const state = bundleState.getState();
  if (!state) throw new Error('No bundle');

  const w = state.wallets.find(w => w.publicKey === publicKey);
  if (!w) throw new Error('Wallet not found');
  if (!w.bought) throw new Error('Wallet has no position to sell');

  const kp = bundleState.getKeypair(publicKey);
  if (!kp) throw new Error('Keypair not found');

  const mintPk = new PublicKey(state.mint);
  const ata = await getAssociatedTokenAddress(mintPk, kp.publicKey);

  let tokenBalance;
  try {
    const account = await getAccount(connection, ata);
    tokenBalance = account.amount;
  } catch {
    throw new Error('Token account not found — already sold?');
  }

  if (tokenBalance === 0n) throw new Error('No tokens to sell');

  const { sig, error } = await executeSell(
    connection, kp, state.mint, tokenBalance, CONFIG.trading.slippagePct
  );

  if (!sig) throw new Error(error || 'Sell failed');

  bundleState.updateWallet(publicKey, {
    bought: false,
    tokenBalance: '0',
    currentValueSol: 0,
    sellTx: sig,
  });

  console.log(`  Sold ${publicKey.slice(0, 8)}: ${sig.slice(0, 16)}...`);

  // Reclaim leftover SOL
  await reclaimWalletSol(kp);

  return sig;
}

// ─── Sell ALL wallets ─────────────────────────────────────────────────────────
async function sellAll() {
  const state = bundleState.getState();
  if (!state) throw new Error('No bundle');

  bundleState.setStatus('selling');

  const buyers = state.wallets.filter(w => w.bought);
  if (buyers.length === 0) {
    bundleState.setStatus('idle');
    return { sold: 0, failed: 0 };
  }

  let sold = 0;
  let failed = 0;

  for (const w of buyers) {
    try {
      await sellWallet(w.publicKey);
      sold++;
    } catch (err) {
      console.error(`  Sell failed for ${w.publicKey.slice(0, 8)}: ${err.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  bundleState.setStatus('idle');
  console.log(`Sell all complete: ${sold} sold, ${failed} failed`);
  return { sold, failed };
}

// ─── Reclaim SOL from a sub-wallet back to funder ─────────────────────────────
async function reclaimWalletSol(kp) {
  try {
    const balance = await connection.getBalance(kp.publicKey);
    const sendAmount = balance - 5000; // keep 5000 lamports for rent
    if (sendAmount <= 0) return;

    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: wallet.publicKey,
      lamports: sendAmount,
    }));

    const sig = await sendAndConfirmTransaction(connection, tx, [kp]);
    console.log(`  Reclaimed ${(sendAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL from ${kp.publicKey.toBase58().slice(0, 8)}: ${sig.slice(0, 16)}...`);

    bundleState.updateWallet(kp.publicKey.toBase58(), { reclaimed: true, reclaimTx: sig });
  } catch (err) {
    console.error(`  Reclaim failed for ${kp.publicKey.toBase58().slice(0, 8)}: ${err.message}`);
  }
}

// ─── Reclaim SOL from all sub-wallets ─────────────────────────────────────────
async function reclaimAll() {
  const state = bundleState.getState();
  if (!state) throw new Error('No bundle');

  const pending = state.wallets.filter(w => !w.reclaimed);
  for (const w of pending) {
    const kp = bundleState.getKeypair(w.publicKey);
    if (!kp) continue;
    await reclaimWalletSol(kp);
    await new Promise(r => setTimeout(r, 200));
  }

  bundleState.clearBundle();
  console.log('All SOL reclaimed — bundle cleared');
}

module.exports = { sellWallet, sellAll, reclaimAll };
