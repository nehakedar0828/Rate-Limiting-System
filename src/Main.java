import com.sun.net.httpserver.HttpServer;
import controller.RateLimiterController;
import service.RateLimiterService;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;

/**
 * Main — Application entry point for RateGuard.
 * Wires together Service and Controller, registers endpoints, and starts HttpServer.
 */
public class Main {
    public static final int PORT = 8080;

    public static void main(String[] args) throws IOException {
        // 1. Instantiate Service and Controller
        RateLimiterService service = new RateLimiterService();
        RateLimiterController controller = new RateLimiterController(service);

        // 2. Create HTTP server on port 8080
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // 3. Register endpoint contexts
        server.createContext("/api", controller::handleApi);
        server.createContext("/health", controller::handleHealth);

        // 4. Multi-threaded request execution
        server.setExecutor(Executors.newCachedThreadPool());

        // 5. Start the server
        server.start();

        System.out.println("============================================================");
        System.out.println("  RateGuard Server Started Successfully (Port: " + PORT + ")");
        System.out.println("============================================================");
        System.out.println("  Protected:  GET http://localhost:" + PORT + "/api (Needs 'X-Client-ID')");
        System.out.println("  Health:     GET http://localhost:" + PORT + "/health");
        System.out.println("  Press Ctrl+C to stop.");
        System.out.println("============================================================");
    }
}
