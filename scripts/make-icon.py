"""Generate the small, geometric application icon (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(icon)
d.rounded_rectangle((12, 12, 500, 500), radius=108, fill="#101f30")
for p in (164, 224, 284, 344):
    d.line((p, 86, p, 134), fill="#69dfc5", width=17)
    d.line((p, 378, p, 426), fill="#69dfc5", width=17)
    d.line((86, p, 134, p), fill="#69dfc5", width=17)
    d.line((378, p, 426, p), fill="#69dfc5", width=17)
d.rounded_rectangle((130, 130, 382, 382), radius=36, fill="#183345", outline="#69dfc5", width=15)
d.line([(162, 269), (210, 269), (236, 205), (274, 316), (306, 248), (350, 248)], fill="#69dfc5", width=16, joint="curve")
dest = root / "src-tauri" / "icons"
dest.mkdir(parents=True, exist_ok=True)
icon.save(dest / "icon.png")
icon.save(dest / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
