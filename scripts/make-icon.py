"""Build every icon size from the canonical vector mark (requires librsvg)."""
from pathlib import Path
import subprocess
from PIL import Image
root = Path(__file__).resolve().parents[1]
mark = (root / 'assets/wing-mark.svg').read_text()
body = mark[mark.index('<path'):mark.index('</svg>')].replace('currentColor', '#f6f7f9')
svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="32" y="32" width="960" height="960" rx="214" fill="#202329"/><g transform="translate(168 168) scale(21.5)">{body}</g><circle cx="805" cy="222" r="42" fill="#e99a49"/></svg>'
(root / 'assets/wing-app.svg').write_text(svg)
subprocess.run(['rsvg-convert', str(root/'assets/wing-app.svg'), '-o', str(root/'assets/icon.png')], check=True)
im = Image.open(root/'assets/icon.png')
iconset = root/'assets/wing.iconset'
iconset.mkdir(exist_ok=True)
for n in [16,32,128,256,512]:
    for scale in [1,2]:
        im.resize((n*scale,n*scale),Image.Resampling.LANCZOS).save(iconset/f'icon_{n}x{n}{"@2x" if scale==2 else ""}.png')
subprocess.run(['iconutil','-c','icns',str(iconset),'-o',str(root/'assets/wing.icns')],check=True)
