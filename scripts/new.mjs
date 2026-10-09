// 用法：npm run new -- <分类目录>/<文件名> [标题]
// 例如：npm run new -- backend/spring-transaction "Spring 事务传播"
import fs from 'node:fs'
import path from 'node:path'

const [target, ...rest] = process.argv.slice(2)
if (!target) {
  console.error('用法：npm run new -- <分类目录>/<文件名> [标题]')
  process.exit(1)
}

const file = path.resolve('docs', target.endsWith('.md') ? target : `${target}.md`)
if (fs.existsSync(file)) {
  console.error(`已存在：${path.relative(process.cwd(), file)}`)
  process.exit(1)
}

const title = rest.join(' ') || path.basename(file, '.md')
const date = new Date().toISOString().slice(0, 10)
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, `---\ntitle: ${title}\ndate: ${date}\ntags: []\n---\n\n# ${title}\n\n`)
console.log(`已创建：${path.relative(process.cwd(), file)}`)
