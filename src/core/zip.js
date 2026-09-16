/**
 * 极简 zip 读写（store 方式，不压缩）
 *
 * 为什么不用 plus.zip：那需要在 manifest 里勾 Zip 模块（还得在 HBuilderX 里配），
 * 而这里只是要把一堆文件装进一个容器 —— 用不着额外的原生模块。
 * 纯 JS 实现的好处是 App / H5 都能用，而且能在 Node 里完整测试。
 *
 * 为什么用 store 而不是 deflate：照片是 JPEG，本来就已经压过了，
 * deflate 收益约 0~3%。而不压缩意味着读取端只需要支持 store，
 * 不必在 JS 里实现 inflate —— 这是本模块能保持这么小的关键。
 *
 * 写是**流式**的：一次只在内存里拿一个文件的字节，
 * 因为备份可能上百 MB，一次性塞进 Uint8Array 会直接把手机搞崩。
 */

/* ---------------- CRC32 ---------------- */

let CRC_TABLE = null

function crcTable() {
	if (CRC_TABLE) return CRC_TABLE
	const t = new Uint32Array(256)
	for (let i = 0; i < 256; i++) {
		let c = i
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		t[i] = c >>> 0
	}
	CRC_TABLE = t
	return t
}

export function crc32(bytes) {
	const t = crcTable()
	let c = 0xffffffff
	for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

/* ---------------- 小工具 ---------------- */

function bytesOf(str) {
	// zip 里的文件名一律按 UTF-8 编码（不设 UTF-8 标志位，
	// 文件名只用 ascii 就足够：backup.json 与 photos/xxx.jpg）
	const out = []
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i)
		if (c < 0x80) out.push(c)
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
		else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
	}
	return new Uint8Array(out)
}

function u16(n) {
	return new Uint8Array([n & 0xff, (n >>> 8) & 0xff])
}

function u32(n) {
	return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])
}

function concat(list) {
	let len = 0
	for (const a of list) len += a.length
	const out = new Uint8Array(len)
	let at = 0
	for (const a of list) {
		out.set(a, at)
		at += a.length
	}
	return out
}

/** MS-DOS 时间/日期（zip 格式规定的老格式，没有时区概念） */
function dosTime(ts) {
	const d = new Date(Number(ts) || 0)
	const time =
		((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31)
	const date =
		(((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
	return { time, date }
}

/* ---------------- 写 ---------------- */

/** zip 的硬上限：单个文件 4GB、条目 65535 个（超出需要 ZIP64，这里不实现） */
export const ZIP_MAX_ENTRIES = 65535

function localHeader(nameBytes, size, crc, ts) {
	const { time, date } = dosTime(ts)
	return concat([
		u32(0x04034b50), // 签名
		u16(20), // 解压所需版本
		u16(0), // 标志位
		u16(0), // 压缩方式 0 = store
		u16(time),
		u16(date),
		u32(crc),
		u32(size), // 压缩后大小（store 下与原始一致）
		u32(size), // 原始大小
		u16(nameBytes.length),
		u16(0), // 扩展字段长度
		nameBytes,
	])
}

function centralHeader(nameBytes, size, crc, offset, ts) {
	const { time, date } = dosTime(ts)
	return concat([
		u32(0x02014b50), // 签名
		u16(20), // 制作版本
		u16(20), // 解压所需版本
		u16(0),
		u16(0),
		u16(time),
		u16(date),
		u32(crc),
		u32(size),
		u32(size),
		u16(nameBytes.length),
		u16(0), // 扩展字段
		u16(0), // 注释
		u16(0), // 起始磁盘号
		u16(0), // 内部属性
		u32(0), // 外部属性
		u32(offset), // 本地头偏移
		nameBytes,
	])
}

function endOfCentralDir(count, cdSize, cdOffset) {
	return concat([
		u32(0x06054b50),
		u16(0),
		u16(0),
		u16(count),
		u16(count),
		u32(cdSize),
		u32(cdOffset),
		u16(0), // 注释长度
	])
}

/**
 * 流式生成一个 store 方式的 zip。
 *
 * @param {Array<{name:string, read:() => Promise<Uint8Array|string>}>} entries
 *        read() 按需返回该文件的字节（可以是 base64 字符串，内部会解码）。
 *        一次只读一个，所以内存占用是「最大的那个文件」而不是总和。
 * @param {{now?:number, onProgress?:(i:number,total:number)=>void}} [opts]
 * @yields {Uint8Array} 按顺序拼起来就是完整的 zip
 */
export async function* zipChunks(entries, opts = {}) {
	const list = entries || []
	if (list.length > ZIP_MAX_ENTRIES) {
		throw new Error(`文件太多（${list.length} 个），超出 zip 上限`)
	}
	const now = Number(opts.now) || Date.now()
	const central = []
	let offset = 0

	for (let i = 0; i < list.length; i++) {
		const e = list[i]
		const raw = await e.read()
		// read() 返回 null 表示这个文件拿不到了（比如照片已经被删）——
		// 跳过它，而不是往 zip 里塞个空文件
		if (raw === null || raw === undefined) {
			if (opts.onProgress) opts.onProgress(i + 1, list.length)
			continue
		}
		const data = typeof raw === 'string' ? base64ToBytes(raw) : raw
		const nameBytes = bytesOf(e.name)
		const crc = crc32(data)

		const head = localHeader(nameBytes, data.length, crc, now)
		yield head
		yield data

		central.push(centralHeader(nameBytes, data.length, crc, offset, now))
		offset += head.length + data.length

		if (opts.onProgress) opts.onProgress(i + 1, list.length)
	}

	const cd = concat(central)
	yield cd
	yield endOfCentralDir(central.length, cd.length, offset)
}

/** base64 → Uint8Array（不依赖 atob，Node 里也能跑） */
export function base64ToBytes(b64) {
	const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
	const clean = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '')
	const len = Math.floor((clean.length * 3) / 4)
	const out = new Uint8Array(len)
	let p = 0
	let buffer = 0
	let bits = 0
	for (let i = 0; i < clean.length; i++) {
		buffer = (buffer << 6) | table.indexOf(clean[i])
		bits += 6
		if (bits >= 8) {
			bits -= 8
			out[p++] = (buffer >> bits) & 0xff
		}
	}
	return p === len ? out : out.subarray(0, p)
}

/** Uint8Array → base64 */
export function bytesToBase64(bytes) {
	const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
	let out = ''
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i]
		const b1 = bytes[i + 1]
		const b2 = bytes[i + 2]
		out += table[b0 >> 2]
		out += table[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)]
		out += b1 === undefined ? '=' : table[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)]
		out += b2 === undefined ? '=' : table[b2 & 63]
	}
	return out
}

/* ---------------- 读 ---------------- */

function rd16(b, p) {
	return b[p] | (b[p + 1] << 8)
}

function rd32(b, p) {
	return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
}

function nameOf(b, p, len) {
	let s = ''
	for (let i = 0; i < len; i++) {
		const c = b[p + i]
		if (c < 0x80) s += String.fromCharCode(c)
		else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (b[p + ++i] & 63))
		else s += String.fromCharCode(((c & 15) << 12) | ((b[p + ++i] & 63) << 6) | (b[p + ++i] & 63))
	}
	return s
}

/**
 * 解析 zip（只支持 store；遇到 deflate 条目会明确报错而不是给出乱码）。
 *
 * 走「中央目录」而不是顺序扫本地头：中央目录是 zip 的正规索引，
 * 条目多、或者前面有别的数据时更可靠。
 *
 * @returns {{ok:boolean, entries?:Array<{name:string, bytes:Uint8Array}>, error?:string}}
 */
export function readZip(bytes) {
	const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
	if (b.length < 22) return { ok: false, error: '文件太小，不像 zip' }

	// 从尾部往前找 EOCD（注释最长 65535，所以最多回看这么多）
	let eocd = -1
	const from = Math.max(0, b.length - 22 - 65535)
	for (let i = b.length - 22; i >= from; i--) {
		if (rd32(b, i) === 0x06054b50) {
			eocd = i
			break
		}
	}
	if (eocd < 0) return { ok: false, error: '找不到 zip 结尾标记（可能不是 zip，或传输中损坏了）' }

	const count = rd16(b, eocd + 10)
	const cdSize = rd32(b, eocd + 12)
	const cdOffset = rd32(b, eocd + 16)
	if (cdOffset + cdSize > b.length) return { ok: false, error: 'zip 索引越界（文件可能被截断）' }

	const entries = []
	let p = cdOffset
	for (let i = 0; i < count; i++) {
		if (rd32(b, p) !== 0x02014b50) {
			return { ok: false, error: `第 ${i + 1} 个条目的索引损坏` }
		}
		const method = rd16(b, p + 10)
		const size = rd32(b, p + 24)
		const nameLen = rd16(b, p + 28)
		const extraLen = rd16(b, p + 30)
		const commentLen = rd16(b, p + 32)
		const localAt = rd32(b, p + 42)
		const name = nameOf(b, p + 46, nameLen)

		if (method !== 0) {
			return {
				ok: false,
				error: `「${name}」是压缩过的条目（zip 里用了 deflate）。请用本应用导出的原始备份文件，不要用其他工具重新打包。`,
			}
		}

		// 本地头里也有名字与扩展字段，长度可能与中央目录不同，要按本地头算数据起点
		if (rd32(b, localAt) !== 0x04034b50) {
			return { ok: false, error: `「${name}」的数据位置损坏` }
		}
		const lNameLen = rd16(b, localAt + 26)
		const lExtraLen = rd16(b, localAt + 28)
		const dataAt = localAt + 30 + lNameLen + lExtraLen
		if (dataAt + size > b.length) {
			return { ok: false, error: `「${name}」的数据不完整` }
		}

		entries.push({ name, bytes: b.subarray(dataAt, dataAt + size) })
		p += 46 + nameLen + extraLen + commentLen
	}

	return { ok: true, entries }
}
