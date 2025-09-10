export interface RetryOptions {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier?: number;
    maxDelayMs?: number;
    retryCondition?: (error: any) => boolean;
}
export interface RetryResult<T> {
    result: T;
    attempts: number;
    totalDuration: number;
}
export declare class RetryManager {
    private logger;
    executeWithRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T>;
    executeWithRetryAndResult<T>(operation: () => Promise<T>, options: RetryOptions): Promise<RetryResult<T>>;
    retryDatabaseOperation<T>(operation: () => Promise<T>, maxAttempts?: number): Promise<T>;
    retryApiCall<T>(operation: () => Promise<T>, maxAttempts?: number): Promise<T>;
    retryDataForSEOCall<T>(operation: () => Promise<T>, maxAttempts?: number): Promise<T>;
    private circuitBreakers;
    executeWithCircuitBreaker<T>(operationName: string, operation: () => Promise<T>, options: {
        failureThreshold: number;
        recoveryTimeMs: number;
        retryOptions?: RetryOptions;
    }): Promise<T>;
    private delay;
    addJitter(delayMs: number, jitterPercent?: number): number;
}
//# sourceMappingURL=RetryManager.d.ts.map