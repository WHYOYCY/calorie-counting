/**
 * 只用 plus.io 的文件操作
 *
 * 真机自检证明：**这台设备上只有 plus.io 的文本写入是真的能写进去的**。
 * Native.js 的各类写入（RandomAccessFile.writeBytes、Files.writeString、
 * Files.copy、MediaStore 输出流）全是「不报错但 0 字节」；
 * plus.io 自己的 entry.copyTo 也会静默失败。
 *
 * 所以整条链路只用两个动作：
 *   写 → FileWriter.write(String)（分块，写完回查字节数）
 *   读 → FileReader.readAsText（读文本）/ readAsDataURL（读二进制）
 *
 * 照片存成 base64 文本、备份是一个 JSON 文本，都是为了只用这两个动作。
 * 每个写入都会核对大小 —— 「写完不知道成没成」是之前所有坑的根源。
 */

/** 输出目录候选，按「用户越容易看到」排序 */
const OUT_DIRS = [
	{ url: '_downloads', label: '下载' },
	{ url: '_documents', label: '文档' },
	{ url: '_doc', label: '应用私有目录' },
]

import { utf8Length } from './utf8.js'

export function hasPlusIo() {
	return (
		typeof plus !== 'undefined' &&
		!!plus &&
		!!plus.io &&
		typeof plus.io.requestFileSystem === 'function'
	)
}

/** plus.io 本地 URL → 平台绝对路径 */
export function absOf(localUrl) {
	if (!hasPlusIo() || typeof plus.io.convertLocalFileSystemURL !== 'function') return ''
	try {
		return plus.io.convertLocalFileSystemURL(localUrl) || ''
	} catch (e) {
		return ''
	}
}

/**
 * 这个绝对路径是不是「用户在文件管理器里能看到」的。
 * 应用私有目录形如 /storage/emulated/0/Android/data/<包名>/...
 * —— 安卓 11 起文件管理器进不去。
 */
export function isUserVisible(absPath) {
	const p = String(absPath || '')
	if (!p) return false
	return p.indexOf('Android/data') < 0 && p.indexOf('Android/obb') < 0
}

/**
 * 逐个探测候选输出目录，返回第一个「用户能看到」的。
 * 都不可见就退回私有目录，并标记出来让界面提示用户。
 * @returns {{url:string, abs:string, label:string, visible:boolean}}
 */
/**
 * 候选输出目录（用户可见的排前面）。每个都试着建出来，建不成的不算。
 * 只探测一次：探测本身要建目录，每次操作都来一遍没必要。
 */
let _outDirs = null
export async function outDirCandidates() {
	if (_outDirs) return _outDirs
	const out = []
	for (const d of OUT_DIRS) {
		const m = await mkdir(d.url)
		if (!m.ok) continue
		out.push({ ...d, visible: isUserVisible(absOf(d.url)) })
	}
	out.sort((a, b) => (a.visible === b.visible ? 0 : a.visible ? -1 : 1))
	_outDirs = out.length ? out : [{ url: '_doc', label: '应用私有目录', visible: false }]
	return _outDirs
}

/** 测试用：清掉目录缓存 */
export function _resetOutDirs() {
	_outDirs = null
}

/** 首选输出目录 */
export async function resolveOutDir() {
	const list = await outDirCandidates()
	return { ...list[0], abs: absOf(list[0].url) }
}

/** 取一个文件名（带目录的本地 URL → 末段） */
export function nameOf(localUrl) {
	const s = String(localUrl || '')
	const i = s.lastIndexOf('/')
	return i >= 0 ? s.slice(i + 1) : s
}

/** 拆出目录与文件名（用于 plus.io 的 getFile/getDirectory 相对路径） */
function splitUrl(localUrl) {
	const s = String(localUrl || '')
	const i = s.lastIndexOf('/')
	return { dir: i >= 0 ? s.slice(0, i) : '', name: i >= 0 ? s.slice(i + 1) : s }
}

/** 建目录（可多级，已存在不报错） */
export function mkdir(localUrl) {
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		const abs = absOf(localUrl)
		if (!abs) {
			resolve({ ok: false, error: '目录路径解析失败' })
			return
		}
		try {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					// 用绝对路径创建，这样 _downloads / _documents 也能建
					fs.root.getDirectory(
						abs,
						{ create: true, exclusive: false },
						() => resolve({ ok: true }),
						(e) => resolve({ ok: false, error: '建目录失败：' + ((e && e.message) || e) })
					)
				},
				() => resolve({ ok: false, error: '无法访问文件系统' })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}

/** 写一个文本文件（plus.io 是唯一验证过能真正写进去的路径） */
/** 单次 write 的最大字符数。过桥参数有长度限制（Native.js 约 4KB），
 *  plus.io 没有官方说明，所以不赌 —— 分块写，每块都回查。 */
export const WRITE_CHUNK = 64 * 1024

/**
 * 写文本文件（分块 + 回查大小）。
 *
 * 真机上唯一被验证过「真的写进去了」的路径就是 plus.io 的
 * FileWriter.write(String)。但一次写几十万字符是否可靠没有官方说法，
 * 所以切成小块顺序写，写完再核对字节数 —— 对不上就报失败，
 * 绝不返回「看起来成功」。
 */
export function writeText(localUrl, text, opts = {}) {
	const chunk = Number(opts.chunk) || WRITE_CHUNK
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		const abs = absOf(localUrl)
		if (!abs) {
			resolve({ ok: false, error: '文件路径解析失败：' + localUrl })
			return
		}
		const full = String(text)
		try {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					fs.root.getFile(
						abs,
						{ create: true, exclusive: false },
						(entry) => {
							entry.createWriter(
								(w) => {
									let at = 0
									let parts = 0
									const step = () => {
										if (at >= full.length) {
											resolve({ ok: true, abs, chars: full.length, parts })
											return
										}
										const piece = full.slice(at, at + chunk)
										at += piece.length
										parts++
										w.onwrite = step
										w.onerror = (e) =>
											resolve({
												ok: false,
												error: `写入第 ${parts} 段失败：` + ((e && e.message) || e),
												written: at - piece.length,
											})
										try {
											w.write(piece)
										} catch (e) {
											resolve({
												ok: false,
												error: 'write 异常：' + ((e && e.message) || e),
											})
										}
									}
									// 文件已存在时，先截断，否则新内容比旧内容短会留下尾巴
									try {
										if (typeof w.seek === 'function') w.seek(0)
										if (typeof w.truncate === 'function') w.truncate(0)
									} catch (e) {
										/* 不支持就算了，靠最终大小核对兜住 */
									}
									step()
								},
								(e) => resolve({ ok: false, error: '创建写入器失败：' + ((e && e.message) || e) })
							)
						},
						(e) => resolve({ ok: false, error: '创建文件失败：' + ((e && e.message) || e) })
					)
				},
				() => resolve({ ok: false, error: '无法访问文件系统' })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}

/**
 * 写文本并核对大小。base64 / JSON 都是纯 ASCII，字符数就是字节数。
 * @returns {Promise<{ok:boolean, abs?:string, bytes?:number, error?:string}>}
 */
export async function writeTextChecked(localUrl, text) {
	const full = String(text)
	const w = await writeText(localUrl, full)
	if (!w.ok) return w
	const want = utf8Length(full)
	const size = await fileSize(localUrl)
	if (size !== want) {
		return {
			ok: false,
			error: `写入大小不对：写进去 ${size} 字节，期望 ${want}。可能没写完整。`,
			abs: w.abs,
		}
	}
	return { ok: true, abs: w.abs, bytes: size }
}

/**
 * 读文本文件。
 *
 * ⚠️ 必须用 readAsText，不能用 readAsDataURL 再截逗号后面：
 *    .b64 照片文件的**内容**本身就是 base64 文本，
 *    用 readAsDataURL 读会把这段文本再 base64 一次（双重编码），
 *    照片就永远显示不出来。这个坑是测试逮出来的。
 */
export function readText(localUrl) {
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		const abs = absOf(localUrl)
		if (!abs) {
			resolve({ ok: false, error: '文件路径解析失败' })
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				abs,
				(entry) => {
					entry.file(
						(file) => {
							const reader = new plus.io.FileReader()
							reader.onloadend = (e) => {
								const s = (e && e.target && e.target.result) || ''
								resolve({ ok: true, text: String(s), size: file.size })
							}
							reader.onerror = () => resolve({ ok: false, error: 'FileReader 出错（文件可能太大）' })
							reader.readAsText(file)
						},
						() => resolve({ ok: false, error: 'entry.file 失败' })
					)
				},
				() => resolve({ ok: false, error: '文件不存在或解析不到' })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}
/** 读文件为 base64（plus.io FileReader → dataURL） */
export function readBase64(localUrl) {
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		const abs = absOf(localUrl)
		if (!abs) {
			resolve({ ok: false, error: '文件路径解析失败' })
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				abs,
				(entry) => {
					entry.file(
						(file) => {
							const reader = new plus.io.FileReader()
							reader.onloadend = (e) => {
								const s = String((e && e.target && e.target.result) || '')
								const comma = s.indexOf(',')
								if (comma < 0) {
									resolve({ ok: false, error: '读出来是空' })
									return
								}
								resolve({ ok: true, base64: s.slice(comma + 1), size: file.size })
							}
							reader.onerror = () => resolve({ ok: false, error: 'FileReader 出错' })
							reader.readAsDataURL(file)
						},
						() => resolve({ ok: false, error: 'entry.file 失败' })
					)
				},
				() => resolve({ ok: false, error: '文件不存在或解析不到' })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}

/** 文件大小（读不到返回 -1） */
export function fileSize(localUrl) {
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve(-1)
			return
		}
		const abs = absOf(localUrl)
		if (!abs) {
			resolve(-1)
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				abs,
				(entry) => entry.file((f) => resolve(Number(f && f.size) || 0), () => resolve(-1)),
				() => resolve(-1)
			)
		} catch (e) {
			resolve(-1)
		}
	})
}

/** 删文件/目录（失败静默） */
export function remove(localUrl) {
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve({ ok: false })
			return
		}
		const abs = absOf(localUrl)
		if (!abs) {
			resolve({ ok: false })
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				abs,
				(entry) => entry.remove(() => resolve({ ok: true }), () => resolve({ ok: false })),
				() => resolve({ ok: false })
			)
		} catch (e) {
			resolve({ ok: false })
		}
	})
}

/** 复制文件（plus.io 原生拷贝，字节不过 JS） */
export function listDir(localUrl) {
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve({ ok: false, error: 'plus.io 不可用', names: [] })
			return
		}
		const abs = absOf(localUrl)
		if (!abs) {
			resolve({ ok: false, error: '目录路径解析失败', names: [] })
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				abs,
				(entry) => {
					const reader = entry.createReader()
					reader.readEntries(
						(entries) => {
							const names = []
							for (let i = 0; i < entries.length; i++) {
								const e = entries[i]
								names.push({
									name: e.name,
									isFile: e.isFile,
									url: `${localUrl.replace(/\/$/, '')}/${e.name}`,
								})
							}
							resolve({ ok: true, names })
						},
						(e) => resolve({ ok: false, error: '读目录失败', names: [] })
					)
				},
				() => resolve({ ok: false, error: '目录不存在', names: [] })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e), names: [] })
		}
	})
}

/** zip 是否可用 */
/**
 * 列出某个目录里符合前缀的文件。
 * 早先这里写死了遍历 OUT_DIRS 而忽略传入的目录参数 —— 结果导入时
 * 永远找不到刚导出的备份。测试逮出来的。
 */
export async function findBackups(localUrl, prefix = 'calorie-backup') {
	const r = await listDir(localUrl)
	if (!r.ok) return []
	const out = []
	for (const f of r.names) {
		if (!f.isFile) continue
		if (f.name.indexOf(prefix) !== 0) continue
		out.push(f)
	}
	return out
}
