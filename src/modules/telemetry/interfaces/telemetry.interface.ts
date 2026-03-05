export interface TelemetryUpdate {
    deviceId: string;
    timestamp: number;
    metrics: {
        avg: Record<string, number>;
        min: Record<string, number>;
        max: Record<string, number>;
    };
}