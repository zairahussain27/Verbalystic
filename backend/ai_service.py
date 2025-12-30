import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

model = genai.GenerativeModel("gemini-1.5-flash")

def generate_ai_improved_transcript(transcript: str, user_id: str):
    """
    Improves grammar, clarity, and fluency of a speech transcript
    """

    if not transcript or len(transcript.split()) < 15:
        return None

    prompt = f"""
You are a speech improvement assistant.

Improve the following spoken transcript by:
- Fixing grammar mistakes
- Making sentences clearer and more fluent
- Keeping the original meaning
- NOT adding extra information
- NOT summarizing

Transcript:
\"\"\"{transcript}\"\"\"

Return ONLY the improved transcript.
"""

    try:
        response = model.generate_content(prompt)

        if not response or not response.text:
            return None

        return response.text.strip()

    except Exception as e:
        print("Gemini AI error:", e)
        return None
