<template>
	<view class="page">
		<!-- 备份 -->
		<view class="card">
			<text class="sec-title">备份与恢复</text>
			<text class="hint t-xs t-mute">
				包含记录与设置，不含照片。换手机时导出，在新手机上导入即可。
			</text>

			<view class="row-btns">
				<view class="btn btn-plain grow" @click="doExport">导出备份</view>
				<view class="btn btn-plain grow" @click="openImport">导入备份</view>
			</view>

			<!--
				照片导出（把照片一起打包）暂时下掉了，只留记录 + 设置的 JSON。
				原因与后续计划见 README「待优化」：能可靠写文件的只有 plus.io 文本写入，
				把大体积图片一起塞进去会让整条链路的失败面变大。
			-->
			<text class="hint t-xs t-mute">照片仍保存在本机、在记录里正常显示，只是不跟着备份走。</text>
		</view>

		<!-- 本机自动备份：清空与覆盖导入都是不可逆的，得留后悔药 -->
		<view class="card">
			<view class="sec-head">
				<text class="sec-title">本机自动备份</text>
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
		</view>

		<!-- 危险操作单独一张卡，和上面隔开 -->
		<view class="card">
			<text class="sec-title">清空</text>
			<text class="hint t-xs t-mute">
				共 {{ recordCount }} 条记录，全部保存在本机。清空前会自动留一份备份。
			</text>
			<view class="btn btn-danger clear-btn" @click="doClear">清空全部记录</view>
		</view>

		<!-- 排查工具：真机上 Native.js 有些操作会静默失效，让设备自己报 -->
		<view class="card">
			<text class="sec-title">排查</text>
			<text class="hint t-xs t-mute">
				导出/导入出问题时，先跑一遍自检，把报告发给我即可定位。
			</text>
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
			<text class="hint t-xs t-mute">
				合并＝保留现有记录，仅补入新记录；覆盖＝清空后整体替换。
			</text>
		</view>
	</view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { allRecords, exportAll, importAll, clearAll } from '../../core/db.js'
import { formatTime } from '../../core/date.js'
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

const importing = ref(false)
const importText = ref('')
const recordCount = ref(0)
const snapshots = ref([])
const testing2 = ref(false)
const testReport = ref('正在自检…')

function refresh() {
	recordCount.value = allRecords().length
	snapshots.value = listSnapshots()
}

onShow(refresh)

/* ---------------- 导出 ---------------- */

/**
 * 导出确认。
 *
 * 三条路的适用场景不同，所以让用户选，而不是我自作主张：
 *   存到下载目录  → 文件管理器 / 插电脑能直接看到
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

/* ---------------- 导入 ---------------- */

function openImport() {
	importText.value = ''
	importing.value = true
}

const onImportText = (e) => {
	importText.value = e.detail.value
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

/* ---------------- 清空 ---------------- */

/**
 * 清空是唯一不可逆的操作，所以要**两步**：
 * 第一次弹窗说明后果，确认后还要再输一次确认词。
 * 用户之前反馈过「怕误点」，一次弹窗不够。
 */
function doClear() {
	if (!recordCount.value) {
		uni.showToast({ title: '本来就是空的', icon: 'none' })
		return
	}
	uni.showModal({
		title: `清空全部 ${recordCount.value} 条记录？`,
		content: '所有记录与照片都会被删除。清空前会自动在本机存一份备份，可以恢复。',
		confirmText: '继续',
		confirmColor: '#c97b6e',
		success: (res) => {
			if (!res.confirm) return
			uni.showModal({
				title: '再确认一次',
				content: '这一步不能撤销（但可以从本机备份恢复）。确定要清空吗？',
				confirmText: '确定清空',
				confirmColor: '#c97b6e',
				cancelText: '算了',
				success: (r2) => {
					if (!r2.confirm) return
					clearAll()
					refresh()
					uni.showToast({ title: '已清空，可在本机备份里恢复', icon: 'none' })
				},
			})
		},
	})
}

/* ---------------- 原生能力自检 ---------------- */

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
</script>

<style lang="scss" scoped>
	.page {
		padding: $s-3 $s-4 $s-6;
	}

	.card + .card {
		margin-top: $s-3;
	}

	.sec-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: $s-2;
	}

	.hint {
		display: block;
		line-height: 1.5;
		margin-top: 10rpx;
	}

	.row-btns {
		display: flex;
		margin-top: $s-3;
	}

	.row-btns .btn + .btn {
		margin-left: $s-2;
	}

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
	}

	.mini-btn:active {
		opacity: 0.8;
	}

	.clear-btn {
		margin-top: $s-3;
	}

	.self-test-btn {
		margin-top: $s-4;
	}

	/* ---------- 自动备份列表 ---------- */
	.snap-list {
		margin-top: $s-2;
	}

	.snap-item {
		display: flex;
		align-items: center;
		padding: $s-3 0;
	}

	.snap-item:first-child {
		padding-top: 0;
	}

	.snap-item + .snap-item {
		border-top: 1rpx solid $c-line;
	}

	.snap-meta {
		display: block;
		margin-top: 2rpx;
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
		margin-bottom: 6rpx;
	}

	.report {
		max-height: 620rpx;
		background: $c-fill;
		border-radius: $r-sm;
		padding: 18rpx;
		margin: $s-2 0 $s-3;
	}

	.report-t {
		font-size: 21rpx;
		line-height: 1.7;
		color: $c-text-sub;
		white-space: pre-wrap;
	}

	.clip-btn {
		margin-top: $s-3;
		height: 68rpx;
		border-radius: $r-sm;
		background: $c-primary-weak;
		color: $c-primary-dark;
		font-size: 24rpx;
		font-weight: 500;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.clip-btn:active {
		opacity: 0.85;
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

	.ph {
		color: $c-text-mute;
	}
</style>
