/**
 * 只用 plus.io + plus.zip 的文件操作
 *
 * 为什么单独一个模块：真机自检证明 **Native.js 的写入在这台设备上全部失败** ——
 * RandomAccessFile.writeBytes、Files.writeString、Files.copy(Path,Path)、
 * MediaStore 的输出流写入，全都是「不报错但 0 字节」。
 * 而 plus.io 的 FileWriter.write(String) 是唯一能真正写进去的。
 *
 * 所以备份链路完全绕开 Native.js：
 *   写文本   → plus.io FileWriter.write(String)
 *   读回来   → plus.io FileReader.readAsDataURL → base64
 *   拷文件   → entry.copyTo
 *   建目录   → getDirectory({create:true})
 *   打包     → plus.zip.compress（原生，字节根本不过 JS）
 *   解包     → plus.zip.decompress
 *   找备份   → DirectoryReader 列目录
 *
 * 这一切都不需要把字节传过 Native.js 桥 —— 那正是问题所在。
 */

/** 输出目录候选，按「用户越容易看到」排序 */
const OUT_DIRS = [
	{ url: '_downloads', label: '下载' },
	{ url: '_documents', label: '文档' },
	{ url: '_doc', label: '应用私有目录' },
]

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
export function resolveOutDir() {
	let fallback = null
	for (const d of OUT_DIRS) {
		const abs = absOf(d.url)
		if (!abs) continue
		const item = { url: d.url, abs, label: d.label, visible: isUserVisible(abs) }
		if (item.visible) return item
		if (!fallback) fallback = item
	}
	return fallback || { url: '_doc', abs: absOf('_doc'), label: '应用私有目录', visible: false }
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
export function writeText(localUrl, text) {
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
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					fs.root.getFile(
						abs,
						{ create: true, exclusive: false },
						(entry) => {
							entry.createWriter(
								(w) => {
									w.onwrite = () => resolve({ ok: true, abs })
									w.onerror = () => resolve({ ok: false, error: '写入失败' })
									try {
										w.write(String(text))
									} catch (e) {
										resolve({ ok: false, error: 'write 异常：' + ((e && e.message) || e) })
									}
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
export function copyFile(fromUrl, toUrl) {
	return new Promise((resolve) => {
		if (!hasPlusIo()) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		const fromAbs = absOf(fromUrl)
		const toAbs = absOf(toUrl)
		if (!fromAbs || !toAbs) {
			resolve({ ok: false, error: '路径解析失败' })
			return
		}
		const to = splitUrl(toAbs)
		try {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					fs.root.getDirectory(
						to.dir,
						{ create: true, exclusive: false },
						(dir) => {
							plus.io.resolveLocalFileSystemURL(
								fromAbs,
								(entry) => {
									entry.copyTo(
										dir,
										to.name,
										() => resolve({ ok: true, abs: toAbs }),
										(e) => resolve({ ok: false, error: '复制失败：' + ((e && e.message) || e) })
									)
								},
								() => resolve({ ok: false, error: '源文件不存在' })
							)
						},
						() => resolve({ ok: false, error: '目标目录不可用' })
					)
				},
				() => resolve({ ok: false, error: '无法访问文件系统' })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}

/** 列目录，返回文件名数组 */
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
export function hasZip() {
	return typeof plus !== 'undefined' && !!(plus && plus.zip && plus.zip.compress)
}

/**
 * 压缩：plus.zip.compress（纯原生，字节不过 JS 桥）。
 * @param {string} srcLocal  源文件或目录的 plus.io 本地 URL（多个用逗号分隔）
 * @param {string} zipLocal  输出 zip 的本地 URL
 */
export function zipCompress(srcLocal, zipLocal) {
	return new Promise((resolve) => {
		if (!hasZip()) {
			resolve({ ok: false, error: 'plus.zip 不可用（需在 HBuilderX 勾 Zip 模块）' })
			return
		}
		const srcAbs = absOf(srcLocal)
		const zipAbs = absOf(zipLocal)
		if (!srcAbs || !zipAbs) {
			resolve({ ok: false, error: '路径解析失败' })
			return
		}
		try {
			plus.zip.compress(
				srcAbs,
				zipAbs,
				() => resolve({ ok: true, abs: zipAbs }),
				(e) => resolve({ ok: false, error: '压缩失败：' + ((e && e.message) || e) })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}

/** 解压：plus.zip.decompress */
export function zipDecompress(zipLocal, destLocal) {
	return new Promise((resolve) => {
		if (!hasZip()) {
			resolve({ ok: false, error: 'plus.zip 不可用' })
			return
		}
		const zipAbs = absOf(zipLocal)
		const destAbs = absOf(destLocal)
		if (!zipAbs || !destAbs) {
			resolve({ ok: false, error: '路径解析失败' })
			return
		}
		if (typeof plus.zip.decompress !== 'function') {
			resolve({ ok: false, error: 'plus.zip.decompress 不可用' })
			return
		}
		try {
			plus.zip.decompress(
				zipAbs,
				destAbs,
				() => resolve({ ok: true, abs: destAbs }),
				(e) => resolve({ ok: false, error: '解压失败：' + ((e && e.message) || e) })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}

/** 列出候选目录里符合前缀的文件（导入时找备份用） */
export async function findBackups(prefix = 'calorie-backup') {
	const out = []
	for (const d of OUT_DIRS) {
		const r = await listDir(d.url)
		if (!r.ok) continue
		for (const f of r.names) {
			if (!f.isFile) continue
			if (f.name.indexOf(prefix) !== 0) continue
			out.push({ ...f, dir: d.url, dirLabel: d.label })
		}
	}
	return out
}
