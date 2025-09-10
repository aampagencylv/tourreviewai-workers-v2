"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const winston_1 = __importDefault(require("winston"));
const Config_1 = require("../config/Config");
class Logger {
    constructor() {
        const config = Config_1.Config.getInstance();
        // Define log format
        const logFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
        }));
        // Create transports
        const transports = [
            new winston_1.default.transports.Console({
                format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta, null, 2)}` : '';
                    return `[${timestamp}] ${level}: ${message}${metaStr}`;
                }))
            })
        ];
        // Add file transport in production
        if (Config_1.Config.isProduction()) {
            transports.push(new winston_1.default.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                format: logFormat,
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5
            }), new winston_1.default.transports.File({
                filename: 'logs/combined.log',
                format: logFormat,
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5
            }));
        }
        // Create logger instance
        this.logger = winston_1.default.createLogger({
            level: config.logLevel,
            format: logFormat,
            transports,
            exitOnError: false
        });
        // Handle uncaught exceptions and rejections
        this.logger.exceptions.handle(new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
        }));
        this.logger.rejections.handle(new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
        }));
    }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    debug(message, meta) {
        this.logger.debug(message, meta);
    }
    info(message, meta) {
        this.logger.info(message, meta);
    }
    warn(message, meta) {
        this.logger.warn(message, meta);
    }
    error(message, error) {
        if (error instanceof Error) {
            this.logger.error(message, {
                error: error.message,
                stack: error.stack,
                name: error.name
            });
        }
        else if (error) {
            this.logger.error(message, { error });
        }
        else {
            this.logger.error(message);
        }
    }
    // Structured logging methods
    logJobStart(jobId, jobType, workerId) {
        this.info('Job started', {
            jobId,
            jobType,
            workerId,
            event: 'job_start'
        });
    }
    logJobComplete(jobId, jobType, workerId, durationMs) {
        this.info('Job completed', {
            jobId,
            jobType,
            workerId,
            durationMs,
            event: 'job_complete'
        });
    }
    logJobFailed(jobId, jobType, workerId, error) {
        this.error('Job failed', {
            jobId,
            jobType,
            workerId,
            error,
            event: 'job_failed'
        });
    }
    logApiCall(apiName, method, url, statusCode, durationMs) {
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
    logWorkerEvent(workerId, event, details) {
        this.info(`Worker ${event}`, {
            workerId,
            event: `worker_${event}`,
            ...details
        });
    }
    logDatabaseOperation(operation, table, durationMs, success) {
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
    async logPerformance(operation, fn, context) {
        const startTime = Date.now();
        let success = false;
        try {
            const result = await fn();
            success = true;
            return result;
        }
        catch (error) {
            success = false;
            throw error;
        }
        finally {
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
    child(context) {
        return this.logger.child(context);
    }
    // Get the underlying winston logger
    getWinstonLogger() {
        return this.logger;
    }
}
exports.Logger = Logger;
//# sourceMappingURL=Logger.js.map