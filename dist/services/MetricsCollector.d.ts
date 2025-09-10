import { SupabaseClient } from '@supabase/supabase-js';
export declare class MetricsCollector {
    private supabase;
    private config;
    private logger;
    private metricsBuffer;
    private flushInterval?;
    constructor(supabase: SupabaseClient);
    recordJobCompletion(jobType: string, durationMs: number): Promise<void>;
    recordJobFailure(jobType: string, errorMessage: string): Promise<void>;
    recordApiCall(apiName: string, durationMs: number, success: boolean): Promise<void>;
    recordReviewsProcessed(count: number, platform: string): Promise<void>;
    recordSystemMetrics(): Promise<void>;
    recordWorkerStatus(status: string, currentJobs: number): Promise<void>;
    recordQueueDepth(depth: number): Promise<void>;
    private recordMetrics;
    private flushMetrics;
    private startPeriodicFlush;
    stop(): Promise<void>;
    recordTimer<T>(metricName: string, operation: () => Promise<T>, tags?: Record<string, any>): Promise<T>;
    recordCounter(metricName: string, value?: number, tags?: Record<string, any>): Promise<void>;
    recordGauge(metricName: string, value: number, unit: string, tags?: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=MetricsCollector.d.ts.map