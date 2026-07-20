# BOM Intake & Normalization Agent

面向 ezPLM / EEAgent 的 BOM 接入与标准化 Agent（Agent 31）。项目可直接部署到 Vercel，支持将 Excel、CSV、PDF、扫描件、截图及粘贴文本转换为可追溯的 Canonical BOM。

## 核心能力

- **多格式接入**：XLSX、XLSM、XLS、XLSB、CSV、TSV、TXT、Markdown、HTML、PDF 与常见图片。
- **隐私优先**：二进制文件默认在浏览器内解析；不把客户 BOM 发送给第三方大模型。
- **结构识别**：自动选择候选 Sheet/Table，识别单行或多行表头，构建 Header Path。
- **语义映射**：中英文 Alias、Header Path、样例值和邻列上下文共同决定字段映射。
- **规则标准化**：RefDes 范围、U1A/U1B、Qty、DNP、Variant、Level、MPN、Package。
- **证据保留**：Raw Cell、公式、显示值、隐藏状态、合并区域、PDF bbox 和 OCR 置信度。
- **质量审核**：Qty/RefDes、重复位号、多 MPN、歧义列、Qty=0 与未知列。
- **非破坏性修改**：`machine_record + approved_patches = resolved_view`。
- **DigiKey 富化**：按制造商料号补全厂商名称，并返回 DigiKey 产品参数中的封装候选与匹配置信度。
- **安全导出**：完整 JSON 与防 CSV Formula Injection 的 UTF-8 CSV。

## 快速开始

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

质量检查：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 部署到 Vercel

1. 将仓库推送到 GitHub、GitLab 或 Bitbucket。
2. 在 Vercel 中导入仓库；Framework Preset 选择 `Next.js`。
3. Build Command 使用 `npm run build`，无需必填环境变量。
4. 部署后访问 `/health/live` 与 `/health/ready` 验证状态。

### 配置 DigiKey API

在 DigiKey Developer Portal 为应用订阅 **Product Information V4 / ProductSearch** 后，在 Vercel 项目的 **Settings → Environment Variables** 添加以下 Production（建议 Preview 也添加）变量：

```text
DIGIKEY_CLIENT_ID=你的 DigiKey OAuth Client ID
DIGIKEY_CLIENT_SECRET=你的 DigiKey OAuth Client Secret
DIGIKEY_LOCALE_SITE=US
DIGIKEY_LOCALE_LANGUAGE=en
DIGIKEY_LOCALE_CURRENCY=USD
```

保存后重新部署。不要把 `Client Secret` 放入 GitHub、浏览器代码或 `NEXT_PUBLIC_*` 变量。应用使用 DigiKey OAuth 2-legged `client_credentials` 流程，在服务端获取短期令牌；点击页面的“DigiKey 补全”只会提交 BOM 中含有制造商料号的行，单次最多 25 条。`.env.example` 提供本地变量模板。

### 配置 ezPLM API

在 Vercel 的 **Settings → Environment Variables** 添加 `EZPLM_API_KEY`。该值仅用于服务端按 ezPLM 的 HMAC-SHA256 规则签名请求，绝不能使用 `NEXT_PUBLIC_` 前缀或提交到 Git。查询优先级为：非 R/C 器件先查 ezPLM，未命中再查 DigiKey 和 Mouser；R/C 无源器件直接查 DigiKey/Mouser。

也可使用 Vercel CLI：

```bash
npm i -g vercel
vercel
```

当前 MVP 是无状态部署。需要服务端任务历史、团队审核和大文件异步处理时，建议接入 Vercel Blob/R2、Vercel Postgres/Neon 与队列 Worker；接口与对象边界已按此方式预留。

## API

### `POST /api/v1/bom-normalization/jobs`

服务端 API 接收已经提取的二维表格，无状态返回标准化结果。浏览器端二进制 Adapter 会先保留 Raw Cell，再调用同一标准化内核。

```json
{
  "source": {
    "type": "parsed_table",
    "filename": "bom.csv",
    "rows": [
      ["位号", "数量", "厂商", "型号"],
      ["R1-R4", 4, "Yageo", "RC0402FR-0710KL"]
    ]
  },
  "options": {
    "preferred_language": "zh-CN",
    "detect_variants": true,
    "detect_multilevel": true,
    "preserve_hidden_rows": true,
    "evaluate_formulas": false
  },
  "idempotency_key": "optional-client-key"
}
```

返回包含 `columnMappings`、`lines`、`rawFieldDictionary`、`reviewItems`、`quality` 与下游事件摘要。

### `POST /api/v1/bom-normalization/enrich/digikey`

仅在服务端配置 DigiKey 凭证后可用。请求传入最多 25 个 `lineId` 与 `manufacturerPartNumber`；响应将厂商、产品描述、封装候选、DigiKey 料号和精确/候选匹配置信度作为富化层返回，不改写原始字段或人工 Patch。

## 安全设计

- MIME 与文件头双校验；默认文件上限 25 MB。
- XLSX/XLSM/XLSB 检查 ZIP 展开体积和压缩比。
- 工作簿限制行、列与单元格总量；不执行宏、外部链接或公式。
- PDF 限制页数；图片限制总像素；OCR 仅在浏览器 Worker 中运行。
- MPN 的 OCR 高风险字符不自动替换。
- 导出 CSV 时，对以 `= + - @` 开头的值添加安全前缀。

## 目录

```text
app/                         Next.js 页面与 Route Handlers
components/                  上传工作区、表格、审核台
lib/bom/                     Domain、Adapter、规则、Patch 与导出
schemas/                     Canonical BOM JSON Schema
tests/                       规则和端到端标准化单测
docs/                        架构、API 与已知边界
```

## 当前边界

- PDF 表格重建基于文本块坐标；复杂无框表格和多栏 PDF 仍需审核。
- 扫描件/图片使用 Tesseract OCR；首开会下载公开 OCR 运行资源，文件内容仍保留在本地。
- XLSX 读取公式和缓存显示值但不重新计算；缓存缺失时不会伪造结果。
- DigiKey 富化不对没有制造商料号的行猜测厂商；从 Footprint 推断的封装优先于 DigiKey 产品参数候选。富化结果不是最终 Part Resolution、价格库存或自动替代料决策。
- Vercel Serverless 不适合长时间大批量 OCR；生产规模建议将 OCR 下沉到隔离 Worker。

详细设计见 `docs/architecture.md` 与 `docs/api.md`。
