import Seneca from 'seneca'
import _ from 'underscore'

let seneca = Seneca()
seneca.client({port: 9000, type: 'tcp'})
let start = Date.now()

let count = 0
_.each(_.range(50000), () => {
  seneca.act('foo:bar', new Buffer(1000), (err, resp) => {
    count++;
    count === 50000 && console.log(Date.now() - start)
  })
})