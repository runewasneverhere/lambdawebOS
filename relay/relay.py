import base64
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import select
import socket
import struct
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("RELAY_PORT", "8765"))
DATA_FILE = os.environ.get("RELAY_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "relay-data.json"))
IMAGE_DIR = os.environ.get("RELAY_IMAGES", os.path.join(os.path.dirname(DATA_FILE), "relay-images"))
ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.environ.get("RELAY_ORIGINS", "https://runewasneverhere.com,https://www.runewasneverhere.com").split(",")
    if origin.strip()
}
LOCAL_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")

USERNAME = re.compile(r"^[a-z_][a-z0-9_-]{2,15}$")
SECRET = re.compile(r"^[0-9a-f]{64}$")
AVATAR = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$")
PNG_DATA = re.compile(r"^data:image/png;base64,([A-Za-z0-9+/]+={0,2})$")
MESSAGE_ID = re.compile(r"^[0-9a-f]{16}$")
RESERVED = {"root", "admin", "administrator", "runewasneverhere", "lambdaweb", "lambdawebos", "system", "daemon", "nobody", "guest", "runetest"}

MAX_BODY = 64 * 1024
MAX_SEND_BODY = 520 * 1024
MAX_AVATAR_BYTES = 40 * 1024
MAX_IMAGE_BYTES = 300 * 1024
MAX_IMAGE_SIDE = 4096
LOG_IMAGE_MAX = 100
MAX_MESSAGE = 500
MAX_USERS = 5000
MAX_PENDING_PER_USER = 100
MAX_SESSIONS = 300
MAX_SESSIONS_PER_IP = 6
MESSAGE_TTL = 60 * 60 * 24 * 60
LOG_MAX = 1000
LOG_TTL = 60 * 60 * 24 * 30
MAX_RETRACT = 200
SEND_INTERVAL = 1.5
TICKET_TTL = 30
OWNERS = {name.strip() for name in os.environ.get("RELAY_OWNERS", "runetest").split(",") if USERNAME.match(name.strip())}

lock = threading.RLock()
registry = {}
joined = {}
pending = {}
admins = set()
log = []
retract = {}
sessions = {}
online = {}
rate = {}
announcements = []
announcement_seq = 0
ANNOUNCEMENT_STORAGE_MAX = 32 * 1024 * 1024


def announcement_space(extra):
    return len(json.dumps(announcements, separators=(",", ":")).encode()) + len(json.dumps(extra).encode()) <= ANNOUNCEMENT_STORAGE_MAX


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def role_of(username):
    if username in OWNERS:
        return "owner"
    if username in admins:
        return "admin"
    return None


def load():
    global announcement_seq
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return
    registry.update({k: v for k, v in data.get("registry", {}).items() if USERNAME.match(k)})
    joined.update({k: v for k, v in data.get("joined", {}).items() if k in registry and type(v) is int and v >= 0})
    announcements.extend(data.get("announcements", []))
    announcement_seq = max(data.get("announcement_seq", 0), max((a["seq"] for a in announcements), default=0))
    cutoff = time.time() - MESSAGE_TTL
    for user, items in data.get("pending", {}).items():
        kept = [m for m in items if m.get("ts", 0) > cutoff]
        if kept:
            pending[user] = kept
    admins.update(name for name in data.get("admins", []) if isinstance(name, str) and name in registry)
    log_cutoff = time.time() - LOG_TTL
    log.extend(m for m in data.get("log", []) if isinstance(m, dict) and isinstance(m.get("id"), str) and m.get("ts", 0) > log_cutoff)
    prune_log()
    for user, ids in data.get("retract", {}).items():
        if USERNAME.match(user) and isinstance(ids, list):
            retract[user] = [i for i in ids if isinstance(i, str)][-MAX_RETRACT:]


def save():
    snapshot = json.dumps(
        {"registry": registry, "pending": pending, "admins": sorted(admins), "log": log, "retract": retract,
         "announcements": announcements, "announcement_seq": announcement_seq, "joined": joined},
        separators=(",", ":"),
    )
    temp = DATA_FILE + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        handle.write(snapshot)
    os.replace(temp, DATA_FILE)


def digest(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


def decode_png(value):
    if not isinstance(value, str) or len(value) > MAX_IMAGE_BYTES * 2:
        return None
    match = PNG_DATA.match(value)
    if not match:
        return None
    try:
        raw = base64.b64decode(match.group(1), validate=True)
    except ValueError:
        return None
    if len(raw) > MAX_IMAGE_BYTES or len(raw) < 45:
        return None
    if raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR" or raw[-12:] != b"\x00\x00\x00\x00IEND\xaeB`\x82":
        return None
    width, height = struct.unpack(">II", raw[16:24])
    if not 1 <= width <= MAX_IMAGE_SIDE or not 1 <= height <= MAX_IMAGE_SIDE:
        return None
    return raw


def image_path(message_id):
    return os.path.join(IMAGE_DIR, message_id + ".png") if MESSAGE_ID.match(message_id) else None


def store_image(message_id, raw):
    path = image_path(message_id)
    if not path:
        return False
    os.makedirs(IMAGE_DIR, exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(raw)
    return True


def read_image(message_id):
    path = image_path(message_id) if isinstance(message_id, str) else None
    if not path:
        return None
    try:
        with open(path, "rb") as handle:
            return "data:image/png;base64," + base64.b64encode(handle.read()).decode()
    except OSError:
        return None


def delete_image(message_id):
    path = image_path(message_id) if isinstance(message_id, str) else None
    if path:
        try:
            os.remove(path)
        except OSError:
            pass


def prune_log():
    cutoff = time.time() - LOG_TTL
    dropped = [m for m in log[:-LOG_MAX]] if len(log) > LOG_MAX else []
    kept = log[-LOG_MAX:]
    expired = [m for m in kept if m.get("ts", 0) <= cutoff]
    kept = [m for m in kept if m.get("ts", 0) > cutoff]
    log[:] = kept
    for entry in dropped + expired:
        if entry.get("image"):
            delete_image(entry.get("id"))
    with_images = [m for m in reversed(log) if m.get("image")]
    for entry in with_images[LOG_IMAGE_MAX:]:
        delete_image(entry.get("id"))
        entry["image"] = False
        entry["imageGone"] = True


def decode_avatar(value):
    if not isinstance(value, str) or len(value) > MAX_AVATAR_BYTES * 2:
        return None
    match = AVATAR.match(value)
    if not match:
        return None
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except ValueError:
        return None
    if len(raw) > MAX_AVATAR_BYTES:
        return None
    kind = match.group(1)
    if kind == "png" and raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, "image/png"
    if kind == "jpeg" and raw[:3] == b"\xff\xd8\xff":
        return raw, "image/jpeg"
    if kind == "webp" and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return raw, "image/webp"
    return None


def throttle(key, limit, window):
    stamp = time.time()
    with lock:
        hits = [t for t in rate.get(key, []) if stamp - t < window]
        if len(hits) >= limit:
            rate[key] = hits
            return False
        hits.append(stamp)
        rate[key] = hits
        if len(rate) > 5000:
            for stale in [k for k, v in rate.items() if not v or stamp - v[-1] > window]:
                rate.pop(stale, None)
    return True


def presence_event():
    with lock:
        users = [{"username": name, "v": sessions[ticket]["v"]} for name, ticket in online.items() if ticket in sessions and sessions[ticket]["open"]]
    users.sort(key=lambda item: item["username"])
    return {"event": "presence", "data": {"users": users}}


def broadcast_presence():
    event = presence_event()
    with lock:
        targets = [s["queue"] for s in sessions.values() if s["open"]]
    for target in targets:
        target.put(event)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 30
    server_version = "relay"
    sys_version = ""

    def log_message(self, fmt, *args):
        return

    def client_ip(self):
        peer = self.client_address[0]
        forwarded = self.headers.get("CF-Connecting-IP")
        if forwarded and peer in ("127.0.0.1", "::1"):
            return forwarded
        return peer

    def origin_allowed(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS or LOCAL_ORIGIN.match(origin):
            return origin
        return None

    def cors(self):
        origin = self.origin_allowed()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")

    def reply(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, limit=MAX_BODY):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > limit:
            self.reply(413, {"error": "too_large"})
            self.close_connection = True
            return None
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self.reply(400, {"error": "bad_json"})
            return None
        if not isinstance(data, dict):
            self.reply(400, {"error": "bad_json"})
            return None
        return data

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/stream":
            self.stream(parse_qs(url.query).get("ticket", [""])[0])
        elif url.path.startswith("/api/avatar/"):
            self.avatar(url.path.rsplit("/", 1)[-1])
        elif url.path == "/api/health":
            self.reply(200, {"ok": True})
        else:
            self.reply(404, {"error": "not_found"})

    def do_POST(self):
        routes = {
            "/api/claim": self.claim,
            "/api/hello": self.hello,
            "/api/send": self.send,
            "/api/admin/users": self.admin_users,
            "/api/admin/set-admin": self.admin_set_admin,
            "/api/admin/delete-user": self.admin_delete_user,
            "/api/admin/messages": self.admin_messages,
            "/api/admin/delete-message": self.admin_delete_message,
            "/api/admin/image": self.admin_image,
            "/api/announcements/list": self.announcement_list,
            "/api/announcements/detail": self.announcement_detail,
            "/api/announcements/photo": self.announcement_photo,
            "/api/announcements/create": self.announcement_create,
            "/api/announcements/delete": self.announcement_delete,
            "/api/announcements/comment": self.announcement_comment,
        }
        path = urlparse(self.path).path
        handler = routes.get(path)
        if not handler:
            self.reply(404, {"error": "not_found"})
            return
        data = self.read_json(MAX_SEND_BODY if path in ("/api/send", "/api/announcements/create") else MAX_BODY)
        if data is not None:
            handler(data)

    def verified(self, data):
        username = data.get("username")
        secret = data.get("secret")
        if not isinstance(username, str) or not isinstance(secret, str) or not USERNAME.match(username) or not SECRET.match(secret):
            return None
        with lock:
            stored = registry.get(username)
        if stored and hmac.compare_digest(stored, digest(secret)):
            return username
        return None

    def claim(self, data):
        if not throttle(("claim", self.client_ip()), 12, 60):
            self.reply(429, {"error": "slow_down"})
            return
        username = data.get("username")
        secret = data.get("secret")
        if not isinstance(username, str) or not USERNAME.match(username):
            self.reply(400, {"error": "invalid_username"})
            return
        if not isinstance(secret, str) or not SECRET.match(secret):
            self.reply(400, {"error": "invalid_secret"})
            return
        with lock:
            if username in RESERVED:
                self.reply(409, {"error": "taken"})
                return
            stored = registry.get(username)
            if stored is None:
                if len(registry) >= MAX_USERS:
                    self.reply(503, {"error": "full"})
                    return
                registry[username] = digest(secret)
                joined[username] = announcement_seq
                save()
                self.reply(200, {"ok": True, "created": True})
            elif hmac.compare_digest(stored, digest(secret)):
                self.reply(200, {"ok": True, "created": False})
            else:
                self.reply(409, {"error": "taken"})

    def hello(self, data):
        username = self.verified(data)
        if not username:
            self.reply(403, {"error": "unauthorized"})
            return
        if not throttle(("hello", username), 20, 60) or not throttle(("hello-ip", self.client_ip()), 30, 60):
            self.reply(429, {"error": "slow_down"})
            return
        avatar = data.get("avatar")
        decoded = decode_avatar(avatar) if avatar else None
        if avatar and not decoded:
            self.reply(400, {"error": "invalid_avatar"})
            return
        ticket = secrets.token_urlsafe(24)
        with lock:
            stamp = time.time()
            for key in [k for k, s in sessions.items() if not s["open"] and stamp - s["created"] > TICKET_TTL]:
                sessions.pop(key, None)
            if len(sessions) >= MAX_SESSIONS:
                self.reply(503, {"error": "busy"})
                return
            ip = self.client_ip()
            if sum(1 for s in sessions.values() if s["ip"] == ip) >= MAX_SESSIONS_PER_IP:
                self.reply(429, {"error": "slow_down"})
                return
            sessions[ticket] = {
                "user": username,
                "ip": ip,
                "avatar": decoded,
                "v": secrets.token_hex(4),
                "queue": queue.Queue(),
                "open": False,
                "created": stamp,
                "last_send": 0.0,
            }
        self.reply(200, {"ticket": ticket})

    def avatar(self, username):
        with lock:
            ticket = online.get(username)
            session = sessions.get(ticket) if ticket else None
            avatar = session["avatar"] if session else None
        if not avatar:
            self.send_response(404)
            self.cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        raw, kind = avatar
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.end_headers()
        self.wfile.write(raw)

    def stream(self, ticket):
        with lock:
            session = sessions.get(ticket)
            if not session or session["open"] or session["user"] not in registry:
                session = None
            else:
                username = session["user"]
                previous = online.get(username)
                if previous and previous in sessions:
                    sessions[previous]["queue"].put({"event": "replaced", "data": {}})
                session["open"] = True
                online[username] = ticket
        if not session:
            self.reply(403, {"error": "unauthorized"})
            return
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        outbox = session["queue"]
        with lock:
            backlog = pending.pop(username, [])
            retracted = retract.pop(username, [])
            if backlog or retracted:
                save()
        try:
            self.emit("ready", {"username": username, "role": role_of(username) or "user"})
            for item in backlog:
                payload = {k: v for k, v in item.items() if k != "ts"}
                if item.get("image"):
                    image = read_image(item.get("id"))
                    if image:
                        payload["image"] = image
                    else:
                        payload["image"] = False
                        payload["imageGone"] = True
                self.emit("message", payload)
            for mid in retracted:
                self.emit("retract", {"id": mid})
            broadcast_presence()
            idle = 0
            while True:
                try:
                    event = outbox.get(timeout=1)
                except queue.Empty:
                    if self.peer_closed():
                        break
                    idle += 1
                    if idle >= 15:
                        idle = 0
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                    continue
                self.emit(event["event"], event["data"])
                if event["event"] in ("replaced", "removed"):
                    break
        except (OSError, ValueError):
            pass
        finally:
            with lock:
                sessions.pop(ticket, None)
                if online.get(username) == ticket:
                    online.pop(username, None)
            broadcast_presence()
            self.close_connection = True

    def peer_closed(self):
        try:
            ready, _, _ = select.select([self.connection], [], [], 0)
            return bool(ready) and self.connection.recv(1, socket.MSG_PEEK) == b""
        except (OSError, ValueError):
            return True

    def emit(self, name, data):
        payload = json.dumps(data, separators=(",", ":"))
        self.wfile.write(f"event: {name}\ndata: {payload}\n\n".encode())
        self.wfile.flush()

    def send(self, data):
        ticket = data.get("ticket")
        recipient = data.get("to")
        text = data.get("text", "")
        reply_to = data.get("replyTo")
        picture = data.get("image")
        with lock:
            session = sessions.get(ticket) if isinstance(ticket, str) else None
            sender = session["user"] if session and session["open"] and session["user"] in registry else None
        if not sender:
            self.reply(403, {"error": "unauthorized"})
            return
        if not throttle(("send-ip", self.client_ip()), 40, 60):
            self.reply(429, {"error": "slow_down"})
            return
        if not isinstance(recipient, str) or not USERNAME.match(recipient) or recipient == sender:
            self.reply(400, {"error": "invalid_recipient"})
            return
        raw = None
        if picture:
            if not throttle(("image", sender), 10, 60):
                self.reply(429, {"error": "slow_down"})
                return
            raw = decode_png(picture)
            if raw is None:
                self.reply(400, {"error": "invalid_image"})
                return
        if not isinstance(text, str) or len(text) > MAX_MESSAGE or (not text.strip() and raw is None):
            self.reply(400, {"error": "invalid_message"})
            return
        if reply_to is not None and (not isinstance(reply_to, str) or len(reply_to) > 40):
            reply_to = None
        stamp = time.time()
        message = {
            "id": secrets.token_hex(8),
            "from": sender,
            "to": recipient,
            "text": text,
            "sent": now_iso(),
            "replyTo": reply_to,
            "ts": stamp,
        }
        if raw is not None:
            message["image"] = True
        with lock:
            if stamp - session["last_send"] < SEND_INTERVAL:
                self.reply(429, {"error": "slow_down"})
                return
            if recipient not in registry:
                self.reply(404, {"error": "no_such_user"})
                return
            target = sessions.get(online.get(recipient, ""))
            live = bool(target and target["open"])
            if not live and len(pending.get(recipient, [])) >= MAX_PENDING_PER_USER:
                self.reply(429, {"error": "mailbox_full"})
                return
            session["last_send"] = stamp
            if raw is not None:
                store_image(message["id"], raw)
            if live:
                event = {k: v for k, v in message.items() if k != "ts"}
                if raw is not None:
                    event["image"] = picture
                target["queue"].put({"event": "message", "data": event})
                delivered = True
            else:
                pending.setdefault(recipient, []).append(message)
                delivered = False
            log.append(dict(message))
            prune_log()
            save()
        self.reply(200, {"ok": True, "delivered": delivered, "id": message["id"], "sent": message["sent"]})

    def announcement_user(self, data):
        ticket = data.get("ticket")
        with lock:
            session = sessions.get(ticket) if isinstance(ticket, str) else None
            if not session or not session["open"] or session["user"] not in registry:
                self.reply(403, {"error": "unauthorized"})
                return None
            return session["user"]

    def announcement_author(self, user):
        session = sessions.get(online.get(user, ""))
        avatar = session.get("avatar") if session else None
        picture = "data:" + avatar[1] + ";base64," + base64.b64encode(avatar[0]).decode() if avatar else None
        return {"username": user, "avatar": picture}

    def announcement_event(self):
        for session in sessions.values():
            if session["open"]:
                session["queue"].put({"event": "announcements", "data": {}})

    def announcement_list(self, data):
        user = self.announcement_user(data)
        if not user:
            return
        before, seen = data.get("before", 0), data.get("seen", 0)
        if type(before) is not int or type(seen) is not int or min(before, seen) < 0:
            self.reply(400, {"error": "invalid_request"})
            return
        with lock:
            seen = max(seen, joined.get(user, 0))
            selected = [a for a in reversed(announcements) if not before or a["seq"] < before][:20]
            items = [{k: v for k, v in a.items() if k not in ("image", "comments")} |
                     {"image": bool(a["image"]), "commentCount": len(a["comments"])} for a in selected]
            self.reply(200, {"items": items, "latest": announcement_seq,
                             "unread": sum(a["seq"] > seen for a in announcements),
                             "notify": any(a["seq"] > seen and a["notify"] for a in announcements),
                             "next": selected[-1]["seq"] if len(selected) == 20 else None})

    def announcement_photo(self, data):
        self.announcement_detail(data, image_only=True)

    def announcement_detail(self, data, image_only=False):
        if not self.announcement_user(data):
            return
        offset = data.get("offset", 0)
        if type(offset) is not int or offset < 0:
            self.reply(400, {"error": "invalid_request"})
            return
        with lock:
            entry = next((a for a in announcements if a["id"] == data.get("id")), None)
            if not entry:
                self.reply(404, {"error": "Announcement no longer exists."})
                return
            if image_only:
                self.reply(200, {"image": entry["image"]})
            else:
                self.reply(200, {"comments": entry["comments"][offset:offset + 30],
                                 "next": offset + 30 if len(entry["comments"]) > offset + 30 else None})

    def announcement_create(self, data):
        global announcement_seq
        who = self.acting_admin(data)
        if not who:
            return
        text, picture, notify = data.get("text"), data.get("image"), data.get("notify", False)
        title = data.get("title", "")
        if not isinstance(title, str) or len(title) > 120 or ("title" in data and not title.strip()):
            self.reply(400, {"error": "Use 1-120 characters for your announcement title."})
            return
        if not isinstance(text, str) or not text.strip() or len(text) > 4000 or type(notify) is not bool:
            self.reply(400, {"error": "Use 1-4000 characters for your announcement."})
            return
        if picture is not None and decode_png(picture) is None:
            self.reply(400, {"error": "Use a PNG image up to 300 KiB and 4096 pixels per side."})
            return
        with lock:
            if not role_of(who[0]):
                self.reply(403, {"error": "forbidden"})
                return
            if len(announcements) >= 200:
                self.reply(409, {"error": "The 200-announcement limit is reached. Delete an older announcement first."})
                return
            entry = {"id": secrets.token_hex(8), "seq": announcement_seq + 1,
                     "author": self.announcement_author(who[0]), "title": title.strip(), "text": text.strip(),
                     "sent": now_iso(), "image": picture, "notify": notify, "comments": []}
            if not announcement_space(entry):
                self.reply(409, {"error": "Announcement storage is full (32 MiB). Delete older announcements first."})
                return
            announcement_seq += 1
            announcements.append(entry)
            save()
            self.announcement_event()
        self.reply(200, {"ok": True})

    def announcement_delete(self, data):
        who = self.acting_admin(data)
        if not who:
            return
        with lock:
            if not role_of(who[0]):
                self.reply(403, {"error": "forbidden"})
                return
            entry = next((a for a in announcements if a["id"] == data.get("id")), None)
            if not entry:
                self.reply(404, {"error": "Announcement no longer exists."})
                return
            announcements.remove(entry)
            save()
            self.announcement_event()
        self.reply(200, {"ok": True})

    def announcement_comment(self, data):
        user = self.announcement_user(data)
        if not user:
            return
        text = data.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 1000:
            self.reply(400, {"error": "Use 1-1000 characters for your comment."})
            return
        if not throttle(("announcement-comment", user), 10, 60):
            self.reply(429, {"error": "slow_down"})
            return
        with lock:
            if user not in registry:
                self.reply(403, {"error": "unauthorized"})
                return
            entry = next((a for a in announcements if a["id"] == data.get("id")), None)
            if not entry:
                self.reply(404, {"error": "Announcement no longer exists."})
                return
            if len(entry["comments"]) >= 100:
                self.reply(409, {"error": "This announcement has reached its 100-comment limit."})
                return
            comment = {"author": self.announcement_author(user), "text": text.strip(), "sent": now_iso()}
            if not announcement_space(comment):
                self.reply(409, {"error": "Announcement storage is full (32 MiB). Ask an administrator to remove older announcements."})
                return
            entry["comments"].append(comment)
            save()
            self.announcement_event()
        self.reply(200, {"ok": True})

    def acting_admin(self, data):
        ticket = data.get("ticket")
        with lock:
            session = sessions.get(ticket) if isinstance(ticket, str) else None
            user = session["user"] if session and session["open"] and session["user"] in registry else None
            role = role_of(user) if user else None
        if not role:
            self.reply(403, {"error": "forbidden"})
            return None
        if not throttle(("admin", user), 120, 60):
            self.reply(429, {"error": "slow_down"})
            return None
        return user, role

    def queue_retract(self, user, message_id):
        target = sessions.get(online.get(user, ""))
        if target and target["open"]:
            target["queue"].put({"event": "retract", "data": {"id": message_id}})
            return
        box = retract.setdefault(user, [])
        if message_id not in box:
            box.append(message_id)
            del box[:-MAX_RETRACT]

    def admin_users(self, data):
        if not self.acting_admin(data):
            return
        with lock:
            users = [{"username": name, "online": name in online, "role": role_of(name) or "user"} for name in sorted(registry)]
        self.reply(200, {"users": users})

    def admin_set_admin(self, data):
        who = self.acting_admin(data)
        if not who:
            return
        if who[1] != "owner":
            self.reply(403, {"error": "forbidden"})
            return
        target = data.get("username")
        grant = data.get("admin")
        if not isinstance(target, str) or not USERNAME.match(target) or not isinstance(grant, bool):
            self.reply(400, {"error": "invalid_request"})
            return
        with lock:
            if target not in registry:
                self.reply(404, {"error": "no_such_user"})
                return
            if target in OWNERS:
                self.reply(400, {"error": "owner"})
                return
            if grant:
                admins.add(target)
            else:
                admins.discard(target)
            save()
            live = sessions.get(online.get(target, ""))
            if live and live["open"]:
                live["queue"].put({"event": "role", "data": {"role": role_of(target) or "user"}})
        self.reply(200, {"ok": True})

    def admin_delete_user(self, data):
        who = self.acting_admin(data)
        if not who:
            return
        target = data.get("username")
        if not isinstance(target, str) or not USERNAME.match(target):
            self.reply(400, {"error": "invalid_request"})
            return
        with lock:
            if target not in registry:
                self.reply(404, {"error": "no_such_user"})
                return
            if target == who[0]:
                self.reply(400, {"error": "self"})
                return
            if target in OWNERS or (target in admins and who[1] != "owner"):
                self.reply(403, {"error": "forbidden"})
                return
            registry.pop(target, None)
            joined.pop(target, None)
            admins.discard(target)
            pending.pop(target, None)
            retract.pop(target, None)
            for user in list(pending):
                pending[user] = [m for m in pending[user] if m.get("from") != target]
                if not pending[user]:
                    pending.pop(user)
            for key in [k for k, s in sessions.items() if s["user"] == target]:
                if sessions[key]["open"]:
                    sessions[key]["queue"].put({"event": "removed", "data": {}})
                else:
                    sessions.pop(key)
            save()
        self.reply(200, {"ok": True})

    def admin_messages(self, data):
        if not self.acting_admin(data):
            return
        with lock:
            items = [
                {
                    "id": m["id"],
                    "from": m["from"],
                    "to": m["to"],
                    "text": m.get("text", ""),
                    "sent": m["sent"],
                    "removed": bool(m.get("removed")),
                    "image": bool(m.get("image")),
                    "imageGone": bool(m.get("imageGone")),
                }
                for m in reversed(log[-300:])
            ]
        self.reply(200, {"messages": items})

    def admin_delete_message(self, data):
        who = self.acting_admin(data)
        if not who:
            return
        message_id = data.get("id")
        if not isinstance(message_id, str) or len(message_id) > 40:
            self.reply(400, {"error": "invalid_request"})
            return
        with lock:
            entry = next((m for m in log if m.get("id") == message_id), None)
            if not entry:
                self.reply(404, {"error": "no_such_message"})
                return
            entry["removed"] = True
            entry["text"] = ""
            if entry.get("image"):
                delete_image(message_id)
            entry["image"] = False
            entry["by"] = who[0]
            recipient = entry["to"]
            if recipient in pending:
                pending[recipient] = [m for m in pending[recipient] if m.get("id") != message_id]
                if not pending[recipient]:
                    pending.pop(recipient)
            for user in {entry["from"], recipient}:
                if user in registry:
                    self.queue_retract(user, message_id)
            save()
        self.reply(200, {"ok": True})

    def admin_image(self, data):
        if not self.acting_admin(data):
            return
        message_id = data.get("id")
        if not isinstance(message_id, str) or not MESSAGE_ID.match(message_id):
            self.reply(400, {"error": "invalid_request"})
            return
        with lock:
            entry = next((m for m in log if m.get("id") == message_id and m.get("image")), None)
        image = read_image(message_id) if entry else None
        if not image:
            self.reply(404, {"error": "no_such_message"})
            return
        self.reply(200, {"image": image})


def main():
    load()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"relay listening on {HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
