export declare class DataForSEOClient {
    private config;
    private logger;
    private client;
    constructor();
    createTask(endpoint: string, payload: any[]): Promise<any>;
    getTaskResult(endpoint: string, taskId: string): Promise<any>;
    private handleApiError;
}
//# sourceMappingURL=DataForSEOClient.d.ts.map