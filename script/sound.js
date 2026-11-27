/* ==========================================================================
   WSWS.WORKS の音
   すべてその場で合成する(音声ファイルは置かない)。はじめは鳴らさず、ヘッダーのスピーカーで入れる。
   入れた・切った状態は覚えておく。ブラウザの決まりで、押す・打つより前は鳴らせない(初めの導入は無音)。
   テレビの部品は本物の機械の音(つまみのカチッ、砂嵐のザッ、電源のボンッ)、W と S の演出はデジタルのピリピリ。
   script.js からは wsSound.play('click') のように呼ぶ。鳴らせないときは何もしない
   ========================================================================== */
(() => {
    'use strict';

    const AC = window.AudioContext || window.webkitAudioContext;
    const KEY = 'wsws-sound';
    const VOL = .5; // 全体の音量(小さめ)
    const R = (a, b) => a + Math.random() * (b - a);
    const pick = (a) => a[(Math.random() * a.length) | 0];

    /* ----------------------------------------------------------------------
       音の部品。c は AudioContext(試すときは OfflineAudioContext でもよい)、to は出口、t は鳴らし始める時刻(秒)
       ---------------------------------------------------------------------- */

    // 2 秒分の雑音。white は白い雑音、crush は同じ値を数サンプルずつ続けて段を粗くした、デジタルのざらついた雑音
    const bufs = new WeakMap();
    function noiseOf(c) {
        let b = bufs.get(c);
        if (b) return b;
        const n = c.sampleRate * 2;
        const white = c.createBuffer(1, n, c.sampleRate), crush = c.createBuffer(1, n, c.sampleRate);
        const w = white.getChannelData(0), k = crush.getChannelData(0);
        let v = 0, hold = 0;
        for (let i = 0; i < n; i++) {
            w[i] = Math.random() * 2 - 1;
            if (hold-- <= 0) {
                v = Math.round((Math.random() * 2 - 1) * 2) / 2;
                hold = 3 + ((Math.random() * 18) | 0);
            }
            k[i] = v;
        }
        b = { white, crush };
        bufs.set(c, b);
        return b;
    }

    // 左右に振って出口へ(振れない古いブラウザでは真ん中)
    function out(c, node, to, pan) {
        if (pan && c.createStereoPanner) {
            const p = c.createStereoPanner();
            p.pan.value = Math.max(-1, Math.min(1, pan));
            node.connect(p).connect(to);
        } else {
            node.connect(to);
        }
    }

    // 立ち上がって(attack)、dur 秒で消える音量
    function env(g, t, gain, attack, dur) {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(.0001, t + Math.max(dur, attack + .005));
    }

    // 雑音をフィルターに通して鳴らす。f → f2 へ周波数を動かせる
    function hiss(c, to, t, { dur, gain, type = 'bandpass', f = 3000, f2 = 0, q = 1, attack = .002, kind = 'white', pan = 0, rate = 1, shape = null }) {
        const s = c.createBufferSource();
        s.buffer = noiseOf(c)[kind];
        s.playbackRate.value = rate;
        const fl = c.createBiquadFilter();
        fl.type = type;
        fl.Q.value = q;
        fl.frequency.setValueAtTime(f, t);
        if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
        const g = c.createGain();
        if (shape) shape(g.gain, t);
        else env(g, t, gain, attack, dur);
        s.connect(fl).connect(g);
        out(c, g, to, pan);
        s.start(t, Math.random() * Math.max(0, 1.9 - dur));
        s.stop(t + dur + .05);
        return g;
    }

    // 音程のある音。f → f2 へ音程を動かせる。lp でこもらせる
    function tone(c, to, t, { dur, gain, type = 'sine', f, f2 = 0, attack = .002, pan = 0, lp = 0 }) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
        const g = c.createGain();
        env(g, t, gain, attack, dur);
        let n = o;
        if (lp) {
            const fl = c.createBiquadFilter();
            fl.type = 'lowpass';
            fl.frequency.value = lp;
            o.connect(fl);
            n = fl;
        }
        n.connect(g);
        out(c, g, to, pan);
        o.start(t);
        o.stop(t + dur + .03);
        return o;
    }

    // 音量を step 秒ごとに段で揺らす(砂嵐の粒、途切れるうなり)
    function steps(param, t, dur, step, lo, hi) {
        for (let x = 0; x < dur; x += step) param.setValueAtTime(R(lo, hi), t + x);
    }

    /* ----------------------------------------------------------------------
       それぞれの音
       ---------------------------------------------------------------------- */
    const V = {
        // つまみの戻り止め: カ・チッ。硬い樹脂の小さな音 2 つと、胴の低い鳴り
        click(c, to, t) {
            const k = R(.92, 1.08);
            hiss(c, to, t, { dur: .014, gain: .32, f: 2300 * k, q: 1.4 });
            hiss(c, to, t + .016, { dur: .024, gain: .5, f: 5000 * k, q: 2.2 });
            tone(c, to, t + .016, { dur: .05, gain: .2, type: 'triangle', f: 260 * k, f2: 150 });
        },

        // 砂嵐: ザッ。粒が 22 ミリ秒ごとに揺れる(画面の砂嵐が切り替わる速さに近い)
        static(c, to, t, ms = 300, level = 1) {
            const d = ms / 1000;
            const grain = c.createGain();
            steps(grain.gain, t, d + .06, .022, .5, 1);
            grain.connect(to);
            hiss(c, grain, t, {
                dur: d + .06, type: 'bandpass', f: 2600, q: .35,
                shape: (p) => {
                    p.setValueAtTime(0, t);
                    p.linearRampToValueAtTime(.26 * level, t + .004);
                    p.setValueAtTime(.26 * level, t + d * .6);
                    p.exponentialRampToValueAtTime(.0001, t + d + .06);
                },
            });
        },

        // 電源: ボンッ(低い胴鳴りと、入った瞬間のパチッ)→ かすかにジー(電源のうなり)
        power(c, to, t) {
            tone(c, to, t, { dur: .38, gain: .3, f: 118, f2: 36 });
            hiss(c, to, t, { dur: .05, gain: .14, type: 'highpass', f: 1800 });
            const o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
            o.type = 'sawtooth';
            o.frequency.value = 60;
            fl.type = 'lowpass';
            fl.frequency.value = 700;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(.05, t + .09);
            g.gain.setValueAtTime(.05, t + .3);
            g.gain.exponentialRampToValueAtTime(.0001, t + 1.3);
            o.connect(fl).connect(g).connect(to);
            o.start(t);
            o.stop(t + 1.35);
        },

        // 音を切るとき: プツッ
        off(c, to, t) {
            hiss(c, to, t, { dur: .02, gain: .26, type: 'lowpass', f: 2200 });
            tone(c, to, t, { dur: .1, gain: .22, f: 95, f2: 45 });
        },

        // シュッ(rise: 板が画面いっぱいに広がる)/ ヒュッ(fall: カメラが勢いよく引く)
        whoosh(c, to, t, ms = 420, fall = false, pan = 0, level = 1) {
            const d = ms / 1000;
            hiss(c, to, t, {
                dur: d + .08, type: 'bandpass', f: fall ? 4200 : 500, f2: fall ? 420 : 4200, q: 1.1, pan,
                shape: (p) => {
                    p.setValueAtTime(0, t);
                    if (fall) {
                        p.linearRampToValueAtTime(.3 * level, t + .03);
                        p.exponentialRampToValueAtTime(.0001, t + d);
                    } else {
                        p.linearRampToValueAtTime(.28 * level, t + d * .82);
                        p.exponentialRampToValueAtTime(.0001, t + d + .08);
                    }
                },
            });
        },

        // ピリピリ: W と S が明滅する、デジタルの細かいノイズ。粒の音程は決まった段から選び、だんだん弱まる
        glitch(c, to, t, ms = 300, level = 1) {
            const d = ms / 1000, PITCH = [880, 1320, 1760, 2640, 3520, 5280];
            for (let x = 0; x < d; x += R(.018, .045)) {
                const k = level * (1 - (x / d) * .6), pan = R(-.35, .35);
                if (Math.random() < .42) tone(c, to, t + x, { dur: R(.012, .03), gain: .05 * k, type: 'square', f: pick(PITCH), attack: .001, pan, lp: 6500 });
                else hiss(c, to, t + x, { dur: R(.01, .035), gain: .26 * k, kind: 'crush', type: 'highpass', f: R(1200, 3600), q: .7, attack: .001, pan, rate: R(.5, 1.5) });
            }
        },

        // 画面の移動: W と S が覆って明滅する間のピリピリと、部品が本物に替わるときのパチパチ
        move(c, to, t, pan = 0) {
            hiss(c, to, t, { dur: .26, gain: .1, kind: 'crush', type: 'bandpass', f: 900, f2: 3200, q: .8, attack: .05, pan });
            V.glitch(c, to, t, 480, .8);
            V.glitch(c, to, t + .86, 160, .5);
        },

        // はじき出される: ガガッ(揺れて裂ける)→ プツン(ブラウン管を切ったように、横一本の線へつぶれて消える)
        eject(c, to, t) {
            const SHAKE = .21;
            // ガガッ: 低くつぶれたうなりと、ざらついた雑音。揺れと同じく 40 ミリ秒ごとに途切れる
            const o = c.createOscillator(), sh = c.createWaveShaper(), fl = c.createBiquadFilter(), gate = c.createGain();
            o.type = 'sawtooth';
            o.frequency.value = 62;
            const curve = new Float32Array(256);
            for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 4);
            sh.curve = curve;
            fl.type = 'lowpass';
            fl.frequency.value = 1400;
            gate.gain.setValueAtTime(0, t);
            for (let x = 0; x < SHAKE; x += .04) gate.gain.setValueAtTime(Math.random() < .25 ? .02 : R(.08, .18), t + x);
            gate.gain.setValueAtTime(.12, t + SHAKE);
            gate.gain.exponentialRampToValueAtTime(.0001, t + SHAKE + .04);
            o.connect(sh).connect(fl).connect(gate).connect(to);
            o.start(t);
            o.stop(t + SHAKE + .06);
            const rough = c.createGain();
            rough.gain.setValueAtTime(0, t);
            for (let x = 0; x < SHAKE; x += .04) rough.gain.setValueAtTime(Math.random() < .3 ? 0 : 1, t + x);
            rough.gain.setValueAtTime(0, t + SHAKE);
            rough.connect(to);
            hiss(c, rough, t, { dur: SHAKE + .02, gain: .22, kind: 'crush', type: 'bandpass', f: 1300, q: .8 });
            // プツン: 線に縮みながら音程が落ち、最後にプツッと切れる
            tone(c, to, t + SHAKE - .01, { dur: .17, gain: .14, f: 2200, f2: 90 });
            hiss(c, to, t + .37, { dur: .025, gain: .3, type: 'lowpass', f: 2200 });
            tone(c, to, t + .37, { dur: .12, gain: .24, f: 95, f2: 45 });
        },

        // ピタッ: 砂嵐が止んで番組にもどる
        snap(c, to, t) {
            hiss(c, to, t, { dur: .018, gain: .3, f: 4200, q: 1.8 });
            tone(c, to, t, { dur: .03, gain: .04, type: 'square', f: 1760, lp: 5000 });
        },

        // 早送り・巻きもどし: テープのキュルキュル(新しい版へは上がり、古い版へは下がる)。止まるときにガチャ
        tape(c, to, t, back = false, ms = 480) {
            const d = ms / 1000;
            const o = c.createOscillator(), lfo = c.createOscillator(), depth = c.createGain();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(back ? 1300 : 650, t);
            o.frequency.exponentialRampToValueAtTime(back ? 650 : 1300, t + d);
            lfo.frequency.value = 11;
            depth.gain.value = 90;
            lfo.connect(depth).connect(o.frequency);
            const fl = c.createBiquadFilter();
            fl.type = 'bandpass';
            fl.frequency.value = 1700;
            fl.Q.value = 2.5;
            // キュル・キュル: 音量を 1 秒に 7 回ほど波打たせる
            const am = c.createGain(), amLfo = c.createOscillator(), amDepth = c.createGain();
            am.gain.value = .55;
            amLfo.frequency.value = 7;
            amDepth.gain.value = .45;
            amLfo.connect(amDepth).connect(am.gain);
            const g = c.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(.16, t + .03);
            g.gain.setValueAtTime(.16, t + d - .04);
            g.gain.exponentialRampToValueAtTime(.0001, t + d + .02);
            o.connect(fl).connect(am).connect(g).connect(to);
            [o, lfo, amLfo].forEach((n) => { n.start(t); n.stop(t + d + .05); });
            hiss(c, to, t, { dur: d, gain: .05, kind: 'crush', type: 'highpass', f: 3000, attack: .03 });
            hiss(c, to, t + d, { dur: .03, gain: .22, type: 'lowpass', f: 1800 });
            tone(c, to, t + d, { dur: .06, gain: .12, type: 'triangle', f: 180, f2: 120 });
        },

        // 端末の打鍵: コツ(Enter は低く大きめ)
        key(c, to, t, enter = false) {
            const k = R(.85, 1.15);
            if (enter) {
                hiss(c, to, t, { dur: .045, gain: .45, f: 1100 * k, q: 1.2 });
                tone(c, to, t, { dur: .05, gain: .14, type: 'triangle', f: 180 * k, f2: 110 });
                return;
            }
            hiss(c, to, t, { dur: .022, gain: .45, f: 2600 * k, q: 1.6 });
            hiss(c, to, t + .012, { dur: .015, gain: .18, f: 1500 * k, q: 1.2 });
        },

        // 端末に行が出るときの小さなカタッ
        tick(c, to, t, level = 1) {
            hiss(c, to, t, { dur: .012, gain: .16 * level, f: R(2800, 4200), q: 1.8 });
        },

        // 端末に行が 1 行ずつ出る。list は [秒, 打ちこんだ行か] の並び
        lines(c, to, t, list) {
            list.forEach(([at, cmd]) => (cmd ? V.key(c, to, t + at) : V.tick(c, to, t + at, .8)));
        },

        // sl: 汽笛のポーッと、右から左へ走り抜けるシュッシュッ(煙が切り替わる速さ)
        train(c, to, t, ms = 4000, step = .112) {
            const d = ms / 1000;
            [587, 698, 880].forEach((f) => {
                const o = c.createOscillator(), vib = c.createOscillator(), vd = c.createGain(), fl = c.createBiquadFilter(), g = c.createGain();
                o.type = 'sawtooth';
                o.frequency.value = f;
                vib.frequency.value = 5.5;
                vd.gain.value = f * .006;
                vib.connect(vd).connect(o.frequency);
                fl.type = 'lowpass';
                fl.frequency.value = 1900;
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(.04, t + .06);
                g.gain.setValueAtTime(.04, t + .5);
                g.gain.exponentialRampToValueAtTime(.0001, t + .8);
                o.connect(fl).connect(g);
                out(c, g, to, .7);
                [o, vib].forEach((n) => { n.start(t); n.stop(t + .85); });
            });
            hiss(c, to, t, { dur: .8, gain: .04, f: 1300, q: 1, attack: .06, pan: .7 });
            let i = 0;
            for (let x = .2; x < d; x += step, i++) {
                const u = x / d, near = Math.sin(Math.PI * u) ** 1.4;
                hiss(c, to, t + x, { dur: .09, gain: (.06 + .34 * near) * (i % 2 ? .6 : 1), f: 650, q: .8, attack: .008, pan: .85 - 1.7 * u });
            }
        },
    };

    /* ----------------------------------------------------------------------
       鳴らす仕組みと、ヘッダーのスピーカー
       ---------------------------------------------------------------------- */
    const btn = document.querySelector('[data-sound]');
    let on = false;
    try { on = localStorage.getItem(KEY) === 'on'; } catch (e) { /* 覚えられないときはオフ */ }
    let ctx = null, master = null, opened = -1e9;

    function init() {
        if (ctx || !AC) return ctx;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor(); // 音が重なっても割れないように
        comp.threshold.value = -14;
        comp.knee.value = 8;
        comp.ratio.value = 5;
        comp.attack.value = .003;
        comp.release.value = .15;
        master = ctx.createGain();
        master.gain.value = VOL;
        master.connect(comp).connect(ctx.destination);
        noiseOf(ctx);
        ctx.onstatechange = applySnow;
        return ctx;
    }

    // 押した・打ったときに音の出口を開ける(iPhone は押した瞬間に一度鳴らさないと開かない)
    function unlock() {
        if (!on || !init() || ctx.state === 'running') return;
        opened = performance.now();
        const p = ctx.resume(); // 古い Safari は Promise を返さない
        if (p && p.catch) p.catch(() => {});
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start();
    }
    ['pointerdown', 'keydown', 'touchend', 'click'].forEach((type) => addEventListener(type, unlock, { capture: true, passive: true }));

    // 鳴らせるときだけ ctx を返す。止まったままのときに予約すると、開いたとたんにまとめて鳴るので、
    // 押した・打った直後(これから開く)のときだけ予約する
    function live() {
        if (!on || !ctx) return null;
        if (ctx.state === 'running') return ctx;
        const ua = navigator.userActivation;
        if (ua ? ua.isActive : performance.now() - opened < 1000) {
            unlock();
            return ctx;
        }
        return null;
    }

    // 1 回ごとの出口。返す関数で、途中でも音を引っこめられる(画面を移ったときの端末の音など)
    function play(name, ...args) {
        const c = live();
        if (!c || !V[name]) return () => {};
        const bus = c.createGain();
        bus.connect(master);
        V[name](c, bus, c.currentTime + .005, ...args);
        return () => {
            bus.gain.setTargetAtTime(0, c.currentTime, .015);
            setTimeout(() => bus.disconnect(), 200);
        };
    }

    // 砂嵐を鳴らし続ける(番組のないチャンネル、はじき出されたあと)。level 0 で止める。
    // 鳴らせない間に頼まれた分は覚えておき、開いたときに鳴らす
    let want = 0, snowNode = null;
    function applySnow() {
        const c = on && ctx && ctx.state === 'running' ? ctx : null;
        const lv = c ? want : 0;
        if (!snowNode) {
            if (!lv) return;
            const s = c.createBufferSource(), fl = c.createBiquadFilter(), grain = c.createGain(), g = c.createGain();
            s.buffer = noiseOf(c).white;
            s.loop = true;
            fl.type = 'bandpass';
            fl.frequency.value = 2600;
            fl.Q.value = .35;
            // 粒: 22 ミリ秒ごとの段で音量を揺らす(1 秒分を作って繰り返す)
            const n = Math.round(c.sampleRate * .022), m = c.createBuffer(1, n * 45, c.sampleRate), d = m.getChannelData(0);
            for (let i = 0; i < 45; i++) d.fill(R(.5, 1), i * n, (i + 1) * n);
            const mod = c.createBufferSource();
            mod.buffer = m;
            mod.loop = true;
            grain.gain.value = 0;
            mod.connect(grain.gain);
            g.gain.value = 0;
            s.connect(fl).connect(grain).connect(g).connect(master);
            s.start();
            mod.start();
            snowNode = { s, mod, g };
        }
        const now = (c || ctx).currentTime;
        snowNode.g.gain.cancelScheduledValues(now);
        snowNode.g.gain.setTargetAtTime(lv * .26, now, lv ? .02 : .03);
        if (!lv) {
            const node = snowNode;
            snowNode = null;
            node.s.stop(now + .2);
            node.mod.stop(now + .2);
        }
    }
    function snow(level) {
        want = level;
        applySnow();
    }

    function paint() {
        if (!btn) return;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.title = on ? '音を消す' : '音を出す';
    }

    if (btn) {
        if (!AC) btn.hidden = true;
        paint();
        btn.addEventListener('click', () => {
            if (on) play('off');
            on = !on;
            try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* 覚えられなくても、このページの間は効く */ }
            paint();
            if (on) {
                unlock();
                play('power');
            }
            applySnow();
        });
    }

    window.wsSound = {
        play,
        snow,
        get on() { return on; },
        get state() { return ctx ? ctx.state : 'none'; }, // 確かめる用
        voices: V, // 試し聴き用(OfflineAudioContext に書き出して確かめる)
    };
})();
