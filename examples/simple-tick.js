import { Node } from '../src/index.js'

//    znode1
//      |
//      |
//    znode2

(async function () {
  console.log('📦 Simple Tick Example - Fire-and-forget messaging\n')
  
  let znode1 = new Node({bind: 'tcp://127.0.0.1:3000'})
  let znode2 = new Node()

  console.log('🔧 Setting up nodes...')
  await znode1.bind()
  console.log(`✅ znode1 bound to ${znode1.getAddress()}`)
  
  await znode2.connect({ address: znode1.getAddress() })
  console.log(`✅ znode2 connected to znode1\n`)

  znode1.onTick('foo', (envelope) => {
    console.log(`📨 znode1 received tick: "${envelope.data}"`)
    console.log(`   from: ${envelope.owner}`)
    console.log(`   event: ${envelope.event}\n`)
    console.log('✨ Example complete!')
    process.exit(0)
  })

  console.log('📤 znode2 sending tick to znode1...')
  znode2.tick({
    event: 'foo',
    to: znode1.getId(),
    data: 'msg from znode2'
  })
}())