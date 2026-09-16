/**
 * 完整备份的读写编排（记录 + 照片）
 *
 * 分层：
 *   fullbackup.js    —— 打包/解包与路径改写（纯逻辑）
 *   plusio.js        —— plus.io / plus.zip 原语
 *   fullbackup-io.js —— 本文件：把上面两层接起来，并处理平台差异
 *
 * 之所以单独一层：backup.js 被 db.js 依赖（快照），而这里要用到 db.js
 * 的 exportAll/importAll，放在 backup.js 里就成循环依赖了。
 */
import { exportAll, importAll } from './db.js'
import {
	packPayload,
	sizeOfPayload,
	summarizePayload as sumPayload,
	unpackPayload,
} from './fullbackup.js'
import { PHOTO_DIR, photoDataUrl, readPhotoBase64, writePhotoBase64 } from './photo.js'
import { hasPlusIo } from './plusio.js'
import { FULL_BACKUP_MAX_BYTES, backupFileName } from './backup.js'

export { parseFullBackupText, summarizePayload } from './fullbackup.js'

/** 备份文件名：带 full 后缀，和纯记录的备份区分开 */
export function fullBackupFileName() {
	return backupFileName().replace(/\.json$/, '-full.json')
}

export function humanSize(bytes) {
	const n = Number(bytes) || 0
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
	return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 读一张照片的 base64。
 * data:/blob: 形式的直接取（H5 的照片是临时 URL），
 * 其余走磁盘上的 .b64 文本文件。
 */
async function readPhoto(path, name) {
	const p = String(path || '')
	if (/^data:/i.test(p)) {
		const comma = p.indexOf(',')
		return comma >= 0 ? p.slice(comma + 1) : null
	}
	if (/^blob:/i.test(p)) {
		const r = await blobToBase64(p)
		return r
	}
	const r = await readPhotoBase64(p)
	return r.ok ? r.base64 : null
}

function blobToBase64(url) {
	return new Promise((resolve) => {
		if (typeof fetch !== 'function' || typeof FileReader === 'undefined') {
			resolve(null)
			return
		}
		fetch(url)
			.then((res) => res.blob())
			.then((blob) => {
				const fr = new FileReader()
				fr.onload = () => {
					const s = String(fr.result || '')
					const comma = s.indexOf(',')
					resolve(comma >= 0 ? s.slice(comma + 1) : null)
				}
				fr.onerror = () => resolve(null)
				fr.readAsDataURL(blob)
			})
			.catch(() => resolve(null))
	})
}

/**
 * 组装完整备份文本（一个普通 JSON 文件）。
 *
 * 会把总量卡在上限内：几十 MB 的字符串直接塞给桥会失败，
 * 所以宁可明确拒绝并告诉用户去清理照片，也不要写出一份坏文件。
 *
 * @returns {Promise<{ok:boolean, text?:string, bytes?:number, stats?:object, error?:string}>}
 */
export async function buildFullBackupJson(opts = {}) {
	const limit = Number(opts.limit) || FULL_BACKUP_MAX_BYTES
	const exported = exportAll()
	const { payload, stats } = await packPayload(exported, readPhoto, { now: opts.now })

	const bytes = sizeOfPayload(payload)
	if (bytes > limit) {
		return {
			ok: false,
			error: `备份约 ${humanSize(bytes)}，超过 ${humanSize(limit)}（照片太多）。请先删掉一些带照片的记录再导出。`,
			stats,
		}
	}

	const text = JSON.stringify(payload)
	return { ok: true, text, bytes, stats }
}

/**
 * 从备份 payload 恢复：先落照片，再覆盖导入记录。
 *
 * 顺序很重要：照片先写成功，记录里的路径才有意义。
 * 写失败的照片对应记录的 photo 会保持为空（见 unpackPayload），
 * 所以不会留下显示不出来的死链。
 *
 * @returns {Promise<{ok:boolean, records?:number, photos?:number, missing?:string[], summary?:object, error?:string}>}
 */
export async function applyRestoredBackup(payload) {
	const canStore = hasPlusIo()
	// App：照片写真成 .b64 文本文件，记录指向它
	// H5：没有长期文件系统，照片只能以 data URL 留在记录里（本次会话可见）
	const un = unpackPayload(payload, (n) => (canStore ? `${PHOTO_DIR}/${n}` : ''))
	if (!un.ok) return { ok: false, error: un.error }

	let written = 0
	const failed = []
	if (canStore) {
		for (const ph of un.photos) {
			const w = await writePhotoBase64(ph.name, ph.base64)
			if (w.ok) written++
			else failed.push(ph.name)
		}
		// 写失败的照片：把相关记录的 photo 清掉，别留死链
		if (failed.length) {
			const bad = new Set(failed.map((n) => `${PHOTO_DIR}/${n}`))
			un.records = un.records.map((r) =>
				r && bad.has(r.photo) ? { ...r, photo: '' } : r
			)
		}
	} else {
		// H5：没有长期文件系统，照片只能以 data URL 留在记录里（本次会话可见）
		const byName = new Map(un.photos.map((p) => [p.name, p.base64]))
		const rows = payload.records || []
		un.records = un.records.map((r, i) => {
			const orig = rows[i]
			if (!r || !orig || !orig.photo) return r
			const b64 = byName.get(orig.photo)
			return b64 ? { ...r, photo: `data:image/jpeg;base64,${b64}` } : r
		})
	}

	const res = importAll({ ...payload, records: un.records }, 'replace')
	if (!res.ok) return { ok: false, error: res.error || '导入失败' }

	return {
		ok: true,
		records: res.total,
		photos: canStore ? written : un.photos.length,
		missing: un.missing,
		failed,
		summary: sumPayload(payload),
	}
}

/** 读回照片做预览（data URL） */
export async function photoUrlOfPhoto(path) {
	return photoDataUrl(path)
}
