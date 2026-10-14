# قياسٌ خامّ — إعادةُ قياس تباين `verify` بعد دمج W-2026-071 (W-2026-070 · علاجُ الجلسة 20)

> خامٌّ لا تفسير. البيئة: Node v20.20.2 · GNU bash 5.3.9(1)-release · لينكس (sandbox) · `nproc` = 2 · المنفّذ: Perplexity Computer (الجلسة 114 تابع).
> **الشجرةُ المقيسة بعد العلاج:** `cb394e7cadee235dbfdbb5ae989a11ccfc973e77` (رأس main بعد دمج #113 في `8e4513f` ثم #115).
> **شجرةُ الضبط قبل العلاج:** `7f81defb22b10edeb6a6d35394dfb3aec7c72ab3` (التزامُ تجميد الجلسة 20) — في `git worktree` منفصل.
> بناءٌ نظيف قبل القياس: `rm -rf dist` (بقايا `dist/` من تبديل الفروع أفسدت قياسًا سابقًا للمنفّذ — مسجَّلٌ في تقرير W-2026-066 §6).
> زمنُ القياس: 2026-10-14 من 02:43:46Z إلى نحو 03:05Z.

## 1) أداةُ الإجهاد (بحرفها — هي أداةُ قياس W-2026-071 نفسُها)

```bash
#!/usr/bin/env bash
# usage: stress.sh OUTDIR ROUNDS PAR
out=$1; rounds=$2; par=$3; mkdir -p "$out"
for r in $(seq 1 $rounds); do
  for p in $(seq 1 $par); do
    ( bash scripts/check_declaration.sh > "$out/r${r}p${p}.txt" 2>&1; echo $? > "$out/r${r}p${p}.rc" ) &
  done
  wait
done
total=$(ls "$out"/*.rc | wc -l); fails=$(grep -L '^0$' "$out"/*.rc | wc -l)
dc03=$(grep -l '✗ \[DC-03\]' "$out"/*.txt | wc -l)
dc04=$(grep -l '✗ \[DC-04\]' "$out"/*.txt | wc -l)
echo "total=$total nonzero=$fails files_with_DC03_fail=$dc03 files_with_DC04_fail=$dc04"
```

`PAR=1` يعني تشغيلًا متتابعًا (لا تزامن).

## 2) حاجزُ الإعلان — الخرجُ بحرفه

| الدفعة | الشجرة | الأمر | الخرج |
|---|---|---|---|
| A متوازية | `cb394e7` | `stress.sh … 25 8` | `total=200 nonzero=0 files_with_DC03_fail=0 files_with_DC04_fail=0` |
| B متوازية | `cb394e7` | `stress.sh … 25 8` | `total=200 nonzero=0 files_with_DC03_fail=0 files_with_DC04_fail=0` |
| C متتابعة | `cb394e7` | `stress.sh … 40 1` | `total=40 nonzero=0 files_with_DC03_fail=0 files_with_DC04_fail=0` |
| D متتابعة | `7f81def` | `stress.sh … 40 1` | `total=40 nonzero=0 files_with_DC03_fail=0 files_with_DC04_fail=0` |
| E متوازية (ضبط) | `7f81def` | `stress.sh … 25 8` | `total=200 nonzero=37 files_with_DC03_fail=15 files_with_DC04_fail=23` |

تصنيفُ تشغيلات E غير الصفريّة الـ37 (عددٌ · رمز · أسطرُ ✗[DC-03] · أسطرُ ✗[DC-04] · أسطرُ `phases_partial`):

```text
     20 1 0 1 0
      2 1 0 2 0
     14 1 1 0 0
      1 1 1 1 0
```

معرّفاتُ E غير الصفريّة: r1p8 r3p2 r3p3 r3p6 r3p8 r4p6 r5p3 r5p4 r6p1 r7p1 r7p8 r8p4 r9p7 r12p1 r12p5 r13p5 r13p8 r14p5 r14p8 r15p2 r15p6 r16p4 r16p6 r16p8 r17p7 r17p8 r18p8 r20p1 r20p7 r21p3 r21p8 r22p2 r23p4 r23p5 r23p6 r24p5 r25p6

لا تشغيلَ غيرُ صفريّ بالرمز 141 في أيّ دفعة.

## 3) `npm run verify` على `cb394e7`

- البدء 02:46:13Z · الانتهاء 02:50:59Z · `rm -rf dist` قبله.
- رمزُ الخروج مقبوضٌ مباشرةً: `npm run verify > LOG 2>&1; echo "VERIFY_RC=$?"` ⇒ **`VERIFY_RC=0`**.
- الحصيلة: `# tests 2445` · `# pass 2445` · `# fail 0`.
- السجلُّ الكامل: [`phase-40-W-2026-070-remeasure-npm-verify.txt`](phase-40-W-2026-070-remeasure-npm-verify.txt).

## 4) `tests/scale/scale_lifecycle` — مصدرُ تباينٍ آخر (SCALE_P99_SUITE_FLAKE)

الأمر: `node --test dist/tests/scale/scale_lifecycle.test.js` على `cb394e7` بعد البناء.

| الظرف | التشغيلات | الحصيلة |
|---|---|---|
| معزول (لا حِملَ آخر) | 10 متتابعة | 10/10 رمز 0 · `# pass 10 # fail 0` في كلٍّ |
| تحت حِمل: 8 نسخٍ من `check_declaration.sh` تُطلق في الخلفية لحظةَ بدئه | 5 | **5/5 رمز 1** · `# pass 9 # fail 1` في كلٍّ |

الاختبارُ الساقط في الخمس بحرفه:

```text
not ok 1 - قبول: خمسون ألف هوية مسجلة وقياس البوابة تحت عتبة التهيئة بهامش معلن
  error: |-
      strict_1.default.ok(percentile(samples, 0.99) <= limit)
  expected: true
  actual: false
```

العتبةُ من `config/scale.yaml` (السطران 8 و11): `gateway_p99_ms: 10` · `acceptance_headroom_percent: 20` — وهي ما ذكره grok في الجلسة 20 (8 ms بحسابه).
