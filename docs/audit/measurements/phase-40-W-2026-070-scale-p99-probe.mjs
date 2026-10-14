// مسبار p99 — يعيد حرفيًّا قياس اختبار «خمسون ألف هوية» من dist دون لمس الاختبار
// docs/audit/measurements/phase-40-W-2026-070-scale-p99-probe.mjs — W-2026-070 · تشخيص SCALE_P99_SUITE_FLAKE
// الاستعمال (من جذر المستودع بعد npm run build): node <هذا الملف> . <عدد المحاولات>
// يطبع لكل محاولة: p50/p99/max بزمن الساعة (hrtime) كما يقيس الاختبار، وcpu_p50/cpu_p99/cpu_max بزمن المعالج (process.cpuUsage — يشمل خيوط جامع القمامة)
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const root = resolve(process.argv[2] ?? '.');
const { identity, scaleState, T0 } = require(`${root}/dist/tests/scale/helpers.js`);
function percentile(v, p) { return v[Math.min(v.length - 1, Math.ceil(v.length * p) - 1)]; }
const trials = Number(process.argv[3] ?? 1);
for (let t = 0; t < trials; t++) {
  const h = scaleState(); const total = h.s.scaleConfig.policy.acceptance_population; const batch = 5000;
  for (let s = 0; s < total; s += batch) {
    const items = Array.from({ length: batch }, (_, i) => identity(s + i, `ministry:owner-${i % 8}`));
    const r = h.s.population.registerBatch(h.command(`scale:batch-${s}`), items, T0); if (!r.ok) throw new Error('register');
  }
  for (let i = 0; i < 20; i++) h.s.gateway.authorize(h.command(`gateway:warmup-${i}`, T0), T0);
  const samples = []; const cpu = [];
  for (let i = 0; i < 200; i++) { const c = process.cpuUsage(); const b = process.hrtime.bigint(); h.s.gateway.authorize(h.command(`gateway:measure-${i}`, T0), T0); samples.push(Number(process.hrtime.bigint() - b) / 1e6); const d = process.cpuUsage(c); cpu.push((d.user + d.system) / 1000); }
  cpu.sort((a, b) => a - b);
  samples.sort((a, b) => a - b);
  const limit = h.s.scaleConfig.policy.gateway_p99_ms * (100 - h.s.scaleConfig.policy.acceptance_headroom_percent) / 100;
  const p99 = percentile(samples, 0.99), max = samples.at(-1), p50 = percentile(samples, 0.5);
  console.log(JSON.stringify({ trial: t, p50: +p50.toFixed(3), p99: +p99.toFixed(3), max: +max.toFixed(3), limit, pass: p99 <= limit && max <= h.s.scaleConfig.policy.gateway_max_ms, top5: samples.slice(-5).map(x => +x.toFixed(3)), cpu_p50: +percentile(cpu,0.5).toFixed(3), cpu_p99: +percentile(cpu,0.99).toFixed(3), cpu_max: +cpu.at(-1).toFixed(3) }));
}
