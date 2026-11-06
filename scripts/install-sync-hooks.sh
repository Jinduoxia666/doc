#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
chmod +x .githooks/post-commit
git config --local core.hooksPath "$root/.githooks"
if [[ -d .content.git ]]; then
  git --git-dir=.content.git config --local core.hooksPath "$root/.githooks"
fi
echo '已安装：主仓库和已初始化的文档内容仓库 commit 后同步到 mini-100'
