"""Build every icon size from the canonical app icon (requires librsvg)."""
from pathlib import Path
import subprocess
from PIL import Image
root = Path(__file__).resolve().parents[1]
subprocess.run(['rsvg-convert', str(root/'assets/wing-app.svg'), '-o', str(root/'assets/icon.png')], check=True)
im = Image.open(root/'assets/icon.png')
iconset = root/'assets/wing.iconset'
iconset.mkdir(exist_ok=True)
for n in [16,32,128,256,512]:
    for scale in [1,2]:
        im.resize((n*scale,n*scale),Image.Resampling.LANCZOS).save(iconset/f'icon_{n}x{n}{"@2x" if scale==2 else ""}.png')
subprocess.run(['iconutil','-c','icns',str(iconset),'-o',str(root/'assets/wing.icns')],check=True)
