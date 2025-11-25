import { Node } from '../src/index.js'

//    znode1
//      |
//      |
//    znode2

(async function () {
  console.log('📦 Simple Request Example - Request/Response pattern\n')
  
  let znode1 = new Node({ bind: 'tcp://127.0.0.1:3000' })
  let znode2 = new Node()

  console.log('🔧 Setting up nodes...')
  await znode1.bind()
  console.log(`✅ znode1 bound to ${znode1.getAddress()}`)
  
  await znode2.connect({ address: znode1.getAddress() })
  console.log(`✅ znode2 connected to znode1\n`)

  znode1.onRequest('foo', (envelope, reply) => {
    console.log(`📨 znode1 received request: "${envelope.data}"`)
    console.log(`   from: ${envelope.owner}`)
    console.log(`   event: ${envelope.event}`)
    console.log(`📤 znode1 sending reply...\n`)
    reply('reply from znode1.')
  })

  console.log('📤 znode2 sending request to znode1...')
  let rep = await znode2.request({
    event: 'foo',
    to: znode1.getId(),
    data: 'request from znode2.'
  })

  console.log(`📨 znode2 received response: "${rep}"\n`)
  console.log('✨ Example complete!')
  process.exit(0)
}())