/**
 * UTF-8 编解码（纯逻辑，不依赖平台）
 *
 * 单独一个文件：备份链路（fullbackup.js）与文件写入核对（plusio.js）
 * 都要用，而**字符数 ≠ 字节数**这件事踩过一次坑了 ——
 * 备份 JSON 里有中文，拿 length 去比文件大小必然对不上。
 * 所以这里只留一份实现，两边都用它。
 */

export function utf8Bytes(str) {
	// 不依赖 TextEncoder：App 旧内核里不一定有
	const s = String(str)
	const out = []
	for (let i = 0; i < s.length; i++) {
		let c = s.charCodeAt(i)
		if (c < 0x80) {
			out.push(c)
		} else if (c < 0x800) {
			out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
		} else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
			const c2 = s.charCodeAt(i + 1)
			if (c2 >= 0xdc00 && c2 <= 0xdfff) {
				const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
				out.push(
					0xf0 | (cp >> 18),
					0x80 | ((cp >> 12) & 0x3f),
					0x80 | ((cp >> 6) & 0x3f),
					0x80 | (cp & 0x3f)
				)
				i++
			} else {
				out.push(0xef, 0xbf, 0xbd)
			}
		} else {
			out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
		}
	}
	return new Uint8Array(out)
}

/** 字符串按 UTF-8 编码后的字节数（写文件后核对大小要用它，不能用 length） */
export function utf8Length(str) {
	return utf8Bytes(str).length
}

export function utf8Decode(bytes) {
	const b = bytes || new Uint8Array(0)
	let s = ''
	let i = 0
	while (i < b.length) {
		const c = b[i++]
		if (c < 0x80) {
			s += String.fromCharCode(c)
		} else if (c >= 0xc0 && c < 0xe0) {
			s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f))
		} else if (c >= 0xe0 && c < 0xf0) {
			s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f))
		} else {
			const cp =
				((c & 0x07) << 18) |
				((b[i++] & 0x3f) << 12) |
				((b[i++] & 0x3f) << 6) |
				(b[i++] & 0x3f)
			const v = cp - 0x10000
			s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
		}
	}
	return s
}
