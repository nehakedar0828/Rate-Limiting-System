/**
 * RateGuard — API Rate Limiting Dashboard
 * Interactive frontend for Core Java Fixed Window Rate Limiter
 * Zero dependencies, Vanilla JavaScript, Safe DOM manipulation, CSV Export.
 */

(function () {
  'use strict';

  // --- Application State ---
  const state = {
    totalRequests: 0,
    successfulRequests: 0,
    rateLimitedRequests: 0,
    clientErrors: 0,
    serverErrors: 0,
    networkErrors: 0,
    totalLatencyMs: 0,
    requestHistory: [], // Holds all immutable record objects in chronological order (oldest -> newest)
    isBatchRunning: false,
    stopBatchRequested: false,
    countdownTimerId: null
  };

  // --- DOM Element References ---
  const elements = {
    // Toast
    toastContainer: document.getElementById('toastContainer'),

    // Health
    healthPill: document.getElementById('healthPill'),
    healthDot: document.getElementById('healthDot'),
    healthText: document.getElementById('healthText'),
    btnHealth: document.getElementById('btnHealth'),

    // Policy & Metrics
    statTotal: document.getElementById('statTotal'),
    statSuccess: document.getElementById('statSuccess'),
    statRateLimited: document.getElementById('statRateLimited'),
    statErrors: document.getElementById('statErrors'),
    statServerErrors: document.getElementById('statServerErrors'),
    statAvgLatency: document.getElementById('statAvgLatency'),
    statRemainingQuota: document.getElementById('statRemainingQuota'),
    statRemainingDesc: document.getElementById('statRemainingDesc'),

    // Dispatcher Controls
    clientIdInput: document.getElementById('clientIdInput'),
    clientIdFeedback: document.getElementById('clientIdFeedback'),
    btnSendSingle: document.getElementById('btnSendSingle'),
    btnSendSingleText: document.getElementById('btnSendSingleText'),
    singleSpinner: document.getElementById('singleSpinner'),

    batchCountInput: document.getElementById('batchCountInput'),
    batchDelayInput: document.getElementById('batchDelayInput'),
    delayVal: document.getElementById('delayVal'),
    btnSendBatch: document.getElementById('btnSendBatch'),
    btnSendBatchText: document.getElementById('btnSendBatchText'),
    btnStopBatch: document.getElementById('btnStopBatch'),
    batchSpinner: document.getElementById('batchSpinner'),
    batchProgressBarContainer: document.getElementById('batchProgressBarContainer'),
    batchProgressBarFill: document.getElementById('batchProgressBarFill'),
    batchProgressText: document.getElementById('batchProgressText'),

    // Countdown Banner
    countdownBanner: document.getElementById('countdownBanner'),
    countdownSeconds: document.getElementById('countdownSeconds'),
    countdownMessage: document.getElementById('countdownMessage'),

    // Live Response Inspector
    latestStatusBadge: document.getElementById('latestStatusBadge'),
    respEndpoint: document.getElementById('respEndpoint'),
    respStatusCode: document.getElementById('respStatusCode'),
    respLatency: document.getElementById('respLatency'),
    respTimestamp: document.getElementById('respTimestamp'),
    hdrLimit: document.getElementById('hdrLimit'),
    hdrRemaining: document.getElementById('hdrRemaining'),
    hdrRetryAfter: document.getElementById('hdrRetryAfter'),
    hdrContentType: document.getElementById('hdrContentType'),
    responseBodyViewer: document.getElementById('responseBodyViewer'),
    btnCopyJson: document.getElementById('btnCopyJson'),

    // History & Export
    filterStatus: document.getElementById('filterStatus'),
    filterClient: document.getElementById('filterClient'),
    btnExportAllLogs: document.getElementById('btnExportAllLogs'),
    btnExportFilteredLogs: document.getElementById('btnExportFilteredLogs'),
    btnClearHistory: document.getElementById('btnClearHistory'),
    historyCounter: document.getElementById('historyCounter'),
    historyTableBody: document.getElementById('historyTableBody'),
    emptyHistoryRow: document.getElementById('emptyHistoryRow'),
    emptyFilteredRow: document.getElementById('emptyFilteredRow')
  };

  // --- Utility Functions ---

  function padZero(n, len = 2) {
    return String(n).padStart(len, '0');
  }

  function formatTime(date) {
    const h = padZero(date.getHours());
    const m = padZero(date.getMinutes());
    const s = padZero(date.getSeconds());
    const ms = padZero(date.getMilliseconds(), 3);
    return `${h}:${m}:${s}.${ms}`;
  }

  function formatDateForFilename(date) {
    const y = date.getFullYear();
    const m = padZero(date.getMonth() + 1);
    const d = padZero(date.getDate());
    return `${y}-${m}-${d}`;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function formatJson(rawText) {
    try {
      const parsed = JSON.parse(rawText);
      return JSON.stringify(parsed, null, 2);
    } catch (_) {
      return rawText;
    }
  }

  // Toast Notification System
  function showToast(message, type = 'info', durationMs = 3500) {
    if (!elements.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px) scale(0.95)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, durationMs);
  }

  // --- Client Validation Feedback ---
  function updateClientValidation() {
    const rawVal = elements.clientIdInput.value;
    const trimmed = rawVal.trim();
    if (!elements.clientIdFeedback) return;

    if (trimmed.length === 0) {
      elements.clientIdFeedback.textContent = 'Blank (triggers 400)';
      elements.clientIdFeedback.className = 'feedback-badge invalid';
    } else {
      elements.clientIdFeedback.textContent = `Valid Client (${trimmed.length} chars)`;
      elements.clientIdFeedback.className = 'feedback-badge';
    }
  }

  // --- Status Categorization ---
  function categorizeStatus(statusCode) {
    if (statusCode === 200) return 'SUCCESS';
    if (statusCode === 429) return 'RATE_LIMITED';
    if (statusCode >= 400 && statusCode < 500) return 'CLIENT_ERROR';
    if (statusCode >= 500 && statusCode < 600) return 'SERVER_ERROR';
    return 'NETWORK_ERROR'; // status === 0 or unknown
  }

  function getStatusPhrase(statusCode) {
    switch (statusCode) {
      case 200: return 'OK';
      case 400: return 'Bad Request';
      case 404: return 'Not Found';
      case 405: return 'Method Not Allowed';
      case 429: return 'Too Many Requests';
      case 500: return 'Internal Server Error';
      case 502: return 'Bad Gateway';
      case 503: return 'Service Unavailable';
      case 0: return 'Connection / Network Error';
      default: return `HTTP ${statusCode}`;
    }
  }

  // --- Network Dispatcher ---

  /**
   * Executes a GET request to /api or /health with monotonic performance timing.
   */
  async function executeApiRequest(endpoint = '/api', rawClientId = null) {
    const startTime = performance.now();
    const timestamp = new Date();
    const headers = {};

    // Note: If rawClientId is null, header is omitted entirely.
    // If rawClientId is empty string "", header is sent with empty value.
    if (rawClientId !== null && rawClientId !== undefined) {
      headers['X-Client-ID'] = rawClientId;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: headers,
        cache: 'no-store'
      });

      const latencyMs = Math.round(performance.now() - startTime);
      const bodyText = await response.text();

      // Extract HTTP response headers
      const limitHeader = response.headers.get('x-ratelimit-limit') || response.headers.get('X-RateLimit-Limit');
      const remainingHeader = response.headers.get('x-ratelimit-remaining') || response.headers.get('X-RateLimit-Remaining');
      const retryAfterHeader = response.headers.get('retry-after') || response.headers.get('Retry-After');
      const contentTypeHeader = response.headers.get('content-type') || response.headers.get('Content-Type');

      let parsedJson = null;
      try {
        parsedJson = JSON.parse(bodyText);
      } catch (_) {}

      // Remaining quota derived directly from backend response
      let remainingQuota = '—';
      if (remainingHeader !== null && remainingHeader !== undefined) {
        remainingQuota = remainingHeader;
      } else if (parsedJson && parsedJson.remaining !== undefined) {
        remainingQuota = String(parsedJson.remaining);
      } else if (response.status === 429) {
        remainingQuota = '0';
      }

      // Retry-After derived directly from backend response
      let retryAfterSeconds = null;
      if (retryAfterHeader !== null && retryAfterHeader !== undefined) {
        retryAfterSeconds = parseInt(retryAfterHeader, 10);
      } else if (parsedJson && parsedJson.retryAfterSeconds !== undefined) {
        retryAfterSeconds = parseInt(parsedJson.retryAfterSeconds, 10);
      }

      // Backend response message
      let message = response.statusText || 'Response received';
      if (parsedJson && parsedJson.message) {
        message = parsedJson.message;
      } else if (response.status === 200) {
        message = 'Request permitted';
      }

      // Error details if applicable
      let errorDetails = 'None';
      if (response.status === 429) {
        errorDetails = `Quota exceeded. Retry-After: ${retryAfterSeconds !== null ? retryAfterSeconds + 's' : 'active'}`;
      } else if (response.status === 400) {
        errorDetails = (parsedJson && parsedJson.message) || 'Missing or blank X-Client-ID header';
      } else if (response.status === 405) {
        errorDetails = 'Method Not Allowed. Supported method: GET';
      } else if (response.status >= 500) {
        errorDetails = `Server returned HTTP ${response.status}`;
      }

      const category = categorizeStatus(response.status);

      return {
        id: state.totalRequests + 1,
        success: true,
        endpoint,
        method: 'GET',
        rawClientId: rawClientId,
        clientId: rawClientId !== null && rawClientId !== undefined && rawClientId !== '' ? rawClientId : '(blank)',
        status: response.status,
        statusText: response.statusText || getStatusPhrase(response.status),
        statusCategory: category,
        latencyMs,
        timestamp,
        timestampIso: timestamp.toISOString(),
        timestampFormatted: formatTime(timestamp),
        bodyText,
        parsedJson,
        headers: {
          limit: limitHeader || '—',
          remaining: remainingHeader || '—',
          retryAfter: retryAfterHeader || '—',
          contentType: contentTypeHeader || '—'
        },
        remainingQuota,
        retryAfterSeconds,
        message,
        errorDetails
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        id: state.totalRequests + 1,
        success: false,
        endpoint,
        method: 'GET',
        rawClientId: rawClientId,
        clientId: rawClientId !== null && rawClientId !== undefined && rawClientId !== '' ? rawClientId : '(blank)',
        status: 0,
        statusText: 'Connection Error',
        statusCategory: 'NETWORK_ERROR',
        latencyMs,
        timestamp,
        timestampIso: timestamp.toISOString(),
        timestampFormatted: formatTime(timestamp),
        bodyText: JSON.stringify({ error: err.message || 'Failed to connect to RateGuard server.' }, null, 2),
        parsedJson: null,
        headers: { limit: '—', remaining: '—', retryAfter: '—', contentType: '—' },
        remainingQuota: '—',
        retryAfterSeconds: null,
        message: 'Could not reach server. Verify RateGuard is running on port 8080.',
        errorDetails: err.message || 'Network unreachable'
      };
    }
  }

  // --- Statistics Calculation (Feature 4) ---

  function recordAndRecalculateStats(record) {
    // Append immutable record to in-memory history
    state.requestHistory.push(record);

    // Update counters accurately based on mutually exclusive status categories
    state.totalRequests++;
    state.totalLatencyMs += record.latencyMs;

    switch (record.statusCategory) {
      case 'SUCCESS':
        state.successfulRequests++;
        break;
      case 'RATE_LIMITED':
        state.rateLimitedRequests++;
        break;
      case 'CLIENT_ERROR':
        state.clientErrors++;
        break;
      case 'SERVER_ERROR':
        state.serverErrors++;
        break;
      case 'NETWORK_ERROR':
        state.networkErrors++;
        break;
    }

    // Refresh UI Metric Cards
    setText(elements.statTotal, state.totalRequests);
    setText(elements.statSuccess, state.successfulRequests);
    setText(elements.statRateLimited, state.rateLimitedRequests);
    setText(elements.statErrors, state.clientErrors);
    if (elements.statServerErrors) {
      setText(elements.statServerErrors, state.serverErrors + state.networkErrors);
    }

    // Calculate Average Response Latency
    const avgLatency = state.totalRequests > 0 ? Math.round(state.totalLatencyMs / state.totalRequests) : 0;
    if (elements.statAvgLatency) {
      setText(elements.statAvgLatency, `${avgLatency}`);
    }

    // Update Remaining Quota for the target client
    if (record.remainingQuota !== '—') {
      setText(elements.statRemainingQuota, record.remainingQuota);
      setText(elements.statRemainingDesc, `Quota (${record.clientId})`);
    }

    // Trigger Countdown Timer if 429 received
    if (record.status === 429 && record.retryAfterSeconds && record.retryAfterSeconds > 0) {
      startCountdown(record.retryAfterSeconds, record.clientId);
    }
  }

  // --- Response Inspector Handler ---

  function updateInspector(record) {
    setText(elements.respEndpoint, `${record.method} ${record.endpoint}`);
    setText(elements.respStatusCode, record.status ? `${record.status} ${record.statusText}` : '0 Connection Failed');
    setText(elements.respLatency, `${record.latencyMs} ms`);
    setText(elements.respTimestamp, record.timestampFormatted);

    setText(elements.hdrLimit, record.headers.limit);
    setText(elements.hdrRemaining, record.headers.remaining);
    setText(elements.hdrRetryAfter, record.headers.retryAfter);
    setText(elements.hdrContentType, record.headers.contentType);

    setText(elements.responseBodyViewer, formatJson(record.bodyText));

    // Update badge styling
    const badge = elements.latestStatusBadge;
    badge.className = 'inspector-badge';
    if (record.status === 200) {
      badge.classList.add('badge-200');
      setText(badge, '200 OK — Permitted');
    } else if (record.status === 429) {
      badge.classList.add('badge-429');
      setText(badge, '429 — Rate Limited');
    } else if (record.status >= 400 && record.status < 500) {
      badge.classList.add('badge-400');
      setText(badge, `${record.status} — ${record.statusText}`);
    } else {
      badge.classList.add('badge-other');
      setText(badge, record.status ? `${record.status} — ${record.statusText}` : 'Network Failure');
    }
  }

  // --- Request History Table Rendering (Feature 3) ---

  function renderHistoryRow(record) {
    const tr = document.createElement('tr');
    tr.dataset.status = String(record.status);
    tr.dataset.category = record.statusCategory;
    tr.dataset.clientId = (record.rawClientId || '').toLowerCase();

    // 1. Request Number (#)
    const tdIndex = document.createElement('td');
    setText(tdIndex, `#${record.id}`);
    tr.appendChild(tdIndex);

    // 2. Time
    const tdTime = document.createElement('td');
    setText(tdTime, record.timestampFormatted);
    tr.appendChild(tdTime);

    // 3. Client ID
    const tdClient = document.createElement('td');
    const codeClient = document.createElement('code');
    setText(codeClient, record.clientId);
    tdClient.appendChild(codeClient);
    tr.appendChild(tdClient);

    // 4. Endpoint
    const tdEndpoint = document.createElement('td');
    const codeEndpoint = document.createElement('code');
    setText(codeEndpoint, record.endpoint);
    tdEndpoint.appendChild(codeEndpoint);
    tr.appendChild(tdEndpoint);

    // 5. Status Badge
    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    if (record.status === 200) {
      badge.classList.add('badge-200');
      setText(badge, '200 OK');
    } else if (record.status === 429) {
      badge.classList.add('badge-429');
      setText(badge, '429 Limit');
    } else if (record.status >= 400 && record.status < 500) {
      badge.classList.add('badge-400');
      setText(badge, `${record.status} ${record.statusText}`);
    } else {
      badge.classList.add('badge-other');
      setText(badge, record.status ? `${record.status}` : 'Err');
    }
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    // 6. Remaining Quota
    const tdRemaining = document.createElement('td');
    setText(tdRemaining, record.remainingQuota !== '—' ? `${record.remainingQuota} / 5` : '—');
    tr.appendChild(tdRemaining);

    // 7. Latency
    const tdLatency = document.createElement('td');
    setText(tdLatency, `${record.latencyMs} ms`);
    tr.appendChild(tdLatency);

    // 8. Backend Message & Error Details
    const tdMessage = document.createElement('td');
    let messageDisplay = record.message;
    if (record.retryAfterSeconds) {
      messageDisplay += ` [Retry-After: ${record.retryAfterSeconds}s]`;
    } else if (record.errorDetails && record.errorDetails !== 'None' && record.errorDetails !== record.message) {
      messageDisplay += ` (${record.errorDetails})`;
    }
    setText(tdMessage, messageDisplay);
    tr.appendChild(tdMessage);

    return tr;
  }

  function appendHistoryRow(record) {
    const tr = renderHistoryRow(record);

    // Insert newest requests first (top of table)
    const firstRow = elements.historyTableBody.querySelector('tr:not(.empty-row)');
    if (firstRow) {
      elements.historyTableBody.insertBefore(tr, firstRow);
    } else {
      // Insert before empty rows
      elements.historyTableBody.insertBefore(tr, elements.historyTableBody.firstChild);
    }

    applyFilters();
  }

  function applyFilters() {
    const statusFilter = elements.filterStatus ? elements.filterStatus.value : 'ALL';
    const clientFilter = elements.filterClient ? elements.filterClient.value.trim().toLowerCase() : '';

    const rows = elements.historyTableBody.querySelectorAll('tr:not(.empty-row)');
    let visibleCount = 0;

    rows.forEach(row => {
      const rowStatus = row.dataset.status;
      const rowCategory = row.dataset.category;
      const rowClient = row.dataset.clientId || '';

      // Match Status
      let matchStatus = false;
      if (statusFilter === 'ALL') {
        matchStatus = true;
      } else if (statusFilter === '200' && rowStatus === '200') {
        matchStatus = true;
      } else if (statusFilter === '429' && rowStatus === '429') {
        matchStatus = true;
      } else if (statusFilter === '4XX' && (rowCategory === 'CLIENT_ERROR' || (rowStatus.startsWith('4') && rowStatus !== '429'))) {
        matchStatus = true;
      } else if (statusFilter === '5XX' && (rowCategory === 'SERVER_ERROR' || rowCategory === 'NETWORK_ERROR' || rowStatus.startsWith('5') || rowStatus === '0')) {
        matchStatus = true;
      }

      // Match Client
      let matchClient = true;
      if (clientFilter.length > 0) {
        matchClient = rowClient.includes(clientFilter);
      }

      if (matchStatus && matchClient) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });

    // Handle Empty States
    const totalRecords = state.requestHistory.length;
    if (totalRecords === 0) {
      if (elements.emptyHistoryRow) elements.emptyHistoryRow.style.display = '';
      if (elements.emptyFilteredRow) elements.emptyFilteredRow.style.display = 'none';
      setText(elements.historyCounter, '0 records');
    } else {
      if (elements.emptyHistoryRow) elements.emptyHistoryRow.style.display = 'none';

      if (visibleCount === 0) {
        if (elements.emptyFilteredRow) elements.emptyFilteredRow.style.display = '';
        setText(elements.historyCounter, `0 of ${totalRecords} records`);
      } else {
        if (elements.emptyFilteredRow) elements.emptyFilteredRow.style.display = 'none';
        if (visibleCount === totalRecords) {
          setText(elements.historyCounter, `${totalRecords} record${totalRecords === 1 ? '' : 's'}`);
        } else {
          setText(elements.historyCounter, `Showing ${visibleCount} of ${totalRecords} records`);
        }
      }
    }
  }

  // --- CSV Export Generation (Feature 1) ---

  /**
   * Sanitizes a single CSV cell value:
   * 1. Protects against CSV / spreadsheet formula injection for values beginning with =, +, -, @, \t, \r
   * 2. Escapes double quotes as "" according to RFC 4180
   * 3. Wraps values with commas, quotes, newlines, or prepended single quotes in double quotes.
   */
  function sanitizeCsvCell(value) {
    if (value === null || value === undefined) return '""';
    let str = String(value);

    // Formula injection prevention:
    // If the string starts with =, +, -, @, \t, or \r, prepend a single quote (') so spreadsheet engines treat it as text
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }

    // RFC 4180 CSV escaping
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r') || str.startsWith("'")) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }

    return str;
  }

  /**
   * Generates a standard RFC 4180 CSV string from an array of record objects.
   */
  function generateCsvContent(records) {
    const headers = [
      'Request number',
      'Timestamp',
      'Client ID',
      'HTTP method',
      'Endpoint',
      'HTTP status code',
      'Status description',
      'Remaining quota',
      'Response time in milliseconds',
      'Backend response message',
      'Error details, if any'
    ];

    const lines = [headers.map(sanitizeCsvCell).join(',')];

    for (const rec of records) {
      const row = [
        rec.id,
        rec.timestampIso,
        rec.clientId,
        rec.method,
        rec.endpoint,
        rec.status,
        rec.statusText,
        rec.remainingQuota,
        rec.latencyMs,
        rec.message,
        rec.errorDetails
      ];
      lines.push(row.map(sanitizeCsvCell).join(','));
    }

    return lines.join('\r\n');
  }

  /**
   * Triggers a native client-side file download with UTF-8 BOM encoding for seamless Microsoft Excel compatibility.
   */
  function triggerCsvDownload(csvContent, filename) {
    // \uFEFF is the UTF-8 Byte Order Mark (BOM). Microsoft Excel requires this to correctly recognize UTF-8 characters.
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');

    downloadAnchor.href = url;
    downloadAnchor.setAttribute('download', filename);
    downloadAnchor.style.display = 'none';
    document.body.appendChild(downloadAnchor);

    downloadAnchor.click();

    setTimeout(() => {
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    }, 200);
  }

  /**
   * Exports all recorded requests regardless of the currently selected status or client filter.
   */
  function handleExportAllLogs() {
    if (state.requestHistory.length === 0) {
      showToast('No request records to export. Run tests to generate request logs.', 'warning');
      return;
    }

    const todayStr = formatDateForFilename(new Date());
    const filename = `rateguard-logs-${todayStr}.csv`;
    const csvData = generateCsvContent(state.requestHistory);

    triggerCsvDownload(csvData, filename);
    showToast(`Exported all ${state.requestHistory.length} logs to ${filename}`, 'success');
  }

  /**
   * Exports only the currently visible filtered requests.
   */
  function handleExportFilteredLogs() {
    if (state.requestHistory.length === 0) {
      showToast('No request records to export.', 'warning');
      return;
    }

    const statusFilter = elements.filterStatus ? elements.filterStatus.value : 'ALL';
    const clientFilter = elements.filterClient ? elements.filterClient.value.trim().toLowerCase() : '';

    const filteredRecords = state.requestHistory.filter(rec => {
      const statusStr = String(rec.status);
      let matchStatus = false;
      if (statusFilter === 'ALL') {
        matchStatus = true;
      } else if (statusFilter === '200' && statusStr === '200') {
        matchStatus = true;
      } else if (statusFilter === '429' && statusStr === '429') {
        matchStatus = true;
      } else if (statusFilter === '4XX' && (rec.statusCategory === 'CLIENT_ERROR' || (statusStr.startsWith('4') && statusStr !== '429'))) {
        matchStatus = true;
      } else if (statusFilter === '5XX' && (rec.statusCategory === 'SERVER_ERROR' || rec.statusCategory === 'NETWORK_ERROR' || statusStr.startsWith('5') || statusStr === '0')) {
        matchStatus = true;
      }

      let matchClient = true;
      if (clientFilter.length > 0) {
        matchClient = (rec.rawClientId || '').toLowerCase().includes(clientFilter);
      }

      return matchStatus && matchClient;
    });

    if (filteredRecords.length === 0) {
      showToast('No records match the current filter criteria to export.', 'warning');
      return;
    }

    const todayStr = formatDateForFilename(new Date());
    const filename = `rateguard-filtered-logs-${todayStr}.csv`;
    const csvData = generateCsvContent(filteredRecords);

    triggerCsvDownload(csvData, filename);
    showToast(`Exported ${filteredRecords.length} filtered records to ${filename}`, 'success');
  }

  // --- Countdown Timer Handlers ---

  function startCountdown(seconds, clientId) {
    if (state.countdownTimerId) {
      clearInterval(state.countdownTimerId);
      state.countdownTimerId = null;
    }

    let remaining = seconds;
    elements.countdownBanner.classList.add('active');
    setText(elements.countdownSeconds, remaining);
    if (elements.countdownMessage) {
      elements.countdownMessage.innerHTML = `Client <code>${clientId}</code> quota exhausted. Window resets in approx: <strong id="countdownSeconds">${remaining}</strong>s`;
      elements.countdownSeconds = document.getElementById('countdownSeconds');
    }

    state.countdownTimerId = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(state.countdownTimerId);
        state.countdownTimerId = null;
        elements.countdownBanner.classList.remove('active');
        setText(elements.countdownSeconds, '0');
        showToast(`Rate limit window for client '${clientId}' has reset.`, 'info');
      } else {
        setText(elements.countdownSeconds, remaining);
      }
    }, 1000);
  }

  // --- Action Handlers ---

  async function handleSendSingle() {
    if (state.isBatchRunning) return;

    const clientId = elements.clientIdInput.value;

    elements.btnSendSingle.disabled = true;
    elements.singleSpinner.classList.add('active');
    setText(elements.btnSendSingleText, 'Sending...');

    try {
      const record = await executeApiRequest('/api', clientId);
      recordAndRecalculateStats(record);
      updateInspector(record);
      appendHistoryRow(record);
    } finally {
      elements.btnSendSingle.disabled = false;
      elements.singleSpinner.classList.remove('active');
      setText(elements.btnSendSingleText, 'Send Request');
    }
  }

  async function handleSendBatch() {
    if (state.isBatchRunning) return;

    const clientId = elements.clientIdInput.value;
    let count = parseInt(elements.batchCountInput.value, 10);
    const delay = parseInt(elements.batchDelayInput.value, 10) || 150;

    // Safety bounds: 1 to 100
    if (isNaN(count) || count < 1) count = 1;
    if (count > 100) count = 100;
    elements.batchCountInput.value = count;

    state.isBatchRunning = true;
    state.stopBatchRequested = false;

    // UI Loading state
    elements.btnSendSingle.disabled = true;
    elements.btnSendBatch.disabled = true;
    elements.btnStopBatch.disabled = false;
    elements.batchSpinner.classList.add('active');
    setText(elements.btnSendBatchText, 'Batch In Progress...');

    elements.batchProgressBarContainer.classList.add('active');
    elements.batchProgressBarFill.style.width = '0%';
    setText(elements.batchProgressText, `Sending 0 of ${count}...`);

    for (let i = 1; i <= count; i++) {
      if (state.stopBatchRequested) {
        setText(elements.batchProgressText, `Halted by user after ${i - 1} requests.`);
        showToast(`Batch execution stopped after ${i - 1} requests.`, 'warning');
        break;
      }

      setText(elements.batchProgressText, `Request ${i} of ${count}...`);
      const pct = Math.round((i / count) * 100);
      elements.batchProgressBarFill.style.width = `${pct}%`;

      const record = await executeApiRequest('/api', clientId);
      recordAndRecalculateStats(record);
      updateInspector(record);
      appendHistoryRow(record);

      if (i < count && !state.stopBatchRequested && delay > 0) {
        await sleep(delay);
      }
    }

    if (!state.stopBatchRequested) {
      setText(elements.batchProgressText, `Completed batch of ${count} requests.`);
      showToast(`Batch of ${count} requests completed successfully.`, 'success');
    }

    state.isBatchRunning = false;
    state.stopBatchRequested = false;

    elements.btnSendSingle.disabled = false;
    elements.btnSendBatch.disabled = false;
    elements.btnStopBatch.disabled = true;
    elements.batchSpinner.classList.remove('active');
    setText(elements.btnSendBatchText, 'Send Batch Requests');
  }

  function handleStopBatch() {
    if (state.isBatchRunning) {
      state.stopBatchRequested = true;
      setText(elements.batchProgressText, 'Stopping batch after current request...');
      elements.btnStopBatch.disabled = true;
    }
  }

  async function handleHealthCheck() {
    elements.btnHealth.disabled = true;
    setText(elements.healthText, 'Health: Checking...');

    const record = await executeApiRequest('/health', null);
    updateInspector(record);

    if (record.status === 200) {
      elements.healthDot.className = 'health-dot up';
      setText(elements.healthText, 'Health: UP (200 OK)');
    } else {
      elements.healthDot.className = 'health-dot down';
      setText(elements.healthText, record.status ? `Health: ${record.status}` : 'Health: Unreachable');
    }

    elements.btnHealth.disabled = false;
  }

  function handleClearHistory() {
    // Clear log rows while preserving empty row placeholders
    const rows = elements.historyTableBody.querySelectorAll('tr:not(.empty-row)');
    rows.forEach(r => r.remove());

    // Reset state & stats
    state.requestHistory = [];
    state.totalRequests = 0;
    state.successfulRequests = 0;
    state.rateLimitedRequests = 0;
    state.clientErrors = 0;
    state.serverErrors = 0;
    state.networkErrors = 0;
    state.totalLatencyMs = 0;

    // Update UI elements
    setText(elements.statTotal, '0');
    setText(elements.statSuccess, '0');
    setText(elements.statRateLimited, '0');
    setText(elements.statErrors, '0');
    if (elements.statServerErrors) setText(elements.statServerErrors, '0');
    if (elements.statAvgLatency) setText(elements.statAvgLatency, '—');
    setText(elements.statRemainingQuota, '—');
    setText(elements.statRemainingDesc, 'Client Quota Left');

    if (state.countdownTimerId) {
      clearInterval(state.countdownTimerId);
      state.countdownTimerId = null;
      elements.countdownBanner.classList.remove('active');
    }

    applyFilters();
    showToast('Browser request history and local statistics cleared.', 'info');
  }

  function handleCopyJson() {
    const jsonText = elements.responseBodyViewer.textContent;
    if (!navigator.clipboard) {
      showToast('Clipboard API not available in this browser context.', 'warning');
      return;
    }
    navigator.clipboard.writeText(jsonText).then(() => {
      showToast('Response JSON copied to clipboard!', 'success', 2000);
    }).catch(() => {
      showToast('Failed to copy to clipboard.', 'warning');
    });
  }

  // --- Attach Event Listeners ---

  function setupEvents() {
    // Single & Batch dispatchers
    elements.btnSendSingle.addEventListener('click', handleSendSingle);
    elements.btnSendBatch.addEventListener('click', handleSendBatch);
    elements.btnStopBatch.addEventListener('click', handleStopBatch);
    elements.btnHealth.addEventListener('click', handleHealthCheck);

    // Export & History actions
    if (elements.btnExportAllLogs) {
      elements.btnExportAllLogs.addEventListener('click', handleExportAllLogs);
    }
    if (elements.btnExportFilteredLogs) {
      elements.btnExportFilteredLogs.addEventListener('click', handleExportFilteredLogs);
    }
    elements.btnClearHistory.addEventListener('click', handleClearHistory);

    // Filters
    if (elements.filterStatus) {
      elements.filterStatus.addEventListener('change', applyFilters);
    }
    if (elements.filterClient) {
      elements.filterClient.addEventListener('input', applyFilters);
    }

    // JSON Copy
    if (elements.btnCopyJson) {
      elements.btnCopyJson.addEventListener('click', handleCopyJson);
    }

    // Client ID Input Validation & Enter key
    elements.clientIdInput.addEventListener('input', updateClientValidation);
    elements.clientIdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!elements.btnSendSingle.disabled && !state.isBatchRunning) {
          handleSendSingle();
        }
      }
    });

    // Client Presets
    document.querySelectorAll('.preset-badge').forEach(badge => {
      badge.addEventListener('click', () => {
        const clientVal = badge.dataset.client;
        elements.clientIdInput.value = clientVal;
        updateClientValidation();
        elements.clientIdInput.focus();
      });
    });

    // Batch Count Presets
    document.querySelectorAll('.preset-count').forEach(btn => {
      btn.addEventListener('click', () => {
        const countVal = btn.dataset.count;
        elements.batchCountInput.value = countVal;
      });
    });

    // Range slider update
    elements.batchDelayInput.addEventListener('input', (e) => {
      setText(elements.delayVal, `${e.target.value} ms`);
    });

    // Initial validation check
    updateClientValidation();

    // Auto-ping server health on page load
    handleHealthCheck();
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEvents);
  } else {
    setupEvents();
  }
})();
