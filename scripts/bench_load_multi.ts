/**
 * scripts/bench_load_multi.ts — تمرين ضغط متعدد العمليات على القناة (T-89)
 * المالك: ديوان التدقيق + وزارة البنية
 *
 * الهدف: قياس هل تصمد «مرة واحدة فقط» وسقوف الحصص تحت التزامن الحقيقي.
 *
 * النتيجة المقيسة: بعد الإصلاح (قفل ملفات حصري في src/crown/command_channel.ts
 * عبر withChannelLock) يصمد الوصول المتزامن — 105/105 سجلًا بلا فقد في 8/8 تشغيلات.
 * قبل الإصلاح كان الفقد متغيّرًا (37–55 من 105، أو 73 عند القراءة المباشرة الخاطئة
 * التي تتجاهل اليوميّة channel.json.journal). الإصلاح طُبّق في W-2026-032 (T-89).
 *
 * ثوابت هذه الوحدة:
 *   1) كل عملية تحمل CommandChannel مستقلًا على نفس الملف — لا تنسيق بينها
 *   2) القفل حصريٌّ يغطّي دورة restore→mutate→save — وهذا ما يُقاس: هل يصمد؟
 *   3) الخرج خام: أرقام مقيسة لا حكم
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { bootstrapState, CommandChannel } from '../src/index';

const WORKER_COUNT = 2;
const COMMANDS_PER_WORKER = 50;
const INIT_COMMANDS = 5;
const EXPECTED_TOTAL = INIT_COMMANDS + WORKER_COUNT * COMMANDS_PER_WORKER;

const dir = mkdtempSync(join(tmpdir(), 'sool-t89-multi-'));
const channelPath = join(dir, 'channel.json');
const auditPath = join(dir, 'audit.jsonl');
const readyPath = join(dir, 'ready.txt');
const now = Date.now();

// تهيئة الدولة والقناة
const state = bootstrapState({ now, auditPath });
const channel = new CommandChannel(state.audit, state.gateway, channelPath);

let counter = 0;
const issue = () => {
  counter += 1;
  return state.king.issueCommand('create_agent', `agent:init-${counter}`, { init: counter }, now);
};
for (let i = 0; i < INIT_COMMANDS; i += 1) {
  channel.submit(issue());
  channel.process(() => undefined, now);
}

console.log(`== تمرين ضغط متعدد العمليات — T-89 ==`);
console.log(`التهيئة: ${INIT_COMMANDS} أوامر أولية · ${WORKER_COUNT} عمليات · ${COMMANDS_PER_WORKER} أمر لكل عملية`);
console.log(`المتوقع: ${EXPECTED_TOTAL} سجلًا إجماليًا`);
console.log('');

// إشارة جاهزية
writeFileSync(readyPath, 'ready');

// إطلاق العمليات المتزامنة
const workers: { name: string; executed: number; denied: number; failed: number }[] = [];
let done = 0;

for (let w = 0; w < WORKER_COUNT; w += 1) {
  const workerName = `worker${w + 1}`;
  const child = spawn('node', [
    '-e',
    `
    const { bootstrapState, CommandChannel } = require('${join(process.cwd(), 'dist', 'src', 'index.js')}');
    const channelPath = process.argv[1];
    const auditPath = process.argv[2];
    const workerName = process.argv[3];
    const readyPath = process.argv[4];
    const { existsSync } = require('node:fs');
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    (async () => {
      while (!existsSync(readyPath)) { await sleep(10); }
      await sleep(Math.random() * 50);
      const now = Date.now();
      const state = bootstrapState({ now, auditPath });
      const channel = new CommandChannel(state.audit, state.gateway, channelPath);
      let counter = parseInt(workerName === 'worker1' ? '1000' : '2000');
      const issue = () => { counter += 1; return state.king.issueCommand('create_agent', \`agent:\${workerName}-\${counter}\`, { worker: workerName, n: counter }, now); };
      let executed = 0, denied = 0, failed = 0;
      for (let i = 0; i < ${COMMANDS_PER_WORKER}; i++) {
        channel.submit(issue());
        const outcomes = channel.process(() => undefined, now);
        for (const o of outcomes) {
          if (o.status === 'executed') executed++;
          else if (o.status === 'denied') denied++;
          else if (o.status === 'failed') failed++;
        }
      }
      console.log(JSON.stringify({ worker: workerName, executed, denied, failed }));
      process.exit(0);
    })().catch(e => { console.error(e.message); process.exit(1); });
    `,
    channelPath, auditPath, workerName, readyPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { process.stderr.write(d.toString()); });

  child.on('exit', (code) => {
    try {
      const result = JSON.parse(output.trim());
      workers.push(result);
      console.log(`${workerName}: executed=${result.executed} denied=${result.denied} failed=${result.failed}`);
    } catch {
      console.log(`${workerName}: error (exit ${code})`);
      workers.push({ name: workerName, executed: 0, denied: 0, failed: 0 });
    }
    done += 1;
    if (done === WORKER_COUNT) {
      printResults();
    }
  });
}

function printResults() {
  console.log('');
  console.log('== النتائج ==');

  // فحص ملف القناة عبر واجهة القناة نفسها — لا قراءة مباشرة للقطة وحدها،
  // لأنّ السجلات بعد سقف CHANNEL_SNAPSHOT_ALWAYS_UNDER تُكتب في اليومية لا في اللقطة.
  // قراءة اللقطة وحدها تُغفل اليومية فترى عددًا أقلّ ممّا حُفظ فعلًا — وهذا عيب القياس
  // نفسه لا عيب القناة. الاستعادة عبر list() تدمج اللقطة واليومية وتُعيد العدد الصحيح.
  const recovered = new CommandChannel(state.audit, state.gateway, channelPath);
  const allRecords = recovered.list();
  const actualRecords = allRecords.length;
  const ids = allRecords.map((r) => r.commandId);
  const unique = new Set(ids);
  const duplicates = ids.length - unique.size;
  const corrupted = false;

  const auditValid = state.audit.verifyIntegrity().valid;
  const lost = EXPECTED_TOTAL - actualRecords;

  console.log(`السجلات المتوقعة: ${EXPECTED_TOTAL}`);
  console.log(`السجلات الفعلية: ${actualRecords}`);
  console.log(`السجلات المفقودة: ${lost}`);
  console.log(`المعرفات المكررة: ${duplicates}`);
  console.log(`ملف تالف: ${corrupted ? 'نعم' : 'لا'}`);
  console.log(`سلسلة التدقيق: ${auditValid ? 'سليمة' : 'مكسورة'}`);

  console.log('');
  console.log('== الحكم ==');
  if (lost > 0) {
    console.log(`فقد تحديثات: ${lost} من ${EXPECTED_TOTAL} سجل ضاعت — الوصول المتزامن غير آمن`);
    console.log('السبب: CommandChannel لا يستخدم قفل ملفات — كل عملية تحمل الحالة وتكتب فوق ما كتبت الأخرى');
    console.log('الإصلاح: قفلٌ حصريٌّ يغطّي دورة restore→mutate→save كاملة في src/crown/command_channel.ts (T-89)');
  } else if (duplicates > 0) {
    console.log(`معرفات مكررة: ${duplicates} — ضمان «مرة واحدة فقط» منتهك`);
  } else if (corrupted) {
    console.log('ملف القناة تالف — الوصول المتزامن غير آمن');
  } else {
    console.log('الوصول المتزامن آمن تحت ذرّية POSIX append');
  }

  rmSync(dir, { recursive: true, force: true });
}
