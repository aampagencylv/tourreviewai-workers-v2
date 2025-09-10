"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScalableJobProcessor = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const DataForSEOClient_js_1 = require("../clients/DataForSEOClient.js");
class ScalableJobProcessor {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        // Initialize Supabase client
        this.supabase = (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseServiceKey);
        // Initialize DataForSEO client with correct constructor
        this.dataForSEOClient = new DataForSEOClient_js_1.DataForSEOClient();
    }
    /**
     * PHASE 1: Quick count and sample (30 seconds)
     * - Get total review count
     * - Import first 10 reviews
     * - Update dashboard immediately
     */
    async processPhase1(payload) {
        this.logger.info(`🚀 PHASE 1: Quick count and sample for user: ${payload.user_id}`);
        const { syncJobId } = await this.createSyncJob(payload, 'phase_1');
        try {
            await this.updateProgress(syncJobId, 10, 'phase_1_starting');
            const urlPath = this.extractTripAdvisorPath(payload.url);
            // Create DataForSEO task for count check (depth: 10)
            const taskId = await this.createDataForSEOTask(urlPath, 10);
            await this.updateProgress(syncJobId, 30, 'phase_1_getting_count');
            // Get count and sample reviews
            const result = await this.pollForResults(syncJobId, taskId);
            const totalAvailable = result.reviews_count || 0;
            const sampleReviews = result.items || [];
            this.logger.info(`📊 PHASE 1: Found ${totalAvailable} total reviews, importing ${sampleReviews.length} sample reviews`);
            // Import sample reviews immediately
            if (sampleReviews.length > 0) {
                await this.importReviews(syncJobId, sampleReviews, payload.user_id);
            }
            // Update job with total count and mark Phase 1 complete
            await this.updateSyncJob(syncJobId, {
                total_available: totalAvailable,
                imported_count: sampleReviews.length,
                processing_stage: 'phase_1_complete',
                status: totalAvailable > 10 ? 'phase_1_complete' : 'completed'
            });
            await this.updateProgress(syncJobId, 100, 'phase_1_complete');
            // Schedule Phase 2 if more reviews available
            if (totalAvailable > 10) {
                await this.schedulePhase2(payload, syncJobId, totalAvailable);
            }
            this.logger.info(`✅ PHASE 1 COMPLETE: ${sampleReviews.length}/${totalAvailable} reviews imported`);
            return {
                success: true,
                syncJobId,
                totalReviews: totalAvailable,
                message: `Phase 1 complete: ${sampleReviews.length}/${totalAvailable} reviews imported. ${totalAvailable > 10 ? 'Background import started.' : 'Import complete.'}`
            };
        }
        catch (error) {
            this.logger.error(`❌ PHASE 1 failed: ${syncJobId}`, error);
            await this.failJob(syncJobId, error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }
    /**
     * PHASE 2: Background bulk import (chunked processing)
     * - Process remaining reviews in chunks of 500
     * - Update dashboard progressively
     * - Non-blocking background operation
     */
    async processPhase2(payload, syncJobId, totalReviews) {
        this.logger.info(`🔄 PHASE 2: Background import of ${totalReviews - 10} remaining reviews`);
        try {
            await this.updateSyncJob(syncJobId, {
                processing_stage: 'phase_2_starting',
                status: 'phase_2_processing'
            });
            const urlPath = this.extractTripAdvisorPath(payload.url);
            const chunkSize = 500; // Process in chunks of 500 reviews
            const totalChunks = Math.ceil((totalReviews - 10) / chunkSize);
            let totalImported = 10; // Already imported 10 in Phase 1
            for (let chunk = 0; chunk < totalChunks; chunk++) {
                const startOffset = 10 + (chunk * chunkSize); // Skip first 10 already imported
                const endOffset = Math.min(startOffset + chunkSize, totalReviews);
                const reviewsInChunk = endOffset - startOffset;
                this.logger.info(`📦 Processing chunk ${chunk + 1}/${totalChunks}: reviews ${startOffset}-${endOffset}`);
                // Update progress
                const chunkProgress = Math.round((chunk / totalChunks) * 80) + 10; // 10-90% range
                await this.updateProgress(syncJobId, chunkProgress, `phase_2_chunk_${chunk + 1}`);
                // Create DataForSEO task for this chunk
                const taskId = await this.createDataForSEOTaskWithOffset(urlPath, reviewsInChunk, startOffset);
                // Get reviews for this chunk
                const result = await this.pollForResults(syncJobId, taskId);
                const chunkReviews = result.items || [];
                // Import chunk reviews
                if (chunkReviews.length > 0) {
                    const imported = await this.importReviews(syncJobId, chunkReviews, payload.user_id);
                    totalImported += imported;
                    // Update progress with current count
                    await this.updateSyncJob(syncJobId, {
                        imported_count: totalImported,
                        processing_stage: `phase_2_chunk_${chunk + 1}_complete`
                    });
                    this.logger.info(`✅ Chunk ${chunk + 1} complete: ${imported} reviews imported (${totalImported}/${totalReviews} total)`);
                }
                // Small delay between chunks to prevent overwhelming the system
                if (chunk < totalChunks - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            // Mark Phase 2 complete
            await this.updateSyncJob(syncJobId, {
                status: 'completed',
                processing_stage: 'phase_2_complete',
                completed_at: new Date().toISOString(),
                imported_count: totalImported
            });
            await this.updateProgress(syncJobId, 100, 'completed');
            this.logger.info(`✅ PHASE 2 COMPLETE: ${totalImported}/${totalReviews} total reviews imported`);
            return {
                success: true,
                syncJobId,
                totalReviews: totalImported,
                message: `Background import complete: ${totalImported}/${totalReviews} reviews imported`
            };
        }
        catch (error) {
            this.logger.error(`❌ PHASE 2 failed: ${syncJobId}`, error);
            await this.failJob(syncJobId, error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }
    /**
     * PHASE 3: Daily incremental sync (fast maintenance)
     * - Check for new reviews only
     * - Fast 1-2 minute updates
     * - Scheduled daily at 2 AM
     */
    async processPhase3(payload) {
        this.logger.info(`🔄 PHASE 3: Incremental sync for user: ${payload.user_id}`);
        const { syncJobId, lastReviewDate } = await this.createSyncJob(payload, 'phase_3');
        try {
            await this.updateProgress(syncJobId, 20, 'phase_3_checking_new');
            const urlPath = this.extractTripAdvisorPath(payload.url);
            // Create task for checking new reviews (small depth)
            const taskId = await this.createDataForSEOTask(urlPath, 50); // Check last 50 reviews
            await this.updateProgress(syncJobId, 50, 'phase_3_getting_recent');
            const result = await this.pollForResults(syncJobId, taskId);
            const allReviews = result.items || [];
            // Filter for new reviews only
            let newReviews = allReviews;
            if (lastReviewDate) {
                newReviews = allReviews.filter((review) => {
                    const reviewDate = review.timestamp || review.date_of_visit;
                    return reviewDate && new Date(reviewDate) > new Date(lastReviewDate);
                });
            }
            this.logger.info(`📊 PHASE 3: Found ${newReviews.length} new reviews out of ${allReviews.length} checked`);
            let importedCount = 0;
            if (newReviews.length > 0) {
                importedCount = await this.importReviews(syncJobId, newReviews, payload.user_id);
            }
            await this.updateSyncJob(syncJobId, {
                status: 'completed',
                processing_stage: 'phase_3_complete',
                completed_at: new Date().toISOString(),
                imported_count: importedCount,
                total_available: result.reviews_count || 0
            });
            await this.updateProgress(syncJobId, 100, 'completed');
            this.logger.info(`✅ PHASE 3 COMPLETE: ${importedCount} new reviews imported`);
            return {
                success: true,
                syncJobId,
                totalReviews: importedCount,
                message: `Incremental sync complete: ${importedCount} new reviews imported`
            };
        }
        catch (error) {
            this.logger.error(`❌ PHASE 3 failed: ${syncJobId}`, error);
            await this.failJob(syncJobId, error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }
    // Helper methods
    async createSyncJob(payload, phase) {
        const syncJobId = `tripadvisor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        // Get last review date for incremental sync
        let lastReviewDate = null;
        if (phase === 'phase_3') {
            const { data } = await this.supabase
                .from('external_reviews')
                .select('posted_at')
                .eq('source', 'tripadvisor')
                .eq('tour_operator_id', payload.user_id)
                .order('posted_at', { ascending: false })
                .limit(1);
            lastReviewDate = data?.[0]?.posted_at || null;
        }
        const { data, error } = await this.supabase
            .from('review_sync_jobs')
            .insert({
            tour_operator_id: payload.user_id,
            platform: 'tripadvisor',
            source_business_name: payload.business_name || 'Unknown Business',
            source_url: payload.url,
            full_history: payload.full_history || false,
            status: 'processing',
            processing_stage: phase,
            progress_percentage: 0,
            total_available: 0,
            imported_count: 0,
            skipped_count: 0,
            error_count: 0,
            started_at: new Date().toISOString()
        })
            .select('id')
            .single();
        if (error) {
            throw new Error(`Failed to create review sync job: ${error.message}`);
        }
        const syncJobId = data.id;
        this.logger.info(`📝 Created ${phase} sync job: ${syncJobId}`);
        return { syncJobId, lastReviewDate: lastReviewDate || '' };
    }
    async schedulePhase2(payload, syncJobId, totalReviews) {
        // Schedule Phase 2 as a background job (immediate execution)
        this.logger.info(`📅 Scheduling Phase 2 background import for ${totalReviews - 10} remaining reviews`);
        // In a real implementation, this would queue the job for background processing
        // For now, we'll process it immediately in the background
        setImmediate(() => {
            this.processPhase2(payload, syncJobId, totalReviews).catch(error => {
                this.logger.error('Background Phase 2 processing failed:', error);
            });
        });
    }
    extractTripAdvisorPath(url) {
        const match = url.match(/tripadvisor\.com\/(.+)$/);
        if (!match) {
            throw new Error('Invalid TripAdvisor URL format');
        }
        return match[1];
    }
    async createDataForSEOTask(urlPath, depth) {
        const taskData = {
            url: `https://www.tripadvisor.com/${urlPath}`,
            depth: Math.min(depth, 4490), // Respect DataForSEO limits
            sort_by: 'newest'
        };
        const result = await this.dataForSEOClient.createTask('business_data/tripadvisor/reviews', [taskData]);
        if (!result.tasks || result.tasks.length === 0) {
            throw new Error('Failed to create DataForSEO task');
        }
        const task = result.tasks[0];
        if (task.status_code !== 20100) {
            throw new Error(`DataForSEO task creation failed: ${task.status_code} - ${task.status_message}`);
        }
        return task.id;
    }
    async createDataForSEOTaskWithOffset(urlPath, depth, offset) {
        const taskData = {
            url: `https://www.tripadvisor.com/${urlPath}`,
            depth: Math.min(depth, 4490),
            sort_by: 'newest',
            offset: offset
        };
        const result = await this.dataForSEOClient.createTask('business_data/tripadvisor/reviews', [taskData]);
        if (!result.tasks || result.tasks.length === 0) {
            throw new Error('Failed to create DataForSEO task with offset');
        }
        const task = result.tasks[0];
        if (task.status_code !== 20100) {
            throw new Error(`DataForSEO task creation failed: ${task.status_code} - ${task.status_message}`);
        }
        return task.id;
    }
    async pollForResults(syncJobId, taskId) {
        const maxAttempts = 60; // 10 minutes max
        const pollInterval = 10000; // 10 seconds
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            try {
                const result = await this.dataForSEOClient.getTaskResult('business_data/tripadvisor/reviews', taskId);
                if (result.tasks && result.tasks.length > 0) {
                    const task = result.tasks[0];
                    if (task.status_code === 20000 && task.result && Array.isArray(task.result) && task.result.length > 0) {
                        this.logger.info(`✅ DataForSEO results ready for task: ${taskId}`);
                        return task.result[0];
                    }
                    if (task.status_code === 20100) {
                        continue; // Still processing
                    }
                    if (task.status_code !== 20000) {
                        throw new Error(`DataForSEO task failed: ${task.status_code} - ${task.status_message}`);
                    }
                    if (task.status_code === 20000 && (!task.result || !Array.isArray(task.result) || task.result.length === 0)) {
                        return { items: [], reviews_count: 0 };
                    }
                }
            }
            catch (error) {
                this.logger.error(`❌ Error polling results for task ${taskId}:`, error);
                if (attempt > maxAttempts / 2) {
                    throw error;
                }
            }
        }
        throw new Error(`DataForSEO task timed out after ${maxAttempts} attempts`);
    }
    async importReviews(syncJobId, reviews, userId) {
        if (!reviews || reviews.length === 0) {
            return 0;
        }
        this.logger.info(`📝 Importing ${reviews.length} reviews for sync job: ${syncJobId}`);
        const reviewRecords = reviews.map(review => ({
            source: 'tripadvisor',
            external_id: review.review_id || `tripadvisor_${Date.now()}_${Math.random()}`,
            author_name: review.user_profile?.name || 'Anonymous',
            rating: review.rating?.value || 5,
            text: review.review_text || '',
            posted_at: review.timestamp || review.date_of_visit || new Date().toISOString(),
            author_photo_url: null,
            place_name: 'Vegas Jeep Tours',
            review_url: review.review_url || null,
            tour_operator_id: userId,
            raw_data: review
        }));
        const { error, count } = await this.supabase
            .from('external_reviews')
            .upsert(reviewRecords, {
            onConflict: 'source,external_id',
            count: 'exact'
        });
        if (error) {
            this.logger.error(`❌ Import error for sync job ${syncJobId}:`, error);
            throw error;
        }
        const imported = count || 0;
        this.logger.info(`✅ Imported ${imported} reviews for sync job: ${syncJobId}`);
        return imported;
    }
    async updateProgress(syncJobId, percentage, stage) {
        await this.supabase
            .from('review_sync_jobs')
            .update({
            progress_percentage: percentage,
            processing_stage: stage,
            updated_at: new Date().toISOString()
        })
            .eq('id', syncJobId);
    }
    async updateSyncJob(syncJobId, updates) {
        await this.supabase
            .from('review_sync_jobs')
            .update({
            ...updates,
            updated_at: new Date().toISOString()
        })
            .eq('id', syncJobId);
    }
    async failJob(syncJobId, errorMessage) {
        await this.supabase
            .from('review_sync_jobs')
            .update({
            status: 'failed',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
            .eq('id', syncJobId);
    }
}
exports.ScalableJobProcessor = ScalableJobProcessor;
//# sourceMappingURL=ScalableJobProcessor.js.map