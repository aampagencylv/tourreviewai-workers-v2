"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = void 0;
const joi_1 = __importDefault(require("joi"));
const configSchema = joi_1.default.object({
    workerId: joi_1.default.string().default(() => `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`),
    workerVersion: joi_1.default.string().default('1.0.0'),
    hostname: joi_1.default.string().default(() => require('os').hostname()),
    supabaseUrl: joi_1.default.string().uri().required(),
    supabaseServiceKey: joi_1.default.string().required(),
    redisUrl: joi_1.default.string().uri().optional(),
    dataForSeoUsername: joi_1.default.string().required(),
    dataForSeoPassword: joi_1.default.string().required(),
    maxConcurrentJobs: joi_1.default.number().integer().min(1).max(50).default(5),
    jobClaimDurationMinutes: joi_1.default.number().integer().min(5).max(120).default(30),
    heartbeatIntervalSeconds: joi_1.default.number().integer().min(10).max(300).default(30),
    batchSize: joi_1.default.number().integer().min(1).max(100).default(20),
    maxRetryAttempts: joi_1.default.number().integer().min(1).max(10).default(3),
    retryDelaySeconds: joi_1.default.number().integer().min(1).max(3600).default(60),
    healthPort: joi_1.default.number().integer().min(1000).max(65535).default(8080),
    logLevel: joi_1.default.string().valid('error', 'warn', 'info', 'debug').default('info'),
    nodeEnv: joi_1.default.string().valid('development', 'staging', 'production').default('development')
});
class Config {
    static getInstance() {
        if (!Config.instance) {
            Config.instance = Config.load();
        }
        return Config.instance;
    }
    static load() {
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
    static validate() {
        Config.getInstance();
    }
    static isProduction() {
        return Config.getInstance().nodeEnv === 'production';
    }
    static isDevelopment() {
        return Config.getInstance().nodeEnv === 'development';
    }
}
exports.Config = Config;
//# sourceMappingURL=Config.js.map