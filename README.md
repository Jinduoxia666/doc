# 开发文档

基于 [VitePress](https://vitepress.dev) 的个人开发文档站，在本机运行，通过 nginx 反向代理对外访问，带站点登录和按文档密码分享。

## 快速开始

```bash
npm install
cp site.example.json site.json   # 按需修改，见下方「本机配置」
npm run passwd -- <登录密码>      # 不带参数则随机生成
npm run dev                       # 打开 http://localhost:7788/<base>/
```

## 命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式，改动实时生效（端口 7788） |
| `npm run serve` | 构建后以静态方式运行（同样是 7788，更快更稳） |
| `npm run new -- solutions/xxx "标题"` | 按模板新建文档 |
| `npm run passwd -- <新密码>` | 设置登录密码，改后所有已登录会话失效 |
| `npm run share:list` | 列出所有分享的链接和密码（需文档站在运行） |
| `npm run content -- <init\|commit\|status\|log\|diff\|install\|uninstall>` | 文档内容的版本记录，见下方「文档版本记录」 |

## 本机配置 `site.json`

域名、前缀等部署信息只放在本机的 `site.json`（已 gitignore），不进仓库。字段参考 `site.example.json`：

| 字段 | 说明 |
|---|---|
| `base` | 整站路径前缀，如 `/dp`，默认 `/dp`。同一域名可按前缀分给不同的人反代到各自主机，访问不带前缀的路径会 302 跳到前缀下 |
| `origin` | 分享链接使用的域名，如 `http://doc.example.com`；不填则用访问时的域名 |
| `contentLabel` | 文档每日提交的 launchd 服务名，默认 `local.doc-daily-commit` |
| `contentCommitAt` | 每日提交时间，默认 `23:30`，改后需重新 `npm run content -- install` |

修改后需重启服务。

## 文档

文档放在 `docs/<分类>/` 下，侧边栏按目录自动生成（子目录会变成可折叠分组）。新增分类：在 `docs/.vitepress/sidebar.mts` 的 `sections` 中加一行并建对应目录。

图片放 `docs/public/`，用 `/xxx.png` 引用；或与文档同目录用相对路径引用。

个人文档不进仓库：`.gitignore` 忽略 `docs/` 下除各分类 `index.md` 外的所有 Markdown 和 `docs/public/` 下除站点图标外的文件。

## 文档版本记录

个人文档由单独的 git 仓库 `.content.git` 记录（工作区为 `docs/`，忽略 `.vitepress/`），与主仓库互不影响，`.content.git` 本身已 gitignore。

```bash
npm run content -- init              # 首次：建库并提交现有文档
npm run content -- install           # 安装 launchd 定时任务，每天定时提交一次（有改动才提交）
npm run content -- commit ["说明"]    # 手动立即提交
npm run content -- log [projects/wrzy.md]   # 查看全部或某篇的历史
npm run content -- diff [提交] [文件]  # 查看改动，默认对比上次提交与工作区
npm run content -- uninstall         # 卸载定时任务
```

- 定时任务的 plist 在 `~/Library/LaunchAgents/<contentLabel>.plist`，日志在 `~/Library/Logs/doc-daily-commit.log`；Mac 在提交时间处于睡眠时，唤醒后补跑
- plist 里写的是安装时 node 的绝对路径，升级或切换 node 版本后需重新 `install`
- 需要异地备份时，给它加一个**私有**远程仓库，之后每次提交会自动推送：`git --git-dir=.content.git remote add origin <地址>`
- 回滚某篇：`git --git-dir=.content.git --work-tree=docs checkout <提交> -- projects/wrzy.md`

## 通过 nginx 反代对外访问

### 当前 `/dp` 部署与自动同步

- 本机 `/Users/jdx/code/www/doc` 是编辑源，mini-100 的同路径运行文档站，dell 将 `/dp/` 转发到 `10.10.1.100:7788`。
- 本机文档站已停止并禁用登录自启，日常编辑与提交同步无需启动本机服务。
- 本机通过 Git `post-commit` 钩子触发同步：主仓库 `git commit`、个人文档仓库提交（包括 `npm run content -- commit` 和每日定时提交）成功后都会同步。不再每 15 秒轮询；没有产生新 commit 时不会自动同步。
- commit 是同步触发点，同步范围仍是当前目录，包括尚未提交或被主仓库忽略的个人文档，新增、修改、删除都会同步。只在本机编辑文档，直接修改 mini-100 的文档会被下次同步覆盖。
- 提交后会等待同步结果；断网或同步失败不回滚 commit，会提示查看日志并手动重试，也可等下一次 commit 再同步。
- mini-100 的 launchd 服务 `com.jdx.doc` 托管 VitePress，退出后自动重启；Node 堆上限为 512MB，用户登录后加载。
- `docs/`、站点代码、`site.json` 和 `.content.git/` 会同步；依赖变化自动执行 `npm ci`，脚本及部署配置变化自动重启服务，正文变化走热更新。
- `.auth.json` 和 `.shares.json` 已在首次迁移时复制，日常同步排除它们。迁移后通过域名管理分享和登录密码；本机预览站的分享记录独立，不会上传。Git 主仓库、依赖、缓存和构建产物也不参与同步。

```bash
npm run sync:mini                  # 立即同步
npm run sync:mini -- --dry-run      # 只查看待同步的改动
npm run sync:install               # 安装/恢复本机两个仓库的提交钩子
tail -50 ~/Library/Logs/doc-sync-mini.log
ssh mini-100 'tail -50 ~/Library/Logs/doc.error.log'
ssh mini-100 'launchctl kickstart -k gui/501/com.jdx.doc'
```

提交触发的同步日志在本机 `~/Library/Logs/doc-sync-mini.log`；同步通过 SSH 别名 `mini-100` 连接，要求免交互认证。钩子路径由本机 Git 配置指定，重新克隆仓库或重新初始化文档内容仓库后需要执行 `npm run sync:install`。以下是其他路径前缀的通用配置步骤。

1. `site.json` 设置 `base`（如 `/zs`），启动服务
2. 固定本机内网 IP，防火墙放行 7788 入站
3. 在 nginx 站点中添加（`proxy_pass` 末尾不要加 `/`，要带着前缀转发）：

```nginx
location = /zs { return 301 /zs/; }

location ^~ /zs/ {
  proxy_pass http://<本机内网IP>:7788;
  proxy_set_header Host $http_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_read_timeout 600s;
}
```

## 登录

通过域名访问需要登录（单个管理员密码），本机访问 `localhost:7788` 免登录。

- 密码以 scrypt 哈希存在 `.auth.json`（已 gitignore），会话 cookie 30 天有效；同一 IP 10 分钟内最多输错 10 次
- 登录后的所有响应强制 `Cache-Control: private`，防止 CDN 把需登录的内容缓存后返回给未登录的人
- 实现在 `docs/.vitepress/auth.mjs` 和 `share.mjs` 的中间件里

## 文档分享

每篇文档顶部有「分享」按钮：生成专属链接 `<origin><base>/s/<id>` 和固定随机密码，别人凭密码只能看这一篇（30 天内免重复输入）。可随时重置密码或取消分享。

- 由 Vite 插件 `docs/.vitepress/share.mjs` 实现，跑在文档站自身上，没有单独的服务；文档站没启动时分享链接也打不开
- 只有「本机发起 + Host 为 localhost」的请求免登录；其他请求（反代、局域网直连）访问站点需先登录，分享页只凭分享密码
- 分享页只渲染被分享的那篇 Markdown，不加载站点前端资源和搜索索引，不会泄露其他文档
- 分享记录与密码存在 `.shares.json`（已 gitignore）；同一 IP 对同一文档 10 分钟内最多输错 10 次
- `npm run serve` 用 Vite 的 preview（`scripts/serve.mjs`）而不是 `vitepress preview`，因为后者不加载 Vite 插件
