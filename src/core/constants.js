/**
 * 全局常量与默认配置
 */

/** 数据结构版本号 —— 升级时用于迁移，防止旧数据丢失 */
export const SCHEMA_VERSION = 1

/** 餐次定义（顺序即展示顺序） */
export const MEALS = [
	{ key: 'breakfast', label: '早餐', short: '早' },
	{ key: 'lunch', label: '午餐', short: '午' },
	{ key: 'dinner', label: '晚餐', short: '晚' },
	{ key: 'snack', label: '加餐', short: '加' },
]

export const MEAL_KEYS = MEALS.map((m) => m.key)

export function mealLabel(key) {
	const m = MEALS.find((x) => x.key === key)
	return m ? m.label : '其他'
}

/** 默认每日热量目标（kcal） */
export const DEFAULT_DAILY_GOAL = 1800

/**
 * 三大营养素供能占比默认值。
 * 供能系数：蛋白质 4 kcal/g、脂肪 9 kcal/g、碳水 4 kcal/g
 */
export const MACRO_RATIO = { protein: 0.2, fat: 0.25, carbs: 0.55 }

export const KCAL_PER_GRAM = { protein: 4, fat: 9, carbs: 4 }

export const MACRO_META = [
	{ key: 'protein', label: '蛋白质', unit: 'g', color: '#3b82f6' },
	{ key: 'fat', label: '脂肪', unit: 'g', color: '#f59e0b' },
	{ key: 'carbs', label: '碳水', unit: 'g', color: '#8b5cf6' },
]

/** 可选视觉模型 */
export const MODELS = [
	{ id: 'qwen3-vl-flash', label: 'qwen3-vl-flash', hint: '快 · 省（推荐）' },
	{ id: 'qwen3-vl-plus', label: 'qwen3-vl-plus', hint: '准 · 贵' },
	{ id: 'qwen-vl-max', label: 'qwen-vl-max', hint: '经典款' },
]

export const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export const DEFAULT_SETTINGS = {
	apiKey: '',
	baseUrl: DEFAULT_BASE_URL,
	model: 'qwen3-vl-flash',
	dailyGoal: DEFAULT_DAILY_GOAL,
	/** true = 三大营养素目标由热量目标自动推导 */
	autoMacro: true,
	macroGoals: { protein: 90, fat: 50, carbs: 248 },
	/** 是否把识别用的照片存到 App 沙箱 */
	storePhoto: true,
}

/** 记录来源 */
export const SOURCE = { AI: 'ai', MANUAL: 'manual' }
