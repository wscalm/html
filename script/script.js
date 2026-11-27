/* ==========================================================================
   WSWS.WORKS
   トップのテレビが目次。チャンネルを選ぶと、その画面に入る。画面を移るときは
   小さな W と S が明滅して次の画面の形をつくり、本物に切り替わる。
   背景の薄い W と S はカーソルのほうを向く。
   ========================================================================== */
(() => {
    'use strict';

    const root = document.documentElement;
    const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const FONT = '"Inter Tight", "Inter", "Helvetica Neue", Arial, sans-serif'; // 導入や背景の小さな W と S
    const MARK_FONT = '"Unbounded", "Inter Tight", "Helvetica Neue", Arial, sans-serif'; // ロゴ WSWS.WORKS
    const MARK_WEIGHT = 700; // CSS の .hero-mark と同じ太さ

    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const inOutCubic = (t) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

    // Web フォントの CSS(あとから効かせている)が届くまで待つ。届かなくても、失敗したら先へ進む
    const fontsCss = new Promise((res) => {
        const l = document.getElementById('webfonts');
        if (!l || l.media === 'all') return res();
        l.addEventListener('load', () => setTimeout(res, 0), { once: true }); // onload で media が all になってから
        l.addEventListener('error', res, { once: true });
    });
    // 書体がそろったとき(CSS が届いて、使う書体の読み込みが終わったとき)
    const fontsReady = document.fonts ? fontsCss.then(() => document.fonts.ready) : fontsCss;

    const header = $('.site-header');
    const dock = $('.dock');

    // 音(script/sound.js)。読めなかったときは鳴らさない
    const sfx = window.wsSound || { play: () => () => {}, snow: () => {}, ready: () => Promise.resolve() };

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
        return { el };
    });

    // 表示されていない(トップ以外の画面にいる)ときは測れないので何もしない
    function fitMark() {
        if (!mark.getClientRects().length) return;
        mark.style.fontSize = '100px';
        const width = letters.reduce((sum, l) => sum + l.el.getBoundingClientRect().width, 0);
        const avail = mark.getBoundingClientRect().width;
        if (width > 0) mark.style.fontSize = `${((100 * avail) / width) * .995}px`;
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
       背景: 導入と同じ大きさの W と S を、導入と同じマス目にぎっしり敷く。
       どの文字もカーソルのほうを向き(W はくぼみが 2 つある側、S は書き始めのカーブの側)、
       カーソルのところはなだらかに盛り上がり(文字が少し大きく濃くなる)、動かすと、通ったあとから
       ゆるい波がひとつずつ広がって、すぐに収まる。
       数千文字を毎フレーム回すので WebGL で描く。使えないときは、向きの変わらない文字を一度だけ描く
       ---------------------------------------------------------------------- */
    const cellSize = () => clamp(Math.round(Math.min(innerWidth, innerHeight) / 70), 8, 13);

    const field = (() => {
        const cvs = $('.field');
        const BASE = .045; // ふだんの濃さ
        const NEAR = .12; // 山頂で足す濃さ
        const RIPS = 8; // 同時に広がる波の数
        const QN = 64; // 丘と波を止める四角(行ごと)の数の上限(data-quiet)
        const T0 = performance.now();
        // 毎回全面を描き直すので、描いた内容は保たない(保つと、コマごとに余分な写しが走る)
        const gl = cvs.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });

        // WebGL が使えないときは、向きの変わらない文字を一度だけ描く
        function flat() {
            const c = cvs.cloneNode();
            cvs.replaceWith(c);
            const ctx = c.getContext('2d');
            const build = () => {
                const W = innerWidth, H = innerHeight, cell = cellSize();
                c.width = Math.round(W * DPR);
                c.height = Math.round(H * DPR);
                ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
                ctx.fillStyle = `rgba(17,17,17,${BASE})`;
                ctx.font = `600 ${cell * .8}px ${FONT}`;
                ctx.textAlign = 'center';
                for (let y = .5; y * cell < H + cell; y++) {
                    for (let x = .5; x * cell < W + cell; x++) ctx.fillText((x + y - 1) % 2 ? 'S' : 'W', x * cell, y * cell + cell * .29);
                }
            };
            build();
            fontsReady.then(build);
            return { build };
        }

        const VS = `
            attribute vec2 a_pos;
            attribute vec3 a_cor;
            uniform vec2 u_res, u_mouse;
            uniform float u_aim, u_lift, u_half, u_r, u_time, u_cell;
            uniform vec4 u_rip[${RIPS}];
            uniform vec4 u_q[${QN}];
            uniform float u_qn;
            varying vec2 v_uv;
            varying float v_a;
            void main() {
                // 文字の行(静かにする四角)の下でも W と S は途切れさせない(白い板のように抜くと、そこだけ浮く)。
                // 代わりに丘と波を止めて、いつもの薄さのまま動かさない。文字との境は CSS の白いふちで分ける
                float sdm = 1e5;
                for (int i = 0; i < ${QN}; i++) {
                    if (float(i) >= u_qn) break;
                    vec4 b = u_q[i];
                    vec2 e = abs(a_pos - (b.xy + b.zw) * 0.5) - (b.zw - b.xy) * 0.5;
                    sdm = min(sdm, length(max(e, 0.0)) + min(max(e.x, e.y), 0.0));
                }
                // 丘と波は、行の 3 マスほど手前からなだらかに収める(濃く大きくなった文字が行にかからないように)
                float qz = 1.0 - smoothstep(0.0, u_cell * 3.0, sdm);
                vec2 d = a_pos - u_mouse;
                // なだらかな丘(0〜1)。カーソルの真下がいちばん高い
                float h = exp(-dot(d, d) / (u_r * u_r)) * u_lift * (1.0 - qz);
                // 波: 山がひとつだけの、ゆるい輪が外へ広がって消える
                float w = 0.0;
                vec2 push = vec2(0.0);
                for (int i = 0; i < ${RIPS}; i++) {
                    vec4 r = u_rip[i];
                    float age = u_time - r.z;
                    if (r.w <= 0.0 || age < 0.0 || age > 1.8) continue;
                    vec2 e = a_pos - r.xy;
                    float dist = length(e);
                    float x = dist - age * 360.0;
                    float wi = r.w * exp(-x * x / 2600.0) * exp(-age * 2.4) * smoothstep(0.0, 40.0, dist);
                    w += wi;
                    push += e / max(dist, 0.001) * wi;
                }
                w = min(w, 1.0) * (1.0 - qz);
                vec2 p = a_pos + d * h * 0.08 + push * 3.0 * (1.0 - qz);
                vec2 to = u_mouse - p;
                vec2 dir = normalize(mix(vec2(0.0, -1.0), to / max(length(to), 0.001), u_aim) + vec2(0.0, -0.0001));
                vec2 c = a_cor.xy * u_half * (1.0 + 0.2 * h + 0.18 * w);
                vec2 q = p + vec2(-dir.y * c.x - dir.x * c.y, dir.x * c.x - dir.y * c.y);
                gl_Position = vec4(q.x / u_res.x * 2.0 - 1.0, 1.0 - q.y / u_res.y * 2.0, 0.0, 1.0);
                v_uv = vec2((a_cor.z + a_cor.x * 0.5 + 0.5) * 0.5, a_cor.y * 0.5 + 0.5);
                v_a = clamp(${BASE.toFixed(3)} + ${NEAR.toFixed(3)} * h + 0.07 * w, 0.0, 1.0) * (1.0 - 0.25 * qz);
            }`;
        const FS = `
            precision mediump float;
            uniform sampler2D u_tex;
            varying vec2 v_uv;
            varying float v_a;
            void main() {
                float a = texture2D(u_tex, v_uv).a * v_a;
                gl_FragColor = vec4(vec3(0.0667) * a, a);
            }`;

        let prog, buf, tex, U = {}, count = 0, W = 0, H = 0, raf = 0, last = 0, alive = 0, ri = 0, qn = 0, paused = false;
        const rip = new Float32Array(RIPS * 4), qbuf = new Float32Array(QN * 4);
        const st = { seen: false, mx: 0, my: 0, tx: 0, ty: 0, aim: 0, aimT: 0, lift: 0, liftT: 0, lx: 0, ly: 0, acc: 0, lastEmit: 0 };

        // カーソルのない端末(スマホなど)では、見えないカーソルが画面の中をゆっくりさまよって、
        // 丘と波をひとりでに立てる。指で触っている間は指に従い、離して少したつと、その場からまたさまよう。
        // 電池のため、さまよっている間は 30 コマ/秒で描き、画面に入ったり触ったりしてから WANDER ミリ秒で休む
        const AUTO = !RM && matchMedia('(hover: none)').matches;
        const WANDER = 15000;
        const wander = { on: false, x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0, nextGoal: 0, nextRip: 0, resume: 0, until: 0 };
        function wanderStep(now, dt) {
            const w = wander;
            if (!w.on) {
                w.on = true;
                w.x = st.seen ? st.mx : innerWidth * (.3 + Math.random() * .4);
                w.y = st.seen ? st.my : innerHeight * (.3 + Math.random() * .4);
                w.vx = w.vy = 0;
                w.nextGoal = 0;
                w.nextRip = now + 800 + Math.random() * 1200;
                if (!st.seen) {
                    st.seen = true;
                    st.mx = st.tx = w.x;
                    st.my = st.ty = w.y;
                }
            }
            // ときどき行き先を変え、そちらへゆるく舵を切る(まっすぐ行かず、弧を描く)
            if (now > w.nextGoal || Math.hypot(w.gx - w.x, w.gy - w.y) < 40) {
                w.gx = innerWidth * (.1 + Math.random() * .8);
                w.gy = innerHeight * (.1 + Math.random() * .8);
                w.nextGoal = now + 4000 + Math.random() * 4000;
            }
            const dx = w.gx - w.x, dy = w.gy - w.y, dist = Math.hypot(dx, dy) || 1;
            const SPEED = 70; // px/秒
            w.vx += ((dx / dist) * SPEED - w.vx) * Math.min(1, dt * .8);
            w.vy += ((dy / dist) * SPEED - w.vy) * Math.min(1, dt * .8);
            w.x += w.vx * dt;
            w.y += w.vy * dt;
            st.tx = w.x;
            st.ty = w.y;
            st.aimT = 1;
            st.liftT = .85;
            if (now > w.nextRip) {
                emit(w.x, w.y, .16 + Math.random() * .16);
                w.nextRip = now + 1400 + Math.random() * 2200;
            }
        }

        function init() {
            const sh = (type, src) => {
                const s = gl.createShader(type);
                gl.shaderSource(s, src);
                gl.compileShader(s);
                return s;
            };
            prog = gl.createProgram();
            gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
            gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
            gl.useProgram(prog);
            ['u_res', 'u_mouse', 'u_aim', 'u_lift', 'u_half', 'u_r', 'u_time', 'u_rip', 'u_tex', 'u_q', 'u_qn', 'u_cell'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
            buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            const aPos = gl.getAttribLocation(prog, 'a_pos'), aCor = gl.getAttribLocation(prog, 'a_cor');
            gl.enableVertexAttribArray(aPos);
            gl.enableVertexAttribArray(aCor);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 20, 0);
            gl.vertexAttribPointer(aCor, 3, gl.FLOAT, false, 20, 8);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            tex = gl.createTexture();
            return true;
        }

        // W と S を白で 1 枚の画像に描き、文字の形(透明度)だけを使う。
        // 小さな文字がぼやけないよう、画面に出る大きさ(1 マス × 画素密度)ちょうどで描く
        let tile = 0;
        function atlas() {
            const T = tile, c = document.createElement('canvas');
            c.width = T * 2;
            c.height = T;
            const g = c.getContext('2d'), fs = T * .8;
            g.font = `600 ${fs}px ${FONT}`;
            g.textAlign = 'center';
            g.textBaseline = 'alphabetic';
            g.fillStyle = '#fff';
            g.fillText('W', T / 2, T / 2 + fs * .36);
            g.fillText('S', T * 1.5, T / 2 + fs * .36);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }

        // 1 文字を 2 つの三角形で。マス目は導入と同じ(端は波で動いても欠けないよう 1 マス外まで)。
        // スマホでツールバーが出入りして高さだけ変わったときは、マス目は作り直さず、canvas の大きさだけ合わせる
        // (マス目は画面の高さぶん余分に作っておく)
        let gridW = 0, gridH = 0, gridCell = 0;
        function build() {
            const cell = cellSize();
            if (prog && innerWidth === gridW && cell === gridCell && innerHeight <= gridH) {
                if (innerHeight === H) return;
                H = innerHeight;
                cvs.height = Math.round(H * DPR);
                gl.viewport(0, 0, cvs.width, cvs.height);
                draw();
                return;
            }
            W = innerWidth;
            H = innerHeight;
            cvs.width = Math.round(W * DPR);
            cvs.height = Math.round(H * DPR);
            gl.viewport(0, 0, cvs.width, cvs.height);
            tile = Math.ceil(cell * DPR);
            atlas();
            gridW = W;
            gridCell = cell;
            gridH = AUTO || matchMedia('(hover: none)').matches ? Math.max(H, window.screen.height || 0) : H;
            const cols = Math.ceil(W / cell) + 2, rows = Math.ceil(gridH / cell) + 2;
            const CORNERS = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
            const data = new Float32Array(cols * rows * 30);
            let o = 0;
            for (let r = 0; r < rows; r++) {
                for (let col = 0; col < cols; col++) {
                    const x = (col - .5) * cell, y = (r - .5) * cell, ch = (r + col) % 2; // 市松に互い違い(斜めには同じ文字が並ぶ)
                    for (let k = 0; k < 12; k += 2) {
                        data[o++] = x;
                        data[o++] = y;
                        data[o++] = CORNERS[k];
                        data[o++] = CORNERS[k + 1];
                        data[o++] = ch;
                    }
                }
            }
            count = cols * rows * 6;
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            gl.uniform1f(U.u_half, cell / 2);
            gl.uniform1f(U.u_cell, cell);
            gl.uniform1f(U.u_r, clamp(Math.min(W, H) * .26, 120, 220)); // 丘の広さ
            draw();
        }

        function draw() {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform2f(U.u_res, W, H);
            gl.uniform2f(U.u_mouse, st.mx, st.my);
            gl.uniform1f(U.u_aim, st.aim);
            gl.uniform1f(U.u_lift, st.lift);
            gl.uniform1f(U.u_time, (performance.now() - T0) / 1000);
            gl.uniform4fv(U.u_rip, rip);
            gl.uniform4fv(U.u_q, qbuf);
            gl.uniform1f(U.u_qn, qn);
            gl.uniform1i(U.u_tex, 0);
            gl.drawArrays(gl.TRIANGLES, 0, count);
        }

        function frame(now) {
            // 演出が画面を覆っている間は描かない(終わったら kick で再開する)
            if (paused) {
                raf = 0;
                return;
            }
            const wandering = AUTO && now > wander.resume && now < wander.until;
            if (wandering && now - last < 30) {
                raf = requestAnimationFrame(frame);
                return;
            }
            const dt = Math.min(.05, (now - last) / 1000 || .016);
            last = now;
            if (wandering) wanderStep(now, dt);
            else if (wander.on) { // さまようのを休む: 丘を下げて、落ち着いたら止まる
                wander.on = false;
                st.liftT = 0;
            }
            // 丘はカーソルに少し遅れてなめらかについてくる
            const k = RM ? 1 : 1 - Math.exp(-dt * 10);
            st.mx += (st.tx - st.mx) * k;
            st.my += (st.ty - st.my) * k;
            st.aim += (st.aimT - st.aim) * (RM ? 1 : 1 - Math.exp(-dt * 6));
            st.lift += (st.liftT - st.lift) * (RM ? 1 : 1 - Math.exp(-dt * 4));
            draw();
            const settled = Math.abs(st.tx - st.mx) < .2 && Math.abs(st.ty - st.my) < .2
                && Math.abs(st.aimT - st.aim) < .002 && Math.abs(st.liftT - st.lift) < .002;
            raf = settled && now > alive && !wandering ? 0 : requestAnimationFrame(frame);
        }

        const kick = () => {
            if (raf) return;
            last = performance.now();
            raf = requestAnimationFrame(frame);
        };

        function emit(x, y, s) {
            const now = performance.now();
            rip.set([x, y, (now - T0) / 1000, s], ri * 4);
            ri = (ri + 1) % RIPS;
            alive = now + 1900;
        }

        // 動かした距離がたまるごとに、速さに応じた強さの波をひとつ出す(ゆっくりなら弱く、止まれば出ない)
        function point(e) {
            const x = e.clientX, y = e.clientY, now = performance.now();
            if (AUTO) {
                wander.on = false;
                wander.resume = Infinity; // 指を離すまで、さまよわない
            }
            if (!st.seen) {
                st.seen = true;
                st.mx = st.lx = x;
                st.my = st.ly = y;
                st.lastEmit = now;
            }
            st.acc += Math.hypot(x - st.lx, y - st.ly);
            st.lx = st.tx = x;
            st.ly = st.ty = y;
            st.aimT = 1;
            st.liftT = 1;
            if (!RM && st.acc > 80) {
                const speed = (st.acc / Math.max(16, now - st.lastEmit)) * 1000;
                emit(x, y, clamp(speed / 2400, .12, .5));
                st.acc = 0;
                st.lastEmit = now;
            }
            kick();
        }

        // 丘を下げる(向きはそのまま)
        const lower = () => {
            st.liftT = 0;
            kick();
        };

        // 静かにする四角を測り直す。els は文字のまとまり(見出し・本文・メニューなど)。
        // まとまりの外枠ではなく、行ごと(画像やアイコンはその形)に測る。行のない余白では丘も波も立つ
        const lineRects = (el) => {
            const out = [];
            const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
                acceptNode: (n) => {
                    if (n.nodeType === 3) return n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                    if (n.closest('.sr-only, [hidden]')) return NodeFilter.FILTER_REJECT;
                    return /^(IMG|SVG|CANVAS|svg)$/.test(n.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                },
            });
            const range = document.createRange();
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                if (n.nodeType === 3) {
                    range.selectNodeContents(n);
                    out.push(...range.getClientRects());
                } else out.push(n.getBoundingClientRect());
            }
            return out.filter((r) => r.width && r.height);
        };
        // 同じ行で近いものはひとつにまとめる
        const mergeRects = (rs, gap) => {
            const out = [];
            for (const r of [...rs].sort((a, b) => a.top - b.top || a.left - b.left)) {
                const m = out.find((o) => Math.min(o.b, r.bottom) - Math.max(o.t, r.top) > Math.min(o.b - o.t, r.height) * .5
                    && r.left - o.r < gap && o.l - r.right < gap);
                if (m) {
                    m.l = Math.min(m.l, r.left);
                    m.t = Math.min(m.t, r.top);
                    m.r = Math.max(m.r, r.right);
                    m.b = Math.max(m.b, r.bottom);
                } else out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
            }
            return out;
        };
        // 測った行の四角は、ページの座標でとっておく(ヘッダーともどるボタンは画面に固定なので、画面の座標のまま)。
        // スクロールでは測り直さず、ずらして選び直すだけにする
        let quietEls = () => [];
        let groups = [];
        function quiet(fn) {
            if (fn) quietEls = fn;
            if (!gl) return;
            const cell = cellSize(), sx = scrollX, sy = scrollY;
            groups = quietEls().filter((el) => el && el.getClientRects().length).map((el) => {
                const fixed = !!el.closest('.site-header, .dock');
                const rs = mergeRects(lineRects(el), cell * 1.5);
                if (!fixed) rs.forEach((o) => { o.l += sx; o.r += sx; o.t += sy; o.b += sy; });
                return { fixed, rs };
            });
            place();
        }
        // いま見えている所の四角を選んで、シェーダーに渡す
        function place() {
            if (!gl) return;
            const cell = cellSize(), px = cell * .7, py = cell * .4, sx = scrollX, sy = scrollY;
            const vis = groups.map(({ fixed, rs }) => {
                const dx = fixed ? 0 : sx, dy = fixed ? 0 : sy;
                return rs.filter((o) => o.b - dy > -60 && o.t - dy < innerHeight + 60)
                    .map((o) => ({ l: o.l - dx, t: o.t - dy, r: o.r - dx, b: o.b - dy }));
            }).filter((g) => g.length);
            // 数が上限を超えるときは、大きいまとまりから外枠ひとつにまとめる
            let total = vis.reduce((n, g) => n + g.length, 0);
            const order = vis.map((g, i) => i).sort((a, b) => vis[b].length - vis[a].length);
            for (const i of order) {
                if (total <= QN) break;
                const g = vis[i];
                if (g.length < 2) continue;
                total -= g.length - 1;
                vis[i] = [g.reduce((a, o) => ({ l: Math.min(a.l, o.l), t: Math.min(a.t, o.t), r: Math.max(a.r, o.r), b: Math.max(a.b, o.b) }))];
            }
            qn = 0;
            qbuf.fill(0);
            for (const o of vis.flat()) {
                if (qn >= QN) break;
                qbuf.set([o.l - px, o.t - py, o.r + px, o.b + py], qn * 4);
                qn++;
            }
            if (prog) kick();
        }

        // 演出が画面を覆っている間は止める
        function pause(on) {
            paused = on;
            if (!on && prog) kick();
        }
        // 画面に入ったときなど: さまよう端末では、しばらくまたさまよう
        function wake() {
            if (!AUTO) return;
            wander.until = performance.now() + WANDER;
            kick();
        }

        if (!gl || !init()) return { ...flat(), quiet() {}, place() {}, pause() {}, wake() {} };
        addEventListener('pointermove', point, { passive: true });
        addEventListener('pointerdown', point, { passive: true });
        // ウィンドウの外へ出たとき、指を離したとき(タッチにはカーソルが残らないため)は丘を下げる
        document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) lower(); });
        // さまよう端末では、指を離して少したったら、その場からまたさまよう
        const release = () => {
            if (AUTO) {
                wander.resume = performance.now() + 1800;
                wander.until = wander.resume + WANDER;
            }
            lower();
        };
        addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') release(); }, { passive: true });
        addEventListener('pointercancel', release, { passive: true });
        cvs.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            cancelAnimationFrame(raf);
            raf = 0;
        });
        cvs.addEventListener('webglcontextrestored', () => {
            init();
            gridW = 0;
            build();
        });

        build();
        wake();
        if (document.fonts) {
            fontsCss.then(() => document.fonts.load(`600 52px "Inter Tight"`, 'WS')).then(() => {
                atlas();
                draw();
            }, () => {});
        }
        return { build, quiet, place, pause, wake };
    })();

    /* ----------------------------------------------------------------------
       部品: data-part を付けた要素。切り替えのとき、W と S でこの形をなぞる
       text は行ごとの帯、links は中のリンクごとの帯、box は四角、glyph はロゴの文字
       ---------------------------------------------------------------------- */
    const ALPHA = { text: .78, links: .85, box: .3, glyph: 1 };
    const bar = (g, r, k) => g.fillRect(r.left, r.top + (r.height * (1 - k)) / 2, r.width, r.height * k);

    function maskOf(el, kind) {
        if (kind === 'glyph') {
            return (g) => {
                const x = el.getBoundingClientRect().left, y = markBaseline();
                g.font = `${MARK_WEIGHT} ${parseFloat(getComputedStyle(mark).fontSize)}px ${MARK_FONT}`;
                g.textAlign = 'left';
                g.textBaseline = 'alphabetic';
                g.fillText(el.textContent, x, y);
                // 小さいときにマス目で途切れないよう、線の幅を少しだけ足す
                g.lineWidth = cellSize() * .3;
                g.lineJoin = 'round';
                g.strokeStyle = '#000';
                g.strokeText(el.textContent, x, y);
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
        return max;
    }

    // 部品に出る順の遅れを割り当てる。ロゴの文字は少し遅れて 1 文字ずつ(gbase から gstep 秒ずつ)。
    // fast はスキップしたときの短い遅れ
    function stagger(parts, step, gbase = .08, gstep = .025) {
        let i = 0, gi = 0;
        parts.forEach((p) => {
            if (p.kind === 'glyph') {
                p.delay = gbase + gi * gstep;
                p.fast = .08 + gi * .025;
                gi++;
            } else {
                p.delay = i * step;
                p.fast = i * .035;
                i++;
            }
        });
        return parts;
    }

    /* ----------------------------------------------------------------------
       導入の締め(トップから始まるとき):
       W と S のノイズが大きな W ひとつの形になる → 本物の W に切り替わる →
       シュッと 3 つに分かれて WSWS.WORKS の 3 つの W に収まる →
       残りの文字が、近い W から外側へ、横から切り出すように一瞬で現れる
       ---------------------------------------------------------------------- */
    const W_AT = [0, 2, 5]; // WSWS.WORKS の 3 つの W
    let hold = null;

    // 3 つの W を画面の真ん中に重ねて大きくしたときの位置と倍率。
    // 文字の箱ではなく、W の字面の中心が画面の中心に来るようにする
    function measureHold() {
        fitMark();
        const fs = parseFloat(getComputedStyle(mark).fontSize);
        const base = markBaseline();
        const g = document.createElement('canvas').getContext('2d');
        g.font = `${MARK_WEIGHT} ${fs}px ${MARK_FONT}`;
        const m = g.measureText('W');
        const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight || fs;
        const capH = m.actualBoundingBoxAscent || fs * .7;
        const S = Math.min((innerWidth * .62) / inkW, (innerHeight * .44) / capH);
        const items = W_AT.map((i) => {
            const el = letters[i].el, r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const gx = r.left + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, gy = base - capH / 2;
            return { el, left: r.left, cx, cy, dx: innerWidth / 2 - cx - S * (gx - cx), dy: innerHeight / 2 - cy - S * (gy - cy) };
        });
        hold = { S, fs, base, items };
        return hold;
    }

    // 大きな W の形(導入で W と S がなぞる)。3 つとも同じ所に重なるので 1 つ描けばよい
    function holdMask(g) {
        const h = measureHold(), it = h.items[0];
        g.save();
        g.translate(it.cx + it.dx, it.cy + it.dy);
        g.scale(h.S, h.S);
        g.translate(-it.cx, -it.cy);
        g.font = `${MARK_WEIGHT} ${h.fs}px ${MARK_FONT}`;
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        g.fillText('W', it.left, h.base);
        g.lineWidth = (cellSize() * .2) / h.S;
        g.lineJoin = 'round';
        g.strokeStyle = '#000';
        g.strokeText('W', it.left, h.base);
        g.restore();
    }

    function wordIn() {
        const h = measureHold(); // 最新の位置で(導入の間にレイアウトが変わっていても合うように)
        const anims = [], ghosts = [];
        const add = (el, kf, opt) => anims.push(el.animate(kf, { fill: 'both', ...opt }));
        const STEP = 'steps(1, end)'; // 途中を補間せず、パッパッと切り替える
        const SPLIT = 800, DUR = 520, EASE = 'cubic-bezier(.75, 0, .15, 1)'; // 大きな W を見せてから、溜めて、一気に飛んで、ピタッと止まる(速すぎると見逃すので、ゆっくりめ)
        const tf = (x, y, s, k, a) => `translate(${x}px, ${y}px) scale(${s}) scaleX(${k}) skewX(${a}deg)`;
        mark.classList.add('is-sequence');

        h.items.forEach(({ el, dx, dy }) => {
            const at = tf(dx, dy, h.S, 1, 0);
            // ① 画面の真ん中で、大きな W がちらついて本物になる(3 つが重なっている)
            add(el, [
                { transform: at, opacity: 0, easing: STEP }, { transform: at, opacity: 1, offset: .3, easing: STEP },
                { transform: at, opacity: .15, offset: .55, easing: STEP }, { transform: at, opacity: 1 },
            ], { duration: 300 });
            // ② シュッと分かれる。飛んでいる間だけ横に伸びて傾き、残像を引く
            const dir = Math.sign(-dx) || 1;
            const split = [
                { transform: at },
                { transform: tf(dx * .45, dy * .45, 1 + (h.S - 1) * .3, 1.6, -14 * dir), offset: .45 },
                { transform: tf(0, 0, 1, 1, 0) },
            ];
            add(el, split, { duration: DUR, delay: SPLIT, easing: EASE, fill: 'forwards' });
            [[36, .2], [72, .08]].forEach(([lag, op]) => {
                const g = el.cloneNode(true);
                g.className = 'ch ghost';
                g.removeAttribute('data-part');
                g.style.left = `${el.offsetLeft}px`;
                g.style.top = `${el.offsetTop}px`;
                mark.appendChild(g);
                ghosts.push(g);
                add(g, split.map((k, n) => ({ ...k, opacity: n === 2 ? 0 : op })), { duration: DUR, delay: SPLIT + lag, easing: EASE, fill: 'forwards' });
            });
        });

        // ③ 残りの文字。近い W から外側へ順に、横から切り出す
        let last = 0;
        const side = (i) => (i / (letters.length - 1)) * 2 - 1; // 音の左右
        const cuts = [];
        letters.forEach(({ el }, i) => {
            if (W_AT.includes(i)) return;
            const near = W_AT.reduce((b, j) => (Math.abs(j - i) < Math.abs(b - i) ? j : b), 0);
            const dir = Math.sign(i - near);
            const delay = SPLIT + DUR - 80 + (Math.abs(i - near) - 1) * 120;
            last = Math.max(last, delay + 320);
            cuts.push([delay / 1000, side(i)]);
            add(el, [
                { clipPath: dir > 0 ? 'inset(-30% 100% -30% 0)' : 'inset(-30% 0 -30% 100%)', transform: `translateX(${-14 * dir}px)`, opacity: 1 },
                { clipPath: 'inset(-30% 0 -30% 0)', transform: 'translateX(0px)', opacity: 1 },
            ], { duration: 320, delay, easing: 'cubic-bezier(.2, .9, .1, 1)' });
        });

        const hush = sfx.play('introWord', { split: SPLIT / 1000, dur: DUR / 1000, ws: W_AT.map(side), letters: cuts });

        // 途中で画面の大きさが変わったら、位置がずれるので最後の形まで飛ばす
        const jump = () => {
            hush(.05);
            anims.forEach((a) => a.finish());
        };
        addEventListener('resize', jump);
        const stop = () => {
            removeEventListener('resize', jump);
            anims.forEach((a) => a.cancel());
            ghosts.forEach((g) => g.remove());
            mark.classList.remove('is-sequence');
            hold = null;
        };
        return { total: last, stop };
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
            // 導入のノイズは、形ができるまでを短めに(以前の 0.8 倍)。グリッチは後半ほど多く大きくして、盛り上げる
            intro: {
                cover: .8, swap: 0, resolve: 2.32, settle: .56, reveal: 3.2,
                step: .06, gbase: .25, gstep: .045, events: 120, evFrom: .16,
                flashes: [1.39, 1.78],
            },
            // トップから始まるとき: 画面の形ではなく、大きな W ひとつの形をつくる
            introW: {
                cover: .8, swap: 0, resolve: 2.0, settle: .48, reveal: 2.64,
                step: .06, gbase: .25, gstep: .045, events: 110, evFrom: .16,
                flashes: [1.16, 1.52],
            },
            move: {
                cover: .3, swap: .3, resolve: .52, settle: .3, reveal: .86,
                step: .035, gbase: .1, gstep: .028, events: 4, evFrom: .05,
                flashes: [],
            },
        };
        const lay = document.createElement('canvas');
        // 演出の絵はどれも粗い W と S と四角なので、画素密度は 1.5 までにする(メモリと描く手間を抑える)
        const FDPR = Math.min(DPR, 1.5);
        let W = 0, H = 0, cell = 12, cols = 0, rows = 0, noise = [], noiseKey = '';
        let run = null;

        const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

        // 大きさが変わったときだけ確保し直す(同じなら消すだけ)
        function prepare(c, w, h, dpr) {
            const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
            if (c.width !== pw || c.height !== ph) {
                c.width = pw;
                c.height = ph;
            }
            const g = c.getContext('2d');
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalAlpha = 1;
            g.clearRect(0, 0, pw, ph);
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            return g;
        }

        // 1 マスに W か S を 1 文字。W と S を 1 度だけ描いた見本から写す(fillText を何千回も呼ばない)
        function fillCells(g, list, dpr, weight, size) {
            const bw = cell + 2 * Math.ceil(cell * .2), bh = bw, fs = cell * size; // マスより少し広い枠(左右の余りは整数にして、写すときにぼけないように)
            const a = document.createElement('canvas');
            a.width = Math.ceil(bw * 2 * dpr);
            a.height = Math.ceil(bh * dpr);
            const ag = a.getContext('2d');
            ag.setTransform(dpr, 0, 0, dpr, 0, 0);
            ag.font = `${weight} ${fs}px ${FONT}`;
            ag.textAlign = 'center';
            ag.textBaseline = 'alphabetic';
            ag.fillStyle = '#111';
            ag.fillText('W', bw / 2, bh / 2 + cell * .29);
            ag.fillText('S', bw * 1.5, bh / 2 + cell * .29);
            const sw = bw * dpr, sh = bh * dpr;
            for (const [col, row, al] of list) {
                g.globalAlpha = al;
                g.drawImage(a, Math.random() < .5 ? 0 : sw, 0, sw, sh, (col + .5) * cell - bw / 2, (row + .5) * cell - bh / 2, bw, bh);
            }
            g.globalAlpha = 1;
        }

        function sizeUp() {
            W = innerWidth;
            H = innerHeight;
            prepare(cvs, W, H, FDPR);
            cell = cellSize();
            cols = Math.ceil(W / cell);
            rows = Math.ceil(H / cell);
            const key = `${W}x${H}`;
            if (key === noiseKey) return;
            noiseKey = key;
            noise = [0, 1].map((i) => {
                const c = noise[i] || document.createElement('canvas');
                const g = prepare(c, (cols + M * 2) * cell, (rows + M * 2) * cell, FDPR);
                const list = [];
                for (let r = 0; r < rows + M * 2; r++) {
                    for (let col = 0; col < cols + M * 2; col++) {
                        if (Math.random() < .78) list.push([col, r, LV[(Math.random() ** 1.6 * LV.length) | 0]]);
                    }
                }
                fillCells(g, list, FDPR, 600, .8);
                return c;
            });
        }

        function assignDelays(r, parts) {
            r.parts = stagger(parts, r.cfg.step, r.cfg.gbase, r.cfg.gstep);
            r.end = r.cfg.reveal + parts.reduce((m, p) => Math.max(m, p.delay), 0) + .16;
        }

        // 次の画面の部品の位置を測り、どのマスがどの部品の形に入るかを決めて、文字でなぞった層を描く
        function measure(r) {
            r.measured = true;
            fitMark();
            const parts = r.shape ? r.shape() : partsOf(r.containers);
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
            // 毎コマ塗る形なので、四角の数を減らす: allCut は横に続くマスをひとつに、cutA・cutB は同じ組が続く所をひとつに
            r.allCut = new Path2D();
            parts.forEach((p) => { p.cutA = new Path2D(); p.cutB = new Path2D(); });
            const list = [];
            for (let row = 0; row < rows; row++) {
                let run0 = -1, seg0 = -1, segP = null, segAB = 0;
                const flush = (end) => {
                    if (segP) (segAB ? segP.cutA : segP.cutB).rect(seg0 * cell - .5, row * cell - .5, (end - seg0) * cell + 1, cell + 1);
                    segP = null;
                };
                for (let col = 0; col <= cols; col++) {
                    const pi = col < cols ? reg[row * cols + col] : -1;
                    if (pi < 0) {
                        if (run0 >= 0) r.allCut.rect(run0 * cell - .5, row * cell - .5, (col - run0) * cell + 1, cell + 1);
                        run0 = -1;
                        flush(col);
                        continue;
                    }
                    if (run0 < 0) run0 = col;
                    const p = parts[pi], ab = Math.random() < .5 ? 1 : 0;
                    if (p !== segP || ab !== segAB) {
                        flush(col);
                        segP = p;
                        segAB = ab;
                        seg0 = col;
                    }
                    list.push([col, row, p.alpha]);
                }
            }
            fillCells(prepare(lay, W, H, FDPR), list, FDPR, 800, .88);
        }

        function begin(r) {
            if (run !== r || r.aborted) return;
            sizeUp();
            const c = r.cfg;
            r.jitR = Array.from({ length: rows }, () => rand(-3, 3));
            r.jitC = Array.from({ length: cols }, () => rand(-3, 3));
            // 消える順: 導入は中心から外へ、押して入るときは押した所から外へ、前後へは進んできた側から
            const o = r.origin;
            r.far = o ? Math.max(Math.hypot(o.x, o.y), Math.hypot(W - o.x, o.y), Math.hypot(o.x, H - o.y), Math.hypot(W - o.x, H - o.y)) : 0;
            const bias = (x, y) => {
                if (!r.dir && o) return Math.min(1, Math.hypot(x * W - o.x, y * H - o.y) / r.far);
                if (!r.dir) return Math.min(1, Math.hypot(x - .5, y - .5) / .71);
                if (r.dir.x) return r.dir.x > 0 ? 1 - x : x;
                return r.dir.y > 0 ? 1 - y : y;
            };
            r.segOff = Array.from({ length: rows }, (_, row) => Array.from({ length: SEG }, (__, s) => (
                c.resolve + bias((s + .5) / SEG, (row + .5) / rows) * c.settle * .65 + Math.random() * c.settle * .35
            )));
            // ピリッと走るノイズ: 横にずれる帯と、白黒が反転した小さな四角。
            // 導入では後半ほど多く(数は時刻の 2 乗に比例)、大きく、大きくずれる。大きな W ができる直前がいちばん激しい。
            // 暗いところで見ても目に痛くないよう、大きく反転させない。帯はずらすだけ(反転するのは 1 行の細い帯と小さな四角)
            r.events = Array.from({ length: c.events }, () => {
                const band = Math.random() < .72;
                const intro = r.mode !== 'move';
                const u = intro ? Math.cbrt(Math.random()) : Math.random();
                const k = intro ? .4 + u : 1; // 大きさ(移動のときは以前のまま)
                const h = band ? 1 + ((Math.random() * 5 * k) | 0) : 1 + ((Math.random() * 2) | 0);
                return {
                    t: c.evFrom + (c.resolve - .06 - c.evFrom) * u, dur: rand(.045, .12),
                    r0: (Math.random() * rows) | 0, h,
                    c0: band ? 0 : (Math.random() * cols) | 0, w: band ? cols : 2 + ((Math.random() * 7 * k) | 0),
                    dx: band ? (Math.random() < .5 ? -1 : 1) * (1 + ((Math.random() * 5 * k) | 0)) : 0,
                    inv: !band || (h === 1 && Math.random() < .35),
                };
            });
            if (c.swap <= 0) {
                r.swapped = true;
                r.swap && r.swap();
                measure(r);
            }
            r.t0 = performance.now();
            r.raf = requestAnimationFrame(frame);
            // 導入の音(グリッチの帯と同じ時刻にガリッ)。スキップしたら引っこめる
            if (r.mode !== 'move') {
                r.hush = sfx.play('introNoise', {
                    cover: c.cover, resolve: c.resolve, settle: c.settle, reveal: c.reveal, flashes: c.flashes, top: r.mode === 'introW',
                    events: r.events.map((e) => [e.t, e.dur, e.h, e.w / cols, ((e.c0 + e.w / 2) / cols) * 2 - 1, e.dx, e.inv]),
                });
            }
            // 覆い終わってから見えるようになるまで、背景は隠れているので描かない
            setTimeout(() => { if (run === r && !r.revealed) field.pause(true); }, c.cover * 1000);
        }

        const drawNoise = (r, dx = 0) => {
            const c = noise[r.k], s = c.width / ((cols + M * 2) * cell);
            ctx.drawImage(c, 0, 0, c.width, c.height, (r.ox + dx - M) * cell, (r.oy - M) * cell, c.width / s, c.height / s);
        };

        // 覆っていく範囲。導入は中心から、押して入るときは押した所からの円。前後へは進む向きの端から
        function coverPath(r, t) {
            const c = r.cfg;
            ctx.beginPath();
            if (!r.dir) {
                const ox = r.origin ? r.origin.x : W / 2, oy = r.origin ? r.origin.y : H / 2;
                const R = (1 - (1 - clamp(t / c.cover, 0, 1)) ** 3) * (r.origin ? r.far * 1.04 : Math.hypot(W, H) * .58);
                for (let row = 0; row < rows; row++) {
                    const dy = (row + .5) * cell - oy;
                    const hw = Math.sqrt(Math.max(0, R * R - dy * dy)) + (R > cell * 4 ? r.jitR[row] * cell : 0);
                    if (hw <= 0) continue;
                    const x0 = Math.max(0, Math.floor((ox - hw) / cell) * cell);
                    ctx.rect(x0, row * cell, Math.min(W, Math.ceil((ox + hw) / cell) * cell) - x0, cell);
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
            // 画面を替えるコマと、次の画面を測って文字の層を描くコマは分ける(1 コマに重い処理が重ならないように)。
            // 形が見えはじめる(resolve)のはまだ先なので、1 コマ遅れても見た目は変わらない
            if (!r.swapped && t >= c.swap) {
                r.swapped = true;
                r.swap && r.swap();
            } else if (r.swapped && !r.measured) {
                measure(r);
            }

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            ctx.setTransform(FDPR, 0, 0, FDPR, 0, 0);

            // ピリピリ: 層・位置・濃さを数十ミリ秒ごとに切り替える。導入は時間とともに激しくなる
            const heat = r.mode !== 'move' ? clamp(t / c.resolve, 0, 1) ** 1.2 : .8;
            if (t >= r.nextSwitch) {
                r.k = (Math.random() * noise.length) | 0;
                const still = t >= c.resolve;
                r.ox = still ? 0 : ((Math.random() * 5) | 0) - 2;
                r.oy = still ? 0 : ((Math.random() * 3) | 0) - 1;
                r.nA = .45 + heat * .25 + Math.random() * .1; // 濃さの振れは小さく(大きく明滅すると目に痛い)
                r.lA = rand(.15, .45);
                r.nextSwitch = t + lerp(.1, .03, heat) * rand(.7, 1.3);
            }

            const covering = t < c.cover;
            if (t < c.reveal) {
                ctx.fillStyle = '#fff';
                if (r.mode !== 'move' || !covering) {
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

            // 導入の途中で、できあがる画面の形が一瞬だけ見える
            if (r.measured) {
                for (const f of c.flashes) {
                    if (t < f || t >= f + .05) continue;
                    ctx.globalAlpha = .5; // 白く抜くと明滅が強いので、薄く重ねるだけにする
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
                    field.pause(false);
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

        // 画面の幅かマスの大きさが変わったときだけ打ち切る(スマホのツールバーの出入りで高さだけ変わるのは、そのまま続ける)
        let sizeAt = '';
        const sizeKey = () => `${innerWidth}|${cellSize()}`;
        const onResize = () => { if (sizeKey() !== sizeAt) abort(); };

        function detach() {
            removeEventListener('resize', onResize);
            removeEventListener('keydown', abort);
            removeEventListener('wheel', abort);
            wrap.removeEventListener('pointerdown', abort);
        }

        function finish() {
            const r = run;
            if (!r) return;
            cancelAnimationFrame(r.raf);
            run = null;
            field.pause(false);
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
            if (r.hush) r.hush(.08);
            if (!r.swapped) {
                r.swapped = true;
                r.swap && r.swap();
            }
            if (!r.revealed) {
                r.revealed = true;
                field.pause(false);
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
                sizeAt = sizeKey();
                addEventListener('resize', onResize);
                if (opts.mode !== 'move') {
                    addEventListener('keydown', abort);
                    addEventListener('wheel', abort, { passive: true });
                    wrap.addEventListener('pointerdown', abort);
                    // canvas に描く文字は Web フォントを待ってから(CSS が届くのも含めて、最大 1.2 秒)
                    // 音を入れている人は、音の出口が開くのも少し待つ(リロードしたときは、押さなくても開くブラウザがある)
                    const wait = Promise.all([
                        document.fonts ? fontsCss.then(() => Promise.all([
                            document.fonts.load('700 100px "Inter Tight"', 'WS'),
                            document.fonts.load(`${MARK_WEIGHT} 100px "Unbounded"`, 'WSORK.'),
                        ])).catch(() => {}) : null,
                        sfx.ready(250),
                    ]);
                    Promise.race([wait, new Promise((res) => setTimeout(res, 1200))]).then(() => begin(r));
                } else {
                    begin(r);
                }
            });
        }

        $('[data-fx-skip]', wrap).addEventListener('click', abort);
        return { play };
    })();

    /* ----------------------------------------------------------------------
       画面の移動: トップのテレビが目次。もどる先は data-parent、
       同じ data-parent のプロダクトどうしは前後に移れる
       ---------------------------------------------------------------------- */
    const screens = $$('.screen').map((el) => ({ el, id: el.id, name: el.dataset.name, parent: el.dataset.parent || '' }));
    const byId = (id) => screens.find((s) => s.id === id);
    const ALIAS = { contact: 'sns', work: 'works', products: 'works' };
    const idFromHash = () => {
        const h = decodeURIComponent(location.hash.slice(1));
        return ALIAS[h] || h;
    };
    const siblings = (s) => (s.parent && s.parent !== 'top' ? screens.filter((o) => o.parent === s.parent) : []);
    const centerOf = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    let cur = null, busy = false;

    function updateChrome() {
        const parent = byId(cur.parent);
        const sib = siblings(cur), i = sib.indexOf(cur);
        const set = (key, target, label, aria) => {
            const b = $(`[data-dock="${key}"]`, dock);
            b.hidden = !target;
            if (!target) return;
            b.dataset.go = target.id;
            $('.dock-label', b).textContent = label;
            b.setAttribute('aria-label', aria || label);
        };
        set('back', parent, parent && (parent.id === 'top' ? 'テレビにもどる' : `${parent.name}の一覧へ`));
        $('[data-dock="back"]', dock).classList.toggle('is-tv', !!parent && parent.id === 'top');
        set('prev', sib[i - 1], sib[i - 1] && sib[i - 1].name, sib[i - 1] && `前のプロダクト: ${sib[i - 1].name}`);
        set('next', sib[i + 1], sib[i + 1] && sib[i + 1].name, sib[i + 1] && `次のプロダクト: ${sib[i + 1].name}`);
        dock.classList.toggle('is-empty', !parent);
        $$('.nav a', header).forEach((a) => {
            const on = a.dataset.go === cur.id || (a.dataset.go === cur.parent && cur.parent !== 'top');
            if (on) a.setAttribute('aria-current', 'true');
            else a.removeAttribute('aria-current');
        });
    }

    function show(s) {
        screens.forEach((o) => o.el.classList.toggle('is-current', o === s));
        cur = s;
        scrollTo(0, 0);
        updateChrome();
        fitMark();
        header.classList.remove('is-scrolled');
        tv.toggle(s.id === 'top');
        page.enter(s);
        requiet(); // 背景の静かにする所は、次のコマで測る(画面を替えたコマに重ねない)
        field.wake();
    }

    /* 各画面の飾り: 頭の小さな画面の 3D の絵、準備中のアカウントの砂嵐、端末に 1 行ずつ出す */
    const page = (() => {
        let stops = [], snowTimer = 0;
        const snow = (el) => {
            let t = '';
            for (let r = 0; r < 10; r++) {
                for (let c = 0; c < 11; c++) {
                    const x = Math.random();
                    t += x < .28 ? 'W' : x < .56 ? 'S' : ' ';
                }
                t += '\n';
            }
            el.textContent = t;
        };
        return {
            enter(s) {
                stops.forEach((f) => f());
                stops = [];
                clearInterval(snowTimer);
                $$('canvas[data-emblem]', s.el).forEach((c) => stops.push(tv.mini3d.mount(c, c.dataset.emblem)));
                // 準備中のアカウント(.acct.is-soon)の画面には、砂嵐を入れる
                $$('.acct.is-soon .acct-screen', s.el).forEach((sc) => {
                    if ($('.acct-snow', sc)) return;
                    const f = document.createElement('span');
                    f.className = 'acct-snow';
                    f.setAttribute('aria-hidden', 'true');
                    sc.append(f);
                });
                const flakes = $$('.acct-snow', s.el);
                flakes.forEach(snow);
                if (flakes.length && !RM) snowTimer = setInterval(() => { if (!document.hidden) flakes.forEach(snow); }, 110);
                $$('[data-term]', s.el).forEach((t) => {
                    t.dispatchEvent(new Event('term:reset'));
                    $$('.tl', t).forEach((l, i) => l.style.setProperty('--i', i));
                    t.classList.remove('is-typing');
                });
            },
            // 画面が見えたら(W と S が本物に替わったら)、端末に 1 行ずつ打ちこむ。
            // 行が出るたびにカタッ(打ちこんだ行はコツ)。間隔は CSS の .term.is-typing .tl と同じ
            type(s) {
                if (RM) return;
                $$('[data-term]', s.el).forEach((t) => {
                    t.classList.remove('is-typing');
                    void t.offsetWidth;
                    t.classList.add('is-typing');
                    const list = $$('.tl:not(.is-live)', t).map((l) => [
                        .35 + (parseFloat(l.style.getPropertyValue('--i')) || 0) * .07,
                        !!$('.ps', l) && !l.classList.contains('term-prompt'),
                    ]);
                    stops.push(sfx.play('lines', list));
                });
            },
        };
    })();

    // 背景の W と S を静かにする所: ヘッダーの文字、もどるボタン、いまの画面の data-quiet
    field.quiet(() => [
        $('.logo', header), $('.nav', header), $('.sound-toggle', header),
        ...$$('.dock-btn:not([hidden])', dock),
        ...(cur ? $$('[data-quiet]', cur.el) : []),
    ]);
    let quietRaf = 0, placeRaf = 0;
    const requiet = () => {
        if (quietRaf) return;
        quietRaf = requestAnimationFrame(() => {
            quietRaf = 0;
            field.quiet();
        });
    };
    // スクロールでは測り直さず、とっておいた四角をずらすだけ
    addEventListener('scroll', () => {
        if (placeRaf || quietRaf) return;
        placeRaf = requestAnimationFrame(() => {
            placeRaf = 0;
            field.place();
        });
    }, { passive: true });
    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(requiet);
        screens.forEach((o) => ro.observe(o.el));
        ro.observe(header);
    }
    fontsReady.then(requiet);

    // origin: 円が広がり始める点(押したボタンなど)。dir: 横へ流すとき(前後のプロダクト)
    // before: 次の画面に替わる直前にすること
    function go(id, { push = true, origin = null, dir = null, before = null, morph = null } = {}) {
        const next = byId(id);
        if (!next || busy || next === cur) return false;
        if (push) history.pushState(null, '', `#${id}`);
        if (RM) {
            if (before) before();
            if (morph) {
                morph.z.remove();
                if (morph.bd) morph.bd.remove();
            }
            show(next);
            return true;
        }
        if (morph) {
            morphIn(next, morph);
            return true;
        }
        // テレビの中の画面からトップへ: テレビの画面の中から、外へ引いて出てくる
        if (next.id === 'top' && cur && tv.channelOf(cur)) {
            pullOut(next);
            return true;
        }
        busy = true;
        const containers = [next.el, dock];
        next.el.classList.add('is-forming');
        // ピリピリは、W と S が流れてくる側から(前後へは進む向き、押して入るときは押した所)
        sfx.play('move', dir ? dir.x * .4 : origin ? ((origin.x / innerWidth) * 2 - 1) * .5 : 0);
        fx.play({
            mode: 'move', dir, origin, containers,
            swap: () => {
                if (before) before();
                dock.classList.add('is-forming');
                show(next);
            },
            onReveal: (parts, fast) => {
                playIn(parts, containers, fast);
                page.type(next);
            },
        }).then(() => {
            busy = false;
            // 移動中に戻る・進むが押されていたら、URL の画面に合わせる
            const want = wanted();
            if (want && want !== cur) go(want.id, { push: false });
        });
        return true;
    }

    /* テレビの番組と、行き先の画面とをつなぐ部分。番組の板はここへ縮んでおさまり、もどるときはここから広がる。
       プロダクトは最初の作品の画面、作品は大きな画面、ボットは投稿のアプリの画面、経歴は端末、SNS はアカウントのまとまり */
    const BRIDGE = { works: '.products .monitor-screen', bots: '.monitor--app .monitor-screen', about: '.term-win', sns: '.sns' };
    const bridgeOf = (s, src) => {
        // プロダクトの一覧は、テレビに映っていた作品の画面へ
        if (s.id === 'works' && src) {
            const m = $$('.products .monitor-screen', s.el).find((el) => $('img', el).getAttribute('src') === src);
            if (m) return m;
        }
        if (BRIDGE[s.id]) return $(BRIDGE[s.id], s.el);
        return $$('.media', s.el).find((m) => m.getClientRects().length) || null;
    };
    // 板(テレビの画面の大きさ r)を、要素の四角 t に重ねる位置。幅を合わせ、はみ出す下は切る。角の丸みも合わせる
    const placeOn = (t, r, el) => {
        const sc = t.width / r.width, rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        return { x: t.left, y: t.top, s: sc, b: Math.max(0, r.height - t.height / sc), rad: rad / sc };
    };
    // 板を a から b へ(e は 0〜1)。位置・倍率・下の切り取り・角の丸み
    const plateAt = (z, a, b, e) => {
        const m = (k) => a[k] + (b[k] - a[k]) * e;
        z.style.transform = `translate(${m('x')}px, ${m('y')}px) scale(${m('s')})`;
        z.style.clipPath = `inset(0px 0px ${m('b').toFixed(1)}px 0px round ${m('rad').toFixed(1)}px)`;
    };
    // requestAnimationFrame で dur ミリ秒かけて fn(p) を呼ぶ(p は 0〜1)。
    // 時計は最初のコマから数える(画面を替えた直後の重いコマで、いきなり先へ飛ばないように)
    const tween = (dur, fn) => new Promise((done) => {
        let t0 = 0;
        fn(0);
        const step = (now) => {
            if (!t0) t0 = now;
            const p = Math.min(1, (now - t0) / dur);
            fn(p);
            if (p < 1) requestAnimationFrame(step);
            else done();
        };
        requestAnimationFrame(step);
    });
    const ramp = (a, b, x) => clamp((x - a) / (b - a), 0, 1);
    // 板と本物の入れ替わり: [時刻, 板の濃さ]。段で行き来しながら本物へ
    const SWAP = [[0, 1], [.66, .15], [.7, .85], [.75, .1], [.8, .6], [.85, 0], [.88, .35], [.92, 0]];
    // 板をがたつかせる(横にずれて明滅する。一度だけ)
    const tear = (el) => {
        if (RM) return;
        el.classList.remove('is-tearing');
        void el.offsetWidth;
        el.classList.add('is-tearing');
    };

    /* 切り替わりのグリッチ: 画面(または指定の四角)に、W と S のノイズの帯と、細い反転の帯を数コマだけ走らせる。
       ページを替えた瞬間など、描き直しで引っかかったり大きさが飛んだりする所にかぶせて、演出に見せる。
       帯は細く小さく(画面全体が明滅しないように) */
    const glitch = (() => {
        const c = document.createElement('canvas');
        c.className = 'glitch-layer';
        c.setAttribute('aria-hidden', 'true');
        document.body.appendChild(c);
        const g = c.getContext('2d');
        const GDPR = Math.min(DPR, 1.5); // 粗い帯なので、画素密度は 1.5 まで
        let until = 0, raf = 0, last = 0, area = null, freeTimer = 0;
        c.width = c.height = 0;
        const frame = (now) => {
            if (now >= until) {
                g.clearRect(0, 0, c.width, c.height);
                raf = 0;
                // しばらく使わなければ、画面いっぱいの canvas を放す(続けて走るときは使い回す)
                freeTimer = setTimeout(() => { c.width = c.height = 0; }, 2000);
                return;
            }
            raf = requestAnimationFrame(frame);
            if (now - last < 45) return; // 1 秒に 20 コマほど。カクカクと切り替わる
            last = now;
            const W = innerWidth, H = innerHeight;
            if (c.width !== Math.round(W * GDPR) || c.height !== Math.round(H * GDPR)) {
                c.width = Math.round(W * GDPR);
                c.height = Math.round(H * GDPR);
            }
            g.setTransform(GDPR, 0, 0, GDPR, 0, 0);
            g.clearRect(0, 0, W, H);
            const cell = cellSize(), a = area || { left: 0, top: 0, width: W, height: H };
            g.font = `600 ${cell * .8}px ${FONT}`;
            g.textAlign = 'center';
            const bands = 3 + ((Math.random() * 4) | 0);
            for (let i = 0; i < bands; i++) {
                const rows = 1 + ((Math.random() * 3) | 0), h = rows * cell;
                const y = Math.round((a.top + Math.random() * Math.max(0, a.height - h)) / cell) * cell;
                const w = a.width * rand(.3, 1), x = a.left + Math.random() * (a.width - w);
                if (Math.random() < .3) { // 細い反転の帯
                    g.fillStyle = '#111';
                    g.fillRect(x, y + cell * .3, w, cell * rand(.25, .6));
                    continue;
                }
                const dark = Math.random() < .5; // 暗い帯に明るい文字か、明るい帯に暗い文字
                g.fillStyle = dark ? 'rgba(17, 17, 17, .88)' : 'rgba(255, 255, 255, .9)';
                g.fillRect(x, y, w, h);
                g.fillStyle = dark ? 'rgba(236, 236, 236, .75)' : 'rgba(17, 17, 17, .6)';
                for (let r = 0; r < rows; r++) {
                    for (let cx = x + cell / 2; cx < x + w; cx += cell) {
                        if (Math.random() < .45) g.fillText(Math.random() < .5 ? 'W' : 'S', cx, y + r * cell + cell * .79);
                    }
                }
            }
        };
        return {
            burst(ms = 240, rect = null) {
                if (RM) return;
                const now = performance.now();
                area = rect;
                until = Math.max(until, now + ms);
                clearTimeout(freeTimer);
                if (!raf) {
                    last = 0;
                    raf = requestAnimationFrame(frame);
                }
            },
        };
    })();
    // つなぐ部分は、ちらつかせずに板と入れ替える(data-part をいったん外す。外した印は data-hold)
    const keep = (el) => {
        const parts = el.closest('[data-part]') ? [el.closest('[data-part]')] : $$('[data-part]', el);
        parts.forEach((p) => {
            p.dataset.hold = p.dataset.part;
            p.removeAttribute('data-part');
        });
        return () => parts.forEach((p) => {
            p.dataset.part = p.dataset.hold;
            delete p.dataset.hold;
        });
    };

    // テレビから入るとき: 全面に広がった番組の板が、行き先のつなぐ部分へ縮んでおさまり、まわりの部品がちらついて出る
    function morphIn(next, { z, bd, r, at, src }) {
        busy = true;
        const containers = [next.el, dock];
        containers.forEach((c) => c.classList.add('is-forming'));
        show(next);
        const target = bridgeOf(next, src);
        const release = target ? keep(target) : () => {};
        const held = target ? (target.closest('[data-hold]') ? [target.closest('[data-hold]')] : $$('[data-hold]', target)) : [];
        const parts = stagger(partsOf(containers), .035);
        z.getAnimations().forEach((a) => a.cancel());
        z.style.borderRadius = '0px';
        plateAt(z, at, at, 0);
        const to = target ? placeOn(target.getBoundingClientRect(), r, target) : at;
        const DUR = 820, MOVE = .76; // 動くのは前の 76%。終わりの方で、板と本物がちらつきながら入れ替わる
        held.forEach((el) => { el.style.opacity = '0'; });
        // ページが替わった瞬間(引っかかりやすい所)は、グリッチでごまかす
        glitch.burst(300);
        sfx.play('glitch', 300);
        tear(z);
        // つなぐ部分に data-part をもどすのは、ちらつきの印(is-revealing)が外れてから(先にもどすと、もう一度ちらつく)
        let revealEnd = Infinity;
        setTimeout(() => {
            const max = playIn(parts, containers, false);
            revealEnd = performance.now() + (max + .8) * 1000;
        }, 160);
        setTimeout(() => page.type(next), DUR * MOVE - 120);
        let swapped = false;
        // 幕(スマホで上下の余りを埋めていた色)は、板が縮み始めると引いて、組み上がるページを見せる
        if (bd) {
            bd.getAnimations().forEach((a) => a.cancel());
            bd.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR * .35, easing: 'ease-out', fill: 'forwards' }).finished.then(() => bd.remove());
        }
        tween(DUR, (p) => {
            plateAt(z, at, to, inOutCubic(Math.min(1, p / MOVE)));
            // 入れ替わり: なめらかに薄めず、段で行き来させる(テレビの信号が乱れて切り替わる感じ)
            const k = target ? SWAP.filter(([t]) => p >= t).pop()[1] : 1 - p;
            z.style.opacity = k;
            held.forEach((el) => { el.style.opacity = target ? 1 - k : p; });
            if (target && !swapped && p >= SWAP[1][0]) {
                swapped = true;
                glitch.burst(260, target.getBoundingClientRect());
                sfx.play('glitch', 240, .7);
                tear(z);
            }
        }).then(() => {
            z.remove();
            held.forEach((el) => { el.style.opacity = ''; });
            setTimeout(release, Math.max(0, revealEnd - performance.now()) + 50);
            busy = false;
            field.quiet();
            const want = wanted();
            if (want && want !== cur) go(want.id, { push: false });
        });
    }

    /* テレビの中の画面からトップへもどる: 電脳の世界から「出ていけ」とはじき出される。どの画面からでも同じ。
       1. 画面がガタガタ揺れて裂け、ノイズの帯が走り、ブラウン管を切ったときのように横一本の線へつぶれる
       2. 画面いっぱいまで寄ったテレビに替わる。テレビは砂嵐がバリバリ鳴っていて、カメラが勢いよく引く
       3. 引いている途中で砂嵐が止み、元の番組にパッともどる */
    function pullOut(top) {
        const from = cur, n = tv.channelOf(from), W = innerWidth, H = innerHeight;
        busy = true;
        // スマホの幅では .dock 自体が固定の帯。パソコンの幅では中のボタンがそれぞれ固定なので、ボタンに当てる
        // (.dock に transform を当てると、中の fixed のボタンの基準が .dock に変わって飛んでしまう)
        const dockEls = getComputedStyle(dock).position === 'fixed' ? [dock] : $$('.dock-btn:not([hidden])', dock);
        const els = [from.el, ...dockEls];
        // 前後のボタンはもともと translateY(-50%) でずらしてあるので、揺れの後ろにそのずれを足す
        const base = new Map(els.map((el) => {
            const t = getComputedStyle(el).transform;
            return [el, t && t !== 'none' ? t : ''];
        }));
        els.forEach((el) => {
            const r = el.getBoundingClientRect(), m = base.get(el) ? new DOMMatrix(base.get(el)) : null;
            el.style.transformOrigin = `${W / 2 - (r.left - (m ? m.e : 0))}px ${H / 2 - (r.top - (m ? m.f : 0))}px`;
        });
        glitch.burst(420);
        sfx.play('eject'); // ガガッ → プツン(長さは EJECT と SHAKE に合わせてある)
        const EJECT = 380, SHAKE = .55;
        let jx = 0, jy = 0, last = 0;
        tween(EJECT, (p) => {
            const now = performance.now();
            if (now - last > 40) { // 揺れはカクカクと、コマごとに跳ぶ
                last = now;
                const a = 1 - p * .5;
                jx = (Math.random() - .5) * 36 * a;
                jy = (Math.random() - .5) * 10 * a;
            }
            const q = ramp(SHAKE, 1, p), e = q * q;
            const sy = 1 - .992 * e, sx = 1 - .35 * ramp(.6, 1, q);
            const tf = `translate(${(jx * (1 - e)).toFixed(1)}px, ${(jy * (1 - e)).toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
            // 揺れのあいだは横に裂ける(上下に分かれて別々にずれる)
            const cut = p < SHAKE ? `inset(${(Math.random() * 30).toFixed(0)}% 0 ${(Math.random() * 30).toFixed(0)}% 0)` : '';
            els.forEach((el) => {
                el.style.transform = `${tf} ${base.get(el)}`;
                el.style.clipPath = Math.random() < .35 ? cut : '';
                el.style.filter = q > 0 ? `brightness(${(1 + 1.4 * q).toFixed(2)})` : '';
                el.style.opacity = p < SHAKE ? (Math.random() < .2 ? .55 : 1) : 1 - ramp(.85, 1, q);
            });
        }).then(() => {
            els.forEach((el) => {
                el.style.transform = el.style.transformOrigin = el.style.clipPath = el.style.filter = el.style.opacity = '';
            });
            // 裏でトップに替え、テレビはそのチャンネルにして、画面いっぱいまで寄せておく
            tv.present(n);
            tv.jam(true);
            show(top);
            const screenEl = tv.screen, topEl = top.el;
            const sr = screenEl.getBoundingClientRect(), tr = topEl.getBoundingClientRect();
            // 入るときと同じく、縦長のスマホでは覆わずに幅いっぱいまで寄る(上下にはテレビの筐体が見える)
            const cover = Math.max(W / sr.width, H / sr.height), fit = Math.min(W / sr.width, H / sr.height);
            const k = cover / fit > 1.15 ? fit : cover;
            const px = sr.left + sr.width / 2, py = sr.top + sr.height / 2;
            const dx = W / 2 - px, dy = H / 2 - py;
            topEl.style.transformOrigin = `${px - tr.left}px ${py - tr.top}px`;
            screenEl.classList.add('is-pulling');
            const set = (e, p) => {
                topEl.style.transform = `translate(${dx * (1 - e)}px, ${dy * (1 - e)}px) scale(${k + (1 - k) * e})`;
                screenEl.style.setProperty('--glass', ramp(.15, .7, p).toFixed(3));
            };
            set(0, 0);
            glitch.burst(360);
            const DUR = 760, CLEAR = .5; // 勢いよく引き(ヒュッ)、半ばで砂嵐が止んで番組にもどる
            sfx.play('whoosh', DUR, true, 0, .6);
            const easeOut = (t) => 1 - (1 - t) ** 4;
            let cleared = false;
            tween(DUR, (p) => {
                set(easeOut(p), p);
                if (!cleared && p >= CLEAR) {
                    cleared = true;
                    tv.jam(false);
                    glitch.burst(120, screenEl.getBoundingClientRect());
                }
            }).then(() => {
                topEl.style.transform = topEl.style.transformOrigin = '';
                screenEl.classList.remove('is-pulling');
                screenEl.style.removeProperty('--glass');
                tv.osd(n);
                busy = false;
                field.quiet();
                const want = wanted();
                if (want && want !== cur) go(want.id, { push: false });
            });
        });
    }

    document.addEventListener('click', (e) => {
        const a = e.target.closest('[data-go]');
        if (!a || !root.classList.contains('is-world')) return;
        e.preventDefault();
        const d = +a.dataset.dir || 0;
        go(a.dataset.go, d ? { dir: { x: d, y: 0 } } : { origin: centerOf(a) });
    });

    // # が画面でないとき(本文へ移動のリンクなど)は、そのままにする
    const wanted = () => (idFromHash() ? byId(idFromHash()) : byId('top'));
    addEventListener('popstate', () => {
        const s = wanted();
        if (s) go(s.id, { push: false });
    });

    // キー: トップではテレビのチャンネル。ほかの画面では Esc でもどり、プロダクトは ← → で前後へ
    addEventListener('keydown', (e) => {
        if (busy || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.target.closest('input, textarea, select, [contenteditable], [role="tablist"]')) return;
        if (cur.id === 'top') {
            tv.key(e);
            return;
        }
        if (e.key === 'Escape' && cur.parent) {
            e.preventDefault();
            go(cur.parent);
            return;
        }
        const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        const sib = siblings(cur), n = d && sib[sib.indexOf(cur) + d];
        if (!n) return;
        e.preventDefault();
        go(n.id, { dir: { x: d, y: 0 } });
    });

    /* ----------------------------------------------------------------------
       テレビ: トップの目次。つまみでチャンネルを替えると、W と S の砂嵐をはさんで番組が変わる。
       画面を押すと、番組がテレビの枠から全面に広がって、その画面に入る。
       チャンネルは、つまみ・ホイール・矢印キー・数字キーで替える。スマホではテレビの画面を左右にスワイプする。
       番組表は画面に出さない(読み上げ用。キーボードで入ったときだけ見える)。そこで選ぶとチャンネルが替わってからそのまま入る。
       最初に電源が入ったときだけ、つまみがピクピクッと揺れる(カーソルを合わせたときと同じ動き)
       ---------------------------------------------------------------------- */
    const tv = (() => {
        const tvEl = $('.tv');
        const screenEl = $('[data-tv-screen]');
        const content = $('.tv-content', screenEl), cvs = $('.tv-static', screenEl), osd = $('.tv-osd', screenEl);
        const knob = $('.tv-knob'), dial = $('.tv-dial');
        const links = $$('.tv-list a[data-ch]');
        const chans = links.map((a) => ({
            n: +a.dataset.ch, a, id: a.hash.slice(1),
            name: $('.tv-list-name', a).textContent,
            prog: $(`.tv-prog[data-ch="${a.dataset.ch}"]`, content),
        }));
        const chan = (n) => chans.find((c) => c.n === n);
        const N = Math.max(6, ...chans.map((c) => c.n)); // つまみの目盛りの数
        const ANG = (n) => -135 + ((n - 1) * 270) / (N - 1);
        let ch = 1, on = false, visible = false, waiting = false;
        let raf = 0, frames = [], fKey = '', fi = 0, lastF = 0, burstUntil = 0, tunedAt = 0;
        let osdTimer = 0, swapTimer = 0, reelTimer = 0, hoverTimer = 0;
        // 砂嵐の音: 番組のないチャンネルでは小さく、はじき出された直後は大きく鳴り続ける
        const snowSound = () => sfx.snow(!on || !visible || document.hidden ? 0
            : screenEl.classList.contains('is-jammed') ? 1 : chan(ch) ? 0 : .3);

        // つまみのまわりの目盛り(番組のない番号は薄く)
        const nums = Array.from({ length: N }, (_, i) => {
            const n = i + 1;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `tv-num${chan(n) ? '' : ' is-empty'}`;
            b.textContent = n;
            b.tabIndex = -1;
            b.setAttribute('aria-hidden', 'true');
            const a = (ANG(n) * Math.PI) / 180;
            b.style.left = `${50 + Math.sin(a) * 45}%`;
            b.style.top = `${50 - Math.cos(a) * 45}%`;
            b.addEventListener('click', () => tune(n));
            dial.appendChild(b);
            return b;
        });
        $('.tv-grille span').textContent = 'WSWS'.repeat(160);

        // 右の小さな画面の絵。行き先の画面の id ごとに、細かい文字で 3D の絵を描く(下の mini3d の SCENES)。
        // 絵のないチャンネルは番号を、番組のない番号は砂嵐を映す
        const miniBox = $('.tv-mini'), miniArt = $('.tv-mini-art');
        let miniTimer = 0;
        const miniStop = () => { clearInterval(miniTimer); mini3d.stop(); };
        const wsNoise = () => Array.from({ length: 7 }, () => Array.from({ length: 13 }, () => {
            const r = Math.random();
            return r < .3 ? 'W' : r < .6 ? 'S' : ' ';
        }).join('')).join('\n');

        /* 小さな画面の 3D の絵(プロダクト・ボット・経歴・SNS): 細かい文字のマス目ごとに、視点から光線を飛ばして形に当てる。
           当たった面の明るさで文字と濃さを選び(面は . : - = + * まで)、輪郭や辺は S と W の明るい線にする。
           光は筐体と同じ左上から。1 マスを 2×2 に分けて当たり具合を見るので、輪郭がギザギザしにくい。
           絵ごとの shade(t) が、時刻 t(ミリ秒)からマスの明るさ(0〜1)と辺の強さ(0〜1)を cells に書く */
        const mini3d = (() => {
            const COLS = 44, ROWS = 24; // 文字のマスは縦長(幅:高さ ≒ 1:1.8)なので、正方形の画面にこの数で並ぶ
            const RAMP = '.:-=+*SW'; // 暗い → 明るい。面ごとに文字がはっきり分かれるよう段は少なめ
            const FACE = .74; // 面はここまで(* まで)。それより明るいのは辺と、光る部品だけ
            const D = 14; // 視点までの距離
            const LIGHT = (() => { const v = [-.45, .8, .4], l = Math.hypot(...v); return v.map((x) => x / l); })();
            const cvs = document.createElement('canvas');
            cvs.className = 'tv-mini-3d';
            cvs.setAttribute('aria-hidden', 'true');
            $('.tv-mini-screen').append(cvs);
            const g = cvs.getContext('2d');
            const cells = new Float32Array(COLS * ROWS * 2); // マスごとの明るさと、辺の強さ
            const lum = (dot) => .12 + .88 * Math.max(0, dot);
            // 長さ。Math.hypot は遅いので、光線を進める内側のループではこちらを使う
            const len2 = (x, y) => Math.sqrt(x * x + y * y);
            const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
            // 傾き a(上面が見える向き)× 縦軸の回転 b。形の側から見た視点と光の向きも返す
            const view = (a, b) => {
                const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
                const R = [[cb, 0, sb], [sa * sb, ca, -sa * cb], [-ca * sb, sa, ca * cb]];
                const o = [D * R[2][0], D * R[2][1], D * R[2][2]];
                const L = [0, 1, 2].map((k) => R[0][k] * LIGHT[0] + R[1][k] * LIGHT[1] + R[2][k] * LIGHT[2]);
                return { R, o, L };
            };
            // マス (c, r) の s 番目の小さな点を通る光線の向き(形の側の座標)
            const ray = (R, half, c, r, s, d) => {
                const x = (((c + .25 + (s & 1) * .5) / COLS) * 2 - 1) * half;
                const y = (1 - ((r + .25 + (s >> 1) * .5) / ROWS) * 2) * half;
                for (let k = 0; k < 3; k++) d[k] = x * R[0][k] + y * R[1][k] - D * R[2][k];
            };

            /* 距離関数で表した形(ボット・卒業帽・@)を描く。光線を少しずつ進めて形に当て、面の向きで明るさを決める。
               sc: half 画面の端までの広さ / lit 部品ごとの「自分で光るか」(光る部品は輪郭の線を引かず、1 点でも当たればその明るさ)
                   thin 細い部品(内側の線を引かない) / soft 折れ目の線を引かない部品
                   pose(t) 動きを進めて { a 傾き, b 回転, bc 全体を包む球の中心, br その半径 } を返す
                   sd(x, y, z) 形までの距離。いちばん近い部品の番号を sc.m に入れる / glow(m, v) 光る部品の明るさ
                   paint(m, v, x, y, z) 面の明るさに模様などを足す(省略可) / line false なら輪郭や辺の線を引かない
                   after(t, R, mats) 形を描いたあとに足すもの(省略可) */
            const mats = new Int8Array(COLS * ROWS), covs = new Float32Array(COLS * ROWS), nrm = new Float32Array(COLS * ROWS * 3);
            const sdfShade = (sc, t) => {
                const { a, b, bc, br } = sc.pose(t), { R, o, L } = view(a, b), sd = sc.sd, HALF = sc.half;
                const d = [0, 0, 0], ox = o[0] - bc[0], oy = o[1] - bc[1], oz = o[2] - bc[2];
                mats.fill(-1);
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        const ci = r * COLS + c;
                        let hit = 0, sum = 0, lit = 0, nx = 0, ny = 0, nz = 0, cm = -1;
                        for (let s = 0; s < 4; s++) {
                            ray(R, HALF, c, r, s, d);
                            const dl = len3(d[0], d[1], d[2]), dx = d[0] / dl, dy = d[1] / dl, dz = d[2] / dl;
                            const bb = ox * dx + oy * dy + oz * dz, h = bb * bb - (ox * ox + oy * oy + oz * oz - br * br);
                            if (h < 0) continue;
                            let tt = -bb - Math.sqrt(h), on = false;
                            const tEnd = -bb + Math.sqrt(h);
                            for (let k = 0; k < 48 && tt < tEnd; k++) {
                                const dist = sd(o[0] + tt * dx, o[1] + tt * dy, o[2] + tt * dz);
                                if (dist < .004) { on = true; break; }
                                tt += dist;
                            }
                            if (!on) continue;
                            const px = o[0] + tt * dx, py = o[1] + tt * dy, pz = o[2] + tt * dz, e = .005;
                            const a1 = sd(px + e, py - e, pz - e), a2 = sd(px - e, py - e, pz + e), a3 = sd(px - e, py + e, pz - e), a4 = sd(px + e, py + e, pz + e);
                            sd(px, py, pz); // 当たった部品を sc.m に
                            const m = sc.m;
                            let qx = a1 - a2 - a3 + a4, qy = -a1 - a2 + a3 + a4, qz = -a1 + a2 - a3 + a4;
                            const ql = len3(qx, qy, qz) || 1;
                            qx /= ql; qy /= ql; qz /= ql;
                            let v = lum(qx * L[0] + qy * L[1] + qz * L[2]) * FACE;
                            if (sc.paint) v = sc.paint(m, v, px, py, pz); // 模様やきらめき
                            if (sc.lit[m]) lit = Math.max(lit, sc.glow(m, v));
                            else sum += v;
                            nx += qx; ny += qy; nz += qz;
                            if (m > cm) cm = m; // 番号の大きい部品(光る部品)を優先
                            hit++;
                        }
                        if (!hit) continue;
                        cells[ci * 2] = sc.lit[cm] ? lit : (sum / hit) * (.45 + .55 * (hit / 4));
                        mats[ci] = cm;
                        covs[ci] = hit / 4;
                        const nl = len3(nx, ny, nz) || 1;
                        nrm[ci * 3] = nx / nl; nrm[ci * 3 + 1] = ny / nl; nrm[ci * 3 + 2] = nz / nl;
                    }
                }
                if (sc.after) sc.after(t, R, mats);
                if (sc.line === false) return; // 線を引かない絵(文字など)
                // 輪郭(外との境目)と、部品の境目・面の折れ目に線を引く。光る部品には引かない。
                // 内側の線は右と下のマスとだけ比べて、1 マスの太さにする
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        const ci = r * COLS + c, m = mats[ci];
                        if (m < 0 || sc.lit[m]) continue;
                        let e = covs[ci] < 1 ? .5 + .5 * covs[ci] : 0;
                        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                            const cc = c + dc, rr = r + dr;
                            const nj = cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS ? -1 : rr * COLS + cc;
                            const mj = nj < 0 ? -1 : mats[nj];
                            if (mj < 0) { e = Math.max(e, covs[ci] < 1 ? .5 + .5 * covs[ci] : 1); continue; }
                            if (sc.lit[mj] || dc < 0 || dr < 0 || sc.thin.includes(m) || sc.thin.includes(mj)) continue;
                            if (m === mj && sc.soft.includes(m)) continue;
                            if (mj !== m || nrm[ci * 3] * nrm[nj * 3] + nrm[ci * 3 + 1] * nrm[nj * 3 + 1] + nrm[ci * 3 + 2] * nrm[nj * 3 + 2] < .6) e = Math.max(e, .6);
                        }
                        cells[ci * 2 + 1] = e;
                    }
                }
            };
            // 角の丸い箱の距離。b は半分の大きさ(丸みの手前まで)、r は丸み
            const box = (x, y, z, bx, by, bz, r) => {
                const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
                const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
                return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
            };
            // 2 点 (ax, ay, az)–(bx, by, bz) を結ぶ、太さ r の棒の距離
            const rod = (x, y, z, ax, ay, az, bx, by, bz, r) => {
                const px = x - ax, py = y - ay, pz = z - az, vx = bx - ax, vy = by - ay, vz = bz - az;
                const k = Math.min(Math.max((px * vx + py * vy + pz * vz) / (vx * vx + vy * vy + vz * vz), 0), 1);
                return len3(px - vx * k, py - vy * k, pz - vz * k) - r;
            };

            /* ボット: 角の丸いロボットの頭。耳とアンテナがあり、目と口は光る。
               左右を見回し、ときどきまばたきし、しゃべる(口が動き、アンテナの玉が光って、上へ電波の輪が広がる) */
            const bot = (() => {
                const CY = -.34; // 頭の中心の高さ(アンテナのぶん下げる)
                const HEAD = 0, EAR = 1, STEM = 2, BALL = 3, EYE = 4, MOUTH = 5;
                let blink = 1, mouth = 0, glow = 0, talk = false, tp = 0;
                const sc = {
                    t0: 5824, // 少し左を向き、目を開けて黙っている所から(動きを減らす設定ではここで止める)
                    half: 1.55,
                    lit: [false, false, false, true, true, true],
                    thin: [STEM],
                    soft: [EAR], // 耳は小さいので、輪郭と頭との境目だけ
                    m: 0,
                    pose(t) {
                        const bp = t % 3700;
                        tp = t % 6400;
                        blink = bp < 160 ? Math.abs(1 - bp / 80) : 1;
                        talk = tp > 3000 && tp < 4800;
                        mouth = talk ? .5 - .5 * Math.cos((tp - 3000) * .026) : 0;
                        glow = talk ? .85 + .15 * Math.sin(tp * .03) : .55;
                        return { a: .28 + Math.sin(t * .0013) * .025, b: Math.sin(t * .00065) * .5, bc: [0, 0, 0], br: 1.7 };
                    },
                    sd(x, y, z) {
                        const hy = y - CY, ax = Math.abs(x);
                        let dist = box(x, hy, z, .7, .42, .46, .3), m = HEAD; // 頭: 幅 2、高さ 1.44、奥行き 1.52。角は大きく丸める
                        const ea = Math.sqrt(hy * hy + z * z) - .14, eb = Math.abs(ax - 1.02) - .05; // 耳: 左右の小さな円柱
                        const ear = Math.min(Math.max(ea, eb), 0) + len2(Math.max(ea, 0), Math.max(eb, 0)) - .04;
                        if (ear < dist) { dist = ear; m = EAR; }
                        const sy = Math.min(Math.max(hy, .7), 1.18); // アンテナの棒
                        const stem = Math.sqrt(x * x + (hy - sy) ** 2 + z * z) - .045;
                        if (stem < dist) { dist = stem; m = STEM; }
                        const ball = Math.sqrt(x * x + (hy - 1.3) ** 2 + z * z) - .12;
                        if (ball < dist) { dist = ball; m = BALL; }
                        const eye = box(ax - .36, hy - .08, z - .72, .09, .012 + .138 * blink, .02, .04); // 目と口は面からわずかに出るだけ
                        if (eye < dist) { dist = eye; m = EYE; }
                        const mo = box(x, hy + .36, z - .72, .24, .008 + .1 * mouth, .02, .03);
                        if (mo < dist) { dist = mo; m = MOUTH; }
                        sc.m = m;
                        return dist;
                    },
                    glow: (m, v) => (m === EYE ? 1 : m === MOUTH ? .92 : Math.max(glow, v)),
                    // しゃべっている間は、アンテナの玉から上へ電波の輪が広がる(頭の外のマスだけ)
                    after(t, R, mt) {
                        if (!talk) return;
                        const HALF = sc.half, wy = CY + 1.3, wx = R[0][1] * wy, wyy = R[1][1] * wy, wz = R[2][1] * wy, f = D / (D - wz);
                        const bc = ((wx * f) / HALF + 1) / 2 * COLS, br = (1 - (wyy * f) / HALF) / 2 * ROWS;
                        const cw = (2 * HALF) / COLS, chh = (2 * HALF) / ROWS;
                        for (let j = 0; j < 4; j++) {
                            const age = (tp - 3000 - j * 450) / 1000;
                            if (age < 0) continue;
                            const rad = .22 + age * .5;
                            if (rad > .62) continue;
                            const fade = 1 - (rad - .22) / .4;
                            for (let r = 0; r < ROWS; r++) {
                                for (let c = 0; c < COLS; c++) {
                                    const ci = r * COLS + c;
                                    if (mt[ci] >= 0) continue;
                                    const dx = (c + .5 - bc) * cw, dy = (br - r - .5) * chh, dd = len2(dx, dy);
                                    if (dy < dd * .35 || Math.abs(dd - rad) > chh * .45) continue; // 上向きの扇の形だけ
                                    cells[ci * 2] = Math.max(cells[ci * 2], .45 + .45 * fade);
                                }
                            }
                        }
                    },
                };
                return { t0: sc.t0, shade: (t) => sdfShade(sc, t) };
            })();

            /* 経歴: 卒業帽(角帽)。四角い板と頭にかぶる部分、てっぺんのボタンから房(タッセル)が垂れる。
               板が菱形に見える向きを中心にゆっくり左右へ振れ(房はいつも手前に見える)、房が揺れる。
               ときどき帽子投げのように宙へ放られて前へ一回転し、着地する */
            const cap = (() => {
                const CY = -.02; // 板の高さ
                const BOARD = 0, CROWN = 1, CORD = 2, BUTTON = 3, TASSEL = 4;
                let hop = 0, flip = 0, cf = 1, sf = 0, tx = 0, ty = -1, tz = 0;
                const sc = {
                    t0: 10472, // 板が菱形に見え、房が手前右に来る角度から。3 秒ほどで最初の帽子投げ(動きを減らす設定ではここで止める)
                    half: 1.5,
                    lit: [false, false, true, true, true],
                    thin: [CORD],
                    soft: [CROWN],
                    m: 0,
                    pose(t) {
                        const tp = t % 8000, u = Math.min(Math.max((tp - 5600) / 1400, 0), 1), toss = u > 0 && u < 1;
                        hop = 1.6 * u * (1 - u); // 放り上げて、落ちてくる
                        flip = toss ? Math.PI * 2 * (u * u * (3 - 2 * u)) : 0;
                        cf = Math.cos(flip); sf = Math.sin(flip);
                        // 房の向き: ふだんは回るぶん少し外へ流れて揺れ、放られている間は大きく振れる
                        const th = .18 + .06 * Math.sin(t * .003) + (toss ? .9 * Math.sin(u * Math.PI) * Math.sin(u * 14) : 0);
                        const ph = .1 * Math.sin(t * .0023) + (toss ? .5 * Math.sin(u * Math.PI) : 0);
                        tx = Math.sin(th); ty = -Math.cos(th) * Math.cos(ph); tz = Math.cos(th) * Math.sin(ph);
                        return { a: .5, b: -Math.PI / 4 + Math.sin(t * .0006) * .4, bc: [0, CY + hop, 0], br: 1.5 };
                    },
                    sd(x, y, z) {
                        // 帽子の側の座標へ: 持ち上げたぶんを戻し、前への回転を戻す
                        const qy = y - CY - hop, py = cf * qy + sf * z, pz = -sf * qy + cf * z, px = x;
                        let dist = box(px, py, pz, .84, .004, .84, .04), m = BOARD; // 板: 一辺 1.76、厚み 0.09
                        const cr = len2(px, pz) - .5 - (py + .02) * -.08, ch = Math.abs(py + .36) - .3; // 頭にかぶる部分: 下へ少し広がる円柱
                        const crown = Math.min(Math.max(cr, ch), 0) + len2(Math.max(cr, 0), Math.max(ch, 0)) - .04;
                        if (crown < dist) { dist = crown; m = CROWN; }
                        // 房のひも: ボタンから板の上を手前右の縁へ走り、縁から垂れる
                        const ex = .88, ey = .05, hx = ex + tx * .4, hy = ey + ty * .4, hz = tz * .4;
                        const cord = Math.min(rod(px, py, pz, 0, .07, 0, ex, ey, 0, .035), rod(px, py, pz, ex, ey, 0, hx, hy, hz, .035));
                        if (cord < dist) { dist = cord; m = CORD; }
                        const button = len3(px, py - .08, pz) - .075;
                        if (button < dist) { dist = button; m = BUTTON; }
                        const tassel = rod(px, py, pz, hx, hy, hz, hx + tx * .3, hy + ty * .3, hz + tz * .3, .09);
                        if (tassel < dist) { dist = tassel; m = TASSEL; }
                        sc.m = m;
                        return dist;
                    },
                    glow: (m) => (m === TASSEL ? 1 : m === BUTTON ? .9 : .82),
                };
                return { t0: sc.t0, shade: (t) => sdfShade(sc, t) };
            })();

            /* SNS: 厚みのある「@」。ゆっくり左右に振れ、ときどきコインのようにくるっと一回転する。
               文字なので輪郭の線は引かず、正面を明るく、厚みの側面を暗くして形を出す */
            const atMark = (() => {
                const TH = .08, DEPTH = .085; // 線の太さの半分と、厚みの半分(太いと a の穴や弧の切れ目がつぶれる)
                // 円弧の距離(中心 cx, cy、半径 r、角度 a0 から a1 まで反時計回り、端は丸い)。端の点は先に求めておく
                const arc = (cx, cy, r, a0, a1) => {
                    const x0 = r * Math.cos(a0), y0 = r * Math.sin(a0), x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
                    return (x, y) => {
                        const px = x - cx, py = y - cy;
                        let a = Math.atan2(py, px);
                        while (a < a0) a += Math.PI * 2;
                        if (a <= a1) return Math.abs(len2(px, py) - r);
                        return Math.min(len2(px - x0, py - y0), len2(px - x1, py - y1));
                    };
                };
                const hook = arc(.52, -.1, .22, Math.PI, Math.PI * 2), ring = arc(0, 0, .76, .066, Math.PI * 2 - 1.15);
                const seg = (x, y, ax, ay, bx, by) => {
                    const px = x - ax, py = y - ay, vx = bx - ax, vy = by - ay;
                    const k = Math.min(Math.max((px * vx + py * vy) / (vx * vx + vy * vy), 0), 1);
                    return len2(px - vx * k, py - vy * k);
                };
                // @ の平面の形: 内側の a(輪と右の縦線)、縦線の下から右へ回り込むかぎ、外側の大きな弧。
                // 弧は右下で終わり、かぎとの間をはっきり空ける(詰まると二重丸に見える)
                const glyph = (x, y) => Math.min(
                    Math.abs(len2(x + .06, y) - .29),
                    seg(x, y, .3, .3, .3, -.1),
                    hook(x, y),
                    seg(x, y, .74, -.1, .76, .05),
                    ring(x, y),
                ) - TH;
                let spin = 0;
                const sc = {
                    t0: 0, half: 1.18, lit: [false], thin: [], soft: [], m: 0, line: false, // 正面を向いた所から
                    pose(t) {
                        const tp = t % 7000, u = Math.min(Math.max((tp - 4800) / 1300, 0), 1);
                        spin = Math.PI * 2 * u * u * (3 - 2 * u);
                        return { a: .16 + Math.sin(t * .0008) * .04, b: Math.sin(t * .0006) * .28 + spin, bc: [0, 0, 0], br: 1.05 }; // 振れ幅は小さく(大きいと a がつぶれる)
                    },
                    sd(x, y, z) {
                        const d2 = glyph(x, y) + .025, dz = Math.abs(z) - DEPTH + .025;
                        sc.m = 0;
                        return Math.min(Math.max(d2, dz), 0) + len2(Math.max(d2, 0), Math.max(dz, 0)) - .025;
                    },
                    glow: () => 1,
                    // 正面(と裏)は明るく、厚みの側面は光の当たり方のまま。輪郭の線の代わりに明暗で形を出す
                    paint: (m, v, px, py, pz) => (Math.abs(pz) > DEPTH - .02 ? .95 : v * .8),
                };
                return { t0: sc.t0, shade: (t) => sdfShade(sc, t) };
            })();

            /* プロダクト: 3D プリンターのように、台の上で立方体(一辺 2)が下から 1 層ずつ積み上がってできる。
               層は W と S のノイズが端から固まるように敷かれ、できあがるとくるっと一回転し、上から W と S に崩れて消え、また作り直す */
            const printer = (() => {
                const HALF = 2.05, EDGE = .08, SEAM = .05, Y0 = .15; // 画面の端までの広さ、辺の線の幅、層の継ぎ目の幅、絵を上へずらす量
                const N = 4, H = 2 / N, BAND = .5; // 層の数と厚さ、W と S のノイズになっている幅
                const P = 9000, LAYER = 800, BUILT = N * LAYER; // 1 巡の長さ、1 層にかける時間、できあがる時刻
                const SPIN0 = 4000, SPIN = 1300, FALL0 = 7400, FALL = 1000; // 一回転と、崩れる時刻・長さ
                const ease = (u) => { u = Math.min(Math.max(u, 0), 1); return u * u * (3 - 2 * u); };
                const d = [0, 0, 0], o = [0, 0, 0], p = [0, 0, 0], nv = [0, 0, 0];
                // 箱: 積み上がった層・敷いている途中の層・台
                const boxes = [0, 1, 2].map(() => ({ lo: [0, 0, 0], hi: [0, 0, 0], on: false, h: { t: 0, ax: 0, sg: 1 } }));
                const [stack, part, plate] = boxes;
                const set = (b, x0, y0, z0, x1, y1, z1) => { b.lo[0] = x0; b.lo[1] = y0; b.lo[2] = z0; b.hi[0] = x1; b.hi[1] = y1; b.hi[2] = z1; b.on = true; };
                // 箱(各軸 lo〜hi)に光線を当てる。当たれば距離 t と、当たった面の軸 ax・向き sg を h に入れる
                const hit = (b) => {
                    let tn = -Infinity, tf = Infinity, ax = 0;
                    for (let k = 0; k < 3; k++) {
                        let t1 = (b.lo[k] - o[k]) / d[k], t2 = (b.hi[k] - o[k]) / d[k];
                        if (t1 > t2) [t1, t2] = [t2, t1];
                        if (t1 > tn) { tn = t1; ax = k; }
                        if (t2 < tf) tf = t2;
                    }
                    if (tn > tf || tf < 0) return false;
                    b.h.t = tn; b.h.ax = ax; b.h.sg = d[ax] > 0 ? -1 : 1;
                    return true;
                };
                return {
                    t0: 3600, // できあがって、3 つの面が見える角度から(動きを減らす設定ではここで止める)
                    shade(t) {
                        const tc = t % P;
                        // 縦軸でゆっくり回り、できあがると一回転
                        const { R, o: eye, L } = view(.46 + Math.sin(t * .00031) * .04, t * .0003 - .38 + Math.PI * 2 * ease((tc - SPIN0) / SPIN));
                        o[0] = eye[0]; o[1] = eye[1] - Y0; o[2] = eye[2];
                        for (const b of boxes) b.on = false;
                        set(plate, -1.3, -1.12, -1.3, 1.3, -1.03, 1.3);
                        // n: 積み上がった層の数。dir, f: 敷いている層の進む向きと、ノイズが固まりきった所の手前の端
                        let n = N, dir = 1, f = 9, top = 9;
                        if (tc < BUILT) {
                            n = Math.floor(tc / LAYER);
                            const u = Math.min((tc % LAYER) / LAYER, 1), y = -1 + n * H;
                            if (n) set(stack, -1, -1, -1, 1, y, 1);
                            dir = n % 2 ? -1 : 1; // 層ごとに向きを変えて往復する
                            const k = -1 + (2 + BAND) * u; // 0 → 2 + BAND 進む
                            if (k > -1) set(part, dir > 0 ? -1 : -Math.min(k, 1), y, -1, dir > 0 ? Math.min(k, 1) : 1, y + H, 1);
                            f = k;
                        } else {
                            if (tc >= FALL0) top = 1 + BAND - (2 + BAND) * Math.min((tc - FALL0) / FALL, 1); // 上から崩れる
                            if (top > -1) set(stack, -1, -1, -1, 1, Math.min(1, top), 1);
                        }
                        for (let r = 0; r < ROWS; r++) {
                            for (let c = 0; c < COLS; c++) {
                                let hits = 0, sum = 0, edge = 0, seam = 0, noise = 0;
                                for (let s = 0; s < 4; s++) {
                                    ray(R, HALF, c, r, s, d);
                                    let b = null;
                                    for (const x of boxes) if (x.on && hit(x) && (!b || x.h.t < b.h.t)) b = x; // 手前に当たった箱
                                    if (!b) continue;
                                    hits++;
                                    const h = b.h;
                                    nv[0] = nv[1] = nv[2] = 0;
                                    nv[h.ax] = h.sg;
                                    const v = lum(nv[0] * L[0] + nv[1] * L[1] + nv[2] * L[2]);
                                    if (b === plate) { sum += v * .4; continue; } // 台は暗く、線も引かない
                                    sum += v;
                                    for (let j = 0; j < 3; j++) p[j] = o[j] + h.t * d[j];
                                    // 敷いたばかりの所と、崩れている所は W と S のノイズ
                                    if ((b === part && p[0] * dir > f - BAND) || p[1] > top - BAND) { noise++; continue; }
                                    // 外の辺は明るい線、層と層の継ぎ目は少し明るい線
                                    let e = false;
                                    for (let j = 0; j < 3; j++) {
                                        if (j === h.ax || (Math.abs(p[j] - b.lo[j]) >= EDGE && Math.abs(p[j] - b.hi[j]) >= EDGE)) continue;
                                        // 下で別の層と接している所は、辺ではなく継ぎ目
                                        if (j === 1 && Math.abs(p[1] - b.lo[1]) < EDGE && p[1] > -1 + EDGE) continue;
                                        // 上に敷いている途中の層が乗っている所も、辺ではない
                                        if (j === 1 && b === stack && part.on && Math.abs(p[1] - b.hi[1]) < EDGE && p[0] >= part.lo[0] && p[0] <= part.hi[0]) continue;
                                        e = true;
                                    }
                                    if (e) { edge++; continue; }
                                    if (h.ax !== 1) for (let k = 1; k < N; k++) if (Math.abs(p[1] + 1 - k * H) < SEAM && p[1] < b.hi[1] - EDGE) seam++;
                                }
                                if (!hits) continue;
                                const i = (r * COLS + c) * 2;
                                if (noise >= 2) { cells[i] = -1; continue; }
                                const v = (sum / hits) * (.45 + .55 * (hits / 4)) * FACE;
                                cells[i] = seam >= 2 ? Math.min(FACE, v + .22) : v;
                                cells[i + 1] = edge / 4;
                            }
                        }
                    },
                };
            })();

            const SCENES = { works: printer, bots: bot, about: cap, sns: atMark };

            // 文字の見本帳: RAMP の文字を白で 1 枚に描いておき、マスごとに濃さ(globalAlpha)を付けて写す。
            // fillText を 1000 回近く呼ぶより、ずっと軽い。描く先の大きさが変わったら作り直す
            const GLYPHS = RAMP; // W と S のノイズも、この中の W と S を使う
            function atlasOf(tg, px) {
                if (tg.atlas && tg.atlasPx === px) return tg.atlas;
                const chh = px / ROWS, fs = chh * 1.02;
                const bw = Math.ceil(chh * 1.3), bh = Math.ceil(chh * 1.5); // 1 文字の枠(はみ出しても切れないよう広め)
                const c = document.createElement('canvas');
                c.width = bw * GLYPHS.length;
                c.height = bh;
                const ag = c.getContext('2d');
                ag.font = `600 ${fs.toFixed(2)}px ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace`;
                ag.textAlign = 'center';
                ag.textBaseline = 'middle';
                ag.fillStyle = 'rgb(236, 236, 236)';
                for (let i = 0; i < GLYPHS.length; i++) ag.fillText(GLYPHS[i], (i + .5) * bw, bh / 2);
                tg.atlas = { c, bw, bh, W: GLYPHS.indexOf('W'), S: GLYPHS.indexOf('S') };
                tg.atlasPx = px;
                return tg.atlas;
            }

            // 描く。due があれば、その時刻までのマスは W と S のノイズのまま(明るさが負のマスも同じノイズ)。
            // 描く先(tg)は、テレビの小さな画面か、各画面の頭の小さな画面
            function draw(tg, scene, t, due) {
                const { cvs, g } = tg;
                const S = cvs.clientWidth;
                if (!S) return;
                const px = Math.round(S * DPR);
                if (cvs.width !== px) cvs.width = cvs.height = px;
                const cw = px / COLS, chh = px / ROWS;
                const A = atlasOf(tg, px), ox = A.bw / 2, oy = A.bh / 2;
                const put = (k, a, c, r) => {
                    g.globalAlpha = a;
                    g.drawImage(A.c, k * A.bw, 0, A.bw, A.bh, Math.round((c + .5) * cw - ox), Math.round((r + .5) * chh - oy), A.bw, A.bh);
                };
                g.globalAlpha = 1;
                g.clearRect(0, 0, px, px);
                cells.fill(0);
                scene.shade(t);
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        const i = r * COLS + c;
                        let v = cells[i * 2];
                        // まだ形になっていない所と、形が崩れている所は W と S のノイズ
                        if ((due && t < due[i]) || v < 0) {
                            if (Math.random() >= .45) put(Math.random() < .5 ? A.W : A.S, .55, c, r);
                            continue;
                        }
                        if (!v) continue;
                        if (cells[i * 2 + 1] >= .25) v = .86 + .14 * cells[i * 2 + 1]; // 辺は S と W の明るい線
                        put(Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1))), .3 + .7 * v, c, r);
                    }
                }
                g.globalAlpha = 1;
            }

            // 動かし始めて、止める関数を返す。画面の外へスクロールして見えない間は描かない
            function run(tg, id) {
                const scene = SCENES[id];
                if (RM) {
                    draw(tg, scene, scene.t0);
                    return () => {};
                }
                const t0 = performance.now(), due = new Float32Array(COLS * ROWS).map(() => scene.t0 + 40 + Math.random() * 300);
                let last = -99, raf = 0, seen = true, stopped = false;
                const step = (now) => {
                    if (!seen) { raf = 0; return; }
                    raf = requestAnimationFrame(step);
                    if (document.hidden) return;
                    const t = now - t0;
                    if (t - last < 40) return; // 1 秒に 25 コマほど。文字が切り替わる感じを残す
                    last = t;
                    draw(tg, scene, t + scene.t0, t < 400 ? due : null);
                };
                const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
                    seen = es[es.length - 1].isIntersecting;
                    if (seen && !raf && !stopped) raf = requestAnimationFrame(step);
                }) : null;
                if (io) io.observe(tg.cvs);
                raf = requestAnimationFrame(step);
                return () => {
                    stopped = true;
                    cancelAnimationFrame(raf);
                    raf = 0;
                    if (io) io.disconnect();
                };
            }

            const tvTarget = { cvs, g };
            let stopTv = null;
            return {
                has: (id) => id in SCENES,
                start(id) {
                    miniBox.classList.add('is-3d');
                    if (stopTv) stopTv();
                    stopTv = run(tvTarget, id);
                },
                stop() {
                    if (stopTv) stopTv();
                    stopTv = null;
                    miniBox.classList.remove('is-3d');
                },
                // 各画面の頭の小さな画面に描く
                mount(canvas, id) {
                    return SCENES[id] ? run({ cvs: canvas, g: canvas.getContext('2d') }, id) : () => {};
                },
            };
        })();

        // チャンネルを替えると、W と S のノイズが絵にまとまる
        function miniShow(c) {
            miniStop();
            miniBox.classList.remove('is-dark');
            if (!c) {
                miniArt.textContent = wsNoise();
                if (!RM) miniTimer = setInterval(() => { miniArt.textContent = wsNoise(); }, 90);
                return;
            }
            if (mini3d.has(c.id)) {
                mini3d.start(c.id);
                return;
            }
            miniArt.textContent = `.-------.\n|  CH   |\n|   ${String(c.n).padEnd(4)}|\n'-------'`;
        }

        // 砂嵐: 黒地に白い W と S。3 枚を描いておいて切り替え、チャンネルを替えた瞬間だけ強く出す
        function makeFrames() {
            const k = Math.min(DPR, 1.5);
            const w = Math.round(screenEl.clientWidth * k), h = Math.round(screenEl.clientHeight * k);
            if (!w || !h || `${w}x${h}` === fKey) return;
            fKey = `${w}x${h}`;
            cvs.width = w;
            cvs.height = h;
            const cell = Math.max(7, Math.round(w / 64));
            frames = [0, 1, 2].map(() => {
                const c = document.createElement('canvas');
                c.width = w;
                c.height = h;
                const g = c.getContext('2d');
                g.font = `600 ${cell * .85}px ${FONT}`;
                g.textAlign = 'center';
                for (let y = 0; y < h / cell; y++) {
                    for (let x = 0; x < w / cell; x++) {
                        if (Math.random() < .25) continue;
                        g.fillStyle = `rgba(255,255,255,${(Math.random() ** 1.5 * .95).toFixed(2)})`;
                        g.fillText(Math.random() < .5 ? 'W' : 'S', (x + .5) * cell, (y + .5) * cell + cell * .3);
                    }
                }
                return c;
            });
        }
        function paint(now = performance.now()) {
            if (!frames.length) return;
            const burst = now < burstUntil;
            cvs.style.opacity = !on ? 0 : burst || !chan(ch) ? 1 : .08;
            const g = cvs.getContext('2d');
            g.clearRect(0, 0, cvs.width, cvs.height);
            const off = burst ? (Math.random() * cvs.height) | 0 : 0;
            g.drawImage(frames[fi], 0, off);
            if (off) g.drawImage(frames[fi], 0, off - cvs.height);
        }
        function loop(now) {
            raf = requestAnimationFrame(loop);
            if (now - lastF < 45) return;
            lastF = now;
            fi = (fi + 1) % 3;
            paint(now);
        }
        function start() {
            makeFrames();
            if (RM) paint();
            else if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
        }
        function stop() {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stop();
            else if (visible) start();
            snowSound();
        });

        // プロダクトの番組は、作品の画面を順に映す
        function reel() {
            clearInterval(reelTimer);
            const c = chan(ch);
            if (RM || !c || !c.prog.hasAttribute('data-reel')) return;
            const imgs = $$('img', c.prog), title = $('[data-reel-title]', c.prog);
            reelTimer = setInterval(() => {
                if (!on || !visible || document.hidden) return;
                const i = imgs.findIndex((im) => im.classList.contains('is-on'));
                const next = imgs[(i + 1) % imgs.length];
                burstUntil = performance.now() + 140;
                setTimeout(() => {
                    imgs.forEach((im) => im.classList.toggle('is-on', im === next));
                    if (title) title.textContent = next.dataset.title;
                }, 70);
            }, 2600);
        }

        // click: つまみのカチッも鳴らす(電源が入って映るときは、砂嵐のザッだけ)
        function tune(n, click = true) {
            if (!on) return;
            n = ((n - 1 + N) % N) + 1;
            ch = n;
            tunedAt = performance.now();
            const c = chan(n);
            sfx.play('static', RM ? 120 : 300);
            if (click) sfx.play('click');
            snowSound();
            chans.forEach((o) => o.prog.classList.remove('is-still'));
            knob.style.transform = `rotate(${ANG(n)}deg)`;
            burstUntil = tunedAt + (RM ? 0 : 300);
            if (!RM) {
                screenEl.classList.remove('is-tuning');
                void screenEl.offsetWidth;
                screenEl.classList.add('is-tuning');
            }
            clearTimeout(swapTimer);
            swapTimer = setTimeout(() => chans.forEach((o) => { o.prog.hidden = o !== c; }), RM ? 0 : 140);
            osd.innerHTML = c ? `${n}` : `${n}<small>準備中</small>`;
            osd.classList.add('is-on');
            clearTimeout(osdTimer);
            if (c) osdTimer = setTimeout(() => osd.classList.remove('is-on'), 2400);
            nums.forEach((b, i) => b.setAttribute('aria-current', i + 1 === n ? 'true' : 'false'));
            links.forEach((a) => (+a.dataset.ch === n ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
            screenEl.setAttribute('aria-label', c ? `${c.name}の画面へ` : `${n} チャンネルは準備中`);
            reel();
            miniShow(c);
            if (RM) paint();
        }

        // 最初に電源が入ったら、つまみを一度だけピクピクッと揺らして、回せることをそれとなく伝える
        let hinted = false;
        function hint() {
            if (hinted || RM) return;
            hinted = true;
            setTimeout(() => {
                knob.classList.add('is-hint');
                knob.addEventListener('animationend', () => knob.classList.remove('is-hint'), { once: true });
            }, 1900); // 先に画面へ目が行くので、少し間をおいてから
        }

        function powerOn(then) {
            if (on) return;
            const done = () => {
                screenEl.classList.remove('is-off', 'is-powering');
                on = true;
                tune(ch, false);
                if (typeof then === 'function') then();
                else hint();
            };
            sfx.play('power');
            if (RM) {
                done();
                return;
            }
            screenEl.classList.remove('is-powering');
            void screenEl.offsetWidth;
            screenEl.classList.add('is-powering');
            setTimeout(done, 320);
        }

        // その番組の画面へ。替えたばかりなら、番組が少し見えてから入る
        function watch(n = ch) {
            if (busy || waiting || root.classList.contains('is-intro')) return;
            // 電源が切れていたら、そのチャンネルに合わせて電源を入れ、映ってから入る
            if (!on) {
                ch = ((n - 1 + N) % N) + 1;
                waiting = true;
                powerOn(() => { waiting = false; watch(n); });
                return;
            }
            if (n !== ch) tune(n);
            const c = chan(n);
            if (!c) return;
            const rest = RM ? 0 : 420 - (performance.now() - tunedAt);
            if (rest > 0) {
                waiting = true;
                setTimeout(() => { waiting = false; watch(n); }, rest);
                return;
            }
            if (RM) {
                go(c.id);
                return;
            }
            // 番組を写しとった板を、画面の位置から全面まで拡大する(縦横比は保ったまま、はみ出す分は切れる)。
            // 全面になったら、その板が行き先の画面の、番組と同じ役目の部分(経歴なら端末)へ縮んでおさまる
            const { z, bd, r, full, at } = plate(c);
            busy = true;
            glitch.burst(160, r); // 写しの板に替わる瞬間も、グリッチでごまかす
            sfx.play('glitch', 140, .7);
            sfx.play('whoosh', 420);
            if (bd) bd.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.7, 0, .2, 1)', fill: 'forwards' });
            z.animate([
                { transform: `translate(${r.left}px, ${r.top}px) scale(1)`, borderRadius: '24px' },
                { transform: full, borderRadius: '0px' },
            ], { duration: 420, easing: 'cubic-bezier(.7, 0, .2, 1)', fill: 'forwards' }).finished.then(() => {
                busy = false;
                const shown = $('img.is-on', c.prog);
                if (!go(c.id, { morph: { z, bd, r, at, src: shown && shown.getAttribute('src') } })) {
                    z.remove();
                    if (bd) bd.remove();
                }
            });
        }

        // 番組を写しとった板(テレビの画面と同じ大きさ。左上を原点に動かす)。full は画面全体を覆うときの位置
        function plate(c) {
            const r = screenEl.getBoundingClientRect();
            const z = document.createElement('div');
            z.className = 'tv-zoom';
            z.style.cssText = `left:0;top:0;width:${r.width}px;height:${r.height}px;transform-origin:0 0;--tw:${tvEl.offsetWidth}px`;
            const p = c.prog.cloneNode(true);
            p.hidden = false;
            p.classList.add('is-still'); // 写しでは、端末の行を打ち直さない(いま見えている所のまま)
            $$('img', p).forEach((im) => { im.decoding = 'sync'; }); // 写した瞬間に絵が抜けないように
            const scan = document.createElement('span');
            scan.className = 'tv-scan';
            z.append(p, scan);
            document.body.appendChild(z);
            // 画面いっぱいに覆う倍率。縦長のスマホでは覆うと左右が大きくはみ出すので、
            // 幅に合わせて収め、上下の余りは番組と同じ色の幕で埋める
            const cover = Math.max(innerWidth / r.width, innerHeight / r.height);
            const fit = Math.min(innerWidth / r.width, innerHeight / r.height);
            let k = cover, bd = null;
            if (cover / fit > 1.15) {
                k = fit;
                bd = document.createElement('div');
                bd.className = 'tv-zoom-bd';
                const bg = getComputedStyle(p).backgroundColor;
                bd.style.background = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : '#0d0d0d';
                document.body.insertBefore(bd, z);
            }
            const fx = (innerWidth - r.width * k) / 2, fy = (innerHeight - r.height * k) / 2;
            return { z, bd, r, k, full: `translate(${fx}px, ${fy}px) scale(${k})`, at: { x: fx, y: fy, s: k, b: 0, rad: 0 } };
        }

        links.forEach((a) => {
            const n = +a.dataset.ch;
            a.addEventListener('click', (e) => {
                if (!root.classList.contains('is-world')) return;
                e.preventDefault();
                watch(n);
            });
            // パソコン: カーソルを合わせると試し見
            if (FINE) {
                a.addEventListener('pointerenter', () => {
                    clearTimeout(hoverTimer);
                    hoverTimer = setTimeout(() => { if (n !== ch) tune(n); }, 90);
                });
                a.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
            }
            a.addEventListener('focus', () => { if (n !== ch) tune(n); });
        });

        // 画面: 押すと入る。指で左右に払うとチャンネルが替わる
        let sx = 0, sy = 0, swiped = false;
        screenEl.addEventListener('touchstart', (e) => {
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
            swiped = false;
        }, { passive: true });
        screenEl.addEventListener('touchend', (e) => {
            const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
            if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.3) {
                swiped = true;
                tune(ch + (dx < 0 ? 1 : -1));
            }
        }, { passive: true });
        screenEl.addEventListener('click', () => {
            if (swiped) {
                swiped = false;
                return;
            }
            watch(ch);
        });

        // つまみ: 押すと次へ。ドラッグで回す
        let drag = null;
        knob.addEventListener('pointerdown', (e) => {
            const r = knob.getBoundingClientRect();
            drag = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, moved: false };
            knob.setPointerCapture(e.pointerId);
        });
        knob.addEventListener('pointermove', (e) => {
            if (!drag || Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 12) return;
            const a = (Math.atan2(e.clientX - drag.cx, drag.cy - e.clientY) * 180) / Math.PI;
            const n = clamp(Math.round(((a + 135) * (N - 1)) / 270) + 1, 1, N);
            if (n !== ch) {
                drag.moved = true;
                tune(n);
            }
        });
        const release = () => { setTimeout(() => { drag = null; }, 0); };
        knob.addEventListener('pointerup', release);
        knob.addEventListener('pointercancel', release);
        knob.addEventListener('click', () => {
            if (!drag || !drag.moved) tune(ch + 1);
        });

        // ホイール: ひと回しで 1 チャンネル(慣性の続きでは替えない)
        let wheelLock = false, wheelTimer = 0;
        tvEl.addEventListener('wheel', (e) => {
            if (!on) return;
            e.preventDefault();
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => { wheelLock = false; }, 220);
            if (wheelLock || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4) return;
            wheelLock = true;
            tune(ch + Math.sign(e.deltaY || e.deltaX));
        }, { passive: false });

        addEventListener('resize', () => { if (visible) start(); });

        // はじめは電源が切れている
        screenEl.classList.add('is-off');
        chans.forEach((c) => { c.prog.hidden = c.n !== ch; });
        knob.style.transform = `rotate(${ANG(ch)}deg)`;

        return {
            powerOn,
            // 端末の reboot: 電源を切った、はじめの状態にもどす(導入のあとで、また電源が入る)
            off() {
                on = false;
                waiting = false;
                clearTimeout(swapTimer);
                clearTimeout(osdTimer);
                clearInterval(reelTimer);
                miniStop();
                miniArt.textContent = '';
                miniBox.classList.add('is-dark');
                osd.classList.remove('is-on');
                screenEl.classList.remove('is-powering', 'is-tuning', 'is-jammed');
                screenEl.classList.add('is-off');
                burstUntil = 0;
                snowSound();
            },
            mini3d,
            screen: screenEl,
            // 砂嵐でうめる(on)/ 止めて、番組を少し揺らしてもどす(off)
            jam(jammed) {
                if (RM) return;
                screenEl.classList.toggle('is-jammed', jammed);
                burstUntil = jammed ? Infinity : performance.now() + 60;
                snowSound();
                if (!jammed) {
                    sfx.play('snap');
                    screenEl.classList.remove('is-tuning');
                    void screenEl.offsetWidth;
                    screenEl.classList.add('is-tuning');
                }
                paint();
            },
            // その画面を映しているチャンネルの番号(プロダクトの各作品は、プロダクトのチャンネル)
            channelOf(s) {
                const c = chans.find((o) => o.id === s.id || o.id === s.parent);
                return c ? c.n : 0;
            },
            // 画面の外から戻ってくるとき: 砂嵐も揺れもなく、そのチャンネルが映っている状態にする
            present(n) {
                const c = chan(n);
                if (!c) return;
                on = true;
                hinted = true;
                screenEl.classList.remove('is-off', 'is-powering', 'is-tuning');
                ch = n;
                tunedAt = performance.now();
                clearTimeout(swapTimer);
                chans.forEach((o) => { o.prog.hidden = o !== c; });
                c.prog.classList.add('is-still'); // 板と入れ替わったとき、端末の行が消えて打ち直されないように
                knob.style.transform = `rotate(${ANG(n)}deg)`;
                nums.forEach((b, i) => b.setAttribute('aria-current', i + 1 === n ? 'true' : 'false'));
                links.forEach((a) => (+a.dataset.ch === n ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
                screenEl.setAttribute('aria-label', `${c.name}の画面へ`);
                osd.classList.remove('is-on');
            },
            // チャンネルの番号を、画面の右上にしばらく出す
            osd(n) {
                osd.innerHTML = `${n}`;
                osd.classList.add('is-on');
                clearTimeout(osdTimer);
                osdTimer = setTimeout(() => osd.classList.remove('is-on'), 1800);
            },
            toggle(show) {
                visible = show;
                snowSound();
                if (!show) {
                    stop();
                    clearInterval(reelTimer);
                    miniStop();
                    return;
                }
                start();
                if (on) {
                    reel();
                    miniShow(chan(ch));
                }
                else if (!root.classList.contains('is-intro')) setTimeout(powerOn, RM ? 0 : 900);
            },
            key(e) {
                if (!on) return;
                const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
                if (step) {
                    e.preventDefault();
                    tune(ch + step);
                } else if (/^[1-9]$/.test(e.key) && +e.key <= N) {
                    tune(+e.key);
                } else if (e.key === 'Enter' && !e.target.closest('a, button')) {
                    watch(ch);
                }
            },
        };
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
        sample.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font:${MARK_WEIGHT} 100px ${MARK_FONT}`;
        document.body.appendChild(sample);
        let last = 0;
        new ResizeObserver(() => {
            if (sample.offsetWidth === last) return;
            last = sample.offsetWidth;
            fitMark();
        }).observe(sample);
    }
    fontsReady.then(fitMark);

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
                    if (!btn.classList.contains('is-active')) return; // 読み込む間に、別のサムネが押された
                    media.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
                    img.src = btn.dataset.src;
                    img.alt = btn.dataset.alt;
                    flicker(media);
                    sfx.play('static', 110, .5);
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

    /* 版を替えるとき: ビデオの早送り・巻きもどしのように、画面が W と S の砂嵐になって流れ、
       左上に ◀◀ v1(古い版へ)/ ▶▶ v3(新しい版へ)と出る。砂嵐が引くと、新しい版の画面がちらついて出る */
    const travel = (media, label, back) => {
        $$('.gen-snow, .gen-osd', media).forEach((el) => el.remove());
        clearInterval(media._snow);
        clearTimeout(media._snowEnd); // 前の切り替えの「砂嵐を引く」合図が、新しい砂嵐を早く止めないように
        clearTimeout(media._osd);
        const osd = document.createElement('span');
        osd.className = 'gen-osd';
        osd.setAttribute('aria-hidden', 'true');
        osd.textContent = `${back ? '◀◀' : '▶▶'} ${label}`;
        media.append(osd);
        sfx.play(RM ? 'snap' : 'tape', back);
        const done = () => {
            osd.textContent = label;
            media._osd = setTimeout(() => osd.classList.add('is-out'), 900);
            osd.addEventListener('transitionend', () => osd.remove(), { once: true });
        };
        if (RM) return done();
        const snow = document.createElement('span');
        snow.className = `gen-snow${back ? ' is-back' : ''}`;
        snow.setAttribute('aria-hidden', 'true');
        media.append(snow);
        // 1 文字の幅は書体で変わるので、実際に測ってから数を決める(足りないと右端が切れる)
        const probe = document.createElement('span');
        probe.textContent = 'W'.repeat(40);
        snow.append(probe);
        const cw = (probe.getBoundingClientRect().width / 40) || 4.5;
        probe.remove();
        const r = media.getBoundingClientRect();
        const cols = Math.ceil(r.width / cw) + 4, rows = Math.ceil(r.height / 8) + 2;
        const fill = () => {
            let t = '';
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const v = Math.random();
                    t += v < .3 ? 'W' : v < .6 ? 'S' : ' ';
                }
                t += '\n';
            }
            snow.textContent = t;
        };
        fill();
        media._snow = setInterval(fill, 50);
        media._snowEnd = setTimeout(() => {
            clearInterval(media._snow);
            snow.classList.add('is-out');
            setTimeout(() => snow.remove(), 200);
            flicker(media);
            done();
        }, 480);
    };

    $$('[data-tabs]').forEach((list) => {
        const tabs = $$('[role="tab"]', list);
        // 使っているもの: 版によって違う行(data-gen)は、選んだ版の分だけ出す
        const genRows = (tab) => {
            const v = $('.gen-v', tab)?.textContent.trim();
            const body = list.closest('.screen');
            if (v && body) $$('[data-gen]', body).forEach((row) => { row.hidden = !row.dataset.gen.split(' ').includes(v); });
        };
        const select = (tab, focus) => {
            const from = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
            const to = tabs.indexOf(tab);
            tabs.forEach((t) => {
                const on = t === tab;
                t.setAttribute('aria-selected', on);
                t.tabIndex = on ? 0 : -1;
                const panel = document.getElementById(t.getAttribute('aria-controls'));
                panel.hidden = !on;
                if (on && from !== to) travel($('.media', panel), $('.gen-v', t).textContent.trim(), to < from);
            });
            genRows(tab);
            if (focus) tab.focus();
        };
        tabs.forEach((tab) => tab.addEventListener('click', () => select(tab)));
        const initial = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
        if (initial) genRows(initial);
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
       経歴の端末: 最後の行に打ちこめる。help で一覧(載せていないコマンドもある。sl とか)。
       見えない <input> を最後の行に重ねて、打った文字とカーソルは端末の書き方で見せる。
       画面に入り直すと、打った分は消えて元の表示にもどる
       ---------------------------------------------------------------------- */
    (() => {
        const term = $('#about [data-term]');
        const line = term && $('.term-prompt', term);
        if (!line) return;
        const input = $('.term-input', line), typed = $('.term-typed', line);
        const PS = $('.ps', line).outerHTML;
        const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        let hist = [], hi = 0, running = false;

        const put = (html, cls = 'tl-out') => {
            const p = document.createElement('p');
            p.className = `tl is-live ${cls}`;
            p.innerHTML = html;
            line.before(p);
            return p;
        };
        const pre = (text, cls = '') => put(esc(text), `tl-out tl-pre ${cls}`);
        const show = () => line.scrollIntoView({ block: 'nearest' });
        const sync = () => {
            typed.textContent = input.value;
            line.classList.toggle('has-text', !!input.value);
            input.setSelectionRange(input.value.length, input.value.length);
        };

        const WORKS = { 'nagai-kotoba-database': 'work-nagai', 'wsws-bookshelf': 'work-bookshelf', romberg: 'work-romberg', 'nagai-kotoba-bot': 'bots' };
        const worksLs = () => put(Object.entries(WORKS).map(([n, id]) => `<a href="#${id}" data-go="${id}">${n}/</a>`).join(''), 'tl-out term-ls');
        const FILES = {
            'career.txt': '2026.04  東京の IT 企業で働きはじめる\n2024.04  岡山大学大学院 環境生命自然科学研究科\n2020.04  岡山大学 工学部 情報系学科\n2001.04  オギャー',
            'now.txt': "仕事のかたわら、個人でウェブサイトや bot を作っています。読んだ本は WSWS'S BOOKSHELF. に記録しています。",
        };
        const age = () => {
            const d = new Date();
            return d.getFullYear() - 2001 - (d.getMonth() < 3 ? 1 : 0);
        };

        const CMDS = {
            help() {
                pre('使えるコマンド:\n  ls  cat  cd  whoami  pwd  date  echo  history  clear  neofetch  git log  reboot  exit');
                put('# ほかにもあるかもしれない', 'tl-comment');
            },
            ls(a) {
                const t = (a[0] || '').replace(/\/$/, '');
                if (t === 'works') return worksLs();
                if (t === 'skills') return pre('backend/  database/  frontend/  infra/  nlp/');
                if (t && !Object.hasOwn(FILES, t) && t !== 'research.txt') return pre(`ls: '${t}' にアクセスできない: そのようなファイルやディレクトリはない`);
                put('career.txt  now.txt  research.txt  <b class="tl-dir">skills/</b>  <b class="tl-dir">works/</b>', 'tl-out tl-pre');
            },
            cat(a) {
                const f = a[0];
                if (!f) return pre('cat: ファイル名がない');
                if (f === 'research.txt') {
                    pre('大学院では、自然言語処理を研究していました。\nBERT とか、Transformer の LLM とかを、PyTorch で動かしていました。');
                    return put('テーマ: <span class="redact" style="--w:9em"><span class="sr-only">非公開</span><span aria-hidden="true">WSWSWSWSWSWS</span></span>');
                }
                if (/^(works|skills)\/?$/.test(f)) return pre(`cat: ${f}: ディレクトリだ`);
                pre(Object.hasOwn(FILES, f) ? FILES[f] : `cat: ${f}: そのようなファイルはない`);
            },
            cd(a) {
                const t = (a[0] || '').replace(/^(\.\/)?(works\/)?/, '').replace(/\/$/, '');
                if (!t || t === '~' || t === '.') return;
                if (t === '..' || t === '/') return CMDS.exit();
                if (Object.hasOwn(WORKS, t)) return go(WORKS[t], { origin: centerOf(line) });
                if (t === 'works' || t === 'skills') return pre(`cd: 中身は ls ${t} で見られる`);
                pre(`cd: ${t}: そのようなディレクトリはない`);
            },
            whoami: () => pre('わそわそ'),
            pwd: () => pre('/home/wsws'),
            hostname: () => pre('works'),
            uname: () => pre('WSWS.WORKS'),
            date: () => pre(new Date().toLocaleString('ja-JP', { dateStyle: 'full', timeStyle: 'medium' })),
            echo: (a) => pre(a.join(' ')),
            history: () => pre(hist.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n') || ''),
            clear() {
                $$('.is-live', term).forEach((el) => el.remove());
                term.classList.add('is-cleared');
            },
            neofetch() {
                const art = ['W   W  SSSS', 'W   W  S   ', 'W W W  SSSS', 'WW WW     S', 'W   W  SSSS'];
                const info = ['<b class="tl-user">wsws</b>@<b class="tl-user">works</b>', '----------', '<b class="tl-key">OS</b>: WSWS.WORKS', '<b class="tl-key">Host</b>: 東京', `<b class="tl-key">Uptime</b>: ${age()} years`, '<b class="tl-key">Shell</b>: wsh(たぶん動く)'];
                const n = Math.max(art.length, info.length);
                put(Array.from({ length: n }, (_, i) => `<span class="tl-art">${(art[i] || '').padEnd(11)}</span>   ${info[i] || ''}`).join('\n'), 'tl-out tl-pre');
            },
            git(a) {
                if (a[0] !== 'log') return pre(a[0] ? `git: '${a[0]}' は git のコマンドではない` : 'usage: git log');
                put([['3f9a2c1', '2026.04', '東京の IT 企業で働きはじめる', true], ['8b1e7d4', '2026.03', '岡山大学大学院 修了'], ['c27a5f0', '2024.04', '岡山大学大学院に進学'], ['e91d2b6', '2024.03', '岡山大学 卒業'], ['5d40e9b', '2020.04', '岡山大学に入学'], ['0a6c3e8', '2020.03', '大阪の高校を卒業'], ['0000001', '2001.04', 'オギャー']]
                    .map(([h, d, t, head]) => `<span class="tl-git">*</span> <span class="glog-hash">${h}</span>${head ? ' <span class="glog-ref">(<span class="glog-head">HEAD -&gt;</span> <span class="glog-branch">main</span>)</span>' : ''} ${d} ${t}`).join('\n'), 'tl-out tl-pre');
            },
            exit: () => go(cur.parent || 'top'),
            // トップにもどって、導入をノイズからもう一度(音を入れていれば音付き)
            reboot() {
                pre('Broadcast message from wsws@works:\n\nThe system is going down for reboot NOW!');
                running = true;
                input.disabled = true;
                setTimeout(() => {
                    running = false;
                    input.disabled = false;
                    if (!rebootSite()) {
                        pre('reboot: いまは再起動できない');
                        input.focus({ preventScroll: true });
                    }
                }, RM ? 0 : 700);
            },
            // 載せていないもの
            sl,
            sudo: () => pre('wsws is not in the sudoers file. This incident will be reported.'),
            rm: () => pre('rm: やめておいた'),
            vim: () => pre('前に開いて、出られなくなった。今回は開かない'),
            mecab: () => pre('mecab: ここには入っていない(長い言葉のデータベースのサーバーにはいる)'),
            claude: () => pre('ここにはいない。いつもは隣の端末にいる'),
            man: (a) => pre(`${a[0] || 'man'} の説明書はない。触ればわかる(わからない)`),
        };
        CMDS.vi = CMDS.nvim = CMDS.vim;
        CMDS.cls = CMDS.clear;
        CMDS.logout = CMDS.exit;

        // sl: 汽車が右から左へ走り抜ける。煙は W と S。走っている間は打てない(本物の sl も止められない)
        function sl() {
            const SMOKE = [
                ['        (W)   ( S )    (WS)     ( W )', '    (S)     (W)'],
                ['      ( S )    (WS)    ( W )   (S)', '     (W)     ( S )'],
            ];
            const BODY = [
                '     ___',
                '    |   |              _______',
                ' ___|___|_____________|  [ ]  |      __________________________',
                '|  WSWS.WORKS EXPRESS |       |=====|  [ ]   [ ]   [ ]   [ ]   |',
                '|_____________________________|=====|__________________________|',
                ' \\__(O)==(O)==(O)______(O)___/         (O)  (O)        (O)  (O)',
            ];
            const SPOKES = ['(|)', '(/)', '(-)', '(\\)'];
            const W = Math.max(...BODY.map((l) => l.length));
            const frame = (k) => [...SMOKE[(k >> 2) % 2], ...BODY.map((l) => l.replaceAll('(O)', SPOKES[k % 4]))].map((l) => l.padEnd(W)).join('\n');
            const track = put('', 'term-sl-track');
            const car = document.createElement('span');
            car.className = 'term-sl';
            car.setAttribute('aria-hidden', 'true');
            track.append(car);
            put('# 汽車が通っていった', 'tl-comment sr-only');
            const ch = (() => {
                const m = document.createElement('span');
                m.textContent = '0'.repeat(20);
                track.append(m);
                const w = m.getBoundingClientRect().width / 20;
                m.remove();
                return w || 8;
            })();
            const cols = Math.ceil(track.clientWidth / ch);
            running = true;
            input.disabled = true;
            show();
            // 走り抜ける長さ(1 コマで RM なら 4 マス・60 ミリ秒、ふだんは 1 マス・28 ミリ秒)と、煙が替わる速さ(4 コマ)に合わせる
            const tick = RM ? 60 : 28, frames = Math.ceil((cols + W) / (RM ? 4 : 1));
            sfx.play('train', frames * tick, (tick * 4) / 1000);
            return new Promise((done) => {
                let x = cols, k = 0;
                const step = () => {
                    car.textContent = frame(k++);
                    car.style.transform = `translateX(${x * ch}px)`;
                    x -= RM ? 4 : 1;
                    if (x > -W) setTimeout(step, RM ? 60 : 28);
                    else {
                        track.remove();
                        running = false;
                        input.disabled = false;
                        input.focus({ preventScroll: true });
                        done();
                    }
                };
                step();
            });
        }

        function run(raw) {
            const cmd = raw.trim();
            put(`${PS} ${esc(raw)}`, '');
            if (cmd) {
                hist.push(cmd);
                const [name, ...args] = cmd.split(/\s+/);
                const f = Object.hasOwn(CMDS, name) ? CMDS[name] : null;
                if (f) f(args);
                else pre(`${name}: コマンドが見つからない`);
            }
            hi = hist.length;
            show();
        }

        // Tab: コマンド名とファイル名を補う
        function complete() {
            const v = input.value, parts = v.split(/\s+/), last = parts.pop();
            const pool = parts.length ? ['career.txt', 'now.txt', 'research.txt', 'skills/', 'works/', ...Object.keys(WORKS).map((n) => `works/${n}/`)] : ['ls', 'cat', 'cd', 'whoami', 'pwd', 'date', 'echo', 'history', 'clear', 'neofetch', 'git', 'reboot', 'exit', 'help'];
            const hits = pool.filter((p) => p.startsWith(last));
            if (hits.length === 1) input.value = [...parts, hits[0]].join(' ') + (hits[0].endsWith('/') ? '' : ' ');
            else if (hits.length > 1) {
                put(`${PS} ${esc(v)}`, '');
                pre(hits.join('  '));
            }
            sync();
        }

        input.addEventListener('input', () => {
            sfx.play('key');
            sync();
        });
        input.addEventListener('keydown', (e) => {
            if (running) return e.preventDefault();
            if (e.key === 'Enter') {
                e.preventDefault();
                sfx.play('key', true);
                const v = input.value;
                input.value = '';
                sync();
                run(v);
            } else if (e.key === 'Tab' && input.value) {
                e.preventDefault();
                sfx.play('key');
                complete();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                sfx.play('key');
                hi = clamp(hi + (e.key === 'ArrowUp' ? -1 : 1), 0, hist.length);
                input.value = hist[hi] || '';
                sync();
            } else if (e.key === 'l' && e.ctrlKey) {
                e.preventDefault();
                sfx.play('key');
                CMDS.clear();
            } else if (e.key === 'c' && e.ctrlKey && !getSelection().toString()) {
                e.preventDefault();
                sfx.play('key');
                put(`${PS} ${esc(input.value)}^C`, '');
                input.value = '';
                sync();
            } else if (e.key === 'Escape') input.blur();
        });
        ['keyup', 'click', 'select'].forEach((t) => input.addEventListener(t, sync));
        input.addEventListener('focus', () => term.classList.add('is-focus'));
        input.addEventListener('blur', () => term.classList.remove('is-focus'));
        // 端末のどこを押しても打てるように(リンクを押したときと、文字を選んだときは除く)
        term.addEventListener('click', (e) => {
            if (e.target.closest('a, button, .redact') || getSelection().toString()) return;
            input.focus({ preventScroll: true });
        });
        // 画面に入り直したら、元の表示にもどす
        term.addEventListener('term:reset', () => {
            if (running) return;
            $$('.is-live', term).forEach((el) => el.remove());
            term.classList.remove('is-cleared');
            input.value = '';
            sync();
            hi = hist.length;
        });
    })();

    /* ----------------------------------------------------------------------
       ボット: 次の投稿(毎時 0 分、日本時間)までの残りと、今日の 24 回のうち済んだ回。
       1 秒ごとに書き換える(タブが見えていないときは休む)
       ---------------------------------------------------------------------- */
    (() => {
        const box = $('[data-bot-clock]');
        if (!box) return;
        const left = $('[data-bot-left]', box), cells = $$('.bot-hours li', box);
        const tick = () => {
            if (document.hidden) return;
            const jst = new Date(Date.now() + 9 * 3600e3); // UTC の関数で読むと日本時間になる
            const h = jst.getUTCHours(), rest = (3600 - jst.getUTCMinutes() * 60 - jst.getUTCSeconds()) % 3600; // ちょうど 0 分は 00:00
            left.textContent = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
            cells.forEach((c, i) => {
                c.classList.toggle('is-done', i <= h);
                c.classList.toggle('is-next', i === (h + 1) % 24 && h < 23);
            });
        };
        setInterval(tick, 1000);
        tick();
    })();

    /* ----------------------------------------------------------------------
       テレビの登場(トップから始まる導入のとき):
       小さな W と S が四方から集まってテレビの形をつくり(画面は濃く、筐体は薄く)、
       上から下へ走査するように本物のテレビへ描き変わる
       ---------------------------------------------------------------------- */
    // CSS の cubic-bezier と同じ曲線。x から y を表で引く
    const bezier = (x1, y1, x2, y2) => {
        const xs = [], ys = [];
        for (let i = 0; i <= 64; i++) {
            const t = i / 64, u = 1 - t;
            xs.push(3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3);
            ys.push(3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3);
        }
        return (x) => {
            if (x <= 0) return 0;
            if (x >= 1) return 1;
            let i = 1;
            while (xs[i] < x) i++;
            return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1] || 1);
        };
    };

    function assembleTv() {
        const tvEl = $('.tv');
        if (RM || !tvEl || !tvEl.getClientRects().length) return Promise.resolve();
        tvEl.classList.add('is-assembling');
        return new Promise((done) => {
            /* 2 段階で細かくなる。
               ① 粗い W と S が飛んできて集まる → ② 半分の大きさの W と S に割れ、くっきりしたテレビの絵で一度止まる →
               上から本物に描き変える(さらに細かい灰色の点の段階は、のっぺりするので入れない) */
            const C1 = Math.max(8, 2 * Math.round((cellSize() * .8) / 2)); // 2 で割り切れる大きさにして、半分に割る
            const SIZES = [C1, C1 / 2];
            const box = tvEl.getBoundingClientRect();
            const rectOf = (sel) => $(sel, tvEl).getBoundingClientRect();
            const body = rectOf('.tv-body'), dial = rectOf('.tv-dial');
            const knob = $('.tv-knob', tvEl), tw = body.width;
            const x0 = box.left - C1, y0 = box.top - C1;
            const EW = (Math.ceil(box.width / C1) + 2) * C1, EH = (Math.ceil(box.height / C1) + 2) * C1; // 絵の範囲

            // 部品の形と濃さ(0 は白、1 は黒)。あとに描く部品ほど上に来る。c はマスの大きさで、縁取りは 1 マス分
            const rr = (g, r, rad, inset = 0) => {
                g.beginPath();
                const x = r.left - x0 + inset, y = r.top - y0 + inset, w = r.width - inset * 2, h = r.height - inset * 2;
                if (g.roundRect) g.roundRect(x, y, w, h, Math.max(0, rad - inset));
                else g.rect(x, y, w, h);
                g.fill();
            };
            const text = (g, el, str, align = 'left') => {
                const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
                g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
                g.textAlign = align;
                g.textBaseline = 'middle';
                g.fillText(str, (align === 'center' ? r.left + r.width / 2 : r.left) - x0, r.top + r.height / 2 - y0);
            };
            const knobAng = (parseFloat((knob.style.transform.match(/rotate\(([-\d.]+)deg/) || [])[1]) || 0) * Math.PI / 180;
            const regions = [
                // 脚は筐体の下面から生えていて、上の端は筐体に隠れる。先に描いて、筐体で上書きする
                [.55, (g) => $$('.tv-leg', tvEl).forEach((leg) => {
                    const rod = $('.tv-leg-rod', leg).getBoundingClientRect();
                    const s = leg.classList.contains('is-right') ? -1 : 1; // 左の脚は左下へ、右の脚は右下へ開く
                    g.lineWidth = tw * .024;
                    g.beginPath();
                    g.moveTo((s > 0 ? rod.right - tw * .015 : rod.left + tw * .015) - x0, rod.top - y0);
                    g.lineTo((s > 0 ? rod.left + tw * .01 : rod.right - tw * .01) - x0, rod.bottom - y0);
                    g.stroke();
                })],
                [.45, (g) => rr(g, body, tw * .045)], // 筐体の縁
                [.13, (g, c) => rr(g, body, tw * .045, c)], // 筐体
                [.42, (g) => { const sp = $('.tv-grille span', tvEl), r = rectOf('.tv-grille'), lh = r.height / 3;
                    g.save(); g.beginPath(); g.rect(r.left - x0, r.top - y0, r.width, r.height); g.clip();
                    const cs = getComputedStyle(sp);
                    g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; g.textBaseline = 'middle'; g.textAlign = 'left';
                    for (let i = 0; i < 3; i++) g.fillText('WSWS'.repeat(12), r.left - x0 - (i % 2) * lh * .7, r.top - y0 + lh * (i + .5));
                    g.restore(); }],
                [.5, (g) => { const r = rectOf('.tv-brand'); g.fillRect(r.left - x0, r.top + r.height * .25 - y0, r.width, r.height * .5); }], // 銘板(小さすぎて字にならないので帯で)
                [.5, (g) => $$('.tv-num', tvEl).forEach((n) => text(g, n, n.textContent, 'center'))],
                [.85, (g) => rr(g, rectOf('.tv-mini'), tw * .018)],
                [.97, (g, c) => rr(g, rectOf('.tv-mini-screen'), tw * .011, Math.min(c * .3, 1))],
                [.5, (g) => { g.beginPath(); g.arc(dial.left + dial.width / 2 - x0, dial.top + dial.height / 2 - y0, knob.offsetWidth / 2, 0, Math.PI * 2); g.fill(); }], // つまみの縁
                [.2, (g, c) => { g.beginPath(); g.arc(dial.left + dial.width / 2 - x0, dial.top + dial.height / 2 - y0, Math.max(0, knob.offsetWidth / 2 - c), 0, Math.PI * 2); g.fill(); }],
                [.9, (g) => { // つまみの針
                    const k = knob.getBoundingClientRect(), r = k.width / 2, cx = k.left + r - x0, cy = k.top + r - y0;
                    g.lineWidth = Math.max(3, r * .12); g.lineCap = 'round';
                    g.beginPath();
                    g.moveTo(cx + Math.sin(knobAng) * r * .25, cy - Math.cos(knobAng) * r * .25);
                    g.lineTo(cx + Math.sin(knobAng) * r * .88, cy - Math.cos(knobAng) * r * .88);
                    g.stroke(); }],
                [.85, (g) => rr(g, rectOf('.tv-screen-frame'), tw * .05)], // 画面の縁
                [.97, (g) => rr(g, rectOf('.tv-screen'), tw * .045)], // ブラウン管
            ];
            // マスの大きさ c ごとに、各マスの濃さを決める
            const levelsAt = (c) => {
                const cols = EW / c, rows = EH / c, level = new Float32Array(cols * rows);
                const m = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
                m.canvas.width = cols;
                m.canvas.height = rows;
                regions.forEach(([a, draw]) => {
                    m.setTransform(1, 0, 0, 1, 0, 0);
                    m.clearRect(0, 0, cols, rows);
                    m.setTransform(1 / c, 0, 0, 1 / c, 0, 0);
                    m.fillStyle = m.strokeStyle = '#000';
                    draw(m, c);
                    const d = m.getImageData(0, 0, cols, rows).data;
                    for (let i = 0; i < level.length; i++) if (d[i * 4 + 3] > 100) level[i] = a;
                });
                return { c, cols, rows, level };
            };
            const L = SIZES.map(levelsAt);

            // ① 粗い文字はテレビの中心から外へ向かう方へ散らばっていて、内へギュッと集まる
            const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
            const far = Math.hypot(innerWidth, innerHeight);
            const ps = [];
            L[0].level.forEach((a, i) => {
                if (!a) return;
                const tx = x0 + ((i % L[0].cols) + .5) * C1, ty = y0 + (((i / L[0].cols) | 0) + .5) * C1;
                const ang = Math.atan2(ty - cy, tx - cx) + rand(-.9, .9), d = rand(.18, .6) * far;
                ps.push({ i, tx, ty, sx: tx + Math.cos(ang) * d, sy: ty + Math.sin(ang) * d,
                    a, k: Math.random() < .5 ? 0 : 1, delay: rand(0, 520), dur: rand(850, 1150) });
            });

            const sprite = (ch, c) => {
                const s = document.createElement('canvas');
                s.width = s.height = Math.ceil(c * DPR);
                const g = s.getContext('2d');
                g.scale(DPR, DPR);
                g.font = `800 ${c * .94}px ${FONT}`;
                g.textAlign = 'center';
                g.fillStyle = '#111';
                g.fillText(ch, c / 2, c * .84);
                return s;
            };
            const spr = [sprite('W', C1), sprite('S', C1)];

            // ② の絵は止まっているので、先に描いておく(位置はテレビの左上からの相対)
            const sheet = () => {
                const s = document.createElement('canvas');
                s.width = Math.round(EW * DPR);
                s.height = Math.round(EH * DPR);
                const g = s.getContext('2d');
                g.scale(DPR, DPR);
                return { s, g };
            };
            // 点ごとに直接書きこむ(文字や四角を何万回も描くより、ずっと速い)
            const paint = (lv, put) => {
                const sh = sheet(), w = sh.s.width, h = sh.s.height, img = sh.g.createImageData(w, h), px = img.data;
                const c = lv.c * DPR;
                lv.level.forEach((a, i) => {
                    if (!a) return;
                    const cx = i % lv.cols, cy = (i / lv.cols) | 0;
                    const xa = Math.round(cx * c), xb = Math.min(w, Math.round((cx + 1) * c));
                    const ya = Math.round(cy * c), yb = Math.min(h, Math.round((cy + 1) * c));
                    const k = Math.random() < .5 ? 0 : 1;
                    for (let y = ya; y < yb; y++) {
                        for (let x = xa; x < xb; x++) put(px, (y * w + x) * 4, a, (x - xa) / (xb - xa), (y - ya) / (yb - ya), k);
                    }
                });
                sh.g.putImageData(img, 0, 0);
                return sh;
            };
            // ② 半分の大きさの W と S(文字の形は、一度だけ描いた見本から写す)
            const glyphs = ['W', 'S'].map((ch) => {
                const sp = sprite(ch, SIZES[1]);
                return { n: sp.width, d: sp.getContext('2d').getImageData(0, 0, sp.width, sp.height).data };
            });
            const mid = paint(L[1], (px, o, a, u, v, k) => {
                const gl = glyphs[k], al = gl.d[(((v * gl.n) | 0) * gl.n + ((u * gl.n) | 0)) * 4 + 3];
                if (!al) return;
                px[o] = px[o + 1] = px[o + 2] = 17;
                px[o + 3] = al * a;
            });
            // 細かくなる順番: 粗いマスごとに時刻を決め、その中の細かいマスも同じ時刻で替わる
            const RE1 = 700; // ① → ② にかける時間
            const due1 = new Float32Array(L[0].level.length).map(() => rand(0, RE1));
            const shown1 = new Uint8Array(due1.length);
            // どのマスが細かくなったかの印(1 マス 1 点の小さな画像)。これを引き伸ばして ② の絵を切り抜く
            const maskOf = (lv) => {
                const c = document.createElement('canvas');
                c.width = lv.cols;
                c.height = lv.rows;
                const g = c.getContext('2d');
                return { c, g, img: g.createImageData(lv.cols, lv.rows), dirty: false };
            };
            const m1 = maskOf(L[0]);
            const mark = (m, i) => { m.img.data[i * 4 + 3] = 255; m.dirty = true; };
            const view = sheet(), tmp = sheet(); // いま見えている ② の絵

            const cvs = document.createElement('canvas');
            cvs.className = 'tv-assemble';
            cvs.setAttribute('aria-hidden', 'true');
            const W = innerWidth, H = innerHeight;
            cvs.width = Math.round(W * DPR);
            cvs.height = Math.round(H * DPR);
            document.body.appendChild(cvs);
            const g = cvs.getContext('2d');

            const fly = bezier(.7, 0, .2, 1); // 溜めて、一気に寄って、ピタッと止まる(ロゴの W と同じ調子)
            const sweep = bezier(.45, 0, .55, 1);
            const GATHER = ps.reduce((mx, p) => Math.max(mx, p.delay + p.dur), 0);
            const T1 = GATHER + 180, SCAN = 700; // 細かくなり始める時刻
            const TS = T1 + RE1 * .75; // 描き変え始める時刻。全部が細かくなりきる前(7〜8 割ほど)に始める
            const t0 = performance.now();
            let raf = 0, shown = false, ended = false;
            const hush = sfx.play('introTv', { gather: GATHER / 1000, t1: T1 / 1000, re1: RE1 / 1000, ts: TS / 1000, scan: SCAN / 1000 });

            const finish = (e) => {
                if (ended) return;
                ended = true;
                if (e) hush(.05); // 画面の大きさが変わって打ち切ったとき
                cancelAnimationFrame(raf);
                removeEventListener('resize', finish);
                cvs.remove();
                tvEl.style.clipPath = '';
                tvEl.classList.remove('is-assembling');
                tvEl.classList.add('is-assembled');
                // 画面のほかの部品がちらつき終わってから、ふつうの状態にもどす
                const settle = () => {
                    if (tvEl.closest('.is-revealing')) setTimeout(settle, 100);
                    else tvEl.classList.remove('is-assembled');
                };
                settle();
                done();
            };
            addEventListener('resize', finish);

            // 印のついたマスだけ、絵 src を残して dst に重ねる
            const masked = (dst, src, m, cut) => {
                tmp.g.globalCompositeOperation = 'copy';
                tmp.g.drawImage(src.s, 0, 0, EW, EH);
                tmp.g.globalCompositeOperation = 'destination-in';
                tmp.g.imageSmoothingEnabled = false;
                tmp.g.drawImage(m.c, 0, 0, EW, EH);
                if (cut) {
                    tmp.g.globalCompositeOperation = 'destination-out';
                    tmp.g.drawImage(cut.c, 0, 0, EW, EH);
                }
                tmp.g.globalCompositeOperation = 'source-over';
                dst.g.drawImage(tmp.s, 0, 0, EW, EH);
            };

            const frame = (now) => {
                const t = now - t0;
                const b = tvEl.getBoundingClientRect();
                const ox = b.left - box.left, oy = b.top - box.top; // 途中でスクロールしても形がずれないように
                g.setTransform(DPR, 0, 0, DPR, 0, 0);
                g.clearRect(0, 0, W, H);

                // ① → ②: 粗いマスが、時刻が来たものから半分の文字に割れる
                if (t >= T1) due1.forEach((d, i) => { if (!shown1[i] && t - T1 >= d) { shown1[i] = 1; mark(m1, i); } });
                if (m1.dirty) {
                    m1.g.putImageData(m1.img, 0, 0);
                    m1.dirty = false;
                    view.g.clearRect(0, 0, EW, EH);
                    masked(view, mid, m1);
                }

                // 組み上がったら、上から下へ本物のテレビに描き変える
                let scan = -Infinity;
                if (t >= TS) {
                    const s = sweep((t - TS) / SCAN);
                    if (s >= 1) return finish();
                    scan = box.top + (box.height + C1) * s;
                    if (!shown) {
                        shown = true;
                        tvEl.classList.remove('is-assembling');
                        tvEl.classList.add('is-assembled');
                    }
                    tvEl.style.clipPath = `inset(-20% -20% ${(b.bottom - scan - oy).toFixed(1)}px -20%)`;
                }

                // ② の絵(描き変え線より下だけ)
                const top = Math.max(0, scan - y0);
                if (top < EH) {
                    g.globalAlpha = 1;
                    const sy = Math.round(top * DPR);
                    g.drawImage(view.s, 0, sy, view.s.width, view.s.height - sy, x0 + ox, y0 + oy + sy / DPR, EW, EH - sy / DPR);
                }
                if (scan > -Infinity) {
                    g.globalAlpha = .55;
                    g.fillStyle = '#111';
                    g.fillRect(body.left + ox, scan + oy - .75, body.width, 1.5);
                }

                // ① の粗い文字(まだ割れていないものだけ)
                const dim = t > GATHER + 40 && t < GATHER + 80 ? .35 : 1; // 組み上がった瞬間に一度ちらつく
                for (const p of ps) {
                    // 飛び始めるまでは描かない(外側に止まった文字が一瞬見えてしまうので)。飛びながら濃くなる
                    if (t < p.delay || shown1[p.i] || p.ty - C1 / 2 < scan) continue;
                    const q = Math.min(1, (t - p.delay) / p.dur);
                    const e = fly(q);
                    if (Math.random() < (q < 1 ? .2 : .015)) p.k ^= 1;
                    g.globalAlpha = p.a * Math.min(1, q * 2.5) * (.3 + .7 * e) * dim;
                    g.drawImage(spr[p.k], p.sx + (p.tx - p.sx) * e + ox - C1 / 2, p.sy + (p.ty - p.sy) * e + oy - C1 / 2, C1, C1);
                }
                raf = requestAnimationFrame(frame);
            };
            raf = requestAnimationFrame(frame);
        });
    }

    /* ----------------------------------------------------------------------
       ボット: Bluesky の公開 API から最新の投稿を読む。読めなければ投稿の例のまま
       ---------------------------------------------------------------------- */
    (async function botFeed() {
        const list = $('[data-feed-list]');
        if (!list || !window.fetch) return;
        const handle = 'nagai-kotoba-bot.bsky.social';
        const agoOf = (when) => {
            const min = Math.round((Date.now() - when) / 60000);
            return min < 60 ? `${Math.max(min, 1)} 分前` : min < 60 * 24 ? `${Math.round(min / 60)} 時間前`
                : `${when.getFullYear()}年${when.getMonth() + 1}月${when.getDate()}日`;
        };
        try {
            const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=8&filter=posts_no_replies`);
            if (!res.ok) return;
            const data = await res.json();
            const posts = (data.feed || []).map((f) => f.post).filter((p) => p && p.record && p.record.text).map((p) => {
                const lines = String(p.record.text).split('\n').filter(Boolean);
                return { word: lines[0], yomi: lines.slice(1).join(' '), ago: agoOf(new Date(p.record.createdAt || p.indexedAt)), url: `https://bsky.app/profile/${handle}/post/${p.uri.split('/').pop()}` };
            }).filter((p) => p.word).slice(0, 4);
            if (!posts.length) return;
            // テレビの 2 チャンネル
            $$('[data-bot-word]').forEach((el) => { el.textContent = posts[0].word; });
            $$('[data-bot-yomi]').forEach((el) => { el.textContent = posts[0].yomi; });
            $$('[data-bot-ago]').forEach((el) => { el.textContent = posts[0].ago; });
            // ボットの画面: いまある投稿の例を写して、中身を差し替える
            const tpl = $('li', list);
            list.replaceChildren(...posts.map((p) => {
                const li = tpl.cloneNode(true);
                $('.fpost', li).href = p.url;
                $('.fpost-who span', li).textContent = p.ago;
                $('.fpost-word', li).textContent = p.word;
                $('.fpost-yomi', li).textContent = p.yomi;
                return li;
            }));
            const label = $('[data-feed-label]');
            if (label) label.textContent = 'Bluesky の最新の投稿';
        } catch (err) {
            // 読めないときは投稿の例を出したままにする
        }
    })();

    /* ----------------------------------------------------------------------
       起動: URL の # の画面から始める。導入はその画面を W と S で形づくる。
       トップから始まるときは、ロゴができて画面が出たあと、テレビの電源が入る
       ---------------------------------------------------------------------- */
    root.classList.add('is-world');
    const first = byId(idFromHash()) || byId('top');
    if (location.hash && byId(idFromHash()) && location.hash.slice(1) !== first.id) history.replaceState(null, '', `#${first.id}`);
    show(first);

    if (root.classList.contains('is-intro')) runIntro(first);

    // 端末の reboot: トップにもどって、導入をノイズからもう一度流す。
    // 打ったキーが「押した」ことになるので、音を入れていれば、ブラウザも導入の音を出させてくれる。
    // 動きを減らす設定では導入がないので、トップへもどるだけ
    function rebootSite() {
        if (busy) return false;
        const top = byId('top');
        if (RM) return cur === top || go('top');
        if (location.hash.slice(1) !== 'top') history.pushState(null, '', '#top');
        root.classList.add('is-intro'); // 先に付ける(テレビに勝手に電源が入らないように)
        tv.off();
        show(top);
        runIntro(top);
        return true;
    }

    function runIntro(first) {
        window.__wsIntro = true;
        busy = true;
        const containers = [first.el, header, dock];
        containers.forEach((c) => c.classList.add('is-forming'));
        const isTop = first === byId('top');
        let after = Promise.resolve();
        fx.play({
            mode: isTop ? 'introW' : 'intro', containers,
            shape: isTop ? () => [{ el: mark, kind: 'bigw', alpha: 1, mask: holdMask, delay: 0, fast: 0 }] : null,
            onReveal: (parts, fast) => {
                root.classList.remove('is-intro');
                if (!isTop) {
                    playIn(parts, containers, fast);
                    page.type(first);
                    return;
                }
                if (fast) {
                    hold = null;
                    playIn(stagger(partsOf(containers), .06), containers, true);
                    setTimeout(tv.powerOn, 400);
                    return;
                }
                // W が分かれて文字がそろったら、一拍おいてほかの部品(メニュー・番組表)をパンと出す
                const seq = wordIn();
                const tvEl = $('.tv');
                const rest = stagger(partsOf(containers).filter((p) => p.kind !== 'glyph' && p.el !== tvEl), .03);
                // テレビは、ロゴがそろって一拍おいてから、ほかの部品が出るのと同時に文字から組み上がる。
                // 組み上がって電源が入ったら、もう移動できるようにする(文字の後片付けはそのあと)
                after = new Promise((done) => setTimeout(() => {
                    const assembled = assembleTv();
                    const max = playIn(rest, containers, false);
                    setTimeout(seq.stop, (max + .9) * 1000);
                    assembled.then(() => {
                        setTimeout(tv.powerOn, RM ? 0 : 250);
                        done();
                    });
                }, seq.total + 250)); // ロゴがそろって一拍おいてから
            },
        }).then(() => after).then(() => {
            busy = false;
            // 導入の間に戻る・進むが押されていたら、URL の画面に合わせる
            const want = wanted();
            if (want && want !== cur) go(want.id, { push: false });
        });
    }
})();
