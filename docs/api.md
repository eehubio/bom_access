# API 与集成

## 健康检查

- `GET /health/live`
- `GET /health/ready`

## 能力发现

`GET /api/v1/bom-normalization/jobs` 返回 Agent 版本、运行模式和 API 输入类型。

## 创建无状态标准化任务

`POST /api/v1/bom-normalization/jobs`

请求体必须包含 `source.type=parsed_table` 与二维 `rows`。Route Handler 使用 Node.js Runtime，单次限制 100,000 行、500,000 单元格和 60 秒。

响应是 `NormalizationResult`，关键对象：

- `source`：Source Asset 摘要。
- `table`：不可变 Raw Table 与 Raw Cell。
- `columnMappings`：字段、置信度、Top-K 与规则。
- `lines`：Canonical BOM Lines。
- `rawFieldDictionary`：原始字段字典。
- `reviewItems`：阻塞、警告和信息审核项。
- `quality`：文档级质量评分。
- `event`：就绪或待审核事件摘要。

## 下游发布条件

仅当以下条件同时成立时，生产系统才应把事件升级为 `bom.normalized.ready`：

```text
review_status = approved
AND required_field_coverage >= configured_threshold
AND no blocking duplicate refdes
AND canonical schema valid
```

MVP 在有阻塞项时返回 `bom.normalization.review_required`，不会伪装成下游就绪。

## Patch

浏览器审核台导出的 JSON 采用：

```text
machine_record
+ approved_patches
= resolved_view
```

每个 Patch 保存目标、基础版本、JSON Pointer 风格路径、旧值、新值、原因和时间。服务端持久化时应增加用户、租户、Evidence IDs 与乐观锁版本。
