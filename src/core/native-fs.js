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

/* ---------------- 完整备份：读写文件 ---------------- */

/** 有 plus 环境（App），但不限平台 */
export function hasPlus() {
	return typeof plus !== 'undefined' && !!plus
}

/** 本地 URL（_doc/x）→ 平台绝对路径 */
function absPathOf(localUrl) {
	if (!hasPlus() || !plus.io || typeof plus.io.convertLocalFileSystemURL !== 'function') {
		return ''
	}
	try {
		return plus.io.convertLocalFileSystemURL(localUrl) || ''
	} catch (e) {
		return ''
	}
}

/**
 * 字节 → ISO-8859-1 字符串（U+0000~U+00FF 与字节一一映射，往返无损）。
 * 分块拼，避免超长字符串拼接退化。
 */
function bytesToLatin1(bytes) {
	let s = ''
	const CH = 8192
	for (let i = 0; i < bytes.length; i += CH) {
		s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)))
	}
	return s
}

/**
 * 写法一：OutputStreamWriter + ISO-8859-1。
 *
 * 只往 Java 传**字符串**（Java 侧自己按 ISO-8859-1 编码成字节）。
 * 字符串是 Native.js 最基础的编组操作，最可能可靠。
 */
async function writeViaWriter(os, chunks, trace) {
	const OutputStreamWriter = plus.android.importClass('java.io.OutputStreamWriter')
	if (!OutputStreamWriter) throw new Error('importClass 返回空（java.io）')
	const w = new OutputStreamWriter(os, 'ISO-8859-1')
	let total = 0
	for await (const chunk of chunks) {
		if (!chunk || !chunk.length) continue
		trace.push('encode')
		const text = bytesToLatin1(chunk)
		trace.push('write')
		callJava(w, 'write', text)
		total += chunk.length
	}
	callJava(w, 'flush')
	callJava(w, 'close')
	return total
}

/**
 * 写法二：java.lang.String.getBytes('ISO-8859-1') → OutputStream.write(byte[])。
 *
 * ⚠️ 真机上这一种**不报错但一个字节都没写进去**（被写入后的大小核对抓住）。
 * 很可能是 byte[] 过桥时编组失败且静默失败。保留它作为备选，
 * 因为不同基座的行为可能不一样。
 */
async function writeViaBytes(os, chunks, trace) {
	const JString = plus.android.importClass('java.lang.String')
	if (!JString) throw new Error('importClass 返回空（java.lang）')
	let total = 0
	for await (const chunk of chunks) {
		if (!chunk || !chunk.length) continue
		trace.push('encode')
		const jbytes = callJava(new JString(bytesToLatin1(chunk)), 'getBytes', 'ISO-8859-1')
		if (!jbytes) throw new Error('字节转换失败（getBytes 返回空）')
		trace.push('write')
		callJava(os, 'write', jbytes)
		total += chunk.length
	}
	callJava(os, 'flush')
	callJava(os, 'close')
	return total
}

/**
 * 把字节块写进 Java OutputStream 的几种写法，按顺序试。
 * 哪种能用只能在真机上验 —— 所以每种写完都要核对实际大小。
 */
const WRITE_STRATEGIES = [
	{ name: 'writer-iso', write: writeViaWriter },
	{ name: 'bytes', write: writeViaBytes },
]

/** 建目录（已存在就算了） */
function ensureDir(absDir) {
	try {
		const File = plus.android.importClass('java.io.File')
		if (!File) return { ok: false, error: 'importClass 返回空（File）' }
		const f = new File(absDir)
		if (!callJava(f, 'exists')) callJava(f, 'mkdirs')
		return { ok: true }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	}
}

/**
 * 字节块 → 应用私有目录下的文件。
 * @param {string} absPath 平台绝对路径
 * @param {AsyncIterable<Uint8Array>|Uint8Array[]} chunks
 */
export async function writeFileBytes(absPath, chunks) {
	if (!isAndroid()) {
		return { ok: false, unsupported: true, error: '当前平台不是 Android', trace: '' }
	}
	const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')
	const File = plus.android.importClass('java.io.File')
	if (!FileOutputStream || !File) {
		return { ok: false, error: 'importClass 返回空（基座可能没链入 java.io）', trace: '' }
	}

	const errors = []

	// 和写公共目录一样：两种写法都试，写完核对实际大小。
	// 真机上 byte[] 那种写法「不报错但一个字节都没写进去」。
	for (const st of WRITE_STRATEGIES) {
		const sub = [st.name]
		let out = null
		try {
			sub.push('open')
			out = new FileOutputStream(absPath)
			const total = await st.write(out, chunks, sub)
			out = null

			// 核对：这个文件到底有多大
			sub.push('verify')
			let size = -1
			try {
				size = Number(callJava(new File(absPath), 'length'))
			} catch (e) {
				size = -1
			}
			if (size >= 0 && size !== total) {
				throw new Error(`写了 ${total} 字节，文件实际只有 ${size} 字节`)
			}

			return { ok: true, bytes: total, method: st.name, trace: sub.join(' → ') }
		} catch (e) {
			try {
				if (out) callJava(out, 'close')
			} catch (e2) {
				/* 关不上就算了 */
			}
			errors.push(`${st.name}: ${String((e && e.message) || e)}`)
		}
	}

	return { ok: false, error: errors.join('  ｜  '), trace: '' }
}

/** 把照片字节写进私有目录（恢复备份时用） */
export async function writePhotoFile(bytes, name) {
	if (!hasPlus()) return { ok: false, error: '当前平台不支持保存照片' }
	const absDir = absPathOf('_doc/food/')
	if (!absDir) return { ok: false, error: '拿不到照片目录路径' }
	const dir = ensureDir(absDir)
	if (!dir.ok) return dir
	const res = await writeFileBytes(absPathOf(`_doc/food/${name}`), [bytes])
	if (!res.ok) return res
	return { ok: true, path: `_doc/food/${name}` }
}

/** 删掉私有目录里的文件（清理临时文件） */
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
 * 查 MediaStore 里某个文件实际有多大（查不到返回 -1）。
 *
 * 用来核对「写完了到底有没有东西」。真机踩过一次：
 * 写入不报错、一个字节也没进去，而当时只能靠一遍遍试才发现。
 */
function querySize(resolver, uri) {
	try {
		const MediaColumns = plus.android.importClass('android.provider.MediaStore$MediaColumns')
		const cursor = callJava(resolver, 'query', uri, null, null, null, null)
		if (!cursor) return -1
		try {
			if (!callJava(cursor, 'moveToFirst')) return -1
			const idx = callJava(cursor, 'getColumnIndex', staticField(MediaColumns, 'SIZE'))
			if (idx < 0) return -1
			return Number(callJava(cursor, 'getLong', idx))
		} finally {
			callJava(cursor, 'close')
		}
	} catch (e) {
		// 查不了就算了 —— 不因为「没法核对」而判失败
		return -1
	}
}

/**
 * 字节 → 公共「下载」目录里的一个文件。
 *
 * 直接写进 MediaStore 给的输出流，**不经手中转文件**。
 * 早先的写法是「先写 _doc 临时文件 → 用 android.os.FileUtils.copy 拷进下载」，
 * 真机上那一步一个字节都没拷过去（文件是 0 字节）却没报错 ——
 * 而 android.os.FileUtils 本来就是 AOSP 的隐藏 API，
 * Android 9+ 对非 SDK 接口有反射限制。所以整条中转去掉。
 */
export async function writeBytesToDownloads(bytes, filename) {
	const trace = []
	if (!isAndroid()) {
		return { ok: false, unsupported: true, error: '当前平台不是 Android', trace: '' }
	}
	if (androidSdk() < 29) {
		return { ok: false, unsupported: true, error: 'Android 10 以下暂不支持', trace: '' }
	}

	plus.android.importClass('android.content.ContentResolver')
	plus.android.importClass('java.io.OutputStream')
	const Downloads = plus.android.importClass('android.provider.MediaStore$Downloads')
	const ContentValues = plus.android.importClass('android.content.ContentValues')
	if (!Downloads || !ContentValues) {
		return {
			ok: false,
			error: 'importClass 返回空（该基座可能没链入 MediaStore）',
			trace: '',
		}
	}

	const errors = []

	// 两种写入写法都试，每种写完都回查实际大小。
	// 真机上 byte[] 那种写法就是「不报错但一个字节都没写进去」，
	// 所以「写完核对」不是多余的，是必需的。
	for (const st of WRITE_STRATEGIES) {
		const sub = [st.name]
		let resolver = null
		let uri = null
		try {
			sub.push('new ContentValues')
			const values = new ContentValues()
			callJava(values, 'put', staticField(Downloads, 'DISPLAY_NAME'), filename)
			callJava(values, 'put', staticField(Downloads, 'MIME_TYPE'), 'application/zip')
			callJava(values, 'put', staticField(Downloads, 'RELATIVE_PATH'), 'Download')

			sub.push('getContentResolver')
			const main = plus.android.runtimeMainActivity()
			resolver = callJava(main, 'getContentResolver')
			if (!resolver) throw new Error('getContentResolver 返回空')

			sub.push('insert')
			uri = callJava(
				resolver,
				'insert',
				staticField(Downloads, 'EXTERNAL_CONTENT_URI'),
				values
			)
			if (!uri) throw new Error('系统拒绝创建文件（MediaStore 没返回 uri）')

			sub.push('openOutputStream')
			const os = callJava(resolver, 'openOutputStream', uri)
			if (!os) throw new Error('无法打开输出流')

			const total = await st.write(os, [bytes], sub)
			if (!total) throw new Error('一个字节都没写进去')

			sub.push('verify')
			const written = querySize(resolver, uri)
			if (written >= 0 && written !== total) {
				throw new Error(`写了 ${total} 字节，实际只有 ${written} 字节`)
			}

			sub.push('ok')
			return {
				ok: true,
				where: `下载/${filename}`,
				bytes: total,
				method: st.name,
				trace: sub.join(' → '),
			}
		} catch (e) {
			// 这次尝试失败：把建出来的（可能空/半截的）文件删掉，再试下一种写法
			try {
				if (uri && resolver) callJava(resolver, 'delete', uri, null, null)
			} catch (e2) {
				/* 清理失败就算了 */
			}
			errors.push(`${st.name}: ${String((e && e.message) || e)}`)
			trace.push(sub.join(' → '))
		}
	}

	return {
		ok: false,
		error: errors.join('  ｜  '),
		trace: trace.join(' ； '),
	}
}

/**
 * 读一个 content:// uri（SAF 选来的文件）→ base64。
 *
 * 全程原生：openInputStream → readAllBytes → Base64.encodeToString。
 * 不再「先落临时文件再用 plus.io 读」—— 真机上那一套读出来是空文件。
 * readAllBytes 是 API 26+ 的。
 *
 * @returns {Promise<{ok:boolean, base64?:string, error?:string, trace?:string}>}
 */
export async function readUriBase64(uri, opts = {}) {
	const trace = []
	if (!isAndroid()) {
		return { ok: false, unsupported: true, error: '当前平台不是 Android', trace: '' }
	}
	const limit = Number(opts.limit) || 0
	try {
		trace.push('importClass')
		plus.android.importClass('java.io.InputStream')
		const Base64 = plus.android.importClass('android.util.Base64')
		if (!Base64) throw new Error('importClass 返回空（基座可能没链入 android.util）')

		trace.push('getContentResolver')
		const main = plus.android.runtimeMainActivity()
		const resolver = callJava(main, 'getContentResolver')
		if (!resolver) throw new Error('getContentResolver 返回空')

		trace.push('openInputStream')
		const input = callJava(resolver, 'openInputStream', uri)
		if (!input) throw new Error('无法打开输入流')

		// 先问一下大小：读进来会 base64 膨胀 33%，太大就别读了
		if (limit) {
			trace.push('available')
			let size = 0
			try {
				size = Number(callJava(input, 'available')) || 0
			} catch (e) {
				size = 0
			}
			if (size > limit) {
				callJava(input, 'close')
				return { ok: false, error: '这个备份文件太大了，当前版本不支持', trace: trace.join(' → ') }
			}
		}

		trace.push('readAllBytes')
		const bytes = callJava(input, 'readAllBytes')
		callJava(input, 'close')
		if (!bytes) throw new Error('readAllBytes 返回空')

		trace.push('encodeToString')
		const b64 = callJava(Base64, 'encodeToString', bytes, staticField(Base64, 'NO_WRAP'))
		if (!b64) throw new Error('读到的内容是空的（文件可能是 0 字节）')

		trace.push('ok')
		return { ok: true, base64: String(b64), trace: trace.join(' → ') }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e), trace: trace.join(' → ') }
	}
}

/**
 * 让用户选一个文件（SAF，ACTION_OPEN_DOCUMENT），直接读成 base64。
 *
 * ⚠️ 这条路最不确定：要重写 Activity.onActivityResult。
 * 真机实测回调**能正常触发**（trace 里的 called:xxxxx），所以：
 *   1. 先把原回调存起来，用完还原
 *   2. 加超时，回调不触发也不会让界面一直卡着
 *   3. 全程 trace
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
			plus.android.importClass('android.content.ContentResolver')
			const Intent = plus.android.importClass('android.content.Intent')
			if (!Intent) throw new Error('importClass 返回空（基座可能没链入 android.content）')

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
					// 直接读成 base64，不再落临时文件
					readUriBase64(uri, { limit: opts.limit }).then((r) => {
						if (r.ok) done({ ok: true, base64: r.base64 })
						else done({ ok: false, error: r.error, inner: r.trace })
					})
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
