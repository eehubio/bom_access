# 架构设计

## 1. 部署形态

项目采用 Next.js App Router，可直接部署到 Vercel。架构分为两条路径：

1. **浏览器隐私路径**：文件安全检查 → Format Adapter → Raw Document → 标准化内核 → 审核台。
2. **无状态 API 路径**：解析后的二维表 → Route Handler → 同一标准化内核 → JSON 结果。

Excel、PDF 和图片不需要先上传到服务端。这样可降低 Vercel Function 时长、内存和请求体限制对 MVP 的影响，也避免把客户原始 BOM 传给外部模型。

## 2. 数据分层

```text
SourceAsset
  └─ RawDocument
      └─ RawTable
          └─ RawCell
              └─ CanonicalBomLine + FieldEvidence
                  └─ ReviewPatch → Resolved View
```

- `SourceAsset` 保存文件名、MIME、SHA256、大小、格式和宏标志。
- `RawCell` 保存原值、显示值、公式、类型、格式、样式、批注、合并区域、隐藏状态、bbox 与 OCR 信息。
- `CanonicalBomLine` 保存标准值，同时每个映射字段都指向 `FieldEvidence`。
- 未映射列进入 `rawFields`，不会被丢弃。
- `ReviewPatch` 不修改机器结果，只在展示/导出 resolved view 时应用。

## 3. Adapter

| Adapter | 实现 | 关键行为 |
| --- | --- | --- |
| XLSX/XLSM/XLS/XLSB | SheetJS | Sheet、Cell、Formula、Style、Comment、Merge、Hidden；不执行宏/公式 |
| CSV/TSV | Papa Parse + TextDecoder | UTF-8、GB18030、Big5、Windows-1252，分隔符和 Quote |
| Text/Markdown/HTML | DOMParser + 规则 | Tab、Pipe、HTML Table、空格对齐、Key-value |
| PDF | PDF.js | 文本层、坐标、页码、bbox；无文本页进入 OCR |
| Image/OCR | Tesseract.js | 中英文 OCR、原始文本与置信度，不自动修正 MPN |

## 4. 标准化流水线

1. 扫描前 12 行并计算 Header Score。
2. 根据前一行文本密度识别多行表头并生成 Header Path。
3. 使用 Alias、包含匹配、值模式、Manufacturer 邻列上下文生成 Top-K 映射。
4. 先分类行，再解析字段；空行和重复表头不进入 Canonical Lines。
5. RefDes 支持范围与多单元逻辑器件，范围上限 500。
6. Qty 空白且 RefDes 明确时可推断，并标记 `inferred_from_refdes`。
7. Qty=0 不自动等于 DNP；DNP 必须有显式列或 Notes 信号。
8. Variant Qty 列输出 Base BOM + Variant Rules。
9. Level 使用栈建立父子关系；不同层级的 RefDes 不直接判重。
10. 生成冲突、质量分、审核项与下游事件。

## 5. 质量模型

整体质量使用加权几何平均，避免高分项掩盖关键低分：

- Table Detection
- Column Mapping
- Required Field Coverage
- Row Normalization
- Evidence Completeness

阻塞审核项包括 Qty/RefDes 不一致、重复位号、非法数量和多个高分表候选。

## 6. 生产扩展

推荐后续增加：

- Vercel Blob / Cloudflare R2：原文件与派生 Artifact。
- Neon / Vercel Postgres：Job、Result、Line Index、Review 与 Patch。
- Inngest / Trigger.dev / 独立队列：批处理、OCR 与重试。
- 隔离 Python Worker：OpenCV 透视校正、复杂 PDF Table Parser、企业 OCR。
- Company Profile：客户 Sheet 名、Alias、内部料号模式、Variant 与 DNP 风格。
- Event Outbox：审核通过后可靠发布 `bom.normalized.ready`。
