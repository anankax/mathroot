// 渲染：把模型的回复拆成三样东西——正文、画板命令、可选回答。
//
// 流式当中围栏是半截的，这里必须处理"还没闭合"的情况，
// 否则学生会在屏幕上看见 ```ggb 一闪一闪的中间态。
var SR = (window.SR = window.SR || {});

SR.render = (function () {

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- 拆围栏 ----
  // 返回 {visible, ggb:[], say:[], pending}
  //   visible —— 能给学生看的正文（围栏已经摘掉）
  //   ggb     —— 已经闭合的画板命令块（每块是若干行）
  //   say     —— 已经闭合的"猜他想说"块
  //   pending —— 后半截还没闭合的围栏原文，**不要显示**，等它闭合
  function parseFences(text) {
    var ggb = [], say = [];
    var visible = String(text == null ? '' : text);

    // 先摘掉闭合的两个专用围栏
    visible = visible.replace(/```[ \t]*(ggb|想说)[ \t]*\r?\n([\s\S]*?)```/g,
      function (all, tag, body) {
        (tag === 'ggb' ? ggb : say).push(body);
        return '';
      });

    // 剩下的反引号如果成不了对，最后那截就是半截围栏——藏起来
    var pending = '';
    var parts = visible.split('```');
    if (parts.length % 2 === 0) {                  // 奇数个标记 → 有一个没闭合
      pending = '```' + parts[parts.length - 1];
      visible = parts.slice(0, -1).join('```');
    }
    visible = visible.replace(/`{1,2}$/, '');      // 末尾可能只到了一两个反引号

    return { visible: visible.trim(), ggb: ggb, say: say, pending: pending };
  }

  // ---- markdown → 干净 HTML ----
  function md(text) {
    var html;
    if (window.marked && window.DOMPurify) {
      try {
        html = window.marked.parse(text, { breaks: true, gfm: true });
      } catch (e) {
        html = esc(text).replace(/\n/g, '<br>');
      }
      // 必须真的过一遍 DOMPurify——模型吐的是不可信文本。
      html = window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
    } else {
      html = esc(text).replace(/\n/g, '<br>');
    }
    return html;
  }

  // ---- 公式：渲在已经净化过的 DOM 上（KaTeX 的输出是本地生成的，可信）----
  function typeset(el) {
    if (!el || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (e) {}
  }

  function renderInto(el, text) {
    el.innerHTML = md(text);
    typeset(el);
  }

  return { esc: esc, parseFences: parseFences, md: md, typeset: typeset, renderInto: renderInto };
})();
