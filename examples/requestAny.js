import { Node } from '../src/index.js'

//    znode1
//      /\
//     /  \
//    /    \
// znode2  znode3

(async function () {
  console.log('📦 Request Any Example - Request from any available peer\n')
  
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

  znode2.onRequest('foo', (envelope, reply) => {
    console.log(`📨 znode2 received request: "${envelope.data}"`)
    console.log(`   from: ${envelope.owner}`)
    console.log(`📤 znode2 sending reply...\n`)
    reply('reply from znode2.')
  })

  znode3.onRequest('foo', (envelope, reply) => {
    console.log(`📨 znode3 received request: "${envelope.data}"`)
    console.log(`   from: ${envelope.owner}`)
    console.log(`📤 znode3 sending reply...\n`)
    reply('reply from znode3.')
  })

  console.log('📤 znode1 sending requestAny (will pick random peer)...')
  let rep = await znode1.requestAny({
    event: 'foo',
    data: 'request from znode1.'
  })

  console.log(`📨 znode1 received response: "${rep}"`)
  console.log(`   (from either znode2 or znode3)\n`)
  console.log('✨ Example complete!')
  process.exit(0)
}())