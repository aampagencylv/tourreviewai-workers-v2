export declare class HealthServer {
    private app;
    private server?;
    private config;
    private logger;
    private startTime;
    private workerManager?;
    constructor();
    setWorkerManager(workerManager: any): void;
    private setupMiddleware;
    private setupRoutes;
    private handleHealthCheck;
    private handleStatusCheck;
    private handleMetrics;
    private handleWorkerInfo;
    private handleReadyCheck;
    private handleLiveCheck;
    private getHealthStatus;
    private getDetailedStatus;
    private getMetrics;
    private checkDatabaseConnection;
    start(): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=HealthServer.d.ts.map