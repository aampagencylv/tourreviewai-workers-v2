"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedJobAPI = void 0;
const Logger_1 = require("../utils/Logger");
const JobAPI_1 = require("./JobAPI");
class EnhancedJobAPI extends JobAPI_1.JobAPI {
    constructor(supabase) {
        super(supabase);
        this.enhancedLogger = Logger_1.Logger.getInstance();
        // NEW: POST /api/tripadvisor/validate-url - Validate TripAdvisor URL
        this.validateTripAdvisorURL = async (req, res) => {
            try {
                const { url, userId } = req.body;
                if (!url) {
                    res.status(400).json({
                        error: 'URL is required'
                    });
                    return;
                }
                const validation = await this.performURLValidation(url, userId);
                res.json({
                    success: true,
                    validation
                });
            }
            catch (error) {
                this.enhancedLogger.error('Error validating TripAdvisor URL:', error);
                res.status(500).json({
                    error: 'Failed to validate URL',
                    details: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        };
        // NEW: POST /api/tripadvisor/setup-url - Setup and lock TripAdvisor URL
        this.setupTripAdvisorURL = async (req, res) => {
            try {
                const { url, userId } = req.body;
                if (!url || !userId) {
                    res.status(400).json({
                        error: 'URL and userId are required'
                    });
                    return;
                }
                // First validate the URL
                const validation = await this.performURLValidation(url, userId);
                if (!validation.isValid) {
                    res.status(400).json({
                        error: 'Invalid URL',
                        details: validation.errorMessage
                    });
                    return;
                }
                // Check if URL is available
                const availability = await this.checkURLAvailability(url, userId);
                if (!availability.available) {
                    res.status(409).json({
                        error: 'URL not available',
                        details: availability.reason
                    });
                    return;
                }
                // Setup the URL in user profile
                const setupResult = await this.setupUserTripAdvisorURL(userId, url, validation);
                if (!setupResult.success) {
                    res.status(500).json({
                        error: 'Failed to setup URL',
                        details: setupResult.error
                    });
                    return;
                }
                res.json({
                    success: true,
                    message: 'TripAdvisor URL setup successfully',
                    businessName: validation.businessName,
                    businessId: validation.businessId,
                    isLocked: false // Will be locked after first successful sync
                });
            }
            catch (error) {
                this.enhancedLogger.error('Error setting up TripAdvisor URL:', error);
                res.status(500).json({
                    error: 'Failed to setup URL',
                    details: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        };
        // NEW: GET /api/tripadvisor/lock-status/:userId - Get URL lock status
        this.getTripAdvisorLockStatus = async (req, res) => {
            try {
                const { userId } = req.params;
                const lockStatus = await this.getUserURLLockStatus(userId);
                res.json({
                    success: true,
                    lockStatus
                });
            }
            catch (error) {
                this.enhancedLogger.error('Error getting lock status:', error);
                res.status(500).json({
                    error: 'Failed to get lock status',
                    details: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        };
        // NEW: POST /api/tripadvisor/trigger-sync - Enhanced sync trigger with validation
        this.triggerEnhancedSync = async (req, res) => {
            try {
                const { userId, fullHistory = false, priority = 'normal' } = req.body;
                if (!userId) {
                    res.status(400).json({
                        error: 'userId is required'
                    });
                    return;
                }
                // Get user's TripAdvisor configuration
                const userConfig = await this.getUserTripAdvisorConfig(userId);
                if (!userConfig.hasIntegration) {
                    res.status(400).json({
                        error: 'TripAdvisor integration not configured for this user'
                    });
                    return;
                }
                // Check if there's already a running sync
                const existingSync = await this.getRunningSync(userId);
                if (existingSync) {
                    res.status(409).json({
                        error: 'Sync already in progress',
                        existingJobId: existingSync.id,
                        status: existingSync.status
                    });
                    return;
                }
                // Create enhanced sync job
                const syncJob = await this.createEnhancedSyncJob(userId, userConfig, fullHistory, priority);
                if (!syncJob.success) {
                    res.status(500).json({
                        error: 'Failed to create sync job',
                        details: syncJob.error
                    });
                    return;
                }
                // If this is the first successful sync, lock the URL
                if (!userConfig.isLocked) {
                    await this.lockUserTripAdvisorURL(userId);
                }
                res.json({
                    success: true,
                    jobId: syncJob.jobId,
                    syncJobId: syncJob.syncJobId,
                    message: 'Enhanced sync job created successfully',
                    estimatedDuration: fullHistory ? '2-5 minutes' : '30-60 seconds'
                });
            }
            catch (error) {
                this.enhancedLogger.error('Error triggering enhanced sync:', error);
                res.status(500).json({
                    error: 'Failed to trigger sync',
                    details: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        };
        // NEW: GET /api/sync/status/:userId - Get comprehensive sync status
        this.getComprehensiveSyncStatus = async (req, res) => {
            try {
                const { userId } = req.params;
                const status = await this.getComprehensiveStatus(userId);
                res.json({
                    success: true,
                    status
                });
            }
            catch (error) {
                this.enhancedLogger.error('Error getting comprehensive sync status:', error);
                res.status(500).json({
                    error: 'Failed to get sync status',
                    details: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        };
    }
    // Helper Methods
    async performURLValidation(url, userId) {
        try {
            // Basic URL format validation
            if (!url.includes('tripadvisor.com')) {
                return {
                    isValid: false,
                    errorMessage: 'URL must be from TripAdvisor'
                };
            }
            // Extract business information from URL
            const urlPattern = /tripadvisor\.com\/([^\/]+)\/([^\/]+)-g(\d+)-d(\d+)-Reviews-(.+)\.html/;
            const match = url.match(urlPattern);
            if (!match) {
                return {
                    isValid: false,
                    errorMessage: 'Invalid TripAdvisor URL format. Please use a business page URL.'
                };
            }
            const [, type, location, locationCode, businessId, businessSlug] = match;
            // Extract business name from slug
            const businessName = businessSlug
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            return {
                isValid: true,
                businessName,
                businessId,
                locationCode,
            };
        }
        catch (error) {
            this.enhancedLogger.error('URL validation error:', error);
            return {
                isValid: false,
                errorMessage: 'Failed to validate URL'
            };
        }
    }
    async checkURLAvailability(url, userId) {
        try {
            // Check if URL is already in use by another user
            const { data: existingUser, error } = await this.supabase
                .from('profiles')
                .select('user_id, company_name')
                .eq('tripadvisor_location_id', url)
                .neq('user_id', userId)
                .single();
            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
                throw error;
            }
            if (existingUser) {
                return {
                    available: false,
                    reason: `This TripAdvisor business is already claimed by ${existingUser.company_name}`
                };
            }
            return { available: true };
        }
        catch (error) {
            this.enhancedLogger.error('Error checking URL availability:', error);
            return {
                available: false,
                reason: 'Failed to check URL availability'
            };
        }
    }
    async setupUserTripAdvisorURL(userId, url, validation) {
        try {
            const { error } = await this.supabase
                .from('profiles')
                .update({
                tripadvisor_location_id: url,
                tripadvisor_business_name: validation.businessName,
                tripadvisor_business_id: validation.businessId,
                tripadvisor_location_code: validation.locationCode,
                updated_at: new Date().toISOString()
            })
                .eq('user_id', userId);
            if (error) {
                throw error;
            }
            // Log the setup in audit trail
            await this.logURLAudit(userId, 'setup', url, validation.businessName);
            return { success: true };
        }
        catch (error) {
            this.enhancedLogger.error('Error setting up user TripAdvisor URL:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    async getUserURLLockStatus(userId) {
        try {
            const { data: profile, error } = await this.supabase
                .from('profiles')
                .select('tripadvisor_location_id, tripadvisor_url_locked_at, tripadvisor_business_name')
                .eq('user_id', userId)
                .single();
            if (error) {
                throw error;
            }
            const isLocked = !!profile.tripadvisor_url_locked_at;
            return {
                isLocked,
                lockedAt: profile.tripadvisor_url_locked_at,
                canUpdate: !isLocked,
                message: isLocked
                    ? `TripAdvisor URL is locked since first successful sync on ${new Date(profile.tripadvisor_url_locked_at).toLocaleDateString()}`
                    : 'TripAdvisor URL can be updated until first successful sync'
            };
        }
        catch (error) {
            this.enhancedLogger.error('Error getting URL lock status:', error);
            return {
                isLocked: false,
                canUpdate: true,
                message: 'Unable to determine lock status'
            };
        }
    }
    async getUserTripAdvisorConfig(userId) {
        try {
            const { data: profile, error } = await this.supabase
                .from('profiles')
                .select('tripadvisor_location_id, tripadvisor_url_locked_at, tripadvisor_business_name, company_name')
                .eq('user_id', userId)
                .single();
            if (error) {
                throw error;
            }
            return {
                hasIntegration: !!profile.tripadvisor_location_id,
                url: profile.tripadvisor_location_id,
                isLocked: !!profile.tripadvisor_url_locked_at,
                businessName: profile.tripadvisor_business_name,
                companyName: profile.company_name
            };
        }
        catch (error) {
            this.enhancedLogger.error('Error getting user TripAdvisor config:', error);
            return {
                hasIntegration: false,
                isLocked: false
            };
        }
    }
    async getRunningSync(userId) {
        try {
            const { data: runningJob, error } = await this.supabase
                .from('review_sync_jobs')
                .select('id, status, created_at')
                .eq('tour_operator_id', userId)
                .eq('platform', 'tripadvisor')
                .in('status', ['pending', 'running'])
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (error && error.code !== 'PGRST116') {
                throw error;
            }
            return runningJob;
        }
        catch (error) {
            this.enhancedLogger.error('Error checking running sync:', error);
            return null;
        }
    }
    async createEnhancedSyncJob(userId, userConfig, fullHistory, priority) {
        try {
            // Create sync job record
            const { data: syncJob, error: syncError } = await this.supabase
                .from('review_sync_jobs')
                .insert({
                tour_operator_id: userId,
                platform: 'tripadvisor',
                status: 'pending',
                full_history: fullHistory,
                source_url: userConfig.url,
                source_business_name: userConfig.businessName,
                total_available: 0,
                imported_count: 0,
                started_at: new Date().toISOString()
            })
                .select()
                .single();
            if (syncError) {
                throw syncError;
            }
            // Create queue job for processing
            const { data: queueJob, error: queueError } = await this.supabase
                .from('job_queue')
                .insert({
                user_id: userId,
                job_type: 'tripadvisor_import',
                priority: priority === 'high' ? 1 : 2,
                status: 'pending',
                payload: {
                    user_id: userId,
                    url: userConfig.url,
                    full_history: fullHistory,
                    business_name: userConfig.businessName,
                    sync_job_id: syncJob.id
                },
                max_attempts: 3,
                estimated_duration_minutes: fullHistory ? 5 : 2
            })
                .select()
                .single();
            if (queueError) {
                throw queueError;
            }
            // Link sync job to queue job
            await this.supabase
                .from('review_sync_jobs')
                .update({ queue_job_id: queueJob.id })
                .eq('id', syncJob.id);
            return {
                success: true,
                jobId: queueJob.id,
                syncJobId: syncJob.id
            };
        }
        catch (error) {
            this.enhancedLogger.error('Error creating enhanced sync job:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    async lockUserTripAdvisorURL(userId) {
        try {
            await this.supabase
                .from('profiles')
                .update({
                tripadvisor_url_locked_at: new Date().toISOString()
            })
                .eq('user_id', userId);
            await this.logURLAudit(userId, 'locked', null, 'URL locked after first successful sync');
        }
        catch (error) {
            this.enhancedLogger.error('Error locking TripAdvisor URL:', error);
        }
    }
    async getComprehensiveStatus(userId) {
        try {
            // Get user config
            const userConfig = await this.getUserTripAdvisorConfig(userId);
            // Get recent sync jobs
            const { data: recentJobs, error: jobsError } = await this.supabase
                .from('review_sync_jobs')
                .select('*')
                .eq('tour_operator_id', userId)
                .eq('platform', 'tripadvisor')
                .order('created_at', { ascending: false })
                .limit(5);
            if (jobsError) {
                throw jobsError;
            }
            // Get review counts
            const { data: reviewCount, error: countError } = await this.supabase
                .from('external_reviews')
                .select('id', { count: 'exact' })
                .eq('tour_operator_id', userId)
                .eq('source', 'tripadvisor');
            if (countError) {
                throw countError;
            }
            return {
                integration: userConfig,
                recentJobs: recentJobs || [],
                totalReviews: reviewCount?.length || 0,
                lastSyncAt: recentJobs?.[0]?.completed_at || null,
                nextScheduledSync: '2:00 AM UTC daily' // From scheduler
            };
        }
        catch (error) {
            this.enhancedLogger.error('Error getting comprehensive status:', error);
            return {
                integration: { hasIntegration: false },
                recentJobs: [],
                totalReviews: 0,
                lastSyncAt: null
            };
        }
    }
    async logURLAudit(userId, action, url, details) {
        try {
            // Only log if audit table exists
            await this.supabase
                .from('tripadvisor_url_audit')
                .insert({
                user_id: userId,
                action,
                old_url: null,
                new_url: url,
                details,
                created_at: new Date().toISOString()
            });
        }
        catch (error) {
            // Silently fail if audit table doesn't exist yet
            this.enhancedLogger.debug('Audit logging skipped (table may not exist):', error);
        }
    }
}
exports.EnhancedJobAPI = EnhancedJobAPI;
//# sourceMappingURL=EnhancedJobAPI.js.map