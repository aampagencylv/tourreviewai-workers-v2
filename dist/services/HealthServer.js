"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthServer = void 0;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const Config_1 = require("../config/Config");
const Logger_1 = require("../utils/Logger");
class HealthServer {
    constructor() {
        this.config = Config_1.Config.getInstance();
        this.logger = Logger_1.Logger.getInstance();
        this.startTime = Date.now();
        this.app = (0, express_1.default)();
        this.setupMiddleware();
        this.setupRoutes();
    }
    setWorkerManager(workerManager) {
        this.workerManager = workerManager;
    }
    setupMiddleware() {
        // Security
        this.app.use((0, helmet_1.default)());
        // CORS
        this.app.use((0, cors_1.default)({
            origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
            credentials: true
        }));
        // Compression
        this.app.use((0, compression_1.default)());
        // JSON parsing
        this.app.use(express_1.default.json({ limit: '10mb' }));
        // Request logging
        this.app.use((req, res, next) => {
            this.logger.debug(`${req.method} ${req.path}`, {
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            next();
        });
    }
    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', this.handleHealthCheck.bind(this));
        // Detailed status endpoint
        this.app.get('/status', this.handleStatusCheck.bind(this));
        // Metrics endpoint
        this.app.get('/metrics', this.handleMetrics.bind(this));
        // Worker info endpoint
        this.app.get('/worker', this.handleWorkerInfo.bind(this));
        // Ready check (for Kubernetes/Docker)
        this.app.get('/ready', this.handleReadyCheck.bind(this));
        // Live check (for Kubernetes/Docker)
        this.app.get('/live', this.handleLiveCheck.bind(this));
        // Root endpoint
        this.app.get('/', (req, res) => {
            res.json({
                service: 'TourReviewAI Worker Service',
                version: this.config.workerVersion,
                status: 'running',
                endpoints: {
                    health: '/health',
                    status: '/status',
                    metrics: '/metrics',
                    worker: '/worker',
                    ready: '/ready',
                    live: '/live'
                }
            });
        });
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: `Route ${req.method} ${req.originalUrl} not found`,
                availableEndpoints: ['/health', '/status', '/metrics', '/worker']
            });
        });
        // Error handler
        this.app.use((error, req, res, next) => {
            this.logger.error('HTTP Error:', error);
            res.status(error.status || 500).json({
                error: 'Internal Server Error',
                message: Config_1.Config.isProduction() ? 'Something went wrong' : error.message,
                timestamp: new Date().toISOString()
            });
        });
    }
    async handleHealthCheck(req, res) {
        try {
            const health = await this.getHealthStatus();
            const statusCode = health.status === 'healthy' ? 200 : 503;
            res.status(statusCode).json(health);
        }
        catch (error) {
            this.logger.error('Health check failed:', error);
            res.status(503).json({
                status: 'unhealthy',
                error: 'Health check failed',
                timestamp: new Date().toISOString()
            });
        }
    }
    async handleStatusCheck(req, res) {
        try {
            const status = await this.getDetailedStatus();
            res.json(status);
        }
        catch (error) {
            this.logger.error('Status check failed:', error);
            res.status(500).json({
                error: 'Status check failed',
                timestamp: new Date().toISOString()
            });
        }
    }
    async handleMetrics(req, res) {
        try {
            const metrics = await this.getMetrics();
            res.json(metrics);
        }
        catch (error) {
            this.logger.error('Metrics collection failed:', error);
            res.status(500).json({
                error: 'Metrics collection failed',
                timestamp: new Date().toISOString()
            });
        }
    }
    async handleWorkerInfo(req, res) {
        try {
            const workerInfo = this.workerManager ? this.workerManager.getStatus() : {
                id: this.config.workerId,
                hostname: this.config.hostname,
                status: 'unknown',
                current_job_count: 0,
                max_concurrent_jobs: this.config.maxConcurrentJobs,
                last_heartbeat: new Date().toISOString()
            };
            res.json(workerInfo);
        }
        catch (error) {
            this.logger.error('Worker info failed:', error);
            res.status(500).json({
                error: 'Worker info failed',
                timestamp: new Date().toISOString()
            });
        }
    }
    async handleReadyCheck(req, res) {
        // Ready means the service can accept traffic
        try {
            const isReady = this.workerManager && await this.checkDatabaseConnection();
            if (isReady) {
                res.json({ status: 'ready', timestamp: new Date().toISOString() });
            }
            else {
                res.status(503).json({ status: 'not ready', timestamp: new Date().toISOString() });
            }
        }
        catch (error) {
            res.status(503).json({ status: 'not ready', error: error instanceof Error ? error.message : 'Unknown error' });
        }
    }
    async handleLiveCheck(req, res) {
        // Live means the service is running (simpler than health)
        res.json({
            status: 'alive',
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime
        });
    }
    async getHealthStatus() {
        const uptime = Date.now() - this.startTime;
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const workerStatus = this.workerManager ? this.workerManager.getStatus() : {
            id: this.config.workerId,
            hostname: this.config.hostname,
            status: 'offline',
            current_job_count: 0,
            max_concurrent_jobs: this.config.maxConcurrentJobs,
            last_heartbeat: new Date().toISOString()
        };
        const dbConnected = await this.checkDatabaseConnection();
        // Determine overall health
        const isHealthy = dbConnected &&
            memoryUsage.heapUsed / memoryUsage.heapTotal < 0.9 && // Memory < 90%
            uptime > 10000; // Running for at least 10 seconds
        return {
            status: isHealthy ? 'healthy' : 'unhealthy',
            timestamp: new Date().toISOString(),
            uptime,
            version: this.config.workerVersion,
            worker: {
                id: workerStatus.id,
                hostname: workerStatus.hostname,
                currentJobs: workerStatus.current_job_count,
                maxJobs: workerStatus.max_concurrent_jobs,
                status: workerStatus.status
            },
            system: {
                memory: {
                    used: memoryUsage.heapUsed,
                    total: memoryUsage.heapTotal,
                    percentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
                },
                cpu: {
                    usage: Math.round((cpuUsage.user + cpuUsage.system) / 1000000) // Convert to milliseconds
                }
            },
            database: {
                connected: dbConnected,
                lastCheck: new Date().toISOString()
            }
        };
    }
    async getDetailedStatus() {
        const health = await this.getHealthStatus();
        return {
            ...health,
            config: {
                nodeEnv: this.config.nodeEnv,
                maxConcurrentJobs: this.config.maxConcurrentJobs,
                batchSize: this.config.batchSize,
                heartbeatInterval: this.config.heartbeatIntervalSeconds,
                logLevel: this.config.logLevel
            },
            process: {
                pid: process.pid,
                platform: process.platform,
                nodeVersion: process.version,
                argv: process.argv
            }
        };
    }
    async getMetrics() {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        return {
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            memory: {
                rss: memoryUsage.rss,
                heapTotal: memoryUsage.heapTotal,
                heapUsed: memoryUsage.heapUsed,
                external: memoryUsage.external,
                arrayBuffers: memoryUsage.arrayBuffers
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            worker: this.workerManager ? this.workerManager.getStatus() : null
        };
    }
    async checkDatabaseConnection() {
        try {
            // Simple database connectivity check
            const response = await fetch(`${this.config.supabaseUrl}/rest/v1/workers?limit=1`, {
                headers: {
                    'Authorization': `Bearer ${this.config.supabaseServiceKey}`,
                    'apikey': this.config.supabaseServiceKey
                }
            });
            return response.ok;
        }
        catch (error) {
            this.logger.error('Database connection check failed:', error);
            return false;
        }
    }
    async start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.config.healthPort, '0.0.0.0', () => {
                    this.logger.info(`🏥 Health server started on port ${this.config.healthPort}`);
                    resolve();
                });
                this.server.on('error', (error) => {
                    this.logger.error('Health server error:', error);
                    reject(error);
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.logger.info('🏥 Health server stopped');
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
}
exports.HealthServer = HealthServer;
//# sourceMappingURL=HealthServer.js.map