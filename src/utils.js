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
    let notsatisfying = _.find(optionsKeysArray, (optionKey) => {
      let optionValue = options[optionKey]
      // ** which could also not exist
      let nodeOptionValue = nodeOptions[optionKey]

      if (nodeOptionValue) {
        if (_.isRegExp(optionValue)) {
          return !optionValue.test(nodeOptionValue)
        }

        if (_.isString(optionValue) || _.isNumber(optionValue)) {
          return optionValue !== nodeOptionValue
        }

        if (_.isObject(optionValue)) {
            return !!_.find(optionValue, (value, operator) => {
                switch (operator) {
                    case '$eq':
                        return value !== nodeOptionValue
                    case '$ne':
                        return value === nodeOptionValue
                    case '$aeq':
                        return value != nodeOptionValue
                    case '$gt':
                        return value >= nodeOptionValue
                    case '$gte':
                        return value > nodeOptionValue
                    case '$lt':
                        return value <= nodeOptionValue
                    case '$lte':
                        return value < nodeOptionValue
                    case '$between':
                        return value[0] >= nodeOptionValue || value[1] <= nodeOptionValue
                    case '$regex':
                        return !value.test(nodeOptionValue)
                    case '$in':
                        return value.indexOf(nodeOptionValue) === -1
                    case '$nin':
                        return value.indexOf(nodeOptionValue) !== -1
                    case '$contains':
                        return nodeOptionValue.indexOf(value) === -1
                    case '$containsAny':
                        return !!_.find(value, (v) => nodeOptionValue.indexOf(v) === -1)
                    case '$containsNone':
                        return !!_.find(value, (v) => nodeOptionValue.indexOf(v) !== -1)
                }
            })
        }
      }

      return true
    })

    return !notsatisfying
  }
}

export default {
  checkNodeReducer,
  optionsPredicateBuilder
}
