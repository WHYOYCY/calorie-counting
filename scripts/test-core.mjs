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
	splitDateTime,
	combineDateTime,
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
	mainItem,
	mainItemIndex,
	otherItems,
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
import {
	RECOGNITION_PROMPT,
	PING_PROMPT,
	extractJson,
	normalizeRecognition,
	chatUrl,
	httpError,
	recognize,
	testConnection,
} from '../src/core/ai.js'

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

/** 可控制的假 uni.request：捕获请求 + 回放预设响应 */
let lastRequest = null
let nextResponse = null

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
	request: (opts) => {
		lastRequest = opts
		const r = nextResponse
		setTimeout(() => {
			if (!r) {
				opts.fail({ errMsg: 'request:fail' })
				return
			}
			if (r.fail) {
				opts.fail(r.fail)
				return
			}
			opts.success({ statusCode: r.statusCode, data: r.data })
		}, 0)
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

eq(
	splitDateTime(T(2026, 9, 13, 8, 30)),
	{ date: '2026-09-13', time: '08:30' },
	'splitDateTime 拆分日期与时间'
)
eq(combineDateTime('2026-09-13', '08:30'), T(2026, 9, 13, 8, 30), 'combineDateTime 与拆分往返一致')
eq(
	dateKey(combineDateTime('2026-09-13', '23:59')),
	'2026-09-13',
	'combineDateTime 处理 23:59 边界（不会跨天）'
)
eq(combineDateTime('2026-09-13', '00:00'), parseKey('2026-09-13').getTime(), 'combineDateTime 00:00 = 当日零点')

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

group('nutrition.js · 主菜识别（列表标题用）')
// 一餐：先录了米饭，但真正的主角是滑蛋炒肉片
const oneMeal = [
	{ name: '米饭', grams: 200, per100: { kcal: 116, protein: 2.6, fat: 0.3, carbs: 25.9 } }, // 232
	{ name: '滑蛋炒肉片', grams: 150, per100: { kcal: 180, protein: 12, fat: 10, carbs: 6 } }, // 270
	{ name: '酸菜', grams: 50, per100: { kcal: 30, protein: 1, fat: 0.2, carbs: 4 } }, // 15
]
eq(mainItemIndex(oneMeal), 1, '主菜下标 = 单项热量最高者')
eq(mainItem(oneMeal).name, '滑蛋炒肉片', '主菜是滑蛋炒肉片，而不是先录入的米饭')
eq(
	otherItems(oneMeal).map((i) => i.name),
	['米饭', '酸菜'],
	'其余条目作为次级信息，顺序保持不变'
)

// 热量相同时取克数大的，保证结果确定
eq(
	mainItem([
		{ name: 'A', grams: 100, per100: { kcal: 100 } },
		{ name: 'B', grams: 200, per100: { kcal: 50 } },
	]).name,
	'B',
	'热量相同时取克数大的'
)
eq(mainItem([]), null, '空列表返回 null')
eq(mainItem(null), null, 'null 输入不报错')
eq(otherItems([{ name: 'only', grams: 100, per100: { kcal: 10 } }]).length, 0, '只有一项时无次级条目')
eq(
	mainItem([{ name: '水', grams: 300, per100: { kcal: 0 } }]).name,
	'水',
	'全为 0 热量时仍能选出主菜'
)

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

/* ================= ai.js ================= */
group('ai.js · JSON 提取容错（缺口 B2）')
eq(extractJson('{"a":1}'), { a: 1 }, '纯 JSON')
eq(extractJson('```json\n{"a":1}\n```'), { a: 1 }, '剥离 markdown 围栏')
eq(extractJson('```\n{"a":1}\n```'), { a: 1 }, '剥离无语言标记的围栏')
eq(extractJson('好的，结果如下：\n{"a":1}\n以上。'), { a: 1 }, '前后有解释文字也能截取')
eq(extractJson('{"a":{"b":[1,2]}}'), { a: { b: [1, 2] } }, '嵌套结构')
eq(extractJson('\uFEFF{"a":1}'), { a: 1 }, '去掉 BOM')
eq(extractJson('这不是 JSON'), null, '无法解析返回 null')
eq(extractJson(''), null, '空字符串返回 null')
eq(extractJson(null), null, 'null 输入不抛异常')

group('ai.js · 识别结果规范化（缺口 B1）')
const notFood = normalizeRecognition({ isFood: false, reason: '这是一张风景照' })
eq(notFood.ok, true, '非食物仍算请求成功')
eq(notFood.isFood, false, 'isFood=false 透传')
eq(notFood.reason, '这是一张风景照', '带出原因给用户')

const good = normalizeRecognition({
	isFood: true,
	items: [
		{
			name: '米饭',
			grams: 200,
			kcalPer100g: 116,
			proteinPer100g: 2.6,
			fatPer100g: 0.3,
			carbsPer100g: 25.9,
			confidence: 0.8,
		},
	],
	note: '光线较暗',
})
eq(good.ok, true, '正常识别')
eq(good.items.length, 1, '条目数')
eq(
	good.items[0].per100,
	{ kcal: 116, protein: 2.6, fat: 0.3, carbs: 25.9 },
	'kcalPer100g 系列字段正确映射到内部 per100 结构'
)
eq(good.items[0].grams, 200, '克数保留')
eq(good.items[0].confidence, 0.8, '置信度保留')
eq(good.note, '光线较暗', 'note 保留')

const alias = normalizeRecognition({
	isFood: true,
	items: [{ name: 'x', grams: 100, kcal: 50, protein: 1 }],
})
eq(alias.items[0].per100.kcal, 50, '兼容 kcal 别名')
eq(alias.items[0].per100.protein, 1, '兼容 protein 别名')

const dirty = normalizeRecognition({
	isFood: true,
	items: [
		{ name: '', grams: 100, kcalPer100g: 100 },
		{ name: '零克数', grams: 0, kcalPer100g: 100 },
		{ name: '有效条目', grams: 100, kcalPer100g: 100 },
	],
})
eq(dirty.items.length, 1, '过滤无名 / 零克数的脏条目')
eq(dirty.items[0].name, '有效条目', '保留合法条目')

eq(normalizeRecognition({ isFood: true, items: [] }).ok, false, '无有效条目标记为失败')
eq(normalizeRecognition(null).ok, false, 'null 输入标记为失败')
eq(normalizeRecognition('字符串').ok, false, '非对象输入标记为失败')

group('ai.js · 请求构造与错误映射')
eq(
	chatUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),
	'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
	'拼接 chat/completions'
)
eq(chatUrl('https://x.com/v1///'), 'https://x.com/v1/chat/completions', '去掉多余的斜杠')
eq(
	chatUrl(''),
	'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
	'空值回退到默认地址'
)
ok(httpError(401).indexOf('API Key') >= 0, '401 → Key 无效提示')
ok(httpError(429).indexOf('频繁') >= 0, '429 → 限流提示')
ok(httpError(404).indexOf('不存在') >= 0, '404 → 地址/模型不存在')
ok(httpError(503).indexOf('服务端') >= 0, '5xx → 服务端错误')
eq(
	httpError(400, { error: { message: 'model not found' } }),
	'model not found',
	'400 优先带出服务端原始详情'
)

ok(RECOGNITION_PROMPT.indexOf('JSON') >= 0, '提示词含 JSON 关键字（json_object 模式的前置要求）')
ok(RECOGNITION_PROMPT.indexOf('isFood') >= 0, '提示词覆盖非食物场景')
ok(RECOGNITION_PROMPT.indexOf('营养成分表') >= 0, '提示词覆盖营养标签 OCR 场景（B6）')
ok(RECOGNITION_PROMPT.indexOf('拆分') >= 0, '提示词要求拆分混合菜品')

/* ================= ai.js 网络契约 ================= */
group('ai.js · 发给 DashScope 的真实请求格式')

const apiSettings = {
	apiKey: 'sk-test-key',
	baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	model: 'qwen3-vl-flash',
}

nextResponse = {
	statusCode: 200,
	data: {
		model: 'qwen3-vl-flash',
		choices: [
			{
				message: {
					content: JSON.stringify({
						isFood: true,
						items: [
							{
								name: '米饭',
								grams: 200,
								kcalPer100g: 116,
								proteinPer100g: 2.6,
								fatPer100g: 0.3,
								carbsPer100g: 25.9,
							},
						],
					}),
				},
			},
		],
	},
}

const wire = await recognize({ base64: 'AAABBBCCC', mime: 'image/jpeg', settings: apiSettings })

eq(wire.ok, true, '识别成功')
eq(wire.isFood, true, 'isFood=true')
eq(wire.items.length, 1, '解析出 1 个条目')
eq(wire.items[0].per100.kcal, 116, '营养素解析正确')

eq(lastRequest.method, 'POST', 'POST 方法')
eq(
	lastRequest.url,
	'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
	'请求地址 = baseUrl + /chat/completions'
)
eq(lastRequest.header.Authorization, 'Bearer sk-test-key', 'Bearer 鉴权头')
eq(
	lastRequest.header['Content-Type'],
	'application/json',
	'JSON 内容类型'
)
eq(lastRequest.data.model, 'qwen3-vl-flash', 'model 透传')
eq(lastRequest.data.temperature, 0, 'temperature 固定 0（贪心解码，结果稳定）')
eq(
	lastRequest.data.response_format,
	{ type: 'json_object' },
	'启用 JSON 输出模式'
)
ok(lastRequest.data.max_tokens > 0, '设置 max_tokens 上限')
ok(lastRequest.timeout >= 30000, '超时 >= 30s（视觉模型响应较慢）')

const content = lastRequest.data.messages[0].content
eq(Array.isArray(content), true, 'content 为数组形式（多模态）')
eq(content.length, 2, '含图片 + 文本两部分')
eq(content[0].type, 'image_url', '第一段是 image_url')
eq(
	content[0].image_url.url,
	'data:image/jpeg;base64,AAABBBCCC',
	'★ 图片为 data URI 格式（DashScope 文档要求的写法）'
)
eq(content[1].type, 'text', '第二段是文本提示词')
eq(content[1].text, RECOGNITION_PROMPT, '提示词完整下发')

// 错误路径
nextResponse = { statusCode: 401, data: { error: { message: 'Invalid API-key' } } }
const unauth = await recognize({ base64: 'x', settings: apiSettings })
eq(unauth.ok, false, '401 识别失败')
ok(unauth.error.indexOf('API Key') >= 0, '401 映射为可操作的中文提示')

nextResponse = { statusCode: 200, data: { choices: [{ message: { content: '抱歉我无法识别' } }] } }
const badJson = await recognize({ base64: 'x', settings: apiSettings })
eq(badJson.ok, false, '模型返回非 JSON → 失败而不是崩溃')
ok(badJson.error.indexOf('JSON') >= 0, '提示无法解析为 JSON')

nextResponse = { fail: { errMsg: 'request:fail timeout' } }
const timeoutRes = await recognize({ base64: 'x', settings: apiSettings })
eq(timeoutRes.ok, false, '超时失败')
ok(timeoutRes.error.indexOf('超时') >= 0, '超时映射为中文提示')

group('ai.js · 测连通（缺口 C2）')
nextResponse = {
	statusCode: 200,
	data: { model: 'qwen3-vl-flash', choices: [{ message: { content: '{"ok":true}' } }] },
}
const ping = await testConnection(apiSettings)
eq(ping.ok, true, '测连通成功')
eq(ping.model, 'qwen3-vl-flash', '回显实际模型名')
eq(lastRequest.data.messages[0].content, PING_PROMPT, '测连通只发纯文本，不消耗图片额度')

eq(lastRequest.timeout, 20000, '测连通用更短的超时')

const noKey = await testConnection({ apiKey: '', model: 'qwen3-vl-flash' })
eq(noKey.ok, false, '空 Key 直接拒绝，不发请求')

/* ========== 回归：手选餐次必须落盘 ========== */
group('db.js · 手选餐次落盘（回归：改完餐次下次打开被打回）')

freshStorage()
initDB()

// 20:00 按时间应归为晚餐，用户手动改成午餐
const pinned = saveRecord({
	ts: T(2026, 9, 13, 20, 0),
	meal: 'lunch',
	mealAuto: false,
	items: [rice],
})
eq(pinned.meal, 'lunch', '保存返回值是手选值')
eq(pinned.mealAuto, false, '★ mealAuto 落盘了（原先漏写，本次 bug 的根因）')

// 模拟冷启动：丢缓存，从存储重读
_resetCache()
initDB()
const reloaded = getRecord(pinned.id)
eq(reloaded.meal, 'lunch', '★ 冷启动后仍是手选的午餐')
eq(reloaded.mealAuto, false, '冷启动后标记仍是手动')

// 自动归类的记录不受影响：改时间要跟着变
const autoRec = saveRecord({ ts: T(2026, 9, 13, 8, 30), items: [rice] })
eq(autoRec.mealAuto, true, '未指定餐次时 mealAuto 为 true')
eq(autoRec.meal, 'breakfast', '按时间归为早餐')
eq(
	normalizeRecord({ ...autoRec, ts: T(2026, 9, 13, 19, 0) }).meal,
	'dinner',
	'自动归类的记录改了时间会重新归类'
)

// 手选的记录改了时间不重新归类
const movedManual = normalizeRecord({ ...pinned, ts: T(2026, 9, 14, 8, 0) })
eq(movedManual.meal, 'lunch', '手选的记录改了时间仍保持午餐')
eq(movedManual.date, '2026-09-14', '但日期仍跟着 ts 走')

group('db.js · 老数据没有 mealAuto 字段时的推断')

const legacyManual = normalizeRecord({
	ts: T(2026, 9, 13, 20, 0),
	meal: 'lunch',
	items: [rice],
})
eq(legacyManual.meal, 'lunch', '与自动值不一致 → 推断当初是手选，不被冲掉')
eq(legacyManual.mealAuto, false, '补上 mealAuto:false')

const legacyAuto = normalizeRecord({
	ts: T(2026, 9, 13, 8, 30),
	meal: 'breakfast',
	items: [rice],
})
eq(legacyAuto.mealAuto, true, '与自动值一致 → 视为自动归类')
eq(legacyAuto.meal, 'breakfast', '餐次保持早餐')

const badMeal = normalizeRecord({ ts: T(2026, 9, 13, 8, 30), meal: 'brunch', items: [rice] })
eq(badMeal.meal, 'breakfast', '非法餐次键回落到按时间推导')
eq(badMeal.mealAuto, true, '非法餐次键不算手选')

group('db.js · 重读不刷新时间戳')

const stamped = normalizeRecord(
	{ ts: T(2026, 9, 13, 8, 30), items: [rice], createdAt: 1000, updatedAt: 2000 },
	{ keepStamps: true }
)
eq(stamped.createdAt, 1000, 'keepStamps 保留 createdAt')
eq(stamped.updatedAt, 2000, 'keepStamps 保留 updatedAt')

const stampBefore = getRecord(pinned.id).updatedAt
_resetCache()
initDB()
eq(getRecord(pinned.id).updatedAt, stampBefore, '冷启动重读不改 updatedAt')
eq(getRecord(pinned.id).createdAt, pinned.createdAt, '冷启动重读不改 createdAt')

/* ---------------- 汇总 ---------------- */
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
if (fail) {
	console.log('\n失败用例:')
	failures.forEach((f) => console.log('  · ' + f))
}
console.log('='.repeat(46))
process.exit(fail ? 1 : 0)
