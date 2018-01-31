import { Node } from '../src'

//    znode1
//      |
//      |
//    znode2

(async function () {
  let znode1 = new Node({ bind: 'tcp://127.0.0.1:3000' })
  let znode2 = new Node()

  await znode1.bind()
  await znode2.connect({ address: znode1.getAddress() })

  znode1.onRequest('foo', ({ body, reply }) => {
    console.log(body)
    reply('reply from znode1.')
  })

  let rep = await znode2.request({
    event: 'foo',
    to: znode1.getId(),
    data: 'request from znode2.'
  })

  console.log(rep)
}())