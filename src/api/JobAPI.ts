import { Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '../utils/Logger';

export class JobAPI {
  private supabase: SupabaseClient;
  private logger = Logger.getInstance();

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // POST /api/jobs/tripadvisor - Create TripAdvisor import job
  public createTripAdvisorJob = async (req: Request, res: Response): Promise<void> => {
    try {
      const { user_id, url, full_history = false, business_name } = req.body;

      // Validate required fields
      if (!user_id || !url) {
        res.status(400).json({
          error: 'Missing required fields: user_id and url are required'
        });
        return;
      }

      // Validate TripAdvisor URL
      if (!url.includes('tripadvisor.com')) {
        res.status(400).json({
          error: 'Invalid URL: Must be a TripAdvisor URL'
        });
        return;
      }

      // Create job in queue
      const jobData = {
        user_id,
        job_type: 'tripadvisor_import',
        priority: 1,
        status: 'pending',
        payload: {
          user_id,
          url,
          full_history,
          business_name
        },
        max_attempts: 3,
        estimated_duration_minutes: 5
      };

      const { data: job, error: jobError } = await this.supabase
        .from('job_queue')
        .insert([jobData])
        .select()
        .single();

      if (jobError) {
        this.logger.error('Failed to create job:', jobError);
        res.status(500).json({
          error: 'Failed to create job',
          details: jobError.message
        });
        return;
      }

      this.logger.info(`📝 Created TripAdvisor job: ${job.id}`);

      res.status(201).json({
        success: true,
        job_id: job.id,
        status: job.status,
        estimated_duration_minutes: job.estimated_duration_minutes,
        message: 'TripAdvisor import job created successfully'
      });

    } catch (error) {
      this.logger.error('Error creating TripAdvisor job:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  // GET /api/jobs/:id/status - Get job status
  public getJobStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const { data: job, error: jobError } = await this.supabase
        .from('job_queue')
        .select('*')
        .eq('id', id)
        .single();

      if (jobError || !job) {
        res.status(404).json({
          error: 'Job not found'
        });
        return;
      }

      // Get sync job details if available
      let syncJob = null;
      if (job.job_type === 'tripadvisor_import') {
        const { data: syncData } = await this.supabase
          .from('review_sync_jobs')
          .select('*')
          .eq('queue_job_id', id)
          .single();
        syncJob = syncData;
      }

      res.json({
        job_id: job.id,
        status: job.status,
        progress: syncJob?.progress_percentage || 0,
        processing_stage: syncJob?.processing_stage || 'queued',
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        error_message: job.error_message,
        worker_id: job.worker_id,
        sync_job: syncJob ? {
          id: syncJob.id,
          platform: syncJob.platform,
          business_name: syncJob.source_business_name,
          total_available: syncJob.total_available,
          imported_count: syncJob.imported_count,
          skipped_count: syncJob.skipped_count,
          error_count: syncJob.error_count
        } : null
      });

    } catch (error) {
      this.logger.error('Error getting job status:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  // GET /api/jobs - List user jobs
  public listUserJobs = async (req: Request, res: Response): Promise<void> => {
    try {
      const { user_id } = req.query;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      if (!user_id) {
        res.status(400).json({
          error: 'Missing required parameter: user_id'
        });
        return;
      }

      const { data: jobs, error: jobsError } = await this.supabase
        .from('job_queue')
        .select('*')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (jobsError) {
        this.logger.error('Error listing jobs:', jobsError);
        res.status(500).json({
          error: 'Failed to retrieve jobs',
          details: jobsError.message
        });
        return;
      }

      res.json({
        jobs: jobs.map(job => ({
          job_id: job.id,
          job_type: job.job_type,
          status: job.status,
          created_at: job.created_at,
          completed_at: job.completed_at,
          error_message: job.error_message
        })),
        total: jobs.length,
        offset,
        limit
      });

    } catch (error) {
      this.logger.error('Error listing user jobs:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  // GET /api/jobs/:id/reviews - Get imported reviews
  public getJobReviews = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;

      // Get sync job ID
      const { data: syncJob, error: syncError } = await this.supabase
        .from('review_sync_jobs')
        .select('id')
        .eq('queue_job_id', id)
        .single();

      if (syncError || !syncJob) {
        res.status(404).json({
          error: 'Job not found or no reviews available'
        });
        return;
      }

      // Get reviews
      const { data: reviews, error: reviewsError } = await this.supabase
        .from('reviews')
        .select('*')
        .eq('job_id', syncJob.id)
        .order('review_date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (reviewsError) {
        this.logger.error('Error retrieving reviews:', reviewsError);
        res.status(500).json({
          error: 'Failed to retrieve reviews',
          details: reviewsError.message
        });
        return;
      }

      res.json({
        job_id: id,
        reviews: reviews || [],
        total: reviews?.length || 0,
        offset,
        limit
      });

    } catch (error) {
      this.logger.error('Error getting job reviews:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

