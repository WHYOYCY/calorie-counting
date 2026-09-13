/**
 * 备份文件的落盘 / 复制（平台差异都收敛在这里）
 *
 * 用运行时特性探测而非条件编译，好处是本模块在 Node 里也能安全 import。
 */
import { todayKey } from './date.js'

export function backupFileName() {
	return `calorie-backup-${todayKey()}.json`
}

/**
 * 把备份写入设备文件。
 * App 端写进应用私有目录（_doc），H5 触发浏览器下载。
 * @returns Promise<{ok:boolean, path?:string, mode?:string, error?:string}>
 */
export function writeBackupFile(json, filename = backupFileName()) {
	return new Promise((resolve) => {
		// App 端
		if (typeof plus !== 'undefined' && plus && plus.io && plus.io.requestFileSystem) {
			plus.io.requestFileSystem(
				plus.io.PRIVATE_DOC,
				(fs) => {
					fs.root.getFile(
						filename,
						{ create: true },
						(entry) => {
							entry.createWriter(
								(writer) => {
									writer.onwrite = () =>
										resolve({ ok: true, path: entry.fullPath, mode: 'file' })
									writer.onerror = () => resolve({ ok: false, error: '写入失败' })
									writer.write(json)
								},
								() => resolve({ ok: false, error: '无法创建写入器' })
							)
						},
						() => resolve({ ok: false, error: '无法创建文件' })
					)
				},
				() => resolve({ ok: false, error: '无法访问应用目录' })
			)
			return
		}

		// H5：浏览器下载
		if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
			try {
				const blob = new Blob([json], { type: 'application/json' })
				const url = URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = filename
				a.click()
				setTimeout(() => URL.revokeObjectURL(url), 1000)
				resolve({ ok: true, mode: 'download' })
			} catch (e) {
				resolve({ ok: false, error: '浏览器下载失败' })
			}
			return
		}

		resolve({ ok: false, error: 'unavailable' })
	})
}

/** 复制到剪贴板（各端通用兜底） */
export function copyText(text) {
	return new Promise((resolve) => {
		if (typeof uni === 'undefined' || typeof uni.setClipboardData !== 'function') {
			resolve({ ok: false })
			return
		}
		uni.setClipboardData({
			data: text,
			success: () => resolve({ ok: true }),
			fail: () => resolve({ ok: false }),
		})
	})
}
