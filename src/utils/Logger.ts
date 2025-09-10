import winston from 'winston';
import { Config } from '../config/Config';

export class Logger {
  private static instance: Logger;
  private logger: winston.Logger;
  
  private constructor() {
    const config = Config.getInstance();
    
    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
      })
    );
    
    // Create transports
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta, null, 2)}` : '';
            return `[${timestamp}] ${level}: ${message}${metaStr}`;
          })
        )
      })
    ];
    
    // Add file transport in production
    if (Config.isProduction()) {
      transports.push(
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: logFormat,
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: logFormat,
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5
        })
      );
    }
    
    // Create logger instance
    this.logger = winston.createLogger({
      level: config.logLevel,
      format: logFormat,
      transports,
      exitOnError: false
    });
    
    // Handle uncaught exceptions and rejections
    this.logger.exceptions.handle(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    );
    
    this.logger.rejections.handle(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    );
  }
  
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }
  
  public debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }
  
  public info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }
  
  public warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }
  
  public error(message: string, error?: any): void {
    if (error instanceof Error) {
      this.logger.error(message, {
        error: error.message,
        stack: error.stack,
        name: error.name
      });
    } else if (error) {
      this.logger.error(message, { error });
    } else {
      this.logger.error(message);
    }
  }
  
  // Structured logging methods
  public logJobStart(jobId: string, jobType: string, workerId: string): void {
    this.info('Job started', {
      jobId,
      jobType,
      workerId,
      event: 'job_start'
    });
  }
  
  public logJobComplete(jobId: string, jobType: string, workerId: string, durationMs: number): void {
    this.info('Job completed', {
      jobId,
      jobType,
      workerId,
      durationMs,
      event: 'job_complete'
    });
  }
  
  public logJobFailed(jobId: string, jobType: string, workerId: string, error: string): void {
    this.error('Job failed', {
      jobId,
      jobType,
      workerId,
      error,
      event: 'job_failed'
    });
  }
  
  public logApiCall(apiName: string, method: string, url: string, statusCode: number, durationMs: number): void {
    const level = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'debug';
    
    this.logger.log(level, 'API call', {
      apiName,
      method,
      url,
      statusCode,
      durationMs,
      event: 'api_call'
    });
  }
  
  public logWorkerEvent(workerId: string, event: string, details?: any): void {
    this.info(`Worker ${event}`, {
      workerId,
      event: `worker_${event}`,
      ...details
    });
  }
  
  public logDatabaseOperation(operation: string, table: string, durationMs: number, success: boolean): void {
    const level = success ? 'debug' : 'error';
    
    this.logger.log(level, `Database ${operation}`, {
      operation,
      table,
      durationMs,
      success,
      event: 'database_operation'
    });
  }
  
  // Performance logging
  public async logPerformance<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: any
  ): Promise<T> {
    const startTime = Date.now();
    let success = false;
    
    try {
      const result = await fn();
      success = true;
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const durationMs = Date.now() - startTime;
      
      this.logger.log(success ? 'debug' : 'error', `Performance: ${operation}`, {
        operation,
        durationMs,
        success,
        event: 'performance',
        ...context
      });
    }
  }
  
  // Create child logger with context
  public child(context: any): winston.Logger {
    return this.logger.child(context);
  }
  
  // Get the underlying winston logger
  public getWinstonLogger(): winston.Logger {
    return this.logger;
  }
}

