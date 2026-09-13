/**
 * 阿里云百炼（DashScope）OpenAI 兼容接口客户端
 *
 * 端点: POST {baseUrl}/chat/completions
 * 鉴权: Authorization: Bearer {apiKey}
 * 图片: content 数组里放 { type:'image_url', image_url:{ url:'data:image/jpeg;base64,...' } }
 *
 * 本模块把「纯解析逻辑」和「网络调用」分开：
 * extractJson / normalizeRecognition 是纯函数，可在 Node 中单测；
 * recognize / testConnection 才依赖 uni.request。
 */
import { DEFAULT_BASE_URL } from './constants.js'
import { round } from './nutrition.js'

/** 识别提示词 —— 要求严格 JSON，并覆盖「非食物」「营养成分表」两个边界场景 */
export const RECOGNITION_PROMPT = `你是专业的营养估算助手。请分析这张照片并只输出 JSON。

判断与拆分规则：
1. 先判断图中是否有食物。如果只是风景、人物、宠物、纯文字等，返回 {"isFood": false, "reason": "简短说明"}。
2. 有食物时，按「可以独立调整份量的部分」拆成多个条目。例如盖浇饭拆成「米饭」和「宫保鸡丁」；套餐拆成各个菜；火锅按主要食材粗略拆分。
3. 菜名用中文，尽量具体（写「红烧肉」而不是「肉」，写「可乐」而不是「饮料」）。
4. 估算每项的可食部分重量（克）与每 100 克的营养值，参考《中国食物成分表》的常见值。
5. 如果图中有包装上的营养成分表/配料表，优先直接读取其每 100 克的数值，不要自行猜测。
6. 不确定的项把 confidence 调低，并在 note 里说明。

只输出如下结构的 JSON，不要任何解释文字、不要 Markdown 代码块：
{
  "isFood": true,
  "items": [
    {
      "name": "米饭",
      "grams": 200,
      "kcalPer100g": 116,
      "proteinPer100g": 2.6,
      "fatPer100g": 0.3,
      "carbsPer100g": 25.9,
      "confidence": 0.8
    }
  ],
  "note": "可选：整体不确定性或建议"
}

不要输出总热量，我会自行计算。`

/** 测连通用的极简提示词（必须含 JSON 字样，json_object 模式才不报错） */
export const PING_PROMPT = '请只回复这个 JSON：{"ok":true}'

/* ---------------- 纯解析逻辑 ---------------- */

/**
 * 从模型返回的文本里稳健地取出 JSON。
 * 容错：Markdown 代码围栏、前后多余解释文字、BOM。
 */
export function extractJson(text) {
	if (text === null || text === undefined) return null
	let s = String(text).replace(/^\uFEFF/, '').trim()
	if (!s) return null

	// 去掉 ```json ... ``` 围栏
	const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
	if (fence && fence[1]) s = fence[1].trim()

	// 截取首个 { 到最后一个 }，容忍前后有解释文字
	const i = s.indexOf('{')
	const j = s.lastIndexOf('}')
	if (i >= 0 && j > i) s = s.slice(i, j + 1)

	try {
		return JSON.parse(s)
	} catch (e) {
		return null
	}
}

function toNum(v) {
	const n = Number(v)
	return isFinite(n) && n > 0 ? n : 0
}

/**
 * 把模型的原始返回值规范化成 App 内部结构。
 * @returns {{ok:boolean, isFood:boolean, items:Array, note:string, error?:string, reason?:string}}
 */
export function normalizeRecognition(raw) {
	if (!raw || typeof raw !== 'object') {
		return { ok: false, isFood: false, items: [], note: '', error: '模型没有返回可解析的 JSON' }
	}

	if (raw.isFood === false) {
		return {
			ok: true,
			isFood: false,
			items: [],
			note: '',
			reason: String(raw.reason || raw.note || '').trim() || '照片里似乎没有食物',
		}
	}

	const list = Array.isArray(raw.items) ? raw.items : []
	const items = []
	for (const it of list) {
		if (!it || typeof it !== 'object') continue
		const name = String(it.name || '').trim()
		const grams = toNum(it.grams)
		if (!name || grams <= 0) continue
		items.push({
			name,
			grams: round(grams, 0),
			per100: {
				kcal: round(toNum(it.kcalPer100g ?? it.kcal ?? it.kcalPer100), 1),
				protein: round(toNum(it.proteinPer100g ?? it.protein), 1),
				fat: round(toNum(it.fatPer100g ?? it.fat), 1),
				carbs: round(toNum(it.carbsPer100g ?? it.carbs), 1),
			},
			confidence: it.confidence === undefined ? null : round(Number(it.confidence) || 0, 2),
		})
	}

	if (!items.length) {
		return {
			ok: false,
			isFood: true,
			items: [],
			note: '',
			error: '识别结果里没有可用的食物条目',
		}
	}

	return { ok: true, isFood: true, items, note: String(raw.note || '').trim() }
}

/* ---------------- 网络调用 ---------------- */

export function chatUrl(baseUrl) {
	const base = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
	return `${base}/chat/completions`
}

/** HTTP 状态码 → 用户能看懂的中文提示 */
export function httpError(status, body) {
	const detail =
		(body && ((body.error && body.error.message) || body.message || body.code)) || ''
	if (status === 401 || status === 403) return 'API Key 无效或没有权限，请检查设置'
	if (status === 404) return '接口地址或模型不存在'
	if (status === 429) return '请求过于频繁或额度已用尽，请稍后再试'
	if (status === 400) return detail || '请求参数有误（可能是该模型不支持图片输入）'
	if (status >= 500) return '服务端暂时不可用，请稍后再试'
	return detail || `请求失败（HTTP ${status}）`
}

function post(settings, payload, timeout = 60000) {
	return new Promise((resolve) => {
		if (typeof uni === 'undefined' || typeof uni.request !== 'function') {
			resolve({ ok: false, error: '当前环境不支持网络请求' })
			return
		}
		uni.request({
			url: chatUrl(settings.baseUrl),
			method: 'POST',
			timeout,
			header: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${settings.apiKey}`,
			},
			data: payload,
			success: (res) => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					resolve({ ok: true, body: res.data })
				} else {
					resolve({
						ok: false,
						error: httpError(res.statusCode, res.data),
						status: res.statusCode,
					})
				}
			},
			fail: (err) => {
				const msg = (err && err.errMsg) || ''
				resolve({
					ok: false,
					error: /timeout/i.test(msg) ? '识别超时，请检查网络后重试' : '网络请求失败，请检查网络',
					detail: msg,
				})
			},
		})
	})
}

function pickMessage(body) {
	const choices = (body && body.choices) || []
	const first = choices[0]
	if (!first) return ''
	const msg = first.message || {}
	if (typeof msg.content === 'string') return msg.content
	// 少数情况 content 是数组
	if (Array.isArray(msg.content)) {
		return msg.content.map((c) => (typeof c === 'string' ? c : c && c.text) || '').join('')
	}
	return ''
}

/**
 * 识别一张图片。
 * @param {{base64:string, mime?:string, settings:object}} opts
 * @returns {Promise<{ok:boolean, isFood?:boolean, items?:Array, note?:string, error?:string, raw?:string}>}
 */
export async function recognize(opts) {
	const { base64, mime = 'image/jpeg', settings } = opts || {}
	if (!settings || !settings.apiKey) {
		return { ok: false, error: '还没有配置 API Key' }
	}
	if (!base64) {
		return { ok: false, error: '图片数据为空' }
	}

	const payload = {
		model: settings.model,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
					{ type: 'text', text: RECOGNITION_PROMPT },
				],
			},
		],
		// 固定参数（缺口 B7）：贪心解码保证同样输入结果稳定
		temperature: 0,
		max_tokens: 1200,
		response_format: { type: 'json_object' },
	}

	const res = await post(settings, payload)
	if (!res.ok) return { ok: false, error: res.error, detail: res.detail }

	const text = pickMessage(res.body)
	const parsed = extractJson(text)
	if (!parsed) {
		return {
			ok: false,
			error: '模型返回的内容无法解析为 JSON',
			raw: String(text).slice(0, 300),
		}
	}

	const norm = normalizeRecognition(parsed)
	return { ...norm, raw: text }
}

/**
 * 测连通（缺口 C2）：填完 Key 立刻验证，避免带着错 Key 拍了一天才发现。
 * 只发一条纯文本请求，几乎不消耗额度。
 */
export async function testConnection(settings) {
	if (!settings || !settings.apiKey) {
		return { ok: false, error: '请先填写 API Key' }
	}
	const payload = {
		model: settings.model,
		messages: [{ role: 'user', content: PING_PROMPT }],
		temperature: 0,
		max_tokens: 32,
		response_format: { type: 'json_object' },
	}
	const res = await post(settings, payload, 20000)
	if (!res.ok) return { ok: false, error: res.error, detail: res.detail }
	const text = pickMessage(res.body)
	const parsed = extractJson(text)
	return {
		ok: true,
		model: (res.body && res.body.model) || settings.model,
		reply: parsed ? JSON.stringify(parsed) : String(text).slice(0, 60),
	}
}
