/**
 * popup.js — Popup Controller
 * Manages the UI state, communicates with background.js,
 * handles recording controls and real-time timer display.
 */

(function () {
  "use strict";

  // ── DOM Elements ────────────────────────────────────────────────────────────
  const btnStart = document.getElementById("btn-start");
  const btnStop = document.getElementById("btn-stop");
  const recStatus = document.getElementById("rec-status");
  const recTimer = document.getElementById("rec-timer");
  const recHint = document.getElementById("rec-hint");
  const recIndicator = document.getElementById("rec-indicator");
  const recordingCard = document.getElementById("recording-card");
  const toast = document.getElementById("toast");
  const infoLastSaved = document.getElementById("info-last-saved");
  const infoFormat = document.getElementById("info-format");
  const trackSection = document.getElementById("track-section");
  const trackList = document.getElementById("track-list");

  // ── State ───────────────────────────────────────────────────────────────────
  let isRecording = false;
  let startTime = null;
  let timerInterval = null;
  let toastTimeout = null;

  // ── Init ────────────────────────────────────────────────────────────────────
  async function init() {
    btnStart.addEventListener("click", onStartClick);
    btnStop.addEventListener("click", onStopClick);

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((msg) => {
      switch (msg.type) {
        case "RECORDING_COMPLETE":
          onRecordingComplete(msg);
          break;
        case "AUDIO_TRACKS_INFO":
          showAudioTracks(msg.tracks);
          break;
        case "MICROPHONE_READY":
          onMicrophoneReady(msg);
          break;
        case "MICROPHONE_PERMISSION_GRANTED":
          checkMicrophonePermission();
          break;
        default:
          break;
      }
    });

    // Check microphone permission status
    await checkMicrophonePermission();

    // Restore state from background
    console.log("[popup] Requesting current state from background...");
    const state = await sendToBackground({ type: "GET_STATE" });
    console.log("[popup] Current state:", state);
    
    if (state && state.isRecording) {
      console.log("[popup] Recording is active, updating UI...");
      applyState(state);
    } else {
      console.log("[popup] No active recording");
      setIdle();
    }
  }

  // ── Check Microphone Permission ─────────────────────────────────────────────
  async function checkMicrophonePermission() {
    const result = await chrome.storage.local.get('microphonePermissionGranted');
    
    if (result.microphonePermissionGranted) {
      console.log("[popup] ✅ Microphone permission granted");
      if (!isRecording) {
        recHint.textContent = "Ready to record both sides";
      }
    } else {
      console.log("[popup] ⚠️ Microphone permission NOT granted");
      if (!isRecording) {
        recHint.textContent = "Click Start to set up microphone permission";
      }
    }
    
    return result.microphonePermissionGranted || false;
  }

  // ── Start Recording ─────────────────────────────────────────────────────────
  async function onStartClick() {
    console.log("[POPUP] START BUTTON CLICKED");
    console.log("[START] clicked");
    console.log("[popup] ═══ Start Recording Clicked ═══");
    
    if (isRecording) {
      console.log("[popup] Already recording, ignoring");
      return;
    }

    btnStart.disabled = true;

    try {
      recStatus.textContent = "Connecting…";
      recHint.textContent = "Starting recording…";

      // Step 1: Find WhatsApp tab
      console.log("[popup] Step 1: Finding WhatsApp tab...");
      const tabs = await chrome.tabs.query({});
      const whatsappTab = tabs.find(t => t.url?.includes("web.whatsapp.com"));
      
      if (!whatsappTab) {
        throw new Error("Please open web.whatsapp.com in a tab first");
      }
      
      console.log("[popup] ✅ Found WhatsApp tab:", whatsappTab.id);

      // Step 2: Start recording
      console.log("[popup] Step 2: Sending START_RECORDING to background...");
      console.log("[POPUP] SENDING START_RECORDING");
      const resp = await sendToBackground({
        type: "START_RECORDING",
        tabId: whatsappTab.id,
      });
      
      console.log("[POPUP] START_RECORDING RESPONSE:", resp);
      console.log("[popup] Response received:", resp);

      if (!resp?.ok && !resp?.success) {
        throw new Error(resp?.error || "Failed to start recording");
      }

      // Step 3: Update UI
      setRecording();
      
      console.log("[popup] ═══════════════════════════════");
      
      // Check if we have both voices
      if (resp.micTracks >= 1 && resp.tabTracks >= 1 && resp.mixedTracks >= 1) {
        console.log("[popup] 🎬 Recording BOTH voices");
        console.log("[popup]    ✅ Your microphone (tracks:", resp.micTracks, ")");
        console.log("[popup]    ✅ Remote person (tracks:", resp.tabTracks, ")");
        console.log("[popup]    ✅ Mixed stream (tracks:", resp.mixedTracks, ")");
        showToast("⏺ Recording both voices");
        recHint.textContent = "Recording: Both voices";
      } else {
        console.log("[popup] ⚠️ Recording configuration incomplete");
        console.log("[popup]    micTracks:", resp.micTracks);
        console.log("[popup]    tabTracks:", resp.tabTracks);
        console.log("[popup]    mixedTracks:", resp.mixedTracks);
        showToast("⚠️ Recording error", true);
        recHint.textContent = "Recording: Configuration error";
      }
      console.log("[popup] ═══════════════════════════════");

    } catch (err) {
      console.error("[POPUP] START RECORDING ERROR:", err);
      console.error("[popup] ❌ Start error:", err);
      console.error("[popup] Error name:", err.name);
      console.error("[popup] Error message:", err.message);
      console.error("[popup] Error stack:", err.stack);
      showToast(`❌ ${err.message}`, true);
      setIdle();
    }
  }

  // ── Stop Recording ──────────────────────────────────────────────────────────
  async function onStopClick() {
    console.log("[popup] Stop Recording clicked");
    
    if (!isRecording) {
      console.log("[popup] Not recording, ignoring");
      return;
    }

    btnStop.disabled = true;
    recStatus.textContent = "Saving…";
    recHint.textContent = "Finalizing audio file…";

    try {
      const resp = await sendToBackground({ type: "STOP_RECORDING" });

      if (!resp?.ok && !resp?.success) {
        console.warn("[popup] Stop returned error:", resp?.error);
        // Don't throw - recording might complete anyway
      }

      console.log("[popup] Stop command sent successfully");

    } catch (err) {
      console.error("[popup] Stop error:", err);
      showToast(`❌ ${err.message}`, true);
      setIdle();
    }
  }

  // ── Recording Complete Handler ──────────────────────────────────────────────
  function onRecordingComplete(msg) {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const sizeKB = msg.size ? Math.round(msg.size / 1024) : "?";
    infoLastSaved.textContent = `${time} · ${sizeKB} KB`;
    infoLastSaved.className = "info-value good";

    setIdle();
    showToast(`✅ Saved: ${msg.filename}`);
  }

  // ── Microphone Ready Handler ────────────────────────────────────────────────
  function onMicrophoneReady(msg) {
    console.log("[popup] ═══════════════════════════════");
    console.log("[popup] MICROPHONE_READY received");
    console.log("[popup]    hasMic:", msg.hasMic);
    console.log("[popup]    micTrackCount:", msg.micTrackCount);
    console.log("[popup]    tabTrackCount:", msg.tabTrackCount);
    
    if (msg.hasMic && msg.micTrackCount >= 1 && msg.tabTrackCount >= 1) {
      console.log("[popup] 🎬 Recording BOTH voices");
      console.log("[popup]    ✅ Your microphone (", msg.micTrackCount, "tracks)");
      console.log("[popup]    ✅ Remote person (", msg.tabTrackCount, "tracks)");
      showToast("⏺ Recording both voices");
      recHint.textContent = "Recording: Both voices";
    } else {
      console.log("[popup] ⚠️ Recording configuration incomplete");
      console.log("[popup]    hasMic:", msg.hasMic);
      console.log("[popup]    micTrackCount:", msg.micTrackCount);
      console.log("[popup]    tabTrackCount:", msg.tabTrackCount);
      showToast("⚠️ Recording error", true);
      recHint.textContent = "Recording: Configuration error";
    }
    console.log("[popup] ═══════════════════════════════");
  }

  // ── UI State: Recording ─────────────────────────────────────────────────────
  function setRecording() {
    isRecording = true;
    startTime = Date.now();

    recordingCard.classList.add("active");
    recStatus.textContent = "Recording…";
    recIndicator.classList.add("visible");

    btnStart.disabled = true;
    btnStop.disabled = false;

    startTimer();
  }

  // ── UI State: Idle ──────────────────────────────────────────────────────────
  function setIdle() {
    isRecording = false;
    startTime = null;

    recordingCard.classList.remove("active");
    recStatus.textContent = "Ready to Record";
    recTimer.textContent = "00:00:00";
    recIndicator.classList.remove("visible");

    btnStart.disabled = false;
    btnStop.disabled = true;

    stopTimer();
    
    // Recheck permission status
    checkMicrophonePermission();
  }

  // ── Apply restored state ────────────────────────────────────────────────────
  function applyState(state) {
    if (state.isRecording) {
      isRecording = true;
      startTime = state.startTime;
      setRecording();
    }
  }

  // ── Timer ───────────────────────────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      if (!startTime) return;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      recTimer.textContent = formatTime(elapsed);
    }, 500);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  // ── Audio Track Display ─────────────────────────────────────────────────────
  function showAudioTracks(tracks) {
    if (!tracks || tracks.length === 0) return;

    trackSection.classList.remove("hidden");
    trackList.innerHTML = "";

    tracks.forEach((track, i) => {
      const item = document.createElement("div");
      item.className = "track-item";
      item.textContent = `[${i}] ${track.kind} · ${track.label || "unnamed"} · ${track.readyState}`;
      trackList.appendChild(item);
    });

    infoFormat.textContent = "audio/webm · opus · 128kbps";
  }

  // ── Toast ───────────────────────────────────────────────────────────────────
  function showToast(message, isError = false) {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toast.classList.remove("show");
    }

    toast.textContent = message;
    toast.className = `toast${isError ? " error-toast" : ""}`;

    void toast.offsetWidth;
    toast.classList.add("show");

    toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }

  // ── Utility ─────────────────────────────────────────────────────────────────
  function sendToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn("[popup] sendMessage error:", chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  init().catch(console.error);

})();
