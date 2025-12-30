console.log("report.js loaded");

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

/* =========================
   LOAD USER (NAME + STREAK)
========================= */

async function loadUserInfo(user) {
  try {
    const res = await fetch(`http://127.0.0.1:8000/get-user/${user.id}`);
    if (!res.ok) return;

    const data = await res.json();
    console.log("User info:", data);

    const nameEl = document.getElementById("userName");
    if (nameEl) nameEl.innerText = data.name || "User";

    const streakEl = document.getElementById("streakCount");
    if (streakEl)
      streakEl.innerText = `${data.streak_count || 0} Day Streak`;

  } catch (err) {
    console.error("Failed to load user info", err);
  }
}

/* =========================
   PERFORMANCE CHART
========================= */

async function loadPerformanceChart(userId) {
  const canvas = document.getElementById("performanceChart");
  if (!canvas) return;

  try {
    const res = await fetch(
      `http://127.0.0.1:8000/report/trends/${userId}`
    );
    if (!res.ok) return;

    const data = await res.json();

    new Chart(canvas, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: "Grammar",
            data: data.grammar,
            borderColor: "#359EFF",
            tension: 0.4
          },
          {
            label: "Flow",
            data: data.flow,
            borderColor: "#10b981",
            tension: 0.4
          },
          {
            label: "Fillers",
            data: data.fillers,
            borderColor: "#f97316",
            tension: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true },
          x: { grid: { display: false } }
        }
      }
    });

  } catch (err) {
    console.error("Chart load failed", err);
  }
}

/* =========================
   LOAD LATEST REPORT
========================= */

async function loadLatestReport(userId) {
  try {
    const res = await fetch(
      `http://127.0.0.1:8000/get-latest-report/${userId}`
    );

    if (!res.ok) {
      console.warn("No report found");
      return;
    }

    const { session, analysis } = await res.json();

    /* ----- TRANSCRIPTS ----- */
    document.getElementById("rawTranscript").innerText =
      session?.transcript || "—";

    document.getElementById("improvedTranscript").innerText =
      analysis?.summary_report || "—";

    /* ----- GRAMMAR TABLE ----- */
    const grammarTable = document.getElementById("grammarTable");
    grammarTable.innerHTML = "";

    let issues = [];
    if (analysis?.grammar_report) {
      try {
        issues = JSON.parse(analysis.grammar_report);
      } catch {
        console.warn("Grammar report is not JSON");
      }
    }

    if (!issues.length) {
      grammarTable.innerHTML = `
        <tr>
          <td colspan="3" class="py-3 text-gray-500 text-center">
            No grammar issues found
          </td>
        </tr>`;
    } else {
      issues.forEach(i => {
        grammarTable.innerHTML += `
          <tr class="border-t">
            <td class="py-3">${i.issue}</td>
            <td class="py-3">${i.suggestion}</td>
            <td class="py-3">${i.errorCount}</td>
          </tr>`;
      });
    }

    /* ----- TIPS (STATIC FOR NOW) ----- */
    const tipsEl = document.getElementById("tipsContainer");
    tipsEl.innerHTML = `
      <div class="bg-white border rounded-xl p-4">
        <h4 class="font-semibold">Reduce Fillers</h4>
        <p class="text-sm text-gray-500">Pause instead of saying “um” or “like”.</p>
      </div>

      <div class="bg-white border rounded-xl p-4">
        <h4 class="font-semibold">Improve Flow</h4>
        <p class="text-sm text-gray-500">Practice sentence linking.</p>
      </div>

      <div class="bg-white border rounded-xl p-4">
        <h4 class="font-semibold">Grammar Focus</h4>
        <p class="text-sm text-gray-500">Watch verb tense consistency.</p>
      </div>
    `;

  } catch (err) {
    console.error("Report load failed", err);
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

  await loadUserInfo(user);
  await loadLatestReport(user.id);
  await loadPerformanceChart(user.id);
})();
