#!/bin/bash

# Simple test script to verify Router and Dealer examples work

echo "════════════════════════════════════════════════════════════════"
echo "Testing Router-Dealer Communication"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Make sure we're in the right directory
cd "$(dirname "$0")/../../.."

# Start router in background
echo "🚀 Starting Router server..."
node dist/sockets/example/router-server.js &
ROUTER_PID=$!

# Wait for router to start
sleep 2

# Start dealer in background
echo "🚀 Starting Dealer client..."
node dist/sockets/example/dealer-client.js &
DEALER_PID=$!

# Let them communicate for 5 seconds
echo "⏳ Letting them communicate for 5 seconds..."
sleep 5

# Stop both processes
echo "🛑 Stopping processes..."
kill $DEALER_PID 2>/dev/null || true
kill $ROUTER_PID 2>/dev/null || true

# Wait for cleanup
wait $DEALER_PID 2>/dev/null || true
wait $ROUTER_PID 2>/dev/null || true

echo ""
echo "✅ Test complete!"
echo ""
echo "To run manually:"
echo "  Terminal 1: node dist/sockets/example/router-server.js"
echo "  Terminal 2: node dist/sockets/example/dealer-client.js"

