console.log("Main.js (real-time) loaded");

/* =========================
   Supabase Initialization
   ========================= */

const SUPABASE_URL = "https://lbacierqszcgokimijtg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiYWNpZXJxc3pjZ29raW1panRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0ODEyMTEsImV4cCI6MjA3OTA1NzIxMX0.roI92a8edtAlHGL78effXlQ3XRCwAF2lGpBkyX4SQIE";

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);


/* =========================
   Config
   ========================= */

const SOCKET_URL = "http://127.0.0.1:8000";
const UPLOAD_AUDIO_URL = "http://127.0.0.1:8000/upload-audio";
const CREATE_SESSION_URL = "http://127.0.0.1:8000/create-session";

const FILLER_WORDS = ["um", "uh", "like", "you know", "so", "actually", "basically", "right"];

/* =========================
   Auth
   ========================= */

async function getAuthenticatedUser() {
    const { data: sessionData, error } = await supabaseClient.auth.getSession();

    if (error || !sessionData.session) {
        console.warn("No active Supabase session");
        window.location.href = "login.html";
        return null;
    }

    return sessionData.session.user;
}


/* =========================
   State
   ========================= */

let isRecording = false;
let audioContext = null;
let mediaStream = null;
let processorNode = null;
let sourceNode = null;
let socket = null;
let mediaRecorder = null;
let recordedChunks = [];
let sessionStartTs = null;
let totalWordsCount = 0;
let lastTranscript = "";
let liveWpm = 0;
let liveFillerCount = 0;
let decibelSmoothing = 0.85;
let CURRENT_USER = null;
let timerInterval = null;

/* =========================
   UI Elements
   ========================= */

const micButton = document.getElementById("micButton");
const decibelBar = document.getElementById("decibelBar");
const timerDisplay = document.getElementById("timerDisplay");
const suggestionText = document.getElementById("suggestionText");
const visualizerCircle = document.getElementById("visualizerCircle");
const micBg = document.getElementById("micBg");
const rippleContainer = document.getElementById("rippleContainer");

/* =========================
   Load User Info
   ========================= */
async function loadUserInfo(user) {
  try {
    const res = await fetch(`http://127.0.0.1:8000/get-user/${user.id}`);
    if (!res.ok) return;

    const data = await res.json();

    document.getElementById("userName").innerText =
      data.name || "User";

  } catch (err) {
    console.error("Failed to load user info", err);
  }
}



/* =========================
   Socket.IO Loader
   ========================= */

async function ensureSocketIoClient() {
    if (typeof io !== "undefined") return;
    await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.socket.io/4.7.2/socket.io.min.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Socket.IO load failed"));
        document.head.appendChild(s);
    });
}

/* =========================
   Audio Utils (unchanged)
   ========================= */

function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
}

function downsampleBuffer(buffer, inputSampleRate, outSampleRate) {
    if (outSampleRate === inputSampleRate) return buffer;
    const ratio = inputSampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Int16Array(newLength);
    let offsetResult = 0, offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffset = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffset && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult++] = (accum / count) * 0x7fff;
        offsetBuffer = nextOffset;
    }
    return result.buffer;
}

/* =========================
   UI Helpers
   ========================= */

function setMicActiveUI(active) {
  // Remove ALL possible gradient states
  micBg.classList.remove(
    "from-blue-600",
    "to-blue-400",
    "from-blue-700",
    "to-blue-500",
    "from-red-600",
    "to-red-400",
    "from-red-700",
    "to-red-500"
  );

  micButton.classList.remove(
    "shadow-blue-500/40",
    "shadow-red-500/40"
  );

  if (active) {
    // 🔴 RECORDING (RED)
    micBg.classList.add("from-red-600", "to-red-400");
    micButton.classList.add("shadow-red-500/40");

    // ❌ disable hover while recording
    micButton.onmouseenter = null;
    micButton.onmouseleave = null;
  } else {
    // 🔵 IDLE (BLUE)
    micBg.classList.add("from-blue-600", "to-blue-400");
    micButton.classList.add("shadow-blue-500/40");

    // ✅ hover effect (blue → darker blue)
    micButton.onmouseenter = () => {
      micBg.classList.replace("from-blue-600", "from-blue-700");
      micBg.classList.replace("to-blue-400", "to-blue-500");
    };

    micButton.onmouseleave = () => {
      micBg.classList.replace("from-blue-700", "from-blue-600");
      micBg.classList.replace("to-blue-500", "to-blue-400");
    };
  }
}





function updateTimer() {
    if (!isRecording || !sessionStartTs) {
        timerDisplay.innerText = "00:00";
        return;
    }
    const elapsed = Math.floor((Date.now() - sessionStartTs) / 1000);
    timerDisplay.innerText =
        `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}
function startTimerLoop() {
    stopTimerLoop();

    timerInterval = setInterval(updateTimer, 1000);
}

function stopTimerLoop() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

let smoothedDbPercent = 0;
function updateDecibelBar(rms) {
    let db = rms <= 1e-8 ? -100 : 20 * Math.log10(rms);
    let pct = Math.max(0, Math.min(1, (db + 100) / 100));
    smoothedDbPercent = smoothedDbPercent * decibelSmoothing + pct * (1 - decibelSmoothing);
    decibelBar.style.height = `${Math.round(smoothedDbPercent * 100)}%`;

    // 🔊 Animate middle circle with voice
    if (visualizerCircle) {
        const scale = 1 + smoothedDbPercent * 0.5;
        visualizerCircle.style.transform = `scale(${scale})`;
        visualizerCircle.style.boxShadow = `0 0 ${10 + smoothedDbPercent * 20}px rgba(59, 130, 246, ${0.3 + smoothedDbPercent * 0.7})`;
    }
}

function updateSuggestionText(text) {
    suggestionText.innerText = text;
}

/* =========================
   Socket Init
   ========================= */

async function initSocket() {
    await ensureSocketIoClient();

    socket = io(SOCKET_URL, {
        path: "/ws/socket.io",
        transports: ["websocket"],
    });

    socket.on("connect", () => {
        socket.emit("identify", { user_id: CURRENT_USER.id });
    });

    socket.on("live_transcript", ({ text }) => {
        lastTranscript = text || "";
        computeLocalStatsFromTranscript(lastTranscript);
    });

    socket.on("live_feedback", ({ suggestion, wpm, fillerCount }) => {
        updateSuggestionText(
            `${suggestion || ""} • WPM: ${Math.round(wpm || liveWpm)} • Fillers: ${fillerCount || liveFillerCount}`
        );
    });
}

/* =========================
   Local Analysis (unchanged)
   ========================= */

function computeLocalStatsFromTranscript(transcript) {
    if (!transcript) return;
    const words = transcript.trim().split(/\s+/);
    totalWordsCount = words.length;

    if (sessionStartTs) {
        const mins = (Date.now() - sessionStartTs) / 60000;
        liveWpm = Math.round(mins > 0 ? totalWordsCount / mins : 0);
    }

    let fillers = 0;
    for (const f of FILLER_WORDS) {
        fillers += (transcript.toLowerCase().match(new RegExp(`\\b${f}\\b`, "g")) || []).length;
    }
    liveFillerCount = fillers;

    let suggestion =
        liveWpm < 90 ? "Speak faster"
        : fillers > 2 ? "Reduce filler words"
        : "Good pace";

    updateSuggestionText(`${suggestion} • WPM: ${liveWpm} • Fillers: ${fillers}`);
}

/* =========================
   Start / Stop Recording
   ========================= */

async function startRecording() {
    if (isRecording) return;

    CURRENT_USER = await getAuthenticatedUser();
    if (!CURRENT_USER) return;

    await initSocket();

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = e => e.data.size && recordedChunks.push(e.data);
    mediaRecorder.start(1000);

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    sessionStartTs = Date.now();
    isRecording = true;
    startTimerLoop();
    setMicActiveUI(true);
    updateSuggestionText("Recording...");

    socket.emit("session_start", { user_id: CURRENT_USER.id });

    processorNode.onaudioprocess = e => {
        if (!isRecording) return;
        const input = e.inputBuffer.getChannelData(0);
        let rms = Math.sqrt(input.reduce((s, v) => s + v * v, 0) / input.length);
        updateDecibelBar(rms);

        const floatCopy = new Float32Array(input);
        const buf = audioContext.sampleRate === 16000
            ? floatTo16BitPCM(floatCopy)
            : downsampleBuffer(floatCopy, audioContext.sampleRate, 16000);

        socket.emit("audio_chunk_pcm", buf);
    };
}

async function stopRecording() {
    if (!isRecording) return;

    isRecording = false;
    stopTimerLoop();
    setMicActiveUI(false);
    updateSuggestionText("Processing...");

    mediaRecorder.stop();
    mediaStream.getTracks().forEach(t => t.stop());
    processorNode.disconnect();
    sourceNode.disconnect();
    audioContext.close();

    const duration = Math.floor((Date.now() - sessionStartTs) / 1000);
    const audioBlob = new Blob(recordedChunks, { type: "audio/webm" });

    const form = new FormData();
    form.append("file", audioBlob);
    form.append("user_id", CURRENT_USER.id);

    let audioUrl = null;
    try {
        const r = await fetch(UPLOAD_AUDIO_URL, { method: "POST", body: form });
        if (r.ok) audioUrl = (await r.json()).url;
    } catch {}

    await fetch(CREATE_SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            user_id: CURRENT_USER.id,
            audio_url: audioUrl,
            transcript: lastTranscript,
            duration_seconds: duration,
            avg_wpm: liveWpm,
            filler_word_count: liveFillerCount
        })
    });

    socket.emit("session_end", { user_id: CURRENT_USER.id });
    socket.disconnect();

    recordedChunks = [];
    sessionStartTs = null;
    updateTimer();
}

/* =========================
   Events
   ========================= */

micButton.addEventListener("click", () =>
    isRecording ? stopRecording() : startRecording()
);

window.addEventListener("beforeunload", () => isRecording && stopRecording());

/* =========================
   Init
   ========================= */

setMicActiveUI(false);
updateTimer();
updateSuggestionText("Click the mic to start a session.");

(async function init() {
  const user = await getAuthenticatedUser();
  if (!user) return;

  await loadUserInfo(user);
})();
