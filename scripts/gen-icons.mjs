// 图标生成器 —— 零依赖手写 PNG 编码器 + 4x 超采样抗锯齿
//
// 产出两类图标：
//   src/static/tabbar/  tabBar 用（碗 / 柱状图 / 人像，灰 + 绿两态）
//   src/static/ui/      界面内联用（相机 / 加号 / 箭头 / 关闭）
//
// 用法: node scripts/gen-icons.mjs
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATIC = path.resolve(__dirname, '../src/static')

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

/* ---------------- 图元（连续坐标，尺寸由调用方给出） ---------------- */
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

/** 圆头线段（用于箭头 / 叉号这类描边图形） */
const segR = (x1, y1, x2, y2, w) => {
	const r = w / 2
	const dx = x2 - x1
	const dy = y2 - y1
	const len2 = dx * dx + dy * dy
	const d1 = disc(x1, y1, r)
	const d2 = disc(x2, y2, r)
	return (x, y) => {
		if (d1(x, y) || d2(x, y)) return true
		let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0
		t = t < 0 ? 0 : t > 1 ? 1 : t
		const px = x1 + t * dx
		const py = y1 + t * dy
		return (x - px) ** 2 + (y - py) ** 2 <= r * r
	}
}

/* ---------------- 渲染 ---------------- */
function render(size, shapes, rgb, holes = []) {
	const buf = Buffer.alloc(size * size * 4)
	const per = SS * SS
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let hit = 0
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const x = px + (sx + 0.5) / SS
					const y = py + (sy + 0.5) / SS
					let inside = false
					for (let i = 0; i < shapes.length; i++) {
						if (shapes[i](x, y)) {
							inside = true
							break
						}
					}
					if (inside) {
						for (let i = 0; i < holes.length; i++) {
							if (holes[i](x, y)) {
								inside = false
								break
							}
						}
					}
					if (inside) hit++
				}
			}
			const i = (py * size + px) * 4
			buf[i] = rgb[0]
			buf[i + 1] = rgb[1]
			buf[i + 2] = rgb[2]
			buf[i + 3] = Math.round((hit / per) * 255)
		}
	}
	return buf
}

/* ---------------- 配色 ---------------- */
const hex = (h) => [
	parseInt(h.slice(1, 3), 16),
	parseInt(h.slice(3, 5), 16),
	parseInt(h.slice(5, 7), 16),
]

const GRAY = hex('#9aa6b2') // tabBar 未选中
const GREEN = hex('#0fa36b') // 主色
const WHITE = hex('#ffffff')
const SOFT = hex('#c3ccd5') // 列表箭头

/* ---------------- tabBar 图标（81×81，图形按 81 坐标系绘制） ---------------- */
const TAB_SIZE = 81

// 记录：饭碗（碗身 + 碗沿 + 圈足）
const iconBowl = () => [
	lowerHalf(40.5, 36, 27, 25, 61),
	roundRect(11, 29, 59, 7, 3.5),
	roundRect(33.5, 59, 14, 6, 3),
]

// 统计：柱状图（三根递增高柱）
const iconBars = () => [
	roundRect(12.5, 47, 16, 19, 4),
	roundRect(33.5, 37, 16, 29, 4),
	roundRect(54.5, 27, 16, 39, 4),
]

// 我的：人像（头 + 肩）
const iconPerson = () => [disc(40.5, 25, 13), lowerHalf(40.5, 49, 23, 24, 68)]

/* ---------------- 界面内联图标（96×96 坐标系） ---------------- */
const UI_SIZE = 96

// 相机：机身 + 顶部取景凸起 + 镜头（挖空成环）
const iconCamera = () => ({
	shapes: [
		roundRect(9, 28, 78, 54, 13),
		roundRect(31, 17, 34, 14, 7),
		disc(48, 55, 17),
	],
	holes: [disc(48, 55, 9.5)],
})

// 加号：两根圆角横竖条
const iconPlus = () => ({
	shapes: [roundRect(27, 43, 42, 10, 5), roundRect(43, 27, 10, 42, 5)],
})

// 右箭头：两段圆头描边
const iconChevron = () => ({
	shapes: [segR(37, 26, 62, 48, 9), segR(62, 48, 37, 70, 9)],
})

// 关闭：两段交叉描边
const iconClose = () => ({
	shapes: [segR(35, 35, 61, 61, 9), segR(61, 35, 35, 61, 9)],
})

/* ---------------- 输出 ---------------- */
function write(dir, name, size, spec, rgb) {
	fs.mkdirSync(dir, { recursive: true })
	const result = typeof spec === 'function' ? spec() : spec
	// 兼容两种写法：返回图形数组，或返回 { shapes, holes }
	const shapes = Array.isArray(result) ? result : result.shapes
	const holes = Array.isArray(result) ? [] : result.holes || []
	fs.writeFileSync(path.join(dir, name), encodePNG(render(size, shapes, rgb, holes), size, size))
	console.log(`  ✓ ${path.relative(process.cwd(), path.join(dir, name))}`)
}

const TAB_DIR = path.join(STATIC, 'tabbar')
const UI_DIR = path.join(STATIC, 'ui')

console.log('tabBar 图标 (81×81):')
for (const [name, fn] of [
	['record', iconBowl],
	['stats', iconBars],
	['mine', iconPerson],
]) {
	write(TAB_DIR, `${name}.png`, TAB_SIZE, fn, GRAY)
	write(TAB_DIR, `${name}-on.png`, TAB_SIZE, fn, GREEN)
}

console.log('\n界面图标 (96×96):')
write(UI_DIR, 'camera.png', UI_SIZE, iconCamera, WHITE)
write(UI_DIR, 'plus.png', UI_SIZE, iconPlus, GREEN)
write(UI_DIR, 'plus-white.png', UI_SIZE, iconPlus, WHITE)
write(UI_DIR, 'chevron.png', UI_SIZE, iconChevron, SOFT)
write(UI_DIR, 'close.png', UI_SIZE, iconClose, SOFT)
write(UI_DIR, 'camera-gray.png', UI_SIZE, iconCamera, GRAY)

console.log('\n完成')
