/**
 * 统计聚合（纯函数，输入记录数组，输出可直接渲染的结构）
 */
import { MEALS } from './constants.js'
import { addDays, eachDay, parseKey, startOfWeek } from './date.js'
import { round, sumRecords, itemTotals } from './nutrition.js'

/** 逐日序列：区间内每一天都有一天，没记录的天计数为 0 */
export function dailySeries(records, fromKey, toKey) {
	const days = eachDay(fromKey, toKey)
	const map = new Map()
	for (const d of days) map.set(d, [])
	for (const r of records || []) {
		const bucket = map.get(r.date)
		if (bucket) bucket.push(r)
	}
	return days.map((d) => {
		const list = bucket_sorted(map.get(d))
		return { date: d, count: list.length, totals: sumRecords(list), records: list }
	})
}

function bucket_sorted(list) {
	return list.slice().sort((a, b) => b.ts - a.ts)
}

/**
 * 区间汇总
 * @param goal 每日热量目标，用于计算达标率
 */
export function rangeSummary(records, fromKey, toKey, goal = 0) {
	const series = dailySeries(records, fromKey, toKey)
	const totals = sumRecords(records)
	const active = series.filter((s) => s.count > 0)
	const dayCount = series.length
	const g = Number(goal) || 0

	let under = 0
	let over = 0
	if (g > 0) {
		for (const s of active) {
			if (s.totals.kcal > g) over++
			else under++
		}
	}

	let maxDay = null
	let minDay = null
	for (const s of active) {
		if (!maxDay || s.totals.kcal > maxDay.totals.kcal) maxDay = s
		if (!minDay || s.totals.kcal < minDay.totals.kcal) minDay = s
	}

	return {
		from: fromKey,
		to: toKey,
		series,
		totals,
		dayCount,
		activeDays: active.length,
		avgPerDay: dayCount ? round(totals.kcal / dayCount, 0) : 0,
		avgPerActiveDay: active.length ? round(totals.kcal / active.length, 0) : 0,
		underDays: under,
		overDays: over,
		/** 达标率 = 未超标天数 / 有记录天数 */
		goalRate: active.length ? Math.round((under / active.length) * 100) : 0,
		maxDay,
		minDay,
	}
}

/** 按餐次拆分 */
export function mealBreakdown(records) {
	return MEALS.map((m) => {
		const list = (records || []).filter((r) => r.meal === m.key)
		return { ...m, count: list.length, totals: sumRecords(list) }
	})
}

/** 食物频次 / 热量榜 */
export function topFoods(records, limit = 10) {
	const map = new Map()
	for (const r of records || []) {
		for (const it of r.items || []) {
			const key = it.name
			if (!key) continue
			const cur = map.get(key) || { name: key, kcal: 0, grams: 0, times: 0 }
			cur.kcal = round(cur.kcal + itemTotals(it).kcal)
			cur.grams = round(cur.grams + (Number(it.grams) || 0), 0)
			cur.times += 1
			map.set(key, cur)
		}
	}
	return Array.from(map.values())
		.sort((a, b) => b.kcal - a.kcal || b.times - a.times)
		.slice(0, limit)
}

/**
 * 最近吃过的食物 —— 供手动录入时「一键复用」。
 * 按名称去重，保留最近一次使用的数据并累计次数。
 */
export function recentFoods(records, limit = 20) {
	const map = new Map()
	const sorted = (records || []).slice().sort((a, b) => b.ts - a.ts)
	for (const r of sorted) {
		for (const it of r.items || []) {
			if (!it.name) continue
			const cur = map.get(it.name)
			if (cur) {
				cur.times += 1
			} else {
				map.set(it.name, {
					name: it.name,
					grams: it.grams,
					per100: it.per100,
					times: 1,
					lastTs: r.ts,
				})
			}
		}
	}
	return Array.from(map.values())
		.sort((a, b) => b.lastTs - a.lastTs || b.times - a.times)
		.slice(0, limit)
}

/** 给柱状图用的每日热量数组（含标签） */
export function chartData(series, valueOf) {
	const pick = typeof valueOf === 'function' ? valueOf : (s) => s.totals.kcal
	const max = series.reduce((m, s) => Math.max(m, pick(s)), 0)
	return {
		max,
		bars: series.map((s) => {
			const v = pick(s)
			return {
				date: s.date,
				value: v,
				ratio: max > 0 ? v / max : 0,
			}
		}),
	}
}

/* ==================== 打卡热力图 ==================== */

/**
 * 一天的热量落在哪个挡位（0–4，共五挡）。
 *
 * 挡位按**当天热量占每日目标的比例**分，不是按绝对值 ——
 * 目标 1800 和 1400 的人，「吃了 1200」的意义完全不同。
 * 比例分界：<50% / <80% / <100%（达标）/ ≥100%（超标）。
 *
 * 没设目标（goal <= 0）时退化成固定阈值，免得除零后全落到同一挡。
 */
export function intakeLevel(kcal, goal = 0) {
	const k = Number(kcal) || 0
	if (k <= 0) return 0
	const g = Number(goal) || 0
	if (g > 0) {
		const r = k / g
		if (r < 0.5) return 1
		if (r < 0.8) return 2
		if (r < 1) return 3
		return 4
	}
	if (k < 400) return 1
	if (k < 900) return 2
	if (k < 1400) return 3
	return 4
}

/**
 * 打卡热力图的数据：按周分列，每列 7 天（周一到周日）。
 *
 * @param records 记录数组（至少覆盖这段时间）
 * @param weeks   显示多少周，默认 26（半年）
 * @param endKey  最后一天（通常是今天），它所在的那一列是最后一列
 * @param goal    每日目标
 * @returns { weeks, cells: 二维数组 [列][行], months: 每列对应的月份标签 }
 *
 * 未来日期（本列中今天之后的日子）标 future=true，渲染成空白，
 * 不画成「没记录」—— 那会让人误以为你那天没打卡。
 */
export function heatmap(records, { weeks = 26, endKey, goal = 0 } = {}) {
	const n = Math.max(1, Number(weeks) || 26)
	const last = endKey || ''
	// 最后一列 = endKey 所在周的周一；第一列再往前推 n-1 周
	const lastMonday = startOfWeek(last)
	const firstMonday = addDays(lastMonday, -7 * (n - 1))

	// 按日期分桶，再交给 sumRecords 算 —— 不在统计层重算一遍营养，
	// 两份算法迟早会不一致
	const byDate = new Map()
	for (const r of records || []) {
		const list = byDate.get(r.date) || []
		list.push(r)
		byDate.set(r.date, list)
	}

	const cols = []
	const months = []
	for (let c = 0; c < n; c++) {
		const monday = addDays(firstMonday, c * 7)
		const col = []
		for (let d = 0; d < 7; d++) {
			const date = addDays(monday, d)
			const hit = byDate.get(date)
			const future = date > last
			const kcal = hit ? Math.round(sumRecords(hit).kcal) : 0
			col.push({
				date,
				kcal,
				count: hit ? hit.length : 0,
				level: future ? 0 : intakeLevel(kcal, goal),
				future,
			})
		}
		cols.push(col)
		months.push(monthOf(monday))
	}
	return { weeks: n, from: firstMonday, to: addDays(lastMonday, 6), cells: cols, months }
}

function monthOf(key) {
	const d = parseKey(key)
	return Number.isFinite(d.getTime()) ? d.getMonth() + 1 : 0
}
