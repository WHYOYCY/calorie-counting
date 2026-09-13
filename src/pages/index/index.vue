<template>
	<view class="page">
		<!-- 日期切换 -->
		<view class="datebar">
			<view class="navbtn" @click="shift(-1)"><text class="chev">‹</text></view>
			<view class="dateinfo" @click="backToToday">
				<text class="dtoday">{{ headLabel }}</text>
				<text class="dsub">{{ subLabel }}</text>
			</view>
			<view class="navbtn" :class="{ dim: isToday }" @click="shift(1)"><text class="chev">›</text></view>
		</view>

		<!-- 汇总卡 -->
		<view class="card summary">
			<view class="kcal-row">
				<text class="kcal num" :class="{ over: isOver }">{{ totals.kcal }}</text>
				<text class="kcal-goal num">/ {{ goal }} kcal</text>
			</view>

			<view class="bar">
				<view class="bar-fill" :class="{ over: isOver }" :style="{ width: pct + '%' }"></view>
			</view>

			<view class="between hint">
				<text v-if="!isOver" class="t-sub">还可以吃 <text class="num t-bold">{{ remain }}</text> kcal</text>
				<text v-else class="over-text">已超出 <text class="num t-bold">{{ -remain }}</text> kcal</text>
				<text class="t-xs t-mute num">{{ records.length }} 条记录</text>
			</view>

			<view class="macros">
				<view class="macro" v-for="m in macroRows" :key="m.key">
					<view class="between macro-head">
						<text class="t-xs t-sub">{{ m.label }}</text>
						<text class="t-xs t-mute num">{{ m.value }}/{{ m.goal }}g</text>
					</view>
					<view class="mini-bar">
						<view class="mini-fill" :style="{ width: m.pct + '%', background: m.color }"></view>
					</view>
				</view>
			</view>
		</view>

		<!-- 操作 -->
		<view class="actions">
			<view class="btn btn-primary grow" @click="shoot">
				<text class="cam">📷</text>
				<text>拍照识别</text>
			</view>
			<view class="btn btn-ghost grow" @click="addRecord('')">手动添加</view>
		</view>

		<!-- 餐次分组 -->
		<view class="card meal" v-for="g in groups" :key="g.key">
			<view class="between meal-head">
				<view class="row">
					<text class="meal-tag" :style="{ background: g.color }">{{ g.short }}</text>
					<text class="meal-name">{{ g.label }}</text>
				</view>
				<text class="num t-sub t-sm">{{ g.totals.kcal }} kcal</text>
			</view>

			<view v-if="g.records.length" class="list">
				<view class="item" v-for="r in g.records" :key="r.id" @click="editRecord(r)">
					<view class="grow">
						<text class="item-name ellipsis">{{ itemNames(r) }}</text>
						<text class="t-xs t-mute num">{{ formatTime(r.ts) }} · {{ gramsOf(r) }}g</text>
					</view>
					<text class="num item-kcal">{{ kcalOf(r) }}</text>
					<text class="arrow">›</text>
				</view>
			</view>
			<view v-else class="none t-xs t-mute">还没有记录</view>

			<view class="add t-sm" @click="addRecord(g.key)">＋ 添加{{ g.label }}</view>
		</view>

		<view class="footer t-xs t-mute">
			<text v-if="isToday">长按条目可删除 · 数据仅保存在本机</text>
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
import { macroGoalsFromKcal, percent, recordTotals, round, sumRecords } from '../../core/nutrition.js'

const dateStr = ref(todayKey())
const records = ref([])
const settings = ref(getSettings())

const isToday = computed(() => dateStr.value === todayKey())

const headLabel = computed(() => dateLabel(dateStr.value))

const subLabel = computed(() => {
	if (isToday.value) {
		const d = parseKey(dateStr.value)
		return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
	}
	return '点击回到今天'
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

function shoot() {
	uni.showToast({ title: '拍照识别开发中', icon: 'none' })
}
</script>

<style lang="scss" scoped>
	.page {
		padding: $gap;
		padding-bottom: 60rpx;
	}

	/* ---------- 日期切换 ---------- */
	.datebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 8rpx 20rpx;
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

	.navbtn.dim {
		opacity: 0.35;
	}

	.chev {
		font-size: 40rpx;
		line-height: 1;
		color: $c-text-sub;
		margin-top: -6rpx;
	}

	.dateinfo {
		flex: 1;
		text-align: center;
	}

	.dtoday {
		display: block;
		font-size: 34rpx;
		font-weight: 600;
	}

	.dsub {
		display: block;
		font-size: 22rpx;
		color: $c-text-mute;
		margin-top: 2rpx;
	}

	/* ---------- 汇总卡 ---------- */
	.summary {
		padding: $gap-lg $gap;
	}

	.kcal-row {
		display: flex;
		align-items: baseline;
		justify-content: center;
	}

	.kcal {
		font-size: 76rpx;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -1rpx;
	}

	.kcal.over {
		color: $c-danger;
	}

	.kcal-goal {
		font-size: 26rpx;
		color: $c-text-mute;
		margin-left: 10rpx;
	}

	.bar {
		height: 18rpx;
		border-radius: 9rpx;
		background: #eef0f2;
		overflow: hidden;
		margin-top: $gap;
	}

	.bar-fill {
		height: 100%;
		border-radius: 9rpx;
		background: $c-primary;
		transition: width 0.3s ease;
	}

	.bar-fill.over {
		background: $c-danger;
	}

	.hint {
		margin-top: 16rpx;
	}

	.over-text {
		color: $c-danger;
		font-size: 26rpx;
	}

	.macros {
		display: flex;
		margin-top: $gap-lg;
	}

	.macro {
		flex: 1;
	}

	.macro + .macro {
		margin-left: $gap;
	}

	.macro-head {
		margin-bottom: 8rpx;
	}

	.mini-bar {
		height: 8rpx;
		border-radius: 4rpx;
		background: #eef0f2;
		overflow: hidden;
	}

	.mini-fill {
		height: 100%;
		border-radius: 4rpx;
	}

	/* ---------- 操作 ---------- */
	.actions {
		display: flex;
		margin-top: $gap;
	}

	.actions .btn + .btn {
		margin-left: $gap;
	}

	.cam {
		margin-right: 8rpx;
	}

	/* ---------- 餐次分组 ---------- */
	.meal-head {
		margin-bottom: 8rpx;
	}

	.meal-tag {
		width: 40rpx;
		height: 40rpx;
		border-radius: 12rpx;
		color: #fff;
		font-size: 22rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: 12rpx;
	}

	.meal-name {
		font-size: 30rpx;
		font-weight: 600;
	}

	.list {
		margin-top: 8rpx;
	}

	.item {
		display: flex;
		align-items: center;
		padding: 18rpx 0;
		border-top: 1rpx solid $c-border;
	}

	.item-name {
		display: block;
		font-size: 28rpx;
		margin-bottom: 2rpx;
	}

	.item-kcal {
		font-size: 28rpx;
		color: $c-text-sub;
	}

	.arrow {
		font-size: 32rpx;
		color: #d1d5db;
		margin-left: 10rpx;
	}

	.none {
		padding: 16rpx 0;
	}

	.add {
		color: $c-primary-dark;
		padding: 18rpx 0 4rpx;
		text-align: center;
		border-top: 1rpx solid $c-border;
		margin-top: 0;
	}

	.add:active {
		opacity: 0.7;
	}

	.footer {
		text-align: center;
		padding: $gap-lg 0 0;
	}
</style>
