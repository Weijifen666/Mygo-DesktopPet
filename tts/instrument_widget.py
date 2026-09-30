"""Apply the desktop speech hooks to the pinned upstream widget bundle.

Run after building panxuc/live2d-widget-mygo v0.2.4. This file contains only
our short patch; the upstream bundle and visual assets stay outside Git.
"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--file', type=Path, default=ROOT / 'index.js')
file = parser.parse_args().file
source = file.read_text(encoding='utf-8')
updated = source


def replace_once(old, new, label):
    global updated
    if new in updated:
        return
    if updated.count(old) != 1:
        raise RuntimeError(f'Upstream {label} changed; review the widget integration')
    updated = updated.replace(old, new)


replace_once(
    'n.innerHTML=e.text,n.classList.add',
    'n.innerHTML=e.text,window.dispatchEvent(new CustomEvent("mygo:widget-line",{detail:{source:n.textContent,characterIndex:ae(),motion:e.motion}})),n.classList.add',
    'tip event',
)
replace_once(
    'function xe(i,e,t,r){',
    'function xe(i,e,t,r,clicked=!1){if(!window.dispatchEvent(new CustomEvent("mygo:widget-before-line",{cancelable:true,detail:{explicitClick:clicked}})))return;',
    'tip guard',
)
replace_once(
    'window.addEventListener("click",f=>{if(f.target.closest("#live2d")){xe(i,Co(),4e3,9);return}',
    'window.addEventListener("click",f=>{if(f.target.closest("#live2d")){xe(i,Co(),4e3,9,!0);return}',
    'model click',
)
replace_once(
    'Pi=setTimeout(()=>{sessionStorage.removeItem("waifu-text"),n.classList.remove("waifu-tips-active")},t)',
    'Pi=setTimeout(function finishTip(){if(window.mygoWidgetBank?.activeSource===n.textContent){Pi=setTimeout(finishTip,250);return}sessionStorage.removeItem("waifu-text"),n.classList.remove("waifu-tips-active")},t)',
    'fixed-speech bubble lifetime',
)
replace_once(
    'autoStart:!0,width:800,height:800,backgroundAlpha:0}',
    'autoStart:!0,width:800,height:800,backgroundAlpha:0,preserveDrawingBuffer:!0}',
    'transparent pixel hit testing',
)
if updated != source:
    file.write_text(updated, encoding='utf-8')
print('Widget click, speech and bubble hooks are ready.')
