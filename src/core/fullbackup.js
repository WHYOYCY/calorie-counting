/**
 * 完整备份（记录 + 照片）的打包 / 解包 —— 纯逻辑，不碰平台 API
 *
 * 格式（v2）：**一个普通的 JSON 文本文件**
 *
 *   {
 *     "format": "cc-full-backup",
 *     "version": 2,
 *     "exportedAt": 1757...,
 *     "records": [ { ...记录, "photo": "food_1.b64" } ],   // photo 是名字，不是路径
 *     "photos":  [ { "name": "food_1.b64", "base64": "..." } ]
 *   }
 *
 * 为什么从 zip 改成单个 JSON：真机自检证明这台设备上
 *   只有 plus.io 的 FileWriter.write(String) 能真正写进去，
 *   entry.copyTo / plus.zip / 各种 Native.js 写入全都是「不报错但 0 字节」。
 * 所以照片在磁盘上就是 base64 文本（.b64），备份自然就是把这段文本塞进 JSON ——
 * 不再需要打包文件、不再需要 zip、也不再有任何「静默失败」的空间。
 *
 * 代价：文件比原图大约 1/3，换来的是「确实存在、且能核对」。
 *
 * 照片名字统一成 <原名>.b64，导出与导入用同一套规则，
 * 所以老记录里指向 .jpg 的照片也能被正确带上。
 */

import { utf8Bytes } from './utf8.js'

export { utf8Bytes, utf8Decode } from './utf8.js'

/** 旧版 zip 备份里照片所在的目录（解析时兼容一下） */
export const PHOTO_DIR = 'photos/'

export const FORMAT = 'cc-full-backup'
export const FORMAT_VERSION = 2

/** 从路径里取文件名（_doc/food/a.b64 与 /storage/…/food/a.jpg 都要能处理） */
export function basename(p) {
	const s = String(p || '')
	const i = s.lastIndexOf('/')
	return i >= 0 ? s.slice(i + 1) : s
}

/**
 * 记录里的照片路径 → 备份里的照片名字。
 *
 * 统一改成 .b64：磁盘上照片是 base64 文本，老记录可能还指着 .jpg，
 * 但两者的**内容**读出来都是 base64，统一命名后导入端才不用猜。
 * data: / blob:（H5 临时照片）没有文件名，用序号生成一个。
 */
export function photoNameOf(photoPath, index = 0) {
	const s = String(photoPath || '')
	if (!s) return ''
	if (/^(data:|blob:)/i.test(s)) return `photo_${index}.b64`
	const b = basename(s)
	if (!b) return ''
	return b.replace(/\.[^.]+$/, '') + '.b64'
}

/** 记录里所有照片名字（去重，保持出现顺序） */
export function photoNamesOf(records) {
	const out = []
	const seen = new Set()
	;(records || []).forEach((r, i) => {
		if (!r || !r.photo) return
		const n = photoNameOf(r.photo, i)
		if (!n || seen.has(n)) return
		seen.add(n)
		out.push({ name: n, from: r.photo })
	})
	return out
}

/**
 * 打包：把照片读成 base64 塞进 payload。
 *
 * 读不到的照片**不假装**：对应记录的 photo 会被清空，
 * 并在 stats.missing 里列出 —— 换手机后少几张照片是能接受的，
 * 但留一堆点不开的死链不能接受。
 *
 * @param {object} exported  exportAll() 的结果
 * @param {(path:string, name:string)=>Promise<string|null>} readPhoto 读一张照片的 base64
 * @returns {Promise<{payload:object, stats:object}>}
 */
export async function packPayload(exported, readPhoto, opts = {}) {
	const now = Number(opts.now) || 0
	const src = (exported && exported.records) || []
	const list = photoNamesOf(src)

	const photos = []
	const missing = []
	for (const item of list) {
		let b64 = null
		try {
			b64 = await readPhoto(item.from, item.name)
		} catch (e) {
			b64 = null
		}
		if (b64) photos.push({ name: item.name, base64: b64 })
		else missing.push(item.name)
	}

	const have = new Set(photos.map((p) => p.name))
	const records = src.map((r, i) => {
		if (!r || !r.photo) return r
		const n = photoNameOf(r.photo, i)
		if (n && have.has(n)) return { ...r, photo: n }
		return { ...r, photo: '' }
	})

	const payload = {
		...exported,
		format: FORMAT,
		version: FORMAT_VERSION,
		exportedAt: now || exported.exportedAt || 0,
		records,
		photos,
	}

	return {
		payload,
		stats: {
			records: records.length,
			photos: photos.length,
			missing,
			dropped: missing.length,
		},
	}
}

/**
 * 解包：把 payload 里的照片名字还原成目标路径，并列出照片本体。
 * 备份里没带的照片 → 记录的 photo 清空（不留死链）。
 *
 * @param {object} payload
 * @param {(name:string)=>string} targetPathOf 名字 → 记录的 photo 该写什么
 * @returns {{ok:boolean, error?:string, records:Array, photos:Array, missing:string[], stats:object}}
 */
export function unpackPayload(payload, targetPathOf) {
	if (!payload || !Array.isArray(payload.records)) {
		return { ok: false, error: '备份格式不正确：缺少 records', records: [], photos: [], missing: [], stats: {} }
	}
	const photos = (Array.isArray(payload.photos) ? payload.photos : []).filter(
		(p) => p && p.name && typeof p.base64 === 'string' && p.base64
	)
	const byName = new Map(photos.map((p) => [p.name, p.base64]))
	const at = typeof targetPathOf === 'function' ? targetPathOf : (n) => n

	const missing = []
	const records = payload.records.map((r) => {
		if (!r || !r.photo) return r
		// 兼容旧版 zip 备份里的 "photos/xxx.jpg" 写法
		let n = String(r.photo)
		if (n.indexOf(PHOTO_DIR) === 0) n = n.slice(PHOTO_DIR.length)
		n = photoNameOf(n)
		if (n && byName.has(n)) return { ...r, photo: at(n) }
		if (n) missing.push(n)
		return { ...r, photo: '' }
	})

	return {
		ok: true,
		records,
		photos,
		missing,
		stats: { records: records.length, photos: photos.length, missing },
	}
}

/** 备份摘要（给确认弹窗用） */
export function summarizePayload(payload) {
	const records = (payload && payload.records) || []
	const photos = (payload && payload.photos) || []
	const withPhoto = records.filter((r) => r && r.photo).length
	return { records: records.length, photos: photos.length, withPhoto }
}

/** 把备份文本解析成 payload */
export function parseFullBackupText(text) {
	let obj = null
	try {
		obj = JSON.parse(String(text))
	} catch (e) {
		return { ok: false, error: '备份内容不是合法 JSON（文件可能损坏或没传完）' }
	}
	if (!obj || !Array.isArray(obj.records)) {
		return { ok: false, error: '备份格式不正确：缺少 records' }
	}
	return { ok: true, payload: obj }
}

/**
 * 估算备份文本的大小（字节）。
 * 用来卡上限，所以宁可略高估 —— 估低了会放行一个写不进去的备份。
 * base64 与 JSON 结构都是 ASCII，字符数即字节数。
 */
export function sizeOfPayload(payload) {
	const photos = (payload && payload.photos) || []
	let n = 0
	for (const p of photos) {
		// {"name":"...","base64":"..."} 的结构开销大概这么多
		n += (p.base64 || '').length + (p.name || '').length + 32
	}
	return utf8Bytes(JSON.stringify({ ...payload, photos: [] })).length + n
}


