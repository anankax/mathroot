# -*- coding: utf-8 -*-
"""生成一张"学生拍照发来的错题"测试图。

为什么要造这张图，而不是随便找一张现成的照片：
  ★ 要测的是 v18 铁律第 7 条——学生把**整份解答**拍过来，模型每一步都看得见。
    这时候它最容易犯的错是"哪一步错了就直接问哪一步"，把学生自己的复盘过程跳过去。
    所以这张图必须**故意写错一步**，而且错在中间，不在最后。
  ★ 图里只有字和算式，没有人脸（作品里不出现未成年人正面画面这条线，测试图也不越）。
  ★ 顺手模拟"手机拍的"：轻微旋转 + 一点点噪点，免得测的是"干净截图"这个最好走的情形。

产物：test/_case_photo.png
"""
import io, os, random
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '_case_photo.png')

W, H = 900, 700
BG = (250, 248, 243)

def font(size, bold=False):
    for name in (('msyhbd.ttc' if bold else 'msyh.ttc'), 'simhei.ttf', 'simsun.ttc'):
        p = os.path.join(r'C:\Windows\Fonts', name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    raise SystemExit('没找到中文字体，装一个 msyh.ttc 或者改这里')

F_T = font(34, True)
F_B = font(30)

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

# 标题
d.text((60, 48), '3. 解方程：2x + 1 = 7', font=F_T, fill=(20, 20, 20))

# 学生的解答：第一步对、第二步错（把 6÷2 写成 4），第三步跟着错
lines = [
    ('解：2x = 7 - 1', (30, 30, 30)),
    ('      2x = 6', (30, 30, 30)),
    ('      x = 6 ÷ 2', (30, 30, 30)),
    ('      x = 4', (30, 30, 30)),
    ('', (30, 30, 30)),
    ('答：x = 4', (30, 30, 30)),
]
y = 140
for s, c in lines:
    if s:
        d.text((110, y), s, font=F_B, fill=c)
    y += 62

# 底下一条淡淡的横线，看着像练习册的行线
d.line([(60, y + 10), (W - 60, y + 10)], fill=(205, 200, 190), width=2)

img = img.rotate(-1.2, resample=Image.BICUBIC, expand=False, fillcolor=BG)

# 一点噪点：模拟手机拍的，也让"干净截图"这个最好走的情形别太占便宜
px = img.load()
random.seed(7)
for _ in range(W * H // 60):
    x = random.randrange(W); yy = random.randrange(H)
    r, g, b = px[x, yy]
    k = random.randint(-9, 9)
    px[x, yy] = (max(0, min(255, r + k)), max(0, min(255, g + k)), max(0, min(255, b + k)))

img.save(OUT, 'PNG')
print('OK', OUT, img.size, os.path.getsize(OUT), 'bytes')
