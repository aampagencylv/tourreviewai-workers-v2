import winston from 'winston';
export declare class Logger {
    private static instance;
    private logger;
    private constructor();
    static getInstance(): Logger;
    debug(message: string, meta?: any): void;
    info(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    error(message: string, error?: any): void;
    logJobStart(jobId: string, jobType: string, workerId: string): void;
    logJobComplete(jobId: string, jobType: string, workerId: string, durationMs: number): void;
    logJobFailed(jobId: string, jobType: string, workerId: string, error: string): void;
    logApiCall(apiName: string, method: string, url: string, statusCode: number, durationMs: number): void;
    logWorkerEvent(workerId: string, event: string, details?: any): void;
    logDatabaseOperation(operation: string, table: string, durationMs: number, success: boolean): void;
    logPerformance<T>(operation: string, fn: () => Promise<T>, context?: any): Promise<T>;
    child(context: any): winston.Logger;
    getWinstonLogger(): winston.Logger;
}
//# sourceMappingURL=Logger.d.ts.map