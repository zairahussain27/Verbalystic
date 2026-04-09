# 🎤 VERBALYSTIC

**AI-Powered Public Speaking Coach**

---

## 📌 Overview

VERBALYSTIC is a web-based application designed to help users improve their public speaking skills through real-time AI-driven speech analysis. It evaluates speech based on parameters like fluency, pronunciation, and confidence, providing structured feedback to enhance communication skills.

---

## 🚀 Features

* 🎙️ Real-time speech recognition using Vosk
* 📊 AI-based feedback on speech performance
* 🧠 NLP analysis using TextBlob
* 📁 Audio upload and processing
* 🔐 User authentication (Login/Signup)
* 📈 Performance report generation
* ⚡ Interactive frontend with multiple pages

---

## 🛠️ Tech Stack

### **Frontend**

* HTML
* CSS
* JavaScript

### **Backend**

* Python (FastAPI)
* Uvicorn

### **AI & Processing**

* Vosk (Speech Recognition)
* TextBlob (NLP Analysis)
* Google Generative AI

---

## 📂 Project Structure

```
Verbalystic/
│
├── backend/
│   ├── main.py
│   ├── ai_service.py
│   ├── database.py
│   ├── realtime.py
│   ├── routes/
│   ├── vosk-model-small-en-us-0.15/
│   └── requirements.txt
│
├── frontend/
│   ├── index.html
│   ├── login.html
│   ├── signup.html
│   ├── main.html
│   ├── profile.html
│   ├── report.html
│   ├── setting.html
│   ├── *.js
│
└── .gitignore
```

---

## ⚙️ Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/TaniyaNagar/verbalystic.git
cd verbalystic
```

---

### 2. Backend Setup

```bash
cd backend
pip install -r requirements.txt
```

Run the server:

```bash
python main.py
```

Server will run at:

```
http://127.0.0.1:8000
```

---

### 3. Frontend Setup

Simply open:

```
frontend/index.html
```

in your browser.

---

## 🌐 Deployment

### Backend (Render)

* Create a Web Service
* Build Command:

```
pip install -r requirements.txt
```

* Start Command:

```
python main.py
```

---

### Frontend (Vercel)

* Upload only `frontend/` folder
* No build required
* Set root directory to `frontend`

---

## 📊 API Endpoints

| Endpoint   | Method | Description          |
| ---------- | ------ | -------------------- |
| `/`        | GET    | Check backend status |
| `/signup`  | POST   | User registration    |
| `/login`   | POST   | User login           |
| `/analyze` | POST   | Speech analysis      |

---

## ⚠️ Known Issues

* Large Vosk model increases deployment size
* Real-time audio streaming may vary based on network
* Google Generative AI package is deprecated (needs upgrade)

---

## 🔮 Future Improvements

* Advanced pronunciation scoring
* Real-time coaching suggestions
* Dashboard analytics
* Mobile compatibility
* Replace deprecated AI package

---

## 👥 Authors

* **Zaira Hussain**
* **Shreyansh Lakhotiya**
* **Taniya Nagar**

---

## 📄 License

This project is for academic and educational purposes.

---

## ⭐ Acknowledgements

* Vosk Speech Recognition
* TextBlob NLP
* FastAPI Community

---

> If this project helped you, consider giving it a ⭐ on GitHub.
