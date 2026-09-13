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
		line-height: 1.5;
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

	.row-top {
		display: flex;
		align-items: flex-start;
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

	/* ---------- 卡片 ---------- */
	.card {
		background: $c-card;
		border-radius: $radius;
		padding: $gap;
	}

	.card + .card {
		margin-top: $gap;
	}

	/* ---------- 文字 ---------- */
	.t-sub {
		color: $c-text-sub;
	}

	.t-mute {
		color: $c-text-mute;
	}

	.t-sm {
		font-size: 24rpx;
	}

	.t-xs {
		font-size: 22rpx;
	}

	.t-lg {
		font-size: 34rpx;
	}

	.t-bold {
		font-weight: 600;
	}

	.num {
		font-variant-numeric: tabular-nums;
	}

	/* ---------- 按钮 ---------- */
	.btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 88rpx;
		border-radius: 44rpx;
		font-size: 30rpx;
		font-weight: 500;
	}

	.btn:active {
		opacity: 0.85;
	}

	.btn-primary {
		background: $c-primary;
		color: #fff;
	}

	.btn-ghost {
		background: $c-primary-weak;
		color: $c-primary-dark;
	}

	.btn-plain {
		background: #f3f4f6;
		color: $c-text-sub;
	}

	.btn-danger {
		background: $c-danger-weak;
		color: $c-danger;
	}

	.btn[disabled],
	.btn.disabled {
		opacity: 0.5;
	}

	/* ---------- 空状态 ---------- */
	.empty {
		padding: 90rpx 0;
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
