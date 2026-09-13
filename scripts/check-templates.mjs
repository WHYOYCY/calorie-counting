// 模板绑定静态检查
//
// 为什么需要它：`<script setup>` 里没声明、但模板里引用了的标识符，
// 单元测试完全抓不到（逻辑层本身是对的），只在真机/浏览器渲染时才炸：
//   [Vue warn] Property "xxx" was accessed during render but is not defined
//   TypeError: _ctx.xxx is not a function
//
// 本脚本把模板里引用到的标识符和脚本里声明过的名字做差集，提前报出来。
//
// 用法: node scripts/check-templates.mjs   （或 npm run check）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '../src')

/** JS 关键字与内置全局，不算未声明 */
const ALLOWED = new Set([
	'true', 'false', 'null', 'undefined', 'this', 'new', 'typeof', 'instanceof',
	'in', 'of', 'void', 'delete', 'return', 'if', 'else', 'for', 'while',
	'function', 'class', 'const', 'let', 'var', 'await', 'async', 'try',
	'catch', 'finally', 'throw', 'switch', 'case', 'break', 'continue', 'do',
	'default', 'yield', 'NaN', 'Infinity',
	'Math', 'JSON', 'Number', 'String', 'Boolean', 'Object', 'Array', 'Date',
	'RegExp', 'Map', 'Set', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
	'console', 'window', 'document',
	// Vue 模板内置
	'$event', '$slots', '$attrs', '$refs', '$props', '$emit', '$set',
])

/** 去掉字符串/模板字面量，避免把里面的词当标识符 */
function stripLiterals(s) {
	return s
		.replace(/'(?:[^'\\]|\\.)*'/g, "''")
		.replace(/"(?:[^"\\]|\\.)*"/g, '""')
		.replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/** 从一段表达式里取出「裸引用」的标识符（跳过 a.b 里的 b、以及对象字面量的 key） */
function identifiersIn(expr) {
	const s = stripLiterals(expr)
	const out = new Set()
	// 不能用 \b 开头：$event 的 $ 不是单词字符，\b 会把它切成 event
	// 标识符字符全在字符类里，全局正则会从左向右贪心匹配，
	// 所以匹配点必然落在标识符开头，不会切到中间
	const re = /(\.\s*)?([A-Za-z_$][A-Za-z0-9_$]*)/g
	let m
	while ((m = re.exec(s))) {
		if (m[1]) continue // 属性访问，如 g.totals 里的 totals
		const rest = s.slice(re.lastIndex)
		if (/^\s*:/.test(rest)) continue // 对象字面量的 key
		out.add(m[2])
	}
	return out
}

/** 收集 <script setup> 里声明的名字 */
function declaredNames(script) {
	const names = new Set()

	// import { a, b as c } from '...'
	for (const m of script.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
		for (const part of m[1].split(',')) {
			const seg = part.trim()
			if (!seg) continue
			const alias = seg.split(/\s+as\s+/)
			const n = (alias[1] || alias[0] || '').trim()
			if (n) names.add(n)
		}
	}
	// import X from '...'
	for (const m of script.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1])
	// const/let/var 声明（含解构）
	for (const m of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
	for (const m of script.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
	for (const m of script.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
		for (const part of m[1].split(',')) {
			const n = part.split(':').pop().replace(/=[\s\S]*$/, '').trim()
			if (n) names.add(n)
		}
	}
	for (const m of script.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) {
		for (const part of m[1].split(',')) {
			const n = part.trim()
			if (n) names.add(n)
		}
	}
	return names
}

/** 收集模板里引用到的名字（含 v-for 局部变量） */
function referencedNames(template) {
	const tpl = template.replace(/<!--[\s\S]*?-->/g, '')
	const locals = new Set()
	const exprs = []

	// 插值
	for (const m of tpl.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push(m[1])

	// v-for：只把 in/of 后面的部分当表达式，前面的作为局部变量
	for (const m of tpl.matchAll(/v-for\s*=\s*"\s*\(?([^)"]*?)\)?\s+(?:in|of)\s+([^"]*?)"/g)) {
		for (const part of m[1].split(',')) {
			const n = part.trim()
			if (n) locals.add(n)
		}
		exprs.push(m[2])
	}

	// 其余绑定属性（:prop / @event / v-if / v-show …），v-for 已单独处理
	for (const m of tpl.matchAll(/(?<![\w-])([:@][\w:.-]+|v-(?!for)[\w:.-]+)\s*=\s*"([^"]*)"/g)) {
		exprs.push(m[2])
	}

	const refs = new Set()
	for (const e of exprs) {
		for (const id of identifiersIn(e)) refs.add(id)
	}
	return { refs, locals }
}

/** 递归收集所有 .vue */
function walk(dir, out = []) {
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name)
		const st = fs.statSync(p)
		if (st.isDirectory()) walk(p, out)
		else if (name.endsWith('.vue')) out.push(p)
	}
	return out
}

const files = walk(SRC)
let problems = 0
let checked = 0

for (const file of files) {
	const src = fs.readFileSync(file, 'utf8')
	const tplMatch = src.match(/<template>([\s\S]*)<\/template>/)
	const scriptMatch = src.match(/<script setup>([\s\S]*?)<\/script>/)
	if (!tplMatch || !scriptMatch) continue

	checked++
	const declared = declaredNames(scriptMatch[1])
	const { refs, locals } = referencedNames(tplMatch[1])

	const missing = []
	for (const r of refs) {
		if (declared.has(r) || locals.has(r) || ALLOWED.has(r)) continue
		missing.push(r)
	}

	const rel = path.relative(process.cwd(), file)
	if (missing.length) {
		problems++
		console.log(`✗ ${rel}`)
		for (const m of missing.sort()) console.log(`    模板引用了但脚本未声明: ${m}`)
	} else {
		console.log(`✓ ${rel}`)
	}
}

console.log('')
if (problems) {
	console.log(`发现 ${problems} 个文件存在未声明的模板绑定（检查了 ${checked} 个）`)
	process.exit(1)
}
console.log(`全部通过（检查了 ${checked} 个 .vue 的模板绑定）`)
