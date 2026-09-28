/**
 * permission.js
 * Handles microphone permission request from foreground extension page
 */

document.getElementById("allowMic").addEventListener("click", async () => {
    const button = document.getElementById("allowMic");
    const status = document.getElementById("status");

    button.disabled = true;
    button.textContent = "Requesting permission...";
    status.className = "status info";
    status.textContent = "Please allow microphone access in the browser prompt...";

    try {
        console.log("[PERMISSION] Requesting microphone access...");
        
        // REAL microphone request - must succeed here
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });

        const tracks = stream.getAudioTracks();
        
        console.log("[PERMISSION] SUCCESS");
        console.log("[PERMISSION] tracks:", tracks.length);
        console.log("[PERMISSION] state:", tracks[0]?.readyState);
        console.log("[PERMISSION] enabled:", tracks[0]?.enabled);
        console.log("[PERMISSION] label:", tracks[0]?.label);

        if (!tracks.length || tracks[0].readyState !== "live") {
            throw new Error("Microphone track is not live");
        }

        // Update UI
        status.className = "status success";
        status.innerHTML = `
            <strong>✅ Microphone Access Verified</strong><br>
            Track count: ${tracks.length}<br>
            Track state: ${tracks[0].readyState}<br>
            Track enabled: ${tracks[0].enabled}<br><br>
            <strong>KEEP THIS PAGE OPEN FOR TESTING</strong><br>
            Now go to WhatsApp Web and start recording.
        `;

        button.textContent = "✅ Microphone Verified";
        button.disabled = true;

        // KEEP STREAM ALIVE FOR TESTING - DO NOT STOP
        window.testMicStream = stream;
        console.log("[PERMISSION] Stream kept alive in window.testMicStream");

    } catch (error) {
        console.error("[PERMISSION] FAILED");
        console.error("[PERMISSION] name:", error.name);
        console.error("[PERMISSION] message:", error.message);
        console.error("[PERMISSION] stack:", error.stack);

        button.disabled = false;
        button.textContent = "🎙️ Try Again";

        // Show appropriate error message
        if (error.name === "NotAllowedError") {
            status.className = "status error";
            status.innerHTML = `
                <strong>❌ Permission Denied</strong><br>
                You clicked "Block" or dismissed the prompt.<br><br>
                <strong>To fix:</strong><br>
                1. Click the 🔒 icon in the address bar<br>
                2. Find "Microphone" and set it to "Allow"<br>
                3. Click "Try Again" above
            `;
        } else if (error.name === "NotFoundError") {
            status.className = "status error";
            status.innerHTML = `
                <strong>❌ No Microphone Found</strong><br>
                Your device doesn't have a microphone or it's not detected.<br>
                Please connect a microphone and try again.
            `;
        } else if (error.name === "NotReadableError") {
            status.className = "status error";
            status.innerHTML = `
                <strong>❌ Microphone In Use</strong><br>
                Your microphone is being used by another application.<br>
                Close other apps (Zoom, Skype, etc.) and try again.
            `;
        } else {
            status.className = "status error";
            status.innerHTML = `
                <strong>❌ Error: ${error.name}</strong><br>
                ${error.message}
            `;
        }
    }
});

// Check if microphone is already active
(async function checkMicrophoneStatus() {
    console.log("[PERMISSION] Page loaded");
    console.log("[PERMISSION] origin:", location.origin);
    console.log("[PERMISSION] pathname:", location.pathname);
})();
