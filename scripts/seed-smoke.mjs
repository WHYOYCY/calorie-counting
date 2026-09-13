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
const BUN = { name: '小笼包', grams: 150, per100: { kcal: 240, protein: 9, fat: 10, carbs: 28 } }
const SOYMILK = { name: '豆浆', grams: 250, per100: { kcal: 31, protein: 3, fat: 1.6, carbs: 1.2 } }
// 这一餐特意让「米饭」不是热量最高的，用来验证列表标题选的是主菜而不是先录入的米饭
const EGG_MEAT = { name: '滑蛋炒肉片', grams: 150, per100: { kcal: 180, protein: 12, fat: 10, carbs: 6 } }
const PICKLE = { name: '酸菜', grams: 50, per100: { kcal: 30, protein: 1, fat: 0.2, carbs: 4 } }
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

// 加餐留空，用来验证「未记录餐次保留淡色占位」的效果
const RECORDS = [
	rec('seed-b1', 8, 30, 'breakfast', [BUN, SOYMILK]),
	rec('seed-l1', 12, 30, 'lunch', [RICE, EGG_MEAT, PICKLE]),
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

// 顺手算出预期值，方便截图时对照（与 core/nutrition 同一套算式）
const r1 = (n) => Math.round(n * 10) / 10
const kcalOf = (items) =>
	items.reduce((s, it) => r1(s + r1((it.per100.kcal * it.grams) / 100)), 0)
const per = (mealKey) => {
	const items = RECORDS.filter((r) => r.meal === mealKey).reduce(
		(all, r) => all.concat(r.items),
		[]
	)
	return kcalOf(items)
}
const total = r1(RECORDS.reduce((s, r) => r1(s + kcalOf(r.items)), 0))

console.log(`✓ 已生成 ${out}`)
console.log(`  日期键: ${KEY}`)
console.log(`  预期合计: ${total} kcal`)
console.log(
	`  分餐次: 早餐 ${per('breakfast')} / 午餐 ${per('lunch')} / 晚餐 ${per('dinner')} / 加餐 ${per('snack')}`
)
console.log(`  午餐主菜应为「滑蛋炒肉片」（270），米饭（232）应降为次级标签`)
