import { Node } from '../src/index.js'

//    znode1
//      |
//      |
//    znode2

(async function () {
  console.log('📦 Error Handling Example - Middleware error propagation\n')
  
  try {
    let znode1 = new Node({bind: 'tcp://127.0.0.1:3000'})
    let znode2 = new Node()

    console.log('🔧 Setting up nodes...')
    await znode1.bind()
    console.log(`✅ znode1 bound to ${znode1.getAddress()}`)
    
    await znode2.connect({ address: znode1.getAddress() })
    console.log(`✅ znode2 connected to znode1\n`)

    console.log('🎯 Setting up middleware chain with error...\n')

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
      console.log(`   Handler 2: ❌ triggering error with next(error)...\n`)
      next('error message')
    })

    znode1.onRequest('foo', (envelope, reply) => {
      console.log('⚠️  Handler 3: This should NOT be called')
      processedValue++
      reply(processedValue)
    })

    console.log('📤 znode2 sending request with data = 1...\n')
    let rep = await znode2.request({
      event: 'foo',
      to: znode1.getId(),
      data: 1
    })

    console.log('⚠️  Should not reach here, error expected')
    console.log('reply', rep)
  } catch (err) {
    console.log('✅ Caught error as expected!')
    console.log(`   Error message: "${err.message}"\n`)
    console.log('✨ Example complete - error handling works!')
    process.exit(0)
  }
}())