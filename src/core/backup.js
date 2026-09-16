/**
 * 备份文件的落盘 / 复制 / 本地快照（平台差异都收敛在这里）
 *
 * 用运行时特性探测而非条件编译，好处是本模块在 Node 里也能安全 import。
 */
import { todayKey } from './date.js'
import { hasStorage, readRaw, writeRaw, removeRaw } from './storage.js'
import { base64ToBytes } from './base64.js'
import { utf8Bytes, utf8Decode } from './utf8.js'
import {
	_resetOutDirs,
	absOf,
	fileSize,
	fileSizeAt,
	findBackups,
	findBackupsAt,
	exportTargets,
	hasPlusIo,
	publicDirCandidates,
	readText,
	writeTextAt,
	writeTextAtChecked,
	writeTextChecked,
} from './plusio.js'

export { _resetOutDirs }
import { parseFullBackupText } from './fullbackup.js'

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

/**
 * 分享一个本地文件（把备份发到微信 / 网盘 / 邮件）。
 *
 * 为什么需要它：`_downloads` 在这台设备上是**应用私有**的
 * （/storage/emulated/0/Android/data/<包名>/downloads），
 * Android 11+ 的文件管理器根本看不到它 —— 也就是说
 * 「导出成功」之后，用户其实**拿不到这个文件**。
 * 系统分享面板是唯一能把它送出去的通道。
 *
 * @returns {Promise<{ok:boolean, unsupported?:boolean, error?:string}>}
 */
export function shareFile(absPath, filename) {
	return new Promise((resolve) => {
		if (typeof uni === 'undefined' || typeof uni.shareWithSystem !== 'function') {
			resolve({ ok: false, unsupported: true, error: '当前环境不支持系统分享' })
			return
		}
		try {
			uni.shareWithSystem({
				type: 'file',
				summary: filename || '卡路里记录备份',
				href: absPath,
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
/**
 * 把完整备份文本写到用户能找到的地方。
 *
 * App：plus.io 写文本（自检证明这台设备上唯一真的能写进去的路径），
 *      逐个候选目录试，写完核对字节数。
 * H5：浏览器下载一个 .json。
 *
 * @returns {Promise<{ok:boolean, where?:string, absPath?:string, userVisible?:boolean,
 *                    bytes?:number, dirLabel?:string, error?:string}>}
 */
export async function exportFullBackupText(text, filename = backupFileName()) {
	const body = String(text || '')
	if (!body) return { ok: false, error: '没有可导出的内容' }

	// H5：直接下载
	if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
		try {
			const blob = new Blob([body], { type: 'application/json' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = filename
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)
			setTimeout(() => URL.revokeObjectURL(url), 4000)
			return { ok: true, where: filename, bytes: body.length, userVisible: true, dirLabel: '浏览器下载' }
		} catch (e) {
			return { ok: false, error: '浏览器下载失败：' + String((e && e.message) || e) }
		}
	}

	if (!hasPlusIo()) return { ok: false, error: '当前环境不支持导出文件' }

	const dirs = await exportTargets()
	const tried = []
	for (const d of dirs) {
		const triedOne = d.public
			? await writeTextAtChecked(d.abs, filename, body)
			: await writeTextChecked(`${d.url}/${filename}`, body)
		if (!triedOne.ok) {
			tried.push(`${d.label}：${triedOne.error}`)
			continue
		}
		return {
			ok: true,
			where: triedOne.abs || `${d.url}/${filename}`,
			absPath: triedOne.abs || absOf(`${d.url}/${filename}`),
			userVisible: !!d.visible,
			bytes: triedOne.bytes,
			dirLabel: d.label,
		}
	}
	return { ok: false, error: '每个目录都写不进去：' + tried.join('；') }
}

/**
 * 扫描候选目录里已有的完整备份文件（新的在前）。
 * 导入时列给用户选 —— 不用系统文件选择器：真机上 SAF 选来的
 * content:// 路径读不出来。
 */
export async function listBackupFiles() {
	if (!hasPlusIo()) return { ok: true, files: [] }
	const out = []
	const seen = new Set()
	for (const d of await exportTargets()) {
		const found = await findBackups(d.url, 'calorie-backup')
		for (const f of found) {
			if (seen.has(f.name)) continue
			seen.add(f.name)
			const size = await fileSize(f.url)
			out.push({ ...f, size, dir: d.label, visible: d.visible })
		}
	}
	// 私有目录根也扫一遍（早期版本可能把备份放在那儿）
	const priv = await findBackups('_doc', 'calorie-backup')
	for (const f of priv) {
		if (seen.has(f.name)) continue
		seen.add(f.name)
		const size = await fileSize(f.url)
		out.push({ ...f, size, dir: '应用私有目录', visible: false })
	}
	// ★ 手机公共的下载/文档目录：从微信、网盘下载的备份，或者用数据线
	//   拷进手机的文件都在那儿（应用私有的 _downloads 里是没有的）。
	//   换手机时文件正是从这儿进来的。
	for (const d of await publicDirCandidates()) {
		for (const f of await findBackupsAt(d.abs, 'calorie-backup')) {
			if (seen.has(f.name)) continue
			seen.add(f.name)
			const size = await fileSizeAt(f.url)
			out.push({ ...f, size, dir: d.label, visible: true, public: true })
		}
	}
	out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
	return { ok: true, files: out }
}

/**
 * 读一个备份文件 → 解析成 payload。
 * 只读文本：自检证明 plus.io 读文本是通的，读二进制不是。
 */
export async function loadBackupFromFile(fileUrl) {
	const r = await readText(fileUrl)
	if (!r.ok) return { ok: false, error: '读取备份失败：' + r.error }
	const text = String(r.text || '').trim()
	if (!text) return { ok: false, error: '备份文件是空的（可能是 0 字节）' }
	const parsed = parseFullBackupText(text)
	if (!parsed.ok) return parsed
	return { ok: true, payload: parsed.payload, bytes: text.length }
}

/* ---------------- H5：从 <input type=file> 读 ---------------- */

/** H5 下让用户选一个备份文件并读出文本 */
export function pickBackupText() {
	return new Promise((resolve) => {
		if (typeof document === 'undefined') {
			resolve({ ok: false, error: '当前环境不支持文件选择' })
			return
		}
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = '.json,application/json'
		input.style.position = 'fixed'
		input.style.left = '-9999px'
		document.body.appendChild(input)
		let done = false
		const finish = (v) => {
			if (done) return
			done = true
			try {
				document.body.removeChild(input)
			} catch (e) {
				/* 已经移除 */
			}
			resolve(v)
		}
		input.onchange = () => {
			const f = input.files && input.files[0]
			if (!f) {
				finish({ ok: false, cancelled: true, error: '' })
				return
			}
			const fr = new FileReader()
			fr.onload = () => finish({ ok: true, text: String(fr.result || ''), name: f.name })
			fr.onerror = () => finish({ ok: false, error: '读取所选文件失败' })
			fr.readAsText(f)
		}
		window.addEventListener(
			'focus',
			() => setTimeout(() => finish({ ok: false, cancelled: true, error: '' }), 800),
			{ once: true }
		)
		input.click()
	})
}
