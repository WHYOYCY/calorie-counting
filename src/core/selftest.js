/**
 * 原生能力自检
 *
 * 为什么需要它：真机上 Native.js 有不少操作是「不报错但什么都不做」的 ——
 * FileUtils.copy、OutputStream.write(byte[])、readAllBytes→encodeToString、
 * 带 Charset 的 Files.readString 都这么栽过。这类问题看代码看不出来，
 * 单元测试也测不到（假环境里一切都是好的），只能让设备自己报。
 *
 * 所以把备份链路依赖的底层操作逐个跑一遍，输出一份报告：
 * 哪几条通、哪几条不通、不通报什么错。一次就能看清全貌，
 * 不用再一轮试一个问题。
 */
import { callJava, staticField, pathOf, filesClass, isAndroid, androidSdk } from './native-fs.js'
import { toBase64, deletePhotoFile } from './photo.js'
import * as PIO from './plusio.js'

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

function abs(localUrl) {
	if (typeof plus === 'undefined' || !plus || !plus.io) return ''
	try {
		return plus.io.convertLocalFileSystemURL(localUrl) || ''
	} catch (e) {
		return ''
	}
}

/** 用 plus.io 写一个文本文件，返回是否成功 */
function plusWriteText(localUrl, text) {
	return new Promise((resolve) => {
		if (typeof plus === 'undefined' || !plus || !plus.io || !plus.io.requestFileSystem) {
			resolve({ ok: false, error: 'plus.io 不可用' })
			return
		}
		try {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					fs.root.getFile(
						localUrl.replace(TMP_DIR, ''),
						{ create: true },
						(entry) => {
							entry.createWriter(
								(w) => {
									w.onwrite = () => resolve({ ok: true })
									w.onerror = () => resolve({ ok: false, error: 'plus.io 写入失败' })
									try {
										w.write(text)
									} catch (e) {
										resolve({ ok: false, error: 'plus.io write 异常' })
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
	add(
		'运行环境',
		isAndroid(),
		isAndroid() ? `Android API ${androidSdk()}` : '非 Android / 没有 plus'
	)
	add(
		'plus.io 可用',
		typeof plus !== 'undefined' && !!(plus && plus.io && plus.io.requestFileSystem),
		''
	)
	add(
		'plus.zip 可用',
		typeof plus !== 'undefined' && !!(plus && plus.zip && plus.zip.compress),
		typeof plus !== 'undefined' && plus && plus.zip ? '已启用' : '未启用（需在 HBuilderX 勾 Zip 模块）'
	)

	if (!isAndroid()) {
		return { rows, text: reportOf(rows) }
	}

	/* ---- 2. Native.js 基本调用 ---- */
	try {
		plus.android.importClass('android.content.ContentResolver')
		const main = plus.android.runtimeMainActivity()
		const resolver = callJava(main, 'getContentResolver')
		add('Native.js 基本调用', !!resolver, resolver ? 'getContentResolver 正常' : '返回空')
	} catch (e) {
		add('Native.js 基本调用', false, String((e && e.message) || e))
	}

	/* ---- 3. java.nio.file.Files 能否导入 ---- */
	let hasFiles = false
	try {
		hasFiles = !!filesClass()
		add('导入 java.nio.file.Files', hasFiles, hasFiles ? '可用' : 'importClass 返回空')
	} catch (e) {
		add('导入 java.nio.file.Files', false, String((e && e.message) || e))
	}

	/* ---- 4. RandomAccessFile.writeBytes 写二进制 ---- */
	try {
		const RAF = plus.android.importClass('java.io.RandomAccessFile')
		if (!RAF) throw new Error('importClass 返回空')
		const f = new RAF(abs(TMP_BIN), 'rw')
		callJava(f, 'setLength', 0)
		callJava(f, 'writeBytes', latin1Of(bytes))
		callJava(f, 'close')
		const size = hasFiles ? Number(callJava(filesClass(), 'size', pathOf(abs(TMP_BIN)))) : -1
		add(
			'RandomAccessFile.writeBytes',
			size === 256,
			size === 256 ? '写入 256 字节并核对通过' : `写了 256 字节，实际 ${n(size)} 字节`
		)
	} catch (e) {
		add('RandomAccessFile.writeBytes', false, String((e && e.message) || e))
	}

	/* ---- 5. Files.writeString → Files.readString(1参)【核心】 ---- */
	try {
		callJava(filesClass(), 'writeString', pathOf(abs(TMP_TEXT)), TEST_TEXT)
		let text = null
		let err = ''
		try {
			text = callJava(filesClass(), 'readString', pathOf(abs(TMP_TEXT)))
		} catch (e) {
			err = String((e && e.message) || e)
		}
		const ok = String(text) === TEST_TEXT
		add(
			'Files.writeString → readString(1参)',
			ok,
			ok
				? '往返一致'
				: text
					? `读回来不一致（${String(text).slice(0, 30)}）`
					: `读回来是空${err ? '（' + err + '）' : ''}`
		)
	} catch (e) {
		add('Files.writeString → readString(1参)', false, String((e && e.message) || e))
	}

	/* ---- 6. Files.readAllLines(1参) ---- */
	try {
		const lines = callJava(filesClass(), 'readAllLines', pathOf(abs(TMP_TEXT)))
		let joined = ''
		if (lines) {
			const arr = Array.isArray(lines) ? lines : Array.prototype.slice.call(lines, 0)
			joined = arr.map((l) => String(l)).join('\n')
		}
		const ok = joined.indexOf(TEST_TEXT) === 0
		add(
			'Files.readAllLines(1参)',
			ok,
			ok ? '读回正常' : lines ? `内容不一致（${joined.slice(0, 30)}）` : '返回空'
		)
	} catch (e) {
		add('Files.readAllLines(1参)', false, String((e && e.message) || e))
	}

	/* ---- 7. Files.copy(Path, Path) 原生拷贝 ---- */
	if (hasFiles) {
		try {
			callJava(filesClass(), 'copy', pathOf(abs(TMP_TEXT)), pathOf(abs(TMP_COPY)))
			const size = Number(callJava(filesClass(), 'size', pathOf(abs(TMP_COPY))))
			add(
				'Files.copy(Path, Path)',
				size > 0,
				size > 0 ? `拷出 ${size} 字节` : '拷出来是空文件'
			)
		} catch (e) {
			add('Files.copy(Path, Path)', false, String((e && e.message) || e))
		}
	}

	/* ---- 8. plus.io 读「plus.io 自己写」的文件 ---- */
	const wrote = await plusWriteText(TMP_TEXT, TEST_TEXT)
	if (!wrote.ok) {
		add('plus.io 写文本', false, wrote.error)
		add('plus.io 读 plus.io 写的文件', false, '上一步没写成')
	} else {
		add('plus.io 写文本', true, '写入成功')
		const r = await toBase64(TMP_TEXT, null)
		const back = r.ok ? b64ToText(r.base64) : ''
		const ok = back === TEST_TEXT
		add(
			'plus.io 读 plus.io 写的文件',
			ok,
			ok ? '往返一致' : r.ok ? '读回来内容不一致' : '读取失败'
		)
	}

	/* ---- 9. plus.io 读「Java 写」的文件 ---- */
	{
		const r = await toBase64(TMP_COPY, null)
		const back = r.ok ? b64ToText(r.base64) : ''
		const ok = back.indexOf(TEST_TEXT) === 0
		add(
			'plus.io 读 Java 写的文件',
			ok,
			ok ? '能读' : r.ok ? '读到内容但不对' : '读取失败'
		)
	}

	/* ---- 10. MediaStore 全链路 ---- */
	try {
		const Downloads = plus.android.importClass('android.provider.MediaStore$Downloads')
		const ContentValues = plus.android.importClass('android.content.ContentValues')
		if (!Downloads || !ContentValues) throw new Error('importClass 返回空')
		const values = new ContentValues()
		callJava(values, 'put', staticField(Downloads, 'DISPLAY_NAME'), 'selftest.json')
		callJava(values, 'put', staticField(Downloads, 'MIME_TYPE'), 'application/json')
		callJava(values, 'put', staticField(Downloads, 'RELATIVE_PATH'), 'Download')
		const main = plus.android.runtimeMainActivity()
		const resolver = callJava(main, 'getContentResolver')
		const uri = callJava(
			resolver,
			'insert',
			staticField(Downloads, 'EXTERNAL_CONTENT_URI'),
			values
		)
		if (!uri) throw new Error('insert 返回空')
		const os = callJava(resolver, 'openOutputStream', uri)
		if (!os) throw new Error('openOutputStream 返回空')
		// 用 writeString 那条路写 12 字节，再回查大小
		const OutputStreamWriter = plus.android.importClass('java.io.OutputStreamWriter')
		const w = new OutputStreamWriter(os, 'UTF-8')
		callJava(w, 'write', 'selftest-12b')
		callJava(w, 'flush')
		callJava(w, 'close')
		let got = -1
		try {
			const MediaColumns = plus.android.importClass('android.provider.MediaStore$MediaColumns')
			const cur = callJava(resolver, 'query', uri, null, null, null, null)
			if (cur && callJava(cur, 'moveToFirst')) {
				const idx = callJava(cur, 'getColumnIndex', staticField(MediaColumns, 'SIZE'))
				got = Number(callJava(cur, 'getLong', idx))
			}
			if (cur) callJava(cur, 'close')
		} catch (e) {
			got = -1
		}
		callJava(resolver, 'delete', uri, null, null)
		add(
			'MediaStore 写入 + 回查大小',
			got === 12 || got === -1,
			got === 12
				? '写入 12 字节并核对通过'
				: got === -1
					? '写入执行了，但查不到大小（无法核对）'
					: `写了 12 字节，实际 ${n(got)} 字节`
		)
	} catch (e) {
		add('MediaStore 写入 + 回查大小', false, String((e && e.message) || e))
	}

	/* ---- 11. plus.io copyTo（照片持久化就靠它） ---- */
	try {
		await plusWriteText(`${TMP_DIR}selsrc.txt`, TEST_TEXT)
		const fromAbs = abs(`${TMP_DIR}selsrc.txt`)
		const copied = await new Promise((resolve) => {
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
			'plus.io copyTo（照片持久化）',
			copied.ok && size > 0,
			copied.ok ? (size > 0 ? `复制成功（${size} 字节）` : '复制"成功"但目标是空的') : copied.error
		)
	} catch (e) {
		add('plus.io copyTo（照片持久化）', false, String((e && e.message) || e))
	}

	/* ---- 12. plus.zip 多路径压缩（导出照片靠它） ---- */
	if (PIO.hasZip()) {
		try {
			await plusWriteText(`${TMP_DIR}z1.txt`, 'AAA')
			await plusWriteText(`${TMP_DIR}z2.txt`, 'BBB')
			const z = await PIO.zipCompressMany([`${TMP_DIR}z1.txt`, `${TMP_DIR}z2.txt`], '_doc/cctest/multi.zip')
			if (!z.ok) {
				add('plus.zip 多路径压缩', false, z.error)
			} else {
				await PIO.remove('_doc/cctest/multiout')
				const d = await PIO.zipDecompress('_doc/cctest/multi.zip', '_doc/cctest/multiout')
				if (!d.ok) {
					add('plus.zip 多路径压缩', false, '解压失败：' + d.error)
				} else {
					const w = await PIO.walkDir('_doc/cctest/multiout')
					const names = w.files.map((f) => f.rel)
					add(
						'plus.zip 多路径压缩',
						names.length === 2,
						names.length === 2 ? `解出：${names.join('、')}` : `解出 ${names.length} 个：${names.join('、')}`
					)
				}
			}
		} catch (e) {
			add('plus.zip 多路径压缩', false, String((e && e.message) || e))
		}

		/* ---- 13. 用 zip 做原生复制（照片拷回时用） ---- */
		try {
			await plusWriteText(`${TMP_DIR}z3.txt`, 'COPYME')
			const c = await PIO.copyViaZip(`${TMP_DIR}z3.txt`, '_doc/cctest', 'z3.txt')
			const size = c.ok ? await PIO.fileSize('_doc/cctest/z3.txt') : -1
			add(
				'plus.zip 原生复制',
				c.ok && size > 0,
				c.ok ? (size > 0 ? `复制成功（${size} 字节）` : '解出来的文件是空的') : c.error
			)
		} catch (e) {
			add('plus.zip 原生复制', false, String((e && e.message) || e))
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
	await PIO.remove('_doc/cctest')

	return { rows, text: reportOf(rows) }
}

function latin1Of(bytes) {
	let s = ''
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
	return s
}

function b64ToText(base64) {
	try {
		const bin = typeof atob === 'function' ? atob(base64) : ''
		if (bin) return bin
	} catch (e) {
		/* 下面的手动解码 */
	}
	const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
	const clean = String(base64).replace(/[^A-Za-z0-9+/]/g, '')
	let out = ''
	let buf = 0
	let bits = 0
	for (let i = 0; i < clean.length; i++) {
		buf = (buf << 6) | table.indexOf(clean[i])
		bits += 6
		if (bits >= 8) {
			bits -= 8
			out += String.fromCharCode((buf >> bits) & 0xff)
		}
	}
	return out
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
	return lines.join('\n')
}
