import zmq from 'zmq'

zmq.Context.setMaxThreads(8)

let getMaxThreads = zmq.Context.getMaxThreads()
let getMaxSockets = zmq.Context.getMaxSockets()

console.log('getMaxThreads', getMaxThreads)
console.log('getMaxSockets', getMaxSockets)

let dealer1 = zmq.socket('dealer')
let dealer2 = zmq.socket('dealer')

let router1 = zmq.socket('router')
let router2 = zmq.socket('router')

// ** BUG scenario
// router1.monitor(10, 0)
// router2.monitor(10, 0)
// dealer1.monitor(10, 0)
// dealer2.monitor(10, 0)

let ADDRESS1 = 'tcp://127.0.0.1:5080'
let ADDRESS2 = 'tcp://127.0.0.1:5081'

router1.bindSync(ADDRESS1)
router2.bindSync(ADDRESS2)

// ** FIX scenario
router1.monitor(10, 0)
router2.monitor(10, 0)

dealer1.on('connect', () => {
  console.log('dealer1 connected')
})
dealer2.on('connect', () => {
  console.log('dealer2 connected')
})

dealer1.connect(ADDRESS1)

// ** IMPORTANT TO START MONITOR dealer1.monitor(10, 0)
dealer2.connect(ADDRESS2)

// ** FIX scenario
dealer1.monitor(10, 0)
dealer2.monitor(10, 0)

router2.on('message', (data) => {
  console.log(data)
})

setInterval(() => {
  // dealer2.send(new Buffer(5));
}, 1000)

setTimeout(() => {
  console.log(1)
  router1.unmonitor()
  router1.unbindSync(ADDRESS1)
  console.log(2)
  setTimeout(() => {
    console.log(3)
    dealer1.removeAllListeners()
    dealer1.unmonitor()
    dealer1.disconnect(ADDRESS1)
  }, 2000)
}, 3000)
