const axios = require('axios');
const { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const { CONFIG } = require('../config');

// ─── Submit a Jito bundle ──────────────────────────────────────────────────────
// transactions: array of signed Transaction objects
// funderKeypair: Keypair that pays the Jito tip
// connection: Solana Connection
async function submitJitoBundle(connection, transactions, funderKeypair) {
  if (!transactions.length) throw new Error('No transactions to bundle');
  if (transactions.length > 5) throw new Error('Jito max 5 transactions per bundle');

  // Fetch blockhash once — all txs must use the same one
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  // Set blockhash on all transactions
  for (const tx of transactions) {
    if (!tx.recentBlockhash) {
      tx.recentBlockhash = blockhash;
    }
  }

  // Build tip transaction (last in bundle)
  const tipAccount = new PublicKey(
    CONFIG.jito.tipAccounts[Math.floor(Math.random() * CONFIG.jito.tipAccounts.length)]
  );

  const tipTx = new Transaction();
  tipTx.add(SystemProgram.transfer({
    fromPubkey: funderKeypair.publicKey,
    toPubkey: tipAccount,
    lamports: CONFIG.jito.tipLamports,
  }));
  tipTx.recentBlockhash = blockhash;
  tipTx.feePayer = funderKeypair.publicKey;
  tipTx.sign(funderKeypair);

  const allTxs = [...transactions, tipTx];

  // Serialize all to base58
  const serialized = allTxs.map(tx => bs58.encode(tx.serialize({ requireAllSignatures: false })));

  // Submit to Jito
  const url = `${CONFIG.jito.blockEngineUrl}/api/v1/bundles`;
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [serialized],
  };

  const res = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const bundleId = res.data?.result;
  if (!bundleId) throw new Error(`Jito returned no bundle ID: ${JSON.stringify(res.data)}`);

  console.log(`  Jito bundle submitted: ${bundleId}`);

  // Poll for confirmation (up to 30s)
  const confirmed = await pollBundleStatus(bundleId, 30000);
  return { bundleId, confirmed, blockhash, lastValidBlockHeight };
}

async function pollBundleStatus(bundleId, timeoutMs = 30000) {
  const url = `${CONFIG.jito.blockEngineUrl}/api/v1/bundles/${bundleId}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await axios.get(url, { timeout: 5000 });
      const status = res.data?.result?.confirmation_status;
      if (status === 'confirmed' || status === 'processed' || status === 'finalized') {
        console.log(`  Jito bundle ${bundleId.slice(0, 8)}... status: ${status}`);
        return true;
      }
    } catch {
      // Keep polling
    }
  }

  console.log(`  Jito bundle ${bundleId.slice(0, 8)}... timed out`);
  return false;
}

module.exports = { submitJitoBundle };
