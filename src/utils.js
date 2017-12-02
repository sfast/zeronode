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
    let notSatisfying = !!_.find(options, (filterValue, filterKey) => {
      if (filterValue instanceof RegExp && typeof nodeOptions[filterKey] === 'string') {
        return !filterValue.test(nodeOptions[filterKey])
      } else if (!(filterValue instanceof RegExp)) {
        return !(filterValue === nodeOptions[filterKey])
      }
      return true
    })

    return !notSatisfying
  }
}

export default {
  checkNodeReducer,
  optionsPredicateBuilder
}
