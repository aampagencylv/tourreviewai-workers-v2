import axios, { AxiosInstance } from 'axios';
import { Config } from '../config/Config';
import { Logger } from '../utils/Logger';

export class DataForSEOClient {
  private config = Config.getInstance();
  private logger = Logger.getInstance();
  private client: AxiosInstance;

  constructor() {
    const credentials = Buffer.from(
      `${this.config.dataForSeoUsername}:${this.config.dataForSeoPassword}`
    ).toString('base64');

    this.client = axios.create({
      baseURL: 'https://api.dataforseo.com/v3',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      }
    });
  }

  public async createTask(endpoint: string, payload: any[]): Promise<any> {
    try {
      this.logger.debug(`POST /${endpoint}/task_post`, payload);
      const response = await this.client.post(`/${endpoint}/task_post`, payload);
      return response.data;
    } catch (error) {
      this.handleApiError(error);
    }
  }

  public async getTaskResult(endpoint: string, taskId: string): Promise<any> {
    try {
      this.logger.debug(`GET /${endpoint}/task_get/${taskId}`);
      const response = await this.client.get(`/${endpoint}/task_get/${taskId}`);
      return response.data;
    } catch (error) {
      this.handleApiError(error);
    }
  }

  private handleApiError(error: any): never {
    if (axios.isAxiosError(error) && error.response) {
      this.logger.error('DataForSEO API Error:', {
        status: error.response.status,
        data: error.response.data
      });
      throw new Error(`DataForSEO API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else {
      this.logger.error('DataForSEO Request Error:', error);
      throw new Error('DataForSEO request failed');
    }
  }
}

