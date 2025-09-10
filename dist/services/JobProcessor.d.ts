import { SupabaseClient } from '@supabase/supabase-js';
interface TripAdvisorImportPayload {
    user_id: string;
    url: string;
    full_history: boolean;
    business_name?: string;
    priority?: number;
}
export declare class JobProcessor {
    private supabase;
    private config;
    private logger;
    private dataForSEOClient;
    private retryManager;
    constructor(supabase: SupabaseClient);
    processTripAdvisorImport(jobId: string, payload: TripAdvisorImportPayload): Promise<void>;
    private validateTripAdvisorPayload;
    private createReviewSyncJob;
    private extractTripAdvisorPath;
    private createDataForSEOTask;
    private pollForResults;
    private importReviews;
    private updateProgress;
    private updateSyncJob;
    private completeJob;
    private failJob;
}
export {};
//# sourceMappingURL=JobProcessor.d.ts.map