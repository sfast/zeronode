import Seneca from 'seneca'

let seneca = Seneca({timeout: 1000000});

seneca.add('foo:*', (msg, reply) => {
  // console.log('received request:', msg)
  reply(new Buffer(1000))
})

seneca.listen({port: 9000, type: 'tcp'})