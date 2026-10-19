# RateGuard — Real-Time API Rate Limiter in Pure Java

A lightweight, zero-dependency, real-time HTTP API rate limiter built entirely with **Core Java (Java 17+)**. RateGuard demonstrates backend infrastructure engineering principles including socket-level HTTP processing, thread-safe data structures, monotonic clock timekeeping, and API protection algorithms.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [Technology Stack](#technology-stack)
4. [Architecture & Request Flow](#architecture--request-flow)
5. [Rate-Limiting Algorithm](#rate-limiting-algorithm)
   - [Fixed Window Counter Explained](#fixed-window-counter-explained)
   - [Fixed Window vs. Token Bucket](#fixed-window-vs-token-bucket)
   - [The Window Boundary Burst Phenomenon](#the-window-boundary-burst-phenomenon)
6. [Project Structure](#project-structure)
7. [Prerequisites](#prerequisites)
8. [Installation and Execution](#installation-and-execution)
9. [API Documentation](#api-documentation)
10. [Testing with curl](#testing-with-curl)
11. [Web-Based Testing Dashboard (RateGuard Playground)](#web-based-testing-dashboard-rateguard-playground)
12. [Sample HTTP Responses](#sample-http-responses)
13. [Configuration](#configuration)
14. [Limitations](#limitations)
15. [Future Enhancements](#future-enhancements)
16. [Learning Outcomes](#learning-outcomes)

---

## Project Overview

Rate limiting is a fundamental defense mechanism in production backend systems. Without rate limiting, public and private APIs are vulnerable to:
- **Denial of Service (DoS) and Brute-Force Attacks**: Malicious actors overwhelming server resources.
- **Cascading Failures**: Upstream traffic spikes bringing down downstream databases and microservices.
- **Resource Exhaustion**: Unfair resource monopolization by a single heavy consumer ("noisy neighbor" problem).

**RateGuard** acts as an inline API guardian. It spins up an embedded HTTP server, intercepts incoming client requests, identifies each client through their `X-Client-ID` header, maintains an independent request counter, and enforces a strict request budget within defined time windows.

---

## Features

- **Embedded HTTP Server**: Built using Java's native `com.sun.net.httpserver.HttpServer`.
- **Per-Client Quota Isolation**: Independent tracking and limits per client identifier (`X-Client-ID`).
- **Fixed Window Counter Algorithm**: Strict evaluation of quotas within discrete time windows.
- **Clock-Skew Immunity**: Time elapsed is measured using `System.nanoTime()`, protecting against system clock resets, NTP adjustments, and leap seconds.
- **Thread Safety & High Concurrency**: Employs fine-grained lock striping via `ConcurrentHashMap.compute()`. Threads for different clients run completely in parallel, while concurrent requests for the same client are processed atomically without global locks.
- **Informative RFC-Compliant HTTP Headers**:
  - `X-RateLimit-Limit`: Maximum requests permitted per window.
  - `X-RateLimit-Remaining`: Number of requests remaining in the current window.
  - `Retry-After`: Approximate seconds until the rate limit resets (included on `429 Too Many Requests`).
- **Standard HTTP Status Codes**:
  - `200 OK`: Request allowed.
  - `400 Bad Request`: Missing or blank `X-Client-ID` header.
  - `405 Method Not Allowed`: Unsupported HTTP verb.
  - `429 Too Many Requests`: Rate limit exceeded.
- **Zero External Dependencies**: No Spring Boot, no Netty, no Guava, no Redis, and no external build tools required.

---

## Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **Language** | Java 17+ (Java 23 verified) | Modern Core Java features (`record`, type inference). |
| **HTTP Server** | `com.sun.net.httpserver.HttpServer` | Built-in lightweight standard Java HTTP runtime. |
| **Concurrency** | `java.util.concurrent.ConcurrentHashMap`, `Executors.newCachedThreadPool()` | Non-blocking multi-threaded request processing with key-scoped atomicity. |
| **Time Tracking** | `System.nanoTime()` / `TimeUnit` | Monotonic time source unaffected by wall-clock drift. |
| **Client Testing** | `curl` / PowerShell / Postman | Standard terminal utilities for testing HTTP endpoints. |
| **Dependencies** | **None (Pure Core Java)** | Self-contained, portable, and runnable with standard JDK tools. |

> **Note**: There is strictly **no Spring Boot** and **no third-party dependency** in this project.

---

## Architecture & Request Flow

RateGuard uses a pipeline model where each incoming connection is dispatched to worker threads managed by a cached thread pool:

```text
[Client / curl]
       │
       ▼ (HTTP Request to localhost:8080)
┌────────────────────────────────────────────────────────┐
│  HttpServer (com.sun.net.httpserver)                  │
│  - Routes request by path (/api, /health, /)          │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  Method & Header Validation                            │
│  - Method check (Enforces GET, returns 405 on others) │
│  - Header check (Validates X-Client-ID, returns 400)   │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  FixedWindowRateLimiter                                │
│  - Lookup ClientRequestState in ConcurrentHashMap     │
│  - Atomic check via ConcurrentHashMap.compute():       │
│    * Elapsed >= WindowDuration ? Reset window & count  │
│    * Count < MaxRequests ? Increment & Permit (200)   │
│    * Count >= MaxRequests ? Reject & Calculate (429)   │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  HTTP Response Formulation                             │
│  - Set X-RateLimit-Limit & X-RateLimit-Remaining       │
│  - Set Retry-After (if 429)                            │
│  - Write UTF-8 JSON response body & close stream       │
└────────────────────────────────────────────────────────┘
```

---

## Rate-Limiting Algorithm

### Fixed Window Counter Explained

The Fixed Window Counter algorithm divides continuous time into non-overlapping, discrete windows of duration $T$ (e.g., 10 seconds). Each client starts with a counter $C = 0$.

For every request received from client $K$ at monotonic timestamp $t_{now}$:

1. **Header Validation**: Check for `X-Client-ID`. If absent or blank, reject with `400 Bad Request`.
2. **Retrieve / Initialize State**:
   - If no record exists for $K$, initialize $windowStart = t_{now}$ and $count = 1$. The request is **permitted** (`200 OK`).
3. **Window Expiration Check**:
   - If $(t_{now} - windowStart) \ge windowDuration$, the previous window has elapsed. Reset $windowStart = t_{now}$ and $count = 1$. The request is **permitted** (`200 OK`).
4. **Quota Evaluation**:
   - If $(t_{now} - windowStart) < windowDuration$:
     - If $count < maxRequests$: Increment $count \leftarrow count + 1$. The request is **permitted** (`200 OK`).
     - If $count \ge maxRequests$: Counter remains unchanged. Calculate:
       $$\text{retryAfterSeconds} = \max\left(1, \left\lceil \frac{windowDuration - (t_{now} - windowStart)}{10^9} \right\rceil\right)$$
       The request is **rejected** (`429 Too Many Requests`).

#### Example Execution (Limit: 5 requests / 10s)

| Request # | Client | Arrival Time | Window Start | Current Count | Result | HTTP Code | Remaining | Retry-After |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `alice` | 0.0s | 0.0s | 1 | Permitted | `200 OK` | 4 | — |
| 2 | `alice` | 1.2s | 0.0s | 2 | Permitted | `200 OK` | 3 | — |
| 3 | `alice` | 2.5s | 0.0s | 3 | Permitted | `200 OK` | 2 | — |
| 4 | `alice` | 3.1s | 0.0s | 4 | Permitted | `200 OK` | 1 | — |
| 5 | `alice` | 4.0s | 0.0s | 5 | Permitted | `200 OK` | 0 | — |
| 6 | `alice` | 4.8s | 0.0s | 5 | **Rejected** | `429 Too Many` | 0 | 6s |
| 7 | `bob` | 5.0s | 5.0s | 1 | Permitted | `200 OK` | 4 | — |
| 8 | `alice` | 10.2s | 10.2s | 1 | Permitted (Reset)| `200 OK` | 4 | — |

---

### Fixed Window vs. Token Bucket

| Dimension | Fixed Window Counter | Token Bucket |
|---|---|---|
| **Mechanism** | Counts events in discrete time slots ($[0, 10), [10, 20)$). | A bucket continuously fills with tokens at rate $r$ up to capacity $C$. Each request consumes 1 token. |
| **Memory Footprint** | Extremely low ($O(1)$ per active client: 1 timestamp + 1 integer). | Low ($O(1)$ per active client: 1 timestamp + 1 double/integer). |
| **Computational Overhead** | Simple integer comparison and addition. | Floating point or timestamp multiplication/division per request. |
| **Traffic Smoothing** | Prone to boundary bursts (traffic spikes near window edges). | Smooths traffic while permitting controlled bursts up to bucket capacity. |
| **Implementation Complexity** | Simple, intuitive, and easy to explain. | Moderately complex (requires token refill logic). |

---

### The Window Boundary Burst Phenomenon

A classic limitation of the Fixed Window Counter algorithm is the **Window Boundary Burst** (or edge-case burst). 

Consider a configuration of **5 requests per 10-second window**:
- Window 1 runs from $t = 0\text{s}$ to $t = 10\text{s}$.
- Window 2 runs from $t = 10\text{s}$ to $t = 20\text{s}$.

A client can send:
- **5 requests** at $t = 9.8\text{s}$ (the end of Window 1) $\rightarrow$ all 5 allowed.
- **5 requests** at $t = 10.1\text{s}$ (the beginning of Window 2) $\rightarrow$ all 5 allowed.

As a result, the server processes **10 requests within a 0.3-second interval**—twice the configured rate of 5 requests per 10 seconds! 

In production systems where this burst profile is problematic, **Sliding Window Log**, **Sliding Window Counter**, or **Token Bucket** algorithms are used to smooth traffic across rolling intervals.

---

## Project Structure

RateGuard is organized into a clean **Controller–Service–Model–View (CSMV)** architecture with an isolated web frontend:

```text
RateGuard/
├── frontend/
│   ├── index.html                     # Responsive testing playground dashboard
│   ├── style.css                      # Modern developer dark theme & animations
│   └── script.js                      # Vanilla JavaScript dispatcher & live inspector
├── src/
│   ├── model/
│   │   └── RateLimiterModel.java      # Client rate-limit state & evaluation record (19 lines)
│   ├── service/
│   │   └── RateLimiterService.java    # Fixed Window algorithm & thread-safe map (52 lines)
│   ├── view/
│   │   └── RateLimiterView.java       # HTTP headers, status codes & JSON rendering (48 lines)
│   ├── controller/
│   │   └── RateLimiterController.java # Request routing & header validation (52 lines)
│   └── Main.java                      # Server startup, static file serving & context wiring (100 lines)
├── README.md                          # Complete project documentation and guide
└── .gitignore                         # Build and IDE artifact ignore rules
```

---

## Prerequisites

- **Java Development Kit (JDK)**: Version 17 or higher (Java 21 or Java 23 recommended).
- Verify your installed JDK:

```bash
java -version
javac -version
```

Expected output:
```text
java version "17.x.x" (or 21.x / 23.x)
javac 17.x.x (or 21.x / 23.x)
```

---

## Installation and Execution

### 1. Compile the Layered Application

From the project root directory:

```powershell
javac -d out src\Main.java src\model\RateLimiterModel.java src\service\RateLimiterService.java src\view\RateLimiterView.java src\controller\RateLimiterController.java
```

### 2. Run the Server

```powershell
java -cp out Main
```

### Server Startup Banner:

```text
============================================================
  RateGuard — Real-Time API Rate Limiter (Core Java)
============================================================
  Listening on:     http://localhost:8080
  Max Requests:     5 per 10 seconds
  Protected Path:   GET /api (Requires 'X-Client-ID' header)
  Health Check:     GET /health
  Press Ctrl+C to stop.
============================================================
```

---

## API Documentation

### 1. Health Check Endpoint

- **Path**: `GET /health`
- **Purpose**: Verify that the server is operational. Does not consume rate-limit quota.
- **Headers Required**: None.
- **Response**: `200 OK`
  ```json
  {
    "status": "UP",
    "message": "RateGuard server is healthy"
  }
  ```

---

### 2. Protected Endpoint

- **Path**: `GET /api`
- **Purpose**: Main API resource protected by the Fixed Window Rate Limiter.
- **Headers Required**: `X-Client-ID: <client-identifier>`

#### Response Matrix:

| Scenario | HTTP Status | Headers | Response Body |
|---|---|---|---|
| **Under Limit** | `200 OK` | `X-RateLimit-Limit: 5`<br>`X-RateLimit-Remaining: <N>` | `{"status":"success","message":"Request permitted","clientId":"...","remaining":<N>}` |
| **Quota Exceeded** | `429 Too Many Requests` | `X-RateLimit-Limit: 5`<br>`X-RateLimit-Remaining: 0`<br>`Retry-After: <S>` | `{"status":"error","message":"Rate limit exceeded. Try again later.","clientId":"...","retryAfterSeconds":<S>}` |
| **Missing Header** | `400 Bad Request` | `Content-Type: application/json` | `{"status":"error","message":"Missing or blank X-Client-ID header"}` |
| **Method Not Allowed** | `405 Method Not Allowed` | `Allow: GET`<br>`Content-Type: application/json` | `{"status":"error","message":"Method Not Allowed. Supported method: GET"}` |

---

## Testing with curl

Execute the following test cases in any standard terminal:

### 1. Check Server Health
```bash
curl -i http://localhost:8080/health
```

### 2. Send a Single Protected Request
```bash
curl -i -H "X-Client-ID: alice" http://localhost:8080/api
```

### 3. Send 6 Rapid Requests (Triggers HTTP 429)

**Linux / macOS (Bash / Zsh):**
```bash
for i in {1..6}; do
  echo "--- Request $i ---"
  curl -i -s -H "X-Client-ID: alice" http://localhost:8080/api
  echo ""
done
```

**Windows PowerShell:**
```powershell
1..6 | ForEach-Object {
    Write-Host "--- Request $_ ---"
    curl.exe -i -s -H "X-Client-ID: alice" http://localhost:8080/api
    Write-Host ""
}
```

*Result*: Requests 1 through 5 return `HTTP/1.1 200 OK` with decreasing `X-RateLimit-Remaining` (4, 3, 2, 1, 0). Request 6 returns `HTTP/1.1 429 Too Many Requests` with a `Retry-After` header.

### 4. Verify Independent Client Limits
While `alice` is rate-limited, client `bob` has a completely independent quota:
```bash
curl -i -H "X-Client-ID: bob" http://localhost:8080/api
```
*Result*: Returns `HTTP/1.1 200 OK` with `X-RateLimit-Remaining: 4`.

### 5. Wait for Window Expiration & Retest
Wait 10 seconds for the window to reset, then issue a request for `alice`:
```bash
# Sleep for 11 seconds
sleep 11    # (Linux/macOS) OR Start-Sleep -Seconds 11 (PowerShell)

curl -i -H "X-Client-ID: alice" http://localhost:8080/api
```
*Result*: Returns `HTTP/1.1 200 OK` with `X-RateLimit-Remaining: 4` (window has reset).

### 6. Test Missing or Blank Client ID
```bash
# Missing header
curl -i http://localhost:8080/api

# Blank header
curl -i -H "X-Client-ID:   " http://localhost:8080/api
```
*Result*: Returns `HTTP/1.1 400 Bad Request`.

### 7. Test Unsupported HTTP Method
```bash
curl -i -X POST -H "X-Client-ID: alice" http://localhost:8080/api
```
*Result*: Returns `HTTP/1.1 405 Method Not Allowed` with `Allow: GET`.

---

## Web-Based Testing Dashboard (RateGuard Playground)

RateGuard includes a browser-based developer dashboard located in `frontend/`, allowing users to test and visualize the rate limiter in real time without Postman or curl.

The frontend is built with pure **HTML5, CSS3, and Vanilla JavaScript** (zero external frameworks or node dependencies) and is served directly by the Java `HttpServer` as a same-origin static context at `http://localhost:8080/`.

### 1. How to Start the Server and Open the Dashboard

1. **Compile the Application** (from the project root):
   ```powershell
   javac -d out src\model\RateLimiterModel.java src\service\RateLimiterService.java src\view\RateLimiterView.java src\controller\RateLimiterController.java src\Main.java
   ```

2. **Run the Java Server**:
   ```powershell
   java -cp out Main
   ```

3. **Open the Dashboard**:
   Navigate to [http://localhost:8080/](http://localhost:8080/) in any modern web browser (Chrome, Edge, Firefox, Safari).

---

### 2. Dashboard Features & How to Test

#### A. Server Health Check
- Click the **"Check /health"** button in the top navigation bar.
- The dashboard sends `GET /health` and updates the health status indicator to **"Health: UP (200 OK)"** with a pulsing green indicator.
- The full JSON payload (`{"status":"UP","message":"RateGuard server is healthy"}`) appears in the **Live Response Inspector**.

#### B. Testing a Single Request (`GET /api`)
1. Enter a client ID in the **Client Identifier** field (or click one of the quick preset buttons: `alice`, `bob`, `charlie`).
2. Click **"Send Request"** (or press <kbd>Enter</kbd>).
3. The dashboard dispatches a real HTTP GET to `/api` with header `X-Client-ID: <id>`.
4. The button temporarily disables during in-flight communication.
5. The **Live Statistics**, **Live Response Inspector**, and **Request History Log** immediately update with:
   - HTTP status code (`200 OK`)
   - Remaining quota (`X-RateLimit-Remaining: 4`)
   - Monotonic response latency in milliseconds
   - Exact timestamp

#### C. Testing Rate Limiting with Multiple Requests (Triggering HTTP 429)
1. Select a client identifier (e.g., `alice`).
2. In the **Batch / Rapid Request Test** panel, set the request count to **`6`** (or click the **`6 (Trigger 429)`** preset).
3. Optionally adjust the delay slider (default: `150 ms`).
4. Click **"Send Batch Requests"**.
5. Observe the live sequential execution:
   - Requests 1 through 5 succeed with `200 OK` and decreasing remaining quotas (`4`, `3`, `2`, `1`, `0`).
   - Request 6 triggers `429 Too Many Requests`.
   - The active **Countdown Banner** appears displaying the exact `Retry-After` seconds returned from the backend, counting down to window reset.

#### D. Testing Client Quota Isolation
1. While client `alice` is rate-limited (`429`), switch the **Client Identifier** to **`bob`** (click the preset `bob`).
2. Click **"Send Request"**.
3. Notice that `bob` immediately receives `200 OK` with `X-RateLimit-Remaining: 4`.
4. This confirms per-client isolation: each client has an independent `5 requests / 10 seconds` window.

#### E. Testing Missing / Blank Client ID Validation
1. Click the **`[Blank Header]`** preset button or empty the input field.
2. Click **"Send Request"**.
3. The backend responds with `400 Bad Request` and `{"status":"error","message":"Missing or blank X-Client-ID header"}`.

#### F. Filtering and Clearing History
- Use the **Filter dropdown** above the history table to filter entries by `All Statuses`, `200 OK Only`, `429 Rate Limited Only`, or `Errors`.
- Click **"Clear Log"** to reset the client-side statistics cards and table view.
  > *Note*: Clearing the history only resets the frontend display; the backend's in-memory rate-limit state continues its fixed 10-second window lifecycle.

---

### 3. Integration & Architectural Notes

- **Same-Origin Static Serving**: The frontend files (`index.html`, `style.css`, `script.js`) are served directly on `http://localhost:8080/` by registering a root context in `Main.java`. This guarantees same-origin access, eliminating browser CORS restrictions while accessing `/api` and `/health`.
- **Zero Framework Footprint**: No React, Node.js, Webpack, or npm dependencies are required. The entire project remains pure Core Java with lightweight HTML/CSS/JS.
- **Backend Integrity**: The core rate-limiting engine (`RateLimiterController.java`, `RateLimiterService.java`, `RateLimiterModel.java`, `RateLimiterView.java`) remains 100% untouched and preserved. Existing curl and Postman testing workflows continue to operate identically.

---

## Sample HTTP Responses

### 1. Successful Request (HTTP 200 OK)
```http
HTTP/1.1 200 OK
Date: Tue, 13 Oct 2026 14:30:30 GMT
Content-type: application/json; charset=UTF-8
Content-length: 83
X-ratelimit-limit: 5
X-ratelimit-remaining: 4

{
  "status": "success",
  "message": "Request permitted",
  "clientId": "alice",
  "remaining": 4
}
```

### 2. Rate Limit Exceeded (HTTP 429 Too Many Requests)
```http
HTTP/1.1 429 Too Many Requests
Date: Tue, 13 Oct 2026 14:30:30 GMT
Content-type: application/json; charset=UTF-8
Content-length: 110
Retry-after: 10
X-ratelimit-limit: 5
X-ratelimit-remaining: 0

{
  "status": "error",
  "message": "Rate limit exceeded. Try again later.",
  "clientId": "alice",
  "retryAfterSeconds": 10
}
```

### 3. Missing Client Header (HTTP 400 Bad Request)
```http
HTTP/1.1 400 Bad Request
Date: Tue, 13 Oct 2026 14:29:15 GMT
Content-type: application/json; charset=UTF-8
Content-length: 66

{
  "status": "error",
  "message": "Missing or blank X-Client-ID header"
}
```

### 4. Unsupported HTTP Method (HTTP 405 Method Not Allowed)
```http
HTTP/1.1 405 Method Not Allowed
Date: Tue, 13 Oct 2026 14:29:33 GMT
Allow: GET
Content-type: application/json; charset=UTF-8
Content-length: 72

{
  "status": "error",
  "message": "Method Not Allowed. Supported method: GET"
}
```

---

## Configuration

RateGuard defines its operating parameters as `public static final` constants at the top of [`src/RateGuard.java`](file:///c:/Users/NEHA/OneDrive/Desktop/java%20project/src/RateGuard.java):

```java
// ==========================================
// Configuration Constants
// ==========================================
public static final int PORT = 8080;                  // HTTP Listening port
public static final int MAX_REQUESTS = 5;             // Max allowed requests per window
public static final long WINDOW_DURATION_SECONDS = 10; // Window length in seconds
```

To modify the rate limit (for example, allowing 100 requests per 60 seconds on port 9000):
1. Edit the constants in [`src/RateGuard.java`](file:///c:/Users/NEHA/OneDrive/Desktop/java%20project/src/RateGuard.java).
2. Recompile: `javac -d out src/RateGuard.java`
3. Restart: `java -cp out RateGuard`

---

## Limitations

1. **In-Memory Volatile Storage**:
   Rate limits and counters are maintained in memory within a `ConcurrentHashMap`. When the JVM process restarts, all active client states and remaining quotas reset.
2. **Single Server Instance (Not Distributed)**:
   This implementation runs on a single node. If placed behind a load balancer with multiple server replicas, requests will be distributed among instances, effectively multiplying the allowed quota unless a shared state store is introduced.
3. **Client-Supplied Identifier**:
   The limiter trusts the `X-Client-ID` header supplied by the client. In an untrusted public network, malicious clients could forge or randomize this header to bypass limits.
4. **Boundary Burst Profile**:
   As described in [The Window Boundary Burst Phenomenon](#the-window-boundary-burst-phenomenon), clients can send maximum allowable requests at the end of one window and immediately at the start of the next.

---

## Future Enhancements

- **Distributed Rate Limiting via Redis**:
  Use Redis `INCR` and `EXPIRE` primitives or atomic Redis Lua scripts to coordinate limits across distributed backend nodes.
- **Sliding Window Counter / Token Bucket Algorithms**:
  Implement rolling window calculations or token bucket algorithms to eliminate boundary burst vulnerabilities.
- **Secure Authentication**:
  Derive client identities from cryptographically verified JSON Web Tokens (JWT), API Keys, or TLS client certificates (mTLS) rather than self-reported headers.
- **Metrics & Observability**:
  Expose Prometheus-formatted metrics (`/metrics`) tracking total requests, accepted vs. rejected counts, and latencies.
- **Automated Eviction**:
  Implement a scheduled cleanup worker (`ScheduledExecutorService`) to evict inactive client entries from memory to prevent unbounded map growth over time.
- **Web Dashboard** *(Implemented)*:
  An interactive real-time HTML/CSS/Vanilla JS playground located in `frontend/` and served directly at `http://localhost:8080/`.

---

## Learning Outcomes

Building RateGuard provides foundational insights into core backend engineering concepts:

1. **Java Network Programming**:
   Using `com.sun.net.httpserver.HttpServer` reveals how HTTP requests map to sockets, headers, stream I/O, and exchange lifecycles without high-level framework abstraction.
2. **High-Throughput Concurrency**:
   Using `ConcurrentHashMap.compute()` showcases lock striping. Instead of synchronizing the entire server or rate limiter (which bottlenecks throughput), synchronization is isolated strictly to the specific client key being updated.
3. **Monotonic Clocks vs. Wall Clocks**:
   Understanding why `System.nanoTime()` must be used for elapsed time calculations instead of `System.currentTimeMillis()`, preventing clock skew anomalies from NTP sync or daylight savings time.
4. **HTTP Protocol Compliance**:
   Practicing proper status code semantics (`200`, `400`, `405`, `429`) and standard rate-limiting response headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`).
5. **Architectural Trade-Offs**:
   Analyzing the performance, complexity, and boundary vulnerabilities of Fixed Window vs. Token Bucket algorithms.
