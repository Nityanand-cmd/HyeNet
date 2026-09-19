# ============================================================
#  HygieNet Cloud Edition - MongoDB Atlas Database Layer
# ============================================================

import os
from datetime import datetime, timezone
from dotenv import load_dotenv
import certifi
import pymongo
from pymongo.errors import PyMongoError

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "")
DEFAULT_MONTHLY_LIMIT = int(os.getenv("MONTHLY_DEFAULT_LIMIT", "5"))

_client = None
_db = None
_is_connected = False
_connection_error = None

# ============================================================
#  AADHAAR VERHOEFF CHECKSUM ALGORITHM & FORMATTING
# ============================================================

_verhoeff_d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
]

_verhoeff_p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
]

_verhoeff_inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]

def validate_verhoeff(num_str: str) -> bool:
    """
    Validates a 12-digit number using UIDAI's Verhoeff checksum algorithm.
    """
    clean = "".join(filter(str.isdigit, str(num_str or "")))
    if len(clean) != 12:
        return False
    c = 0
    for i, digit in enumerate(reversed(clean)):
        c = _verhoeff_d[c][_verhoeff_p[i % 8][int(digit)]]
    return c == 0

def format_aadhaar(num_str: str) -> str:
    clean = "".join(filter(str.isdigit, str(num_str or "")))
    if len(clean) == 12:
        return f"{clean[:4]} {clean[4:8]} {clean[8:]}"
    return clean

def mask_aadhaar(num_str: str) -> str:
    clean = "".join(filter(str.isdigit, str(num_str or "")))
    if len(clean) == 12:
        return f"XXXX-XXXX-{clean[8:]}"
    return str(num_str or "")

# Fallback in-memory store in case MongoDB Atlas credentials need updating
_fallback_users = {
    "C3:27:87:14": {"name": "Sunita Yadav", "monthly_limit": 5, "used_pads": 0, "active": True},
    "E3:A5:AE:02": {"name": "Anita Kumari", "monthly_limit": 5, "used_pads": 0, "active": True}
}
_fallback_transactions = []
_fallback_devices = {}

def get_db():
    global _client, _db, _is_connected, _connection_error
    if _db is not None and _is_connected:
        return _db

    if not MONGODB_URI:
        _is_connected = False
        _connection_error = "MONGODB_URI is not configured in .env"
        return None

    try:
        # Strip quotes if present in .env
        clean_uri = MONGODB_URI.strip().strip('"').strip("'")
        
        # Connect to MongoDB Atlas with CA certs and timeout
        _client = pymongo.MongoClient(
            clean_uri,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=4000
        )
        
        # Test connection ping
        _client.admin.command('ping')
        
        # Use database 'hygienet'
        _db = _client.get_database("hygienet")
        _is_connected = True
        _connection_error = None
        print("[MongoDB] Successfully connected to MongoDB Atlas!")
        
        # Initialize collections & indexes
        _init_database(_db)
        return _db

    except Exception as e:
        _is_connected = False
        _connection_error = str(e)
        print(f"[MongoDB Warning] Connection error: {e}")
        print("[MongoDB] Operating in resilient fallback mode.")
        return None

def _init_database(db):
    try:
        # Ensure unique index on rfid_uid
        db.users.create_index("rfid_uid", unique=True)
        db.transactions.create_index([("timestamp", pymongo.DESCENDING)])
        db.devices.create_index("device_id", unique=True)

        # Seed initial test cards if users collection is empty
        if db.users.count_documents({}) == 0:
            initial_users = [
                {
                    "rfid_uid": "C3:27:87:14",
                    "name": "Sunita Yadav",
                    "monthly_limit": DEFAULT_MONTHLY_LIMIT,
                    "used_pads": 0,
                    "active": True,
                    "created_at": datetime.now(timezone.utc)
                },
                {
                    "rfid_uid": "E3:A5:AE:02",
                    "name": "Anita Kumari",
                    "monthly_limit": DEFAULT_MONTHLY_LIMIT,
                    "used_pads": 0,
                    "active": True,
                    "created_at": datetime.now(timezone.utc)
                }
            ]
            db.users.insert_many(initial_users)
            print("[MongoDB] Seeded default test users into 'users' collection.")
    except Exception as e:
        print(f"[MongoDB] Init warning: {e}")

def get_connection_status():
    get_db()
    return {
        "connected": _is_connected,
        "error": _connection_error,
        "mode": "MongoDB Atlas" if _is_connected else "Fallback Memory Store"
    }

# ------------------------------------------------------------
#  USER OPERATIONS
# ------------------------------------------------------------

def normalize_uid(raw_uid: str) -> str:
    """
    Normalizes RFID UID strings into uppercase colon-separated format.
    Accepts: 'C3:27:87:14', 'c3:27:87:14', 'C3278714', 'c3 27 87 14', 'c3-27-87-14'.
    """
    if not raw_uid:
        return ""
    clean = "".join(c for c in raw_uid.strip().upper() if c in "0123456789ABCDEF")
    if len(clean) % 2 == 0 and len(clean) >= 6 and ":" not in raw_uid:
        return ":".join(clean[i:i+2] for i in range(0, len(clean), 2))
    return raw_uid.strip().upper().replace(" ", ":").replace("-", ":")

def get_user_by_uid(uid: str):
    norm = normalize_uid(uid)
    raw = uid.strip().upper()
    db = get_db()
    if db is not None:
        try:
            user = db.users.find_one({"$or": [{"rfid_uid": norm}, {"rfid_uid": raw}]})
            if user:
                return user
        except Exception as e:
            print(f"[MongoDB Error] get_user_by_uid: {e}")

    # Fallback
    for k in (norm, raw):
        if k in _fallback_users:
            u = _fallback_users[k].copy()
            u["rfid_uid"] = k
            return u
    return None

def get_user_cycle(uid: str):
    user = get_user_by_uid(uid)
    if not user:
        return None
    default_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return user.get("cycle_data", {
        "last_period_date": default_date,
        "cycle_length": 28,
        "period_duration": 5
    })

def update_user_cycle(uid: str, last_period_date: str, cycle_length: int = 28, period_duration: int = 5):
    user = get_user_by_uid(uid)
    if not user:
        return False
    actual_uid = user.get("rfid_uid", uid)
    cycle_data = {
        "last_period_date": last_period_date,
        "cycle_length": int(cycle_length),
        "period_duration": int(period_duration),
        "updated_at": datetime.now(timezone.utc)
    }
    db = get_db()
    if db is not None:
        try:
            db.users.update_one(
                {"rfid_uid": actual_uid},
                {"$set": {"cycle_data": cycle_data}}
            )
            return True
        except Exception as e:
            print(f"[MongoDB Error] update_user_cycle: {e}")
            return False
    if actual_uid in _fallback_users:
        _fallback_users[actual_uid]["cycle_data"] = cycle_data
        return True
    return False


def get_all_users():
    db = get_db()
    if db is not None:
        try:
            cursor = db.users.find().sort("name", pymongo.ASCENDING)
            results = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                results.append(doc)
            return results
        except Exception as e:
            print(f"[MongoDB Error] get_all_users: {e}")

    # Fallback
    results = []
    for uid, data in _fallback_users.items():
        results.append({
            "rfid_uid": uid,
            "name": data["name"],
            "monthly_limit": data.get("monthly_limit", DEFAULT_MONTHLY_LIMIT),
            "used_pads": data.get("used_pads", 0),
            "active": data.get("active", True)
        })
    return results

def upsert_user(rfid_uid: str, name: str, monthly_limit: int = DEFAULT_MONTHLY_LIMIT, aadhaar_no: str = ""):
    rfid_uid = rfid_uid.strip().upper()
    clean_aadhaar = format_aadhaar(aadhaar_no) if aadhaar_no else ""
    db = get_db()
    if db is not None:
        try:
            update_data = {
                "name": name,
                "monthly_limit": monthly_limit,
                "active": True,
                "updated_at": datetime.now(timezone.utc)
            }
            if clean_aadhaar:
                update_data["aadhaar_no"] = clean_aadhaar
            result = db.users.update_one(
                {"rfid_uid": rfid_uid},
                {
                    "$set": update_data,
                    "$setOnInsert": {
                        "used_pads": 0,
                        "created_at": datetime.now(timezone.utc)
                    }
                },
                upsert=True
            )
            return True
        except Exception as e:
            print(f"[MongoDB Error] upsert_user: {e}")

    # Fallback
    if rfid_uid in _fallback_users:
        _fallback_users[rfid_uid]["name"] = name
        _fallback_users[rfid_uid]["monthly_limit"] = monthly_limit
        if clean_aadhaar:
            _fallback_users[rfid_uid]["aadhaar_no"] = clean_aadhaar
    else:
        _fallback_users[rfid_uid] = {
            "name": name,
            "monthly_limit": monthly_limit,
            "used_pads": 0,
            "active": True,
            "aadhaar_no": clean_aadhaar
        }
    return True

def reset_all_monthly():
    db = get_db()
    if db is not None:
        try:
            db.users.update_many({}, {"$set": {"used_pads": 0, "emergency_extra_pads": 0}})
            return True
        except Exception as e:
            print(f"[MongoDB Error] reset_all_monthly: {e}")

    for uid in _fallback_users:
        _fallback_users[uid]["used_pads"] = 0
        _fallback_users[uid]["emergency_extra_pads"] = 0
    return True

def reset_user_monthly(uid: str):
    uid = uid.strip().upper()
    db = get_db()
    if db is not None:
        try:
            db.users.update_one({"rfid_uid": uid}, {"$set": {"used_pads": 0, "emergency_extra_pads": 0}})
            return True
        except Exception as e:
            print(f"[MongoDB Error] reset_user_monthly: {e}")

    if uid in _fallback_users:
        _fallback_users[uid]["used_pads"] = 0
        _fallback_users[uid]["emergency_extra_pads"] = 0
        return True
    return False

def update_user(uid: str, name: str, monthly_limit: int, aadhaar_no: str = ""):
    uid = uid.strip().upper()
    clean_aadhaar = format_aadhaar(aadhaar_no) if aadhaar_no else ""
    db = get_db()
    if db is not None:
        try:
            set_fields = {
                "name": name.strip(),
                "monthly_limit": monthly_limit,
                "updated_at": datetime.now(timezone.utc)
            }
            if clean_aadhaar:
                set_fields["aadhaar_no"] = clean_aadhaar
            res = db.users.update_one(
                {"rfid_uid": uid},
                {"$set": set_fields}
            )
            return res.matched_count > 0
        except Exception as e:
            print(f"[MongoDB Error] update_user: {e}")
            return False

    if uid in _fallback_users:
        _fallback_users[uid]["name"] = name.strip()
        _fallback_users[uid]["monthly_limit"] = monthly_limit
        if clean_aadhaar:
            _fallback_users[uid]["aadhaar_no"] = clean_aadhaar
        return True
    return False

def delete_user(uid: str):
    uid = uid.strip().upper()
    db = get_db()
    if db is not None:
        try:
            res = db.users.delete_one({"rfid_uid": uid})
            return res.deleted_count > 0
        except Exception as e:
            print(f"[MongoDB Error] delete_user: {e}")
            return False

    if uid in _fallback_users:
        del _fallback_users[uid]
        return True
    return False


# ------------------------------------------------------------
#  DISPENSE & TRANSACTION OPERATIONS
# ------------------------------------------------------------

def record_dispense(uid: str, device_id: str, quantity: int):
    """
    Atomically verifies balance and records the dispense transaction.
    Takes into account monthly_limit plus temporary emergency_extra_pads.
    """
    uid = uid.strip().upper()
    db = get_db()
    
    if db is not None:
        try:
            user = db.users.find_one({"rfid_uid": uid})
            if not user:
                return {"success": False, "reason": "CARD_NOT_FOUND", "message": "Card not registered"}

            monthly_limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
            extra_granted = user.get("emergency_extra_pads", 0)
            effective_limit = monthly_limit + extra_granted
            current_used = user.get("used_pads", 0)
            remaining = max(0, effective_limit - current_used)

            if quantity > remaining:
                log_transaction(uid, user.get("name", "Unknown"), device_id, quantity, "DENIED_LIMIT_REACHED", remaining)
                return {
                    "success": False,
                    "reason": "LIMIT_EXCEEDED",
                    "remaining": remaining,
                    "message": f"Requested {quantity} but only {remaining} pads remaining."
                }

            # Atomic increment in MongoDB
            result = db.users.find_one_and_update(
                {"rfid_uid": uid, "used_pads": {"$lte": effective_limit - quantity}},
                {"$inc": {"used_pads": quantity}, "$set": {"last_dispensed_at": datetime.now(timezone.utc)}},
                return_document=pymongo.ReturnDocument.AFTER
            )

            if not result:
                return {"success": False, "reason": "CONCURRENCY_ERROR", "message": "Limit check failed"}

            new_remaining = max(0, effective_limit - result["used_pads"])
            
            # Log transaction
            log_transaction(uid, user.get("name", "Unknown"), device_id, quantity, "DISPENSED", new_remaining)

            # Update device statistics & decrement machine hopper inventory
            db.devices.update_one(
                {"device_id": device_id},
                {
                    "$inc": {"total_dispensed": quantity},
                    "$set": {"last_seen": datetime.now(timezone.utc), "status": "ONLINE"}
                },
                upsert=True
            )
            update_hopper_stock(quantity, is_refill=False)

            return {
                "success": True,
                "user_name": user.get("name", "Unknown"),
                "dispensed": quantity,
                "used_pads": result["used_pads"],
                "remaining": new_remaining,
                "remaining_after": new_remaining,
                "emergency_extra_pads": extra_granted
            }

        except Exception as e:
            print(f"[MongoDB Error] record_dispense: {e}")

    # Resilient Fallback Store
    if uid not in _fallback_users:
        log_transaction(uid, "Unknown", device_id, quantity, "INVALID_CARD", 0)
        return {"success": False, "reason": "CARD_NOT_FOUND", "message": "Card not registered"}

    user = _fallback_users[uid]
    monthly_limit = user.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    extra_granted = user.get("emergency_extra_pads", 0)
    effective_limit = monthly_limit + extra_granted
    current_used = user.get("used_pads", 0)
    remaining = max(0, effective_limit - current_used)

    if quantity > remaining:
        log_transaction(uid, user["name"], device_id, quantity, "DENIED_LIMIT_REACHED", remaining)
        return {"success": False, "reason": "LIMIT_EXCEEDED", "remaining": remaining}

    user["used_pads"] += quantity
    new_remaining = max(0, effective_limit - user["used_pads"])
    log_transaction(uid, user["name"], device_id, quantity, "DISPENSED", new_remaining)
    update_hopper_stock(quantity, is_refill=False)

    return {
        "success": True,
        "user_name": user["name"],
        "dispensed": quantity,
        "used_pads": user["used_pads"],
        "remaining": new_remaining,
        "remaining_after": new_remaining,
        "emergency_extra_pads": extra_granted
    }

def log_transaction(uid: str, name: str, device_id: str, quantity: int, status: str, remaining_after: int):
    tx_record = {
        "rfid_uid": uid,
        "user_name": name,
        "device_id": device_id,
        "quantity": quantity,
        "status": status,
        "remaining_after": remaining_after,
        "timestamp": datetime.now(timezone.utc)
    }

    db = get_db()
    if db is not None:
        try:
            db.transactions.insert_one(tx_record)
            return
        except Exception as e:
            print(f"[MongoDB Error] log_transaction: {e}")

    # Fallback
    _fallback_transactions.insert(0, {
        "rfid_uid": uid,
        "user_name": name,
        "device_id": device_id,
        "quantity": quantity,
        "status": status,
        "remaining_after": remaining_after,
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    })
    if len(_fallback_transactions) > 100:
        _fallback_transactions.pop()

def get_recent_transactions(limit: int = 50):
    db = get_db()
    if db is not None:
        try:
            cursor = db.transactions.find().sort("timestamp", pymongo.DESCENDING).limit(limit)
            txs = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                if isinstance(doc.get("timestamp"), datetime):
                    doc["timestamp"] = doc["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                txs.append(doc)
            return txs
        except Exception as e:
            print(f"[MongoDB Error] get_recent_transactions: {e}")

    return _fallback_transactions[:limit]

def get_user_transactions(uid: str, limit: int = 50):
    uid = uid.strip().upper()
    user = get_user_by_uid(uid)
    actual_uid = user.get("rfid_uid", uid) if user else uid
    raw_uid = normalize_uid(uid)
    
    db = get_db()
    if db is not None:
        try:
            query = {"$or": [{"rfid_uid": uid}, {"rfid_uid": actual_uid}]}
            cursor = db.transactions.find(query).sort("timestamp", pymongo.DESCENDING).limit(limit)
            txs = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                if isinstance(doc.get("timestamp"), datetime):
                    doc["timestamp"] = doc["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                txs.append(doc)
            return txs
        except Exception as e:
            print(f"[MongoDB Error] get_user_transactions: {e}")

    return [t for t in _fallback_transactions if normalize_uid(t.get("rfid_uid", "")) in (normalize_uid(uid), normalize_uid(actual_uid))][:limit]


# ------------------------------------------------------------
#  DEVICE HEARTBEAT & STATS
# ------------------------------------------------------------

def update_device_ping(device_id: str, firmware: str = "2.0.0", rssi: int = 0):
    db = get_db()
    if db is not None:
        try:
            db.devices.update_one(
                {"device_id": device_id},
                {
                    "$set": {
                        "last_seen": datetime.now(timezone.utc),
                        "status": "ONLINE",
                        "firmware_version": firmware,
                        "rssi": rssi
                    },
                    "$setOnInsert": {
                        "total_dispensed": 0,
                        "registered_at": datetime.now(timezone.utc)
                    }
                },
                upsert=True
            )
            return True
        except Exception as e:
            print(f"[MongoDB Error] update_device_ping: {e}")

    _fallback_devices[device_id] = {
        "last_seen": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        "status": "ONLINE",
        "firmware": firmware,
        "rssi": rssi
    }
    return True

def get_dashboard_summary():
    db = get_db()
    if db is not None:
        try:
            user_count = db.users.count_documents({})
            
            # Sum total pads dispensed
            pipeline = [
                {"$match": {"status": "DISPENSED"}},
                {"$group": {"_id": None, "total": {"$sum": "$quantity"}}}
            ]
            agg = list(db.transactions.aggregate(pipeline))
            total_dispensed = agg[0]["total"] if agg else 0

            # Today's transactions
            now_utc = datetime.now(timezone.utc)
            start_of_day = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
            try:
                today_tx_count = db.transactions.count_documents({"timestamp": {"$gte": start_of_day}})
            except Exception:
                today_tx_count = db.transactions.count_documents({"timestamp": {"$gte": start_of_day.replace(tzinfo=None)}})

            # Devices online status
            devices = list(db.devices.find())
            for d in devices:
                d["_id"] = str(d.get("_id", ""))
                dt = d.get("last_seen")
                if isinstance(dt, datetime):
                    d["last_seen_str"] = dt.strftime("%H:%M:%S")
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    diff_seconds = (now_utc - dt).total_seconds()
                    d["is_active"] = diff_seconds < 120
                else:
                    d["is_active"] = False


            return {
                "total_dispensed": total_dispensed,
                "today_transactions": today_tx_count,
                "registered_users": user_count,
                "monthly_limit": DEFAULT_MONTHLY_LIMIT,
                "devices": devices,
                "connection": get_connection_status()
            }
        except Exception as e:
            print(f"[MongoDB Error] get_dashboard_summary: {e}")

    # Fallback metrics
    total_disp = sum(u.get("used_pads", 0) for u in _fallback_users.values())
    return {
        "total_dispensed": total_disp,
        "today_transactions": len(_fallback_transactions),
        "registered_users": len(_fallback_users),
        "monthly_limit": DEFAULT_MONTHLY_LIMIT,
        "devices": [{"device_id": k, "status": v["status"], "is_active": True} for k, v in _fallback_devices.items()],
        "connection": get_connection_status()
    }

# ============================================================
#  MACHINE HOPPER INVENTORY & REFILL ATTENDANT LOGS
# ============================================================

_fallback_hopper = {
    "device_id": "hygienet-01",
    "location": "MMMUT Center #01",
    "capacity": 50,
    "current_stock": 42,
    "status": "ONLINE",
    "last_refilled": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
}
_fallback_refill_logs = []

def get_hopper_status():
    db = get_db()
    if db is not None:
        try:
            hopper = db.hopper.find_one({"device_id": "hygienet-01"})
            if not hopper:
                hopper = {
                    "device_id": "hygienet-01",
                    "location": "MMMUT Center #01",
                    "capacity": 50,
                    "current_stock": 42,
                    "status": "ONLINE",
                    "last_refilled": datetime.now(timezone.utc)
                }
                db.hopper.insert_one(hopper)
            
            cur = hopper.get("current_stock", 42)
            stat = "REFILL_NEEDED" if cur <= 10 else "ONLINE"
            if cur == 0:
                stat = "EMPTY"

            return {
                "device_id": hopper.get("device_id", "hygienet-01"),
                "location": hopper.get("location", "MMMUT Center #01"),
                "capacity": hopper.get("capacity", 50),
                "current_stock": cur,
                "status": stat,
                "last_refilled": str(hopper.get("last_refilled", ""))
            }
        except Exception as e:
            print(f"[MongoDB Error] get_hopper_status: {e}")
    return _fallback_hopper

def update_hopper_stock(amount: int, is_refill: bool = False):
    db = get_db()
    if db is not None:
        try:
            if is_refill:
                db.hopper.update_one(
                    {"device_id": "hygienet-01"},
                    {
                        "$set": {
                            "current_stock": amount,
                            "last_refilled": datetime.now(timezone.utc),
                            "status": "ONLINE"
                        }
                    },
                    upsert=True
                )
            else:
                db.hopper.update_one(
                    {"device_id": "hygienet-01"},
                    {"$inc": {"current_stock": -amount}},
                    upsert=True
                )
            return get_hopper_status()
        except Exception as e:
            print(f"[MongoDB Error] update_hopper_stock: {e}")

    if is_refill:
        _fallback_hopper["current_stock"] = amount
        _fallback_hopper["last_refilled"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    else:
        _fallback_hopper["current_stock"] = max(0, _fallback_hopper["current_stock"] - amount)
    _fallback_hopper["status"] = "REFILL_NEEDED" if _fallback_hopper["current_stock"] <= 10 else "ONLINE"
    return _fallback_hopper

def create_refill_log(attendant_name: str, quantity_added: int, photos: list, notes: str = ""):
    db = get_db()
    log_doc = {
        "device_id": "hygienet-01",
        "attendant_name": attendant_name or "Restock Attendant",
        "quantity_added": int(quantity_added),
        "photos": photos or [],
        "notes": notes.strip(),
        "status": "PENDING_VERIFICATION",
        "timestamp": datetime.now(timezone.utc)
    }

    if db is not None:
        try:
            res = db.refill_logs.insert_one(log_doc)
            log_doc["_id"] = str(res.inserted_id)
            return {"success": True, "message": "Restock submission received! Awaiting admin photo verification.", "log": log_doc}
        except Exception as e:
            print(f"[MongoDB Error] create_refill_log: {e}")

    # Fallback
    log_doc["_id"] = str(len(_fallback_refill_logs) + 1)
    log_doc["timestamp"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    _fallback_refill_logs.insert(0, log_doc)
    return {"success": True, "message": "Restock submission logged for admin verification.", "log": log_doc}

def get_refill_logs(status: str = None):
    db = get_db()
    if db is not None:
        try:
            query = {"status": status} if status else {}
            cursor = db.refill_logs.find(query).sort("timestamp", pymongo.DESCENDING)
            results = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                doc["id"] = doc["_id"]
                doc["staff_name"] = doc.get("staff_name") or doc.get("attendant_name", "Restock Attendant")
                doc["remarks"] = doc.get("remarks") or doc.get("notes", "")
                photos = doc.get("photos", [])
                if photos:
                    doc.setdefault("photo_hopper_base64", photos[0] if len(photos) > 0 else "")
                    doc.setdefault("photo_tray_base64", photos[1] if len(photos) > 1 else "")
                if isinstance(doc.get("timestamp"), datetime):
                    doc["timestamp"] = doc["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                results.append(doc)
            return results
        except Exception as e:
            print(f"[MongoDB Error] get_refill_logs: {e}")
    res = []
    for r in _fallback_refill_logs:
        if not status or r.get("status") == status:
            r["id"] = r.get("_id")
            r["staff_name"] = r.get("staff_name") or r.get("attendant_name", "Restock Attendant")
            r["remarks"] = r.get("remarks") or r.get("notes", "")
            photos = r.get("photos", [])
            if photos:
                r.setdefault("photo_hopper_base64", photos[0] if len(photos) > 0 else "")
                r.setdefault("photo_tray_base64", photos[1] if len(photos) > 1 else "")
            res.append(r)
    return res

def verify_refill_log(log_id: str, action: str = "approve"):
    db = get_db()
    from bson.objectid import ObjectId
    if db is not None:
        try:
            log = db.refill_logs.find_one({"_id": ObjectId(log_id)})
            if not log:
                return {"success": False, "message": "Refill log not found"}
            
            if action == "approve":
                # Set hopper stock to full capacity (50) or add quantity
                new_stock = min(50, get_hopper_status()["current_stock"] + log.get("quantity_added", 50))
                update_hopper_stock(new_stock, is_refill=True)

                db.refill_logs.update_one(
                    {"_id": ObjectId(log_id)},
                    {"$set": {"status": "APPROVED", "verified_at": datetime.now(timezone.utc)}}
                )
                return {"success": True, "message": f"Restock verified! Hopper stock updated to {new_stock} pads."}
            else:
                db.refill_logs.update_one(
                    {"_id": ObjectId(log_id)},
                    {"$set": {"status": "REJECTED", "verified_at": datetime.now(timezone.utc)}}
                )
                return {"success": True, "message": "Restock submission rejected."}
        except Exception as e:
            print(f"[MongoDB Error] verify_refill_log: {e}")

    for r in _fallback_refill_logs:
        if r.get("_id") == log_id:
            if action == "approve":
                r["status"] = "APPROVED"
                new_stock = min(50, _fallback_hopper["current_stock"] + r.get("quantity_added", 50))
                update_hopper_stock(new_stock, is_refill=True)
                return {"success": True, "message": f"Restock verified! Hopper stock updated to {new_stock}."}
            else:
                r["status"] = "REJECTED"
                return {"success": True, "message": "Restock rejected."}
    return {"success": False, "message": "Log not found"}

# ============================================================
#  EMERGENCY PAD / QUOTA EXTENSION REQUESTS
# ============================================================

_fallback_emergency_requests = []

def create_emergency_request(rfid_uid: str, reason: str = "Emergency pad needed on campus"):
    user = get_user_by_uid(rfid_uid)
    if not user:
        return {"success": False, "message": "Beneficiary card UID not registered in system."}
    
    actual_uid = user.get("rfid_uid", rfid_uid)
    db = get_db()
    req_doc = {
        "rfid_uid": actual_uid,
        "user_name": user.get("name", "Beneficiary"),
        "aadhaar_no": mask_aadhaar(user.get("aadhaar_no", "")),
        "reason": reason.strip(),
        "status": "PENDING",
        "timestamp": datetime.now(timezone.utc)
    }

    if db is not None:
        try:
            existing = db.emergency_requests.find_one({"rfid_uid": actual_uid, "status": "PENDING"})
            if existing:
                return {"success": False, "message": "You already have an active emergency request pending approval."}
            res = db.emergency_requests.insert_one(req_doc)
            req_doc["_id"] = str(res.inserted_id)
            return {"success": True, "message": "Emergency request submitted to campus administrator.", "request": req_doc}
        except Exception as e:
            print(f"[MongoDB Error] create_emergency_request: {e}")

    for r in _fallback_emergency_requests:
        if r.get("rfid_uid") == actual_uid and r.get("status") == "PENDING":
            return {"success": False, "message": "Emergency request already pending."}
    req_doc["_id"] = str(len(_fallback_emergency_requests) + 1)
    req_doc["timestamp"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    _fallback_emergency_requests.insert(0, req_doc)
    return {"success": True, "message": "Emergency request submitted.", "request": req_doc}

def get_emergency_requests(status: str = None):
    db = get_db()
    if db is not None:
        try:
            query = {"status": status} if status else {}
            cursor = db.emergency_requests.find(query).sort("timestamp", pymongo.DESCENDING)
            results = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                doc["id"] = doc["_id"]
                if isinstance(doc.get("timestamp"), datetime):
                    doc["timestamp"] = doc["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
                results.append(doc)
            return results
        except Exception as e:
            print(f"[MongoDB Error] get_emergency_requests: {e}")
    res = []
    for r in _fallback_emergency_requests:
        if not status or r.get("status") == status:
            r["id"] = r.get("_id")
            res.append(r)
    return res

def resolve_emergency_request(request_id: str, action: str = "approve", extra_pads: int = 1):
    db = get_db()
    from bson.objectid import ObjectId
    if db is not None:
        try:
            req = None
            if ObjectId.is_valid(request_id):
                req = db.emergency_requests.find_one({"_id": ObjectId(request_id)})
            if not req:
                req = db.emergency_requests.find_one({"_id": str(request_id)})

            if not req:
                for r in _fallback_emergency_requests:
                    if str(r.get("_id")) == str(request_id) or str(r.get("id")) == str(request_id):
                        req = r
                        break

            if not req:
                return {"success": False, "message": "Request not found"}
            if req.get("status") != "PENDING":
                return {"success": False, "message": f"Request already {req.get('status')}"}
            
            uid = req.get("rfid_uid")
            q_filter = {"_id": ObjectId(request_id)} if ObjectId.is_valid(request_id) else {"_id": str(request_id)}
            
            if action in ["approve", "grant"]:
                db.users.update_one({"rfid_uid": uid}, {"$inc": {"emergency_extra_pads": extra_pads}})
                db.emergency_requests.update_one(
                    q_filter,
                    {"$set": {"status": "APPROVED", "pads_granted": extra_pads, "resolved_at": datetime.now(timezone.utc)}}
                )
                return {"success": True, "message": f"Approved temporary +{extra_pads} emergency pad(s) for {req.get('user_name')}."}
            else:
                db.emergency_requests.update_one(
                    q_filter,
                    {"$set": {"status": "REJECTED", "resolved_at": datetime.now(timezone.utc)}}
                )
                return {"success": True, "message": "Emergency request declined/dismissed."}
        except Exception as e:
            print(f"[MongoDB Error] resolve_emergency_request: {e}")

    for r in _fallback_emergency_requests:
        if str(r.get("_id")) == str(request_id) or str(r.get("id")) == str(request_id):
            if action in ["approve", "grant"]:
                r["status"] = "APPROVED"
                r["pads_granted"] = extra_pads
                if r.get("rfid_uid") in _fallback_users:
                    _fallback_users[r.get("rfid_uid")]["emergency_extra_pads"] = _fallback_users[r.get("rfid_uid")].get("emergency_extra_pads", 0) + extra_pads
                return {"success": True, "message": f"Approved temporary +{extra_pads} emergency pad(s)."}
            else:
                r["status"] = "REJECTED"
                return {"success": True, "message": "Emergency request declined/dismissed."}
    return {"success": False, "message": "Request not found"}

# ============================================================
#  AADHAAR STUDENT REGISTRATION WITH OTP & CARD ALLOTMENT
# ============================================================

_fallback_registrations = []

def create_registration_request(name: str, aadhaar_no: str, email: str):
    import random
    clean_aadhaar = "".join(filter(str.isdigit, str(aadhaar_no or "")))
    if len(clean_aadhaar) != 12:
        return {"success": False, "message": "Please enter a valid 12-digit Aadhaar number."}
    
    if not validate_verhoeff(clean_aadhaar):
        return {"success": False, "message": "Invalid Aadhaar number (Verhoeff checksum verification failed)."}

    otp = f"{random.randint(100000, 999999)}"
    db = get_db()
    req_doc = {
        "name": name.strip(),
        "aadhaar_no": format_aadhaar(clean_aadhaar),
        "email": email.strip().lower(),
        "otp": otp,
        "status": "PENDING_OTP",
        "created_at": datetime.now(timezone.utc)
    }

    # Dispatch real email via SMTP if configured
    email_res = {"sent": False, "message": "Local simulation"}
    try:
        from backend.mailer import send_otp_email
        email_res = send_otp_email(email, name, otp)
    except Exception as em_err:
        print(f"[Mailer Exception] {em_err}")
        email_res = {"sent": False, "message": str(em_err)}

    if db is not None:
        try:
            existing_user = db.users.find_one({"aadhaar_no": format_aadhaar(clean_aadhaar)})
            if existing_user:
                return {"success": False, "message": f"Aadhaar {mask_aadhaar(clean_aadhaar)} is already registered with Card UID {existing_user.get('rfid_uid')}."}
            
            res = db.registration_requests.insert_one(req_doc)
            req_id = str(res.inserted_id)
            msg = f"OTP sent to {email}" if email_res.get("sent") else f"OTP generated for {email} (Check inbox or dev bar)"
            return {"success": True, "request_id": req_id, "otp": otp, "email_sent": email_res.get("sent", False), "message": msg}
        except Exception as e:
            print(f"[MongoDB Error] create_registration_request: {e}")

    req_id = str(len(_fallback_registrations) + 1)
    req_doc["_id"] = req_id
    _fallback_registrations.insert(0, req_doc)
    msg = f"OTP sent to {email}" if email_res.get("sent") else f"OTP generated for {email}"
    return {"success": True, "request_id": req_id, "otp": otp, "email_sent": email_res.get("sent", False), "message": msg}

def reject_registration_request(request_id: str, reason: str = "Rejected by administrator"):
    db = get_db()
    from bson.objectid import ObjectId
    if db is not None:
        try:
            req = None
            if ObjectId.is_valid(request_id):
                req = db.registration_requests.find_one({"_id": ObjectId(request_id)})
            if not req:
                req = db.registration_requests.find_one({"_id": str(request_id)})

            if req:
                if ObjectId.is_valid(request_id):
                    db.registration_requests.update_one(
                        {"_id": ObjectId(request_id)},
                        {"$set": {"status": "REJECTED", "rejection_reason": reason, "rejected_at": datetime.now(timezone.utc)}}
                    )
                else:
                    db.registration_requests.update_one(
                        {"_id": str(request_id)},
                        {"$set": {"status": "REJECTED", "rejection_reason": reason, "rejected_at": datetime.now(timezone.utc)}}
                    )
                return {"success": True, "message": f"Registration request for {req.get('name')} cancelled."}
        except Exception as e:
            print(f"[MongoDB Error] reject_registration_request: {e}")

    for r in _fallback_registrations:
        if str(r.get("_id")) == str(request_id) or str(r.get("id")) == str(request_id):
            r["status"] = "REJECTED"
            r["rejection_reason"] = reason
            return {"success": True, "message": f"Registration request for {r.get('name')} cancelled."}

    return {"success": False, "message": "Registration request not found."}

def verify_registration_otp(request_id: str, entered_otp: str):
    db = get_db()
    from bson.objectid import ObjectId
    if db is not None:
        try:
            req = None
            if ObjectId.is_valid(request_id):
                req = db.registration_requests.find_one({"_id": ObjectId(request_id)})
            if not req:
                req = db.registration_requests.find_one({"_id": str(request_id)})

            if req:
                if str(req.get("otp", "")).strip() != str(entered_otp or "").strip():
                    return {"success": False, "message": "Incorrect OTP. Please try again."}
                
                if ObjectId.is_valid(request_id):
                    db.registration_requests.update_one(
                        {"_id": ObjectId(request_id)},
                        {"$set": {"status": "PENDING_ALLOTMENT", "verified_at": datetime.now(timezone.utc)}}
                    )
                else:
                    db.registration_requests.update_one(
                        {"_id": str(request_id)},
                        {"$set": {"status": "PENDING_ALLOTMENT", "verified_at": datetime.now(timezone.utc)}}
                    )
                return {"success": True, "message": "Aadhaar verified! Request submitted for admin card allotment."}
        except Exception as e:
            print(f"[MongoDB Error] verify_registration_otp: {e}")

    for r in _fallback_registrations:
        if str(r.get("_id")) == str(request_id) or str(r.get("id")) == str(request_id):
            if str(r.get("otp", "")).strip() == str(entered_otp or "").strip():
                r["status"] = "PENDING_ALLOTMENT"
                return {"success": True, "message": "Aadhaar verified! Request submitted for card allotment."}
            return {"success": False, "message": "Incorrect OTP."}
    return {"success": False, "message": "Request not found"}

def get_pending_registrations():
    db = get_db()
    if db is not None:
        try:
            cursor = db.registration_requests.find({"status": {"$nin": ["ALLOTTED", "REJECTED"]}}).sort("created_at", pymongo.DESCENDING)
            results = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                doc["id"] = doc["_id"]
                if isinstance(doc.get("created_at"), datetime):
                    doc["created_at"] = doc["created_at"].strftime("%Y-%m-%d %H:%M:%S")
                results.append(doc)
            return results
        except Exception as e:
            print(f"[MongoDB Error] get_pending_registrations: {e}")
    res = []
    for r in _fallback_registrations:
        if r.get("status") not in ["ALLOTTED", "REJECTED"]:
            r["id"] = str(r.get("_id"))
            res.append(r)
    return res

def allot_rfid_card_to_student(request_id: str, rfid_uid: str, monthly_limit: int = DEFAULT_MONTHLY_LIMIT):
    rfid_uid = rfid_uid.strip().upper()
    db = get_db()
    from bson.objectid import ObjectId
    if db is not None:
        try:
            req = None
            if ObjectId.is_valid(request_id):
                req = db.registration_requests.find_one({"_id": ObjectId(request_id)})
            if not req:
                req = db.registration_requests.find_one({"_id": str(request_id)})
            
            if not req:
                for r in _fallback_registrations:
                    if str(r.get("_id")) == str(request_id) or str(r.get("id")) == str(request_id):
                        req = r
                        break

            if not req:
                return {"success": False, "message": "Registration request not found."}
            
            # Upsert into users so the student record is cleanly created or updated
            db.users.update_one(
                {"rfid_uid": rfid_uid},
                {
                    "$set": {
                        "rfid_uid": rfid_uid,
                        "name": req.get("name"),
                        "aadhaar_no": req.get("aadhaar_no"),
                        "email": req.get("email"),
                        "monthly_limit": monthly_limit,
                        "used_pads": 0,
                        "active": True,
                        "allotted_at": datetime.now(timezone.utc)
                    },
                    "$setOnInsert": {
                        "created_at": datetime.now(timezone.utc)
                    }
                },
                upsert=True
            )

            # Mark registration request as ALLOTTED
            if ObjectId.is_valid(request_id):
                db.registration_requests.update_one(
                    {"_id": ObjectId(request_id)},
                    {"$set": {"status": "ALLOTTED", "allotted_uid": rfid_uid, "allotted_at": datetime.now(timezone.utc)}}
                )
            else:
                db.registration_requests.update_one(
                    {"_id": str(request_id)},
                    {"$set": {"status": "ALLOTTED", "allotted_uid": rfid_uid, "allotted_at": datetime.now(timezone.utc)}}
                )

            return {"success": True, "message": f"RFID Card {rfid_uid} allotted to {req.get('name')} successfully!"}
        except Exception as e:
            print(f"[MongoDB Error] allot_rfid_card_to_student: {e}")

    for r in _fallback_registrations:
        if str(r.get("_id")) == str(request_id) or str(r.get("id")) == str(request_id):
            _fallback_users[rfid_uid] = {
                "name": r.get("name"),
                "aadhaar_no": r.get("aadhaar_no"),
                "email": r.get("email"),
                "monthly_limit": monthly_limit,
                "used_pads": 0,
                "active": True
            }
            r["status"] = "ALLOTTED"
            r["allotted_uid"] = rfid_uid
            return {"success": True, "message": f"RFID Card {rfid_uid} allotted to {r.get('name')}!"}
    return {"success": False, "message": "Request not found"}

# ============================================================
#  MONTHLY DISPENSES BREAKDOWN & TEST ROLLOVER
# ============================================================

def get_monthly_dispense_summary():
    """
    Returns monthly statistics with Month Number and Name (e.g. Month 09 - September 2026).
    """
    db = get_db()
    month_names = {
        1: "January", 2: "February", 3: "March", 4: "April",
        5: "May", 6: "June", 7: "July", 8: "August",
        9: "September", 10: "October", 11: "November", 12: "December"
    }

    if db is not None:
        try:
            pipeline = [
                {"$match": {"status": "DISPENSED"}},
                {
                    "$group": {
                        "_id": {
                            "year": {"$year": "$timestamp"},
                            "month": {"$month": "$timestamp"}
                        },
                        "total_pads": {"$sum": "$quantity"},
                        "transactions_count": {"$sum": 1},
                        "beneficiaries": {"$addToSet": "$rfid_uid"}
                    }
                },
                {"$sort": {"_id.year": -1, "_id.month": -1}}
            ]
            agg = list(db.transactions.aggregate(pipeline))
            summary = []
            for item in agg:
                m_no = item["_id"]["month"]
                year = item["_id"]["year"]
                summary.append({
                    "month_no": m_no,
                    "month_name": month_names.get(m_no, str(m_no)),
                    "year": year,
                    "label": f"Month {m_no:02d} — {month_names.get(m_no, '')} {year}",
                    "total_pads": item["total_pads"],
                    "transactions_count": item["transactions_count"],
                    "unique_beneficiaries": len(item.get("beneficiaries", []))
                })
            if not summary:
                now = datetime.now()
                summary.append({
                    "month_no": now.month,
                    "month_name": month_names[now.month],
                    "year": now.year,
                    "label": f"Month {now.month:02d} — {month_names[now.month]} {now.year}",
                    "total_pads": 0,
                    "transactions_count": 0,
                    "unique_beneficiaries": 0
                })
            return summary
        except Exception as e:
            print(f"[MongoDB Error] get_monthly_dispense_summary: {e}")

    now = datetime.now()
    return [{
        "month_no": now.month,
        "month_name": month_names[now.month],
        "year": now.year,
        "label": f"Month {now.month:02d} — {month_names[now.month]} {now.year}",
        "total_pads": sum(t.get("quantity", 0) for t in _fallback_transactions if t.get("status") == "DISPENSED"),
        "transactions_count": len(_fallback_transactions),
        "unique_beneficiaries": len(set(t.get("rfid_uid") for t in _fallback_transactions))
    }]

def simulate_month_rollover():
    """
    Simulates a new monthly cycle: resets used_pads to 0 and emergency_extra_pads to 0 for all users.
    """
    reset_all_monthly()
    return {"success": True, "message": "Simulated new monthly cycle! All beneficiary pad quotas reset to standard limit."}

def clear_all_transactions():
    """
    Clears all transaction records from MongoDB Atlas and fallback memory.
    """
    db = get_db()
    if db is not None:
        try:
            db.transactions.delete_many({})
            return True
        except Exception as e:
            print(f"[MongoDB Error] clear_all_transactions: {e}")
    _fallback_transactions.clear()
    return True

