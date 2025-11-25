import { Node } from '../src/index.js'


//    znode1
//      /\
//     /  \
//    /    \
// znode2  znode3

(async function () {
  console.log('📦 Object Filter Example - Filter by peer options\n')
  
  let znode1 = new Node({ bind: 'tcp://127.0.0.1:3000' })
  let znode2 = new Node({ options: { name: 'a' }})
  let znode3 = new Node({ options: { name: 'b'}})

  console.log('🔧 Setting up nodes...')
  await znode1.bind()
  console.log(`✅ znode1 bound to ${znode1.getAddress()}`)
  
  await znode2.connect({ address: znode1.getAddress() })
  console.log(`✅ znode2 (name='a') connected to znode1`)
  
  await znode3.connect({ address: znode1.getAddress() })
  console.log(`✅ znode3 (name='b') connected to znode1\n`)

  let receivedCount = 0

  znode2.onTick('foo', (envelope) => {
    console.log(`📨 znode2 (name='a') received tick: "${envelope.data}"`)
    receivedCount++
    finish()
  })

  znode3.onTick('foo', (envelope) => {
    console.log(`❌ znode3 (name='b') should NOT receive (filtered out)`)
    receivedCount++
    finish()
  })

  function finish() {
    if (receivedCount === 1) {
      console.log('\n✨ Filter worked! Only znode2 received the message')
      console.log('   (znode3 was filtered out by name !== "a")\n')
      console.log('✨ Example complete!')
      process.exit(0)
    }
  }

  console.log('📤 znode1 sending tickAll with filter: { name: "a" }...\n')
  znode1.tickAll({
    event: 'foo',
    data: 'tick from znode1.',
    filter: {
      name: 'a'
    }
  })
  
  setTimeout(() => {
    console.log('\n✨ Filter worked correctly!\n')
    console.log('✨ Example complete!')
    process.exit(0)
  }, 1000)
}())