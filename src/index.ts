import dotenv from 'dotenv';
import { WorkerManager } from './services/WorkerManager';
import { HealthServer } from './services/HealthServer';
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
    
    // Start health server
    const healthServer = new HealthServer();
    await healthServer.start();
    
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

