# NPM Version Comparison Setup

To benchmark the npm version of Zeronode against your local optimized version:

## Setup (one time)

```bash
# Navigate to benchmark directory
cd benchmark

# Install the npm version of zeronode
npm install zeronode

# Go back to root
cd ..
```

## Run Benchmarks

```bash
# Run NPM version benchmark
npm run benchmark:node-npm

# Run local optimized version benchmark
npm run benchmark:node

# Run both and compare
npm run benchmark:compare-npm
```

## What to Compare

- **Throughput**: Messages per second (higher is better)
- **Latency**: Mean latency in milliseconds (lower is better)
- **Consistency**: Variance across different message sizes

## Expected Results

With the optimizations in this branch:
- **Buffer-first envelope parsing** - eliminates Envelop class overhead
- **Type coercion fixes** - handles numeric event IDs
- **SocketId caching** - reduces repeated getId() calls
- **IIFE removal** - cleaner async code

You should see:
- **~10-20% better throughput**
- **~1-2ms lower latency**
- **More consistent performance across message sizes**

