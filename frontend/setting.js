console.log("setting.js loaded");

/* =========================
   SUPABASE INIT
   ========================= */

const SUPABASE_URL = "https://lbacierqszcgokimijtg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiYWNpZXJxc3pjZ29raW1panRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0ODEyMTEsImV4cCI6MjA3OTA1NzIxMX0.roI92a8edtAlHGL78effXlQ3XRCwAF2lGpBkyX4SQIE";

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
/* =========================
   AUTH
   ========================= */
async function getAuthenticatedUser() {
  const { data } = await supabaseClient.auth.getSession();

  if (!data.session) {
    window.location.href = "login.html";
    return null;
  }
  return data.session.user;
}

(async function init() {
  const { data } = await supabaseClient.auth.getSession();

  if (!data.session) {
    window.location.href = "login.html";
    return;
  }

  const user = data.session.user;

  await loadUserInfo(user); // ✅ SIDEBAR NAME
  await loadSettings();    // ✅ SETTINGS PANEL
})();

async function loadUserInfo(user) {
  try {
    const res = await fetch(`http://127.0.0.1:8000/get-user/${user.id}`);
    if (!res.ok) return;

    const data = await res.json();

    const nameEl = document.getElementById("userName");
    if (nameEl) nameEl.innerText = data.name || "User";

  } catch (err) {
    console.error("Failed to load user info", err);
  }
}

/* =========================
   LOAD SETTINGS (FAST)
   ========================= */
async function loadSettings() {
  const emailEl = document.getElementById("settingEmail");
  const nameEl = document.getElementById("settingName");
  const nameE2 = document.getElementById("userName");
  // Default placeholders (instant UI)
  emailEl.innerText = "—";
  nameEl.innerText = "Loading...";

  // Get auth session
  const { data, error } = await supabaseClient.auth.getSession();

  if (error || !data.session) {
    window.location.href = "login.html";
    return;
  }

  const user = data.session.user;

  /* ===== EMAIL (always instant) ===== */
  emailEl.innerText = user.email || "—";

  /* ===== NAME (priority order) ===== */
  // 1️⃣ Metadata → instant
  if (user.user_metadata?.name) {
    nameEl.innerText = user.user_metadata.name;
    return;
  }

  // 2️⃣ Backend → background fetch (NON-BLOCKING)
  fetch(`http://127.0.0.1:8000/get-user/${user.id}`)
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (data?.name) {
        nameEl.innerText = data.name;
      } else {
        nameEl.innerText = "—";
      }
    })
    .catch(() => {
      nameEl.innerText = "—";
    });
}

/* =========================
   CHANGE PASSWORD
   ========================= */
document
  .getElementById("changePasswordBtn")
  ?.addEventListener("click", async () => {
    const newPassword = prompt("Enter your new password:");
    if (!newPassword) return;

    const { error } = await supabaseClient.auth.updateUser({
      password: newPassword
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("Password updated successfully");
  });

/* =========================
   LOGOUT
   ========================= */
document
  .getElementById("logoutBtn")
  ?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  });

/* =========================
   INIT
   ========================= */
loadSettings();
