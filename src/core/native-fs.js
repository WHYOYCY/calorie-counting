/**
 * 原生文件落盘（受限使用）
 *
 * ⚠️ 这个模块里的代码无法在开发机上执行 —— 只能在真机上验证。
 * 因此这里只做一件事，并且：
 *   1. 每一步都 try/catch，失败一律返回 { ok:false, error }，绝不抛给调用方
 *   2. 调用方必须准备降级路径（分享 → 剪贴板）
 *   3. 提供 probe()，让用户点「诊断」就能把具体报错发出来
 *
 * 为什么需要它：安卓 11 起强制分区存储，应用私有目录（Android/data/…）
 * 文件管理器进不去，`plus.io` 也写不进公共目录
 * （plus.io.PUBLIC_DOWNLOADS 实测仍解析到应用私有目录）。
 * 想真的落到用户能看到的地方，只有走 MediaStore 或 SAF。
 *
 * 这里选 MediaStore 而不是 SAF：SAF 要重写 Activity.onActivityResult，
 * 社区多个反馈它「开界面时就被调用、真返回时反而不触发」，时序不可靠；
 * 而 MediaStore 是「直接写入」，没有回调时序问题。
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
 * 能力探测：界面上「诊断」用，也让调用方决定要不要尝试。
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

/**
 * 把文本写进公共「下载」目录，返回文件在系统中的位置。
 *
 * 用 OutputStreamWriter 而不是 write(byte[])：Native.js 里 JSON 字符串
 * 转 java byte[] 需要额外绕，而 Writer 可以直接吃字符串。
 *
 * @returns Promise<{ok:boolean, where?:string, error?:string}>
 */
export function saveToDownloads(text, filename) {
	return new Promise((resolve) => {
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

		try {
			const Downloads = plus.android.importClass('android.provider.MediaStore$Downloads')
			const ContentValues = plus.android.importClass('android.content.ContentValues')
			const OutputStreamWriter = plus.android.importClass('java.io.OutputStreamWriter')

			const main = plus.android.runtimeMainActivity()
			const resolver = main.getContentResolver()

			const values = new ContentValues()
			values.put(Downloads.DISPLAY_NAME, filename)
			values.put(Downloads.MIME_TYPE, 'application/json')
			values.put(Downloads.RELATIVE_PATH, 'Download')

			const uri = resolver.insert(Downloads.EXTERNAL_CONTENT_URI, values)
			if (!uri) {
				resolve({ ok: false, error: '系统拒绝创建文件（MediaStore 返回空）' })
				return
			}

			const os = resolver.openOutputStream(uri)
			if (!os) {
				resolve({ ok: false, error: '无法打开输出流' })
				return
			}

			const writer = new OutputStreamWriter(os, 'UTF-8')
			writer.write(text)
			writer.flush()
			writer.close()

			resolve({ ok: true, where: `下载/${filename}` })
		} catch (e) {
			resolve({ ok: false, error: String((e && e.message) || e) })
		}
	})
}
