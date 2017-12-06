import {Router} from '../index'

const runRouter = async () => {
  let bindAddress1 = 'tcp://127.0.0.1:5039'
  let bindAddress2 = 'tcp://127.0.0.1:5040'

  let router1 = new Router({ id: 'TestRouter1', options: {layer: 'RouterLayer1'} })
  let router2 = new Router({ id: 'TestRouter2', options: {layer: 'RouterLayer2'} })

  router1.debugMode(true)
  router2.debugMode(true)

  await router1.bind(bindAddress1)

  await router2.bind(bindAddress2)

  // setTimeout(async () => {
  //   console.log(`Start unbind from ${bindAddress1} .... `)
  //   await router1.unbind()
  //   console.log(`Finish unbind from ${bindAddress1} .... `)
  // }, 10000)
}

runRouter()
