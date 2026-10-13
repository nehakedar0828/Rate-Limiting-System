import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * RateGuard — Real-Time API Rate Limiter in Pure Java.
 *
 * Implements a thread-safe Fixed Window Counter rate-limiting algorithm
 * using Core Java (Java 17+) and com.sun.net.httpserver.HttpServer.
 */
public class RateGuard {

    // ==========================================
    // Configuration Constants
    // ==========================================
    public static final int PORT = 8080;
    public static final int MAX_REQUESTS = 5;
    public static final long WINDOW_DURATION_SECONDS = 10;
    private static final long WINDOW_DURATION_NANOS = TimeUnit.SECONDS.toNanos(WINDOW_DURATION_SECONDS);

    // Rate Limiter Instance
    private static final FixedWindowRateLimiter rateLimiter = new FixedWindowRateLimiter(MAX_REQUESTS, WINDOW_DURATION_NANOS);

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // Register endpoints
        server.createContext("/api", RateGuard::handleApi);
        server.createContext("/health", RateGuard::handleHealth);
        server.createContext("/", RateGuard::handleRoot);

        // Concurrent request handling
        server.setExecutor(Executors.newCachedThreadPool());

        // Graceful shutdown hook
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log("INFO", "Shutting down RateGuard server...");
            server.stop(1);
            log("INFO", "Server stopped.");
        }));

        server.start();

        System.out.println("============================================================");
        System.out.println("  RateGuard — Real-Time API Rate Limiter (Core Java)");
        System.out.println("============================================================");
        System.out.printf("  Listening on:     http://localhost:%d%n", PORT);
        System.out.printf("  Max Requests:     %d per %d seconds%n", MAX_REQUESTS, WINDOW_DURATION_SECONDS);
        System.out.println("  Protected Path:   GET /api (Requires 'X-Client-ID' header)");
        System.out.println("  Health Check:     GET /health");
        System.out.println("  Press Ctrl+C to stop.");
        System.out.println("============================================================");
    }

    // ==========================================
    // HTTP Handlers
    // ==========================================

    /**
     * Handles requests to /api (subject to rate limiting).
     */
    private static void handleApi(HttpExchange exchange) throws IOException {
        // Enforce HTTP GET method
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.getResponseHeaders().set("Allow", "GET");
            sendJsonResponse(exchange, 405, "{\"status\":\"error\",\"message\":\"Method Not Allowed. Supported method: GET\"}");
            log("WARN", exchange.getRequestMethod() + " /api - 405 Method Not Allowed");
            return;
        }

        // Validate X-Client-ID header
        String clientId = exchange.getRequestHeaders().getFirst("X-Client-ID");
        if (clientId == null || clientId.trim().isEmpty()) {
            sendJsonResponse(exchange, 400, "{\"status\":\"error\",\"message\":\"Missing or blank X-Client-ID header\"}");
            log("WARN", "GET /api - 400 Bad Request (Missing or blank X-Client-ID)");
            return;
        }

        clientId = clientId.trim();

        // Evaluate rate limit for the client
        RateLimitResult result = rateLimiter.checkAndConsume(clientId);

        // Populate rate limit headers
        exchange.getResponseHeaders().set("X-RateLimit-Limit", String.valueOf(MAX_REQUESTS));
        exchange.getResponseHeaders().set("X-RateLimit-Remaining", String.valueOf(result.remaining()));

        if (!result.allowed()) {
            exchange.getResponseHeaders().set("Retry-After", String.valueOf(result.retryAfterSeconds()));
            String body = String.format(
                "{\"status\":\"error\",\"message\":\"Rate limit exceeded. Try again later.\",\"clientId\":\"%s\",\"retryAfterSeconds\":%d}",
                escapeJson(clientId), result.retryAfterSeconds()
            );
            sendJsonResponse(exchange, 429, body);
            log("WARN", String.format("GET /api - Client: '%s' - 429 Too Many Requests (Retry-After: %ds)",
                sanitizeForLog(clientId), result.retryAfterSeconds()));
        } else {
            String body = String.format(
                "{\"status\":\"success\",\"message\":\"Request permitted\",\"clientId\":\"%s\",\"remaining\":%d}",
                escapeJson(clientId), result.remaining()
            );
            sendJsonResponse(exchange, 200, body);
            log("INFO", String.format("GET /api - Client: '%s' - 200 OK (Remaining: %d/%d)",
                sanitizeForLog(clientId), result.remaining(), MAX_REQUESTS));
        }
    }

    /**
     * Handles requests to /health (quota-free health check).
     */
    private static void handleHealth(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.getResponseHeaders().set("Allow", "GET");
            sendJsonResponse(exchange, 405, "{\"status\":\"error\",\"message\":\"Method Not Allowed. Supported method: GET\"}");
            log("WARN", exchange.getRequestMethod() + " /health - 405 Method Not Allowed");
            return;
        }

        String body = "{\"status\":\"UP\",\"message\":\"RateGuard server is healthy\"}";
        sendJsonResponse(exchange, 200, body);
        log("INFO", "GET /health - 200 OK");
    }

    /**
     * Handles fallback paths.
     */
    private static void handleRoot(HttpExchange exchange) throws IOException {
        if ("/".equals(exchange.getRequestURI().getPath())) {
            sendJsonResponse(exchange, 200, "{\"status\":\"success\",\"message\":\"RateGuard server is running. Endpoints: /api, /health\"}");
        } else {
            sendJsonResponse(exchange, 404, "{\"status\":\"error\",\"message\":\"Endpoint not found\"}");
        }
    }

    // ==========================================
    // HTTP & JSON Helpers
    // ==========================================

    private static void sendJsonResponse(HttpExchange exchange, int statusCode, String responseJson) throws IOException {
        byte[] responseBytes = responseJson.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.sendResponseHeaders(statusCode, responseBytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(responseBytes);
        }
    }

    private static String escapeJson(String input) {
        if (input == null) return "";
        return input.replace("\\", "\\\\")
                    .replace("\"", "\\\"")
                    .replace("\b", "\\b")
                    .replace("\f", "\\f")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r")
                    .replace("\t", "\\t");
    }

    private static String sanitizeForLog(String input) {
        if (input == null) return "null";
        return input.replaceAll("[\\r\\n\\t]", "_");
    }

    private static void log(String level, String message) {
        System.out.printf("[%s] [%s] %s%n", Instant.now(), level, message);
    }

    // ==========================================
    // Rate Limiting Algorithm & State
    // ==========================================

    /**
     * Tracks the fixed window start timestamp and request count for a client.
     */
    static class ClientRequestState {
        long windowStartNanos;
        int requestCount;

        ClientRequestState(long windowStartNanos, int requestCount) {
            this.windowStartNanos = windowStartNanos;
            this.requestCount = requestCount;
        }
    }

    /**
     * Represents the outcome of a rate check.
     */
    record RateLimitResult(boolean allowed, int remaining, long retryAfterSeconds) {}

    /**
     * Thread-safe Fixed Window Counter rate limiter.
     */
    static class FixedWindowRateLimiter {
        private final int maxRequests;
        private final long windowDurationNanos;
        private final ConcurrentHashMap<String, ClientRequestState> clientStates = new ConcurrentHashMap<>();

        public FixedWindowRateLimiter(int maxRequests, long windowDurationNanos) {
            this.maxRequests = maxRequests;
            this.windowDurationNanos = windowDurationNanos;
        }

        /**
         * Evaluates whether a request from the given client is allowed.
         * Atomically updates the client state.
         */
        public RateLimitResult checkAndConsume(String clientId) {
            long now = System.nanoTime();
            RateLimitResult[] resultHolder = new RateLimitResult[1];

            // Atomic compute per client ID: prevents race conditions while avoiding global locks
            clientStates.compute(clientId, (id, state) -> {
                // If client has no previous state or the current window has expired, start a new window
                if (state == null || (now - state.windowStartNanos) >= windowDurationNanos) {
                    state = new ClientRequestState(now, 1);
                    int remaining = Math.max(0, maxRequests - 1);
                    resultHolder[0] = new RateLimitResult(true, remaining, 0);
                    return state;
                }

                // Window is still active: check quota
                if (state.requestCount >= maxRequests) {
                    // Quota exceeded: calculate remaining seconds in window (ceiling division, minimum 1s)
                    long elapsedNanos = now - state.windowStartNanos;
                    long remainingNanos = windowDurationNanos - elapsedNanos;
                    long retryAfterSeconds = Math.max(1, (remainingNanos + 999_999_999L) / 1_000_000_000L);
                    resultHolder[0] = new RateLimitResult(false, 0, retryAfterSeconds);
                    return state; // Counter is not incremented on rejected request
                } else {
                    // Quota available: increment count and allow request
                    state.requestCount++;
                    int remaining = maxRequests - state.requestCount;
                    resultHolder[0] = new RateLimitResult(true, remaining, 0);
                    return state;
                }
            });

            return resultHolder[0];
        }
    }
}
