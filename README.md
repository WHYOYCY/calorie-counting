# 卡路里记录

拍照识别食物热量 + 本地持久化记录的安卓 App。基于 uni-app (Vue 3 + Vite)。

## 特性

- **拍照识别**：拍一张饭菜照片，由阿里云百炼 qwen-vl 视觉模型估算热量与三大营养素，结果可逐项修正后入库
- **本地持久化**：记录存在本机，照片存 App 私有目录，无任何统计上报
- **时间分类**：按日期分组 + 按时间自动归类餐次（早餐 / 午餐 / 晚餐 / 加餐，含夜宵）
- **汇总统计**：日 / 周 / 月 视图、达标率、餐次分布、食物热量排行
- **手动兜底**：AI 不可用时（无网、未配 Key、识别失败）仍可完整手动记录

## 环境要求

- Node.js ≥ 18
- 打包安卓 APK 需要 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（用于云打包）

## 快速开始

```bash
npm install

npm run dev:h5        # 浏览器里开发调试（最快）
npm run dev:app       # 用 HBuilderX 内置基座在真机运行
npm run build:h5      # 构建 H5
npm run build:app     # 构建 App 资源（配合 HBuilderX 打包）
```

## 配置 API Key

App 内 **我的 → 拍照识别 → API Key** 填写阿里云百炼的 API Key，保存在本机。

> Key 不写进代码、不进版本库。获取地址：阿里云百炼控制台。
> 模型默认 `qwen3-vl-flash`（快且便宜，单次识别约 ¥0.001 级别），可在设置里切换。

## 测试

```bash
npm test              # 核心逻辑单元测试（116+ 断言，纯 Node 运行）
```

核心逻辑（日期、营养换算、数据层、统计聚合）都是纯函数，不依赖 uni 运行时，
因此可以直接在 Node 中测试，无需模拟器。

### H5 冒烟测试

用无头浏览器验证「有数据状态」下的真实渲染与数据绑定：

```bash
npm run build:h5
node scripts/seed-smoke.mjs      # 往构建产物里写一个灌了种子数据的 seed.html
node scripts/serve-dist.mjs 4173 # 起静态服务
# 然后用浏览器打开 http://localhost:4173/seed.html
```

### 不花额度联调识别链路

本地 mock 服务会返回一份固定的识别结果，可在没有 API Key 的情况下
把「拍照 → 识别 → 确认 → 入库」整条链路走通：

```bash
node scripts/mock-dashscope.mjs 5555
# 然后在 App「我的 → 接口地址」填 http://localhost:5555/v1
# Key 随便填一段够长的字符串即可（mock 只检查是否存在，不校验真伪）
```

> 真机访问不了 `localhost`，请把地址换成电脑的局域网 IP，
> 例如 `http://192.168.1.5:5555/v1`，并确保手机与电脑在同一 Wi-Fi。

## 验证状态

下表区分「已自动化验证」与「必须真机验证」——后者依赖摄像头、
相册权限与原生文件系统，无法在浏览器里覆盖：

| 能力 | 状态 |
|---|---|
| 核心逻辑（日期 / 营养换算 / 数据层 / 统计聚合） | ✅ 183 项断言 |
| 发给 DashScope 的请求格式（data URI、鉴权头、参数） | ✅ mock `uni.request` 断言 |
| 四个页面的渲染 | ✅ 无头浏览器 dump DOM |
| 数据绑定数值正确性 | ✅ 与手算结果逐项比对 |
| **拍照 → base64 转换（`plus.io.FileReader`）** | ⚠️ 需真机验证 |
| **相机 / 相册权限拒绝后的引导** | ⚠️ 需真机验证 |
| **照片落盘与删除（App 私有目录）** | ⚠️ 需真机验证 |
| **云打包 APK 与安装** | ⚠️ 需 HBuilderX + DCloud 账号 |

## 目录结构

```
src/
├── core/                  # 纯逻辑，零 UI 依赖，全部可单测
│   ├── constants.js       # 常量、默认设置、餐次定义
│   ├── date.js            # 日期键、周/月边界、日期标签、餐次归类
│   ├── nutrition.js       # per100g 基准模型、营养换算、目标推导
│   ├── db.js              # 记录 CRUD、设置、schema 迁移、备份
│   ├── stats.js           # 逐日序列、区间汇总、食物聚合
│   ├── ai.js              # DashScope 客户端（JSON 容错解析 + 错误映射）
│   ├── photo.js           # 选图 / base64 / 落盘 / 删除（平台差异收敛处）
│   ├── draft.js           # 识别结果 → 编辑页 的内存中转
│   └── backup.js          # 备份落盘 / 复制（平台差异收敛处）
├── pages/
│   ├── index/index.vue    # 记录（首页）：今日汇总 + 餐次分组
│   ├── stats/stats.vue    # 统计：日/周/月 + 图表 + 排行
│   ├── settings/settings.vue  # 我的：API Key、目标、数据管理
│   └── record/edit.vue    # 记录详情：新增/编辑/删除
├── static/tabbar/         # tabBar 图标（由脚本生成，勿手改）
├── App.vue                # 全局样式
├── pages.json             # 路由 + tabBar
└── uni.scss               # 主题变量（自动注入所有 scss 块）

scripts/
├── gen-tabbar-icons.mjs   # 零依赖 PNG 生成器（4x 超采样抗锯齿）
├── test-core.mjs          # 单元测试 + 请求契约测试
├── seed-smoke.mjs         # 冒烟测试种子数据
├── serve-dist.mjs         # 静态服务器
└── mock-dashscope.mjs     # 本地 mock 识别服务（不花额度联调）
```

## 数据模型

一条记录里的每个食物项存**每 100g 基准值** `per100` + 实际克数 `grams`，
所有展示值由 `per100 × grams/100` 派生：

```js
{
  id, ts, date,            // date 与 meal 由 ts 派生，改时间会自动重算
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  items: [{ name, grams, per100: { kcal, protein, fat, carbs } }],
  photo, note, source: 'ai' | 'manual', createdAt, updatedAt
}
```

这样用户改克数时营养自动联动，且不会出现「改了热量但营养素对不上」的自相矛盾。

## 隐私

- 记录与照片只存在本机
- 照片仅发送到你自己填写的接口地址用于识别
- 应用不含任何统计上报（已在 manifest 中关闭 uni 统计）

## 免责

识别结果由大模型估算，仅供记录参考，不构成医疗或营养建议。
