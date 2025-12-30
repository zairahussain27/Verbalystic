console.log("profile.js loaded");

/* =========================
   SUPABASE INIT
   ========================= */
const SUPABASE_URL = "https://lbacierqszcgokimijtg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiYWNpZXJxc3pjZ29raW1panRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0ODEyMTEsImV4cCI6MjA3OTA1NzIxMX0.roI92a8edtAlHGL78effXlQ3XRCwAF2lGpBkyX4SQIE";

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);


const API_BASE = "http://127.0.0.1:8000";

/* =========================
   AUTH
   ========================= */
async function getAuthenticatedUser() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error || !data.session) {
    window.location.href = "login.html";
    return null;
  }

  return data.session.user;
}
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
   LOAD PROFILE
   ========================= */
async function loadProfile(user) {
  try {
    const res = await fetch(`${API_BASE}/get-user/${user.id}`);
    if (!res.ok) throw new Error("Profile fetch failed");

    const data = await res.json();

    // Sidebar
    document.getElementById("userName").innerText =
      data.name || "User";

    // Profile header
    document.getElementById("profileName").innerText =
      data.name || "—";
    document.getElementById("profileEmail").innerText =
      data.email || "—";

    // Stats
    document.getElementById("streakCount").innerText =
      `${data.streak_count || 0} Days`;

    document.getElementById("totalSessions").innerText =
      data.total_sessions || 0;

    document.getElementById("weeklyConsistency").innerText =
      `${data.weekly_consistency_percent || 0}%`;

    document.getElementById("speakingMinutes").innerText =
      data.speaking_minutes || 0;

  } catch (err) {
    console.error("Profile load error:", err);
    alert("Failed to load profile");
  }
}

/* =========================
   ROADMAP
   ========================= */
async function loadRoadmap(userId) {
  const container = document.getElementById("roadmapContainer");
  container.innerHTML = "";

  try {
    const res = await fetch(`${API_BASE}/get-roadmap/${userId}`);
    if (!res.ok) throw new Error("Roadmap fetch failed");

    const data = await res.json();

    if (!data.roadmap || data.roadmap.length === 0) {
      container.innerHTML =
        `<p class="text-sm text-gray-500">No roadmap available</p>`;
      return;
    }

    data.roadmap.forEach(item => {
      container.innerHTML += `
        <div class="border rounded-md p-4">
          <h4 class="font-semibold">${item.skill_focus}</h4>
          <p class="text-sm text-gray-600 mt-1">
            ${item.ai_recommendations || ""}
          </p>
          <p class="text-xs text-gray-500 mt-2">
            Status: ${item.progress_status || "—"}
          </p>
        </div>
      `;
    });

  } catch (err) {
    console.error("Roadmap error:", err);
    container.innerHTML =
      `<p class="text-sm text-red-500">Failed to load roadmap</p>`;
  }
}

/* =========================
   ACHIEVEMENTS
   ========================= */
async function loadAchievements(userId) {
  const container = document.getElementById("achievementsContainer");
  container.innerHTML = "";

  try {
    const res = await fetch(`${API_BASE}/get-achievements/${userId}`);
    if (!res.ok) throw new Error("Achievements fetch failed");

    const data = await res.json();

    if (!data.achievements || data.achievements.length === 0) {
      container.innerHTML =
        `<p class="text-sm text-gray-500">No achievements yet</p>`;
      return;
    }

    data.achievements.forEach(badge => {
      container.innerHTML += `
        <div class="flex flex-col items-center gap-2 border rounded-md p-4">
          <span class="material-symbols-outlined text-3xl text-blue-500">
            emoji_events
          </span>
          <p class="text-sm font-medium text-center">
            ${badge.name}
          </p>
        </div>
      `;
    });

  } catch (err) {
    console.error("Achievements error:", err);
    container.innerHTML =
      `<p class="text-sm text-red-500">Failed to load achievements</p>`;
  }
}

/* =========================
   LOGOUT
   ========================= */
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

/* =========================
   INIT
   ========================= */
(async function init() {
  const user = await getAuthenticatedUser();
  if (!user) return;

  await loadProfile(user);
  await loadRoadmap(user.id);
  await loadAchievements(user.id);
})();
