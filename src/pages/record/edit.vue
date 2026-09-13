<template>
	<view class="page">
		<!-- 照片：手动添加路径同样可以拍照留档或识别填充 -->
		<view class="card photo-card">
			<template v-if="photo">
				<image class="photo" :src="photo" mode="aspectFill" @click="previewPhoto" />
				<text class="photo-tag" v-if="source === 'ai'">AI 识别</text>
				<view class="photo-acts">
					<view class="photo-act" @click="recognizeCurrentPhoto">识别填充</view>
					<view class="photo-act-sep"></view>
					<view class="photo-act" @click="openPhotoMenu">换一张</view>
					<view class="photo-act-sep"></view>
					<view class="photo-act danger" @click="removePhoto">移除</view>
				</view>
			</template>
			<view v-else class="photo-empty" @click="openPhotoMenu">
				<image class="ico-lg" src="/static/ui/camera-gray.png" mode="aspectFit" />
				<text class="photo-empty-t">拍照留档 / 识别填充</text>
				<text class="photo-empty-s">可选，不拍也能直接记</text>
			</view>
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
					<view class="del" @click="removeItem(i)">
						<image class="ico-sm" src="/static/ui/close.png" mode="aspectFit" />
					</view>
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

			<view class="add" @click="addBlank">
				<image class="ico-sm" src="/static/ui/plus.png" mode="aspectFit" />
				<text class="add-t">添加一行</text>
			</view>
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
			<view class="between total-row">
				<text class="total-label">合计</text>
				<view class="row">
					<text class="num total-kcal">{{ round(totals.kcal, 0) }}</text>
					<text class="total-unit">kcal</text>
				</view>
			</view>
			<view class="between macro-line">
				<text class="num">蛋白质 {{ totals.protein }} g</text>
				<text class="num">脂肪 {{ totals.fat }} g</text>
				<text class="num">碳水 {{ totals.carbs }} g</text>
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
	getSettings,
	saveSettings,
} from '../../core/db.js'
import { itemTotals, round, sumItems } from '../../core/nutrition.js'
import { recentFoods } from '../../core/stats.js'
import { takeDraft } from '../../core/draft.js'
import { persistPhoto, pickImage, toBase64 } from '../../core/photo.js'
import { recognize } from '../../core/ai.js'

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
/** H5 下重新识别已选照片需要原始 File 对象 */
const lastFile = ref(null)
const photoBusy = ref(false)

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

/* ---------------- 照片：留档 / 识别填充 ---------------- */

function openPhotoMenu() {
	uni.showActionSheet({
		itemList: ['拍照并识别', '拍照留档', '从相册选择'],
		success: (r) => {
			if (r.tapIndex === 0) capturePhoto('camera', true)
			else if (r.tapIndex === 1) capturePhoto('camera', false)
			else capturePhoto('album', false)
		},
	})
}

/** 确认「保存照片」是开着的，否则照片只是临时路径，过一阵就失效了 */
function ensurePhotoEnabled() {
	if (getSettings().storePhoto) return Promise.resolve(true)
	return new Promise((resolve) => {
		uni.showModal({
			title: '需要先开启「保存照片」',
			content: '关闭时照片不会存到应用目录，记录里的照片会失效。现在开启吗？',
			confirmText: '开启并继续',
			cancelText: '取消',
			success: (r) => {
				if (!r.confirm) {
					resolve(false)
					return
				}
				saveSettings({ storePhoto: true })
				resolve(true)
			},
		})
	})
}

async function capturePhoto(source, thenRecognize) {
	if (!(await ensurePhotoEnabled())) return

	const pick = await pickImage(source)
	if (!pick.ok) {
		if (pick.error) uni.showToast({ title: pick.error, icon: 'none' })
		return
	}
	lastFile.value = pick.file || null

	uni.showLoading({ title: '处理照片…', mask: true })
	const saved = await persistPhoto(pick.path)
	uni.hideLoading()

	// 落盘失败（如 H5）就退回临时路径，至少本次会话可见
	photo.value = saved.ok ? saved.path : pick.path
	if (saved.ok) lastFile.value = null

	if (thenRecognize) await recognizeCurrentPhoto()
	else uni.showToast({ title: '照片已添加', icon: 'none' })
}

async function recognizeCurrentPhoto() {
	if (photoBusy.value) return
	if (!photo.value) {
		uni.showToast({ title: '还没有照片', icon: 'none' })
		return
	}
	if (!getSettings().apiKey) {
		uni.showModal({
			title: '还没配置 API Key',
			content: '识别填充需要阿里云百炼的 API Key。',
			confirmText: '去设置',
			cancelText: '知道了',
			success: (r) => {
				if (r.confirm) uni.switchTab({ url: '/pages/settings/settings' })
			},
		})
		return
	}

	photoBusy.value = true
	uni.showLoading({ title: '识别中…', mask: true })

	let res
	try {
		const b64 = await toBase64(photo.value, lastFile.value)
		res = b64.ok
			? await recognize({ base64: b64.base64, mime: b64.mime, settings: getSettings() })
			: { ok: false, error: b64.error }
	} catch (e) {
		res = { ok: false, error: '识别过程出错' }
	}

	uni.hideLoading()
	photoBusy.value = false

	if (!res.ok) {
		uni.showModal({
			title: '识别失败',
			content: res.error + (res.detail ? `\n${res.detail}` : ''),
			confirmText: '手动填写',
			showCancel: false,
		})
		return
	}
	if (!res.isFood) {
		uni.showModal({
			title: '没识别到食物',
			content: res.reason || '照片里似乎没有食物，可以继续手动填写。',
			showCancel: false,
		})
		return
	}

	const added = applyRecognizedItems(res.items)
	if (res.note) note.value = note.value ? `${note.value}\n${res.note}` : res.note
	source.value = 'ai'
	showMacros.value = items.value.some((st) => num(st.protein) || num(st.fat) || num(st.carbs))
	uni.showToast({
		title: added.mode === 'replace' ? `已填入 ${added.count} 项` : `已追加 ${added.count} 项`,
		icon: 'none',
	})
}

/** 表单还空着就直接填入；已有内容则追加，绝不默默覆盖用户已填的东西 */
function applyRecognizedItems(list) {
	const states = (list || []).map(stateFromItem)
	if (!states.length) return { mode: 'append', count: 0 }

	const allBlank = items.value.length > 0 && items.value.every(isBlank)
	if (allBlank) {
		items.value = states
		return { mode: 'replace', count: states.length }
	}

	const last = items.value[items.value.length - 1]
	if (last && isBlank(last)) items.value.pop()
	items.value.push(...states)
	return { mode: 'append', count: states.length }
}

function removePhoto() {
	uni.showModal({
		title: '移除照片？',
		content: '记录本身会保留，只是不再带这张照片。',
		confirmColor: '#c97b6e',
		success: (r) => {
			if (!r.confirm) return
			photo.value = ''
			lastFile.value = null
			if (source.value === 'ai') source.value = 'manual'
		},
	})
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
		confirmColor: '#c97b6e',
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
		padding: $s-3 $s-4 $s-6;
	}

	.label {
		font-size: 25rpx;
		font-weight: 600;
		color: $c-text-sub;
		letter-spacing: 0.5rpx;
	}

	/* ---------- 照片 ---------- */
	.photo-card {
		padding: 0;
		overflow: hidden;
		position: relative;
	}

	.photo {
		width: 100%;
		height: 400rpx;
		display: block;
	}

	.photo-tag {
		position: absolute;
		right: $s-3;
		top: $s-3;
		background: rgba(15, 163, 107, 0.9);
		color: #fff;
		font-size: 21rpx;
		font-weight: 500;
		padding: 7rpx 18rpx;
		border-radius: $r-pill;
	}

	.photo-acts {
		display: flex;
		align-items: center;
		border-top: 1rpx solid $c-line;
	}

	.photo-act {
		flex: 1;
		text-align: center;
		padding: 22rpx 0;
		font-size: 25rpx;
		color: $c-text-sub;
	}

	.photo-act:active {
		background: $c-fill;
	}

	.photo-act.danger {
		color: $c-danger;
	}

	.photo-act-sep {
		width: 1rpx;
		height: 28rpx;
		background: $c-line;
		flex-shrink: 0;
	}

	/* 无照片时的引导区：手动添加路径也能随时拍照 */
	.photo-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: $s-5 0;
	}

	.photo-empty:active {
		background: #fbfcfd;
	}

	.photo-empty-t {
		font-size: 26rpx;
		color: $c-text-sub;
		margin-top: $s-2;
	}

	.photo-empty-s {
		font-size: 21rpx;
		color: $c-text-mute;
		margin-top: 5rpx;
	}

	.head {
		margin-bottom: $s-3;
	}

	.toggle {
		font-size: 24rpx;
		color: $c-primary-dark;
		font-weight: 500;
	}

	/* ---------- 时间 / 餐次 ---------- */
	.field {
		display: flex;
		align-items: center;
		padding: 12rpx 0;
	}

	.field .label {
		width: 110rpx;
		flex-shrink: 0;
	}

	.pickers {
		justify-content: flex-end;
	}

	.picker {
		background: $c-fill;
		border-radius: $r-sm;
		padding: 14rpx 22rpx;
		font-size: 27rpx;
		margin-left: $s-2;
	}

	.chips {
		display: flex;
	}

	.chip {
		flex: 1;
		text-align: center;
		padding: 14rpx 0;
		font-size: 25rpx;
		background: $c-fill;
		border-radius: $r-sm;
		color: $c-text-sub;
	}

	.chip + .chip {
		margin-left: 10rpx;
	}

	.chip.on {
		color: #fff;
		font-weight: 600;
	}

	.tip {
		display: block;
		font-size: 21rpx;
		color: $c-text-mute;
		padding: 6rpx 0 0 110rpx;
	}

	/* ---------- 食物条目 ---------- */
	.food {
		margin-top: $s-3;
		padding: $s-3;
		border: 1rpx solid $c-line;
		border-radius: $r-sm;
	}

	.food-head {
		display: flex;
		align-items: center;
	}

	.name-input {
		font-size: 29rpx;
		font-weight: 500;
		height: 56rpx;
	}

	.del {
		width: 52rpx;
		height: 52rpx;
		margin-left: $s-2;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: $r-pill;
		background: $c-fill;
	}

	.del:active {
		background: $c-danger-weak;
	}

	.food-row {
		display: flex;
		align-items: center;
		margin-top: $s-2;
	}

	.mini-field {
		display: flex;
		align-items: center;
		background: $c-fill;
		border-radius: $r-xs;
		padding: 0 16rpx;
		height: 66rpx;
		margin-right: 10rpx;
		flex: 1;
	}

	.mini-input {
		flex: 1;
		min-width: 30rpx;
		font-size: 27rpx;
		height: 66rpx;
	}

	.unit {
		font-size: 21rpx;
		color: $c-text-mute;
		margin-left: 6rpx;
		flex-shrink: 0;
	}

	.food-kcal {
		min-width: 96rpx;
		text-align: right;
		font-size: 29rpx;
		font-weight: 600;
		color: $c-primary-dark;
	}

	.ph {
		color: #c3ccd5;
	}

	.add {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: $s-3;
		padding: 20rpx 0;
		border-radius: $r-sm;
		background: $c-primary-tint;
	}

	.add:active {
		background: $c-primary-weak;
	}

	.add-t {
		font-size: 25rpx;
		color: $c-primary-dark;
		font-weight: 500;
		margin-left: 8rpx;
	}

	/* ---------- 最近吃过 ---------- */
	.recents {
		display: flex;
		flex-wrap: wrap;
		margin-top: $s-2;
	}

	.recent {
		background: $c-fill;
		border-radius: $r-sm;
		padding: 12rpx 20rpx;
		margin: 0 10rpx 10rpx 0;
		max-width: 100%;
	}

	.recent text {
		display: block;
	}

	/* ---------- 备注 ---------- */
	.note {
		width: 100%;
		height: 130rpx;
		font-size: 27rpx;
		margin-top: $s-2;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 18rpx;
	}

	/* ---------- 合计 ---------- */
	.total-row {
		align-items: baseline;
	}

	.total-label {
		font-size: 25rpx;
		font-weight: 600;
		color: $c-text-sub;
	}

	.total-kcal {
		font-size: 46rpx;
		font-weight: 700;
		letter-spacing: -1rpx;
		color: $c-primary-dark;
	}

	.total-unit {
		font-size: 22rpx;
		color: $c-text-mute;
		margin-left: 8rpx;
	}

	.macro-line {
		margin-top: $s-2;
		padding-top: $s-2;
		border-top: 1rpx solid $c-line;
		font-size: 21rpx;
		color: $c-text-mute;
	}

	/* ---------- 底部 ---------- */
	.holder {
		height: 190rpx;
	}

	.bottom {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		padding: $s-3 $s-4;
		background: #fff;
		box-shadow: 0 -4rpx 24rpx rgba(22, 32, 42, 0.06);
	}

	.del-btn {
		width: 176rpx;
		flex-shrink: 0;
		margin-right: $s-3;
	}
</style>
