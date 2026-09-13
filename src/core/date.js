/**
 * 日期与餐次工具（纯函数，不依赖 uni API，可在 Node 中直接测试）
 * 约定：所有日期键为本地时区的 'YYYY-MM-DD'
 */

export function pad2(n) {
	return n < 10 ? '0' + n : '' + n
}

/** 时间戳 → 'YYYY-MM-DD' */
export function dateKey(ts) {
	const d = new Date(ts)
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function todayKey(now = Date.now()) {
	return dateKey(now)
}

/** 'YYYY-MM-DD' → 本地零点的 Date */
export function parseKey(key) {
	const parts = String(key).split('-').map(Number)
	return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0)
}

/** 时间戳 → 'HH:mm' */
export function formatTime(ts) {
	const d = new Date(ts)
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function addDays(key, n) {
	const d = parseKey(key)
	d.setDate(d.getDate() + n)
	return dateKey(d.getTime())
}

/** 时间戳 → { date: 'YYYY-MM-DD', time: 'HH:mm' } */
export function splitDateTime(ts) {
	return { date: dateKey(ts), time: formatTime(ts) }
}

/** 'YYYY-MM-DD' + 'HH:mm' → 时间戳（本地时区，避免用字符串拼接导致时区偏移） */
export function combineDateTime(key, timeStr) {
	const d = parseKey(key)
	const parts = String(timeStr || '00:00').split(':')
	const h = Number(parts[0])
	const mi = Number(parts[1])
	d.setHours(isFinite(h) ? h : 0, isFinite(mi) ? mi : 0, 0, 0)
	return d.getTime()
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 日期标签：今天 / 昨天 / 明天 / M月D日 周X / YYYY年M月D日 */
export function dateLabel(key, now = Date.now()) {
	const today = todayKey(now)
	if (key === today) return '今天'
	if (key === addDays(today, -1)) return '昨天'
	if (key === addDays(today, 1)) return '明天'
	const d = parseKey(key)
	const w = WEEKDAYS[d.getDay()]
	if (d.getFullYear() === new Date(now).getFullYear()) {
		return `${d.getMonth() + 1}月${d.getDate()}日 周${w}`
	}
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** 周起点 = 周一 */
export function startOfWeek(key) {
	const d = parseKey(key)
	const day = d.getDay() // 0 = 周日
	d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
	return dateKey(d.getTime())
}

export function monthKey(key) {
	return String(key).slice(0, 7)
}

export function startOfMonth(key) {
	return monthKey(key) + '-01'
}

export function endOfMonth(key) {
	const d = parseKey(key)
	const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
	return dateKey(last.getTime())
}

/** 生成 [fromKey, toKey] 区间内所有日期键（含首尾，上限 400 天防御） */
export function eachDay(fromKey, toKey) {
	const out = []
	let cur = fromKey
	for (let i = 0; i < 400 && cur <= toKey; i++) {
		out.push(cur)
		cur = addDays(cur, 1)
	}
	return out
}

/** 相对今天的天数偏移（今天 = 0，昨天 = -1） */
export function dayOffset(key, now = Date.now()) {
	const a = parseKey(key).getTime()
	const b = parseKey(todayKey(now)).getTime()
	return Math.round((a - b) / 86400000)
}

/** 月份标签：'2026-09' → '2026年9月' */
export function monthLabel(mKey) {
	const parts = String(mKey).split('-')
	return `${parts[0]}年${Number(parts[1])}月`
}

/**
 * 按时间自动归类餐次。
 * 04–10 早餐、10–15 午餐、15–21 晚餐，其余（21–24 及 00–04 夜宵）为加餐。
 */
export function mealOfTs(ts) {
	const h = new Date(ts).getHours()
	if (h >= 4 && h < 10) return 'breakfast'
	if (h >= 10 && h < 15) return 'lunch'
	if (h >= 15 && h < 21) return 'dinner'
	return 'snack'
}
