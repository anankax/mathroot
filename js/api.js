// DeepSeek 客户端。浏览器直连（CORS 实测放行），不需要任何代理。
//
// 请求骨架照邰言邰语那份抄的——同一个 OpenAI 兼容协议，踩过的坑一样：
//   关思维链遇 400 要去掉参数重发 / 429 是秒回的、重试很便宜 / 超时分三段 /
//   半截的回复不要丢，留着比空着强。
var SR = (window.SR = window.SR || {});

SR.api = (function () {

  function getKey() { try { return localStorage.getItem(SR.LS_KEY) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { localStorage.setItem(SR.LS_KEY, String(k || '').trim()); } catch (e) {} }
  function forgetKey() { try { localStorage.removeItem(SR.LS_KEY); } catch (e) {} }
  function hasKey() { return getKey().length > 10; }

  // 本会话累计用量，页脚拿它显token（自己盯着余额用）
  var usage = { prompt: 0, completion: 0, calls: 0 };
  function usageText() {
    if (!usage.calls) return '';
    return '本会话 ' + usage.calls + ' 次 · 输入 ' + usage.prompt + ' tokens · 输出 ' + usage.completion;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- 本地检索：按学生这一轮说的话，从教材索引里挑几条塞进去 ----
  //   提示词里第三节写的就是"系统会从教材索引里找出一条塞给你"，这里兑现它。
  //   检索是按【学生这一轮说的话】做的——话里没点名知识点就召不回，
  //   所以查不到时给空，模型那边有"教材索引里没有就当没有"的兜底。
  function pickTextbook(query, k) {
    try {
      if (!SR.findTextbook) return '';
      var hits = SR.findTextbook(query, k || 2);
      if (!hits || !hits.length) return '';
      var out = [];
      for (var i = 0; i < hits.length; i++) out.push(hits[i].doc.text.trim());
      return out.join('\n\n');
    } catch (e) { return ''; }
  }

  // ---- 组装 system ----
  // mode: 'student' | 'demo'；query: 学生这一轮说的话，用来检索教材索引
  function buildSystem(mode, query) {
    var m = SR.MODES[mode] || SR.MODES.student;
    var sys = m.prompt() || '';
    // 演示模式不检索。实测：给学生那套教材索引塞进演示模式，出图率从 8/8 掉到 6/8——
    // 附注里那句"照上面「三、教材索引」那节的规矩"在演示模式的提示词里根本没有对应的一节，
    // 模型被这段没头没尾的附注带跑了。教师模式要的是快，别再给它添东西。
    var tb = (mode === 'demo') ? '' : pickTextbook(query, 2);
    if (tb) {
      sys += '\n\n---\n\n# 附：这一轮给你翻出来的教材索引\n\n' +
             '（下面这几条是系统按学生刚说的话找出来的。**只挑对得上这道题的那一条用**，' +
             '对不上就当没给。用法照上面「三、教材索引」那节的规矩。）\n\n' + tb;
    }
    return sys;
  }

  // ---- 一次对话 ----
  // opts: {mode, history:[{role,content}], text, imageDataUrl, onChunk}
  // 返回 {text} 或 {error}
  async function ask(opts) {
    var onChunk = opts.onChunk || function () {};
    if (!hasKey()) return { error: '还没填 DeepSeek Key' };
    if (!navigator.onLine) return { error: '断网了' };

    // 图片走 image_url 段；DeepSeek-V4.1-Flash 实测收图
    var userContent;
    if (opts.imageDataUrl) {
      userContent = [
        { type: 'text', text: opts.text || '（这是学生的解答，帮我看看）' },
        { type: 'image_url', image_url: { url: opts.imageDataUrl } }
      ];
    } else {
      userContent = opts.text || '';
    }

    var msgs = [{ role: 'system', content: buildSystem(opts.mode, opts.text || '') }]
      .concat(opts.history || [])
      .concat([{ role: 'user', content: userContent }]);

    var ctl = new AbortController();
    var timer = null, got = false;
    var arm = function (ms) { clearTimeout(timer); timer = setTimeout(function () { ctl.abort(); }, ms); };
    arm(SR.WAIT_FIRST);
    var hard = setTimeout(function () { ctl.abort(); }, SR.HARD_CAP);

    // 拆成函数，是为了万一 thinking 不被认了能去掉重发
    function bodyOf(withThinking) {
      var b = {
        model: SR.MODEL,
        messages: msgs,
        temperature: SR.TEMPERATURE,
        max_tokens: SR.MAX_TOKENS,
        stream: true
      };
      if (withThinking && SR.THINKING_OFF) b.thinking = SR.THINKING_OFF;
      return JSON.stringify(b);
    }

    var all = '';
    try {
      var send = function (body) {
        return fetch(SR.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getKey() },
          body: body,
          signal: ctl.signal
        });
      };

      var r = await send(bodyOf(true));
      if (r.status === 400) {
        var t4 = await r.text().catch(function () { return ''; });
        if (!/thinking/i.test(t4)) return { error: '接口说：' + t4.slice(0, 120) };
        r = await send(bodyOf(false));          // 参数不被认，去掉再来
      }

      for (var i = 0; i < 2 && r.status === 429; i++) {
        await sleep(1200 + i * 1500);
        r = await send(bodyOf(true));
      }

      if (!r.ok) {
        if (r.status === 401) return { error: 'Key 不对，去右上角重新填一个' };
        if (r.status === 402) return { error: 'DeepSeek 余额不够了' };
        if (r.status === 429) return { error: '请求太密，稍等一下再发' };
        var t = await r.text().catch(function () { return ''; });
        return { error: '接口 ' + r.status + '：' + t.slice(0, 120) };
      }

      // ---- 收流。只取 delta.content，reasoning_content 一律丢掉 ----
      //   思维链参数生效时它根本不出现；万一没关掉，这里也保证学生看不见。
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        buf += dec.decode(step.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();                       // 最后一行可能只到一半，留着
        for (var j = 0; j < lines.length; j++) {
          var s = lines[j].trim();
          if (s.indexOf('data:') !== 0) continue;
          var p = s.slice(5).trim();
          if (p === '[DONE]') continue;
          var o; try { o = JSON.parse(p); } catch (e) { continue; }
          var ch = o && o.choices && o.choices[0] && o.choices[0].delta;
          if (ch && ch.content) {
            all += ch.content;
            onChunk(ch.content);
            if (!got) { got = true; arm(SR.WAIT_IDLE); }   // 出字了，计时口径换成"盯动静"
          }
          if (o && o.usage) {
            usage.prompt += o.usage.prompt_tokens || 0;
            usage.completion += o.usage.completion_tokens || 0;
            usage.calls++;
          }
        }
      }

      if (!all) return { error: '模型没说出话来' };
      return { text: all };

    } catch (e) {
      if (all) return { text: all };             // 吐了半截，别丢
      if (e.name !== 'AbortError') return { error: '连不上 DeepSeek：' + (e.message || '') };
      return { error: got ? '模型说着说着没动静了' : '等太久了，没等到回复' };
    } finally {
      clearTimeout(timer);
      clearTimeout(hard);
    }
  }

  return {
    ask: ask, getKey: getKey, setKey: setKey, forgetKey: forgetKey, hasKey: hasKey,
    usage: usage, usageText: usageText, pickTextbook: pickTextbook, buildSystem: buildSystem
  };
})();
