# ============================================================
#  HygieNet Cloud Serverless API & Web Host (Vercel + Local)
# ============================================================

import os
import sys
from pathlib import Path

# Add project root to sys.path so backend module can be imported
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from flask import Flask, request, jsonify, send_from_directory, Response
from dotenv import load_dotenv
import backend.db as db

try:
    import api.static_content as static_content
except ImportError:
    try:
        import static_content
    except ImportError:
        static_content = None

load_dotenv(dotenv_path=BASE_DIR / ".env")

app = Flask(__name__, static_folder=None)

DEVICE_KEY = os.getenv("DEVICE_KEY", "hygienet_r4_sec_2026_x89")
DEFAULT_MONTHLY_LIMIT = int(os.getenv("MONTHLY_DEFAULT_LIMIT", "5"))
ADMIN_ID = os.getenv("ADMIN_ID", "admin").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123").strip()
REFILL_ID = os.getenv("REFILL_ID", "refill").strip()
REFILL_PASSWORD = os.getenv("REFILL_PASSWORD", "refill123").strip()

def verify_device_key(req):
    """
    Validates the X-Device-Key header to prevent unauthorized API calls.
    Web browser requests with 'X-Client: Web' or local simulator calls are allowed.
    """
    header_key = req.headers.get("X-Device-Key", "")
    client_type = req.headers.get("X-Client", "")
    if client_type == "WebSimulator":
        return True
    return header_key == DEVICE_KEY

# ------------------------------------------------------------
#  FRONTEND STATIC ROUTES (IN-MEMORY ZERO-404 BUNDLE)
# ------------------------------------------------------------

@app.route("/")
def index():
    pub_file = BASE_DIR / "public" / "index.html"
    if pub_file.exists():
        return send_from_directory(str(BASE_DIR / "public"), "index.html")
    api_pub = BASE_DIR / "api" / "public" / "index.html"
    if api_pub.exists():
        return send_from_directory(str(BASE_DIR / "api" / "public"), "index.html")
    if static_content and hasattr(static_content, "INDEX_HTML"):
        return Response(static_content.INDEX_HTML, mimetype="text/html")
    return "Not found", 404

@app.route("/style.css")
def style_css():
    pub_file = BASE_DIR / "public" / "style.css"
    if pub_file.exists():
        return send_from_directory(str(BASE_DIR / "public"), "style.css")
    api_pub = BASE_DIR / "api" / "public" / "style.css"
    if api_pub.exists():
        return send_from_directory(str(BASE_DIR / "api" / "public"), "style.css")
    if static_content and hasattr(static_content, "STYLE_CSS"):
        return Response(static_content.STYLE_CSS, mimetype="text/css")
    return "Not found", 404

@app.route("/app.js")
def app_js():
    pub_file = BASE_DIR / "public" / "app.js"
    if pub_file.exists():
        return send_from_directory(str(BASE_DIR / "public"), "app.js")
    api_pub = BASE_DIR / "api" / "public" / "app.js"
    if api_pub.exists():
        return send_from_directory(str(BASE_DIR / "api" / "public"), "app.js")
    if static_content and hasattr(static_content, "APP_JS"):
        return Response(static_content.APP_JS, mimetype="application/javascript")
    return "Not found", 404

@app.route("/manifest.json")
def manifest_json():
    pub_file = BASE_DIR / "public" / "manifest.json"
    if pub_file.exists():
        return send_from_directory(str(BASE_DIR / "public"), "manifest.json", mimetype="application/manifest+json")
    api_pub = BASE_DIR / "api" / "public" / "manifest.json"
    if api_pub.exists():
        return send_from_directory(str(BASE_DIR / "api" / "public"), "manifest.json", mimetype="application/manifest+json")
    return jsonify({
        "name": "HygieNet Cloud",
        "short_name": "HygieNet",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#090e1a",
        "theme_color": "#10b981"
    })

@app.route("/sw.js")
def service_worker():
    pub_file = BASE_DIR / "public" / "sw.js"
    if pub_file.exists():
        return send_from_directory(str(BASE_DIR / "public"), "sw.js", mimetype="application/javascript")
    api_pub = BASE_DIR / "api" / "public" / "sw.js"
    if api_pub.exists():
        return send_from_directory(str(BASE_DIR / "api" / "public"), "sw.js", mimetype="application/javascript")
    return Response("self.addEventListener('fetch', function(){});", mimetype="application/javascript")



# ------------------------------------------------------------
#  ARDUINO UNO R4 WIFI API ENDPOINTS
# ------------------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "online",
        "service": "HygieNet Cloud API",
        "database": db.get_connection_status()
    })

@app.route("/api/device/ping", methods=["POST"])
def device_ping():
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id", "hygienet-01")
    firmware = data.get("firmware", "2.0.0-R4")
    rssi = data.get("rssi", 0)

    db.update_device_ping(device_id, firmware, rssi)
    return jsonify({
        "status": "ack",
        "device_id": device_id,
        "server_time": db.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })

@app.route("/api/card/verify", methods=["GET", "POST"])
def verify_card():
    """
    Called by UNO R4 WiFi when an RFID card is tapped.
    Validates authorization, calculates remaining pads for the month,
    and instructs the R4 OLED on what to display.
    """
    if not verify_device_key(request):
        return jsonify({"authorized": False, "reason": "UNAUTHORIZED_DEVICE", "message": "Invalid Device Key"}), 401

    if request.method == "GET":
        uid = request.args.get("uid", "").strip().upper()
        device_id = request.args.get("device_id", "hygienet-01")
    else:
        data = request.get_json(silent=True) or {}
        uid = data.get("uid", "").strip().upper()
        device_id = data.get("device_id", "hygienet-01")

    if not uid:
        return jsonify({"authorized": False, "reason": "NO_UID", "message": "UID missing"}), 400

    user = db.get_user_by_uid(uid)

    if not user:
        # Log invalid card attempt
        db.log_transaction(uid, "Unknown", device_id, 0, "INVALID_CARD", 0)
        return jsonify({
            "authorized": False,
            "reason": "CARD_NOT_FOUND",
            "message": "Unregistered card. Contact admin.",
            "uid": uid
        })

    monthly_limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    extra_granted = user.get("emergency_extra_pads", 0)
    effective_limit = monthly_limit + extra_granted
    used_pads = user.get("used_pads", 0)
    remaining = max(0, effective_limit - used_pads)

    if remaining <= 0:
        db.log_transaction(uid, user.get("name", "Unknown"), device_id, 0, "DENIED_LIMIT_REACHED", 0)
        return jsonify({
            "authorized": False,
            "reason": "LIMIT_REACHED",
            "name": user.get("name", "User"),
            "used_pads": used_pads,
            "monthly_limit": monthly_limit,
            "emergency_extra_pads": extra_granted,
            "effective_limit": effective_limit,
            "remaining": 0,
            "message": "Monthly pad quota exhausted."
        })

    # Return authorization and allowable pad range
    return jsonify({
        "authorized": True,
        "name": user.get("name", "User"),
        "monthly_limit": monthly_limit,
        "emergency_extra_pads": extra_granted,
        "effective_limit": effective_limit,
        "used_pads": used_pads,
        "remaining": remaining,
        "max_selectable": min(remaining, 5) # Safe limit per transaction
    })

@app.route("/api/dispense/complete", methods=["POST"])
@app.route("/api/dispense/record", methods=["POST"])
def dispense_complete():
    """
    Called by UNO R4 WiFi after user presses CONFIRM button.
    Server deducts remaining pads atomically and commits transaction.
    """
    if not verify_device_key(request):
        return jsonify({"success": False, "reason": "UNAUTHORIZED_DEVICE"}), 401

    data = request.get_json(silent=True) or {}
    uid = data.get("uid", "").strip().upper()
    device_id = data.get("device_id", "hygienet-01")
    quantity = int(data.get("quantity", 1))

    if not uid or quantity <= 0:
        return jsonify({"success": False, "reason": "INVALID_PARAMS"}), 400

    result = db.record_dispense(uid, device_id, quantity)
    if result.get("success"):
        return jsonify(result), 200
    else:
        return jsonify(result), 400

# ------------------------------------------------------------
#  DASHBOARD & MANAGEMENT APIS
# ------------------------------------------------------------

@app.route("/api/dashboard/stats", methods=["GET"])
def dashboard_stats():
    stats = db.get_dashboard_summary()
    return jsonify(stats)

@app.route("/api/users", methods=["GET"])
def list_users():
    users = db.get_all_users()
    return jsonify(users)

@app.route("/api/users", methods=["POST"])
def save_user():
    data = request.get_json(silent=True) or {}
    uid = data.get("rfid_uid", "").strip().upper()
    name = data.get("name", "").strip()
    limit = int(data.get("monthly_limit", DEFAULT_MONTHLY_LIMIT))
    aadhaar = data.get("aadhaar_no", "").strip()

    if not uid or not name:
        return jsonify({"success": False, "message": "UID and Name are required."}), 400

    db.upsert_user(uid, name, limit, aadhaar)
    return jsonify({"success": True, "message": f"User {name} saved successfully."})

@app.route("/api/users/reset", methods=["POST"])
def reset_users():
    data = request.get_json(silent=True) or {}
    uid = data.get("rfid_uid")

    if uid:
        db.reset_user_monthly(uid)
        return jsonify({"success": True, "message": f"Reset limit for card {uid}"})
    else:
        db.reset_all_monthly()
        return jsonify({"success": True, "message": "All monthly limits reset to 0."})

@app.route("/api/transactions", methods=["GET"])
def list_transactions():
    limit = int(request.args.get("limit", 50))
    txs = db.get_recent_transactions(limit)
    return jsonify(txs)

@app.route("/api/transactions/clear", methods=["POST", "DELETE"])
def clear_all_tx_route():
    db.clear_all_transactions()
    return jsonify({"success": True, "message": "All transactions have been deleted."})

@app.after_request
def set_cache_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ------------------------------------------------------------
#  AI CHATBOT ENGINE (MENSTRUAL HYGIENE & MACHINE ASSISTANT)
# ------------------------------------------------------------

def generate_bot_reply(msg: str, lang: str = "en") -> str:
    m = msg.lower().strip()
    is_hindi = lang.startswith("hi") or any(word in m for word in [
        "hindi", "namaste", "pad", "mahina", "dard", "kaise", "istamal", "kya", "madad", "puchna", "batao", "pehno"
    ])

    if any(k in m for k in ["how often", "change", "replace", "how many hours", "kitne ghante", "kab badal", "कब बदल", "घंटे", "बदलें"]):
        if is_hindi:
            return (
                "🩸 **पैड कब बदलें?**\n\n"
                "• सेनेटरी पैड को हर **4 से 6 घंटे** में अवश्य बदलें, चाहे फ्लो कम ही क्यों न हो।\n"
                "• एक ही पैड को लंबे समय तक लगाने से बैक्टीरिया, रैशेज और इन्फेक्शन (UTI) का खतरा बढ़ता है।\n"
                "• भारी दिनों (Heavy flow) में इसे और जल्दी बदलें।"
            )
        return (
            "🩸 **How Often to Change Your Pad:**\n\n"
            "• Change your sanitary pad every **4 to 6 hours**, even if your flow seems light.\n"
            "• Wearing a pad for too long promotes bacterial growth, odor, rashes, and urinary tract infections (UTI).\n"
            "• On heavier days, inspect and replace it every 3 to 4 hours."
        )

    if any(k in m for k in ["cramp", "pain", "dard", "stomach", "relief", "pet dard", "दर्द", "कष्ट", "राहत", "क्रैम्प"]):
        if is_hindi:
            return (
                "🌿 **पीरियड्स के दर्द (क्रैम्प्स) से राहत के उपाय:**\n\n"
                "1. **गर्म सिकाई**: पेट के निचले हिस्से पर गर्म पानी की थैली (Hot water bottle) रखें।\n"
                "2. **गुनगुना पानी**: अदरक या अजवाइन का गुनगुना पानी मांसपेशियों को आराम देता है।\n"
                "3. **हल्की स्ट्रेचिंग**: बालासन (Child's Pose) कमर और पेट का दर्द कम करता है।\n"
                "4. **हाइड्रेशन**: दिन में 8–10 गिलास पानी पिएं।\n"
                "⚠️ यदि दर्द अत्यधिक असहनीय हो, तो डॉक्टर से संपर्क करें।"
            )
        return (
            "🌿 **Relief Tips for Menstrual Cramps:**\n\n"
            "1. **Heat Therapy**: Apply a warm heating pad or hot water bottle to your lower abdomen.\n"
            "2. **Warm Hydration**: Sip warm water or ginger tea to ease abdominal spasms.\n"
            "3. **Gentle Stretching**: Poses like Child's Pose (Balasana) relieve pelvic pressure.\n"
            "4. **Magnesium & Nutrients**: Bananas and leafy greens help soothe muscle contractions.\n"
            "⚠️ Consult a medical professional if pain is unusually severe."
        )

    if any(k in m for k in ["dispose", "throw", "dustbin", "flush", "fenk", "disposal", "फेंक", "निपटान", "कूड़ा", "डस्टबिन"]):
        if is_hindi:
            return (
                "🗑️ **पैड का सुरक्षित निपटान (Safe Disposal):**\n\n"
                "• **कभी भी फ्लश न करें**: सेनेटरी पैड टॉयलेट में न डालें, इससे पाइप जाम हो जाते हैं।\n"
                "• इस्तेमाल किए पैड को अखबार या कवर में अच्छी तरह लपेटें।\n"
                "• हमेशा ढक्कन वाले कूड़ेदान (Sanitary Bin) या भस्मीकरण यंत्र में डालें।\n"
                "• हाथ साबुन से धोना न भूलें।"
            )
        return (
            "🗑️ **Safe & Hygienic Pad Disposal:**\n\n"
            "• **Never flush pads**: Pads do not dissolve and will cause severe plumbing blockages.\n"
            "• Wrap the used pad tightly in newspaper or its replacement wrapper.\n"
            "• Dispose of it in a designated covered sanitary bin or incinerator.\n"
            "• Always wash your hands thoroughly with soap afterward."
        )

    if any(k in m for k in ["tracker", "cycle", "irregular", "ovulation", "date", "phase", "next period", "din", "मासिक", "चक्र", "ट्रैकर", "तारीख"]):
        if is_hindi:
            return (
                "📅 **मासिक धर्म चक्र और पीरियड ट्रैकर:**\n\n"
                "• एक सामान्य मासिक चक्र **21 से 35 दिन** (औसतन 28 दिन) का होता है।\n"
                "• आप HygieNet के **Period Tracker** में पिछले पीरियड की तारीख दर्ज कर अगले पीरियड का समय जान सकती हैं।\n"
                "• पीरियड से 2-3 दिन पहले ही मशीन से पैड्स कलेक्ट कर तैयार रहें!"
            )
        return (
            "📅 **Understanding Your Menstrual Cycle:**\n\n"
            "• A typical cycle lasts **21 to 35 days** (averaging 28 days).\n"
            "• **Menstrual Phase (Days 1–5)**: Active bleeding, rest and hygiene prioritized.\n"
            "• **Follicular & Ovulation (Days 6–16)**: Energy peaks, fertile window.\n"
            "• **Luteal Phase (Days 17–28)**: PMS may occur, preparing for next cycle.\n"
            "• Use our interactive **Period Tracker** below to log your date and receive pad readiness reminders!"
        )

    if any(k in m for k in ["machine", "dispense", "how to use", "vending", "collect", "button", "tap", "मशीन", "निकाल", "प्रयोग"]):
        if is_hindi:
            return (
                "⚙️ **HygieNet मशीन से पैड कैसे निकालें?**\n\n"
                "1. **कार्ड टैप करें**: अपना RFID कार्ड मशीन के स्कैनर पर लगाएं।\n"
                "2. **संख्या चुनें**: आगे लगे **+ / -** बटन से आवश्यक पैड संख्या चुनें।\n"
                "3. **CONFIRM दबाएं**: सर्वो मोटर पैड को नीचे ट्रे में निकाल देगी।\n"
                "4. **कलेक्ट करें**: ट्रे से सुरक्षित पैड प्राप्त करें!"
            )
        return (
            "⚙️ **How to Use the HygieNet Vending Machine:**\n\n"
            "1. **Tap Card**: Place your RFID card on the reader.\n"
            "2. **Select Quantity**: Press the **(+)** button on the panel to choose your pad count.\n"
            "3. **Press CONFIRM**: The dual-servo mechanism will drop the pads into the collection tray.\n"
            "4. **Collect**: Retrieve your sanitary pads safely from the dispenser hopper!"
        )

    if any(k in m for k in ["quota", "limit", "remaining", "how many", "points", "free", "कोटा", "बचे", "संख्या"]):
        if is_hindi:
            return (
                "📦 **पैड कोटा और आवंटन नियम:**\n\n"
                "• प्रत्येक पंजीकृत लाभार्थी को प्रति माह **5 पैड** का कोटा मिलता है।\n"
                "• यह कोटा हर महीने की शुरुआत में रीसेट होता है।\n"
                "• पोर्टल पर लॉगिन करके आप अपने बचे हुए पैड्स देख सकती हैं।"
            )
        return (
            "📦 **Pad Quota & Allocation:**\n\n"
            "• Each registered beneficiary receives an allocation (default **5 pads per month**).\n"
            "• Quotas renew every monthly cycle.\n"
            "• Check your live remaining balance anytime right on your Beneficiary Portal!"
        )

    if is_hindi:
        return (
            "नमस्ते! मैं **HygieBot** हूँ — आपकी स्वास्थ्य और HygieNet सहायता सहेली।\n\n"
            "आप मुझसे पूछ सकती हैं:\n"
            "• 'पैड कब बदलना चाहिए?'\n"
            "• 'पीरियड्स के दर्द से राहत के उपाय'\n"
            "• 'पैड का सही निपटान कैसे करें?'\n"
            "• 'मशीन से पैड कैसे निकालें?'\n\n"
            "बताइए, मैं आपकी क्या सहायता करूँ?"
        )
    return (
        "Hello! I am **HygieBot**, your menstrual health & HygieNet assistant.\n\n"
        "Feel free to ask me about:\n"
        "• 'When should I change my sanitary pad?'\n"
        "• 'Tips for menstrual cramps & pain relief'\n"
        "• 'Safe hygienic disposal guidelines'\n"
        "• 'How to track your cycle with the Period Tracker'\n"
        "• 'How to use the HygieNet vending machine'\n\n"
        "How can I help you today?"
    )

@app.route("/api/chat", methods=["POST"])
def ai_chat():
    data = request.get_json(silent=True) or {}
    message = data.get("message", "").strip()
    lang = data.get("lang", "en").lower()
    reply = generate_bot_reply(message, lang)
    return jsonify({"reply": reply})

@app.route("/api/user/<uid>/cycle", methods=["GET", "POST"])
def user_cycle_endpoint(uid):
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        last_date = data.get("last_period_date", "")
        cycle_len = int(data.get("cycle_length", 28))
        period_dur = int(data.get("period_duration", 5))
        ok = db.update_user_cycle(uid, last_date, cycle_len, period_dur)
        if ok:
            return jsonify({"success": True, "message": "Cycle tracker settings saved."})
        return jsonify({"success": False, "message": "Failed to save cycle settings."}), 400

    cycle = db.get_user_cycle(uid)
    return jsonify({"success": True, "cycle_data": cycle})

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}
    role = data.get("role", "").strip().lower()
    
    # Admin login check
    if role == "admin":
        admin_id = str(data.get("id", "")).strip()
        admin_pass = str(data.get("password", "")).strip()
        if admin_id == ADMIN_ID and admin_pass == ADMIN_PASSWORD:
            return jsonify({
                "success": True,
                "role": "admin",
                "name": "Administrator",
                "message": "Welcome, Administrator."
            })
        return jsonify({
            "success": False,
            "message": "Invalid Admin ID or Password."
        }), 401

    # Restock / Refill Staff login check
    if role == "refill":
        refill_id = str(data.get("id", "")).strip()
        refill_pass = str(data.get("password", "")).strip()
        if refill_id == REFILL_ID and refill_pass == REFILL_PASSWORD:
            return jsonify({
                "success": True,
                "role": "refill",
                "name": "Restock Attendant",
                "message": "Welcome, Restock Attendant."
            })
        return jsonify({
            "success": False,
            "message": "Invalid Restock Attendant ID or Password."
        }), 401
    
    # Beneficiary / User login check
    user_uid = str(data.get("uid") or data.get("id", "")).strip().upper()
    if not user_uid:
        return jsonify({"success": False, "message": "Please enter a valid RFID Card UID."}), 400
    
    user = db.get_user_by_uid(user_uid)
    if not user:
        return jsonify({"success": False, "message": f"Beneficiary card '{user_uid}' is not registered."}), 404
    
    actual_uid = user.get("rfid_uid", user_uid)
    limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    extra = user.get("emergency_extra_pads", 0)
    effective_limit = limit + extra
    used = user.get("used_pads", 0)
    remaining = max(0, effective_limit - used)
    cycle = db.get_user_cycle(actual_uid)
    
    return jsonify({
        "success": True,
        "role": "user",
        "user": {
            "name": user.get("name", "Beneficiary"),
            "rfid_uid": actual_uid,
            "monthly_limit": limit,
            "emergency_extra_pads": extra,
            "effective_limit": effective_limit,
            "used_pads": used,
            "remaining": remaining,
            "active": user.get("active", True),
            "last_dispensed_at": str(user.get("last_dispensed_at", "")),
            "cycle_data": cycle
        },
        "message": f"Welcome back, {user.get('name', 'Beneficiary')}."
    })

@app.route("/api/user/<uid>", methods=["GET"])
def get_user_profile(uid):
    user = db.get_user_by_uid(uid)
    if not user:
        return jsonify({"success": False, "message": "Beneficiary not found"}), 404
    
    actual_uid = user.get("rfid_uid", uid)
    limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    extra = user.get("emergency_extra_pads", 0)
    effective_limit = limit + extra
    used = user.get("used_pads", 0)
    remaining = max(0, effective_limit - used)
    cycle = db.get_user_cycle(actual_uid)
    return jsonify({
        "success": True,
        "user": {
            "name": user.get("name", "Beneficiary"),
            "rfid_uid": actual_uid,
            "monthly_limit": limit,
            "emergency_extra_pads": extra,
            "effective_limit": effective_limit,
            "used_pads": used,
            "remaining": remaining,
            "active": user.get("active", True),
            "last_dispensed_at": str(user.get("last_dispensed_at", "")),
            "cycle_data": cycle
        }
    })


@app.route("/api/user/<uid>/transactions", methods=["GET"])
def get_user_transactions(uid):
    uid = uid.strip().upper()
    limit = int(request.args.get("limit", 20))
    txs = db.get_user_transactions(uid, limit)
    return jsonify(txs)

@app.route("/api/users/<path:uid>", methods=["PUT"])
@app.route("/api/users/<uid>", methods=["PUT"])
@app.route("/api/users/update", methods=["POST"])
@app.route("/api/users/<path:uid>/update", methods=["POST"])
@app.route("/api/users/<uid>/update", methods=["POST"])
def update_user_details(uid=None):
    import urllib.parse
    data = request.get_json(silent=True) or {}
    raw_uid = data.get("rfid_uid") or uid or ""
    clean_uid = urllib.parse.unquote(str(raw_uid)).strip().upper()
    name = data.get("name", "").strip()
    limit = int(data.get("monthly_limit", DEFAULT_MONTHLY_LIMIT))
    aadhaar = data.get("aadhaar_no", "").strip()
    
    if not clean_uid or not name:
        return jsonify({"success": False, "message": "UID and Name are required."}), 400
        
    ok = db.update_user(clean_uid, name, limit, aadhaar)
    if ok:
        return jsonify({"success": True, "message": f"Beneficiary {name} updated successfully."})
    return jsonify({"success": False, "message": "Failed to update beneficiary."}), 400

@app.route("/api/users/<path:uid>", methods=["DELETE"])
@app.route("/api/users/<uid>", methods=["DELETE"])
@app.route("/api/users/delete", methods=["POST"])
@app.route("/api/users/<path:uid>/delete", methods=["POST"])
@app.route("/api/users/<uid>/delete", methods=["POST"])
def delete_user_record(uid=None):
    import urllib.parse
    data = request.get_json(silent=True) or {}
    raw_uid = data.get("rfid_uid") or uid or ""
    clean_uid = urllib.parse.unquote(str(raw_uid)).strip().upper()
    if not clean_uid:
        return jsonify({"success": False, "message": "UID is required."}), 400
    ok = db.delete_user(clean_uid)
    if ok:
        return jsonify({"success": True, "message": f"Beneficiary card {clean_uid} deleted successfully."})
    return jsonify({"success": False, "message": "Beneficiary not found or could not be deleted."}), 404

# ============================================================
#  HOPPER, REFILL STAFF, EMERGENCY & REGISTRATION ENDPOINTS
# ============================================================

@app.route("/api/hopper", methods=["GET"])
def get_hopper():
    status = db.get_hopper_status()
    if isinstance(status, dict):
        status.setdefault("success", True)
    return jsonify(status)

@app.route("/api/admin/hopper/refill", methods=["POST"])
def admin_refill_hopper():
    data = request.get_json(silent=True) or {}
    stock = int(data.get("amount", 50))
    res = db.update_hopper_stock(stock, is_refill=True)
    return jsonify({"success": True, "hopper": res, "message": f"Hopper stock updated to {stock} pads."})

@app.route("/api/refill/submit", methods=["POST"])
def submit_refill():
    data = request.get_json(silent=True) or {}
    attendant = (data.get("staff_name") or data.get("attendant_name") or "Restock Attendant").strip()
    qty = int(data.get("quantity_added", 50))
    photos = data.get("photos", [])
    if not photos:
        if data.get("photo_hopper_base64"):
            photos.append(data.get("photo_hopper_base64"))
        if data.get("photo_tray_base64"):
            photos.append(data.get("photo_tray_base64"))
    notes = (data.get("remarks") or data.get("notes") or "").strip()

    if qty <= 0:
        return jsonify({"success": False, "message": "Quantity added must be greater than 0."}), 400

    res = db.create_refill_log(attendant, qty, photos, notes)
    if isinstance(res, dict) and "refill_id" not in res:
        log_obj = res.get("log", {})
        res["refill_id"] = str(log_obj.get("_id", ""))
    return jsonify(res)

@app.route("/api/admin/refills", methods=["GET"])
def list_refill_logs():
    status = request.args.get("status")
    logs = db.get_refill_logs(status)
    if isinstance(logs, list):
        return jsonify({"success": True, "refills": logs})
    return jsonify(logs)

@app.route("/api/admin/refills/<id>/verify", methods=["POST"])
def verify_refill(id):
    data = request.get_json(silent=True) or {}
    action = data.get("action", "approve").lower()
    res = db.verify_refill_log(id, action)
    return jsonify(res)

@app.route("/api/admin/refills/<id>", methods=["DELETE"])
@app.route("/api/admin/refills/<id>/delete", methods=["POST"])
def delete_refill_route(id):
    ok = db.delete_refill_log(id)
    if ok:
        return jsonify({"success": True, "message": "Restock submission deleted."})
    return jsonify({"success": False, "message": "Restock submission not found."}), 404

@app.route("/api/admin/refills/clear", methods=["POST"])
def clear_refills_route():
    ok = db.clear_all_refill_logs()
    if ok:
        return jsonify({"success": True, "message": "All restock submissions cleared."})
    return jsonify({"success": False, "message": "Failed to clear restock submissions."}), 500

@app.route("/api/user/emergency-request", methods=["POST"])
def submit_emergency_request():
    data = request.get_json(silent=True) or {}
    uid = data.get("rfid_uid", "").strip()
    reason = (data.get("reason") or "Emergency pad needed on campus").strip()
    if not uid:
        return jsonify({"success": False, "message": "RFID Card UID is required."}), 400
    res = db.create_emergency_request(uid, reason)
    if isinstance(res, dict) and "request_id" not in res:
        req_obj = res.get("request", {})
        res["request_id"] = str(req_obj.get("_id", ""))
    return jsonify(res)

@app.route("/api/admin/emergency-requests", methods=["GET"])
def list_emergency_requests():
    status = request.args.get("status")
    reqs = db.get_emergency_requests(status)
    if isinstance(reqs, list):
        return jsonify({"success": True, "requests": reqs})
    return jsonify(reqs)

@app.route("/api/admin/emergency-requests/<id>/action", methods=["POST"])
def handle_emergency_request_action(id):
    data = request.get_json(silent=True) or {}
    action = data.get("action", "approve").lower()
    extra_pads = int(data.get("extra_pads", 1))
    res = db.resolve_emergency_request(id, action, extra_pads)
    return jsonify(res)

@app.route("/api/auth/register-request", methods=["POST"])
def register_student_request():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    aadhaar = data.get("aadhaar_no", "").strip()
    email = data.get("email", "").strip()

    if not name or not aadhaar or not email:
        return jsonify({"success": False, "message": "Name, Aadhaar Number, and Email are required."}), 400

    res = db.create_registration_request(name, aadhaar, email)
    if not res.get("success"):
        return jsonify(res), 400
    if isinstance(res, dict):
        res["dev_otp"] = res.get("otp")
    return jsonify(res)

@app.route("/api/auth/verify-registration-otp", methods=["POST"])
def verify_student_otp():
    data = request.get_json(silent=True) or {}
    req_id = data.get("request_id", "").strip()
    otp = data.get("otp", "").strip()

    if not req_id or not otp:
        return jsonify({"success": False, "message": "Request ID and OTP are required."}), 400

    res = db.verify_registration_otp(req_id, otp)
    if not res.get("success"):
        return jsonify(res), 400
    return jsonify(res)

@app.route("/api/admin/registration-requests", methods=["GET"])
def list_pending_registrations():
    reqs = db.get_pending_registrations()
    if isinstance(reqs, list):
        return jsonify({"success": True, "requests": reqs})
    return jsonify(reqs)

@app.route("/api/admin/registration-requests/<id>/allot", methods=["POST"])
def allot_card_to_student(id):
    data = request.get_json(silent=True) or {}
    rfid_uid = data.get("rfid_uid", "").strip()
    limit = int(data.get("monthly_limit", DEFAULT_MONTHLY_LIMIT))

    if not rfid_uid:
        return jsonify({"success": False, "message": "Please enter an RFID Card UID to allot."}), 400

    res = db.allot_rfid_card_to_student(id, rfid_uid, limit)
    return jsonify(res)

@app.route("/api/admin/registration-requests/<id>/reject", methods=["POST"])
@app.route("/api/admin/registration-requests/<id>", methods=["DELETE"])
def reject_registration_request_route(id):
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "Cancelled by administrator").strip()
    res = db.reject_registration_request(id, reason)
    return jsonify(res)

@app.route("/api/dashboard/monthly-summary", methods=["GET"])
def monthly_summary():
    from datetime import datetime
    now = datetime.now()
    month_names = {
        1: "January", 2: "February", 3: "March", 4: "April",
        5: "May", 6: "June", 7: "July", 8: "August",
        9: "September", 10: "October", 11: "November", 12: "December"
    }
    res = db.get_monthly_dispense_summary()
    return jsonify({
        "success": True,
        "current_month": now.month,
        "current_month_name": month_names.get(now.month, ""),
        "current_year": now.year,
        "monthly_summary": res
    })

@app.route("/api/admin/simulate-month-rollover", methods=["POST"])
def simulate_rollover():
    res = db.simulate_month_rollover()
    from datetime import datetime
    now = datetime.now()
    if isinstance(res, dict):
        res.setdefault("new_month", (now.month % 12) + 1)
    return jsonify(res)



# ------------------------------------------------------------
#  STATIC ASSET CATCH-ALL ROUTE
# ------------------------------------------------------------

@app.route("/<path:path>")
def static_proxy(path):
    if path == "style.css":
        return style_css()
    if path == "app.js":
        return app_js()
    return index()

# ------------------------------------------------------------
#  LOCAL LAUNCHER
# ------------------------------------------------------------


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print("=" * 60)
    print("  HygieNet Cloud Server Running!")
    print(f"  Local URL: http://localhost:{port}")
    print("  Vercel Serverless Ready")
    print("=" * 60)
    app.run(host="0.0.0.0", port=port, debug=False)
