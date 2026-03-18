/* ── The Bundloor — Frontend App ── */

// ─── State ────────────────────────────────────────────────────────────────────
let ws = null;
let wsRetry = 0;
let bundle = null;

// ─── Utility ──────────────────────────────────────────────────────────────────
function fmt(sol, decimals = 4) {
  if (sol === null || sol === undefined) return '—';
  return Number(sol).toFixed(decimals);
}

function fmtTokens(raw) {
  if (!raw) return '—';
  const n = Number(raw) / 1e6;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

function shortAddr(addr) {
  if (!addr) return '—';
  return addr.slice(0, 4) + '...' + addr.slice(-4);
}

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h';
}

function solscan(addr, type = 'account') {
  return `https://solscan.io/${type}/${addr}`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function toast(msg, level = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + level;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ─── Log ──────────────────────────────────────────────────────────────────────
const logEl = document.getElementById('log-output');
function log(msg, level = 'info') {
  const line = document.createElement('div');
  const ts = new Date().toTimeString().slice(0, 8);
  line.className = 'log-line ' + level;
  line.textContent = `[${ts}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  if (logEl.children.length > 500) logEl.removeChild(logEl.firstChild);
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    wsRetry = 0;
    document.getElementById('ws-dot').className = 'dot connected';
    document.getElementById('ws-label').textContent = 'CONNECTED';
    log('WebSocket connected', 'ok');
    loadInitialData();
  };

  ws.onmessage = (e) => {
    try {
      const { type, data } = JSON.parse(e.data);
      handleWSMessage(type, data);
    } catch {}
  };

  ws.onclose = () => {
    document.getElementById('ws-dot').className = 'dot';
    document.getElementById('ws-label').textContent = 'DISCONNECTED';
    log('WebSocket disconnected — retrying...', 'warn');
    const delay = Math.min(1000 * 2 ** wsRetry, 30000);
    wsRetry++;
    setTimeout(connectWS, delay);
  };

  ws.onerror = () => {};
}

function handleWSMessage(type, data) {
  switch (type) {
    case 'new_token':      renderNewToken(data); break;
    case 'trending_update': renderTrending(data); break;
    case 'bundle_state':   onBundleState(data); break;
    case 'pong':           break;
    default: break;
  }
}

// ─── Load Initial Data ────────────────────────────────────────────────────────
async function loadInitialData() {
  // Health / wallet info
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.ok) {
      document.getElementById('wallet-addr').textContent = shortAddr(data.wallet);
      document.getElementById('wallet-bal').textContent = fmt(data.balanceSol, 4);
    }
  } catch {}

  // Existing bundle
  try {
    const res = await fetch('/api/bundle/status');
    const data = await res.json();
    if (data.bundle) onBundleState(data.bundle);
  } catch {}

  // Initial feeds
  try {
    const [nr, tr] = await Promise.all([
      fetch('/api/feeds/new').then(r => r.json()),
      fetch('/api/feeds/trending').then(r => r.json()),
    ]);
    if (nr.tokens?.length) nr.tokens.forEach(t => renderNewToken(t, false));
    if (tr.tokens?.length) renderTrending(tr.tokens);
  } catch {}
}

// ─── Feed Rendering ───────────────────────────────────────────────────────────
const newFeedEl = document.getElementById('new-feed');
const newCountEl = document.getElementById('new-count');
let newCount = 0;

function renderNewToken(token, flash = true) {
  newCount++;
  newCountEl.textContent = newCount;

  const item = document.createElement('div');
  item.className = 'feed-item' + (flash ? ' new-flash' : '');
  item.innerHTML = `
    <div>
      <div class="symbol">${esc(token.symbol)}</div>
      <div class="name">${esc(token.name)}</div>
    </div>
    <div class="name td-addr">${shortAddr(token.mint)}</div>
    <div class="meta sol">${token.marketCapSol ? fmt(token.marketCapSol, 1) + ' SOL' : 'NEW'}</div>
  `;
  item.title = token.mint;
  item.onclick = () => fillCA(token.mint);

  newFeedEl.insertBefore(item, newFeedEl.firstChild);

  // Keep list bounded
  while (newFeedEl.children.length > 50) newFeedEl.removeChild(newFeedEl.lastChild);
}

const trendingFeedEl = document.getElementById('trending-feed');
const trendingCountEl = document.getElementById('trending-count');

function renderTrending(tokens) {
  trendingCountEl.textContent = tokens.length;
  trendingFeedEl.innerHTML = '';
  for (const t of tokens.slice(0, 50)) {
    const item = document.createElement('div');
    item.className = 'feed-item';
    const mcap = t.marketCapSol ? fmt(t.marketCapSol, 1) + ' SOL' : '—';
    item.innerHTML = `
      <div>
        <div class="symbol">${esc(t.symbol)}</div>
        <div class="name">${esc(t.name)}</div>
      </div>
      <div class="name td-addr">${shortAddr(t.mint)}</div>
      <div class="meta ${t.complete ? '' : 'sol'}">${t.complete ? '<span style="color:var(--amber)">MIGRATED</span>' : mcap}</div>
    `;
    item.title = t.mint;
    item.onclick = () => fillCA(t.mint);
    trendingFeedEl.appendChild(item);
  }
}

function fillCA(mint) {
  document.getElementById('input-ca').value = mint;
  toast('CA copied to input', 'ok');
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Bundle State Rendering ───────────────────────────────────────────────────
function onBundleState(state) {
  bundle = state;
  renderBundle(state);
}

function renderBundle(state) {
  const noMsg = document.getElementById('no-bundle-msg');
  const table = document.getElementById('wallet-table');
  const stats = document.getElementById('bundle-stats');
  const actions = document.getElementById('bundle-actions');

  if (!state) {
    noMsg.style.display = 'block';
    table.style.display = 'none';
    stats.style.display = 'none';
    actions.style.display = 'none';
    setButtonStates('idle');
    return;
  }

  noMsg.style.display = 'none';
  table.style.display = 'table';
  stats.style.display = 'flex';
  actions.style.display = 'flex';

  // Status badge
  const badge = document.getElementById('bundle-status-badge');
  badge.textContent = state.status.toUpperCase();
  badge.className = '';
  badge.id = 'bundle-status-badge';
  badge.classList.add(state.status);

  // Stats
  document.getElementById('stat-mint').textContent = shortAddr(state.mint);
  document.getElementById('stat-mint').title = state.mint;
  document.getElementById('stat-total').textContent = fmt(state.totalSol, 3);
  document.getElementById('stat-wallets').textContent = state.wallets.length;

  // Aggregate PNL
  const buyers = state.wallets.filter(w => w.bought && w.currentValueSol !== null);
  if (buyers.length > 0) {
    const totalValue = buyers.reduce((s, w) => s + (w.currentValueSol || 0), 0);
    const totalCost = buyers.reduce((s, w) => s + w.solAllocated, 0);
    const totalPnl = totalValue - totalCost;
    const pnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    document.getElementById('stat-value').textContent = fmt(totalValue, 3);
    const pnlEl = document.getElementById('stat-pnl');
    const sign = totalPnl >= 0 ? '+' : '';
    pnlEl.textContent = `${sign}${fmt(totalPnl, 4)} SOL (${sign}${fmt(pnlPct, 1)}%)`;
    pnlEl.className = 'stat-val ' + (totalPnl >= 0 ? 'pnl-pos' : 'pnl-neg');
  } else {
    document.getElementById('stat-value').textContent = '—';
    document.getElementById('stat-pnl').textContent = '—';
  }

  // Wallet rows
  const tbody = document.getElementById('wallet-tbody');
  tbody.innerHTML = '';
  for (const w of state.wallets) {
    const row = document.createElement('tr');

    const pnlClass = w.pnlSol === null || w.pnlSol === undefined
      ? 'td-pnl-zero'
      : w.pnlSol >= 0 ? 'td-pnl-pos' : 'td-pnl-neg';

    const pnlText = w.pnlSol !== null && w.pnlSol !== undefined
      ? `${w.pnlSol >= 0 ? '+' : ''}${fmt(w.pnlSol, 4)} (${w.pnlSol >= 0 ? '+' : ''}${fmt(w.pnlPct, 1)}%)`
      : '—';

    const statusText = w.bought ? 'ACTIVE'
      : w.distributed ? 'FUNDED'
      : 'PENDING';
    const statusClass = w.bought ? 'ok' : w.distributed ? 'pending' : 'idle';

    row.innerHTML = `
      <td class="td-sol">${w.index}</td>
      <td class="td-addr"><a href="${solscan(w.publicKey)}" target="_blank">${shortAddr(w.publicKey)}</a></td>
      <td class="td-sol">${fmt(w.solAllocated, 4)}</td>
      <td class="td-tokens">${fmtTokens(w.tokenBalance)}</td>
      <td class="td-value">${w.currentValueSol !== null && w.currentValueSol !== undefined ? fmt(w.currentValueSol, 4) : '—'}</td>
      <td class="${pnlClass}">${pnlText}</td>
      <td class="td-status ${statusClass}">${statusText}</td>
      <td>${w.bought ? `<button class="btn danger" style="font-size:10px;padding:2px 8px" onclick="sellOne('${w.publicKey}')">SELL</button>` : ''}</td>
    `;
    tbody.appendChild(row);
  }

  setButtonStates(state.status);
}

function setButtonStates(status) {
  const busy = ['distributing', 'buying', 'selling'].includes(status);
  const hasBundle = !!bundle;

  document.getElementById('btn-create').disabled = busy || (hasBundle && !['idle','error'].includes(status));
  document.getElementById('btn-distribute').disabled = busy || !hasBundle || status === 'active';
  document.getElementById('btn-buy').disabled = busy || !hasBundle;
  document.getElementById('btn-cancel').disabled = !hasBundle;
}

// ─── Button Handlers ──────────────────────────────────────────────────────────
document.getElementById('btn-create').onclick = async () => {
  const ca = document.getElementById('input-ca').value.trim();
  const sol = parseFloat(document.getElementById('input-sol').value);
  const wallets = parseInt(document.getElementById('input-wallets').value);

  if (!ca) return toast('Enter a contract address', 'warn');
  if (!sol || sol <= 0) return toast('Enter SOL amount', 'warn');
  if (!wallets || wallets < 1) return toast('Enter wallet count (1-30)', 'warn');

  try {
    const res = await fetch('/api/bundle/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ca, solAmount: sol, walletCount: wallets }),
    });
    const data = await res.json();
    if (data.error) return toast(data.error, 'err');
    toast(`Bundle created: ${wallets} wallets`, 'ok');
    log(`Bundle created for ${ca.slice(0,8)}... — ${wallets} wallets, ${sol} SOL`, 'ok');
  } catch (err) {
    toast('Request failed', 'err');
  }
};

document.getElementById('btn-distribute').onclick = async () => {
  if (!confirm('Distribute SOL to sub-wallets? This sends real SOL.')) return;
  try {
    await fetch('/api/bundle/distribute', { method: 'POST' });
    toast('Distribution started...', 'ok');
    log('Distributing SOL to wallets...', 'info');
  } catch { toast('Request failed', 'err'); }
};

document.getElementById('btn-buy').onclick = async () => {
  if (!bundle) return toast('No bundle', 'warn');
  const undistributed = bundle.wallets.filter(w => !w.distributed).length;
  if (undistributed > 0 && !confirm(`${undistributed} wallets not funded. Continue anyway?`)) return;
  if (!confirm('Execute buys on all wallets? This spends real SOL.')) return;

  const mode = document.getElementById('buy-mode').value;
  try {
    await fetch('/api/bundle/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    toast(`Buying (${mode} mode)...`, 'ok');
    log(`Executing buys in ${mode} mode...`, 'info');
  } catch { toast('Request failed', 'err'); }
};

document.getElementById('btn-cancel').onclick = async () => {
  if (!confirm('Cancel and clear bundle?')) return;
  try {
    await fetch('/api/bundle', { method: 'DELETE' });
    toast('Bundle cancelled', 'warn');
    log('Bundle cancelled', 'warn');
  } catch { toast('Request failed', 'err'); }
};

document.getElementById('btn-sell-all').onclick = async () => {
  if (!confirm('Sell ALL positions?')) return;
  try {
    await fetch('/api/bundle/sell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    toast('Selling all positions...', 'warn');
    log('Selling all positions...', 'warn');
  } catch { toast('Request failed', 'err'); }
};

document.getElementById('btn-reclaim').onclick = async () => {
  if (!confirm('Reclaim SOL from all sub-wallets and clear bundle?')) return;
  try {
    await fetch('/api/bundle/reclaim', { method: 'POST' });
    toast('Reclaiming SOL...', 'ok');
    log('Reclaiming SOL from wallets...', 'ok');
  } catch { toast('Request failed', 'err'); }
};

async function sellOne(publicKey) {
  if (!confirm(`Sell wallet ${publicKey.slice(0,8)}...?`)) return;
  try {
    await fetch('/api/bundle/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletPublicKey: publicKey }),
    });
    toast(`Selling ${publicKey.slice(0,8)}...`, 'warn');
    log(`Selling wallet ${publicKey.slice(0,8)}...`, 'warn');
  } catch { toast('Request failed', 'err'); }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  };
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
connectWS();
