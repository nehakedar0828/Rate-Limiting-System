package service;

import model.RateLimiterModel;
import model.RateLimiterModel.Result;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * RateLimiterService — Implements thread-safe Fixed Window Counter logic.
 */
public class RateLimiterService {
    public static final int MAX_REQUESTS = 5;
    public static final long WINDOW_SECONDS = 10;
    private static final long WINDOW_NANOS = TimeUnit.SECONDS.toNanos(WINDOW_SECONDS);

    private final ConcurrentHashMap<String, RateLimiterModel> clientMap = new ConcurrentHashMap<>();

    /**
     * Atomically checks quota and records a request for the given clientId.
     */
    public Result checkAndConsume(String clientId) {
        long now = System.nanoTime();
        Result[] resultHolder = new Result[1];

        // compute() locks only the specific client's bucket, guaranteeing thread safety
        clientMap.compute(clientId, (id, state) -> {
            // Case 1: First request from client, or previous window has expired
            if (state == null || (now - state.windowStartNanos) >= WINDOW_NANOS) {
                state = new RateLimiterModel(now, 1);
                resultHolder[0] = new Result(true, MAX_REQUESTS - 1, 0);
                return state;
            }

            // Case 2: Window still active, but limit already reached
            if (state.requestCount >= MAX_REQUESTS) {
                long elapsed = now - state.windowStartNanos;
                long remainingNanos = WINDOW_NANOS - elapsed;
                long retryAfter = Math.max(1, (remainingNanos + 999_999_999L) / 1_000_000_000L);
                resultHolder[0] = new Result(false, 0, retryAfter);
                return state;
            }

            // Case 3: Window still active and quota available
            state.requestCount++;
            int remaining = MAX_REQUESTS - state.requestCount;
            resultHolder[0] = new Result(true, remaining, 0);
            return state;
        });

        return resultHolder[0];
    }
}
