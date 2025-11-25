import { Node } from '../src/index.js'

//    znode1
//      |
//      |
//    znode2
//      /\
//     /  \
//    /    \
// znode3  znode4
(async function () {
  console.log('📦 Tick All Example - Broadcast to all connected peers\n')
  
  let znode1 = new Node({ bind: 'tcp://127.0.0.1:3000' })
  let znode2 = new Node({ bind: 'tcp://127.0.0.1:3001' })
  let znode3 = new Node()
  let znode4 = new Node()

  console.log('🔧 Setting up nodes...')
  await znode1.bind()
  console.log(`✅ znode1 bound to ${znode1.getAddress()}`)
  
  await znode2.bind()
  console.log(`✅ znode2 bound to ${znode2.getAddress()}`)
  
  await znode2.connect({ address: znode1.getAddress() })
  console.log(`✅ znode2 connected to znode1`)
  
  await znode3.connect({ address: znode2.getAddress() })
  console.log(`✅ znode3 connected to znode2`)
  
  await znode4.connect({ address: znode2.getAddress() })
  console.log(`✅ znode4 connected to znode2\n`)

  let receivedCount = 0

  znode1.onTick('foo', (envelope) => {
    console.log(`📨 znode1 received tick: "${envelope.data}"`)
    receivedCount++
    if (receivedCount === 3) finish()
  })
  
  znode3.onTick('foo', (envelope) => {
    console.log(`📨 znode3 received tick: "${envelope.data}"`)
    receivedCount++
    if (receivedCount === 3) finish()
  })
  
  znode4.onTick('foo', (envelope) => {
    console.log(`📨 znode4 received tick: "${envelope.data}"`)
    receivedCount++
    if (receivedCount === 3) finish()
  })

  function finish() {
    console.log('\n✨ All 3 peers received the broadcast, example complete!')
    process.exit(0)
  }

  console.log('📤 znode2 broadcasting tickAll to all connected peers...\n')
  znode2.tickAll({
    event: 'foo',
    data: 'msg from znode2'
  })
}())