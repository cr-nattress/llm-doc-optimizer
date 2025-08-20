import { env } from '../config/environment.js'

export interface CacheEntry<T = any> {
  value: T
  expires: number
  created: number
  hits: number
}

export interface CacheConfig {
  ttl: number // Time to live in seconds
  maxSize: number // Maximum number of entries
  enableCompression: boolean
  enableMetrics: boolean
}

export interface CacheMetrics {
  hits: number
  misses: number
  sets: number
  deletes: number
  evictions: number
  size: number
  memoryUsage: number
}

// In-memory cache implementation
export class MemoryCache {
  private cache = new Map<string, CacheEntry>()
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    size: 0,
    memoryUsage: 0
  }

  constructor(private config: CacheConfig) {}

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    
    if (!entry) {
      this.metrics.misses++
      return null
    }

    // Check if expired
    if (Date.now() > entry.expires) {
      this.cache.delete(key)
      this.metrics.misses++
      this.metrics.evictions++
      return null
    }

    entry.hits++
    this.metrics.hits++
    return entry.value as T
  }

  set<T>(key: string, value: T, ttl?: number): void {
    const actualTtl = (ttl || this.config.ttl) * 1000
    const now = Date.now()
    
    // Check cache size limit
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictOldest()
    }

    const entry: CacheEntry<T> = {
      value,
      expires: now + actualTtl,
      created: now,
      hits: 0
    }

    this.cache.set(key, entry)
    this.metrics.sets++
    this.updateMemoryUsage()
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key)
    if (deleted) {
      this.metrics.deletes++
      this.updateMemoryUsage()
    }
    return deleted
  }

  clear(): void {
    this.cache.clear()
    this.resetMetrics()
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    return entry !== undefined && Date.now() <= entry.expires
  }

  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  size(): number {
    return this.cache.size
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.created < oldestTime) {
        oldestTime = entry.created
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      this.metrics.evictions++
    }
  }

  private updateMemoryUsage(): void {
    this.metrics.size = this.cache.size
    // Rough estimate of memory usage
    this.metrics.memoryUsage = this.cache.size * 1024 // Assume 1KB per entry on average
  }

  private resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      size: 0,
      memoryUsage: 0
    }
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics }
  }

  // Cleanup expired entries
  cleanup(): number {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key)
        cleaned++
      }
    }

    this.metrics.evictions += cleaned
    this.updateMemoryUsage()
    return cleaned
  }
}

// Redis cache implementation (for production)
export class RedisCache {
  private redis: any // Redis client
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    size: 0,
    memoryUsage: 0
  }

  constructor(private config: CacheConfig, redisUrl?: string) {
    if (redisUrl) {
      this.initRedis(redisUrl)
    }
  }

  private async initRedis(url: string): Promise<void> {
    console.warn('Redis not available in serverless environment, using memory cache only')
    this.redis = null
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null

    try {
      const value = await this.redis.get(key)
      if (value) {
        this.metrics.hits++
        return JSON.parse(value) as T
      } else {
        this.metrics.misses++
        return null
      }
    } catch (error) {
      console.error('Redis get error:', error)
      this.metrics.misses++
      return null
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    if (!this.redis) return

    try {
      const actualTtl = ttl || this.config.ttl
      await this.redis.setEx(key, actualTtl, JSON.stringify(value))
      this.metrics.sets++
    } catch (error) {
      console.error('Redis set error:', error)
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.redis) return false

    try {
      const result = await this.redis.del(key)
      if (result > 0) {
        this.metrics.deletes++
        return true
      }
      return false
    } catch (error) {
      console.error('Redis delete error:', error)
      return false
    }
  }

  async clear(): Promise<void> {
    if (!this.redis) return

    try {
      await this.redis.flushDb()
      this.resetMetrics()
    } catch (error) {
      console.error('Redis clear error:', error)
    }
  }

  async has(key: string): Promise<boolean> {
    if (!this.redis) return false

    try {
      const exists = await this.redis.exists(key)
      return exists === 1
    } catch (error) {
      console.error('Redis exists error:', error)
      return false
    }
  }

  private resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      size: 0,
      memoryUsage: 0
    }
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics }
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect()
    }
  }
}

// CDN configuration and utilities
export class CDNManager {
  private cdnUrl: string
  private enabled: boolean

  constructor(cdnUrl?: string) {
    this.cdnUrl = cdnUrl || env.CDN_URL || ''
    this.enabled = env.CDN_ENABLED && !!this.cdnUrl
  }

  // Generate CDN URL for static assets
  getAssetUrl(path: string): string {
    if (!this.enabled) {
      return path
    }

    const cleanPath = path.startsWith('/') ? path.slice(1) : path
    return `${this.cdnUrl}/${cleanPath}`
  }

  // Generate cache-busting URL
  getCacheBustedUrl(path: string, version?: string): string {
    const baseUrl = this.getAssetUrl(path)
    const separator = baseUrl.includes('?') ? '&' : '?'
    const cacheBuster = version || Date.now().toString()
    
    return `${baseUrl}${separator}v=${cacheBuster}`
  }

  // Check if CDN is available
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) {
      return false
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      
      const response = await fetch(`${this.cdnUrl}/health`, {
        method: 'HEAD',
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      return response.ok
    } catch (error) {
      console.warn('CDN health check failed:', error)
      return false
    }
  }

  // Purge cache for specific paths
  async purgeCache(paths: string[]): Promise<boolean> {
    if (!this.enabled) {
      return false
    }

    try {
      // This would depend on your CDN provider's API
      console.log('Would purge CDN cache for paths:', paths)
      return true
    } catch (error) {
      console.error('CDN cache purge failed:', error)
      return false
    }
  }
}

// Cache key generators
export class CacheKeyGenerator {
  static optimization(content: string, model: string, options: any): string {
    const hash = this.simpleHash(content + model + JSON.stringify(options))
    return `opt:${hash}`
  }

  static analysis(content: string, analysisType: string): string {
    const hash = this.simpleHash(content + analysisType)
    return `analysis:${hash}`
  }

  static userToken(userId: string, timeWindow: string): string {
    return `token:${userId}:${timeWindow}`
  }

  static rateLimit(identifier: string, window: string): string {
    return `rate:${identifier}:${window}`
  }

  static health(service: string): string {
    return `health:${service}`
  }

  private static simpleHash(input: string): string {
    let hash = 0
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }
}

// Multi-tier cache implementation
export class TieredCache {
  private l1Cache: MemoryCache // Fast, small cache
  private l2Cache: RedisCache | MemoryCache // Larger, persistent cache

  constructor(
    l1Config: CacheConfig,
    l2Config: CacheConfig,
    redisUrl?: string
  ) {
    this.l1Cache = new MemoryCache({
      ...l1Config,
      maxSize: Math.min(l1Config.maxSize, 1000) // Limit L1 size
    })

    this.l2Cache = redisUrl && env.NODE_ENV === 'production'
      ? new RedisCache(l2Config, redisUrl)
      : new MemoryCache(l2Config)
  }

  async get<T>(key: string): Promise<T | null> {
    // Try L1 cache first
    let value = this.l1Cache.get<T>(key)
    if (value !== null) {
      return value
    }

    // Try L2 cache
    value = await this.l2Cache.get<T>(key)
    if (value !== null) {
      // Store in L1 for faster future access
      this.l1Cache.set(key, value, 300) // 5 minute L1 TTL
      return value
    }

    return null
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    // Store in both caches
    this.l1Cache.set(key, value, Math.min(ttl || 300, 300)) // Max 5 min L1 TTL
    await this.l2Cache.set(key, value, ttl)
  }

  async delete(key: string): Promise<boolean> {
    const l1Deleted = this.l1Cache.delete(key)
    const l2Deleted = await this.l2Cache.delete(key)
    return l1Deleted || l2Deleted
  }

  async clear(): Promise<void> {
    this.l1Cache.clear()
    await this.l2Cache.clear()
  }

  getMetrics(): { l1: CacheMetrics; l2: CacheMetrics } {
    return {
      l1: this.l1Cache.getMetrics(),
      l2: this.l2Cache.getMetrics()
    }
  }

  // Cleanup expired entries in L1
  cleanup(): void {
    this.l1Cache.cleanup()
  }

  async disconnect(): Promise<void> {
    if (this.l2Cache instanceof RedisCache) {
      await this.l2Cache.disconnect()
    }
  }
}

// Create default cache instances
const defaultConfig: CacheConfig = {
  ttl: env.CACHE_TTL,
  maxSize: 10000,
  enableCompression: env.NODE_ENV === 'production',
  enableMetrics: env.ENABLE_METRICS
}

// Export cache instances
export const cache = new TieredCache(
  { ...defaultConfig, maxSize: 1000 }, // L1 config
  defaultConfig, // L2 config
  env.REDIS_URL
)

export const cdnManager = new CDNManager()

// Cache cleanup scheduler
if (env.NODE_ENV === 'production') {
  setInterval(() => {
    cache.cleanup()
  }, 300000) // Clean up every 5 minutes
}