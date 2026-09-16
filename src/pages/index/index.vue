<template>
	<view class="page">
		<!-- 日期切换 -->
		<view class="head">
			<view class="nav" @click="shift(-1)">
				<image class="ico-sm flip" src="/static/ui/chevron.png" mode="aspectFit" />
			</view>
			<view class="head-mid" @click="backToToday">
				<text class="head-title">{{ headLabel }}</text>
				<text class="head-sub">{{ subLabel }}</text>
			</view>
			<view class="nav" :class="{ off: isToday }" @click="shift(1)">
				<image class="ico-sm" src="/static/ui/chevron.png" mode="aspectFit" />
			</view>
		</view>

		<!-- 仪表盘 -->
		<view class="card summary">
			<view class="hero">
				<text class="hero-num" :class="{ over: isOver }">{{ round(totals.kcal, 0) }}</text>
				<text class="hero-goal">/ {{ round(goal, 0) }}</text>
			</view>

			<view class="bar">
				<view class="bar-fill" :class="{ over: isOver }" :style="{ width: pct + '%' }"></view>
			</view>

			<!-- 剩余热量：胶囊居中，弱化存在感 -->
			<view class="pill-row">
				<view class="pill" :class="{ over: isOver }">
					<text v-if="!isOver">还可以吃 {{ remain }} kcal</text>
					<text v-else>已超出 {{ -remain }} kcal</text>
				</view>
			</view>

			<view class="hr"></view>

			<!-- 三大营养素：横向三列，省掉约一半垂直空间 -->
			<view class="macros3">
				<view class="m3" v-for="m in macroRows" :key="m.key">
					<view class="m3-head">
						<text class="m3-label">{{ m.label }}</text>
						<text class="m3-val">{{ m.value }}<text class="m3-unit">g</text></text>
					</view>
					<view class="m3-foot">
						<view class="m3-track">
							<view class="m3-fill" :style="{ width: m.pct + '%', background: m.fill }"></view>
						</view>
						<image
							v-if="m.over"
							class="m3-alert"
							src="/static/ui/alert.png"
							mode="aspectFit"
						/>
					</view>
				</view>
			</view>
		</view>

		<!-- 全日餐次：空餐次保留淡色占位，提醒用户补记 -->
		<view class="list">
			<view
				class="meal-block"
				v-for="g in groups"
				:key="g.key"
				:class="{ blank: !g.records.length, filled: g.records.length }"
			>
				<view class="meal-head">
					<image class="meal-ico" :src="g.icon" mode="aspectFit" />
					<text class="meal-name grow">{{ g.label }}</text>
					<text v-if="g.records.length" class="meal-kcal">{{ round(g.totals.kcal, 0) }}</text>
					<text v-if="g.records.length" class="meal-unit">kcal</text>
					<view class="meal-add" @click="addRecord(g.key)">
						<image class="ico-sm" src="/static/ui/plus.png" mode="aspectFit" />
					</view>
				</view>

				<view
					class="rec"
					v-for="r in g.records"
					:key="r.id"
					@click="editRecord(r)"
					hover-class="rec-press"
					:hover-stay-time="80"
				>
					<view class="rec-main">
						<text class="rec-title ellipsis">{{ titleOf(r) }}</text>
						<view class="rec-sub" v-if="subParts(r).length">
							<view class="rec-sub-i" v-for="(p, pi) in subParts(r)" :key="pi">
								<view v-if="p.sep" class="rec-sep"></view>
								<text v-else class="rec-sub-t">{{ p.name }}</text>
							</view>
						</view>
					</view>
					<view class="rec-side">
						<text class="rec-kcal">{{ kcalOf(r) }}</text>
						<text class="rec-meta">{{ formatTime(r.ts) }} · {{ gramsOf(r) }}g</text>
					</view>
				</view>
			</view>
		</view>
	</view>

	<!-- 悬浮操作：不再用两个大色块把数据和列表隔开 -->
	<view v-if="fabOpen" class="fab-mask" @click="fabOpen = false"></view>
	<view class="fab-wrap">
		<view class="fab-menu" :class="{ open: fabOpen }">
			<view class="fab-item" @click="pickManual">
				<text class="fab-item-t">手动添加</text>
				<view class="fab-item-b">
					<image class="ico-sm" src="/static/ui/plus.png" mode="aspectFit" />
				</view>
			</view>
			<view class="fab-item" @click="pickCamera">
				<text class="fab-item-t">拍照识别</text>
				<view class="fab-item-b">
					<image class="ico-sm" src="/static/ui/camera-gray.png" mode="aspectFit" />
				</view>
			</view>
		</view>
		<view class="fab" :class="{ open: fabOpen }" @click="fabOpen = !fabOpen">
			<image
				class="ico"
				:src="fabOpen ? '/static/ui/close-white.png' : '/static/ui/camera.png'"
				mode="aspectFit"
			/>
		</view>
	</view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { MACRO_META, MEALS } from '../../core/constants.js'
import { addDays, dateLabel, formatTime, parseKey, todayKey } from '../../core/date.js'
import { getSettings, recordsByDate } from '../../core/db.js'
import {
	macroGoalsFromKcal,
	mainItem,
	otherItems,
	percent,
	recordTotals,
	round,
	sumRecords,
} from '../../core/nutrition.js'
import { persistPhoto, photoPathFor, pickImage, toBase64 } from '../../core/photo.js'
import { recognize } from '../../core/ai.js'
import { setDraft } from '../../core/draft.js'

const dateStr = ref(todayKey())
const records = ref([])
const settings = ref(getSettings())
const fabOpen = ref(false)

const isToday = computed(() => dateStr.value === todayKey())

const headLabel = computed(() => dateLabel(dateStr.value))

const subLabel = computed(() => {
	if (!isToday.value) return '点击回到今天'
	const d = parseKey(dateStr.value)
	return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
})

const totals = computed(() => sumRecords(records.value))
const goal = computed(() => Number(settings.value.dailyGoal) || 0)
const pct = computed(() => percent(totals.value.kcal, goal.value, 100))
const isOver = computed(() => goal.value > 0 && totals.value.kcal > goal.value)
const remain = computed(() => round(goal.value - totals.value.kcal, 0))

const macroRows = computed(() => {
	const g = settings.value.autoMacro
		? macroGoalsFromKcal(settings.value.dailyGoal)
		: settings.value.macroGoals
	const t = totals.value
	return MACRO_META.map((m) => {
		const value = t[m.key] || 0
		const mg = Number(g[m.key]) || 0
		const over = mg > 0 && value > mg
		return {
			...m,
			value,
			goal: mg,
			over,
			pct: percent(value, mg, 100),
			fill: over
				? `linear-gradient(90deg, ${m.color}, #c97b6e)`
				: `linear-gradient(90deg, ${m.color}b0, ${m.color})`,
		}
	})
})

const groups = computed(() => {
	const map = {}
	for (const m of MEALS) map[m.key] = []
	for (const r of records.value) {
		const bucket = map[r.meal] || map.snack
		bucket.push(r)
	}
	return MEALS.map((m) => {
		const list = map[m.key]
		return { ...m, records: list, totals: sumRecords(list) }
	})
})

function refresh() {
	settings.value = getSettings()
	records.value = recordsByDate(dateStr.value)
}

onShow(() => {
	fabOpen.value = false
	refresh()
})

onHide(() => {
	fabOpen.value = false
})

function shift(n) {
	if (n > 0 && isToday.value) {
		uni.showToast({ title: '已经是最新一天', icon: 'none' })
		return
	}
	dateStr.value = addDays(dateStr.value, n)
	refresh()
}

function backToToday() {
	if (isToday.value) return
	dateStr.value = todayKey()
	refresh()
}

/* ---------------- 列表展示：主菜做标题，其余作次级信息 ---------------- */

function titleOf(r) {
	const m = mainItem(r.items)
	return m ? m.name : '空记录'
}

/** 其余菜品拼成「带竖线分隔」的次级行，超过 3 项则收成 +N */
function subParts(r) {
	const names = otherItems(r.items)
		.map((i) => i.name)
		.filter(Boolean)
	if (!names.length) return []
	const shown = names.slice(0, 3)
	const rest = names.length - shown.length
	const out = []
	shown.forEach((name, i) => {
		if (i > 0) out.push({ sep: true })
		out.push({ sep: false, name })
	})
	if (rest > 0) out.push({ sep: false, name: `+${rest}` })
	return out
}

function gramsOf(r) {
	return round(
		(r.items || []).reduce((s, i) => s + (Number(i.grams) || 0), 0),
		0
	)
}

function kcalOf(r) {
	// 展示层取整：小数会让大数字看着啰嗦，精度保留在编辑页
	return round(recordTotals(r).kcal, 0)
}

function editRecord(r) {
	uni.navigateTo({ url: `/pages/record/edit?id=${r.id}` })
}

function addRecord(meal) {
	uni.navigateTo({
		url: `/pages/record/edit?date=${dateStr.value}${meal ? '&meal=' + meal : ''}`,
	})
}

/* ---------------- 悬浮操作 ---------------- */

function pickManual() {
	fabOpen.value = false
	addRecord('')
}

function pickCamera() {
	fabOpen.value = false
	// 等收起动画走完再拉起系统相机，避免动画被系统弹窗打断
	setTimeout(shoot, 180)
}

function shoot() {
	if (!getSettings().apiKey) {
		uni.showModal({
			title: '还没配置 API Key',
			content: '拍照识别需要阿里云百炼的 API Key。可以现在去设置里填写，也可以先手动记录。',
			confirmText: '去设置',
			cancelText: '手动记录',
			success: (r) => {
				if (r.confirm) uni.switchTab({ url: '/pages/settings/settings' })
				else addRecord('')
			},
		})
		return
	}
	uni.showActionSheet({
		itemList: ['拍照', '从相册选择'],
		success: (res) => runRecognize(res.tapIndex === 0 ? 'camera' : 'album'),
	})
}

async function runRecognize(source) {
	const pick = await pickImage(source)
	if (!pick.ok) {
		if (pick.error) uni.showToast({ title: pick.error, icon: 'none' })
		return
	}

	uni.showLoading({ title: '读取图片…', mask: true })
	const b64 = await toBase64(pick.path, pick.file)
	if (!b64.ok) {
		uni.hideLoading()
		fallbackToManual('读取图片失败', b64.error)
		return
	}

	uni.showLoading({ title: '识别中…', mask: true })
	let res
	try {
		res = await recognize({ base64: b64.base64, mime: b64.mime, settings: getSettings() })
	} catch (e) {
		res = { ok: false, error: '识别过程出错' }
	}
	uni.hideLoading()

	if (!res.ok) {
		fallbackToManual('识别失败', res.error + (res.detail ? `\n${res.detail}` : ''))
		return
	}

	if (!res.isFood) {
		uni.showModal({
			title: '没识别到食物',
			content: res.reason || '照片里似乎没有食物',
			confirmText: '手动记录',
			cancelText: '重拍',
			success: (r) => {
				if (r.confirm) addRecord('')
			},
		})
		return
	}

	// 落盘失败（典型是 H5：没有长期文件系统）就退回 data URL，
	// 至少本次会话里编辑页看得见刚拍的照片。
	// 不用 blob: URL —— 它的生命周期绑在创建它的文档上，
	// 且在部分环境下 <image> 不渲染；data URL 到处都能渲染。
	// 另外这里直接用手上已有的 base64，不需要多读一次图。
	const fallback = `data:${b64.mime};base64,${b64.base64}`
	let photo = fallback
	let photoTransient = true
	if (getSettings().storePhoto) {
		try {
			const saved = await persistPhoto(pick.path)
			photo = photoPathFor(saved, fallback)
			photoTransient = !saved.ok
		} catch (e) {
			photo = photoPathFor(null, fallback)
		}
	}
	// 注意：即使用户关掉了「保存照片」，这里仍然把照片带进编辑页，
	// 只是标记为临时（保存记录时不写进去）。
	// 否则关闭该设置后，刚拍完照片编辑页也什么都不显示，很莫名其妙。

	setDraft({
		items: res.items,
		note: res.note,
		photo,
		// 临时路径（data URL）不写进记录：一是撑爆本地存储，
		// 二是记录里存一份巨大的 base64 字符串没有意义
		photoTransient,
		source: 'ai',
	})
	uni.navigateTo({ url: '/pages/record/edit?fromDraft=1' })
}

function fallbackToManual(title, content) {
	uni.showModal({
		title,
		content: content || '请重试或改用手动记录',
		confirmText: '手动记录',
		cancelText: '知道了',
		success: (r) => {
			if (r.confirm) addRecord('')
		},
	})
}
</script>

<style lang="scss" scoped>
	.page {
		/* 首页导航栏已隐藏（navigationStyle: custom），自行避开状态栏 */
		padding: 0 $s-4 200rpx;
		padding-top: var(--status-bar-height, 0px);
	}

	/* ---------- 日期切换 ---------- */
	.head {
		display: flex;
		align-items: center;
		padding: $s-3 0 $s-4;
	}

	.nav {
		width: 64rpx;
		height: 64rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: $r-pill;
	}

	.nav:active {
		background: rgba(28, 39, 51, 0.05);
	}

	.nav.off {
		opacity: 0.25;
	}

	.flip {
		transform: rotate(180deg);
	}

	.head-mid {
		flex: 1;
		text-align: center;
	}

	.head-title {
		display: block;
		font-size: 33rpx;
		font-weight: 600;
	}

	.head-sub {
		display: block;
		font-size: 21rpx;
		color: $c-text-mute;
		margin-top: 2rpx;
	}

	/* ---------- 仪表盘 ---------- */
	.summary {
		padding: $s-5 $s-4 $s-4;
	}

	.hero {
		display: flex;
		align-items: baseline;
		justify-content: center;
	}

	/* 字重加到 600，让大数字成为页面视觉锚点 */
	.hero-num {
		font-family: $ff-num;
		font-size: 94rpx;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -1.5rpx;
	}

	.hero-num.over {
		color: $c-danger;
	}

	.hero-goal {
		font-family: $ff-num;
		font-size: 25rpx;
		color: $c-text-mute;
		margin-left: 12rpx;
	}

	.bar {
		height: 12rpx;
		border-radius: $r-pill;
		background: $c-fill;
		overflow: hidden;
		margin-top: $s-4;
	}

	.bar-fill {
		height: 100%;
		border-radius: $r-pill;
		background: linear-gradient(90deg, #7cc3a8, $c-primary);
		transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.bar-fill.over {
		background: linear-gradient(90deg, #e0a99e, $c-danger);
	}

	.pill-row {
		display: flex;
		justify-content: center;
		margin-top: $s-3;
	}

	.pill {
		background: $c-primary-weak;
		color: $c-primary-dark;
		font-size: 22rpx;
		padding: 8rpx 26rpx;
		border-radius: $r-pill;
	}

	.pill.over {
		background: $c-danger-weak;
		color: $c-danger;
	}

	.hr {
		height: 1rpx;
		background: $c-line;
		margin: $s-4 0 $s-3;
	}

	/* ---------- 三列营养素 ---------- */
	.macros3 {
		display: flex;
	}

	.m3 {
		flex: 1;
		min-width: 0;
	}

	.m3 + .m3 {
		margin-left: $s-4;
	}

	.m3-head {
		display: flex;
		align-items: baseline;
		margin-bottom: 10rpx;
	}

	.m3-label {
		font-size: 20rpx;
		color: $c-text-mute;
		margin-right: 7rpx;
	}

	.m3-val {
		font-family: $ff-num;
		font-size: 28rpx;
		font-weight: 600;
	}

	.m3-unit {
		font-size: 19rpx;
		font-weight: 400;
		color: $c-text-mute;
		margin-left: 1rpx;
	}

	.m3-foot {
		display: flex;
		align-items: center;
	}

	.m3-track {
		flex: 1;
		height: 8rpx;
		border-radius: $r-pill;
		background: $c-fill;
		overflow: hidden;
	}

	.m3-fill {
		height: 100%;
		border-radius: $r-pill;
		transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.m3-alert {
		width: 22rpx;
		height: 22rpx;
		margin-left: 7rpx;
		flex-shrink: 0;
	}

	/* ---------- 餐次 ---------- */
	.list {
		margin-top: $s-4;
	}

	.meal-block {
		margin-top: $s-4;
	}

	.meal-block.filled {
		margin-top: $s-5;
	}

	.meal-head {
		display: flex;
		align-items: center;
		padding: 0 4rpx $s-2;
	}

	/* 未记录的餐次：整体压淡，只留引导作用（类名避开全局 .empty） */
	.meal-block.blank .meal-ico {
		opacity: 0.32;
	}

	.meal-block.blank .meal-name {
		color: $c-text-mute;
		font-weight: 500;
	}

	.meal-block.blank .meal-head {
		padding-bottom: 0;
	}

	.meal-block.blank .meal-add {
		background: rgba(255, 255, 255, 0.7);
		box-shadow: none;
	}

	.meal-ico {
		width: 38rpx;
		height: 38rpx;
		margin-right: 10rpx;
		flex-shrink: 0;
	}

	.meal-name {
		font-size: 27rpx;
		font-weight: 600;
	}

	.meal-kcal {
		font-family: $ff-num;
		font-size: 26rpx;
		font-weight: 600;
		color: $c-text-sub;
	}

	.meal-unit {
		font-size: 19rpx;
		color: $c-text-mute;
		margin-left: 4rpx;
	}

	.meal-add {
		width: 48rpx;
		height: 48rpx;
		margin-left: $s-2;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: $r-pill;
		background: $c-card;
		box-shadow: $sh-1;
	}

	.meal-add:active {
		background: $c-primary-tint;
	}

	/* ---------- 记录卡片 ---------- */
	.rec {
		display: flex;
		align-items: center;
		background: $c-card;
		border-radius: $r-md;
		padding: $s-3 $s-3 $s-3 $s-4;
		box-shadow: $sh-1;
	}

	.rec + .rec {
		margin-top: $s-2;
	}

	.rec-press {
		background: #fbfcfd;
	}

	.rec-main {
		flex: 1;
		min-width: 0;
	}

	.rec-title {
		display: block;
		font-size: 29rpx;
		font-weight: 600;
		line-height: 1.35;
	}

	/* 次级菜品：纯文字 + 竖线分隔，比胶囊标签干净 */
	.rec-sub {
		display: flex;
		align-items: center;
		flex-wrap: nowrap;
		overflow: hidden;
		margin-top: 7rpx;
	}

	.rec-sub-i {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.rec-sub-t {
		font-size: 22rpx;
		color: $c-text-mute;
		white-space: nowrap;
	}

	.rec-sep {
		width: 2rpx;
		height: 18rpx;
		background: $c-line-strong;
		margin: 0 10rpx;
		flex-shrink: 0;
	}

	/* 右侧数据列：热量降权（字号减小 + 转灰），让菜名成为主角 */
	.rec-side {
		text-align: right;
		margin-left: $s-3;
		flex-shrink: 0;
	}

	.rec-kcal {
		display: block;
		font-family: $ff-num;
		font-size: 32rpx;
		font-weight: 600;
		line-height: 1.15;
		color: $c-text-sub;
	}

	.rec-meta {
		display: block;
		font-family: $ff-num;
		font-size: 19rpx;
		color: $c-text-mute;
		margin-top: 5rpx;
	}

	/* ---------- 悬浮操作 ---------- */
	.fab-mask {
		position: fixed;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		background: rgba(28, 39, 51, 0.22);
		z-index: 40;
	}

	.fab-wrap {
		position: fixed;
		right: $s-4;
		bottom: calc(50px + #{$s-4});
		z-index: 50;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.fab-menu {
		opacity: 0;
		transform: translateY(20rpx) scale(0.92);
		transform-origin: bottom right;
		pointer-events: none;
		transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
		margin-bottom: $s-3;
	}

	.fab-menu.open {
		opacity: 1;
		transform: none;
		pointer-events: auto;
	}

	.fab-item {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		margin-top: $s-2;
	}

	.fab-item-t {
		background: #fff;
		color: $c-text;
		font-size: 25rpx;
		font-weight: 500;
		padding: 12rpx 24rpx;
		border-radius: $r-pill;
		box-shadow: $sh-2;
		margin-right: $s-2;
	}

	.fab-item-b {
		width: 84rpx;
		height: 84rpx;
		border-radius: $r-pill;
		background: #fff;
		box-shadow: $sh-2;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.fab-item:active .fab-item-b {
		background: $c-primary-tint;
	}

	/* 降饱和 + 双层投影，让它有层次但不突兀 */
	.fab {
		width: 108rpx;
		height: 108rpx;
		border-radius: $r-pill;
		background: linear-gradient(135deg, #79bda6, #4f9e82);
		box-shadow: 0 3rpx 8rpx rgba(28, 39, 51, 0.07), 0 14rpx 32rpx rgba(79, 158, 130, 0.24);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), background 0.2s;
	}

	.fab.open {
		transform: rotate(90deg);
		background: linear-gradient(135deg, #8a97a4, #66737f);
		box-shadow: 0 3rpx 8rpx rgba(28, 39, 51, 0.08), 0 14rpx 32rpx rgba(102, 115, 127, 0.22);
	}

	.fab:active {
		opacity: 0.9;
	}
</style>
