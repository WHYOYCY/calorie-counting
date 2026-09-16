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

		<!-- 汇总：大数字 + 达标率环 -->
		<view class="card">
			<view class="sum-top">
				<view class="grow">
					<text class="kicker">总摄入</text>
					<view class="hero">
						<text class="hero-num num">{{ groupDigits(round(summary.totals.kcal, 0)) }}</text>
						<text class="hero-unit">kcal</text>
					</view>
					<text v-if="summary.activeDays" class="hero-sub">
						共 {{ summary.dayCount }} 天 · 有记录 {{ summary.activeDays }} 天
					</text>
				</view>
				<view v-if="summary.activeDays" class="ring" :style="{ background: ringBg }">
					<view class="ring-in">
						<text class="ring-v num" :class="ringTone">{{ summary.goalRate }}<text class="ring-suf">%</text></text>
						<text class="ring-k">达标率</text>
					</view>
				</view>
			</view>

			<!-- 三个次要指标：等宽格子，横向对齐 -->
			<view class="tiles">
				<view class="tile">
					<text class="tile-v num">{{ groupDigits(summary.avgPerActiveDay) }}</text>
					<text class="tile-k">日均 kcal</text>
				</view>
				<view class="tile">
					<text class="tile-v num">{{ summary.activeDays }}</text>
					<text class="tile-k">有记录天数</text>
				</view>
				<view class="tile">
					<text class="tile-v num" :class="{ warn: summary.overDays > 0 }">
						{{ summary.overDays }}
					</text>
					<text class="tile-k">超出目标</text>
				</view>
			</view>

			<!-- 营养素胶囊：浅底深字，一眼区分三种 -->
			<view class="pills">
				<view
					v-for="m in macroLine"
					:key="m.key"
					class="mpill"
					:style="{ background: m.soft, color: m.deep }"
				>
					<text class="mpill-t">{{ m.label }}</text>
					<text class="mpill-v num">{{ m.value }}g</text>
				</view>
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
								:class="{ over: goal > 0 && b.value > goal, today: b.today }"
								:style="{ height: b.h + '%' }"
								@click="tapBar(b)"
							></view>
						</view>
					</view>
				</view>
			</view>

			<view class="xaxis">
				<text
					class="xlabel"
					v-for="(b, i) in bars"
					:key="i"
					:class="{ dim: !b.label, today: b.today }"
				>
					{{ b.label }}
				</text>
			</view>
		</view>

		<!-- 餐次分布：一条堆叠条看结构，下面四项看细节 -->
		<view class="card">
			<view class="between card-head">
				<text class="kicker">餐次分布</text>
				<text v-if="summary.totals.kcal > 0" class="t-xs t-mute">按热量占比</text>
			</view>

			<view v-if="summary.totals.kcal > 0" class="stack">
				<view
					v-for="m in mealsFilled"
					:key="m.key"
					class="stack-i"
					:style="{ width: m.pct + '%', background: m.color }"
				></view>
			</view>
			<text v-else class="stack-empty">这个区间还没有记录</text>

			<view class="mgrid">
				<view class="mg" v-for="m in meals" :key="m.key" :class="{ off: !m.count }">
					<view class="mg-head">
						<view class="mg-dot" :style="{ background: m.color }"></view>
						<text class="mg-name grow">{{ m.label }}</text>
						<text v-if="m.count" class="mg-pct num">{{ m.pct }}%</text>
					</view>
					<text class="mg-kcal num">
						{{ groupDigits(m.totals.kcal) }}<text class="mg-unit"> kcal</text>
					</text>
					<text class="mg-cnt">{{ m.count }} 条记录</text>
				</view>
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
import { withAlpha, darken } from '../../core/color.js'
import { groupDigits, percent, round } from '../../core/nutrition.js'
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
	return MACRO_META.map((m) => ({
		...m,
		value: t[m.key] || 0,
		// 浅底深字：底色是同色相的低透明度，文字压暗保证对比度
		soft: withAlpha(m.color, 0.16),
		deep: darken(m.color, 0.42),
	}))
})

/**
 * 达标率环：用 conic-gradient 画，不需要 canvas。
 * 底色先铺一层同色的浅色（这样即使 conic-gradient 不被支持，
 * 也是一个完整的浅色环，不会变成一块空白）。
 */
const ringColor = computed(() => {
	if (!summary.value.activeDays) return '#dfe5ea'
	return summary.value.goalRate >= 60 ? '#52a98a' : '#d9a45b'
})

const ringTone = computed(() => (summary.value.goalRate >= 60 ? '' : 'warn'))

const ringBg = computed(() => {
	const p = Math.max(0, Math.min(100, Number(summary.value.goalRate) || 0))
	return `conic-gradient(${ringColor.value} 0 ${p}%, ${withAlpha(ringColor.value, 0.18)} ${p}% 100%)`
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

/** 目标线夹到 96%，否则目标 >= 刻度上限时会贴在图顶被裁掉 */
const goalPct = computed(() => {
	if (goal.value <= 0) return 0
	return Math.min(96, (goal.value / scaleMax.value) * 100)
})

const bars = computed(() => {
	const isMonth = mode.value === 'month'
	const max = scaleMax.value
	return summary.value.series.map((s) => {
		const day = Number(s.date.slice(8))
		const wd = WEEK_SHORT[parseKey(s.date).getDay()]
		const kcal = s.totals.kcal
		return {
			date: s.date,
			value: kcal,
			// 值为 0 就不画柱（否则只剩一截误导性的短柱）
			h: kcal > 0 ? Math.max(2, Math.round((kcal / max) * 100)) : 0,
			// 月视图只标 1/5/10… 避免 30 个标签挤在一起
			label: isMonth ? (day === 1 || day % 5 === 0 ? String(day) : '') : wd,
			today: s.date === todayKey(),
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

/** 堆叠条只画有热量的餐次；全为 0 时整条不画（否则会出现一条空白底槽） */
const mealsFilled = computed(() => meals.value.filter((m) => m.pct > 0))

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
		/* 底部留出 tabbar 的高度，滚到底时最后一张卡片不会被压住 */
		padding: $s-3 $s-4 calc(#{$h-tabbar} + #{$s-4});
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

	.sum-top {
		display: flex;
		align-items: center;
	}

	.hero {
		display: flex;
		align-items: baseline;
		margin-top: 4rpx;
	}

	/* 展示级大数字：主色 + 半粗，配细字重的字体显得稳而不重 */
	.hero-num {
		font-family: $ff-num;
		font-size: 88rpx;
		font-weight: 600;
		line-height: 1.02;
		letter-spacing: -2rpx;
		color: $c-primary-dark;
	}

	.hero-unit {
		font-size: 24rpx;
		color: $c-text-mute;
		margin-left: 10rpx;
	}

	.hero-sub {
		display: block;
		font-size: 21rpx;
		color: $c-text-mute;
		margin-top: 6rpx;
	}

	/* ---------- 达标率环 ---------- */
	.ring {
		width: 148rpx;
		height: 148rpx;
		border-radius: $r-pill;
		padding: 15rpx;
		margin-left: $s-4;
		flex-shrink: 0;
	}

	.ring-in {
		width: 100%;
		height: 100%;
		border-radius: $r-pill;
		background: #fff;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.ring-v {
		font-size: 38rpx;
		font-weight: 600;
		line-height: 1.1;
		color: $c-primary-dark;
	}

	.ring-v.warn {
		color: $c-warn;
	}

	.ring-suf {
		font-size: 20rpx;
		font-weight: 400;
		margin-left: 1rpx;
	}

	.ring-k {
		font-size: 19rpx;
		color: $c-text-mute;
		margin-top: 1rpx;
	}

	/* ---------- 次要指标格子 ---------- */
	.tiles {
		display: flex;
		margin-top: $s-4;
	}

	.tile {
		flex: 1;
		min-width: 0;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 14rpx 6rpx;
		text-align: center;
	}

	.tile + .tile {
		margin-left: $s-2;
	}

	.tile-v {
		display: block;
		font-size: 34rpx;
		font-weight: 600;
		line-height: 1.2;
	}

	.tile-v.warn {
		color: $c-danger;
	}

	.tile-k {
		display: block;
		font-size: 20rpx;
		color: $c-text-mute;
		margin-top: 2rpx;
	}

	/* ---------- 营养素胶囊 ---------- */
	.pills {
		display: flex;
		margin-top: $s-3;
	}

	.mpill {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		justify-content: center;
		padding: 12rpx 8rpx;
		border-radius: $r-pill;
	}

	.mpill + .mpill {
		margin-left: $s-2;
	}

	.mpill-t {
		font-size: 21rpx;
		margin-right: 8rpx;
		opacity: 0.85;
	}

	.mpill-v {
		font-size: 25rpx;
		font-weight: 600;
	}

	/* ---------- 图表 ---------- */
	.legend {
		display: flex;
		align-items: center;
	}

	.legend-line {
		width: 26rpx;
		height: 2rpx;
		background: $c-line-strong;
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
		/* 极淡实线：只做参照，虚线会让整张图显得吵 */
		background: rgba(28, 39, 51, 0.15);
	}

	.bars {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: flex-end;
		/* 只有几根柱子时居中聚拢，避免整张图空荡荡 */
		justify-content: center;
	}

	.bar-col {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		min-width: 0;
		/* 上限只对「柱子很少」的情况生效：3 根柱子时撑到约 90px 宽，
		   31 天时仍然等分填满（那时每列只有十几 px，够不到上限） */
		max-width: 132rpx;
	}

	.bar-wrap {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.bar {
		width: 64%;
		max-width: 76rpx;
		min-width: 14rpx;
		background: linear-gradient(180deg, #7cc3a8, $c-primary);
		border-radius: 10rpx 10rpx 3rpx 3rpx;
		transition: opacity 0.15s;
	}

	.bar:active {
		opacity: 0.75;
	}

	.bar.over {
		background: linear-gradient(180deg, #e0a99e, $c-danger);
	}

	/* 今天：加一圈同色描边，扫一眼就知道自己在哪一天 */
	.bar.today {
		box-shadow: 0 0 0 3rpx $c-primary-weak;
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

	.xlabel.today {
		color: $c-primary-dark;
		font-weight: 600;
	}

	/* ---------- 餐次 ---------- */
	.stack {
		display: flex;
		height: 30rpx;
		border-radius: $r-pill;
		overflow: hidden;
		background: $c-fill;
	}

	.stack-i {
		height: 100%;
		min-width: 6rpx;
	}

	.stack-i + .stack-i {
		border-left: 2rpx solid #fff;
	}

	.stack-empty {
		display: block;
		font-size: 23rpx;
		color: $c-text-mute;
		padding: $s-3 0;
	}

	.mgrid {
		display: flex;
		flex-wrap: wrap;
		margin-top: $s-3;
	}

	.mg {
		width: 50%;
		padding: $s-2 0;
	}

	/* 左列留白，右列靠左对齐，视觉上仍然成列 */
	.mg:nth-child(odd) {
		padding-right: $s-3;
	}

	.mg.off .mg-name,
	.mg.off .mg-kcal {
		color: $c-text-mute;
		opacity: 0.75;
	}

	.mg-head {
		display: flex;
		align-items: center;
	}

	.mg-dot {
		width: 14rpx;
		height: 14rpx;
		border-radius: $r-pill;
		margin-right: 8rpx;
		flex-shrink: 0;
	}

	.mg-name {
		font-size: 25rpx;
	}

	.mg-pct {
		font-size: 20rpx;
		color: $c-text-mute;
		margin-left: 6rpx;
	}

	.mg-kcal {
		display: block;
		font-size: 30rpx;
		font-weight: 600;
		line-height: 1.25;
		margin-top: 4rpx;
	}

	.mg-unit {
		font-size: 19rpx;
		font-weight: 400;
		color: $c-text-mute;
	}

	.mg-cnt {
		display: block;
		font-size: 19rpx;
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
