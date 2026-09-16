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
export function callJava(obj, name) {
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
export function staticField(cls, name) {
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
 * 把文本写进公共「下载」目录。
 *
 * @returns Promise<{ok:boolean, where?:string, error?:string, trace?:string}>
 */
export async function saveToDownloads(text, filename) {
	// 以前走 Native.js 写 MediaStore 输出流，真机自检证明那条路写入无效
	// （不报错但 0 字节）。改用 plus.io 写文本 —— 唯一验证过能真正写进去的。
	if (!hasPlusIoAvailable()) {
		return { ok: false, unsupported: true, error: '当前平台不支持写文件' }
	}
	const out = resolveOutDir()
	const url = `${out.url}/${filename}`
	const wrote = await plusio.writeText(url, text)
	if (!wrote.ok) return { ok: false, error: wrote.error }
	const size = await plusio.fileSize(url)
	const expect = utf8Len(text)
	if (size !== expect) {
		return { ok: false, error: `写进去 ${size} 字节，期望 ${expect}` }
	}
	return { ok: true, mode: 'file', where: url, absPath: plusio.absOf(url), userVisible: out.visible, bytes: size }
}

function hasPlusIoAvailable() {
	return typeof plus !== 'undefined' && !!(plus && plus.io && plus.io.requestFileSystem)
}

function utf8Len(str) {
	// 只用来核对字节数：中文按 3 字节算
	let n = 0
	const t = String(str)
	for (let i = 0; i < t.length; i++) {
		const c = t.charCodeAt(i)
		if (c < 0x80) n += 1
		else if (c < 0x800) n += 2
		else if (c >= 0xd800 && c <= 0xdbff) {
			n += 4
			i++
		} else n += 3
	}
	return n
}/* ---------------- 完整备份：读写文件 ---------------- */

import { bytesToBase64 } from './zip.js'
import * as plusio from './plusio.js'

/** ISO-8859-1 字符串 → 字节（每个码点低 8 位就是一个字节） */

/* ---------------- 下面这些是给「原生能力自检」用的底层工具 ---------------- */
/*
 * 说明：这个文件曾经有近千行，装着一整套「用 Native.js 写文件」的实现
 * （writeBytesToDownloads / writeFileBytes / readTextFileNative /
 *   pickFileBytes / MediaStore 输出流 …）。
 * 真机自检证明那整套在这台设备上**写入全部无效**（不报错但 0 字节），
 * 所以备份链路改走 plus.io + plus.zip（见 plusio.js），
 * 那些实现已整体删除 —— 留着不工作的代码只会误导后来的人。
 *
 * 保留的只有：环境探测、Native.js 的两个调用工具、以及文本导出的 plus.io 实现。
 * 自检里仍然会探一下那几条 Native.js 路径，用于判断别的机型能不能用。
 */

/** 绝对路径 → java.nio.file.Path（自检用） */
export function pathOf(absPath) {
	const File = plus.android.importClass('java.io.File')
	if (!File) throw new Error('importClass 返回空（java.io.File）')
	return callJava(new File(absPath), 'toPath')
}

/** java.nio.file.Files（自检用） */
export function filesClass() {
	const Files = plus.android.importClass('java.nio.file.Files')
	if (!Files) throw new Error('importClass 返回空（java.nio.file，需 API 26+）')
	return Files
}
