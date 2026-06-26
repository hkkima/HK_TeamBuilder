#!/usr/bin/env bash
# 10·25·60명 E2E 전체 실행 (Python CLI + 브라우저).
# 사용: bash tests/e2e/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

echo "### 1/2  Python CLI E2E ###"
python3 "$HERE/run_cli.py"

echo
echo "### 2/2  브라우저 E2E (Playwright) ###"
if [ ! -d "$HERE/node_modules/playwright-core" ]; then
  echo "playwright-core 설치 중..."
  (cd "$HERE" && npm install --silent)
fi
node "$HERE/e2e.mjs"

echo
echo "✅ 전체 E2E 통과"
