package view;

import com.sun.net.httpserver.HttpExchange;
import model.RateLimiterModel.Result;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * RateLimiterView — Formats and writes HTTP headers, status codes, and JSON responses.
 */
public class RateLimiterView {

    /**
     * Renders either 200 OK or 429 Too Many Requests based on the rate-limit evaluation.
     */
    public static void renderRateLimitResponse(HttpExchange exchange, String clientId, Result result, int maxLimit) throws IOException {
        exchange.getResponseHeaders().set("X-RateLimit-Limit", String.valueOf(maxLimit));
        exchange.getResponseHeaders().set("X-RateLimit-Remaining", String.valueOf(result.remaining()));

        if (result.allowed()) {
            String json = String.format("{\"status\":\"success\",\"message\":\"Request permitted\",\"clientId\":\"%s\",\"remaining\":%d}",
                    escapeJson(clientId), result.remaining());
            renderJson(exchange, 200, json);
        } else {
            exchange.getResponseHeaders().set("Retry-After", String.valueOf(result.retryAfterSeconds()));
            String json = String.format("{\"status\":\"error\",\"message\":\"Rate limit exceeded. Try again later.\",\"clientId\":\"%s\",\"retryAfterSeconds\":%d}",
                    escapeJson(clientId), result.retryAfterSeconds());
            renderJson(exchange, 429, json);
        }
    }

    /**
     * Sets Content-Type, status code, and writes the JSON response body to the client stream.
     */
    public static void renderJson(HttpExchange exchange, int statusCode, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static String escapeJson(String str) {
        return (str == null) ? "" : str.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
