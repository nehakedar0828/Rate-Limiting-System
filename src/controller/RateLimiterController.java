package controller;

import com.sun.net.httpserver.HttpExchange;
import model.RateLimiterModel.Result;
import service.RateLimiterService;
import view.RateLimiterView;
import java.io.IOException;

/**
 * RateLimiterController — Handles incoming HTTP requests, validates input, and orchestrates Service and View.
 */
public class RateLimiterController {
    private final RateLimiterService service;

    public RateLimiterController(RateLimiterService service) {
        this.service = service;
    }

    /**
     * Handles protected requests to /api.
     */
    public void handleApi(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.getResponseHeaders().set("Allow", "GET");
            RateLimiterView.renderJson(exchange, 405, "{\"status\":\"error\",\"message\":\"Method Not Allowed. Supported method: GET\"}");
            return;
        }

        String clientId = exchange.getRequestHeaders().getFirst("X-Client-ID");
        if (clientId == null || clientId.trim().isEmpty()) {
            RateLimiterView.renderJson(exchange, 400, "{\"status\":\"error\",\"message\":\"Missing or blank X-Client-ID header\"}");
            return;
        }

        clientId = clientId.trim();
        Result result = service.checkAndConsume(clientId);
        RateLimiterView.renderRateLimitResponse(exchange, clientId, result, RateLimiterService.MAX_REQUESTS);
    }

    /**
     * Handles /health requests without consuming quota.
     */
    public void handleHealth(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.getResponseHeaders().set("Allow", "GET");
            RateLimiterView.renderJson(exchange, 405, "{\"status\":\"error\",\"message\":\"Method Not Allowed. Supported method: GET\"}");
            return;
        }

        RateLimiterView.renderJson(exchange, 200, "{\"status\":\"UP\",\"message\":\"RateGuard server is healthy\"}");
    }
}
