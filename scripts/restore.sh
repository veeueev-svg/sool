#!/usr/bin/env bash
# scripts/restore.sh — مشغل الاستعادة التشغيلي (المرحلة 32)
# المالك: وزارة البنية | المدخلات: مجلد تهيئة وملف نسخة، أو --bench | المخرجات: تنفيذ موثق أو قياس فعلي
# التبعيات: bash وملفات JavaScript المبنية | الصلاحيات: يمرر التبديل إلى restore_cli ثم RoyalArchive؛ لا يملك فك تجميد أو مسار استعادة ثان.
# السجلات: تصدرها وحدات الدولة لا الصدفة | حالات الفشل: set -euo pipefail يمنع نجاحا صامتا؛ راجع infra/disaster-recovery/RUNBOOK.md.
# الاختبارات: npm run bench:recovery | اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
# الوثيقة المرتبطة: infra/disaster-recovery/RUNBOOK.md
# ثوابت هذه الوحدة: 1) --bench يشغّل قياسا فعليا؛ 2) أي استعادة تمر بالأرشيف؛ 3) لا thaw هنا.
set -euo pipefail
if [ "${1:-}" = "--bench" ]; then
  node dist/scripts/bench_recovery.js
  exit 0
fi
node dist/scripts/restore_cli.js "$@"
