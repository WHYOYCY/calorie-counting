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

		<!-- 汇总：只留三个关键指标（总摄入已经去掉，看下面的热力图与图表） -->
		<view class="card">
			<view class="tiles">
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
				<view class="tile">
					<text
						class="tile-v num"
						:class="{ warn: summary.activeDays && summary.goalRate < 60 }"
					>
						{{ summary.goalRate }}<text class="tile-suf">%</text>
					</text>
					<text class="tile-k">达标率</text>
				</view>
			</view>
			<text v-if="summary.activeDays" class="tile-note">
				达标率 = 有记录的天里，没超过 {{ groupDigits(goal) }} kcal 的比例
			</text>
		</view>

		<!-- 打卡热力图：一列一周，七行是周一到周日 -->
		<view class="card">
			<view class="between card-head">
				<text class="kicker">打卡热力图</text>
				<text class="t-xs t-mute">最近 {{ heat.weeks }} 周</text>
			</view>

			<view class="hm">
				<view class="hm-labels">
					<text class="hm-month" v-for="(m, i) in heat.months" :key="i">
						{{ i === 0 || m !== heat.months[i - 1] ? m + '月' : '' }}
					</text>
				</view>
				<view class="hm-main">
					<view class="hm-days">
						<text
							v-for="(d, i) in WEEK_SHORT"
							:key="i"
							class="hm-day"
							:class="{ hide: i % 2 === 1 }"
						>
							{{ d }}
						</text>
					</view>
					<view class="hm-grid">
						<view class="hm-col" v-for="(col, ci) in heat.cells" :key="ci">
							<view
								v-for="cell in col"
								:key="cell.date"
								class="hm-cell"
								:class="['lv' + cell.level, { future: cell.future, on: cell.date === picked }]"
								@click="tapDay(cell)"
							></view>
						</view>
					</view>
				</view>
			</view>

			<view class="hm-foot">
				<text class="hm-foot-t">少</text>
				<view v-for="l in LEVELS" :key="l" class="hm-cell hm-mini" :class="'lv' + l"></view>
				<text class="hm-foot-t">多</text>
				<text class="hm-foot-hint">点格子看当天吃了什么</text>
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

	<!-- 当天详情：点热力图格子后弹出 -->
	<view v-if="picked" class="mask" @click="closeDay">
		<view class="dialog" @click.stop>
			<view class="between">
				<text class="dialog-title">{{ pickedLabel }}</text>
				<text class="t-xs t-mute">{{ day.count }} 条记录</text>
			</view>

			<view class="dd-top">
				<text class="dd-v num">{{ groupDigits(day.kcal) }}</text>
				<text class="dd-u">kcal</text>
				<text v-if="goal > 0" class="dd-goal">/ {{ groupDigits(goal) }}</text>
				<text class="dd-badge" :class="day.tone">{{ day.badge }}</text>
			</view>

			<view class="dd-macros">
				<view
					v-for="m in day.macros"
					:key="m.key"
					class="dd-m"
					:style="{ background: m.soft, color: m.deep }"
				>
					<text class="dd-m-t">{{ m.label }}</text>
					<text class="dd-m-v num">{{ m.value }}g</text>
				</view>
			</view>

			<view class="dd-meals" v-if="day.meals.length">
				<view class="dd-meal" v-for="m in day.meals" :key="m.key">
					<text class="dd-meal-t">{{ m.label }}</text>
					<text class="dd-meal-v num">{{ groupDigits(m.kcal) }} kcal</text>
				</view>
			</view>
			<text v-else class="dd-empty">这一天没有记录</text>

			<text v-if="day.foods.length" class="dd-foods">{{ day.foods.join(' · ') }}</text>

			<view class="row-btns">
				<view v-if="day.count" class="btn btn-plain grow" @click="openThisDay">看这一天</view>
				<view class="btn btn-plain grow" @click="closeDay">关闭</view>
			</view>
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
import { allRecords, getSettings, recordsByDate, recordsInRange } from '../../core/db.js'
import { withAlpha, darken } from '../../core/color.js'
import { groupDigits, percent, round, sumRecords } from '../../core/nutrition.js'
import { heatmap, mealBreakdown, rangeSummary, topFoods } from '../../core/stats.js'

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

/* ---------------- 打卡热力图 ---------------- */

const LEVELS = [0, 1, 2, 3, 4]
const HEAT_WEEKS = 13

/** 选中哪一天（空字符串 = 没选） */
const picked = ref('')

/**
 * 热力图固定看最近 13 周（一个季度），不跟上面的日/周/月切换走 ——
 * 列数少一半，格子大一倍：真机上 26 列时每格只有 9~13px，14 列约 20~27px，
 * 手指点得准，五档深浅也看得清。
 * 「打卡」本来就是长期视角，跟着切反而看不出规律。
 * 依赖 goal（来自 settings）以便 onShow 刷新后重算。
 */
const heat = computed(() => {
	void goal.value
	return heatmap(allRecords(), {
		weeks: HEAT_WEEKS,
		endKey: todayKey(),
		goal: goal.value,
	})
})

const pickedLabel = computed(() => (picked.value ? dateLabel(picked.value) : ''))

/** 点开的那一天的明细（缩略图里的全部内容都从这里来） */
const day = computed(() => {
	const key = picked.value
	const list = key ? recordsByDate(key) : []
	const t = sumRecords(list)
	const kcal = round(t.kcal, 0)
	const g = goal.value
	let tone = 'none'
	let badge = '还没有记录'
	if (list.length) {
		if (g > 0 && kcal > g) {
			tone = 'over'
			badge = `超出 ${round(kcal - g, 0)}`
		} else if (g > 0 && kcal < g * 0.5) {
			tone = 'low'
			badge = '偏少'
		} else {
			tone = 'ok'
			badge = g > 0 ? `还剩 ${round(g - kcal, 0)}` : '已记录'
		}
	}
	return {
		kcal,
		count: list.length,
		tone,
		badge,
		macros: MACRO_META.map((m) => ({
			...m,
			value: round(t[m.key] || 0, 1),
			soft: withAlpha(m.color, 0.16),
			deep: darken(m.color, 0.42),
		})),
		meals: mealBreakdown(list)
			.filter((m) => m.count > 0)
			.map((m) => ({ key: m.key, label: m.label, kcal: round(m.totals.kcal, 0) })),
		foods: topFoods(list, 8).map((f) => f.name),
	}
})

function tapDay(cell) {
	// 未来的日子是空的，点了没意义
	if (!cell || cell.future) return
	picked.value = picked.value === cell.date ? '' : cell.date
}

function closeDay() {
	picked.value = ''
}

/** 跳到「日」视图看这一天的完整列表 */
function openThisDay() {
	if (!picked.value) return
	mode.value = 'day'
	anchor.value = picked.value
	picked.value = ''
	uni.pageScrollTo({ scrollTop: 0, duration: 200 })
}

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
		margin-bottom: $s-3;
	}

	/* 三个关键指标：等宽格子，横向对齐 */
	.tiles {
		display: flex;
		margin-top: $s-3;
	}

	.tile {
		flex: 1;
		min-width: 0;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 20rpx 6rpx;
		text-align: center;
	}

	.tile + .tile {
		margin-left: $s-2;
	}

	.tile-v {
		display: block;
		font-size: 46rpx;
		font-weight: 600;
		line-height: 1.15;
	}

	.tile-v.warn {
		color: $c-danger;
	}

	.tile-suf {
		font-size: 22rpx;
		font-weight: 400;
		color: $c-text-mute;
		margin-left: 2rpx;
	}

	.tile-k {
		display: block;
		font-size: 21rpx;
		color: $c-text-mute;
		margin-top: 4rpx;
	}

	.tile-note {
		display: block;
		font-size: 19rpx;
		color: $c-text-mute;
		margin-top: $s-3;
		line-height: 1.5;
	}

	/* ---------- 打卡热力图 ---------- */
	.hm-labels {
		display: flex;
		padding-left: 34rpx;
		height: 26rpx;
	}

	.hm-month {
		flex: 1;
		min-width: 0;
		font-size: 17rpx;
		color: $c-text-mute;
		overflow: visible;
		white-space: nowrap;
	}

	.hm-main {
		display: flex;
	}

	/* 行标签用「7 等分」对齐格子，而不是写死高度 ——
	   格子大小会随周数和屏幕宽度变，写死高度一改周数就错位 */
	.hm-days {
		width: 34rpx;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
	}

	.hm-day {
		flex: 1;
		display: flex;
		align-items: center;
		font-size: 17rpx;
		color: $c-text-mute;
	}

	.hm-day.hide {
		color: transparent;
	}

	.hm-grid {
		flex: 1;
		display: flex;
		min-width: 0;
	}

	.hm-col {
		flex: 1;
		min-width: 0;
		padding-right: 4rpx;
	}

	/* 正方形格子：用 padding-bottom 撑高度（比 aspect-ratio 兼容性稳） */
	.hm-cell {
		width: 100%;
		height: 0;
		padding-bottom: 100%;
		border-radius: 5rpx;
		margin-bottom: 4rpx;
	}

	/* 最后一行的格子不要底部间隔：多出来的那几像素会让整列偏高，
	   行标签就对不齐了（标签是 7 等分，格子是「格子 + 间隔」） */
	.hm-col .hm-cell:last-child {
		margin-bottom: 0;
	}

	/* 五档深浅：同一色相从浅到深，一眼看出吃多吃少 */
	.hm-cell.lv0 {
		background: $c-fill;
	}

	.hm-cell.lv1 {
		background: #e0ebe6;
	}

	.hm-cell.lv2 {
		background: #bcd9cd;
	}

	.hm-cell.lv3 {
		background: #8cc3ae;
	}

	.hm-cell.lv4 {
		background: $c-primary;
	}

	/* 还没到的日子：留空，不画成「没记录」 */
	.hm-cell.future {
		background: transparent;
	}

	/* 选中的那一格：描一圈深色，位置一眼能找到 */
	.hm-cell.on {
		box-shadow: 0 0 0 2rpx $c-text, 0 0 0 4rpx #fff;
	}

	.hm-foot {
		display: flex;
		align-items: center;
		margin-top: $s-3;
		padding-left: 34rpx;
	}

	.hm-foot-t {
		font-size: 18rpx;
		color: $c-text-mute;
	}

	.hm-mini {
		width: 26rpx;
		height: 26rpx;
		padding-bottom: 0;
		margin: 0 5rpx;
		border-radius: 5rpx;
	}

	.hm-foot-hint {
		font-size: 18rpx;
		color: $c-text-mute;
		margin-left: auto;
	}

	/* ---------- 当天详情弹层 ---------- */
	.mask {
		position: fixed;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		background: rgba(22, 32, 42, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: $s-4;
		z-index: 99;
	}

	.dialog {
		width: 100%;
		background: #fff;
		border-radius: $r-lg;
		padding: $s-4;
		box-shadow: $sh-3;
	}

	.dialog-title {
		display: block;
		font-size: 32rpx;
		font-weight: 600;
		margin-bottom: 2rpx;
	}

	.dd-top {
		display: flex;
		align-items: baseline;
		margin: $s-3 0 $s-3;
	}

	.dd-v {
		font-family: $ff-num;
		font-size: 56rpx;
		font-weight: 600;
		line-height: 1.05;
		letter-spacing: -1rpx;
		color: $c-primary-dark;
	}

	.dd-u {
		font-size: 21rpx;
		color: $c-text-mute;
		margin-left: 8rpx;
	}

	.dd-goal {
		font-family: $ff-num;
		font-size: 22rpx;
		color: $c-text-mute;
		margin-left: 8rpx;
	}

	.dd-badge {
		margin-left: auto;
		font-size: 20rpx;
		padding: 5rpx 16rpx;
		border-radius: $r-pill;
		background: $c-fill;
		color: $c-text-sub;
	}

	.dd-badge.ok {
		background: $c-primary-weak;
		color: $c-primary-dark;
	}

	.dd-badge.over {
		background: $c-danger-weak;
		color: $c-danger;
	}

	.dd-badge.low {
		background: #fbf3e6;
		color: #9a7434;
	}

	.dd-macros {
		display: flex;
	}

	.dd-m {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		justify-content: center;
		padding: 12rpx 6rpx;
		border-radius: $r-pill;
	}

	.dd-m + .dd-m {
		margin-left: $s-2;
	}

	.dd-m-t {
		font-size: 20rpx;
		margin-right: 7rpx;
		opacity: 0.85;
	}

	.dd-m-v {
		font-size: 24rpx;
		font-weight: 600;
	}

	.dd-meals {
		margin-top: $s-3;
		border-top: 1rpx solid $c-line;
		padding-top: $s-2;
	}

	.dd-meal {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6rpx 0;
	}

	.dd-meal-t {
		font-size: 24rpx;
		color: $c-text-sub;
	}

	.dd-meal-v {
		font-size: 24rpx;
		font-weight: 600;
	}

	.dd-foods {
		display: block;
		font-size: 21rpx;
		color: $c-text-mute;
		margin-top: $s-2;
		line-height: 1.5;
	}

	.dd-empty {
		display: block;
		font-size: 24rpx;
		color: $c-text-mute;
		padding: $s-4 0;
		text-align: center;
	}

	.row-btns {
		display: flex;
		margin-top: $s-4;
	}

	.row-btns .btn + .btn {
		margin-left: $s-2;
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
