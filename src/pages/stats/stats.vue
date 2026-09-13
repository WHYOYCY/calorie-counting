<template>
	<view class="page">
		<!-- 维度切换 -->
		<view class="seg">
			<view
				v-for="m in MODES"
				:key="m.key"
				class="seg-item"
				:class="{ on: mode === m.key }"
				@click="switchMode(m.key)"
			>
				{{ m.label }}
			</view>
		</view>

		<!-- 区间切换 -->
		<view class="head">
			<view class="nav" @click="shift(-1)">
				<image class="ico-sm flip" src="/static/ui/chevron.png" mode="aspectFit" />
			</view>
			<view class="head-mid">
				<text class="head-title num">{{ rangeLabel }}</text>
				<text class="head-sub">{{ rangeSub }}</text>
			</view>
			<view class="nav" @click="shift(1)">
				<image class="ico-sm" src="/static/ui/chevron.png" mode="aspectFit" />
			</view>
		</view>

		<!-- 汇总 -->
		<view class="card">
			<text class="kicker">总摄入</text>
			<view class="hero">
				<text class="hero-num num">{{ groupDigits(summary.totals.kcal) }}</text>
				<text class="hero-unit">kcal</text>
			</view>

			<view class="hr"></view>

			<view class="stats">
				<view class="stat">
					<text class="stat-v num">{{ groupDigits(summary.avgPerActiveDay) }}</text>
					<text class="stat-k">日均 kcal</text>
				</view>
				<view class="stat-div"></view>
				<view class="stat">
					<text class="stat-v num">{{ summary.activeDays }}</text>
					<text class="stat-k">有记录天数</text>
				</view>
				<view class="stat-div"></view>
				<view class="stat">
					<text class="stat-v num" :class="{ warn: summary.activeDays && summary.goalRate < 60 }">
						{{ summary.goalRate }}<text class="stat-suf">%</text>
					</text>
					<text class="stat-k">达标率</text>
				</view>
			</view>

			<view class="macro-line">
				<view class="ml" v-for="m in macroLine" :key="m.key">
					<view class="ml-dot" :style="{ background: m.color }"></view>
					<text class="ml-label">{{ m.label }}</text>
					<text class="ml-val num">{{ m.value }}g</text>
				</view>
			</view>

			<view v-if="summary.overDays" class="over-tip">
				有 {{ summary.overDays }} 天超出目标（{{ groupDigits(goal) }} kcal）
			</view>
		</view>

		<!-- 趋势 -->
		<view class="card" v-if="mode !== 'day'">
			<view class="between card-head">
				<text class="kicker">每日热量</text>
				<view class="legend" v-if="goal > 0">
					<view class="legend-line"></view>
					<text class="legend-t">目标 {{ groupDigits(goal) }}</text>
				</view>
			</view>

			<view class="plot">
				<view v-if="goal > 0" class="goal-line" :style="{ bottom: goalPct + '%' }"></view>
				<view class="bars">
					<view class="bar-col" v-for="(b, i) in bars" :key="i">
						<view class="bar-wrap">
							<view
								class="bar"
								:class="{ over: goal > 0 && b.value > goal }"
								:style="{ height: b.h + '%' }"
								@click="tapBar(b)"
							></view>
						</view>
					</view>
				</view>
			</view>

			<view class="xaxis">
				<text class="xlabel" v-for="(b, i) in bars" :key="i" :class="{ dim: !b.label }">
					{{ b.label }}
				</text>
			</view>
		</view>

		<!-- 餐次分布 -->
		<view class="card">
			<text class="kicker">餐次分布</text>
			<view class="meal" v-for="m in meals" :key="m.key">
				<view class="meal-row">
					<view class="meal-dot" :style="{ background: m.color }"></view>
					<text class="meal-name grow">{{ m.label }}</text>
					<text class="meal-kcal num">{{ groupDigits(m.totals.kcal) }}</text>
					<text class="meal-unit">kcal</text>
				</view>
				<view class="mbar">
					<view class="mfill" :style="{ width: m.pct + '%', background: m.color }"></view>
				</view>
				<text class="meal-count">{{ m.count }} 条记录</text>
			</view>
		</view>

		<!-- 食物排行 -->
		<view class="card">
			<text class="kicker">食物排行 · 按热量</text>
			<view v-if="foods.length">
				<view class="food" v-for="(f, i) in foods" :key="f.name">
					<text class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</text>
					<view class="grow">
						<text class="food-name ellipsis">{{ f.name }}</text>
						<text class="food-meta num">{{ f.times }} 次 · 共 {{ f.grams }} g</text>
					</view>
					<text class="food-kcal num">{{ groupDigits(f.kcal) }}</text>
				</view>
			</view>
			<view v-else class="empty">这个区间还没有记录</view>
		</view>
	</view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { MACRO_META } from '../../core/constants.js'
import {
	addDays,
	dateKey,
	dateLabel,
	endOfMonth,
	monthLabel,
	parseKey,
	startOfMonth,
	startOfWeek,
	todayKey,
} from '../../core/date.js'
import { getSettings, recordsInRange } from '../../core/db.js'
import { groupDigits, percent } from '../../core/nutrition.js'
import { mealBreakdown, rangeSummary, topFoods } from '../../core/stats.js'

const MODES = [
	{ key: 'day', label: '日' },
	{ key: 'week', label: '周' },
	{ key: 'month', label: '月' },
]

const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六']

const mode = ref('week')
const anchor = ref(todayKey())
const settings = ref(getSettings())

const goal = computed(() => Number(settings.value.dailyGoal) || 0)

const range = computed(() => {
	if (mode.value === 'day') return { from: anchor.value, to: anchor.value }
	if (mode.value === 'week') {
		const from = startOfWeek(anchor.value)
		return { from, to: addDays(from, 6) }
	}
	return { from: startOfMonth(anchor.value), to: endOfMonth(anchor.value) }
})

const records = computed(() => recordsInRange(range.value.from, range.value.to))

const summary = computed(() =>
	rangeSummary(records.value, range.value.from, range.value.to, goal.value)
)

const rangeLabel = computed(() => {
	if (mode.value === 'day') return dateLabel(anchor.value)
	if (mode.value === 'month') return monthLabel(anchor.value.slice(0, 7))
	const f = parseKey(range.value.from)
	const t = parseKey(range.value.to)
	return `${f.getMonth() + 1}月${f.getDate()}日 – ${t.getMonth() + 1}月${t.getDate()}日`
})

const rangeSub = computed(() => {
	if (mode.value === 'day') return '单日汇总'
	if (mode.value === 'week') return '周一至周日'
	const d = parseKey(range.value.from)
	return `${d.getFullYear()}年 · 共 ${summary.value.dayCount} 天`
})

const macroLine = computed(() => {
	const t = summary.value.totals
	return MACRO_META.map((m) => ({ ...m, value: t[m.key] || 0 }))
})

/**
 * 柱状图刻度上限把「目标线」也算进去，
 * 这样目标线永远落在图内，柱高与目标线可直观对比。
 */
const scaleMax = computed(() => {
	let max = goal.value
	for (const s of summary.value.series) max = Math.max(max, s.totals.kcal)
	return max > 0 ? max : 1
})

const goalPct = computed(() => {
	if (goal.value <= 0) return 0
	return Math.min(100, (goal.value / scaleMax.value) * 100)
})

const bars = computed(() => {
	const isMonth = mode.value === 'month'
	const max = scaleMax.value
	return summary.value.series.map((s) => {
		const day = Number(s.date.slice(8))
		const wd = WEEK_SHORT[parseKey(s.date).getDay()]
		return {
			date: s.date,
			value: s.totals.kcal,
			h: Math.round((s.totals.kcal / max) * 100),
			// 月视图只标 1/5/10… 避免 30 个标签挤在一起
			label: isMonth ? (day === 1 || day % 5 === 0 ? String(day) : '') : wd,
		}
	})
})

const meals = computed(() => {
	const total = summary.value.totals.kcal || 0
	return mealBreakdown(records.value).map((m) => ({
		...m,
		pct: percent(m.totals.kcal, total, 100),
	}))
})

const foods = computed(() => topFoods(records.value, 10))

function refresh() {
	settings.value = getSettings()
}

onShow(refresh)

function switchMode(key) {
	mode.value = key
}

function shift(n) {
	if (mode.value === 'day') {
		anchor.value = addDays(anchor.value, n)
	} else if (mode.value === 'week') {
		anchor.value = addDays(anchor.value, n * 7)
	} else {
		const d = parseKey(anchor.value)
		d.setDate(1)
		d.setMonth(d.getMonth() + n)
		anchor.value = dateKey(d.getTime())
	}
}

function tapBar(b) {
	if (!b.value) return
	uni.showToast({ title: `${b.date.slice(5)} · ${b.value} kcal`, icon: 'none' })
}
</script>

<style lang="scss" scoped>
	.page {
		padding: $s-3 $s-4 $s-6;
	}

	.flip {
		transform: rotate(180deg);
	}

	/* ---------- 维度切换 ---------- */
	.seg {
		display: flex;
		background: #eceff2;
		border-radius: $r-sm;
		padding: 5rpx;
	}

	.seg-item {
		flex: 1;
		text-align: center;
		padding: 14rpx 0;
		font-size: 27rpx;
		color: $c-text-sub;
		border-radius: $r-xs;
		transition: background 0.2s, color 0.2s;
	}

	.seg-item.on {
		background: #fff;
		color: $c-text;
		font-weight: 600;
		box-shadow: $sh-1;
	}

	/* ---------- 区间切换 ---------- */
	.head {
		display: flex;
		align-items: center;
		padding: $s-4 0;
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

	.head-mid {
		flex: 1;
		text-align: center;
	}

	.head-title {
		display: block;
		font-size: 32rpx;
		font-weight: 600;
	}

	.head-sub {
		display: block;
		font-size: 22rpx;
		color: $c-text-mute;
		margin-top: 2rpx;
	}

	/* ---------- 汇总 ---------- */
	.kicker {
		display: block;
		font-size: 24rpx;
		color: $c-text-mute;
	}

	.card-head {
		margin-bottom: $s-4;
	}

	.hero {
		display: flex;
		align-items: baseline;
		margin-top: 6rpx;
	}

	.hero-num {
		font-size: 72rpx;
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: -1.5rpx;
		color: $c-primary-dark;
	}

	.hero-unit {
		font-size: 24rpx;
		color: $c-text-mute;
		margin-left: 10rpx;
	}

	.hr {
		height: 1rpx;
		background: $c-line;
		margin: $s-4 0;
	}

	.stats {
		display: flex;
		align-items: center;
	}

	.stat {
		flex: 1;
		text-align: center;
	}

	.stat-div {
		width: 1rpx;
		height: 52rpx;
		background: $c-line;
	}

	.stat-v {
		display: block;
		font-size: 38rpx;
		font-weight: 600;
		line-height: 1.2;
	}

	.stat-v.warn {
		color: $c-warn;
	}

	.stat-suf {
		font-size: 22rpx;
		font-weight: 400;
		color: $c-text-mute;
		margin-left: 2rpx;
	}

	.stat-k {
		display: block;
		font-size: 21rpx;
		color: $c-text-mute;
		margin-top: 4rpx;
	}

	.macro-line {
		display: flex;
		margin-top: $s-4;
		padding-top: $s-3;
		border-top: 1rpx solid $c-line;
	}

	.ml {
		flex: 1;
		display: flex;
		align-items: center;
	}

	.ml-dot {
		width: 12rpx;
		height: 12rpx;
		border-radius: $r-pill;
		margin-right: 8rpx;
		flex-shrink: 0;
	}

	.ml-label {
		font-size: 21rpx;
		color: $c-text-mute;
		margin-right: 8rpx;
	}

	.ml-val {
		font-size: 23rpx;
		font-weight: 600;
	}

	.over-tip {
		margin-top: $s-3;
		font-size: 22rpx;
		color: $c-danger;
	}

	/* ---------- 图表 ---------- */
	.legend {
		display: flex;
		align-items: center;
	}

	.legend-line {
		width: 28rpx;
		height: 2rpx;
		background: $c-text-mute;
		margin-right: 8rpx;
	}

	.legend-t {
		font-size: 21rpx;
		color: $c-text-mute;
	}

	.plot {
		position: relative;
		height: 240rpx;
	}

	.goal-line {
		position: absolute;
		left: 0;
		right: 0;
		height: 1rpx;
		background: repeating-linear-gradient(
			to right,
			$c-text-mute 0,
			$c-text-mute 8rpx,
			transparent 8rpx,
			transparent 16rpx
		);
		opacity: 0.7;
	}

	.bars {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: flex-end;
	}

	.bar-col {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		min-width: 0;
	}

	.bar-wrap {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.bar {
		width: 56%;
		max-width: 34rpx;
		min-height: 4rpx;
		background: linear-gradient(180deg, #17b87b, $c-primary);
		border-radius: 6rpx 6rpx 0 0;
	}

	.bar.over {
		background: linear-gradient(180deg, #f97066, $c-danger);
	}

	.xaxis {
		display: flex;
		margin-top: $s-2;
	}

	.xlabel {
		flex: 1;
		text-align: center;
		font-size: 20rpx;
		color: $c-text-sub;
	}

	.xlabel.dim {
		color: transparent;
	}

	/* ---------- 餐次 ---------- */
	.meal + .meal {
		margin-top: $s-4;
	}

	.meal-row {
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
		font-size: 27rpx;
		font-weight: 500;
	}

	.meal-kcal {
		font-size: 27rpx;
		font-weight: 600;
	}

	.meal-unit {
		font-size: 20rpx;
		color: $c-text-mute;
		margin-left: 5rpx;
	}

	.mbar {
		height: 10rpx;
		border-radius: $r-pill;
		background: $c-fill;
		overflow: hidden;
		margin: $s-2 0 8rpx;
	}

	.mfill {
		height: 100%;
		border-radius: $r-pill;
	}

	.meal-count {
		font-size: 20rpx;
		color: $c-text-mute;
	}

	/* ---------- 排行 ---------- */
	.food {
		display: flex;
		align-items: center;
		padding: 16rpx 0;
	}

	.food + .food {
		border-top: 1rpx solid $c-line;
	}

	.rank {
		width: 40rpx;
		height: 40rpx;
		border-radius: 12rpx;
		background: $c-fill;
		color: $c-text-mute;
		font-size: 21rpx;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: $s-3;
		flex-shrink: 0;
	}

	.rank.top {
		background: $c-primary-weak;
		color: $c-primary-dark;
	}

	.food-name {
		display: block;
		font-size: 28rpx;
	}

	.food-meta {
		display: block;
		font-size: 20rpx;
		color: $c-text-mute;
		margin-top: 2rpx;
	}

	.food-kcal {
		font-size: 26rpx;
		font-weight: 600;
		color: $c-text-sub;
	}
</style>
