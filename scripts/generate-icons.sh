#!/bin/bash
set -euo pipefail

SOURCE="${1:-logo-source.png}"
BUILD_DIR="build"
WORK_SOURCE="$SOURCE"
TMP_SOURCE=""

cleanup() {
  if [ -n "$TMP_SOURCE" ] && [ -f "$TMP_SOURCE" ]; then
    rm -f "$TMP_SOURCE"
  fi
}

trap cleanup EXIT

if [ ! -f "$SOURCE" ]; then
  echo "ERROR: Source image not found: $SOURCE"
  echo "Usage: bash scripts/generate-icons.sh [source-1024x1024.png]"
  exit 1
fi

mkdir -p "$BUILD_DIR"

if python3 -c "import PIL" >/dev/null 2>&1; then
  TMP_SOURCE="$(mktemp "${TMPDIR:-/tmp}/zora-icon-source.XXXXXX.png")"
  echo "Preparing icon artwork..."
  python3 - "$SOURCE" "$TMP_SOURCE" <<'PY'
from PIL import Image, ImageDraw, ImageFilter, ImageStat
import sys

source_path, target_path = sys.argv[1], sys.argv[2]
canvas_size = 1024
plate_bounds = (104, 96, 920, 912)
plate_radius = 210
subject_scale_target = 620

image = Image.open(source_path).convert("RGBA")
w, h = image.size
pixels = image.load()

subject_pixels = []
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        if max(r, g, b) - min(r, g, b) > 18:
            subject_pixels.append((x, y))

if subject_pixels:
    xs = [point[0] for point in subject_pixels]
    ys = [point[1] for point in subject_pixels]
    bbox = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
else:
    bbox = (0, 0, w, h)

padding = 28
left = max(0, bbox[0] - padding)
top = max(0, bbox[1] - padding)
right = min(w, bbox[2] + padding)
bottom = min(h, bbox[3] + padding)
crop = image.crop((left, top, right, bottom)).copy()

cw, ch = crop.size
sample_size = max(24, min(45, cw // 6, ch // 6))
corner_boxes = [
    (0, 0, sample_size, sample_size),
    (cw - sample_size, 0, cw, sample_size),
    (0, ch - sample_size, sample_size, ch),
    (cw - sample_size, ch - sample_size, cw, ch),
]

samples = []
for box in corner_boxes:
    stat = ImageStat.Stat(crop.crop(box))
    samples.append(stat.mean[:3])

bg = tuple(sum(sample[i] for sample in samples) / len(samples) for i in range(3))
crop_pixels = crop.load()
for y in range(ch):
    for x in range(cw):
        r, g, b, a = crop_pixels[x, y]
        bgdiff = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
        color = max(r, g, b) - min(r, g, b)

        if bgdiff < 12 and color < 16:
            crop_pixels[x, y] = (255, 255, 255, a)
        elif bgdiff < 18 and color < 18:
            mix = (18 - bgdiff) / 6 * 0.65
            crop_pixels[x, y] = (
                int(r * (1 - mix) + 255 * mix),
                int(g * (1 - mix) + 255 * mix),
                int(b * (1 - mix) + 255 * mix),
                a,
            )

mask = Image.new("L", crop.size, 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.ellipse((8, 8, cw - 8, ch - 8), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(24))

soft_crop = Image.new("RGBA", crop.size, (255, 255, 255, 0))
soft_crop.paste(crop, (0, 0), mask)

scale = min(subject_scale_target / cw, subject_scale_target / ch)
new_width = max(1, round(cw * scale))
new_height = max(1, round(ch * scale))
soft_crop = soft_crop.resize((new_width, new_height), Image.Resampling.LANCZOS)

canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

shadow_mask = Image.new("L", (canvas_size, canvas_size), 0)
shadow_draw = ImageDraw.Draw(shadow_mask)
shadow_draw.rounded_rectangle((116, 112, 908, 904), radius=plate_radius, fill=90)
shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(34))
shadow = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
shadow.paste((0, 0, 0, 26), (0, 0), shadow_mask)
canvas.alpha_composite(shadow)

plate = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
plate_draw = ImageDraw.Draw(plate)
plate_draw.rounded_rectangle(plate_bounds, radius=plate_radius, fill=(255, 255, 255, 255))
canvas.alpha_composite(plate)

offset = ((canvas_size - new_width) // 2, (canvas_size - new_height) // 2)
canvas.alpha_composite(soft_crop, offset)
canvas.save(target_path)

print(
    f"  composed {image.width}x{image.height} -> {canvas_size}x{canvas_size}"
    f" using subject box {bbox}"
)
PY
  WORK_SOURCE="$TMP_SOURCE"
else
  echo "WARNING: Pillow not installed; resizing source directly."
  echo "WARNING: Non-square images may appear stretched in the generated icons."
fi

echo "Generating icon.png (512x512)..."
sips -z 512 512 "$WORK_SOURCE" --out "$BUILD_DIR/icon.png" >/dev/null

echo "Generating icon.icns..."
ICONSET="$BUILD_DIR/icon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

sips -z 16 16 "$WORK_SOURCE" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$WORK_SOURCE" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$WORK_SOURCE" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$WORK_SOURCE" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$WORK_SOURCE" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$WORK_SOURCE" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$WORK_SOURCE" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$WORK_SOURCE" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$WORK_SOURCE" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$WORK_SOURCE" --out "$ICONSET/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$ICONSET" -o "$BUILD_DIR/icon.icns"
rm -rf "$ICONSET"

echo "Generating icon.ico..."
python3 - "$WORK_SOURCE" "$BUILD_DIR/icon.ico" <<'PY' 2>/dev/null || {
from PIL import Image
import sys

source_path, target_path = sys.argv[1], sys.argv[2]
image = Image.open(source_path)
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
image.save(target_path, format="ICO", sizes=sizes)
print("  icon.ico created")
PY
  echo "WARNING: Pillow not installed. Install with: pip3 install Pillow"
  echo "WARNING: Skipping icon.ico for now (Windows build will use default icon)"
}

echo ""
echo "Done. Generated icons in $BUILD_DIR/:"
ls -la "$BUILD_DIR"/icon.*
