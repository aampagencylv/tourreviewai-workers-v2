"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_js_1 = require("@supabase/supabase-js");
const WorkerManager_1 = require("./services/WorkerManager");
const JobAPI_1 = require("./api/JobAPI");
const EnhancedJobAPI_1 = require("./api/EnhancedJobAPI");
const Logger_1 = require("./utils/Logger");
const Config_1 = require("./config/Config");
// Load environment variables
dotenv_1.default.config();
const logger = Logger_1.Logger.getInstance();
async function main() {
    try {
        logger.info('🚀 Starting Enhanced TourReviewAI Worker Service');
        // Validate configuration
        Config_1.Config.validate();
        // Initialize Supabase client
        const config = Config_1.Config.getInstance();
        const supabase = (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceKey);
        // Start API server (single server for everything)
        const app = (0, express_1.default)();
        const jobAPI = new JobAPI_1.JobAPI(supabase);
        const enhancedJobAPI = new EnhancedJobAPI_1.EnhancedJobAPI(supabase);
        // Middleware
        app.use((0, cors_1.default)());
        app.use(express_1.default.json());
        // Root endpoint
        app.get('/', (req, res) => {
            res.json({
                service: 'TourReviewAI Enhanced Worker',
                version: '2.0.0',
                status: 'healthy',
                features: [
                    'TripAdvisor URL validation and locking',
                    'Enhanced sync capabilities',
                    'Comprehensive status monitoring',
                    'Backward compatibility'
                ],
                endpoints: {
                    legacy: [
                        'POST /api/jobs/tripadvisor',
                        'GET /api/jobs/:id/status',
                        'GET /api/jobs',
                        'GET /api/jobs/:id/reviews'
                    ],
                    enhanced: [
                        'POST /api/tripadvisor/validate-url',
                        'POST /api/tripadvisor/setup-url',
                        'GET /api/tripadvisor/lock-status/:userId',
                        'POST /api/tripadvisor/trigger-sync',
                        'GET /api/sync/status/:userId'
                    ]
                }
            });
        });
        // ===== EXISTING API ROUTES (PRESERVED) =====
        app.post('/api/jobs/tripadvisor', jobAPI.createTripAdvisorJob);
        app.get('/api/jobs/:id/status', jobAPI.getJobStatus);
        app.get('/api/jobs', jobAPI.listUserJobs);
        app.get('/api/jobs/:id/reviews', jobAPI.getJobReviews);
        // ===== NEW ENHANCED API ROUTES =====
        // TripAdvisor URL Management
        app.post('/api/tripadvisor/validate-url', enhancedJobAPI.validateTripAdvisorURL);
        app.post('/api/tripadvisor/setup-url', enhancedJobAPI.setupTripAdvisorURL);
        app.get('/api/tripadvisor/lock-status/:userId', enhancedJobAPI.getTripAdvisorLockStatus);
        // Enhanced Sync Management
        app.post('/api/tripadvisor/trigger-sync', enhancedJobAPI.triggerEnhancedSync);
        app.get('/api/sync/status/:userId', enhancedJobAPI.getComprehensiveSyncStatus);
        // ===== HEALTH AND STATUS ENDPOINTS =====
        // Health check endpoint (duplicate of health server for convenience)
        app.get('/api/health', (req, res) => {
            res.json({ status: 'healthy', service: 'tourreviewai-enhanced-api' });
        });
        // Basic health check (for Railway)
        app.get('/health', (req, res) => {
            res.send('OK');
        });
        // Service status endpoint
        app.get('/api/status', async (req, res) => {
            try {
                // Test database connectivity
                const { data, error } = await supabase
                    .from('profiles')
                    .select('user_id')
                    .limit(1);
                const dbStatus = error ? 'error' : 'connected';
                res.json({
                    service: 'TourReviewAI Enhanced Worker',
                    status: 'healthy',
                    database: dbStatus,
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    features: {
                        legacyAPI: true,
                        enhancedAPI: true,
                        urlValidation: true,
                        urlLocking: true,
                        comprehensiveStatus: true
                    }
                });
            }
            catch (error) {
                res.status(500).json({
                    service: 'TourReviewAI Enhanced Worker',
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });
        // ===== ERROR HANDLING =====
        // 404 handler
        app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Endpoint not found',
                availableEndpoints: {
                    legacy: [
                        'POST /api/jobs/tripadvisor',
                        'GET /api/jobs/:id/status',
                        'GET /api/jobs',
                        'GET /api/jobs/:id/reviews'
                    ],
                    enhanced: [
                        'POST /api/tripadvisor/validate-url',
                        'POST /api/tripadvisor/setup-url',
                        'GET /api/tripadvisor/lock-status/:userId',
                        'POST /api/tripadvisor/trigger-sync',
                        'GET /api/sync/status/:userId'
                    ],
                    health: [
                        'GET /health',
                        'GET /api/health',
                        'GET /api/status'
                    ]
                }
            });
        });
        // Global error handler
        app.use((error, req, res, next) => {
            logger.error('Unhandled API error:', error);
            res.status(500).json({
                error: 'Internal server error',
                details: error.message
            });
        });
        const apiPort = parseInt(process.env.PORT || process.env.API_PORT || '8080');
        app.listen(apiPort, '0.0.0.0', () => {
            logger.info(`🌐 Enhanced API Server running on port ${apiPort}`);
            logger.info(`📋 Available endpoints:`);
            logger.info(`   Legacy API: /api/jobs/*`);
            logger.info(`   Enhanced API: /api/tripadvisor/*, /api/sync/*`);
            logger.info(`   Health checks: /health, /api/health, /api/status`);
        });
        // Start worker manager
        const workerManager = new WorkerManager_1.WorkerManager();
        await workerManager.start();
        // Graceful shutdown handling
        const shutdown = async (signal) => {
            logger.info(`📴 Received ${signal}, starting graceful shutdown...`);
            try {
                await workerManager.stop();
                logger.info('✅ Graceful shutdown completed');
                process.exit(0);
            }
            catch (error) {
                logger.error('❌ Error during shutdown:', error);
                process.exit(1);
            }
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        logger.info('✅ Enhanced Worker service started successfully');
        logger.info('🔄 Backward compatibility maintained for existing functionality');
        logger.info('🆕 New enhanced features available');
    }
    catch (error) {
        logger.error('❌ Failed to start enhanced worker service:', error);
        process.exit(1);
    }
}
// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('🚨 Unhandled Rejection at:', { promise, reason });
    process.exit(1);
});
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('🚨 Uncaught Exception:', error);
    process.exit(1);
});
main();
// Force deployment Wed Sep 10 15:38:21 EDT 2025
//# sourceMappingURL=index.js.map