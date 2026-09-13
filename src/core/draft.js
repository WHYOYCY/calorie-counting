/**
 * 识别结果 → 编辑页 的内存中转
 *
 * 为什么不走 URL 参数：识别结果（多个条目 + 营养素）序列化后会很长，
 * navigateTo 的 query 长度在部分平台有限制，且中文需要额外编码。
 * 内存中转最简单可靠；编辑页 take 一次后即清空，避免重复填入。
 */

let draft = null

export function setDraft(d) {
	draft = d || null
}

/** 取出并清空 */
export function takeDraft() {
	const d = draft
	draft = null
	return d
}

export function peekDraft() {
	return draft
}

export function clearDraft() {
	draft = null
}
