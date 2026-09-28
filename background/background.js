/**
 * background.js — Service Worker
 * Orchestrates tab audio capture and the offscreen document lifecycle.
 */

"use strict";

// ─── Recording State Machine ──────────────────────────────────────────────────
const RecordingState = {
  IDLE: 'idle',
  STARTING: 'starting',
  RECORDING: 'recording',
  STOPPING: 'stopping',
};

let recordingState = {
  state: RecordingState.IDLE,
  isRecording: false,
  startTime: null,
  tabId: null,
  streamId: null,
};

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[background] Received message:", msg.type, msg);
  
  switch (msg.type) {
    case "GET_STATE":
      sendResponse(recordingState);
      return;

    case "START_RECORDING":
      console.log("[BACKGROUND] RECEIVED START_RECORDING");
      handleStartRecording(msg.tabId).then(sendResponse);
      return true;

    case "STOP_RECORDING":
      handleStopRecording().then(sendResponse);
      return true;

    case "RECORDING_COMPLETE":
      handleRecordingComplete(msg.blob, msg.filename, msg.size).then(sendResponse);
      return true;

    case "RECORDING_ERROR":
      console.error("[background] Recording error from offscreen:", msg.error);
      recordingState = {
        state: RecordingState.IDLE,
        isRecording: false,
        startTime: null,
        tabId: null,
        streamId: null,
      };
      return;

    default:
      break;
  }
});

// ─── Start Recording ──────────────────────────────────────────────────────────
async function handleStartRecording(tabId) {
  console.log("[background] handleStartRecording called for tabId:", tabId);
  console.log("[background] Current state:", recordingState.state);
  
  // DIAGNOSTIC: Check microphone permission state
  const micPermission = await chrome.storage.local.get("microphonePermissionGranted");
  console.log("[background] MIC PERMISSION STATE:", micPermission);
  console.log("[background] START RECORDING");
  
  // Check state machine - prevent double-start
  if (recordingState.state !== RecordingState.IDLE) {
    console.log("[background] Cannot start - state is:", recordingState.state);
    return { ok: false, error: `Recording is ${recordingState.state}` };
  }

  // Get the ACTIVE tab - this is critical for activeTab permission
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  
  console.log("[background] active tab:", tab?.id, tab?.url);
  
  // Verify we have a valid tab
  if (!tab?.id) {
    console.error("[background] No active tab found");
    return { ok: false, error: "No active tab found" };
  }
  
  // Verify it's the WhatsApp Web tab
  if (!tab.url || !tab.url.includes("web.whatsapp.com")) {
    console.error("[background] Active tab is not WhatsApp Web:", tab.url);
    return { 
      ok: false, 
      error: "Please make sure WhatsApp Web is the active tab before starting recording" 
    };
  }
  
  // Use the active tab's ID (not the passed tabId)
  const targetTabId = tab.id;
  console.log("[background] target tab ID:", targetTabId);
  console.log("[background] target tab URL:", tab.url);
  
  // DIAGNOSTIC: Check activeTab permission
  const hasActiveTab = await chrome.permissions.contains({permissions: ["activeTab"]});
  console.log("[background] activeTab permission:", hasActiveTab);

  // Check if tab is already captured
  try {
    const capturedTabs = await chrome.tabCapture.getCapturedTabs();
    console.log("[background] Currently captured tabs:", capturedTabs);
    
    const alreadyCaptured = capturedTabs.find(t => t.tabId === targetTabId);
    if (alreadyCaptured) {
      console.log("[background] Tab is already captured, stopping previous capture...");
      // Clean up previous capture
      await closeOffscreen();
      // Wait a bit for cleanup
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    console.warn("[background] Could not check captured tabs:", err);
  }

  // Set state to STARTING
  recordingState.state = RecordingState.STARTING;

  try {
    console.log("[BACKGROUND] REQUESTING TAB STREAM ID");
    console.log("[background] Getting tab capture stream ID using getMediaStreamId...");
    console.log("[background] active tab ID:", targetTabId);
    console.log("[background] active tab URL:", tab.url);
    
    // Use getMediaStreamId with the active tab
    const streamId = await getTabCaptureStreamId(targetTabId);
    console.log("[BACKGROUND] TAB STREAM ID ACQUIRED");
    console.log("[background] ✅ Got streamId:", streamId);
    
    console.log("[background] Ensuring offscreen document...");
    await ensureOffscreenDocument();
    console.log("[background] ✅ Offscreen document ready");

    const filename = `whatsapp-call-${Date.now()}.webm`;
    console.log("[background] Filename:", filename);

    console.log("[BACKGROUND] SENDING START TO OFFSCREEN");
    console.log("[background] Forwarding to offscreen with streamId...");
    const startResp = await forwardToOffscreen({
      type: "OFFSCREEN_START",
      streamId,
      filename,
    });
    console.log("[background] Offscreen response:", startResp);

    if (!startResp?.ok && !startResp?.success) {
      recordingState.state = RecordingState.IDLE;
      await closeOffscreen();
      return { 
        success: false,
        ok: false, 
        error: startResp?.error || "Offscreen recorder failed to start",
        errorName: startResp?.errorName,
        errorMessage: startResp?.errorMessage
      };
    }

    // Update state to RECORDING
    recordingState = {
      state: RecordingState.RECORDING,
      isRecording: true,
      startTime: Date.now(),
      tabId: targetTabId,
      streamId,
    };
    
    console.log("[background] ✅ Recording started successfully");
    const finalResponse = { 
      success: true,
      ok: true,
      micTracks: startResp.micTracks || 0,
      tabTracks: startResp.tabTracks || 0,
      mixedTracks: startResp.mixedTracks || 0,
      bothVoices: startResp.bothVoices || false,
      hasMic: startResp.hasMic,
      hasTab: startResp.hasTab,
    };
    console.log("[background] Response to popup:", finalResponse);
    
    return finalResponse;

  } catch (err) {
    console.error("[background] startRecording error:", err);
    console.error("[background] tab capture failed:", err.name);
    console.error("[background] tab capture message:", err.message);
    console.error("[background] error stack:", err.stack);
    recordingState.state = RecordingState.IDLE;
    await closeOffscreen();
    return { 
      success: false,
      ok: false, 
      error: err.message,
      errorName: err.name
    };
  }
}

// ─── Stop Recording ───────────────────────────────────────────────────────────
async function handleStopRecording() {
  console.log("[background] handleStopRecording called");
  console.log("[background] Current state:", recordingState.state);
  
  if (recordingState.state !== RecordingState.RECORDING) {
    console.log("[background] Not currently recording, state is:", recordingState.state);
    return { ok: true, message: "No active recording to stop" };
  }

  recordingState.state = RecordingState.STOPPING;

  try {
    await forwardToOffscreen({ type: "OFFSCREEN_STOP" });
    return { ok: true, success: true };
  } catch (err) {
    console.error("[background] Stop error:", err);
    recordingState.state = RecordingState.IDLE;
    await closeOffscreen();
    return { ok: false, success: false, error: err.message };
  }
}

// ─── Recording Complete ───────────────────────────────────────────────────────
async function handleRecordingComplete(base64Data, filename, size) {
  console.log(`[background] Recording complete: ${filename} (${size} bytes)`);
  
  // Convert base64 back to a data URL for download
  const url = `data:audio/webm;base64,${base64Data}`;

  await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
  });
  
  // Notify popup
  chrome.runtime.sendMessage({ 
    type: "RECORDING_COMPLETE", 
    filename, 
    size 
  }).catch(() => {});
  
  // Reset state to IDLE
  recordingState = {
    state: RecordingState.IDLE,
    isRecording: false,
    startTime: null,
    tabId: null,
    streamId: null,
  };
  
  // Close offscreen after a delay
  setTimeout(() => {
    closeOffscreen();
  }, 1000);
}

// ─── Tab Capture ──────────────────────────────────────────────────────────────
function getTabCaptureStreamId(tabId) {
  return new Promise((resolve, reject) => {
    // Use getMediaStreamId for MV3
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, streamId => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!streamId) {
        reject(new Error("No streamId returned"));
      } else {
        resolve(streamId);
      }
    });
  });
}

// ─── Offscreen Document ───────────────────────────────────────────────────────
async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen/offscreen.html");
  
  // Check if offscreen document already exists using getContexts
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });
  
  if (existingContexts.length > 0) {
    console.log("[background] Offscreen document already exists");
    return;
  }

  console.log("[background] Creating new offscreen document...");
  await chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capture tab audio + microphone for WhatsApp call recording",
  });

  // Give offscreen doc time to register its message listener
  await new Promise(r => setTimeout(r, 300));
}

async function closeOffscreen() {
  try {
    const offscreenUrl = chrome.runtime.getURL("offscreen/offscreen.html");
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    
    if (existingContexts.length > 0) {
      await chrome.offscreen.closeDocument();
      console.log("[background] Offscreen document closed");
    }
  } catch (err) {
    console.warn("[background] Error closing offscreen:", err);
  }
}

// ─── Forward to Offscreen ─────────────────────────────────────────────────────
function forwardToOffscreen(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        console.warn("[background] forwardToOffscreen error:", chrome.runtime.lastError.message);
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

// ─── Startup ──────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log("[background] WhatsApp Call Notes installed.");
});
