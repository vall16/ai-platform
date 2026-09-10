/**
 * AI Persona Widget — frontend logic.
 * Handles: text chat, voice input (Web Speech API + WebSocket), avatar video.
 */
(function () {
  'use strict';

  const config = window.aiPersonaConfig;
  if (!config || !config.apiKey) return;

  const {
    widgetId,
    apiKey,
    avatarId,
    voiceId,
    language,
    personality,
    greeting,
    enableVoice,
    theme,
    apiBase,
  } = config;

  const el = document.getElementById(widgetId);
  if (!el) return;

  // --- State ---
  let sessionId = null;
  let ws = null;
  let mediaStream = null;
  let isRecording = false;
  let audioContext = null;

  // --- DOM Build ---
  el.innerHTML = `
    <div class="ai-persona-header">
      <div class="ai-persona-avatar-thumb">🤖</div>
      <div class="ai-persona-header-info">
        <div class="ai-persona-header-name">AI Assistant</div>
        <div class="ai-persona-header-status online">Online</div>
      </div>
    </div>
    <div class="ai-persona-avatar-area">
      <div class="ai-persona-avatar-placeholder">👤</div>
    </div>
    <div class="ai-persona-messages" role="log" aria-live="polite"></div>
    <div class="ai-persona-input-area">
      <input type="text" class="ai-persona-input" placeholder="Type a message..." aria-label="Message input" />
      ${enableVoice ? '<button class="ai-persona-btn mic" title="Voice input" aria-label="Toggle microphone">🎤</button>' : ''}
      <button class="ai-persona-btn send" title="Send" aria-label="Send message">➤</button>
    </div>
  `;

  const messagesEl = el.querySelector('.ai-persona-messages');
  const inputEl = el.querySelector('.ai-persona-input');
  const sendBtn = el.querySelector('.ai-persona-btn.send');
  const micBtn = el.querySelector('.ai-persona-btn.mic');
  const avatarArea = el.querySelector('.ai-persona-avatar-area');

  // --- Session Management ---
  async function startSession() {
    const res = await fetch(`${apiBase}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        product_type: 'persona',
        avatar_id: avatarId,
        voice_id: voiceId,
        language,
        personality,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to start session: ${res.status}`);
    }

    const data = await res.json();
    sessionId = data.session_id;
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

      // If voice is enabled, play the TTS audio.
      if (data.audio_url) {
        playAudio(data.audio_url);
      }
    } catch (err) {
      hideTyping();
      appendMessage('assistant', '⚠️ Sorry, I encountered an error. Please try again.');
      console.error('[AI Persona]', err);
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
    recognition.lang = language;
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
      console.error('[AI Persona] Speech error:', event.error);
      isRecording = false;
      micBtn.classList.remove('active');
    };

    micBtn.addEventListener('click', () => {
      if (isRecording) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });
  }

  // --- Avatar Video (WebSocket) ---
  async function connectAvatar() {
    if (!avatarId) return;

    try {
      const res = await fetch(`${apiBase}/api/v1/sessions/${sessionId}/avatar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ avatar_id: avatarId }),
      });

      if (!res.ok) return;

      const data = await res.json();
      if (data.stream_url) {
        const video = document.createElement('video');
        video.src = data.stream_url;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        avatarArea.innerHTML = '';
        avatarArea.appendChild(video);
      }
    } catch (err) {
      console.error('[AI Persona] Avatar connect failed:', err);
    }
  }

  // --- Audio Playback ---
  function playAudio(url) {
    const audio = new Audio(url);
    audio.play().catch(() => {});
  }

  // --- UI Helpers ---
  function appendMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `ai-persona-msg ${role}`;
    msg.textContent = text;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'ai-persona-msg assistant typing';
    typing.id = 'ai-persona-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const typing = document.getElementById('ai-persona-typing');
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
      appendMessage('assistant', greeting);
      connectAvatar();
      initVoice();
    } catch (err) {
      console.error('[AI Persona] Init failed:', err);
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
