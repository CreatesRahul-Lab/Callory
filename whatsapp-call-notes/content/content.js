/**
 * content.js — Content Script (web.whatsapp.com)
 * Detects when a WhatsApp Web call is active and can access the page's MediaStreams
 */

(function () {
  "use strict";

  let inCall = false;
  let capturedStream = null;

  // Selectors that indicate an active WhatsApp Web call
  const CALL_SELECTORS = [
    '[data-testid="call-container"]',
    '[data-testid="voice-call-panel"]',
    '[data-testid="video-call-panel"]',
    ".__6N9sG",
    "._1CGVL",
    '[aria-label="Voice call"]',
    '[aria-label="Video call"]',
  ];

  function detectCall() {
    const active = CALL_SELECTORS.some((sel) => {
      try {
        return document.querySelector(sel) !== null;
      } catch {
        return false;
      }
    });

    if (active !== inCall) {
      inCall = active;
      chrome.runtime.sendMessage({
        type: "CALL_STATUS",
        inCall,
        url: window.location.href,
      }).catch(() => {});
      console.log(`[WA Call Notes] Call detected: ${inCall}`);
    }
  }

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_MIC_STREAM") {
      getMicrophoneStream().then(sendResponse);
      return true;
    }
  });

  // Function to get microphone stream from the page context
  async function getMicrophoneStream() {
    try {
      console.log("[content] Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      
      console.log("[content] Got microphone stream:", stream.id);
      capturedStream = stream;
      
      return {
        ok: true,
        streamId: stream.id,
        tracks: stream.getAudioTracks().map(t => ({
          id: t.id,
          label: t.label,
          kind: t.kind,
          enabled: t.enabled,
        })),
      };
    } catch (err) {
      console.error("[content] Microphone access error:", err);
      return {
        ok: false,
        error: err.message,
        errorName: err.name,
      };
    }
  }

  // Watch DOM for changes (WhatsApp is a SPA)
  const observer = new MutationObserver(() => {
    detectCall();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-testid", "aria-label"],
  });

  // Initial check
  detectCall();

  // Also poll lightly every 2s as a fallback
  setInterval(detectCall, 2000);

  console.log("[WA Call Notes] Content script loaded on web.whatsapp.com");
})();
