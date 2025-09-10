import { Logger } from './Logger';

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  retryCondition?: (error: any) => boolean;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalDuration: number;
}

export class RetryManager {
  private logger = Logger.getInstance();
  
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions
  ): Promise<T> {
    const {
      maxAttempts,
      delayMs,
      backoffMultiplier = 2,
      maxDelayMs = 30000,
      retryCondition = () => true
    } = options;
    
    const startTime = Date.now();
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await operation();
        
        if (attempt > 1) {
          this.logger.info(`Operation succeeded on attempt ${attempt}/${maxAttempts}`, {
            attempts: attempt,
            totalDuration: Date.now() - startTime
          });
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        this.logger.warn(`Operation failed on attempt ${attempt}/${maxAttempts}`, {
          error: error instanceof Error ? error.message : error,
          attempt,
          maxAttempts
        });
        
        // Don't retry if this is the last attempt
        if (attempt === maxAttempts) {
          break;
        }
        
        // Don't retry if the error condition says not to
        if (!retryCondition(error)) {
          this.logger.info('Retry condition not met, stopping retries', {
            error: error instanceof Error ? error.message : error
          });
          break;
        }
        
        // Calculate delay with exponential backoff
        const currentDelay = Math.min(
          delayMs * Math.pow(backoffMultiplier, attempt - 1),
          maxDelayMs
        );
        
        this.logger.debug(`Waiting ${currentDelay}ms before retry ${attempt + 1}/${maxAttempts}`);
        
        await this.delay(currentDelay);
      }
    }
    
    // All attempts failed
    const totalDuration = Date.now() - startTime;
    this.logger.error(`Operation failed after ${maxAttempts} attempts`, {
      maxAttempts,
      totalDuration,
      finalError: lastError instanceof Error ? lastError.message : lastError
    });
    
    throw lastError;
  }
  
  public async executeWithRetryAndResult<T>(
    operation: () => Promise<T>,
    options: RetryOptions
  ): Promise<RetryResult<T>> {
    const startTime = Date.now();
    let attempts = 0;
    
    try {
      const result = await this.executeWithRetry(async () => {
        attempts++;
        return await operation();
      }, options);
      
      return {
        result,
        attempts,
        totalDuration: Date.now() - startTime
      };
      
    } catch (error) {
      throw error;
    }
  }
  
  // Specific retry strategies for common scenarios
  
  public async retryDatabaseOperation<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3
  ): Promise<T> {
    return this.executeWithRetry(operation, {
      maxAttempts,
      delayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 10000,
      retryCondition: (error) => {
        // Retry on connection errors, timeouts, but not on data validation errors
        const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        
        return errorMessage.includes('connection') ||
               errorMessage.includes('timeout') ||
               errorMessage.includes('network') ||
               errorMessage.includes('econnreset') ||
               errorMessage.includes('enotfound');
      }
    });
  }
  
  public async retryApiCall<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3
  ): Promise<T> {
    return this.executeWithRetry(operation, {
      maxAttempts,
      delayMs: 2000,
      backoffMultiplier: 2,
      maxDelayMs: 30000,
      retryCondition: (error) => {
        // Retry on 5xx errors, rate limits, and network errors
        if (error.response) {
          const status = error.response.status;
          return status >= 500 || status === 429; // Server errors or rate limit
        }
        
        // Retry on network errors
        const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        return errorMessage.includes('network') ||
               errorMessage.includes('timeout') ||
               errorMessage.includes('econnreset') ||
               errorMessage.includes('enotfound');
      }
    });
  }
  
  public async retryDataForSEOCall<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 5
  ): Promise<T> {
    return this.executeWithRetry(operation, {
      maxAttempts,
      delayMs: 5000, // Start with 5 seconds for DataForSEO
      backoffMultiplier: 1.5, // Gentler backoff for API calls
      maxDelayMs: 60000, // Max 1 minute delay
      retryCondition: (error) => {
        if (error.response) {
          const status = error.response.status;
          
          // Don't retry on authentication errors or bad requests
          if (status === 401 || status === 403 || status === 400) {
            return false;
          }
          
          // Retry on server errors and rate limits
          return status >= 500 || status === 429;
        }
        
        // Retry on network errors
        return true;
      }
    });
  }
  
  // Circuit breaker pattern
  private circuitBreakers = new Map<string, {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
  }>();
  
  public async executeWithCircuitBreaker<T>(
    operationName: string,
    operation: () => Promise<T>,
    options: {
      failureThreshold: number;
      recoveryTimeMs: number;
      retryOptions?: RetryOptions;
    }
  ): Promise<T> {
    const { failureThreshold, recoveryTimeMs, retryOptions } = options;
    
    let breaker = this.circuitBreakers.get(operationName);
    if (!breaker) {
      breaker = { failures: 0, lastFailure: 0, state: 'closed' };
      this.circuitBreakers.set(operationName, breaker);
    }
    
    const now = Date.now();
    
    // Check circuit breaker state
    if (breaker.state === 'open') {
      if (now - breaker.lastFailure > recoveryTimeMs) {
        breaker.state = 'half-open';
        this.logger.info(`Circuit breaker for ${operationName} is now half-open`);
      } else {
        throw new Error(`Circuit breaker for ${operationName} is open`);
      }
    }
    
    try {
      const result = retryOptions 
        ? await this.executeWithRetry(operation, retryOptions)
        : await operation();
      
      // Success - reset circuit breaker
      if (breaker.state === 'half-open') {
        breaker.state = 'closed';
        breaker.failures = 0;
        this.logger.info(`Circuit breaker for ${operationName} is now closed`);
      }
      
      return result;
      
    } catch (error) {
      breaker.failures++;
      breaker.lastFailure = now;
      
      if (breaker.failures >= failureThreshold) {
        breaker.state = 'open';
        this.logger.error(`Circuit breaker for ${operationName} is now open`, {
          failures: breaker.failures,
          threshold: failureThreshold
        });
      }
      
      throw error;
    }
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Utility method to add jitter to delays (helps with thundering herd)
  public addJitter(delayMs: number, jitterPercent: number = 0.1): number {
    const jitter = delayMs * jitterPercent * (Math.random() - 0.5) * 2;
    return Math.max(0, delayMs + jitter);
  }
}

