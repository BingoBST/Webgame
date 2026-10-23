'use strict';
// ---------------------------------------------------------------------------
// 2D UI (HUD, inventories, menus) drawn on an overlay canvas in GUI pixels
// ---------------------------------------------------------------------------
const Font = {
  img: null, widths: new Uint8Array(256), tinted: new Map(),
  init(img) {
    this.img = img;
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, 128, 128).data;
    for (let ch = 0; ch < 256; ch++) {
      const cx = (ch % 16) * 8, cy = Math.floor(ch / 16) * 8;
      let w = 0;
      for (let col = 7; col >= 0; col--) {
        let any = false;
        for (let row = 0; row < 8; row++) if (d[((cy + row) * 128 + cx + col) * 4 + 3] > 0) { any = true; break; }
        if (any) { w = col + 1; break; }
      }
      this.widths[ch] = ch === 32 ? 4 : w + 1;
    }
  },
  sheet(color) {
    let s = this.tinted.get(color);
    if (s) return s;
    s = document.createElement('canvas'); s.width = 128; s.height = 128;
    const x = s.getContext('2d');
    x.drawImage(this.img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, 128, 128);
    this.tinted.set(color, s);
    return s;
  },
  charW(c) {
    const code = c.charCodeAt(0);
    if (code < 128) return this.widths[code];
    return 9;
  },
  width(str) { let w = 0; for (const c of String(str)) w += this.charW(c); return w; },
  drawRaw(ctx, str, x, y, color) {
    const sh = this.sheet(color);
    for (const c of String(str)) {
      const code = c.charCodeAt(0);
      if (code < 128) {
        ctx.drawImage(sh, (code % 16) * 8, Math.floor(code / 16) * 8, 8, 8, x, y, 8, 8);
        x += this.widths[code];
      } else {
        ctx.fillStyle = color;
        ctx.font = '8.5px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(c, x, y - 1.2);
        x += 9;
      }
    }
    return x;
  },
  draw(ctx, str, x, y, color = '#FFFFFF', shadow = true) {
    if (shadow) this.drawRaw(ctx, str, x + 1, y + 1, shade(color));
    return this.drawRaw(ctx, str, x, y, color);
  },
  center(ctx, str, cx, y, color, shadow = true) { this.draw(ctx, str, Math.round(cx - this.width(str) / 2), y, color, shadow); },
};
function shade(c) {
  const n = parseInt(c.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return '#' + [r >> 2, g >> 2, b >> 2].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
class UI {
  constructor(game, canvas) {
    this.game = game; this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.scale = 2; this.w = 320; this.h = 240;
    this.mouse = { x: 0, y: 0, down: false, button: -1 };
    this.screen = null; this.cursor = null;
    this.chat = []; this.toasts = [];
    this.itemNameT = 0; this.lastSel = -1;
    this.debug = false; this.hideHud = false;
    this.input = document.getElementById('textinput');
    this.drag = null;
  }
  get img() { return this.game.renderer.images; }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr); this.canvas.height = Math.floor(window.innerHeight * dpr);
    const auto = Math.max(1, Math.min(Math.floor(this.canvas.width / 320), Math.floor(this.canvas.height / 240)));
    const pref = this.game.settings.guiScale;
    this.scale = pref ? Math.min(pref * dpr, auto) : Math.min(auto, Math.round(3 * dpr));
    this.scale = Math.max(1, Math.floor(this.scale));
    this.w = Math.ceil(this.canvas.width / this.scale); this.h = Math.ceil(this.canvas.height / this.scale);
    this.dpr = dpr;
    if (this.screen && this.screen.layout) this.screen.layout();
  }
  toGui(ev) { const r = this.canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * this.dpr / this.scale, (ev.clientY - r.top) * this.dpr / this.scale]; }

  open(screen) {
    if (this.screen && this.screen.close) this.screen.close();
    this.screen = screen;
    this.hideInput();
    if (screen) { if (screen.layout) screen.layout(); this.game.releasePointer(); }
  }
  close() {
    if (this.screen && this.screen.close) this.screen.close();
    this.screen = null;
    if (this.cursor) { this.returnStack(this.cursor); this.cursor = null; }
    this.hideInput();
    this.game.capturePointer();
  }
  returnStack(s) {
    const left = this.game.player.inv.add(s);
    if (left) this.game.dropFromPlayer({ ...s, count: left });
  }

  message(text, color = '#FFFFFF') { this.chat.push({ text, color, t: performance.now() }); if (this.chat.length > 100) this.chat.shift(); }
  toast(title, sub, iconId) { this.toasts.push({ title, sub, icon: iconId, t: performance.now() }); Sound.toast(); }

  // ---- primitives ---------------------------------------------------------------
  sprite(name, x, y, w, h, sx = 0, sy = 0, sw, sh) {
    const im = this.img[name];
    if (!im) return;
    this.ctx.drawImage(im, sx, sy, sw ?? (w ?? im.width), sh ?? (h ?? im.height), x, y, w ?? im.width, h ?? im.height);
  }
  nine(name, x, y, w, h, border) {
    const im = this.img[name], c = this.ctx, iw = im.width, ih = im.height, b = border;
    c.drawImage(im, 0, 0, b, b, x, y, b, b); c.drawImage(im, iw - b, 0, b, b, x + w - b, y, b, b);
    c.drawImage(im, 0, ih - b, b, b, x, y + h - b, b, b); c.drawImage(im, iw - b, ih - b, b, b, x + w - b, y + h - b, b, b);
    c.drawImage(im, b, 0, iw - 2 * b, b, x + b, y, w - 2 * b, b); c.drawImage(im, b, ih - b, iw - 2 * b, b, x + b, y + h - b, w - 2 * b, b);
    c.drawImage(im, 0, b, b, ih - 2 * b, x, y + b, b, h - 2 * b); c.drawImage(im, iw - b, b, b, ih - 2 * b, x + w - b, y + b, b, h - 2 * b);
    c.drawImage(im, b, b, iw - 2 * b, ih - 2 * b, x + b, y + b, w - 2 * b, h - 2 * b);
  }
  drawItem(stack, x, y, opts = {}) {
    if (!stack) return;
    const r = this.game.renderer, S = r.iconSize, cols = r.iconCols, c = this.ctx;
    const id = stack.id;
    const def = ITEMS[id];
    if (!def) return;
    const iconIdx = def.iconIdx ?? id;
    const smooth = !!(def.block && !def.flat && BLOCKS[id] && BLOCKS[id].shape !== SH_CROSS);
    if (typeof Enchant !== 'undefined' && Enchant.hasEnch(stack)) {
      if (!this._glintCanvas) {
        this._glintCanvas = document.createElement('canvas');
        this._glintCanvas.width = 16;
        this._glintCanvas.height = 16;
        this._glintCtx = this._glintCanvas.getContext('2d');
      }
      const gc = this._glintCtx;
      gc.globalCompositeOperation = 'source-over';
      gc.clearRect(0, 0, 16, 16);
      gc.imageSmoothingEnabled = smooth;
      gc.imageSmoothingQuality = 'high';
      gc.drawImage(r.iconAtlas, (iconIdx % cols) * S, Math.floor(iconIdx / cols) * S, S, S, 0, 0, 16, 16);
      gc.imageSmoothingEnabled = false;
      // Mask animated purple glint strictly to non-transparent item pixels
      gc.globalCompositeOperation = 'source-atop';
      const t = (performance.now() * 0.022) % 28;
      for (const off of [t - 14, t]) {
        const g = gc.createLinearGradient(off - 6, -2, off + 6, 18);
        g.addColorStop(0, 'rgba(150, 50, 255, 0.0)');
        g.addColorStop(0.35, 'rgba(185, 85, 255, 0.22)');
        g.addColorStop(0.5, 'rgba(235, 165, 255, 0.36)');
        g.addColorStop(0.65, 'rgba(185, 85, 255, 0.22)');
        g.addColorStop(1, 'rgba(150, 50, 255, 0.0)');
        gc.fillStyle = g;
        gc.fillRect(0, 0, 16, 16);
      }
      gc.globalCompositeOperation = 'source-over';
      c.imageSmoothingEnabled = false;
      c.drawImage(this._glintCanvas, x, y);
    } else {
      c.imageSmoothingEnabled = smooth;
      c.imageSmoothingQuality = 'high';
      c.drawImage(r.iconAtlas, (iconIdx % cols) * S, Math.floor(iconIdx / cols) * S, S, S, x, y, 16, 16);
      c.imageSmoothingEnabled = false;
    }
    if (def && def.durability && stack.dmg > 0) {
      const f = 1 - stack.dmg / def.durability;
      c.fillStyle = '#000'; c.fillRect(x + 2, y + 13, 13, 2);
      c.fillStyle = `hsl(${Math.round(f * 120)},100%,50%)`; c.fillRect(x + 2, y + 13, Math.round(13 * f), 1);
    }
    if (stack.count > 1 || opts.showCount) {
      const t = String(stack.count);
      Font.draw(c, t, x + 17 - Font.width(t), y + 9, '#FFFFFF');
    }
  }
  tooltip(lines, x, y) {
    const c = this.ctx;
    let w = 0; for (const l of lines) w = Math.max(w, Font.width(l.text));
    const h = lines.length * 10 + (lines.length > 1 ? 2 : 0) - 2;
    let tx = x + 12, ty = y - 12;
    if (tx + w + 4 > this.w) tx = x - w - 16;
    if (ty + h + 6 > this.h) ty = this.h - h - 6;
    c.fillStyle = 'rgba(16,0,16,0.94)';
    c.fillRect(tx - 3, ty - 4, w + 6, h + 8); c.fillRect(tx - 4, ty - 3, w + 8, h + 6);
    c.fillStyle = 'rgba(80,0,255,0.32)'; c.fillRect(tx - 3, ty - 3, w + 6, 1); c.fillRect(tx - 3, ty + h + 2, w + 6, 1);
    c.fillRect(tx - 3, ty - 3, 1, h + 6); c.fillRect(tx + w + 2, ty - 3, 1, h + 6);
    let yy = ty;
    lines.forEach((l, i) => { Font.draw(c, l.text, tx, yy, l.color || '#FFFFFF'); yy += i === 0 ? 12 : 10; });
  }
  itemLines(stack) {
    const d = ITEMS[stack.id];
    const hasEnch = typeof Enchant !== 'undefined' && Enchant.hasEnch(stack);
    const isEffectPotion = !!(d.potion && d.potion !== 'water' && d.potion !== 'awkward');
    const titleColor = d.key === 'enchanted_book' ? '#FFFF55' : (hasEnch || isEffectPotion || d.key.includes('diamond') || d.key === 'golden_apple' ? '#55FFFF' : '#FFFFFF');
    const titleText = stack.name ? `${stack.name} (${d.cn})` : d.cn;
    const lines = [{ text: titleText, color: titleColor }];
    if (stack.ench && typeof Enchant !== 'undefined') {
      for (const ek of Object.keys(stack.ench)) {
        lines.push({ text: Enchant.formatEnch(ek, stack.ench[ek]), color: d.key === 'enchanted_book' ? '#FFFF55' : '#AA88FF' });
      }
    }
    if (d.potion) {
      if (d.potion === 'water') lines.push({ text: '无效果', color: '#777777' });
      else if (d.potion === 'awkward') lines.push({ text: '无效果 (酿造基底)', color: '#777777' });
      else if (d.potion === 'instant_health') lines.push({ text: '瞬间治疗 (+8 生命值)', color: '#5588FF' });
      else if (d.potion === 'fire_resistance') lines.push({ text: '抗火 (3:00) - 免疫火焰与熔岩', color: '#5588FF' });
      else if (d.potion === 'speed') lines.push({ text: '迅捷 (3:00) - +20% 移动速度', color: '#5588FF' });
      else if (d.potion === 'night_vision') lines.push({ text: '夜视 (3:00) - 黑暗与水下视野增强', color: '#5588FF' });
    }
    if (d.food) lines.push({ text: `食物: +${d.food[0]} 饥饿值`, color: '#AAAAAA' });
    const sharpBonus = (stack.ench && stack.ench.sharpness) ? (0.5 * stack.ench.sharpness + 0.5) : 0;
    if (d.tool) lines.push({ text: `攻击伤害: ${d.attack + sharpBonus}`, color: '#00AA00' });
    else if (d.attack) lines.push({ text: `攻击伤害: ${d.attack + sharpBonus}`, color: '#00AA00' });
    if (d.armor) lines.push({ text: `护甲值: +${d.armor.points}`, color: '#5555FF' });
    if (d.durability) lines.push({ text: `耐久度: ${d.durability - (stack.dmg || 0)} / ${d.durability}`, color: '#AAAAAA' });
    if (fuelValue(stack.id)) lines.push({ text: `燃料: ${(fuelValue(stack.id) / 200).toFixed(1)} 个物品`, color: '#777777' });
    if (this.game.settings.advTooltips) lines.push({ text: 'minecraft:' + d.key, color: '#555555' });
    return lines;
  }
  button(b) {
    const hover = this.hit(b) && b.enabled !== false;
    this.nine(b.enabled === false ? 'button_dis' : hover ? 'button_hl' : 'button', b.x, b.y, b.w, b.h, 3);
    Font.center(this.ctx, typeof b.label === 'function' ? b.label() : b.label, b.x + b.w / 2, b.y + (b.h - 8) / 2, b.enabled === false ? '#A0A0A0' : hover ? '#FFFFA0' : '#FFFFFF');
  }
  slider(s) {
    this.nine('slider', s.x, s.y, s.w, s.h, 2);
    const hx = s.x + Math.round(s.value * (s.w - 8));
    this.nine(this.hit(s) ? 'slider_handle_hl' : 'slider_handle', hx, s.y, 8, s.h, 2);
    Font.center(this.ctx, s.label(), s.x + s.w / 2, s.y + (s.h - 8) / 2, '#FFFFFF');
  }
  hit(r, mx = this.mouse.x, my = this.mouse.y) { return mx >= r.x && my >= r.y && mx < r.x + r.w && my < r.y + r.h; }
  dim(a = 0.55) { this.ctx.fillStyle = `rgba(16,16,16,${a})`; this.ctx.fillRect(0, 0, this.w, this.h); }
  showInput(x, y, w, h, value, onEnter, opts = {}) {
    const el = this.input, s = this.scale / this.dpr;
    el.style.display = 'block';
    el.style.left = (x * s) + 'px'; el.style.top = (y * s) + 'px'; el.style.width = (w * s) + 'px'; el.style.height = (h * s) + 'px';
    el.style.fontSize = Math.max(12, (h - 6) * s) + 'px';
    el.value = value || ''; el.maxLength = opts.max || 100;
    el.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') onEnter(el.value); if (e.key === 'Escape') { if (opts.onEsc) opts.onEsc(); } };
    el.oninput = () => { if (opts.onInput) opts.onInput(el.value); };
    setTimeout(() => el.focus(), 0);
  }
  hideInput() { this.input.style.display = 'none'; this.input.onkeydown = null; this.input.blur(); }

  // ---- HUD ---------------------------------------------------------------------------
  drawHUD() {
    const g = this.game, p = g.player, c = this.ctx, W = this.w, H = this.h;
    if (this.hideHud) return;
    // crosshair (inverted)
    if (!this.screen && g.perspective === 0) {
      c.globalCompositeOperation = 'difference';
      this.sprite('crosshair', Math.floor(W / 2 - 7.5), Math.floor(H / 2 - 7.5));
      c.globalCompositeOperation = 'source-over';
    }
    const hx = Math.floor(W / 2 - 91), hy = H - 22;
    this.sprite('hotbar', hx, hy);
    this.sprite('hotbar_sel', hx - 1 + p.inv.sel * 20, hy - 1);
    for (let i = 0; i < 9; i++) this.drawItem(p.inv.slots[i], hx + 3 + i * 20, hy + 3);
    if (!p.creative) {
      // xp bar
      const xb = H - 29;
      this.sprite('xp_bg', hx, xb);
      const lvl = g.xpLevel(), need = g.xpNeeded(lvl), prog = (p.xp - g.xpTotalFor(lvl)) / need;
      const pw = Math.floor(182 * clamp(prog, 0, 1));
      if (pw > 0) c.drawImage(this.img.xp_fg, 0, 0, pw, 5, hx, xb, pw, 5);
      if (lvl > 0) { const t = String(lvl), tx = Math.floor(W / 2 - Font.width(t) / 2); for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) Font.drawRaw(c, t, tx + ox, xb - 6 + oy, '#000000'); Font.drawRaw(c, t, tx, xb - 6, '#80FF20'); }
      // hearts
      const hy2 = H - 39;
      const blink = p.invuln > 10 && (p.invuln / 3 | 0) % 2 === 1;
      const low = p.health <= 4;
      for (let i = 0; i < 10; i++) {
        const x = hx + i * 8;
        let y = hy2;
        if (low) y += Math.round(Math.sin(g.tickCount * 1.7 + i * 3.1) * 1);
        this.sprite(blink ? 'heart_container_blink' : 'heart_container', x, y);
        const hpv = p.health - i * 2;
        if (hpv >= 2) this.sprite(blink ? 'heart_full_blink' : 'heart_full', x, y);
        else if (hpv >= 1) this.sprite(blink ? 'heart_half_blink' : 'heart_half', x, y);
      }
      // armor
      const ap = p.inv.armorPoints();
      if (ap > 0) for (let i = 0; i < 10; i++) {
        const v = ap - i * 2;
        this.sprite(v >= 2 ? 'armor_full' : v >= 1 ? 'armor_half' : 'armor_empty', hx + i * 8, hy2 - 10);
      }
      // food
      for (let i = 0; i < 10; i++) {
        const x = hx + 182 - 9 - i * 8;
        let y = hy2;
        if (p.saturation <= 0 && g.tickCount % (p.food * 3 + 1) === 0) y += Math.round(Math.random() * 2 - 1);
        this.sprite('food_empty', x, y);
        const fv = p.food - i * 2;
        if (fv >= 2) this.sprite('food_full', x, y); else if (fv >= 1) this.sprite('food_half', x, y);
      }
      // air
      if (p.eyeInWater || p.air < 300) {
        const bubbles = Math.ceil((p.air - 2) * 10 / 300), full = Math.ceil(p.air * 10 / 300) - bubbles;
        for (let i = 0; i < 10; i++) {
          const x = hx + 182 - 9 - i * 8;
          if (i < bubbles) this.sprite('air', x, hy2 - 10);
          else if (i < bubbles + full && p.air > 0) this.sprite('air_bursting', x, hy2 - 10);
        }
      }
    }
    // held item name
    if (p.inv.sel !== this.lastSel) { this.lastSel = p.inv.sel; this.itemNameT = performance.now(); }
    const held = p.inv.held;
    const dt = performance.now() - this.itemNameT;
    if (held && dt < 2500) {
      const a = dt > 2000 ? 1 - (dt - 2000) / 500 : 1;
      c.globalAlpha = a;
      Font.center(c, held.name || ITEMS[held.id].cn, W / 2, H - (p.creative ? 38 : 58), (typeof Enchant !== 'undefined' && Enchant.hasEnch(held)) ? '#55FFFF' : '#FFFFFF');
      c.globalAlpha = 1;
    }
    // action bar message
    if (this.actionBar && performance.now() - this.actionBar.t < 2500) Font.center(c, this.actionBar.text, W / 2, H - (p.creative ? 50 : 70), this.actionBar.color || '#FFFFFF');
    this.drawChat();
    this.drawToasts();
    this.drawStatusEffects();
    if (this.debug) this.drawDebug();
    if (g.sleepFade > 0) { c.fillStyle = `rgba(10,10,20,${g.sleepFade})`; c.fillRect(0, 0, W, H); }
    if (!this.screen && g.state === 'play' && document.pointerLockElement !== g.canvas && !g.debugPause) {
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, H / 2 - 24, W, 20);
      Font.center(c, '点击屏幕继续游戏', W / 2, H / 2 - 18, '#FFFFFF');
    }
  }
  drawChat() {
    const c = this.ctx, now = performance.now(), open = this.screen && this.screen.isChat;
    let y = this.h - 48;
    const list = open ? this.chat.slice(-20) : this.chat.slice(-10);
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i], age = now - m.t;
      if (!open && age > 10000) continue;
      const a = open ? 1 : clamp((10000 - age) / 1000, 0, 1);
      c.globalAlpha = a * 0.5; c.fillStyle = '#000'; c.fillRect(2, y - 1, 320, 10); c.globalAlpha = a;
      Font.draw(c, m.text, 4, y, m.color);
      c.globalAlpha = 1;
      y -= 10;
    }
  }
  drawToasts() {
    const c = this.ctx, now = performance.now();
    const g = this.game;
    if (g.state === 'play' && g.tutorial >= 0 && g.mode === 'survival' && !this.toasts.length && !this.debug) {
      const st = TUTORIAL[g.tutorial], x = this.w - 160;
      this.sprite('toast', x, 0);
      this.drawItem({ id: item(st.icon), count: 1 }, x + 8, 8);
      Font.draw(c, st.title, x + 30, 7, '#55FFFF', false);
      Font.draw(c, st.text, x + 30, 18, '#FFFFFF', false);
    }
    this.toasts = this.toasts.filter(t => now - t.t < 5500);
    let y = 0;
    for (const t of this.toasts) {
      const age = now - t.t;
      const slide = age < 400 ? 1 - age / 400 : age > 5000 ? (age - 5000) / 500 : 0;
      const x = this.w - 160 + Math.round(slide * 160);
      this.sprite('toast', x, y);
      if (t.icon) this.drawItem({ id: t.icon, count: 1 }, x + 8, y + 8);
      Font.draw(c, t.title, x + 30, y + 7, '#FFFF00', false);
      Font.draw(c, t.sub, x + 30, y + 18, '#FFFFFF', false);
      y += 32;
    }
  }
  drawStatusEffects() {
    const g = this.game, p = g.player, c = this.ctx, W = this.w;
    if (!p || !p.effects || typeof STATUS_EFFECTS === 'undefined') return;
    const keys = Object.keys(p.effects).filter(k => p.effects[k] && p.effects[k].ticks > 0);
    if (!keys.length) return;
    const toastOffset = (this.toasts && this.toasts.length)
      ? this.toasts.length * 32 + 4
      : (g.state === 'play' && g.tutorial >= 0 && g.mode === 'survival' && !this.debug ? 36 : 4);
    let by = toastOffset;
    for (const k of keys) {
      const st = p.effects[k];
      const def = STATUS_EFFECTS[k];
      if (!def) continue;
      const sec = Math.max(0, Math.ceil(st.ticks / 20));
      const mm = Math.floor(sec / 60);
      const ss = String(sec % 60).padStart(2, '0');
      const timeStr = `${mm}:${ss}`;
      const label = `${def.cn} ${timeStr}`;
      const bx = W - 28;
      // Background box (24x24)
      if (this.img.effect_bg) {
        this.sprite('effect_bg', bx, by, 24, 24);
      } else {
        c.fillStyle = 'rgba(24, 24, 32, 0.82)';
        c.fillRect(bx, by, 24, 24);
        c.fillStyle = '#8B8B8B';
        c.fillRect(bx, by, 24, 1);
        c.fillRect(bx, by, 1, 24);
      }
      // Blink icon when < 5 seconds left
      const blinkAlpha = st.ticks <= 100 ? (0.4 + 0.6 * Math.abs(Math.sin(g.tickCount * 0.35))) : 1;
      c.globalAlpha = blinkAlpha;
      if (this.img[def.icon]) {
        this.sprite(def.icon, bx + 3, by + 3, 18, 18);
      }
      c.globalAlpha = 1;
      // Label & timer to the left of the effect box
      const lw = Font.width(label);
      c.fillStyle = 'rgba(0, 0, 0, 0.45)';
      c.fillRect(bx - lw - 5, by + 6, lw + 3, 11);
      Font.draw(c, label, bx - lw - 4, by + 8, st.ticks <= 100 ? '#FF8888' : '#E8E8E8');
      by += 26;
    }
  }
  drawDebug() {
    const g = this.game, p = g.player, c = this.ctx;
    const x = Math.floor(p.pos[0]), y = Math.floor(p.pos[1]), z = Math.floor(p.pos[2]);
    const dirs = ['南 (+Z)', '西 (-X)', '北 (-Z)', '东 (+X)'];
    let yaw = ((-p.yaw * 180 / Math.PI) % 360 + 540) % 360 - 180;
    const facing = dirs[Math.round(((yaw + 180) % 360) / 90) % 4];
    const ch = g.world.getChunk(x >> 4, z >> 4);
    const bi = ch ? BIOMES[ch.biome[((z & 15) << 4) | (x & 15)]] : '?';
    const l = g.world.getLight(x, y, z);
    const t = g.dayTime();
    const wk = g.worker ? (g.worker.isReady() ? `Worker (队列 ${g.worker.queue.length})` : `主线程回退`) : '关闭';
    const L = [
      `Minecraft JS 复刻版 (26.2 官方材质)`,
      `${g.fps} fps  区段: ${g.renderer.stats ? g.renderer.stats.sections : 0}  三角形: ${g.renderer.stats ? g.renderer.stats.tris : 0}  计算: ${wk}`,
      `区块: 已加载 ${g.world.chunks.size}  待生成 ${g.genQueueLen || 0}  实体: ${g.entities.length}  粒子: ${g.particles.list.length}`,
      ``,
      `XYZ: ${p.pos[0].toFixed(3)} / ${p.pos[1].toFixed(3)} / ${p.pos[2].toFixed(3)}`,
      `方块: ${x} ${y} ${z}   区块: ${x >> 4} ${z >> 4}`,
      `朝向: ${facing} (${yaw.toFixed(1)} / ${(p.pitch * 180 / Math.PI).toFixed(1)})`,
      `生物群系: ${bi}`,
      `光照: 天空 ${l >> 4}  方块 ${l & 15}`,
      `时间: 第 ${Math.floor(g.worldTime / 24000) + 1} 天  ${String(Math.floor((t / 1000 + 6) % 24)).padStart(2, '0')}:${String(Math.floor((t % 1000) * 0.06)).padStart(2, '0')}`,
      `种子: ${g.world.seed}`,
    ];
    if (g.target) {
      const [tx, ty, tz] = g.target.pos;
      const tid = g.world.getBlock(tx, ty, tz), tm = g.world.getMeta(tx, ty, tz), b = BLOCKS[tid];
      let rsInfo = '';
      if (tid === 119) rsInfo = ` [信号强度: ${tm & 15}]`;
      else if (tid === 127 || tid === 156) rsInfo = ` [延迟: ${((tm >> 2) & 3) + 1}刻, 充能: ${tid === 156 ? '是' : '否'}]`;
      else if (tid === 514) rsInfo = ` [模式: ${(tm & 4) ? '减法' : '比较'}, 输出: ${(tm >> 4) & 15}]`;
      else if (tid === 515) rsInfo = ` [侦测面: ${tm & 7}, 脉冲: ${(tm & 8) ? '是' : '否'}]`;
      else if (tid === 516 || tid === 517) rsInfo = ` [朝向: ${tm & 7}, 伸出: ${(tm & 8) ? '是' : '否'}]`;
      else if (tid === 122 || tid === 123 || tid === 159) rsInfo = ` [激活: ${(tm & 8) ? '是' : '否'}]`;
      else if (tid === 124 || tid === 169) rsInfo = ` [踩下: ${(tm & 1) ? '是' : '否'}]`;
      else if (typeof Redstone !== 'undefined' && Redstone.isBlockPowered(g.world, tx, ty, tz)) rsInfo = ` [受红石充能]`;
      L.push(`目标方块: minecraft:${b ? b.key : '?'} (${tx}, ${ty}, ${tz}) meta=${tm}${rsInfo}`);
    }
    let yy = 2;
    for (const s of L) { if (s) { const w = Font.width(s); c.fillStyle = 'rgba(80,80,80,0.55)'; c.fillRect(1, yy - 1, w + 2, 10); Font.draw(c, s, 2, yy, '#E0E0E0', false); } yy += 10; }
  }

  // ---- frame ------------------------------------------------------------------------------
  draw() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.imageSmoothingEnabled = false;
    const g = this.game;
    if (g.state === 'play') {
      this.drawOverlays();
      this.drawHUD();
    }
    if (this.screen) this.screen.draw(this);
    if (this.cursor) this.drawItem(this.cursor, this.mouse.x - 8, this.mouse.y - 8);
  }
  drawOverlays() {
    const g = this.game, p = g.player, c = this.ctx, W = this.w, H = this.h;
    // vignette (convert inverted mask if needed and draw as dark corner alpha overlay)
    if (!this._vigCanvas && this.img.vignette) {
      const vImg = this.img.vignette, vw = vImg.width || 256, vh = vImg.height || 256;
      const vc = document.createElement('canvas'); vc.width = vw; vc.height = vh;
      const vx = vc.getContext('2d'); vx.drawImage(vImg, 0, 0);
      const id = vx.getImageData(0, 0, vw, vh), d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = Math.max(d[i], d[i + 1], d[i + 2]);
        const alpha = lum > 0 ? lum : d[i + 3];
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = alpha;
      }
      vx.putImageData(id, 0, 0);
      this._vigCanvas = vc;
    }
    if (this._vigCanvas) {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 0.38;
      c.imageSmoothingEnabled = true;
      c.drawImage(this._vigCanvas, 0, 0, W, H);
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 1;
    }
    if (g.headInWater) {
      c.globalAlpha = 0.25; c.imageSmoothingEnabled = true;
      const ox = (p.yaw * 64) % 64, oy = (p.pitch * 64) % 64;
      for (let x = -64; x < W + 64; x += 64) for (let y = -64; y < H + 64; y += 64) c.drawImage(this.img.underwater, x + ox, y + oy, 64, 64);
      c.globalAlpha = 1; c.imageSmoothingEnabled = false;
    }
    if (g.headInLava) { c.fillStyle = 'rgba(200,60,0,0.75)'; c.fillRect(0, 0, W, H); }
    if (p.fire > 0 && !p.creative && g.perspective === 0) {
      const r = g.renderer, layer = T('fire_0') + (g.tickCount % 32);
      c.globalAlpha = 0.85;
      const s = Math.min(W, H) * 0.45;
      c.drawImage(r.stripCanvas, 0, layer * 16, 16, 16, W / 2 - s * 1.1, H - s * 0.75, s, s);
      c.drawImage(r.stripCanvas, 0, layer * 16, 16, 16, W / 2 + s * 0.1, H - s * 0.75, s, s);
      c.globalAlpha = 1;
    }
    if (p.hurtTime > 0) { c.fillStyle = `rgba(160,0,0,${p.hurtTime / 10 * 0.25})`; c.fillRect(0, 0, W, H); }
    if (p.deathTime > 0) { const a = Math.min(0.6, p.deathTime / 40); const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, `rgba(80,0,0,${a})`); gr.addColorStop(1, `rgba(160,20,20,${a})`); c.fillStyle = gr; c.fillRect(0, 0, W, H); }
  }

  // ---- input routing -----------------------------------------------------------------------
  mouseMove(ev) {
    [this.mouse.x, this.mouse.y] = this.toGui(ev);
    if (this.screen && this.screen.mouseMove) this.screen.mouseMove(this, this.mouse.x, this.mouse.y);
  }
  mouseDown(ev) {
    [this.mouse.x, this.mouse.y] = this.toGui(ev);
    this.mouse.down = true; this.mouse.button = ev.button;
    if (this.screen && this.screen.mouseDown) this.screen.mouseDown(this, this.mouse.x, this.mouse.y, ev.button, ev.shiftKey);
  }
  mouseUp(ev) {
    [this.mouse.x, this.mouse.y] = this.toGui(ev);
    this.mouse.down = false;
    if (this.screen && this.screen.mouseUp) this.screen.mouseUp(this, this.mouse.x, this.mouse.y, ev.button);
  }
  wheel(dy) { if (this.screen && this.screen.wheel) this.screen.wheel(this, dy); }
  key(ev) { if (this.screen && this.screen.key) return this.screen.key(this, ev); return false; }
}

// ---------------------------------------------------------------------------
// Container screen base (slot handling, MC click semantics)
// ---------------------------------------------------------------------------
class ContainerScreen {
  constructor(game, bg, w, h, title) { this.game = game; this.bg = bg; this.gw = w; this.gh = h; this.title = title; this.slots = []; this.dragSlots = null; }
  layout() { const u = this.game.ui; this.x = Math.floor((u.w - this.gw) / 2); this.y = Math.floor((u.h - this.gh) / 2); }
  addPlayerSlots(y0, hotY, x0 = 8) {
    const inv = this.game.player.inv;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
      const i = 9 + r * 9 + c;
      this.slots.push({ x: x0 + c * 18, y: y0 + r * 18, get: () => inv.slots[i], set: (s) => { inv.slots[i] = s; }, group: 'main', idx: i });
    }
    for (let c = 0; c < 9; c++) this.slots.push({ x: x0 + c * 18, y: hotY, get: () => inv.slots[c], set: (s) => { inv.slots[c] = s; }, group: 'hotbar', idx: c });
  }
  slotAt(mx, my) {
    for (const s of this.slots) if (mx >= this.x + s.x - 1 && mx < this.x + s.x + 17 && my >= this.y + s.y - 1 && my < this.y + s.y + 17) return s;
    return null;
  }
  drawBase(ui) {
    ui.dim(0.6);
    if (this.bg && ui.img[this.bg]) {
      ui.ctx.drawImage(ui.img[this.bg], 0, 0, this.gw, this.gh, this.x, this.y, this.gw, this.gh);
    } else {
      const c = ui.ctx;
      c.fillStyle = '#C6C6C6'; c.fillRect(this.x, this.y, this.gw, this.gh);
      c.fillStyle = '#FFFFFF'; c.fillRect(this.x, this.y, this.gw - 1, 1); c.fillRect(this.x, this.y, 1, this.gh - 1);
      c.fillStyle = '#555555'; c.fillRect(this.x + 1, this.y + this.gh - 1, this.gw - 1, 1); c.fillRect(this.x + this.gw - 1, this.y + 1, 1, this.gh - 1);
    }
    if (this.title) Font.draw(ui.ctx, this.title, this.x + 8, this.y + 6, '#404040', false);
  }
  drawSlots(ui) {
    const hov = this.slotAt(ui.mouse.x, ui.mouse.y);
    for (const s of this.slots) {
      const st = s.get();
      if (!st && s.emptyIcon) { ui.ctx.globalAlpha = 0.6; ui.sprite(s.emptyIcon, this.x + s.x, this.y + s.y); ui.ctx.globalAlpha = 1; }
      ui.drawItem(st, this.x + s.x, this.y + s.y);
      if (s === hov || (this.dragSlots && this.dragSlots.has(s))) { ui.ctx.fillStyle = 'rgba(255,255,255,0.5)'; ui.ctx.fillRect(this.x + s.x, this.y + s.y, 16, 16); }
    }
    if (hov && hov.get() && !ui.cursor) ui.tooltip(ui.itemLines(hov.get()), ui.mouse.x, ui.mouse.y);
  }
  draw(ui) { this.drawBase(ui); this.drawExtra && this.drawExtra(ui); this.drawSlots(ui); }
  canPlace(s, st) { return !s.output && (!s.accept || s.accept(st)); }
  maxIn(s, st) { return Math.min(maxStack(st.id), s.max || 64); }
  mouseDown(ui, mx, my, button, shift) {
    const s = this.slotAt(mx, my);
    if (!s) {
      if (this.outside && this.outside(mx, my) && ui.cursor) {
        if (button === 0) { this.game.dropFromPlayer(ui.cursor); ui.cursor = null; }
        else if (button === 2) { this.game.dropFromPlayer({ ...ui.cursor, count: 1 }); ui.cursor.count--; if (!ui.cursor.count) ui.cursor = null; }
      }
      return;
    }
    Sound.init();
    if (s.output) { this.takeOutput(ui, s, shift); return; }
    if (shift && button === 0) { this.quickMove(s); this.changed(); return; }
    const st = s.get();
    // start drag distribution
    const sameMeta = (a, b) => !ITEMS[a.id].durability && (typeof Enchant === 'undefined' || Enchant.sameStackMeta(a, b));
    if (ui.cursor && (button === 0 || button === 2) && (!st || (st.id === ui.cursor.id && sameMeta(st, ui.cursor)))) {
      this.dragSlots = new Set([s]); this.dragButton = button; this.dragStart = s;
    }
    const now = performance.now();
    if (button === 0 && !ui.cursor && st == null && this.lastClick && now - this.lastClick.t < 300 && this.lastClick.id != null) {
      // double click: gather
      const id = this.lastClick.id; ui.cursor = this.lastClick.stack;
      if (ui.cursor) for (const o of this.slots) { const os = o.get(); if (os && !o.output && os.id === id && sameMeta(os, ui.cursor) && ui.cursor.count < maxStack(id)) { const k = Math.min(os.count, maxStack(id) - ui.cursor.count); ui.cursor.count += k; os.count -= k; if (!os.count) o.set(null); } }
      this.lastClick = null; this.changed(); return;
    }
    if (this.dragSlots) return; // resolved on mouseUp
    this.clickSlot(ui, s, button);
    this.lastClick = { t: now, id: ui.cursor ? ui.cursor.id : null, stack: ui.cursor };
  }
  clickSlot(ui, s, button) {
    const st = s.get();
    if (button === 0) {
      if (!ui.cursor) { if (st) { ui.cursor = st; s.set(null); } }
      else if (!st) { if (this.canPlace(s, ui.cursor)) { const k = Math.min(ui.cursor.count, this.maxIn(s, ui.cursor)); s.set({ ...ui.cursor, count: k }); ui.cursor.count -= k; if (!ui.cursor.count) ui.cursor = null; } }
      else if (st.id === ui.cursor.id && !ITEMS[st.id].durability && (typeof Enchant === 'undefined' || Enchant.sameStackMeta(st, ui.cursor))) { const k = Math.min(ui.cursor.count, this.maxIn(s, st) - st.count); st.count += k; ui.cursor.count -= k; if (!ui.cursor.count) ui.cursor = null; }
      else if (this.canPlace(s, ui.cursor)) { s.set(ui.cursor); ui.cursor = st; }
    } else if (button === 2) {
      if (!ui.cursor) { if (st) { const k = Math.ceil(st.count / 2); ui.cursor = { ...st, count: k }; st.count -= k; if (!st.count) s.set(null); } }
      else if (!st) { if (this.canPlace(s, ui.cursor)) { s.set({ ...ui.cursor, count: 1 }); ui.cursor.count--; if (!ui.cursor.count) ui.cursor = null; } }
      else if (st.id === ui.cursor.id && st.count < this.maxIn(s, st) && !ITEMS[st.id].durability && (typeof Enchant === 'undefined' || Enchant.sameStackMeta(st, ui.cursor))) { st.count++; ui.cursor.count--; if (!ui.cursor.count) ui.cursor = null; }
      else if (this.canPlace(s, ui.cursor)) { s.set(ui.cursor); ui.cursor = st; }
    }
    this.changed();
  }
  mouseMove(ui, mx, my) {
    if (this.dragSlots && ui.mouse.down && ui.cursor) {
      const s = this.slotAt(mx, my);
      const st = s && s.get();
      const canMerge = !st || (st.id === ui.cursor.id && !ITEMS[st.id].durability && (typeof Enchant === 'undefined' || Enchant.sameStackMeta(st, ui.cursor)));
      if (s && !s.output && canMerge && this.canPlace(s, ui.cursor) && this.dragSlots.size < ui.cursor.count) this.dragSlots.add(s);
    }
  }
  mouseUp(ui, mx, my, button) {
    if (!this.dragSlots) return;
    const set = [...this.dragSlots]; this.dragSlots = null;
    if (set.length === 1) { this.clickSlot(ui, set[0], this.dragButton); return; }
    if (!ui.cursor) return;
    const per = this.dragButton === 2 ? 1 : Math.floor(ui.cursor.count / set.length);
    if (per < 1) return;
    for (const s of set) {
      if (!ui.cursor) break;
      const st = s.get();
      if (st && (st.id !== ui.cursor.id || ITEMS[st.id].durability || (typeof Enchant !== 'undefined' && !Enchant.sameStackMeta(st, ui.cursor)))) continue;
      const room = this.maxIn(s, ui.cursor) - (st ? st.count : 0);
      const k = Math.min(per, room, ui.cursor.count);
      if (k <= 0) continue;
      if (st) st.count += k; else s.set(typeof Enchant !== 'undefined' ? Enchant.cloneStack(ui.cursor, k) : { ...ui.cursor, count: k });
      ui.cursor.count -= k; if (!ui.cursor.count) ui.cursor = null;
    }
    this.changed();
  }
  quickMove(s) {
    const st = s.get(); if (!st) return;
    let targets;
    if (s.group === 'hotbar') targets = this.slots.filter(o => o.group === 'container').length ? this.slots.filter(o => o.group === 'container') : this.slots.filter(o => o.group === 'main');
    else if (s.group === 'main') targets = this.slots.filter(o => o.group === 'container').length ? this.slots.filter(o => o.group === 'container') : this.slots.filter(o => o.group === 'hotbar');
    else targets = this.slots.filter(o => o.group === 'hotbar' || o.group === 'main').sort((a, b) => (a.group === 'hotbar' ? 1 : 0) - (b.group === 'hotbar' ? 1 : 0)).reverse();
    if (ITEMS[st.id].armor && (s.group === 'main' || s.group === 'hotbar')) {
      const a = this.slots.find(o => o.armorSlot === ITEMS[st.id].armor.slot && !o.get());
      if (a) { a.set(st); s.set(null); return; }
    }
    targets = targets.filter(t => this.canPlace(t, st));
    for (const t of targets) { const ts = t.get(); if (ts && ts.id === st.id && !ITEMS[st.id].durability && (typeof Enchant === 'undefined' || Enchant.sameStackMeta(ts, st))) { const k = Math.min(st.count, this.maxIn(t, st) - ts.count); ts.count += k; st.count -= k; if (!st.count) { s.set(null); return; } } }
    for (const t of targets) { if (!t.get()) { const k = Math.min(st.count, this.maxIn(t, st)); t.set({ ...st, count: k }); st.count -= k; if (!st.count) { s.set(null); return; } } }
  }
  takeOutput(ui, s, shift) {
    const st = s.get(); if (!st) return;
    const clone = (x) => typeof Enchant !== 'undefined' ? Enchant.cloneStack(x) : { ...x };
    if (shift) {
      let guard = 0;
      while (s.get() && guard++ < 64) {
        const out = s.get();
        if (!this.game.player.inv.canFit(out)) break;
        this.game.player.inv.add(clone(out));
        s.onTake(out);
        this.changed();
      }
      return;
    }
    if (!ui.cursor) { ui.cursor = clone(st); s.onTake(st); }
    else if (ui.cursor.id === st.id && !ITEMS[st.id].durability && (typeof Enchant === 'undefined' || Enchant.sameStackMeta(ui.cursor, st)) && ui.cursor.count + st.count <= maxStack(st.id)) { ui.cursor.count += st.count; s.onTake(st); }
    this.changed();
  }
  key(ui, ev) {
    const k = ev.key;
    if (k >= '1' && k <= '9') {
      const s = this.slotAt(ui.mouse.x, ui.mouse.y);
      if (s && !s.output) {
        const inv = this.game.player.inv, i = +k - 1;
        const a = s.get(), b = inv.slots[i];
        if (!b || this.canPlace(s, b)) { s.set(b); inv.slots[i] = a; this.changed(); }
      }
      return true;
    }
    if (k === 'q' || k === 'Q') {
      const s = this.slotAt(ui.mouse.x, ui.mouse.y);
      if (s && s.get() && !s.output) { const st = s.get(); const n = ev.ctrlKey ? st.count : 1; this.game.dropFromPlayer({ ...st, count: n }); st.count -= n; if (!st.count) s.set(null); this.changed(); }
      return true;
    }
    return false;
  }
  outside(mx, my) { return mx < this.x || my < this.y || mx > this.x + this.gw || my > this.y + this.gh; }
  changed() {
    if (this.be && this.be.pos && typeof Redstone !== 'undefined' && Redstone.updateComparatorsNear) {
      Redstone.updateComparatorsNear(this.game, this.be.pos[0], this.be.pos[1], this.be.pos[2]);
      if (this.game.flushMesh) this.game.flushMesh();
    }
  }
}

class CraftingScreen extends ContainerScreen {
  constructor(game, size) {
    const big = size === 3;
    super(game, big ? 'crafting_table' : 'inventory', 176, 166, big ? '合成' : null);
    this.size = size; this.grid = new Array(size * size).fill(null);
    const ox = big ? 30 : 98, oy = big ? 17 : 18;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const i = r * size + c;
      this.slots.push({ x: ox + c * 18, y: oy + r * 18, get: () => this.grid[i], set: (s) => { this.grid[i] = s; }, group: 'craft' });
    }
    this.result = null;
    this.slots.push({ x: big ? 124 : 154, y: big ? 35 : 28, output: true, get: () => this.result, set: () => { }, onTake: () => this.consume() });
    if (!big) {
      const inv = game.player.inv;
      const icons = ['slot_helmet', 'slot_chestplate', 'slot_leggings', 'slot_boots'];
      for (let i = 0; i < 4; i++) this.slots.push({ x: 8, y: 8 + i * 18, armorSlot: i, emptyIcon: icons[i], get: () => inv.slots[36 + i], set: (s) => { inv.slots[36 + i] = s; }, accept: (st) => ITEMS[st.id].armor && ITEMS[st.id].armor.slot === i, max: 1, group: 'armor' });
    }
    this.addPlayerSlots(84, 142);
  }
  changed() {
    const r = matchRecipe(this.grid, this.size);
    this.result = r ? { id: r.result, count: r.count, dmg: 0 } : null;
  }
  layout() {
    super.layout();
    const u = this.game.ui;
    this.bookFits = u.w >= this.gw + 152;
    this.bookOpen = this.bookFits && this.game.settings.recipeBook !== false;
    if (this.bookOpen) this.x = Math.floor((u.w - this.gw - 149) / 2) + 149;
    this.bookBtn = this.size === 3 ? { x: 5, y: 34, w: 20, h: 18 } : { x: 104, y: 61, w: 20, h: 18 };
    this.page = this.page || 0;
  }
  bookRecipes() {
    const n = this.size * this.size;
    const inv = this.game.player.inv;
    const avail = new Map();
    for (let i = 0; i < 36; i++) { const s = inv.slots[i]; if (s) avail.set(s.id, (avail.get(s.id) || 0) + s.count); }
    for (const s of this.grid) if (s) avail.set(s.id, (avail.get(s.id) || 0) + s.count);
    const list = [];
    for (const r of RECIPES) {
      if (r.type === 'shaped' ? (r.w > this.size || r.h > this.size) : r.ing.length > n) continue;
      const plan = planRecipe(r, avail, this.size);
      if (this.onlyCraftable && !plan) continue;
      list.push({ r, plan });
    }
    list.sort((a, b) => (b.plan ? 1 : 0) - (a.plan ? 1 : 0));
    return list;
  }
  fillRecipe(entry, max) {
    const inv = this.game.player.inv, ui = this.game.ui;
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i]) { ui.returnStack(this.grid[i]); this.grid[i] = null; }
    const avail = new Map();
    for (let i = 0; i < 36; i++) { const s = inv.slots[i]; if (s) avail.set(s.id, (avail.get(s.id) || 0) + s.count); }
    const plan = planRecipe(entry.r, avail, this.size);
    if (!plan) { this.changed(); return; }
    let times = 1;
    if (max) {
      const need = new Map(); for (const c of plan) if (c) need.set(c.id, (need.get(c.id) || 0) + 1);
      times = 64;
      for (const [id, k] of need) times = Math.min(times, Math.floor(avail.get(id) / k), maxStack(id));
      times = Math.max(1, times);
    }
    plan.forEach((c, i) => { if (c) { inv.remove(c.id, times); this.grid[i] = { id: c.id, count: times, dmg: 0 }; } });
    this.changed();
    Sound.click();
  }
  bookLayout() { return { x: this.x - 149, y: this.y, w: 147, h: 166 }; }
  drawBook(ui) {
    const c = ui.ctx, P = this.bookLayout();
    c.fillStyle = '#C6C6C6'; c.fillRect(P.x, P.y, P.w, P.h);
    c.fillStyle = '#FFFFFF'; c.fillRect(P.x, P.y, P.w - 1, 1); c.fillRect(P.x, P.y, 1, P.h - 1);
    c.fillStyle = '#555555'; c.fillRect(P.x + 1, P.y + P.h - 1, P.w - 1, 1); c.fillRect(P.x + P.w - 1, P.y + 1, 1, P.h - 1);
    Font.draw(c, '配方书', P.x + 8, P.y + 7, '#404040', false);
    this.filterBtn = { x: P.x + 82, y: P.y + 4, w: 58, h: 14 };
    ui.nine(ui.hit(this.filterBtn) ? 'button_hl' : 'button', this.filterBtn.x, this.filterBtn.y, this.filterBtn.w, this.filterBtn.h, 3);
    Font.center(c, this.onlyCraftable ? '仅可合成' : '全部配方', this.filterBtn.x + 29, this.filterBtn.y + 3, '#FFFFFF');
    const list = this.bookRecipes();
    const per = 20, pages = Math.max(1, Math.ceil(list.length / per));
    this.page = clamp(this.page, 0, pages - 1);
    this.bookCells = [];
    let hover = null;
    list.slice(this.page * per, this.page * per + per).forEach((e, i) => {
      const x = P.x + 11 + (i % 5) * 25, y = P.y + 24 + Math.floor(i / 5) * 25;
      const cell = { x, y, w: 25, h: 25, e };
      this.bookCells.push(cell);
      c.fillStyle = e.plan ? '#7FA06A' : '#A05050';
      c.fillRect(x + 1, y + 1, 23, 23);
      c.fillStyle = e.plan ? '#5E7E4E' : '#7A3A3A'; c.fillRect(x + 1, y + 23, 23, 1); c.fillRect(x + 23, y + 1, 1, 23);
      ui.drawItem({ id: e.r.result, count: e.r.count }, x + 5, y + 5);
      if (ui.hit(cell)) { c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(x + 1, y + 1, 23, 23); hover = e; }
    });
    this.prevBtn = { x: P.x + 38, y: P.y + 130, w: 12, h: 17 }; this.nextBtn = { x: P.x + 93, y: P.y + 130, w: 12, h: 17 };
    if (pages > 1) {
      Font.center(c, (this.page + 1) + '/' + pages, P.x + 73, P.y + 135, '#404040', false);
      Font.draw(c, '<', this.prevBtn.x + 3, this.prevBtn.y + 5, this.page > 0 ? (ui.hit(this.prevBtn) ? '#FFFFA0' : '#404040') : '#909090', false);
      Font.draw(c, '>', this.nextBtn.x + 3, this.nextBtn.y + 5, this.page < pages - 1 ? (ui.hit(this.nextBtn) ? '#FFFFA0' : '#404040') : '#909090', false);
    }
    Font.draw(c, 'Shift+点击 填充最多', P.x + 8, P.y + 152, '#606060', false);
    if (hover && !ui.cursor) {
      const lines = [{ text: ITEMS[hover.r.result].cn + (hover.r.count > 1 ? ' x' + hover.r.count : '') }];
      const need = new Map();
      const ings = hover.r.type === 'shaped' ? hover.r.pattern.join('').split('').filter(ch => ch !== ' ').map(ch => hover.r.keys[ch]) : hover.r.ing;
      for (const opts of ings) { const k = opts.map(id => ITEMS[id].cn).slice(0, 2).join('/'); need.set(k, (need.get(k) || 0) + 1); }
      for (const [k, n] of need) lines.push({ text: k + ' x' + n, color: '#AAAAAA' });
      if (!hover.plan) lines.push({ text: '材料不足', color: '#FF5555' });
      ui.tooltip(lines, ui.mouse.x, ui.mouse.y);
    }
  }
  consume() {
    const r = this.result;
    for (let i = 0; i < this.grid.length; i++) {
      const s = this.grid[i];
      if (s) {
        if (s.id === item('water_bucket') || s.id === item('lava_bucket')) { this.grid[i] = makeStack('bucket'); continue; }
        s.count--; if (!s.count) this.grid[i] = null;
      }
    }
    if (r) this.game.onCraft(r.id, r.count);
    this.changed();
  }
  draw(ui) {
    this.drawBase(ui);
    if (this.bookOpen) this.drawBook(ui);
    this.drawExtra(ui);
    if (this.bookFits) {
      const b = this.bookBtn;
      ui.sprite(ui.hit({ x: this.x + b.x, y: this.y + b.y, w: b.w, h: b.h }) ? 'rb_button_hl' : 'rb_button', this.x + b.x, this.y + b.y);
    }
    this.drawSlots(ui);
  }
  mouseDown(ui, mx, my, button, shift) {
    const b = this.bookBtn;
    if (this.bookFits && ui.hit({ x: this.x + b.x, y: this.y + b.y, w: b.w, h: b.h }, mx, my)) {
      this.game.settings.recipeBook = !this.bookOpen; this.game.saveSettings(); this.layout(); Sound.click(); return;
    }
    if (this.bookOpen) {
      if (ui.hit(this.filterBtn || { x: 0, y: 0, w: 0, h: 0 }, mx, my)) { this.onlyCraftable = !this.onlyCraftable; this.page = 0; Sound.click(); return; }
      if (ui.hit(this.prevBtn || { x: 0, y: 0, w: 0, h: 0 }, mx, my)) { this.page--; Sound.click(); return; }
      if (ui.hit(this.nextBtn || { x: 0, y: 0, w: 0, h: 0 }, mx, my)) { this.page++; Sound.click(); return; }
      for (const c of this.bookCells || []) if (ui.hit(c, mx, my)) { if (!ui.cursor) this.fillRecipe(c.e, shift); return; }
      if (ui.hit(this.bookLayout(), mx, my)) return;
    }
    super.mouseDown(ui, mx, my, button, shift);
  }
  wheel(ui, dy) { if (this.bookOpen && ui.hit(this.bookLayout())) this.page += Math.sign(dy); }
  outside(mx, my) { return super.outside(mx, my) && !(this.bookOpen && this.game.ui.hit(this.bookLayout(), mx, my)); }
  drawExtra(ui) {
    if (this.size === 2) {
      Font.draw(ui.ctx, '合成', this.x + 97, this.y + 6, '#404040', false);
      // player preview
      const pv = this.game.renderer.playerPreview(this.game, ui, this.x + 26, this.y + 8, 49, 70);
      if (pv) { ui.ctx.imageSmoothingEnabled = true; ui.ctx.drawImage(pv, this.x + 26, this.y + 8, 49, 70); ui.ctx.imageSmoothingEnabled = false; }
    } else Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + 73, '#404040', false);
  }
  close() {
    for (const s of this.grid) if (s) this.game.ui.returnStack(s);
    this.grid.fill(null);
  }
}

class ChestScreen extends ContainerScreen {
  constructor(game, be, title = '箱子') {
    super(game, 'generic_54', 176, 168, title);
    this.be = be;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
      const i = r * 9 + c;
      this.slots.push({ x: 8 + c * 18, y: 18 + r * 18, get: () => be.slots[i], set: (s) => { be.slots[i] = s; }, group: 'container' });
    }
    this.addPlayerSlots(85, 143);
  }
  drawBase(ui) {
    ui.dim(0.6);
    const c = ui.ctx, im = ui.img.generic_54;
    c.drawImage(im, 0, 0, 176, 71, this.x, this.y, 176, 71);
    c.drawImage(im, 0, 126, 176, 96, this.x, this.y + 71, 176, 96);
    Font.draw(c, this.title, this.x + 8, this.y + 6, '#404040', false);
    Font.draw(c, '物品栏', this.x + 8, this.y + 74, '#404040', false);
  }
  close() { this.game.markBlockEntity(this.be); Sound.door(this.be.pos, false); }
}

class HopperScreen extends ContainerScreen {
  constructor(game, be) {
    super(game, 'hopper_gui', 176, 133, '漏斗');
    this.be = be;
    if (!Array.isArray(be.slots)) be.slots = new Array(5).fill(null);
    for (let i = 0; i < 5; i++) {
      this.slots.push({
        x: 44 + i * 18,
        y: 20,
        get: () => be.slots[i],
        set: (s) => { be.slots[i] = s; },
        group: 'container',
      });
    }
    this.addPlayerSlots(51, 109);
  }
  drawExtra(ui) {
    Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + 40, '#404040', false);
  }
  close() { this.game.markBlockEntity(this.be); }
}

class TradingScreen extends ContainerScreen {
  constructor(game, villager) {
    if (typeof Trading !== 'undefined') Trading.ensureVillager(villager, game);
    const profDef = typeof Trading !== 'undefined' ? Trading.profDef(villager.profession) : { cn: '村民' };
    const lvlName = typeof Trading !== 'undefined' ? Trading.levelName(villager.level || 1) : '新手';
    super(game, null, 276, 166, `${profDef.cn} - ${lvlName}`);
    this.villager = villager;
    this.selTrade = 0;
    this.scroll = 0;
    this.payA = null;
    this.payB = null;
    this.result = null;
    this.tradeCells = [];

    this.slots.push({
      x: 136, y: 37, group: 'container',
      get: () => this.payA,
      set: (s) => { this.payA = s; },
    });
    this.slots.push({
      x: 162, y: 37, group: 'container',
      get: () => this.payB,
      set: (s) => { this.payB = s; },
    });
    this.slots.push({
      x: 220, y: 37, output: true,
      get: () => this.result,
      set: () => { },
      onTake: () => this.consumeTrade(),
    });
    this.addPlayerSlots(84, 142, 108);
  }

  trades() {
    return (this.villager && this.villager.trades) || [];
  }

  activeTrade() {
    const list = this.trades();
    return list[this.selTrade] || null;
  }

  changed() {
    const list = this.trades();
    if (!list.length) { this.result = null; return; }
    let t = this.activeTrade();
    if (typeof Trading !== 'undefined') {
      if (!Trading.canFulfill(t, this.payA, this.payB)) {
        const matchIdx = list.findIndex(cand => Trading.canFulfill(cand, this.payA, this.payB));
        if (matchIdx >= 0) {
          this.selTrade = matchIdx;
          t = list[matchIdx];
        }
      }
      if (Trading.canFulfill(t, this.payA, this.payB)) {
        this.result = typeof Enchant !== 'undefined' ? Enchant.cloneStack(t.result) : { ...t.result };
      } else {
        this.result = null;
      }
    }
  }

  selectTrade(idx, fillMax = false) {
    const list = this.trades();
    if (idx < 0 || idx >= list.length) return;
    this.selTrade = idx;
    const t = list[idx];
    const ui = this.game.ui;
    const inv = this.game.player.inv;
    // Return existing payment slots back to player inventory first
    if (this.payA) { ui.returnStack(this.payA); this.payA = null; }
    if (this.payB) { ui.returnStack(this.payB); this.payB = null; }
    if (!t || (typeof Trading !== 'undefined' && Trading.isOutOfStock(t))) {
      this.changed();
      return;
    }
    const haveA = inv.count(t.costA.id);
    const haveB = t.costB ? inv.count(t.costB.id) : Infinity;
    const remUses = Math.max(1, (t.maxUses || 12) - (t.uses || 0));
    const maxTimesA = Math.floor(haveA / t.costA.count);
    const maxTimesB = t.costB ? Math.floor(haveB / t.costB.count) : Infinity;
    let times = fillMax ? Math.min(remUses, maxTimesA, maxTimesB) : 1;
    times = Math.max(1, times);

    const pullA = Math.min(haveA, maxStack(t.costA.id), t.costA.count * times);
    if (pullA > 0) {
      inv.remove(t.costA.id, pullA);
      this.payA = { id: t.costA.id, count: pullA, dmg: 0 };
    }
    if (t.costB) {
      const pullB = Math.min(haveB, maxStack(t.costB.id), t.costB.count * times);
      if (pullB > 0) {
        inv.remove(t.costB.id, pullB);
        this.payB = { id: t.costB.id, count: pullB, dmg: 0 };
      }
    }
    this.changed();
    Sound.click();
  }

  consumeTrade() {
    const t = this.activeTrade();
    if (!t || typeof Trading === 'undefined') return;
    Trading.consumePayment(
      t,
      () => this.payA,
      (v) => { this.payA = v; },
      () => this.payB,
      (v) => { this.payB = v; },
      this.villager,
      this.game
    );
    const profDef = Trading.profDef(this.villager.profession);
    const lvlName = Trading.levelName(this.villager.level || 1);
    this.title = `${profDef.cn} - ${lvlName}`;
    this.changed();
  }

  drawSlotBox(c, x, y) {
    c.fillStyle = '#373737'; c.fillRect(x - 1, y - 1, 17, 1); c.fillRect(x - 1, y - 1, 1, 17);
    c.fillStyle = '#FFFFFF'; c.fillRect(x - 1, y + 16, 18, 1); c.fillRect(x + 16, y - 1, 1, 18);
    c.fillStyle = '#8B8B8B'; c.fillRect(x, y, 16, 16);
  }

  drawBase(ui) {
    ui.dim(0.6);
    const c = ui.ctx;
    // Outer frame (276 x 166)
    c.fillStyle = '#C6C6C6'; c.fillRect(this.x, this.y, this.gw, this.gh);
    c.fillStyle = '#FFFFFF'; c.fillRect(this.x, this.y, this.gw - 1, 1); c.fillRect(this.x, this.y, 1, this.gh - 1);
    c.fillStyle = '#555555'; c.fillRect(this.x + 1, this.y + this.gh - 1, this.gw - 1, 1); c.fillRect(this.x + this.gw - 1, this.y + 1, 1, this.gh - 1);
    // Vertical divider between trade list (left 100px) and trading/inventory area (right 176px)
    c.fillStyle = '#555555'; c.fillRect(this.x + 100, this.y + 4, 1, this.gh - 8);
    c.fillStyle = '#FFFFFF'; c.fillRect(this.x + 101, this.y + 4, 1, this.gh - 8);
    // Left trade list inset box
    c.fillStyle = '#404040'; c.fillRect(this.x + 5, this.y + 17, 90, 142);
    // Slot backgrounds on right panel
    for (const s of this.slots) this.drawSlotBox(c, this.x + s.x, this.y + s.y);
    Font.draw(c, '交易列表', this.x + 8, this.y + 6, '#404040', false);
    Font.center(c, this.title, this.x + 188, this.y + 6, '#404040', false);
    Font.draw(c, '物品栏', this.x + 108, this.y + 72, '#404040', false);
  }

  drawExtra(ui) {
    const c = ui.ctx;
    const list = this.trades();
    // Villager XP bar under header
    const vXp = (this.villager && this.villager.xp) || 0;
    const vLvl = (this.villager && this.villager.level) || 1;
    const curMin = (typeof VILLAGER_LEVELS !== 'undefined' && VILLAGER_LEVELS[vLvl - 1]) ? VILLAGER_LEVELS[vLvl - 1].minXp : 0;
    const nextMin = (typeof VILLAGER_LEVELS !== 'undefined' && VILLAGER_LEVELS[vLvl]) ? VILLAGER_LEVELS[vLvl].minXp : curMin + 50;
    const xpProg = vLvl >= 5 ? 1 : clamp((vXp - curMin) / Math.max(1, nextMin - curMin), 0, 1);
    c.fillStyle = '#333333'; c.fillRect(this.x + 136, this.y + 18, 102, 5);
    c.fillStyle = '#55FF55'; c.fillRect(this.x + 137, this.y + 19, Math.round(100 * xpProg), 3);

    // Arrow between payment slots and output slot
    const active = this.activeTrade();
    const outOfStock = active && typeof Trading !== 'undefined' && Trading.isOutOfStock(active);
    c.fillStyle = outOfStock ? '#AA3333' : '#606060';
    c.fillRect(this.x + 186, this.y + 43, 22, 4);
    if (outOfStock) {
      Font.center(c, 'X', this.x + 197, this.y + 41, '#FF5555');
    } else {
      Font.draw(c, '>', this.x + 203, this.y + 41, '#404040', false);
    }

    // Trade offer rows on left panel (up to 7 visible at 20px height)
    const vis = 7;
    const maxSc = Math.max(0, list.length - vis);
    this.scroll = clamp(this.scroll, 0, maxSc);
    this.tradeCells = [];
    let hovItem = null;

    for (let i = 0; i < Math.min(vis, list.length - this.scroll); i++) {
      const idx = this.scroll + i;
      const t = list[idx];
      const rx = this.x + 6, ry = this.y + 18 + i * 20, rw = 88, rh = 20;
      const cell = { x: rx, y: ry, w: rw, h: rh, idx, trade: t };
      this.tradeCells.push(cell);
      const isSel = idx === this.selTrade;
      const isHov = ui.hit(cell);
      const locked = typeof Trading !== 'undefined' && Trading.isOutOfStock(t);

      c.fillStyle = locked ? '#5A3A3A' : (isSel ? '#7A9A68' : (isHov ? '#8E8E8E' : '#727272'));
      c.fillRect(rx, ry, rw, rh - 1);
      c.fillStyle = isSel ? '#B8E098' : '#9E9E9E';
      c.fillRect(rx, ry, rw, 1);

      ui.drawItem(t.costA, rx + 2, ry + 2);
      if (t.costB) ui.drawItem(t.costB, rx + 20, ry + 2);
      Font.draw(c, locked ? 'X' : '→', rx + 43, ry + 6, locked ? '#FF5555' : '#FFFFFF', false);
      ui.drawItem(t.result, rx + 58, ry + 2);
      const stockStr = `${Math.max(0, (t.maxUses || 12) - (t.uses || 0))}`;
      Font.draw(c, stockStr, rx + 86 - Font.width(stockStr), ry + 2, locked ? '#FF5555' : '#CCCCCC', false);

      if (isHov && !ui.cursor) {
        if (ui.mouse.x < rx + 20) hovItem = t.costA;
        else if (t.costB && ui.mouse.x < rx + 38) hovItem = t.costB;
        else if (ui.mouse.x >= rx + 56) hovItem = t.result;
      }
    }

    if (hovItem && !ui.cursor) {
      ui.tooltip(ui.itemLines(hovItem), ui.mouse.x, ui.mouse.y);
    }
  }

  mouseDown(ui, mx, my, button, shift) {
    if (button === 0) {
      for (const cell of this.tradeCells) {
        if (ui.hit(cell, mx, my)) {
          this.selectTrade(cell.idx, shift);
          return;
        }
      }
    }
    super.mouseDown(ui, mx, my, button, shift);
  }

  wheel(ui, dy) {
    const list = this.trades();
    this.scroll = clamp(this.scroll + Math.sign(dy), 0, Math.max(0, list.length - 7));
  }

  close() {
    if (this.payA) { this.game.ui.returnStack(this.payA); this.payA = null; }
    if (this.payB) { this.game.ui.returnStack(this.payB); this.payB = null; }
  }
}

class FurnaceScreen extends ContainerScreen {
  constructor(game, be) {
    super(game, 'furnace', 176, 166, '熔炉');
    this.be = be;
    this.slots.push({ x: 56, y: 17, get: () => be.input, set: (s) => { be.input = s; }, group: 'container', accept: (st) => !!SMELTING[st.id] });
    this.slots.push({ x: 56, y: 53, get: () => be.fuel, set: (s) => { be.fuel = s; }, group: 'container', accept: (st) => fuelValue(st.id) > 0 });
    this.slots.push({ x: 116, y: 35, output: true, get: () => be.output, set: (s) => { be.output = s; }, onTake: (st) => { this.game.onSmeltTake(st, be); be.output = null; } });
    this.addPlayerSlots(84, 142);
  }
  canPlace(s, st) { if (s.output) return false; return !s.accept || s.accept(st); }
  quickMove(s) {
    const st = s.get(); if (!st) return;
    if (s.group === 'main' || s.group === 'hotbar') {
      const tgt = SMELTING[st.id] ? this.slots[0] : fuelValue(st.id) ? this.slots[1] : null;
      if (tgt) {
        const ts = tgt.get();
        if (!ts) { tgt.set(st); s.set(null); return; }
        if (ts.id === st.id) { const k = Math.min(st.count, maxStack(st.id) - ts.count); ts.count += k; st.count -= k; if (!st.count) s.set(null); return; }
      }
    }
    super.quickMove(s);
  }
  drawExtra(ui) {
    const be = this.be, c = ui.ctx;
    if (be.burn > 0) {
      const f = Math.ceil(be.burn / be.burnMax * 13) + 1;
      c.drawImage(ui.img.lit_progress, 0, 14 - f, 14, f, this.x + 56, this.y + 36 + 14 - f, 14, f);
    }
    if (be.cook > 0) {
      const w = Math.ceil(be.cook / 200 * 24);
      c.drawImage(ui.img.burn_progress, 0, 0, w, 16, this.x + 79, this.y + 34, w, 16);
    }
    Font.draw(c, '物品栏', this.x + 8, this.y + 73, '#404040', false);
  }
  close() { this.game.markBlockEntity(this.be); }
}

class BrewingScreen extends ContainerScreen {
  constructor(game, be) {
    super(game, 'brewing_stand_gui', 176, 166, '酿造台');
    this.be = be;
    if (!Array.isArray(be.bottles) || be.bottles.length < 3) be.bottles = [null, null, null];
    if (be.brewTime === undefined) be.brewTime = 0;
    if (be.fuelCharges === undefined) be.fuelCharges = 0;
    // Slot 0: Blaze Powder fuel slot at (17, 17)
    this.slots.push({
      x: 17, y: 17, group: 'container',
      accept: (st) => typeof Brewing !== 'undefined' ? Brewing.isFuel(st) : st.id === item('blaze_powder'),
      get: () => be.fuel,
      set: (s) => { be.fuel = s; },
    });
    // Slot 1: Ingredient slot at (79, 17)
    this.slots.push({
      x: 79, y: 17, group: 'container',
      accept: (st) => typeof Brewing !== 'undefined' && Brewing.isIngredient(st),
      get: () => be.ingredient,
      set: (s) => { be.ingredient = s; },
    });
    // Slots 2..4: Three potion bottle slots at (56, 51), (79, 58), (102, 51)
    const bCoords = [[56, 51], [79, 58], [102, 51]];
    for (let i = 0; i < 3; i++) {
      const [bx, by] = bCoords[i];
      this.slots.push({
        x: bx, y: by, max: 1, group: 'container',
        accept: (st) => typeof Brewing !== 'undefined' && Brewing.isBottle(st),
        get: () => be.bottles[i],
        set: (s) => { be.bottles[i] = s; },
      });
    }
    this.addPlayerSlots(84, 142);
  }
  quickMove(s) {
    const st = s.get();
    if (!st) return;
    if (s.group === 'main' || s.group === 'hotbar') {
      if (typeof Brewing !== 'undefined' && Brewing.isFuel(st)) {
        const tgt = this.slots[0], ts = tgt.get();
        if (!ts) { tgt.set(st); s.set(null); return; }
        if (ts.id === st.id && ts.count < 64) {
          const k = Math.min(st.count, 64 - ts.count);
          ts.count += k; st.count -= k; if (!st.count) s.set(null);
          return;
        }
      } else if (typeof Brewing !== 'undefined' && Brewing.isIngredient(st)) {
        const tgt = this.slots[1], ts = tgt.get();
        if (!ts) { tgt.set(st); s.set(null); return; }
        if (ts.id === st.id && ts.count < 64) {
          const k = Math.min(st.count, 64 - ts.count);
          ts.count += k; st.count -= k; if (!st.count) s.set(null);
          return;
        }
      } else if (typeof Brewing !== 'undefined' && Brewing.isBottle(st)) {
        for (let i = 2; i <= 4; i++) {
          if (!this.slots[i].get()) {
            this.slots[i].set({ ...st, count: 1 });
            st.count -= 1; if (!st.count) { s.set(null); return; }
          }
        }
        return;
      }
    }
    super.quickMove(s);
  }
  drawExtra(ui) {
    const be = this.be, c = ui.ctx;
    // Fuel bar (18x4 at 60, 44)
    if ((be.fuelCharges || 0) > 0 && ui.img.brew_fuel) {
      const fw = clamp(Math.ceil((be.fuelCharges / 20) * 18), 1, 18);
      c.drawImage(ui.img.brew_fuel, 0, 0, fw, 4, this.x + 60, this.y + 44, fw, 4);
    }
    // Progress arrow (9x28 at 97, 16) & bubbles (12x29 at 63, 14)
    if ((be.brewTime || 0) > 0) {
      if (ui.img.brew_progress) {
        const ph = clamp(Math.ceil((be.brewTime / 400) * 28), 1, 28);
        c.drawImage(ui.img.brew_progress, 0, 0, 9, ph, this.x + 97, this.y + 16, 9, ph);
      }
      if (ui.img.brew_bubbles) {
        const bLens = [0, 6, 11, 16, 20, 24, 29];
        const bh = bLens[Math.floor((this.game.tickCount || 0) / 2) % bLens.length];
        if (bh > 0) {
          c.drawImage(ui.img.brew_bubbles, 0, 29 - bh, 12, bh, this.x + 63, this.y + 14 + 29 - bh, 12, bh);
        }
      }
    }
    Font.draw(c, '物品栏', this.x + 8, this.y + 73, '#404040', false);
  }
  close() { this.game.markBlockEntity(this.be); }
}


class EnchantingScreen extends ContainerScreen {
  constructor(game, pos) {
    super(game, 'enchanting_table_gui', 176, 166, '附魔');
    this.pos = pos;
    this.itemSlot = null;
    this.lapisSlot = null;
    const bs = typeof Enchant !== 'undefined' ? Enchant.countBookshelves(game.world, pos[0], pos[1], pos[2]) : { count: 0 };
    this.bookshelves = bs.count;
    this.options = [null, null, null];
    this.slots.push({
      x: 15, y: 47, max: 1, group: 'container',
      get: () => this.itemSlot,
      set: (s) => { this.itemSlot = s; }
    });
    this.slots.push({
      x: 35, y: 47, emptyIcon: 'slot_lapis', group: 'container',
      accept: (st) => st.id === item('lapis_lazuli'),
      get: () => this.lapisSlot,
      set: (s) => { this.lapisSlot = s; }
    });
    this.addPlayerSlots(84, 142);
  }
  changed() {
    const curKey = this.itemSlot ? `${this.itemSlot.id}:${Object.keys(this.itemSlot.ench || {}).join(',')}` : '';
    if (typeof Enchant !== 'undefined' && this.itemSlot) {
      if (this._lastItemKey !== curKey) {
        if (this.game.player && this.game.player.creative && this._lastItemKey !== undefined) {
          this.game.player.enchantSeed = ((this.game.player.enchantSeed || 1337) * 1664525 + 1013904223) | 0;
        }
        this._lastItemKey = curKey;
      }
      this.options = Enchant.getTableOptions(this.game.player, this.itemSlot, this.bookshelves);
    } else {
      this._lastItemKey = '';
      this.options = [null, null, null];
    }
  }
  quickMove(s) {
    const st = s.get(); if (!st) return;
    if (s.group === 'main' || s.group === 'hotbar') {
      if (st.id === item('lapis_lazuli')) {
        const tgt = this.slots[1], ts = tgt.get();
        if (!ts) { tgt.set(st); s.set(null); return; }
        if (ts.id === st.id && ts.count < 64) {
          const k = Math.min(st.count, 64 - ts.count);
          ts.count += k; st.count -= k; if (!st.count) s.set(null);
          return;
        }
      } else if (!this.slots[0].get() && typeof Enchant !== 'undefined' && Enchant.enchantability(st.id) > 0 && !Enchant.hasEnch(st)) {
        this.slots[0].set({ ...st, count: 1 });
        st.count -= 1; if (!st.count) s.set(null);
        return;
      }
    }
    super.quickMove(s);
  }
  canAfford(opt) {
    if (!opt) return false;
    const p = this.game.player;
    if (p.creative) return true;
    const lapis = this.lapisSlot ? this.lapisSlot.count : 0;
    const lvl = this.game.xpLevel();
    return lapis >= opt.lapisCost && lvl >= opt.reqLevel;
  }
  drawExtra(ui) {
    const c = ui.ctx, p = this.game.player;
    Font.draw(c, '物品栏', this.x + 8, this.y + 73, '#404040', false);
    const bsLabel = (p.creative && this.bookshelves < 15) ? '书架: 15/15 (创造)' : `书架: ${this.bookshelves}/15`;
    Font.draw(c, bsLabel, this.x + 78, this.y + 5, '#5533AA', false);
    // Draw 3D opening/closing book above the item & lapis slots
    const hasOpts = this.options.some(Boolean);
    if (this.game.renderer && typeof this.game.renderer.bookPreview === 'function') {
      c.drawImage(this.game.renderer.bookPreview(hasOpts), this.x + 13, this.y + 12, 40, 32);
    } else {
      ui.drawItem({ id: item('book'), count: 1 }, this.x + 25, this.y + 21);
    }

    let hovOpt = null;
    for (let i = 0; i < 3; i++) {
      const opt = this.options[i];
      const bx = this.x + 60, by = this.y + 14 + i * 19;
      const rect = { x: bx, y: by, w: 108, h: 19 };
      if (!opt) {
        ui.sprite('enchant_slot_dis', bx, by);
        continue;
      }
      const afford = this.canAfford(opt);
      const isHov = ui.hit(rect);
      if (isHov) hovOpt = opt;
      ui.sprite(!afford ? 'enchant_slot_dis' : (isHov ? 'enchant_slot_hl' : 'enchant_slot'), bx, by);
      ui.sprite((afford ? 'enchant_lvl_' : 'enchant_lvl_') + (i + 1) + (afford ? '' : '_dis'), bx + 1, by + 1);
      // Top line (y = by + 2..7): compact scaled Galactic/rune text so it never collides with bottom line
      const words = opt.words.slice(0, 14);
      c.save();
      c.translate(bx + 19, by + 2);
      c.scale(0.65, 0.65);
      Font.draw(c, words, 0, 0, !afford ? '#685E4A' : (isHov ? '#FFFF80' : '#40362C'), false);
      c.restore();
      // Bottom line (y = by + 10..17): Chinese enchantment preview hint with 3px vertical clearance
      Font.draw(c, opt.preview, bx + 19, by + 10, !afford ? '#544C3D' : (isHov ? '#55FFFF' : '#2B2118'), false);
      // Required XP level on right
      const lvlStr = String(opt.reqLevel);
      Font.draw(c, lvlStr, bx + 105 - Font.width(lvlStr), by + 9, afford ? '#80FF20' : '#407F10');
    }
    if (hovOpt && !ui.cursor) {
      const lapis = this.lapisSlot ? this.lapisSlot.count : 0;
      const lvl = this.game.xpLevel();
      const lines = [{ text: hovOpt.preview, color: '#FFFF55' }];
      if (!p.creative) {
        lines.push({ text: `${hovOpt.lapisCost} 个青金石`, color: lapis >= hovOpt.lapisCost ? '#AAAAAA' : '#FF5555' });
        lines.push({ text: `需要 ${hovOpt.reqLevel} 级经验（消耗 ${hovOpt.lapisCost} 级）`, color: lvl >= hovOpt.reqLevel ? '#AAAAAA' : '#FF5555' });
      }
      ui.tooltip(lines, ui.mouse.x, ui.mouse.y);
    }
  }
  mouseDown(ui, mx, my, button, shift) {
    if (button === 0) {
      for (let i = 0; i < 3; i++) {
        const opt = this.options[i];
        const rect = { x: this.x + 60, y: this.y + 14 + i * 19, w: 108, h: 19 };
        if (opt && ui.hit(rect, mx, my) && this.canAfford(opt)) {
          this.applyEnchant(opt);
          return;
        }
      }
    }
    super.mouseDown(ui, mx, my, button, shift);
  }
  applyEnchant(opt) {
    const g = this.game, p = g.player;
    if (!this.itemSlot) return;
    if (!p.creative) {
      this.lapisSlot.count -= opt.lapisCost;
      if (this.lapisSlot.count <= 0) this.lapisSlot = null;
      g.deductXpLevels(opt.lapisCost);
    }
    if (this.itemSlot.id === item('book')) {
      this.itemSlot = { id: item('enchanted_book'), count: 1, dmg: 0, ench: { ...opt.ench } };
    } else {
      this.itemSlot = { ...this.itemSlot, ench: { ...opt.ench } };
    }
    p.enchantSeed = ((Math.random() * 0x7FFFFFFF) | 0) || 1;
    Sound.levelup();
    if (this.pos) {
      const [tx, ty, tz] = this.pos;
      for (let k = 0; k < 18; k++) {
        g.particles.spawn('glint', tx + 0.5 + (Math.random() - 0.5) * 0.8, ty + 0.9 + Math.random() * 0.5, tz + 0.5 + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.08, 0.04, (Math.random() - 0.5) * 0.08);
      }
    }
    g.grant('enchant');
    this.changed();
  }
  close() {
    if (this.itemSlot) { this.game.ui.returnStack(this.itemSlot); this.itemSlot = null; }
    if (this.lapisSlot) { this.game.ui.returnStack(this.lapisSlot); this.lapisSlot = null; }
  }
}

class AnvilScreen extends ContainerScreen {
  constructor(game, pos) {
    super(game, 'anvil_gui', 176, 166, '修复与命名');
    this.pos = pos;
    this.left = null;
    this.right = null;
    this.result = null;
    this.calc = null;
    this.customName = '';
    this._lastLeftRef = null;
    this.slots.push({
      x: 27, y: 47, max: 1, group: 'container',
      get: () => this.left,
      set: (s) => { this.left = s; }
    });
    this.slots.push({
      x: 76, y: 47, group: 'container',
      get: () => this.right,
      set: (s) => { this.right = s; }
    });
    this.slots.push({
      x: 134, y: 47, output: true,
      get: () => this.result,
      set: () => { },
      onTake: () => this.consumeAnvil()
    });
    this.addPlayerSlots(84, 142);
  }
  layout() {
    super.layout();
    this.syncInput();
  }
  syncInput() {
    const u = this.game.ui;
    if (this.x === undefined) return;
    if (this.left) {
      u.showInput(this.x + 62, this.y + 22, 103, 12, this.customName, () => { }, {
        onInput: (v) => { this.customName = v; this.recalc(); },
        onEsc: () => u.close(),
        max: 30
      });
    } else {
      u.hideInput();
    }
  }
  changed() {
    if (this.left !== this._lastLeftRef) {
      this._lastLeftRef = this.left;
      this.customName = this.left ? (this.left.name || ITEMS[this.left.id].cn) : '';
      this.syncInput();
    }
    this.recalc();
  }
  recalc() {
    if (typeof Enchant === 'undefined' || !this.left) {
      this.calc = null;
      this.result = null;
      return;
    }
    const p = this.game.player;
    this.calc = Enchant.computeAnvil(this.left, this.right, this.customName, p.creative);
    if (this.calc && !this.calc.error && this.calc.out) {
      const canPay = p.creative || this.game.xpLevel() >= this.calc.cost;
      this.result = canPay ? this.calc.out : null;
    } else {
      this.result = null;
    }
  }
  quickMove(s) {
    const st = s.get(); if (!st) return;
    if (s.group === 'main' || s.group === 'hotbar') {
      if (!this.slots[0].get()) {
        this.slots[0].set({ ...st, count: 1 });
        st.count -= 1; if (!st.count) s.set(null);
        return;
      } else if (!this.slots[1].get()) {
        this.slots[1].set(st); s.set(null);
        return;
      }
    }
    super.quickMove(s);
  }
  consumeAnvil() {
    if (!this.calc || this.calc.error) return;
    const g = this.game, p = g.player;
    if (!p.creative) {
      g.deductXpLevels(this.calc.cost);
    }
    this.left = null;
    this._lastLeftRef = null;
    if (this.right && this.calc.takeRight > 0) {
      this.right.count -= this.calc.takeRight;
      if (this.right.count <= 0) this.right = null;
    }
    this.customName = '';
    this.syncInput();
    Sound.block('place', 'metal', this.pos || p.pos);
    Sound.tone(this.pos || p.pos, { freq: 880, dur: 0.14, vol: 0.3, type: 'triangle' });
    this.recalc();
  }
  drawExtra(ui) {
    const c = ui.ctx, p = this.game.player;
    Font.draw(c, '物品栏', this.x + 8, this.y + 73, '#404040', false);
    ui.sprite(this.left ? 'anvil_field' : 'anvil_field_dis', this.x + 59, this.y + 20);
    if (this.calc && this.calc.error && (this.right || this.calc.tooExpensive)) {
      ui.sprite('anvil_error', this.x + 99, this.y + 45);
    }
    if (this.calc && this.calc.cost > 0) {
      const tooExp = this.calc.tooExpensive;
      const canPay = p.creative || (!tooExp && this.game.xpLevel() >= this.calc.cost);
      const txt = tooExp ? '过于昂贵！' : `花费经验: ${this.calc.cost}`;
      const col = canPay ? '#80FF20' : '#FF6060';
      const tx = this.x + 168 - Font.width(txt);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(tx - 2, this.y + 67, Font.width(txt) + 4, 11);
      Font.draw(c, txt, tx, this.y + 69, col);
    }
  }
  key(ui, ev) {
    if (this.left && document.activeElement === ui.input) return true;
    return super.key(ui, ev);
  }
  close() {
    this.game.ui.hideInput();
    if (this.left) { this.game.ui.returnStack(this.left); this.left = null; }
    if (this.right) { this.game.ui.returnStack(this.right); this.right = null; }
  }
}

class CreativeScreen extends ContainerScreen {
  constructor(game) {
    super(game, 'tab_items', 195, 136, null);
    this.tab = 0; this.scroll = 0; this.search = '';
    this.items = [];
    this.trash = null;
    const inv = game.player.inv;
    for (let c = 0; c < 9; c++) this.slots.push({ x: 9 + c * 18, y: 112, get: () => inv.slots[c], set: (s) => { inv.slots[c] = s; }, group: 'hotbar' });
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
      const k = r * 9 + c;
      this.slots.push({ x: 9 + c * 18, y: 18 + r * 18, creative: true, get: () => { const id = this.items[this.scroll * 9 + k]; return id != null ? { id, count: 1 } : null; }, set: () => { } });
    }
    this.trashSlot = { x: 173, y: 112, trash: true, get: () => null, set: () => { } };
    this.slots.push(this.trashSlot);
    this.setTab(0);
  }
  tabs() { return [...CREATIVE_TABS, { name: '搜索物品', icon: 'compass_search', search: true }]; }
  setTab(t) {
    this.tab = t; this.scroll = 0;
    const tabs = this.tabs();
    if (tabs[t].search) {
      this.bg = 'tab_item_search';
      const q = this.search.trim().toLowerCase();
      this.items = ITEMS.filter(it => it && !(BLOCKS[it.id] && BLOCKS[it.id].noItem)).filter(it => !q || it.cn.includes(q) || it.key.includes(q)).map(it => it.id);
      const u = this.game.ui;
      if (this.x !== undefined) u.showInput(this.x + 82, this.y + 6, 89, 10, this.search, () => { }, { onInput: (v) => { this.search = v; this.setTab(this.tab); }, onEsc: () => u.close(), max: 30 });
    } else {
      this.bg = 'tab_items';
      this.items = tabs[t].items.map(k => item(k));
      this.game.ui.hideInput();
    }
  }
  layout() { super.layout(); this.y += 14; if (this.tabs()[this.tab].search) this.setTab(this.tab); }
  maxScroll() { return Math.max(0, Math.ceil(this.items.length / 9) - 5); }
  wheel(ui, dy) { this.scroll = clamp(this.scroll + Math.sign(dy), 0, this.maxScroll()); }
  tabRect(i) { return { x: this.x + i * 27, y: this.y - 28, w: 26, h: 30 }; }
  draw(ui) {
    ui.dim(0.6);
    const c = ui.ctx, tabs = this.tabs();
    for (let i = 0; i < tabs.length; i++) if (i !== this.tab) { const r = this.tabRect(i); ui.sprite('tab_top_unselected_' + Math.min(7, i + 1), r.x, r.y); }
    c.drawImage(ui.img[this.bg], 0, 0, 195, 136, this.x, this.y, 195, 136);
    { const r = this.tabRect(this.tab); ui.sprite('tab_top_selected_' + Math.min(7, this.tab + 1), r.x, r.y); }
    for (let i = 0; i < tabs.length; i++) {
      const r = this.tabRect(i);
      const icon = tabs[i].search ? item('book') : item(tabs[i].icon);
      ui.drawItem({ id: icon, count: 1 }, r.x + 5, r.y + 9);
    }
    Font.draw(c, tabs[this.tab].name, this.x + 8, this.y + 6, '#404040', false);
    // scroller
    const ms = this.maxScroll();
    const sy = this.y + 18 + (ms ? Math.round(this.scroll / ms * (112 - 15 - 18)) : 0);
    ui.sprite(ms ? 'scroller' : 'scroller_disabled', this.x + 175, sy);
    // trash slot
    ui.ctx.fillStyle = '#8b8b8b'; ui.ctx.fillRect(this.x + 173, this.y + 112, 16, 16);
    Font.center(c, 'X', this.x + 181, this.y + 116, '#FF5555');
    this.drawSlots(ui);
    for (let i = 0; i < tabs.length; i++) if (ui.hit(this.tabRect(i))) ui.tooltip([{ text: tabs[i].name }], ui.mouse.x, ui.mouse.y);
  }
  drawSlots(ui) {
    const hov = this.slotAt(ui.mouse.x, ui.mouse.y);
    for (const s of this.slots) {
      if (s.trash) continue;
      ui.drawItem(s.get(), this.x + s.x, this.y + s.y);
      if (s === hov) { ui.ctx.fillStyle = 'rgba(255,255,255,0.5)'; ui.ctx.fillRect(this.x + s.x, this.y + s.y, 16, 16); }
    }
    if (hov && hov.get() && !ui.cursor) ui.tooltip(ui.itemLines(hov.get()), ui.mouse.x, ui.mouse.y);
  }
  mouseDown(ui, mx, my, button, shift) {
    const tabs = this.tabs();
    for (let i = 0; i < tabs.length; i++) if (ui.hit(this.tabRect(i), mx, my)) { this.setTab(i); Sound.click(); return; }
    if (mx >= this.x + 175 && mx < this.x + 187 && my >= this.y + 18 && my < this.y + 130) { this.scrolling = true; this.mouseMove(ui, mx, my); return; }
    const s = this.slotAt(mx, my);
    if (s && s.trash) { if (ui.cursor) ui.cursor = null; else if (shift) this.game.player.inv.slots.fill(null, 0, 36); return; }
    if (s && s.creative) {
      const st = s.get();
      if (ui.cursor) { ui.cursor = null; return; }
      if (!st) return;
      if (shift) { const inv = this.game.player.inv; const i = inv.slots.findIndex((x, j) => j < 9 && !x); inv.slots[i >= 0 ? i : inv.sel] = { id: st.id, count: maxStack(st.id), dmg: 0 }; return; }
      ui.cursor = { id: st.id, count: button === 2 ? 1 : maxStack(st.id), dmg: 0 };
      return;
    }
    if (s && button === 1 && s.get()) { ui.cursor = { ...s.get(), count: maxStack(s.get().id) }; return; }
    super.mouseDown(ui, mx, my, button, shift);
  }
  mouseMove(ui, mx, my) {
    if (this.scrolling && ui.mouse.down) { const ms = this.maxScroll(); this.scroll = clamp(Math.round((my - this.y - 25) / (112 - 15 - 18) * ms), 0, ms); return; }
    super.mouseMove(ui, mx, my);
  }
  mouseUp(ui, mx, my, b) { this.scrolling = false; super.mouseUp(ui, mx, my, b); }
  quickMove(s) { if (s.group === 'hotbar') s.set(null); }
  outside(mx, my) { return super.outside(mx, my) && my > this.y - 28; }
  key(ui, ev) { if (this.tabs()[this.tab].search && document.activeElement === ui.input) return true; return super.key(ui, ev); }
}

// ---------------------------------------------------------------------------
// Menu screens (buttons & sliders)
// ---------------------------------------------------------------------------
class MenuScreen {
  constructor(game, title) { this.game = game; this.title = title; this.widgets = []; this.bgDim = 0.5; }
  layout() { }
  draw(ui) {
    if (this.bgDirt) this.drawDirt(ui); else if (this.bgDim) ui.dim(this.bgDim);
    if (this.title) Font.center(ui.ctx, this.title, ui.w / 2, this.titleY ?? 30, '#FFFFFF');
    if (this.drawExtra) this.drawExtra(ui);
    for (const w of this.widgets) { if (w.slider) ui.slider(w); else if (w.text) Font.center(ui.ctx, typeof w.text === 'function' ? w.text() : w.text, w.x, w.y, w.color || '#FFFFFF'); else ui.button(w); }
    for (const w of this.widgets) if (w.tip && ui.hit(w)) ui.tooltip(w.tip.map(t => ({ text: t })), ui.mouse.x, ui.mouse.y);
  }
  drawDirt(ui) {
    const c = ui.ctx, r = this.game.renderer;
    if (!this.dirtPat) {
      const t = document.createElement('canvas'); t.width = 32; t.height = 32;
      const x = t.getContext('2d'); x.imageSmoothingEnabled = false;
      x.drawImage(r.stripCanvas, 0, T('dirt') * 16, 16, 16, 0, 0, 32, 32);
      x.fillStyle = 'rgba(0,0,0,0.75)'; x.fillRect(0, 0, 32, 32);
      this.dirtPat = c.createPattern(t, 'repeat');
    }
    c.fillStyle = this.dirtPat; c.fillRect(0, 0, ui.w, ui.h);
  }
  mouseDown(ui, mx, my, button) {
    if (button !== 0) return;
    for (const w of this.widgets) {
      if (w.slider && ui.hit(w, mx, my)) { this.dragging = w; this.mouseMove(ui, mx, my); Sound.click(); return; }
      if (!w.slider && !w.text && w.enabled !== false && ui.hit(w, mx, my)) { Sound.init(); Sound.click(); w.onClick(); return; }
    }
  }
  mouseMove(ui, mx) {
    if (this.dragging && ui.mouse.down) { const w = this.dragging; w.value = clamp((mx - w.x - 4) / (w.w - 8), 0, 1); w.onChange(w.value); }
  }
  mouseUp() { this.dragging = null; }
  key(ui, ev) { if (ev.key === 'Escape' && this.onEsc) { this.onEsc(); return true; } return false; }
}

// Choose concrete ingredient ids for a recipe given available counts; returns per-grid-slot list or null
function planRecipe(r, avail, size) {
  const left = new Map(avail);
  const take = (opts) => {
    let best = -1, bestN = 0;
    for (const id of opts) { const n = left.get(id) || 0; if (n > bestN) { best = id; bestN = n; } }
    if (best < 0) return null;
    left.set(best, bestN - 1);
    return { id: best };
  };
  const out = new Array(size * size).fill(null);
  if (r.type === 'shaped') {
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const ch = r.pattern[y][x];
      if (ch === ' ' || ch === undefined) continue;
      const t = take(r.keys[ch]); if (!t) return null;
      out[y * size + x] = t;
    }
  } else {
    for (let i = 0; i < r.ing.length; i++) { const t = take(r.ing[i]); if (!t) return null; out[i] = t; }
  }
  return out;
}