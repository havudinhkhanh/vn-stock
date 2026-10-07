#!/usr/bin/env bash
# Đẩy báo cáo chạy (log, probe_report, meta) lên nhánh `status` để Claude đọc được khi cần sửa lỗi.
# Dùng: bash scripts/publish_status.sh <tên-thư-mục-con> <file1> [file2 ...]
set -uo pipefail
sub="$1"; shift
tmp="$(mktemp -d)"
git config user.name "vn-stock-bot"
git config user.email "vn-stock-bot@users.noreply.github.com"
if git ls-remote --exit-code --heads origin status >/dev/null 2>&1; then
  git fetch -q --depth 1 origin status && git worktree add -q "$tmp/wt" FETCH_HEAD
else
  git worktree add -q --detach "$tmp/wt" && (cd "$tmp/wt" && git checkout -q --orphan status && git rm -rqf . >/dev/null 2>&1 || true)
fi
mkdir -p "$tmp/wt/$sub"
for f in "$@"; do [ -f "$f" ] && cp "$f" "$tmp/wt/$sub/"; done
date -u +"%Y-%m-%dT%H:%M:%SZ run ${GITHUB_RUN_ID:-local}" > "$tmp/wt/$sub/last_run.txt"
cd "$tmp/wt" && git add -A && git commit -qm "status: $sub ${GITHUB_RUN_ID:-}" && git push -q origin HEAD:status || echo "Không đẩy được báo cáo lên nhánh status"
