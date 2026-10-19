import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import controller.RateLimiterController;
import service.RateLimiterService;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;

/**
 * Main — Application entry point for RateGuard.
 * Wires together Service and Controller, registers endpoints, and starts HttpServer.
 */
public class Main {
    public static final int PORT = 8080;
    private static final Path FRONTEND_DIR = Path.of("frontend").toAbsolutePath().normalize();

    public static void main(String[] args) throws IOException {
        // 1. Instantiate Service and Controller
        RateLimiterService service = new RateLimiterService();
        RateLimiterController controller = new RateLimiterController(service);

        // 2. Create HTTP server on port 8080
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // 3. Register endpoint contexts
        server.createContext("/api", controller::handleApi);
        server.createContext("/health", controller::handleHealth);
        server.createContext("/", Main::handleStaticFile);

        // 4. Multi-threaded request execution
        server.setExecutor(Executors.newCachedThreadPool());

        // 5. Start the server
        server.start();

        System.out.println("============================================================");
        System.out.println("  RateGuard Server Started Successfully (Port: " + PORT + ")");
        System.out.println("============================================================");
        System.out.println("  Dashboard:  http://localhost:" + PORT + "/");
        System.out.println("  Protected:  GET http://localhost:" + PORT + "/api (Needs 'X-Client-ID')");
        System.out.println("  Health:     GET http://localhost:" + PORT + "/health");
        System.out.println("  Press Ctrl+C to stop.");
        System.out.println("============================================================");
    }

    /**
     * Serves static frontend files (HTML/CSS/JS) for the RateGuard testing playground.
     */
    private static void handleStaticFile(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            exchange.getResponseHeaders().set("Allow", "GET, HEAD");
            byte[] err = "405 Method Not Allowed".getBytes();
            exchange.sendResponseHeaders(405, err.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(err);
            }
            return;
        }

        String reqPath = exchange.getRequestURI().getPath();
        if (reqPath == null || reqPath.isEmpty() || "/".equals(reqPath)) {
            reqPath = "index.html";
        } else if (reqPath.startsWith("/")) {
            reqPath = reqPath.substring(1);
        }

        Path target = FRONTEND_DIR.resolve(reqPath).normalize();

        // Prevent directory traversal attacks
        if (!target.startsWith(FRONTEND_DIR) || Files.isDirectory(target) || !Files.exists(target)) {
            byte[] notFound = "404 Not Found".getBytes();
            exchange.sendResponseHeaders(404, notFound.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(notFound);
            }
            return;
        }

        String mimeType = getMimeType(target.getFileName().toString());
        exchange.getResponseHeaders().set("Content-Type", mimeType);
        long fileSize = Files.size(target);
        exchange.sendResponseHeaders(200, fileSize);

        if ("GET".equalsIgnoreCase(method)) {
            try (OutputStream os = exchange.getResponseBody()) {
                Files.copy(target, os);
            }
        } else {
            exchange.getResponseBody().close();
        }
    }

    private static String getMimeType(String filename) {
        String lower = filename.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=UTF-8";
        if (lower.endsWith(".css")) return "text/css; charset=UTF-8";
        if (lower.endsWith(".js")) return "application/javascript; charset=UTF-8";
        if (lower.endsWith(".json")) return "application/json; charset=UTF-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }
}

