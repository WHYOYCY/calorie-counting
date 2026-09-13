<template>
	<view class="page">
		<!-- 识别照片 -->
		<view class="card photo-card" v-if="photo">
			<image class="photo" :src="photo" mode="aspectFill" @click="previewPhoto" />
			<text class="photo-tag" v-if="source === 'ai'">AI 识别</text>
		</view>

		<!-- 时间与餐次 -->
		<view class="card">
			<view class="field">
				<text class="label">时间</text>
				<view class="row grow pickers">
					<picker mode="date" :value="dateStr" @change="onDateChange">
						<view class="picker num">{{ dateStr }}</view>
					</picker>
					<picker mode="time" :value="timeStr" @change="onTimeChange">
						<view class="picker num">{{ timeStr }}</view>
					</picker>
				</view>
			</view>

			<view class="field">
				<text class="label">餐次</text>
				<view class="chips grow">
					<view
						v-for="m in MEALS"
						:key="m.key"
						class="chip"
						:class="{ on: meal === m.key }"
						:style="meal === m.key ? { background: m.color, borderColor: m.color } : {}"
						@click="pickMeal(m.key)"
					>
						{{ m.label }}
					</view>
				</view>
			</view>

			<text v-if="mealAuto" class="tip t-xs t-mute">已按时间自动归类，点上方可手动指定</text>
		</view>

		<!-- 食物条目 -->
		<view class="card">
			<view class="between head">
				<text class="label">食物 · {{ items.length }} 项</text>
				<text class="toggle t-sm" @click="showMacros = !showMacros">
					{{ showMacros ? '收起营养素' : '营养素明细' }}
				</text>
			</view>

			<view class="food" v-for="(st, i) in items" :key="i">
				<view class="food-head">
					<input
						class="name-input grow"
						:value="st.name"
						placeholder="食物名称"
						placeholder-class="ph"
						@input="onText(i, 'name', $event)"
					/>
					<view class="del" @click="removeItem(i)">✕</view>
				</view>

				<view class="food-row">
					<view class="mini-field">
						<input
							class="mini-input num"
							type="digit"
							:value="st.grams"
							placeholder="0"
							placeholder-class="ph"
							@input="onText(i, 'grams', $event)"
						/>
						<text class="unit">g</text>
					</view>
					<view class="mini-field">
						<input
							class="mini-input num"
							type="digit"
							:value="st.kcal"
							placeholder="0"
							placeholder-class="ph"
							@input="onText(i, 'kcal', $event)"
						/>
						<text class="unit">kcal/100g</text>
					</view>
					<text class="food-kcal num t-bold">{{ kcalOf(st) }}</text>
				</view>

				<view v-if="showMacros" class="food-row">
					<view class="mini-field">
						<input
							class="mini-input num"
							type="digit"
							:value="st.protein"
							placeholder="0"
							placeholder-class="ph"
							@input="onText(i, 'protein', $event)"
						/>
						<text class="unit">蛋白</text>
					</view>
					<view class="mini-field">
						<input
							class="mini-input num"
							type="digit"
							:value="st.fat"
							placeholder="0"
							placeholder-class="ph"
							@input="onText(i, 'fat', $event)"
						/>
						<text class="unit">脂肪</text>
					</view>
					<view class="mini-field">
						<input
							class="mini-input num"
							type="digit"
							:value="st.carbs"
							placeholder="0"
							placeholder-class="ph"
							@input="onText(i, 'carbs', $event)"
						/>
						<text class="unit">碳水</text>
					</view>
				</view>
			</view>

			<view class="add t-sm" @click="addBlank">＋ 添加一行</view>
		</view>

		<!-- 最近吃过 -->
		<view class="card" v-if="recents.length">
			<text class="label">最近吃过</text>
			<view class="recents">
				<view class="recent" v-for="f in recents" :key="f.name" @click="addFromRecent(f)">
					<text class="t-sm ellipsis">{{ f.name }}</text>
					<text class="t-xs t-mute num">{{ f.grams }}g · {{ kcalOfItem(f) }}kcal</text>
				</view>
			</view>
		</view>

		<!-- 备注 -->
		<view class="card">
			<text class="label">备注</text>
			<textarea
				class="note"
				:value="note"
				placeholder="可选，例如：公司楼下"
				placeholder-class="ph"
				maxlength="200"
				@input="onNote"
			/>
		</view>

		<!-- 合计 -->
		<view class="card">
			<view class="between">
				<text class="t-sub">合计</text>
				<text class="num total-kcal">{{ totals.kcal }} kcal</text>
			</view>
			<view class="between t-xs t-mute macro-line">
				<text class="num">蛋白 {{ totals.protein }}g</text>
				<text class="num">脂肪 {{ totals.fat }}g</text>
				<text class="num">碳水 {{ totals.carbs }}g</text>
			</view>
		</view>

		<view class="holder"></view>

		<!-- 底部操作 -->
		<view class="bottom safe-bottom">
			<view v-if="id" class="btn btn-danger del-btn" @click="remove">删除</view>
			<view class="btn btn-primary grow" @click="save">保存</view>
		</view>
	</view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { MEALS } from '../../core/constants.js'
import {
	combineDateTime,
	formatTime,
	mealOfTs,
	splitDateTime,
	todayKey,
} from '../../core/date.js'
import {
	allRecords,
	deleteRecord,
	getRecord,
	saveRecord,
} from '../../core/db.js'
import { itemTotals, sumItems } from '../../core/nutrition.js'
import { recentFoods } from '../../core/stats.js'
import { takeDraft } from '../../core/draft.js'

/* 输入框用字符串保存，避免受控数字输入在 "1." 这类中间态被归零 */
const id = ref('')
const dateStr = ref(todayKey())
const timeStr = ref('12:00')
const meal = ref('lunch')
const mealAuto = ref(true)
const items = ref([])
const note = ref('')
const photo = ref('')
const source = ref('manual')
const createdAt = ref(0)
const showMacros = ref(false)
const recents = ref([])

function num(v) {
	const n = Number(v)
	return isFinite(n) && n > 0 ? n : 0
}

function blankState() {
	return { name: '', grams: '', kcal: '', protein: '', fat: '', carbs: '' }
}

function stateFromItem(it) {
	return {
		name: it.name || '',
		grams: it.grams ? String(it.grams) : '',
		kcal: it.per100 && it.per100.kcal ? String(it.per100.kcal) : '',
		protein: it.per100 && it.per100.protein ? String(it.per100.protein) : '',
		fat: it.per100 && it.per100.fat ? String(it.per100.fat) : '',
		carbs: it.per100 && it.per100.carbs ? String(it.per100.carbs) : '',
	}
}

function itemFromState(st) {
	return {
		name: String(st.name || '').trim(),
		grams: num(st.grams),
		per100: {
			kcal: num(st.kcal),
			protein: num(st.protein),
			fat: num(st.fat),
			carbs: num(st.carbs),
		},
	}
}

const parsedItems = computed(() => items.value.map(itemFromState))
const totals = computed(() => sumItems(parsedItems.value))

function kcalOf(st) {
	return itemTotals(itemFromState(st)).kcal
}

function kcalOfItem(it) {
	return itemTotals(it).kcal
}

/* ---------------- 时间 / 餐次 ---------------- */

function currentTs() {
	return combineDateTime(dateStr.value, timeStr.value)
}

function syncMeal() {
	if (mealAuto.value) meal.value = mealOfTs(currentTs())
}

function onDateChange(e) {
	dateStr.value = e.detail.value
	syncMeal()
}

function onTimeChange(e) {
	timeStr.value = e.detail.value
	syncMeal()
}

function pickMeal(key) {
	meal.value = key
	mealAuto.value = false
}

/* ---------------- 条目操作 ---------------- */

function onText(i, field, e) {
	items.value[i][field] = e.detail.value
}

function isBlank(st) {
	return !String(st.name || '').trim() && !num(st.grams) && !num(st.kcal)
}

function addBlank() {
	items.value.push(blankState())
}

function pushItem(state) {
	const last = items.value[items.value.length - 1]
	if (last && isBlank(last)) items.value.splice(items.value.length - 1, 1)
	items.value.push(state)
}

function addFromRecent(f) {
	pushItem(
		stateFromItem({
			name: f.name,
			grams: f.grams,
			per100: f.per100,
		})
	)
}

function removeItem(i) {
	items.value.splice(i, 1)
	if (!items.value.length) addBlank()
}

function onNote(e) {
	note.value = e.detail.value
}

function previewPhoto() {
	if (!photo.value) return
	uni.previewImage({ urls: [photo.value] })
}

/* ---------------- 载入 ---------------- */

onLoad((q) => {
	recents.value = recentFoods(allRecords(), 12)

	// 拍照识别结果（内存中转，避免超长 query）
	if (q && q.fromDraft) {
		const d = takeDraft()
		if (d) {
			items.value = (d.items || []).map(stateFromItem)
			if (!items.value.length) items.value = [blankState()]
			note.value = d.note || ''
			photo.value = d.photo || ''
			source.value = d.source || 'ai'
			// 识别结果默认记在「现在」，并按时间自动归类餐次
			const now = Date.now()
			dateStr.value = todayKey()
			timeStr.value = formatTime(now)
			mealAuto.value = true
			syncMeal()
			showMacros.value = items.value.some(
				(st) => num(st.protein) || num(st.fat) || num(st.carbs)
			)
			return
		}
	}

	if (q && q.id) {
		const r = getRecord(q.id)
		if (!r) {
			uni.showToast({ title: '记录不存在', icon: 'none' })
			setTimeout(() => uni.navigateBack(), 700)
			return
		}
		id.value = r.id
		const sp = splitDateTime(r.ts)
		dateStr.value = sp.date
		timeStr.value = sp.time
		meal.value = r.meal
		// 原本就是按时间自动归类的 → 继续跟随时间变化；手动指定过的 → 保留
		mealAuto.value = r.meal === mealOfTs(r.ts)
		items.value = (r.items || []).map(stateFromItem)
		if (!items.value.length) items.value = [blankState()]
		note.value = r.note || ''
		photo.value = r.photo || ''
		source.value = r.source || 'manual'
		createdAt.value = r.createdAt || 0
		showMacros.value = (r.items || []).some(
			(it) => it.per100 && (it.per100.protein || it.per100.fat || it.per100.carbs)
		)
		return
	}

	const d = (q && q.date) || todayKey()
	dateStr.value = d
	timeStr.value = formatTime(Date.now())
	if (q && q.meal) {
		meal.value = q.meal
		mealAuto.value = false
	} else {
		mealAuto.value = true
		syncMeal()
	}
	items.value = [blankState()]
})

/* ---------------- 保存 / 删除 ---------------- */

function save() {
	const valid = parsedItems.value.filter((it) => it.name && it.grams > 0)
	if (!valid.length) {
		uni.showToast({ title: '请填写食物名称和克数', icon: 'none' })
		return
	}
	const dropped = parsedItems.value.length - valid.length
	if (dropped > 0) {
		uni.showToast({ title: `已忽略 ${dropped} 个不完整的条目`, icon: 'none' })
	}

	saveRecord({
		id: id.value || undefined,
		ts: currentTs(),
		meal: meal.value,
		mealAuto: mealAuto.value,
		items: valid,
		note: note.value,
		photo: photo.value,
		source: source.value,
		createdAt: createdAt.value || undefined,
	})

	uni.showToast({ title: '已保存', icon: 'success' })
	setTimeout(() => uni.navigateBack(), 450)
}

function remove() {
	uni.showModal({
		title: '删除这条记录？',
		content: '删除后无法恢复',
		confirmColor: '#ef4444',
		success: (res) => {
			if (!res.confirm) return
			deleteRecord(id.value)
			uni.showToast({ title: '已删除', icon: 'success' })
			setTimeout(() => uni.navigateBack(), 400)
		},
	})
}
</script>

<style lang="scss" scoped>
	.page {
		padding: $gap;
	}

	.label {
		font-size: 26rpx;
		color: $c-text-sub;
	}

	/* ---------- 识别照片 ---------- */
	.photo-card {
		padding: 0;
		overflow: hidden;
		position: relative;
	}

	.photo {
		width: 100%;
		height: 380rpx;
		display: block;
	}

	.photo-tag {
		position: absolute;
		right: 16rpx;
		top: 16rpx;
		background: rgba(34, 197, 94, 0.92);
		color: #fff;
		font-size: 22rpx;
		padding: 6rpx 16rpx;
		border-radius: 20rpx;
	}

	.head {
		margin-bottom: 8rpx;
	}

	.toggle {
		color: $c-primary-dark;
	}

	/* ---------- 时间 / 餐次 ---------- */
	.field {
		display: flex;
		align-items: center;
		padding: 12rpx 0;
	}

	.field .label {
		width: 100rpx;
		flex-shrink: 0;
	}

	.pickers {
		justify-content: flex-end;
	}

	.picker {
		background: #f6f7f8;
		border-radius: $radius-sm;
		padding: 12rpx 20rpx;
		font-size: 28rpx;
		margin-left: $gap-sm;
	}

	.chips {
		display: flex;
	}

	.chip {
		flex: 1;
		text-align: center;
		padding: 12rpx 0;
		font-size: 26rpx;
		border: 1rpx solid $c-border-strong;
		border-radius: $radius-sm;
		color: $c-text-sub;
	}

	.chip + .chip {
		margin-left: $gap-sm;
	}

	.chip.on {
		color: #fff;
		font-weight: 600;
	}

	.tip {
		padding: 4rpx 0 0 100rpx;
	}

	/* ---------- 食物条目 ---------- */
	.food {
		padding: $gap 0;
		border-top: 1rpx solid $c-border;
	}

	.food-head {
		display: flex;
		align-items: center;
	}

	.name-input {
		font-size: 30rpx;
		height: 56rpx;
	}

	.del {
		width: 56rpx;
		height: 56rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		color: $c-text-mute;
		font-size: 26rpx;
	}

	.food-row {
		display: flex;
		align-items: center;
		margin-top: $gap-sm;
	}

	.mini-field {
		display: flex;
		align-items: center;
		background: #f6f7f8;
		border-radius: $radius-sm;
		padding: 0 16rpx;
		height: 64rpx;
		margin-right: $gap-sm;
		flex: 1;
	}

	.mini-input {
		flex: 1;
		min-width: 40rpx;
		font-size: 28rpx;
		height: 64rpx;
	}

	.unit {
		font-size: 22rpx;
		color: $c-text-mute;
		margin-left: 6rpx;
		flex-shrink: 0;
	}

	.food-kcal {
		min-width: 100rpx;
		text-align: right;
		font-size: 30rpx;
		color: $c-primary-dark;
	}

	.ph {
		color: #c8ccd0;
	}

	.add {
		color: $c-primary-dark;
		text-align: center;
		padding: 20rpx 0 4rpx;
		border-top: 1rpx solid $c-border;
	}

	.add:active {
		opacity: 0.7;
	}

	/* ---------- 最近吃过 ---------- */
	.recents {
		display: flex;
		flex-wrap: wrap;
		margin-top: $gap-sm;
	}

	.recent {
		background: #f6f7f8;
		border-radius: $radius-sm;
		padding: 12rpx 18rpx;
		margin: 0 $gap-sm $gap-sm 0;
		max-width: 100%;
	}

	.recent text {
		display: block;
	}

	/* ---------- 备注 ---------- */
	.note {
		width: 100%;
		height: 120rpx;
		font-size: 28rpx;
		margin-top: $gap-sm;
		background: #f6f7f8;
		border-radius: $radius-sm;
		padding: 16rpx;
	}

	/* ---------- 合计 ---------- */
	.total-kcal {
		font-size: 40rpx;
		font-weight: 700;
		color: $c-primary-dark;
	}

	.macro-line {
		margin-top: 8rpx;
	}

	/* ---------- 底部 ---------- */
	.holder {
		height: 180rpx;
	}

	.bottom {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		padding: $gap;
		background: rgba(255, 255, 255, 0.96);
		border-top: 1rpx solid $c-border;
	}

	.del-btn {
		width: 180rpx;
		flex-shrink: 0;
		margin-right: $gap;
	}
</style>
