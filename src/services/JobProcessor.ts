import { SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import { Config } from '../config/Config';
import { Logger } from '../utils/Logger';
import { DataForSEOClient } from '../clients/DataForSEOClient';
import { RetryManager } from '../utils/RetryManager';

// Use require for crypto to ensure compatibility
const crypto = require('crypto');

// Simple UUID generation function as fallback
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

interface TripAdvisorImportPayload {
  user_id: string;
  url: string;
  full_history: boolean;
  business_name?: string;
  priority?: number;
}

interface ReviewData {
  review_id: string;
  title?: string;
  rating: { value: number };
  review_text: string;
  user_profile?: { name: string };
  timestamp: string;
  date_of_experience?: string;
  url?: string;
  [key: string]: any;
}

export class JobProcessor {
  private config = Config.getInstance();
  private logger = Logger.getInstance();
  private dataForSEOClient: DataForSEOClient;
  private retryManager: RetryManager;
  
  constructor(private supabase: SupabaseClient) {
    this.dataForSEOClient = new DataForSEOClient();
    this.retryManager = new RetryManager();
  }
  
  public async processTripAdvisorImport(jobId: string, payload: TripAdvisorImportPayload): Promise<void> {
    this.logger.info(`🎯 Processing TripAdvisor import job: ${jobId}`);
    
    try {
      // Validate payload
      this.validateTripAdvisorPayload(payload);
      
      // Create review sync job record and get last review date for incremental sync
      const { syncJobId, lastReviewDate } = await this.createReviewSyncJob(jobId, payload);
      
      // Extract URL path for DataForSEO
      const urlPath = this.extractTripAdvisorPath(payload.url);
      
      // Update progress
      await this.updateProgress(syncJobId, 10, 'extracting_url');
      
      // Smart two-phase approach for full history imports
      let taskId: string;
      let reviewsData: any;
      
      if (payload.full_history) {
        // Phase 1: Get review count with minimal API cost
        this.logger.info(`📊 Phase 1: Getting review count for smart depth calculation`);
        const countTaskId = await this.createDataForSEOTask(urlPath, false, 10); // Small depth to get count
        await this.updateProgress(syncJobId, 20, 'getting_review_count');
        
        const countData = await this.pollForResults(syncJobId, countTaskId);
        const totalReviews = countData.reviews_count || 0;
        
        this.logger.info(`📊 Found ${totalReviews} total reviews available`);
        await this.updateSyncJob(syncJobId, { total_available: totalReviews });
        
        if (totalReviews > 10) {
          // Phase 2: Get all reviews with exact depth needed
          this.logger.info(`📊 Phase 2: Getting all ${totalReviews} reviews with optimal depth`);
          taskId = await this.createDataForSEOTask(urlPath, true, totalReviews);
          await this.updateProgress(syncJobId, 40, 'getting_all_reviews');
          reviewsData = await this.pollForResults(syncJobId, taskId);
        } else {
          // Use the count data if there are only a few reviews
          this.logger.info(`📊 Using Phase 1 data (only ${totalReviews} reviews)`);
          reviewsData = countData;
        }
      } else {
        // For incremental sync, use standard approach
        const depth = 20; // Small depth for checking new reviews
        taskId = await this.createDataForSEOTask(urlPath, false, depth);
        await this.updateProgress(syncJobId, 30, 'checking_new_reviews');
        reviewsData = await this.pollForResults(syncJobId, taskId);
      }
      
      // Process and import reviews with incremental sync
      await this.updateProgress(syncJobId, 60, 'importing_reviews');
      const importedCount = await this.importReviews(syncJobId, reviewsData, lastReviewDate);
      
      // Mark as completed
      await this.completeJob(syncJobId, importedCount, reviewsData.items?.length || 0);
      
      this.logger.info(`✅ TripAdvisor import completed: ${importedCount} reviews imported`);
      
    } catch (error) {
      this.logger.error(`❌ TripAdvisor import failed for job ${jobId}:`, error);
      await this.failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
  
  private validateTripAdvisorPayload(payload: TripAdvisorImportPayload): void {
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
  
  private async createReviewSyncJob(queueJobId: string, payload: TripAdvisorImportPayload): Promise<{syncJobId: string, lastReviewDate: string | null}> {
    const syncJobId = generateUUID();
    
    // Extract business info from URL
    const businessMatch = payload.url.match(/\/([^\/]+)\.html$/);
    const businessId = businessMatch ? businessMatch[1] : 'unknown';
    const businessName = payload.business_name || 
      businessId.replace(/-/g, ' ').replace(/^.*Reviews /, '') || 
      'TripAdvisor Business';
    
    // Check for incremental sync - find the most recent review for this business
    let lastReviewDate: string | null = null;
    if (!payload.full_history) {
      try {
        const { data: lastReview, error } = await this.supabase
          .from('tripadvisor_reviews')
          .select('review_date')
          .eq('platform', 'tripadvisor')
          .ilike('source_url', `%${businessId}%`)
          .order('review_date', { ascending: false })
          .limit(1)
          .maybeSingle(); // Use maybeSingle() instead of single() to handle no results
          
        if (!error && lastReview?.review_date) {
          lastReviewDate = lastReview.review_date;
          this.logger.info(`🔄 Incremental sync: Last review date found: ${lastReviewDate}`);
        } else {
          this.logger.info(`🆕 First-time import: No existing reviews found for this business`);
        }
      } catch (error) {
        this.logger.warn(`⚠️ Could not check for existing reviews:`, error);
        // Continue with full import if incremental check fails
      }
    }
    
    const { data, error } = await this.supabase
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
        status: 'processing',
        progress_percentage: 0,
        total_available: 0,
        imported_count: 0,
        skipped_count: 0,
        error_count: 0,
        started_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      throw new Error(`Failed to create review sync job: ${error.message}`);
    }
    
    this.logger.info(`📝 Created review sync job: ${syncJobId}`);
    return { syncJobId, lastReviewDate };
  }
  
  private extractTripAdvisorPath(url: string): string {
    const match = url.match(/tripadvisor\.com\/(.+)$/);
    if (!match) {
      throw new Error('Invalid TripAdvisor URL format');
    }
    return match[1];
  }
  
  private async createDataForSEOTask(urlPath: string, fullHistory: boolean, explicitDepth?: number): Promise<string> {
    let depth: number;
    
    if (explicitDepth) {
      // Use the explicit depth provided (either for count check or exact review count)
      depth = Math.min(explicitDepth, 4490); // Respect DataForSEO max limit
    } else if (fullHistory) {
      // Default for full history when we don't know the count yet
      depth = 1000;
    } else {
      // Default for incremental sync
      depth = 20;
    }
    
    // Round up to nearest 10 as recommended by DataForSEO
    depth = Math.ceil(depth / 10) * 10;
    
    const payload = [{
      url_path: urlPath,
      location_code: 1003854, // United States location code
      priority: 2,
      depth: depth
    }];
    
    this.logger.info(`📡 Creating DataForSEO task with depth ${depth} (explicit: ${explicitDepth}, fullHistory: ${fullHistory})`);
    
    const taskId = await this.retryManager.executeWithRetry(
      async () => {
        const result = await this.dataForSEOClient.createTask('business_data/tripadvisor/reviews', payload);
        return result.tasks[0].id;
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
        backoffMultiplier: 2
      }
    );
    
    this.logger.info(`⏳ DataForSEO task created: ${taskId}`);
    return taskId;
  }
  
  private async pollForResults(syncJobId: string, taskId: string): Promise<any> {
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
          
          if (task.status_code === 20000 && task.result && Array.isArray(task.result) && task.result.length > 0) {
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
          
          // Handle case where task is successful but no results
          if (task.status_code === 20000 && (!task.result || !Array.isArray(task.result) || task.result.length === 0)) {
            this.logger.warn(`⚠️ DataForSEO task completed but returned no results for task: ${taskId}`);
            return { items: [], reviews_count: 0 }; // Return empty result structure
          }
        }
      } catch (error) {
        this.logger.error(`❌ Error polling results for task ${taskId}:`, error);
        
        // Continue polling unless it's a critical error or we're past halfway
        if (attempt > maxAttempts / 2) {
          throw error;
        }
      }
    }
    
    throw new Error(`DataForSEO task timed out after ${maxAttempts} attempts`);
  }
  
  private async importReviews(syncJobId: string, reviewsData: any, lastReviewDate?: string | null): Promise<number> {
    const totalAvailable = reviewsData.reviews_count || 0;
    const allReviews: ReviewData[] = reviewsData.items || [];
    
    this.logger.info(`📊 Total reviews available: ${totalAvailable}, Retrieved: ${allReviews.length}`);
    if (lastReviewDate) {
      this.logger.info(`🔄 Incremental sync: Only importing reviews newer than ${lastReviewDate}`);
    }
    
    // Update total available count from API response
    await this.updateSyncJob(syncJobId, { total_available: totalAvailable });
    
    // Filter for incremental sync if needed
    let reviewsToImport = allReviews;
    if (lastReviewDate) {
      reviewsToImport = allReviews.filter(review => {
        const reviewDate = review.timestamp || review.date_of_visit;
        return reviewDate && new Date(reviewDate) > new Date(lastReviewDate);
      });
      this.logger.info(`📋 Filtered reviews: ${reviewsToImport.length}/${allReviews.length} are new reviews`);
      
      // If no new reviews found, we're done
      if (reviewsToImport.length === 0) {
        this.logger.info(`✅ Incremental sync complete: No new reviews found`);
        return 0;
      }
    }
    
    this.logger.info(`📝 Importing ${reviewsToImport.length} reviews for sync job: ${syncJobId}`);
    
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process in batches for better performance and memory management
    const batchSize = this.config.batchSize;
    
    for (let i = 0; i < reviewsToImport.length; i += batchSize) {
      const batch = reviewsToImport.slice(i, i + batchSize);
      
      // Complete review records for the external_reviews table
      const reviewRecords = batch.map(review => ({
        source: 'tripadvisor',
        external_id: review.review_id || `tripadvisor_${Date.now()}_${Math.random()}`,
        author_name: review.user_profile?.name || 'Anonymous',
        rating: review.rating?.value || 5,
        text: review.review_text || '',
        posted_at: review.timestamp || review.date_of_visit || new Date().toISOString(),
        author_photo_url: (review.user_profile as any)?.photo_url || null,
        place_name: 'Vegas Jeep Tours',
        review_url: review.review_url || null,
        tour_operator_id: '55e41290-65af-4e0e-8d4f-6c058f5e0a0f', // Use the actual user ID
        raw_data: review
      }));
      
      try {
        const { error, count } = await this.supabase
          .from('tripadvisor_reviews')
          .upsert(reviewRecords, { 
            onConflict: 'source,external_id',
            count: 'exact'
          });
        
        if (error) {
          this.logger.error(`❌ Batch import error for sync job ${syncJobId}:`, error);
          errors += batch.length;
        } else {
          const batchImported = count || batch.length;
          imported += batchImported;
          skipped += batch.length - batchImported;
        }
      } catch (error) {
        this.logger.error(`❌ Batch processing error for sync job ${syncJobId}:`, error);
        errors += batch.length;
      }
      
      // Update progress
      const progress = 60 + Math.round(((i + batch.length) / reviewsToImport.length) * 35);
      await this.updateProgress(syncJobId, progress, 'importing_reviews');
      await this.updateSyncJob(syncJobId, { 
        imported_count: imported,
        skipped_count: skipped,
        error_count: errors
      });
      
      this.logger.debug(`📊 Progress: ${imported}/${reviewsToImport.length} imported, ${skipped} skipped, ${errors} errors`);
    }
    
    this.logger.info(`📊 Import completed: ${imported} imported, ${skipped} skipped, ${errors} errors`);
    return imported;
  }
  
  private async updateProgress(syncJobId: string, percentage: number, stage: string): Promise<void> {
    await this.supabase
      .from('review_sync_jobs')
      .update({
        progress_percentage: Math.min(percentage, 100),
        processing_stage: stage,
        updated_at: new Date().toISOString()
      })
      .eq('id', syncJobId);
  }
  
  private async updateSyncJob(syncJobId: string, data: any): Promise<void> {
    await this.supabase
      .from('review_sync_jobs')
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .eq('id', syncJobId);
  }
  
  private async completeJob(syncJobId: string, importedCount: number, totalAvailable: number): Promise<void> {
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
  
  private async failJob(jobId: string, errorMessage: string): Promise<void> {
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

