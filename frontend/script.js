/**
 * RateGuard — API Rate Limiting Playground
 * Interactive frontend for testing Core Java Fixed Window Rate Limiter
 * Zero dependencies, Vanilla JavaScript, Safe DOM manipulation.
 */

(function () {
  'use strict';

  // --- State ---
  const state = {
    totalRequests: 0,
    successfulRequests: 0,
    rateLimitedRequests: 0,
    errorRequests: 0,
    requestHistory: [], // Array of log records
    isBatchRunning: false,
    stopBatchRequested: false,
    countdownTimerId: null
  };

  // --- DOM Elements ---
  const elements = {
    // Health
    healthPill: document.getElementById('healthPill'),
    healthDot: document.getElementById('healthDot'),
    healthText: document.getElementById('healthText'),
    btnHealth: document.getElementById('btnHealth'),

    // Stats
    statTotal: document.getElementById('statTotal'),
    statSuccess: document.getElementById('statSuccess'),
    statRateLimited: document.getElementById('statRateLimited'),
    statErrors: document.getElementById('statErrors'),
    statRemainingQuota: document.getElementById('statRemainingQuota'),
    statRemainingDesc: document.getElementById('statRemainingDesc'),

    // Controls
    clientIdInput: document.getElementById('clientIdInput'),
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

    // Inspector
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

    // History Table
    filterStatus: document.getElementById('filterStatus'),
    btnClearHistory: document.getElementById('btnClearHistory'),
    historyCounter: document.getElementById('historyCounter'),
    historyTableBody: document.getElementById('historyTableBody'),
    emptyHistoryRow: document.getElementById('emptyHistoryRow')
  };

  // --- Utility Functions ---

  function formatTime(date) {
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const h = pad(date.getHours());
    const m = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    const ms = pad(date.getMilliseconds(), 3);
    return `${h}:${m}:${s}.${ms}`;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Safely update text without innerHTML
  function setText(el, text) {
    if (el) el.textContent = text;
  }

  // Format JSON safely
  function formatJson(rawText) {
    try {
      const parsed = JSON.parse(rawText);
      return JSON.stringify(parsed, null, 2);
    } catch (_) {
      return rawText;
    }
  }

  // --- Network Dispatcher ---

  /**
   * Executes a GET request to /api or /health with precise timekeeping.
   */
  async function executeApiRequest(endpoint = '/api', clientId = null) {
    const startTime = performance.now();
    const timestamp = new Date();
    const headers = {};

    if (clientId !== null && clientId !== undefined) {
      headers['X-Client-ID'] = clientId;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: headers,
        cache: 'no-store'
      });

      const latencyMs = Math.round(performance.now() - startTime);
      const bodyText = await response.text();

      // Extract headers
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

      return {
        success: true,
        endpoint,
        clientId: clientId !== null ? clientId : '(none)',
        status: response.status,
        statusText: response.statusText || getStatusPhrase(response.status),
        latencyMs,
        timestamp,
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
        message: (parsedJson && parsedJson.message) ? parsedJson.message : (response.statusText || 'Response received')
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        success: false,
        endpoint,
        clientId: clientId !== null ? clientId : '(none)',
        status: 0,
        statusText: 'Network / Connection Error',
        latencyMs,
        timestamp,
        bodyText: JSON.stringify({ error: err.message || 'Failed to connect to RateGuard server.' }, null, 2),
        headers: { limit: '—', remaining: '—', retryAfter: '—', contentType: '—' },
        remainingQuota: '—',
        retryAfterSeconds: null,
        message: 'Could not reach server. Is RateGuard running on port 8080?'
      };
    }
  }

  function getStatusPhrase(statusCode) {
    switch (statusCode) {
      case 200: return 'OK';
      case 400: return 'Bad Request';
      case 404: return 'Not Found';
      case 405: return 'Method Not Allowed';
      case 429: return 'Too Many Requests';
      case 500: return 'Internal Server Error';
      default: return 'HTTP ' + statusCode;
    }
  }

  // --- UI Update Handlers ---

  function updateStatistics(record) {
    state.totalRequests++;
    if (record.status === 200) {
      state.successfulRequests++;
    } else if (record.status === 429) {
      state.rateLimitedRequests++;
    } else {
      state.errorRequests++;
    }

    setText(elements.statTotal, state.totalRequests);
    setText(elements.statSuccess, state.successfulRequests);
    setText(elements.statRateLimited, state.rateLimitedRequests);
    setText(elements.statErrors, state.errorRequests);

    if (record.remainingQuota !== '—') {
      setText(elements.statRemainingQuota, record.remainingQuota);
      setText(elements.statRemainingDesc, `Remaining Quota (${record.clientId})`);
    }

    // Trigger or update countdown if 429
    if (record.status === 429 && record.retryAfterSeconds && record.retryAfterSeconds > 0) {
      startCountdown(record.retryAfterSeconds);
    }
  }

  function updateInspector(record) {
    setText(elements.respEndpoint, record.endpoint);
    setText(elements.respStatusCode, record.status ? `${record.status} ${record.statusText}` : 'Failed (0)');
    setText(elements.respLatency, `${record.latencyMs} ms`);
    setText(elements.respTimestamp, formatTime(record.timestamp));

    setText(elements.hdrLimit, record.headers.limit);
    setText(elements.hdrRemaining, record.headers.remaining);
    setText(elements.hdrRetryAfter, record.headers.retryAfter);
    setText(elements.hdrContentType, record.headers.contentType);

    setText(elements.responseBodyViewer, formatJson(record.bodyText));

    // Update inspector badge
    const badge = elements.latestStatusBadge;
    badge.className = 'inspector-badge';
    if (record.status === 200) {
      badge.classList.add('badge-200');
      setText(badge, '200 OK — Permitted');
    } else if (record.status === 429) {
      badge.classList.add('badge-429');
      setText(badge, '429 — Rate Limited');
    } else if (record.status === 400) {
      badge.classList.add('badge-400');
      setText(badge, '400 — Bad Request');
    } else {
      badge.classList.add('badge-other');
      setText(badge, record.status ? `${record.status} ${record.statusText}` : 'Connection Failed');
    }
  }

  function appendHistoryRow(record) {
    // Hide empty row placeholder
    if (elements.emptyHistoryRow) {
      elements.emptyHistoryRow.style.display = 'none';
    }

    const tr = document.createElement('tr');
    tr.dataset.status = String(record.status);
    tr.dataset.clientId = record.clientId;

    // # index
    const tdIndex = document.createElement('td');
    setText(tdIndex, `#${state.totalRequests}`);
    tr.appendChild(tdIndex);

    // Time
    const tdTime = document.createElement('td');
    setText(tdTime, formatTime(record.timestamp));
    tr.appendChild(tdTime);

    // Client ID
    const tdClient = document.createElement('td');
    const codeClient = document.createElement('code');
    setText(codeClient, record.clientId || '(none)');
    tdClient.appendChild(codeClient);
    tr.appendChild(tdClient);

    // Status
    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    if (record.status === 200) {
      badge.classList.add('badge-200');
      setText(badge, '200 OK');
    } else if (record.status === 429) {
      badge.classList.add('badge-429');
      setText(badge, '429 Rate Limit');
    } else if (record.status === 400) {
      badge.classList.add('badge-400');
      setText(badge, '400 Bad Request');
    } else {
      badge.classList.add('badge-other');
      setText(badge, record.status ? `${record.status}` : 'Err');
    }
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    // Remaining
    const tdRemaining = document.createElement('td');
    setText(tdRemaining, record.remainingQuota !== '—' ? `${record.remainingQuota} / 5` : '—');
    tr.appendChild(tdRemaining);

    // Latency
    const tdLatency = document.createElement('td');
    setText(tdLatency, `${record.latencyMs} ms`);
    tr.appendChild(tdLatency);

    // Details / Message
    const tdMessage = document.createElement('td');
    let detailText = record.message;
    if (record.retryAfterSeconds) {
      detailText += ` (Retry-After: ${record.retryAfterSeconds}s)`;
    }
    setText(tdMessage, detailText);
    tr.appendChild(tdMessage);

    // Prepend to top of table body for instant visibility
    elements.historyTableBody.insertBefore(tr, elements.historyTableBody.firstChild);

    // Apply active filter to this new row
    applyFilter();
    updateHistoryCounter();
  }

  function updateHistoryCounter() {
    const totalEntries = elements.historyTableBody.querySelectorAll('tr:not(.empty-row)').length;
    setText(elements.historyCounter, `${totalEntries} entries`);
  }

  function applyFilter() {
    const filterVal = elements.filterStatus.value;
    const rows = elements.historyTableBody.querySelectorAll('tr:not(.empty-row)');

    rows.forEach(row => {
      const status = row.dataset.status;
      if (filterVal === 'ALL') {
        row.style.display = '';
      } else if (filterVal === '200' && status === '200') {
        row.style.display = '';
      } else if (filterVal === '429' && status === '429') {
        row.style.display = '';
      } else if (filterVal === 'ERROR' && status !== '200' && status !== '429') {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  }

  // --- Countdown Timer ---

  function startCountdown(seconds) {
    if (state.countdownTimerId) {
      clearInterval(state.countdownTimerId);
    }

    let remaining = seconds;
    elements.countdownBanner.classList.add('active');
    setText(elements.countdownSeconds, remaining);

    state.countdownTimerId = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(state.countdownTimerId);
        state.countdownTimerId = null;
        elements.countdownBanner.classList.remove('active');
        setText(elements.countdownSeconds, '0');
      } else {
        setText(elements.countdownSeconds, remaining);
      }
    }, 1000);
  }

  // --- Action Handlers ---

  async function handleSendSingle() {
    const clientId = elements.clientIdInput.value;

    // UI Loading state
    elements.btnSendSingle.disabled = true;
    elements.singleSpinner.classList.add('active');
    setText(elements.btnSendSingleText, 'Sending...');

    try {
      const record = await executeApiRequest('/api', clientId);
      updateStatistics(record);
      updateInspector(record);
      appendHistoryRow(record);
    } finally {
      elements.btnSendSingle.disabled = false;
      elements.singleSpinner.classList.remove('active');
      setText(elements.btnSendSingleText, 'Send Request');
    }
  }

  async function handleSendBatch() {
    const clientId = elements.clientIdInput.value;
    let count = parseInt(elements.batchCountInput.value, 10);
    const delay = parseInt(elements.batchDelayInput.value, 10) || 150;

    // Validation
    if (isNaN(count) || count < 1) count = 1;
    if (count > 100) count = 100;
    elements.batchCountInput.value = count;

    state.isBatchRunning = true;
    state.stopBatchRequested = false;

    // UI state for batch
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
        setText(elements.batchProgressText, `Stopped by user after ${i - 1} requests.`);
        break;
      }

      setText(elements.batchProgressText, `Request ${i} of ${count}...`);
      const pct = Math.round((i / count) * 100);
      elements.batchProgressBarFill.style.width = `${pct}%`;

      const record = await executeApiRequest('/api', clientId);
      updateStatistics(record);
      updateInspector(record);
      appendHistoryRow(record);

      if (i < count && !state.stopBatchRequested && delay > 0) {
        await sleep(delay);
      }
    }

    if (!state.stopBatchRequested) {
      setText(elements.batchProgressText, `Completed batch of ${count} requests.`);
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
    // Clear log rows while preserving the empty-row placeholder
    const rows = elements.historyTableBody.querySelectorAll('tr:not(.empty-row)');
    rows.forEach(r => r.remove());

    if (elements.emptyHistoryRow) {
      elements.emptyHistoryRow.style.display = '';
    }

    // Reset stats
    state.totalRequests = 0;
    state.successfulRequests = 0;
    state.rateLimitedRequests = 0;
    state.errorRequests = 0;

    setText(elements.statTotal, '0');
    setText(elements.statSuccess, '0');
    setText(elements.statRateLimited, '0');
    setText(elements.statErrors, '0');
    setText(elements.statRemainingQuota, '—');
    setText(elements.statRemainingDesc, 'Remaining Quota');
    setText(elements.historyCounter, '0 entries');

    if (state.countdownTimerId) {
      clearInterval(state.countdownTimerId);
      state.countdownTimerId = null;
      elements.countdownBanner.classList.remove('active');
    }
  }

  // --- Attach Event Listeners ---

  function setupEvents() {
    // Single & Batch dispatchers
    elements.btnSendSingle.addEventListener('click', handleSendSingle);
    elements.btnSendBatch.addEventListener('click', handleSendBatch);
    elements.btnStopBatch.addEventListener('click', handleStopBatch);
    elements.btnHealth.addEventListener('click', handleHealthCheck);
    elements.btnClearHistory.addEventListener('click', handleClearHistory);
    elements.filterStatus.addEventListener('change', applyFilter);

    // Keyboard trigger (Enter on Client ID sends single request)
    elements.clientIdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!elements.btnSendSingle.disabled) {
          handleSendSingle();
        }
      }
    });

    // Client Presets
    document.querySelectorAll('.preset-badge').forEach(badge => {
      badge.addEventListener('click', () => {
        const clientVal = badge.dataset.client;
        elements.clientIdInput.value = clientVal;
        elements.clientIdInput.focus();
      });
    });

    // Batch Presets
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
