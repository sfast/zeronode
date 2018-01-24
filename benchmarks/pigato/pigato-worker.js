import { Worker } from 'pigato'

let worker = new Worker('tcp://127.0.0.1:8000', 'foo', {
  concurrency: -1
})

worker.on('connect', () => {
  console.log('Worker successfully connected.')
})

worker.on('request', (msg, reply) => {
  reply.write(new Buffer(1000))
  reply.end()
})

worker.start()