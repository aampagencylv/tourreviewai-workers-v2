import { createClient, SupabaseClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import { Config, WorkerConfig } from '../config/Config';
import { Logger } from '../utils/Logger';
import { JobProcessor } from './JobProcessor';
import { MetricsCollector } from './MetricsCollector';

interface Job {
  id: string;
  job_type: string;
  payload: any;
  priority: number;
}

interface WorkerStatus {
  id: string;
  hostname: string;
  status: 'idle' | 'busy' | 'offline';
  current_job_count: number;
  max_concurrent_jobs: number;
  last_heartbeat: string;
}

export class WorkerManager {
  private config: WorkerConfig;
  private logger: Logger;
  private supabase: SupabaseClient;
  private jobProcessor: JobProcessor;
  private metricsCollector: MetricsCollector;
  
  private isRunning = false;
  private currentJobs = new Map<string, Promise<void>>();
  private heartbeatInterval?: NodeJS.Timeout;
  private jobPollingInterval?: NodeJS.Timeout;
  
  constructor() {
    this.config = Config.getInstance();
    this.logger = Logger.getInstance();
    
    this.supabase = createClient(
      this.config.supabaseUrl,
      this.config.supabaseServiceKey
    );
    
    this.jobProcessor = new JobProcessor(this.supabase);
    this.metricsCollector = new MetricsCollector(this.supabase);
  }
  
  public async start(): Promise<void> {
    this.logger.info('🔄 Starting Worker Manager');
    
    try {
      // Register worker
      await this.registerWorker();
      
      // Start heartbeat
      this.startHeartbeat();
      
      // Start job polling
      this.startJobPolling();
      
      // Start cleanup tasks
      this.startCleanupTasks();
      
      this.isRunning = true;
      this.logger.info(`✅ Worker Manager started (ID: ${this.config.workerId})`);
      
    } catch (error) {
      this.logger.error('❌ Failed to start Worker Manager:', error);
      throw error;
    }
  }
  
  public async stop(): Promise<void> {
    this.logger.info('🛑 Stopping Worker Manager');
    
    this.isRunning = false;
    
    // Stop intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.jobPollingInterval) {
      clearInterval(this.jobPollingInterval);
    }
    
    // Wait for current jobs to complete (with timeout)
    const jobPromises = Array.from(this.currentJobs.values());
    if (jobPromises.length > 0) {
      this.logger.info(`⏳ Waiting for ${jobPromises.length} jobs to complete...`);
      
      try {
        await Promise.race([
          Promise.all(jobPromises),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Job completion timeout')), 60000)
          )
        ]);
      } catch (error) {
        this.logger.warn('⚠️ Some jobs did not complete within timeout');
      }
    }
    
    // Unregister worker
    await this.unregisterWorker();
    
    this.logger.info('✅ Worker Manager stopped');
  }
  
  private async registerWorker(): Promise<void> {
    const workerData = {
      id: this.config.workerId,
      hostname: this.config.hostname,
      process_id: process.pid,
      version: this.config.workerVersion,
      supported_job_types: ['tripadvisor_import'],
      max_concurrent_jobs: this.config.maxConcurrentJobs,
      current_job_count: 0,
      status: 'idle' as const,
      last_heartbeat: new Date().toISOString(),
      registered_at: new Date().toISOString()
    };
    
    const { error } = await this.supabase
      .from('workers')
      .upsert(workerData);
    
    if (error) {
      throw new Error(`Failed to register worker: ${error.message}`);
    }
    
    this.logger.info(`📝 Worker registered: ${this.config.workerId}`);
  }
  
  private async unregisterWorker(): Promise<void> {
    const { error } = await this.supabase
      .from('workers')
      .update({ 
        status: 'offline',
        current_job_count: 0
      })
      .eq('id', this.config.workerId);
    
    if (error) {
      this.logger.error('❌ Failed to unregister worker:', error);
    } else {
      this.logger.info('📝 Worker unregistered');
    }
  }
  
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeat();
      } catch (error) {
        this.logger.error('💓 Heartbeat failed:', error);
      }
    }, this.config.heartbeatIntervalSeconds * 1000);
  }
  
  private async sendHeartbeat(): Promise<void> {
    const { error } = await this.supabase
      .from('workers')
      .update({
        last_heartbeat: new Date().toISOString(),
        current_job_count: this.currentJobs.size,
        status: this.currentJobs.size > 0 ? 'busy' : 'idle'
      })
      .eq('id', this.config.workerId);
    
    if (error) {
      throw new Error(`Heartbeat failed: ${error.message}`);
    }
    
    this.logger.debug(`💓 Heartbeat sent (${this.currentJobs.size} active jobs)`);
  }
  
  private startJobPolling(): void {
    this.jobPollingInterval = setInterval(async () => {
      if (this.isRunning && this.canAcceptMoreJobs()) {
        try {
          await this.pollForJobs();
        } catch (error) {
          this.logger.error('🔍 Job polling failed:', error);
        }
      }
    }, 5000); // Poll every 5 seconds
  }
  
  private canAcceptMoreJobs(): boolean {
    return this.currentJobs.size < this.config.maxConcurrentJobs;
  }
  
  private async pollForJobs(): Promise<void> {
    const availableSlots = this.config.maxConcurrentJobs - this.currentJobs.size;
    
    for (let i = 0; i < availableSlots; i++) {
      const job = await this.claimNextJob();
      if (job) {
        this.processJob(job);
      } else {
        break; // No more jobs available
      }
    }
  }
  
  private async claimNextJob(): Promise<Job | null> {
    try {
      const { data, error } = await this.supabase
        .rpc('claim_next_job', {
          worker_id_param: this.config.workerId,
          supported_job_types_param: ['tripadvisor_import'],
          claim_duration_minutes: this.config.jobClaimDurationMinutes
        });
      
      if (error) {
        throw new Error(`Failed to claim job: ${error.message}`);
      }
      
      if (data && data.length > 0) {
        const job = data[0];
        this.logger.info(`🎯 Claimed job: ${job.job_id} (${job.job_type})`);
        return {
          id: job.job_id,
          job_type: job.job_type,
          payload: job.payload,
          priority: job.priority
        };
      }
      
      return null;
    } catch (error) {
      this.logger.error('❌ Failed to claim job:', error);
      return null;
    }
  }
  
  private processJob(job: Job): void {
    const jobPromise = this.executeJob(job)
      .catch(error => {
        this.logger.error(`❌ Job ${job.id} failed:`, error);
      })
      .finally(() => {
        this.currentJobs.delete(job.id);
        this.logger.debug(`🏁 Job ${job.id} completed, ${this.currentJobs.size} jobs remaining`);
      });
    
    this.currentJobs.set(job.id, jobPromise);
    this.logger.info(`🚀 Started processing job: ${job.id} (${this.currentJobs.size}/${this.config.maxConcurrentJobs})`);
  }
  
  private async executeJob(job: Job): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Update job status to processing
      await this.updateJobStatus(job.id, 'processing');
      
      // Process the job based on type
      switch (job.job_type) {
        case 'tripadvisor_import':
          await this.jobProcessor.processTripAdvisorImport(job.id, job.payload);
          break;
        default:
          throw new Error(`Unsupported job type: ${job.job_type}`);
      }
      
      // Mark job as completed
      await this.updateJobStatus(job.id, 'completed', {
        actual_duration_seconds: Math.round((Date.now() - startTime) / 1000)
      });
      
      // Record metrics
      await this.metricsCollector.recordJobCompletion(job.job_type, Date.now() - startTime);
      
      this.logger.info(`✅ Job ${job.id} completed successfully`);
      
    } catch (error) {
      // Mark job as failed
      await this.updateJobStatus(job.id, 'failed', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        error_details: { error: error instanceof Error ? error.stack : error }
      });
      
      // Record metrics
      await this.metricsCollector.recordJobFailure(job.job_type, error instanceof Error ? error.message : 'Unknown error');
      
      throw error;
    }
  }
  
  private async updateJobStatus(jobId: string, status: string, additionalData: any = {}): Promise<void> {
    const updateData = {
      status,
      ...additionalData
    };
    
    if (status === 'processing') {
      updateData.started_at = new Date().toISOString();
    } else if (status === 'completed' || status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }
    
    const { error } = await this.supabase
      .from('job_queue')
      .update(updateData)
      .eq('id', jobId);
    
    if (error) {
      this.logger.error(`❌ Failed to update job ${jobId} status to ${status}:`, error);
    }
  }
  
  private startCleanupTasks(): void {
    // Release expired job claims every minute
    cron.schedule('* * * * *', async () => {
      try {
        const { data } = await this.supabase.rpc('release_expired_claims');
        if (data && data > 0) {
          this.logger.info(`🧹 Released ${data} expired job claims`);
        }
      } catch (error) {
        this.logger.error('🧹 Cleanup task failed:', error);
      }
    });
    
    // Clean up old metrics every hour
    cron.schedule('0 * * * *', async () => {
      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 7); // Keep 7 days of metrics
        
        const { error } = await this.supabase
          .from('system_metrics')
          .delete()
          .lt('recorded_at', cutoffDate.toISOString());
        
        if (error) {
          this.logger.error('🧹 Failed to clean up old metrics:', error);
        } else {
          this.logger.debug('🧹 Cleaned up old metrics');
        }
      } catch (error) {
        this.logger.error('🧹 Metrics cleanup failed:', error);
      }
    });
  }
  
  public getStatus(): WorkerStatus {
    return {
      id: this.config.workerId,
      hostname: this.config.hostname,
      status: this.currentJobs.size > 0 ? 'busy' : 'idle',
      current_job_count: this.currentJobs.size,
      max_concurrent_jobs: this.config.maxConcurrentJobs,
      last_heartbeat: new Date().toISOString()
    };
  }
}

