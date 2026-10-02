/**
 * tests/production/boot_supervision.test.ts — المراقبةُ من الإقلاع نفسِه (T-109 · W-2026-049 · ADR-0052)
 * المالك: وزارة البنية + ديوان التدقيق | يوثّق في: docs/test-reports/phase-40-W-2026-049.md
 * يثبت: (1) `superviseAtBoot` يبدأ المراقبةَ بعد `state_online` مباشرةً بمسحةٍ في لحظة الإقلاع، بلا
 *       تشغيلٍ اتحاديّ؛ (2) الغيابُ يُبقي البناءَ بلا مؤقّتاتٍ كما كان؛ (3) التشغيلُ الاتحاديُّ بعدها لا
 *       يبدأ مراقبةً ثانية؛ (4) نقطةُ الدخول `dist/src/main.js` عمليّةٌ حيّةٌ تراقب وتقف بإشارة.
 * ولا يثبت: الحصرَ داخل الحاوية — ذلك شاهدُ `confinement-witness.yml`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../../src/index';
import { readFileSync, writeFileSync } from 'node:fs';
import { confinedWitnessRoot, establishFederation, OBSERVER, withConfigCopy } from './helpers';
import { writeFakeProc, UNCONFINED } from '../security/proc_fixture';

/** نسخةُ تهيئةٍ شاهدُ حصرِها على جذرٍ مُصطنع — فالحكمُ لا يتبع بيئةَ الاختبار (ثابت المهاد 1) */
function withWitness(root: string, run: (configDir: string) => void): void {
  withConfigCopy((dir) => {
    const file = join(dir, 'confinement.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('witness_root: "/proc"', `witness_root: "${root}"`), 'utf8');
    run(dir);
  });
}

// الساعةُ الحقيقية: النبضُ يقيس بها، فساعةٌ مثبَّتةٌ في الماضي تُدخل الدولةَ وضعَ الحماية لا المراقب
const NOW = Date.now();

function withDirs(run: (stateDir: string, checkpointDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-boot-sup-'));
  try { run(join(root, 'state'), join(root, 'cp')); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('T-109: superviseAtBoot ⇒ المراقبةُ جاريةٌ من الإقلاع، ومسحتُها الأولى في لحظته بلا تشغيلٍ اتحاديّ', () => {
  withWitness(confinedWitnessRoot(), (configDir) => withDirs((stateDir, checkpointDir) => {
    const s = bootstrapState({ configDir, now: NOW, persistenceDir: stateDir, checkpointDir, superviseAtBoot: true });
    try {
      assert.equal(s.continuousSupervisor.running, true);
      assert.equal(s.mode(), 'normal', 'محصورةٌ ⇒ لا حادثَ حرجٌ في المسحة الأولى');
      const kinds = s.audit.snapshot().map((e) => e.kind);
      const online = kinds.indexOf('state_online');
      assert.equal(online >= 0 && kinds.indexOf('continuous_supervision_started') > online, true, 'بعد الخاتمة لا قبلها');
      const report = s.continuousSupervisor.report();
      assert.equal(report.sweeps >= 1, true);
      assert.equal(report.firstSweepAt, NOW, 'فارقُ أولِ مسحةٍ عن الإقلاع صفر');
      assert.equal(s.audit.find('federated_operation_started').length, 0, 'بلا تشغيلٍ معلن');
      assert.equal(existsSync(join(checkpointDir, 'supervision.json')), true, 'نقطةُ التفتيش في المجلد الممرَّر');
    } finally {
      s.continuousSupervisor.stop('ministry:infrastructure', 'انتهى القياس');
      s.journal?.close();
    }
  }));
});

test('T-109: دولةٌ غيرُ محصورةٍ تُقلع بمراقبةٍ ⇒ المسحةُ الأولى ترفع الحادثَ الحرجَ وتوقفها في لحظة الإقلاع', () => {
  withWitness(writeFakeProc(UNCONFINED), (configDir) => withDirs((stateDir, checkpointDir) => {
    const s = bootstrapState({ configDir, now: NOW, persistenceDir: stateDir, checkpointDir, superviseAtBoot: true });
    try {
      assert.equal(s.mode(), 'halted');
      assert.equal(s.continuousSupervisor.report().incidents.some((i) => i.kind === 'process_not_confined'), true);
    } finally {
      s.continuousSupervisor.stop('ministry:infrastructure', 'انتهى القياس');
      s.journal?.close();
    }
  }));
});

test('T-109: بلا الخيار تُبنى الدولةُ بلا مراقبةٍ جارية كما كانت — والتأسيسُ مختومٌ بـstate_online', () => {
  const s = bootstrapState({ now: NOW });
  assert.equal(s.continuousSupervisor.running, false);
  assert.equal(s.audit.snapshot().at(-1)!.kind, 'state_online');
});

test('T-109: التشغيلُ الاتحاديُّ بعد مراقبةِ الإقلاع لا يبدأ مراقبةً ثانية', () => {
  withWitness(confinedWitnessRoot(), (configDir) => withDirs((stateDir, checkpointDir) => {
    const s = bootstrapState({ configDir, now: NOW, persistenceDir: stateDir, checkpointDir, superviseAtBoot: true });
    try {
      establishFederation(s, NOW);
      const started = s.federatedOperation.begin('ministry:infrastructure', [], 'تشغيلٌ بعد الإقلاع', NOW + 10);
      assert.equal(started.ok, true, JSON.stringify(started));
      assert.equal(s.audit.find('continuous_supervision_started').length, 1);
      assert.notEqual(OBSERVER, 'ministry:infrastructure');
    } finally {
      s.continuousSupervisor.stop('ministry:infrastructure', 'انتهى القياس');
      s.journal?.close();
    }
  }));
});

test('T-109: نقطةُ الدخول عمليّةٌ حيّةٌ تراقب من إقلاعها وتقف بـSIGTERM وقفًا معلنًا', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-main-'));
  try {
    const child = spawn(process.execPath, [join(process.cwd(), 'dist/src/main.js'), '--state-dir', join(root, 'state')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    const online = await new Promise<Record<string, unknown>>((resolveP, reject) => {
      const timer = setTimeout(() => reject(new Error(`لا إقلاع: ${out}`)), 20_000);
      child.stdout.on('data', () => {
        const line = out.split('\n').find((l) => l.includes('"state_online"'));
        if (line) { clearTimeout(timer); resolveP(JSON.parse(line)); }
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`خرجت مبكرًا ${code}: ${out}`)); });
    });
    assert.equal(online.supervising, true);
    assert.equal(Number(online.sweeps) >= 1, true);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(child.exitCode, null, 'العمليّةُ حيّةٌ بعد الإقلاع لا تخرج');
    const code = await new Promise<number | null>((r) => { child.once('exit', r); child.kill('SIGTERM'); });
    assert.equal(code, 0);
    const stopped = JSON.parse(out.split('\n').find((l) => l.includes('"state_stopped"'))!);
    assert.equal(stopped.stopped, true);
    assert.equal(existsSync(join(root, 'state', 'supervision', 'supervision.json')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
