<script>
	import { initDB } from './core/db.js'

	export default {
		onLaunch() {
			// 迁移数据结构、补齐默认设置、预热记录缓存
			try {
				initDB()
			} catch (e) {
				console.error('[initDB] 失败', e)
			}
		},
	}
</script>

<style lang="scss">
	/* ================= 全局基础样式 ================= */
	page {
		background-color: $c-bg;
		color: $c-text;
		font-size: 28rpx;
		line-height: 1.55;
		-webkit-font-smoothing: antialiased;
	}

	view,
	text,
	input,
	textarea,
	scroll-view,
	image {
		box-sizing: border-box;
	}

	/* ---------- 布局 ---------- */
	.row {
		display: flex;
		align-items: center;
	}

	.between {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.center {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.grow {
		flex: 1;
		min-width: 0;
	}

	.wrap {
		flex-wrap: wrap;
	}

	.ellipsis {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	/* ---------- 卡片：靠阴影分层，不靠描边 ---------- */
	.card {
		background: $c-card;
		border-radius: $r-md;
		padding: $s-4;
		box-shadow: $sh-1;
	}

	.card + .card {
		margin-top: $s-3;
	}

	/* ---------- 文字 ---------- */
	.t-sub {
		color: $c-text-sub;
	}

	.t-mute {
		color: $c-text-mute;
	}

	.t-sm {
		font-size: 25rpx;
	}

	.t-xs {
		font-size: 22rpx;
	}

	.t-bold {
		font-weight: 600;
	}

	/* 数字统一用等宽数字，避免跳动 */
	.num {
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum';
	}

	/* ---------- 分区标题 ---------- */
	.sec {
		display: block;
		font-size: 25rpx;
		font-weight: 600;
		color: $c-text-sub;
		letter-spacing: 1rpx;
		margin-bottom: $s-3;
	}

	/* ---------- 按钮 ---------- */
	.btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 92rpx;
		border-radius: $r-md;
		font-size: 29rpx;
		font-weight: 500;
		transition: opacity 0.15s, transform 0.15s;
	}

	.btn:active {
		opacity: 0.82;
		transform: scale(0.985);
	}

	.btn-primary {
		background: $c-primary;
		color: #fff;
		box-shadow: 0 6rpx 18rpx rgba(15, 163, 107, 0.22);
	}

	.btn-ghost {
		background: $c-card;
		color: $c-text;
		box-shadow: $sh-1;
	}

	.btn-plain {
		background: $c-fill;
		color: $c-text-sub;
	}

	.btn-danger {
		background: $c-danger-weak;
		color: $c-danger;
	}

	.btn.disabled {
		opacity: 0.5;
	}

	/* ---------- 图标 ---------- */
	.ico {
		width: 36rpx;
		height: 36rpx;
		flex-shrink: 0;
	}

	.ico-sm {
		width: 28rpx;
		height: 28rpx;
		flex-shrink: 0;
	}

	.ico-lg {
		width: 44rpx;
		height: 44rpx;
		flex-shrink: 0;
	}

	/* ---------- 空状态 ---------- */
	.empty {
		padding: 80rpx 0;
		text-align: center;
		color: $c-text-mute;
		font-size: 26rpx;
	}

	/* ---------- 安全区 ---------- */
	.safe-bottom {
		padding-bottom: constant(safe-area-inset-bottom);
		padding-bottom: env(safe-area-inset-bottom);
	}
</style>
