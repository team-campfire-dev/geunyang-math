"""Draws every brand image that is committed as a picture rather than as markup.

`src/app/icon.svg` is the only drawing anyone edits. The tab icon, the home-screen icon and the card
a shared link shows are all made from it, and all three are binaries, so without this script they are
files nobody can remake. Run it after any change to the mark:

    npm run brand:images

It needs macOS. Two reasons, both about rendering:

  * ImageMagick drops every stroke in these SVGs — it renders them through its own MSVG parser, which
    ignores the stroke attributes the mark is drawn with. Quick Look hands the file to WebKit, which
    is a real browser, so `qlmanage` is what rasterises here.
  * `next/og` cannot set this app's own type. Satori reads ttf/otf/woff and both brand faces ship as
    woff2; Pretendard alone is four times the 500KB bundle ceiling. So the card is drawn here, once,
    with Apple SD Gothic Neo standing in for the reading face. The two are close relatives, and the
    card reads as the app does.

Everything the script writes is reproducible: run it twice on an unchanged icon.svg and the bytes
come out the same, so a dirty tree after running it means the mark really did move.
"""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'src' / 'app'
ICON = APP / 'icon.svg'

PAPER = (0xFA, 0xF6, 0xEE)
INK = (0x2B, 0x26, 0x22)
MUTED = (0x8A, 0x83, 0x78)
CLAY = (0xD2, 0x67, 0x4A)
LINE = (0xE3, 0xDE, 0xD2)
RULE = (70, 58, 36)

GOTHIC = Path('/System/Library/Fonts/AppleSDGothicNeo.ttc')
BOLD, MEDIUM = 6, 2

# The plate in icon.svg is a 600-unit rounded square with a 132-unit radius. The card cuts its tile
# to the same shape, because Quick Look returns an opaque sheet — whatever the icon leaves
# transparent comes back white, and pasted flat that shows as four white corners.
PLATE_RADIUS = 132 / 600


def render_icon(size: int) -> Image.Image:
    """icon.svg, rasterised by WebKit at `size` square."""
    if not shutil.which('qlmanage'):
        sys.exit('qlmanage not found. This script needs macOS; see the note at the top of the file.')
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['qlmanage', '-t', '-s', str(size), '-o', tmp, str(ICON)],
                       check=True, capture_output=True)
        out = Path(tmp) / f'{ICON.name}.png'
        if not out.exists():
            sys.exit(f'Quick Look rendered nothing for {ICON}. Is the SVG valid XML?')
        return Image.open(out).convert('RGBA').copy()


def write_icons(mark: Image.Image) -> None:
    mark.convert('RGB').resize((180, 180), Image.LANCZOS).save(APP / 'apple-icon.png', optimize=True)
    # The .ico has to be RGBA. Saved as RGB it is a valid file that every viewer opens and that the
    # Turbopack build refuses with "The PNG is not in RGBA format", nowhere near this line.
    mark.resize((48, 48), Image.LANCZOS).save(APP / 'favicon.ico', format='ICO',
                                              sizes=[(48, 48), (32, 32), (16, 16)])


def write_card(mark: Image.Image) -> None:
    if not GOTHIC.exists():
        sys.exit(f'{GOTHIC} not found. The card is drawn with the system Korean face.')
    face = lambda size, weight: ImageFont.truetype(str(GOTHIC), size, index=weight)

    width, height = 1200, 630
    card = Image.new('RGB', (width, height), PAPER)
    draw = ImageDraw.Draw(card)

    # The app's own squared paper, at the faintness it has on screen.
    faint = tuple(int(c * 0.06 + p * 0.94) for c, p in zip(RULE, PAPER))
    for x in range(0, width, 26):
        draw.line([(x, 0), (x, height)], fill=faint)
    for y in range(0, height, 26):
        draw.line([(0, y), (width, y)], fill=faint)

    size, left = 300, 96
    top = (height - size) // 2

    # A hairline under the tile, so the mark reads as something set down on the paper rather than a
    # patch where the ruling stopped.
    draw.rounded_rectangle([left - 2, top - 2, left + size + 2, top + size + 2],
                           radius=int(PLATE_RADIUS * size) + 2, outline=LINE, width=2)

    supersample = 4
    plate = Image.new('L', (size * supersample, size * supersample), 0)
    ImageDraw.Draw(plate).rounded_rectangle(
        [0, 0, size * supersample - 1, size * supersample - 1],
        radius=int(PLATE_RADIUS * size * supersample), fill=255)
    card.paste(mark.convert('RGB').resize((size, size), Image.LANCZOS), (left, top),
               plate.resize((size, size), Image.LANCZOS))

    x = left + size + 76
    # One clay rule, the only colour on the card — the same accent the whiskers are drawn in.
    draw.rounded_rectangle([x, 150, x + 96, 156], radius=3, fill=CLAY)
    draw.text((x, 196), '그냥, 다시 시작하는 수학', font=face(64, BOLD), fill=INK)
    draw.text((x, 292), '기초부터 차근차근, 내 속도로.', font=face(34, MEDIUM), fill=MUTED)
    draw.text((x, 346), '짧은 수업과 꾸준한 연습.', font=face(34, MEDIUM), fill=MUTED)
    draw.text((x, 420), '그냥수학', font=face(28, MEDIUM), fill=MUTED)

    card.save(APP / 'opengraph-image.png', optimize=True)
    card.save(APP / 'twitter-image.png', optimize=True)


def main() -> None:
    if not ICON.exists():
        sys.exit(f'{ICON} not found.')
    mark = render_icon(1024)
    write_icons(mark)
    write_card(mark)
    for name in ('favicon.ico', 'apple-icon.png', 'opengraph-image.png', 'twitter-image.png'):
        print(f'wrote src/app/{name}')


if __name__ == '__main__':
    main()
