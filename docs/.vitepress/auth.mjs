// 站点登录：单个管理员密码（scrypt 哈希存在 .auth.json，已 gitignore），
// 登录后下发 HMAC 签名的会话 cookie。改密码会让所有已登录会话失效。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const STORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.auth.json')
export const SESSION_COOKIE = 'doc_session'
const SESSION_DAYS = 30

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf-8'))
  } catch {
    return null
  }
}

export function hasPassword() {
  return Boolean(load()?.hash)
}

export function setPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 32).toString('hex')
  // 换新 secret，让旧会话全部失效
  const data = { salt, hash, secret: crypto.randomBytes(32).toString('hex') }
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export function checkPassword(password) {
  const data = load()
  if (!data?.hash || typeof password !== 'string') return false
  const hash = crypto.scryptSync(password, data.salt, 32)
  return crypto.timingSafeEqual(hash, Buffer.from(data.hash, 'hex'))
}

function sign(secret, exp) {
  return crypto.createHmac('sha256', secret).update(`session:${exp}`).digest('base64url')
}

export function sessionCookie(secure) {
  const data = load()
  const exp = Date.now() + SESSION_DAYS * 86400 * 1000
  const value = `${exp}.${sign(data.secret, exp)}`
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

export function isLoggedIn(cookieValue) {
  const data = load()
  if (!data?.secret || !cookieValue) return false
  const [exp, sig] = cookieValue.split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  const expected = Buffer.from(sign(data.secret, exp))
  const actual = Buffer.from(sig)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}
