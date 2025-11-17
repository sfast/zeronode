import { Node } from '../src/index.js'


//    znode1
//      /\
//     /  \
//    /    \
// znode2  znode3

(async function () {
  console.log('📦 Tick Any Example - Send to any connected peer\n')
  
  let znode1 = new Node({bind: 'tcp://127.0.0.1:3000'})
  let znode2 = new Node()
  let znode3 = new Node()

  console.log('🔧 Setting up nodes...')
  await znode1.bind()
  console.log(`✅ znode1 bound to ${znode1.getAddress()}`)
  
  await znode2.connect({ address: znode1.getAddress() })
  console.log(`✅ znode2 connected to znode1`)
  
  await znode3.connect({ address: znode1.getAddress() })
  console.log(`✅ znode3 connected to znode1\n`)

  let receivedCount = 0

  znode2.onTick('foo', (envelope) => {
    console.log(`📨 znode2 received tick: "${envelope.data}"`)
    console.log(`   from: ${envelope.owner}\n`)
    receivedCount++
    if (receivedCount === 2) finish()
  })

  znode3.onTick('foo', (envelope) => {
    console.log(`📨 znode3 received tick: "${envelope.data}"`)
    console.log(`   from: ${envelope.owner}\n`)
    receivedCount++
    if (receivedCount === 2) finish()
  })

  function finish() {
    console.log('✨ Both ticks delivered, example complete!')
    process.exit(0)
  }

  console.log('📤 znode1 sending tickAny (will pick random peer)...')
  znode1.tickAny({
    event: 'foo',
    data: 'tick from znode1.'
  })
  
  console.log('📤 znode1 sending another tickAny...\n')
  znode1.tickAny({
    event: 'foo',
    data: 'tick from znode1.'
  })
}())