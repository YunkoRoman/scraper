export interface RetryConfig {
  maxRetries: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
}
