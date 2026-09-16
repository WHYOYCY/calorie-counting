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

import { readText, writeTextChecked } from './plusio.js'

/** 照片目录（App 私有目录下），文本照片存在这里 */
export const PHOTO_DIR = '_doc/food'

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
								resolve({ ok: false, fallback: true, reason: '读出来是空' })
								return
							}
							resolve({ ok: true, base64, mime })
						}
						reader.onerror = () => resolve({ ok: false, fallback: true, reason: 'FileReader 出错（文件可能太大）' })
						reader.readAsDataURL(file)
					},
					() => resolve({ ok: false, fallback: true, reason: 'entry.file 失败' })
				)
			},
			() => resolve({ ok: false, fallback: true, reason: 'resolveLocalFileSystemURL 解析不到' })
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
	// 每一步都记下来。这类跨层读取失败时，「哪一环失败的」比错误码有用得多 ——
	// 早先只返回一句「读取失败」，只能靠猜。
	const tried = []

	// H5 优先：直接读 File/Blob，最可靠
	const byFile = await readByFileReader(file)
	if (byFile.ok) return byFile
	tried.push('File 对象：' + (file ? '读取失败' : '没有 File'))

	// 次选：blob: / data: URL（H5 落盘失败后的兜底路径）
	const byUrl = await readByUrl(path)
	if (byUrl.ok) return byUrl
	tried.push('URL 读取：不是 blob/data 或不支持')

	// App 首选：plus.io
	const byPlus = await readByPlusIo(path)
	if (byPlus.ok) return byPlus
	tried.push('plus.io：' + (byPlus.reason || '失败'))

	// 再次：小程序/部分 App 运行时的文件系统 API
	const byFs = await readByFileSystemManager(path)
	if (byFs.ok) return byFs
	tried.push('FileSystemManager：不可用')

	return { ok: false, error: '读取图片失败，请换一张图或改用手动记录', tried }
}

/* ---------------- 落盘 / 删除 ---------------- */

/**
 * 把临时图片复制到 App 私有目录，返回可用于 <image src> 的路径。
 * H5 无长期文件系统，直接返回失败（照片不持久化）。
 */
/**
 * 把图片落盘。
 *
 * ⚠️ 这里是「照片一直丢失」的根因所在，改法说明：
 *
 * 原实现用 plus.io 的 entry.copyTo 把相机临时文件拷进私有目录。
 * 真机上 copyTo 跨文件系统会**静默失败**（不报错、目标文件不存在），
 * 于是照片从来没落盘、界面上的「照片已丢失」其实是真的。
 * 更早还试过 Native.js 写二进制、Files.copy —— 自检报告证明这台设备上
 * 所有 Native.js 写入都是「不报错但 0 字节」。
 *
 * 自检里唯一**被证明真的能写进去**的是 plus.io 的 FileWriter.write(String)。
 * 所以照片改成存 base64 文本（.b64），配一次写入大小核对：
 *   - 不依赖 copyTo / plus.zip / Native.js
 *   - 写没写成功当场就知道，不再有静默失败
 *   - 备份时直接把这段文本塞进 JSON，不需要打包照片文件
 *
 * 代价是文件比原图大约 1/3，换来的是「确实存在」。
 */
export async function persistPhoto(tempPath) {
	if (typeof plus === 'undefined' || !plus || !plus.io || !plus.io.PRIVATE_DOC) {
		return { ok: false, path: '', error: '当前平台不支持保存照片' }
	}
	const r = await toBase64(tempPath)
	if (!r.ok) return { ok: false, path: '', error: r.error || '读取图片失败' }

	const name = `food_${Date.now()}.b64`
	return writePhotoBase64(name, r.base64)
}

/** 把一段 base64 写成照片文件，并核对大小 */
export async function writePhotoBase64(name, base64) {
	const dir = await ensurePhotoDir()
	if (!dir.ok) return { ok: false, path: '', error: dir.error }
	const url = `${PHOTO_DIR}/${name}`
	const w = await writeTextChecked(url, base64)
	if (!w.ok) return { ok: false, path: '', error: '保存照片失败：' + w.error }
	return { ok: true, path: url, bytes: w.bytes }
}

function ensurePhotoDir() {
	return new Promise((resolve) => {
		plus.io.requestFileSystem(
			plus.io.PRIVATE_DOC,
			(fs) => {
				fs.root.getDirectory(
					'food',
					{ create: true },
					() => resolve({ ok: true }),
					() => resolve({ ok: false, error: '无法创建照片目录' })
				)
			},
			() => resolve({ ok: false, error: '无法访问应用目录' })
		)
	})
}

/**
 * 读回照片的 base64（.b64 文本文件）。
 * @returns {Promise<{ok:boolean, base64?:string, error?:string}>}
 */
export async function readPhotoBase64(path) {
	const p = String(path || '')
	if (!p) return { ok: false, error: '没有照片路径' }
	if (/^data:/i.test(p)) return { ok: true, base64: splitDataUrl(p).base64 }
	const r = await readText(p)
	if (!r.ok) return { ok: false, error: r.error }
	const text = String(r.text || '').trim()
	if (!text) return { ok: false, error: '照片文件是空的' }
	return { ok: true, base64: text }
}

/**
 * 照片路径 → 可直接给 <image src> 用的 data URL。
 * 用于 .b64 文本照片；读不到返回空字符串（调用方显示「已丢失」）。
 */
export async function photoDataUrl(path) {
	const r = await readPhotoBase64(path)
	if (!r.ok || !r.base64) return { ok: false, error: r.error }
	return { ok: true, url: `data:image/jpeg;base64,${r.base64}` }
}

/** 文本照片（.b64）需要异步读出才能显示；普通文件路径同步转换即可 */
export function isTextPhoto(path) {
	return /\.b64$/i.test(String(path || ''))
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
