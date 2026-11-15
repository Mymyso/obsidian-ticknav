const { Plugin, MarkdownView } = require('obsidian');

const MIN_W = 8;      // 最远处刻度长度(px)
const MAX_W = 36;     // 当前位置刻度长度(px)
const SIGMA = 2.2;    // 渐变范围：越大，受影响的相邻刻度越多
const REF = 0.3;      // 参考线位置：视口高度的 30% 处（点击跳转也会把标题放到这里）

// 距离 d 对应的“影响力”，当前项为 1，向两侧平滑衰减到 0
const falloff = (d) => Math.exp(-Math.pow(d / SIGMA, 2));

module.exports = class TickNav extends Plugin {
  async onload() {
    this.cleanup = null;
    this.ctl = null;
    this.lastPath = null;
    this.timer = null;

    const r = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.refresh(), 60);
    };
    this.registerEvent(this.app.workspace.on('active-leaf-change', r));
    this.registerEvent(this.app.workspace.on('layout-change', r));
    // 只响应当前笔记的变化，其他文件索引更新不再触发重建
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (file === this.app.workspace.getActiveFile()) r();
    }));
    this.app.workspace.onLayoutReady(r);
  }

  onunload() {
    clearTimeout(this.timer);
    this.clear();
  }

  clear() {
    if (this.cleanup) this.cleanup();
    this.cleanup = null;
    this.ctl = null;
    document.querySelectorAll('.ticknav').forEach(e => e.remove());
  }

  refPx(view) {
    return Math.round((view.contentEl.clientHeight || 600) * REF);
  }

  getPreviewHeadings(view) {
    return [...view.contentEl.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .filter(el => !el.closest('.markdown-embed') && !el.classList.contains('inline-title'));
  }

  // 在阅读模式里找到某个标题对应的元素
  findPreviewHeading(view, h, index, heads, rendered) {
    const elements = rendered || this.getPreviewHeadings(view);
    const line = String(h.position.start.line);
    const byLine = elements.find(el => el.getAttribute('data-line') === line);
    if (byLine) return byLine;

    // 按层级 + 文字 + 同名次序匹配（同名标题不会都跳到第一个）
    const text = h.heading.trim();
    const same = elements.filter(el =>
      Number(el.tagName.slice(1)) === h.level && el.textContent.trim() === text);
    const occurrence = heads.slice(0, index + 1)
      .filter(item => item.level === h.level && item.heading.trim() === text).length - 1;
    if (same[occurrence]) return same[occurrence];

    // 只有当渲染出的标题数量和大纲完全一致时才按序号兜底
    // （阅读模式是分段懒渲染的，数量不一致时按序号会匹配错）
    return elements.length === heads.length ? elements[index] : null;
  }

  atBottom(el) {
    return el.scrollHeight > el.clientHeight + 10
      && el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  }

  getPreviewActiveIndex(view, heads) {
    const scroller = view.contentEl.querySelector('.markdown-preview-view');
    if (!scroller) return null;

    const rendered = this.getPreviewHeadings(view);
    const top = scroller.getBoundingClientRect().top + this.refPx(view);
    let index = 0;
    heads.forEach((h, i) => {
      const el = this.findPreviewHeading(view, h, i, heads, rendered);
      if (el && el.getBoundingClientRect().top <= top) index = i;
    });
    if (this.atBottom(scroller)) index = heads.length - 1;
    return index;
  }

  getSourceActiveIndex(view, heads) {
    const cm = view.editor && view.editor.cm;
    if (!cm) return null;
    const sc = cm.scrollDOM;
    const y = sc.scrollTop + this.refPx(view);
    const line = cm.state.doc.lineAt(cm.lineBlockAtHeight(y).from).number - 1;
    let index = 0;
    heads.forEach((h, i) => { if (h.position.start.line <= line) index = i; });
    if (this.atBottom(sc)) index = heads.length - 1;
    return index;
  }

  // 平滑跳转，目标标题落在参考线位置（与高亮判定一致，不会跳完又变回上一项）
  goTo(view, h, index, heads) {
    const line = h.position.start.line;
    const offset = this.refPx(view);
    try {
      if (view.getMode() === 'source') {
        const cm = view.editor.cm;
        const pos = view.editor.posToOffset({ line, ch: 0 });
        const block = cm.lineBlockAt(pos);
        cm.scrollDOM.scrollTo({ top: block.top - offset, behavior: 'smooth' });
        return;
      }
      const el = this.findPreviewHeading(view, h, index, heads);
      if (el) {
        el.style.scrollMarginTop = offset + 'px';
        el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        return;
      }
    } catch (e) { /* ignore */ }
    view.currentMode.applyScroll(line);
  }

  refresh() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    // 焦点在侧边栏等非笔记面板时，保留现有刻度，不要清掉
    if (!view || !view.file) return;

    const heads = this.app.metadataCache.getFileCache(view.file)?.headings || [];
    if (!heads.length) {
      this.clear();
      this.lastPath = view.file.path;
      return;
    }

    // 标题结构没变（只是行号随编辑移动）时，不重建 DOM，避免打字时闪烁
    const sig = view.file.path + '\n' + heads.map(h => h.level + '|' + h.heading).join('\n');
    const old = this.ctl;
    if (old && old.view === view && old.sig === sig && old.wrap.isConnected) {
      old.heads = heads;
      old.update();
      return;
    }

    this.clear();
    const isNewFile = this.lastPath !== view.file.path;
    this.lastPath = view.file.path;

    const ctl = { view, sig, heads };
    this.ctl = ctl;

    const wrap = view.contentEl.createDiv({ cls: 'ticknav' });
    wrap.style.setProperty('--max', MAX_W + 'px');
    if (isNewFile) wrap.addClass('enter');
    ctl.wrap = wrap;
    const list = wrap.createDiv({ cls: 'ticknav-list' });
    const label = wrap.createDiv({ cls: 'ticknav-label' });
    const canHover = typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    let active = -1;
    let pinned = null;       // 点击刻度后锁定的索引，直到用户手动滚动/点击内容
    let isNavigating = false;

    const hideLabel = () => label.removeClass('show');
    const showLabel = (tick, text) => {
      const wr = wrap.getBoundingClientRect();
      const tr = tick.getBoundingClientRect();
      label.setText(text);
      label.style.top = (tr.top - wr.top + tr.height / 2) + 'px';
      label.addClass('show');
    };

    const ticks = heads.map((h, i) => {
      const t = list.createDiv({ cls: 'ticknav-tick' });
      t.style.setProperty('--i', String(i));
      t.style.setProperty('--w', MIN_W + 'px');
      t.addEventListener('click', () => {
        pinned = i;
        isNavigating = true;
        setActive(i);
        if (!canHover) showLabel(t, ctl.heads[i].heading);
        this.goTo(view, ctl.heads[i], i, ctl.heads);
      });
      if (canHover) {
        t.addEventListener('mouseenter', () => showLabel(t, ctl.heads[i]?.heading ?? ''));
        t.addEventListener('mouseleave', hideLabel);
      }
      return t;
    });

    // 按到当前项的距离，渐变设置长度和亮度
    const setActive = (idx) => {
      if (idx === active) return;
      active = idx;
      ticks.forEach((t, i) => {
        const f = falloff(Math.abs(i - idx));
        t.toggleClass('active', i === idx);
        t.style.setProperty('--w', (MIN_W + (MAX_W - MIN_W) * f).toFixed(1) + 'px');
        t.style.setProperty('--o', (0.22 + 0.45 * f).toFixed(2));
      });
      // 刻度很多、列表可滚动时，保证当前项可见
      const lr = list.getBoundingClientRect();
      const tr = ticks[idx].getBoundingClientRect();
      if (tr.top < lr.top) list.scrollTop -= lr.top - tr.top;
      else if (tr.bottom > lr.bottom) list.scrollTop += tr.bottom - lr.bottom;
    };

    const update = () => {
      if (pinned !== null) return;
      const idx = view.getMode() === 'preview'
        ? this.getPreviewActiveIndex(view, ctl.heads)
        : this.getSourceActiveIndex(view, ctl.heads);
      if (idx !== null) setActive(idx);
    };
    ctl.update = update;

    const onManualInteraction = (event) => {
      // 点按刻度本身不收起标题预览；点按内容、滚轮、键盘才收起并恢复跟随
      if (event.target && wrap.contains(event.target)) return;
      hideLabel();
      pinned = null;
      isNavigating = false;
      update();
    };
    const onScroll = () => {
      if (!isNavigating) hideLabel();
      update();
    };

    const el = view.contentEl;
    el.addEventListener('scroll', onScroll, true);
    el.addEventListener('touchstart', onManualInteraction, true);
    el.addEventListener('mousedown', onManualInteraction, true);
    el.addEventListener('wheel', onManualInteraction, true);
    el.addEventListener('keydown', onManualInteraction, true);

    setActive(0);
    update();
    // 阅读模式刚切换时内容还在渲染，稍后再校准一次
    setTimeout(() => { if (this.ctl === ctl) update(); }, 250);

    this.cleanup = () => {
      el.removeEventListener('scroll', onScroll, true);
      el.removeEventListener('touchstart', onManualInteraction, true);
      el.removeEventListener('mousedown', onManualInteraction, true);
      el.removeEventListener('wheel', onManualInteraction, true);
      el.removeEventListener('keydown', onManualInteraction, true);
    };
  }
};
