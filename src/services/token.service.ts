import type { TokenUsage, CompletionMetrics } from './openai.service.js'

export interface ModelPricing {
  inputTokensPerDollar: number
  outputTokensPerDollar: number
  inputCostPer1000: number
  outputCostPer1000: number
}

export interface TokenTransaction {
  id: string
  timestamp: number
  userId: string
  model: string
  usage: TokenUsage
  cost: number
  operation: 'completion' | 'streaming' | 'embedding'
  requestId?: string
  optimizationType?: string
  documentCount?: number
}

export interface TokenUsageStats {
  totalRequests: number
  totalTokens: number
  totalCost: number
  modelBreakdown: Record<string, {
    requests: number
    tokens: number
    cost: number
  }>
  periodStats: {
    last24h: TokenUsagePeriod
    last7d: TokenUsagePeriod
    last30d: TokenUsagePeriod
  }
}

export interface TokenUsagePeriod {
  requests: number
  tokens: number
  cost: number
  avgTokensPerRequest: number
}

export interface TokenBudget {
  dailyLimit: number
  monthlyLimit: number
  dailyUsed: number
  monthlyUsed: number
  dailyRemaining: number
  monthlyRemaining: number
  alertThresholds: {
    daily: number // percentage (e.g., 80 for 80%)
    monthly: number
  }
}

export class TokenManager {
  private transactions: Map<string, TokenTransaction[]> = new Map()
  private readonly modelPricing: Record<string, ModelPricing>

  constructor() {
    // Current OpenAI pricing as of 2024 (per 1000 tokens)
    this.modelPricing = {
      'gpt-4': {
        inputTokensPerDollar: 33333, // $0.03 per 1k tokens
        outputTokensPerDollar: 16667, // $0.06 per 1k tokens
        inputCostPer1000: 0.03,
        outputCostPer1000: 0.06
      },
      'gpt-4-turbo': {
        inputTokensPerDollar: 100000, // $0.01 per 1k tokens
        outputTokensPerDollar: 33333,  // $0.03 per 1k tokens
        inputCostPer1000: 0.01,
        outputCostPer1000: 0.03
      },
      'gpt-3.5-turbo': {
        inputTokensPerDollar: 500000, // $0.002 per 1k tokens
        outputTokensPerDollar: 500000, // $0.002 per 1k tokens
        inputCostPer1000: 0.002,
        outputCostPer1000: 0.002
      },
      'gpt-4o': {
        inputTokensPerDollar: 200000, // $0.005 per 1k tokens
        outputTokensPerDollar: 66667,  // $0.015 per 1k tokens
        inputCostPer1000: 0.005,
        outputCostPer1000: 0.015
      },
      'gpt-4o-mini': {
        inputTokensPerDollar: 6666667, // $0.00015 per 1k tokens
        outputTokensPerDollar: 1666667, // $0.0006 per 1k tokens
        inputCostPer1000: 0.00015,
        outputCostPer1000: 0.0006
      }
    }
  }

  /**
   * Calculate the cost of token usage for a specific model
   */
  calculateCost(model: string, usage: TokenUsage): number {
    const pricing = this.modelPricing[model] || this.modelPricing['gpt-3.5-turbo']!
    
    const inputCost = (usage.promptTokens / 1000) * pricing.inputCostPer1000
    const outputCost = (usage.completionTokens / 1000) * pricing.outputCostPer1000
    
    return inputCost + outputCost
  }

  /**
   * Record a token transaction
   */
  recordTransaction(
    userId: string,
    metrics: CompletionMetrics,
    operation: 'completion' | 'streaming' | 'embedding' = 'completion',
    additionalData?: {
      optimizationType?: string
      documentCount?: number
    }
  ): TokenTransaction {
    const cost = this.calculateCost(metrics.model, metrics.usage)
    
    const transaction: TokenTransaction = {
      id: this.generateTransactionId(),
      timestamp: Date.now(),
      userId,
      model: metrics.model,
      usage: metrics.usage,
      cost,
      operation,
      requestId: metrics.requestId,
      optimizationType: additionalData?.optimizationType,
      documentCount: additionalData?.documentCount
    }

    // Store transaction
    const userTransactions = this.transactions.get(userId) || []
    userTransactions.push(transaction)
    this.transactions.set(userId, userTransactions)

    // Cleanup old transactions (older than 90 days)
    this.cleanupOldTransactions(userId)

    console.log(`💰 Token transaction recorded: ${metrics.usage.totalTokens} tokens, $${cost.toFixed(4)} (${metrics.model})`)

    return transaction
  }

  /**
   * Get token usage statistics for a user
   */
  getUsageStats(userId: string): TokenUsageStats {
    const transactions = this.transactions.get(userId) || []
    const now = Date.now()

    // Filter transactions by time periods
    const last24h = transactions.filter(t => now - t.timestamp <= 24 * 60 * 60 * 1000)
    const last7d = transactions.filter(t => now - t.timestamp <= 7 * 24 * 60 * 60 * 1000)
    const last30d = transactions.filter(t => now - t.timestamp <= 30 * 24 * 60 * 60 * 1000)

    // Calculate totals
    const totalRequests = transactions.length
    const totalTokens = transactions.reduce((sum, t) => sum + t.usage.totalTokens, 0)
    const totalCost = transactions.reduce((sum, t) => sum + t.cost, 0)

    // Model breakdown
    const modelBreakdown: Record<string, { requests: number; tokens: number; cost: number }> = {}
    transactions.forEach(t => {
      if (!modelBreakdown[t.model]) {
        modelBreakdown[t.model] = { requests: 0, tokens: 0, cost: 0 }
      }
      modelBreakdown[t.model]!.requests++
      modelBreakdown[t.model]!.tokens += t.usage.totalTokens
      modelBreakdown[t.model]!.cost += t.cost
    })

    return {
      totalRequests,
      totalTokens,
      totalCost,
      modelBreakdown,
      periodStats: {
        last24h: this.calculatePeriodStats(last24h),
        last7d: this.calculatePeriodStats(last7d),
        last30d: this.calculatePeriodStats(last30d)
      }
    }
  }

  /**
   * Get token budget information for a user
   */
  getTokenBudget(userId: string, dailyLimit: number = 10000, monthlyLimit: number = 250000): TokenBudget {
    const now = Date.now()
    const startOfDay = new Date().setHours(0, 0, 0, 0)
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()

    const transactions = this.transactions.get(userId) || []
    
    const dailyUsed = transactions
      .filter(t => t.timestamp >= startOfDay)
      .reduce((sum, t) => sum + t.usage.totalTokens, 0)
    
    const monthlyUsed = transactions
      .filter(t => t.timestamp >= startOfMonth)
      .reduce((sum, t) => sum + t.usage.totalTokens, 0)

    return {
      dailyLimit,
      monthlyLimit,
      dailyUsed,
      monthlyUsed,
      dailyRemaining: Math.max(0, dailyLimit - dailyUsed),
      monthlyRemaining: Math.max(0, monthlyLimit - monthlyUsed),
      alertThresholds: {
        daily: 80, // 80% threshold
        monthly: 90 // 90% threshold
      }
    }
  }

  /**
   * Check if user has exceeded token budgets
   */
  checkBudgetLimits(userId: string, requestedTokens: number, dailyLimit?: number, monthlyLimit?: number): {
    allowed: boolean
    reason?: string
    budget: TokenBudget
  } {
    const budget = this.getTokenBudget(userId, dailyLimit, monthlyLimit)
    
    if (budget.dailyUsed + requestedTokens > budget.dailyLimit) {
      return {
        allowed: false,
        reason: 'Daily token limit exceeded',
        budget
      }
    }
    
    if (budget.monthlyUsed + requestedTokens > budget.monthlyLimit) {
      return {
        allowed: false,
        reason: 'Monthly token limit exceeded',
        budget
      }
    }

    return { allowed: true, budget }
  }

  /**
   * Get cost estimate for a request
   */
  estimateCost(model: string, estimatedTokens: number): number {
    const pricing = this.modelPricing[model] || this.modelPricing['gpt-3.5-turbo']!
    
    // Estimate roughly 70% input, 30% output tokens
    const estimatedInput = Math.floor(estimatedTokens * 0.7)
    const estimatedOutput = Math.floor(estimatedTokens * 0.3)
    
    const inputCost = (estimatedInput / 1000) * pricing.inputCostPer1000
    const outputCost = (estimatedOutput / 1000) * pricing.outputCostPer1000
    
    return inputCost + outputCost
  }

  /**
   * Get model pricing information
   */
  getModelPricing(): Record<string, ModelPricing> {
    return { ...this.modelPricing }
  }

  /**
   * Get recent transactions for a user
   */
  getRecentTransactions(userId: string, limit: number = 50): TokenTransaction[] {
    const transactions = this.transactions.get(userId) || []
    return transactions
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  /**
   * Get aggregate statistics across all users (admin function)
   */
  getGlobalStats(): {
    totalUsers: number
    totalTransactions: number
    totalTokens: number
    totalCost: number
    modelUsage: Record<string, number>
  } {
    let totalTransactions = 0
    let totalTokens = 0
    let totalCost = 0
    const modelUsage: Record<string, number> = {}

    for (const userTransactions of this.transactions.values()) {
      totalTransactions += userTransactions.length
      
      userTransactions.forEach(t => {
        totalTokens += t.usage.totalTokens
        totalCost += t.cost
        modelUsage[t.model] = (modelUsage[t.model] || 0) + t.usage.totalTokens
      })
    }

    return {
      totalUsers: this.transactions.size,
      totalTransactions,
      totalTokens,
      totalCost,
      modelUsage
    }
  }

  private calculatePeriodStats(transactions: TokenTransaction[]): TokenUsagePeriod {
    const requests = transactions.length
    const tokens = transactions.reduce((sum, t) => sum + t.usage.totalTokens, 0)
    const cost = transactions.reduce((sum, t) => sum + t.cost, 0)
    const avgTokensPerRequest = requests > 0 ? tokens / requests : 0

    return { requests, tokens, cost, avgTokensPerRequest }
  }

  private generateTransactionId(): string {
    return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private cleanupOldTransactions(userId: string): void {
    const transactions = this.transactions.get(userId) || []
    const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000) // 90 days ago
    
    const recentTransactions = transactions.filter(t => t.timestamp > cutoff)
    this.transactions.set(userId, recentTransactions)
  }
}

// Global token manager instance
export const tokenManager = new TokenManager()