#!/bin/bash
# 用 pm2 托管文档站（V8 内存参数与 RSS 重启阈值见 ecosystem.config.cjs）
set -euo pipefail
cd "$(dirname "$0")/.."

# 先删 pm2 里的 doc，否则下面 kill 掉后 autorestart 会立刻再占上 7788
npx pm2 delete doc >/dev/null 2>&1 || true

if lsof -nP -iTCP:7788 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "释放 7788..."
  for pid in $(lsof -tiTCP:7788 -sTCP:LISTEN 2>/dev/null); do
    echo "  kill $pid"
    kill "$pid" || true
  done
  sleep 1
  for pid in $(lsof -tiTCP:7788 -sTCP:LISTEN 2>/dev/null); do
    echo "  kill -9 $pid"
    kill -9 "$pid" || true
  done
  sleep 1
  if lsof -nP -iTCP:7788 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "无法释放 7788，请手动: lsof -tiTCP:7788 -sTCP:LISTEN | xargs kill -9" >&2
    exit 1
  fi
fi

npx pm2 start ecosystem.config.cjs
npx pm2 save
npx pm2 status
echo
curl -sI --noproxy '*' http://127.0.0.1:7788/dp/ | head -5
echo
echo "开机自启（可选）: npx pm2 startup   # 再按提示执行 sudo 那行"
