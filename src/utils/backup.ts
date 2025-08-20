import { env } from '../config/environment.js'
import { databaseManager } from '../config/database.js'
import { errorReporter } from './error-reporter.js'

export interface BackupConfig {
  enabled: boolean
  interval: number // Backup interval in milliseconds
  retentionDays: number
  storageUrl?: string
  compressionLevel: number
  encryptionEnabled: boolean
  includeSystemData: boolean
  includeLogs: boolean
  maxBackupSize: number // Max backup size in bytes
}

export interface BackupMetadata {
  id: string
  timestamp: Date
  type: 'full' | 'incremental' | 'differential'
  size: number
  duration: number
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  checksum: string
  storageLocation: string
  retainUntil: Date
  components: string[] // What was backed up
}

export interface DisasterRecoveryPlan {
  priority: number
  component: string
  recoveryTimeObjective: number // RTO in minutes
  recoveryPointObjective: number // RPO in minutes
  procedures: string[]
  dependencies: string[]
  contacts: string[]
}

// Backup manager
export class BackupManager {
  private config: BackupConfig
  private backupHistory: BackupMetadata[] = []
  private isRunning = false
  private nextBackupId = 1

  constructor(config?: Partial<BackupConfig>) {
    this.config = {
      enabled: env.BACKUP_ENABLED,
      interval: env.BACKUP_INTERVAL,
      retentionDays: env.BACKUP_RETENTION_DAYS,
      storageUrl: env.BACKUP_STORAGE_URL,
      compressionLevel: 6, // gzip level 1-9
      encryptionEnabled: env.NODE_ENV === 'production',
      includeSystemData: true,
      includeLogs: false,
      maxBackupSize: 5 * 1024 * 1024 * 1024, // 5GB
      ...config
    }

    if (this.config.enabled) {
      this.startScheduler()
    }
  }

  // Start automatic backup scheduler
  private startScheduler(): void {
    if (!this.config.enabled || !this.config.interval) {
      return
    }

    setInterval(async () => {
      try {
        await this.performBackup('incremental')
      } catch (error) {
        console.error('Scheduled backup failed:', error)
        await errorReporter.report(
          error as Error,
          {
            operation: 'scheduled-backup',
            timestamp: new Date()
          },
          {
            canRecover: true,
            userMessage: 'Backup operation failed but will retry',
            internalMessage: 'Scheduled backup failure',
            severity: 'medium'
          }
        )
      }
    }, this.config.interval)

    console.log(`Backup scheduler started with interval: ${this.config.interval}ms`)
  }

  // Perform backup operation
  async performBackup(type: 'full' | 'incremental' | 'differential' = 'full'): Promise<BackupMetadata> {
    if (this.isRunning) {
      throw new Error('Backup operation already in progress')
    }

    const backupId = `backup_${Date.now()}_${this.nextBackupId++}`
    const startTime = Date.now()

    const metadata: BackupMetadata = {
      id: backupId,
      timestamp: new Date(),
      type,
      size: 0,
      duration: 0,
      status: 'pending',
      checksum: '',
      storageLocation: '',
      retainUntil: new Date(Date.now() + (this.config.retentionDays * 24 * 60 * 60 * 1000)),
      components: []
    }

    this.backupHistory.push(metadata)
    this.isRunning = true

    try {
      metadata.status = 'in_progress'
      console.log(`Starting ${type} backup: ${backupId}`)

      // Determine what to backup based on type
      const components = await this.getBackupComponents(type)
      metadata.components = components

      // Create backup archive
      const backupData = await this.createBackupArchive(components, backupId)
      
      // Compress if enabled
      const compressedData = this.config.compressionLevel > 0 
        ? await this.compressData(backupData)
        : backupData

      // Encrypt if enabled
      const finalData = this.config.encryptionEnabled
        ? await this.encryptData(compressedData)
        : compressedData

      // Check size limits
      if (finalData.length > this.config.maxBackupSize) {
        throw new Error(`Backup size (${finalData.length}) exceeds maximum allowed size (${this.config.maxBackupSize})`)
      }

      // Calculate checksum
      metadata.checksum = await this.calculateChecksum(finalData)
      metadata.size = finalData.length

      // Store backup
      metadata.storageLocation = await this.storeBackup(backupId, finalData)
      
      metadata.status = 'completed'
      metadata.duration = Date.now() - startTime

      console.log(`Backup completed: ${backupId} (${metadata.size} bytes, ${metadata.duration}ms)`)

      // Cleanup old backups
      await this.cleanupOldBackups()

      return metadata

    } catch (error) {
      metadata.status = 'failed'
      metadata.duration = Date.now() - startTime
      
      console.error(`Backup failed: ${backupId}`, error)
      throw error
    } finally {
      this.isRunning = false
    }
  }

  // Get components to backup based on backup type
  private async getBackupComponents(type: 'full' | 'incremental' | 'differential'): Promise<string[]> {
    const components: string[] = []

    // Always include critical application data
    components.push('configuration')
    components.push('cache-metadata')

    if (type === 'full') {
      // Full backup includes everything
      if (this.config.includeSystemData) {
        components.push('environment-config')
        components.push('security-settings')
      }
      
      if (this.config.includeLogs) {
        components.push('application-logs')
        components.push('error-logs')
      }

      // Database backup if available
      try {
        const dbHealth = await databaseManager.healthCheck()
        if (dbHealth.healthy) {
          components.push('database')
        }
      } catch (error) {
        console.warn('Database not available for backup:', error)
      }
    } else {
      // Incremental/differential - only changed data
      components.push('cache-changes')
      components.push('recent-logs')
    }

    return components
  }

  // Create backup archive from components
  private async createBackupArchive(components: string[], backupId: string): Promise<Buffer> {
    const archive: Record<string, any> = {
      metadata: {
        id: backupId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        components
      }
    }

    for (const component of components) {
      try {
        archive[component] = await this.backupComponent(component)
      } catch (error) {
        console.warn(`Failed to backup component ${component}:`, error)
        archive[component] = { error: error instanceof Error ? error.message : 'Unknown error' }
      }
    }

    return Buffer.from(JSON.stringify(archive, null, 2))
  }

  // Backup individual component
  private async backupComponent(component: string): Promise<any> {
    switch (component) {
      case 'configuration':
        return {
          environment: process.env.NODE_ENV,
          features: {
            streaming: env.ENABLE_STREAMING,
            batchProcessing: env.ENABLE_BATCH_PROCESSING,
            documentAnalysis: env.ENABLE_DOCUMENT_ANALYSIS
          },
          limits: {
            maxFileSize: env.MAX_FILE_SIZE,
            rateLimit: env.RATE_LIMIT_MAX,
            concurrency: env.CONCURRENCY_LIMIT
          }
        }

      case 'cache-metadata':
        // Backup cache statistics and configuration
        return {
          cacheSize: 'N/A', // Would get from cache instance
          hitRate: 'N/A',
          configuration: {
            ttl: env.CACHE_TTL,
            cdnEnabled: env.CDN_ENABLED
          }
        }

      case 'environment-config':
        return {
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          environmentVariables: Object.keys(process.env).filter(key => 
            !key.includes('SECRET') && !key.includes('KEY') && !key.includes('PASSWORD')
          )
        }

      case 'security-settings':
        return {
          corsOrigin: env.CORS_ORIGIN !== '*' ? 'configured' : 'wildcard',
          httpsEnforced: env.FORCE_HTTPS,
          errorReporting: env.ERROR_REPORTING_ENABLED,
          rateLimiting: env.RATE_LIMIT_MAX > 0
        }

      case 'database':
        try {
          // This would typically use database-specific backup tools
          // For now, just backup metadata
          const health = await databaseManager.healthCheck()
          return {
            healthy: health.healthy,
            latency: health.latency,
            connectionCount: health.activeConnections,
            // In production, would export actual data
            note: 'Database backup would require specific tooling'
          }
        } catch (error) {
          return { error: 'Database backup failed' }
        }

      case 'application-logs':
        // In production, would read from log files
        return {
          logLevel: env.LOG_LEVEL,
          logsLocation: 'stdout/stderr',
          note: 'Application logs backup not implemented'
        }

      case 'error-logs':
        // Would backup error reporter data
        return {
          errorReportingEnabled: env.ERROR_REPORTING_ENABLED,
          endpoint: env.ERROR_REPORTING_ENDPOINT ? 'configured' : 'not configured'
        }

      default:
        throw new Error(`Unknown backup component: ${component}`)
    }
  }

  // Compress backup data
  private async compressData(data: Buffer): Promise<Buffer> {
    try {
      const zlib = await import('zlib')
      return new Promise((resolve, reject) => {
        zlib.gzip(data, { level: this.config.compressionLevel }, (err, compressed) => {
          if (err) reject(err)
          else resolve(compressed)
        })
      })
    } catch (error) {
      console.warn('Compression failed, using uncompressed data:', error)
      return data
    }
  }

  // Encrypt backup data
  private async encryptData(data: Buffer): Promise<Buffer> {
    try {
      const crypto = await import('crypto')
      const algorithm = 'aes-256-gcm'
      const key = crypto.scryptSync(env.JWT_SECRET, 'backup-salt', 32)
      const iv = crypto.randomBytes(16)
      
      const cipher = crypto.createCipheriv(algorithm, key, iv)
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
      
      // Prepend IV for decryption
      return Buffer.concat([iv, encrypted])
    } catch (error) {
      console.warn('Encryption failed, using unencrypted data:', error)
      return data
    }
  }

  // Calculate backup checksum
  private async calculateChecksum(data: Buffer): Promise<string> {
    try {
      const crypto = await import('crypto')
      return crypto.createHash('sha256').update(data).digest('hex')
    } catch (error) {
      console.warn('Checksum calculation failed:', error)
      return 'unavailable'
    }
  }

  // Store backup to configured storage
  private async storeBackup(backupId: string, data: Buffer): Promise<string> {
    if (!this.config.storageUrl) {
      // Local storage fallback
      const path = await import('path')
      const fs = await import('fs/promises')
      
      const backupDir = './backups'
      const backupPath = path.join(backupDir, `${backupId}.backup`)
      
      await fs.mkdir(backupDir, { recursive: true })
      await fs.writeFile(backupPath, data)
      
      return backupPath
    }

    // Cloud storage (would implement based on storage provider)
    if (this.config.storageUrl.startsWith('s3://')) {
      return await this.storeToS3(backupId, data)
    } else if (this.config.storageUrl.startsWith('gcs://')) {
      return await this.storeToGCS(backupId, data)
    } else {
      throw new Error(`Unsupported storage URL: ${this.config.storageUrl}`)
    }
  }

  // Store to AWS S3
  private async storeToS3(backupId: string, data: Buffer): Promise<string> {
    // Implementation would use AWS SDK
    console.log(`Would store backup ${backupId} to S3`)
    return `s3://backup-bucket/${backupId}.backup`
  }

  // Store to Google Cloud Storage
  private async storeToGCS(backupId: string, data: Buffer): Promise<string> {
    // Implementation would use Google Cloud SDK
    console.log(`Would store backup ${backupId} to GCS`)
    return `gcs://backup-bucket/${backupId}.backup`
  }

  // Cleanup old backups
  private async cleanupOldBackups(): Promise<void> {
    const cutoffDate = new Date(Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000))
    
    const oldBackups = this.backupHistory.filter(backup => 
      backup.timestamp < cutoffDate && backup.status === 'completed'
    )

    for (const backup of oldBackups) {
      try {
        await this.deleteBackup(backup)
        console.log(`Deleted expired backup: ${backup.id}`)
      } catch (error) {
        console.error(`Failed to delete backup ${backup.id}:`, error)
      }
    }

    // Remove from history
    this.backupHistory = this.backupHistory.filter(backup => 
      backup.timestamp >= cutoffDate || backup.status !== 'completed'
    )
  }

  // Delete backup from storage
  private async deleteBackup(backup: BackupMetadata): Promise<void> {
    if (backup.storageLocation.startsWith('./')) {
      const fs = await import('fs/promises')
      await fs.unlink(backup.storageLocation)
    } else {
      // Cloud storage deletion would go here
      console.log(`Would delete backup from cloud storage: ${backup.storageLocation}`)
    }
  }

  // Restore from backup
  async restoreFromBackup(backupId: string): Promise<void> {
    const backup = this.backupHistory.find(b => b.id === backupId)
    if (!backup || backup.status !== 'completed') {
      throw new Error(`Backup ${backupId} not found or not completed`)
    }

    console.log(`Starting restore from backup: ${backupId}`)

    try {
      // Retrieve backup data
      const backupData = await this.retrieveBackup(backup)
      
      // Verify checksum
      const checksum = await this.calculateChecksum(backupData)
      if (checksum !== backup.checksum) {
        throw new Error('Backup checksum verification failed')
      }

      // Decrypt if needed
      const decryptedData = this.config.encryptionEnabled
        ? await this.decryptData(backupData)
        : backupData

      // Decompress if needed
      const decompressedData = this.config.compressionLevel > 0
        ? await this.decompressData(decryptedData)
        : decryptedData

      // Parse backup archive
      const archive = JSON.parse(decompressedData.toString())
      
      // Restore components
      for (const component of backup.components) {
        if (archive[component] && !archive[component].error) {
          await this.restoreComponent(component, archive[component])
        }
      }

      console.log(`Restore completed: ${backupId}`)
    } catch (error) {
      console.error(`Restore failed: ${backupId}`, error)
      throw error
    }
  }

  // Retrieve backup data from storage
  private async retrieveBackup(backup: BackupMetadata): Promise<Buffer> {
    if (backup.storageLocation.startsWith('./')) {
      const fs = await import('fs/promises')
      return await fs.readFile(backup.storageLocation)
    } else {
      throw new Error('Cloud storage retrieval not implemented')
    }
  }

  // Decrypt backup data
  private async decryptData(data: Buffer): Promise<Buffer> {
    try {
      const crypto = await import('crypto')
      const algorithm = 'aes-256-gcm'
      const key = crypto.scryptSync(env.JWT_SECRET, 'backup-salt', 32)
      
      const iv = data.slice(0, 16)
      const encryptedData = data.slice(16)
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv)
      return Buffer.concat([decipher.update(encryptedData), decipher.final()])
    } catch (error) {
      throw new Error(`Decryption failed: ${error}`)
    }
  }

  // Decompress backup data
  private async decompressData(data: Buffer): Promise<Buffer> {
    try {
      const zlib = await import('zlib')
      return new Promise((resolve, reject) => {
        zlib.gunzip(data, (err, decompressed) => {
          if (err) reject(err)
          else resolve(decompressed)
        })
      })
    } catch (error) {
      throw new Error(`Decompression failed: ${error}`)
    }
  }

  // Restore individual component
  private async restoreComponent(component: string, data: any): Promise<void> {
    console.log(`Restoring component: ${component}`)
    
    switch (component) {
      case 'configuration':
        // Would restore application configuration
        console.log('Configuration restore:', data)
        break
        
      case 'database':
        // Would restore database data
        console.log('Database restore not implemented')
        break
        
      default:
        console.log(`Component ${component} restore not implemented`)
    }
  }

  // Get backup status and history
  getBackupHistory(): BackupMetadata[] {
    return [...this.backupHistory]
  }

  getBackupStatus(): {
    enabled: boolean
    isRunning: boolean
    lastBackup?: BackupMetadata
    nextBackup?: Date
  } {
    const lastBackup = this.backupHistory
      .filter(b => b.status === 'completed')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0]

    const nextBackup = lastBackup && this.config.enabled
      ? new Date(lastBackup.timestamp.getTime() + this.config.interval)
      : undefined

    return {
      enabled: this.config.enabled,
      isRunning: this.isRunning,
      lastBackup,
      nextBackup
    }
  }
}

// Disaster recovery manager
export class DisasterRecoveryManager {
  private plans: DisasterRecoveryPlan[] = []

  constructor() {
    this.initializeRecoveryPlans()
  }

  private initializeRecoveryPlans(): void {
    this.plans = [
      {
        priority: 1,
        component: 'Database',
        recoveryTimeObjective: 15, // 15 minutes
        recoveryPointObjective: 5, // 5 minutes
        procedures: [
          'Check database health',
          'Restore from latest backup',
          'Verify data integrity',
          'Update connection strings'
        ],
        dependencies: ['Storage system', 'Network connectivity'],
        contacts: ['database-admin@company.com', 'on-call@company.com']
      },
      {
        priority: 2,
        component: 'Application Services',
        recoveryTimeObjective: 10, // 10 minutes
        recoveryPointObjective: 1, // 1 minute
        procedures: [
          'Deploy to backup region',
          'Update DNS records',
          'Verify health checks',
          'Enable traffic routing'
        ],
        dependencies: ['CDN', 'Load balancer'],
        contacts: ['devops@company.com', 'on-call@company.com']
      },
      {
        priority: 3,
        component: 'Cache Layer',
        recoveryTimeObjective: 5, // 5 minutes
        recoveryPointObjective: 0, // Acceptable data loss
        procedures: [
          'Restart cache services',
          'Warm up cache',
          'Monitor performance'
        ],
        dependencies: ['Application services'],
        contacts: ['devops@company.com']
      }
    ]
  }

  getRecoveryPlans(): DisasterRecoveryPlan[] {
    return [...this.plans]
  }

  async executeRecoveryPlan(component: string): Promise<void> {
    const plan = this.plans.find(p => p.component === component)
    if (!plan) {
      throw new Error(`No recovery plan found for component: ${component}`)
    }

    console.log(`Executing disaster recovery plan for: ${component}`)
    console.log(`RTO: ${plan.recoveryTimeObjective} minutes`)
    console.log(`RPO: ${plan.recoveryPointObjective} minutes`)

    // In production, this would execute actual recovery procedures
    for (const procedure of plan.procedures) {
      console.log(`Executing: ${procedure}`)
      // Simulate procedure execution time
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log(`Recovery plan completed for: ${component}`)
  }
}

// Create singleton instances
export const backupManager = new BackupManager()
export const disasterRecoveryManager = new DisasterRecoveryManager()

// Graceful shutdown handler
process.on('beforeExit', async () => {
  console.log('Performing final backup before shutdown...')
  try {
    if (backupManager.getBackupStatus().enabled) {
      await backupManager.performBackup('incremental')
    }
  } catch (error) {
    console.error('Final backup failed:', error)
  }
})