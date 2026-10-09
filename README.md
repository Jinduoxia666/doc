# 开发文档

基于 [VitePress](https://vitepress.dev) 的个人开发文档站，在本机运行，通过反向代理（nginx 或 Cloudflare Tunnel）对外访问，带站点登录和按文档密码分享。

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
| `npm run new -- backend/xxx "标题"` | 按模板新建文档 |
| `npm run passwd -- <新密码>` | 设置登录密码，改后所有已登录会话失效 |
| `npm run share:list` | 列出所有分享的链接和密码（需文档站在运行） |
| `npm run tunnel -- <start\|stop\|restart\|status\|log>` | 管理 launchd 托管的 Cloudflare Tunnel（macOS，可选） |

## 本机配置 `site.json`

域名、前缀等部署信息只放在本机的 `site.json`（已 gitignore），不进仓库。字段参考 `site.example.json`：

| 字段 | 说明 |
|---|---|
| `base` | 整站路径前缀，如 `/dp`，默认 `/dp`。同一域名可按前缀分给不同的人反代到各自主机，访问不带前缀的路径会 302 跳到前缀下 |
| `origin` | 分享链接使用的域名，如 `http://doc.example.com`；不填则用访问时的域名 |
| `tunnelLabel` | Cloudflare Tunnel 的 launchd 服务名，plist 位于 `~/Library/LaunchAgents/<tunnelLabel>.plist`；不用 Tunnel 可不填 |

修改后需重启服务。

## 文档

文档放在 `docs/<分类>/` 下，侧边栏按目录自动生成（子目录会变成可折叠分组）。新增分类：在 `docs/.vitepress/sidebar.mts` 的 `sections` 中加一行并建对应目录。

图片放 `docs/public/`，用 `/xxx.png` 引用；或与文档同目录用相对路径引用。

个人文档不进仓库：`.gitignore` 忽略 `docs/` 下除各分类 `index.md` 外的所有 Markdown 和 `docs/public/` 下除站点图标外的文件。

## 通过 nginx 反代对外访问

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
