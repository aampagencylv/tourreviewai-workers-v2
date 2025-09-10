import { WorkerConfig } from '../config/Config.js';
import { Logger } from '../utils/Logger.js';
interface TripAdvisorJobPayload {
    user_id: string;
    url: string;
    full_history: boolean;
    business_name?: string;
}
interface JobResult {
    success: boolean;
    syncJobId: string;
    totalReviews?: number;
    error?: string;
    message?: string;
}
export declare class ScalableJobProcessor {
    private supabase;
    private dataForSEOClient;
    private config;
    private logger;
    constructor(config: WorkerConfig, logger: Logger);
    /**
     * PHASE 1: Quick count and sample (30 seconds)
     * - Get total review count
     * - Import first 10 reviews
     * - Update dashboard immediately
     */
    processPhase1(payload: TripAdvisorJobPayload): Promise<JobResult>;
    /**
     * PHASE 2: Background bulk import (chunked processing)
     * - Process remaining reviews in chunks of 500
     * - Update dashboard progressively
     * - Non-blocking background operation
     */
    processPhase2(payload: TripAdvisorJobPayload, syncJobId: string, totalReviews: number): Promise<JobResult>;
    /**
     * PHASE 3: Daily incremental sync (fast maintenance)
     * - Check for new reviews only
     * - Fast 1-2 minute updates
     * - Scheduled daily at 2 AM
     */
    processPhase3(payload: TripAdvisorJobPayload): Promise<JobResult>;
    private createSyncJob;
    private schedulePhase2;
    private extractTripAdvisorPath;
    private createDataForSEOTask;
    private createDataForSEOTaskWithOffset;
    private pollForResults;
    private importReviews;
    private updateProgress;
    private updateSyncJob;
    private failJob;
}
export {};
//# sourceMappingURL=ScalableJobProcessor.d.ts.map