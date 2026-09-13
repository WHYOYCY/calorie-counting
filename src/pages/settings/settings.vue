<template>
	<view class="page">
		<!-- 识别设置 -->
		<view class="card">
			<text class="sec-title">拍照识别</text>

			<view class="field">
				<text class="label">API Key</text>
				<view class="input-wrap row">
					<input
						class="input grow"
						:password="!showKey"
						:value="form.apiKey"
						placeholder="粘贴阿里云百炼 API Key"
						placeholder-class="ph"
						@input="onApiKey"
					/>
					<text class="eye" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</text>
				</view>
			</view>
			<text class="hint t-xs t-mute">
				Key 只保存在本机，不会上传到任何第三方服务器。开通地址：阿里云百炼控制台。
			</text>

			<view class="field">
				<text class="label">模型</text>
				<picker :range="modelLabels" :value="modelIndex" @change="onModel">
					<view class="picker num">{{ modelLabels[modelIndex] }}</view>
				</picker>
			</view>
			<text class="hint t-xs t-mute">{{ MODELS[modelIndex].hint }} · 单次识别约 ¥0.001 级别</text>

			<view class="field">
				<text class="label">接口地址</text>
				<input
					class="input grow"
					:value="form.baseUrl"
					placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
					placeholder-class="ph"
					@blur="onBaseUrl"
				/>
			</view>

			<view class="field">
				<text class="label">保存照片</text>
				<switch :checked="form.storePhoto" color="#22c55e" @change="onStorePhoto" />
			</view>
			<text class="hint t-xs t-mute">开启后会把识别用的照片存到 App 私有目录，占空间但可回看。</text>
		</view>

		<!-- 目标 -->
		<view class="card">
			<text class="sec-title">每日目标</text>

			<view class="field">
				<text class="label">热量目标</text>
				<view class="input-wrap row">
					<input
						class="input grow num"
						type="number"
						:value="form.dailyGoal"
						@blur="onGoal"
					/>
					<text class="suffix">kcal</text>
				</view>
			</view>

			<view class="field">
				<text class="label">营养素自动分配</text>
				<switch :checked="form.autoMacro" color="#22c55e" @change="onAutoMacro" />
			</view>
			<text class="hint t-xs t-mute">
				按蛋白质 20% / 脂肪 25% / 碳水 55% 的供能比自动计算。
			</text>

			<view class="field">
				<text class="label">蛋白质</text>
				<view class="input-wrap row">
					<input
						class="input grow num"
						type="digit"
						:disabled="form.autoMacro"
						:value="macroInputs.protein"
						@blur="onMacro('protein', $event)"
					/>
					<text class="suffix">g</text>
				</view>
			</view>
			<view class="field">
				<text class="label">脂肪</text>
				<view class="input-wrap row">
					<input
						class="input grow num"
						type="digit"
						:disabled="form.autoMacro"
						:value="macroInputs.fat"
						@blur="onMacro('fat', $event)"
					/>
					<text class="suffix">g</text>
				</view>
			</view>
			<view class="field">
				<text class="label">碳水</text>
				<view class="input-wrap row">
					<input
						class="input grow num"
						type="digit"
						:disabled="form.autoMacro"
						:value="macroInputs.carbs"
						@blur="onMacro('carbs', $event)"
					/>
					<text class="suffix">g</text>
				</view>
			</view>
		</view>

		<!-- 数据 -->
		<view class="card">
			<text class="sec-title">数据</text>
			<text class="hint t-xs t-mute">共 {{ recordCount }} 条记录，全部保存在本机。</text>

			<view class="row-btns">
				<view class="btn btn-ghost grow" @click="doExport">导出备份</view>
				<view class="btn btn-ghost grow" @click="openImport">导入备份</view>
			</view>
			<view class="btn btn-danger clear-btn" @click="doClear">清空全部记录</view>
		</view>

		<!-- 关于 -->
		<view class="card">
			<text class="sec-title">关于</text>
			<view class="about-row between">
				<text class="t-sm t-sub">版本</text>
				<text class="t-sm num">1.0.0</text>
			</view>
			<view class="about-row between">
				<text class="t-sm t-sub">数据存储</text>
				<text class="t-sm">仅本机</text>
			</view>
			<view class="about-row between">
				<text class="t-sm t-sub">照片用途</text>
				<text class="t-sm">仅发送至所填接口识别</text>
			</view>
			<text class="hint t-xs t-mute">
				本应用不含任何统计上报。识别结果由大模型估算，仅供记录参考，不构成医疗或营养建议。
			</text>
		</view>
	</view>

	<!-- 导入弹层 -->
	<view v-if="importing" class="mask" @click="importing = false">
		<view class="dialog" @click.stop>
			<text class="dialog-title">导入备份</text>
			<text class="hint t-xs t-mute">把之前导出的 JSON 粘贴到这里</text>
			<textarea
				class="paste"
				:value="importText"
				placeholder='{"app":"calorie-counting",...}'
				placeholder-class="ph"
				@input="onImportText"
			/>
			<view class="row-btns">
				<view class="btn btn-plain grow" @click="importing = false">取消</view>
				<view class="btn btn-ghost grow" @click="doImport('merge')">合并</view>
				<view class="btn btn-primary grow" @click="doImport('replace')">覆盖</view>
			</view>
			<text class="hint t-xs t-mute">合并＝保留现有记录，仅补入新记录；覆盖＝清空后整体替换。</text>
		</view>
	</view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { DEFAULT_BASE_URL, MODELS } from '../../core/constants.js'
import { getSettings, saveSettings, allRecords, exportAll, importAll, clearAll } from '../../core/db.js'
import { macroGoalsFromKcal } from '../../core/nutrition.js'
import { backupFileName, copyText, writeBackupFile } from '../../core/backup.js'

const showKey = ref(false)
const importing = ref(false)
const importText = ref('')
const recordCount = ref(0)
const form = reactive({ ...getSettings() })

const modelLabels = computed(() => MODELS.map((m) => `${m.label}（${m.hint}）`))
const modelIndex = computed(() => {
	const i = MODELS.findIndex((m) => m.id === form.model)
	return i >= 0 ? i : 0
})

/** 自动模式下把推导值显示出来，让用户知道当前实际目标 */
const macroInputs = computed(() => {
	const g = form.autoMacro ? macroGoalsFromKcal(form.dailyGoal) : form.macroGoals
	return {
		protein: g.protein,
		fat: g.fat,
		carbs: g.carbs,
	}
})

function refresh() {
	Object.assign(form, getSettings())
	recordCount.value = allRecords().length
}

onShow(refresh)

function commit(patch, msg = '已保存') {
	Object.assign(form, saveSettings(patch))
	uni.showToast({ title: msg, icon: 'none' })
}

const onApiKey = (e) => {
	form.apiKey = e.detail.value
}
const onStorePhoto = (e) => commit({ storePhoto: e.detail.value })
const onAutoMacro = (e) => commit({ autoMacro: e.detail.value })

function onModel(e) {
	const m = MODELS[Number(e.detail.value)]
	if (m) commit({ model: m.id })
}

function onBaseUrl(e) {
	const v = String(e.detail.value || '').trim() || DEFAULT_BASE_URL
	commit({ baseUrl: v })
}

function onGoal(e) {
	const v = Math.max(0, Math.round(Number(e.detail.value) || 0))
	if (!v) {
		uni.showToast({ title: '请输入有效目标', icon: 'none' })
		Object.assign(form, getSettings())
		return
	}
	commit({ dailyGoal: v })
}

function onMacro(key, e) {
	const v = Math.max(0, Number(e.detail.value) || 0)
	commit({ macroGoals: { ...form.macroGoals, [key]: v } })
}

/* ---------------- 备份 ---------------- */

async function doExport() {
	const payload = exportAll()
	const json = JSON.stringify(payload)
	const res = await writeBackupFile(json)

	if (res.ok && res.mode === 'file') {
		const copied = await copyText(json)
		uni.showModal({
			title: '备份已导出',
			content: `文件：${backupFileName()}\n（应用私有目录）${copied.ok ? '\n\n备份内容已同时复制到剪贴板。' : ''}`,
			showCancel: false,
			confirmText: '好',
		})
		return
	}
	if (res.ok && res.mode === 'download') {
		uni.showToast({ title: '已开始下载', icon: 'success' })
		return
	}
	// 兜底：剪贴板
	const copied = await copyText(json)
	if (copied.ok) {
		uni.showModal({
			title: '已复制到剪贴板',
			content: '当前环境无法直接写文件，备份 JSON 已复制，请粘贴保存。',
			showCancel: false,
		})
	} else {
		uni.showToast({ title: '导出失败', icon: 'none' })
	}
}

function openImport() {
	importText.value = ''
	importing.value = true
}

const onImportText = (e) => {
	importText.value = e.detail.value
}

function doImport(mode) {
	const text = importText.value.trim()
	if (!text) {
		uni.showToast({ title: '请先粘贴备份内容', icon: 'none' })
		return
	}
	const res = importAll(text, mode)
	if (!res.ok) {
		uni.showToast({ title: res.error || '导入失败', icon: 'none' })
		return
	}
	importing.value = false
	refresh()
	uni.showModal({
		title: '导入完成',
		content: `本次处理 ${res.imported} 条，当前共 ${res.total} 条记录。`,
		showCancel: false,
	})
}

function doClear() {
	uni.showModal({
		title: '清空全部记录？',
		content: '所有记录与照片都会被删除，且无法恢复。建议先导出备份。',
		confirmText: '清空',
		confirmColor: '#ef4444',
		success: (res) => {
			if (!res.confirm) return
			clearAll()
			refresh()
			uni.showToast({ title: '已清空', icon: 'success' })
		},
	})
}
</script>

<style lang="scss" scoped>
	.page {
		padding: $gap;
		padding-bottom: 60rpx;
	}

	.sec-title {
		display: block;
		font-size: 30rpx;
		font-weight: 600;
		margin-bottom: $gap-sm;
	}

	.field {
		display: flex;
		align-items: center;
		padding: 14rpx 0;
	}

	.label {
		width: 190rpx;
		flex-shrink: 0;
		font-size: 27rpx;
		color: $c-text-sub;
	}

	.input-wrap {
		flex: 1;
		background: #f6f7f8;
		border-radius: $radius-sm;
		padding: 0 16rpx;
		height: 68rpx;
	}

	.input {
		flex: 1;
		font-size: 28rpx;
		height: 68rpx;
	}

	.input[disabled] {
		color: $c-text-mute;
	}

	.eye {
		font-size: 24rpx;
		color: $c-primary-dark;
		padding-left: 12rpx;
	}

	.suffix {
		font-size: 24rpx;
		color: $c-text-mute;
		padding-left: 8rpx;
	}

	.picker {
		background: #f6f7f8;
		border-radius: $radius-sm;
		padding: 16rpx;
		font-size: 28rpx;
	}

	.ph {
		color: #c8ccd0;
	}

	.hint {
		display: block;
		line-height: 1.6;
		padding: 2rpx 0 10rpx;
	}

	.row-btns {
		display: flex;
		margin-top: $gap-sm;
	}

	.row-btns .btn + .btn {
		margin-left: $gap-sm;
	}

	.clear-btn {
		margin-top: $gap-sm;
	}

	.about-row {
		padding: 14rpx 0;
		border-top: 1rpx solid $c-border;
	}

	.about-row:first-of-type {
		border-top: none;
	}

	/* ---------- 导入弹层 ---------- */
	.mask {
		position: fixed;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: $gap-lg;
		z-index: 99;
	}

	.dialog {
		width: 100%;
		background: #fff;
		border-radius: $radius-lg;
		padding: $gap-lg;
	}

	.dialog-title {
		display: block;
		font-size: 32rpx;
		font-weight: 600;
		margin-bottom: 8rpx;
	}

	.paste {
		width: 100%;
		height: 260rpx;
		background: #f6f7f8;
		border-radius: $radius-sm;
		padding: 16rpx;
		font-size: 24rpx;
		margin: $gap-sm 0;
	}
</style>
