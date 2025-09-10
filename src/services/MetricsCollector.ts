import { SupabaseClient } from '@supabase/supabase-js';
import { Config } from '../config/Config';
import { Logger } from '../utils/Logger';

interface MetricData {
  metric_name: string;
  metric_value: number;
  metric_unit?: string;
  tags?: Record<string, any>;
}

export class MetricsCollector {
  private config = Config.getInstance();
  private logger = Logger.getInstance();
  private metricsBuffer: MetricData[] = [];
  private flushInterval?: NodeJS.Timeout;
  
  constructor(private supabase: SupabaseClient) {
    this.startPeriodicFlush();
  }
  
  public async recordJobCompletion(jobType: string, durationMs: number): Promise<void> {
    await this.recordMetrics([
      {
        metric_name: 'job_completed',
        metric_value: 1,
        metric_unit: 'count',
        tags: { 
          job_type: jobType,
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      },
      {
        metric_name: 'job_duration',
        metric_value: durationMs,
        metric_unit: 'milliseconds',
        tags: { 
          job_type: jobType,
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      }
    ]);
  }
  
  public async recordJobFailure(jobType: string, errorMessage: string): Promise<void> {
    await this.recordMetrics([
      {
        metric_name: 'job_failed',
        metric_value: 1,
        metric_unit: 'count',
        tags: { 
          job_type: jobType,
          error: errorMessage.substring(0, 100), // Truncate long errors
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      }
    ]);
  }
  
  public async recordApiCall(apiName: string, durationMs: number, success: boolean): Promise<void> {
    await this.recordMetrics([
      {
        metric_name: 'api_call',
        metric_value: 1,
        metric_unit: 'count',
        tags: { 
          api_name: apiName,
          success: success,
          worker_id: this.config.workerId
        }
      },
      {
        metric_name: 'api_duration',
        metric_value: durationMs,
        metric_unit: 'milliseconds',
        tags: { 
          api_name: apiName,
          success: success,
          worker_id: this.config.workerId
        }
      }
    ]);
  }
  
  public async recordReviewsProcessed(count: number, platform: string): Promise<void> {
    await this.recordMetrics([
      {
        metric_name: 'reviews_processed',
        metric_value: count,
        metric_unit: 'count',
        tags: { 
          platform: platform,
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      }
    ]);
  }
  
  public async recordSystemMetrics(): Promise<void> {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    await this.recordMetrics([
      {
        metric_name: 'memory_heap_used',
        metric_value: memoryUsage.heapUsed,
        metric_unit: 'bytes',
        tags: { 
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      },
      {
        metric_name: 'memory_heap_total',
        metric_value: memoryUsage.heapTotal,
        metric_unit: 'bytes',
        tags: { 
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      },
      {
        metric_name: 'memory_rss',
        metric_value: memoryUsage.rss,
        metric_unit: 'bytes',
        tags: { 
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      },
      {
        metric_name: 'cpu_user',
        metric_value: cpuUsage.user,
        metric_unit: 'microseconds',
        tags: { 
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      },
      {
        metric_name: 'cpu_system',
        metric_value: cpuUsage.system,
        metric_unit: 'microseconds',
        tags: { 
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      }
    ]);
  }
  
  public async recordWorkerStatus(status: string, currentJobs: number): Promise<void> {
    await this.recordMetrics([
      {
        metric_name: 'worker_status',
        metric_value: status === 'idle' ? 0 : status === 'busy' ? 1 : -1,
        metric_unit: 'status',
        tags: { 
          status: status,
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      },
      {
        metric_name: 'worker_current_jobs',
        metric_value: currentJobs,
        metric_unit: 'count',
        tags: { 
          worker_id: this.config.workerId,
          hostname: this.config.hostname
        }
      }
    ]);
  }
  
  public async recordQueueDepth(depth: number): Promise<void> {
    await this.recordMetrics([
      {
        metric_name: 'queue_depth',
        metric_value: depth,
        metric_unit: 'count',
        tags: { 
          worker_id: this.config.workerId
        }
      }
    ]);
  }
  
  private async recordMetrics(metrics: MetricData[]): Promise<void> {
    try {
      // Add to buffer for batch processing
      this.metricsBuffer.push(...metrics);
      
      // If buffer is getting large, flush immediately
      if (this.metricsBuffer.length > 100) {
        await this.flushMetrics();
      }
      
    } catch (error) {
      this.logger.error('Failed to record metrics:', error);
    }
  }
  
  private async flushMetrics(): Promise<void> {
    if (this.metricsBuffer.length === 0) {
      return;
    }
    
    const metricsToFlush = [...this.metricsBuffer];
    this.metricsBuffer = [];
    
    try {
      const { error } = await this.supabase
        .from('system_metrics')
        .insert(metricsToFlush);
      
      if (error) {
        this.logger.error('Failed to flush metrics to database:', error);
        // Put metrics back in buffer for retry
        this.metricsBuffer.unshift(...metricsToFlush);
      } else {
        this.logger.debug(`📊 Flushed ${metricsToFlush.length} metrics to database`);
      }
      
    } catch (error) {
      this.logger.error('Error flushing metrics:', error);
      // Put metrics back in buffer for retry
      this.metricsBuffer.unshift(...metricsToFlush);
    }
  }
  
  private startPeriodicFlush(): void {
    // Flush metrics every 30 seconds
    this.flushInterval = setInterval(async () => {
      await this.flushMetrics();
    }, 30000);
    
    // Also record system metrics every minute
    setInterval(async () => {
      await this.recordSystemMetrics();
    }, 60000);
  }
  
  public async stop(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    // Flush any remaining metrics
    await this.flushMetrics();
  }
  
  // Utility methods for common metric patterns
  public async recordTimer<T>(
    metricName: string, 
    operation: () => Promise<T>,
    tags?: Record<string, any>
  ): Promise<T> {
    const startTime = Date.now();
    let success = false;
    
    try {
      const result = await operation();
      success = true;
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      
      await this.recordMetrics([
        {
          metric_name: metricName,
          metric_value: duration,
          metric_unit: 'milliseconds',
          tags: {
            ...tags,
            success: success,
            worker_id: this.config.workerId
          }
        }
      ]);
    }
  }
  
  public async recordCounter(
    metricName: string, 
    value: number = 1,
    tags?: Record<string, any>
  ): Promise<void> {
    await this.recordMetrics([
      {
        metric_name: metricName,
        metric_value: value,
        metric_unit: 'count',
        tags: {
          ...tags,
          worker_id: this.config.workerId
        }
      }
    ]);
  }
  
  public async recordGauge(
    metricName: string, 
    value: number,
    unit: string,
    tags?: Record<string, any>
  ): Promise<void> {
    await this.recordMetrics([
      {
        metric_name: metricName,
        metric_value: value,
        metric_unit: unit,
        tags: {
          ...tags,
          worker_id: this.config.workerId
        }
      }
    ]);
  }
}

