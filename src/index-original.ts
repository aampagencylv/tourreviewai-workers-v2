import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { WorkerManager } from './services/WorkerManager';
import { HealthServer } from './services/HealthServer';
import { JobAPI } from './api/JobAPI';
import { Logger } from './utils/Logger';
import { Config } from './config/Config';

// Load environment variables
dotenv.config();

const logger = Logger.getInstance();

async function main() {
  try {
    logger.info('🚀 Starting TourReviewAI Worker Service');
    
    // Validate configuration
    Config.validate();
    
    // Initialize Supabase client
    const config = Config.getInstance();
    const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
    
    // Start health server
    const healthServer = new HealthServer();
    await healthServer.start();
    
    // Start API server
    const app = express();
    const jobAPI = new JobAPI(supabase);
    
    // Middleware
    app.use(cors());
    app.use(express.json());
    
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
    const workerManager = new WorkerManager();
    await workerManager.start();
    
    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      logger.info(`📴 Received ${signal}, starting graceful shutdown...`);
      
      try {
        await workerManager.stop();
        await healthServer.stop();
        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    logger.info('✅ Worker service started successfully');
    
  } catch (error) {
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

