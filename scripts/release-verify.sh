#!/usr/bin/env bash
# ZoraAgent 发版验证脚本
# 用法: bun run test:release

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
RESULTS=()

run_gate() {
  local name="$1"
  local cmd="$2"
  echo ""
  echo -e "${CYAN}━━━ ${BOLD}${name}${NC} ${CYAN}━━━${NC}"
  if eval "$cmd"; then
    echo -e "  ${GREEN}✅ PASSED${NC}"
    RESULTS+=("✅ ${name}")
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}❌ FAILED${NC}"
    RESULTS+=("❌ ${name}")
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     ZoraAgent Code Release Gates          ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════╝${NC}"
echo -e "  $(date '+%Y-%m-%d %H:%M:%S') | Bun $(bun --version 2>/dev/null || echo N/A)"
echo ""

run_gate "TypeScript 类型检查" "bun run typecheck"
run_gate "L1 Unit" "bun run test:unit"
run_gate "L2 Integration" "bun run test:integration"
run_gate "L3 E2E" "bun run test:e2e"

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          Release Gate Report              ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════╝${NC}"
echo ""
for result in "${RESULTS[@]}"; do
  echo -e "  ${result}"
done
echo ""
echo -e "  ${GREEN}Passed: ${PASS}${NC}  ${RED}Failed: ${FAIL}${NC}"

echo ""
if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}${BOLD}自动化门禁失败${NC}"
  exit 1
fi

echo -e "  ${GREEN}${BOLD}自动化门禁通过${NC}"
