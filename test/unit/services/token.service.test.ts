import { describe, it, expect, beforeEach } from 'vitest'
import { TokenManager } from '../../../src/services/token.service.js'
import type { CompletionMetrics } from '../../../src/services/openai.service.js'

describe('TokenManager', () => {
  let tokenManager: TokenManager

  beforeEach(() => {
    tokenManager = new TokenManager()
  })

  describe('calculateCost', () => {
    it('should calculate cost for gpt-3.5-turbo correctly', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      }

      const cost = tokenManager.calculateCost('gpt-3.5-turbo', usage)
      
      // $0.002 per 1k tokens for both input and output
      expect(cost).toBe(0.003) // (1000/1000 * 0.002) + (500/1000 * 0.002)
    })

    it('should calculate cost for gpt-4 correctly', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      }

      const cost = tokenManager.calculateCost('gpt-4', usage)
      
      // $0.03 per 1k input tokens, $0.06 per 1k output tokens
      expect(cost).toBe(0.06) // (1000/1000 * 0.03) + (500/1000 * 0.06)
    })

    it('should fallback to gpt-3.5-turbo pricing for unknown models', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      }

      const cost = tokenManager.calculateCost('unknown-model', usage)
      
      expect(cost).toBe(0.003) // Same as gpt-3.5-turbo
    })
  })

  describe('recordTransaction', () => {
    it('should record a transaction successfully', () => {
      const metrics: CompletionMetrics = {
        model: 'gpt-3.5-turbo',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        },
        duration: 1000,
        requestId: 'req-123',
        cost: 0.0003
      }

      const transaction = tokenManager.recordTransaction(
        'user-123',
        metrics,
        'completion',
        { optimizationType: 'clarity', documentCount: 1 }
      )

      expect(transaction).toMatchObject({
        id: expect.stringMatching(/^txn_/),
        timestamp: expect.any(Number),
        userId: 'user-123',
        model: 'gpt-3.5-turbo',
        usage: metrics.usage,
        cost: expect.any(Number),
        operation: 'completion',
        requestId: 'req-123',
        optimizationType: 'clarity',
        documentCount: 1
      })
    })
  })

  describe('getUsageStats', () => {
    it('should return empty stats for new user', () => {
      const stats = tokenManager.getUsageStats('new-user')

      expect(stats).toMatchObject({
        totalRequests: 0,
        totalTokens: 0,
        totalCost: 0,
        modelBreakdown: {},
        periodStats: {
          last24h: { requests: 0, tokens: 0, cost: 0, avgTokensPerRequest: 0 },
          last7d: { requests: 0, tokens: 0, cost: 0, avgTokensPerRequest: 0 },
          last30d: { requests: 0, tokens: 0, cost: 0, avgTokensPerRequest: 0 }
        }
      })
    })

    it('should aggregate stats correctly after transactions', () => {
      const userId = 'test-user'
      
      // Record multiple transactions
      for (let i = 0; i < 3; i++) {
        const metrics: CompletionMetrics = {
          model: 'gpt-3.5-turbo',
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150
          },
          duration: 1000,
          cost: 0.0003
        }
        
        tokenManager.recordTransaction(userId, metrics, 'completion')
      }

      const stats = tokenManager.getUsageStats(userId)

      expect(stats.totalRequests).toBe(3)
      expect(stats.totalTokens).toBe(450) // 150 * 3
      expect(stats.totalCost).toBeCloseTo(0.0009, 4) // 0.0003 * 3
      expect(stats.modelBreakdown['gpt-3.5-turbo']).toMatchObject({
        requests: 3,
        tokens: 450,
        cost: expect.any(Number)
      })
    })
  })

  describe('getTokenBudget', () => {
    it('should return correct budget for new user', () => {
      const budget = tokenManager.getTokenBudget('new-user', 10000, 250000)

      expect(budget).toMatchObject({
        dailyLimit: 10000,
        monthlyLimit: 250000,
        dailyUsed: 0,
        monthlyUsed: 0,
        dailyRemaining: 10000,
        monthlyRemaining: 250000,
        alertThresholds: {
          daily: 80,
          monthly: 90
        }
      })
    })

    it('should track daily usage correctly', () => {
      const userId = 'budget-user'
      const metrics: CompletionMetrics = {
        model: 'gpt-3.5-turbo',
        usage: {
          promptTokens: 500,
          completionTokens: 500,
          totalTokens: 1000
        },
        duration: 1000,
        cost: 0.002
      }
      
      tokenManager.recordTransaction(userId, metrics, 'completion')
      
      const budget = tokenManager.getTokenBudget(userId, 10000, 250000)
      
      expect(budget.dailyUsed).toBe(1000)
      expect(budget.dailyRemaining).toBe(9000)
    })
  })

  describe('checkBudgetLimits', () => {
    it('should allow requests within budget', () => {
      const result = tokenManager.checkBudgetLimits('new-user', 1000, 10000, 250000)

      expect(result.allowed).toBe(true)
      expect(result.budget.dailyRemaining).toBe(10000)
    })

    it('should reject requests exceeding daily limit', () => {
      const result = tokenManager.checkBudgetLimits('new-user', 15000, 10000, 250000)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Daily token limit exceeded')
    })

    it('should reject requests exceeding monthly limit', () => {
      const result = tokenManager.checkBudgetLimits('new-user', 300000, 10000, 250000)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Monthly token limit exceeded')
    })
  })

  describe('estimateCost', () => {
    it('should estimate cost correctly', () => {
      const cost = tokenManager.estimateCost('gpt-3.5-turbo', 1000)
      
      // 70% input (700 tokens), 30% output (300 tokens)
      // $0.002 per 1k tokens for both
      const expectedCost = (700 / 1000 * 0.002) + (300 / 1000 * 0.002)
      
      expect(cost).toBeCloseTo(expectedCost, 6)
    })

    it('should handle different models', () => {
      const gpt3Cost = tokenManager.estimateCost('gpt-3.5-turbo', 1000)
      const gpt4Cost = tokenManager.estimateCost('gpt-4', 1000)
      
      expect(gpt4Cost).toBeGreaterThan(gpt3Cost)
    })
  })

  describe('getModelPricing', () => {
    it('should return pricing for all supported models', () => {
      const pricing = tokenManager.getModelPricing()

      expect(pricing).toHaveProperty('gpt-3.5-turbo')
      expect(pricing).toHaveProperty('gpt-4')
      expect(pricing).toHaveProperty('gpt-4-turbo')
      expect(pricing).toHaveProperty('gpt-4o')
      expect(pricing).toHaveProperty('gpt-4o-mini')

      expect(pricing['gpt-3.5-turbo']).toMatchObject({
        inputTokensPerDollar: expect.any(Number),
        outputTokensPerDollar: expect.any(Number),
        inputCostPer1000: expect.any(Number),
        outputCostPer1000: expect.any(Number)
      })
    })
  })

  describe('getRecentTransactions', () => {
    it('should return transactions in reverse chronological order', () => {
      const userId = 'transaction-user'
      
      // Record transactions with slight delays
      for (let i = 0; i < 3; i++) {
        const metrics: CompletionMetrics = {
          model: 'gpt-3.5-turbo',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          duration: 1000,
          cost: 0.0003
        }
        
        tokenManager.recordTransaction(userId, metrics, 'completion')
      }

      const transactions = tokenManager.getRecentTransactions(userId, 10)

      expect(transactions).toHaveLength(3)
      
      // Should be in reverse chronological order (newest first)
      for (let i = 0; i < transactions.length - 1; i++) {
        expect(transactions[i]!.timestamp).toBeGreaterThanOrEqual(transactions[i + 1]!.timestamp)
      }
    })

    it('should limit results correctly', () => {
      const userId = 'limit-user'
      
      // Record 5 transactions
      for (let i = 0; i < 5; i++) {
        const metrics: CompletionMetrics = {
          model: 'gpt-3.5-turbo',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          duration: 1000,
          cost: 0.0003
        }
        
        tokenManager.recordTransaction(userId, metrics, 'completion')
      }

      const transactions = tokenManager.getRecentTransactions(userId, 3)

      expect(transactions).toHaveLength(3)
    })
  })

  describe('getGlobalStats', () => {
    it('should aggregate stats across all users', () => {
      // Record transactions for multiple users
      const users = ['user1', 'user2', 'user3']
      
      users.forEach(userId => {
        const metrics: CompletionMetrics = {
          model: 'gpt-3.5-turbo',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          duration: 1000,
          cost: 0.0003
        }
        
        tokenManager.recordTransaction(userId, metrics, 'completion')
      })

      const globalStats = tokenManager.getGlobalStats()

      expect(globalStats.totalUsers).toBe(3)
      expect(globalStats.totalTransactions).toBe(3)
      expect(globalStats.totalTokens).toBe(450) // 150 * 3
      expect(globalStats.modelUsage['gpt-3.5-turbo']).toBe(450)
    })
  })
})