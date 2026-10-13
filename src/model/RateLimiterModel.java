package model;

/**
 * RateLimiterModel — Stores rate-limiting state for an individual client.
 */
public class RateLimiterModel {
    public long windowStartNanos;
    public int requestCount;

    public RateLimiterModel(long windowStartNanos, int requestCount) {
        this.windowStartNanos = windowStartNanos;
        this.requestCount = requestCount;
    }

    /**
     * Immutable outcome of a rate-limit evaluation.
     */
    public record Result(boolean allowed, int remaining, long retryAfterSeconds) {}
}
