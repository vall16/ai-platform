/**
 * AI Persona — admin panel JS.
 * Handles: API key validation, preview.
 */
(function () {
  'use strict';

  const apiKeyInput = document.getElementById('ai-persona-api-key');
  if (!apiKeyInput) return;

  const apiBase = (window.aiPersonaAdmin && window.aiPersonaAdmin.apiBase) || '';
  let debounceTimer = null;

  apiKeyInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(validateKey, 1000);
  });

  async function validateKey() {
    const key = apiKeyInput.value.trim();
    const desc = apiKeyInput.closest('td').querySelector('.description');
    if (!desc) return;

    if (!key) {
      desc.textContent = 'Your AI Platform API key. Get it from the Control Room dashboard.';
      desc.style.color = '';
      return;
    }

    if (!apiBase) {
      desc.textContent = '⚠ Set the API Base URL first.';
      desc.style.color = '#996800';
      return;
    }

    try {
      const res = await fetch(apiBase + '/api/v1/sessions/active/count', {
        headers: { Authorization: 'Bearer ' + key },
      });

      if (res.ok) {
        desc.textContent = '✓ API key valid — connected to AI Platform.';
        desc.style.color = '#00830f';
      } else if (res.status === 401 || res.status === 403) {
        desc.textContent = '✗ Invalid API key or tenant not active.';
        desc.style.color = '#d63638';
      } else {
        desc.textContent = '✗ Backend error (HTTP ' + res.status + ').';
        desc.style.color = '#d63638';
      }
    } catch {
      desc.textContent = '⚠ Could not validate (network/CORS error).';
      desc.style.color = '#996800';
    }
  }
})();
