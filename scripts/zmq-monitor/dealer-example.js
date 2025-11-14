/* eslint-disable no-console */
const zmq = require('zeromq');

(async () => {
  const address = process.env.ADDR || 'tcp://127.0.0.1:7777';
  
  // Simple config - ZeroMQ handles reconnection natively
  const dealer = new zmq.Dealer({ 
    routingId: 'dealer-monitor',
    reconnectInterval: 5000,      // Retry every 5s (or -1 to disable)
    reconnectMaxInterval: 20000   // Max backoff 20s (0 = constant interval)
  });

  console.log('[dealer] Config:', { address, ...dealer });
  console.log('[dealer] Starting...\n');

  // Attach event listeners (just for observability)
  const on = (name) => dealer.events.on(name, (...args) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] 📡 ${name}`, ...args);
  });
  
  ['connect', 'disconnect', 'connect_retry', 'connect:retry'].forEach(on);

  await dealer.connect(address);
  console.log(`[dealer] ✅ Connect issued to ${address}\n`);

  // Track connection state for smart sending
  let isConnected = false;
  dealer.events.on('connect', () => {
    isConnected = true;
    console.log('[dealer] 🟢 CONNECTED - messages will be sent\n');
  });
  dealer.events.on('disconnect', () => {
    isConnected = false;
    console.log('[dealer] 🔴 DISCONNECTED - messages will be queued\n');
  });

  // Send periodic pings (only when connected)
  let i = 0;
  setInterval(async () => {
    if (!isConnected) {
      console.log(`[dealer] ⏸️  Skip ping-${i++} (offline)`);
      return;
    }
    
    try {
      const msg = `ping-${i++}`;
      await dealer.send(Buffer.from(msg));
      console.log(`[dealer] 📤 Sent: ${msg}`);
    } catch (e) {
      console.log(`[dealer] ❌ Send error: ${e.message}`);
    }
  }, 2000);

  // Receive echoes
  (async () => {
    for await (const [msg] of dealer) {
      console.log(`[dealer] 📥 Received: ${msg.toString()}\n`);
    }
  })();

  // Cleanup
  process.on('SIGINT', () => {
    console.log('\n[dealer] 🛑 Shutting down...');
    dealer.close();
    process.exit(0);
  });
})();

