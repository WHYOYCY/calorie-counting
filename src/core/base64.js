/**
 * base64 编解码（纯逻辑，不依赖平台）
 *
 * 单独一个文件：zip 时代它住在 zip.js 里，现在备份不再用 zip，
 * 但 Native.js 与字节校验还要用，所以独立出来。
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Uint8Array → base64 字符串 */
export function bytesToBase64(bytes) {
	const b = bytes || new Uint8Array(0)
	let out = ''
	for (let i = 0; i < b.length; i += 3) {
		const b0 = b[i]
		const b1 = i + 1 < b.length ? b[i + 1] : 0
		const b2 = i + 2 < b.length ? b[i + 2] : 0
		out += B64[b0 >> 2]
		out += B64[((b0 & 0x03) << 4) | (b1 >> 4)]
		out += i + 1 < b.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
		out += i + 2 < b.length ? B64[b2 & 0x3f] : '='
	}
	return out
}

/** base64 字符串 → Uint8Array（忽略换行与空白；遇到非法字符即报错） */
export function base64ToBytes(str) {
	const s = String(str || '').replace(/[\s\r\n]/g, '')
	const clean = s.replace(/=+$/, '')
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
	let at = 0
	let buf = 0
	let bits = 0
	for (let i = 0; i < clean.length; i++) {
		const v = B64.indexOf(clean[i])
		if (v < 0) throw new Error(`base64 里有非法字符：${clean[i]}`)
		buf = (buf << 6) | v
		bits += 6
		if (bits >= 8) {
			bits -= 8
			out[at++] = (buf >> bits) & 0xff
		}
	}
	return out.subarray(0, at)
}
