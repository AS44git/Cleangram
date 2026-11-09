"""
Use your own picture as Cleangram's launcher icon: put a square image named icon.png at the top
of the repository and build. The picture is fitted to Android's icon shape (your launcher clips
it to a circle or rounded square); without icon.png the app keeps its own icon.
"""
import sys
from pathlib import Path
from PIL import Image, ImageFilter

src = Path(sys.argv[1])
res = Path("app/src/main/res")
SIZE = 432          # 108dp at xxxhdpi: the whole icon layer
SHOWN = 312         # the middle that launchers show, a little more than their 72dp window

img = Image.open(src).convert("RGBA")
side = min(img.size)
left, top = (img.width - side) // 2, (img.height - side) // 2
img = img.crop((left, top, left + side, top + side))

# Behind it, a blurred, enlarged copy of itself, so any edge a launcher shows matches.
canvas = img.resize((SIZE, SIZE), Image.LANCZOS).filter(ImageFilter.GaussianBlur(24))
canvas = Image.alpha_composite(Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255)), canvas)
front = img.resize((SHOWN, SHOWN), Image.LANCZOS)
off = (SIZE - SHOWN) // 2
canvas.alpha_composite(front, (off, off))

out = res / "drawable-nodpi"
out.mkdir(parents=True, exist_ok=True)
canvas.convert("RGB").save(out / "ic_custom_icon.png", optimize=True)
(res / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <background android:drawable="@drawable/ic_custom_icon" />\n'
    '    <foreground android:drawable="@android:color/transparent" />\n'
    '</adaptive-icon>\n')
print("Using", src, "as the app icon")
