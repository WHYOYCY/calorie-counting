/**
 * 只用 plus.io 的文件操作（应用所有落盘都走这里）
 *
 * 真机自检的结论，决定了这个模块长什么样：
 *
 *   能用的：plus.io 的 FileWriter.write(String)（写文本）、FileReader（读）、
 *           DirectoryEntry.getFile/getDirectory、DirectoryReader 列目录
 *   不能用的：Native.js 的一切写入（不报错但 0 字节）、
 *           plus.io 的 entry.copyTo（报「执行出错」）、
 *           写公共目录在部分 ROM 上会被拒（所以只当加分项）
 *
 * 两条硬规矩：
 *   1. 写入**必须**回查字节数（writeTextChecked），
 *      「写完不知道成没成」是之前所有坑的根源。
 *   2. plus.io 的动作都是**异步**的：上一个没回调就调下一个会抛异常。
 *      所以每个动作都等回调，truncate 不回调就超时兜底。
 */
import { utf8Decode, utf8Length } from './utf8.js'
import { base64ToBytes } from './base64.js'

/** 单次 write 的最大字符数。过桥参数有长度限制，所以不赌，切成小块顺序写 */
export const WRITE_CHUNK = 64 * 1024

/**
 * 把原生抛出来的东西变成人能看的文本。
 *
 * 教训：plus.io 抛的异常带的是 name/code 而不是 message，直接拼字符串
 * 得到的是 `[object Object]` —— 真机报告里只看到这个，等于白跑一轮。
 */
export function errText(e) {
	if (e === undefined || e === null) return '未知错误'
	if (typeof e === 'string') return e
	const parts = []
	for (const k of ['name', 'code', 'message', 'errMsg', 'description', 'type']) {
		const v = e[k]
		if (v !== undefined && v !== null && String(v) !== '') parts.push(`${k}=${v}`)
	}
	if (parts.length) return parts.join(' ')
	try {
		const j = JSON.stringify(e)
		if (j && j !== '{}') return j
	} catch (x) {
		/* 循环引用之类 */
	}
	return Object.prototype.toString.call(e)
}

export function hasPlusIo() {
	return (
		typeof plus !== 'undefined' &&
		!!plus &&
		!!plus.io &&
		typeof plus.io.requestFileSystem === 'function'
	)
}

/** 本地 URL（_doc/x）→ 原生绝对路径；已经是绝对路径就原样返回 */
export function absOf(localUrl) {
	const s = String(localUrl || '')
	if (!s) return ''
	if (typeof plus !== 'undefined' && plus && plus.io && plus.io.convertLocalFileSystemURL) {
		try {
			const abs = plus.io.convertLocalFileSystemURL(s)
			if (abs) return String(abs).replace(/\/$/, '')
		} catch (e) {
			/* 下面用兜底 */
		}
	}
	if (s.indexOf('/') === 0) return s.replace(/\/$/, '')
	return ''
}

/** 拆出目录与文件名 */
function splitUrl(localUrl) {
	const s = String(localUrl || '')
	const i = s.lastIndexOf('/')
	return { dir: i > 0 ? s.slice(0, i) : '', name: i >= 0 ? s.slice(i + 1) : s }
}

/** 取文件名 */
export function nameOf(localUrl) {
	return splitUrl(localUrl).name
}

/**
 * 这个绝对路径是不是「用户能在文件管理器里看到」的。
 * Android 11+ 上 Android/data 下的东西对外是不可见的。
 */
export function isUserVisible(absPath) {
	const p = String(absPath || '')
	if (!p) return false
	if (/\/Android\/(data|obb)\//i.test(p)) return false
	return /^\/(storage|sdcard|mnt\/sdcard)/i.test(p) || p.indexOf('/Android/media/') >= 0
}

/* ==================== 目录 ==================== */

/** 建目录（绝对路径，已存在不报错） */
export function mkdir(localUrl) {
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		const abs = absOf(localUrl)
		if (!abs) {
			resolve({ ok: false, error: '目录路径解析失败：' + localUrl })
			return
		}
		try {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					fs.root.getDirectory(
						abs,
						{ create: true, exclusive: false },
						() => resolve({ ok: true, abs }),
						(e) => resolve({ ok: false, error: '建目录失败：' + errText(e) })
					)
				},
				(e) => resolve({ ok: false, error: '无法访问文件系统：' + errText(e) })
			)
		} catch (e) {
			resolve({ ok: false, error: '异常：' + errText(e) })
		}
	})
}

/** 应用私有目录候选，用户可见的排前面 */
const OUT_DIRS = [
	{ url: '_downloads', label: '下载' },
	{ url: '_documents', label: '文档' },
	{ url: '_doc', label: '应用私有目录' },
]

let _outDirs = null
export async function outDirCandidates() {
	if (_outDirs) return _outDirs
	const out = []
	for (const d of OUT_DIRS) {
		const m = await mkdir(d.url)
		if (!m.ok) continue
		out.push({ ...d, abs: absOf(d.url), visible: isUserVisible(absOf(d.url)) })
	}
	out.sort((a, b) => (a.visible === b.visible ? 0 : a.visible ? -1 : 1))
	_outDirs = out.length ? out : [{ url: '_doc', abs: absOf('_doc'), label: '应用私有目录', visible: false }]
	return _outDirs
}

/**
 * 手机**公共**存储里的目录。
 *
 * 为什么单独列：`_downloads` 是**应用私有**的（真机上解析成
 * /storage/emulated/0/Android/data/<包名>/downloads），而从微信/网盘
 * 下载的备份、用数据线拷进手机的文件都在手机公共的 Download / Documents 里 ——
 * 换手机时文件正是从那里进来的。
 *
 * 怎么找：plus.io 只给私有目录提供了 `_xxx` 短路径，公共目录没有等价写法，
 * 而且不同 ROM 的绝对路径也不一样（/sdcard 与 /storage/emulated/0 都常见）。
 * 所以**不猜文档语义**：候选逐个去列目录，能列出来的才算数。
 */
const PUBLIC_CANDIDATES = [
	{ label: '手机下载目录', type: 'PUBLIC_DOWNLOADS', paths: ['/storage/emulated/0/Download', '/sdcard/Download'] },
	{ label: '手机文档目录', type: 'PUBLIC_DOCUMENTS', paths: ['/storage/emulated/0/Documents', '/sdcard/Documents'] },
]

let _publicDirs = null
export async function publicDirCandidates() {
	if (_publicDirs) return _publicDirs
	const out = []
	const seen = new Set()
	const push = async (label, abs) => {
		const p = String(abs || '').replace(/\/$/, '')
		if (!p || seen.has(p)) return
		// 同一个目录有多种写法（/sdcard 与 /storage/emulated/0 指向同一处），
		// 按标签去重，报告里才不会出现四行一样的目录
		if (out.some((x) => x.label === label)) return
		seen.add(p)
		const r = await listDirAt(p)
		if (!r.ok) return
		out.push({ url: p, abs: p, label, visible: true, public: true })
	}
	for (const c of PUBLIC_CANDIDATES) {
		const root = await publicRootPath(c.type)
		if (root) await push(c.label, root)
		for (const p of c.paths) await push(c.label, p)
	}
	_publicDirs = out
	return out
}

/** 取 PUBLIC_* 文件系统的根路径（拿不到就空字符串） */
function publicRootPath(type) {
	return new Promise((resolve) => {
		if (!hasPlusIo() || typeof plus.io.requestFileSystem !== 'function') {
			resolve('')
			return
		}
		const t = plus.io[type]
		if (t === undefined || t === null) {
			resolve('')
			return
		}
		try {
			plus.io.requestFileSystem(
				t,
				(fs) => {
					const root = fs && fs.root
					let p = (root && root.fullPath) || ''
					if (p && p.indexOf('/') !== 0) {
						try {
							p = plus.io.convertLocalFileSystemURL(p) || p
						} catch (e) {
							/* 用原值 */
						}
					}
					resolve(p || '')
				},
				() => resolve('')
			)
		} catch (e) {
			resolve('')
		}
	})
}

/**
 * 导出位置候选：**手机公共目录优先**。
 *
 * 应用私有的 `_downloads` 在 Android 11+ 上文件管理器看不到，用户导出完
 * 其实拿不到文件（只能靠分享）。公共 Download 目录是任何文件管理器都能看到的。
 * 逐个真写一个探针文件验证，写不进去的自动跳过。
 */
let _exportTargets = null
export async function exportTargets() {
	if (_exportTargets) return _exportTargets
	const out = []
	for (const d of await publicDirCandidates()) {
		if (await canWriteAt(d.abs)) out.push({ ...d, writable: true })
	}
	for (const d of await outDirCandidates()) out.push({ ...d, writable: true })
	_exportTargets = out
	return out
}

/** 首选输出目录 */
export async function resolveOutDir() {
	const list = await exportTargets()
	return list[0] || { url: '_doc', abs: absOf('_doc'), label: '应用私有目录', visible: false }
}

/** 测试用：清掉所有探测缓存 */
export function _resetOutDirs() {
	_outDirs = null
	_publicDirs = null
	_exportTargets = null
	_canWrite.clear()
}

/* ==================== 写 ==================== */

/**
 * 往一个 entry 上写文本：分块、顺序、异步安全。
 *
 * ⚠️ plus.io 的 FileWriter 是**异步**的：上一个动作（truncate/write）还没回调
 *    就再调 write 会直接抛异常。早先的代码是「truncate(0) 紧接 write()」，
 *    真机上整条写入路径全挂，报出来还只有 `[object Object]`。
 *    现在的规矩：每个动作都等回调，truncate 加超时兜底（宁可留尾巴，
 *    最后有大小核对兜住，也不能卡住）。
 */
function writeWith(getEntry, full, opts = {}) {
	const chunk = Number(opts.chunk) || WRITE_CHUNK
	return new Promise((resolve) => {
		const got = (entry) => {
			entry.createWriter(
				(w) => {
					let at = 0
					let parts = 0
					let begun = false
					const finish = () => resolve({ ok: true, chars: full.length, parts })
					const fail = (e, what) => resolve({ ok: false, error: `${what}：${errText(e)}`, written: at })
					const next = () => {
						if (at >= full.length) {
							finish()
							return
						}
						const piece = full.slice(at, at + chunk)
						at += piece.length
						parts++
						w.onwrite = next
						w.onerror = (e) => fail(e, `写入第 ${parts} 段失败`)
						try {
							w.write(piece)
						} catch (e) {
							fail(e, `写入第 ${parts} 段异常`)
						}
					}
					const begin = () => {
						if (begun) return
						begun = true
						next()
					}
					if (typeof w.truncate === 'function') {
						w.onwrite = begin
						w.onerror = begin
						try {
							w.truncate(0)
						} catch (e) {
							begin()
						}
						setTimeout(begin, 1500)
					} else {
						begin()
					}
				},
				(e) => resolve({ ok: false, error: '创建写入器失败：' + errText(e) })
			)
		}
		try {
			getEntry(got, (e) => resolve({ ok: false, error: '创建文件失败：' + errText(e) }))
		} catch (e) {
			resolve({ ok: false, error: '异常：' + errText(e) })
		}
	})
}

/**
 * 写文本到应用私有目录。
 * 两步（都是验证过能用的）：mkdir 建父目录 → getFile(绝对路径) → 分块写。
 */
export async function writeText(localUrl, text, opts = {}) {
	if (!hasPlusIo()) return { ok: false, error: 'plus.io 不可用' }
	const abs = absOf(localUrl)
	if (!abs) return { ok: false, error: '文件路径解析失败：' + localUrl }
	const { dir } = splitUrl(abs)
	if (dir) await mkdir(dir) // 建不出来不致命（父目录可能已存在）
	const full = String(text)
	return new Promise((resolve) => {
		try {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					writeWith(
						(ok, fail) => fs.root.getFile(abs, { create: true, exclusive: false }, ok, fail),
						full,
						opts
					).then((r) => resolve(r.ok ? { ...r, abs } : r))
				},
				(e) => resolve({ ok: false, error: '无法访问文件系统：' + errText(e) })
			)
		} catch (e) {
			resolve({ ok: false, error: '异常：' + errText(e) })
		}
	})
}

/** 写文本并核对字节数（base64 / JSON 都是纯 ASCII，但 JSON 里有中文，所以按 UTF-8 算） */
export async function writeTextChecked(localUrl, text) {
	const full = String(text)
	const w = await writeText(localUrl, full)
	if (!w.ok) return w
	const want = utf8Length(full)
	const size = await fileSize(localUrl)
	if (size !== want) {
		return { ok: false, error: `写入大小不对：写进去 ${size} 字节，期望 ${want}。可能没写完整。`, abs: w.abs }
	}
	return { ok: true, abs: w.abs, bytes: size }
}

/**
 * 按**绝对路径**写文本（公共目录用）。
 * 公共目录没有 `_xxx` 短路径，只能先解析目录 entry，再在它下面建文件。
 */
export function writeTextAt(dirAbs, name, text, opts = {}) {
	return new Promise((resolve) => {
		if (!hasPlusIo() || !dirAbs) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		const base = String(dirAbs).replace(/\/$/, '')
		const full = String(text)
		try {
			plus.io.resolveLocalFileSystemURL(
				base,
				(dirEntry) => {
					writeWith(
						(ok, fail) => dirEntry.getFile(name, { create: true, exclusive: false }, ok, fail),
						full,
						opts
					).then((r) => resolve(r.ok ? { ...r, abs: `${base}/${name}` } : r))
				},
				(e) => resolve({ ok: false, error: '目录解析不到：' + errText(e) })
			)
		} catch (e) {
			resolve({ ok: false, error: '异常：' + errText(e) })
		}
	})
}

/** 按绝对路径写 + 核对字节数 */
export async function writeTextAtChecked(dirAbs, name, text) {
	const full = String(text)
	const w = await writeTextAt(dirAbs, name, full)
	if (!w.ok) return w
	const abs = w.abs || `${String(dirAbs).replace(/\/$/, '')}/${name}`
	const want = utf8Length(full)
	const size = await fileSizeAt(abs)
	if (size !== want) {
		return { ok: false, error: `写入大小不对：写进去 ${size} 字节，期望 ${want}`, abs }
	}
	return { ok: true, abs, bytes: size }
}

/** 某个目录能不能写（写个探针文件再删掉，结果缓存） */
const _canWrite = new Map()
export async function canWriteAt(dirAbs, opts = {}) {
	const key = String(dirAbs || '')
	if (!key) return false
	if (!opts.fresh && _canWrite.has(key)) return _canWrite.get(key)
	const probe = '.cc_write_probe'
	const w = await writeTextAt(key, probe, 'ok')
	let ok = false
	if (w.ok) {
		const size = await fileSizeAt(`${key}/${probe}`)
		ok = size === 2
		await removeAt(`${key}/${probe}`)
	}
	_canWrite.set(key, ok)
	return ok
}

/* ==================== 读 ==================== */

/**
 * 读文本文件。
 *
 * 两条路都走 plus.io，都不经过 Native.js：
 *   1. readAsText —— 直接拿文本（最干净）
 *   2. readAsDataURL → 把 base64 解回文本（纯 JS 解码）
 *
 * 为什么要有第 2 条：真机上 plus.io 各方法**个体差异很大**（写文本能成、
 * copyTo 却失败），所以不能假设 readAsText 一定可用。第 2 条只用
 * 「读成 base64」这一个动作，剩下的解码在我们自己手里。
 *
 * ⚠️ 不能拿「readAsDataURL 再截逗号后面」直接当结果：.b64 照片文件的
 *    **内容**本身就是 base64 文本，那样会得到「base64 的 base64」
 *    （双重编码），照片永远显示不出来。必须真的解码回文本。
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
							const viaBase64 = () => {
								const reader = new plus.io.FileReader()
								reader.onloadend = (e) => {
									const raw = String((e && e.target && e.target.result) || '')
									const comma = raw.indexOf(',')
									const b64 = comma >= 0 ? raw.slice(comma + 1) : raw
									if (!b64) {
										resolve({ ok: false, error: '两种读法都读不出内容（文件可能是 0 字节）' })
										return
									}
									try {
										resolve({
											ok: true,
											text: utf8Decode(base64ToBytes(b64)),
											size: file.size,
											via: 'base64 解码',
										})
									} catch (err) {
										resolve({ ok: false, error: 'base64 解码失败：' + errText(err) })
									}
								}
								reader.onerror = () => resolve({ ok: false, error: 'FileReader 出错（文件可能太大）' })
								try {
									reader.readAsDataURL(file)
								} catch (e) {
									resolve({ ok: false, error: 'readAsDataURL 异常：' + errText(e) })
								}
							}
							const viaText = () => {
								const reader = new plus.io.FileReader()
								reader.onloadend = (e) => {
									const t = (e && e.target && e.target.result) || ''
									if (String(t).length) {
										resolve({ ok: true, text: String(t), size: file.size, via: 'readAsText' })
										return
									}
									// readAsText 在这台设备上返回空 → 换第二条路
									viaBase64()
								}
								reader.onerror = () => viaBase64()
								try {
									reader.readAsText(file)
								} catch (e) {
									viaBase64()
								}
							}
							viaText()
						},
						() => resolve({ ok: false, error: 'entry.file 失败' })
					)
				},
				() => resolve({ ok: false, error: '文件不存在或解析不到' })
			)
		} catch (e) {
			resolve({ ok: false, error: '异常：' + errText(e) })
		}
	})
}

/** 读成 base64（读二进制用；文件内容是 base64 文本时请用 readText） */
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
			resolve({ ok: false, error: '异常：' + errText(e) })
		}
	})
}

/* ==================== 查 / 删 / 列 ==================== */

export function fileSize(localUrl) {
	return fileSizeAt(absOf(localUrl))
}

/** 按绝对路径查文件大小（读不到返回 -1） */
export function fileSizeAt(absPath) {
	return new Promise((resolve) => {
		if (!hasPlusIo() || !absPath) {
			resolve(-1)
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				String(absPath),
				(entry) => entry.file((file) => resolve(Number(file.size) || 0), () => resolve(-1)),
				() => resolve(-1)
			)
		} catch (e) {
			resolve(-1)
		}
	})
}

export function remove(localUrl) {
	return removeAt(absOf(localUrl))
}

/** 按绝对路径删除（文件或目录，失败静默返回 ok:false） */
export function removeAt(absPath) {
	return new Promise((resolve) => {
		if (!hasPlusIo() || !absPath) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				String(absPath).replace(/\/$/, ''),
				(entry) => entry.remove(() => resolve({ ok: true }), () => resolve({ ok: false })),
				() => resolve({ ok: false })
			)
		} catch (e) {
			resolve({ ok: false })
		}
	})
}

export function listDir(localUrl) {
	return listDirAt(absOf(localUrl))
}

/** 按绝对路径列目录（公共目录只能这么读） */
export function listDirAt(absPath) {
	return new Promise((resolve) => {
		if (!hasPlusIo() || !absPath) {
			resolve({ ok: false, error: 'plus.io 不可用', names: [] })
			return
		}
		const base = String(absPath).replace(/\/$/, '')
		try {
			plus.io.resolveLocalFileSystemURL(
				base,
				(entry) => {
					const reader = entry.createReader()
					reader.readEntries(
						(entries) => {
							const names = []
							for (let i = 0; i < entries.length; i++) {
								const e = entries[i]
								names.push({ name: e.name, isFile: e.isFile, url: `${base}/${e.name}` })
							}
							resolve({ ok: true, names })
						},
						() => resolve({ ok: false, error: '读目录失败', names: [] })
					)
				},
				() => resolve({ ok: false, error: '目录不存在', names: [] })
			)
		} catch (e) {
			resolve({ ok: false, error: errText(e), names: [] })
		}
	})
}

/** 列出某个目录里符合前缀的文件 */
export async function findBackups(localUrl, prefix = 'calorie-backup') {
	return findBackupsAt(absOf(localUrl), prefix)
}

/** 按绝对路径找备份文件 */
export async function findBackupsAt(absPath, prefix = 'calorie-backup') {
	const r = await listDirAt(absPath)
	if (!r.ok) return []
	return r.names.filter((f) => f.isFile && f.name.indexOf(prefix) === 0)
}
