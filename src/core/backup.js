/**
 * 备份文件的落盘 / 复制 / 本地快照（平台差异都收敛在这里）
 *
 * 用运行时特性探测而非条件编译，好处是本模块在 Node 里也能安全 import。
 */
import { todayKey } from './date.js'
import { hasStorage, readRaw, writeRaw, removeRaw } from './storage.js'
import { base64ToBytes } from './zip.js'
import { _internal as fbutf8 } from './fullbackup.js'
import {
	absOf,
	copyFile,
	fileSize,
	findBackups,
	hasPlusIo,
	listDir,
	mkdir,
	readBase64,
	remove,
	resolveOutDir,
	writeText,
	zipCompress,
	zipDecompress,
} from './plusio.js'

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

/**
 * 导出完整备份（App 端）。
 *
 * 重做原因：真机自检证明 **Native.js 的写入全部失败**（writeBytes、
 * writeString、Files.copy、MediaStore 输出流都是「不报错但 0 字节」），
 * 唯一能真正写进去的是 plus.io 的 FileWriter.write(String)。
 *
 * 所以整条链只用 plus.io + plus.zip，**JS 生成的字节一次都不过桥**：
 *   1. 建临时目录，把 backup.json（文本）用 plus.io 写进去
 *   2. 照片用 entry.copyTo 原生拷进同一目录（字节不过 JS）
 *   3. plus.zip.compress 打成一个 zip（纯原生）
 *   4. 输出目录优先挑「用户在文件管理器里看得到」的那个
 *
 * @param {object} plan  { jsonText, photos:[{from, name}] }  由调用方准备
 */
export async function exportFullBackupNative(plan, filename) {
	const outDir = resolveOutDir()
	const work = '_doc/ccexport'
	const zipLocal = `${outDir.url}/${filename}`

	// 1. 清掉上次的临时目录，建新的
	await remove(work)
	const made = await mkdir(work)
	if (!made.ok) return { ok: false, error: made.error }

	// 2. 写 backup.json（文本，plus.io 能写）
	const wrote = await writeText(`${work}/backup.json`, plan.jsonText)
	if (!wrote.ok) {
		await remove(work)
		return { ok: false, error: '写 backup.json 失败：' + wrote.error }
	}
	// 比字节数：plus.io 按 UTF-8 写，中文一个字符占 3 字节，
	// 拿字符数去比会误判（记录里有中文菜名，必然不等）
	const expectBytes = fbutf8.utf8Bytes(plan.jsonText).length
	const sizeCheck = await fileSize(`${work}/backup.json`)
	if (sizeCheck !== expectBytes) {
		await remove(work)
		return { ok: false, error: `backup.json 写进去 ${sizeCheck} 字节，期望 ${expectBytes}` }
	}

	// 3. 拷照片（plus.io 原生拷贝）
	const photoDir = `${work}/photos`
	if (plan.photos.length) {
		const pd = await mkdir(photoDir)
		if (!pd.ok) {
			await remove(work)
			return { ok: false, error: '建照片目录失败：' + pd.error }
		}
	}
	let copied = 0
	const missed = []
	for (const ph of plan.photos) {
		const c = await copyFile(ph.from, `${photoDir}/${ph.name}`)
		if (c.ok) copied++
		else missed.push(ph.name)
	}

	// 4. 打包（plus.zip 原生压缩）
	const zipped = await zipCompress(work, zipLocal)
	if (!zipped.ok) {
		await remove(work)
		return { ok: false, error: zipped.error }
	}
	const zipSize = await fileSize(zipLocal)
	await remove(work)

	if (!(zipSize > 0)) {
		return { ok: false, error: `生成的 zip 大小异常（${zipSize} 字节）` }
	}

	return {
		ok: true,
		where: zipLocal,
		absPath: absOf(zipLocal),
		userVisible: outDir.visible,
		bytes: zipSize,
		photos: copied,
		missing: missed,
		dirLabel: outDir.label,
	}
}

/**
 * 列出可供恢复的备份文件（扫描下载 / 文档 / 私有目录）。
 * 不走系统文件选择器：SAF 选来的 content:// 在真机上读不出来
 * （plus.io 读不了 content://，Native.js 读取也失败）。
 */
export async function listBackupFiles() {
	const list = await findBackups('calorie-backup')
	// 附带大小，方便用户辨认
	const out = []
	for (const f of list) {
		const size = await fileSize(f.url)
		out.push({ ...f, size })
	}
	return out.sort((a, b) => String(b.name).localeCompare(String(a.name)))
}

/**
 * 从指定的备份文件恢复：原生解压 → 读 backup.json → 把照片拷回私有目录。
 * @returns {Promise<{ok:boolean, payload?:object, photos?:number, error?:string}>}
 */
export async function loadBackupFromFile(fileUrl) {
	const work = '_doc/ccrestore'
	await remove(work)
	const made = await mkdir(work)
	if (!made.ok) return { ok: false, error: made.error }

	const un = await zipDecompress(fileUrl, work)
	if (!un.ok) {
		await remove(work)
		return { ok: false, error: un.error }
	}

	// backup.json 可能在根，也可能在压缩时带了一层目录里
	let jsonUrl = `${work}/backup.json`
	let text = await readBase64Text(jsonUrl)
	if (!text.ok) {
		const sub = await listDir(work)
		const dir = sub.ok ? sub.names.find((x) => !x.isFile) : null
		if (dir) {
			jsonUrl = `${dir.url}/backup.json`
			text = await readBase64Text(jsonUrl)
		}
	}
	if (!text.ok) {
		await remove(work)
		return { ok: false, error: '备份里找不到 backup.json（' + text.error + '）' }
	}

	let payload = null
	try {
		payload = JSON.parse(text.text)
	} catch (e) {
		await remove(work)
		return { ok: false, error: 'backup.json 解析失败' }
	}
	if (!payload || !Array.isArray(payload.records)) {
		await remove(work)
		return { ok: false, error: '备份格式不正确：缺少 records' }
	}

	// 照片：从解压目录拷回 _doc/food/，并把记录里的路径改成新位置
	const base = jsonUrl.slice(0, jsonUrl.lastIndexOf('/'))
	const photoDir = `${base}/photos`
	const dirList = await listDir(photoDir)
	const names = dirList.ok ? dirList.names.filter((x) => x.isFile).map((x) => x.name) : []
	const have = new Set(names)

	let photos = 0
	const records = payload.records.map((r) => {
		if (!r || !r.photo) return r
		const p = String(r.photo)
		const n = p.indexOf('photos/') === 0 ? p.slice(7) : p.slice(p.lastIndexOf('/') + 1)
		if (!n || !have.has(n)) {
			// 备份里没带这张 → 清空，别留死链
			return { ...r, photo: '' }
		}
		return { ...r, photo: `_doc/food/${n}` }
	})

	// 真正拷照片（异步逐个来）
	for (const n of names) {
		const c = await copyFile(`${photoDir}/${n}`, `_doc/food/${n}`)
		if (c.ok) photos++
	}

	await remove(work)
	return { ok: true, payload: { ...payload, records }, photos, total: names.length }
}

/** 读取一个文本文件（走 plus.io 读 base64 再解码成 UTF-8 文本） */
async function readBase64Text(localUrl) {
	const r = await readBase64(localUrl)
	if (!r.ok) return { ok: false, error: r.error }
	return { ok: true, text: fbutf8.utf8Decode(base64ToBytes(r.base64)) }
}


/** 把完整备份交给用户：H5 浏览器下载二进制 zip / App 走原生链路 */
export async function persistBackupZip(bytes, filename, plan) {
	const isH5 = typeof document !== 'undefined' && typeof Blob !== 'undefined'
	if (hasPlusIo() && plan) return exportFullBackupNative(plan, filename)
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
}/** H5：用 <input type=file> 选一个 zip 并读成字节 */
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
 * H5 端选一个备份文件（浏览器 input）并读成二进制 zip。
 *
 * App 端不走这里 —— 真机上 SAF 选来的 content:// 读不出来
 * （plus.io 读不了 content://，Native.js 读取也失效），
 * 所以 App 改成扫描「下载 / 文档」目录，见 listBackupFiles。
 */
export async function pickZipFile() {
	if (typeof document === 'undefined') {
		return { ok: false, unsupported: true, error: 'App 端请用「从文件恢复」扫描目录' }
	}
	return pickZipOnH5()
}
