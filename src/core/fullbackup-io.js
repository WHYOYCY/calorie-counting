/**
 * 完整备份的读写编排（记录 + 照片）
 *
 * 分层：
 *   zip.js          —— zip 格式本身（纯逻辑）
 *   fullbackup.js   —— 打包/解包与路径改写（纯逻辑）
 *   native-fs.js    —— App 原生原语（MediaStore、SAF）
 *   fullbackup-io.js —— 本文件：把上面三层接起来，并处理平台差异
 *
 * 之所以单独一层：backup.js 被 db.js 依赖（快照），而这里要用到 db.js
 * 的 exportAll/importAll，放在 backup.js 里就成循环依赖了。
 */
import { exportAll, importAll } from './db.js'
import { fullBackupEntries, parseFullBackup, summarizeFullBackup } from './fullbackup.js'
import { zipChunks } from './zip.js'
import { toBase64 } from './photo.js'
import {
	FULL_BACKUP_MAX_BYTES,
	backupFileName,
	persistBackupZip,
	pickZipFile,
} from './backup.js'

/** 备份文件名：带 full 后缀，和纯记录的备份区分开 */
export function fullBackupFileName() {
	return backupFileName().replace(/\.json$/, '-full.zip')
}

export function humanSize(bytes) {
	const n = Number(bytes) || 0
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
	return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 读出 App 私有目录里一张照片的字节（base64）。
 * 走 photo.js 已有的分层降级，读不到就返回 null。
 */
async function readPhotoBytes(path) {
	const r = await toBase64(path, null)
	return r.ok ? r.base64 : null
}

/**
 * 组装完整备份并收成字节。
 *
 * 会把总量卡在上限内：几百 MB 的 Uint8Array 会直接把手机搞崩，
 * 所以宁可明确拒绝并告诉用户去清理照片，也不要走到崩溃。
 *
 * @returns {Promise<{ok:boolean, bytes?:Uint8Array, stats?:object, error?:string}>}
 */
export async function buildFullBackupZip(opts = {}) {
	const limit = Number(opts.limit) || FULL_BACKUP_MAX_BYTES
	const payload = exportAll()
	const { entries, stats } = fullBackupEntries(payload, readPhotoBytes)

	const chunks = []
	let total = 0
	try {
		for await (const c of zipChunks(entries, { onProgress: opts.onProgress })) {
			total += c.length
			if (total > limit) {
				return {
					ok: false,
					error: `备份超过 ${humanSize(limit)}（照片太多），请先在「数据」里清理一些照片`,
					stats,
				}
			}
			chunks.push(c)
		}
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e), stats }
	}

	const bytes = new Uint8Array(total)
	let at = 0
	for (const c of chunks) {
		bytes.set(c, at)
		at += c.length
	}
	return { ok: true, bytes, stats }
}

/**
 * 把完整备份交出去：H5 浏览器下载 / App 先落私有目录再进公共下载目录。
 * @returns {Promise<{ok:boolean, mode?:string, where?:string, error?:string, trace?:string}>}
 */
export async function deliverFullBackup(bytes, filename) {
	return persistBackupZip(bytes, filename)
}

/**
 * 让用户选一个完整备份文件并读进来。
 * @returns {Promise<{ok:boolean, bytes?:Uint8Array, error?:string, trace?:string}>}
 */
export async function loadFullBackupFromPicker() {
	return pickZipFile()
}

/**
 * 从字节恢复完整备份：先落照片文件，再覆盖导入记录。
 *
 * 注意顺序：照片必须先写成功，记录里的路径才有意义。
 * 写失败的照片，对应记录的 photo 会被清空（见 parseFullBackup），
 * 所以不会留下显示不出来的死链。
 *
 * @returns {Promise<{ok:boolean, records?:number, photos?:number, failed?:number, summary?:object, error?:string}>}
 */
export async function restoreFullBackup(zipBytes, opts = {}) {
	const summary = summarizeFullBackup(zipBytes)
	if (!summary.ok) return { ok: false, error: summary.error }

	// 目标路径：App 写进私有目录，H5 没有长期文件系统 → 照片无法持久化
	const targetPathOf = opts.targetPathOf || ((name) => `_doc/food/${name}`)
	const parsed = parseFullBackup(zipBytes, targetPathOf)
	if (!parsed.ok) return { ok: false, error: parsed.error }

	// 没写成功的照片，把记录里的路径清掉，避免留下显示不出来的死链
	const written = new Set()
	let failed = 0
	for (const p of parsed.photos) {
		let res = null
		try {
			res = await opts.writePhoto(p)
		} catch (e) {
			res = null
		}
		if (res && res.ok) written.add(p.path)
		else failed++
	}

	const records = parsed.payload.records.map((r) =>
		r && r.photo && !written.has(r.photo) ? { ...r, photo: '' } : r
	)

	const res = importAll({ ...parsed.payload, records }, 'replace')
	if (!res.ok) return { ok: false, error: res.error || '导入失败' }

	return {
		ok: true,
		records: res.total,
		photos: written.size,
		failed,
		summary,
	}
}
