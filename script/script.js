/* ==========================================================================
   WSWS.WORKS
   画面は上下左右につながる。移るときは小さな W と S が明滅して次の画面の形を
   つくり、本物に切り替わる。背景の薄い W と S はカーソルのほうを向く。
   ========================================================================== */
(() => {
    'use strict';

    const root = document.documentElement;
    const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const FONT = '"Inter Tight", "Inter", "Helvetica Neue", Arial, sans-serif';

    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const inOutCubic = (t) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

    const header = $('.site-header');
    const compass = $('.compass');

    /* ----------------------------------------------------------------------
       ロゴ: 1 文字ずつに分けて、画面幅いっぱいに合わせる
       ---------------------------------------------------------------------- */
    const mark = $('[data-mark]');
    const markText = mark.textContent.trim();
    mark.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = markText;
    mark.appendChild(sr);
    const letters = Array.from(markText).map((ch) => {
        const el = document.createElement('span');
        el.className = 'ch';
        el.textContent = ch;
        el.dataset.part = 'glyph';
        el.setAttribute('aria-hidden', 'true');
        mark.appendChild(el);
        return { el, w: 700 };
    });

    // 表示されていない(トップ以外の画面にいる)ときは測れないので何もしない
    function fitMark() {
        if (!mark.getClientRects().length) return;
        letters.forEach((l) => { l.el.style.fontWeight = ''; });
        mark.style.fontSize = '100px';
        const width = letters.reduce((sum, l) => sum + l.el.getBoundingClientRect().width, 0);
        const avail = mark.getBoundingClientRect().width;
        if (width > 0) mark.style.fontSize = `${((100 * avail) / width) * .995}px`;
        letters.forEach((l) => { l.el.style.fontWeight = Math.round(l.w); });
    }

    function markBaseline() {
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        mark.appendChild(probe);
        const y = probe.getBoundingClientRect().bottom;
        probe.remove();
        return y;
    }

    /* ----------------------------------------------------------------------
       トップの動き: カーソルの近くでロゴが細くなり、作品のカードが奥行きで動く
       ---------------------------------------------------------------------- */
    const topScreen = $('#top');
    const stack = $$('.stack-item').map((el) => ({
        par: $('.stack-par', el),
        depth: parseFloat(el.style.getPropertyValue('--depth')) || 1,
        x: 0, y: 0,
    }));

    if (FINE && !RM) {
        let mx = -1e4, my = -1e4, raf = 0;
        const tick = () => {
            let moving = false;
            const fs = parseFloat(mark.style.fontSize) || 100;
            for (const l of letters) {
                const r = l.el.getBoundingClientRect();
                const d = Math.hypot(r.left + r.width / 2 - mx, (r.top + r.height / 2 - my) * 1.3);
                const f = clamp(1 - d / (fs * 2), 0, 1);
                const target = 700 - 480 * inOutCubic(f);
                l.w = lerp(l.w, target, .14);
                if (Math.abs(l.w - target) > .5) moving = true;
                l.el.style.fontWeight = Math.round(l.w);
            }
            const inside = mx > -1e3;
            const nx = inside ? mx / innerWidth - .5 : 0, ny = inside ? my / innerHeight - .5 : 0;
            for (const s of stack) {
                const tx = -nx * 36 * s.depth, ty = -ny * 26 * s.depth;
                s.x = lerp(s.x, tx, .08);
                s.y = lerp(s.y, ty, .08);
                if (Math.abs(s.x - tx) > .05 || Math.abs(s.y - ty) > .05) moving = true;
                s.par.style.transform = `translate3d(${s.x.toFixed(2)}px,${s.y.toFixed(2)}px,0)`;
            }
            raf = moving ? requestAnimationFrame(tick) : 0;
        };
        const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
        topScreen.addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; kick(); }, { passive: true });
        topScreen.addEventListener('pointerleave', () => { mx = my = -1e4; kick(); });
    }

    /* ----------------------------------------------------------------------
       背景: 薄い W と S を敷き詰め、それぞれがカーソルのほうを向く。
       W はくぼみが 2 つある側(上)、S は書き始めのカーブの側(上)をカーソルへ向ける
       ---------------------------------------------------------------------- */
    const field = (() => {
        const cvs = $('.field');
        const ctx = cvs.getContext('2d');
        let items = [], W = 0, H = 0, fs = 15, px = null, py = null, raf = 0;

        function draw() {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            ctx.fillStyle = 'rgba(17,17,17,.045)';
            ctx.font = `600 ${fs}px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            for (const it of items) {
                const c = Math.cos(it.a) * DPR, s = Math.sin(it.a) * DPR;
                ctx.setTransform(c, s, -s, c, it.x * DPR, it.y * DPR);
                ctx.fillText(it.ch, 0, fs * .36);
            }
        }

        // 文字の上向き(0, -1)を回して、カーソルへの向きに合わせる角度
        function aim() {
            if (px === null) return;
            for (const it of items) it.t = Math.atan2(px - it.x, -(py - it.y));
        }

        function tick() {
            let moving = false;
            for (const it of items) {
                const d = Math.atan2(Math.sin(it.t - it.a), Math.cos(it.t - it.a));
                if (Math.abs(d) > .002) {
                    it.a += RM ? d : d * .16;
                    moving = true;
                } else {
                    it.a = it.t;
                }
            }
            draw();
            raf = moving ? requestAnimationFrame(tick) : 0;
        }

        function build() {
            W = innerWidth;
            H = innerHeight;
            cvs.width = Math.round(W * DPR);
            cvs.height = Math.round(H * DPR);
            const gap = clamp(Math.round(Math.min(W, H) / 19), 34, 52);
            fs = Math.round(gap * .36);
            const cols = Math.ceil(W / gap) + 1, rows = Math.ceil(H / gap) + 1;
            const ox = (W - (cols - 1) * gap) / 2, oy = (H - (rows - 1) * gap) / 2;
            items = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    items.push({ x: ox + c * gap, y: oy + r * gap, ch: (r + c) % 2 ? 'S' : 'W', a: 0, t: 0 });
                }
            }
            aim();
            items.forEach((it) => { it.a = it.t; });
            draw();
        }

        const point = (x, y) => {
            px = x;
            py = y;
            aim();
            if (!raf) raf = requestAnimationFrame(tick);
        };
        addEventListener('pointermove', (e) => point(e.clientX, e.clientY), { passive: true });
        addEventListener('pointerdown', (e) => point(e.clientX, e.clientY), { passive: true });
        build();
        if (document.fonts) document.fonts.ready.then(draw);
        return { build };
    })();

    /* ----------------------------------------------------------------------
       部品: data-part を付けた要素。切り替えのとき、W と S でこの形をなぞる
       text は行ごとの帯、links は中のリンクごとの帯、box と card は四角、glyph はロゴの文字
       ---------------------------------------------------------------------- */
    const ALPHA = { text: .78, links: .85, box: .3, card: .3, glyph: 1 };
    const bar = (g, r, k) => g.fillRect(r.left, r.top + (r.height * (1 - k)) / 2, r.width, r.height * k);

    function maskOf(el, kind) {
        if (kind === 'glyph') {
            return (g) => {
                g.font = `700 ${parseFloat(getComputedStyle(mark).fontSize)}px ${FONT}`;
                g.textAlign = 'left';
                g.textBaseline = 'alphabetic';
                g.fillText(el.textContent, el.getBoundingClientRect().left, markBaseline());
            };
        }
        if (kind === 'card') {
            return (g) => {
                const img = $('img', el), r = img.getBoundingClientRect();
                const rot = ((parseFloat(getComputedStyle($('.stack-card', el)).rotate) || 0) * Math.PI) / 180;
                g.save();
                g.translate(r.left + r.width / 2, r.top + r.height / 2);
                g.rotate(rot);
                g.fillRect(-img.offsetWidth / 2, -img.offsetHeight / 2, img.offsetWidth, img.offsetHeight);
                g.restore();
            };
        }
        if (kind === 'box') {
            return (g) => {
                const r = el.getBoundingClientRect();
                g.fillRect(r.left, r.top, r.width, r.height);
            };
        }
        if (kind === 'links') {
            return (g) => $$('a, button', el).forEach((a) => {
                if (a.getClientRects().length) bar(g, a.getBoundingClientRect(), .5);
            });
        }
        return (g) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            [...range.getClientRects()].forEach((r) => bar(g, r, .6));
        };
    }

    function partsOf(containers) {
        const els = [];
        containers.forEach((c) => {
            if (c.matches('[data-part]')) els.push(c);
            els.push(...$$('[data-part]', c));
        });
        return els
            .filter((el) => el.getClientRects().length)
            .map((el) => {
                const kind = el.dataset.part;
                return { el, kind, alpha: ALPHA[kind] ?? .78, mask: maskOf(el, kind), delay: 0, fast: 0 };
            });
    }

    // 部品を、それぞれの遅れでちらつきながら出す
    function playIn(parts, containers, fast) {
        let max = 0;
        parts.forEach((p) => {
            const d = fast ? p.fast : p.delay;
            max = Math.max(max, d);
            p.el.style.setProperty('--d', `${Math.round(d * 1000)}ms`);
        });
        containers.forEach((c) => {
            c.classList.remove('is-forming', 'is-revealing');
            void c.offsetWidth;
            c.classList.add('is-revealing');
        });
        setTimeout(() => containers.forEach((c) => c.classList.remove('is-revealing')), (max + .8) * 1000);
    }

    /* ----------------------------------------------------------------------
       切り替えの演出(導入も同じ仕組みで、長く派手にしたもの)
       1. 小さな W と S が画面を覆う(導入は中心から、移動は進む向きの端から)
       2. ピリピリ明滅する(層・位置・濃さを数十ミリ秒ごとに切り替える)
       3. 次の画面の部品の形だけが文字で残る
       4. 部品ごとに本物へ切り替わる
       ---------------------------------------------------------------------- */
    const fx = (() => {
        const wrap = $('[data-fx]');
        const cvs = $('.intro-canvas', wrap);
        const ctx = cvs.getContext('2d');
        const LV = [.08, .12, .16, .22, .3, .42, .6, .9];
        const M = 4; // ノイズの層は画面より上下左右 M マスずつ大きく描き、ずらしても端が欠けないようにする
        const SEG = 6; // 消えるときの 1 行の区切り数
        const CFG = {
            intro: {
                cover: 1.0, swap: 0, resolve: 2.9, settle: .7, reveal: 4.0,
                step: .06, gbase: .25, gstep: .045, events: 38, evFrom: .25,
                flashes: [1.74, 2.22], climax: [2.44, 2.53, 2.63, 2.71, 2.78],
            },
            move: {
                cover: .3, swap: .3, resolve: .52, settle: .3, reveal: .86,
                step: .035, gbase: .1, gstep: .028, events: 4, evFrom: .05,
                flashes: [], climax: [],
            },
        };
        const lay = document.createElement('canvas');
        let W = 0, H = 0, cell = 12, cols = 0, rows = 0, noise = [], noiseKey = '';
        let run = null;

        const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

        function prepare(c, w, h, dpr, weight, size) {
            c.width = Math.round(w * dpr);
            c.height = Math.round(h * dpr);
            const g = c.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.font = `${weight} ${cell * size}px ${FONT}`;
            g.textAlign = 'center';
            g.textBaseline = 'alphabetic';
            return g;
        }

        // 1 マスに W か S を 1 文字。濃さごとにまとめて描く
        function fillCells(g, list) {
            const byAlpha = new Map();
            for (const [col, row, a] of list) {
                if (!byAlpha.has(a)) byAlpha.set(a, []);
                byAlpha.get(a).push(col, row);
            }
            for (const [a, xy] of byAlpha) {
                g.fillStyle = `rgba(17,17,17,${a})`;
                for (let i = 0; i < xy.length; i += 2) {
                    g.fillText(Math.random() < .5 ? 'W' : 'S', (xy[i] + .5) * cell, (xy[i + 1] + .5) * cell + cell * .29);
                }
            }
        }

        function sizeUp() {
            W = innerWidth;
            H = innerHeight;
            cvs.width = Math.round(W * DPR);
            cvs.height = Math.round(H * DPR);
            cell = clamp(Math.round(Math.min(W, H) / 70), 8, 13);
            cols = Math.ceil(W / cell);
            rows = Math.ceil(H / cell);
            const key = `${W}x${H}`;
            if (key === noiseKey) return;
            noiseKey = key;
            const ldpr = Math.min(DPR, 1.5);
            noise = [0, 1].map((i) => {
                const c = noise[i] || document.createElement('canvas');
                const g = prepare(c, (cols + M * 2) * cell, (rows + M * 2) * cell, ldpr, 600, .8);
                const list = [];
                for (let r = 0; r < rows + M * 2; r++) {
                    for (let col = 0; col < cols + M * 2; col++) {
                        if (Math.random() < .78) list.push([col, r, LV[(Math.random() ** 1.6 * LV.length) | 0]]);
                    }
                }
                fillCells(g, list);
                return c;
            });
        }

        function assignDelays(r, parts) {
            let i = 0, gi = 0;
            for (const p of parts) {
                if (p.kind === 'glyph') {
                    p.delay = r.cfg.gbase + gi * r.cfg.gstep;
                    p.fast = .08 + gi * .025;
                    gi++;
                } else {
                    p.delay = i * r.cfg.step;
                    p.fast = i * .035;
                    i++;
                }
            }
            r.parts = parts;
            r.end = r.cfg.reveal + parts.reduce((m, p) => Math.max(m, p.delay), 0) + .16;
        }

        // 次の画面の部品の位置を測り、どのマスがどの部品の形に入るかを決めて、文字でなぞった層を描く
        function measure(r) {
            r.measured = true;
            fitMark();
            const parts = partsOf(r.containers);
            assignDelays(r, parts);
            const reg = new Int16Array(cols * rows).fill(-1);
            const g = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
            g.canvas.width = cols;
            g.canvas.height = rows;
            parts.forEach((part, pi) => {
                g.setTransform(1, 0, 0, 1, 0, 0);
                g.clearRect(0, 0, cols, rows);
                g.setTransform(1 / cell, 0, 0, 1 / cell, 0, 0);
                g.fillStyle = '#000';
                part.mask(g);
                const d = g.getImageData(0, 0, cols, rows).data;
                for (let i = 0; i < reg.length; i++) if (d[i * 4 + 3] > 100) reg[i] = pi;
            });
            r.allCut = new Path2D();
            parts.forEach((p) => { p.cutA = new Path2D(); p.cutB = new Path2D(); });
            const list = [];
            for (let i = 0; i < reg.length; i++) {
                if (reg[i] < 0) continue;
                const p = parts[reg[i]], col = i % cols, row = (i / cols) | 0;
                const x = col * cell - .5, y = row * cell - .5;
                (Math.random() < .5 ? p.cutA : p.cutB).rect(x, y, cell + 1, cell + 1);
                r.allCut.rect(x, y, cell + 1, cell + 1);
                list.push([col, row, p.alpha]);
            }
            fillCells(prepare(lay, W, H, DPR, 800, .88), list);
        }

        function begin(r) {
            if (run !== r || r.aborted) return;
            sizeUp();
            const c = r.cfg;
            r.jitR = Array.from({ length: rows }, () => rand(-3, 3));
            r.jitC = Array.from({ length: cols }, () => rand(-3, 3));
            // 消える順: 導入は中心から外へ、移動は進んできた側から
            const bias = (x, y) => {
                if (!r.dir) return Math.min(1, Math.hypot(x - .5, y - .5) / .71);
                if (r.dir.x) return r.dir.x > 0 ? 1 - x : x;
                return r.dir.y > 0 ? 1 - y : y;
            };
            r.segOff = Array.from({ length: rows }, (_, row) => Array.from({ length: SEG }, (__, s) => (
                c.resolve + bias((s + .5) / SEG, (row + .5) / rows) * c.settle * .65 + Math.random() * c.settle * .35
            )));
            // ピリッと走るノイズ: 横にずれる帯と、白黒が反転した四角。導入では終盤ほど多い
            r.events = Array.from({ length: c.events }, () => {
                const band = Math.random() < .6;
                const u = r.mode === 'intro' ? Math.sqrt(Math.random()) : Math.random();
                return {
                    t: c.evFrom + (c.resolve - .06 - c.evFrom) * u, dur: rand(.035, .09),
                    r0: (Math.random() * rows) | 0, h: 1 + ((Math.random() * (band ? 4 : 3)) | 0),
                    c0: band ? 0 : (Math.random() * cols) | 0, w: band ? cols : 3 + ((Math.random() * 16) | 0),
                    dx: band ? (Math.random() < .5 ? -1 : 1) * (1 + ((Math.random() * 3) | 0)) : 0,
                    inv: !band || Math.random() < .3,
                };
            });
            if (c.swap <= 0) {
                r.swapped = true;
                r.swap && r.swap();
                measure(r);
            }
            r.t0 = performance.now();
            r.raf = requestAnimationFrame(frame);
        }

        const drawNoise = (r, dx = 0) => {
            const c = noise[r.k], s = c.width / ((cols + M * 2) * cell);
            ctx.drawImage(c, 0, 0, c.width, c.height, (r.ox + dx - M) * cell, (r.oy - M) * cell, c.width / s, c.height / s);
        };

        // 覆っていく範囲。導入は中心からの円、移動は進む向きの端から
        function coverPath(r, t) {
            const c = r.cfg;
            ctx.beginPath();
            if (!r.dir) {
                const R = (1 - (1 - clamp(t / c.cover, 0, 1)) ** 3) * Math.hypot(W, H) * .58;
                for (let row = 0; row < rows; row++) {
                    const dy = (row + .5) * cell - H / 2;
                    const hw = Math.sqrt(Math.max(0, R * R - dy * dy)) + r.jitR[row] * cell;
                    if (hw <= 0) continue;
                    const x0 = Math.max(0, Math.floor((W / 2 - hw) / cell) * cell);
                    ctx.rect(x0, row * cell, Math.min(W, Math.ceil((W / 2 + hw) / cell) * cell) - x0, cell);
                }
                return;
            }
            const p = inOutCubic(clamp(t / c.cover, 0, 1));
            const frac = (j) => (p >= 1 ? 1 : clamp(p * 1.3 - .15 + j * .04, 0, 1));
            if (r.dir.x) {
                for (let row = 0; row < rows; row++) {
                    const w = Math.ceil(frac(r.jitR[row]) * cols) * cell;
                    ctx.rect(r.dir.x > 0 ? W - w : 0, row * cell, w, cell);
                }
            } else {
                for (let col = 0; col < cols; col++) {
                    const h = Math.ceil(frac(r.jitC[col]) * rows) * cell;
                    ctx.rect(col * cell, r.dir.y > 0 ? H - h : 0, cell, h);
                }
            }
        }

        function dissolvePath(r, t) {
            ctx.beginPath();
            for (let row = 0; row < rows; row++) {
                for (let s = 0; s < SEG; s++) {
                    if (t >= r.segOff[row][s]) continue;
                    const a = Math.round((cols * s) / SEG), b = Math.round((cols * (s + 1)) / SEG);
                    ctx.rect(a * cell, row * cell, (b - a) * cell, cell);
                }
            }
        }

        function frame(now) {
            const r = run;
            if (!r || r.aborted) return;
            const c = r.cfg, t = (now - r.t0) / 1000;
            if (!r.swapped && t >= c.swap) {
                r.swapped = true;
                r.swap && r.swap();
                measure(r);
            }

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

            // ピリピリ: 層・位置・濃さを数十ミリ秒ごとに切り替える。導入は時間とともに激しくなる
            const heat = r.mode === 'intro' ? clamp(t / c.resolve, 0, 1) ** 1.2 : .8;
            if (t >= r.nextSwitch) {
                r.k = (Math.random() * noise.length) | 0;
                const still = t >= c.resolve;
                r.ox = still ? 0 : ((Math.random() * 5) | 0) - 2;
                r.oy = still ? 0 : ((Math.random() * 3) | 0) - 1;
                r.nA = Math.random() < .06 + heat * .14 ? 1 : .45 + heat * .35 + Math.random() * .15;
                r.lA = rand(.15, .45);
                r.nextSwitch = t + lerp(.1, .03, heat) * rand(.7, 1.3);
            }

            const covering = t < c.cover;
            if (t < c.reveal) {
                ctx.fillStyle = '#fff';
                if (r.mode === 'intro' || !covering) {
                    ctx.fillRect(0, 0, W, H);
                } else {
                    ctx.save();
                    coverPath(r, t);
                    ctx.clip();
                    ctx.fillRect(0, 0, W, H);
                    ctx.restore();
                }
            }

            if (t < c.resolve + c.settle + .05) {
                ctx.save();
                if (covering) coverPath(r, t);
                else dissolvePath(r, t);
                ctx.clip();
                ctx.globalAlpha = r.nA;
                drawNoise(r);
                ctx.restore();
            }

            // 形が見えはじめたら、部品のマスからはノイズを消して白に戻す
            if (r.measured && t >= c.resolve && t < c.reveal) {
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#fff';
                ctx.fill(r.allCut);
            }

            // 導入の山場: 白黒が反転した画面が数回はさまる
            for (const ct of c.climax) {
                if (t < ct || t >= ct + .045) continue;
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#111';
                ctx.fillRect(0, 0, W, H);
                ctx.globalCompositeOperation = 'destination-out';
                drawNoise(r);
                drawNoise(r);
                ctx.globalCompositeOperation = 'source-over';
            }

            // 導入の途中で、できあがる画面の形が一瞬だけ見える
            if (r.measured) {
                for (const f of c.flashes) {
                    if (t < f || t >= f + .05) continue;
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = '#fff';
                    ctx.fill(r.allCut);
                    ctx.drawImage(lay, 0, 0, W, H);
                }
            }

            // 部品の形だけが残る。はじめの 0.3 秒はちらつきながら濃くなる
            if (r.measured && t >= c.resolve) {
                const on = t >= c.resolve + .3 || hash(Math.floor(t / .04)) > .4;
                ctx.globalAlpha = on ? 1 : r.lA;
                ctx.drawImage(lay, 0, 0, W, H);
            }

            for (const e of r.events) {
                if (t < e.t || t >= e.t + e.dur) continue;
                const x = e.c0 * cell, y = e.r0 * cell, w = e.w * cell, h = e.h * cell;
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y, w, h);
                ctx.clip();
                ctx.globalAlpha = 1;
                ctx.fillStyle = e.inv ? '#111' : '#fff';
                ctx.fillRect(x, y, w, h);
                if (e.inv) ctx.globalCompositeOperation = 'destination-out';
                drawNoise(r, e.dx);
                drawNoise(r, e.dx);
                ctx.restore();
            }

            // 部品を本物に切り替え、その部品の文字を消す
            if (r.measured && t >= c.reveal) {
                if (!r.revealed) {
                    r.revealed = true;
                    wrap.classList.add('is-fading');
                    r.onReveal(r.parts, false);
                }
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'destination-out';
                for (const p of r.parts) {
                    const rt = c.reveal + p.delay;
                    if (t >= rt) ctx.fill(p.cutA);
                    if (t >= rt + .07) ctx.fill(p.cutB);
                }
                ctx.globalCompositeOperation = 'source-over';
            }

            if (r.revealed && t >= r.end + .06) finish();
            else r.raf = requestAnimationFrame(frame);
        }

        function detach() {
            removeEventListener('resize', abort);
            removeEventListener('keydown', abort);
            removeEventListener('wheel', abort);
            wrap.removeEventListener('pointerdown', abort);
        }

        function finish() {
            const r = run;
            if (!r) return;
            cancelAnimationFrame(r.raf);
            run = null;
            detach();
            wrap.classList.remove('is-on', 'is-fading', 'is-skipped', 'is-move');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            r.done();
        }

        // スキップや画面サイズの変更: すぐに次の画面を出して、演出を薄く消す
        function abort() {
            const r = run;
            if (!r || r.aborted) return;
            r.aborted = true;
            cancelAnimationFrame(r.raf);
            detach();
            if (!r.swapped) {
                r.swapped = true;
                r.swap && r.swap();
            }
            if (!r.revealed) {
                r.revealed = true;
                if (!r.measured) assignDelays(r, partsOf(r.containers));
                r.onReveal(r.parts, true);
            }
            wrap.classList.add('is-fading', 'is-skipped');
            setTimeout(finish, 460);
        }

        function play(opts) {
            return new Promise((done) => {
                const r = {
                    ...opts, cfg: CFG[opts.mode], done,
                    swapped: false, measured: false, revealed: false, aborted: false,
                    parts: [], k: 0, ox: 0, oy: 0, nA: .6, lA: .3, nextSwitch: 0, raf: 0, t0: 0, end: 9,
                };
                run = r;
                wrap.classList.remove('is-fading', 'is-skipped');
                wrap.classList.add('is-on');
                wrap.classList.toggle('is-move', opts.mode === 'move');
                addEventListener('resize', abort);
                if (opts.mode === 'intro') {
                    addEventListener('keydown', abort);
                    addEventListener('wheel', abort, { passive: true });
                    wrap.addEventListener('pointerdown', abort);
                    // canvas に描く文字は Web フォントを待ってから(最大 0.9 秒)
                    const wait = document.fonts ? document.fonts.load('700 100px "Inter Tight"', 'WS').catch(() => {}) : null;
                    Promise.race([wait, new Promise((res) => setTimeout(res, 900))]).then(() => begin(r));
                } else {
                    begin(r);
                }
            });
        }

        $('[data-fx-skip]', wrap).addEventListener('click', abort);
        return { play };
    })();

    /* ----------------------------------------------------------------------
       画面の移動
       ---------------------------------------------------------------------- */
    const screens = $$('.screen').map((el) => ({ el, id: el.id, x: +el.dataset.x, y: +el.dataset.y, name: el.dataset.name }));
    const byId = (id) => screens.find((s) => s.id === id);
    const at = (x, y) => screens.find((s) => s.x === x && s.y === y);
    const DIRS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
    const ALIAS = { works: 'work-nagai', contact: 'sns' };
    const idFromHash = () => {
        const h = decodeURIComponent(location.hash.slice(1));
        return ALIAS[h] || h;
    };
    let cur = null, busy = false;

    // 小さな地図: 画面の並びをそのまま四角で描く
    const minimap = $('.minimap');
    const minX = Math.min(...screens.map((s) => s.x)), minY = Math.min(...screens.map((s) => s.y));
    minimap.style.gridTemplateColumns = `repeat(${Math.max(...screens.map((s) => s.x)) - minX + 1}, auto)`;
    screens.forEach((s) => {
        s.dot = document.createElement('span');
        s.dot.style.gridColumn = s.x - minX + 1;
        s.dot.style.gridRow = s.y - minY + 1;
        minimap.appendChild(s.dot);
    });

    const atTop = () => scrollY <= 1;
    const atBottom = () => scrollY + innerHeight >= document.documentElement.scrollHeight - 2;

    function updateChrome() {
        Object.entries(DIRS).forEach(([d, [dx, dy]]) => {
            const n = at(cur.x + dx, cur.y + dy);
            const b = $(`.compass-btn[data-dir="${d}"]`, compass);
            b.hidden = !n;
            if (!n) return;
            $('.compass-label', b).textContent = n.name;
            b.dataset.go = n.id;
            b.setAttribute('aria-label', `${n.name}へ`);
        });
        $$('.nav a', header).forEach((a) => {
            const on = a.dataset.go === cur.id || (a.dataset.nav === 'work' && cur.el.classList.contains('screen--work'));
            if (on) a.setAttribute('aria-current', 'true');
            else a.removeAttribute('aria-current');
        });
        screens.forEach((s) => s.dot.classList.toggle('is-current', s === cur));
    }

    function show(s) {
        screens.forEach((o) => o.el.classList.toggle('is-current', o === s));
        cur = s;
        scrollTo(0, 0);
        updateChrome();
        fitMark();
        header.classList.remove('is-scrolled');
    }

    function go(id, { push = true } = {}) {
        const next = byId(id);
        if (!next || busy || next === cur) return;
        let dx = Math.sign(next.x - cur.x), dy = Math.sign(next.y - cur.y);
        if (dx && dy) {
            if (Math.abs(next.x - cur.x) >= Math.abs(next.y - cur.y)) dy = 0;
            else dx = 0;
        }
        if (push) history.pushState(null, '', `#${id}`);
        if (RM) {
            show(next);
            return;
        }
        busy = true;
        next.el.classList.add('is-forming');
        fx.play({
            mode: 'move', dir: { x: dx, y: dy }, containers: [next.el],
            swap: () => show(next),
            onReveal: (parts, fast) => playIn(parts, [next.el], fast),
        }).then(() => {
            busy = false;
            // 移動中に戻る・進むが押されていたら、URL の画面に合わせる
            const want = wanted();
            if (want && want !== cur) go(want.id, { push: false });
        });
    }

    const move = (d) => {
        const [dx, dy] = DIRS[d];
        const n = at(cur.x + dx, cur.y + dy);
        if (n) go(n.id);
    };

    document.addEventListener('click', (e) => {
        const a = e.target.closest('[data-go]');
        if (!a || !root.classList.contains('is-world')) return;
        e.preventDefault();
        go(a.dataset.go);
    });

    // # が画面でないとき(本文へ移動のリンクなど)は、そのままにする
    const wanted = () => (idFromHash() ? byId(idFromHash()) : byId('top'));
    addEventListener('popstate', () => {
        const s = wanted();
        if (s) go(s.id, { push: false });
    });

    addEventListener('keydown', (e) => {
        if (busy || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.target.closest('input, textarea, select, [contenteditable], [role="tablist"]')) return;
        const d = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
        if (!d) return;
        // 上下は、画面の中でまだスクロールできるならスクロールを優先する
        if ((d === 'down' && !atBottom()) || (d === 'up' && !atTop())) return;
        const [dx, dy] = DIRS[d];
        if (!at(cur.x + dx, cur.y + dy)) return;
        e.preventDefault();
        move(d);
    });

    // ホイール: 横の動きで左右へ、縦は画面の端までスクロールしてからさらに回すと上下へ。
    // 慣性で続けて動かないよう、ホイールが止まるまで次を受け付けない
    (function wheel() {
        let accX = 0, accY = 0, locked = false, timer = 0;
        addEventListener('wheel', (e) => {
            if (e.ctrlKey) return;
            clearTimeout(timer);
            timer = setTimeout(() => { accX = accY = 0; locked = false; }, 240);
            // 導入や切り替えの最中に回したホイールの続き(慣性)では動かさない
            if (busy || root.classList.contains('is-intro')) locked = true;
            if (locked) return;
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                accX += e.deltaX;
                accY = 0;
            } else {
                const down = e.deltaY > 0;
                accY = (down && atBottom()) || (!down && atTop()) ? accY + e.deltaY : 0;
                accX = 0;
            }
            const d = accX > 90 ? 'right' : accX < -90 ? 'left' : accY > 90 ? 'down' : accY < -90 ? 'up' : null;
            if (!d) return;
            accX = accY = 0;
            locked = true;
            move(d);
        }, { passive: true });
    })();

    // スワイプ: 左右はそのまま、上下は画面の端にいるときだけ
    (function swipe() {
        let sx = 0, sy = 0, st = 0, top = false, bottom = false, on = false;
        addEventListener('touchstart', (e) => {
            on = e.touches.length === 1;
            if (!on) return;
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
            st = Date.now();
            top = atTop();
            bottom = atBottom();
        }, { passive: true });
        addEventListener('touchend', (e) => {
            if (!on || busy || Date.now() - st > 700) return;
            on = false;
            const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 'right' : 'left');
            else if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx) * 1.4) {
                if (dy < 0 && bottom) move('down');
                else if (dy > 0 && top) move('up');
            }
        }, { passive: true });
    })();

    addEventListener('scroll', () => header.classList.toggle('is-scrolled', scrollY > 8), { passive: true });

    let resizeTimer = 0;
    addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            fitMark();
            field.build();
        }, 120);
    });
    // ロゴの Web フォントが届いて文字の幅が変わったら合わせ直す。
    // 読み込み完了の合図だけでは、まだ前の書体で測ってしまうことがあるため、見えない見本の幅を見張る
    if ('ResizeObserver' in window) {
        const sample = document.createElement('span');
        sample.setAttribute('aria-hidden', 'true');
        sample.textContent = markText;
        sample.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font:700 100px ${FONT}`;
        document.body.appendChild(sample);
        let last = 0;
        new ResizeObserver(() => {
            if (sample.offsetWidth === last) return;
            last = sample.offsetWidth;
            fitMark();
        }).observe(sample);
    }
    if (document.fonts) document.fonts.ready.then(fitMark);

    /* ----------------------------------------------------------------------
       作品: ギャラリーとバージョンの切り替え
       ---------------------------------------------------------------------- */
    const flicker = (el) => {
        el.classList.remove('is-switching');
        void el.offsetWidth;
        if (!RM) el.classList.add('is-switching');
    };

    $$('[data-gallery]').forEach((gallery) => {
        const media = $('.media', gallery);
        const img = $('.gallery-img', gallery);
        const caption = $('.gallery-caption', gallery);
        const thumbs = $$('.gallery-thumbs button', gallery);

        thumbs.forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('is-active')) return;
                thumbs.forEach((b) => {
                    const on = b === btn;
                    b.classList.toggle('is-active', on);
                    if (on) b.setAttribute('aria-current', 'true');
                    else b.removeAttribute('aria-current');
                });
                caption.textContent = btn.dataset.caption;
                // 読み込んでから差し替える。古い画像を背景に残して、新しい画像をちらつかせて重ねる
                const next = new Image();
                next.onload = next.onerror = () => {
                    media.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
                    img.src = btn.dataset.src;
                    img.alt = btn.dataset.alt;
                    flicker(media);
                };
                next.src = btn.dataset.src;
            });
        });

        // 大きな画像をクリックすると次の 1 枚へ
        media.addEventListener('click', () => {
            const i = thumbs.findIndex((b) => b.classList.contains('is-active'));
            thumbs[(i + 1) % thumbs.length].click();
        });
    });

    $$('[data-tabs]').forEach((list) => {
        const tabs = $$('[role="tab"]', list);
        const select = (tab, focus) => {
            tabs.forEach((t) => {
                const on = t === tab;
                t.setAttribute('aria-selected', on);
                t.tabIndex = on ? 0 : -1;
                const panel = document.getElementById(t.getAttribute('aria-controls'));
                panel.hidden = !on;
                if (on) flicker($('.media', panel));
            });
            if (focus) tab.focus();
        };
        tabs.forEach((tab) => tab.addEventListener('click', () => select(tab)));
        list.addEventListener('keydown', (e) => {
            const i = tabs.indexOf(document.activeElement);
            if (i < 0) return;
            const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            if (step) {
                e.preventDefault();
                select(tabs[(i + step + tabs.length) % tabs.length], true);
            } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                select(tabs[e.key === 'Home' ? 0 : tabs.length - 1], true);
            }
        });
    });

    /* ----------------------------------------------------------------------
       ボット: Bluesky の公開 API から最新の投稿を読む。読めなければ投稿の例のまま
       ---------------------------------------------------------------------- */
    (async function botFeed() {
        const box = $('[data-bot-feed]');
        if (!box || !window.fetch) return;
        const handle = 'nagai-kotoba-bot.bsky.social';
        try {
            const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=1&filter=posts_no_replies`);
            if (!res.ok) return;
            const data = await res.json();
            const post = data.feed && data.feed[0] && data.feed[0].post;
            const lines = post ? String(post.record.text || '').split('\n').filter(Boolean) : [];
            if (!lines.length) return;
            const when = new Date(post.record.createdAt || post.indexedAt);
            const min = Math.round((Date.now() - when) / 60000);
            const ago = min < 60 ? `${Math.max(min, 1)} 分前` : min < 60 * 24 ? `${Math.round(min / 60)} 時間前`
                : `${when.getFullYear()}年${when.getMonth() + 1}月${when.getDate()}日`;
            $('.post-head', box).textContent = 'Bluesky の最新の投稿';
            $('.post-word', box).textContent = lines[0];
            $('.post-yomi', box).textContent = lines.slice(1).join(' ');
            $('.post-meta', box).textContent = `長い言葉bot · ${ago}`;
            box.href = `https://bsky.app/profile/${handle}/post/${post.uri.split('/').pop()}`;
        } catch (err) {
            // 読めないときは投稿の例を出したままにする
        }
    })();

    /* ----------------------------------------------------------------------
       起動: URL の # の画面から始める。導入はその画面を W と S で形づくる
       ---------------------------------------------------------------------- */
    root.classList.add('is-world');
    const first = byId(idFromHash()) || byId('top');
    if (location.hash && byId(idFromHash()) && location.hash.slice(1) !== first.id) history.replaceState(null, '', `#${first.id}`);
    show(first);

    if (root.classList.contains('is-intro')) {
        window.__wsIntro = true;
        busy = true;
        const containers = [first.el, header, compass];
        containers.forEach((c) => c.classList.add('is-forming'));
        fx.play({
            mode: 'intro', containers,
            onReveal: (parts, fast) => {
                root.classList.remove('is-intro');
                playIn(parts, containers, fast);
            },
        }).then(() => { busy = false; });
    }
})();
