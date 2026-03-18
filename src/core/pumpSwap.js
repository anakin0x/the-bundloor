const {
  PublicKey, Transaction, TransactionInstruction,
  SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress, createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const { CONFIG } = require('../config');

// ─── Pump.fun Program Constants ───────────────────────────────────────────────
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_FEE = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJ5Nmhcdo1so');
const PUMP_EVENT_AUTH = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const SYSTEM_PROGRAM = SystemProgram.programId;
const RENT_PROGRAM = new PublicKey('SysvarRent111111111111111111111111111111111');

const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// ─── Bonding Curve State Reader ────────────────────────────────────────────────
async function getBondingCurveState(connection, bondingCurve) {
  const info = await connection.getAccountInfo(bondingCurve);
  if (!info || !info.data || info.data.length < 49) return null;
  const d = info.data;
  return {
    virtualTokenReserves: d.readBigUInt64LE(8),
    virtualSolReserves: d.readBigUInt64LE(16),
    realTokenReserves: d.readBigUInt64LE(24),
    realSolReserves: d.readBigUInt64LE(32),
    tokenTotalSupply: d.readBigUInt64LE(40),
    complete: d[48] === 1,
  };
}

// ─── AMM Math ─────────────────────────────────────────────────────────────────
function calculateBuyTokens(virtualSolReserves, virtualTokenReserves, solIn) {
  const fee = solIn / 100n;
  const solAfterFee = solIn - fee;
  const num = virtualTokenReserves * solAfterFee;
  const den = virtualSolReserves + solAfterFee;
  return num / den;
}

function calculateSellSol(virtualSolReserves, virtualTokenReserves, tokenIn) {
  const num = virtualSolReserves * tokenIn;
  const den = virtualTokenReserves + tokenIn;
  const solOut = num / den;
  const fee = solOut / 100n;
  return solOut - fee;
}

// ─── Derive Bonding Curve PDA ──────────────────────────────────────────────────
function getBondingCurvePDA(mintPk) {
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintPk.toBuffer()],
    PUMP_PROGRAM
  );
  return bondingCurve;
}

// ─── Build Buy Transaction (unsigned) ─────────────────────────────────────────
// Returns a Transaction ready to be signed and sent, or null on error.
async function buildBuyTransaction(connection, buyerKeypair, mint, amountSol, slippagePct) {
  try {
    const mintPk = new PublicKey(mint);
    const amountLamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));

    const bondingCurve = getBondingCurvePDA(mintPk);
    const bondingCurveAta = await getAssociatedTokenAddress(mintPk, bondingCurve, true);
    const buyerAta = await getAssociatedTokenAddress(mintPk, buyerKeypair.publicKey);

    const curveState = await getBondingCurveState(connection, bondingCurve);
    if (!curveState) return { tx: null, error: 'Could not read bonding curve' };
    if (curveState.complete) return { tx: null, error: 'Token already migrated' };

    const expectedTokens = calculateBuyTokens(
      curveState.virtualSolReserves,
      curveState.virtualTokenReserves,
      amountLamports
    );
    if (expectedTokens <= 0n) return { tx: null, error: 'Zero tokens expected' };

    const minTokens = expectedTokens * BigInt(100 - slippagePct) / 100n;
    const maxSolCost = amountLamports + (amountLamports * 2n / 100n);

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: CONFIG.trading.priorityFeeMicroLamports,
    }));

    // Create ATA if needed
    const ataInfo = await connection.getAccountInfo(buyerAta);
    if (!ataInfo) {
      tx.add(createAssociatedTokenAccountInstruction(
        buyerKeypair.publicKey, buyerAta, buyerKeypair.publicKey, mintPk
      ));
    }

    const buyData = Buffer.alloc(8 + 8 + 8);
    BUY_DISCRIMINATOR.copy(buyData, 0);
    buyData.writeBigUInt64LE(minTokens, 8);
    buyData.writeBigUInt64LE(maxSolCost, 16);

    tx.add(new TransactionInstruction({
      programId: PUMP_PROGRAM,
      keys: [
        { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMP_FEE, isSigner: false, isWritable: true },
        { pubkey: mintPk, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
        { pubkey: buyerAta, isSigner: false, isWritable: true },
        { pubkey: buyerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: RENT_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: PUMP_EVENT_AUTH, isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: buyData,
    }));

    return { tx, expectedTokens, error: null };
  } catch (err) {
    return { tx: null, error: err.message };
  }
}

// ─── Execute Buy (single wallet) ──────────────────────────────────────────────
async function executeBuy(connection, buyerKeypair, mint, amountSol, slippagePct) {
  const { tx, error } = await buildBuyTransaction(connection, buyerKeypair, mint, amountSol, slippagePct);
  if (!tx) return { sig: null, error };

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = buyerKeypair.publicKey;
  tx.sign(buyerKeypair);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });

  try {
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  } catch {
    // May still land
  }

  return { sig, error: null };
}

// ─── Execute Sell (single wallet) ─────────────────────────────────────────────
async function executeSell(connection, sellerKeypair, mint, tokenAmount, slippagePct) {
  try {
    const mintPk = new PublicKey(mint);
    const bondingCurve = getBondingCurvePDA(mintPk);
    const bondingCurveAta = await getAssociatedTokenAddress(mintPk, bondingCurve, true);
    const sellerAta = await getAssociatedTokenAddress(mintPk, sellerKeypair.publicKey);

    const curveState = await getBondingCurveState(connection, bondingCurve);
    if (!curveState) return { sig: null, error: 'Could not read bonding curve' };
    if (curveState.complete) return { sig: null, error: 'Token migrated — use Jupiter' };

    const expectedSol = calculateSellSol(
      curveState.virtualSolReserves,
      curveState.virtualTokenReserves,
      tokenAmount
    );
    const minSol = expectedSol * BigInt(100 - slippagePct) / 100n;

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: CONFIG.trading.priorityFeeMicroLamports,
    }));

    const sellData = Buffer.alloc(8 + 8 + 8);
    SELL_DISCRIMINATOR.copy(sellData, 0);
    sellData.writeBigUInt64LE(tokenAmount, 8);
    sellData.writeBigUInt64LE(minSol, 16);

    tx.add(new TransactionInstruction({
      programId: PUMP_PROGRAM,
      keys: [
        { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMP_FEE, isSigner: false, isWritable: true },
        { pubkey: mintPk, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
        { pubkey: sellerAta, isSigner: false, isWritable: true },
        { pubkey: sellerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: PUMP_EVENT_AUTH, isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: sellData,
    }));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = sellerKeypair.publicKey;
    tx.sign(sellerKeypair);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    try {
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    } catch {
      // May still land
    }

    return { sig, error: null };
  } catch (err) {
    return { sig: null, error: err.message };
  }
}

// ─── Read current value of tokens for PNL ─────────────────────────────────────
async function getTokenCurrentValue(connection, mint, tokenAmount) {
  try {
    const mintPk = new PublicKey(mint);
    const bondingCurve = getBondingCurvePDA(mintPk);
    const curveState = await getBondingCurveState(connection, bondingCurve);
    if (!curveState || curveState.complete) return null;

    const solOut = calculateSellSol(
      curveState.virtualSolReserves,
      curveState.virtualTokenReserves,
      tokenAmount
    );
    return Number(solOut) / LAMPORTS_PER_SOL;
  } catch {
    return null;
  }
}

module.exports = {
  getBondingCurvePDA,
  getBondingCurveState,
  buildBuyTransaction,
  executeBuy,
  executeSell,
  getTokenCurrentValue,
  PUMP_PROGRAM,
};
