// 设置站点登录密码：npm run passwd -- <新密码>；不带参数则随机生成一个。
// 修改后所有已登录的会话都会失效。
import crypto from 'node:crypto'
import { setPassword } from '../docs/.vitepress/auth.mjs'

let password = process.argv[2]
if (!password) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  password = Array.from(crypto.randomBytes(16), (b) => chars[b % chars.length]).join('')
} else if (password.length < 8) {
  console.error('密码至少 8 位')
  process.exit(1)
}
setPassword(password)
console.log(`登录密码已设置：${password}`)
