import { Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
export declare class JobAPI {
    private supabase;
    private logger;
    constructor(supabase: SupabaseClient);
    createTripAdvisorJob: (req: Request, res: Response) => Promise<void>;
    getJobStatus: (req: Request, res: Response) => Promise<void>;
    listUserJobs: (req: Request, res: Response) => Promise<void>;
    getJobReviews: (req: Request, res: Response) => Promise<void>;
}
//# sourceMappingURL=JobAPI.d.ts.map