interface WorkerStatus {
    id: string;
    hostname: string;
    status: 'idle' | 'busy' | 'offline';
    current_job_count: number;
    max_concurrent_jobs: number;
    last_heartbeat: string;
}
export declare class WorkerManager {
    private config;
    private logger;
    private supabase;
    private jobProcessor;
    private metricsCollector;
    private isRunning;
    private currentJobs;
    private heartbeatInterval?;
    private jobPollingInterval?;
    constructor();
    start(): Promise<void>;
    stop(): Promise<void>;
    private registerWorker;
    private unregisterWorker;
    private startHeartbeat;
    private sendHeartbeat;
    private startJobPolling;
    private canAcceptMoreJobs;
    private pollForJobs;
    private claimNextJob;
    private processJob;
    private executeJob;
    private updateJobStatus;
    private startCleanupTasks;
    getStatus(): WorkerStatus;
}
export {};
//# sourceMappingURL=WorkerManager.d.ts.map