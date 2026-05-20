"""Fetch AcFun official guardian-medal css + sprites, then output:
  - public/medals/live_L*.png       (decoded sprites with stable names)
  - scripts/medal_official.css       (final css snippet scoped under .guardian-club-panel)

We dedupe sprites by hash and produce stable names live_L1.png .. live_L7.png in
ascending order of first appearance (same convention as acfun).
"""
import base64
import hashlib
import os
import re
import urllib.parse
import urllib.request

HEADERS = {"User-Agent": "Mozilla/5.0"}
RUNTIME_URL = "https://ali-imgs.acfun.cn/kos/nlav10360/static/js/runtime.dbea049e.js"
CSS_BASE = "https://ali-imgs.acfun.cn/kos/nlav10360/static/css/"

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PUBLIC_MEDALS_DIR = os.path.join(PROJECT_ROOT, "public", "medals")
OUT_CSS = os.path.join(os.path.dirname(__file__), "medal_official.css")
PUBLIC_URL_PREFIX = "/medals/"

SCOPE = ".guardian-club-panel"


def fetch(url):
    if url.startswith("//"):
        url = "https:" + url
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def fetch_text(url):
    return fetch(url).decode("utf-8", "ignore")


def get_chunk_map():
    rt = fetch_text(RUNTIME_URL)
    blocks = re.findall(
        r'\{\s*(?:\d+:"[a-f0-9]{6,8}"\s*,\s*){5,}\d+:"[a-f0-9]{6,8}"\s*\}', rt
    )
    for b in blocks:
        if "31d6cfe0" in b:
            return {int(k): v for k, v in re.findall(r'(\d+):"([a-f0-9]{6,8})"', b)}
    return {}


def find_medal_chunks(chunk_map):
    found = []
    for cid, hash_ in sorted(chunk_map.items()):
        if hash_ == "31d6cfe0":
            continue
        url = f"{CSS_BASE}{cid}.{hash_}.css"
        try:
            text = fetch_text(url)
        except Exception:
            continue
        if "medal-lv" in text and "medal-wrapper" in text:
            found.append((cid, text))
    return found


# ---------- sprite handling ----------

SPRITE_NAME_BY_HASH = {}
SPRITE_NEXT_INDEX = 1


def register_sprite(raw_bytes):
    """Persist sprite png and return public URL like /medals/live_L1.png."""
    global SPRITE_NEXT_INDEX
    h = hashlib.md5(raw_bytes).hexdigest()
    if h in SPRITE_NAME_BY_HASH:
        return SPRITE_NAME_BY_HASH[h]
    # avoid name collision with already-existing sprites (e.g. live_L6.png from prior runs)
    while True:
        name = f"live_L{SPRITE_NEXT_INDEX}.png"
        SPRITE_NEXT_INDEX += 1
        dest = os.path.join(PUBLIC_MEDALS_DIR, name)
        if os.path.exists(dest):
            # if existing file matches same hash, reuse
            with open(dest, "rb") as f:
                existing = f.read()
            if hashlib.md5(existing).hexdigest() == h:
                public_url = PUBLIC_URL_PREFIX + name
                SPRITE_NAME_BY_HASH[h] = public_url
                return public_url
            # otherwise skip and try next index
            continue
        with open(dest, "wb") as f:
            f.write(raw_bytes)
        public_url = PUBLIC_URL_PREFIX + name
        SPRITE_NAME_BY_HASH[h] = public_url
        return public_url


def url_to_public(url):
    """Resolve url() value to a local public url; downloads if external."""
    url = url.strip().strip("'\"")
    if url.startswith("data:image"):
        try:
            payload = url.split(",", 1)[1]
            raw = base64.b64decode(payload)
        except Exception:
            return url
        return register_sprite(raw)
    if url.startswith("//"):
        url = "https:" + url
    if url.startswith("http"):
        try:
            data = fetch(url)
        except Exception:
            return url
        return register_sprite(data)
    return url


# ---------- css cleaning ----------


def clean_css(css):
    # drop scoped data-v attributes
    css = re.sub(r"\[data-v-[a-f0-9]+\]", "", css)
    # collapse double spaces
    css = re.sub(r"\s+", " ", css)
    return css


def extract_medal_rules(css):
    """Return list of (selector, body) for rules whose selector contains 'medal'."""
    rules = []
    i = 0
    n = len(css)
    while i < n:
        # find next '{'
        brace = css.find("{", i)
        if brace == -1:
            break
        selector = css[i:brace].strip().rstrip(";").strip()
        # skip @media etc. (treat as transparent: descend into block)
        if selector.startswith("@"):
            close = find_matching_brace(css, brace)
            if close == -1:
                break
            i = close + 1
            continue
        close = find_matching_brace(css, brace)
        if close == -1:
            break
        body = css[brace + 1:close].strip()
        if "medal" in selector and "{" not in body:
            # skip the medal-flash sprite animation - it relies on acfun's
            # @keyframes that we don't ship, and the guardian list ui
            # does not show the flash effect anyway.
            if "medal-flash" in selector:
                i = close + 1
                continue
            rules.append((selector, body))
        i = close + 1
    return rules


def find_matching_brace(s, open_idx):
    depth = 0
    for j in range(open_idx, len(s)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return j
    return -1


def rewrite_urls(body):
    def repl(m):
        new = url_to_public(m.group(1))
        return f"url({new})"

    return re.sub(r"url\(([^)]+)\)", repl, body)


def scope_selector(sel):
    """Prepend our panel scope to every selector in the comma list."""
    parts = [p.strip() for p in sel.split(",") if p.strip()]
    scoped = [f"{SCOPE} {p}" if not p.startswith(SCOPE) else p for p in parts]
    return ",\n".join(scoped)


def emit_css(rules):
    out_lines = [
        "/* === AcFun 官方守护团勋章样式（自动生成，勿手改）",
        "    source: live.acfun.cn webpack chunks 1 & 9",
        "    sprites: public/medals/live_LN.png === */",
        "",
    ]
    for sel, body in rules:
        body = rewrite_urls(body).strip().rstrip(";")
        scoped = scope_selector(sel)
        out_lines.append(f"{scoped} {{ {body} }}")
    return "\n".join(out_lines) + "\n"


def main():
    os.makedirs(PUBLIC_MEDALS_DIR, exist_ok=True)
    # preload existing sprites into name->url map so we keep stable filenames
    for fname in sorted(os.listdir(PUBLIC_MEDALS_DIR)):
        if not fname.startswith("live_L") or not fname.endswith(".png"):
            continue
        try:
            with open(os.path.join(PUBLIC_MEDALS_DIR, fname), "rb") as f:
                data = f.read()
        except OSError:
            continue
        SPRITE_NAME_BY_HASH[hashlib.md5(data).hexdigest()] = PUBLIC_URL_PREFIX + fname

    chunk_map = get_chunk_map()
    chunks = find_medal_chunks(chunk_map)
    if not chunks:
        print("[fail] no chunks containing medal-lv markers found")
        return
    all_rules = []
    seen_pairs = set()
    for cid, css in chunks:
        cleaned = clean_css(css)
        for sel, body in extract_medal_rules(cleaned):
            # de-dup only when full rule (selector + body) is identical;
            # acfun intentionally repeats some selectors so later rules
            # override earlier ones (e.g. medal-level background-image
            # and :before background-position).
            key = (sel, body)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            all_rules.append((sel, body))
    css_out = emit_css(all_rules)
    with open(OUT_CSS, "w", encoding="utf-8") as f:
        f.write(css_out)
    print(f"[ok] {len(all_rules)} rules -> {OUT_CSS}")
    print(f"[ok] {len(SPRITE_NAME_BY_HASH)} sprites under {PUBLIC_MEDALS_DIR}")


if __name__ == "__main__":
    main()
