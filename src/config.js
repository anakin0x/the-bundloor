require('dotenv').config();

const CONFIG = {
  rpc: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  ws: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
  privateKey: process.env.PRIVATE_KEY || '',
  jito: {
    blockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.labs.dev',
    tipLamports: parseInt(process.env.JITO_TIP_LAMPORTS || '50000', 10),
    tipAccounts: [
      '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
      'HFqU5x63VTqvB6pKYkvYuPo37KBJT4VQFWQMiLH5iBio',
      'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
      'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1sMXcem8kvK',
    ],
  },
  trading: {
    slippagePct: parseInt(process.env.SLIPPAGE_PCT || '25', 10),
    priorityFeeMicroLamports: parseInt(process.env.PRIORITY_FEE_MICROLAMPORTS || '50000', 10),
    maxWallets: parseInt(process.env.MAX_WALLETS || '30', 10),
    feeBufferSol: parseFloat(process.env.SOL_FEE_BUFFER_PER_WALLET || '0.003'),
  },
  port: parseInt(process.env.PORT || '3000', 10),
};

module.exports = { CONFIG };
