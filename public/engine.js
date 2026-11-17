// Tarco signage renderer: draws one 1080x1920 frame for time t. Shared by the player and the admin preview.
// Also exports LandscapeEngine for 1920x1080 screens (rotate=90/270).
export const W = 1080, H = 1920, CARD_X = 48, CARD_Y = 196, CARD = 984, RADIUS = 40;
const RED = '#EB1D24', BLUE = '#0B4DA1';
const PHONE_PATH = 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z';

function rr(ctx, x, y, w, h, r) {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y); ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br); ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h); ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl); ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export const loadImg = (src) => new Promise((res, rej) => {
  const i = new Image();
  if (typeof src === 'string' && /^https?:\/\//i.test(src) && !src.startsWith(location.origin)) {
    i.crossOrigin = 'anonymous';
  }
  i.onload = () => res(i);
  i.onerror = (e) => {
    console.error('loadImg failed for:', String(src).slice(0, 100), e);
    rej(new Error('image failed: ' + String(src).slice(0, 60)));
  };
  i.src = src;
});

export async function loadFonts(base = 'assets/fonts/') {
  const defs = [['300', 'Bukra-Light.otf'], ['400', 'Bukra-Regular.otf'], ['700', 'Bukra-Bold.otf']];
  await Promise.all(defs.map(async ([w, f]) => {
    const ff = new FontFace('Bukra', `url(${base}${f})`, { weight: w });
    await ff.load(); document.fonts.add(ff);
  }));
}

// crop the white margin around a QR image so it fills its box (keeps a small quiet zone)
function cropQr(img) {
  const s = Math.min(1507, Math.max(img.naturalWidth, img.naturalHeight));
  const sc = s / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
  const c = mk(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y += 2) for (let xx = 0; xx < w; xx += 2) {
    const i = (y * w + xx) * 4;
    if (d[i] + d[i + 1] + d[i + 2] < 720) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return img;
  const m = Math.round(0.04 * (x1 - x0)), side = Math.max(x1 - x0, y1 - y0) + 2 * m;
  const out = mk(564, 564), o = out.getContext('2d');
  o.fillStyle = '#fff'; o.fillRect(0, 0, 564, 564);
  o.imageSmoothingQuality = 'high';
  o.drawImage(c, x0 - m, y0 - m, side, side, 0, 0, 564, 564);
  return out;
}

function fit(ctx, text, weight, px, maxW, family = 'Bukra') {
  let s = px;
  for (; s > 14; s -= 2) { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxW) break; }
  return s;
}

export class Engine {
  constructor(canvas, { logo, defaultQr }) {
    this.c = canvas; canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext('2d');
    this.logo = logo; this.defaultQr = defaultQr ? cropQr(defaultQr) : null; this.qr = this.defaultQr;
    this.cfg = { hold: 8, transition: 0.9, zoom: 0.04, footer: {} };
    this.items = []; this.starts = [0]; this.durs = []; this.total = 0;
    this.overlay = mk(W, H);
    this.shadow = this._shadowSprite();
    this.drawOverlay();
  }
  _shadowSprite(w = CARD, h = CARD) {
    const pad = 130, c = mk(w + pad * 2, h + pad * 2), x = c.getContext('2d');
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 64; x.shadowOffsetY = 24;
    x.fillStyle = '#000'; rr(x, pad, pad, w, h, RADIUS); x.fill();
    x.shadowColor = 'transparent'; x.globalCompositeOperation = 'destination-out'; rr(x, pad, pad, w, h, RADIUS); x.fill();
    return { c, pad };
  }
  setConfig(cfg) {
    this.cfg = { ...this.cfg, ...cfg, footer: { ...(this.cfg.footer || {}), ...(cfg.footer || {}) } };
    this._layout(); this.drawOverlay();
  }
  setQr(img) { this.qr = img ? cropQr(img) : this.defaultQr; this.drawOverlay(); }
  // list: [{id, key, src (image or video poster), video (url, optional), vdur, seconds}] — builds only the items whose key changed
  async setPosts(list) {
    const old = new Map(this.items.map((i) => [i.key, i]));
    const next = [];
    for (const p of list) {
      let it = old.get(p.key);
      if (!it) { try { it = await this._build(p); } catch (e) { console.warn(e); continue; } }
      it.seconds = p.seconds; next.push(it);
    }
    // release videos that are no longer in the playlist
    for (const it of this.items) if (it.video && !next.includes(it)) { try { it.video.pause(); it.video.removeAttribute('src'); it.video.load(); } catch (e) { /* ignore */ } }
    this.items = next; this._act = null; this._layout();
  }
  _layout() {
    const hold = this.cfg.hold || 8;
    this.durs = this.items.map((i) => Math.max(2, Number(i.seconds) || (i.video ? i.vdur : hold)));
    this.starts = [0]; this.durs.forEach((d) => this.starts.push(this.starts[this.starts.length - 1] + d));
    this.total = this.starts[this.starts.length - 1];
  }
  async _loadVideo(p) {
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = p.video;
    await new Promise((res) => {
      const done = () => res();
      v.addEventListener('loadeddata', done, { once: true }); v.addEventListener('error', done, { once: true });
      setTimeout(done, 25000); v.load();
    });
    return v;
  }
  async _build(p) {
    let video = null, img = null;
    if (p.video) {
      video = await this._loadVideo(p);
      if (p.src) { try { img = await loadImg(p.src); } catch (e) { /* poster optional */ } }
      if (!img && video.readyState >= 2) { img = mk(video.videoWidth, video.videoHeight); img.getContext('2d').drawImage(video, 0, 0); img.naturalWidth = img.width; img.naturalHeight = img.height; }
      if (!img) throw new Error('video failed: ' + String(p.video).slice(0, 60));
    } else img = p.img || await loadImg(p.src);
    const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    img = img.naturalWidth ? img : Object.assign(img, { naturalWidth: img.width, naturalHeight: img.height });
    const sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
    const B = Math.round(CARD * 1.1);
    const card = mk(B, B), cx = card.getContext('2d'); cx.imageSmoothingQuality = 'high';
    if (!video) cx.drawImage(img, sx, sy, s, s, 0, 0, B, B);
    // blurred navy-tinted background (cover crop of the square into 1080x1920)
    const sw = s * (W / H), sx2 = sx + (s - sw) / 2;
    const small = mk(54, 96), sm = small.getContext('2d');
    sm.imageSmoothingQuality = 'high';
    try { sm.filter = 'blur(2px)'; } catch (e) { /* optional */ }
    sm.drawImage(img, sx2, sy, sw, s, -4, -4, 62, 104);
    const bg = mk(W, H), b = bg.getContext('2d');
    b.imageSmoothingQuality = 'high';
    try { b.filter = 'blur(14px)'; } catch (e) { /* older browsers: the 20x upscale is already very soft */ }
    b.drawImage(small, -40, -40, W + 80, H + 80); b.filter = 'none';
    b.fillStyle = 'rgba(35,44,87,.45)'; b.fillRect(0, 0, W, H);
    const v = b.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(0,0,0,.2)'); v.addColorStop(.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.2)');
    b.fillStyle = v; b.fillRect(0, 0, W, H);
    if (video) {
      const vw = video.videoWidth || img.naturalWidth, vh = video.videoHeight || img.naturalHeight;
      // fit 'fill': cover-crop into the square card. Otherwise show the whole video: landscape = card width, portrait = up to VMAX tall
      const fill = p.fit === 'fill', VMAX = 1000;
      let cw, ch;
      if (fill) { cw = CARD; ch = CARD; } else { const k = Math.min(CARD / vw, VMAX / vh); cw = Math.round(vw * k); ch = Math.round(vh * k); }
      const poster = mk(cw, ch), pc = poster.getContext('2d');
      if (fill) { const iw = img.naturalWidth, ih = img.naturalHeight, sc = Math.max(cw / iw, ch / ih); pc.drawImage(img, (iw - cw / sc) / 2, (ih - ch / sc) / 2, cw / sc, ch / sc, 0, 0, cw, ch); }
      else pc.drawImage(img, 0, 0, cw, ch);
      const vdur = isFinite(video.duration) && video.duration > 0 ? video.duration : (Number(p.vdur) || 8);
      const it = { key: p.key, id: p.id, seconds: p.seconds, bg, video, vdur, poster, cw, ch, fill, vw, vh, shadow: this._shadowSprite(cw, ch) };
      video.onended = () => { if (this._act === it && this._local < this._dur - 0.4) { video.currentTime = 0; video.play().catch(() => {}); } };
      return it;
    }
    return { key: p.key, id: p.id, seconds: p.seconds, card, bg };
  }
  // start/stop video elements as the timeline moves between items
  _sync(i, j, local, d) {
    this._local = local; this._dur = d;
    const act = this.items[i];
    if (this._act !== act) {
      if (this._act && this._act.video) this._act.video.pause();
      this._act = act;
      if (act.video) { const v = act.video; try { v.currentTime = 0; } catch (e) { /* ignore */ } v.play().catch(() => {}); }
      const nx = this.items[j];
      if (nx && nx !== act && nx.video) { try { nx.video.pause(); nx.video.currentTime = 0; } catch (e) { /* ignore */ } }
    } else if (act.video && act.video.paused && !act.video.ended && local < d - 0.4) act.video.play().catch(() => {});
  }
  locate(t) {
    const N = this.items.length; let i = 0;
    while (i < N - 1 && t >= this.starts[i + 1]) i++;
    const local = t - this.starts[i], d = this.durs[i], tr = Math.min(this.cfg.transition || 0.9, d / 2);
    let p = 0; if (N > 1 && local > d - tr) p = Math.min((local - (d - tr)) / tr, 1);
    return { i, j: (i + 1) % N, local, d, p };
  }
  render(t) {
    const ctx = this.ctx, N = this.items.length;
    if (N === 0) { this._standby(); return; }
    const { i, j, local, d, p } = this.locate(t), e = ease(p);
    this._sync(i, j, local, d);
    ctx.globalAlpha = 1; ctx.drawImage(this.items[i].bg, 0, 0);
    if (p > 0) { ctx.globalAlpha = e; ctx.drawImage(this.items[j].bg, 0, 0); ctx.globalAlpha = 1; }
    const D = CARD + 60, z = this.cfg.zoom || 0;
    this._card(this.items[i], CARD_X - Math.round(D * e), this.items[i].video ? 1 : 1 + z * Math.min(local / d, 1));
    if (p > 0) this._card(this.items[j], CARD_X + Math.round(D * (1 - e)), 1);
    // progress segments
    const segw = (CARD - (N - 1) * 8) / N;
    for (let k = 0; k < N; k++) {
      const x = CARD_X + k * (segw + 8);
      ctx.fillStyle = 'rgba(255,255,255,.28)'; rr(ctx, x, 168, segw, 6, 3); ctx.fill();
      const fill = k < i ? 1 : k === i ? Math.min(local / d, 1) : 0;
      if (fill > 0) { ctx.fillStyle = RED; rr(ctx, x, 168, Math.max(6, segw * fill), 6, 3); ctx.fill(); }
    }
    ctx.drawImage(this.overlay, 0, 0);
  }
  _card(it, x, zoomK) {
    const ctx = this.ctx;
    const cw = it.cw || CARD, ch = it.ch || CARD, cx = x + (CARD - cw) / 2, cy = CARD_Y + (CARD - ch) / 2, sh = it.shadow || this.shadow;
    if (x > -CARD - 160 && x < W + 160) ctx.drawImage(sh.c, cx - sh.pad, cy - sh.pad);
    ctx.save(); rr(ctx, cx, cy, cw, ch, RADIUS); ctx.clip();
    if (it.video) {
      const v = it.video, ok = v.readyState >= 2 && v.videoWidth > 0;
      if (ok && it.fill) { const sc = Math.max(cw / v.videoWidth, ch / v.videoHeight), sw = cw / sc, sh2 = ch / sc; ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh2) / 2, sw, sh2, cx, cy, cw, ch); }
      else ctx.drawImage(ok ? v : it.poster, cx, cy, cw, ch);
    } else {
      const s = CARD * zoomK;
      ctx.drawImage(it.card, x + CARD / 2 - s / 2, CARD_Y + CARD / 2 - s / 2, s, s);
    }
    ctx.restore();
  }
  _standby() {
    const ctx = this.ctx, g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#232C57'); g.addColorStop(1, '#141a3a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.overlay, 0, 0);
  }
  drawOverlay() {
    const o = this.overlay.getContext('2d'); o.clearRect(0, 0, W, H);
    if (this.logo) { const lw = 372, lh = lw * this.logo.naturalHeight / this.logo.naturalWidth; o.drawImage(this.logo, (W - lw) / 2, 44, lw, lh); }
    const f = this.cfg.footer || {}, FY = 1240;
    const g = o.createLinearGradient(0, FY, 0, H); g.addColorStop(0, '#2b3669'); g.addColorStop(1, '#1d2550');
    o.save(); rr(o, 0, FY, W, H - FY + 60, [56, 56, 0, 0]); o.clip();
    o.fillStyle = g; o.fillRect(0, FY, W, H - FY);
    o.fillStyle = BLUE; o.fillRect(0, FY, W, 8); o.fillStyle = RED; o.fillRect(W * 0.62, FY, W * 0.38, 8);
    o.restore();
    o.textBaseline = 'middle'; o.fillStyle = '#fff';
    // red pill: label + phone icon
    const label = f.label || 'خدمة العملاء';
    o.direction = 'rtl'; o.textAlign = 'right'; o.font = '700 38px Bukra';
    const tw = o.measureText(label).width, pw = 30 + tw + 14 + 36 + 26, px = (W - pw) / 2, py = 1282, ph = 69.4;
    o.fillStyle = RED; rr(o, px, py, pw, ph, ph / 2); o.fill();
    o.fillStyle = '#fff'; o.fillText(label, px + pw - 30, py + 8 + 24.7 + 2);
    o.save(); o.translate(px + 26, py + 8 + 24.7 - 18); o.scale(1.5, 1.5);
    o.strokeStyle = '#fff'; o.lineWidth = 2; o.lineCap = 'round'; o.lineJoin = 'round'; o.stroke(new Path2D(PHONE_PATH)); o.restore();
    // phone number (connected digits)
    const phone = String(f.phone || '920027276').replace(/\s+/g, '');
    o.direction = 'ltr'; o.textAlign = 'center'; o.textBaseline = 'alphabetic'; o.fillStyle = '#fff';
    const ns = fit(o, phone, 700, 150, 968); o.font = `700 ${ns}px Bukra`;
    try { o.letterSpacing = '2px'; } catch (e) { /* optional */ }
    o.fillText(phone, W / 2 + 1, 1488);
    try { o.letterSpacing = '0px'; } catch (e) { /* optional */ }
    // QR box
    o.fillStyle = '#fff'; rr(o, 56, 1537, 310, 310, 30); o.fill();
    if (this.qr) { o.imageSmoothingQuality = 'high'; o.drawImage(this.qr, 70, 1551, 282, 282); }
    // info column (right of the QR, right-aligned)
    const t = f.qrTitle ?? 'امسح الكود للتواصل', s = f.qrSub ?? 'عبر واتساب مباشرة';
    const lines = String(f.hours ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    const MAXW = 1024 - 406;
    o.direction = 'rtl'; o.textAlign = 'right'; o.textBaseline = 'middle';
    const ts = fit(o, t, 700, 46, MAXW), ss = fit(o, s, 400, 36, MAXW);
    const hs = lines.length ? Math.min(...lines.map((l) => fit(o, l, 400, 34, MAXW))) : 0;
    const lh = hs * 1.45;
    const H1 = ts * 1.3 + 12 + ss * 1.3 + (lines.length ? 12 + 16 + 2 + lines.length * lh : 0) + (lines.length ? 12 : 0);
    let y = 1692 - H1 / 2;
    o.fillStyle = '#fff'; o.font = `700 ${ts}px Bukra`; o.fillText(t, 1024, y + ts * 0.65); y += ts * 1.3 + 12;
    o.fillStyle = '#cfd6f2'; o.font = `400 ${ss}px Bukra`; o.fillText(s, 1024, y + ss * 0.65); y += ss * 1.3;
    if (lines.length) {
      y += 24; o.fillStyle = 'rgba(255,255,255,.18)'; o.fillRect(406, y, MAXW, 2); y += 18;
      o.fillStyle = '#e3e8fb'; o.font = `400 ${hs}px Bukra`;
      for (const l of lines) { o.fillText(l, 1024, y + lh / 2 + 2); y += lh; }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LandscapeEngine — true 1920×1080 canvas for rotate=90/270 screens
//
// Layout (left-to-right):
//   [LEFT 280px]  navy bg + Tarco logo centered
//   [CENTER 1360px] blurred bg + content in natural aspect (no forced square)
//   [RIGHT 280px] navy bg + QR top + label/phone/hours below
// ─────────────────────────────────────────────────────────────────────────────
export const LW = 1920, LH = 1080;
const L_LEFT_W = 280, L_RIGHT_W = 280;
const L_CENTER_X = L_LEFT_W, L_CENTER_W = LW - L_LEFT_W - L_RIGHT_W; // 1360
const L_RIGHT_X = LW - L_RIGHT_W;
const NAVY1 = '#141a3a', NAVY2 = '#1d2550';

export class LandscapeEngine {
  constructor(canvas, { logo, defaultQr }) {
    this.c = canvas; canvas.width = LW; canvas.height = LH;
    this.ctx = canvas.getContext('2d');
    this.logo = logo; this.defaultQr = defaultQr ? cropQr(defaultQr) : null; this.qr = this.defaultQr;
    this.cfg = { hold: 8, transition: 0.9, zoom: 0, footer: {} };
    this.items = []; this.starts = [0]; this.durs = []; this.total = 0;
    this.overlay = mk(LW, LH);
    this.drawOverlay();
  }

  setConfig(cfg) {
    this.cfg = { ...this.cfg, ...cfg, footer: { ...(this.cfg.footer || {}), ...(cfg.footer || {}) } };
    this._layout(); this.drawOverlay();
  }
  setQr(img) { this.qr = img ? cropQr(img) : this.defaultQr; this.drawOverlay(); }

  async setPosts(list) {
    const old = new Map(this.items.map((i) => [i.key, i]));
    const next = [];
    for (const p of list) {
      let it = old.get(p.key);
      if (!it) { try { it = await this._build(p); } catch (e) { console.warn(e); continue; } }
      it.seconds = p.seconds; next.push(it);
    }
    for (const it of this.items) if (it.video && !next.includes(it)) { try { it.video.pause(); it.video.removeAttribute('src'); it.video.load(); } catch (e) { /* ignore */ } }
    this.items = next; this._act = null; this._layout();
  }

  _layout() {
    const hold = this.cfg.hold || 8;
    this.durs = this.items.map((i) => Math.max(2, Number(i.seconds) || (i.video ? i.vdur : hold)));
    this.starts = [0]; this.durs.forEach((d) => this.starts.push(this.starts[this.starts.length - 1] + d));
    this.total = this.starts[this.starts.length - 1];
  }

  async _loadVideo(p) {
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = p.video;
    await new Promise((res) => {
      const done = () => res();
      v.addEventListener('loadeddata', done, { once: true }); v.addEventListener('error', done, { once: true });
      setTimeout(done, 25000); v.load();
    });
    return v;
  }

  // Compute content dimensions that fit inside the center panel while preserving natural aspect ratio.
  // Square stays square, portrait stays portrait — no forced crop.
  _contentSize(srcW, srcH) {
    const PAD = 40;
    const maxW = L_CENTER_W - PAD * 2;  // 1280
    const maxH = LH - PAD * 2;          // 1000
    const scale = Math.min(maxW / srcW, maxH / srcH);
    return { cw: Math.round(srcW * scale), ch: Math.round(srcH * scale) };
  }

  async _build(p) {
    let video = null, img = null;
    if (p.video) {
      video = await this._loadVideo(p);
      if (p.src) { try { img = await loadImg(p.src); } catch (e) { /* poster optional */ } }
      if (!img && video.readyState >= 2) { img = mk(video.videoWidth, video.videoHeight); img.getContext('2d').drawImage(video, 0, 0); img.naturalWidth = img.width; img.naturalHeight = img.height; }
      if (!img) throw new Error('video failed: ' + String(p.video).slice(0, 60));
    } else img = p.img || await loadImg(p.src);
    img = img.naturalWidth ? img : Object.assign(img, { naturalWidth: img.width, naturalHeight: img.height });

    // blurred full-landscape background from content (covers all 1920×1080)
    const small = mk(96, 54), sm = small.getContext('2d');
    sm.imageSmoothingQuality = 'high';
    try { sm.filter = 'blur(2px)'; } catch (e) { /* optional */ }
    sm.drawImage(img, 0, 0, 96, 54);
    const bg = mk(LW, LH), b = bg.getContext('2d');
    b.imageSmoothingQuality = 'high';
    try { b.filter = 'blur(18px)'; } catch (e) { /* older browsers: upscale already soft */ }
    b.drawImage(small, -40, -40, LW + 80, LH + 80); b.filter = 'none';
    b.fillStyle = 'rgba(35,44,87,.55)'; b.fillRect(0, 0, LW, LH);

    if (video) {
      const vw = video.videoWidth || img.naturalWidth, vh = video.videoHeight || img.naturalHeight;
      const { cw, ch } = this._contentSize(vw, vh);
      const poster = mk(cw, ch), pc = poster.getContext('2d');
      pc.drawImage(img, 0, 0, cw, ch);
      const vdur = isFinite(video.duration) && video.duration > 0 ? video.duration : (Number(p.vdur) || 8);
      const it = { key: p.key, id: p.id, seconds: p.seconds, bg, video, vdur, poster, cw, ch, vw, vh };
      video.onended = () => { if (this._act === it && this._local < this._dur - 0.4) { video.currentTime = 0; video.play().catch(() => {}); } };
      return it;
    }

    // image: pre-render at content dimensions (preserve natural aspect)
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const { cw, ch } = this._contentSize(iw, ih);
    const card = mk(cw, ch), cx = card.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, iw, ih, 0, 0, cw, ch);
    return { key: p.key, id: p.id, seconds: p.seconds, bg, card, cw, ch };
  }

  _sync(i, j, local, d) {
    this._local = local; this._dur = d;
    const act = this.items[i];
    if (this._act !== act) {
      if (this._act && this._act.video) this._act.video.pause();
      this._act = act;
      if (act.video) { const v = act.video; try { v.currentTime = 0; } catch (e) { /* ignore */ } v.play().catch(() => {}); }
      const nx = this.items[j];
      if (nx && nx !== act && nx.video) { try { nx.video.pause(); nx.video.currentTime = 0; } catch (e) { /* ignore */ } }
    } else if (act.video && act.video.paused && !act.video.ended && local < d - 0.4) act.video.play().catch(() => {});
  }

  locate(t) {
    const N = this.items.length; let i = 0;
    while (i < N - 1 && t >= this.starts[i + 1]) i++;
    const local = t - this.starts[i], d = this.durs[i], tr = Math.min(this.cfg.transition || 0.9, d / 2);
    let p = 0; if (N > 1 && local > d - tr) p = Math.min((local - (d - tr)) / tr, 1);
    return { i, j: (i + 1) % N, local, d, p };
  }

  render(t) {
    const ctx = this.ctx, N = this.items.length;
    if (N === 0) { this._standby(); return; }
    const { i, j, local, d, p } = this.locate(t), e = ease(p);
    this._sync(i, j, local, d);

    // blurred background fills whole canvas
    ctx.globalAlpha = 1; ctx.drawImage(this.items[i].bg, 0, 0);
    if (p > 0) { ctx.globalAlpha = e; ctx.drawImage(this.items[j].bg, 0, 0); ctx.globalAlpha = 1; }

    // content in center column — slide horizontally during transition
    const slideAmt = Math.round((L_CENTER_W + 80) * e);
    this._drawContent(this.items[i], -slideAmt, e < 0.5 ? 1 : Math.max(0, 1 - (e - 0.5) * 4));
    if (p > 0) this._drawContent(this.items[j], L_CENTER_W + 80 - slideAmt, Math.min(1, e * 4));

    ctx.drawImage(this.overlay, 0, 0);
  }

  // Draw content item at horizontal offset dx inside center column, with optional alpha
  _drawContent(it, dx, alpha) {
    const ctx = this.ctx;
    const cw = it.cw, ch = it.ch;
    // center content within the center column
    const destX = L_CENTER_X + (L_CENTER_W - cw) / 2 + dx;
    const destY = (LH - ch) / 2;
    if (destX + cw < L_CENTER_X || destX > L_RIGHT_X) return; // fully off-screen

    ctx.save();
    // clip drawing to center column only (don't bleed over panels)
    ctx.beginPath(); ctx.rect(L_CENTER_X, 0, L_CENTER_W, LH); ctx.clip();
    ctx.globalAlpha = alpha;

    // soft drop-shadow for the content card
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#000';
    rr(ctx, destX, destY, cw, ch, 20); ctx.fill();
    ctx.shadowColor = 'transparent';

    // draw content
    rr(ctx, destX, destY, cw, ch, 20); ctx.clip();
    if (it.video) {
      const v = it.video, ok = v.readyState >= 2 && v.videoWidth > 0;
      ctx.drawImage(ok ? v : it.poster, destX, destY, cw, ch);
    } else {
      ctx.drawImage(it.card, destX, destY, cw, ch);
    }
    ctx.restore();
  }

  _standby() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, LW, LH);
    g.addColorStop(0, '#232C57'); g.addColorStop(1, '#141a3a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
    ctx.drawImage(this.overlay, 0, 0);
  }

  drawOverlay() {
    const o = this.overlay.getContext('2d'); o.clearRect(0, 0, LW, LH);
    const f = this.cfg.footer || {};

    // ── LEFT PANEL: navy background ──
    const lg = o.createLinearGradient(0, 0, L_LEFT_W, 0);
    lg.addColorStop(0, NAVY1); lg.addColorStop(1, NAVY2);
    o.fillStyle = lg; o.fillRect(0, 0, L_LEFT_W, LH);
    // Red accent line on right edge of left panel
    o.fillStyle = RED; o.fillRect(L_LEFT_W - 4, 0, 4, LH);

    // Tarco logo centered in left panel
    if (this.logo) {
      const maxLogoW = 220, maxLogoH = 160;
      const lw = this.logo.naturalWidth, lh = this.logo.naturalHeight;
      const scale = Math.min(maxLogoW / lw, maxLogoH / lh);
      const dw = Math.round(lw * scale), dh = Math.round(lh * scale);
      o.drawImage(this.logo, Math.round((L_LEFT_W - dw) / 2), Math.round((LH - dh) / 2), dw, dh);
    }

    // ── RIGHT PANEL: navy background ──
    const rg = o.createLinearGradient(L_RIGHT_X, 0, LW, 0);
    rg.addColorStop(0, NAVY2); rg.addColorStop(1, NAVY1);
    o.fillStyle = rg; o.fillRect(L_RIGHT_X, 0, L_RIGHT_W, LH);
    // Red accent line on left edge of right panel
    o.fillStyle = RED; o.fillRect(L_RIGHT_X, 0, 4, LH);

    // ── RIGHT PANEL content ──
    const PAD = 20; // padding inside right panel
    const panelInnerX = L_RIGHT_X + PAD;
    const panelInnerW = L_RIGHT_W - PAD * 2;

    // QR box — top of right panel
    const QR_SIZE = panelInnerW; // fill the width
    const QR_Y = 32;
    o.fillStyle = '#fff'; rr(o, panelInnerX, QR_Y, QR_SIZE, QR_SIZE, 14); o.fill();
    if (this.qr) {
      const inset = 10;
      o.imageSmoothingQuality = 'high';
      o.drawImage(this.qr, panelInnerX + inset, QR_Y + inset, QR_SIZE - inset * 2, QR_SIZE - inset * 2);
    }

    // Below QR: red label pill + phone + divider + hours
    let ry = QR_Y + QR_SIZE + 24;

    // Red pill label
    const label = f.label || 'خدمة العملاء';
    o.direction = 'rtl'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.font = '700 22px Bukra';
    const labelW = Math.min(o.measureText(label).width + 28, panelInnerW);
    const pillH = 38, pillX = panelInnerX + (panelInnerW - labelW) / 2;
    o.fillStyle = RED; rr(o, pillX, ry, labelW, pillH, pillH / 2); o.fill();
    o.fillStyle = '#fff'; o.fillText(label, panelInnerX + panelInnerW / 2, ry + pillH / 2);
    ry += pillH + 14;

    // Phone number
    const phone = String(f.phone || '920027276').replace(/\s+/g, '');
    o.direction = 'ltr'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillStyle = '#fff';
    const pfs = fit(o, phone, 700, 32, panelInnerW); o.font = `700 ${pfs}px Bukra`;
    try { o.letterSpacing = '1px'; } catch (e) { /* optional */ }
    o.fillText(phone, panelInnerX + panelInnerW / 2, ry + pfs * 0.6);
    try { o.letterSpacing = '0px'; } catch (e) { /* optional */ }
    ry += pfs * 1.4 + 10;

    // Divider
    o.fillStyle = 'rgba(255,255,255,.2)'; o.fillRect(panelInnerX, ry, panelInnerW, 1); ry += 14;

    // Hours lines
    const lines = String(f.hours ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (lines.length) {
      o.direction = 'rtl'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillStyle = '#cfd6f2';
      const hfs = Math.min(...lines.map((l) => fit(o, l, 400, 24, panelInnerW)));
      o.font = `400 ${hfs}px Bukra`;
      for (const l of lines) { o.fillText(l, panelInnerX + panelInnerW / 2, ry + hfs * 0.6); ry += hfs * 1.5; }
    }

    // QR scan hint (small, below hours or below divider)
    const hint = f.qrTitle ?? 'امسح للتواصل';
    o.direction = 'rtl'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillStyle = 'rgba(255,255,255,.5)';
    o.font = `400 18px Bukra`;
    // only draw if space remains
    if (ry + 26 < LH - PAD) { o.fillText(hint, panelInnerX + panelInnerW / 2, ry + 12); }
  }
}
