import { Broker } from 'pigato'

let broker = new Broker('tcp://*:8000')
broker.on('start', () => {
  console.log('broker started')
})
broker.start()