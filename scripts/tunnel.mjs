// 管理 launchd 托管的 Cloudflare Tunnel：npm run tunnel -- <start|stop|restart|status|log>
// 服务名（launchd Label）从 site.json 的 tunnelLabel 读取，plist 放在 ~/Library/LaunchAgents/<Label>.plist
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

const site = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../site.json', import.meta.url), 'utf-8'))
  } catch {
    return {}
  }
})()
const label = site.tunnelLabel
if (!label) {
  console.error('site.json 未配置 tunnelLabel（launchd 服务名）')
  process.exit(1)
}

const domain = `gui/${process.getuid()}`
const plist = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`)
const commands = {
  start: `launchctl bootstrap ${domain} "${plist}"`,
  stop: `launchctl bootout ${domain}/${label}`,
  restart: `launchctl kickstart -k ${domain}/${label}`,
  status: `launchctl print ${domain}/${label} | grep -E "state|pid ="`,
  log: `tail -f "${path.join(os.homedir(), 'Library/Logs/doc-tunnel.log')}"`,
}

const action = process.argv[2]
if (!commands[action]) {
  console.error(`用法：npm run tunnel -- <${Object.keys(commands).join('|')}>`)
  process.exit(1)
}
execSync(commands[action], { stdio: 'inherit' })
