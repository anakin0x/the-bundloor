const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const BUNDLE_FILE = path.join(DATA_DIR, 'bundle.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let _writeTimer = null;
let _cache = null;

function loadBundle() {
  if (_cache !== undefined) return _cache;
  try {
    if (fs.existsSync(BUNDLE_FILE)) {
      _cache = JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf-8'));
      return _cache;
    }
  } catch (err) {
    console.error(`Storage read error: ${err.message}`);
    try { fs.renameSync(BUNDLE_FILE, BUNDLE_FILE + '.bak.' + Date.now()); } catch {}
  }
  _cache = null;
  return null;
}

function saveBundle(state) {
  _cache = state;
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    try {
      const tmp = BUNDLE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, BUNDLE_FILE);
    } catch (err) {
      console.error(`Storage write error: ${err.message}`);
    }
    _writeTimer = null;
  }, 100);
}

function flushSync() {
  if (_writeTimer) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
    try {
      const tmp = BUNDLE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(_cache, null, 2));
      fs.renameSync(tmp, BUNDLE_FILE);
    } catch (err) {
      console.error(`Storage flush error: ${err.message}`);
    }
  }
}

module.exports = { loadBundle, saveBundle, flushSync };
