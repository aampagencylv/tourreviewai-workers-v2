"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobProcessor = void 0;
const Config_1 = require("../config/Config");
const Logger_1 = require("../utils/Logger");
const DataForSEOClient_1 = require("../clients/DataForSEOClient");
const RetryManager_1 = require("../utils/RetryManager");
// Use require for crypto to ensure compatibility
const crypto = require('crypto');
// Simple UUID generation function as fallback
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
class JobProcessor {
    constructor(supabase) {
        this.supabase = supabase;
        this.config = Config_1.Config.getInstance();
        this.logger = Logger_1.Logger.getInstance();
        this.dataForSEOClient = new DataForSEOClient_1.DataForSEOClient();
        this.retryManager = new RetryManager_1.RetryManager();
    }
    async processTripAdvisorImport(jobId, payload) {
        this.logger.info(`🎯 Processing TripAdvisor import job: ${jobId}`);
        try {
            // Validate payload
            this.validateTripAdvisorPayload(payload);
            // Create review sync job record
            const syncJobId = await this.createReviewSyncJob(jobId, payload);
            // Extract URL path for DataForSEO
            const urlPath = this.extractTripAdvisorPath(payload.url);
            // Update progress
            await this.updateProgress(syncJobId, 10, 'extracting_url');
            // Call DataForSEO API
            const taskId = await this.createDataForSEOTask(urlPath, payload.full_history);
            // Update sync job with task ID
            await this.updateSyncJob(syncJobId, { dataforseo_task_id: taskId });
            await this.updateProgress(syncJobId, 30, 'waiting_for_results');
            // Poll for results
            const reviewsData = await this.pollForResults(syncJobId, taskId);
            // Process and import reviews
            await this.updateProgress(syncJobId, 60, 'importing_reviews');
            const importedCount = await this.importReviews(syncJobId, reviewsData);
            // Mark as completed
            await this.completeJob(syncJobId, importedCount, reviewsData.items?.length || 0);
            this.logger.info(`✅ TripAdvisor import completed: ${importedCount} reviews imported`);
        }
        catch (error) {
            this.logger.error(`❌ TripAdvisor import failed for job ${jobId}:`, error);
            await this.failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }
    validateTripAdvisorPayload(payload) {
        if (!payload.user_id) {
            throw new Error('user_id is required');
        }
        if (!payload.url) {
            throw new Error('url is required');
        }
        if (!payload.url.includes('tripadvisor.com')) {
            throw new Error('Invalid TripAdvisor URL');
        }
        if (typeof payload.full_history !== 'boolean') {
            throw new Error('full_history must be a boolean');
        }
    }
    async createReviewSyncJob(queueJobId, payload) {
        const syncJobId = generateUUID();
        // Extract business info from URL
        const businessMatch = payload.url.match(/\/([^\/]+)\.html$/);
        const businessId = businessMatch ? businessMatch[1] : 'unknown';
        const businessName = payload.business_name ||
            businessId.replace(/-/g, ' ').replace(/^.*Reviews /, '') ||
            'TripAdvisor Business';
        const { error } = await this.supabase
            .from('review_sync_jobs')
            .insert({
            id: syncJobId,
            queue_job_id: queueJobId,
            tour_operator_id: payload.user_id,
            platform: 'tripadvisor',
            source_business_id: businessId,
            source_business_name: businessName,
            source_url: payload.url,
            full_history: payload.full_history,
            status: 'running',
            progress_percentage: 5,
            processing_stage: 'initializing',
            started_at: new Date().toISOString(),
            total_available: 0, // Initialize with 0, will be updated when we get results
            imported_count: 0,
            skipped_count: 0,
            error_count: 0
        });
        if (error) {
            throw new Error(`Failed to create review sync job: ${error.message}`);
        }
        this.logger.info(`📝 Created review sync job: ${syncJobId}`);
        return syncJobId;
    }
    extractTripAdvisorPath(url) {
        const match = url.match(/tripadvisor\.com\/(.+)$/);
        if (!match) {
            throw new Error('Invalid TripAdvisor URL format');
        }
        return match[1];
    }
    async createDataForSEOTask(urlPath, fullHistory) {
        const payload = [{
                url_path: urlPath,
                location_code: 1003854, // United States location code
                priority: 2,
                depth: fullHistory ? 500 : 150 // Increased limits: 150 default, 500 for full history
            }];
        this.logger.info('📡 Creating DataForSEO task:', payload);
        const taskId = await this.retryManager.executeWithRetry(async () => {
            const result = await this.dataForSEOClient.createTask('business_data/tripadvisor/reviews', payload);
            return result.tasks[0].id;
        }, {
            maxAttempts: 3,
            delayMs: 1000,
            backoffMultiplier: 2
        });
        this.logger.info(`⏳ DataForSEO task created: ${taskId}`);
        return taskId;
    }
    async pollForResults(syncJobId, taskId) {
        const maxAttempts = 60; // 10 minutes max
        const pollInterval = 10000; // 10 seconds
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            this.logger.debug(`🔍 Polling DataForSEO results, attempt ${attempt}/${maxAttempts}`);
            // Update progress during polling
            const progressIncrement = Math.min(2, (50 - 30) / maxAttempts);
            await this.updateProgress(syncJobId, 30 + (attempt * progressIncrement), 'waiting_for_results');
            try {
                const result = await this.dataForSEOClient.getTaskResult('business_data/tripadvisor/reviews', taskId);
                if (result.tasks && result.tasks.length > 0) {
                    const task = result.tasks[0];
                    if (task.status_code === 20000 && task.result && task.result.length > 0) {
                        this.logger.info(`✅ DataForSEO results ready for task: ${taskId}`);
                        return task.result[0];
                    }
                    if (task.status_code === 20100) {
                        this.logger.debug(`⏳ DataForSEO task still processing: ${taskId}`);
                        continue;
                    }
                    if (task.status_code !== 20000) {
                        throw new Error(`DataForSEO task failed: ${task.status_code} - ${task.status_message}`);
                    }
                }
            }
            catch (error) {
                this.logger.error(`❌ Error polling results for task ${taskId}:`, error);
                // Continue polling unless it's a critical error or we're past halfway
                if (attempt > maxAttempts / 2) {
                    throw error;
                }
            }
        }
        throw new Error(`DataForSEO task timed out after ${maxAttempts} attempts`);
    }
    async importReviews(syncJobId, reviewsData) {
        const reviews = reviewsData.items || [];
        const totalReviews = reviews.length;
        this.logger.info(`📝 Importing ${totalReviews} reviews for sync job: ${syncJobId}`);
        // Update total available count
        await this.updateSyncJob(syncJobId, { total_available: totalReviews });
        let imported = 0;
        let skipped = 0;
        let errors = 0;
        // Process in batches for better performance and memory management
        const batchSize = this.config.batchSize;
        for (let i = 0; i < reviews.length; i += batchSize) {
            const batch = reviews.slice(i, i + batchSize);
            // Complete review records for the new clean table
            const reviewRecords = batch.map(review => ({
                job_id: syncJobId,
                platform: 'tripadvisor',
                external_id: review.review_id || `tripadvisor_${Date.now()}_${Math.random()}`,
                author_name: review.user_profile?.name || 'Anonymous',
                author_location: review.user_profile?.location || null,
                rating: review.rating?.value || 5,
                review_title: review.title || null,
                review_text: review.review_text || 'No review text available',
                review_date: review.timestamp || new Date().toISOString(),
                source_url: review.url || null,
                language: review.language || 'en',
                is_verified: review.is_verified || false,
                helpful_votes: review.helpful_votes || 0,
                raw_data: review
            }));
            try {
                const { error, count } = await this.supabase
                    .from('tripadvisor_reviews')
                    .upsert(reviewRecords, {
                    onConflict: 'platform,external_id',
                    count: 'exact'
                });
                if (error) {
                    this.logger.error(`❌ Batch import error for sync job ${syncJobId}:`, error);
                    errors += batch.length;
                }
                else {
                    const batchImported = count || batch.length;
                    imported += batchImported;
                    skipped += batch.length - batchImported;
                }
            }
            catch (error) {
                this.logger.error(`❌ Batch processing error for sync job ${syncJobId}:`, error);
                errors += batch.length;
            }
            // Update progress
            const progress = 60 + Math.round(((i + batch.length) / totalReviews) * 35);
            await this.updateProgress(syncJobId, progress, 'importing_reviews');
            await this.updateSyncJob(syncJobId, {
                imported_count: imported,
                skipped_count: skipped,
                error_count: errors
            });
            this.logger.debug(`📊 Progress: ${imported}/${totalReviews} imported, ${skipped} skipped, ${errors} errors`);
        }
        this.logger.info(`📊 Import completed: ${imported} imported, ${skipped} skipped, ${errors} errors`);
        return imported;
    }
    async updateProgress(syncJobId, percentage, stage) {
        await this.supabase
            .from('review_sync_jobs')
            .update({
            progress_percentage: Math.min(percentage, 100),
            processing_stage: stage,
            updated_at: new Date().toISOString()
        })
            .eq('id', syncJobId);
    }
    async updateSyncJob(syncJobId, data) {
        await this.supabase
            .from('review_sync_jobs')
            .update({
            ...data,
            updated_at: new Date().toISOString()
        })
            .eq('id', syncJobId);
    }
    async completeJob(syncJobId, importedCount, totalAvailable) {
        await this.supabase
            .from('review_sync_jobs')
            .update({
            status: 'succeeded',
            progress_percentage: 100,
            processing_stage: 'completed',
            completed_at: new Date().toISOString(),
            imported_count: importedCount,
            total_available: totalAvailable,
            updated_at: new Date().toISOString()
        })
            .eq('id', syncJobId);
    }
    async failJob(jobId, errorMessage) {
        // Update both job_queue and review_sync_jobs
        await Promise.all([
            this.supabase
                .from('job_queue')
                .update({
                status: 'failed',
                error_message: errorMessage,
                completed_at: new Date().toISOString()
            })
                .eq('id', jobId),
            this.supabase
                .from('review_sync_jobs')
                .update({
                status: 'failed',
                error: errorMessage,
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
                .eq('queue_job_id', jobId)
        ]);
    }
}
exports.JobProcessor = JobProcessor;
//# sourceMappingURL=JobProcessor.js.map