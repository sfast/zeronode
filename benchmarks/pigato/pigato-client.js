import { Client } from 'pigato'
import _ from 'underscore'

let client = new Client('tcp://127.0.0.1:8000')

client.on('connect', () => {
  let count = 0
    , start = Date.now()

  _.each(_.range(50000), () => {
    client.request('foo', new Buffer(1000), { timeout: 100000})
      .on('data', (...resp) => {
        count++
        count === 50000 && console.log(Date.now() - start)
      })
  })
  console.log('client successfully connected.')
})

client.start()