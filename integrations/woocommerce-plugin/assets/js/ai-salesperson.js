/**
 * AI Salesperson Widget — frontend logic.
 * Handles: text chat, voice input (Web Speech API), product/checkout links.
 *
 * Shared by the WooCommerce plugin and the Shopify app. The host platform
 * injects `window.aiSalespersonConfig` before this script runs. The SaaS
 * backend performs all commerce calls (Shopify/Woo Admin API); this widget
 * only talks to the SaaS backend with a Bearer API key.
 */
(function () {
  'use strict';

  const config = window.aiSalespersonConfig;
  if (!config) return;

  const {
    widgetId,
    apiKey,
    apiBase,
    shopName,
    shopUrl,
    platform,
    currency,
    shopCredentials,
    language,
    personality,
    greeting,
    enableVoice,
  } = config;

  const el = document.getElementById(widgetId);
  if (!el) return;

  if (!apiKey || !apiBase) {
    el.innerHTML =
      '<div class="ai-salesperson-not-configured">AI Salesperson is not configured. ' +
      'Set the API Base URL and API Key in the settings.</div>';
    return;
  }

  // --- State ---
  let sessionId = null;
  let isRecording = false;

  // --- DOM Build ---
  el.innerHTML = `
    <div class="ai-salesperson-header">
      <div class="ai-salesperson-avatar-thumb">🛒</div>
      <div class="ai-salesperson-header-info">
        <div class="ai-salesperson-header-name">${escapeHtml(shopName || 'AI Salesperson')}</div>
        <div class="ai-salesperson-header-status online">Online</div>
      </div>
    </div>
    <div class="ai-salesperson-messages" role="log" aria-live="polite"></div>
    <div class="ai-salesperson-input-area">
      <input type="text" class="ai-salesperson-input" placeholder="Ask about products..." aria-label="Message input" />
      ${enableVoice ? '<button class="ai-salesperson-btn mic" title="Voice input" aria-label="Toggle microphone">🎤</button>' : ''}
      <button class="ai-salesperson-btn send" title="Send" aria-label="Send message">➤</button>
    </div>
  `;

  const messagesEl = el.querySelector('.ai-salesperson-messages');
  const inputEl = el.querySelector('.ai-salesperson-input');
  const sendBtn = el.querySelector('.ai-salesperson-btn.send');
  const micBtn = el.querySelector('.ai-salesperson-btn.mic');

  // --- Session Management ---
  async function startSession() {
    const body = {
      product_type: 'salesperson',
      shop_name: shopName,
      shop_url: shopUrl,
      platform: platform,
      currency: currency,
      shop_credentials: shopCredentials,
      language: language,
      personality: personality,
    };
    // Drop empty commerce fields so the backend sees a clean body.
    Object.keys(body).forEach((k) => {
      if (body[k] === undefined || body[k] === null || body[k] === '') delete body[k];
    });

    const res = await fetch(`${apiBase}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = `Failed to start session: ${res.status}`;
      try {
        const err = await res.json();
        if (err && err.error) detail += ` (${err.error})`;
      } catch (_) {
        /* non-JSON error body */
      }
      throw new Error(detail);
    }

    const data = await res.json();
    sessionId = data.session_id || data.id;
    return data;
  }

  // --- Text Chat ---
  async function sendMessage(text) {
    if (!text.trim() || !sessionId) return;

    appendMessage('user', text);
    inputEl.value = '';
    showTyping();

    try {
      const res = await fetch(`${apiBase}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        throw new Error(`Send failed: ${res.status}`);
      }

      const data = await res.json();
      hideTyping();
      appendMessage('assistant', data.reply);

      if (data.audio_url) {
        playAudio(data.audio_url);
      }
    } catch (err) {
      hideTyping();
      appendMessage('assistant', '⚠️ Sorry, I encountered an error. Please try again.');
      console.error('[AI Salesperson]', err);
    }
  }

  // --- Voice Input (Web Speech API for STT on client side) ---
  function initVoice() {
    if (!micBtn || !enableVoice) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micBtn.title = 'Speech recognition not supported in this browser';
      micBtn.disabled = true;
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language || 'en';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      isRecording = true;
      micBtn.classList.add('active');
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove('active');
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (event.results[event.results.length - 1].isFinal) {
        sendMessage(transcript.trim());
      } else {
        inputEl.value = transcript;
      }
    };

    recognition.onerror = (event) => {
      console.error('[AI Salesperson] Speech error:', event.error);
      isRecording = false;
      micBtn.classList.remove('active');
    };

    micBtn.addEventListener('click', () => {
      if (isRecording) recognition.stop();
      else recognition.start();
    });
  }

  // --- Audio Playback ---
  function playAudio(url) {
    const audio = new Audio(url);
    audio.play().catch(() => {});
  }

  // --- UI Helpers ---
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Render assistant text with URLs turned into clickable links (checkout/product).
  // Escape first, then only inject <a> tags — safe against LLM/user content.
  function renderRich(text) {
    return escapeHtml(text).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }

  function appendMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `ai-salesperson-msg ${role}`;
    if (role === 'assistant') {
      msg.innerHTML = renderRich(text);
    } else {
      msg.textContent = text;
    }
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'ai-salesperson-msg assistant typing';
    typing.id = 'ai-salesperson-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const typing = document.getElementById('ai-salesperson-typing');
    if (typing) typing.remove();
  }

  // --- Event Listeners ---
  sendBtn.addEventListener('click', () => sendMessage(inputEl.value));
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  // --- Init ---
  async function init() {
    try {
      await startSession();
      appendMessage(
        'assistant',
        greeting || "Hi! I'm your shopping assistant. What are you looking for?"
      );
      initVoice();
    } catch (err) {
      console.error('[AI Salesperson] Init failed:', err);
      appendMessage('assistant', '⚠️ Could not connect. Please check your configuration.');
    }
  }

  // Start when widget is visible (IntersectionObserver).
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        init();
        observer.disconnect();
      }
    },
    { threshold: 0.5 }
  );
  observer.observe(el);
})();
