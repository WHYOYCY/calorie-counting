# 卡路里记录

拍一张饭菜照片，由视觉大模型估算热量与三大营养素，记在本机。
安卓 App，基于 uni-app（Vue 3 + Vite）。

<p align="center">
  <img src="docs/screenshots/home.png" width="24%" alt="记录" />
  <img src="docs/screenshots/stats.png" width="24%" alt="统计" />
  <img src="docs/screenshots/edit.png" width="24%" alt="记录详情" />
  <img src="docs/screenshots/settings.png" width="24%" alt="设置" />
</p>

## 特性

- **拍照识别** —— 拍一张照片，由阿里云百炼 `qwen-vl` 估算热量与三大营养素；
  支持拆解混合菜品（盖浇饭拆成米饭 + 菜），也能直接读取包装上的营养成分表
- **结果可修正** —— 识别结果先落到确认页，逐项可改克数与热量再入库
- **手动兜底** —— 无网、没配 Key、识别失败时都能完整手动记录；
  手动路径同样可以拍照留档或事后识别填充
- **本地持久化** —— 记录存本机，照片存 App 私有目录，无任何统计上报
- **时间分类** —— 按日期分组 + 按时间自动归类餐次（早/午/晚/加餐，含夜宵）
- **汇总统计** —— 日 / 周 / 月视图、达标率、餐次分布、食物热量排行
- **备份与后悔药** —— 清空记录或覆盖导入前会自动在本机留一份快照（保留最近 3 份，可一键回滚）；
  另有**完整备份**：把设置、记录、所有照片打成一个 zip，换手机时用它一次搬过去

## 快速开始

```bash
npm install

npm run dev:h5     # 浏览器里开发调试（最快）
npm run dev:app    # 用 HBuilderX 内置基座在真机运行
npm run build:h5   # 构建 H5
npm run build:app  # 构建 App 资源，产物在 dist/build/app，用 HBuilderX 打包
```

打包 APK 需要 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（云打包）。

## 配置 API Key

App 内 **我的 → 拍照识别 → API Key** 填写阿里云百炼的 API Key，保存在本机。

> Key 不写进代码、不进版本库。获取地址：阿里云百炼控制台。
> 模型默认 `qwen3-vl-flash`（快且便宜，单次识别约 ¥0.001 量级），可在设置里切换。
> 填完可以点「测试连接」立刻验证，不用等到拍照才发现 Key 填错了。

## 不花额度联调

本地 mock 服务会返回一份固定的识别结果，没有 API Key 也能把
「拍照 → 识别 → 确认 → 入库」整条链路走通：

```bash
node scripts/mock-dashscope.mjs 5555
# 然后在 App「我的 → 接口地址」填 http://localhost:5555/v1
# Key 随便填一段够长的字符串即可（mock 只检查是否存在，不校验真伪）
```

> 真机访问不了 `localhost`，请换成电脑的局域网 IP，例如
> `http://192.168.1.5:5555/v1`，并确保手机与电脑在同一 Wi-Fi。

## 测试

```bash
npm test          # 模板绑定检查 + 核心逻辑单元测试
npm run check     # 只查模板绑定
npm run test:core # 只跑核心逻辑单元测试
```

`npm test` 是两道关：

1. **模板绑定检查**（`scripts/check-templates.mjs`）—— 把模板里引用到的标识符与
   `<script setup>` 里声明的名字做差集。这类错误单元测试完全抓不到
   （逻辑层本身是对的），只在渲染时才炸 `Property "x" was accessed during render`。
2. **核心逻辑单元测试**（405 项断言）—— 日期与餐次归类、营养换算、
   数据层增删改查与迁移、统计聚合、DashScope 请求契约。

核心逻辑（`src/core/`）不依赖 uni 运行时，靠运行时特性探测解耦，
因此可以直接在 Node 里测，不需要模拟器。

### H5 冒烟测试

```bash
npm run build:h5
node scripts/seed-smoke.mjs      # 生成 3 个灌了种子数据、直达目标页的种子页
node scripts/serve-dist.mjs 4173 # 起静态服务
# 浏览器打开 http://localhost:4173/seed.html
```

## 目录结构

```
src/
├── core/                  # 纯逻辑，零 UI 依赖，全部可单测
│   ├── constants.js       # 常量、默认设置、餐次定义
│   ├── date.js            # 日期键、周/月边界、日期标签、餐次自动归类
│   ├── nutrition.js       # per100g 基准模型、营养换算、主菜识别、目标推导
│   ├── storage.js         # 本地存储原语（db 与 backup 共用，避免循环依赖）
│   ├── db.js              # 记录 CRUD、设置、schema 迁移、备份导入导出
│   ├── stats.js           # 逐日序列、区间汇总、食物聚合
│   ├── ai.js              # DashScope 客户端（JSON 容错解析 + 错误映射）
│   ├── photo.js           # 选图 / base64 / 落盘 / 删除（平台差异收敛处）
│   ├── draft.js           # 识别结果 → 编辑页 的内存中转
│   ├── zip.js             # 极简 zip 读写（store 方式，流式写）
│   ├── fullbackup.js      # 完整备份的打包/解包与路径改写（纯逻辑）
│   ├── fullbackup-io.js   # 完整备份的导出/恢复编排
│   ├── backup.js          # 本机快照、剪贴板、备份落盘
│   └── native-fs.js       # App 原生原语（MediaStore / SAF / 私有文件）
├── pages/
│   ├── index/index.vue        # 记录：今日汇总 + 餐次列表 + 悬浮操作
│   ├── stats/stats.vue        # 统计：日/周/月 + 图表 + 排行
│   ├── settings/settings.vue  # 我的：API Key、目标、数据管理
│   └── record/edit.vue        # 记录详情：新增/编辑/删除、照片
├── static/                # 图标（由脚本生成，勿手改）
├── App.vue                # 全局样式
├── pages.json             # 路由 + tabBar
└── uni.scss               # 设计令牌（自动注入所有 scss 块）

scripts/
├── gen-icons.mjs          # 零依赖 PNG 生成器（4x 超采样抗锯齿）
├── test-core.mjs          # 单元测试 + 请求契约测试
├── check-templates.mjs    # 模板绑定静态检查
├── seed-smoke.mjs         # 冒烟测试种子页生成器
├── serve-dist.mjs         # 静态服务器
├── measure.mjs            # 注入探针测量 rem 缩放，排查布局问题
└── mock-dashscope.mjs     # 本地 mock 识别服务
```

## 设计说明

### 数据模型

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

这样改克数时营养自动联动，且不会出现「改了热量但营养素对不上」的自相矛盾。

### 列表标题选主菜而不是第一项

用户常常顺手先录米饭，拿米饭当标题会让人误以为这顿只吃了米饭。
`mainItem()` 按**单项热量最高**挑主角（热量相同取克数大的），其余菜品降为次级信息。

### 换手机时照片怎么办

照片只存在 App 私有目录，**普通备份里只有路径、没有照片** ——
拿普通备份到新手机上，每张照片的位置都是一片空白。所以另做了一条路：

**完整备份**把 `backup.json` + `photos/` 打成一个 zip。导出时会把记录里的
照片路径改写成 zip 内的相对路径（这样才算可移植）；恢复时再把照片写回
新手机的私有目录并改回绝对路径。

几个关键取舍：

- **用 store（不压缩）方式打 zip**。照片是 JPEG，本来就已经压过，deflate
  收益约 0~3%；不压缩则读取端只需支持 store，**不必在 JS 里实现 inflate**。
  这也不依赖 plus.zip（那要在 manifest 里勾 Zip 模块）。
- **写入是流式的**，一次只在内存里拿一张照片，不是把几百 MB 全堆起来。
  但仍设了 120MB 上限：超过就明确拒绝并告诉用户去清理照片，而不是走到崩溃。
- **备份里没带的照片，导入时会把记录的图片字段清空**。留一个永远显示不
  出来的路径比没有更糟 —— 界面上一片空白还不告诉你为什么。
- 编辑页对读不出来的照片会明确显示「照片已丢失」，而不是默默留白。
- **写文件不用 Blob**。uni-app App 端的页面 JS 跑在逻辑层 JS 引擎里，
  不是浏览器环境 —— 没有 `document` / `window` / `Blob`
  （真机报「当前内核不支持 Blob」就是这个原因），所以
  `plus.io` 的 `FileWriter.write(Blob)` 在 App 上走不通。
  改用 Native.js 的 `FileOutputStream`，二进制则编成 ISO-8859-1
  字符串再过 `getBytes`（U+0000~U+00FF 与字节一一映射，往返无损）。

### 为什么导出要走系统能力

安卓 11 起强制分区存储：`Android/data/<包名>/` 这个应用私有目录，
文件管理器进不去、插电脑 USB 也看不到 —— 备份写在那里等于拿不出来。
而 `plus.io.PUBLIC_DOWNLOADS` 名字看着像公共下载目录，实测仍解析到
应用私有目录（`Android/data/<包名>/.<appid>/downloads`），所以那个经典写法没用。
想真的落到用户能看到的地方，只能走 MediaStore（Android 10+ 直接写入公共下载目录）。

这部分代码在开发机上跑不了，因此 `native-fs.js` 里每一处都 try/catch、
失败返回结构化错误而不抛异常，导出流程按「MediaStore → 系统分享 → 剪贴板」
降级，并把失败原因和系统版本一起提示出来，方便用户回报。

### 图标是生成的，不是手绘的

`scripts/gen-icons.mjs` 里是一个零依赖的 PNG 编码器 + 4x 超采样抗锯齿，
用圆角矩形、椭圆、圆头线段这些图元组合出所有图标，
支持挖空（相机镜头成环、警示图标挖出感叹号）与描边（tabBar 线性图标）。
换主色只需改脚本里的几个色值重新生成。

## 隐私

- 记录与照片只存在本机
- 照片仅发送到你自己填写的接口地址用于识别
- 应用不含任何统计上报（已在 manifest 中关闭 uni 统计）

## 免责

识别结果由大模型估算，仅供记录参考，不构成医疗或营养建议。

## License

[MIT](LICENSE)
