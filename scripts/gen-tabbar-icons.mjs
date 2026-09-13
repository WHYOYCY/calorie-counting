// tabBar 图标生成器 —— 零依赖手写 PNG 编码器 + 4x 超采样抗锯齿
// 用法: node scripts/gen-tabbar-icons.mjs
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../src/static/tabbar')

const SIZE = 81 // tabBar 标准尺寸
const SS = 4 // 超采样倍数

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (() => {
	const t = new Int32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		t[n] = c
	}
	return t
})()

function crc32(buf) {
	let c = 0xffffffff
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length, 0)
	const t = Buffer.from(type, 'ascii')
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
	return Buffer.concat([len, t, data, crc])
}

function encodePNG(rgba, w, h) {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0)
	ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // RGBA
	const stride = w * 4
	const raw = Buffer.alloc((stride + 1) * h)
	for (let y = 0; y < h; y++) {
		raw[y * (stride + 1)] = 0 // filter: none
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	])
}

/* ---------------- 图元（连续坐标 0..81） ---------------- */
const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

/** 椭圆下半部（碗身 / 肩部） */
const lowerHalf = (cx, cy, rx, ry, yMax = Infinity) => (x, y) =>
	y >= cy && y <= yMax && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1

/** 圆角矩形 */
const roundRect = (x0, y0, w, h, r) => (x, y) => {
	if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false
	const dx = Math.max(x0 + r - x, 0, x - (x0 + w - r))
	const dy = Math.max(y0 + r - y, 0, y - (y0 + h - r))
	return dx * dx + dy * dy <= r * r
}

/* ---------------- 渲染 ---------------- */
function render(shapes, rgb) {
	const buf = Buffer.alloc(SIZE * SIZE * 4)
	const per = SS * SS
	for (let py = 0; py < SIZE; py++) {
		for (let px = 0; px < SIZE; px++) {
			let hit = 0
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const x = px + (sx + 0.5) / SS
					const y = py + (sy + 0.5) / SS
					for (let i = 0; i < shapes.length; i++) {
						if (shapes[i](x, y)) {
							hit++
							break
						}
					}
				}
			}
			const i = (py * SIZE + px) * 4
			buf[i] = rgb[0]
			buf[i + 1] = rgb[1]
			buf[i + 2] = rgb[2]
			buf[i + 3] = Math.round((hit / per) * 255)
		}
	}
	return buf
}

/* ---------------- 三个图标 ---------------- */
// 记录：饭碗（碗身 + 碗沿 + 圈足）
const iconRecord = () => [
	lowerHalf(40.5, 36, 27, 25, 61), // 碗身
	roundRect(11, 29, 59, 7, 3.5), // 碗沿
	roundRect(33.5, 59, 14, 6, 3), // 圈足
]

// 统计：柱状图（三根递增高柱）
const iconStats = () => [
	roundRect(12.5, 47, 16, 19, 4),
	roundRect(33.5, 37, 16, 29, 4),
	roundRect(54.5, 27, 16, 39, 4),
]

// 我的：人像（头 + 肩）
const iconMine = () => [disc(40.5, 25, 13), lowerHalf(40.5, 49, 23, 24, 68)]

const GRAY = [0x9c, 0xa3, 0xaf] // 未选中
const GREEN = [0x22, 0xc5, 0x5e] // 选中

const TARGETS = [
	['record', iconRecord],
	['stats', iconStats],
	['mine', iconMine],
]

fs.mkdirSync(OUT_DIR, { recursive: true })
for (const [name, shapeFn] of TARGETS) {
	const shapes = shapeFn()
	fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), encodePNG(render(shapes, GRAY), SIZE, SIZE))
	fs.writeFileSync(
		path.join(OUT_DIR, `${name}-on.png`),
		encodePNG(render(shapes, GREEN), SIZE, SIZE)
	)
	console.log(`✓ ${name}.png / ${name}-on.png`)
}
console.log(`\n输出目录: ${OUT_DIR}`)
