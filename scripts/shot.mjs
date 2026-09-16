// 截图工具：用无头 Edge 通过 CDP 打开页面并截图（默认 492px，接近安卓真机宽度）
//
// 用法:
//   node scripts/serve-dist.mjs 4173 &
//   node scripts/shot.mjs "http://localhost:4173/seed-stats.html" node_modules/.cache/stats.png 492 1200
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9500 + Math.floor(process.pid % 400)

const [url, outPath, wArg, hArg] = process.argv.slice(2)
if (!url || !outPath) {
	console.error('用法: node scripts/shot.mjs <url> <out.png> [宽] [高]')
	process.exit(1)
}
const width = Number(wArg) || 492
const height = Number(hArg) || 1100

const prof = path.resolve(__dirname, `../node_modules/.cache/shot-profile-${process.pid}`)
fs.rmSync(prof, { recursive: true, force: true })

const edge = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${prof}`,
		'--no-first-run',
		'--disable-gpu',
		'--hide-scrollbars',
		`--window-size=${width},${height}`,
		'about:blank',
	],
	{ stdio: 'ignore' }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targetWs() {
	for (let i = 0; i < 60; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
			const list = await r.json()
			const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
			if (page) return page.webSocketDebuggerUrl
		} catch (e) {
			/* 还没起来 */
		}
		await sleep(250)
	}
	throw new Error('连不上无头浏览器')
}

const wsUrl = await targetWs()
// Node 22+ 自带 WebSocket，不用额外依赖
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
	ws.onopen = res
	ws.onerror = rej
})

let id = 0
const pending = new Map()
ws.onmessage = (e) => {
	const m = JSON.parse(e.data)
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m)
		pending.delete(m.id)
	}
}
const send = (method, params = {}) =>
	new Promise((res, rej) => {
		const myId = ++id
		pending.set(myId, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)))
		ws.send(JSON.stringify({ id: myId, method, params }))
	})

await send('Emulation.setDeviceMetricsOverride', {
	width,
	height,
	deviceScaleFactor: 2,
	mobile: true,
})
await send('Page.enable')
await send('Page.navigate', { url })
await sleep(Number(process.env.SHOT_WAIT || 3200))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
console.log(`✓ ${outPath} (${width}×${height})`)

ws.close()
edge.kill()
process.exit(0)
