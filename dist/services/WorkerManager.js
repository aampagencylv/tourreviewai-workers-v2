"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerManager = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const node_cron_1 = __importDefault(require("node-cron"));
const Config_1 = require("../config/Config");
const Logger_1 = require("../utils/Logger");
const JobProcessor_1 = require("./JobProcessor");
const MetricsCollector_1 = require("./MetricsCollector");
class WorkerManager {
    constructor() {
        this.isRunning = false;
        this.currentJobs = new Map();
        this.config = Config_1.Config.getInstance();
        this.logger = Logger_1.Logger.getInstance();
        this.supabase = (0, supabase_js_1.createClient)(this.config.supabaseUrl, this.config.supabaseServiceKey);
        this.jobProcessor = new JobProcessor_1.JobProcessor(this.supabase);
        this.metricsCollector = new MetricsCollector_1.MetricsCollector(this.supabase);
    }
    async start() {
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
        }
        catch (error) {
            this.logger.error('❌ Failed to start Worker Manager:', error);
            throw error;
        }
    }
    async stop() {
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
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Job completion timeout')), 60000))
                ]);
            }
            catch (error) {
                this.logger.warn('⚠️ Some jobs did not complete within timeout');
            }
        }
        // Unregister worker
        await this.unregisterWorker();
        this.logger.info('✅ Worker Manager stopped');
    }
    async registerWorker() {
        const workerData = {
            id: this.config.workerId,
            hostname: this.config.hostname,
            process_id: process.pid,
            version: this.config.workerVersion,
            supported_job_types: ['tripadvisor_import'],
            max_concurrent_jobs: this.config.maxConcurrentJobs,
            current_job_count: 0,
            status: 'idle',
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
    async unregisterWorker() {
        const { error } = await this.supabase
            .from('workers')
            .update({
            status: 'offline',
            current_job_count: 0
        })
            .eq('id', this.config.workerId);
        if (error) {
            this.logger.error('❌ Failed to unregister worker:', error);
        }
        else {
            this.logger.info('📝 Worker unregistered');
        }
    }
    startHeartbeat() {
        this.heartbeatInterval = setInterval(async () => {
            try {
                await this.sendHeartbeat();
            }
            catch (error) {
                this.logger.error('💓 Heartbeat failed:', error);
            }
        }, this.config.heartbeatIntervalSeconds * 1000);
    }
    async sendHeartbeat() {
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
    startJobPolling() {
        this.jobPollingInterval = setInterval(async () => {
            if (this.isRunning && this.canAcceptMoreJobs()) {
                try {
                    await this.pollForJobs();
                }
                catch (error) {
                    this.logger.error('🔍 Job polling failed:', error);
                }
            }
        }, 5000); // Poll every 5 seconds
    }
    canAcceptMoreJobs() {
        return this.currentJobs.size < this.config.maxConcurrentJobs;
    }
    async pollForJobs() {
        const availableSlots = this.config.maxConcurrentJobs - this.currentJobs.size;
        for (let i = 0; i < availableSlots; i++) {
            const job = await this.claimNextJob();
            if (job) {
                this.processJob(job);
            }
            else {
                break; // No more jobs available
            }
        }
    }
    async claimNextJob() {
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
        }
        catch (error) {
            this.logger.error('❌ Failed to claim job:', error);
            return null;
        }
    }
    processJob(job) {
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
    async executeJob(job) {
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
        }
        catch (error) {
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
    async updateJobStatus(jobId, status, additionalData = {}) {
        const updateData = {
            status,
            ...additionalData
        };
        if (status === 'processing') {
            updateData.started_at = new Date().toISOString();
        }
        else if (status === 'completed' || status === 'failed') {
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
    startCleanupTasks() {
        // Release expired job claims every minute
        node_cron_1.default.schedule('* * * * *', async () => {
            try {
                const { data } = await this.supabase.rpc('release_expired_claims');
                if (data && data > 0) {
                    this.logger.info(`🧹 Released ${data} expired job claims`);
                }
            }
            catch (error) {
                this.logger.error('🧹 Cleanup task failed:', error);
            }
        });
        // Clean up old metrics every hour
        node_cron_1.default.schedule('0 * * * *', async () => {
            try {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - 7); // Keep 7 days of metrics
                const { error } = await this.supabase
                    .from('system_metrics')
                    .delete()
                    .lt('recorded_at', cutoffDate.toISOString());
                if (error) {
                    this.logger.error('🧹 Failed to clean up old metrics:', error);
                }
                else {
                    this.logger.debug('🧹 Cleaned up old metrics');
                }
            }
            catch (error) {
                this.logger.error('🧹 Metrics cleanup failed:', error);
            }
        });
    }
    getStatus() {
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
exports.WorkerManager = WorkerManager;
//# sourceMappingURL=WorkerManager.js.map