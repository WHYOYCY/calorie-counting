/**
 * 完整备份（记录 + 照片）
 *
 * 为什么需要单独一层：普通备份只导出记录，照片路径在、照片本身不在 ——
 * 换手机导入后每张照片都是一片空白。这里把照片也装进 zip，并且
 * 把路径改写成 zip 内的相对路径，导出的 JSON 才是可移植的。
 *
 * zip 内布局：
 *   backup.json          记录与设置（photo 字段是 photos/xxx.jpg）
 *   photos/food_1.jpg    照片本体
 *
 * 本模块是纯逻辑（不碰平台 API），所以能在 Node 里完整测试；
 * 真正的读写落在 zip.js 与各平台层。
 */
import { readZip } from './zip.js'

export const MANIFEST_NAME = 'backup.json'
export const PHOTO_DIR = 'photos/'

/** 从路径里取文件名（_doc/food/a.jpg 与 /storage/…/food/a.jpg 都要能处理） */
export function basename(p) {
	const s = String(p || '')
	const i = s.lastIndexOf('/')
	return i >= 0 ? s.slice(i + 1) : s
}

/** 记录里所有非空照片路径（去重） */
export function photoPathsOf(records) {
	const out = []
	const seen = new Set()
	for (const r of records || []) {
		if (!r || !r.photo) continue
		const b = basename(r.photo)
		if (!b || seen.has(b)) continue
		seen.add(b)
		out.push(r.photo)
	}
	return out
}

function utf8Bytes(str) {
	// 不依赖 TextEncoder：App 旧内核里不一定有
	const s = String(str)
	const out = []
	for (let i = 0; i < s.length; i++) {
		let c = s.charCodeAt(i)
		if (c < 0x80) out.push(c)
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
		else if (c >= 0xd800 && c <= 0xdbff) {
			// 代理对（emoji 等）
			const c2 = s.charCodeAt(++i)
			c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
			out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
		} else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
	}
	return new Uint8Array(out)
}

function utf8Decode(bytes) {
	let s = ''
	let i = 0
	const b = bytes
	while (i < b.length) {
		const c = b[i++]
		if (c < 0x80) s += String.fromCharCode(c)
		else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63))
		else if (c < 0xf0)
			s += String.fromCharCode(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63))
		else {
			const cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63)
			const v = cp - 0x10000
			s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 1023))
		}
	}
	return s
}

function sizeOf(data) {
	return typeof data === 'string' ? Math.floor((data.length * 3) / 4) : data.length
}

/** 导出时：把记录里的照片路径改写成 zip 内的相对路径 */
function rewriteForZip(rec) {
	if (!rec || !rec.photo) return rec
	const b = basename(rec.photo)
	return { ...rec, photo: b ? PHOTO_DIR + b : '' }
}

/**
 * 组装完整备份的 zip 条目。
 *
 * read() 是惰性的：打包时才逐个去读照片，所以内存占用是「最大的那张照片」，
 * 而不是所有照片的总和 —— 否则几百 MB 的备份会直接把手机搞崩。
 *
 * @param {object} payload    exportAll() 的结果
 * @param {(path:string) => Promise<string|Uint8Array|null>} readPhoto
 *        读一张照片，返回 base64 或字节；读不到返回 null（会被跳过）
 * @param {object} [stats]    打包过程中被填上实际结果，打包完成后才准
 * @returns {{entries:Array, stats:object}}
 */
export function fullBackupEntries(payload, readPhoto, stats) {
	const s = stats || { photos: 0, missing: [], bytes: 0, planned: 0 }
	const records = (payload && payload.records) || []

	const manifest = { ...(payload || {}), records: records.map(rewriteForZip) }
	const manifestBytes = utf8Bytes(JSON.stringify(manifest))

	const entries = [{ name: MANIFEST_NAME, read: async () => manifestBytes }]
	s.bytes += manifestBytes.length

	const seen = new Set()
	for (const r of records) {
		if (!r || !r.photo) continue
		const b = basename(r.photo)
		if (!b || seen.has(b)) continue
		seen.add(b)
		s.planned++
		const src = r.photo
		entries.push({
			name: PHOTO_DIR + b,
			read: async () => {
				let data = null
				try {
					data = await readPhoto(src)
				} catch (e) {
					data = null
				}
				if (!data) {
					// 文件不在了：跳过，并记下来告诉用户，而不是塞个空文件
					s.missing.push(b)
					return null
				}
				s.photos++
				s.bytes += sizeOf(data)
				return data
			},
		})
	}
	return { entries, stats: s }
}

/**
 * 解析完整备份 zip，并把照片路径映射到目标平台。
 *
 * @param {Uint8Array} zipBytes
 * @param {(name:string) => string} targetPathOf  照片应该写到哪（平台相关）
 * @returns {{ok:boolean, payload?:object, photos?:Array, error?:string}}
 */
export function parseFullBackup(zipBytes, targetPathOf) {
	const z = readZip(zipBytes)
	if (!z.ok) return { ok: false, error: z.error }

	const manifestEntry = z.entries.find((e) => e.name === MANIFEST_NAME)
	if (!manifestEntry) {
		return { ok: false, error: '这不是本应用的完整备份（里面没有 backup.json）' }
	}

	let payload
	try {
		payload = JSON.parse(utf8Decode(manifestEntry.bytes))
	} catch (e) {
		return { ok: false, error: '备份里的记录数据解析失败' }
	}
	if (!payload || !Array.isArray(payload.records)) {
		return { ok: false, error: '备份格式不正确：缺少 records 数组' }
	}

	// zip 里实际带了的照片
	const have = new Map()
	for (const e of z.entries) {
		if (e.name.indexOf(PHOTO_DIR) !== 0) continue
		const b = e.name.slice(PHOTO_DIR.length)
		if (b && b.indexOf('/') < 0) have.set(b, e.bytes)
	}

	const photos = []
	const emitted = new Set()
	const records = payload.records.map((r) => {
		if (!r || !r.photo) return r
		const p = String(r.photo)
		const b = p.indexOf(PHOTO_DIR) === 0 ? p.slice(PHOTO_DIR.length) : basename(p)
		// 备份里没带这张照片（导出时文件就已经丢了）→ 清空路径。
		// 留着一个永远显示不出来的路径比没有更糟。
		if (!b || !have.has(b)) return { ...r, photo: '' }
		const target = targetPathOf(b)
		if (!emitted.has(b)) {
			emitted.add(b)
			photos.push({ name: b, bytes: have.get(b), path: target })
		}
		return { ...r, photo: target }
	})

	return { ok: true, payload: { ...payload, records }, photos }
}

/** 备份摘要（导入前给用户看，避免覆盖错文件） */
export function summarizeFullBackup(zipBytes) {
	const z = readZip(zipBytes)
	if (!z.ok) return { ok: false, error: z.error }
	const m = z.entries.find((e) => e.name === MANIFEST_NAME)
	if (!m) return { ok: false, error: '这不是本应用的完整备份' }
	let payload = null
	try {
		payload = JSON.parse(utf8Decode(m.bytes))
	} catch (e) {
		return { ok: false, error: '备份里的记录数据解析失败' }
	}
	const photos = z.entries.filter((e) => e.name.indexOf(PHOTO_DIR) === 0).length
	return {
		ok: true,
		records: (payload.records || []).length,
		photos,
		exportedAt: payload.exportedAt || 0,
	}
}

export const _internal = { utf8Bytes, utf8Decode }
