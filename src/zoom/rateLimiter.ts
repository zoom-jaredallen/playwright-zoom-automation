/**
 * Token Bucket Rate Limiter — prevents hitting Zoom API rate limits
 * by throttling requests proactively. Respects Retry-After headers
 * and auto-reduces concurrency when approaching limits.
 */

export interface RateLimiterOptions {
  /** Maximum requests per second. Default: 10 (Zoom's typical limit). */
  maxRequestsPerSecond?: number;
  /** Maximum burst size. Default: 30. */
  burstSize?: number;
  /** Global backoff when a 429 is received (ms). Default: respects Retry-After. */
  globalBackoffMs?: number;
}

export interface RateLimiterStats {
  totalRequests: number;
  throttledRequests: number;
  rateLimitHits: number;
  currentTokens: number;
  maxTokens: number;
  globalBackoffUntil?: string;
}

export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms
  private lastRefill: number;
  private globalBackoffUntil = 0;
  private totalRequests = 0;
  private throttledRequests = 0;
  private rateLimitHits = 0;
  private waitQueue: Array<{ resolve: () => void }> = [];
  private refillInterval: ReturnType<typeof setInterval> | undefined;

  constructor(options: RateLimiterOptions = {}) {
    const maxPerSecond = options.maxRequestsPerSecond ?? 10;
    this.maxTokens = options.burstSize ?? maxPerSecond * 3;
    this.tokens = this.maxTokens;
    this.refillRate = maxPerSecond / 1_000; // tokens per ms
    this.lastRefill = Date.now();
  }

  /** Get current rate limiter statistics. */
  getStats(): RateLimiterStats {
    this.refill();
    return {
      totalRequests: this.totalRequests,
      throttledRequests: this.throttledRequests,
      rateLimitHits: this.rateLimitHits,
      currentTokens: Math.floor(this.tokens),
      maxTokens: this.maxTokens,
      globalBackoffUntil: this.globalBackoffUntil > Date.now()
        ? new Date(this.globalBackoffUntil).toISOString()
        : undefined
    };
  }

  /**
   * Acquire a token before making an API request.
   * Resolves when a token is available. May delay if rate limited.
   */
  async acquire(): Promise<void> {
    this.totalRequests += 1;

    // Wait for global backoff if active
    const backoffRemaining = this.globalBackoffUntil - Date.now();
    if (backoffRemaining > 0) {
      this.throttledRequests += 1;
      await sleep(backoffRemaining);
    }

    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // No tokens available — wait for refill
    this.throttledRequests += 1;
    const waitMs = (1 - this.tokens) / this.refillRate;
    await sleep(Math.ceil(waitMs));
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  /**
   * Report a 429 response. Sets global backoff for all requests.
   */
  reportRateLimit(retryAfterMs?: number): void {
    this.rateLimitHits += 1;
    const backoffMs = retryAfterMs ?? 60_000; // Default 60s if no Retry-After
    this.globalBackoffUntil = Date.now() + backoffMs;
    this.tokens = 0; // Drain all tokens
  }

  /**
   * Report a successful response. Useful for adaptive rate limiting.
   */
  reportSuccess(): void {
    // Could implement adaptive rate increase here in the future
  }

  /** Start automatic token refill (for long-running processes). */
  start(): void {
    if (this.refillInterval) return;
    this.refillInterval = setInterval(() => this.refill(), 100);
  }

  /** Stop automatic refill. */
  stop(): void {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = undefined;
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a rate-limited fetch wrapper that automatically throttles
 * and handles 429 responses.
 */
export function createRateLimitedFetch(
  rateLimiter: RateLimiter,
  baseFetch: typeof fetch = fetch
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await rateLimiter.acquire();

    const response = await baseFetch(input, init);

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const retryAfterMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1_000 : undefined;
      rateLimiter.reportRateLimit(retryAfterMs);
    } else if (response.ok) {
      rateLimiter.reportSuccess();
    }

    return response;
  };
}
