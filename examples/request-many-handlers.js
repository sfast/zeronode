import { Node } from '../src/index.js'

//    znode1
//      |
//      |
//    znode2

(async function () {
  console.log('📦 Middleware Chain Example - Multiple handlers with next()\n')
  
  let znode1 = new Node({bind: 'tcp://127.0.0.1:3000'})
  let znode2 = new Node()

  console.log('🔧 Setting up nodes...')
  await znode1.bind()
  console.log(`✅ znode1 bound to ${znode1.getAddress()}`)
  
  await znode2.connect({ address: znode1.getAddress() })
  console.log(`✅ znode2 connected to znode1\n`)

  console.log('🎯 Setting up middleware chain (3 handlers)...\n')

  // Store value in envelope context (not directly on envelope)
  let processedValue = 0

  znode1.onRequest('foo', (envelope, reply, next) => {
    processedValue = envelope.data
    console.log(`📨 Handler 1: received value = ${processedValue}`)
    processedValue++
    console.log(`   Handler 1: incremented to ${processedValue}, calling next()`)
    next()
  })

  znode1.onRequest('foo', (envelope, reply, next) => {
    console.log(`📨 Handler 2: received value = ${processedValue}`)
    processedValue++
    console.log(`   Handler 2: incremented to ${processedValue}, calling next()`)
    next()
  })

  znode1.onRequest('foo', (envelope, reply) => {
    console.log(`📨 Handler 3: received value = ${processedValue}`)
    processedValue++
    console.log(`   Handler 3: final value = ${processedValue}, sending reply\n`)
    reply(processedValue)
  })

  console.log('📤 znode2 sending request with data = 1...\n')
  let rep = await znode2.request({
    event: 'foo',
    to: znode1.getId(),
    data: 1
  })

  console.log(`📨 znode2 received reply: ${rep}`)
  console.log('   (value went through 3 handlers: 1 → 2 → 3 → 4)\n')
  console.log('✨ Example complete!')
  process.exit(0)
}())