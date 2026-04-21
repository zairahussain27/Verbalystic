from fastapi import FastAPI, HTTPException, File, UploadFile, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, timedelta
import bcrypt, os, time
import uvicorn

from backend.realtime import sio_app
from backend.database import get_connection
from textblob import TextBlob

# =========================================================
# APP SETUP
# =========================================================
app = FastAPI()
app.mount("/ws", sio_app)

@app.get("/")
def root():
    return {"status": "Verbalystic backend running"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# PASSWORD UTILS
# =========================================================
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# =========================================================
# MODELS
# =========================================================
class UserSignup(BaseModel):
    name: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class SessionCreate(BaseModel):
    user_id: str
    audio_url: Optional[str] = None
    transcript: Optional[str] = None
    duration_seconds: Optional[int] = None
    avg_wpm: Optional[int] = None


# =========================================================
# AUTH
# =========================================================
@app.post("/register")
def register(user: UserSignup):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id FROM users WHERE email=%s", (user.email,))
    if cur.fetchone():
        raise HTTPException(400, "Email already exists")

    cur.execute(
        """
        INSERT INTO users (name, email, password)
        VALUES (%s, %s, %s)
        RETURNING id
        """,
        (user.name, user.email, hash_password(user.password)),
    )

    user_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"user_id": user_id}


@app.post("/login")
def login(data: UserLogin):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id, password FROM users WHERE email=%s", (data.email,))
    row = cur.fetchone()

    if not row or not verify_password(data.password, row[1]):
        raise HTTPException(401, "Invalid credentials")

    cur.close()
    conn.close()
    return {"user_id": row[0]}


# =========================================================
# SESSION + STREAK + AI
# =========================================================
@app.get("/get-user/{user_id}")
def get_user(user_id: str):
    conn = get_connection()
    cur = conn.cursor()

    # user basic info
    cur.execute("""
        SELECT name, email, streak_count
        FROM users
        WHERE id = %s
    """, (user_id,))
    user = cur.fetchone()

    if not user:
        raise HTTPException(404, "User not found")

    name, email, streak = user

    # total sessions + speaking minutes
    cur.execute("""
        SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0)
        FROM sessions
        WHERE user_id = %s
    """, (user_id,))
    total_sessions, speaking_seconds = cur.fetchone()

    # weekly consistency
    cur.execute("""
        SELECT COUNT(DISTINCT session_at::date)
        FROM sessions
        WHERE user_id = %s
          AND session_at >= now() - interval '7 days'
    """, (user_id,))
    active_days = cur.fetchone()[0]
    weekly_consistency = int((active_days / 7) * 100)

    cur.close()
    conn.close()

    return {
        "name": name,
        "email": email,
        "streak_count": streak or 0,
        "total_sessions": total_sessions,
        "weekly_consistency_percent": weekly_consistency,
        "speaking_minutes": speaking_seconds // 60
    }

@app.post("/create-session")
def create_session(data: SessionCreate, bg: BackgroundTasks):
    conn = get_connection()
    cur = conn.cursor()

    try:

        # ----- STREAK -----
        cur.execute(
            "SELECT last_session_date, streak_count FROM users WHERE id=%s",
            (data.user_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "User not found")

        last_date, streak = row
        today = date.today()
        streak = streak or 0

        if last_date == today:
            new_streak = streak
        elif last_date == today - timedelta(days=1):
            new_streak = streak + 1
        else:
            new_streak = 1

        cur.execute(
            """
            UPDATE users
            SET streak_count=%s, last_session_date=%s
            WHERE id=%s
            """,
            (new_streak, today, data.user_id),
        )

        # ----- LOCAL ANALYSIS -----
        analysis = analyze_transcript(data.transcript or "")

        cur.execute(
            """
            INSERT INTO sessions
            (user_id, audio_url, transcript, duration_seconds, session_at,
             avg_wpm, filler_word_count, pronunciation_score, tone_score, grammar_score)
            VALUES (%s,%s,%s,%s,now(),%s,%s,%s,%s,%s)
            RETURNING id
            """,
            (
                data.user_id,
                data.audio_url,
                data.transcript,
                data.duration_seconds,
                data.avg_wpm,
                analysis["filler_word_count"],
                analysis["pronunciation_score"],
                analysis["tone_score"],
                analysis["grammar_score"],
            ),
        )

        session_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO analysis_report (session_id, created_at) VALUES (%s, now())",
            (session_id,),
        )

        conn.commit()

        # 🔥 BACKGROUND AI (Gemini)
        # ✅ FIXED: correct arguments
        bg.add_task(
            process_ai,
            data.user_id,
            data.transcript or "",
            session_id,
        )

        return {"session_id": session_id, "streak_count": new_streak}

    except Exception as e:
        conn.rollback()
        raise HTTPException(400, str(e))
    finally:
        cur.close()
        conn.close()


# =========================================================
# AI BACKGROUND TASK (GEMINI)
# =========================================================
def ai_usage_count(user_id: str) -> int:
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT COUNT(*)
        FROM analysis_report ar
        JOIN sessions s ON ar.session_id = s.id
        WHERE s.user_id = %s
          AND ar.summary_report IS NOT NULL
    """, (user_id,))

    count = cur.fetchone()[0]
    cur.close()
    conn.close()
    return count

def process_ai(user_id: str, transcript: str, session_id: str):
    # ---- HARD LIMIT: 4 USES ----
    used = ai_usage_count(user_id)

    if used >= 4:
        print(f"AI LIMIT REACHED for user {user_id}")
        return

    if not transcript or len(transcript.split()) < 2:
        return

    try:
        improved = generate_ai_improved_transcript(transcript)
        if not improved:
            return

        conn = get_connection()
        cur = conn.cursor()
        cur.execute("""
            UPDATE analysis_report
            SET summary_report = %s
            WHERE session_id = %s
        """, (improved, session_id))
        conn.commit()

        print(f"AI USED {used + 1}/4")

    except Exception as e:
        print("AI ERROR:", e)

    finally:
        if "cur" in locals():
            cur.close()
        if "conn" in locals():
            conn.close()

# =========================================================
# LATEST REPORT
# =========================================================

@app.get("/get-latest-report/{user_id}")
def get_latest_report(user_id: str):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        """
        SELECT id, transcript, avg_wpm, filler_word_count,
               pronunciation_score, tone_score
        FROM sessions
        WHERE user_id=%s
        ORDER BY session_at DESC
        LIMIT 1
        """,
        (user_id,),
    )
    session = cur.fetchone()
    if not session:
        raise HTTPException(404, "No sessions")

    session_id = session[0]

    cur.execute(
        """
        SELECT vocabulary_score, fluency_score, clarity_score,
               grammar_report, summary_report, recommendations
        FROM analysis_report
        WHERE session_id=%s
        """,
        (session_id,),
    )
    analysis = cur.fetchone() or [None] * 6

    cur.close()
    conn.close()

    return {
        "session": {
            "transcript": session[1],
            "avg_wpm": session[2],
            "filler_word_count": session[3],
            "pronunciation_score": session[4],
            "tone_score": session[5],
        },
        "analysis": {
            "vocabulary_score": analysis[0],
            "fluency_score": analysis[1],
            "clarity_score": analysis[2],
            "grammar_report": analysis[3],
            "summary_report": analysis[4],
            "recommendations": analysis[5],
        },
    }

# =========================================================
# PERFORMANCE TRENDS (FOR REPORT CHART)
# =========================================================
@app.get("/report/trends/{user_id}")
def report_trends(user_id: str):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT avg_wpm, filler_word_count, grammar_score
        FROM sessions
        WHERE user_id = %s
        ORDER BY session_at DESC
        LIMIT 7
    """, (user_id,))

    rows = cur.fetchall()[::-1]

    cur.close()
    conn.close()

    return {
        "labels": [f"S{i+1}" for i in range(len(rows))],
        "grammar": [r[2] for r in rows],
        "flow": [r[0] for r in rows],
        "fillers": [r[1] for r in rows],
    }

# =========================================================
# AUDIO UPLOAD
# =========================================================
UPLOAD_DIR = "uploaded_audio"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...), user_id: str = Form(...)):
    path = f"{UPLOAD_DIR}/{user_id}_{int(time.time())}.webm"
    with open(path, "wb") as f:
        f.write(await file.read())
    return {"url": path}


# =========================================================
# LOCAL ANALYSIS
# =========================================================
def analyze_transcript(text: str):
    if not text:
        return dict.fromkeys(
            ["filler_word_count", "pronunciation_score", "tone_score", "grammar_score"], 0
        )

    fillers = ["um", "uh", "like", "you know", "basically"]
    filler_count = sum(text.lower().count(w) for w in fillers)

    words = text.split()
    pronunciation = round((len(set(words)) / (len(words) + 1)) * 100, 2)

    blob = TextBlob(text)
    tone = round((blob.sentiment.polarity + 1) * 50)
    grammar = round(100 - abs(blob.sentiment.subjectivity - 0.5) * 100)

    return {
        "filler_word_count": filler_count,
        "pronunciation_score": pronunciation,
        "tone_score": tone,
        "grammar_score": grammar,
    }

@app.get("/get-roadmap/{user_id}")
def get_roadmap(user_id: str):
    return { "roadmap": [] }


@app.get("/get-achievements/{user_id}")
def get_achievements(user_id: str):
    return { "achievements": [] }
