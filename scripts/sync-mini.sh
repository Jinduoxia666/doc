#!/bin/bash
# 本机是文档源；mini-100 上的登录和分享记录不被日常同步覆盖。
set -euo pipefail
cd "$(dirname "$0")/.."

lock="${TMPDIR:-/tmp}/doc-sync-mini.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo '已有同步任务在运行，请稍后重试。' >&2
  exit 1
fi
changes=$(mktemp)
trap 'rm -f "$changes"; rmdir "$lock"' EXIT

# macOS openrsync 的归档模式会刷新未修改文件的属性，触发 Vite 重启。
# 以内容校验和判断变化，不同步时间/权限，只有正文变化才触发热更新。
args=(-rlcz --delete --itemize-changes)
case "${1:-}" in
  '') ;;
  --dry-run) args+=(--dry-run) ;;
  *) echo '用法: bash scripts/sync-mini.sh [--dry-run]' >&2; exit 1 ;;
esac

/usr/bin/rsync "${args[@]}" \
  -e '/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=10 -o ServerAliveCountMax=2' \
  --exclude='/.git/' --exclude='/node_modules/' --exclude='/.pm2/' \
  --exclude='.DS_Store' --exclude='/docs/.vitepress/cache/' \
  --exclude='/docs/.vitepress/dist/' --exclude='/docs/.vitepress/.temp/' \
  --exclude='*.timestamp-*.mjs' \
  --exclude='/.auth.json' --exclude='/.shares.json*' \
  ./ mini-100:/Users/jdx/code/www/doc/ >"$changes"
cat "$changes"
if [[ "${1:-}" == --dry-run ]]; then exit 0; fi

# 正文由 VitePress 热更新；状态写在 node_modules 内，失败后再次执行仍会重试。
/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=8 \
  -o ServerAliveInterval=10 -o ServerAliveCountMax=2 mini-100 /bin/bash -s <<'REMOTE'
set -euo pipefail
cd /Users/jdx/code/www/doc
export PATH=/Users/jdx/.nvm/versions/node/v22.22.2/bin:/usr/bin:/bin
deps=$(shasum package.json package-lock.json)
runtime=$(shasum site.json ecosystem.config.cjs scripts/*)
restart=false
if [[ ! -x node_modules/.bin/vitepress || "$deps" != "$(cat node_modules/.doc-deps 2>/dev/null || true)" ]]; then
  npm ci --no-audit --no-fund
  printf '%s\n' "$deps" >node_modules/.doc-deps
  restart=true
fi
if [[ "$restart" == true || "$runtime" != "$(cat node_modules/.doc-runtime 2>/dev/null || true)" ]]; then
  launchctl kickstart -k gui/501/com.jdx.doc
  printf '%s\n' "$runtime" >node_modules/.doc-runtime
fi
REMOTE
