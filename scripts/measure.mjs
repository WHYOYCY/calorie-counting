// 生成一个带测量探针的页面，用来查清 uni-app H5 的 rem/rpx 实际缩放情况
// 用法: node scripts/measure.mjs  然后无头浏览器打开 /measure.html 并 dump-dom
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist/build/h5')
const src = path.join(DIST, 'index.html')

if (!fs.existsSync(src)) {
	console.error('找不到构建产物，请先 npm run build:h5')
	process.exit(1)
}

const probe = `
<script>
setTimeout(function () {
  var d = document.createElement('div');
  d.id = 'MEASURE';
  var card = document.querySelector('.card');
  var hero = document.querySelector('.hero-num');
  var meal = document.querySelector('.meals');
  var tab = document.querySelector('uni-tabbar');
  function w(el) { return el ? el.offsetWidth : -1; }
  d.textContent = [
    'rootFont=' + getComputedStyle(document.documentElement).fontSize,
    'htmlFont=' + getComputedStyle(document.documentElement).fontSize,
    'innerWidth=' + window.innerWidth,
    'clientWidth=' + document.documentElement.clientWidth,
    'bodyScrollW=' + document.body.scrollWidth,
    'bodyClientW=' + document.body.clientWidth,
    'dpr=' + window.devicePixelRatio,
    'heroFont=' + (hero ? getComputedStyle(hero).fontSize : -1),
    'cardW=' + w(card),
    'mealsW=' + w(meal),
    'tabW=' + w(tab)
  ].join(' | ');
  document.body.appendChild(d);
}, 2500);
</script>
`

const html = fs.readFileSync(src, 'utf8').replace('</body>', probe + '</body>')
fs.writeFileSync(path.join(DIST, 'measure.html'), html)
console.log('✓ 已生成 dist/build/h5/measure.html')
