<template>
	<view class="page">
		<!-- 概览：替掉「用户信息」（本应用没有账号），给的是实际用得上的数字 -->
		<view class="card">
			<view class="ov-top">
				<text class="kicker">今日</text>
				<text class="ov-streak">{{ streak ? `连续记录 ${streak} 天` : '今天还没记录' }}</text>
			</view>
			<view class="ov-num">
				<text class="ov-kcal num">{{ groupDigits(todayKcal) }}</text>
				<text class="ov-goal">/ {{ groupDigits(goal) }} kcal</text>
			</view>
			<view class="ov-bar">
				<view class="ov-fill" :class="{ over: todayKcal > goal }" :style="{ width: todayPct + '%' }"></view>
			</view>
			<text class="hint t-xs t-mute">共 {{ recordCount }} 条记录，全部保存在本机。</text>
		</view>

		<!-- 每日目标：普通用户最常用的设置，留在主页面 -->
		<view class="card">
			<view class="sec-head">
				<view class="sec-title-wrap">
					<image class="sec-ico" src="/static/ui/target.png" mode="aspectFit" />
					<text class="sec-title">每日目标</text>
				</view>
				<view class="mini-btn" :class="{ on: hasPending }" @click="applyNow">刷新</view>
			</view>

			<view class="field">
				<text class="label">热量目标</text>
				<view class="input-wrap row">
					<input
						class="input grow num"
						type="number"
						:value="goalShown"
						@input="onGoalInput"
						@blur="onGoal"
					/>
					<text class="suffix">kcal</text>
				</view>
			</view>

			<view class="field">
				<text class="label">营养素目标</text>
				<view class="auto-row">
					<text class="auto-t">按热量自动分配</text>
					<switch :checked="form.autoMacro" color="#52a98a" @change="onAutoMacro" />
				</view>
			</view>

			<!-- 三个目标值：一行三列，用营养素自己的颜色区分 -->
			<view class="mgrid">
				<view
					v-for="m in macroRows"
					:key="m.key"
					class="mg"
					:style="{ background: m.soft, color: m.deep }"
				>
					<text class="mg-t">{{ m.label }}</text>
					<view class="mg-v-row">
						<input
							class="mg-input num"
							type="digit"
							:disabled="form.autoMacro"
							:value="macroShown(m.key)"
							@input="onMacroInput(m.key, $event)"
							@blur="onMacro(m.key, $event)"
						/>
						<text class="mg-u">g</text>
					</view>
				</view>
			</view>
			<text class="hint t-xs t-mute">
				{{ form.autoMacro ? '按常见比例自动分配，关掉上面的开关可以自己填。' : '自己填的数字，改热量目标不会覆盖它。' }}
			</text>
		</view>

		<!-- 分区入口 -->
		<view class="card list-card">
			<view class="entry" @click="go('/pages/settings/ai')" hover-class="entry-press">
				<image class="entry-ico" src="/static/ui/camera.png" mode="aspectFit" />
				<view class="entry-main">
					<text class="entry-t">拍照识别设置</text>
					<text class="entry-s">{{ aiSub }}</text>
				</view>
				<image class="ico-sm" src="/static/ui/chevron.png" mode="aspectFit" />
			</view>

			<view class="entry" @click="go('/pages/settings/data')" hover-class="entry-press">
				<image class="entry-ico" src="/static/ui/box.png" mode="aspectFit" />
				<view class="entry-main">
					<text class="entry-t">数据管理</text>
					<text class="entry-s">导出与导入备份 · 本机自动备份 · 清空记录</text>
				</view>
				<image class="ico-sm" src="/static/ui/chevron.png" mode="aspectFit" />
			</view>
		</view>

		<!-- 隐私：把最关键的一句说重一点 -->
		<view class="privacy">
			<text class="privacy-t">
				所有记录只保存在这台手机上，不含任何统计上报；照片也只会发给你填的识别接口。
			</text>
		</view>

		<!-- 关于：只留最基础的信息，压到页面最底部 -->
		<view class="about">
			<text class="about-t">卡路里记录 v{{ APP_VERSION }}</text>
			<text class="about-t">识别结果由大模型估算，仅供记录参考，不构成医疗或营养建议</text>
		</view>
	</view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { APP_VERSION, MACRO_META, MACRO_RATIO, MODELS } from '../../core/constants.js'
import { withAlpha, darken } from '../../core/color.js'
import { allRecords, getSettings, recordsByDate, saveSettings } from '../../core/db.js'
import { todayKey } from '../../core/date.js'
import { groupDigits, macroGoalsFromKcal, round, sumRecords } from '../../core/nutrition.js'

const recordCount = ref(0)
const todayKcal = ref(0)
const streak = ref(0)
const form = reactive({ ...getSettings() })

const goal = computed(() => Number(form.dailyGoal) || 0)
const todayPct = computed(() => {
	if (goal.value <= 0) return 0
	return Math.min(100, Math.round((todayKcal.value / goal.value) * 100))
})

/** 入口行的副标题：直接说清配没配好，不用点进去才知道 */
const aiSub = computed(() => {
	const m = MODELS.find((x) => x.id === form.model)
	const name = m ? m.plain : form.model
	return String(form.apiKey || '').trim() ? `已配置 · ${name}` : '未配置 · 不影响手动记录'
})

/* ---------------- 每日目标：待提交的输入 ---------------- */

/**
 * 还没落库的输入文本（key 不存在 = 该字段没有待提交改动）。
 *
 * 为什么需要它：input 只绑了 @blur，而手机上失焦得额外点一下别处。
 * 用户改完热量目标，下方的营养素推导值不会跟着动，也看不出到底
 * 有没有生效。把编辑中的文本单独存一份，点「刷新」就能立即提交并重算。
 */
const pending = reactive({})
const MACRO_KEYS = Object.keys(MACRO_RATIO)

const goalShown = computed(() => ('dailyGoal' in pending ? pending.dailyGoal : form.dailyGoal))

function macroShown(key) {
	return key in pending ? pending[key] : macroInputs.value[key]
}

/** 有改动还没落库 —— 用来把「刷新」按钮点亮，提示用户可以点 */
const hasPending = computed(() => {
	if ('dailyGoal' in pending && String(pending.dailyGoal) !== String(form.dailyGoal)) {
		return true
	}
	// 自动分配模式下三个营养素只是推导值的展示，不算用户输入
	if (!form.autoMacro) {
		for (const k of MACRO_KEYS) {
			if (k in pending && String(pending[k]) !== String(form.macroGoals[k])) return true
		}
	}
	return false
})

/** 自动模式下把推导值显示出来，让用户知道当前实际目标 */
const macroInputs = computed(() => {
	const g = form.autoMacro ? macroGoalsFromKcal(form.dailyGoal) : form.macroGoals
	return { protein: g.protein, fat: g.fat, carbs: g.carbs }
})

/** 三个目标值 + 各自的浅底深字配色（和统计页保持同一套视觉语言） */
const macroRows = computed(() =>
	MACRO_META.map((m) => ({
		...m,
		soft: withAlpha(m.color, 0.16),
		deep: darken(m.color, 0.42),
	}))
)

function clearPending() {
	for (const k of Object.keys(pending)) delete pending[k]
}

/**
 * 「刷新」：把当前输入（含还没失焦提交的）立即落库并重算营养素。
 * 没有改动时也点得，只是提示一句「已是最新」。
 */
function applyNow() {
	const patch = {}

	if ('dailyGoal' in pending) {
		const v = Math.max(0, Math.round(Number(pending.dailyGoal) || 0))
		delete pending.dailyGoal
		if (!v) {
			uni.showToast({ title: '请输入有效目标', icon: 'none' })
			return
		}
		if (v !== form.dailyGoal) patch.dailyGoal = v
	}

	if (!form.autoMacro) {
		const next = { ...form.macroGoals }
		let touched = false
		for (const k of MACRO_KEYS) {
			if (!(k in pending)) continue
			const v = Math.max(0, Number(pending[k]) || 0)
			delete pending[k]
			if (v !== next[k]) {
				next[k] = v
				touched = true
			}
		}
		if (touched) patch.macroGoals = next
	}

	if (!Object.keys(patch).length) {
		uni.showToast({ title: '已是最新', icon: 'none' })
		return
	}
	commit(patch, '已更新')
}

function onGoalInput(e) {
	pending.dailyGoal = e.detail.value
}

function onMacroInput(key, e) {
	pending[key] = e.detail.value
}

function onGoal(e) {
	const v = Math.max(0, Math.round(Number(e.detail.value) || 0))
	delete pending.dailyGoal
	if (!v) {
		uni.showToast({ title: '请输入有效目标', icon: 'none' })
		Object.assign(form, getSettings())
		return
	}
	commit({ dailyGoal: v })
}

function onMacro(key, e) {
	const v = Math.max(0, Number(e.detail.value) || 0)
	delete pending[key]
	commit({ macroGoals: { ...form.macroGoals, [key]: v } })
}

const onAutoMacro = (e) => commit({ autoMacro: e.detail.value })

/* ---------------- 概览数据 ---------------- */

/**
 * 连续记录天数：从今天（或昨天）往前数，连续有记录的天数。
 *
 * 「今天还没记」不该把连续记录打断 —— 一天还没过完，
 * 所以今天没记时从昨天开始数，昨天也没记就归零。
 */
function computeStreak(records) {
	const days = new Set(records.map((r) => r.date))
	const key = (offset) => {
		const d = new Date()
		d.setDate(d.getDate() - offset)
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
	}
	let n = 0
	let i = days.has(key(0)) ? 0 : 1
	while (days.has(key(i))) {
		n++
		i++
	}
	return n
}

function refresh() {
	// 重新从存储读，待提交的编辑随之作废
	// （否则输入框会停在旧文本上，和 form 里的值对不上）
	clearPending()
	Object.assign(form, getSettings())
	const all = allRecords()
	recordCount.value = all.length
	todayKcal.value = round(sumRecords(recordsByDate(todayKey())).kcal, 0)
	streak.value = computeStreak(all)
}

onShow(refresh)

function commit(patch, msg) {
	Object.assign(form, saveSettings(patch))
	if (msg) uni.showToast({ title: msg, icon: 'none' })
}

function go(url) {
	uni.navigateTo({ url })
}
</script>

<style lang="scss" scoped>
	.page {
		/* 底部留出 tabbar 的高度，滚到底时最后一块内容不会被压住 */
		padding: $s-3 $s-4 calc(#{$h-tabbar} + #{$s-4});
	}

	.card + .card {
		margin-top: $s-3;
	}

	/* ---------- 概览 ---------- */
	.ov-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.kicker {
		font-size: 24rpx;
		color: $c-text-mute;
	}

	.ov-streak {
		font-size: 21rpx;
		color: $c-primary-dark;
		font-weight: 500;
	}

	.ov-num {
		display: flex;
		align-items: baseline;
		margin-top: 6rpx;
	}

	.ov-kcal {
		font-size: 68rpx;
		font-weight: 600;
		line-height: 1.05;
		letter-spacing: -1.5rpx;
		color: $c-primary-dark;
	}

	.ov-goal {
		font-size: 22rpx;
		color: $c-text-mute;
		margin-left: 10rpx;
	}

	.ov-bar {
		height: 10rpx;
		border-radius: $r-pill;
		background: $c-fill;
		overflow: hidden;
		margin: $s-3 0 $s-2;
	}

	.ov-fill {
		height: 100%;
		border-radius: $r-pill;
		background: linear-gradient(90deg, #7cc3a8, $c-primary);
		transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.ov-fill.over {
		background: linear-gradient(90deg, #e0a99e, $c-danger);
	}

	.hint {
		display: block;
		line-height: 1.5;
	}

	/* ---------- 分区标题 ---------- */
	.sec-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: $s-3;
	}

	/* 标题左边一个小图标，让每张卡片一眼能分开 */
	.sec-title-wrap {
		display: flex;
		align-items: center;
	}

	.sec-ico {
		width: 34rpx;
		height: 34rpx;
		margin-right: 12rpx;
		flex-shrink: 0;
	}

	.mini-btn {
		height: 52rpx;
		padding: 0 24rpx;
		border-radius: $r-pill;
		background: $c-fill;
		color: $c-text-sub;
		font-size: 23rpx;
		font-weight: 500;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s, color 0.15s;
	}

	.mini-btn:active {
		opacity: 0.8;
	}

	/* 有改动没落库时点亮，提示「这里可以点」 */
	.mini-btn.on {
		background: $c-primary-weak;
		color: $c-primary-dark;
	}

	/* ---------- 表单 ---------- */
	.field {
		margin-bottom: $s-3;
	}

	.label {
		display: block;
		font-size: 25rpx;
		color: $c-text-sub;
		margin-bottom: 10rpx;
	}

	.input-wrap {
		display: flex;
		align-items: center;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 0 20rpx;
	}

	.input {
		height: 84rpx;
		font-size: 30rpx;
		min-width: 0;
	}

	.suffix {
		font-size: 22rpx;
		color: $c-text-mute;
		margin-left: 8rpx;
		flex-shrink: 0;
	}

	.auto-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 10rpx 20rpx;
	}

	.auto-t {
		font-size: 25rpx;
	}

	/* ---------- 三个营养素目标：一行三列 ---------- */
	.mgrid {
		display: flex;
		margin-top: $s-1;
	}

	.mg {
		flex: 1;
		min-width: 0;
		border-radius: $r-sm;
		padding: 12rpx 10rpx 10rpx;
		text-align: center;
	}

	.mg + .mg {
		margin-left: $s-2;
	}

	.mg-t {
		display: block;
		font-size: 20rpx;
		opacity: 0.85;
	}

	.mg-v-row {
		display: flex;
		align-items: baseline;
		justify-content: center;
		margin-top: 2rpx;
	}

	.mg-input {
		font-size: 34rpx;
		font-weight: 600;
		line-height: 1.3;
		text-align: center;
		min-width: 0;
		width: 100%;
	}

	.mg-u {
		font-size: 19rpx;
		opacity: 0.75;
		margin-left: 1rpx;
		flex-shrink: 0;
	}

	/* ---------- 入口列表 ---------- */
	.list-card {
		padding: 0 $s-4;
	}

	.entry {
		display: flex;
		align-items: center;
		padding: $s-4 0;
	}

	.entry + .entry {
		border-top: 1rpx solid $c-line;
	}

	.entry-press {
		background: $c-primary-tint;
	}

	.entry-ico {
		width: 40rpx;
		height: 40rpx;
		margin-right: $s-3;
		flex-shrink: 0;
	}

	.entry-main {
		flex: 1;
		min-width: 0;
	}

	.entry-t {
		display: block;
		font-size: 28rpx;
		font-weight: 500;
	}

	.entry-s {
		display: block;
		font-size: 21rpx;
		color: $c-text-mute;
		margin-top: 3rpx;
	}

	/* ---------- 隐私 ---------- */
	.privacy {
		background: $c-primary-weak;
		border-radius: $r-md;
		padding: $s-3 $s-4;
		margin-top: $s-3;
	}

	.privacy-t {
		font-size: 22rpx;
		font-weight: 600;
		color: $c-primary-dark;
		line-height: 1.6;
	}

	/* ---------- 关于：压到最底部，小字 ---------- */
	.about {
		margin-top: $s-5;
		padding: 0 $s-1;
	}

	.about-t {
		display: block;
		font-size: 19rpx;
		color: $c-text-mute;
		line-height: 1.7;
	}
</style>
