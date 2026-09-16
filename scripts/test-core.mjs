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
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { base64ToBytes, bytesToBase64 } from '../src/core/base64.js'
import {
	saveSnapshot,
	listSnapshots,
	readSnapshot,
	latestSnapshot,
	clearSnapshots,
	SNAPSHOT_KEEP,
} from '../src/core/backup.js'
import { photoPathFor, photoSrc, deletePhotoFile, splitDataUrl, toBase64 } from '../src/core/photo.js'
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

/* ========== 回归：拍完照编辑页不显示 ========== */
group('photo.js · 照片路径决策（回归：拍完照编辑页不显示照片）')

eq(
	photoPathFor({ ok: true, path: '_doc/food/a.jpg' }, 'blob:tmp'),
	'_doc/food/a.jpg',
	'落盘成功 → 用持久路径'
)
eq(
	photoPathFor({ ok: false }, 'blob:tmp'),
	'blob:tmp',
	'★ 落盘失败 → 退回临时路径（原先返回空字符串，编辑页只能显示空状态）'
)
eq(photoPathFor(null, 'blob:tmp'), 'blob:tmp', '落盘抛异常也退回临时路径')
eq(
	photoPathFor({ ok: true, path: '' }, 'blob:tmp'),
	'blob:tmp',
	'落盘返回空路径时退回'
)
eq(photoPathFor({ ok: false }, ''), '', '两者都没有则为空')
eq(photoPathFor(undefined, undefined), '', '全空不报错')

group('photo.js · photoSrc 渲染路径')

eq(photoSrc(''), '', '空路径返回空')
eq(photoSrc('blob:http://x/abc'), 'blob:http://x/abc', 'blob: 原样返回')
eq(photoSrc('data:image/jpeg;base64,AAA'), 'data:image/jpeg;base64,AAA', 'data: 原样返回')
eq(photoSrc('https://x/a.jpg'), 'https://x/a.jpg', '网络路径原样返回')
eq(photoSrc('file:///a.jpg'), 'file:///a.jpg', 'file:// 原样返回')
// Node 里没有 plus，应原样返回而不是抛异常
eq(photoSrc('_doc/food/a.jpg'), '_doc/food/a.jpg', '无 plus 环境原样返回')
eq(photoSrc(null), '', 'null 返回空')

group('photo.js · 删除照片对各种路径形式都不抛异常')
deletePhotoFile('')
deletePhotoFile('_doc/food/a.jpg')
deletePhotoFile('/storage/emulated/0/x.jpg')
deletePhotoFile('file:///x.jpg')
deletePhotoFile('blob:xxx')
deletePhotoFile(null)
ok(true, '六种路径形式调用均未抛异常')

eq(splitDataUrl('data:image/png;base64,QUJD').mime, 'image/png', 'data URL 解析出 mime')
eq(splitDataUrl('data:image/png;base64,QUJD').base64, 'QUJD', 'data URL 解析出 base64')
eq(splitDataUrl('garbage').base64, '', '非法 data URL 返回空')

/* ========== 本地快照：不可逆操作的后悔药 ========== */
group('backup.js · 本地快照')

freshStorage()
const DAY = 24 * 3600 * 1000
const D0 = T(2026, 9, 10, 12, 0)
const payloadOf = (n) => ({
	app: 'calorie-counting',
	schemaVersion: 1,
	exportedAt: D0,
	settings: {},
	records: Array.from({ length: n }, (_, i) => ({ id: 'r' + i })),
})

eq(listSnapshots().length, 0, '初始没有快照')

const s1 = saveSnapshot(payloadOf(2), { now: D0 })
eq(s1.ok, true, '存快照成功')
eq(listSnapshots().length, 1, '清单里有 1 份')
eq(readSnapshot(s1.ts).records.length, 2, '能把内容读回来')

eq(typeof latestSnapshot().ts, 'number', 'latestSnapshot 带索引信息（ts）')
eq(latestSnapshot().records, 2, '索引里带记录条数，界面直接用不用读快照')
eq(latestSnapshot().payload.records.length, 2, 'latestSnapshot 带 payload')

// 同一天不重复存（避免每次启动都写一遍）
const s2 = saveSnapshot(payloadOf(2), { now: D0 + 3600 * 1000 })
eq(s2.skipped, true, '同一天不重复存')
eq(listSnapshots().length, 1, '仍然只有 1 份')

// 不可逆操作要 force，即使当天已存也要再存一份
const s3 = saveSnapshot(payloadOf(3), { now: D0 + 2 * 3600 * 1000, force: true })
eq(!!s3.skipped, false, 'force 忽略当天去重')
eq(listSnapshots().length, 1, '同一天的旧快照被替换，仍只 1 份')
eq(latestSnapshot().payload.records.length, 3, '拿到的是最新那份')
eq(s3.ts === s1.ts, false, '两次快照的时间戳不撞车')

// 跨天累计 + 滚动删除
saveSnapshot(payloadOf(4), { now: D0 + DAY })
saveSnapshot(payloadOf(5), { now: D0 + 2 * DAY })
eq(listSnapshots().length, 3, `跨天累计到 ${SNAPSHOT_KEEP} 份`)
const oldestTs = listSnapshots()[2].ts
saveSnapshot(payloadOf(6), { now: D0 + 3 * DAY })
eq(listSnapshots().length, SNAPSHOT_KEEP, '超过保留数后不再增长')
eq(readSnapshot(oldestTs), null, '被轮换掉的旧快照已从存储里删除')
eq(latestSnapshot().payload.records.length, 6, '最新一份是刚存的')
eq(
	listSnapshots().map((s) => s.ts).every((v, i, a) => i === 0 || a[i - 1] > v),
	true,
	'清单按时间倒序'
)

// 体积上限：太大就不存，宁可没有快照也不能把存储写满
const tooBig = saveSnapshot({ records: [{ big: 'x'.repeat(1024 * 1024 + 10) }] })
eq(tooBig.ok, false, '超过体积上限拒绝存')

eq(
	(typeof tooBig.error === 'string' ? tooBig.error : '').indexOf('太大') >= 0,
	true,
	'给出「太大」而不是静默失败'
)

clearSnapshots()
eq(listSnapshots().length, 0, 'clearSnapshots 清空清单')
eq(latestSnapshot(), null, '清空后 latestSnapshot 为 null')

group('db.js · 清空/覆盖前自动留档')

freshStorage()
initDB()
clearSnapshots()
saveRecord({ ts: T(2026, 9, 13, 8, 30), items: [rice] })
saveRecord({ ts: T(2026, 9, 13, 12, 30), items: [rice] })
const beforeClear = allRecords().length
eq(beforeClear, 2, '先有 2 条记录')

clearAll()
eq(allRecords().length, 0, '清空后没有记录')
const snap = latestSnapshot()
ok(!!snap, '★ 清空前自动存了一份快照')
eq(snap.payload.records.length, 2, '快照里正是被清掉的那 2 条')

// 用快照恢复
const restored = importAll(snap.payload, 'replace')
eq(restored.ok, true, '从快照恢复成功')
eq(allRecords().length, 2, '★ 记录回来了')

/* ========== Native.js 落盘：用假 plus 复现真机报错 ========== */

/**
 * 造一个假 Native.js 环境。
 *
 * 关键在于：从 Java 返回的实例（resolver / os）在 JS 侧**没有方法** ——
 * 这正是真机上 `resolver.insert is not a function` 的成因。
 * 只有 plus.android.invoke 能真正调到实现；直接点调用会招。
 */
function fakePlus(opts = {}) {
	const files = new Map()
	const calls = []
	const resolver = { _kind: 'resolver' }
	// 旧 mock 的 invoke 不把接收者传给实现，cursor.getLong 只能靠这个闭包变量
	let lastCursorSize = 0

	const impl = {
		activity: {
			getContentResolver: () => resolver,
		},
		resolver: {
			insert: (uri, values) => {
				if (opts.insertNull) return null
				const u = 'content://downloads/' + (files.size + 1)
				files.set(u, { values, text: '' })
				return { _kind: 'uri', url: u }
			},
			openOutputStream: (uri) => {
				if (opts.openNull) return null
				return { _kind: 'os', uri: uri && uri.url }
			},
			query: (uri) => {
				// 旧 mock 不传接收者给实现，所以把刚查到的大小存到闭包里，
				// 由 cursor.getLong 取用
				const d = uri && files.get(uri.url)
				lastCursorSize = d ? String(d.text || '').length : 0
				return { _kind: 'cursor' }
			},
			delete: (uri) => {
				files.delete(uri && uri.url)
				return 1
			},
		},
		os: {
			write: (x) => {
				if (opts.writeThrows) throw new Error('write 失败')
				const last = [...files.values()].pop()
				if (last) last.text += typeof x === 'string' ? x : String(x)
			},
			flush: () => {},
			close: () => {},
		},
		cursor: {
			moveToFirst: () => true,
			getColumnIndex: () => 0,
			getLong: () => lastCursorSize,
			close: () => {},
		},
		writer: {
			write: (x) => {
				if (opts.writerThrows) throw new Error('OutputStreamWriter 不可用')
				// maxChunkBytes 模拟长度限制：超长静默丢弃
				if (opts.maxChunkBytes && String(x).length > opts.maxChunkBytes) return
				const last = [...files.values()].pop()
				if (last) last.text += String(x)
			},
			flush: () => {},
			close: () => {},
		},
		jstring: {
			getBytes: () => (opts.getBytesNull ? null : '<bytes>'),
		},
	}

	// missingMethod = 模拟「invoke 也调不到」的情形，也就是用户遇到的
	// resolver.insert is not a function
	if (opts.missingMethod) delete impl.resolver[opts.missingMethod]

	const classes = {
		'android.os.Build': { VERSION: { SDK_INT: opts.sdk === undefined ? 36 : opts.sdk } },
		'android.provider.MediaStore$MediaColumns': { SIZE: '_size' },
		'android.provider.MediaStore$Downloads': {
			DISPLAY_NAME: '_display_name',
			MIME_TYPE: 'mime_type',
			RELATIVE_PATH: 'relative_path',
			EXTERNAL_CONTENT_URI: { _kind: 'uri', url: 'content://downloads' },
		},
		'android.content.ContentValues': function ContentValues() {
			this.vals = {}
			this.put = (k, v) => {
				this.vals[k] = v
			}
		},
		'java.io.OutputStreamWriter': function OutputStreamWriter(os, enc) {
			if (opts.writerThrows) throw new Error('OutputStreamWriter 不可用')
			return {
				_kind: 'writer',
				os,
				enc,
				write: (text) => impl.writer.write(text),
				flush: () => {},
				close: () => {},
			}
		},
		'__unused_OutputStreamWriter': function OutputStreamWriter() {
			return { _kind: 'writer' }
		},
		'java.lang.String': function JString() {
			return { _kind: 'jstring' }
		},
	}

	// opts.noInvoke = 模拟没有 plus.android.invoke 的旧环境
	const android = {
		runtimeMainActivity: () => ({ _kind: 'activity' }),
		importClass: (name) => {
			calls.push('importClass:' + name)
			if (opts.importNullFor && opts.importNullFor === name) return null
			return classes[name] || {}
		},
		getAttribute: (cls, name) => (cls ? cls[name] : null),
	}
	// 注意：必须用普通函数 / rest 参数，不能用箭头函数 ——
	// 箭头函数里的 arguments 指向外层作用域，会把参数全丢掉
	if (!opts.noInvoke) {
		android.invoke = function (obj, name) {
			const args = Array.prototype.slice.call(arguments, 2)
			// JS 侧自己 new 出来的对象直接调；Java 返回的实例没方法，得走实现表
			if (obj && typeof obj[name] === 'function') return obj[name].apply(obj, args)
			const t = obj && obj._kind
			const fn = impl[t] && impl[t][name]
			if (!fn) throw new Error(`${t}.${name} is not a function`)
			return fn.apply(null, args)
		}
	}
	return { plus: { android }, files, calls, resolver }
}

const withPlus = (opts, fn) => {
	const env = fakePlus(opts)
	globalThis.plus = env.plus
	return Promise.resolve(fn(env)).finally(() => {
		delete globalThis.plus
	})
}

const { saveToDownloads, probe, isAndroid } = await import('../src/core/native-fs.js')


group('native-fs.js · 能力探测')

await withPlus({ sdk: 36 }, async () => {
	const p = probe()
	eq(p.isAndroid, true, '识别为 Android')
	eq(p.sdk, 36, '读到 SDK 级别')
	eq(p.canSaveToDownloads, true, 'API 36 判断为可用')
	eq(p.canShare, false, 'Node 里没有 uni.shareWithSystem → 分享不可用')
})

await withPlus({ sdk: 28 }, async () => {
	eq(probe().canSaveToDownloads, false, 'API 28 判断为不可用')
})

eq(isAndroid(), false, '没有 plus 时 isAndroid 为 false')

eq((await saveToDownloads('x', 'y.json')).unsupported, true, '没有 plus 时直接标不支持')

const bytesOfText = (s) => new Uint8Array(Buffer.from(s, 'utf8'))

// 包含全部 256 种字节值，能真正验出二进制是否被篡改
const BINARY = new Uint8Array(1024)
for (let i = 0; i < BINARY.length; i++) BINARY[i] = i & 0xff

/** 造一条记录（照片字段由参数给） */
function recWith(id, photo, items) {
	return {
		id,
		ts: T(2026, 9, 16, 8, 0) + Number(String(id).replace(/\D/g, '') || 0) * 60000,
		date: '2026-09-16',
		meal: 'breakfast',
		mealAuto: true,
		items: items || [{ name: '米饭', grams: 200, per100: { kcal: 116, protein: 2.6, fat: 0.3, carbs: 25.9 } }],
		photo: photo || '',
		note: '',
		source: 'manual',
		createdAt: T(2026, 9, 16, 8, 0),
		updatedAt: T(2026, 9, 16, 8, 0),
	}
}

/** exportAll() 形状的 payload */
function fullPayloadOf(records) {
	return {
		records,
		settings: { dailyGoal: 1800, apiKey: 'sk-test' },
		exportedAt: T(2026, 9, 16, 18, 0),
	}
}

/**
 * 假的「磁盘上的照片」：路径 → base64 内容。
 * 真机上 readPhotoBase64 对 .b64 文本文件读到的是文本本身，
 * 对老的 .jpg 文件读到的是那个 JPEG 的 base64 —— 两者都是「文件在就有的读」。
 */
const PHOTOS = {
	'_doc/food/food_1.jpg': 'AAAA',
	'/storage/emulated/0/Android/data/x/doc/food/food_2.jpg': 'BBBB',
}

/** 读一张照片（文件不在就返回 null，跟真机一致） */
function photoReaderOf(map) {
	return async (path) => map[path] || null
}

const FB = await import('../src/core/fullbackup.js')

group('fullbackup.js · 照片命名与去重')

eq(FB.basename('_doc/food/a.jpg'), 'a.jpg', '本地 URL 取文件名')
eq(FB.basename('/storage/emulated/0/x/food/b.jpg'), 'b.jpg', '原生绝对路径取文件名')
eq(FB.basename('c.jpg'), 'c.jpg', '无目录时原样返回')
eq(FB.basename(''), '', '空值不报错')

eq(FB.photoNameOf('_doc/food/food_1.jpg'), 'food_1.b64', '★ .jpg 统一成 .b64（磁盘上照片是 base64 文本）')
eq(FB.photoNameOf('_doc/food/food_1.b64'), 'food_1.b64', '已经是 .b64 就不动')
eq(FB.photoNameOf('data:image/jpeg;base64,AAAA', 3), 'photo_3.b64', 'data URL 没有文件名，用序号')
eq(FB.photoNameOf(''), '', '空路径 → 空名字')

eq(
	FB.photoNamesOf([
		recWith('r1', '_doc/food/x.jpg'),
		recWith('r2', '_doc/food/x.b64'),
		recWith('r3', ''),
	]).length,
	1,
	'同一张照片（只是扩展名写法不同）只算一次'
)

group('fullbackup.js · 打包：照片进 JSON，缺的不假装')

const payload1 = fullPayloadOf([
	recWith('r1', '_doc/food/food_1.jpg'),
	recWith('r2', '/storage/emulated/0/Android/data/x/doc/food/food_2.jpg'),
	recWith('r3', ''),
])
const packed1 = await FB.packPayload(payload1, photoReaderOf(PHOTOS))

eq(packed1.stats.records, 3, '记录数对')
eq(packed1.stats.photos, 2, '★ 两张照片都被读出来塞进 payload')
eq(packed1.stats.missing.length, 0, '没有缺失')
eq(packed1.payload.format, 'cc-full-backup', '带格式标记（以后好认）')
eq(packed1.payload.photos.length, 2, 'payload 里有照片数组')
eq(packed1.payload.photos[0].name, 'food_1.b64', '照片名字规范化')
eq(packed1.payload.photos[0].base64, 'AAAA', '★ 照片内容是 base64 文本')
eq(
	packed1.payload.records.map((r) => r.photo).join('|'),
	'food_1.b64|food_2.b64|',
	'★ 记录里的 photo 变成照片名字（不带路径，这样才可移植）'
)
eq(packed1.payload.records[1].items[0].name, '米饭', '记录内容原封不动')
eq(packed1.payload.settings.dailyGoal, 1800, '设置一起带走')

// 照片文件已经丢了的情况
const packed2 = await FB.packPayload(
	fullPayloadOf([recWith('r1', '_doc/food/food_1.jpg'), recWith('r2', '_doc/food/food_gone.jpg')]),
	photoReaderOf(PHOTOS)
)
eq(packed2.stats.photos, 1, '只带上存在的那张')
eq(packed2.stats.missing.join(','), 'food_gone.b64', '★ 缺失的照片被记下来')
eq(packed2.stats.dropped, 1, '缺失数量单独统计（界面上要如实说）')
eq(
	packed2.payload.records.map((r) => r.photo).join('|'),
	'food_1.b64|',
	'★ 照片没了就把路径清空，不留永远显示不出来的死链'
)

// 读取函数抛异常也不能把整个导出带崩
const packed3 = await FB.packPayload(
	fullPayloadOf([recWith('r1', '_doc/food/food_1.jpg')]),
	async () => {
		throw new Error('读照片炸了')
	}
)
eq(packed3.stats.photos, 0, '读照片抛异常 → 当缺失处理')
eq(packed3.stats.missing.length, 1, '记下这张缺失')
eq(packed3.payload.records.length, 1, '★ 记录本身照样导出（照片读不到不该让备份整体失败）')

group('fullbackup.js · 解包：名字还原成路径，死链清空')

const unpack1 = FB.unpackPayload(packed1.payload, (n) => `_doc/food/${n}`)
eq(unpack1.ok, true, '解包成功')
eq(unpack1.records.length, 3, '记录数对')
eq(
	unpack1.records.map((r) => r.photo).join('|'),
	'_doc/food/food_1.b64|_doc/food/food_2.b64|',
	'★ 照片名字映射回目标平台的路径'
)
eq(unpack1.photos.length, 2, '带出 2 张照片本体')
eq(unpack1.photos[0].base64, 'AAAA', '★ 照片 base64 原样带出')
eq(unpack1.missing.length, 0, '没有缺失')

// 备份里没有照片 → 必须清空，不能留死链
const noPhoto = FB.unpackPayload(
	{ ...packed1.payload, photos: [] },
	(n) => `_doc/food/${n}`
)
eq(
	noPhoto.records.map((r) => r.photo).join('|'),
	'||',
	'★ 备份里没带照片时清空路径（否则换机后一堆点不开的死链）'
)
eq(noPhoto.photos.length, 0, '没有照片要写')
eq(noPhoto.records[0].items[0].name, '米饭', '记录本身仍然完好')

// 兼容旧版 zip 备份里的 "photos/xxx.jpg" 写法
const legacy = FB.unpackPayload(
	{
		records: [{ ...recWith('r1', ''), photo: 'photos/food_1.jpg' }],
		photos: [{ name: 'food_1.b64', base64: 'AAAA' }],
	},
	(n) => `_doc/food/${n}`
)
eq(
	legacy.records[0].photo,
	'_doc/food/food_1.b64',
	'★ 旧备份里的 photos/xxx.jpg 也能正确映射（老备份不至于白导）'
)

eq(FB.unpackPayload(null, (n) => n).ok, false, '不是备份 → 报错')
eq(FB.unpackPayload({ records: 'nope' }, (n) => n).ok, false, 'records 不是数组 → 报错')

group('fullbackup.js · 文本解析与摘要与大小')

const text1 = JSON.stringify(packed1.payload)
const parsed1 = FB.parseFullBackupText(text1)
eq(parsed1.ok, true, '文本能解析')
eq(parsed1.payload.records.length, 3, '解析出记录')

eq(FB.parseFullBackupText('nope').ok, false, '不是 JSON → 报错')
ok(
	String(FB.parseFullBackupText('nope').error).indexOf('JSON') >= 0,
	'错误信息说清是 JSON 的问题'
)
eq(FB.parseFullBackupText('{"a":1}').ok, false, '缺少 records → 报错')
eq(FB.parseFullBackupText('[]').ok, false, '顶层是数组 → 报错')

const fbSum = FB.summarizePayload(packed1.payload)
eq(fbSum.records, 3, '摘要里的记录数')
eq(fbSum.photos, 2, '摘要里的照片数')
eq(fbSum.withPhoto, 2, '★ 摘要里的「带照片的记录数」')

ok(FB.sizeOfPayload(packed1.payload) >= text1.length - 40, '大小估算接近真实文本长度（用来卡上限，不能低估太多）')

/* ========== 完整备份的编排（导出/恢复） ========== */

const FBIO = await import('../src/core/fullbackup-io.js')
const BK = await import('../src/core/backup.js')

group('fullbackup-io.js · 导出整体流程')

freshStorage()
initDB()
// Node 里没有 plus，照片文件读不到 —— 正好验「缺失」这条路
saveRecord({ ts: T(2026, 9, 16, 8, 0), items: [rice], photo: '_doc/food/food_a.jpg' })
saveRecord({ ts: T(2026, 9, 16, 12, 0), items: [rice] })

eq(allRecords().length, 2, '先有 2 条记录')

const built = await FBIO.buildFullBackupJson()
eq(built.ok, true, '能打出完整备份')
ok(built.text.length > 100, `产出 ${built.text.length} 字节的文本`)
ok(String(built.text).indexOf('"format":"cc-full-backup"') > 0, '★ 产出的是可读的 JSON 文本')
eq(built.stats.photos, 0, 'Node 下照片读不到，所以 0 张')
eq(built.stats.missing.join(','), 'food_a.b64', '★ 记录在案的缺失照片')
eq(FB.parseFullBackupText(built.text).ok, true, '产出的文本能被自己的解析器读回来')

const limited = await FBIO.buildFullBackupJson({ limit: 50 })
eq(limited.ok, false, '★ 超过体积上限时明确拒绝')
ok(String(limited.error).indexOf('删') >= 0, `告诉用户怎么办：${limited.error}`)

eq(FBIO.humanSize(512), '512 B', '体积格式化：字节')
eq(FBIO.humanSize(2048), '2.0 KB', '体积格式化：KB')
eq(FBIO.humanSize(5 * 1024 * 1024), '5.0 MB', '体积格式化：MB')
ok(FBIO.fullBackupFileName().indexOf('full.json') > 0, `文件名带 full 后缀：${FBIO.fullBackupFileName()}`)

group('fullbackup-io.js · 恢复整体流程（App：照片写回 .b64）')

const srcPayload = fullPayloadOf([
	recWith('r1', '_doc/food/food_1.jpg'),
	recWith('r2', '/storage/emulated/0/Android/data/x/doc/food/food_2.jpg'),
	recWith('r3', ''),
])
const packedSrc = (await FB.packPayload(srcPayload, photoReaderOf(PHOTOS))).payload
eq(packedSrc.photos.length, 2, '备份里有 2 张照片')

const backupText = JSON.stringify(packedSrc)

// 用一个假 plus.io 让 writePhotoBase64 真的走一遍写入
const envFB = fakePlusIO()
globalThis.plus = envFB.plus
const rest = await FBIO.applyRestoredBackup(JSON.parse(backupText))
delete globalThis.plus

eq(rest.ok, true, '恢复成功')
eq(rest.records, 3, '恢复出 3 条记录')
eq(rest.photos, 2, '写回 2 张照片')
eq(rest.failed.length, 0, '没有写失败')
eq(
	envFB.files.get('/abs/_doc/food/food_1.b64'),
	'AAAA',
	'★ 照片真的被写成了 .b64 文本文件'
)
eq(envFB.files.get('/abs/_doc/food/food_2.b64'), 'BBBB', '第二张也对')
eq(allRecords().length, 3, '记录数对（覆盖导入）')
eq(
	allRecords()
		.map((r) => r.photo)
		.sort()
		.join('|'),
	'|_doc/food/food_1.b64|_doc/food/food_2.b64',
	'★ 记录里的照片路径指向写回的位置（排序后空串在最前）'
)
eq(rest.summary.records, 3, '返回摘要里的记录数')
eq(rest.summary.photos, 2, '返回摘要里的照片数')

group('fullbackup-io.js · 照片写不进去时要清掉死链')

freshStorage()
initDB()
// 让写入必定失败：文件系统请求直接报错
const envBad = fakePlusIO({ fsFails: true })
globalThis.plus = envBad.plus
const rest2 = await FBIO.applyRestoredBackup(JSON.parse(backupText))
delete globalThis.plus

eq(rest2.ok, true, '照片写不进去，但记录仍然恢复')
eq(rest2.photos, 0, '写回 0 张')
eq(rest2.failed.length, 2, '两张都失败')
eq(allRecords().length, 3, '记录数对')
eq(
	allRecords().filter((r) => r.photo).length,
	0,
	'★ 写不进去的照片把路径清空了（否则换机后全是显示不出来的死链）'
)
eq(allRecords().filter((r) => r.items.length).length, 3, '★ 记录本身完好无损')

eq((await FBIO.applyRestoredBackup({ nope: 1 })).ok, false, '坏备份 → 恢复失败')


/* ========== Native.js 写二进制：不用 Blob ========== */

/**
 * 假 Java 文件系统。
 * 关键：getBytes('ISO-8859-1') 要**忠实模拟 Java 的编码**
 * （每个码点 → 一个字节），否则测不出 latin1 过桥到底对不对。
 */
function fakeJavaFs(opts = {}) {
	const files = new Map()
	const dirs = new Set()
	const calls = []

	const impl = {
		raf: {
			// RandomAccessFile.writeBytes(String)：每字符低 8 位写成一个字节
			writeBytes: (o, text) => {
				// maxChunkBytes 模拟「超过这个长度的块被静默丢弃」
				if (opts.maxChunkBytes && text.length > opts.maxChunkBytes) return
				const list = files.get(o.path) || []
				for (let i = 0; i < text.length; i++) list.push(text.charCodeAt(i) & 0xff)
				files.set(o.path, list)
			},
			// 'rw' 模式不清空文件，要显式截断
			setLength: (o, n) => {
				const list = files.get(o.path) || []
				files.set(o.path, list.slice(0, Number(n) || 0))
			},
			close: () => {},
		},
		jstring: {
			getBytes: (o) => {
				if (opts.getBytesNull) return null
				const s = o.s
				const out = new Uint8Array(s.length)
				for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
				return out
			},
		},
		fos: {
			write: (o, bytes) => {
				if (opts.writeThrows) throw new Error('write 失败')
				const list = files.get(o.path) || []
				for (let i = 0; i < bytes.length; i++) list.push(bytes[i])
				files.set(o.path, list)
			},
			flush: () => {},
			close: () => {},
		},
		writer: {
			// 按 ISO-8859-1 写：每个码点恰好一个字节
			write: (o, text) => {
				// maxChunkBytes 模拟「Native.js 传参长度限制」：超长静默丢弃
				if (opts.maxChunkBytes && text.length > opts.maxChunkBytes) return
				const list = files.get(o.os.path) || []
				for (let i = 0; i < text.length; i++) list.push(text.charCodeAt(i) & 0xff)
				files.set(o.os.path, list)
			},
			flush: () => {},
			close: () => {},
		},
		file: {
			exists: (o) => files.has(o.path) || dirs.has(o.path),
			mkdirs: (o) => {
				dirs.add(o.path)
				return true
			},
			length: (o) => (files.get(o.path) ? files.get(o.path).length : 0),
		},
		fis: {
			readAllBytes: (o) => {
				if (opts.readThrows) throw new Error('readAllBytes 失败')
				const list = files.get(o.path)
				if (!list) throw new Error('文件不存在')
				return Uint8Array.from(list)
			},
			close: () => {},
		},
	}

	const classes = {
		'java.lang.String': function JString(s) {
			return { _kind: 'jstring', s: String(s) }
		},
		'java.io.FileOutputStream': function FileOutputStream(p) {
			if (opts.openThrows) throw new Error('open 失败')
			if (!files.has(p)) files.set(p, [])
			return { _kind: 'fos', path: p }
		},
		'java.io.File': function File(p) {
			return { _kind: 'file', path: p }
		},
		'java.io.RandomAccessFile': function RandomAccessFile(p) {
			if (opts.rafThrows) throw new Error('RandomAccessFile 不可用')
			if (!files.has(p)) files.set(p, [])
			return { _kind: 'raf', path: p }
		},
		'java.nio.charset.StandardCharsets': { ISO_8859_1: { _kind: 'charset' } },
		'java.nio.file.Files': {
			readString: (p) => {
				if (opts.readStringThrows) throw new Error('Files.readString 不可用')
				const list = files.get(p && p.path)
				if (!list) throw new Error('文件不存在')
				let out = ''
				for (let i = 0; i < list.length; i++) out += String.fromCharCode(list[i])
				return out
			},
		},
		'java.io.OutputStreamWriter': function OutputStreamWriter(os, enc) {
			if (opts.writerThrows) throw new Error('OutputStreamWriter 不可用')
			return { _kind: 'writer', os, enc }
		},
		'java.io.FileInputStream': function FileInputStream(p) {
			if (opts.readOpenThrows) throw new Error('打开文件失败')
			if (!files.has(p) && opts.missingFileThrows) throw new Error('文件不存在')
			return { _kind: 'fis', path: p }
		},
	}

	const Bas64 = {
		NO_WRAP: 2,
		encodeToString: (bytes) => {
			// 真的按 base64 编码，这样往返测试才有意义
			return Buffer.from(Uint8Array.from(bytes)).toString('base64')
		},
	}

	const android = {
		importClass: (name) => {
			calls.push(name)
			if (opts.importNullFor === name) return null
			if (name === 'android.util.Base64') return Bas64
			return classes[name] || {}
		},
		invoke: function (obj, name) {
			const args = Array.prototype.slice.call(arguments, 2)
			if (obj && typeof obj[name] === 'function') return obj[name].apply(obj, args)
			const fn = impl[obj && obj._kind] && impl[obj && obj._kind][name]
			if (!fn) throw new Error(`${obj && obj._kind}.${name} is not a function`)
			return fn.apply(null, [obj].concat(args))
		},
		getAttribute: (cls, name) => (cls ? cls[name] : null),
		runtimeMainActivity: () => ({}),
	}

	const plusLike = {
		android,
		io: {
			convertLocalFileSystemURL: (u) => 'ABS:/' + String(u).replace(/\/$/, ''),
		},
	}
	return { plus: plusLike, files, dirs, calls }
}

const withJavaFs = async (opts, fn) => {
	const env = fakeJavaFs(opts)
	globalThis.plus = env.plus
	try {
		return await fn(env)
	} finally {
		delete globalThis.plus
	}
}

const NFS = await import('../src/core/native-fs.js')

group('photo.js · 读取失败时要能看出是哪一环')

// Node 里既没有 File 对象、也没有 plus、也没有 FileSystemManager
const b64fail = await toBase64('_doc/food/x.jpg', null)
eq(b64fail.ok, false, '读不到就是失败')
ok(Array.isArray(b64fail.tried), '★ 带上了每一步的结果')
eq(b64fail.tried.length, 4, '★ 四条读取路径都报了')
ok(
	String(b64fail.tried.join(' ')).indexOf('没有 File') >= 0,
	`★ 说清楚是「没有 File」而不是笼统的读取失败：${JSON.stringify(b64fail.tried)}`
)
ok(
	String(b64fail.tried.join(' ')).indexOf('plus.io') >= 0,
	'列举了 plus.io 这一环'
)

/* ========== 写进公共下载 / 从 SAF 读回（不经手中转文件） ========== */

/**
 * 假 MediaStore。
 *
 * 关键：模拟真机的真实行为 —— 写进去多少字节就是多少，不做任何“好心”的转换，
 * 这样才能验出「写进去的是不是原样」以及「空文件能不能被发现」。
 */
function fakeMediaStore(opts = {}) {
	// MediaStore 文档：url -> { name, bytes }
	const docs = new Map()
	// 普通文件：path -> { bytes }
	const files = new Map()
	const dirs = new Set()
	let seq = 0

	/** 取某个句柄对应的字节容器（MediaStore 文档或普通文件） */
	const boxOf = (h) => {
		if (!h) return null
		if (h.url) return docs.get(h.url) || null
		if (h.path) return files.get(h.path) || null
		return null
	}
	const push = (h, bytes) => {
		const box = boxOf(h)
		if (!box) return
		if (opts.dropWrites) return // 模拟真机：不报错但一个字节都没写进去
		// maxChunkBytes 模拟「Native.js 传参长度限制」：
		// 超过这个长度的块静默丢弃（真机就是这样）
		if (opts.maxChunkBytes && bytes.length > opts.maxChunkBytes) return
		for (let i = 0; i < bytes.length; i++) box.bytes.push(bytes[i])
	}

	const impl = {
		// invoke 会把接收者对象作为第一个参数传进来
		jstring: {
			getBytes: (o) => {
				const s = o.s
				const out = new Uint8Array(s.length)
				for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
				return out
			},
		},
		activity: { getContentResolver: () => ({ _kind: 'resolver' }) },
		resolver: {
			insert: (self, uri, values) => {
				if (opts.insertNull) return null
				const url = 'content://downloads/' + ++seq
				docs.set(url, { name: values.vals._display_name, bytes: [] })
				return { _kind: 'uri', url }
			},
			openOutputStream: (self, uri) => {
				if (opts.openOutNull) return null
				return { _kind: 'os', url: uri.url }
			},
			openInputStream: (self, uri) => {
				if (opts.openInNull) return null
				return { _kind: 'is', url: uri.url }
			},
			delete: (self, uri) => {
				docs.delete(uri && uri.url)
				return 1
			},
			query: (self, uri) => {
				if (opts.queryNull) return null
				const d = docs.get(uri && uri.url)
				if (!d) return null
				return { _kind: 'cursor', size: d.bytes.length }
			},
		},
		cursor: {
			moveToFirst: () => true,
			getColumnIndex: () => 0,
			getLong: (o) => o.size,
			close: () => {},
		},
		os: { write: (o, bytes) => push(o, bytes), flush: () => {}, close: () => {} },
		fos: { write: (o, bytes) => push(o, bytes), flush: () => {}, close: () => {} },
		// RandomAccessFile.writeBytes(String)：字符串按每字符低 8 位写成字节
		raf: {
			writeBytes: (o, text) => {
				if (!files.has(o.path)) files.set(o.path, { bytes: [] })
				const box = files.get(o.path)
				for (let i = 0; i < text.length; i++) box.bytes.push(text.charCodeAt(i) & 0xff)
			},
			// 'rw' 模式不清空文件，要显式截断
			setLength: (o, n) => {
				if (!files.has(o.path)) files.set(o.path, { bytes: [] })
				files.get(o.path).bytes = files.get(o.path).bytes.slice(0, Number(n) || 0)
			},
			close: () => {},
		},
		writer: {
			// 按 ISO-8859-1 写：每个码点恰好一个字节
			write: (o, text) => {
				const n = text.length
				const out = new Uint8Array(n)
				for (let i = 0; i < n; i++) out[i] = text.charCodeAt(i) & 0xff
				push(o.os, out)
			},
			flush: () => {},
			close: () => {},
		},
		is: {
			available: (o) => (boxOf(o) ? boxOf(o).bytes.length : 0),
			readAllBytes: (o) => Uint8Array.from(boxOf(o).bytes),
			close: () => {},
		},
		file: {
			exists: (o) => dirs.has(o.path),
			mkdirs: (o) => {
				dirs.add(o.path)
				return true
			},
			length: (o) => (files.get(o.path) ? files.get(o.path).bytes.length : 0),
			toPath: (o) => ({ _kind: 'path', path: o.path }),
		},
	}

	const Bas64 = {
		NO_WRAP: 2,
		encodeToString: (bytes) => Buffer.from(Uint8Array.from(bytes)).toString('base64'),
	}

	const classes = {
		'android.os.Build': { VERSION: { SDK_INT: opts.sdk === undefined ? 36 : opts.sdk } },
		'java.lang.String': function JString(s) {
			return { _kind: 'jstring', s: String(s) }
		},
		'android.content.ContentValues': function ContentValues() {
			this.vals = {}
			this.put = (k, v) => {
				this.vals[k] = v
			}
		},
		'android.provider.MediaStore$MediaColumns': { SIZE: '_size' },
		'android.provider.MediaStore$Downloads': {
			DISPLAY_NAME: '_display_name',
			MIME_TYPE: 'mime_type',
			RELATIVE_PATH: 'relative_path',
			EXTERNAL_CONTENT_URI: { _kind: 'uri', url: 'content://downloads' },
		},
		'java.io.FileOutputStream': function FileOutputStream(p) {
			if (opts.openOutThrows) throw new Error('打不开文件')
			if (!files.has(p)) files.set(p, { bytes: [] })
			return { _kind: 'fos', path: p }
		},
		'java.io.OutputStreamWriter': function OutputStreamWriter(os, enc) {
			if (opts.writerThrows) throw new Error('OutputStreamWriter 不可用')
			// 忠实模拟 Native.js：**JS 里 new 出来的实例，方法可用**
			// （Java 方法返回的实例才不可用 —— 那正是当初
			//   「resolver.insert is not a function」的成因）
			return {
				_kind: 'writer',
				os,
				enc,
				write: (text) => impl.writer.write({ os }, text),
				flush: () => {},
				close: () => {},
			}
		},
		'java.io.File': function File(p) {
			return { _kind: 'file', path: p }
		},
		'java.io.RandomAccessFile': function RandomAccessFile(p) {
			if (opts.rafThrows) throw new Error('RandomAccessFile 不可用')
			if (!files.has(p)) files.set(p, { bytes: [] })
			return { _kind: 'raf', path: p }
		},
		'java.nio.charset.StandardCharsets': { ISO_8859_1: { _kind: 'charset', name: 'ISO-8859-1' } },
		'java.nio.file.Files': {
			// 原生侧搬运：InputStream/Path → Path/OutputStream，字节不过 JS 桥
			copy: (a, b) => {
				if (opts.filesCopyThrows) throw new Error('Files.copy 不可用')
				// dropWrites 现在必须作用在这条路上 —— 它才是真正在搬运的路径
				if (opts.dropWrites) {
					const srcBox = a && a._kind === 'is' ? docs.get(a.url) : a && a.path ? files.get(a.path) : null
					return srcBox ? srcBox.bytes.length : 0
				}
				const src = a && a._kind === 'is' ? docs.get(a.url) : a && a.path ? files.get(a.path) : null
				let dst = b && b._kind === 'os' ? docs.get(b.url) : null
				if (!dst && b && b.path) {
					if (!files.has(b.path)) files.set(b.path, { bytes: [] })
					dst = files.get(b.path)
				}
				if (!src || !dst) throw new Error('Files.copy 参数不认识')
				for (let i = 0; i < src.bytes.length; i++) dst.bytes.push(src.bytes[i])
				return src.bytes.length
			},
			// 按 ISO-8859-1 读成字符串（每字节 → 一个码点）
			readString: (p) => {
				if (opts.readStringThrows) throw new Error('Files.readString 不可用')
				const box = files.get(p && p.path)
				if (!box) throw new Error('文件不存在')
				return Buffer.from(Uint8Array.from(box.bytes)).toString('utf8')
			},
			// writeString/readString 按真实 UTF-8 语义（中文一字符 3 字节）
			writeString: (p, text) => {
				if (opts.writeStringThrows) throw new Error('Files.writeString 不可用')
				const bytes = [...Buffer.from(String(text), 'utf8')]
				files.set(p && p.path, { bytes })
				return p
			},
			readAllLines: (p) => {
				if (opts.readAllLinesThrows) throw new Error('Files.readAllLines 不可用')
				const box = files.get(p && p.path)
				if (!box) throw new Error('文件不存在')
				return [Buffer.from(Uint8Array.from(box.bytes)).toString('utf8')]
			},
			size: (p) => {
				const box = files.get(p && p.path)
				return box ? box.bytes.length : 0
			},
		},
	}

	const android = {
		importClass: (name) => {
			if (opts.importNullFor === name) return null
			if (name === 'android.util.Base64') return Bas64
			return classes[name] || {}
		},
		invoke: function (obj, name) {
			const args = Array.prototype.slice.call(arguments, 2)
			if (obj && typeof obj[name] === 'function') return obj[name].apply(obj, args)
			const fn = impl[obj && obj._kind] && impl[obj && obj._kind][name]
			if (!fn) throw new Error(`${obj && obj._kind}.${name} is not a function`)
			return fn.apply(null, [obj].concat(args))
		},
		getAttribute: (cls, name) => (cls ? cls[name] : null),
		runtimeMainActivity: () => ({ _kind: 'activity' }),
	}

	return {
		plus: { android, io: { convertLocalFileSystemURL: (u) => 'ABS:/' + String(u) } },
		docs,
		files,
		dirs,
		firstUri: () => 'content://downloads/1',
		uriOf: (n) => 'content://downloads/' + n,
	}
}

const withMediaStore = async (opts, fn) => {
	const env = fakeMediaStore(opts)
	globalThis.plus = env.plus
	try {
		return await fn(env)
	} finally {
		delete globalThis.plus
	}
}

/* ========== plus.io + plus.zip 链路（真机上唯一能写的路） ========== */

/**
 * 假 plus.io / plus.zip。
 *
 * 关键：plus.io 的 FileWriter 收的是**字符串**，所以 mock 里也按文本存 ——
 * 这正是真机上的行为（写文本能成，写二进制不能）。
 * zip 部分直接用本项目自己的 zip 引擎，能真正验证打包/解包。
 */
/**
 * 假 plus.io。
 *
 * 只模拟**真机自检证明能用的那部分**：文本写入、文本读回、列目录、删文件。
 * 不模拟 copyTo / plus.zip —— 那几条在真机上要么静默失败要么不可靠，
 * 应用也已经不再依赖它们（照片存成 base64 文本，备份是一个 JSON 文本）。
 *
 * opts.fsFails    requestFileSystem 直接失败（模拟磁盘满/无权限）
 * opts.noDirs     建目录失败（模拟一个输出目录都拿不到）
 * opts.dropTail   每次 write 悄悄少写最后一个字符（模拟静默丢字节）
 */
function fakePlusIO(opts = {}) {
	/** absPath -> 文本内容（真机上 plus.io 只能可靠地写文本） */
	const files = new Map()
	const dirs = new Set(['/abs', '/abs/_doc', '/abs/_downloads', '/abs/_documents'])

	const base = (url) => {
		const t = String(url || '')
		if (t.indexOf('/') === 0) return t.replace(/\/$/, '')
		return ('/abs/' + t.replace(/^\.?\/?/, '')).replace(/\/$/, '')
	}
	const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1)

	const rootPath = (path) => {
		const t = String(path || '')
		if (t.indexOf('/') === 0) return t.replace(/\/$/, '')
		if (t.indexOf('_') === 0) return base(t)
		return '/abs/_doc/' + t.replace(/^\.?\/?/, '')
	}

	const entryOf = (abs) => {
		const e = {
			name: nameOf(abs),
			isFile: files.has(abs),
			isDirectory: dirs.has(abs),
			fullPath: abs,
			__abs: abs,
			file: (cb) => {
				const t = files.get(abs)
				cb && cb(t === undefined ? null : { size: Buffer.byteLength(t, 'utf8'), name: e.name, __abs: abs })
			},
			remove: (cb) => {
				files.delete(abs)
				dirs.delete(abs)
				cb && cb()
			},
			// copyTo：应用已不再用它（真机上会静默失败），但自检会探测它，
			// 所以 mock 里按「正常工作的 plus.io」实现，供那条探针用
			copyTo: (dir, name, ok, fail) => {
				const src = files.get(abs)
				if (src === undefined) return fail && fail(new Error('源不存在'))
				const dest = ((dir && dir.fullPath) || '/abs').replace(/\/$/, '') + '/' + name
				files.set(dest, src)
				ok && ok(entryOf(dest))
			},
			createWriter: (cb) => {
				// 忠实模拟文件写入：从 pos 开始覆写，pos 随之前进（分块写就是靠这个串起来的）
				let pos = 0
				const w = {
					onwrite: null,
					onerror: null,
					seek(n) {
						pos = Number(n) || 0
					},
					truncate() {
						files.set(abs, '')
						pos = 0
					},
					write(text) {
						const piece = opts.dropTail ? String(text).slice(0, -1) : String(text)
						const prev = files.get(abs) || ''
						files.set(abs, prev.slice(0, pos) + piece + prev.slice(pos + piece.length))
						pos += piece.length
						setTimeout(() => w.onwrite && w.onwrite(), 0)
					},
				}
				cb(w)
			},
			createReader: () => ({
				readEntries: (cb) => {
					const prefix = abs + '/'
					const out = []
					for (const k of files.keys()) {
						if (k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf('/') < 0) out.push(entryOf(k))
					}
					for (const d of dirs) {
						if (d.indexOf(prefix) === 0 && d.slice(prefix.length).indexOf('/') < 0) {
							out.push({ name: nameOf(d), isFile: false, isDirectory: true, fullPath: d })
						}
					}
					cb(out)
				},
			}),
		}
		return e
	}

	const FileReader = function () {
		this.readAsDataURL = (file) => {
			const abs = (file && file.__abs) || ''
			setTimeout(() => {
				const t = files.get(abs)
				if (t === undefined) {
					this.onerror && this.onerror(new Error('读不到'))
					return
				}
				const b64 = Buffer.from(t, 'utf8').toString('base64')
				this.onloadend && this.onloadend({ target: { result: 'data:application/octet-stream;base64,' + b64 } })
			}, 0)
		}
		// 读文本：返回文件内容本身（不是它的 base64）——
		// .b64 照片文件的内容已经是 base64，双重编码会让照片永远显示不出来
		this.readAsText = (file) => {
			const abs = (file && file.__abs) || ''
			setTimeout(() => {
				const t = files.get(abs)
				if (t === undefined) {
					this.onerror && this.onerror(new Error('读不到'))
					return
				}
				this.onloadend && this.onloadend({ target: { result: t } })
			}, 0)
		}
	}

	const root = {
		// PRIVATE_DOC 的根就是 _doc —— 真机上 fullPath 也带着这一段，
		// copyTo 的目标路径要靠它，少了就会拷错地方
		fullPath: '/abs/_doc',
		// 相对路径相对 fs 根（_doc）；以 _ 开头的是本地 URL（_doc/xxx）
		getFile: (path, o, ok, fail) => {
			if (opts.noDirs) return fail && fail(new Error('写不进去'))
			const p = rootPath(path)
			dirs.add(p.slice(0, p.lastIndexOf('/')))
			if (!files.has(p)) files.set(p, '')
			ok(entryOf(p))
		},
		getDirectory: (path, o, ok, fail) => {
			if (opts.noDirs) return fail && fail(new Error('建不了目录'))
			const p = rootPath(path)
			if (!files.has(p)) dirs.add(p)
			ok(entryOf(p))
		},
	}

	const plusLike = {
		io: {
			PRIVATE_DOC: 1,
			PUBLIC_DOWNLOADS: 2,
			PUBLIC_DOCUMENTS: 3,
			convertLocalFileSystemURL: (u) => base(u),
			requestFileSystem: (type, ok, fail) => {
				if (opts.fsFails) return fail && fail(new Error('文件系统不可用'))
				ok({ root })
			},
			resolveLocalFileSystemURL: (u, ok, fail) => {
				const p = base(u)
				if (files.has(p) || dirs.has(p)) ok(entryOf(p))
				else fail && fail(new Error('找不到：' + p))
			},
			FileReader,
		},
	}

	// 如果外层已经有一个 plus（例如 withMediaStore 造的 android 环境），
	// 把它并进来 —— 两个假环境叠加时不该互相抹掉
	const outer = globalThis.plus
	if (outer && outer.android) plusLike.android = outer.android
	if (outer && outer.zip) plusLike.zip = outer.zip

	return { plus: plusLike, files, dirs, base }
}

const withPlusIO = async (opts, fn) => {
	const env = fakePlusIO(opts)
	globalThis.plus = env.plus
	// 输出目录是缓存过的，每个假环境都要重新探测
	BK._resetOutDirs()
	try {
		return await fn(env)
	} finally {
		delete globalThis.plus
	}
}

/** 让写入悄悄丢字节，验证「写完回查大小」真的能抓住 */
const withShortWrite = (fn) => withPlusIO({ dropTail: true }, fn)

group('plusio.js · 文本写入是唯一可靠的路')

const PIO = await import('../src/core/plusio.js')

eq(
	PIO.isUserVisible('/storage/emulated/0/Android/data/com.x/apps/y/doc'),
	false,
	'Android/data 下的目录判为用户不可见'
)
eq(PIO.isUserVisible('/storage/emulated/0/Download/x.json'), true, '公共下载目录判为可见')

await withPlusIO({}, async () => {
	// 写文本 → 回读：自检证明这台设备上只有这条路真的能写进去
	const w = await PIO.writeText('_doc/t.txt', 'hello-中文')
	eq(w.ok, true, 'plus.io 写文本成功')
	eq(await PIO.fileSize('_doc/t.txt'), Buffer.byteLength('hello-中文', 'utf8'), '大小按 UTF-8 字节算')

	const r = await PIO.readBase64('_doc/t.txt')
	eq(r.ok, true, '读回成功')
	eq(Buffer.from(r.base64, 'base64').toString('utf8'), 'hello-中文', '★ 字节完全一致（中文不乱码）')
})

await withPlusIO({}, async () => {
	// 写入大小不对时必须报失败，不能返回「看起来成功」
	const bad = await withShortWrite(async () => PIO.writeTextChecked('_doc/t2.txt', 'ABCDEFGH'))
	eq(bad.ok, false, '★ 写完回查大小，对不上就报失败')
	ok(String(bad.error).indexOf('大小') >= 0, `错误信息说清是大小问题：${bad.error}`)
})

await withPlusIO({}, async () => {
	// 分块写：超过单块上限的文本也要完整落盘
	const big = 'B'.repeat(PIO.WRITE_CHUNK * 2 + 123)
	const w = await PIO.writeTextChecked('_doc/big.txt', big)
	eq(w.ok, true, '★ 超长文本分块写成功')
	eq(w.bytes, big.length, '字节数与预期一致')
	const back = await PIO.readText('_doc/big.txt')
	eq(back.ok, true, '读回成功')
	eq(back.text.length, big.length, '★ 分块写没有丢内容')
})

group('完整备份 · 真机唯一能走的路（plus.io 文本）')

await withPlusIO({}, async (env) => {
	// 端到端：存记录（带照片）→ 导出 → 清空 → 从文件恢复 → 照片回来
	freshStorage()
	initDB()
	// 照片在磁盘上就是 base64 文本
	await PIO.writeText('_doc/food/food_p1.b64', 'UEhPVE8tT05F')
	await PIO.writeText('_doc/food/food_p2.b64', 'UEhPVE8tVFdP')
	saveRecord({ ts: T(2026, 9, 16, 8, 0), items: [rice], photo: '_doc/food/food_p1.b64', note: '有照片' })
	saveRecord({ ts: T(2026, 9, 16, 12, 0), items: [rice], photo: '_doc/food/food_p2.b64', note: '也有照片' })

	const built = await FBIO.buildFullBackupJson()
	eq(built.ok, true, '导出成功')
	eq(built.stats.photos, 2, '★ 两张照片都进备份了')
	eq(built.stats.missing.length, 0, '没有缺失')

	const parsed = FB.parseFullBackupText(built.text)
	eq(parsed.ok, true, '备份文本能解析回来')
	eq(parsed.payload.photos.length, 2, '备份里确实有照片本体')

	// 写进「下载目录」
	const out = await BK.exportFullBackupText(built.text, 'calorie-backup-test-full.json')
	eq(out.ok, true, `★ 导出到磁盘成功：${out.error || ''}`)
	eq(out.userVisible, true, '落在用户能看到的目录')
	eq(
		out.bytes,
		Buffer.byteLength(built.text, 'utf8'),
		'★ 写进去的字节数与文本的 UTF-8 字节数一致（不是 0 字节；注意中文，不能用 length）'
	)

	// 清空，再列文件、读回来
	clearAll()
	eq(allRecords().length, 0, '清空成功')

	const listed = await BK.listBackupFiles()
	eq(listed.ok, true, '列出备份文件成功')
	eq(listed.files.length, 1, '★ 找到了刚导出的那个备份')
	eq(listed.files[0].name, 'calorie-backup-test-full.json', '文件名对')
	eq(listed.files[0].size > 0, true, '★ 文件大小回查正常（不是 0 字节）')

	const loaded = await BK.loadBackupFromFile(listed.files[0].url)
	eq(loaded.ok, true, `读取备份成功：${loaded.error || ''}`)
	eq(loaded.payload.records.length, 2, '读回 2 条记录')

	const applied = await FBIO.applyRestoredBackup(loaded.payload)
	eq(applied.ok, true, '恢复成功')
	eq(applied.records, 2, '恢复出 2 条记录')
	eq(applied.photos, 2, '★ 写回 2 张照片')
	eq(env.files.get('/abs/_doc/food/food_p1.b64'), 'UEhPVE8tT05F', '★ 照片内容逐字符一致')
	eq(allRecords().length, 2, '记录回到 2 条')
	eq(
		allRecords().filter((r) => r.photo).length,
		2,
		'★ 两条记录的照片路径都在（换手机后照片不会消失）'
	)
	eq(
		allRecords().every((r) => r.photo.indexOf('_doc/food/') === 0),
		true,
		'照片路径指向私有目录'
	)
})

await withPlusIO({}, async () => {
	// 照片缺失：导出照样成功，但如实报告，且不留死链
	freshStorage()
	initDB()
	saveRecord({ ts: T(2026, 9, 16, 8, 0), items: [rice], photo: '_doc/food/nope.b64' })
	saveRecord({ ts: T(2026, 9, 16, 12, 0), items: [rice] })

	const built = await FBIO.buildFullBackupJson()
	eq(built.ok, true, '照片丢失不影响导出')
	eq(built.stats.photos, 0, '0 张照片')
	eq(built.stats.dropped, 1, '★ 如实记下 1 张缺失')
	const parsed = FB.parseFullBackupText(built.text)
	eq(parsed.payload.records[0].photo, '', '★ 缺照片的那条记录图片字段被清空')
})

await withPlusIO({ noDirs: true }, async () => {
	// 一个目录都写不进去 → 明确报失败，不能假装成功
	const r = await BK.exportFullBackupText('{"records":[]}', 'x.json')
	eq(r.ok, false, '★ 全写不进去时报失败')
	ok(String(r.error).indexOf('写不进去') >= 0, `说清是写不进去：${r.error}`)
})

const ST = await import('../src/core/selftest.js')

group('selftest.js · 自检要能报出真话')

// Node / H5 环境：应老实报「非 Android」，而不是崩
const st1 = await ST.runSelfTest()
ok(Array.isArray(st1.rows) && st1.rows.length > 0, '产出报告行')
ok(st1.text.indexOf('原生能力自检') >= 0, '报告有标题')
eq(st1.rows[0].ok, false, '没有 plus 时第一条就报不通')
ok(st1.text.indexOf('不通') >= 0, '报告里出现「不通」')

// 假 Android + 假 plus.io：核心路径（文本写读、照片往返、备份往返）要全通
await withMediaStore({}, async () => {
	await withPlusIO({}, async () => {
		const st2 = await ST.runSelfTest()
		const byName = (n) => st2.rows.find((x) => x.name.indexOf(n) >= 0)

		ok(!!byName('运行环境'), '有「运行环境」这条')
		eq(byName('运行环境').ok, true, '假 Android 环境被认出来')
		ok(
			String(byName('运行环境').detail).indexOf('API 36') >= 0,
			`读到 API 级别：${byName('运行环境').detail}`
		)

		// ★ 这几条就是应用真正依赖的路径，必须通
		eq(byName('plus.io 可用').ok, true, 'plus.io 那条通过')
		eq(byName('plus.io 写文本 + 核对大小').ok, true, '★ 写文本 + 回查大小通过')
		eq(byName('plus.io 读文本').ok, true, '★ 读文本通过（含中文）')
		eq(byName('照片落盘往返').ok, true, '★ 照片存了再读回完全一致')
		eq(byName('备份文本往返').ok, true, '★ 备份写了再读回能解析')
		eq(byName('plus.io copyTo').ok, true, '备选路径 copyTo 通过')

		ok(st2.text.indexOf('照片落盘往返') >= 0, '报告里列出了具体项名，便于对照')
		ok(/\d+ 项不通/.test(st2.text) || st2.text.indexOf('全部通过') >= 0, '报告末尾有汇总')
	})
})

// 刻意弄坏：写入悄悄丢字节 → 自检必须报不通（这正是「静默失败」的防线）
await withMediaStore({}, async () => {
	await withPlusIO({ dropTail: true }, async () => {
		const st3 = await ST.runSelfTest()
		const byName = (n) => st3.rows.find((x) => x.name.indexOf(n) >= 0)
		eq(byName('plus.io 写文本 + 核对大小').ok, false, '★ 写入丢字节 → 自检报不通')
		eq(byName('照片落盘往返').ok, false, '★ 照片往返也会报不通（不会假装成功）')
		ok(String(byName('plus.io 写文本 + 核对大小').detail).indexOf('大小') >= 0, '错误里说清是大小不对')
	})
})

// 完全写不进去的环境（磁盘满 / 无权限）
await withMediaStore({}, async () => {
	await withPlusIO({ fsFails: true }, async () => {
		const st4 = await ST.runSelfTest()
		const byName = (n) => st4.rows.find((x) => x.name.indexOf(n) >= 0)
		eq(byName('plus.io 写文本 + 核对大小').ok, false, '文件系统不可用 → 报不通')
		eq(byName('照片落盘往返').ok, false, '照片也写不了')
		ok(st4.text.indexOf('影响备份') >= 0, '★ 报告末尾单独指出哪些不通会影响备份/照片')
	})
})

group('selftest.js · 报告格式')
const rows = [
	{ name: 'A', ok: true, detail: '好的' },
	{ name: 'B', ok: false, detail: '坏的' },
	{ name: 'C', ok: null, detail: '' },
]
const txt = ST.reportOf(rows)
ok(txt.indexOf('[通过] A — 好的') >= 0, '通过的项有标记与说明')
ok(txt.indexOf('[不通] B — 坏的') >= 0, '不通的项有标记与说明')
ok(txt.indexOf('[跳过] C') >= 0, '跳过的项有标记')
ok(txt.indexOf('1 项不通：B') >= 0, '末尾汇总不通的项名')

/* ---------------- 汇总 ---------------- */
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
if (fail) {
	console.log('\n失败用例:')
	failures.forEach((f) => console.log('  · ' + f))
}
console.log('='.repeat(46))
process.exit(fail ? 1 : 0)
