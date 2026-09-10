/**
 * AI Persona — admin panel JS.
 * Handles: API key validation, preview.
 */
(function () {
  'use strict';

  const apiKeyInput = document.getElementById('ai-persona-api-key');
  if (!apiKeyInput) return;

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

    try {
      const res = await fetch('/wp-json/ai-persona/v1/widget/config', {
        headers: { 'X-API-Key': key },
      });

      if (res.ok) {
        desc.textContent = '✓ API key valid — connected to AI Platform.';
        desc.style.color = '#00830f';
      } else {
        desc.textContent = '✗ Invalid API key.';
        desc.style.color = '#d63638';
      }
    } catch {
      desc.textContent = '⚠ Could not validate (network error).';
      desc.style.color = '#996800';
    }
  }
})();
