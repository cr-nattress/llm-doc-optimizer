import { z } from 'zod'

// Environment schema with validation
const envSchema = z.object({
  // Core application settings
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().default(8888),
  
  // OpenAI configuration
  OPENAI_API_KEY: z.string().min(1, 'OpenAI API key is required'),
  OPENAI_ORG_ID: z.string().optional(),
  OPENAI_PROJECT_ID: z.string().optional(),
  
  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000), // 15 minutes
  
  // Security
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  CORS_ORIGIN: z.string().default('*'),
  ALLOWED_ORIGINS: z.string().default('*'),
  
  // Error reporting
  ERROR_REPORTING_ENABLED: z.coerce.boolean().default(false),
  ERROR_REPORTING_ENDPOINT: z.string().url().optional(),
  ERROR_REPORTING_API_KEY: z.string().optional(),
  
  // Performance and limits
  MAX_FILE_SIZE: z.coerce.number().default(10485760), // 10MB
  MAX_REQUEST_TIMEOUT: z.coerce.number().default(300000), // 5 minutes
  CONCURRENCY_LIMIT: z.coerce.number().default(10),
  
  // Database (optional for future use)
  DATABASE_URL: z.string().url().optional(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().default(20),
  DATABASE_CONNECTION_TIMEOUT: z.coerce.number().default(30000),
  
  // Monitoring and observability
  ENABLE_METRICS: z.coerce.boolean().default(true),
  METRICS_PORT: z.coerce.number().default(8889),
  HEALTH_CHECK_INTERVAL: z.coerce.number().default(30000),
  
  // CDN and caching
  CDN_ENABLED: z.coerce.boolean().default(false),
  CDN_URL: z.string().url().optional(),
  CACHE_TTL: z.coerce.number().default(3600), // 1 hour
  REDIS_URL: z.string().url().optional(),
  
  // Backup and recovery
  BACKUP_ENABLED: z.coerce.boolean().default(false),
  BACKUP_INTERVAL: z.coerce.number().default(86400000), // 24 hours
  BACKUP_RETENTION_DAYS: z.coerce.number().default(30),
  BACKUP_STORAGE_URL: z.string().url().optional(),
  
  // Feature flags
  ENABLE_STREAMING: z.coerce.boolean().default(true),
  ENABLE_BATCH_PROCESSING: z.coerce.boolean().default(true),
  ENABLE_DOCUMENT_ANALYSIS: z.coerce.boolean().default(true),
  
  // SSL/TLS
  SSL_CERT_PATH: z.string().optional(),
  SSL_KEY_PATH: z.string().optional(),
  FORCE_HTTPS: z.coerce.boolean().default(false),
  
  // Netlify specific
  NETLIFY_ENV: z.enum(['development', 'branch-deploy', 'deploy-preview', 'production']).optional(),
  NETLIFY_SITE_ID: z.string().optional(),
  NETLIFY_DEPLOY_URL: z.string().url().optional(),
  
  // Third-party integrations
  WEBHOOK_SECRET: z.string().optional(),
  WEBHOOK_ENDPOINTS: z.string().optional(),
  
  // Development
  DEBUG: z.string().optional(),
  DISABLE_TELEMETRY: z.coerce.boolean().default(false)
})

export type Environment = z.infer<typeof envSchema>

// Environment validation with detailed error messages
class EnvironmentValidator {
  private env: Environment | null = null
  private validationErrors: string[] = []

  validate(): Environment {
    if (this.env) {
      return this.env
    }

    try {
      this.env = envSchema.parse(process.env)
      this.performAdditionalValidation()
      return this.env
    } catch (error) {
      if (error instanceof z.ZodError) {
        this.validationErrors = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        )
      } else {
        this.validationErrors = [`Unexpected validation error: ${error}`]
      }
      
      this.logValidationErrors()
      throw new Error(`Environment validation failed: ${this.validationErrors.join(', ')}`)
    }
  }

  private performAdditionalValidation(): void {
    if (!this.env) return

    // Production-specific validations
    if (this.env.NODE_ENV === 'production') {
      if (this.env.JWT_SECRET.length < 64) {
        this.validationErrors.push('JWT_SECRET should be at least 64 characters in production')
      }
      
      if (!this.env.ERROR_REPORTING_ENABLED) {
        console.warn('WARNING: Error reporting is disabled in production')
      }
      
      if (this.env.CORS_ORIGIN === '*') {
        console.warn('WARNING: CORS is set to allow all origins in production')
      }
      
      if (!this.env.FORCE_HTTPS) {
        console.warn('WARNING: HTTPS is not enforced in production')
      }
    }

    // Cross-dependency validations
    if (this.env.ERROR_REPORTING_ENABLED && !this.env.ERROR_REPORTING_ENDPOINT) {
      this.validationErrors.push('ERROR_REPORTING_ENDPOINT is required when ERROR_REPORTING_ENABLED is true')
    }

    if (this.env.CDN_ENABLED && !this.env.CDN_URL) {
      this.validationErrors.push('CDN_URL is required when CDN_ENABLED is true')
    }

    if (this.env.BACKUP_ENABLED && !this.env.BACKUP_STORAGE_URL) {
      this.validationErrors.push('BACKUP_STORAGE_URL is required when BACKUP_ENABLED is true')
    }

    // Security validations
    if (this.env.OPENAI_API_KEY.startsWith('sk-') && this.env.OPENAI_API_KEY.length < 20) {
      this.validationErrors.push('OPENAI_API_KEY appears to be invalid (too short)')
    }

    // Performance validations
    if (this.env.MAX_REQUEST_TIMEOUT > 600000) { // 10 minutes
      console.warn('WARNING: MAX_REQUEST_TIMEOUT is very high (>10 minutes)')
    }

    if (this.env.CONCURRENCY_LIMIT > 50) {
      console.warn('WARNING: CONCURRENCY_LIMIT is very high (>50)')
    }

    if (this.validationErrors.length > 0) {
      throw new Error(`Additional validation failed: ${this.validationErrors.join(', ')}`)
    }
  }

  private logValidationErrors(): void {
    console.error('Environment validation failed:')
    this.validationErrors.forEach(error => {
      console.error(`  - ${error}`)
    })
    
    console.error('\nRequired environment variables:')
    console.error('  - OPENAI_API_KEY: Your OpenAI API key')
    console.error('  - JWT_SECRET: Secret key for JWT token signing (min 32 chars)')
    
    console.error('\nOptional environment variables:')
    console.error('  - NODE_ENV: development|staging|production (default: development)')
    console.error('  - LOG_LEVEL: fatal|error|warn|info|debug|trace (default: info)')
    console.error('  - RATE_LIMIT_MAX: Max requests per window (default: 100)')
    console.error('  - ERROR_REPORTING_ENABLED: Enable error reporting (default: false)')
  }

  getValidationErrors(): string[] {
    return [...this.validationErrors]
  }

  isValid(): boolean {
    return this.env !== null && this.validationErrors.length === 0
  }
}

// Create singleton validator
const validator = new EnvironmentValidator()

// Export validated environment
export const env = validator.validate()

// Export utilities
export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'
export const isStaging = env.NODE_ENV === 'staging'

// Environment health check
export function getEnvironmentHealth(): {
  valid: boolean
  environment: string
  errors: string[]
  warnings: string[]
} {
  const warnings: string[] = []
  
  if (isProduction) {
    if (env.CORS_ORIGIN === '*') warnings.push('CORS allows all origins')
    if (!env.FORCE_HTTPS) warnings.push('HTTPS not enforced')
    if (!env.ERROR_REPORTING_ENABLED) warnings.push('Error reporting disabled')
  }
  
  return {
    valid: validator.isValid(),
    environment: env.NODE_ENV,
    errors: validator.getValidationErrors(),
    warnings
  }
}

// Configuration presets for different environments
export const environmentPresets = {
  development: {
    LOG_LEVEL: 'debug',
    CORS_ORIGIN: 'http://localhost:3000',
    ERROR_REPORTING_ENABLED: false,
    ENABLE_METRICS: true,
    FORCE_HTTPS: false
  },
  staging: {
    LOG_LEVEL: 'info',
    ERROR_REPORTING_ENABLED: true,
    ENABLE_METRICS: true,
    FORCE_HTTPS: true
  },
  production: {
    LOG_LEVEL: 'warn',
    ERROR_REPORTING_ENABLED: true,
    ENABLE_METRICS: true,
    FORCE_HTTPS: true,
    DISABLE_TELEMETRY: false
  }
} as const

// Export for testing
export { validator }