/**
 * 本地存储原语
 *
 * 单独抽出来的原因：db.js（记录）和 backup.js（快照）都要用，
 * 而 db.js 也要在清空/覆盖前写快照 —— 如果两边互相 import 就成了循环依赖。
 *
 * 全部用运行时特性探测，所以本模块在 Node 里也能安全 import（测试用假存储替身）。
 */

export function hasStorage() {
	return (
		typeof uni !== 'undefined' &&
		!!uni &&
		typeof uni.getStorageSync === 'function' &&
		typeof uni.setStorageSync === 'function'
	)
}

export function readRaw(key, fallback) {
	if (!hasStorage()) return fallback
	try {
		const v = uni.getStorageSync(key)
		if (v === '' || v === null || v === undefined) return fallback
		return typeof v === 'string' ? JSON.parse(v) : v
	} catch (e) {
		return fallback
	}
}

export function writeRaw(key, value) {
	if (!hasStorage()) return false
	try {
		uni.setStorageSync(key, JSON.stringify(value))
		return true
	} catch (e) {
		return false
	}
}

export function removeRaw(key) {
	if (!hasStorage() || typeof uni.removeStorageSync !== 'function') return false
	try {
		uni.removeStorageSync(key)
		return true
	} catch (e) {
		return false
	}
}
