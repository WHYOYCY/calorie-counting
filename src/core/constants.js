/**
 * 全局常量与默认配置
 */

/** 数据结构版本号 —— 升级时用于迁移，防止旧数据丢失 */
export const SCHEMA_VERSION = 1

/** 餐次定义（顺序即展示顺序） */
export const MEALS = [
	{
		key: 'breakfast',
		label: '早餐',
		short: '早',
		color: '#d9a45b',
		icon: '/static/meal/breakfast.png',
	},
	{ key: 'lunch', label: '午餐', short: '午', color: '#52a98a', icon: '/static/meal/lunch.png' },
	{ key: 'dinner', label: '晚餐', short: '晚', color: '#6e90cc', icon: '/static/meal/dinner.png' },
	{ key: 'snack', label: '加餐', short: '加', color: '#9c86cc', icon: '/static/meal/snack.png' },
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
	{ key: 'protein', label: '蛋白质', unit: 'g', color: '#8fb0e0' },
	{ key: 'fat', label: '脂肪', unit: 'g', color: '#e8cb8a' },
	{ key: 'carbs', label: '碳水', unit: 'g', color: '#b5a6e0' },
]

/** 应用版本（界面上只显示这一处，避免各页面各写一个数字） */
export const APP_VERSION = '1.0.1'

/**
 * 可选视觉模型。
 *
 * plain 是给普通用户看的说法（「快速识别」比 qwen3-vl-flash 好懂），
 * 具体模型名只在二级设置页里以小字出现 —— 那是给要排查问题的人看的。
 */
export const MODELS = [
	{
		id: 'qwen3-vl-flash',
		plain: '快速识别',
		label: 'qwen3-vl-flash',
		hint: '最快、最省，日常够用（推荐）',
	},
	{ id: 'qwen3-vl-plus', plain: '精细识别', label: 'qwen3-vl-plus', hint: '更准一些，也贵一些' },
	{ id: 'qwen-vl-max', plain: '经典识别', label: 'qwen-vl-max', hint: '上一代旗舰，兼容旧配置' },
]

/** 把模型 id 说成人话（找不到就退回 id 本身） */
export function modelPlain(id) {
	const m = MODELS.find((x) => x.id === id)
	return m ? m.plain : String(id || '')
}

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
