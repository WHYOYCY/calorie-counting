/**
 * 数据层 —— 记录的增删改查、设置读写、结构迁移、备份导入导出
 *
 * 存储布局：
 *   cc_meta     -> { schemaVersion }
 *   cc_records  -> Record[]
 *   cc_settings -> Settings
 *
 * 设计要点：
 *   1. 记录是纯文本（一年约 200KB），照片以「文件」形式存 App 沙箱，
 *      库里只留相对路径 —— 避免把 base64 塞进 storage 撑爆容量。
 *   2. 所有 uni API 调用都做运行时特性探测，使本模块可在 Node 中直接测试。
 *   3. date / meal 在保存时由 ts 重新派生，避免「改了时间但分类没变」。
 */
import { SCHEMA_VERSION, DEFAULT_SETTINGS, MEAL_KEYS } from './constants.js'
import { dateKey, mealOfTs } from './date.js'
import { round } from './nutrition.js'
import { deletePhotoFile } from './photo.js'

const K_META = 'cc_meta'
const K_RECORDS = 'cc_records'
const K_SETTINGS = 'cc_settings'

/* ---------------- 底层读写（特性探测，Node 可测） ---------------- */

function hasStorage() {
	return (
		typeof uni !== 'undefined' &&
		!!uni &&
		typeof uni.getStorageSync === 'function' &&
		typeof uni.setStorageSync === 'function'
	)
}

function readRaw(key, fallback) {
	if (!hasStorage()) return fallback
	try {
		const v = uni.getStorageSync(key)
		if (v === '' || v === null || v === undefined) return fallback
		return typeof v === 'string' ? JSON.parse(v) : v
	} catch (e) {
		return fallback
	}
}

function writeRaw(key, value) {
	if (!hasStorage()) return false
	try {
		uni.setStorageSync(key, JSON.stringify(value))
		return true
	} catch (e) {
		return false
	}
}

/** 删除照片文件（缺口 A4：删除记录时连带清理，否则沙箱被垃圾图撑爆） */
function removePhotoFile(path) {
	deletePhotoFile(path)
}

/* ---------------- id ---------------- */

let idSeq = 0
export function genId() {
	idSeq = (idSeq + 1) % 46656
	return (
		Date.now().toString(36) +
		'-' +
		idSeq.toString(36) +
		'-' +
		Math.floor(Math.random() * 46656).toString(36)
	)
}

/* ---------------- 归一化 ---------------- */

export function normalizeItem(it) {
	const src = it || {}
	const p = src.per100 || {}
	return {
		name: String(src.name || '').trim(),
		grams: Math.max(0, round(Number(src.grams) || 0)),
		per100: {
			kcal: Math.max(0, round(Number(p.kcal) || 0)),
			protein: Math.max(0, round(Number(p.protein) || 0)),
			fat: Math.max(0, round(Number(p.fat) || 0)),
			carbs: Math.max(0, round(Number(p.carbs) || 0)),
		},
	}
}

/**
 * 归一化一条记录。
 *
 * mealAuto 表示「餐次是否跟随时间自动归类」：
 *   true  -> meal 每次由 ts 重新推导（改了时间，分类跟着变）
 *   false -> meal 用用户手选的值，不随时间变
 *
 * 这个标记必须写到返回值里（即落盘）。早先漏写了，导致存进去的记录
 * 丢掉标记，下次冷启动重读时被视为「自动」而把手选餐次冲掉。
 *
 * opts.keepStamps：重读存量数据/导入备份时保留原有时间戳，
 * 否则每次冷启动 updatedAt 都会被刷成当前时间。
 */
export function normalizeRecord(input, opts) {
	const src = input || {}
	const now = Date.now()
	const ts = Number(src.ts) || now
	const autoMeal = mealOfTs(ts)
	const hasMeal = MEAL_KEYS.includes(src.meal)

	// 老数据没有 mealAuto 字段：若存的餐次与按时间推导的不一致，
	// 说明当初是手动指定的，按手动处理 —— 标记已经丢了，只能这样推断。
	// 不这么干的话，这次修复反而会把用户以前手选的餐次冲回自动值。
	const manual =
		src.mealAuto === false ||
		(src.mealAuto !== true && hasMeal && src.meal !== autoMeal)

	const keepStamps = !!(opts && opts.keepStamps)

	return {
		id: src.id || genId(),
		ts,
		date: dateKey(ts),
		meal: manual && hasMeal ? src.meal : autoMeal,
		mealAuto: !manual,
		items: (src.items || []).map(normalizeItem).filter((it) => it.name && it.grams > 0),
		photo: src.photo || '',
		note: String(src.note || '').trim(),
		source: src.source === 'ai' ? 'ai' : 'manual',
		createdAt: Number(src.createdAt) || now,
		updatedAt: keepStamps ? Number(src.updatedAt) || Number(src.createdAt) || now : now,
	}
}

function isValidRecord(r) {
	return !!r && typeof r === 'object' && typeof r.id === 'string' && Number(r.ts) > 0
}

/* ---------------- 缓存 ---------------- */

let recordCache = null

function loadRecords() {
	if (recordCache) return recordCache
	const raw = readRaw(K_RECORDS, [])
	recordCache = (Array.isArray(raw) ? raw : [])
		.filter(isValidRecord)
		.map((r) => normalizeRecord(r, { keepStamps: true }))
	return recordCache
}

function persistRecords() {
	return writeRaw(K_RECORDS, recordCache || [])
}

/** 按时间倒序 */
function sortDesc(list) {
	return list.slice().sort((a, b) => b.ts - a.ts)
}

/* ---------------- 迁移 ---------------- */

const MIGRATIONS = [
	// v0 -> v1：首个正式版本，仅写入版本号
	(meta) => {
		meta.schemaVersion = 1
	},
]

function migrate() {
	const meta = readRaw(K_META, { schemaVersion: 0 }) || { schemaVersion: 0 }
	let v = Number(meta.schemaVersion) || 0
	while (v < SCHEMA_VERSION && v < MIGRATIONS.length) {
		MIGRATIONS[v](meta)
		v = Number(meta.schemaVersion) || v + 1
	}
	meta.schemaVersion = SCHEMA_VERSION
	writeRaw(K_META, meta)
	return meta
}

/** 初始化：迁移 + 补齐默认设置 + 预热缓存 */
export function initDB() {
	migrate()
	const s = readRaw(K_SETTINGS, null)
	if (!s) writeRaw(K_SETTINGS, { ...DEFAULT_SETTINGS })
	recordCache = null
	loadRecords()
	return true
}

/* ---------------- 记录 CRUD ---------------- */

export function allRecords() {
	return sortDesc(loadRecords())
}

export function getRecord(id) {
	return loadRecords().find((r) => r.id === id) || null
}

export function recordsByDate(key) {
	return sortDesc(loadRecords().filter((r) => r.date === key))
}

export function recordsInRange(fromKey, toKey) {
	return loadRecords().filter((r) => r.date >= fromKey && r.date <= toKey)
}

/** 新增或更新（以 id 判定），返回保存后的记录 */
export function saveRecord(input) {
	const rec = normalizeRecord(input)
	const list = loadRecords()
	const idx = list.findIndex((r) => r.id === rec.id)
	if (idx >= 0) {
		// 保留原始创建时间；若换了照片则清掉旧图
		const old = list[idx]
		rec.createdAt = old.createdAt
		if (old.photo && old.photo !== rec.photo) removePhotoFile(old.photo)
		list[idx] = rec
	} else {
		list.push(rec)
	}
	persistRecords()
	return rec
}

export function deleteRecord(id) {
	const list = loadRecords()
	const idx = list.findIndex((r) => r.id === id)
	if (idx < 0) return false
	removePhotoFile(list[idx].photo)
	list.splice(idx, 1)
	persistRecords()
	return true
}

/* ---------------- 设置 ---------------- */

export function getSettings() {
	const s = readRaw(K_SETTINGS, null)
	return { ...DEFAULT_SETTINGS, ...(s || {}) }
}

export function saveSettings(patch) {
	const next = { ...getSettings(), ...(patch || {}) }
	writeRaw(K_SETTINGS, next)
	return next
}

/* ---------------- 备份 ---------------- */

export function exportAll() {
	return {
		app: 'calorie-counting',
		schemaVersion: SCHEMA_VERSION,
		exportedAt: Date.now(),
		settings: getSettings(),
		records: allRecords(),
	}
}

/**
 * 导入备份。
 * mode = 'replace' 覆盖 / 'merge' 合并（按 id 去重）
 */
export function importAll(payload, mode = 'merge') {
	let data = payload
	if (typeof payload === 'string') {
		try {
			data = JSON.parse(payload)
		} catch (e) {
			return { ok: false, error: 'JSON 解析失败' }
		}
	}
	if (!data || !Array.isArray(data.records)) {
		return { ok: false, error: '备份格式不正确：缺少 records 数组' }
	}
	const incoming = data.records
		.filter(isValidRecord)
		.map((r) => normalizeRecord(r, { keepStamps: true }))
	if (mode === 'replace') {
		for (const r of loadRecords()) removePhotoFile(r.photo)
		recordCache = incoming
	} else {
		const list = loadRecords()
		const seen = new Set(list.map((r) => r.id))
		for (const r of incoming) {
			if (!seen.has(r.id)) list.push(r)
		}
	}
	persistRecords()
	if (data.settings && typeof data.settings === 'object') {
		saveSettings(data.settings)
	}
	return { ok: true, imported: incoming.length, total: loadRecords().length }
}

/** 清空全部记录（连同照片文件） */
export function clearAll() {
	for (const r of loadRecords()) removePhotoFile(r.photo)
	recordCache = []
	persistRecords()
	return true
}

/** 仅供测试：丢弃内存缓存，强制从存储重读 */
export function _resetCache() {
	recordCache = null
}
