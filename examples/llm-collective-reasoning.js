import { Node } from '../src/index.js'

/**
 * 🧠 Collective LLM Reasoning System
 * 
 * Demonstrates a distributed reasoning architecture where specialized nodes
 * collaborate to solve complex problems using cyclic token flow.
 * 
 * Architecture:
 * - Each node has a specialized role (analyzer, researcher, reasoner, etc.)
 * - Nodes pass enriched context in a cycle
 * - Global context accumulates insights
 * - Token budget is distributed across nodes
 * - Results are synthesized from collective intelligence
 */

// ============================================================================
// NODE SPECIALIZATIONS
// ============================================================================

const NodeRole = {
  ANALYZER: 'analysis',       // Breaks down the problem  
  RESEARCHER: 'research',     // Gathers relevant information
  REASONER: 'reasoning',      // Applies logical deduction
  SYNTHESIZER: 'synthesis',   // Combines insights
  CRITIC: 'critique',         // Validates and finds flaws
  CREATIVE: 'creative'        // Generates novel approaches
}

// ============================================================================
// MOCK LLM FUNCTIONS (Replace with real LLM calls)
// ============================================================================

const mockLLM = {
  async analyze(query, context, tokenBudget) {
    console.log(`   🔍 [ANALYZER] Processing with ${tokenBudget} tokens...`)
    await sleep(100) // Simulate API call
    return {
      subProblems: ['aspect1', 'aspect2', 'aspect3'],
      complexity: 'medium',
      suggestedApproach: 'multi-step reasoning'
    }
  },

  async research(query, subProblems, tokenBudget) {
    console.log(`   📚 [RESEARCHER] Gathering info with ${tokenBudget} tokens...`)
    await sleep(100)
    return {
      findings: ['fact1', 'fact2', 'fact3'],
      relevantConcepts: ['concept1', 'concept2'],
      confidence: 0.85
    }
  },

  async reason(query, findings, tokenBudget) {
    console.log(`   🧮 [REASONER] Applying logic with ${tokenBudget} tokens...`)
    await sleep(100)
    return {
      conclusions: ['conclusion1', 'conclusion2'],
      reasoning: 'step-by-step deduction',
      confidence: 0.90
    }
  },

  async synthesize(query, allInsights, tokenBudget) {
    console.log(`   🎨 [SYNTHESIZER] Combining insights with ${tokenBudget} tokens...`)
    await sleep(100)
    return {
      finalAnswer: 'Synthesized response from collective intelligence',
      confidence: 0.92,
      sources: ['analyzer', 'researcher', 'reasoner']
    }
  },

  async critique(result, tokenBudget) {
    console.log(`   🔎 [CRITIC] Validating with ${tokenBudget} tokens...`)
    await sleep(100)
    return {
      isValid: true,
      improvements: ['minor refinement needed'],
      confidence: 0.88
    }
  },

  async brainstorm(query, context, tokenBudget) {
    console.log(`   💡 [CREATIVE] Generating ideas with ${tokenBudget} tokens...`)
    await sleep(100)
    return {
      novelIdeas: ['approach1', 'approach2', 'approach3'],
      unconventionalPaths: ['path1'],
      confidence: 0.75
    }
  }
}

// ============================================================================
// REASONING CONTEXT (Travels through the network)
// ============================================================================

function createReasoningContext(query, totalTokenBudget) {
  return {
    query,
    tokenBudget: {
      total: totalTokenBudget,
      used: 0,
      perNode: {}
    },
    insights: {
      analysis: null,
      research: null,
      reasoning: null,
      synthesis: null,
      critique: null,
      creative: null
    },
    nodeVisited: [],
    iteration: 0,
    maxIterations: 2,
    confidence: 0.0,
    startTime: Date.now()
  }
}

// Helper functions for context manipulation
const contextHelpers = {
  recordNodeVisit(context, nodeRole, tokensUsed, result) {
    context.nodeVisited.push({ role: nodeRole, timestamp: Date.now() })
    context.tokenBudget.used += tokensUsed
    context.tokenBudget.perNode[nodeRole] = (context.tokenBudget.perNode[nodeRole] || 0) + tokensUsed
    context.insights[nodeRole] = result
  },

  getRemainingTokens(context) {
    return context.tokenBudget.total - context.tokenBudget.used
  },

  isComplete(context) {
    return (
      context.insights.synthesis && 
      context.insights.critique?.isValid
    ) || context.iteration >= context.maxIterations
  },

  getStats(context) {
    return {
      totalTime: Date.now() - context.startTime,
      tokensUsed: context.tokenBudget.used,
      tokensRemaining: contextHelpers.getRemainingTokens(context),
      nodesVisited: context.nodeVisited.length,
      iterations: context.iteration,
      finalConfidence: context.confidence
    }
  }
}

// ============================================================================
// NODE HANDLERS (Each node processes according to its role)
// ============================================================================

function createSpecializedNode(role, port) {
  const node = new Node({ 
    options: { 
      role, 
      port,
      name: `${role}-node`
    } 
  })

  node.onRequest('process', async (envelope) => {
    const context = envelope.data.context
    const tokensPerNode = Math.floor(contextHelpers.getRemainingTokens(context) / 6) // Distribute equally
    
    console.log(`\n📍 Node [${role.toUpperCase()}] processing...`)
    console.log(`   Iteration: ${context.iteration + 1}`)
    console.log(`   Tokens allocated: ${tokensPerNode}`)

    let result

    switch (role) {
      case NodeRole.ANALYZER:
        result = await mockLLM.analyze(context.query, context.insights, tokensPerNode)
        contextHelpers.recordNodeVisit(context, role, tokensPerNode, result)
        break

      case NodeRole.RESEARCHER:
        if (!context.insights.analysis) {
          throw new Error('Analysis required before research')
        }
        result = await mockLLM.research(
          context.query, 
          context.insights.analysis.subProblems, 
          tokensPerNode
        )
        contextHelpers.recordNodeVisit(context, role, tokensPerNode, result)
        break

      case NodeRole.REASONER:
        if (!context.insights.research) {
          throw new Error('Research required before reasoning')
        }
        result = await mockLLM.reason(
          context.query,
          context.insights.research.findings,
          tokensPerNode
        )
        contextHelpers.recordNodeVisit(context, role, tokensPerNode, result)
        break

      case NodeRole.CREATIVE:
        result = await mockLLM.brainstorm(context.query, context.insights, tokensPerNode)
        contextHelpers.recordNodeVisit(context, role, tokensPerNode, result)
        break

      case NodeRole.SYNTHESIZER:
        if (!context.insights.reasoning) {
          throw new Error('Reasoning required before synthesis')
        }
        result = await mockLLM.synthesize(context.query, context.insights, tokensPerNode)
        contextHelpers.recordNodeVisit(context, role, tokensPerNode, result)
        context.confidence = result.confidence
        break

      case NodeRole.CRITIC:
        if (!context.insights.synthesis) {
          throw new Error('Synthesis required before critique')
        }
        result = await mockLLM.critique(context.insights.synthesis, tokensPerNode)
        contextHelpers.recordNodeVisit(context, role, tokensPerNode, result)
        
        // Decide if we need another iteration
        if (!result.isValid && context.iteration < context.maxIterations) {
          console.log('   ⚠️  Critique suggests improvements - initiating refinement cycle')
          context.iteration++
          // Reset some insights for refinement
          context.insights.synthesis = null
        }
        break
    }

    console.log(`   ✅ [${role.toUpperCase()}] Completed`)
    
    return { context, shouldContinue: !contextHelpers.isComplete(context) }
  })

  return node
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

async function runCollectiveReasoning(query, tokenBudget = 10000) {
  console.log('🧠 Collective LLM Reasoning System\n')
  console.log('━'.repeat(60))
  console.log(`📝 Query: "${query}"`)
  console.log(`🎫 Token Budget: ${tokenBudget}`)
  console.log('━'.repeat(60))

  // Create specialized nodes in a reasoning pipeline
  const nodeConfigs = [
    { role: NodeRole.ANALYZER, port: 4000 },
    { role: NodeRole.RESEARCHER, port: 4001 },
    { role: NodeRole.REASONER, port: 4002 },
    { role: NodeRole.CREATIVE, port: 4003 },
    { role: NodeRole.SYNTHESIZER, port: 4004 },
    { role: NodeRole.CRITIC, port: 4005 }
  ]

  console.log('\n🔧 Initializing specialized nodes...\n')

  const nodes = []

  // Create and bind all nodes
  for (const config of nodeConfigs) {
    const node = createSpecializedNode(config.role, config.port)
    await node.bind(`tcp://127.0.0.1:${config.port}`)
    nodes.push({ node, config })
    console.log(`✅ [${config.role.toUpperCase()}] node bound to port ${config.port}`)
  }

  // Create orchestrator node that will coordinate everything
  console.log('\n🎛️  Creating orchestrator node...')
  const orchestrator = new Node({ options: { role: 'orchestrator' } })
  await orchestrator.bind('tcp://127.0.0.1:3999')
  console.log('✅ Orchestrator bound to port 3999')

  // Connect orchestrator to all worker nodes
  console.log('\n🔗 Connecting orchestrator to all nodes...\n')
  for (const { node, config } of nodes) {
    await orchestrator.connect({ address: node.getAddress() })
    console.log(`   orchestrator → ${config.role}`)
  }

  // Create reasoning context
  const context = createReasoningContext(query, tokenBudget)

  console.log('\n━'.repeat(60))
  console.log('🚀 Starting collective reasoning process...')
  console.log('━'.repeat(60))

  // Process through each node in sequence
  let currentContext = context
  
  for (const { node, config } of nodes) {
    if (contextHelpers.isComplete(currentContext)) {
      console.log('\n✅ Reasoning complete!')
      break
    }

    const result = await orchestrator.request({
      to: node.getId(),
      event: 'process',
      data: { context: currentContext },
      timeout: 5000
    })

    currentContext = result.context
  }

  // Display results
  console.log('\n━'.repeat(60))
  console.log('📊 RESULTS')
  console.log('━'.repeat(60))

  const stats = contextHelpers.getStats(currentContext)
  
  console.log(`\n📈 Statistics:`)
  console.log(`   Total Time: ${stats.totalTime}ms`)
  console.log(`   Tokens Used: ${stats.tokensUsed} / ${tokenBudget}`)
  console.log(`   Efficiency: ${((stats.tokensUsed / tokenBudget) * 100).toFixed(1)}%`)
  console.log(`   Nodes Visited: ${stats.nodesVisited}`)
  console.log(`   Iterations: ${stats.iterations}`)
  console.log(`   Final Confidence: ${(stats.finalConfidence * 100).toFixed(1)}%`)

  console.log(`\n🎯 Final Answer:`)
  console.log(`   ${currentContext.insights.synthesis?.finalAnswer || 'No synthesis available'}`)

  console.log(`\n💡 Key Insights:`)
  console.log(`   Analysis: ${JSON.stringify(currentContext.insights.analysis?.suggestedApproach)}`)
  console.log(`   Research: ${currentContext.insights.research?.findings?.length || 0} findings`)
  console.log(`   Reasoning: ${currentContext.insights.reasoning?.conclusions?.length || 0} conclusions`)
  console.log(`   Creative: ${currentContext.insights.creative?.novelIdeas?.length || 0} novel ideas`)
  console.log(`   Critique: ${currentContext.insights.critique?.isValid ? '✅ Valid' : '❌ Needs improvement'}`)

  console.log('\n━'.repeat(60))
  console.log('✨ Collective reasoning complete!')
  console.log('━'.repeat(60))

  // Cleanup
  await orchestrator.stop()
  await Promise.all(nodes.map(({ node }) => node.stop()))
}

// ============================================================================
// HELPER
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// RUN EXAMPLE
// ============================================================================

(async () => {
  try {
    await runCollectiveReasoning(
      'What are the implications of quantum computing on current encryption methods?',
      10000
    )
    
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err)
    process.exit(1)
  }
})()

