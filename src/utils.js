import _ from 'underscore'

// ** we use this to check if node is satisfying the predicate and adding node id into accumulatorSet
const checkNodeReducer = (node, predicate, accumulatorSet) => {
  let nodeOptions = node.getOptions()
  if (_.isFunction(predicate) && predicate(nodeOptions)) {
    accumulatorSet.add(node.getId())
  }
}

const optionsPredicateBuilder = (options) => {
  return (nodeOptions) => {
    let optionsKeysArray = Object.keys(options)
    let satisfying = _.find(optionsKeysArray, (optionKey) => {
      let optionValue = options[optionKey]
      // ** which could also not exist
      let nodeOptionValue = nodeOptions[optionKey]

      if (nodeOptionValue) {
        if (_.isRegExp(optionValue)) {
          return optionValue.test(nodeOptionValue)
        }

        if (_.isString(optionValue)) {
          return optionValue.test(nodeOptionValue)
        }
      }

      return false
    })

    return !!satisfying
  }
}

export default {
  checkNodeReducer,
  optionsPredicateBuilder
}
