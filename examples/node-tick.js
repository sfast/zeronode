import Promise from 'bluebird'
import Node from '../src/node'

const MESSAGE_COUNT = 1000
const SETINTERVAL_COUNT = 100
const SETINTERVAL_TIME = 100

let dns = new Node({ bind: 'tcp://127.0.0.1:6000', options: { layer: 'DNS' } })

let layerA = new Node({ bind: 'tcp://127.0.0.1:6001', options: { layer: 'A' } })
let layerB = new Node({ bind: 'tcp://127.0.0.1:6002', options: { layer: 'B' } })

let errPrint = (err) => { console.log('error', err) }

let all = []

all.push(dns.bind())
all.push(layerA.bind())
all.push(layerB.bind())

let _intervals = []

let _clearIntervals = () => {
  _intervals.forEach((tickIntervalItem) => {
    clearInterval(tickIntervalItem)
  })
}

let start = null

let tickWithInterval = (t) => {
  let intervalCleaner = setInterval(() => {
    if (!start) {
      start = Date.now()
    }
    layerA.tickAny({ event: 'WELCOME-A', data: {node: layerA.getId(), name: 'layerA'}, filter: {layer: 'DNS'} })
    layerB.tickAny({ event: 'WELCOME-B', data: {node: layerB.getId(), name: 'layerB'}, filter: {layer: /^DNS/} })
        // _clearIntervals()
  }, t)

  _intervals.push(intervalCleaner)
}

let run = async () => {
  console.log('RUN')

  let i = 0

  await Promise.all(all)
  console.log('All nodes are binded')
  await layerA.connect({ address: dns.getAddress() })
  console.log('Layer A connected')
  await layerB.connect({ address: dns.getAddress() })
  console.log('Layer B connected')

  dns.onTick(/^WELCOME/, (data) => {
    i++
    if (i === MESSAGE_COUNT) {
      _clearIntervals()
      console.log(`Time passed: `, Date.now() - start)
    }
  })

  for (let j = 0; j < SETINTERVAL_COUNT; j++) {
    tickWithInterval(SETINTERVAL_TIME)
  }
}

run()
