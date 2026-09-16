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
