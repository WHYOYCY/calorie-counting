/**
 * 原生能力自检
 *
 * 为什么需要它：真机上不少原生操作是「不报错但什么都不做」的 ——
 * Native.js 的 FileUtils.copy / OutputStream.write(byte[]) / 带 Charset 的
 * readString 都这么栽过；plus.io 的 entry.copyTo 也是如此（照片因此
 * 从来没被存下来）。这类问题看代码看不出来，单元测试也测不到
 * （假环境里一切都是好的），只能让设备自己报。
 *
 * 所以把**备份链路真正依赖的那几步**逐个跑一遍，输出一份报告：
 * 哪几条通、哪几条不通、不通报什么错。一次就能看清全貌。
 *
 * 报告顺序刻意如此：前面几行是应用真正依赖的路径，
 * 后面几行是「能更省事就好了」的备选路径（不通也不影响用）。
 */
import { callJava, staticField, pathOf, filesClass, isAndroid, androidSdk } from './native-fs.js'
import { deletePhotoFile, readPhotoBase64, writePhotoBase64 } from './photo.js'
import * as PIO from './plusio.js'
import { utf8Length } from './utf8.js'

const TMP_DIR = '_doc/'
const TMP_TEXT = `${TMP_DIR}selftest.txt`
const TMP_BIN = `${TMP_DIR}selftest.bin`
const TMP_COPY = `${TMP_DIR}selftest.copy`

/** 自检用的已知内容（含全部 256 种字节值，能验出编码问题） */
function testBytes() {
	const b = new Uint8Array(256)
	for (let i = 0; i < 256; i++) b[i] = i
	return b
}
const TEST_TEXT = 'CCSELFTEST:hello-世界-0123456789'
/** 一张"照片"：内容是 base64 文本（磁盘上的照片就是这么存的） */
const TEST_PHOTO_B64 =
	'/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

function abs(localUrl) {
	if (typeof plus === 'undefined' || !plus || !plus.io) return ''
	try {
		return plus.io.convertLocalFileSystemURL(localUrl) || ''
	} catch (e) {
		return ''
	}
}

/** 数字 → 可读 */
const n = (v) => (isFinite(v) ? String(v) : String(v))

/**
 * 跑一遍自检。
 * @returns {Promise<{rows:Array<{name:string, ok:boolean|null, detail:string}>, text:string}>}
 */
export async function runSelfTest() {
	const rows = []
	const add = (name, ok, detail) => rows.push({ name, ok, detail: detail || '' })
	const bytes = testBytes()

	/* ---- 1. 环境 ---- */
	add('运行环境', !!abs('_doc'), `${isAndroid() ? 'Android' : '非 Android'}${androidSdk() ? ' / API ' + androidSdk() : ''}`)
	add(
		'plus.io 可用',
		PIO.hasPlusIo(),
		PIO.hasPlusIo() ? '读写文件的基础，必备' : '不可用 —— 照片与备份都无法保存'
	)

	// 导出位置：只要有一个能写就算通过。能不能被文件管理器看到是另一回事
	// （看不到也不影响用，用「分享」把文件发出去就行）——
	// 早先把「私有目录」记成不通，看起来像坏了，其实是正常情况。
	try {
		const targets = await PIO.exportTargets()
		const pub = targets.filter((t) => t.public)
		if (!targets.length) {
			add('导出位置', false, '一个能写的目录都没有')
		} else {
			add(
				'导出位置',
				true,
				pub.length
					? `能直接写到${pub.map((t) => t.label).join('、')}（文件管理器里能看到）`
					: `只能写到${targets[0].label}（私有目录，文件管理器看不到，导出后用「分享」发出去）`
			)
		}
	} catch (e) {
		add('导出位置', false, String((e && e.message) || e))
	}

	/* ---- 2. 应用真正依赖的路径：plus.io 文本读写 ---- */
	let wroteOk = false
	try {
		const w = await PIO.writeTextChecked(TMP_TEXT, TEST_TEXT)
		wroteOk = w.ok
		add(
			'plus.io 写文本 + 核对大小',
			w.ok,
			w.ok ? `写入并回查通过（${w.bytes} 字节）` : w.error
		)
	} catch (e) {
		add('plus.io 写文本 + 核对大小', false, String((e && e.message) || e))
	}

	if (wroteOk) {
		try {
			const r = await PIO.readText(TMP_TEXT)
			const same = r.ok && r.text === TEST_TEXT
			add(
				'plus.io 读文本',
				same,
				same
					? `内容与写入完全一致（含中文），走的是「${r.via}」`
					: r.ok
						? `内容不一致：读到 ${r.text.length} 字符，期望 ${TEST_TEXT.length}`
						: r.error
			)
		} catch (e) {
			add('plus.io 读文本', false, String((e && e.message) || e))
		}
	} else {
		add('plus.io 读文本', false, '上一步没写成')
	}

	/* ---- 公共目录：换手机时文件从这儿进来 ---- */
	try {
		const pubs = await PIO.publicDirCandidates()
		if (!pubs.length) {
			add(
				'手机公共目录',
				null,
				'读不到公共的下载/文档目录。换手机时请用「分享备份文件」把文件发出去；'
					+ '从别的手机导回来时，如果这里读不到，就只能靠应用自己的下载目录。'
			)
		} else {
			const found = await PIO.findBackupsAt(pubs[0].abs, 'calorie-backup')
			const writable = []
			for (const d of pubs) if (await PIO.canWriteAt(d.abs)) writable.push(d.label)
			add(
				'手机公共目录',
				true,
				`能读 ${pubs.map((x) => x.label).join('、')}`
					+ (writable.length ? `，且能写入 ${writable.join('、')}` : '（但写不进去，导出还得靠分享）')
					+ (found.length ? `；里面有 ${found.length} 个备份文件` : '')
			)
		}
	} catch (e) {
		add('手机公共目录', false, String((e && e.message) || e))
	}

	/* ---- 3. 照片落盘往返（照片就是这么存的） ---- */
	try {
		const w = await writePhotoBase64('selftest_photo.b64', TEST_PHOTO_B64)
		if (!w.ok) {
			add('照片落盘往返（.b64）', false, w.error)
		} else {
			const r = await readPhotoBase64(w.path)
			const same = r.ok && r.base64 === TEST_PHOTO_B64
			add(
				'照片落盘往返（.b64）',
				same,
				same
					? `存入再读回完全一致（${TEST_PHOTO_B64.length} 字符）—— 照片不会丢`
					: r.ok
						? `读回来的内容不一致（${(r.base64 || '').length} 字符）`
						: r.error
			)
		}
	} catch (e) {
		add('照片落盘往返（.b64）', false, String((e && e.message) || e))
	}

	/* ---- 4. 备份文本往返（一个 JSON 文本文件） ---- */
	try {
		const payload = { format: 'cc-full-backup', records: [{ name: '测试-米饭', kcal: 116 }], photos: [] }
		const text = JSON.stringify(payload)
		const w = await PIO.writeTextChecked('_doc/selftest_backup.json', text)
		if (!w.ok) {
			add('备份文本往返', false, w.error)
		} else {
			const r = await PIO.readText('_doc/selftest_backup.json')
			let ok = false
			let detail = r.error || '读回来是空'
			if (r.ok && r.text) {
				try {
					ok = JSON.stringify(JSON.parse(r.text)) === text
					detail = ok ? '写入 → 读回 → 解析 全部一致' : '解析回来的内容不一致'
				} catch (e) {
					detail = '读回来的不是合法 JSON'
				}
			}
			add('备份文本往返', ok, detail)
		}
	} catch (e) {
		add('备份文本往返', false, String((e && e.message) || e))
	}

	/* ---- 5. 备选路径：plus.io copyTo（照片早期用它，真机上静默失败） ---- */
	try {
		const written = await PIO.writeText(`${TMP_DIR}selsrc.txt`, TEST_TEXT)
		const fromAbs = abs(`${TMP_DIR}selsrc.txt`)
		const copied = await new Promise((resolve) => {
			if (typeof plus === 'undefined' || !plus || !plus.io) {
				resolve({ ok: false, error: 'plus.io 不可用' })
				return
			}
			if (!written.ok) {
				resolve({ ok: false, error: '前面的写入就没成，这条没法验' })
				return
			}
			plus.io.resolveLocalFileSystemURL(
				fromAbs,
				(entry) => {
					plus.io.requestFileSystem(
						plus.io.PRIVATE_DOC,
						(fs) => {
							fs.root.getDirectory(
								'cctest',
								{ create: true },
								(dir) => {
									entry.copyTo(
										dir,
										'seldst.txt',
										() => resolve({ ok: true }),
										(e) => resolve({ ok: false, error: '复制失败：' + ((e && e.message) || e) })
									)
								},
								() => resolve({ ok: false, error: '建目录失败' })
							)
						},
						() => resolve({ ok: false, error: '访问文件系统失败' })
					)
				},
				() => resolve({ ok: false, error: '源文件不存在' })
			)
		})
		let size = -1
		if (copied.ok) size = await PIO.fileSize('_doc/cctest/seldst.txt')
		add(
			'plus.io copyTo（备选）',
			copied.ok && size > 0,
			copied.ok
				? size > 0
					? `复制成功（${size} 字节）`
					: '复制"成功"但目标是空的（就是这个坑让照片一直丢）'
				: copied.error
		)
	} catch (e) {
		add('plus.io copyTo（备选）', false, String((e && e.message) || e))
	}

	/* ---- 6. Native.js：目前应用不依赖，仅作记录 ---- */
	let resolver = null
	try {
		const Context = staticField('android.content.Context', 'CONTENT_RESOLVER')
		const ActivityThread = callJava('android.app.ActivityThread', 'currentApplication')
		resolver = Context && ActivityThread ? callJava(ActivityThread, 'getContentResolver') : null
		add('Native.js 基本调用', !!resolver, resolver ? 'getContentResolver 正常' : '返回空')
	} catch (e) {
		add('Native.js 基本调用', false, String((e && e.message) || e))
	}

	let hasFiles = false
	try {
		hasFiles = !!filesClass()
		add('导入 java.nio.file.Files', hasFiles, hasFiles ? '可用' : 'importClass 返回空')
	} catch (e) {
		add('导入 java.nio.file.Files', false, String((e && e.message) || e))
	}

	if (hasFiles) {
		try {
			const p = pathOf(`${TMP_DIR}selftest.bin`)
			const Files = filesClass()
			const latin = String.fromCharCode.apply(null, Array.from(bytes))
			callJava(Files, 'writeString', p, latin, 'ISO-8859-1')
			const size = await PIO.fileSize(TMP_BIN)
			add(
				'Files.writeString',
				size === 256,
				size === 256 ? '写入 256 字节成功' : `写了 256 字节，实际 ${size} 字节`
			)
		} catch (e) {
			add('Files.writeString', false, String((e && e.message) || e))
		}

		try {
			const p = pathOf(`${TMP_DIR}selftest.bin`)
			const Files = filesClass()
			let got = ''
			try {
				got = callJava(Files, 'readString', p)
			} catch (e) {
				got = ''
			}
			add(
				'Files.readString（1 参）',
				!!got && got.length === 256,
				got ? `读回 ${got.length} 字符` : '读回来是空'
			)
		} catch (e) {
			add('Files.readString（1 参）', false, String((e && e.message) || e))
		}
	}

	/* ---- 清理 ---- */
	for (const p of [TMP_TEXT, TMP_BIN, TMP_COPY]) {
		try {
			deletePhotoFile(p)
		} catch (e) {
			/* 清理失败无所谓 */
		}
	}
	for (const p of [
		`${TMP_DIR}selftest_photo.b64`,
		`${TMP_DIR}selftest_backup.json`,
		`${TMP_DIR}selsrc.txt`,
		'_doc/cctest',
	]) {
		try {
			await PIO.remove(p)
		} catch (e) {
			/* 清理失败无所谓 */
		}
	}

	return { rows, text: reportOf(rows) }
}

/** 生成可复制的报告文本 */
export function reportOf(rows) {
	const lines = ['卡路里记录 · 原生能力自检', '']
	for (const r of rows) {
		const mark = r.ok === true ? '通过' : r.ok === false ? '不通' : '跳过'
		lines.push(`[${mark}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
	}
	const bad = rows.filter((r) => r.ok === false)
	lines.push('')
	lines.push(bad.length ? `${bad.length} 项不通：${bad.map((r) => r.name).join('、')}` : '全部通过')
	const need = rows.filter((r) => r.ok === false && r.name.indexOf('备选') < 0 && r.name.indexOf('Native.js') < 0)
	if (need.length) {
		lines.push(`其中影响备份/照片的：${need.map((r) => r.name).join('、')}`)
	}
	return lines.join('\n')
}

export { utf8Length }
