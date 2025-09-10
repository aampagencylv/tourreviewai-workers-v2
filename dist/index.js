"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const supabase_js_1 = require("@supabase/supabase-js");
const WorkerManager_1 = require("./services/WorkerManager");
const HealthServer_1 = require("./services/HealthServer");
const JobAPI_1 = require("./api/JobAPI");
const Logger_1 = require("./utils/Logger");
const Config_1 = require("./config/Config");
// Load environment variables
dotenv_1.default.config();
const logger = Logger_1.Logger.getInstance();
async function main() {
    try {
        logger.info('🚀 Starting TourReviewAI Worker Service');
        // Validate configuration
        Config_1.Config.validate();
        // Initialize Supabase client
        const config = Config_1.Config.getInstance();
        const supabase = (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceKey);
        // Start health server
        const healthServer = new HealthServer_1.HealthServer();
        await healthServer.start();
        // Start API server
        const app = (0, express_1.default)();
        const jobAPI = new JobAPI_1.JobAPI(supabase);
        // Middleware
        app.use((0, cors_1.default)());
        app.use(express_1.default.json());
        // API Routes
        app.post('/api/jobs/tripadvisor', jobAPI.createTripAdvisorJob);
        app.get('/api/jobs/:id/status', jobAPI.getJobStatus);
        app.get('/api/jobs', jobAPI.listUserJobs);
        app.get('/api/jobs/:id/reviews', jobAPI.getJobReviews);
        // Health check endpoint (duplicate of health server for convenience)
        app.get('/api/health', (req, res) => {
            res.json({ status: 'healthy', service: 'tourreviewai-api' });
        });
        const apiPort = parseInt(process.env.API_PORT || '3001');
        app.listen(apiPort, '0.0.0.0', () => {
            logger.info(`🌐 API Server running on port ${apiPort}`);
        });
        // Start worker manager
        const workerManager = new WorkerManager_1.WorkerManager();
        await workerManager.start();
        // Graceful shutdown handling
        const shutdown = async (signal) => {
            logger.info(`📴 Received ${signal}, starting graceful shutdown...`);
            try {
                await workerManager.stop();
                await healthServer.stop();
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
        logger.info('✅ Worker service started successfully');
    }
    catch (error) {
        logger.error('❌ Failed to start worker service:', error);
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
//# sourceMappingURL=index.js.map