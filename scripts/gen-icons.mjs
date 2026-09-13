// 图标生成器 —— 零依赖手写 PNG 编码器 + 4x 超采样抗锯齿
//
// 产出：
//   src/static/tabbar/  tabBar：线性描边（未选中）/ 实心填充（选中）
//   src/static/ui/      界面内联：相机 / 加号 / 箭头 / 关闭 / 警示
//   src/static/meal/    餐次实物图标：日出 / 太阳 / 月亮 / 苹果
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
	ihdr[8] = 8
	ihdr[9] = 6
	const stride = w * 4
	const raw = Buffer.alloc((stride + 1) * h)
	for (let y = 0; y < h; y++) {
		raw[y * (stride + 1)] = 0
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	])
}

/* ---------------- 图元 ---------------- */
const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

const lowerHalf = (cx, cy, rx, ry, yMax = Infinity) => (x, y) =>
	y >= cy && y <= yMax && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1

const upperHalf = (cx, cy, r) => (x, y) => y <= cy && disc(cx, cy, r)(x, y)

const roundRect = (x0, y0, w, h, r) => (x, y) => {
	if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false
	const dx = Math.max(x0 + r - x, 0, x - (x0 + w - r))
	const dy = Math.max(y0 + r - y, 0, y - (y0 + h - r))
	return dx * dx + dy * dy <= r * r
}

/** 圆头线段 */
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

/** 由中心点、角度（度，90 = 正上）与半径求坐标 */
const polar = (cx, cy, deg, r) => {
	const rad = (deg * Math.PI) / 180
	return [cx + Math.cos(rad) * r, cy - Math.sin(rad) * r]
}

/* ---- 描边（线性图标）组合子 ---- */
const ring = (cx, cy, r, sw) => {
	const outer = disc(cx, cy, r + sw / 2)
	const inner = disc(cx, cy, r - sw / 2)
	return (x, y) => outer(x, y) && !inner(x, y)
}

const strokeLowerHalf = (cx, cy, rx, ry, yMax, sw) => {
	const outer = lowerHalf(cx, cy, rx + sw / 2, ry + sw / 2, yMax)
	const inner = lowerHalf(cx, cy, rx - sw / 2, ry - sw / 2, yMax)
	return (x, y) => outer(x, y) && !inner(x, y)
}

const strokeRoundRect = (x0, y0, w, h, r, sw) => {
	const outer = roundRect(x0 - sw / 2, y0 - sw / 2, w + sw, h + sw, r + sw / 2)
	const inner = roundRect(x0 + sw / 2, y0 + sw / 2, w - sw, h - sw, Math.max(0.1, r - sw / 2))
	return (x, y) => outer(x, y) && !inner(x, y)
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

/* ---------------- 配色（低饱和，莫兰迪倾向） ---------------- */
const hex = (h) => [
	parseInt(h.slice(1, 3), 16),
	parseInt(h.slice(3, 5), 16),
	parseInt(h.slice(5, 7), 16),
]

const INK = hex('#a8b3bd') // tabBar 未选中（线性）
const GREEN = hex('#52a98a') // 主色（选中填充）
const SOFT = hex('#c9d2da') // 箭头 / 关闭
const WHITE = hex('#ffffff')
const AMBER = hex('#d9a45b')
const BLUE = hex('#6e90cc')
const VIOLET = hex('#9c86cc')
const ALERT = hex('#c97b6e')

/* ---------------- tabBar：线性 + 实心 ---------------- */
const TAB = 81
const SW = 6.5 // 81 画布上约等于 2px 视觉粗细

// 饭碗
const bowlLine = () => [segR(13.5, 36, 67.5, 36, SW), strokeLowerHalf(40.5, 36, 27, 25, 61, SW)]
const bowlSolid = () => [roundRect(11, 32.5, 59, 7, 3.5), lowerHalf(40.5, 36, 27, 25, 61)]

// 柱状图
const barsLine = () => [
	strokeRoundRect(12.5, 47, 16, 19, 4, SW),
	strokeRoundRect(33.5, 37, 16, 29, 4, SW),
	strokeRoundRect(54.5, 27, 16, 39, 4, SW),
]
const barsSolid = () => [
	roundRect(12.5, 47, 16, 19, 4),
	roundRect(33.5, 37, 16, 29, 4),
	roundRect(54.5, 27, 16, 39, 4),
]

// 人像
const personLine = () => [ring(40.5, 25, 13, SW), strokeLowerHalf(40.5, 49, 23, 24, 68, SW)]
const personSolid = () => [disc(40.5, 25, 13), lowerHalf(40.5, 49, 23, 24, 68)]

/* ---------------- 界面内联图标 ---------------- */
const UI = 96

const camera = () => ({
	shapes: [roundRect(9, 28, 78, 54, 13), roundRect(31, 17, 34, 14, 7), disc(48, 55, 17)],
	holes: [disc(48, 55, 9.5)],
})

const plus = () => ({ shapes: [roundRect(27, 43, 42, 10, 5), roundRect(43, 27, 10, 42, 5)] })

const chevron = () => ({ shapes: [segR(37, 26, 62, 48, 9), segR(62, 48, 37, 70, 9)] })

const close = () => ({ shapes: [segR(35, 35, 61, 61, 9), segR(61, 35, 35, 61, 9)] })

// 警示：实心圆挖出感叹号
const alert = () => ({
	shapes: [disc(48, 48, 30)],
	holes: [roundRect(43, 29, 10, 25, 5), disc(48, 66, 6)],
})

/* ---------------- 餐次实物图标 ---------------- */
// 日出：地平线 + 上半圆 + 三道光芒
const sunrise = () => {
	const cx = 48
	const cy = 64
	const rays = []
	for (const deg of [90, 135, 45]) {
		const [x1, y1] = polar(cx, cy, deg, 23)
		const [x2, y2] = polar(cx, cy, deg, 33)
		rays.push(segR(x1, y1, x2, y2, 6))
	}
	return { shapes: [upperHalf(cx, cy, 17), segR(10, cy, 86, cy, 7), ...rays] }
}

// 太阳：实心圆 + 八道光芒
const sun = () => {
	const cx = 48
	const cy = 48
	const rays = []
	for (let deg = 0; deg < 360; deg += 45) {
		const [x1, y1] = polar(cx, cy, deg, 22)
		const [x2, y2] = polar(cx, cy, deg, 31)
		rays.push(segR(x1, y1, x2, y2, 6))
	}
	return { shapes: [disc(cx, cy, 15), ...rays] }
}

// 月亮：大圆挖掉一个偏移圆成月牙
const moon = () => ({
	shapes: [disc(46, 48, 21)],
	holes: [disc(60, 41, 19)],
})

// 苹果：两个交叠圆成微宽果身 + 果柄
const apple = () => ({
	shapes: [disc(39, 54, 17), disc(57, 54, 17), segR(48, 36, 48, 24, 6)],
})

/* ---------------- 输出 ---------------- */
function write(dir, name, size, spec, rgb) {
	fs.mkdirSync(dir, { recursive: true })
	const result = typeof spec === 'function' ? spec() : spec
	const shapes = Array.isArray(result) ? result : result.shapes
	const holes = Array.isArray(result) ? [] : result.holes || []
	fs.writeFileSync(path.join(dir, name), encodePNG(render(size, shapes, rgb, holes), size, size))
	console.log(`  ✓ ${path.relative(process.cwd(), path.join(dir, name))}`)
}

const TAB_DIR = path.join(STATIC, 'tabbar')
const UI_DIR = path.join(STATIC, 'ui')
const MEAL_DIR = path.join(STATIC, 'meal')

console.log('tabBar（线性 → 实心）:')
for (const [name, lineFn, solidFn] of [
	['record', bowlLine, bowlSolid],
	['stats', barsLine, barsSolid],
	['mine', personLine, personSolid],
]) {
	write(TAB_DIR, `${name}.png`, TAB, lineFn, INK)
	write(TAB_DIR, `${name}-on.png`, TAB, solidFn, GREEN)
}

console.log('\n界面图标:')
write(UI_DIR, 'camera.png', UI, camera, WHITE)
write(UI_DIR, 'camera-gray.png', UI, camera, INK)
write(UI_DIR, 'plus.png', UI, plus, GREEN)
write(UI_DIR, 'plus-white.png', UI, plus, WHITE)
write(UI_DIR, 'chevron.png', UI, chevron, SOFT)
write(UI_DIR, 'close.png', UI, close, SOFT)
write(UI_DIR, 'close-white.png', UI, close, WHITE)
write(UI_DIR, 'alert.png', UI, alert, ALERT)

console.log('\n餐次图标:')
write(MEAL_DIR, 'breakfast.png', UI, sunrise, AMBER)
write(MEAL_DIR, 'lunch.png', UI, sun, GREEN)
write(MEAL_DIR, 'dinner.png', UI, moon, BLUE)
write(MEAL_DIR, 'snack.png', UI, apple, VIOLET)

console.log('\n完成')
