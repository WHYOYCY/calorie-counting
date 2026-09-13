/**
 * 核心逻辑自测 —— 纯 Node 运行，不需要 App 环境
 *
 * 运行: npm test
 * 原理: 用 esbuild 打包成单文件再执行，从而绕开
 *       「package.json 无 type:module，但源码是 ESM」的解析问题。
 */
import {
	dateKey,
	todayKey,
	parseKey,
	formatTime,
	addDays,
	dateLabel,
	startOfWeek,
	startOfMonth,
	endOfMonth,
	eachDay,
	dayOffset,
	monthLabel,
	mealOfTs,
} from '../src/core/date.js'
import {
	round,
	itemTotals,
	sumItems,
	per100FromServing,
	macroGoalsFromKcal,
	kcalFromMacros,
	percent,
} from '../src/core/nutrition.js'
import {
	initDB,
	genId,
	normalizeRecord,
	saveRecord,
	allRecords,
	getRecord,
	recordsByDate,
	recordsInRange,
	deleteRecord,
	getSettings,
	saveSettings,
	exportAll,
	importAll,
	clearAll,
	_resetCache,
} from '../src/core/db.js'
import {
	dailySeries,
	rangeSummary,
	mealBreakdown,
	topFoods,
	recentFoods,
	chartData,
} from '../src/core/stats.js'
import { DEFAULT_DAILY_GOAL } from '../src/core/constants.js'

/* ---------------- 极简测试框架 ---------------- */
let pass = 0
let fail = 0
const failures = []

function group(name) {
	console.log(`\n── ${name} ──`)
}

function eq(actual, expected, label) {
	const a = JSON.stringify(actual)
	const b = JSON.stringify(expected)
	if (a === b) {
		pass++
		console.log(`  ✓ ${label}`)
	} else {
		fail++
		failures.push(label)
		console.log(`  ✗ ${label}\n      期望: ${b}\n      实际: ${a}`)
	}
}

function ok(cond, label) {
	eq(!!cond, true, label)
}

/* ---------------- uni API 仿真 ---------------- */
const store = new Map()
const removedFiles = []

globalThis.uni = {
	getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
	setStorageSync: (k, v) => {
		store.set(k, v)
	},
	removeStorageSync: (k) => {
		store.delete(k)
	},
	removeSavedFile: ({ filePath }) => {
		removedFiles.push(filePath)
	},
}

function freshStorage() {
	store.clear()
	removedFiles.length = 0
	_resetCache()
}

/** 构造本地时间戳，避免受运行机器时区影响 */
const T = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

/* ================= date.js ================= */
group('date.js · 日期键与格式化')
eq(dateKey(T(2026, 9, 13, 8, 30)), '2026-09-13', "dateKey → 'YYYY-MM-DD'")
eq(dateKey(T(2026, 1, 5)), '2026-01-05', '个位数月份/日期补零')
eq(formatTime(T(2026, 9, 13, 8, 5)), '08:05', "formatTime → 'HH:mm'")
eq(parseKey('2026-09-13').getDate(), 13, 'parseKey 解析到本地日期')
eq(addDays('2026-09-30', 1), '2026-10-01', 'addDays 跨月')
eq(addDays('2026-01-01', -1), '2025-12-31', 'addDays 跨年进位')
eq(dayOffset('2026-09-12', T(2026, 9, 13)), -1, 'dayOffset 昨天 = -1')

group('date.js · 日期标签')
eq(dateLabel('2026-09-13', T(2026, 9, 13)), '今天', '今天')
eq(dateLabel('2026-09-12', T(2026, 9, 13)), '昨天', '昨天')
eq(dateLabel('2026-09-11', T(2026, 9, 13)), '9月11日 周五', '同年显示月日+周几')
eq(dateLabel('2025-09-11', T(2026, 9, 13)), '2025年9月11日', '跨年显示完整日期')

group('date.js · 周/月边界')
// 2026-09-13 是周日 → 周一应为 09-07
eq(startOfWeek('2026-09-13'), '2026-09-07', '周日起点回退到本周一')
eq(startOfWeek('2026-09-07'), '2026-09-07', '周一自身不变')
eq(parseKey(startOfWeek('2026-09-13')).getDay(), 1, 'startOfWeek 结果必为周一')
eq(startOfMonth('2026-09-13'), '2026-09-01', '月初')
eq(endOfMonth('2026-02-10'), '2026-02-28', '平年 2 月 28 天')
eq(endOfMonth('2024-02-10'), '2024-02-29', '闰年 2 月 29 天')
eq(monthLabel('2026-09'), '2026年9月', '月份标签')

group('date.js · 日期序列')
eq(
	eachDay('2026-09-11', '2026-09-13'),
	['2026-09-11', '2026-09-12', '2026-09-13'],
	'eachDay 含首尾'
)
eq(eachDay('2026-09-13', '2026-09-13').length, 1, 'eachDay 单日')
eq(eachDay('2026-09-13', '2026-09-11').length, 0, 'eachDay 起止倒置返回空')

group('date.js · 餐次自动归类（含夜宵）')
eq(mealOfTs(T(2026, 9, 13, 4, 0)), 'breakfast', '04:00 早餐')
eq(mealOfTs(T(2026, 9, 13, 8, 30)), 'breakfast', '08:30 早餐')
eq(mealOfTs(T(2026, 9, 13, 10, 0)), 'lunch', '10:00 午餐')
eq(mealOfTs(T(2026, 9, 13, 14, 59)), 'lunch', '14:59 午餐')
eq(mealOfTs(T(2026, 9, 13, 15, 0)), 'dinner', '15:00 晚餐')
eq(mealOfTs(T(2026, 9, 13, 20, 59)), 'dinner', '20:59 晚餐')
eq(mealOfTs(T(2026, 9, 13, 21, 0)), 'snack', '21:00 加餐')
eq(mealOfTs(T(2026, 9, 13, 23, 59)), 'snack', '23:59 夜宵归加餐')
eq(mealOfTs(T(2026, 9, 13, 0, 30)), 'snack', '00:30 凌晨归当日加餐（缺口 A2 决议）')
eq(mealOfTs(T(2026, 9, 13, 3, 59)), 'snack', '03:59 仍为加餐')

/* ================= nutrition.js ================= */
group('nutrition.js · 换算与派生')
eq(round(1.25, 1), 1.3, 'round 保留 1 位')
eq(round(51.80, 1), 51.8, 'round 去掉尾随 0')
eq(round(NaN, 1), 0, 'round 处理 NaN')

const rice = { name: '米饭', grams: 200, per100: { kcal: 116, protein: 2.6, fat: 0.3, carbs: 25.9 } }
eq(
	itemTotals(rice),
	{ kcal: 232, protein: 5.2, fat: 0.6, carbs: 51.8 },
	'itemTotals 按克数换算 per100'
)
eq(
	itemTotals({ name: 'x', grams: 0, per100: rice.per100 }),
	{ kcal: 0, protein: 0, fat: 0, carbs: 0 },
	'克数为 0 → 全 0'
)
eq(
	itemTotals({ name: 'x', grams: 150, per100: { kcal: 100 } }),
	{ kcal: 150, protein: 0, fat: 0, carbs: 0 },
	'per100 缺字段按 0 处理'
)

eq(
	sumItems([rice, { name: '鸡胸', grams: 100, per100: { kcal: 165, protein: 31, fat: 3.6, carbs: 0 } }]),
	{ kcal: 397, protein: 36.2, fat: 4.2, carbs: 51.8 },
	'sumItems 累加多项'
)

eq(
	per100FromServing({ kcal: 232, grams: 200 }),
	{ kcal: 116, protein: 0, fat: 0, carbs: 0 },
	'per100FromServing 反推基准值'
)
eq(
	per100FromServing({ kcal: 100, grams: 0 }),
	{ kcal: 0, protein: 0, fat: 0, carbs: 0 },
	'per100FromServing 克数为 0 不除零'
)

eq(
	macroGoalsFromKcal(1800),
	{ protein: 90, fat: 50, carbs: 248 },
	'macroGoalsFromKcal 20/25/55 供能比'
)
eq(kcalFromMacros({ protein: 90, fat: 50, carbs: 248 }), 1802, 'kcalFromMacros 回算热量')
eq(percent(232, 1800), 13, 'percent 取整')
eq(percent(100, 0), 0, 'percent 分母为 0 不炸')

/* ================= db.js ================= */
group('db.js · 记录归一化')
freshStorage()

const derived = normalizeRecord({ ts: T(2026, 9, 13, 8, 30), items: [rice] })
eq(derived.date, '2026-09-13', 'date 由 ts 派生')
eq(derived.meal, 'breakfast', 'meal 由 ts 派生')
ok(derived.id && typeof derived.id === 'string', '自动生成 id')
eq(derived.source, 'manual', 'source 默认 manual')

const manual = normalizeRecord({
	ts: T(2026, 9, 13, 20, 0),
	meal: 'lunch',
	mealAuto: false,
	items: [rice],
})
eq(manual.meal, 'lunch', 'mealAuto:false 时保留手选餐次')

eq(
	normalizeRecord({ ts: T(2026, 9, 13), items: [{ name: '', grams: 100 }, { name: '米饭', grams: 0 }] })
		.items.length,
	0,
	'过滤掉无名/零克数的条目'
)
eq(genId() === genId(), false, 'genId 不重复')

group('db.js · 增删改查')
freshStorage()
initDB()
eq(allRecords(), [], '初始为空')

const r1 = saveRecord({ ts: T(2026, 9, 13, 8, 30), items: [rice], photo: 'food/a.jpg' })
const r2 = saveRecord({
	ts: T(2026, 9, 13, 12, 30),
	items: [{ name: '鸡胸', grams: 100, per100: { kcal: 165, protein: 31, fat: 3.6, carbs: 0 } }],
})
const r3 = saveRecord({ ts: T(2026, 9, 12, 19, 0), items: [rice] })

eq(allRecords().length, 3, '插入 3 条')
eq(allRecords().map((r) => r.id), [r2.id, r1.id, r3.id], '按时间倒序返回')
eq(getRecord(r1.id).id, r1.id, 'getRecord 命中')
eq(getRecord('nope'), null, 'getRecord 未命中返回 null')
eq(recordsByDate('2026-09-13').length, 2, 'recordsByDate 过滤当天')
eq(recordsInRange('2026-09-12', '2026-09-12').length, 1, 'recordsInRange 闭区间')

// 缺口 C1：改了时间，餐次与日期都要跟着重算
const moved = saveRecord({ ...r1, ts: T(2026, 9, 13, 20, 0) })
eq(moved.meal, 'dinner', 'C1: 改时间后餐次重算为晚餐')
eq(moved.createdAt, r1.createdAt, '更新时保留原始创建时间')
eq(allRecords().length, 3, '更新不新增记录')

const movedDay = saveRecord({ ...moved, ts: T(2026, 9, 14, 20, 0) })
eq(movedDay.date, '2026-09-14', 'C1: 跨天后 date 同步更新')

group('db.js · 照片文件清理（缺口 A4）')
freshStorage()
initDB()
removedFiles.length = 0
const withPhoto = saveRecord({
	ts: T(2026, 9, 13, 12, 0),
	items: [rice],
	photo: 'food/old.jpg',
})
saveRecord({ ...withPhoto, photo: 'food/new.jpg' })
eq(removedFiles, ['food/old.jpg'], '换图时删掉旧图')

removedFiles.length = 0
saveRecord({ ...withPhoto, photo: 'food/new.jpg' })
eq(removedFiles, [], '图片未变则不删')

deleteRecord(withPhoto.id)
eq(removedFiles.length >= 1, true, '删除记录时连带删图')

group('db.js · 设置')
freshStorage()
initDB()
const s0 = getSettings()
eq(s0.dailyGoal, DEFAULT_DAILY_GOAL, '默认热量目标')
eq(s0.model, 'qwen3-vl-flash', '默认模型')
eq(s0.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1', '默认 baseUrl')
eq(getSettings().apiKey, '', '默认不含 API Key（安全基线）')

saveSettings({ dailyGoal: 2000 })
eq(getSettings().dailyGoal, 2000, '设置写入生效')
eq(getSettings().model, 'qwen3-vl-flash', '未覆盖的字段保持默认')

group('db.js · 持久化与备份')
freshStorage()
initDB()
saveRecord({ ts: T(2026, 9, 13, 8, 0), items: [rice] })
saveRecord({ ts: T(2026, 9, 12, 8, 0), items: [rice] })

_resetCache()
eq(allRecords().length, 2, '清缓存后能从存储重新读出（真正落盘）')

const backup = exportAll()
eq(backup.records.length, 2, 'exportAll 含全部记录')
eq(backup.schemaVersion, 1, 'exportAll 带结构版本号')
ok(typeof backup.exportedAt === 'number', 'exportAll 带导出时间')

// merge：按 id 去重
const mergeRes = importAll(JSON.stringify(backup), 'merge')
eq(mergeRes.ok, true, 'importAll 接受 JSON 字符串')
eq(mergeRes.total, 2, 'merge 模式按 id 去重，不重复导入')

// merge：新增一条
const extra = { ...backup, records: [{ ...backup.records[0], id: 'manual-new-id' }] }
importAll(extra, 'merge')
eq(allRecords().length, 3, 'merge 模式导入新 id')

// replace：整体覆盖
importAll(backup, 'replace')
eq(allRecords().length, 2, 'replace 模式整体覆盖')

eq(importAll({ records: 'not-an-array' }).ok, false, '非法备份被拒绝')
eq(importAll('{ bad json').ok, false, '坏 JSON 被拒绝且不抛异常')

clearAll()
eq(allRecords().length, 0, 'clearAll 清空')
_resetCache()
eq(allRecords().length, 0, '清空已落盘')

/* ================= stats.js ================= */
group('stats.js · 逐日序列')
freshStorage()
initDB()
saveRecord({ ts: T(2026, 9, 13, 8, 30), items: [rice] })
saveRecord({ ts: T(2026, 9, 11, 12, 30), items: [rice] })

const recs = allRecords()
const series = dailySeries(recs, '2026-09-11', '2026-09-13')
eq(series.length, 3, '区间内每天都有一天（含无记录的 09-12）')
eq(series.map((s) => s.count), [1, 0, 1], '逐日记录条数')
eq(series[0].totals.kcal, 232, '逐日热量')

group('stats.js · 区间汇总')
const sum = rangeSummary(recs, '2026-09-11', '2026-09-13', 1800)
eq(sum.totals.kcal, 464, '区间总热量')
eq(sum.dayCount, 3, '区间总天数')
eq(sum.activeDays, 2, '有记录天数')
eq(sum.avgPerDay, 155, '日均（按全部天数）')
eq(sum.avgPerActiveDay, 232, '日均（仅有记录天）')
eq(sum.underDays, 2, '达标天数')
eq(sum.overDays, 0, '超标天数')
eq(sum.goalRate, 100, '达标率')
eq(sum.maxDay.date, '2026-09-11', '最高热量日')
eq(sum.minDay.date, '2026-09-11', '最低热量日（仅在有记录天内比较）')

const over = rangeSummary(
	[{ ...recs[0], totals: undefined }].concat([{ ts: T(2026, 9, 10), date: '2026-09-10', meal: 'dinner', items: [{ name: '炸鸡', grams: 500, per100: { kcal: 500, protein: 0, fat: 0, carbs: 0 } }] }]),
	'2026-09-10',
	'2026-09-13',
	1800
)
eq(over.overDays, 1, '超标天数统计')
eq(over.goalRate, 50, '达标率 = 1/(1+1)')

group('stats.js · 餐次与食物聚合')
const recs2 = [
	{ id: 'a', ts: T(2026, 9, 13, 8, 0), date: '2026-09-13', meal: 'breakfast', items: [rice] },
	{ id: 'b', ts: T(2026, 9, 13, 12, 0), date: '2026-09-13', meal: 'lunch', items: [rice] },
	{ id: 'c', ts: T(2026, 9, 13, 12, 30), date: '2026-09-13', meal: 'lunch', items: [rice] },
]
const mb = mealBreakdown(recs2)
eq(mb.length, 4, '餐次固定返回 4 组')
eq(mb.find((m) => m.key === 'lunch').count, 2, '午餐 2 条')
eq(mb.find((m) => m.key === 'lunch').totals.kcal, 464, '午餐热量合计')
eq(mb.find((m) => m.key === 'dinner').count, 0, '晚餐无记录')

const tops = topFoods(recs2, 5)
eq(tops[0].name, '米饭', '食物榜第一名')
eq(tops[0].times, 3, '食物出现次数')
eq(tops[0].kcal, 696, '食物热量累计')
eq(tops[0].grams, 600, '食物克数累计')

const recent = recentFoods(recs2, 5)
eq(recent.length, 1, 'recentFoods 按名称去重')
eq(recent[0].times, 3, 'recentFoods 累计次数')
eq(recent.length && recent[0].per100.kcal, 116, 'recentFoods 保留 per100 供复用')

group('stats.js · 图表数据')
const chart = chartData(series)
eq(chart.max, 232, '柱状图最大值')
eq(chart.bars.map((b) => b.ratio), [1, 0, 1], '柱高比例')
eq(chartData([{ date: 'x', totals: { kcal: 0 } }]).bars[0].ratio, 0, '全 0 时比例不除零')

/* ---------------- 汇总 ---------------- */
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
if (fail) {
	console.log('\n失败用例:')
	failures.forEach((f) => console.log('  · ' + f))
}
console.log('='.repeat(46))
process.exit(fail ? 1 : 0)
