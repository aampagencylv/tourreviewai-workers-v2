"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataForSEOClient = void 0;
const axios_1 = __importDefault(require("axios"));
const Config_1 = require("../config/Config");
const Logger_1 = require("../utils/Logger");
class DataForSEOClient {
    constructor() {
        this.config = Config_1.Config.getInstance();
        this.logger = Logger_1.Logger.getInstance();
        const credentials = Buffer.from(`${this.config.dataForSeoUsername}:${this.config.dataForSeoPassword}`).toString('base64');
        this.client = axios_1.default.create({
            baseURL: 'https://api.dataforseo.com/v3',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json'
            }
        });
    }
    async createTask(endpoint, payload) {
        try {
            this.logger.debug(`POST /${endpoint}/task_post`, payload);
            const response = await this.client.post(`/${endpoint}/task_post`, payload);
            return response.data;
        }
        catch (error) {
            this.handleApiError(error);
        }
    }
    async getTaskResult(endpoint, taskId) {
        try {
            this.logger.debug(`GET /${endpoint}/task_get/${taskId}`);
            const response = await this.client.get(`/${endpoint}/task_get/${taskId}`);
            return response.data;
        }
        catch (error) {
            this.handleApiError(error);
        }
    }
    handleApiError(error) {
        if (axios_1.default.isAxiosError(error) && error.response) {
            this.logger.error('DataForSEO API Error:', {
                status: error.response.status,
                data: error.response.data
            });
            throw new Error(`DataForSEO API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        }
        else {
            this.logger.error('DataForSEO Request Error:', error);
            throw new Error('DataForSEO request failed');
        }
    }
}
exports.DataForSEOClient = DataForSEOClient;
//# sourceMappingURL=DataForSEOClient.js.map