#!/usr/bin/env python3
"""InvestCap dev server: serves the front end and proxies Finnhub so the API key stays server-side."""
import ipaddress
import json
import mimetypes
import os
import re
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

mimetypes.add_type("application/manifest+json", ".webmanifest")
ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "5173"))
HOST = os.environ.get("HOST", "127.0.0.1")  # set HOST=0.0.0.0 to let your phone reach it on the same Wi-Fi
FINNHUB = "https://finnhub.io/api/v1"
# Only these files are ever served statically, so .env and the rest of the repo stay private.
STATIC = {
    "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/data.js": "data.js", "/styles.css": "styles.css",
    "/manifest.webmanifest": "manifest.webmanifest", "/sw.js": "sw.js",
    "/icons/icon-192.png": "icons/icon-192.png", "/icons/icon-512.png": "icons/icon-512.png",
    "/icons/apple-touch-icon.png": "icons/apple-touch-icon.png", "/icons/icon.svg": "icons/icon.svg",
}


def load_env(path):
    env = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip("\"'")
    except FileNotFoundError:
        pass
    return env


API_KEY = os.environ.get("FINNHUB_API_KEY") or load_env(os.path.join(ROOT, ".env")).get("FINNHUB_API_KEY", "")

_cache = {}
_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=8)


class UpstreamError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def finnhub(path, params, ttl):
    """GET a Finnhub endpoint with a small in-memory TTL cache to respect free-tier rate limits."""
    if not API_KEY:
        raise UpstreamError(503, "FINNHUB_API_KEY is not set in .env")
    qs = "&".join(f"{k}={quote(str(v))}" for k, v in sorted(params.items()))
    key = f"{path}?{qs}"
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    req = Request(f"{FINNHUB}{path}?{qs}", headers={"X-Finnhub-Token": API_KEY, "User-Agent": "InvestCap/0.1"})
    try:
        with urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode())
    except HTTPError as e:
        if hit and e.code == 429:  # rate limited: serve the stale value rather than failing
            return hit[1]
        msg = {401: "Finnhub rejected the API key", 403: "Not available on the Finnhub free plan", 429: "Finnhub rate limit hit, retry shortly"}.get(e.code, f"Finnhub error {e.code}")
        raise UpstreamError(e.code if e.code in (401, 403, 429) else 502, msg)
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise UpstreamError(502, "Could not reach Finnhub")
    with _lock:
        _cache[key] = (now + ttl, data)
    return data


def get_quote(symbol):
    q = finnhub("/quote", {"symbol": symbol}, ttl=20)
    # Finnhub returns zeros for unknown symbols
    if not q.get("c"):
        return None
    return {"symbol": symbol, "price": q["c"], "prev": q["pc"], "change": q["d"], "pct": q["dp"], "high": q["h"], "low": q["l"], "open": q["o"], "t": q["t"]}


# Historical prices: Finnhub's free plan has no candles, so history comes from Yahoo's unofficial chart endpoint.
# It is isolated here so it can be swapped for a licensed source later.
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/"
HISTORY = {  # UI range -> (yahoo range, interval, cache seconds)
    "1D": ("1d", "5m", 120), "1W": ("5d", "30m", 600), "1M": ("1mo", "1d", 3600), "3M": ("3mo", "1d", 3600),
    "1Y": ("1y", "1d", 3600), "2Y": ("2y", "1wk", 3600), "5Y": ("5y", "1wk", 3600), "10Y": ("10y", "1mo", 3600),
}
SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


def get_history(symbol, rng):
    yrange, interval, ttl = HISTORY[rng]
    key = f"hist:{symbol}:{rng}"
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    url = f"{YAHOO}{quote(symbol.replace('.', '-'))}?range={yrange}&interval={interval}"
    try:
        with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 InvestCap/0.1"}), timeout=10) as r:
            res = json.loads(r.read().decode())["chart"]["result"][0]
        ts = res.get("timestamp") or []
        closes = res["indicators"]["quote"][0]["close"]
        pts = [(t, c) for t, c in zip(ts, closes) if c is not None]
        if not pts:
            return None
        out = {"t": [p[0] for p in pts], "c": [round(p[1], 4) for p in pts], "prev": res["meta"].get("chartPreviousClose")}
    except Exception:
        with _lock:
            hit = _cache.get(key)
        return hit[1] if hit else None  # stale value if we have one
    with _lock:
        _cache[key] = (now + ttl, out)
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Only answer devices on this computer or the local network, never the public internet.
        try:
            if not ipaddress.ip_address(self.client_address[0]).is_private:
                return self.send_error(403)
        except ValueError:
            return self.send_error(403)
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            return self.api(url)
        if url.path in STATIC:
            self.path = "/" + STATIC[url.path]
            return super().do_GET()
        self.send_error(404)

    do_HEAD = do_GET

    def api(self, url):
        q = parse_qs(url.query)
        try:
            if url.path == "/api/status":
                return self.send_json({"live": bool(API_KEY)})
            if url.path == "/api/quotes":
                syms = [s.strip().upper() for s in q.get("symbols", [""])[0].split(",") if s.strip()][:30]
                results = list(_pool.map(lambda s: (s, get_quote(s)), syms))
                return self.send_json({"quotes": {s: v for s, v in results if v}})
            if url.path == "/api/search":
                term = q.get("q", [""])[0].strip()[:40]
                if not term:
                    return self.send_json({"results": []})
                data = finnhub("/search", {"q": term}, ttl=300)
                out = [
                    {"symbol": r["symbol"], "name": r["description"].title(), "type": r.get("type", "")}
                    for r in data.get("result", [])
                    if "." not in r["symbol"] and ":" not in r["symbol"] and r.get("type") in ("Common Stock", "ETP")
                ][:8]
                return self.send_json({"results": out})
            if url.path == "/api/history":
                rng = q.get("range", ["1M"])[0].upper()
                syms = [x.strip().upper() for x in q.get("symbols", [""])[0].split(",") if x.strip()][:20]
                if rng not in HISTORY or not syms or not all(SYMBOL_RE.match(x) for x in syms):
                    return self.send_json({"error": "Bad request"}, 400)
                results = list(_pool.map(lambda x: (x, get_history(x, rng)), syms))
                return self.send_json({"range": rng, "series": {x: v for x, v in results if v}})
            if url.path == "/api/news":
                sym = q.get("symbol", [""])[0].strip().upper()
                if sym:
                    today = date.today()
                    data = finnhub("/company-news", {"symbol": sym, "from": (today - timedelta(days=7)).isoformat(), "to": today.isoformat()}, ttl=300)
                else:
                    data = finnhub("/news", {"category": "general"}, ttl=300)
                items = [
                    {"title": n["headline"], "src": n.get("source", ""), "url": n.get("url", ""), "t": n.get("datetime", 0), "tag": (n.get("related") or "Markets").split(",")[0] or "Markets"}
                    for n in data[:12] if n.get("headline")
                ]
                return self.send_json({"news": items})
            self.send_json({"error": "Not found"}, 404)
        except UpstreamError as e:
            self.send_json({"error": str(e)}, e.status)


if __name__ == "__main__":
    print(f"InvestCap on http://{'127.0.0.1' if HOST == '127.0.0.1' else HOST}:{PORT}  ·  Finnhub key: {'loaded' if API_KEY else 'MISSING (set FINNHUB_API_KEY in .env)'}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
