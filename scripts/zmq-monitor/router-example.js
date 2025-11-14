/* eslint-disable no-console */
const zmq = require('zeromq');

(async () => {
  const address = process.env.ADDR || 'tcp://127.0.0.1:7778';
  const sock = new zmq.Router({ routingId: 'router-monitor-7778' });

  // Monitor common router-side events
  const on = (name) => sock.events.on(name, (...args) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ROUTER events -> ${name}`, ...args);
  });
  [
    'listening',
    'accept',
    'accept_error',
    'bind_error',
    'closed',
    'close_error',
    'disconnect',
  ].forEach(on);

  await sock.bind(address);
  console.log(`[router] bound to ${address}`);

  // Manual control: you can unbind/rebind the router yourself from the terminal
  // Example:
  //   ADDR=tcp://127.0.0.1:7777 node scripts/zmq-monitor/router.js
  // Then in another terminal, stop and restart this process to simulate downtime

  // Track connected dealers
  const dealers = new Map(); // routingId -> { lastSeen, messageCount }

  console.log('[router] Waiting for messages...');

  // Echo replies back to sender and track stats
  for await (const msg of sock) {
    console.log('[router] 🔔 Received message with', msg.length, 'frames');
    
    // Router receives: [routingId, data] (2 frames)
    // ZeroMQ handles the empty delimiter internally in v6+
    try {
      if (msg.length >= 2) {
        const [routingId, ...dataFrames] = msg;
        const routingIdStr = routingId.toString();
        const data = dataFrames[0]?.toString() || '';
        
        console.log(`[router] 🆔 Routing ID: ${routingIdStr}`);
        console.log(`[router] 📦 Data: ${data}`);
        
        // Track dealer stats
        if (!dealers.has(routingIdStr)) {
          dealers.set(routingIdStr, { lastSeen: Date.now(), messageCount: 0 });
          console.log(`[router] 🔗 New dealer connected: ${routingIdStr}`);
        }
        
        const dealer = dealers.get(routingIdStr);
        dealer.lastSeen = Date.now();
        dealer.messageCount++;
        
        // Log received message
        if (data.startsWith('ping-')) {
          console.log(`[router] 📩 Received from ${routingIdStr}: ${data} (total: ${dealer.messageCount})`);
        } else {
          console.log(`[router] 📩 Received from ${routingIdStr}: ${data}`);
        }
        
        // Echo back (router sends: [routingId, data])
        await sock.send([routingId, ...dataFrames]);
        console.log(`[router] 📤 Echoed back to ${routingIdStr}`);
      } else {
        console.log(`[router] ⚠️  Unexpected frame count: ${msg.length}`);
      }
    } catch (e) {
      console.log('[router] ❌ Error:', e && e.message);
      console.log('[router] Stack:', e && e.stack);
    }
  }
  
  console.log('[router] Message loop ended');
})(); 


