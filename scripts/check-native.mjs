// Native.js 静态检查
//
// 为什么需要它：真机踩过一次 ——
//   plus.android.importClass('java.io.FileOutputStream')   // 没接收
//   ...
//   new FileOutputStream(dest)                             // 真机：FileOutputStream is not defined
//
// plus.android.importClass **不会在当前作用域创建同名绑定**，
// 不接收返回值就等于没导入。
//
// 这类错误单元测试抓不到：测试里的假 plus 是我自己写的，
// 类永远存在，永远不会「未定义」。只有在真机上才炸。
// 所以在静态阶段拦下来。
//
// 用法: node scripts/check-native.mjs   （或 npm run check）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '../src')

/**
 * 把字符串与注释的内容替换成等长空格。
 * 保持长度不变，这样偏移量仍然对得上（找作用域要按大括号配对，
 * 而字符串里的大括号会把它带偏）。
 */
function blankLiterals(s) {
	const out = s.split('')
	let i = 0
	const n = s.length
	const blank = (from, to) => {
		for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' '
	}
	while (i < n) {
		const c = s[i]
		if (c === '/' && s[i + 1] === '/') {
			let j = i
			while (j < n && s[j] !== '\n') j++
			blank(i, j)
			i = j
		} else if (c === '/' && s[i + 1] === '*') {
			let j = i + 2
			while (j < n && !(s[j] === '*' && s[j + 1] === '/')) j++
			blank(i, j + 2)
			i = j + 2
		} else if (c === "'" || c === '"' || c === '`') {
			let j = i + 1
			while (j < n && s[j] !== c) {
				if (s[j] === '\\') j++
				j++
			}
			blank(i + 1, j)
			i = j + 1
		} else {
			i++
		}
	}
	return out.join('')
}

/** 找出所有函数体（按大括号配对），用于按作用域判断 */
function functionScopes(blanked) {
	const scopes = []
	const re = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g
	let m
	while ((m = re.exec(blanked))) {
		const open = m.index + m[0].length - 1
		let depth = 0
		let i = open
		for (; i < blanked.length; i++) {
			if (blanked[i] === '{') depth++
			else if (blanked[i] === '}') {
				depth--
				if (depth === 0) break
			}
		}
		scopes.push({ name: m[1], start: m.index, end: i + 1 })
	}
	return scopes
}

function walk(dir, out = []) {
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name)
		const st = fs.statSync(p)
		if (st.isDirectory()) walk(p, out)
		else if (name.endsWith('.js')) out.push(p)
	}
	return out
}

const files = walk(SRC)
let problems = 0
let checked = 0

for (const file of files) {
	const src = fs.readFileSync(file, 'utf8')
	if (src.indexOf('plus.android.importClass') < 0) continue
	checked++

	const blanked = blankLiterals(src)
	const scopes = functionScopes(blanked)
	const rel = path.relative(process.cwd(), file)
	const found = []

	const re = /plus\.android\.importClass\(\s*'([^']+)'\s*\)/g
	let m
	while ((m = re.exec(src))) {
		const full = m[1]
		const simple = full.split('.').pop().split('$').pop()
		// 看这个调用前面是不是 `=`
		const before = blanked.slice(Math.max(0, m.index - 60), m.index)
		if (/=\s*$/.test(before)) continue // 已接收，没问题

		// 找它所在的最内层作用域
		const scope =
			scopes
				.filter((s) => m.index >= s.start && m.index < s.end)
				.sort((a, b) => a.end - a.start - (b.end - b.start))[0] || null
		const from = scope ? scope.start : 0
		const to = scope ? scope.end : blanked.length
		const body = blanked.slice(from, to)

		// 同一个作用域里只要别处把这个类名接收过，就不算错
		// （顺序上也可能靠后，但那种写法容易被误读而非报错，不在这里纠）
		const assignedInScope = new RegExp(
			'(?:const|let|var)\\s+' + simple + '\\s*=\\s*plus\\.android\\.importClass'
		).test(body)
		if (assignedInScope) continue

		// 这个作用域里有没有「裸用」这个类名
		const bare = new RegExp('(?:new\\s+|\\b)' + simple + '\\s*[.(]').test(body)
		if (bare) {
			const line = src.slice(0, m.index).split('\n').length
			found.push(
				`    第 ${line} 行 importClass('${full}') 没接收返回值，但${scope ? ` ${scope.name}() 里` : '同作用域内'}用了裸类名 ${simple}`
			)
		}
	}

	if (found.length) {
		problems++
		console.log(`✗ ${rel}`)
		for (const f of found) console.log(f)
		console.log('      （改成 const X = plus.android.importClass(...) 再 new X(...)）')
	} else {
		console.log(`✓ ${rel}`)
	}
}

console.log('')
if (problems) {
	console.log(`发现 ${problems} 个文件存在未接收的 importClass（检查了 ${checked} 个）`)
	process.exit(1)
}
console.log(`Native.js 检查通过（检查了 ${checked} 个含 importClass 的文件）`)
