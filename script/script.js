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

    const header = $('.site-header');
    const dock = $('.dock');

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
        const QN = 24; // 文字の下を静かにする四角の数の上限(data-quiet)
        const T0 = performance.now();
        // ほとんど止まっている絵なので、描いた内容を保つ(見えない間に描いた分が消えないように)
        const gl = cvs.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });

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
            if (document.fonts) document.fonts.ready.then(build);
            return { build };
        }

        const VS = `
            attribute vec2 a_pos;
            attribute vec3 a_cor;
            uniform vec2 u_res, u_mouse;
            uniform float u_aim, u_lift, u_half, u_r, u_time;
            uniform vec4 u_rip[${RIPS}];
            uniform vec4 u_q[${QN}];
            uniform float u_qn;
            varying vec2 v_uv;
            varying float v_a;
            void main() {
                // 文字の下(静かにする四角の中)では、W と S を薄くし、丘も波も立てない。縁はなだらかに
                float qz = 0.0;
                for (int i = 0; i < ${QN}; i++) {
                    if (float(i) >= u_qn) break;
                    vec4 b = u_q[i];
                    vec2 e = abs(a_pos - (b.xy + b.zw) * 0.5) - (b.zw - b.xy) * 0.5;
                    float sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
                    qz = max(qz, 1.0 - smoothstep(0.0, 30.0, sd));
                }
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
                vec2 p = a_pos + d * h * 0.08 + push * 3.0;
                vec2 to = u_mouse - p;
                vec2 dir = normalize(mix(vec2(0.0, -1.0), to / max(length(to), 0.001), u_aim) + vec2(0.0, -0.0001));
                vec2 c = a_cor.xy * u_half * (1.0 + 0.2 * h + 0.18 * w);
                vec2 q = p + vec2(-dir.y * c.x - dir.x * c.y, dir.x * c.x - dir.y * c.y);
                gl_Position = vec4(q.x / u_res.x * 2.0 - 1.0, 1.0 - q.y / u_res.y * 2.0, 0.0, 1.0);
                v_uv = vec2((a_cor.z + a_cor.x * 0.5 + 0.5) * 0.5, a_cor.y * 0.5 + 0.5);
                v_a = clamp(${BASE.toFixed(3)} + ${NEAR.toFixed(3)} * h + 0.07 * w, 0.0, 1.0) * (1.0 - 0.88 * qz);
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

        let prog, buf, tex, U = {}, count = 0, W = 0, H = 0, raf = 0, last = 0, alive = 0, ri = 0, qn = 0;
        const rip = new Float32Array(RIPS * 4), qbuf = new Float32Array(QN * 4);
        const st = { seen: false, mx: 0, my: 0, tx: 0, ty: 0, aim: 0, aimT: 0, lift: 0, liftT: 0, lx: 0, ly: 0, acc: 0, lastEmit: 0 };

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
            ['u_res', 'u_mouse', 'u_aim', 'u_lift', 'u_half', 'u_r', 'u_time', 'u_rip', 'u_tex', 'u_q', 'u_qn'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
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

        // 1 文字を 2 つの三角形で。マス目は導入と同じ(端は波で動いても欠けないよう 1 マス外まで)
        function build() {
            W = innerWidth;
            H = innerHeight;
            cvs.width = Math.round(W * DPR);
            cvs.height = Math.round(H * DPR);
            gl.viewport(0, 0, cvs.width, cvs.height);
            const cell = cellSize();
            tile = Math.ceil(cell * DPR);
            atlas();
            const cols = Math.ceil(W / cell) + 2, rows = Math.ceil(H / cell) + 2;
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
            const dt = Math.min(.05, (now - last) / 1000 || .016);
            last = now;
            // 丘はカーソルに少し遅れてなめらかについてくる
            const k = RM ? 1 : 1 - Math.exp(-dt * 10);
            st.mx += (st.tx - st.mx) * k;
            st.my += (st.ty - st.my) * k;
            st.aim += (st.aimT - st.aim) * (RM ? 1 : 1 - Math.exp(-dt * 6));
            st.lift += (st.liftT - st.lift) * (RM ? 1 : 1 - Math.exp(-dt * 4));
            draw();
            const settled = Math.abs(st.tx - st.mx) < .2 && Math.abs(st.ty - st.my) < .2
                && Math.abs(st.aimT - st.aim) < .002 && Math.abs(st.liftT - st.lift) < .002;
            raf = settled && now > alive ? 0 : requestAnimationFrame(frame);
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

        // 静かにする四角を測り直す。els は文字のまとまり(見出し・本文・メニューなど)。少し外まで広げる
        let quietEls = () => [];
        function quiet(fn) {
            if (fn) quietEls = fn;
            if (!gl) return;
            qn = 0;
            qbuf.fill(0);
            for (const el of quietEls()) {
                if (qn >= QN) break;
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height || r.bottom < -60 || r.top > innerHeight + 60) continue;
                const pad = 8;
                qbuf.set([r.left - pad, r.top - pad, r.right + pad, r.bottom + pad], qn * 4);
                qn++;
            }
            if (prog) kick();
        }

        if (!gl || !init()) return { ...flat(), quiet() {} };
        addEventListener('pointermove', point, { passive: true });
        addEventListener('pointerdown', point, { passive: true });
        // ウィンドウの外へ出たとき、指を離したとき(タッチにはカーソルが残らないため)は丘を下げる
        document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) lower(); });
        addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') lower(); }, { passive: true });
        addEventListener('pointercancel', lower, { passive: true });
        cvs.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            cancelAnimationFrame(raf);
            raf = 0;
        });
        cvs.addEventListener('webglcontextrestored', () => {
            init();
            build();
        });

        build();
        if (document.fonts) {
            document.fonts.load(`600 52px "Inter Tight"`, 'WS').then(() => {
                atlas();
                draw();
            }, () => {});
        }
        return { build, quiet };
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

    // 部品に出る順の遅れを割り当てる。ロゴの文字は少し遅れて 1 文字ずつ
    function stagger(parts, step) {
        let i = 0, gi = 0;
        parts.forEach((p) => {
            if (p.kind === 'glyph') {
                p.delay = p.fast = .08 + gi++ * .025;
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
        letters.forEach(({ el }, i) => {
            if (W_AT.includes(i)) return;
            const near = W_AT.reduce((b, j) => (Math.abs(j - i) < Math.abs(b - i) ? j : b), 0);
            const dir = Math.sign(i - near);
            const delay = SPLIT + DUR - 80 + (Math.abs(i - near) - 1) * 120;
            last = Math.max(last, delay + 320);
            add(el, [
                { clipPath: dir > 0 ? 'inset(-30% 100% -30% 0)' : 'inset(-30% 0 -30% 100%)', transform: `translateX(${-14 * dir}px)`, opacity: 1 },
                { clipPath: 'inset(-30% 0 -30% 0)', transform: 'translateX(0px)', opacity: 1 },
            ], { duration: 320, delay, easing: 'cubic-bezier(.2, .9, .1, 1)' });
        });

        // 途中で画面の大きさが変わったら、位置がずれるので最後の形まで飛ばす
        const jump = () => anims.forEach((a) => a.finish());
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
            intro: {
                cover: 1.0, swap: 0, resolve: 2.9, settle: .7, reveal: 4.0,
                step: .06, gbase: .25, gstep: .045, events: 70, evFrom: .2,
                flashes: [1.74, 2.22], climax: [], // 画面全体が白黒反転する山場は、目に強すぎるのでやめた
            },
            // トップから始まるとき: 画面の形ではなく、大きな W ひとつの形をつくる
            introW: {
                cover: 1.0, swap: 0, resolve: 2.5, settle: .6, reveal: 3.3,
                step: .06, gbase: .25, gstep: .045, events: 64, evFrom: .2,
                flashes: [1.45, 1.9], climax: [],
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
            cell = cellSize();
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
            // ピリッと走るノイズ: 横にずれる帯と、白黒が反転した小さな四角。導入では終盤ほど多い。
            // 暗いところで見ても目に痛くないよう、大きく反転させない。帯はずらすだけ(反転するのは 1 行の細い帯と小さな四角)
            r.events = Array.from({ length: c.events }, () => {
                const band = Math.random() < .72;
                const u = r.mode !== 'move' ? Math.sqrt(Math.random()) : Math.random();
                const h = band ? 1 + ((Math.random() * 5) | 0) : 1 + ((Math.random() * 2) | 0);
                return {
                    t: c.evFrom + (c.resolve - .06 - c.evFrom) * u, dur: rand(.045, .12),
                    r0: (Math.random() * rows) | 0, h,
                    c0: band ? 0 : (Math.random() * cols) | 0, w: band ? cols : 2 + ((Math.random() * 7) | 0),
                    dx: band ? (Math.random() < .5 ? -1 : 1) * (1 + ((Math.random() * 5) | 0)) : 0,
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

            // 導入の山場: 白黒が反転した画面が数回はさまる(いまは使っていない。climax を空にしてある)
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
                if (opts.mode !== 'move') {
                    addEventListener('keydown', abort);
                    addEventListener('wheel', abort, { passive: true });
                    wrap.addEventListener('pointerdown', abort);
                    // canvas に描く文字は Web フォントを待ってから(最大 0.9 秒)
                    const wait = document.fonts ? Promise.all([
                        document.fonts.load('700 100px "Inter Tight"', 'WS'),
                        document.fonts.load(`${MARK_WEIGHT} 100px "Unbounded"`, 'WSORK.'),
                    ]).catch(() => {}) : null;
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
        field.quiet();
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
                const flakes = $$('.acct-snow', s.el);
                flakes.forEach(snow);
                if (flakes.length && !RM) snowTimer = setInterval(() => { if (!document.hidden) flakes.forEach(snow); }, 110);
                $$('[data-term]', s.el).forEach((t) => {
                    $$('.tl', t).forEach((l, i) => l.style.setProperty('--i', i));
                    t.classList.remove('is-typing');
                });
            },
            // 画面が見えたら(W と S が本物に替わったら)、端末に 1 行ずつ打ちこむ
            type(s) {
                if (RM) return;
                $$('[data-term]', s.el).forEach((t) => {
                    t.classList.remove('is-typing');
                    void t.offsetWidth;
                    t.classList.add('is-typing');
                });
            },
        };
    })();

    // 背景の W と S を静かにする所: ヘッダーの文字、もどるボタン、いまの画面の data-quiet
    field.quiet(() => [
        $('.logo', header), $('.nav', header),
        ...$$('.dock-btn:not([hidden])', dock),
        ...(cur ? $$('[data-quiet]', cur.el) : []),
    ]);
    let quietRaf = 0;
    const requiet = () => {
        if (quietRaf) return;
        quietRaf = requestAnimationFrame(() => {
            quietRaf = 0;
            field.quiet();
        });
    };
    addEventListener('scroll', requiet, { passive: true });
    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(requiet);
        screens.forEach((o) => ro.observe(o.el));
        ro.observe(header);
    }
    if (document.fonts) document.fonts.ready.then(requiet);

    // origin: 円が広がり始める点(押したボタンなど)。dir: 横へ流すとき(前後のプロダクト)
    // before: 次の画面に替わる直前にすること
    function go(id, { push = true, origin = null, dir = null, before = null, morph = null } = {}) {
        const next = byId(id);
        if (!next || busy || next === cur) return false;
        if (push) history.pushState(null, '', `#${id}`);
        if (RM) {
            if (before) before();
            if (morph) morph.z.remove();
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
    const easeIO = (t) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
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
        let until = 0, raf = 0, last = 0, area = null;
        const frame = (now) => {
            if (now >= until) {
                g.clearRect(0, 0, c.width, c.height);
                raf = 0;
                return;
            }
            raf = requestAnimationFrame(frame);
            if (now - last < 45) return; // 1 秒に 20 コマほど。カクカクと切り替わる
            last = now;
            const W = innerWidth, H = innerHeight;
            if (c.width !== Math.round(W * DPR) || c.height !== Math.round(H * DPR)) {
                c.width = Math.round(W * DPR);
                c.height = Math.round(H * DPR);
            }
            g.setTransform(DPR, 0, 0, DPR, 0, 0);
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
    function morphIn(next, { z, r, at, src }) {
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
        tear(z);
        setTimeout(() => playIn(parts, containers, false), 160);
        setTimeout(() => page.type(next), DUR * MOVE - 120);
        let swapped = false;
        tween(DUR, (p) => {
            plateAt(z, at, to, easeIO(Math.min(1, p / MOVE)));
            // 入れ替わり: なめらかに薄めず、段で行き来させる(テレビの信号が乱れて切り替わる感じ)
            const k = target ? SWAP.filter(([t]) => p >= t).pop()[1] : 1 - p;
            z.style.opacity = k;
            held.forEach((el) => { el.style.opacity = target ? 1 - k : p; });
            if (target && !swapped && p >= SWAP[1][0]) {
                swapped = true;
                glitch.burst(260, target.getBoundingClientRect());
                tear(z);
            }
        }).then(() => {
            z.remove();
            held.forEach((el) => { el.style.opacity = ''; });
            release();
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
        const els = [from.el, dock];
        els.forEach((el) => {
            const r = el.getBoundingClientRect();
            el.style.transformOrigin = `${W / 2 - r.left}px ${H / 2 - r.top}px`;
        });
        glitch.burst(420);
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
                el.style.transform = tf;
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
            const k = Math.max(W / sr.width, H / sr.height);
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

        // 右の小さな画面の絵(ASCII アート)。行き先の画面の id ごとに、コマを並べる。
        // コマが 2 つ以上あると順にくり返す。絵のないチャンネルは番号を、番組のない番号は砂嵐を映す。
        // プロダクト(works)・ボット(bots)・経歴(about)・SNS(sns)は、細かい文字で 3D の絵を描く(下の mini3d)
        const MINI_ART = {};
        const artOf = (src) => {
            const lines = src.replace(/^\n/, '').split('\n');
            const w = Math.max(...lines.map((l) => l.length));
            return lines.map((l) => l.padEnd(w));
        };
        const miniBox = $('.tv-mini'), miniArt = $('.tv-mini-art');
        let miniRaf = 0, miniTimer = 0;
        const miniStop = () => { cancelAnimationFrame(miniRaf); clearInterval(miniTimer); mini3d.stop(); };
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
                            const dl = Math.hypot(d[0], d[1], d[2]), dx = d[0] / dl, dy = d[1] / dl, dz = d[2] / dl;
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
                            const ql = Math.hypot(qx, qy, qz) || 1;
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
                        const nl = Math.hypot(nx, ny, nz) || 1;
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
                return Math.hypot(px - vx * k, py - vy * k, pz - vz * k) - r;
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
                        const ear = Math.min(Math.max(ea, eb), 0) + Math.hypot(Math.max(ea, 0), Math.max(eb, 0)) - .04;
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
                                    const dx = (c + .5 - bc) * cw, dy = (br - r - .5) * chh, dd = Math.hypot(dx, dy);
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
                        const cr = Math.hypot(px, pz) - .5 - (py + .02) * -.08, ch = Math.abs(py + .36) - .3; // 頭にかぶる部分: 下へ少し広がる円柱
                        const crown = Math.min(Math.max(cr, ch), 0) + Math.hypot(Math.max(cr, 0), Math.max(ch, 0)) - .04;
                        if (crown < dist) { dist = crown; m = CROWN; }
                        // 房のひも: ボタンから板の上を手前右の縁へ走り、縁から垂れる
                        const ex = .88, ey = .05, hx = ex + tx * .4, hy = ey + ty * .4, hz = tz * .4;
                        const cord = Math.min(rod(px, py, pz, 0, .07, 0, ex, ey, 0, .035), rod(px, py, pz, ex, ey, 0, hx, hy, hz, .035));
                        if (cord < dist) { dist = cord; m = CORD; }
                        const button = Math.hypot(px, py - .08, pz) - .075;
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
                // 円弧の距離(中心 cx, cy、半径 r、角度 a0 から a1 まで反時計回り、端は丸い)
                const arc = (x, y, cx, cy, r, a0, a1) => {
                    const px = x - cx, py = y - cy;
                    let a = Math.atan2(py, px);
                    while (a < a0) a += Math.PI * 2;
                    if (a <= a1) return Math.abs(Math.hypot(px, py) - r);
                    return Math.min(Math.hypot(px - r * Math.cos(a0), py - r * Math.sin(a0)), Math.hypot(px - r * Math.cos(a1), py - r * Math.sin(a1)));
                };
                const seg = (x, y, ax, ay, bx, by) => {
                    const px = x - ax, py = y - ay, vx = bx - ax, vy = by - ay;
                    const k = Math.min(Math.max((px * vx + py * vy) / (vx * vx + vy * vy), 0), 1);
                    return Math.hypot(px - vx * k, py - vy * k);
                };
                // @ の平面の形: 内側の a(輪と右の縦線)、縦線の下から右へ回り込むかぎ、外側の大きな弧。
                // 弧は右下で終わり、かぎとの間をはっきり空ける(詰まると二重丸に見える)
                const glyph = (x, y) => Math.min(
                    Math.abs(Math.hypot(x + .06, y) - .29),
                    seg(x, y, .3, .3, .3, -.1),
                    arc(x, y, .52, -.1, .22, Math.PI, Math.PI * 2),
                    seg(x, y, .74, -.1, .76, .05),
                    arc(x, y, 0, 0, .76, .066, Math.PI * 2 - 1.15),
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
                        return Math.min(Math.max(d2, dz), 0) + Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) - .025;
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

            // 描く。due があれば、その時刻までのマスは W と S のノイズのまま(明るさが負のマスも同じノイズ)。
            // 描く先(tg)は、テレビの小さな画面か、各画面の頭の小さな画面
            function draw(tg, scene, t, due) {
                const { cvs, g } = tg;
                const S = cvs.clientWidth;
                if (!S) return;
                const px = Math.round(S * DPR);
                if (cvs.width !== px) cvs.width = cvs.height = px;
                const cw = px / COLS, chh = px / ROWS;
                g.clearRect(0, 0, px, px);
                g.font = `600 ${(chh * 1.02).toFixed(2)}px ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace`;
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                cells.fill(0);
                scene.shade(t);
                for (let r = 0; r < ROWS; r++) {
                    for (let c = 0; c < COLS; c++) {
                        const i = r * COLS + c, x = (c + .5) * cw, y = (r + .5) * chh;
                        if (due && t < due[i]) {
                            if (Math.random() < .45) continue;
                            g.fillStyle = 'rgba(236, 236, 236, .55)';
                            g.fillText(Math.random() < .5 ? 'W' : 'S', x, y);
                            continue;
                        }
                        let v = cells[i * 2];
                        if (!v) continue;
                        if (v < 0) { // 形が崩れている所
                            if (Math.random() < .45) continue;
                            g.fillStyle = 'rgba(236, 236, 236, .55)';
                            g.fillText(Math.random() < .5 ? 'W' : 'S', x, y);
                            continue;
                        }
                        if (cells[i * 2 + 1] >= .25) v = .86 + .14 * cells[i * 2 + 1]; // 辺は S と W の明るい線
                        g.fillStyle = `rgba(236, 236, 236, ${(.3 + .7 * v).toFixed(3)})`;
                        g.fillText(RAMP[Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1)))], x, y);
                    }
                }
            }

            // 動かし始めて、止める関数を返す
            function run(tg, id) {
                const scene = SCENES[id];
                if (RM) {
                    draw(tg, scene, scene.t0);
                    return () => {};
                }
                const t0 = performance.now(), due = Array.from({ length: COLS * ROWS }, () => scene.t0 + 40 + Math.random() * 300);
                let last = -99, raf = 0;
                const step = (now) => {
                    raf = requestAnimationFrame(step);
                    if (document.hidden) return;
                    const t = now - t0;
                    if (t - last < 40) return; // 1 秒に 25 コマほど。文字が切り替わる感じを残す
                    last = t;
                    draw(tg, scene, t + scene.t0, t < 400 ? due : null);
                };
                raf = requestAnimationFrame(step);
                return () => cancelAnimationFrame(raf);
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
            const frames = (MINI_ART[c.id] || [`
.-------.
|  CH   |
|   ${String(c.n).padEnd(4)}|
'-------'`]).map(artOf);
            const loop = () => {
                if (frames.length < 2 || RM) return;
                let f = 0;
                miniTimer = setInterval(() => {
                    f = (f + 1) % frames.length;
                    miniArt.textContent = frames[f].join('\n');
                }, 700);
            };
            if (RM) {
                miniArt.textContent = frames[0].join('\n');
                return;
            }
            const due = frames[0].map((l) => [...l].map(() => 40 + Math.random() * 300));
            const t0 = performance.now();
            let last = -99;
            const step = (now) => {
                const t = now - t0;
                if (t - last < 40) { miniRaf = requestAnimationFrame(step); return; } // パラパラと、少しずつ
                last = t;
                let left = false;
                miniArt.textContent = frames[0].map((l, r) => [...l].map((ch, i) => {
                    if (t >= due[r][i]) return ch;
                    left = true;
                    return Math.random() < .5 ? 'W' : 'S';
                }).join('')).join('\n');
                if (left) miniRaf = requestAnimationFrame(step);
                else loop();
            };
            miniRaf = requestAnimationFrame(step);
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
        document.addEventListener('visibilitychange', () => (document.hidden ? stop() : visible && start()));

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

        function tune(n) {
            if (!on) return;
            n = ((n - 1 + N) % N) + 1;
            ch = n;
            tunedAt = performance.now();
            const c = chan(n);
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
                tune(ch);
                if (typeof then === 'function') then();
                else hint();
            };
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
            const { z, r, full, at } = plate(c);
            busy = true;
            glitch.burst(160, r); // 写しの板に替わる瞬間も、グリッチでごまかす
            z.animate([
                { transform: `translate(${r.left}px, ${r.top}px) scale(1)`, borderRadius: '24px' },
                { transform: full, borderRadius: '0px' },
            ], { duration: 420, easing: 'cubic-bezier(.7, 0, .2, 1)', fill: 'forwards' }).finished.then(() => {
                busy = false;
                const shown = $('img.is-on', c.prog);
                if (!go(c.id, { morph: { z, r, at, src: shown && shown.getAttribute('src') } })) z.remove();
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
            const k = Math.max(innerWidth / r.width, innerHeight / r.height);
            const fx = (innerWidth - r.width * k) / 2, fy = (innerHeight - r.height * k) / 2;
            return { z, r, k, full: `translate(${fx}px, ${fy}px) scale(${k})`, at: { x: fx, y: fy, s: k, b: 0, rad: 0 } };
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
            mini3d,
            screen: screenEl,
            // 砂嵐でうめる(on)/ 止めて、番組を少し揺らしてもどす(off)
            jam(jammed) {
                if (RM) return;
                screenEl.classList.toggle('is-jammed', jammed);
                burstUntil = jammed ? Infinity : performance.now() + 60;
                if (!jammed) {
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

            const finish = () => {
                if (ended) return;
                ended = true;
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

    if (root.classList.contains('is-intro')) {
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
        }).then(() => after).then(() => { busy = false; });
    }
})();
