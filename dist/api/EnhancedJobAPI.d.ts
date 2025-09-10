import { SupabaseClient } from '@supabase/supabase-js';
import { JobAPI } from './JobAPI';
export declare class EnhancedJobAPI extends JobAPI {
    private enhancedLogger;
    constructor(supabase: SupabaseClient);
    validateTripAdvisorURL: (req: any, res: any) => Promise<void>;
    setupTripAdvisorURL: (req: any, res: any) => Promise<void>;
    getTripAdvisorLockStatus: (req: any, res: any) => Promise<void>;
    triggerEnhancedSync: (req: any, res: any) => Promise<void>;
    getComprehensiveSyncStatus: (req: any, res: any) => Promise<void>;
    private performURLValidation;
    private checkURLAvailability;
    private setupUserTripAdvisorURL;
    private getUserURLLockStatus;
    private getUserTripAdvisorConfig;
    private getRunningSync;
    private createEnhancedSyncJob;
    private lockUserTripAdvisorURL;
    private getComprehensiveStatus;
    private logURLAudit;
}
//# sourceMappingURL=EnhancedJobAPI.d.ts.map