// 本地 mock DashScope —— 不消耗真实额度就能联调整条拍照识别链路
//
// 用法:
//   node scripts/mock-dashscope.mjs [port]        # 默认 5555
//   然后在 App「我的 → 接口地址」填 http://localhost:5555/v1
//
// 注意: 真机访问不了 localhost，请把地址换成电脑的局域网 IP（如 http://192.168.1.5:5555/v1）
import http from 'node:http'

const PORT = Number(process.argv[2]) || 5555

/** 模拟模型返回：一道主食 + 一道荤素 + 一道素菜，并带一段不确定说明 */
const RECOGNITION = {
	isFood: true,
	items: [
		{
			name: '米饭',
			grams: 200,
			kcalPer100g: 116,
			proteinPer100g: 2.6,
			fatPer100g: 0.3,
			carbsPer100g: 25.9,
			confidence: 0.9,
		},
		{
			name: '番茄炒蛋',
			grams: 180,
			kcalPer100g: 74,
			proteinPer100g: 4.2,
			fatPer100g: 4.8,
			carbsPer100g: 4.6,
			confidence: 0.75,
		},
		{
			name: '清炒时蔬',
			grams: 150,
			kcalPer100g: 45,
			proteinPer100g: 2.1,
			fatPer100g: 3.0,
			carbsPer100g: 3.4,
			confidence: 0.6,
		},
	],
	note: '本地 mock 数据，用于不消耗额度的联调。清炒时蔬用油量不确定，误差可能较大。',
}

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function send(res, code, obj) {
	res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS })
	res.end(JSON.stringify(obj))
}

http
	.createServer((req, res) => {
		if (req.method === 'OPTIONS') {
			res.writeHead(204, CORS)
			res.end()
			return
		}

		if (!req.url.includes('/chat/completions')) {
			send(res, 404, { error: { message: `no route for ${req.url}` } })
			return
		}

		const auth = req.headers.authorization || ''
		if (!auth.startsWith('Bearer ') || auth.length < 12) {
			console.log(`← 拒绝: 缺少或畸形的 Authorization (${auth || '空'})`)
			send(res, 401, { error: { message: 'Invalid API-key provided.' } })
			return
		}

		let body = ''
		req.on('data', (c) => {
			body += c
		})
		req.on('end', () => {
			let parsed = {}
			try {
				parsed = JSON.parse(body)
			} catch (e) {
				send(res, 400, { error: { message: 'invalid JSON body' } })
				return
			}

			const hasImage = body.includes('data:image/')
			const model = parsed.model || 'qwen3-vl-flash'
			const content = hasImage ? JSON.stringify(RECOGNITION) : JSON.stringify({ ok: true })

			console.log(
				`← ${hasImage ? '识别请求' : '测连通请求'} · model=${model} · 图片字段=${
					hasImage ? '有' : '无'
				} · body=${(body.length / 1024).toFixed(1)}KB`
			)

			send(res, 200, {
				id: 'chatcmpl-mock',
				object: 'chat.completion',
				created: Math.floor(Date.now() / 1000),
				model,
				choices: [
					{
						index: 0,
						message: { role: 'assistant', content },
						finish_reason: 'stop',
					},
				],
				usage: { prompt_tokens: 1215, completion_tokens: 176, total_tokens: 1391 },
			})
		})
	})
	.listen(PORT, () => {
		console.log(`mock DashScope 已启动: http://localhost:${PORT}/v1`)
		console.log('在 App「我的 → 接口地址」里填上面这个地址即可联调（Key 随便填一段够长的字符串）')
		console.log('真机请改用电脑局域网 IP，例如 http://192.168.1.5:' + PORT + '/v1')
	})
