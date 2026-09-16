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

			<view class="row-btns test-row">
				<view
					class="btn btn-plain grow"
					:class="{ disabled: testing }"
					@click="doTest"
				>
					{{ testing ? '测试中…' : '测试连接' }}
				</view>
			</view>

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
				<switch :checked="form.storePhoto" color="#52a98a" @change="onStorePhoto" />
			</view>
			<text class="hint t-xs t-mute">开启后会把识别用的照片存到 App 私有目录，占空间但可回看。</text>
		</view>

		<!-- 目标 -->
		<view class="card">
			<view class="sec-head">
				<text class="sec-title">每日目标</text>
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
				<text class="label">营养素自动分配</text>
				<switch :checked="form.autoMacro" color="#52a98a" @change="onAutoMacro" />
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
						:value="macroShown('protein')"
						@input="onMacroInput('protein', $event)"
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
						:value="macroShown('fat')"
						@input="onMacroInput('fat', $event)"
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
						:value="macroShown('carbs')"
						@input="onMacroInput('carbs', $event)"
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
				<view class="btn btn-plain grow" @click="doExport">导出备份</view>
				<view class="btn btn-plain grow" @click="openImport">导入备份</view>
			</view>
			<text class="hint t-xs t-mute">
				只含记录与设置，体积很小。照片不在这里面。
			</text>

			<!--
				照片导出（把照片一起打包）已经下掉，只留记录 + 设置的 JSON。
				原因与后续计划见 README「待优化」一节：
				这台设备上能可靠写文件的只有 plus.io 的文本写入，把大体积图片
				一起塞进备份会让整条链路的失败面变大；先把「记录不丢」做扎实，
				照片导出之后单独重新设计。
			-->
			<text class="hint t-xs t-mute">
				照片仍保存在本机、在记录里正常显示，只是暂时不跟着备份走。
			</text>

			<!-- 本机自动备份：清空与覆盖导入都是不可逆的，得留后悔药 -->
			<view class="sub-head between">
				<text class="sub-title">本机自动备份</text>
				<text class="t-xs t-mute">
					{{ snapshots.length ? `保留最近 ${SNAPSHOT_KEEP} 份` : '暂无' }}
				</text>
			</view>
			<text v-if="!snapshots.length" class="hint t-xs t-mute">
				清空记录或覆盖导入前会自动把当前数据存一份到这里，可以随时恢复。
			</text>
			<view v-else class="snap-list">
				<view v-for="s in snapshots" :key="s.ts" class="snap-item">
					<view class="grow">
						<text class="t-sm">{{ s.day }} {{ snapTime(s.ts) }}</text>
						<text class="t-xs t-mute snap-meta">
							{{ s.records }} 条 · {{ snapSize(s.bytes) }}
						</text>
					</view>
					<view class="mini-btn" @click="doRestore(s)">恢复</view>
				</view>
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
			<!-- 原生能力自检：真机上 Native.js 有些操作会静默失效，让设备自己报 -->
			<view class="btn btn-plain self-test-btn" @click="doSelfTest">原生能力自检</view>
		</view>
	</view>

	<!-- 自检报告弹层 -->
	<view v-if="testing2" class="mask" @click="testing2 = false">
		<view class="dialog" @click.stop>
			<text class="dialog-title">原生能力自检</text>
			<text class="hint t-xs t-mute">
				把备份链路依赖的底层操作逐个跑一遍。哪条不通会直接说明报什么错，
				方便定位真机上「不报错但什么都不做」的问题。
			</text>
			<scroll-view class="report" scroll-y>
				<text class="report-t">{{ testReport }}</text>
			</scroll-view>
			<view class="row-btns">
				<view class="btn btn-plain grow" @click="testing2 = false">关闭</view>
				<view class="btn btn-ghost grow" @click="copyReport">复制报告</view>
				<view class="btn btn-primary grow" @click="doSelfTest">重新自检</view>
			</view>
		</view>
	</view>

	<!-- 导入弹层 -->
	<view v-if="importing" class="mask" @click="importing = false">
		<view class="dialog" @click.stop>
			<text class="dialog-title">导入备份</text>
			<text class="hint t-xs t-mute">把之前导出的 JSON 粘贴到这里</text>
			<view class="clip-btn" @click="pasteFromClipboard">从剪贴板读取</view>
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
import { DEFAULT_BASE_URL, MODELS, MACRO_RATIO } from '../../core/constants.js'
import { getSettings, saveSettings, allRecords, exportAll, importAll, clearAll } from '../../core/db.js'
import { formatTime } from '../../core/date.js'
import { macroGoalsFromKcal } from '../../core/nutrition.js'
import {
	backupFileName,
	copyText,
	writeBackupFile,
	readClipboard,
	shareText,
	listSnapshots,
	readSnapshot,
	SNAPSHOT_KEEP,
} from '../../core/backup.js'
import { probe, saveToDownloads } from '../../core/native-fs.js'
import { runSelfTest } from '../../core/selftest.js'
import { testConnection } from '../../core/ai.js'

const showKey = ref(false)
const testing = ref(false)
const importing = ref(false)
const importText = ref('')
const recordCount = ref(0)
const snapshots = ref([])
const form = reactive({ ...getSettings() })

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

/** 显示值：有待提交的文本就用它，否则用已保存的值 */
const goalShown = computed(() =>
	'dailyGoal' in pending ? pending.dailyGoal : form.dailyGoal
)

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

function onGoalInput(e) {
	pending.dailyGoal = e.detail.value
}

function onMacroInput(key, e) {
	pending[key] = e.detail.value
}

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

const modelLabels = computed(() => MODELS.map((m) => `${m.label} · ${m.hint}`))
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
	// 重新从存储读，待提交的编辑随之作废
	// （否则输入框会停在旧文本上，和 form 里的值对不上）
	clearPending()
	Object.assign(form, getSettings())
	recordCount.value = allRecords().length
	snapshots.value = listSnapshots()
}

onShow(refresh)

function commit(patch, msg) {
	Object.assign(form, saveSettings(patch))
	if (msg) uni.showToast({ title: msg, icon: 'none' })
}

/* ---------------- 测连通（缺口 C2） ---------------- */

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

	if (res.ok) {
		uni.showModal({
			title: '连接正常',
			content: `模型 ${res.model} 已就绪，可以回去拍照识别了。`,
			showCancel: false,
		})
	} else {
		uni.showModal({
			title: '连接失败',
			content: (res.error || '未知错误') + (res.detail ? `\n${res.detail}` : ''),
			showCancel: false,
		})
	}
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

/* ---------------- 备份 ---------------- */

/**
 * 导出确认。
 *
 * 三条路的适用场景不同，所以让用户选，而不是我自作主张：
 *   存到下载目录  → 文件管理器 / 插电脑能直接看到（需 Android 10+）
 *   发送到其他应用 → 微信 / 邮件 / 网盘 / 备忘录
 *   复制到剪贴板  → 到处都能用，但数据量大时粘贴很痛苦
 */
async function doExport() {
	const payload = exportAll()
	const json = JSON.stringify(payload)
	const kb = Math.round(json.length / 1024)

	// 按平台给不同选项：H5 的浏览器下载是最好用的，App 上没这个东西；
	// 而 App 上「写入应用私有目录」恰恰是用户拿不到文件的那个坑，不再当选项摆出来。
	const p = probe()
	const isH5 = typeof document !== 'undefined'
	const opts = p.isAndroid
		? ['存到「下载」目录', '发送到其他应用', '复制到剪贴板']
		: isH5
			? ['下载文件', '复制到剪贴板']
			: ['保存到应用目录', '复制到剪贴板']

	uni.showActionSheet({
		title: `备份 ${kb} KB`,
		itemList: opts,
		success: (r) => {
			const pick = opts[r.tapIndex]
			if (pick === '存到「下载」目录') exportToDownloads(json)
			else if (pick === '发送到其他应用') exportViaShare(json)
			else if (pick === '下载文件' || pick === '保存到应用目录') exportViaFile(json)
			else exportViaClipboard(json, false)
		},
	})
}

/** H5 浏览器下载 / App 私有目录（iOS 等没有 MediaStore 的平台） */
async function exportViaFile(json) {
	const res = await writeBackupFile(json)
	if (res.ok && res.mode === 'download') {
		uni.showToast({ title: '已开始下载', icon: 'success' })
		return
	}
	if (res.ok) {
		uni.showModal({
			title: '备份已写出',
			content: `文件：${backupFileName()}\n位置：${res.path || '应用私有目录'}`,
			showCancel: false,
		})
		return
	}
	showExportError('写入文件失败', res.error, json)
}

/** 存到公共「下载」目录（Android 10+） */
async function exportToDownloads(json) {
	const name = backupFileName()
	uni.showLoading({ title: '写入中…', mask: true })
	const res = await saveToDownloads(json, name)
	uni.hideLoading()

	if (res.ok) {
		uni.showModal({
			title: '已保存',
			content: `位置：${res.where}\n\n打开「文件管理」或在电脑上接 USB，在下载目录里就能找到它。`,
			showCancel: false,
		})
		return
	}

	if (res.unsupported) {
		uni.showToast({ title: res.error || '当前平台不支持', icon: 'none' })
		return
	}

	// 失败要把原因摆出来 —— 这条路只能在真机验证，需要用户把报错告诉我
	showExportError('保存到下载目录失败', res.error, json, res.trace)
}

/** 走系统分享面板（只能发文本） */
async function exportViaShare(json) {
	const res = await shareText(json)
	if (res.ok) return
	if (res.unsupported) {
		uni.showToast({ title: res.error || '当前平台不支持分享', icon: 'none' })
		return
	}
	showExportError('分享失败', res.error, json)
}

/** 剪贴板：各端通用兜底 */
async function exportViaClipboard(json, quiet) {
	const copied = await copyText(json)
	if (!copied.ok) {
		uni.showToast({ title: '复制失败', icon: 'none' })
		return
	}
	if (quiet) return
	uni.showModal({
		title: '已复制到剪贴板',
		content: `${Math.round(json.length / 1024)} KB 的备份 JSON 已复制，粘贴到备忘录或聊天窗口保存。`,
		showCancel: false,
	})
}

/** 导出失败：把诊断信息一并给出，方便排查（这条路只能真机验） */
function showExportError(title, error, json, trace) {
	const p = probe()
	const lines = [
		`原因：${error || '未知'}`,
		`Android：API ${p.isAndroid ? p.sdk : '非 Android'}`,
		`MediaStore：${p.canSaveToDownloads ? '按 SDK 判断可用' : '不可用'}`,
		`系统分享：${p.canShare ? '可用' : '不可用'}`,
	]
	// 失败发生在哪一步最关键：Native.js 的报错经常只在某一环出现
	if (trace) lines.push(`失败步骤：${trace}`)

	uni.showModal({
		title,
		content: `${lines.join('\n')}\n\n要改成复制到剪贴板吗？`,
		confirmText: '复制备份',
		cancelText: '好',
		success: (r) => {
			if (r.confirm) exportViaClipboard(json, false)
		},
	})
}

/* ---------------- 原生能力自检 ---------------- */

const testing2 = ref(false)
const testReport = ref('正在自检…')

async function doSelfTest() {
	testing2.value = true
	testReport.value = '正在自检…'
	try {
		const { text } = await runSelfTest()
		testReport.value = text
	} catch (e) {
		testReport.value = '自检本身出错了：' + String((e && e.message) || e)
	}
}

async function copyReport() {
	const r = await copyText(testReport.value)
	uni.showToast({ title: r.ok ? '已复制' : '复制失败', icon: 'none' })
}

/* ---------------- 照片导出：暂时下掉 ---------------- */
/*
 * 这里原本是「完整备份（含照片）」：把记录与所有照片装进一个备份文件。
 * 已经移除，原因是这条链路的失败面太大 ——
 * 真机上能可靠写文件的只有 plus.io 的文本写入，一旦把几十 MB 的
 * base64 图片一起塞进去，写入大小核对、内存、超时都会成为新的坑。
 * 先把「记录一定不丢」做扎实，照片导出之后单独重新设计（见 README「待优化」）。
 * 照片本身仍然存在本机、在记录详情里正常显示，只是不跟着备份走。
 */

/* ---------------- 本机自动备份 ---------------- */

function snapTime(ts) {
	return formatTime(ts)
}

function snapSize(bytes) {
	const kb = Number(bytes || 0) / 1024
	return kb < 1 ? `${Number(bytes || 0)} B` : `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
}

function doRestore(s) {
	const payload = readSnapshot(s.ts)
	if (!payload) {
		uni.showToast({ title: '这份备份读不出来了', icon: 'none' })
		refresh()
		return
	}
	uni.showModal({
		title: '恢复这份备份？',
		content: `${s.day} 的备份将覆盖当前全部记录。当前数据也会先自动存一份，还能再退回来。`,
		confirmText: '恢复',
		success: (r) => {
			if (!r.confirm) return
			const res = importAll(payload, 'replace')
			if (!res.ok) {
				uni.showToast({ title: res.error || '恢复失败', icon: 'none' })
				return
			}
			refresh()
			uni.showModal({
				title: '已恢复',
				content: `当前共 ${res.total} 条记录。`,
				showCancel: false,
			})
		},
	})
}

async function pasteFromClipboard() {
	const res = await readClipboard()
	if (!res.ok) {
		uni.showToast({ title: res.error || '读取剪贴板失败', icon: 'none' })
		return
	}
	if (!String(res.text || '').trim()) {
		uni.showToast({ title: '剪贴板里没有内容', icon: 'none' })
		return
	}
	importText.value = String(res.text).trim()
	uni.showToast({ title: '已读取', icon: 'none' })
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
		content: '所有记录与照片都会被删除。清空前会自动在本机存一份备份，可以恢复。',
		confirmText: '清空',
		confirmColor: '#c97b6e',
		success: (res) => {
			if (!res.confirm) return
			clearAll()
			refresh()
			uni.showToast({ title: '已清空，可在本机备份里恢复', icon: 'none' })
		},
	})
}
</script>

<style lang="scss" scoped>
	.page {
		padding: $s-3 $s-4 $s-6;
	}

	/* ---------- 分区标题 ---------- */
	.sec-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: $s-3;
	}

	/* 卡片标题行右侧的小按钮：比全局 .btn 矮一半，不抢卡片主体 */
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

	.sec-head .sec-title {
		margin-bottom: 0;
	}

	.sec-title {
		display: block;
		font-size: 25rpx;
		font-weight: 600;
		color: $c-text-sub;
		letter-spacing: 0.5rpx;
		margin-bottom: $s-3;
	}

	/* ---------- 表单行 ---------- */
	.field {
		display: flex;
		align-items: center;
		padding: 13rpx 0;
	}

	.label {
		width: 210rpx;
		flex-shrink: 0;
		font-size: 26rpx;
		color: $c-text-sub;
	}

	.input-wrap {
		flex: 1;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 0 18rpx;
		height: 72rpx;
	}

	.input {
		flex: 1;
		font-size: 27rpx;
		height: 72rpx;
	}

	.input[disabled] {
		color: $c-text-mute;
	}

	.eye {
		font-size: 23rpx;
		font-weight: 500;
		color: $c-primary-dark;
		padding-left: 14rpx;
	}

	.suffix {
		font-size: 23rpx;
		color: $c-text-mute;
		padding-left: 8rpx;
	}

	.picker {
		background: $c-fill;
		border-radius: $r-sm;
		padding: 16rpx 18rpx;
		font-size: 27rpx;
	}

	.ph {
		color: #c3ccd5;
	}

	.hint {
		display: block;
		font-size: 21rpx;
		line-height: 1.65;
		color: $c-text-mute;
		padding: 2rpx 0 12rpx;
	}

	/* ---------- 按钮组 ---------- */
	.row-btns {
		display: flex;
		margin-top: $s-3;
	}

	.row-btns .btn + .btn {
		margin-left: $s-2;
	}

	.test-row {
		margin-top: 0;
		padding-bottom: 4rpx;
	}

	.clear-btn {
		margin-top: $s-2;
	}

	/* ---------- 本机自动备份 ---------- */
	.sub-head {
		margin-top: $s-4;
		margin-bottom: $s-2;
	}

	.sub-title {
		font-size: 25rpx;
		color: $c-text-sub;
	}

	.snap-list {
		margin-top: $s-1;
	}

	.snap-item {
		display: flex;
		align-items: center;
		padding: 14rpx 0;
		border-top: 2rpx solid $c-line;
	}

	.snap-item:first-child {
		border-top: 0;
	}

	.snap-meta {
		display: block;
		margin-top: 4rpx;
	}

	.self-test-btn {
		margin-top: $s-3;
		height: 76rpx;
		font-size: 26rpx;
	}

	.report {
		height: 560rpx;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 18rpx;
		margin: $s-3 0;
	}

	.report-t {
		font-size: 22rpx;
		line-height: 1.7;
		color: $c-text-sub;
		white-space: pre-wrap;
	}

	.clip-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 60rpx;
		margin-top: $s-2;
		border-radius: $r-sm;
		background: $c-primary-weak;
		color: $c-primary-dark;
		font-size: 24rpx;
		font-weight: 500;
	}

	.clip-btn:active {
		opacity: 0.8;
	}

	/* ---------- 关于 ---------- */
	.about-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 15rpx 0;
	}

	.about-row + .about-row {
		border-top: 1rpx solid $c-line;
	}

	/* ---------- 导入弹层 ---------- */
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
		margin-bottom: 6rpx;
	}

	.paste {
		width: 100%;
		height: 280rpx;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 18rpx;
		font-size: 23rpx;
		margin: $s-2 0 $s-3;
	}
</style>
