import { env } from './environment.js'

export interface DatabaseConfig {
  url?: string
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  ssl?: boolean
  maxConnections?: number
  connectionTimeout?: number
  idleTimeout?: number
  acquireTimeout?: number
  retryAttempts?: number
  retryDelay?: number
  enableLogging?: boolean
}

export interface ConnectionPoolMetrics {
  totalConnections: number
  activeConnections: number
  idleConnections: number
  waitingClients: number
  totalRequests: number
  successfulConnections: number
  failedConnections: number
  averageConnectionTime: number
}

// Database connection manager
export class DatabaseManager {
  private pool: any = null
  private config: DatabaseConfig
  private metrics: ConnectionPoolMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    waitingClients: 0,
    totalRequests: 0,
    successfulConnections: 0,
    failedConnections: 0,
    averageConnectionTime: 0
  }
  private connectionTimes: number[] = []

  constructor(config?: Partial<DatabaseConfig>) {
    this.config = this.buildConfig(config)
  }

  private buildConfig(customConfig?: Partial<DatabaseConfig>): DatabaseConfig {
    const baseConfig: DatabaseConfig = {
      url: env.DATABASE_URL,
      maxConnections: env.DATABASE_MAX_CONNECTIONS,
      connectionTimeout: env.DATABASE_CONNECTION_TIMEOUT,
      idleTimeout: 30000, // 30 seconds
      acquireTimeout: 60000, // 1 minute
      retryAttempts: 3,
      retryDelay: 1000, // 1 second
      enableLogging: env.NODE_ENV === 'development',
      ssl: env.NODE_ENV === 'production'
    }

    return { ...baseConfig, ...customConfig }
  }

  // Initialize database connection pool
  async initialize(): Promise<void> {
    if (!this.config.url) {
      console.log('No database URL configured, skipping database initialization')
      return
    }

    try {
      // Dynamic import based on database type
      if (this.config.url.startsWith('postgresql://') || this.config.url.startsWith('postgres://')) {
        await this.initializePostgreSQL()
      } else if (this.config.url.startsWith('mysql://')) {
        await this.initializeMysql()
      } else if (this.config.url.startsWith('mongodb://') || this.config.url.startsWith('mongodb+srv://')) {
        await this.initializeMongoDB()
      } else {
        throw new Error(`Unsupported database URL format: ${this.config.url}`)
      }

      console.log('Database connection pool initialized successfully')
    } catch (error) {
      console.error('Failed to initialize database:', error)
      throw error
    }
  }

  private async initializePostgreSQL(): Promise<void> {
    throw new Error('PostgreSQL not supported in current environment. Database drivers are optional in serverless environments.')
  }

  private async initializeMysql(): Promise<void> {
    throw new Error('MySQL not supported in current environment. Database drivers are optional in serverless environments.')
  }

  private async initializeMongoDB(): Promise<void> {
    throw new Error('MongoDB not supported in current environment. Database drivers are optional in serverless environments.')
  }

  // Execute query with connection pooling
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.pool) {
      throw new Error('Database not initialized')
    }

    const startTime = Date.now()
    this.metrics.totalRequests++

    try {
      let result: any

      if (this.config.url?.startsWith('postgresql://') || this.config.url?.startsWith('postgres://')) {
        result = await this.pool.query(sql, params)
        return result.rows
      } else if (this.config.url?.startsWith('mysql://')) {
        const [rows] = await this.pool.execute(sql, params)
        return rows as T[]
      } else if (this.config.url?.startsWith('mongodb://') || this.config.url?.startsWith('mongodb+srv://')) {
        // MongoDB queries would be handled differently
        throw new Error('MongoDB queries should use collection methods, not SQL')
      }

      return []
    } catch (error) {
      this.metrics.failedConnections++
      console.error('Database query failed:', error)
      throw error
    } finally {
      this.recordConnectionTime(Date.now() - startTime)
    }
  }

  // Get database connection for custom operations
  async getConnection(): Promise<any> {
    if (!this.pool) {
      throw new Error('Database not initialized')
    }

    if (this.config.url?.startsWith('postgresql://') || this.config.url?.startsWith('postgres://')) {
      return await this.pool.connect()
    } else if (this.config.url?.startsWith('mysql://')) {
      return await this.pool.getConnection()
    } else if (this.config.url?.startsWith('mongodb://') || this.config.url?.startsWith('mongodb+srv://')) {
      return this.pool.db()
    }

    throw new Error('Unsupported database type for direct connections')
  }

  // Health check
  async healthCheck(): Promise<{
    healthy: boolean
    latency: number
    activeConnections: number
    error?: string
  }> {
    if (!this.pool) {
      return {
        healthy: false,
        latency: 0,
        activeConnections: 0,
        error: 'Database not initialized'
      }
    }

    const startTime = Date.now()

    try {
      if (this.config.url?.startsWith('postgresql://') || this.config.url?.startsWith('postgres://')) {
        const client = await this.pool.connect()
        await client.query('SELECT 1')
        client.release()
      } else if (this.config.url?.startsWith('mysql://')) {
        const connection = await this.pool.getConnection()
        await connection.execute('SELECT 1')
        connection.release()
      } else if (this.config.url?.startsWith('mongodb://') || this.config.url?.startsWith('mongodb+srv://')) {
        await this.pool.db().admin().ping()
      }

      const latency = Date.now() - startTime
      
      return {
        healthy: true,
        latency,
        activeConnections: this.metrics.activeConnections,
      }
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        activeConnections: this.metrics.activeConnections,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Get connection pool metrics
  getMetrics(): ConnectionPoolMetrics {
    return { ...this.metrics }
  }

  // Record connection time for metrics
  private recordConnectionTime(time: number): void {
    this.connectionTimes.push(time)
    
    // Keep only last 100 connection times
    if (this.connectionTimes.length > 100) {
      this.connectionTimes.shift()
    }

    this.metrics.averageConnectionTime = 
      this.connectionTimes.reduce((a, b) => a + b, 0) / this.connectionTimes.length
  }

  // Transaction support
  async transaction<T>(callback: (connection: any) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('Database not initialized')
    }

    let connection: any
    let result: T

    try {
      connection = await this.getConnection()

      if (this.config.url?.startsWith('postgresql://') || this.config.url?.startsWith('postgres://')) {
        await connection.query('BEGIN')
        result = await callback(connection)
        await connection.query('COMMIT')
      } else if (this.config.url?.startsWith('mysql://')) {
        await connection.beginTransaction()
        result = await callback(connection)
        await connection.commit()
      } else {
        // MongoDB transactions
        const session = this.pool.startSession()
        try {
          result = await session.withTransaction(async () => {
            return await callback(connection)
          })
        } finally {
          session.endSession()
        }
      }

      return result
    } catch (error) {
      if (connection) {
        if (this.config.url?.startsWith('postgresql://') || this.config.url?.startsWith('postgres://')) {
          await connection.query('ROLLBACK')
        } else if (this.config.url?.startsWith('mysql://')) {
          await connection.rollback()
        }
      }
      throw error
    } finally {
      if (connection && typeof connection.release === 'function') {
        connection.release()
      }
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    if (!this.pool) {
      return
    }

    try {
      if (this.config.url?.startsWith('postgresql://') || this.config.url?.startsWith('postgres://')) {
        await this.pool.end()
      } else if (this.config.url?.startsWith('mysql://')) {
        await this.pool.end()
      } else if (this.config.url?.startsWith('mongodb://') || this.config.url?.startsWith('mongodb+srv://')) {
        await this.pool.close()
      }

      console.log('Database connection pool closed successfully')
    } catch (error) {
      console.error('Error closing database connection pool:', error)
    }
  }
}

// Database migration support
export class MigrationManager {
  constructor(private dbManager: DatabaseManager) {}

  async runMigrations(migrationsPath: string): Promise<void> {
    // Implementation would depend on specific migration framework
    console.log(`Running migrations from ${migrationsPath}`)
    
    // For PostgreSQL, might use a library like node-pg-migrate
    // For MySQL, might use knex or similar
    // For MongoDB, migrations are typically handled differently
  }

  async createMigrationsTable(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    
    await this.dbManager.query(createTableSQL)
  }
}

// Create default database manager instance
export const databaseManager = new DatabaseManager()

// Graceful shutdown handler
process.on('beforeExit', async () => {
  await databaseManager.shutdown()
})

// Database health check utilities
export async function checkDatabaseHealth(): Promise<{
  connected: boolean
  latency?: number
  error?: string
}> {
  try {
    const health = await databaseManager.healthCheck()
    return {
      connected: health.healthy,
      latency: health.latency,
      error: health.error
    }
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Database initialization with retry logic
export async function initializeDatabaseWithRetry(maxRetries: number = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await databaseManager.initialize()
      return
    } catch (error) {
      console.error(`Database initialization attempt ${attempt} failed:`, error)
      
      if (attempt === maxRetries) {
        throw new Error(`Failed to initialize database after ${maxRetries} attempts`)
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000
      console.log(`Retrying in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}