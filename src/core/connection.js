const { Connection, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const { CONFIG } = require('../config');

let _connection = null;
let _wallet = null;

function getConnection() {
  if (!_connection) {
    if (!CONFIG.rpc || CONFIG.rpc.includes('YOUR_')) {
      throw new Error('SOLANA_RPC_URL not configured in .env');
    }
    _connection = new Connection(CONFIG.rpc, {
      commitment: 'confirmed',
      wsEndpoint: CONFIG.ws,
    });
  }
  return _connection;
}

function getWallet() {
  if (!_wallet) {
    if (!CONFIG.privateKey || CONFIG.privateKey.includes('your_')) {
      throw new Error('PRIVATE_KEY not configured in .env');
    }
    _wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.privateKey));
    console.log(`Wallet: ${_wallet.publicKey.toBase58()}`);
  }
  return _wallet;
}

// Lazy proxy exports
const connection = new Proxy({}, {
  get(_t, prop) { return getConnection()[prop]; },
});

const wallet = new Proxy({}, {
  get(_t, prop) { return getWallet()[prop]; },
});

module.exports = { connection, wallet, getConnection, getWallet };
