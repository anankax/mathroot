# 打包（.zip）的外部闸：**拿 Python 的 zipfile 去读我们写出来的那个包。**
#
# ★★ 为什么不拿 js/pack.js 自己读一遍就算验过（这是这个文件存在的**全部**理由）：
#   我们写包用的是 js/docx.js 的写入器（CRC 查表、两个头、EOCD 偏移都是手写的），
#   要是再拿我们自己的读取器去读，错了也是**两边一起错**——
#   CRC 算错、EOCD 偏移写错、中文件名没置 UTF-8 位，这几种坏法在自读自验里
#   **一个字节的错都证不出来**。所以必须换一套完全无关的实现（CPython 的 zipfile），
#   而且换的是**别人机器上的解压软件会走的那条路**。
#
# 查六样，每样都对应一种真实的"老师那边打不开／打开是乱码"：
#   1. zip 本身坏没坏（CRC）                       ← 坏了 = 解压软件报"文件已损坏"
#   2. 非 ASCII 的文件名有没有置位 11（0x0800）     ← 没置 = 解压出来是"鏁版牴-…"这种乱码
#   3. 清单里每个名字的 sha256 对不对（逐字节）     ← 内容被截断/被换成 base64 文本都能抓到
#      ⚠ 清单**只给名字、不给 sha256** 时，这条自动降级成"名字对不对"，
#        并在 info 里明写"只对名字，没比内容"——别把那种绿当成内容也验过了。
#   4. 条目顺序：01、02…连不连得上                  ← 序号断了 = 解压顺序不再是讲课顺序
#   5. `备课全程.md` 头三个字节是不是 EF BB BF      ← 没有 BOM，Windows 记事本整篇乱码
#   6. 每张 .png 的签名 + IHDR 里的宽高是不是正整数 ← "图真的是图、有尺寸"
#
# 用法：
#   python test/check_zip.py <包.zip> [清单.json]
#   python test/check_zip.py --selftest          # ★ 先跑红：证明上面六条真的会报警
#
# 清单是探针顺手写的一份 { files: [ {name, sha256, size} ] }（见 test/probe_pack.cjs）。
# 没有清单也能跑，只是第 3 条自动跳过（会明写"没查"）。
#
# ★ 这份只判"纸上能判的错"。**Windows 资源管理器双击能不能解开、解出来的中文名
#   在他那台机器上乱不乱码，仍然只能他双击。** 别把这里的绿当成那个绿。
import sys, os, json, zipfile, hashlib, struct

# ★ 输出一律走 UTF-8：这台机器上 cmd 的默认代码页会把中文打成乱码，
#   而这份脚本的输出是**给人看的**（"包里：01-数轴.png、备课全程.md"那几行）。
#   不改的话，出错信息里的中文名恰好就是最该看清的那部分。
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PNG_SIG = b'\x89PNG\r\n\x1a\n'
UTF_FLAG = 0x0800
MD = '备课全程.md'


def png_size(b):
    """从字节里读 PNG 的宽高（第 16-23 字节，big-endian）。不解码、不依赖 PIL。"""
    if len(b) < 24 or b[:8] != PNG_SIG:
        return None
    w, h = struct.unpack('>II', b[16:24])
    return (w, h)


def check(path, manifest=None):
    bad, info = [], {}
    z = zipfile.ZipFile(path)
    infos = z.infolist()
    names = [i.filename for i in infos]

    # ★ 读一条条目，**读不出来不许把整个脚本掀翻**。
    #   z.read() 撞上 CRC 不对会抛 BadZipFile——而那正是第 1 条要报的事，
    #   抛出去的话后面的条目、后面的 3/4/5/6 条一条都查不到，输出只剩一个 traceback。
    #   （写这个文件时它当场就绊了这一下：翻坏一个字节，脚本自己炸了，没报出"CRC 坏"。）
    def rd(n):
        try:
            return z.read(n)
        except zipfile.BadZipFile:
            return None

    # 1. CRC
    broken = z.testzip()
    if broken:
        bad.append('zip CRC 坏在 ' + str(broken) + '（解压软件会直接报"文件已损坏"）')

    # 2. 文件名的 UTF-8 位
    #    ★ 判据是**位有没有置**，不是"名字里有没有中文"——位没置时 zipfile 会按
    #    cp437 解，解出来的字只是看起来像中文（"鏁版牴"那种），照样是非 ASCII。
    for i in infos:
        if i.filename.isascii():
            continue
        if not (i.flag_bits & UTF_FLAG):
            bad.append('「' + i.filename + '」这个条目的名字**没置位 11（0x0800）**——'
                       '别的解压软件会按系统代码页解，中文文件名会变成乱码')

    # 3. 逐字节比对（要清单）
    #
    # ★ 清单可以**只给名字、不给 sha256**（浏览器腿就是这样：页面里 make() 只回
    #   整包的字节，拿不到每个文件的字节）。那种清单照样有用——它管的是
    #   "名字集合对不对、序号对不对、md 在不在"；**唯独内容没比**。
    #   所以这里按条判、并按条说明，最后把"比了几条内容"如实写进 info：
    #   免得看见一片绿就以为内容也验过了。
    if manifest:
        want = {f['name']: f for f in manifest.get('files', [])}
        got = set(names)
        hashed = 0
        for n, f in want.items():
            if n not in got:
                bad.append('清单里有「' + n + '」，包里没有')
                continue
            if 'sha256' not in f:
                continue                       # 这条清单只说"该有这个文件"，没说内容
            data = rd(n)
            if data is None:
                bad.append('「' + n + '」读不出来（CRC 不对，见上面第 1 条）——没法比对内容')
                continue
            h = hashlib.sha256(data).hexdigest()
            hashed += 1
            if h != f['sha256']:
                bad.append('「' + n + '」内容对不上：清单 ' + f['sha256'][:12] +
                           '…（' + str(f.get('size', '?')) + ' 字节），包里算出来 ' +
                           h[:12] + '…（' + str(len(data)) + ' 字节）')
        for n in names:
            if n not in want:
                bad.append('包里有「' + n + '」，清单里没有（多出来的东西同样是错）')
        info['清单'] = (str(len(want)) + ' 个（比了 ' + str(hashed) + ' 条内容）' if hashed
                        else str(len(want)) + ' 个（★ 只对名字，没比内容）')
    else:
        info['清单'] = '没给（第 3 条没查）'

    # 4. 序号连不连得上 + 备课全程.md 在不在
    nums = []
    for n in names:
        head = n.split('-', 1)[0]
        if len(head) == 2 and head.isdigit():
            nums.append(int(head))
    nums.sort()
    if nums and nums != list(range(1, len(nums) + 1)):
        bad.append('图的序号不连续：' + ', '.join('%02d' % x for x in nums) +
                   '（解压出来的默认顺序就不再是讲课顺序了）')
    if MD not in names:
        bad.append('包里没有「' + MD + '」——老师拿到的只有图，链子全文丢了')

    # 5. BOM
    if MD in names and rd(MD) is not None:
        head = rd(MD)[:3]
        if head != b'\xef\xbb\xbf':
            bad.append('「' + MD + '」没带 UTF-8 BOM（头三个字节是 ' +
                       head.hex(' ') + '，应该是 ef bb bf）——'
                       'Windows 记事本打开会整篇乱码，老师会以为文件坏了')

    # 6. PNG
    pngs, sizes = 0, []
    for n in names:
        if not n.lower().endswith('.png'):
            continue
        pngs += 1
        blob = rd(n)
        if blob is None:
            continue                      # CRC 已经报过了，别再报一条"不是 PNG"
        wh = png_size(blob)
        if not wh:
            bad.append('「' + n + '」不是一张正常的 PNG（签名不对或太短）')
            continue
        if wh[0] <= 0 or wh[1] <= 0 or wh[0] > 20000 or wh[1] > 20000:
            bad.append('「' + n + '」的尺寸不对劲：' + str(wh))
            continue
        sizes.append(str(wh[0]) + '×' + str(wh[1]))

    info['条目'] = str(len(names))
    info['图'] = str(pngs) + ' 张'
    info['尺寸'] = '、'.join(sizes[:3]) + ('…' if len(sizes) > 3 else '')
    info['压缩方式'] = '全部 stored（不压缩）' if all(i.compress_type == 0 for i in infos) \
        else '有压缩条目：' + str(sorted({i.compress_type for i in infos}))
    return bad, info, names


def selftest():
    """★ 先跑红。这份自检只问一件事：**上面那六条真的会报警吗。**

    做法是现场造一个**好包**，再把它**改坏两处**（数据里翻一个字节 → CRC 该报；
    清掉位 11 → 文件名该报），看 check() 抓不抓得到。抓不到 = 下面每一条绿都不算数。
    ⚠ 自检只许问"我在不在工作"，**不许断言包长什么样**——那会把产品行为焊进自检，
    产品一变就喊"尺子坏了"，把人指错方向。（这条坑本仓库踩过，见 test/probe_math.cjs 顶上。）
    """
    import tempfile, io
    probe = os.path.join(tempfile.gettempdir(), 'sr_selftest.zip')
    # ★ 这份夹具必须是一张**合法的**最小 PNG 头（签名 + IHDR 里带真实的宽高）。
    #   第一版拿"签名 + 一串 0"当图，宽高读出来是 (0,0)，于是好包被判成坏的——
    #   自检当场红给我看。夹具不合法就等于在拿坏输入证明"闸会响"，那证明不了什么。
    fake_png = (PNG_SIG + struct.pack('>I', 13) + b'IHDR' +
                struct.pack('>II', 8, 6) +               # 宽 8、高 6
                b'\x08\x02\x00\x00\x00' + b'\x00' * 4)
    body = [('01-图.png', fake_png),
            (MD, b'\xef\xbb\xbf' + '备课全程\n'.encode('utf-8'))]
    with zipfile.ZipFile(probe, 'w', zipfile.ZIP_STORED) as z:
        for n, d in body:
            z.writestr(n, d)
    good = open(probe, 'rb').read()

    fails = []
    bad, info, names = check(probe)
    if bad:
        fails.append('好包被它判成坏的：' + '；'.join(bad))

    # 坏法一：数据里翻一个字节 → CRC 必须报（翻的是 .png 正文，不是头）
    i = good.find(PNG_SIG)
    t1 = os.path.join(tempfile.gettempdir(), 'sr_selftest_crc.zip')
    open(t1, 'wb').write(good[:i + 10] + bytes([good[i + 10] ^ 0xFF]) + good[i + 11:])
    b1, _, _ = check(t1)
    if not any('CRC' in x for x in b1):
        fails.append('把正文翻了一个字节，它没报 CRC —— 第 1 条是瞎的')

    # 坏法二：清掉位 11 → 中文文件名必须报
    raw = bytearray(good)
    for sig, off in ((b'PK\x03\x04', 6), (b'PK\x01\x02', 8)):
        p = raw.find(sig)
        while p >= 0:
            flags = int.from_bytes(raw[p + off:p + off + 2], 'little')
            raw[p + off:p + off + 2] = (flags & ~UTF_FLAG).to_bytes(2, 'little')
            p = raw.find(sig, p + 4)
    t2 = os.path.join(tempfile.gettempdir(), 'sr_selftest_flag.zip')
    open(t2, 'wb').write(bytes(raw))
    b2, _, _ = check(t2)
    if not any('0x0800' in x for x in b2):
        fails.append('清掉了位 11，它没报 —— 第 2 条是瞎的（而这一条正是"解压出来乱码"的正主）')

    for f in (probe, t1, t2):
        try:
            os.remove(f)
        except OSError:
            pass

    print('===== check_zip.py 尺子自检 =====')
    if fails:
        print('★★★ 尺子自己坏了 —— 下面的绿**一条都别信**，先修 test/check_zip.py：')
        for x in fails:
            print('    · ' + x)
        return 3
    print('  好包判绿、翻一个字节报 CRC、清掉位 11 报文件名乱码  ✓')
    print('  （它证明的是"闸会响"，不是"包是对的"。）')
    return 0


def main(args):
    if '--selftest' in args:
        return selftest()
    if not args:
        print(__doc__ or '用法：python test/check_zip.py <包.zip> [清单.json]')
        return 2
    zips = [a for a in args if a.lower().endswith('.zip')]
    allbad = 0
    for f in zips:
        man = None
        cand = os.path.splitext(f)[0] + '.json'
        if os.path.exists(cand):
            man = json.load(open(cand, encoding='utf-8'))
        try:
            bad, info, names = check(f, man)
        except Exception as e:
            print('%-30s × 打不开：%s' % (os.path.basename(f), e))
            allbad += 1
            continue
        tag = '干净' if not bad else '★ %d 处问题' % len(bad)
        print('%-30s %-12s' % (os.path.basename(f), tag))
        print('     条目 %s（%s）　图 %s　尺寸 %s　清单 %s　%s'
              % (info['条目'], info['压缩方式'], info['图'], info['尺寸'],
                 info['清单'], ''))
        print('     包里：' + '、'.join(names))
        for b in bad:
            print('     · ' + b)
        allbad += len(bad)
    print('\n合计问题 %d 处。' % allbad)
    print('★ 这份只判"纸上能判的错"。**双击能不能解开、中文名在他机器上乱不乱码，仍然只能他双击。**')
    return 1 if allbad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
