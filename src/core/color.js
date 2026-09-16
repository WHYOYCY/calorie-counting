/**
 * 颜色小工具（纯逻辑，不依赖任何运行环境）
 *
 * 为什么需要：营养素、餐次这些颜色是**数据**（存在 constants.js 里），
 * 但要用它们画「浅底深字」的胶囊、堆叠条底衬时，就得按同一个色相算出
 * 半透明版和压暗版。直接写死在样式里的话，改一处颜色要改好几个地方。
 */

/** '#52a98a' / '#5a8' / '52a98a' → { r, g, b }；解析不了返回 null */
export function parseHex(hex) {
	let s = String(hex == null ? '' : hex).trim().replace(/^#/, '')
	if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
	if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
	return {
		r: parseInt(s.slice(0, 2), 16),
		g: parseInt(s.slice(2, 4), 16),
		b: parseInt(s.slice(4, 6), 16),
	}
}

function clamp255(n) {
	return Math.max(0, Math.min(255, Math.round(n)))
}

function hex2(n) {
	return clamp255(n).toString(16).padStart(2, '0')
}

/**
 * 半透明版：胶囊底色、堆叠条的底衬都用它。
 * 用 rgba() 而不是 8 位十六进制 —— 后者在老一点的 WebView 上会被整条丢掉。
 */
export function withAlpha(hex, alpha = 0.14) {
	const c = parseHex(hex)
	if (!c) return hex
	const a = Math.max(0, Math.min(1, Number(alpha)))
	return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`
}

/**
 * 压暗：浅底上的文字要够深才看得清。
 * amount 0.36 大约等于「同色系但明显更重」的感觉，比直接用原色更耐看。
 */
export function darken(hex, amount = 0.36) {
	const c = parseHex(hex)
	if (!c) return hex
	const k = Math.max(0, Math.min(1, Number(amount)))
	// 直接乘会让深色变得太黑，所以朝「保留一点原色」的方向插值
	return `#${hex2(c.r * (1 - k))}${hex2(c.g * (1 - k))}${hex2(c.b * (1 - k))}`
}
