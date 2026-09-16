/**
 * 图片选取 / 转 base64 / 落盘 / 删除
 *
 * 平台差异全部收敛在这里，统一用运行时特性探测（而非条件编译），
 * 这样本模块在 Node 里也能被安全 import。
 *
 * ⚠️ 已知坑：plus.io.FileReader 有「转码不完整」的社区报告，
 *    因此这里做了分层降级：plus.io → getFileSystemManager → 明确报错，
 *    并在真机验收清单里列为必测项。
 */

function guessMime(path) {
	const p = String(path || '').toLowerCase()
	if (p.indexOf('.png') >= 0) return 'image/png'
	if (p.indexOf('.webp') >= 0) return 'image/webp'
	if (p.indexOf('.gif') >= 0) return 'image/gif'
	if (p.indexOf('.bmp') >= 0) return 'image/bmp'
	return 'image/jpeg'
}

export function splitDataUrl(dataUrl) {
	const s = String(dataUrl || '')
	const comma = s.indexOf(',')
	if (comma < 0) return { base64: '', mime: 'image/jpeg' }
	const head = s.slice(0, comma)
	const m = head.match(/data:([^;]+)/)
	return { base64: s.slice(comma + 1), mime: (m && m[1]) || 'image/jpeg' }
}

/* ---------------- 选图 ---------------- */

/**
 * 选一张图。
 * @param {string} source '' 时同时给出拍照/相册入口；'camera' 或 'album' 指定来源
 */
export function pickImage(source = '') {
	return new Promise((resolve) => {
		if (typeof uni === 'undefined' || typeof uni.chooseImage !== 'function') {
			resolve({ ok: false, error: '当前环境不支持选择图片' })
			return
		}
		uni.chooseImage({
			count: 1,
			sizeType: ['compressed'],
			sourceType: source ? [source] : ['camera', 'album'],
			success: (res) => {
				const path = res && res.tempFilePaths && res.tempFilePaths[0]
				const file = res && res.tempFiles && res.tempFiles[0]
				if (!path) {
					resolve({ ok: false, error: '没有拿到图片' })
					return
				}
				resolve({ ok: true, path, file })
			},
			fail: (err) => {
				const msg = (err && err.errMsg) || ''
				const cancelled = /cancel|取消/i.test(msg)
				resolve({
					ok: false,
					cancelled,
					// 缺口 B3：权限被拒时给出可操作的提示，而不是静默失败
					error: /auth|permission|denied/i.test(msg)
						? '没有相机/相册权限，请到系统设置里开启'
						: cancelled
							? ''
							: msg || '选择图片失败',
				})
			},
		})
	})
}

/* ---------------- 转 base64 ---------------- */

function readByPlusIo(path) {
	return new Promise((resolve) => {
		if (typeof plus === 'undefined' || !plus || !plus.io || !plus.io.resolveLocalFileSystemURL) {
			resolve({ ok: false, fallback: true })
			return
		}
		plus.io.resolveLocalFileSystemURL(
			path,
			(entry) => {
				entry.file(
					(file) => {
						const reader = new plus.io.FileReader()
						reader.onloadend = (e) => {
							const { base64, mime } = splitDataUrl(e && e.target && e.target.result)
							if (!base64) {
								resolve({ ok: false, fallback: true })
								return
							}
							resolve({ ok: true, base64, mime })
						}
						reader.onerror = () => resolve({ ok: false, fallback: true })
						reader.readAsDataURL(file)
					},
					() => resolve({ ok: false, fallback: true })
				)
			},
			() => resolve({ ok: false, fallback: true })
		)
	})
}

function readByFileSystemManager(path) {
	return new Promise((resolve) => {
		if (
			typeof uni === 'undefined' ||
			typeof uni.getFileSystemManager !== 'function'
		) {
			resolve({ ok: false, fallback: true })
			return
		}
		try {
			const fs = uni.getFileSystemManager()
			const base64 = fs.readFileSync(path, 'base64')
			if (!base64) {
				resolve({ ok: false, fallback: true })
				return
			}
			resolve({ ok: true, base64, mime: guessMime(path) })
		} catch (e) {
			resolve({ ok: false, fallback: true })
		}
	})
}

function readByFileReader(file) {
	return new Promise((resolve) => {
		if (
			!file ||
			typeof FileReader === 'undefined' ||
			typeof Blob === 'undefined' ||
			!(file instanceof Blob)
		) {
			resolve({ ok: false, fallback: true })
			return
		}
		const reader = new FileReader()
		reader.onload = () => {
			const { base64, mime } = splitDataUrl(reader.result)
			if (!base64) {
				resolve({ ok: false, fallback: true })
				return
			}
			resolve({ ok: true, base64, mime })
		}
		reader.onerror = () => resolve({ ok: false, fallback: true })
		reader.readAsDataURL(file)
	})
}

/**
 * blob: / data: 形式的图片 → base64。
 *
 * H5 落盘失败时会退回临时路径（blob: URL），后续「识别填充」得能读它，
 * 否则刚拍完照片点识别就是「读取图片失败」。
 */
async function readByUrl(url) {
	const u = String(url || '')
	if (!/^(blob:|data:)/i.test(u) || typeof fetch !== 'function') {
		return { ok: false, fallback: true }
	}
	try {
		const res = await fetch(u)
		const blob = await res.blob()
		return await readByFileReader(blob)
	} catch (e) {
		return { ok: false, fallback: true }
	}
}

/**
 * 图片 → base64。
 * @param {string} path 临时文件路径
 * @param {Blob}   [file] H5 下 chooseImage 给出的 File 对象
 * @returns {Promise<{ok:boolean, base64?:string, mime?:string, error?:string}>}
 */
export async function toBase64(path, file) {
	// H5 优先：直接读 File/Blob，最可靠
	const byFile = await readByFileReader(file)
	if (byFile.ok) return byFile

	// 次选：blob: / data: URL（H5 落盘失败后的兜底路径）
	const byUrl = await readByUrl(path)
	if (byUrl.ok) return byUrl

	// App 首选：plus.io
	const byPlus = await readByPlusIo(path)
	if (byPlus.ok) return byPlus

	// 再次：小程序/部分 App 运行时的文件系统 API
	const byFs = await readByFileSystemManager(path)
	if (byFs.ok) return byFs

	return { ok: false, error: '读取图片失败，请换一张图或改用手动记录' }
}

/* ---------------- 落盘 / 删除 ---------------- */

/**
 * 把临时图片复制到 App 私有目录，返回可用于 <image src> 的路径。
 * H5 无长期文件系统，直接返回失败（照片不持久化）。
 */
export function persistPhoto(tempPath) {
	return new Promise((resolve) => {
		if (typeof plus === 'undefined' || !plus || !plus.io || !plus.io.requestFileSystem) {
			resolve({ ok: false, path: '', error: '当前平台不支持保存照片' })
			return
		}
		plus.io.resolveLocalFileSystemURL(
			tempPath,
			(entry) => {
				plus.io.requestFileSystem(
					plus.io.PRIVATE_DOC,
					(fs) => {
						fs.root.getDirectory(
							'food',
							{ create: true },
							(dir) => {
								const name = `food_${Date.now()}.jpg`
								entry.copyTo(
									dir,
									name,
									(newEntry) =>
										resolve({ ok: true, path: newEntry.fullPath || `_doc/food/${name}` }),
									() => resolve({ ok: false, path: '', error: '复制照片失败' })
								)
							},
							() => resolve({ ok: false, path: '', error: '无法创建照片目录' })
						)
					},
					() => resolve({ ok: false, path: '', error: '无法访问应用目录' })
				)
			},
			() => resolve({ ok: false, path: '', error: '找不到源图片' })
		)
	})
}

function byUniRemove(path) {
	if (typeof uni !== 'undefined' && uni && typeof uni.removeSavedFile === 'function') {
		uni.removeSavedFile({ filePath: path, fail: () => {} })
	}
}

/**
 * 决定记录里该用哪个照片路径。
 *
 * 落盘成功 → 用持久路径（App 私有目录，重启后仍在）。
 * 落盘失败 → 退回临时路径。典型场景是 H5：没有长期文件系统，
 *            但本次会话里编辑页仍应看得见刚拍的照片。
 *
 * 首页拍照那条路径原先缺这个兜底，落盘一失败 photo 就是空字符串，
 * 于是编辑页显示的是「拍照留档」空状态 —— 刚拍的照片看不见。
 * 编辑页自己的 capturePhoto 则有兜底，两边行为不一致。
 * 抽成函数让两边共用，以后不会再跑偏。
 */
export function photoPathFor(saved, tempPath) {
	if (saved && saved.ok && saved.path) return saved.path
	return tempPath || ''
}

/** 删除照片文件（不抛异常，失败静默） */
export function deletePhotoFile(path) {
	const p = String(path || '')
	if (!p) return
	// _doc/xxx 这类本地 URL、/storage/... 这类原生绝对路径、file:// 形式，
	// plus.io 都能解析。早先只认 _doc 开头，存了原生绝对路径时照片文件
	// 就永远删不掉（记录没了，文件还在沙箱里堆着）。
	const plusCanResolve =
		typeof plus !== 'undefined' &&
		plus &&
		plus.io &&
		typeof plus.io.resolveLocalFileSystemURL === 'function' &&
		/^(_|file:\/\/|\/)/.test(p)

	if (plusCanResolve) {
		plus.io.resolveLocalFileSystemURL(
			p,
			(entry) => {
				entry.remove(
					() => {},
					() => byUniRemove(p)
				)
			},
			() => byUniRemove(p)
		)
		return
	}
	byUniRemove(p)
}

/**
 * 照片路径 → 可直接给 <image src> 用的形式。
 *
 * H5 / 网络 / data: / blob: 原样返回。
 * App 端把 _doc/xxx 这类本地 URL 转成平台绝对路径：image 组件官方
 * 列明的本地形式是「绝对路径」，而 fullPath 到底返回相对还是绝对
 * 在官方文档与社区实测之间说法不一，所以不赌某一种，在渲染前统一转换。
 * 转换失败就原样返回，不会比不转更糟。
 */
export function photoSrc(path) {
	const p = String(path || '')
	if (!p) return ''
	if (/^(data:|blob:|https?:|file:)/i.test(p)) return p
	if (
		typeof plus !== 'undefined' &&
		plus &&
		plus.io &&
		typeof plus.io.convertLocalFileSystemURL === 'function'
	) {
		try {
			const abs = plus.io.convertLocalFileSystemURL(p)
			if (abs) return abs
		} catch (e) {
			/* 转换失败就用原路径 */
		}
	}
	return p
}
