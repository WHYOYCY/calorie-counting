<template>
	<view class="page">
		<!-- 连接状态：一眼看出配好没有 -->
		<view class="status" :class="statusTone">
			<view class="dot"></view>
			<text class="status-t">{{ statusText }}</text>
			<text v-if="form.apiKey" class="status-sub">{{ modelPlain(form.model) }}</text>
		</view>

		<!-- API Key -->
		<view class="card">
			<view class="sec-head">
				<text class="sec-title">API Key</text>
				<view class="help" @click="showHelp('key')">?</view>
			</view>
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

			<!-- 隐私声明：这条最该被看见，所以给它底色 -->
			<view class="privacy">
				<text class="privacy-t">Key 只保存在本机，不会上传到任何第三方服务器。</text>
			</view>
		</view>

		<!-- 识别效果 -->
		<view class="card">
			<view class="sec-head">
				<text class="sec-title">识别效果</text>
				<view class="help" @click="showHelp('model')">?</view>
			</view>
			<picker :range="modelLabels" :value="modelIndex" @change="onModel">
				<view class="picker-row">
					<text class="picker-val">{{ MODELS[modelIndex].plain }}</text>
					<text class="picker-model num">{{ MODELS[modelIndex].label }}</text>
					<image class="ico-sm" src="/static/ui/chevron.png" mode="aspectFit" />
				</view>
			</picker>
			<text class="hint t-xs t-mute">{{ MODELS[modelIndex].hint }}</text>

			<view class="field row-field">
				<view class="grow">
					<text class="label">保存识别照片</text>
					<text class="hint t-xs t-mute">开启后，照片将保存在本机，方便回看。</text>
				</view>
				<switch :checked="form.storePhoto" color="#52a98a" @change="onStorePhoto" />
			</view>
		</view>

		<!-- 连接 -->
		<view class="card">
			<view class="sec-head">
				<text class="sec-title">连接</text>
				<view class="help" @click="showHelp('base')">?</view>
			</view>
			<text class="label">接口地址</text>
			<view class="input-wrap">
				<input
					class="input"
					:value="form.baseUrl"
					placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
					placeholder-class="ph"
					@blur="onBaseUrl"
				/>
			</view>
			<text class="hint t-xs t-mute">
				默认阿里云百炼。除非你走代理或自建服务，否则不用改。
			</text>

			<view class="btn btn-plain test-btn" :class="{ disabled: testing }" @click="doTest">
				{{ testing ? '测试中…' : '测试连接' }}
			</view>
			<text v-if="testedAt" class="hint t-xs t-mute">上次测试：{{ testedAt }}</text>
		</view>

		<!-- 离线也能用：把「没配 Key 也能记」说清楚，降低门槛 -->
		<view class="note">
			<text class="note-t">
				不配也能用。手动记录随时可用，AI 识别只是省事的加分项。
			</text>
		</view>
	</view>

	<!-- 说明弹层 -->
	<view v-if="help" class="mask" @click="help = ''">
		<view class="dialog" @click.stop>
			<text class="dialog-title">{{ helpTitle }}</text>
			<text class="dialog-body">{{ helpBody }}</text>
			<view class="row-btns">
				<view class="btn btn-primary grow" @click="help = ''">知道了</view>
			</view>
		</view>
	</view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { DEFAULT_BASE_URL, MODELS, modelPlain } from '../../core/constants.js'
import { getSettings, saveSettings } from '../../core/db.js'
import { testConnection } from '../../core/ai.js'

const showKey = ref(false)
const testing = ref(false)
const help = ref('')
const testedAt = ref('')
const form = reactive({ ...getSettings() })

/** 配好没有：有 Key 就算配好，测过就按测试结果说 */
const statusTone = computed(() => {
	if (!String(form.apiKey || '').trim()) return 'off'
	return testOk.value === false ? 'bad' : 'on'
})

const testOk = ref(null)

const statusText = computed(() => {
	if (!String(form.apiKey || '').trim()) return '还没配置，AI 识别不可用（手动记录不受影响）'
	if (testOk.value === false) return '上次测试没通过，检查 Key 或网络'
	if (testOk.value === true) return '已配置，可以拍照识别'
	return '已配置，建议点下面的「测试连接」确认一下'
})

const modelLabels = computed(() => MODELS.map((m) => `${m.plain} · ${m.hint}`))
const modelIndex = computed(() => {
	const i = MODELS.findIndex((m) => m.id === form.model)
	return i >= 0 ? i : 0
})

/* ---------------- 说明文案：把术语翻译成人话 ---------------- */

const HELP = {
	key: {
		title: '什么是 API Key',
		body:
			'拍照识别要把照片发给阿里云百炼（通义千问）来估算热量，需要一个「通行证」——就是 API Key。\n\n' +
			'怎么拿：浏览器打开阿里云百炼控制台，登录后开通「模型服务」，在 API-KEY 页面创建一个，复制粘贴到这里。\n\n' +
			'要花钱吗：按次计费，一次识别大约一分钱的量级。\n\n' +
			'安全吗：Key 只存在这台手机里，不会上传到别的服务器；照片也只会发给你填的这个接口。',
	},
	model: {
		title: '识别效果怎么选',
		body:
			'快速识别：最快最省，日常够用，推荐。\n' +
			'精细识别：更准一些，也贵一些，适合经常识别复杂菜品。\n' +
			'经典识别：上一代旗舰，只有旧配置才需要。\n\n' +
			'拿不准就用「快速识别」，识别结果都可以手动改。',
	},
	base: {
		title: '接口地址是什么',
		body:
			'照片要发给谁。默认是阿里云百炼的官方地址，正常上网就能用。\n\n' +
			'只有两种情况要改：一是你用了公司/学校的代理，二是你自己搭了服务。\n\n' +
			'填错了会连不上，「测试连接」会直接告诉你失败原因。',
	},
}

const helpTitle = computed(() => (HELP[help.value] || {}).title || '')
const helpBody = computed(() => (HELP[help.value] || {}).body || '')

function showHelp(k) {
	help.value = k
}

/* ---------------- 读写 ---------------- */

function refresh() {
	Object.assign(form, getSettings())
}

onShow(refresh)

function commit(patch, msg) {
	Object.assign(form, saveSettings(patch))
	if (msg) uni.showToast({ title: msg, icon: 'none' })
}

const onApiKey = (e) => {
	form.apiKey = e.detail.value
	testOk.value = null
}

const onStorePhoto = (e) => commit({ storePhoto: e.detail.value })

function onModel(e) {
	const m = MODELS[Number(e.detail.value)]
	if (m) commit({ model: m.id })
}

function onBaseUrl(e) {
	const v = String(e.detail.value || '').trim() || DEFAULT_BASE_URL
	commit({ baseUrl: v })
}

async function doTest() {
	const key = String(form.apiKey || '').trim()
	if (!key) {
		uni.showToast({ title: '请先填写 API Key', icon: 'none' })
		return
	}
	// 先把当前填的内容落库，保证测的就是稍后要用的配置
	commit({ apiKey: key }, '')
	testing.value = true
	let res
	try {
		res = await testConnection(getSettings())
	} catch (e) {
		res = { ok: false, error: '测试过程出错' }
	}
	testing.value = false
	testOk.value = !!res.ok
	testedAt.value = formatNow()

	if (res.ok) {
		uni.showToast({ title: '连接正常', icon: 'success' })
	} else {
		uni.showModal({
			title: '连接失败',
			content: (res.error || '未知错误') + (res.detail ? `\n${res.detail}` : ''),
			showCancel: false,
		})
	}
}

/** 只用来显示「上次测试」的时间，跨天也不重要，就取时分 */
function formatNow() {
	const d = new Date()
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<style lang="scss" scoped>
	.page {
		padding: $s-3 $s-4 $s-6;
	}

	/* ---------- 连接状态 ---------- */
	.status {
		display: flex;
		align-items: center;
		background: $c-card;
		border-radius: $r-md;
		padding: $s-3 $s-4;
		margin-bottom: $s-3;
	}

	.dot {
		width: 14rpx;
		height: 14rpx;
		border-radius: $r-pill;
		margin-right: 12rpx;
		flex-shrink: 0;
		background: $c-text-mute;
	}

	.status.on .dot {
		background: $c-primary;
	}

	.status.bad .dot {
		background: $c-danger;
	}

	.status-t {
		flex: 1;
		min-width: 0;
		font-size: 23rpx;
		color: $c-text-sub;
	}

	.status-sub {
		font-size: 21rpx;
		color: $c-text-mute;
		margin-left: $s-2;
		flex-shrink: 0;
	}

	/* ---------- 卡片 ---------- */
	.card + .card {
		margin-top: $s-3;
	}

	.sec-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: $s-3;
	}

	/* 「?」：术语旁边随时能点开看解释 */
	.help {
		width: 40rpx;
		height: 40rpx;
		border-radius: $r-pill;
		background: $c-fill;
		color: $c-text-mute;
		font-size: 24rpx;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.help:active {
		background: $c-primary-weak;
		color: $c-primary-dark;
	}

	.field {
		margin-top: $s-4;
	}

	.row-field {
		display: flex;
		align-items: center;
	}

	.label {
		display: block;
		font-size: 26rpx;
		font-weight: 500;
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
		font-size: 26rpx;
		min-width: 0;
	}

	.eye {
		font-size: 23rpx;
		color: $c-primary-dark;
		padding-left: $s-2;
		flex-shrink: 0;
	}

	.ph {
		color: $c-text-mute;
	}

	.privacy {
		background: $c-primary-weak;
		border-radius: $r-sm;
		padding: 16rpx 20rpx;
		margin-top: $s-3;
	}

	.privacy-t {
		font-size: 22rpx;
		font-weight: 600;
		color: $c-primary-dark;
		line-height: 1.5;
	}

	.picker-row {
		display: flex;
		align-items: center;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 0 20rpx;
		height: 84rpx;
	}

	.picker-val {
		font-size: 26rpx;
		font-weight: 500;
	}

	.picker-model {
		font-size: 20rpx;
		color: $c-text-mute;
		margin-left: 12rpx;
		flex: 1;
		min-width: 0;
	}

	.hint {
		display: block;
		line-height: 1.5;
		margin-top: 10rpx;
	}

	.test-btn {
		margin-top: $s-4;
	}

	.disabled {
		opacity: 0.6;
	}

	.note {
		margin-top: $s-4;
		padding: 0 $s-1;
	}

	.note-t {
		font-size: 21rpx;
		color: $c-text-mute;
		line-height: 1.6;
	}

	/* ---------- 弹层 ---------- */
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
		margin-bottom: $s-2;
	}

	.dialog-body {
		display: block;
		font-size: 24rpx;
		color: $c-text-sub;
		line-height: 1.7;
	}

	.row-btns {
		display: flex;
		margin-top: $s-4;
	}
</style>
