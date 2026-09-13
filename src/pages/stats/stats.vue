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
		<view class="rangebar">
			<view class="navbtn" @click="shift(-1)"><text class="chev">‹</text></view>
			<view class="rangeinfo">
				<text class="rtitle">{{ rangeLabel }}</text>
				<text class="rsub">{{ rangeSub }}</text>
			</view>
			<view class="navbtn" @click="shift(1)"><text class="chev">›</text></view>
		</view>

		<!-- 汇总 -->
		<view class="card">
			<view class="between">
				<text class="t-sub">总摄入</text>
				<text class="num big-kcal">{{ summary.totals.kcal }}</text>
			</view>
			<view class="stats">
				<view class="stat">
					<text class="stat-v num">{{ summary.avgPerActiveDay }}</text>
					<text class="stat-k t-xs t-mute">日均 kcal</text>
				</view>
				<view class="stat">
					<text class="stat-v num">{{ summary.activeDays }}</text>
					<text class="stat-k t-xs t-mute">有记录天数</text>
				</view>
				<view class="stat">
					<text class="stat-v num" :class="{ warn: summary.goalRate < 60 }">{{ summary.goalRate }}%</text>
					<text class="stat-k t-xs t-mute">达标率</text>
				</view>
			</view>
			<view class="macro-line">
				<text class="t-xs t-mute num">蛋白 {{ summary.totals.protein }}g</text>
				<text class="t-xs t-mute num">脂肪 {{ summary.totals.fat }}g</text>
				<text class="t-xs t-mute num">碳水 {{ summary.totals.carbs }}g</text>
			</view>
			<view v-if="summary.overDays" class="t-xs over-tip">
				有 {{ summary.overDays }} 天超出目标（{{ goal }} kcal）
			</view>
		</view>

		<!-- 趋势柱状图 -->
		<view class="card" v-if="mode !== 'day'">
			<text class="label">每日热量</text>
			<view class="chart">
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
						<text class="bar-label" :class="{ dim: !b.value }">{{ b.label }}</text>
					</view>
				</view>
			</view>
			<view class="legend t-xs t-mute">
				<text>绿色＝未超目标</text>
				<text v-if="goal > 0" class="legend-r">红色＝超出目标</text>
			</view>
		</view>

		<!-- 餐次分布 -->
		<view class="card">
			<text class="label">餐次分布</text>
			<view class="meal" v-for="m in meals" :key="m.key">
				<view class="between meal-head">
					<view class="row">
						<text class="dot" :style="{ background: m.color }"></text>
						<text class="t-sm">{{ m.label }}</text>
					</view>
					<text class="t-xs t-mute num">{{ m.totals.kcal }} kcal · {{ m.count }} 条</text>
				</view>
				<view class="mbar">
					<view class="mfill" :style="{ width: m.pct + '%', background: m.color }"></view>
				</view>
			</view>
		</view>

		<!-- 食物排行 -->
		<view class="card">
			<text class="label">食物排行（按热量）</text>
			<view v-if="foods.length">
				<view class="food" v-for="(f, i) in foods" :key="f.name">
					<text class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</text>
					<view class="grow">
						<text class="food-name ellipsis">{{ f.name }}</text>
						<text class="t-xs t-mute num">{{ f.times }} 次 · 共 {{ f.grams }}g</text>
					</view>
					<text class="num t-sub t-sm">{{ f.kcal }} kcal</text>
				</view>
			</view>
			<view v-else class="empty">这个区间还没有记录</view>
		</view>
	</view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
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
import { percent } from '../../core/nutrition.js'
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
	return `${f.getMonth() + 1}月${f.getDate()}日 - ${t.getMonth() + 1}月${t.getDate()}日`
})

const rangeSub = computed(() => {
	if (mode.value === 'day') return '单日'
	if (mode.value === 'week') return '周一至周日'
	const d = parseKey(range.value.from)
	return `${d.getFullYear()}年 · 共 ${summary.value.dayCount} 天`
})

const bars = computed(() => {
	const series = summary.value.series
	let max = 0
	for (const s of series) max = Math.max(max, s.totals.kcal)
	if (max <= 0) max = 1
	const isMonth = mode.value === 'month'
	return series.map((s) => {
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

const mealPct = computed(() => {
	const total = summary.value.totals.kcal || 0
	return mealBreakdown(records.value).map((m) => ({
		...m,
		pct: percent(m.totals.kcal, total, 100),
	}))
})

const meals = computed(() => mealPct.value)

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
		padding: $gap;
		padding-bottom: 60rpx;
	}

	.label {
		font-size: 26rpx;
		color: $c-text-sub;
		display: block;
		margin-bottom: $gap-sm;
	}

	/* ---------- 维度切换 ---------- */
	.seg {
		display: flex;
		background: #eceff1;
		border-radius: $radius-sm;
		padding: 6rpx;
	}

	.seg-item {
		flex: 1;
		text-align: center;
		padding: 14rpx 0;
		font-size: 27rpx;
		color: $c-text-sub;
		border-radius: 10rpx;
	}

	.seg-item.on {
		background: #fff;
		color: $c-text;
		font-weight: 600;
	}

	/* ---------- 区间切换 ---------- */
	.rangebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: $gap 8rpx;
	}

	.navbtn {
		width: 72rpx;
		height: 72rpx;
		border-radius: 36rpx;
		background: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.chev {
		font-size: 40rpx;
		line-height: 1;
		color: $c-text-sub;
		margin-top: -6rpx;
	}

	.rangeinfo {
		flex: 1;
		text-align: center;
	}

	.rtitle {
		display: block;
		font-size: 32rpx;
		font-weight: 600;
	}

	.rsub {
		display: block;
		font-size: 22rpx;
		color: $c-text-mute;
		margin-top: 2rpx;
	}

	/* ---------- 汇总 ---------- */
	.big-kcal {
		font-size: 54rpx;
		font-weight: 700;
		color: $c-primary-dark;
	}

	.stats {
		display: flex;
		margin-top: $gap;
		padding-top: $gap;
		border-top: 1rpx solid $c-border;
	}

	.stat {
		flex: 1;
		text-align: center;
	}

	.stat-v {
		display: block;
		font-size: 36rpx;
		font-weight: 600;
	}

	.stat-v.warn {
		color: $c-warn;
	}

	.stat-k {
		display: block;
		margin-top: 2rpx;
	}

	.macro-line {
		display: flex;
		justify-content: space-between;
		margin-top: $gap;
		padding-top: $gap-sm;
		border-top: 1rpx solid $c-border;
	}

	.over-tip {
		margin-top: 8rpx;
		color: $c-danger;
	}

	/* ---------- 柱状图 ---------- */
	.chart {
		height: 260rpx;
	}

	.bars {
		display: flex;
		align-items: flex-end;
		height: 100%;
	}

	.bar-col {
		flex: 1;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 0;
	}

	.bar-wrap {
		flex: 1;
		width: 100%;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.bar {
		width: 60%;
		max-width: 40rpx;
		min-height: 4rpx;
		background: $c-primary;
		border-radius: 6rpx 6rpx 0 0;
	}

	.bar.over {
		background: $c-danger;
	}

	.bar-label {
		font-size: 20rpx;
		color: $c-text-sub;
		margin-top: 8rpx;
		height: 28rpx;
		line-height: 28rpx;
	}

	.bar-label.dim {
		color: #d8dcdf;
	}

	.legend {
		display: flex;
		margin-top: $gap-sm;
	}

	.legend-r {
		margin-left: $gap;
	}

	/* ---------- 餐次 ---------- */
	.meal + .meal {
		margin-top: $gap;
	}

	.meal-head {
		margin-bottom: 8rpx;
	}

	.dot {
		width: 16rpx;
		height: 16rpx;
		border-radius: 8rpx;
		margin-right: 10rpx;
	}

	.mbar {
		height: 12rpx;
		border-radius: 6rpx;
		background: #eef0f2;
		overflow: hidden;
	}

	.mfill {
		height: 100%;
		border-radius: 6rpx;
	}

	/* ---------- 食物排行 ---------- */
	.food {
		display: flex;
		align-items: center;
		padding: 16rpx 0;
		border-top: 1rpx solid $c-border;
	}

	.food:first-child {
		border-top: none;
	}

	.rank {
		width: 44rpx;
		height: 44rpx;
		border-radius: 22rpx;
		background: #f0f2f4;
		color: $c-text-sub;
		font-size: 22rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: $gap-sm;
		flex-shrink: 0;
	}

	.rank.top {
		background: $c-primary;
		color: #fff;
	}

	.food-name {
		display: block;
		font-size: 28rpx;
	}
</style>
