/**
 * 统计聚合（纯函数，输入记录数组，输出可直接渲染的结构）
 */
import { MEALS } from './constants.js'
import { eachDay } from './date.js'
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
		return { key: m.key, label: m.label, short: m.short, count: list.length, totals: sumRecords(list) }
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
