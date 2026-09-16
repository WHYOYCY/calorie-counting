/**
 * 原生文件落盘（受限使用）
 *
 * ⚠️ 这个模块里的代码无法在开发机上执行 —— 只能在真机上验证。
 * 因此这里只做一件事，并且：
 *   1. 每一步都 try/catch，失败一律返回 { ok:false, error, trace }
 *   2. 调用方必须准备降级路径（分享 → 剪贴板）
 *   3. trace 记录失败发生在哪一步，用户把弹窗内容发回来就能定位
 *
 * 为什么需要它：安卓 11 起强制分区存储，应用私有目录（Android/data/…）
 * 文件管理器进不去，`plus.io` 也写不进公共目录
 * （plus.io.PUBLIC_DOWNLOADS 实测仍解析到应用私有目录）。
 * 想真的落到用户能看到的地方，只有走 MediaStore 或 SAF。
 *
 * 这里选 MediaStore 而不是 SAF：SAF 要重写 Activity.onActivityResult，
 * 社区多个反馈它「开界面时就被调用、真返回时反而不触发」，时序不可靠；
 * 而 MediaStore 是「直接写入」，没有回调时序问题。
 *
 * 踩过的坑（真机报错 resolver.insert is not a function）：
 *   Native.js 里，从 Java 方法返回的实例，其方法不一定挂在 JS 代理上 ——
 *   必须先 importClass 它的类，或者改用 plus.android.invoke 走显式反射。
 *   现在两者都做，并且所有对 Java 对象的调用都统一走 callJava()。
 */

/** 当前是否 Android + plus 环境 */
export function isAndroid() {
	return (
		typeof plus !== 'undefined' &&
		!!plus &&
		!!plus.android &&
		typeof plus.android.runtimeMainActivity === 'function'
	)
}

/** 取 Android API 级别（失败返回 0） */
export function androidSdk() {
	if (!isAndroid()) return 0
	try {
		const Build = plus.android.importClass('android.os.Build')
		const v = Build && Build.VERSION && Build.VERSION.SDK_INT
		return Number(v) || 0
	} catch (e) {
		return 0
	}
}

/**
 * 能力探测（只按 SDK 级别判断，不代表一定能成功 —— 真机才是准的）。
 */
export function probe() {
	const sdk = androidSdk()
	return {
		isAndroid: isAndroid(),
		sdk,
		// MediaStore.Downloads 是 API 29 引入的；29 以下得另走老路，这里不覆盖
		canSaveToDownloads: isAndroid() && sdk >= 29,
		canShare:
			typeof uni !== 'undefined' && typeof uni.shareWithSystem === 'function',
	}
}

/* ---------------- Java 互操作辅助 ---------------- */

/**
 * 调用 Java 对象的方法。
 * 优先 plus.android.invoke（显式反射，不依赖方法是否挂在代理上），
 * 没有该 API 时退回直接点调用。二选一，不会重复调用。
 */
function callJava(obj, name) {
	const args = Array.prototype.slice.call(arguments, 2)
	const A = plus.android
	if (A && typeof A.invoke === 'function') {
		return A.invoke.apply(A, [obj, name].concat(args))
	}
	// 没有 invoke 时只能直接点调用。方法没暴露给 JS 时要报得看得懂，
	// 而不是抛 "Cannot read properties of undefined (reading 'apply')"
	const fn = obj && obj[name]
	if (typeof fn !== 'function') {
		throw new Error(`调不到 ${name}（该对象的方法未暴露给 JS）`)
	}
	return fn.apply(obj, args)
}

/** 读静态字段（部分基座上类代理取不到静态字段，退回 getAttribute） */
function staticField(cls, name) {
	try {
		const v = cls[name]
		if (v !== undefined && v !== null) return v
	} catch (e) {
		/* 继续试 getAttribute */
	}
	const A = plus.android
	if (A && typeof A.getAttribute === 'function') {
		try {
			return A.getAttribute(cls, name)
		} catch (e) {
			return null
		}
	}
	return null
}

/**
 * 把字符串写进输出流。
 *
 * 两条写法都试：
 *   A. OutputStreamWriter 可以直接吃 JS 字符串，最省事
 *   B. 退回 new java.lang.String(text).getBytes('UTF-8') + write(byte[])
 *      —— 注意必须 new 出真正的 String 实例：invoke 对原始 JS 字符串
 *         调 getBytes 会返回 null（社区已知问题）
 */
function writeText(os, text, trace) {
	const errs = []

	try {
		trace.push('writer')
		const OutputStreamWriter = plus.android.importClass('java.io.OutputStreamWriter')
		const w = new OutputStreamWriter(os, 'UTF-8')
		callJava(w, 'write', text)
		callJava(w, 'flush')
		callJava(w, 'close')
		return
	} catch (e) {
		errs.push('Writer: ' + ((e && e.message) || e))
	}

	try {
		trace.push('getBytes')
		const JString = plus.android.importClass('java.lang.String')
		const bytes = callJava(new JString(text), 'getBytes', 'UTF-8')
		if (!bytes) throw new Error('getBytes 返回空')
		callJava(os, 'write', bytes)
		callJava(os, 'flush')
		callJava(os, 'close')
		return
	} catch (e) {
		errs.push('getBytes: ' + ((e && e.message) || e))
	}

	throw new Error('写入内容失败（' + errs.join('；') + '）')
}

/**
 * 把文本写进公共「下载」目录。
 *
 * @returns Promise<{ok:boolean, where?:string, error?:string, trace?:string}>
 */
export function saveToDownloads(text, filename) {
	return new Promise((resolve) => {
		const trace = []

		if (!isAndroid()) {
			resolve({ ok: false, unsupported: true, error: '当前平台不是 Android' })
			return
		}
		if (androidSdk() < 29) {
			// Android 10 以下走传统路径，这里没有实现（且那些系统上
			// 应用私有目录本来就是可访问的，现有导出方式够用）
			resolve({ ok: false, unsupported: true, error: 'Android 10 以下暂不支持' })
			return
		}

		let resolver = null
		let uri = null

		try {
			// 关键：返回自 Java 的实例，先 importClass 其类，方法才可见
			trace.push('importClass')
			plus.android.importClass('android.content.Context')
			plus.android.importClass('android.content.ContentResolver')
			plus.android.importClass('java.io.OutputStream')
			const Downloads = plus.android.importClass('android.provider.MediaStore$Downloads')
			const ContentValues = plus.android.importClass('android.content.ContentValues')
			if (!Downloads || !ContentValues) {
				throw new Error('importClass 返回空（该基座可能没链入 MediaStore）')
			}

			trace.push('new ContentValues')
			const values = new ContentValues()
			callJava(values, 'put', staticField(Downloads, 'DISPLAY_NAME'), filename)
			callJava(values, 'put', staticField(Downloads, 'MIME_TYPE'), 'application/json')
			callJava(values, 'put', staticField(Downloads, 'RELATIVE_PATH'), 'Download')

			trace.push('getContentResolver')
			const main = plus.android.runtimeMainActivity()
			resolver = callJava(main, 'getContentResolver')
			if (!resolver) throw new Error('getContentResolver 返回空')

			trace.push('insert')
			uri = callJava(
				resolver,
				'insert',
				staticField(Downloads, 'EXTERNAL_CONTENT_URI'),
				values
			)
			if (!uri) throw new Error('系统拒绝创建文件（MediaStore 没返回 uri）')

			trace.push('openOutputStream')
			const os = callJava(resolver, 'openOutputStream', uri)
			if (!os) throw new Error('无法打开输出流')

			writeText(os, text, trace)

			trace.push('ok')
			resolve({ ok: true, where: `下载/${filename}`, trace: trace.join(' → ') })
		} catch (e) {
			// 失败时把刚建出来的空文件删掉，免得下载目录里留个 0 字节垃圾
			try {
				if (uri && resolver) callJava(resolver, 'delete', uri, null, null)
			} catch (e2) {
				/* 清理失败就算了 */
			}
			resolve({
				ok: false,
				error: String((e && e.message) || e),
				trace: trace.join(' → '),
			})
		}
	})
}

/* ---------------- 完整备份：写入 / 选择文件 ---------------- */

/** 有 plus 环境（App），但不限平台 */
export function hasPlus() {
	return typeof plus !== 'undefined' && !!plus
}

/**
 * 用 plus.io 把字节写进应用私有目录，返回 _doc 下的相对路径。
 *
 * 只能传 Blob：write() 若传字符串会把二进制弄坏。
 * 先落私有目录而不是直接写公共目录，是因为 plus.io 能稳定写私有目录，
 * 而公共目录必须走 MediaStore —— 那就得把二进制经过 JS 桥，很容易出错。
 * 所以流程是：plus.io 写私有 → 原生 FileUtils.copy 到公共下载。
 */
export function writePrivateFile(bytes, filename) {
	return new Promise((resolve) => {
		if (!hasPlus() || !plus.io || !plus.io.requestFileSystem) {
			resolve({ ok: false, unsupported: true, error: '当前平台不支持写文件' })
			return
		}
		if (typeof Blob === 'undefined') {
			resolve({ ok: false, error: '当前内核不支持 Blob，无法写二进制文件' })
			return
		}
		try {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					fs.root.getFile(
						filename,
						{ create: true },
						(entry) => {
							entry.createWriter(
								(w) => {
									w.onwrite = () =>
										resolve({
											ok: true,
											path: entry.fullPath || `_doc/${filename}`,
										})
									w.onerror = () => resolve({ ok: false, error: '写入失败' })
									try {
										w.write(new Blob([bytes], { type: 'application/zip' }))
									} catch (e) {
										resolve({
											ok: false,
											error: 'write 调用异常：' + ((e && e.message) || e),
										})
									}
								},
								() => resolve({ ok: false, error: '无法创建写入器' })
							)
						},
						() => resolve({ ok: false, error: '无法创建文件' })
					)
				},
				() => resolve({ ok: false, error: '无法访问应用目录' })
			)
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}

/** 删掉私有目录里的文件（清理临时 zip） */
export function removePrivateFile(path) {
	return new Promise((resolve) => {
		if (!hasPlus() || !plus.io || !plus.io.resolveLocalFileSystemURL) {
			resolve({ ok: false })
			return
		}
		try {
			plus.io.resolveLocalFileSystemURL(
				path,
				(entry) => entry.remove(() => resolve({ ok: true }), () => resolve({ ok: false })),
				() => resolve({ ok: false })
			)
		} catch (e) {
			resolve({ ok: false })
		}
	})
}

/**
 * 把私有目录里的文件拷进公共「下载」目录。
 *
 * 关键：用原生 FileUtils.copy(InputStream, OutputStream) 直接对拷，
 * **二进制根本不经过 JS 桥** —— 既避开了 Native.js 传 byte[] 的坑，
 * 也不会把整个备份读进 JS 内存。FileUtils 是 API 29+ 的。
 */
export function copyPrivateToDownloads(privatePath, filename) {
	return new Promise((resolve) => {
		const trace = []
		if (!isAndroid()) {
			resolve({ ok: false, unsupported: true, error: '当前平台不是 Android' })
			return
		}
		if (androidSdk() < 29) {
			resolve({ ok: false, unsupported: true, error: 'Android 10 以下暂不支持' })
			return
		}

		let resolver = null
		let uri = null
		try {
			trace.push('importClass')
			plus.android.importClass('android.content.ContentResolver')
			plus.android.importClass('java.io.OutputStream')
			plus.android.importClass('java.io.FileInputStream')
			const Downloads = plus.android.importClass('android.provider.MediaStore$Downloads')
			const ContentValues = plus.android.importClass('android.content.ContentValues')
			const FileUtils = plus.android.importClass('android.os.FileUtils')
			if (!Downloads || !ContentValues || !FileUtils) {
				throw new Error('importClass 返回空（该基座可能没链入 MediaStore / FileUtils）')
			}

			trace.push('new ContentValues')
			const values = new ContentValues()
			callJava(values, 'put', staticField(Downloads, 'DISPLAY_NAME'), filename)
			callJava(values, 'put', staticField(Downloads, 'MIME_TYPE'), 'application/zip')
			callJava(values, 'put', staticField(Downloads, 'RELATIVE_PATH'), 'Download')

			trace.push('getContentResolver')
			const main = plus.android.runtimeMainActivity()
			resolver = callJava(main, 'getContentResolver')
			if (!resolver) throw new Error('getContentResolver 返回空')

			trace.push('insert')
			uri = callJava(
				resolver,
				'insert',
				staticField(Downloads, 'EXTERNAL_CONTENT_URI'),
				values
			)
			if (!uri) throw new Error('系统拒绝创建文件（MediaStore 没返回 uri）')

			trace.push('convertPath')
			const abs =
				plus.io && typeof plus.io.convertLocalFileSystemURL === 'function'
					? plus.io.convertLocalFileSystemURL(privatePath)
					: ''
			if (!abs) throw new Error('拿不到私有文件的绝对路径')

			trace.push('openOutputStream')
			const os = callJava(resolver, 'openOutputStream', uri)
			if (!os) throw new Error('无法打开输出流')

			trace.push('FileUtils.copy')
			const FileInputStream = plus.android.importClass('java.io.FileInputStream')
			const input = new FileInputStream(abs)
			callJava(FileUtils, 'copy', input, os)
			callJava(os, 'flush')
			callJava(os, 'close')
			callJava(input, 'close')

			trace.push('ok')
			resolve({ ok: true, where: `下载/${filename}`, trace: trace.join(' → ') })
		} catch (e) {
			try {
				if (uri && resolver) callJava(resolver, 'delete', uri, null, null)
			} catch (e2) {
				/* 清理失败就算了 */
			}
			resolve({
				ok: false,
				error: String((e && e.message) || e),
				trace: trace.join(' → '),
			})
		}
	})
}

/**
 * 让用户选一个文件（SAF，ACTION_OPEN_DOCUMENT），读成字节。
 *
 * ⚠️ 这条路最不确定：要重写 Activity.onActivityResult，
 * 而社区多个反馈它「开界面时就被调用、真返回时反而不触发」。
 * 所以这里：
 *   1. 先把原回调存起来，用完还原（社区给出的规避办法）
 *   2. 加超时，不然回调不触发会让界面一直卡着
 *   3. 全程 trace，出错能定位到哪一步
 */
export function pickFileBytes(opts = {}) {
	const TIMEOUT = Number(opts.timeout) || 90000
	return new Promise((resolve) => {
		const trace = []
		const done = (() => {
			let used = false
			return (v) => {
				if (used) return
				used = true
				clearTimeout(timer)
				trace.push('result')
				resolve({ ...v, trace: trace.join(' → ') })
			}
		})()
		const timer = setTimeout(
			() => done({ ok: false, error: '没有等到文件选择的结果（系统没回调）' }),
			TIMEOUT
		)

		if (!isAndroid()) {
			done({ ok: false, unsupported: true, error: '当前平台不是 Android' })
			return
		}

		try {
			trace.push('importClass')
			plus.android.importClass('android.content.Intent')
			plus.android.importClass('android.content.ContentResolver')
			plus.android.importClass('java.io.InputStream')
			plus.android.importClass('java.io.FileOutputStream')
			const Intent = plus.android.importClass('android.content.Intent')
			const FileUtils = plus.android.importClass('android.os.FileUtils')
			if (!Intent || !FileUtils) throw new Error('importClass 返回空')

			trace.push('buildIntent')
			const main = plus.android.runtimeMainActivity()
			const intent = new Intent(staticField(Intent, 'ACTION_OPEN_DOCUMENT'))
			callJava(intent, 'addCategory', staticField(Intent, 'CATEGORY_OPENABLE'))
			callJava(intent, 'setType', '*/*')

			const CODE = 0x9f01
			trace.push('hook onActivityResult')
			const previous = main.onActivityResult
			main.onActivityResult = function (reqCode, resCode, data) {
				trace.push('called:' + reqCode)
				if (reqCode !== CODE) {
					if (previous) previous.apply(main, arguments)
					return
				}
				// 用完还原，别把别人的回调顶掉
				main.onActivityResult = previous
				try {
					if (resCode !== -1) {
						done({ ok: false, cancelled: true, error: '' })
						return
					}
					const uri = callJava(data, 'getData')
					if (!uri) throw new Error('没有拿到文件 uri')
					const resolver = callJava(main, 'getContentResolver')
					const input = callJava(resolver, 'openInputStream', uri)
					if (!input) throw new Error('无法打开输入流')

					// 先落成私有临时文件，再用 plus.io 读（避免二进制过 JS 桥）
					const tmpName = 'picked-' + Date.now() + '.zip'
					const dest = plus.io.convertLocalFileSystemURL('_doc/' + tmpName)
					const out = new FileOutputStream(dest)
					callJava(FileUtils, 'copy', input, out)
					callJava(out, 'flush')
					callJava(out, 'close')
					callJava(input, 'close')
					done({ ok: true, path: '_doc/' + tmpName, bytes: 0, mode: 'file' })
				} catch (e) {
					done({ ok: false, error: String((e && e.message) || e) })
				}
			}

			trace.push('startActivityForResult')
			callJava(main, 'startActivityForResult', intent, CODE)
		} catch (e) {
			done({ ok: false, error: String((e && e.message) || e) })
		}
	})
}
