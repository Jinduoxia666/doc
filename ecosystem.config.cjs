const path = require('node:path')

/** 文档站：VitePress dev（保留热更新），用 V8 参数压内存，超限由 pm2 自动重启 */
module.exports = {
  apps: [
    {
      name: 'doc',
      cwd: __dirname,
      script: path.join(__dirname, 'node_modules/vitepress/bin/vitepress.js'),
      args: 'dev docs',
      interpreter: 'node',
      // 实测 JS 堆实际只用 ~100MB，但默认参数下 V8 预留到 ~230MB 不归还，RSS 450MB 左右。
      // --max-semi-space-size=1：新生代从默认几十 MB 压到 1MB
      // --optimize-for-size：GC 更积极、空闲时归还内存
      // 两者合用 RSS 约 200~250MB，页面响应只慢几十毫秒（与 npm run dev 一致）
      // --max-old-space-size=256：堆上限，防 JS 堆无限涨
      // patch-netifs 仅在沙箱/无网卡枚举环境兜底，正常机器上是 no-op
      node_args:
        '--require ./scripts/patch-netifs.cjs --max-old-space-size=256 --max-semi-space-size=1 --optimize-for-size',
      // 不能按 256MB 杀进程（启动/首次编译会短暂冲高，会反复重启 → 502），只拦异常泄漏
      max_memory_restart: '400M',
      autorestart: true,
      watch: false,
      time: true,
    },
  ],
}
