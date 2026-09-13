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

		<!-- 今日汇总 -->
		<view class="card summary">
			<view class="hero">
				<text class="hero-num num" :class="{ over: isOver }">{{ groupDigits(totals.kcal) }}</text>
				<text class="hero-goal num">/ {{ groupDigits(goal) }}</text>
			</view>

			<view class="bar">
				<view class="bar-fill" :class="{ over: isOver }" :style="{ width: pct + '%' }"></view>
			</view>

			<view class="between hero-hint">
				<text v-if="!isOver" class="t-sm t-sub">
					还可以吃 <text class="num t-bold">{{ groupDigits(remain) }}</text> kcal
				</text>
				<text v-else class="t-sm over-text">
					已超出 <text class="num t-bold">{{ groupDigits(-remain) }}</text> kcal
				</text>
				<text class="t-xs t-mute num">{{ records.length }} 条记录</text>
			</view>

			<view class="hr"></view>

			<view class="macro" v-for="m in macroRows" :key="m.key">
				<text class="macro-label">{{ m.label }}</text>
				<view class="macro-bar">
					<view
						class="macro-fill"
						:style="{ width: m.pct + '%', background: m.color }"
					></view>
				</view>
				<text class="macro-val num">
					{{ m.value }}<text class="macro-goal">/{{ m.goal }}</text>
				</text>
			</view>
		</view>

		<!-- 操作 -->
		<view class="actions">
			<view class="btn btn-primary grow" @click="shoot">
				<image class="ico" src="/static/ui/camera.png" mode="aspectFit" />
				<text class="act-label">拍照识别</text>
			</view>
			<view class="btn btn-ghost grow" @click="addRecord('')">
				<image class="ico" src="/static/ui/plus.png" mode="aspectFit" />
				<text class="act-label">手动添加</text>
			</view>
		</view>

		<!-- 餐次分组 -->
		<view class="card meals">
			<view class="meal" v-for="(g, gi) in groups" :key="g.key" :class="{ first: gi === 0 }">
				<view class="meal-head">
					<view class="meal-dot" :style="{ background: g.color }"></view>
					<text class="meal-name grow">{{ g.label }}</text>
					<text v-if="g.totals.kcal" class="meal-kcal num">{{ groupDigits(g.totals.kcal) }}</text>
					<text v-if="g.totals.kcal" class="meal-unit">kcal</text>
					<view class="meal-add" @click="addRecord(g.key)">
						<image class="ico-sm" src="/static/ui/plus.png" mode="aspectFit" />
					</view>
				</view>

				<view
					class="rec"
					v-for="r in g.records"
					:key="r.id"
					@click="editRecord(r)"
					hover-class="rec-hover"
				>
					<view class="grow">
						<text class="rec-name ellipsis">{{ itemNames(r) }}</text>
						<text class="rec-meta num">{{ formatTime(r.ts) }} · {{ gramsOf(r) }} g</text>
					</view>
					<text class="rec-kcal num">{{ kcalOf(r) }}</text>
					<image class="ico-sm rec-arrow" src="/static/ui/chevron.png" mode="aspectFit" />
				</view>
			</view>
		</view>

		<view class="foot t-xs t-mute">
			<text v-if="isToday">数据仅保存在本机</text>
			<text v-else>查看历史记录</text>
		</view>
	</view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { MACRO_META, MEALS } from '../../core/constants.js'
import { addDays, dateLabel, formatTime, parseKey, todayKey } from '../../core/date.js'
import { getSettings, recordsByDate } from '../../core/db.js'
import {
	groupDigits,
	macroGoalsFromKcal,
	percent,
	recordTotals,
	round,
	sumRecords,
} from '../../core/nutrition.js'
import { persistPhoto, pickImage, toBase64 } from '../../core/photo.js'
import { recognize } from '../../core/ai.js'
import { setDraft } from '../../core/draft.js'

const dateStr = ref(todayKey())
const records = ref([])
const settings = ref(getSettings())

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
		return { ...m, value, goal: mg, pct: percent(value, mg, 100) }
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

onShow(refresh)

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

function itemNames(r) {
	const names = (r.items || []).map((i) => i.name).filter(Boolean)
	return names.length ? names.join('、') : '空记录'
}

function gramsOf(r) {
	return round(
		(r.items || []).reduce((s, i) => s + (Number(i.grams) || 0), 0),
		0
	)
}

function kcalOf(r) {
	return recordTotals(r).kcal
}

function editRecord(r) {
	uni.navigateTo({ url: `/pages/record/edit?id=${r.id}` })
}

function addRecord(meal) {
	uni.navigateTo({
		url: `/pages/record/edit?date=${dateStr.value}${meal ? '&meal=' + meal : ''}`,
	})
}

/* ---------------- 拍照识别 ---------------- */

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

	// 照片落盘失败不阻塞记录（任何一步失败都要能退回手动）
	let photo = ''
	if (getSettings().storePhoto) {
		try {
			const saved = await persistPhoto(pick.path)
			if (saved.ok) photo = saved.path
		} catch (e) {
			photo = ''
		}
	}

	setDraft({ items: res.items, note: res.note, photo, source: 'ai' })
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
		padding: $s-3 $s-4 $s-6;
	}

	/* ---------- 日期切换 ---------- */
	.head {
		display: flex;
		align-items: center;
		padding: $s-2 0 $s-4;
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
		background: rgba(22, 32, 42, 0.05);
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
		font-size: 34rpx;
		font-weight: 600;
		letter-spacing: 0.5rpx;
	}

	.head-sub {
		display: block;
		font-size: 22rpx;
		color: $c-text-mute;
		margin-top: 2rpx;
	}

	/* ---------- 汇总卡 ---------- */
	.summary {
		padding: $s-5 $s-4 $s-4;
	}

	.hero {
		display: flex;
		align-items: baseline;
		justify-content: center;
	}

	.hero-num {
		font-size: 92rpx;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -2rpx;
	}

	.hero-num.over {
		color: $c-danger;
	}

	.hero-goal {
		font-size: 26rpx;
		color: $c-text-mute;
		margin-left: 12rpx;
	}

	.bar {
		height: 14rpx;
		border-radius: $r-pill;
		background: $c-fill;
		overflow: hidden;
		margin-top: $s-4;
	}

	.bar-fill {
		height: 100%;
		border-radius: $r-pill;
		background: linear-gradient(90deg, #17b87b, $c-primary);
		transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.bar-fill.over {
		background: linear-gradient(90deg, #f97066, $c-danger);
	}

	.hero-hint {
		margin-top: $s-3;
	}

	.over-text {
		color: $c-danger;
	}

	.hr {
		height: 1rpx;
		background: $c-line;
		margin: $s-4 0 $s-3;
	}

	/* ---------- 宏量营养素 ---------- */
	.macro {
		display: flex;
		align-items: center;
		padding: 9rpx 0;
	}

	.macro-label {
		width: 104rpx;
		font-size: 24rpx;
		color: $c-text-sub;
		flex-shrink: 0;
	}

	.macro-bar {
		flex: 1;
		height: 10rpx;
		border-radius: $r-pill;
		background: $c-fill;
		overflow: hidden;
		margin-right: $s-3;
	}

	.macro-fill {
		height: 100%;
		border-radius: $r-pill;
		transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.macro-val {
		width: 150rpx;
		text-align: right;
		font-size: 24rpx;
		font-weight: 600;
		flex-shrink: 0;
	}

	.macro-goal {
		font-weight: 400;
		color: $c-text-mute;
	}

	/* ---------- 操作按钮 ---------- */
	.actions {
		display: flex;
		margin-top: $s-3;
	}

	.actions .btn + .btn {
		margin-left: $s-3;
	}

	.act-label {
		margin-left: 12rpx;
	}

	/* ---------- 餐次列表 ---------- */
	.meals {
		padding: 0 $s-4;
	}

	.meal {
		padding: $s-3 0;
		border-top: 1rpx solid $c-line;
	}

	.meal.first {
		border-top: none;
	}

	.meal-head {
		display: flex;
		align-items: center;
	}

	.meal-dot {
		width: 14rpx;
		height: 14rpx;
		border-radius: $r-pill;
		margin-right: 14rpx;
		flex-shrink: 0;
	}

	.meal-name {
		font-size: 29rpx;
		font-weight: 600;
	}

	.meal-kcal {
		font-size: 27rpx;
		font-weight: 600;
		color: $c-text-sub;
	}

	.meal-unit {
		font-size: 21rpx;
		color: $c-text-mute;
		margin-left: 5rpx;
	}

	.meal-add {
		width: 52rpx;
		height: 52rpx;
		margin-left: $s-2;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: $r-pill;
		background: $c-primary-tint;
	}

	.meal-add:active {
		background: $c-primary-weak;
	}

	/* ---------- 记录行 ---------- */
	.rec {
		display: flex;
		align-items: center;
		padding: 14rpx 0 14rpx 28rpx;
		border-radius: $r-sm;
	}

	.rec-hover {
		background: #fafbfc;
	}

	.rec-name {
		display: block;
		font-size: 28rpx;
	}

	.rec-meta {
		display: block;
		font-size: 21rpx;
		color: $c-text-mute;
		margin-top: 3rpx;
	}

	.rec-kcal {
		font-size: 27rpx;
		color: $c-text;
		margin-left: $s-2;
	}

	.rec-arrow {
		margin-left: 8rpx;
		opacity: 0.65;
	}

	/* ---------- 页脚 ---------- */
	.foot {
		text-align: center;
		padding-top: $s-5;
	}
</style>
