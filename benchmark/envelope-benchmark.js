/**
 * Envelope Serialization/Deserialization Benchmark
 * Tests the performance of buffer operations
 */

import Envelop from '../src/sockets/envelope.js'
import { EnvelopType } from '../src/sockets/enum.js'

const ITERATIONS = 100000

// Test data scenarios
const scenarios = [
  {
    name: 'Small Message',
    data: { user: 'john', action: 'login' }
  },
  {
    name: 'Medium Message',
    data: {
      user: 'john',
      action: 'update',
      items: Array(10).fill({ id: 1, name: 'item', value: 100 })
    }
  },
  {
    name: 'Large Message',
    data: {
      users: Array(100).fill({ id: 1, name: 'user', email: 'user@example.com', data: { key: 'value' } }),
      metadata: { timestamp: Date.now(), version: '1.0.0' }
    }
  }
]

function benchmarkEnvelopeSerialization (scenario) {
  console.log(`\n📦 ${scenario.name}:`)
  
  // Create envelope
  const envelope = new Envelop({
    type: EnvelopType.REQUEST,
    tag: 'benchmark:test',
    data: scenario.data,
    owner: 'benchmark-client',
    recipient: 'benchmark-server'
  })

  // Benchmark serialization (toBuffer)
  const serializeStart = process.hrtime.bigint()
  for (let i = 0; i < ITERATIONS; i++) {
    envelope.getBuffer()
  }
  const serializeEnd = process.hrtime.bigint()
  const serializeTime = Number(serializeEnd - serializeStart) / 1e6 // Convert to ms
  const serializeOpsPerSec = (ITERATIONS / serializeTime) * 1000

  // Get a buffer for deserialization test
  const buffer = envelope.getBuffer()
  const bufferSize = buffer.length

  // Benchmark deserialization (fromBuffer)
  const deserializeStart = process.hrtime.bigint()
  for (let i = 0; i < ITERATIONS; i++) {
    Envelop.fromBuffer(buffer)
  }
  const deserializeEnd = process.hrtime.bigint()
  const deserializeTime = Number(deserializeEnd - deserializeStart) / 1e6
  const deserializeOpsPerSec = (ITERATIONS / deserializeTime) * 1000

  // Results
  console.log(`  Buffer Size: ${bufferSize} bytes`)
  console.log(`  Serialize:   ${serializeOpsPerSec.toFixed(0).padStart(10)} ops/sec (${(serializeTime / ITERATIONS).toFixed(3)}ms per op)`)
  console.log(`  Deserialize: ${deserializeOpsPerSec.toFixed(0).padStart(10)} ops/sec (${(deserializeTime / ITERATIONS).toFixed(3)}ms per op)`)
  console.log(`  Total:       ${((serializeOpsPerSec + deserializeOpsPerSec) / 2).toFixed(0).padStart(10)} ops/sec (average)`)
}

console.log('='.repeat(60))
console.log('🚀 Envelope Buffer Operations Benchmark')
console.log('='.repeat(60))
console.log(`Iterations: ${ITERATIONS.toLocaleString()}`)

scenarios.forEach(benchmarkEnvelopeSerialization)

console.log('\n' + '='.repeat(60))
console.log('✅ Benchmark Complete')
console.log('='.repeat(60))

