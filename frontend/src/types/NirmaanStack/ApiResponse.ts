export interface ApiResponse {
    message: {
        status: number;
        message?: string; // Success message
        error?: string; // Error message
    }
}