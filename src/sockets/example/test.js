import {Dealer, Router, SocketEvent} from '../index'

let routerAddress1 = 'tcp://127.0.0.1:5034'
let routerAddress2 = 'tcp://127.0.0.1:5035'

const runDealer = async () => {
  let dealer1 = new Dealer({ id: 'TestDealer1', options: {layer: 'DealerLayer1'} })

  let dealer2 = new Dealer({ id: 'TestDealer2', options: {layer: 'DealerLayer2'} })

  dealer1.debugMode(true)
  await dealer1.connect(routerAddress1)
  await dealer2.connect(routerAddress2)

  dealer1.on(SocketEvent.RECONNECT, () => { console.log('Reconnecting') })
  dealer1.on(SocketEvent.DISCONNECT, () => {
    console.log('Dealer 1 SocketEvent.DISCONNECT')

    dealer1.disconnect()
  })
}

const runRouter = async () => {
  let router1 = new Router({ id: 'TestRouter1', options: {layer: 'RouterLayer1'} })
  let router2 = new Router({ id: 'TestRouter2', options: {layer: 'RouterLayer2'} })

  router1.debugMode(true)
  router2.debugMode(true)

  await router1.bind(routerAddress1)
  await router2.bind(routerAddress2)

  runDealer()

  setTimeout(async () => {
    console.log(`Start unbind from ${routerAddress1} .... `)
    await router1.unbind()
    console.log(`Finish unbind from ${routerAddress1} .... `)
  }, 5000)
}

runRouter()
