import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
print("Workspace Root:", ROOT)

pub_dir = ROOT / "public"
api_pub_dir = ROOT / "api" / "public"
api_pub_dir.mkdir(parents=True, exist_ok=True)

for fname in ["index.html", "style.css", "app.js", "manifest.json", "sw.js"]:
    src = pub_dir / fname
    if src.exists():
        dst = api_pub_dir / fname
        shutil.copy2(src, dst)
        print(f"Copied {src.name} -> {dst} ({src.stat().st_size} bytes)")

index_html = (pub_dir / "index.html").read_text(encoding="utf-8")
style_css = (pub_dir / "style.css").read_text(encoding="utf-8")
app_js = (pub_dir / "app.js").read_text(encoding="utf-8")

static_content_py = ROOT / "api" / "static_content.py"
with open(static_content_py, "w", encoding="utf-8") as f:
    f.write("# Auto-generated static content bundle for serverless runtime\n\n")
    f.write(f"INDEX_HTML = {repr(index_html)}\n\n")
    f.write(f"STYLE_CSS = {repr(style_css)}\n\n")
    f.write(f"APP_JS = {repr(app_js)}\n")

print(f"Generated {static_content_py} ({static_content_py.stat().st_size} bytes)")
