// 冒烟测试种子页生成器
// 往 H5 构建产物里写一个 seed.html：先灌入构造好的记录，再跳转到首页，
// 这样无头浏览器 dump 出来的 DOM 就是「有数据状态」，可验证数据绑定是否正确。
// 用法: node scripts/seed-smoke.mjs  然后用无头浏览器打开 /seed.html
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist/build/h5')

if (!fs.existsSync(DIST)) {
	console.error(`构建产物不存在: ${DIST}\n请先执行 npm run build:h5`)
	process.exit(1)
}

const pad = (n) => String(n).padStart(2, '0')
const now = new Date()
const KEY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const at = (h, mi) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi).getTime()

const RICE = { name: '米饭', grams: 200, per100: { kcal: 116, protein: 2.6, fat: 0.3, carbs: 25.9 } }
const EGG = { name: '鸡蛋', grams: 50, per100: { kcal: 144, protein: 13.3, fat: 8.8, carbs: 2.8 } }
const KUNGFU = { name: '宫保鸡丁', grams: 150, per100: { kcal: 180, protein: 12, fat: 10, carbs: 9 } }
const NOODLE = { name: '面条', grams: 300, per100: { kcal: 137, protein: 4.5, fat: 0.5, carbs: 28 } }

function rec(id, hour, min, meal, items) {
	const ts = at(hour, min)
	return {
		id,
		ts,
		date: KEY,
		meal,
		items,
		photo: '',
		note: '',
		source: 'manual',
		createdAt: ts,
		updatedAt: ts,
	}
}

const RECORDS = [
	rec('seed-b1', 8, 30, 'breakfast', [RICE, EGG]),
	rec('seed-l1', 12, 30, 'lunch', [KUNGFU, RICE]),
	rec('seed-d1', 19, 0, 'dinner', [NOODLE]),
]

const SETTINGS = {
	apiKey: 'sk-seed-demo',
	baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	model: 'qwen3-vl-flash',
	dailyGoal: 1800,
	autoMacro: true,
	macroGoals: { protein: 90, fat: 50, carbs: 248 },
	storePhoto: true,
}

// uni-app H5 的存储格式为 JSON.stringify({ type, data })
const wrap = (v) => JSON.stringify({ type: typeof v, data: v })

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>seed</title></head>
<body>
<script>
localStorage.clear();
localStorage.setItem('cc_records', ${JSON.stringify(wrap(JSON.stringify(RECORDS)))});
localStorage.setItem('cc_settings', ${JSON.stringify(wrap(JSON.stringify(SETTINGS)))});
localStorage.setItem('cc_meta', ${JSON.stringify(
	wrap(JSON.stringify({ schemaVersion: 1 }))
)});
localStorage.setItem('uni-storage-keys', ${JSON.stringify(
	wrap(JSON.stringify(['cc_records', 'cc_settings', 'cc_meta']))
)});
location.replace('/#/pages/index/index');
</script>
</body></html>
`

const out = path.join(DIST, 'seed.html')
fs.writeFileSync(out, html)
console.log(`✓ 已生成 ${out}`)
console.log(`  日期键: ${KEY}`)
console.log('  预期合计: 1217 kcal（早餐 304 / 午餐 502 / 晚餐 411）')
