// 文档内容的版本记录：npm run content -- <init|commit|status|log|diff|install|uninstall>
// 个人文档不进主仓库，改由单独的 git 仓库 .content.git 管理（工作区为 docs/），
// launchd 每天定时执行一次 commit，有改动才提交；配置了远程仓库则顺带推送。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const gitDir = path.join(root, '.content.git')
const workTree = path.join(root, 'docs')

const site = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'site.json'), 'utf-8'))
  } catch {
    return {}
  }
})()
const label = site.contentLabel || 'local.doc-daily-commit'
const [hour, minute] = (site.contentCommitAt || '23:30').split(':').map(Number)
const plist = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`)
const logFile = path.join(os.homedir(), 'Library/Logs/doc-daily-commit.log')
const domain = `gui/${process.getuid()}`

const git = (args, opts = {}) =>
  execFileSync('git', [`--git-dir=${gitDir}`, `--work-tree=${workTree}`, ...args], {
    cwd: workTree,
    encoding: 'utf-8',
    ...opts,
  })
const run = (args) => git(args, { stdio: 'inherit' })

const commands = {
  init() {
    if (fs.existsSync(gitDir)) return console.log('已初始化：.content.git')
    git(['init', '--quiet', '--initial-branch=main'])
    // 站点骨架（.vitepress）归主仓库管，这里只记录内容
    fs.writeFileSync(path.join(gitDir, 'info/exclude'), '.vitepress/\n.DS_Store\n')
    console.log('已初始化：.content.git')
    commands.commit('初始导入')
  },

  commit(message) {
    git(['add', '-A'])
    const changed = git(['diff', '--cached', '--name-status']).trim()
    const stamp = new Date().toLocaleString('sv-SE').slice(0, 16)
    if (!changed) return console.log(`[${stamp}] 没有改动`)
    const lines = changed.split('\n')
    git(['commit', '--quiet', '-m', `${message || '每日快照'} ${stamp.slice(0, 10)}：${lines.length} 个文件`, '-m', changed])
    console.log(`[${stamp}] 已提交 ${lines.length} 个文件\n${changed}`)
    if (git(['remote']).trim()) {
      try {
        run(['push', '--quiet', 'origin', 'HEAD'])
      } catch {
        console.error('推送失败，下次提交时会一并推送')
      }
    }
  },

  status: () => run(['status', '--short']),
  // npm run content -- log [文件]   文件路径相对 docs/，如 projects/wrzy.md
  log: (file) => run(['log', '--stat', '--date=format:%Y-%m-%d %H:%M', ...(file ? ['--follow', '--', file] : [])]),
  // npm run content -- diff [提交] [文件]   默认对比上次提交与当前工作区
  diff: (...args) => run(['diff', ...args]),

  install() {
    fs.mkdirSync(path.dirname(plist), { recursive: true })
    fs.writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${fileURLToPath(import.meta.url)}</string>
    <string>commit</string>
  </array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>${logFile}</string>
  <key>StandardErrorPath</key><string>${logFile}</string>
</dict>
</plist>
`,
    )
    try {
      execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' })
    } catch {}
    execFileSync('launchctl', ['bootstrap', domain, plist])
    console.log(`已安装定时任务 ${label}：每天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 提交，日志 ${logFile}`)
  },

  uninstall() {
    try {
      execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' })
    } catch {}
    fs.rmSync(plist, { force: true })
    console.log(`已卸载定时任务 ${label}`)
  },
}

const [action, ...args] = process.argv.slice(2)
if (!commands[action]) {
  console.error(`用法：npm run content -- <${Object.keys(commands).join('|')}>`)
  process.exit(1)
}
if (action !== 'init' && action !== 'uninstall' && !fs.existsSync(gitDir)) {
  console.error('尚未初始化，先执行：npm run content -- init')
  process.exit(1)
}
commands[action](...args)
