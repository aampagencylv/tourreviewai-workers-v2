import Joi from 'joi';

export interface WorkerConfig {
  // Worker Identity
  workerId: string;
  workerVersion: string;
  hostname: string;
  
  // Database
  supabaseUrl: string;
  supabaseServiceKey: string;
  
  // Redis (optional - can use Supabase for queue)
  redisUrl?: string;
  
  // DataForSEO API
  dataForSeoUsername: string;
  dataForSeoPassword: string;
  
  // Worker Settings
  maxConcurrentJobs: number;
  jobClaimDurationMinutes: number;
  heartbeatIntervalSeconds: number;
  
  // Processing Settings
  batchSize: number;
  maxRetryAttempts: number;
  retryDelaySeconds: number;
  
  // Health Server
  healthPort: number;
  
  // Logging
  logLevel: string;
  
  // Environment
  nodeEnv: string;
}

const configSchema = Joi.object({
  workerId: Joi.string().default(() => `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`),
  workerVersion: Joi.string().default('1.0.0'),
  hostname: Joi.string().default(() => require('os').hostname()),
  
  supabaseUrl: Joi.string().uri().required(),
  supabaseServiceKey: Joi.string().required(),
  
  redisUrl: Joi.string().uri().optional(),
  
  dataForSeoUsername: Joi.string().required(),
  dataForSeoPassword: Joi.string().required(),
  
  maxConcurrentJobs: Joi.number().integer().min(1).max(50).default(5),
  jobClaimDurationMinutes: Joi.number().integer().min(5).max(120).default(30),
  heartbeatIntervalSeconds: Joi.number().integer().min(10).max(300).default(30),
  
  batchSize: Joi.number().integer().min(1).max(100).default(20),
  maxRetryAttempts: Joi.number().integer().min(1).max(10).default(3),
  retryDelaySeconds: Joi.number().integer().min(1).max(3600).default(60),
  
  healthPort: Joi.number().integer().min(1000).max(65535).default(8080),
  
  logLevel: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  
  nodeEnv: Joi.string().valid('development', 'staging', 'production').default('development')
});

export class Config {
  private static instance: WorkerConfig;
  
  public static getInstance(): WorkerConfig {
    if (!Config.instance) {
      Config.instance = Config.load();
    }
    return Config.instance;
  }
  
  private static load(): WorkerConfig {
    const rawConfig = {
      workerId: process.env.WORKER_ID,
      workerVersion: process.env.WORKER_VERSION || process.env.npm_package_version,
      hostname: process.env.HOSTNAME,
      
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      
      redisUrl: process.env.REDIS_URL,
      
      dataForSeoUsername: process.env.DATAFORSEO_USERNAME,
      dataForSeoPassword: process.env.DATAFORSEO_PASSWORD,
      
      maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '5'),
      jobClaimDurationMinutes: parseInt(process.env.JOB_CLAIM_DURATION_MINUTES || '30'),
      heartbeatIntervalSeconds: parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS || '30'),
      
      batchSize: parseInt(process.env.BATCH_SIZE || '20'),
      maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3'),
      retryDelaySeconds: parseInt(process.env.RETRY_DELAY_SECONDS || '60'),
      
      healthPort: parseInt(process.env.HEALTH_PORT || process.env.PORT || '8080'),
      
      logLevel: process.env.LOG_LEVEL || 'info',
      
      nodeEnv: process.env.NODE_ENV || 'development'
    };
    
    const { error, value } = configSchema.validate(rawConfig);
    
    if (error) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }
    
    return value;
  }
  
  public static validate(): void {
    Config.getInstance();
  }
  
  public static isProduction(): boolean {
    return Config.getInstance().nodeEnv === 'production';
  }
  
  public static isDevelopment(): boolean {
    return Config.getInstance().nodeEnv === 'development';
  }
}

