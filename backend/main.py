from fastapi import FastAPI, HTTPException, File, UploadFile, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, timedelta
from realtime import sio_app
from database import get_connection
from textblob import TextBlob
import bcrypt, os, time
from ai_service import generate_ai_improved_transcript
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

# =========================================================
# APP SETUP
# =========================================================
app = FastAPI()
app.mount("/ws", sio_app)

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

class AnalysisCreate(BaseModel):
    session_id: str
    vocabulary_score: Optional[float] = None
    fluency_score: Optional[float] = None
    clarity_score: Optional[float] = None
    grammar_report: Optional[str] = None
    summary_report: Optional[str] = None
    recommendations: Optional[str] = None

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

    cur.execute("""
        INSERT INTO users (name, email, password)
        VALUES (%s, %s, %s)
        RETURNING id
    """, (user.name, user.email, hash_password(user.password)))

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
# PROFILE
# =========================================================
@app.get("/get-user/{user_id}")
def get_user(user_id: str):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT id, name, email, profile_image, streak_count
        FROM users WHERE id=%s
    """, (user_id,))
    user = cur.fetchone()
    if not user:
        raise HTTPException(404, "User not found")

    cur.execute("""
        SELECT COUNT(*), COALESCE(SUM(duration_seconds),0)
        FROM sessions WHERE user_id=%s
    """, (user_id,))
    total_sessions, speaking_minutes = cur.fetchone()

    cur.execute("""
        SELECT COUNT(DISTINCT session_at::date)
        FROM sessions
        WHERE user_id=%s AND session_at >= now() - interval '7 days'
    """, (user_id,))
    weekly_consistency = int((cur.fetchone()[0] / 7) * 100)

    cur.close()
    conn.close()

    return {
        "id": user[0],
        "name": user[1],
        "email": user[2],
        "profile_image": user[3],
        "streak_count": user[4],
        "total_sessions": total_sessions,
        "speaking_minutes": speaking_minutes,
        "weekly_consistency_percent": weekly_consistency,
    }

# =========================================================
# SESSION + AI + STREAK
# =========================================================
@app.post("/create-session")
def create_session(data: SessionCreate, bg: BackgroundTasks):
    conn = get_connection()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT last_session_date, streak_count
            FROM users WHERE id=%s
        """, (data.user_id,))
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

        cur.execute("""
            UPDATE users
            SET streak_count=%s, last_session_date=%s
            WHERE id=%s
        """, (new_streak, today, data.user_id))

        analysis = analyze_transcript(data.transcript or "")

        cur.execute("""
            INSERT INTO sessions
            (user_id, audio_url, transcript, duration_seconds, session_at,
             avg_wpm, filler_word_count, pronunciation_score, tone_score, grammar_score)
            VALUES (%s,%s,%s,%s,now(),%s,%s,%s,%s,%s)
            RETURNING id
        """, (
            data.user_id,
            data.audio_url,
            data.transcript,
            data.duration_seconds,
            data.avg_wpm,
            analysis["filler_word_count"],
            analysis["pronunciation_score"],
            analysis["tone_score"],
            analysis["grammar_score"]
        ))

        session_id = cur.fetchone()[0]

        cur.execute("""
            INSERT INTO analysis_report (session_id, created_at)
            VALUES (%s, now())
        """, (session_id,))

        conn.commit()

        # 🔥 BACKGROUND AI (Gemini)
        bg.add_task(
            process_ai,
            data.user_id,
            data.transcript or "",
            session_id
        )

        return {"session_id": session_id, "streak_count": new_streak}

    except Exception as e:
        conn.rollback()
        raise HTTPException(400, str(e))
    finally:
        cur.close()
        conn.close()

# =========================================================
# AI BACKGROUND TASK
# =========================================================
def process_ai(user_id: str, transcript: str, session_id: str):
    if not transcript or len(transcript.split()) < 15:
        return

    improved = generate_ai_improved_transcript(transcript, user_id)
    if not improved:
        return

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        UPDATE analysis_report
        SET summary_report=%s
        WHERE session_id=%s
    """, (improved, session_id))
    conn.commit()
    cur.close()
    conn.close()

# =========================================================
# LATEST REPORT
# =========================================================
@app.get("/get-latest-report/{user_id}")
def get_latest_report(user_id: str):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT id, transcript, avg_wpm, filler_word_count,
               pronunciation_score, tone_score
        FROM sessions
        WHERE user_id=%s
        ORDER BY session_at DESC
        LIMIT 1
    """, (user_id,))
    session = cur.fetchone()
    if not session:
        raise HTTPException(404, "No sessions")

    session_id = session[0]

    cur.execute("""
        SELECT vocabulary_score, fluency_score, clarity_score,
               grammar_report, summary_report, recommendations
        FROM analysis_report
        WHERE session_id=%s
    """, (session_id,))
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
        }
    }

# =========================================================
# CHART DATA
# =========================================================
@app.get("/report/trends/{user_id}")
def report_trends(user_id: str):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT avg_wpm, filler_word_count, grammar_score
        FROM sessions
        WHERE user_id=%s
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
# TRANSCRIPT ANALYSIS
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
