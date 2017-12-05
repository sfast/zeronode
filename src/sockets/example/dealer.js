import {Dealer, SocketEvent} from '../index'

const runDealer = async () => {
  let routerAddress1 = 'tcp://127.0.0.1:5039'
  let routerAddress2 = 'tcp://127.0.0.1:5040'

  let dealer1 = new Dealer({ id: 'TestDealer1', options: {layer: 'DealerLayer1'} })
  let dealer2 = new Dealer({ id: 'TestDealer2', options: {layer: 'DealerLayer2'} })

  dealer1.debugMode(true)
  await dealer1.connect(routerAddress1)
  await dealer2.connect(routerAddress2)

  dealer1.on(SocketEvent.RECONNECT, () => { console.log('TestDealer1 reconnecting...') })
  dealer1.on(SocketEvent.DISCONNECT, () => {
    console.log('TestDealer1 SocketEvent.DISCONNECT')
    console.log('TestDealer1 disconnecting')
    dealer1.disconnect()
  })
}

runDealer()
