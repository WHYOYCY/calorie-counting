// 极简静态服务器 —— 用于把 H5 构建产物跑起来做冒烟测试
// 用法: node scripts/serve-dist.mjs [port]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../dist/build/h5')
const PORT = Number(process.argv[2]) || 4173

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
}

if (!fs.existsSync(ROOT)) {
	console.error(`构建产物不存在: ${ROOT}\n请先执行 npm run build:h5`)
	process.exit(1)
}

http
	.createServer((req, res) => {
		let p = decodeURIComponent(req.url.split('?')[0].split('#')[0])
		if (p === '/') p = '/index.html'
		let file = path.join(ROOT, p)
		if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			file = path.join(ROOT, 'index.html') // SPA 回退
		}
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
		fs.createReadStream(file).pipe(res)
	})
	.listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`))
