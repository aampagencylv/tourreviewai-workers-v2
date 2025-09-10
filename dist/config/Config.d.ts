export interface WorkerConfig {
    workerId: string;
    workerVersion: string;
    hostname: string;
    supabaseUrl: string;
    supabaseServiceKey: string;
    redisUrl?: string;
    dataForSeoUsername: string;
    dataForSeoPassword: string;
    maxConcurrentJobs: number;
    jobClaimDurationMinutes: number;
    heartbeatIntervalSeconds: number;
    batchSize: number;
    maxRetryAttempts: number;
    retryDelaySeconds: number;
    healthPort: number;
    logLevel: string;
    nodeEnv: string;
}
export declare class Config {
    private static instance;
    static getInstance(): WorkerConfig;
    private static load;
    static validate(): void;
    static isProduction(): boolean;
    static isDevelopment(): boolean;
}
//# sourceMappingURL=Config.d.ts.map