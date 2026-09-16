/**
 * 备份文件的落盘 / 复制 / 本地快照（平台差异都收敛在这里）
 *
 * 用运行时特性探测而非条件编译，好处是本模块在 Node 里也能安全 import。
 */
import { todayKey } from './date.js'
import { hasStorage, readRaw, writeRaw, removeRaw } from './storage.js'
import { toBase64 } from './photo.js'
import { base64ToBytes } from './zip.js'
import {
	writePrivateFile,
	removePrivateFile,
	copyPrivateToDownloads,
	pickFileBytes,
} from './native-fs.js'

export function backupFileName() {
	return `calorie-backup-${todayKey()}.json`
}

/* ---------------- 本地快照 ---------------- */

const K_SNAP_INDEX = 'cc_backup_index'
const snapKey = (ts) => `cc_backup_${ts}`

/** 最多保留几份快照 */
export const SNAPSHOT_KEEP = 3
/**
 * 单份快照的体积上限。
 * 快照和记录共用同一份本地存储，存太大了会把存储塞满（存储写失败
 * 比丢快照严重得多），宁可不存。按真实结构一天 4 条约 1.2KB 估算，
 * 1MB 能装下好几年。
 */
export const SNAPSHOT_MAX_BYTES = 1024 * 1024

/**
 * 存一份本地快照（同一天只留最新一份，超出保留数就滚动删最旧的）。
 *
 * 为什么需要：清空记录、覆盖导入都是不可逆的。快照存在本地存储里，
 * 不依赖任何文件系统，所以 App / H5 都能用。
 *
 * @param {object} payload 与导出备份同格式的对象
 * @param {{force?:boolean}} [opts] force = 忽略「今天已存过」直接再存一份
 */
export function saveSnapshot(payload, opts = {}) {
	if (!hasStorage()) return { ok: false, error: '当前环境不支持本地快照' }

	let json
	try {
		json = JSON.stringify(payload)
	} catch (e) {
		return { ok: false, error: '备份序列化失败' }
	}
	if (json.length > SNAPSHOT_MAX_BYTES) {
		return { ok: false, error: '数据太大，已跳过快照', bytes: json.length }
	}

	const index = readRaw(K_SNAP_INDEX, [])
	const list = Array.isArray(index) ? index.slice() : []
	const recCount = Array.isArray(payload && payload.records) ? payload.records.length : 0

	// 时间戳必须严格递增：同一毫秒内连存两次（比如刚清空又覆盖导入）
	// 会撞到同一个 storage key，后一份把前一份覆盖掉。
	// opts.now 是给测试用的时间注入点。
	const newest = list.reduce((max, it) => Math.max(max, Number(it.ts) || 0), 0)
	const ts = Math.max(Number(opts.now) || Date.now(), newest + 1)
	const day = todayKey(ts)

	// 今天已经存过且没要求强制 → 不重复存（避免每次启动都写一遍）
	if (!opts.force && list.some((it) => it.day === day)) {
		return { ok: true, skipped: true, ts, day }
	}

	// 存储写失败（通常是满了）比丢快照严重得多，所以失败要报出来
	if (!writeRaw(snapKey(ts), json)) {
		return { ok: false, error: '写入快照失败（本地存储可能已满）' }
	}

	// 同一天的旧快照清掉，只留最新那份
	for (const it of list) {
		if (it.day === day) removeRaw(snapKey(it.ts))
	}
	// index 里带上条数，界面上直接显示，不用把每份快照都读出来
	const next = [{ ts, day, bytes: json.length, records: recCount }]
		.concat(list.filter((it) => it.day !== day))
		.sort((a, b) => b.ts - a.ts)

	const dropped = next.splice(SNAPSHOT_KEEP)
	for (const it of dropped) removeRaw(snapKey(it.ts))

	writeRaw(K_SNAP_INDEX, next)
	return { ok: true, ts, day, bytes: json.length, records: recCount, rotated: dropped.length }
}

/** 快照清单（新的在前） */
export function listSnapshots() {
	const index = readRaw(K_SNAP_INDEX, [])
	if (!Array.isArray(index)) return []
	return index.slice().sort((a, b) => b.ts - a.ts)
}

/** 读一份快照的内容（解析后的对象），读不到返回 null */
export function readSnapshot(ts) {
	const json = readRaw(snapKey(ts), '')
	if (!json || typeof json !== 'string') return null
	try {
		return JSON.parse(json)
	} catch (e) {
		return null
	}
}

/** 最近一份快照（没有则 null） */
export function latestSnapshot() {
	const list = listSnapshots()
	if (!list.length) return null
	const payload = readSnapshot(list[0].ts)
	return payload ? { ...list[0], payload } : null
}

/** 清空全部快照 */
export function clearSnapshots() {
	for (const it of listSnapshots()) removeRaw(snapKey(it.ts))
	return writeRaw(K_SNAP_INDEX, [])
}

/* ---------------- 剪贴板 ---------------- */

/** 复制到剪贴板（各端通用兜底） */
export function copyText(text) {
	return new Promise((resolve) => {
		if (typeof uni === 'undefined' || typeof uni.setClipboardData !== 'function') {
			resolve({ ok: false })
			return
		}
		uni.setClipboardData({
			data: text,
			success: () => resolve({ ok: true }),
			fail: () => resolve({ ok: false }),
		})
	})
}

/**
 * 用系统分享面板把备份当文本发出去（微信 / 邮件 / 备忘录）。
 *
 * 只能发文本：HTML5+ 的 sendWithSystem 只支持 text / image，
 * 发不了 .json 文件。所以这条路只适合数据量小的时候。
 * 好处是它不需要在 manifest 里勾 Share 模块（那是 uni.share 三方 SDK 才要的）。
 */
export function shareText(text) {
	return new Promise((resolve) => {
		if (typeof uni === 'undefined' || typeof uni.shareWithSystem !== 'function') {
			resolve({ ok: false, unsupported: true, error: '当前环境不支持系统分享' })
			return
		}
		try {
			uni.shareWithSystem({
				type: 'text',
				summary: text,
				success: () => resolve({ ok: true }),
				fail: (e) => resolve({ ok: false, error: (e && e.errMsg) || '分享失败' }),
			})
		} catch (e) {
			resolve({ ok: false, error: '分享调用异常' })
		}
	})
}

/** 读剪贴板（导入时省掉手动长按粘贴） */
export function readClipboard() {
	return new Promise((resolve) => {
		if (typeof uni === 'undefined' || typeof uni.getClipboardData !== 'function') {
			resolve({ ok: false, error: '当前环境不支持读取剪贴板' })
			return
		}
		uni.getClipboardData({
			success: (res) => resolve({ ok: true, text: (res && res.data) || '' }),
			fail: () => resolve({ ok: false, error: '读取剪贴板失败' }),
		})
	})
}

/**
 * 把备份写入设备文件。
 * App 端写进应用私有目录（_doc），H5 触发浏览器下载。
 * @returns Promise<{ok:boolean, path?:string, mode?:string, error?:string}>
 */
export function writeBackupFile(json, filename = backupFileName()) {
	return new Promise((resolve) => {
		// App 端
		if (typeof plus !== 'undefined' && plus && plus.io && plus.io.requestFileSystem) {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					fs.root.getFile(
						filename,
						{ create: true },
						(entry) => {
							entry.createWriter(
								(writer) => {
									writer.onwrite = () =>
										resolve({ ok: true, path: entry.fullPath, mode: 'file' })
									writer.onerror = () => resolve({ ok: false, error: '写入失败' })
									writer.write(json)
								},
								() => resolve({ ok: false, error: '无法创建写入器' })
							)
						},
						() => resolve({ ok: false, error: '无法创建文件' })
					)
				},
				() => resolve({ ok: false, error: '无法访问应用目录' })
			)
			return
		}

		// H5：浏览器下载
		if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
			try {
				const blob = new Blob([json], { type: 'application/json' })
				const url = URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = filename
				a.click()
				setTimeout(() => URL.revokeObjectURL(url), 1000)
				resolve({ ok: true, mode: 'download' })
			} catch (e) {
				resolve({ ok: false, error: '浏览器下载失败' })
			}
			return
		}

		resolve({ ok: false, error: 'unavailable' })
	})
}

/** 复制到剪贴板（各端通用兜底） - 已上移到剪贴板一节 */

/* ---------------- 完整备份（含照片）的落盘与选取 ---------------- */

/**
 * 完整备份的内存上限。
 * 备份会先在内存里组装成 Uint8Array（几百 MB 会把手机搞崩），
 * 所以超过就明确拒绝，让用户先清理照片。
 */
export const FULL_BACKUP_MAX_BYTES = 120 * 1024 * 1024

/** 把完整备份交给用户：H5 浏览器下载 / App 落私有目录再进公共下载目录 */
export async function persistBackupZip(bytes, filename) {
	const isH5 = typeof document !== 'undefined' && typeof Blob !== 'undefined'
	const app = typeof plus !== 'undefined' && !!plus && plus.io && plus.io.requestFileSystem

	// App：plus.io 写私有目录 → 原生 FileUtils.copy 进公共「下载」
	if (app) {
		const wrote = await writePrivateFile(bytes, filename)
		if (!wrote.ok) {
			return { ok: false, error: wrote.error || '写入临时文件失败', trace: '' }
		}
		const copied = await copyPrivateToDownloads(wrote.path, filename)
		// 临时文件不管成不成功都删掉，别在私有目录里留一份几百 MB 的副本
		removePrivateFile(wrote.path)
		if (copied.ok) return { ok: true, mode: 'downloads', where: copied.where }
		return {
			ok: false,
			mode: 'private',
			error: copied.error,
			trace: copied.trace,
		}
	}

	// H5：浏览器下载
	if (isH5) {
		try {
			const blob = new Blob([bytes], { type: 'application/zip' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = filename
			a.click()
			setTimeout(() => URL.revokeObjectURL(url), 1000)
			return { ok: true, mode: 'download' }
		} catch (e) {
			return { ok: false, error: '浏览器下载失败' }
		}
	}

	return { ok: false, error: '当前环境不支持保存文件' }
}

/** H5：用 <input type=file> 选一个 zip 并读成字节 */
function pickZipOnH5() {
	return new Promise((resolve) => {
		try {
			const input = document.createElement('input')
			input.type = 'file'
			input.accept = '.zip,application/zip'
			input.style.display = 'none'
			input.onchange = () => {
				const file = input.files && input.files[0]
				if (!file) {
					resolve({ ok: false, cancelled: true, error: '' })
					return
				}
				if (file.size > FULL_BACKUP_MAX_BYTES) {
					resolve({ ok: false, error: '这个备份文件太大了，当前版本不支持' })
					return
				}
				const reader = new FileReader()
				reader.onload = () => {
					resolve({ ok: true, bytes: new Uint8Array(reader.result) })
				}
				reader.onerror = () => resolve({ ok: false, error: '读取文件失败' })
				reader.readAsArrayBuffer(file)
			}
			document.body.appendChild(input)
			input.click()
			setTimeout(() => {
				if (input.parentNode) input.parentNode.removeChild(input)
			}, 60000)
		} catch (e) {
			resolve({ ok: false, error: '无法打开文件选择器' })
		}
	})
}

/**
 * 让用户选一个完整备份文件并读成字节。
 * H5 走 <input type=file>；App 走 SAF，先落私有临时文件再用 plus.io 读。
 */
export async function pickZipFile() {
	const isH5 = typeof document !== 'undefined'

	if (isH5) return pickZipOnH5()

	const picked = await pickFileBytes()
	if (!picked.ok) return picked

	// 先看大小，太大就别读了（读进来会 base64 膨胀 33%）
	const size = await privateFileSize(picked.path)
	if (size > FULL_BACKUP_MAX_BYTES) {
		removePrivateFile(picked.path)
		return { ok: false, error: '这个备份文件太大了，当前版本不支持' }
	}

	const b64 = await toBase64(picked.path, null)
	removePrivateFile(picked.path)
	if (!b64.ok) {
		return { ok: false, error: '读取所选文件失败', trace: picked.trace }
	}
	return { ok: true, bytes: base64ToBytes(b64.base64), trace: picked.trace }
}

/** 读私有文件的大小（读不到返回 0，交给后面的读取去报错） */
function privateFileSize(path) {
	return new Promise((resolve) => {
		if (typeof plus === 'undefined' || !plus || !plus.io || !plus.io.resolveLocalFileSystemURL) {
			resolve(0)
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				path,
				(entry) => {
					entry.file(
						(f) => resolve(Number(f && f.size) || 0),
						() => resolve(0)
					)
				},
				() => resolve(0)
			)
		} catch (e) {
			resolve(0)
		}
	})
}

/** 把照片字节写进 App 私有目录（恢复备份时用）
 *  —— 实现挪到 native-fs.js，二进制写入逻辑集中在一处
 */
export { writePhotoFile } from './native-fs.js'
