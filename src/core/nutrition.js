/**
 * 营养计算（纯函数）
 *
 * 数据模型核心约定（缺口 A1）：
 *   每条食物项存「每 100g 基准值」per100 + 实际克数 grams，
 *   所有展示值由 per100 × grams/100 派生。
 *   → 用户改克数时营养自动联动，且不会出现「改热量导致数据自相矛盾」。
 */
import { KCAL_PER_GRAM, MACRO_RATIO } from './constants.js'

export const EMPTY_TOTALS = { kcal: 0, protein: 0, fat: 0, carbs: 0 }

export function round(n, digits = 1) {
	if (!isFinite(n)) return 0
	const f = Math.pow(10, digits)
	return Math.round(n * f) / f
}

export function emptyPer100() {
	return { kcal: 0, protein: 0, fat: 0, carbs: 0 }
}

/** 单条食物项 → 实际营养摄入 */
export function itemTotals(item) {
	if (!item) return { ...EMPTY_TOTALS }
	const k = (Number(item.grams) || 0) / 100
	const p = item.per100 || {}
	return {
		kcal: round((Number(p.kcal) || 0) * k),
		protein: round((Number(p.protein) || 0) * k),
		fat: round((Number(p.fat) || 0) * k),
		carbs: round((Number(p.carbs) || 0) * k),
	}
}

/** 累加多条食物项 */
export function sumItems(items) {
	const acc = { ...EMPTY_TOTALS }
	for (const it of items || []) {
		const t = itemTotals(it)
		acc.kcal = round(acc.kcal + t.kcal)
		acc.protein = round(acc.protein + t.protein)
		acc.fat = round(acc.fat + t.fat)
		acc.carbs = round(acc.carbs + t.carbs)
	}
	return acc
}

/** 单条记录总营养 */
export function recordTotals(record) {
	return sumItems((record && record.items) || [])
}

/** 多条记录汇总 */
export function sumRecords(records) {
	return sumItems(
		(records || []).reduce((all, r) => all.concat((r && r.items) || []), [])
	)
}

/** 记录总克数 */
export function recordGrams(record) {
	return round(
		((record && record.items) || []).reduce((s, it) => s + (Number(it.grams) || 0), 0),
		0
	)
}

/**
 * 由「一份的实际营养 + 实际克数」反推 per100 基准。
 * 用于手动录入：用户只填热量和克数时补齐基准值。
 */
export function per100FromServing(serving) {
	const g = Number(serving && serving.grams) || 0
	if (g <= 0) return emptyPer100()
	const k = 100 / g
	return {
		kcal: round((Number(serving.kcal) || 0) * k),
		protein: round((Number(serving.protein) || 0) * k),
		fat: round((Number(serving.fat) || 0) * k),
		carbs: round((Number(serving.carbs) || 0) * k),
	}
}

/** 由三大营养素克数推算总热量（校验用） */
export function kcalFromMacros(macros) {
	const m = macros || {}
	return round(
		(Number(m.protein) || 0) * KCAL_PER_GRAM.protein +
			(Number(m.fat) || 0) * KCAL_PER_GRAM.fat +
			(Number(m.carbs) || 0) * KCAL_PER_GRAM.carbs,
		0
	)
}

/** 由热量目标推导三大营养素默认克数目标（缺口 D2） */
export function macroGoalsFromKcal(kcal, ratio = MACRO_RATIO) {
	const k = Number(kcal) || 0
	return {
		protein: Math.round((k * ratio.protein) / KCAL_PER_GRAM.protein),
		fat: Math.round((k * ratio.fat) / KCAL_PER_GRAM.fat),
		carbs: Math.round((k * ratio.carbs) / KCAL_PER_GRAM.carbs),
	}
}

/** 百分比（分母为 0 时返回 0），可选上限 */
export function percent(value, total, max = Infinity) {
	const t = Number(total) || 0
	if (t <= 0) return 0
	const p = ((Number(value) || 0) / t) * 100
	return Math.min(round(p, 0), max)
}

/** 千分位分组：1217 → '1,217'（让大数字更易读） */
export function groupDigits(n) {
	const v = Math.round(Number(n) || 0)
	const neg = v < 0
	const s = String(Math.abs(v))
	let out = ''
	for (let i = 0; i < s.length; i++) {
		if (i > 0 && (s.length - i) % 3 === 0) out += ','
		out += s[i]
	}
	return (neg ? '-' : '') + out
}
