# THE BUNDLOOR

> Multi-wallet Solana bundler for pump.fun — buy tokens across N wallets simultaneously, monitor PNL in real-time, and sell individually or all at once.

```
┌─────────────────────────────────────────────────────────────────────┐
│  [ THE BUNDLOOR ]          [●] CONNECTED    WALLET: AbCd...wxYz    │
├──────────────────────────────────┬──────────────────────────────────┤
│  NEW TOKENS                  42  │  TRENDING                    50  │
│  > DOGE2  AbCd...  2s  3.1 SOL  │  > PEPE99  XyZw...  420 SOL     │
│  > TRUMP  EfGh...  5s  1.4 SOL  │  > WIF     QrSt...  180 SOL     │
│  > ...                           │  > ...                           │
├──────────────────────────────────┴──────────────────────────────────┤
│  BUNDLER CONTROLS                                                   │
│  CA: [___________________] SOL: [___] WALLETS: [__] MODE: [JITO]   │
│  [CREATE]  [DISTRIBUTE]  [BUY]  [CANCEL]                           │
├─────────────────────────────────────────────────────────────────────┤
│  #  ADDRESS        ALLOC    TOKENS    VALUE    PNL        ACTION   │
│  1  AbCd...wxYz   0.3421   245.1K   0.3920  +14.6%  [SELL]        │
│  2  EfGh...mnOp   0.1822   131.0K   0.2010  +10.3%  [SELL]        │
│                                                                     │
│  [SELL ALL]              Total: +0.234 SOL (+12.1%)  [RECLAIM SOL] │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Features

- **Bundled buys** — distribute SOL across up to 30 freshly generated wallets and buy in one atomic Jito bundle
- **Random allocation** — SOL is split using the broken-stick method so no two wallets get the exact same amount (harder to detect patterns on-chain)
- **Live PNL tracking** — bonding curve state is read on-chain every 4 seconds; no price API needed
- **Selective selling** — sell any single wallet or all positions at once
- **SOL reclaim** — sweep leftover SOL from all sub-wallets back to your funder wallet after selling
- **Live feeds** — new tokens from pumpportal.fun WebSocket + trending tokens from pump.fun REST API, updating in real-time
- **Retro terminal UI** — lightweight vanilla HTML/CSS/JS, no React or bundlers required
- **State persistence** — bundle state (including sub-wallet keys) survives server restarts so you can always sell

---

## Prerequisites

- Node.js 18+
- A Solana wallet with SOL (dedicated trading wallet recommended — **not** your main wallet)
- A paid RPC endpoint (strongly recommended for production — see [RPC Providers](#rpc-providers))

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/yourname/the-bundloor.git
cd the-bundloor
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your private key and RPC URL

# 3. Start
npm start

# 4. Open in browser
open http://localhost:3000
```

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
# Solana RPC — use a paid provider in production (see below)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WS_URL=wss://api.mainnet-beta.solana.com

# Your funder wallet private key (base58 encoded)
# Export from Phantom: Settings > Show Secret Recovery Phrase
PRIVATE_KEY=your_bs58_private_key_here

# Jito bundle settings
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.labs.dev
JITO_TIP_LAMPORTS=50000        # ~0.00005 SOL tip per bundle

# Trading defaults
SLIPPAGE_PCT=25                # Slippage tolerance (%)
PRIORITY_FEE_MICROLAMPORTS=50000
MAX_WALLETS=30
SOL_FEE_BUFFER_PER_WALLET=0.003   # Extra SOL per wallet for tx fees

PORT=3000
```

### RPC Providers

The free public Solana RPC (`api.mainnet-beta.solana.com`) rate-limits aggressively. For anything beyond testing, use a paid provider:

| Provider | URL | Notes |
|---|---|---|
| [Helius](https://helius.dev) | `https://mainnet.helius-rpc.com/?api-key=...` | Generous free tier |
| [QuickNode](https://quicknode.com) | Custom endpoint | Fast, reliable |
| [Triton](https://triton.one) | Custom endpoint | Low-latency |

---

## How It Works

### The Bundle Flow

```
1. CREATE
   └─ Generate N Keypairs
   └─ Split totalSol randomly (broken-stick algorithm)
   └─ Save to data/bundle.json (persisted)

2. DISTRIBUTE
   └─ Batch SOL transfers (7 per transaction) from funder → sub-wallets
   └─ Each sub-wallet receives: allocated SOL + 0.003 SOL fee buffer

3. BUY  [Jito mode]
   └─ For each group of 4 wallets:
       ├─ Build buy transaction per wallet (pump.fun bonding curve instruction)
       ├─ Fetch ONE blockhash for the whole group
       ├─ Sign all transactions
       ├─ Add Jito tip transaction (funder → tip account)
       └─ Submit bundle to Jito block engine → atomic landing

4. MONITOR (automatic, every 4s)
   └─ Read bonding curve state on-chain (getMultipleAccountsInfo)
   └─ Compute: tokenBalance → expectedSolOut → PNL
   └─ Broadcast via WebSocket to UI

5. SELL
   ├─ Single wallet: read ATA balance → build sell instruction → send
   └─ Sell all: iterate wallets, sell each, then reclaim leftover SOL

6. RECLAIM
   └─ Sweep remaining SOL from each sub-wallet back to funder
   └─ Clear bundle state
```

### Bonding Curve Math

All pricing is computed directly from the pump.fun bonding curve account — no external price API:

```
// Buy tokens out
tokenOut = (virtualTokenReserves × solIn × 0.99) / (virtualSolReserves + solIn × 0.99)

// Current sell value
solOut = (virtualSolReserves × tokenBalance) / (virtualTokenReserves + tokenBalance) × 0.99

// PNL
pnlSol = solOut - solAllocated
pnlPct = (pnlSol / solAllocated) × 100
```

### Jito Bundles

Jito bundles guarantee atomic execution — all transactions in a bundle land in the same block or none do. This is important for bundling because it prevents partial fills where some wallets buy at different prices.

Limits:
- Max **5 transactions per bundle** (4 buy txs + 1 tip tx)
- With >4 wallets, multiple bundles are submitted sequentially
- If Jito submission fails, the executor falls back to sequential sends automatically

---

## Architecture

```
the-bundloor/
├── server.js                    # Express + WebSocket server entry point
├── .env.example                 # Environment config template
│
├── src/
│   ├── config.js                # Env var loader → CONFIG object
│   │
│   ├── core/
│   │   ├── connection.js        # Lazy Solana Connection + funder Keypair
│   │   ├── pumpSwap.js          # pump.fun buy/sell instruction builder
│   │   └── jitoBundle.js        # Jito bundle HTTP submission + polling
│   │
│   ├── bundler/
│   │   ├── walletFactory.js     # Keypair generation + broken-stick allocation
│   │   ├── distributor.js       # Fund sub-wallets (batched SOL transfers)
│   │   ├── buyExecutor.js       # Jito bundle buys (sequential fallback)
│   │   ├── sellExecutor.js      # Individual + all-at-once sell + SOL reclaim
│   │   └── pnlTracker.js        # Polls bonding curve state every 4s
│   │
│   ├── feeds/
│   │   ├── newTokensFeed.js     # pumpportal.fun WebSocket → new token events
│   │   └── trendingFeed.js      # pump.fun REST polling every 10s
│   │
│   ├── api/
│   │   └── routes.js            # All REST API endpoints
│   │
│   ├── ws/
│   │   └── broadcaster.js       # WebSocket server + typed event broadcast
│   │
│   └── state/
│       ├── bundleState.js       # In-memory state machine + broadcast wiring
│       └── persistence.js       # Atomic JSON write (debounced, tmp+rename)
│
├── public/
│   ├── index.html               # Single-page app
│   ├── css/terminal.css         # Retro terminal styles
│   └── js/app.js                # Frontend: WS client, feeds, bundle UI
│
└── data/
    └── bundle.json              # Auto-generated. Contains sub-wallet keys. GITIGNORED.
```

### State Machine

```
                   CREATE
  ─────────────────────────────────────────────────────────────────
  idle  ──▶  distributing  ──▶  distributed  ──▶  buying  ──▶  active
   ▲                                                           │      │
   │                                                    SELL ALL     SELL ONE
   │                                                           ▼
   └──────────────────────────── selling ◀───────────────────┘
                                     │
                                     ▼
                                    idle
  (any step can transition to error)
```

### REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server health + funder wallet balance |
| `GET` | `/api/bundle/status` | Current bundle state (no private keys) |
| `POST` | `/api/bundle/create` | `{ ca, solAmount, walletCount }` |
| `POST` | `/api/bundle/distribute` | Fund sub-wallets from funder |
| `POST` | `/api/bundle/buy` | `{ mode: "jito" \| "sequential" }` |
| `POST` | `/api/bundle/sell` | `{ walletPublicKey? }` — omit for sell-all |
| `POST` | `/api/bundle/reclaim` | Sweep SOL + clear bundle |
| `DELETE` | `/api/bundle` | Force clear bundle state |
| `GET` | `/api/feeds/new` | Last 50 new tokens |
| `GET` | `/api/feeds/trending` | Last 50 trending tokens |

### WebSocket Events (Server → Client)

| Event type | Payload | Description |
|---|---|---|
| `bundle_state` | Bundle object (no private keys) | Any bundle state change |
| `new_token` | `{ mint, name, symbol, marketCapSol, ... }` | New token on pump.fun |
| `trending_update` | `Token[]` | Trending list refresh |
| `pong` | — | Keepalive response |

---

## Security Notes

- **Use a dedicated trading wallet.** Never use your main wallet as the funder.
- `data/bundle.json` is created automatically and contains sub-wallet private keys. It is gitignored, but treat it like a secret — delete it after all positions are closed.
- The `.env` file contains your private key. Never commit it, share it, or put it in a public location.
- Sub-wallet keys are **never** transmitted over WebSocket or REST API — they exist only in memory and in `data/bundle.json`.

---

## Development

```bash
# Auto-restart on file changes
npm run dev

# Check for issues
node -e "require('./server')"
```

---

## Known Limitations

- **Migrated tokens** — if a pump.fun token completes its bonding curve and migrates to Raydium, selling via this tool will fail. You will need to sell through Raydium or Jupiter directly.
- **Jito availability** — during high network congestion, Jito bundles may time out. The executor falls back to sequential sends automatically.
- **Free RPC rate limits** — the public Solana RPC will throttle PNL polling with more than ~5 wallets. Use a paid RPC for anything serious.
- **Max 30 wallets** — configurable via `MAX_WALLETS` in `.env`.

---

## License

MIT
