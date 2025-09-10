"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const Config_js_1 = require("./config/Config.js");
const Logger_js_1 = require("./utils/Logger.js");
const ScalableJobProcessor_js_1 = require("./services/ScalableJobProcessor.js");
const config = Config_js_1.Config.getInstance();
const logger = Logger_js_1.Logger.getInstance();
async function main() {
    const app = (0, express_1.default)();
    const PORT = parseInt(process.env.PORT || process.env.API_PORT || '8080');
    // Middleware
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use(express_1.default.urlencoded({ extended: true }));
    // Initialize scalable processor
    const scalableProcessor = new ScalableJobProcessor_js_1.ScalableJobProcessor(config, logger);
    // Root endpoint - Service information
    app.get('/', (req, res) => {
        res.json({
            service: 'TourReviewAI Scalable Worker',
            version: '3.0.0',
            status: 'healthy',
            timestamp: new Date().toISOString(),
            architecture: 'Three-Phase Scalable Import System',
            phases: {
                phase1: 'Quick count + sample (30 seconds) → Immediate dashboard update',
                phase2: 'Background bulk import (chunked) → Progressive updates',
                phase3: 'Daily incremental sync → Fast maintenance'
            },
            endpoints: [
                'POST /api/tripadvisor/phase1 - Quick count and sample (immediate)',
                'POST /api/tripadvisor/phase3 - Daily incremental sync',
                'GET /api/tripadvisor/progress/:syncJobId - Get detailed progress'
            ]
        });
    });
    // Health check endpoints
    app.get('/health', (req, res) => {
        res.send('OK');
    });
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'TourReviewAI Scalable Worker',
            version: '3.0.0'
        });
    });
    // PHASE 1: Quick count and sample (immediate dashboard update)
    app.post('/api/tripadvisor/phase1', async (req, res) => {
        try {
            logger.info('🚀 Phase 1 request received:', req.body);
            const payload = req.body;
            if (!payload.user_id || !payload.url) {
                return res.status(400).json({ error: 'user_id and url are required' });
            }
            const result = await scalableProcessor.processPhase1({
                user_id: payload.user_id,
                url: payload.url,
                full_history: true,
                business_name: payload.business_name
            });
            return res.status(201).json(result);
        }
        catch (error) {
            logger.error('❌ Phase 1 error:', error);
            return res.status(500).json({
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    // PHASE 3: Daily incremental sync
    app.post('/api/tripadvisor/phase3', async (req, res) => {
        try {
            logger.info('🔄 Phase 3 request received:', req.body);
            const payload = req.body;
            if (!payload.user_id || !payload.url) {
                return res.status(400).json({ error: 'user_id and url are required' });
            }
            const result = await scalableProcessor.processPhase3({
                user_id: payload.user_id,
                url: payload.url,
                full_history: false,
                business_name: payload.business_name
            });
            return res.status(201).json(result);
        }
        catch (error) {
            logger.error('❌ Phase 3 error:', error);
            return res.status(500).json({
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    // Get detailed progress for any sync job
    app.get('/api/tripadvisor/progress/:syncJobId', async (req, res) => {
        try {
            const { syncJobId } = req.params;
            const { data, error } = await scalableProcessor.supabase
                .from('review_sync_jobs')
                .select('*')
                .eq('id', syncJobId)
                .single();
            if (error || !data) {
                return res.status(404).json({ error: 'Sync job not found' });
            }
            return res.json({
                syncJobId: data.id,
                status: data.status,
                progress: data.progress_percentage,
                stage: data.processing_stage,
                totalAvailable: data.total_available,
                imported: data.imported_count,
                skipped: data.skipped_count,
                errors: data.error_count,
                startedAt: data.started_at,
                completedAt: data.completed_at,
                errorMessage: data.error_message,
                phase: data.processing_stage?.includes('phase_1') ? 1 :
                    data.processing_stage?.includes('phase_2') ? 2 :
                        data.processing_stage?.includes('phase_3') ? 3 : 'unknown'
            });
        }
        catch (error) {
            logger.error('❌ Progress check error:', error);
            return res.status(500).json({
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    // Get all sync jobs for a user
    app.get('/api/tripadvisor/jobs/:userId', async (req, res) => {
        try {
            const { userId } = req.params;
            const { data, error } = await scalableProcessor.supabase
                .from('review_sync_jobs')
                .select('*')
                .eq('user_id', userId)
                .order('started_at', { ascending: false })
                .limit(10);
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            return res.json({
                jobs: data?.map((job) => ({
                    syncJobId: job.id,
                    status: job.status,
                    progress: job.progress_percentage,
                    stage: job.processing_stage,
                    totalAvailable: job.total_available,
                    imported: job.imported_count,
                    startedAt: job.started_at,
                    completedAt: job.completed_at,
                    phase: job.processing_stage?.includes('phase_1') ? 1 :
                        job.processing_stage?.includes('phase_2') ? 2 :
                            job.processing_stage?.includes('phase_3') ? 3 : 'unknown'
                })) || []
            });
        }
        catch (error) {
            logger.error('❌ Jobs list error:', error);
            return res.status(500).json({
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    // 404 handler
    app.use('*', (req, res) => {
        res.status(404).json({
            error: 'Not Found',
            message: `Endpoint ${req.method} ${req.originalUrl} not found`,
            availableEndpoints: [
                'GET / - Service information',
                'GET /health - Health check',
                'POST /api/tripadvisor/phase1 - Quick count and sample',
                'POST /api/tripadvisor/phase3 - Incremental sync',
                'GET /api/tripadvisor/progress/:syncJobId - Get progress',
                'GET /api/tripadvisor/jobs/:userId - List user jobs'
            ]
        });
    });
    // Error handler
    app.use((error, req, res, next) => {
        logger.error('❌ Unhandled error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    });
    // Start server
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`🌐 TourReviewAI Scalable Worker v3.0.0 running on port ${PORT}`);
        logger.info(`📊 Health check: http://localhost:${PORT}/health`);
        logger.info(`🚀 Phase 1 endpoint: http://localhost:${PORT}/api/tripadvisor/phase1`);
        logger.info(`🔄 Phase 3 endpoint: http://localhost:${PORT}/api/tripadvisor/phase3`);
        logger.info(`📈 Progress tracking: http://localhost:${PORT}/api/tripadvisor/progress/:syncJobId`);
    });
    // Graceful shutdown
    process.on('SIGTERM', () => {
        logger.info('🛑 Received SIGTERM, shutting down gracefully');
        process.exit(0);
    });
    process.on('SIGINT', () => {
        logger.info('🛑 Received SIGINT, shutting down gracefully');
        process.exit(0);
    });
}
main().catch((error) => {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map