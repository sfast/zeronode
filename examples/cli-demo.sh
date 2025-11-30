#!/bin/bash

# Demo: Router and Nodes with CLI
# 
# This script demonstrates:
# 1. Starting a router
# 2. Starting service nodes connected to router
# 3. Using interactive client to send requests

echo "🌐 Zeronode CLI Demo"
echo "===================="
echo ""
echo "This demo will:"
echo "  1. Start a router on port 8087"
echo "  2. Start an auth service on port 3001"
echo "  3. Start an interactive client"
echo ""
echo "Press Ctrl+C to stop all processes"
echo ""

# Start router in background
echo "📍 Starting router..."
node bin/zeronode.js --router --bind tcp://127.0.0.1:8087 > /tmp/router.log 2>&1 &
ROUTER_PID=$!
sleep 1

# Start auth service in background
echo "📍 Starting auth service..."
node bin/zeronode.js --node --name auth \
  --bind tcp://127.0.0.1:3001 \
  --connect tcp://127.0.0.1:8087 > /tmp/auth.log 2>&1 &
AUTH_PID=$!
sleep 1

# Start payment service in background
echo "📍 Starting payment service..."
node bin/zeronode.js --node --name payment \
  --bind tcp://127.0.0.1:3002 \
  --connect tcp://127.0.0.1:8087 > /tmp/payment.log 2>&1 &
PAYMENT_PID=$!
sleep 1

echo ""
echo "✅ All services started!"
echo ""
echo "Router:   tcp://127.0.0.1:8087 (PID: $ROUTER_PID)"
echo "Auth:     tcp://127.0.0.1:3001 (PID: $AUTH_PID)"
echo "Payment:  tcp://127.0.0.1:3002 (PID: $PAYMENT_PID)"
echo ""
echo "📝 Starting interactive client..."
echo "   Try: request auth ping"
echo "   Try: request payment ping"
echo "   Try: list"
echo ""

# Start interactive client in foreground
node bin/zeronode.js --node --name test-client \
  --connect tcp://127.0.0.1:8087 \
  --interactive

# Cleanup on exit
echo ""
echo "🧹 Cleaning up..."
kill $ROUTER_PID $AUTH_PID $PAYMENT_PID 2>/dev/null
echo "✅ Demo finished"

