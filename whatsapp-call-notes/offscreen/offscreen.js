/**
 * offscreen.js — Offscreen Document
 * Captures tab audio + microphone, mixes them, and records with MediaRecorder.
 * Routes tab audio to speakers so user can hear the other person.
 */

(function () {
  "use strict";

  let mediaRecorder = null;
  let audioChunks = [];
  let currentFilename = "";
  let micStream = null;
  let tabStream = null;
  let audioContext = null;
  let destinationNode = null;
  let micSource = null;
  let remoteSource = null;

  // ─── Message Handler ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[offscreen] Received message:", msg.type);
    
    switch (msg.type) {
      case "OFFSCREEN_START":
        console.log("[OFFSCREEN] START_RECORDING RECEIVED");
        startRecording(msg.streamId, msg.filename).then(sendResponse);
        return true;

      case "OFFSCREEN_STOP":
        stopRecording().then(sendResponse);
        return true;

      default:
        break;
    }
  });

  // ─── Start Recording ─────────────────────────────────────────────────────────
  async function startRecording(streamId, filename) {
    console.log("[START] offscreen recording handler entered");
    console.log("[START] Offscreen startRecording called");
    console.log("[START] streamId:", streamId);
    console.log("[START] filename:", filename);
    
    try {
      console.log("[START] ═══ Starting Recording ═══");
      
      currentFilename = filename;
      audioChunks = [];

      // Step 1: Get tab audio using the streamId from tabCapture
      console.log("[START] Step 1: Getting tab audio stream...");
      console.log("[START] tab capture requested");
      tabStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
          },
        },
        video: false,
      });

      console.log("[START] tab stream acquired");
      const tabTracks = tabStream.getAudioTracks();
      console.log("[OFFSCREEN] TAB AUDIO ACQUIRED:", tabTracks.length);
      console.log("[START] ✅ Tab stream obtained");
      console.log("[START]    Tracks count:", tabTracks.length);
      if (tabTracks.length > 0) {
        console.log("[START]    Track[0] label:", tabTracks[0].label);
        console.log("[START]    Track[0] readyState:", tabTracks[0].readyState);
        console.log("[START]    Track[0] enabled:", tabTracks[0].enabled);
        console.log("[START]    Track[0] muted:", tabTracks[0].muted);
      }

      if (tabTracks.length === 0 || tabTracks[0].readyState !== 'live') {
        throw new Error("Tab audio track is not live");
      }

      // Step 2: Get microphone separately
      console.log("[START] Step 2: Getting microphone stream...");
      console.log("[START] REQUESTING ACTUAL MIC STREAM");
      console.log("[START] mic getUserMedia requested");
      console.log("[OFFSCREEN] REQUESTING MICROPHONE");
      
      try {
        // Use global micStream variable - DO NOT redeclare
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
        console.log("[OFFSCREEN] MICROPHONE ACQUIRED:", micStream.getAudioTracks().length);
        console.log("[START] MIC STREAM SUCCESS");
        console.log("[START] MIC TRACK COUNT:", micStream.getAudioTracks().length);
        console.log("[START] MIC TRACK STATE:", micStream.getAudioTracks()[0]?.readyState);
        console.log("[START] MIC TRACK ENABLED:", micStream.getAudioTracks()[0]?.enabled);
        
        const micTracks = micStream.getAudioTracks();
        console.log("[START] mic tracks:", micTracks.length);
        if (micTracks.length > 0) {
          console.log("[START]    Track[0] label:", micTracks[0].label);
          console.log("[START]    Track[0] muted:", micTracks[0].muted);
          console.log("[START] mic track state:", micTracks[0].readyState);
          console.log("[START] mic track enabled:", micTracks[0].enabled);
        }

        if (micTracks.length === 0 || micTracks[0].readyState !== 'live') {
          throw new Error("Microphone track is not live");
        }

      } catch (error) {
        console.error("[START] MIC STREAM FAILED");
        console.error("[START] ACTUAL MIC CAPTURE FAILED");
        console.error("[START] error.name:", error.name);
        console.error("[START] error.message:", error.message);
        console.error("[START] error.stack:", error.stack);
        console.error("[START] origin:", location.origin);
        console.error("[START] protocol:", location.protocol);
        console.error("[START] pathname:", location.pathname);
        
        if (error.name === 'NotAllowedError') {
          console.error("[START] → NotAllowedError: Microphone permission was denied");
          console.error("[START] → This means getUserMedia was blocked by the browser");
          console.error("[START] → Offscreen documents may have different permission context");
        } else if (error.name === 'NotFoundError') {
          console.error("[START] → No microphone device found");
        } else if (error.name === 'NotReadableError') {
          console.error("[START] → Microphone in use by another app");
        }
        
        // Stop tab stream before failing
        if (tabStream) {
          tabStream.getTracks().forEach(track => track.stop());
        }
        
        // DO NOT continue with remote-only recording - FAIL HARD
        return { 
          ok: false, 
          error: `Microphone failed: ${error.name} - ${error.message}`,
          errorName: error.name,
          errorMessage: error.message
        };
      }

      // Step 3: Create AudioContext
      console.log("[START] Step 3: Creating AudioContext...");
      audioContext = new AudioContext();
      console.log("[START] ✅ AudioContext created");
      console.log("[START]    State:", audioContext.state);
      console.log("[START]    Sample rate:", audioContext.sampleRate);

      // Step 4: Create source nodes
      console.log("[START] Step 4: Creating audio source nodes...");
      
      micSource = audioContext.createMediaStreamSource(micStream);
      console.log("[START] ✅ Microphone audio source created");
      
      remoteSource = audioContext.createMediaStreamSource(tabStream);
      console.log("[START] ✅ Tab audio source created");

      // Step 5: Create MediaStreamDestination for mixing
      console.log("[START] Step 5: Creating MediaStreamDestination...");
      destinationNode = audioContext.createMediaStreamDestination();
      console.log("[START] ✅ Destination node created");

      // Step 6: Connect audio graph
      console.log("[START] Step 6: Connecting audio graph...");
      
      // Connect microphone to destination (recording)
      micSource.connect(destinationNode);
      console.log("[START] ✅ Microphone connected to destination (recording)");
      
      // Connect tab audio to BOTH destination (recording) AND speakers (so user can hear)
      remoteSource.connect(destinationNode);
      console.log("[START] ✅ Tab audio connected to destination (recording)");
      
      remoteSource.connect(audioContext.destination);
      console.log("[START] ✅ Tab audio connected to speakers (user can hear WhatsApp call)");
      
      // Get the mixed stream
      const mixedStream = destinationNode.stream;
      
      // CRITICAL DIAGNOSTICS
      console.log("[START] offscreen recording handler entered");
      console.log("[OFFSCREEN] MIXED STREAM:", mixedStream.getAudioTracks().length);
      console.log("[START] ════════════════════════════════");
      console.log("[START] mic tracks:", micStream.getAudioTracks().length);
      console.log("[START] tab tracks:", tabStream.getAudioTracks().length);
      console.log("[START] mixed stream tracks:", mixedStream.getAudioTracks().length);
      console.log("[START] ════════════════════════════════");

      // Step 7: Verify destination stream
      console.log("[START] Step 7: Verifying mixed stream...");
      const recordTracks = mixedStream.getAudioTracks();
      console.log("[START] ✅ Mixed stream ready");
      console.log("[START]    Tracks count:", recordTracks.length);
      if (recordTracks.length > 0) {
        console.log("[START]    Track[0] label:", recordTracks[0].label);
        console.log("[START]    Track[0] readyState:", recordTracks[0].readyState);
        console.log("[START]    Track[0] enabled:", recordTracks[0].enabled);
      }

      if (recordTracks.length === 0 || recordTracks[0].readyState !== 'live') {
        throw new Error("Mixed stream has no live tracks");
      }

      // Step 8: Create MediaRecorder
      console.log("[START] Step 8: Creating MediaRecorder...");
      const mimeType = getSupportedMimeType();
      console.log("[START]    MIME type:", mimeType);

      mediaRecorder = new MediaRecorder(mixedStream, {
        mimeType: mimeType || "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000,
      });
      console.log("[START] MediaRecorder created");

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunks.push(event.data);
          console.log("[offscreen] 📦 Chunk received:", event.data.size, "bytes, total chunks:", audioChunks.length);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("[offscreen] ❌ MediaRecorder error:", event.error);
      };

      mediaRecorder.onstop = async () => {
        console.log("[offscreen] MediaRecorder stopped");
        await finalizeRecording();
      };

      console.log("[OFFSCREEN] STARTING MEDIA RECORDER");
      mediaRecorder.start(1000); // 1-second timeslice
      console.log("[OFFSCREEN] MEDIA RECORDER STARTED");
      console.log("[START] MediaRecorder started");
      console.log("[START]    State:", mediaRecorder.state);

      console.log("[START] ═══════════════════════════════════");
      console.log("[START] 🎬 RECORDING IN PROGRESS");
      console.log("[START]    Microphone: YES (your voice)");
      console.log("[START]    Tab audio: YES (remote person)");
      console.log("[START]    User can hear: YES (tab → speakers)");
      console.log("[START]    WhatsApp call: UNAFFECTED");
      console.log("[START] ═══════════════════════════════════");

      // Prepare response
      const response = {
        success: true,
        ok: true,
        micTracks: micStream.getAudioTracks().length,
        tabTracks: tabStream.getAudioTracks().length,
        mixedTracks: mixedStream.getAudioTracks().length,
        bothVoices: true,
        hasMic: true,
        hasTab: true
      };

      console.log("[START] Sending success response:", response);

      // Send notifications (fire and forget - don't wait for response)
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "MICROPHONE_READY",
          hasMic: true,
          micTrackCount: micStream.getAudioTracks().length,
          tabTrackCount: tabStream.getAudioTracks().length,
        }).catch(err => {
          console.log("[offscreen] Could not send MICROPHONE_READY (no listener):", err.message);
        });

        chrome.runtime.sendMessage({
          type: "AUDIO_TRACKS_INFO",
          tracks: recordTracks.map((t) => ({
            label: t.label,
            kind: t.kind,
            enabled: t.enabled,
            readyState: t.readyState,
          })),
          hasMic: true,
          hasTab: true,
        }).catch(err => {
          console.log("[offscreen] Could not send AUDIO_TRACKS_INFO (no listener):", err.message);
        });
      }, 100);

      return response;

    } catch (err) {
      console.error("[START] ❌ startRecording FAILED");
      console.error("[START]    Error:", err.message);
      console.error("[START]    Stack:", err.stack);
      cleanup();
      return { 
        success: false,
        ok: false, 
        error: err.message,
        errorName: err.name,
        errorStack: err.stack
      };
    }
  }

  // ─── Stop Recording ───────────────────────────────────────────────────────────
  async function stopRecording() {
    console.log("[offscreen] stopRecording called");
    
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      console.warn("[offscreen] MediaRecorder not active");
      return { ok: false, error: "MediaRecorder not active" };
    }

    mediaRecorder.stop();
    console.log("[offscreen] MediaRecorder.stop() called");
    
    return { ok: true };
  }

  // ─── Finalize & Send to Background ───────────────────────────────────────────
  async function finalizeRecording() {
    console.log("[offscreen] Finalizing recording...");
    console.log("[offscreen]    Total chunks:", audioChunks.length);
    
    if (audioChunks.length === 0) {
      console.error("[offscreen] ❌ No chunks recorded!");
      chrome.runtime.sendMessage({
        type: "RECORDING_ERROR",
        error: "No audio data was captured.",
      }).catch(() => { });
      cleanup();
      return;
    }

    const blob = new Blob(audioChunks, { type: "audio/webm" });
    console.log("[offscreen] ✅ Blob created, size:", blob.size, "bytes");

    const base64 = await blobToBase64(blob);
    console.log("[offscreen] ✅ Converted to base64");

    chrome.runtime.sendMessage({
      type: "RECORDING_COMPLETE",
      blob: base64,
      filename: currentFilename,
      size: blob.size,
    }).catch((err) => {
      console.error("[offscreen] Failed to send recording:", err);
    });

    cleanup();
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  function cleanup() {
    console.log("[offscreen] Cleaning up resources...");
    
    audioChunks = [];
    
    // Disconnect audio nodes
    if (micSource) {
      try {
        micSource.disconnect();
        console.log("[offscreen]    ✓ Mic source disconnected");
      } catch (e) {}
      micSource = null;
    }
    
    if (remoteSource) {
      try {
        remoteSource.disconnect();
        console.log("[offscreen]    ✓ Remote source disconnected");
      } catch (e) {}
      remoteSource = null;
    }
    
    destinationNode = null;
    
    // Stop all tracks
    if (tabStream) {
      tabStream.getTracks().forEach((track) => {
        track.stop();
        console.log("[offscreen]    ✓ Stopped tab track:", track.label);
      });
      tabStream = null;
    }
    
    if (micStream) {
      micStream.getTracks().forEach((track) => {
        track.stop();
        console.log("[offscreen]    ✓ Stopped mic track:", track.label);
      });
      micStream = null;
    }
    
    // Close audio context
    if (audioContext) {
      audioContext.close().then(() => {
        console.log("[offscreen]    ✓ AudioContext closed");
      }).catch(() => {});
      audioContext = null;
    }
    
    mediaRecorder = null;
    
    console.log("[offscreen] ✅ Cleanup complete");
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function getSupportedMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "";
  }

  console.log("[offscreen] Offscreen recorder document ready.");
})();
