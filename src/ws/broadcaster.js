const { WebSocketServer, WebSocket } = require('ws');

let _wss = null;

function init(server) {
  _wss = new WebSocketServer({ server });

  _wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch {}
    });
    ws.on('error', () => {});
  });

  console.log('WebSocket server ready');
}

function broadcast(type, data) {
  if (!_wss) return;
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const client of _wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

module.exports = { init, broadcast };
