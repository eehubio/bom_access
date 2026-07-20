"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileClock,
  FileSearch,
  FileSpreadsheet,
  History,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  PanelRightClose,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Tags,
  TriangleAlert,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeDocument } from "@/lib/bom/normalize";
import { parseFile, parseText } from "@/lib/bom/parsers";
import { applyReviewPatches } from "@/lib/bom/patches";
import { downloadArtifact, resultToCsv, resultToJson } from "@/lib/bom/export";
import type {
  CanonicalBomLine,
  NormalizationResult,
  ParseProgress,
  RawDocument,
  ReviewPatch,
} from "@/lib/bom/types";
import type { DigiKeyEnrichmentMatch, DigiKeyEnrichmentResponse } from "@/lib/digikey/types";
import { createId } from "@/lib/bom/utils";
import { listStoredBomTasks, saveStoredBomTask, type StoredBomTask } from "@/lib/bom/task-store";
import { UploadZone } from "./upload-zone";

const DEMO_BOM = `序号\t位号\t数量\t厂商\t型号\t描述\t封装\tDNP\t采购备注
10\tR1-R4, R8\t5\tYageo\tRC0402FR-0710KL\tRES 10K 1%\t0402\t\t优先国产
20\tC1-C3\t3\tMurata\tGRM155R71C104KA88\tCAP 100nF 16V\t0402\t\t
30\tU1A/U1B\t1\tTexas Instruments\tTPS62I60DSGR / TPS62160DSGR\tDC/DC Converter\tWSON-8\t\tOCR待确认
40\tD1\t0\tNexperia\tPESD5V0S1UL\tESD protection\tSOD-882\tDNP\tEU版本不装
50\tR8\t1\tYageo\tRC0402FR-071KL\tRES 1K 1%\t0402\t\t重复位号示例
60\t\t4\t\tSCR-M2X4\tM2 screw\t\t\t机械件无位号`;

type MainTab = "bom" | "mapping" | "evidence" | "reviews";
type WorkspaceSection = "bom" | "history" | "rules";
type AppStatus = "idle" | "processing" | "ready" | "error";
type HistoryTask = StoredBomTask;

function enrichmentKey(line: CanonicalBomLine): string {
  const reference = line.referenceDesignators.normalized[0] ?? "";
  const isPassive = /^(R|C)\d+/i.test(reference);
  const packageCode = line.engineering.package?.normalized?.match(/(?:_|^)(\d{4})(?:_|\s|$)/)?.[1] ?? "";
  const searchQuery = line.part.manufacturerPartNumber?.normalized
    ? ""
    : `${/^R/i.test(reference) ? "resistor" : "capacitor"} ${line.engineering.value?.normalized ?? ""} ${packageCode}`;
  return JSON.stringify({
    manufacturerPartNumber: line.part.manufacturerPartNumber?.normalized ?? "",
    searchQuery,
    footprint: line.engineering.footprint?.normalized ?? "",
    isPassive,
    quantity: line.quantity.perAssembly ?? "",
  });
}

const PIPELINE = [
  ["SECURITY_SCANNING", "安全扫描"],
  ["EXTRACTING_RAW_DOCUMENT", "原始数据提取"],
  ["DETECTING_TABLES", "表格与表头识别"],
  ["MAPPING_COLUMNS", "列语义映射"],
  ["NORMALIZING_LINES", "行项目标准化"],
  ["QUALITY_EVALUATING", "质量与冲突检查"],
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function qualityTone(score: number): string {
  if (score >= 0.9) return "good";
  if (score >= 0.75) return "warn";
  return "bad";
}

function confidenceLabel(score?: number): string {
  if (score === undefined) return "—";
  return `${Math.round(score * 100)}%`;
}

function enrichmentSourceLabel(enrichment?: DigiKeyEnrichmentMatch): string {
  if (!enrichment) return "";
  if (enrichment.source === "ezplm_parts_api") return "ezPLM 匹配";
  return enrichment.source === "mouser_search_v1" ? "Mouser 候选" : "DigiKey 候选";
}

function LoadingView({ progress }: { progress: ParseProgress }) {
  return (
    <div className="loading-view">
      <div className="loading-glyph">
        <LoaderCircle className="spin" size={34} />
        <Sparkles className="loading-spark" size={17} />
      </div>
      <span className="eyebrow">AGENT WORKING</span>
      <h2>正在理解这份 BOM</h2>
      <p>{progress.detail}</p>
      <div className="progress-track large">
        <i style={{ width: `${Math.max(6, progress.progress)}%` }} />
      </div>
      <div className="loading-stages">
        {PIPELINE.map(([key, label], index) => {
          const activeIndex = Math.min(
            PIPELINE.length - 1,
            Math.floor((progress.progress / 100) * PIPELINE.length),
          );
          return (
            <div className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""} key={key}>
              {index < activeIndex ? <Check size={14} /> : <CircleDot size={14} />}
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCards({ result }: { result: NormalizationResult }) {
  const cards = [
    { label: "标准行项目", value: result.summary.canonicalLines, meta: `${result.summary.componentLines} 个元器件`, icon: Table2 },
    { label: "字段映射", value: `${Math.round(result.quality.columnMappingScore * 100)}%`, meta: `${result.summary.unmappedColumns} 个未映射列`, icon: Tags },
    { label: "待审核", value: result.summary.reviewItems, meta: result.quality.reviewRequired ? "需要人工确认" : "全部自动通过", icon: AlertTriangle },
    { label: "整体质量", value: `${Math.round(result.quality.overallScore * 100)}%`, meta: "加权几何评分", icon: ShieldCheck },
  ];
  return (
    <div className="summary-grid">
      {cards.map(({ label, value, meta, icon: Icon }) => (
        <div className="summary-card" key={label}>
          <div className="summary-icon"><Icon size={18} /></div>
          <div>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{meta}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryView({ tasks, onOpen }: { tasks: HistoryTask[]; onOpen: (task: HistoryTask) => void }) {
  return <div className="empty-panel"><History size={30} /><h2>历史任务</h2>{tasks.length ? <div className="review-list">{tasks.map((task) => <article className="review-item info" key={task.taskId}><div className="review-severity"><FileClock size={17} /></div><div className="review-copy"><div><strong>{task.result.source.filename}</strong><span>{task.result.source.sourceType.toUpperCase()} · {task.result.summary.canonicalLines} 行</span></div><p>{new Date(task.createdAt).toLocaleString("zh-CN")}</p></div><button className="button ghost compact" onClick={() => onOpen(task)}>打开</button></article>)}</div> : <p>当前会话还没有处理过 BOM。上传并解析后的任务会显示在这里。</p>}</div>;
}

function RulesView({ onOpen }: { onOpen: () => void }) {
  return <div className="empty-panel"><Tags size={30} /><h2>字段规则</h2><p>系统会识别位号、数量、厂商、型号、Value、封装和 Footprint；未识别列会原样保存在 Raw Fields。</p><button className="button primary compact" onClick={onOpen}>返回 BOM 标准化</button></div>;
}

function BomTable({
  lines,
  selectedLineId,
  onSelect,
  enrichments,
  reviewedLineIds,
}: {
  lines: CanonicalBomLine[];
  selectedLineId?: string;
  onSelect: (line: CanonicalBomLine) => void;
  enrichments: Map<string, DigiKeyEnrichmentMatch[]>;
  reviewedLineIds: Set<string>;
}) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="line-col">#</th>
            <th>位号</th>
            <th className="qty-col">数量</th>
            <th>厂商</th>
            <th>制造商料号 / 内部料号</th>
            <th>描述</th>
            <th>封装</th>
            <th>单价 (USD)</th>
            <th>装配</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const enrichment = enrichments.get(line.lineId)?.[0];
            const rawUnitPrice = line.commercial.unitPrice?.normalized ?? enrichment?.unitPrice;
            const parsedUnitPrice = Number(rawUnitPrice);
            const unitPrice = Number.isFinite(parsedUnitPrice) ? parsedUnitPrice : null;
            const isReviewed = reviewedLineIds.has(line.lineId);
            const needsCandidateReview = Boolean(enrichment);
            return <tr
              key={line.lineId}
              className={`${selectedLineId === line.lineId ? "selected" : ""} ${line.lineType !== "component" ? "non-component" : ""}`}
              onClick={() => onSelect(line)}
            >
              <td className="line-col">{line.lineNumber || index + 1}</td>
              <td>
                <strong className="cell-primary">{line.referenceDesignators.normalized.join(", ") || "—"}</strong>
                {line.hierarchy.level > 0 && <span className="mini-tag">L{line.hierarchy.level}</span>}
              </td>
              <td className="qty-col">{line.quantity.perAssembly ?? "AR"}</td>
              <td>
                {line.part.manufacturer?.normalized || enrichment?.manufacturer || "—"}
                {enrichment?.manufacturer && <small className={enrichment.source === "ezplm_parts_api" ? "source-ezplm" : ""}>{enrichmentSourceLabel(enrichment)} {Math.round(enrichment.confidence * 100)}%</small>}
              </td>
              <td>
                <strong className="cell-primary mono">
                  {line.part.manufacturerPartNumber?.normalized || enrichment?.matchedManufacturerPartNumber || line.part.internalPartNumber?.normalized || "—"}
                </strong>
                {!line.part.manufacturerPartNumber?.normalized && enrichment?.matchedManufacturerPartNumber && (
                  <small className={enrichment.source === "ezplm_parts_api" ? "source-ezplm" : ""}>{enrichmentSourceLabel(enrichment)} · 待审核</small>
                )}
                {line.part.manufacturerPartNumber && line.part.internalPartNumber && (
                  <small>{line.part.internalPartNumber.normalized}</small>
                )}
              </td>
              <td className="description-cell">{line.engineering.description?.normalized || line.engineering.value?.normalized || line.lineType}</td>
              <td>
                {enrichment?.source === "ezplm_parts_api" && enrichment.package || line.engineering.package?.normalized || enrichment?.package || "—"}
                {enrichment?.source === "ezplm_parts_api" && enrichment.package && <small className="source-ezplm">ezPLM KiCad 封装</small>}
                {enrichment?.source !== "ezplm_parts_api" && !line.engineering.package?.normalized && enrichment?.package && <small>产品参数候选</small>}
              </td>
              <td>{unitPrice === null ? "—" : <><strong>${unitPrice.toFixed(4)}</strong><small>小计 ${(unitPrice * Number(line.quantity.perAssembly ?? 1)).toFixed(4)}</small></>}</td>
              <td>
                {line.assembly.dnp ? <span className="pill neutral">DNP</span> : <span className="pill active">装配</span>}
              </td>
              <td>
                {isReviewed ? (
                  <span className="status-dot approved"><CheckCircle2 size={14} />已审核</span>
                ) : !needsCandidateReview && line.reviewStatus === "auto_approved" ? (
                  <span className="status-dot approved"><CheckCircle2 size={14} />已通过</span>
                ) : (
                  <span className="status-dot review"><TriangleAlert size={14} />待审核</span>
                )}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function MappingTable({ result }: { result: NormalizationResult }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table mapping-table">
        <thead><tr><th>源列</th><th>原始表头</th><th>Header Path</th><th>标准字段</th><th>置信度</th><th>规则</th><th>样例</th></tr></thead>
        <tbody>
          {result.columnMappings.map((mapping) => (
            <tr key={mapping.sourceColumn}>
              <td><span className="column-chip">{mapping.sourceColumnLabel}</span></td>
              <td><strong>{mapping.headerRaw}</strong></td>
              <td>{mapping.headerPath}</td>
              <td>{mapping.targetField ? <span className="field-chip">{mapping.targetField}</span> : <span className="field-chip raw">raw_fields</span>}</td>
              <td><span className={`score ${qualityTone(mapping.confidence)}`}>{confidenceLabel(mapping.confidence)}</span></td>
              <td><code>{mapping.mappingRule}</code></td>
              <td className="sample-cell">{mapping.sampleValues.slice(0, 2).join(" · ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceView({ line }: { line?: CanonicalBomLine }) {
  if (!line) return <div className="empty-panel"><FileSearch size={28} /><p>选择一行查看字段证据</p></div>;
  return (
    <div className="evidence-grid">
      {Object.entries(line.evidence).map(([field, evidence]) => evidence && (
        <div className="evidence-card" key={field}>
          <div className="evidence-head"><span>{field}</span><strong>{confidenceLabel(line.confidence[field as keyof typeof line.confidence])}</strong></div>
          <code>{String(evidence.rawValue ?? "")}</code>
          <dl>
            <div><dt>来源</dt><dd>{evidence.sheet ? `${evidence.sheet}!${evidence.cellAddress}` : evidence.page ? `Page ${evidence.page} · ${evidence.cellAddress}` : evidence.cellAddress}</dd></div>
            <div><dt>表头</dt><dd>{evidence.headerPath}</dd></div>
            <div><dt>规则</dt><dd>{evidence.mappingRule}</dd></div>
          </dl>
        </div>
      ))}
      {Object.keys(line.rawFields).map((header) => (
        <div className="evidence-card raw-card" key={header}>
          <div className="evidence-head"><span>raw_fields/{header}</span><strong>保留</strong></div>
          <code>{line.rawFields[header].displayValue}</code>
          <p>未映射列原样保留，不参与自动标准化。</p>
        </div>
      ))}
    </div>
  );
}

function ReviewsView({
  result,
  resolvedIds,
  onResolve,
  onSelectLine,
}: {
  result: NormalizationResult;
  resolvedIds: Set<string>;
  onResolve: (id: string) => void;
  onSelectLine: (lineId?: string) => void;
}) {
  const open = result.reviewItems.filter((item) => !resolvedIds.has(item.reviewId));
  return (
    <div className="review-list">
      {open.length === 0 && <div className="empty-panel"><CheckCircle2 size={30} /><p>所有审核项已处理</p></div>}
      {open.map((item) => (
        <article className={`review-item ${item.severity}`} key={item.reviewId} onClick={() => onSelectLine(item.lineId)}>
          <div className="review-severity">{item.severity === "blocking" ? <TriangleAlert size={17} /> : item.severity === "warning" ? <AlertTriangle size={17} /> : <Info size={17} />}</div>
          <div className="review-copy"><div><strong>{item.title}</strong><span>{item.reasonCode}</span></div><p>{item.detail}</p></div>
          <button className="button ghost compact" onClick={(event) => { event.stopPropagation(); onResolve(item.reviewId); }}><Check size={14} />标记已审核</button>
        </article>
      ))}
    </div>
  );
}

function Inspector({
  line,
  patches,
  onPatch,
  enrichments,
  onMarkReviewed,
}: {
  line?: CanonicalBomLine;
  patches: ReviewPatch[];
  onPatch: (patch: ReviewPatch) => void;
  enrichments?: DigiKeyEnrichmentMatch[];
  onMarkReviewed: (lineId: string) => void;
}) {
  const primaryEnrichment = enrichments?.[0];
  const [mpn, setMpn] = useState(line?.part.manufacturerPartNumber?.normalized ?? primaryEnrichment?.matchedManufacturerPartNumber ?? "");
  const [manufacturer, setManufacturer] = useState(line?.part.manufacturer?.normalized ?? primaryEnrichment?.manufacturer ?? "");
  const [qty, setQty] = useState(line?.quantity.perAssembly ?? "");
  const [packageValue, setPackageValue] = useState(line?.engineering.package?.normalized ?? "");

  const createPatch = (path: string, oldValue: unknown, value: unknown, reasonCode: string) => {
    if (!line || oldValue === value) return;
    onPatch({
      patchId: createId("patch"),
      targetType: "bom_line",
      targetId: line.lineId,
      baseVersion: "machine-v1",
      operations: [{ op: "replace", path, oldValue, value }],
      reasonCode,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <aside className="inspector">
      <div className="inspector-title"><div><span>字段审核</span><strong>{line ? `源行 ${line.sourceRowNumber}` : "未选择行"}</strong></div><PanelRightClose size={17} /></div>
      {!line ? (
        <div className="inspector-empty"><WandSparkles size={28} /><p>选择任意 BOM 行，查看证据并创建非破坏性 Patch。</p></div>
      ) : (
        <>
          <div className="source-context">
            <span>机器结果</span>
            <strong>{line.referenceDesignators.normalized.join(", ") || line.lineType}</strong>
            <small>Machine record 保持不可变</small>
          </div>
          {enrichments?.length ? <div className="candidate-section"><h4><Sparkles size={15} />查询候选</h4>{enrichments.map((enrichment) => <div className="candidate-line" key={`${enrichment.source}-${enrichment.matchedManufacturerPartNumber}`}><div><strong>{enrichment.manufacturer ?? "未返回厂商"} · {enrichment.matchedManufacturerPartNumber}</strong><small>{enrichment.source === "ezplm_parts_api" ? "ezPLM" : enrichment.source === "mouser_search_v1" ? "Mouser" : "DigiKey"} · {enrichment.unitPrice === null ? "未提供报价" : `$${enrichment.unitPrice.toFixed(4)} / pcs`} · {Math.round(enrichment.confidence * 100)}%</small></div><button className="text-button" onClick={() => { createPatch("/part/manufacturerPartNumber/normalized", line.part.manufacturerPartNumber?.normalized ?? "", enrichment.matchedManufacturerPartNumber, "distributor_candidate_approved"); createPatch("/part/manufacturer/normalized", line.part.manufacturer?.normalized ?? "", enrichment.manufacturer ?? "", "distributor_candidate_approved"); if (enrichment.package) createPatch("/engineering/package/normalized", line.engineering.package?.normalized ?? "", enrichment.package, "distributor_package_approved"); if (enrichment.unitPrice !== null) createPatch("/commercial/unitPrice/normalized", line.commercial.unitPrice?.normalized ?? "", enrichment.unitPrice.toFixed(4), "distributor_price_approved"); }}>采用</button></div>)}</div> : null}
          <div className="edit-section">
            <label>厂商 <em>{confidenceLabel(line.confidence.manufacturer)}</em></label>
            <input value={manufacturer} placeholder="例如：YAGEO" onChange={(event) => setManufacturer(event.target.value)} />
            <button className="text-button" onClick={() => createPatch("/part/manufacturer/normalized", line.part.manufacturer?.normalized ?? "", manufacturer, "manual_manufacturer_review")}>保存为 Patch</button>
          </div>
          <div className="edit-section">
            <label>制造商料号 <em>{confidenceLabel(line.confidence.manufacturer_part_number)}</em></label>
            <input value={mpn} onChange={(event) => setMpn(event.target.value)} />
            <button className="text-button" onClick={() => createPatch("/part/manufacturerPartNumber/normalized", line.part.manufacturerPartNumber?.normalized ?? "", mpn, "manual_mpn_review")}>保存为 Patch</button>
            <small className="muted">保存后，点击顶部“自动补全”可查询该料号的分销商价格和封装。</small>
          </div>
          <div className="edit-row">
            <div className="edit-section"><label>数量 <em>{confidenceLabel(line.confidence.quantity)}</em></label><input value={qty} onChange={(event) => setQty(event.target.value)} /><button className="text-button" onClick={() => createPatch("/quantity/perAssembly", line.quantity.perAssembly, qty, "quantity_review")}>保存</button></div>
            <div className="edit-section"><label>封装 <em>{confidenceLabel(line.confidence.package)}</em></label><input value={packageValue} onChange={(event) => setPackageValue(event.target.value)} /><button className="text-button" onClick={() => createPatch("/engineering/package/normalized", line.engineering.package?.normalized ?? "", packageValue, "package_review")}>保存</button></div>
          </div>
          <div className="evidence-section"><h4><FileSearch size={15} />来源证据</h4>{Object.entries(line.evidence).slice(0, 5).map(([field, evidence]) => evidence && <div className="evidence-line" key={field}><span>{field}</span><strong>{evidence.sheet ? `${evidence.sheet}!${evidence.cellAddress}` : evidence.page ? `P${evidence.page}` : evidence.cellAddress}</strong></div>)}</div>
          <div className="issue-section"><h4><AlertTriangle size={15} />当前问题</h4>{line.issues.length ? line.issues.map((issue) => <span className="issue-chip" key={issue}>{issue}</span>) : <p className="muted">无阻塞问题</p>}</div>
          <button className="button primary compact" onClick={() => onMarkReviewed(line.lineId)}><CheckCircle2 size={14} />标记本行已审核</button>
          <div className="patch-section"><h4><History size={15} />Patch 历史</h4>{patches.filter((patch) => patch.targetId === line.lineId).map((patch) => <div className="patch-line" key={patch.patchId}><span>{patch.operations[0].path}</span><strong>{String(patch.operations[0].value)}</strong></div>)}{!patches.some((patch) => patch.targetId === line.lineId) && <p className="muted">尚无人工修改</p>}</div>
        </>
      )}
    </aside>
  );
}

export function BomWorkspace() {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [progress, setProgress] = useState<ParseProgress>({ stage: "RECEIVED", progress: 0, detail: "准备接收文件" });
  const [result, setResult] = useState<NormalizationResult>();
  const [historyTasks, setHistoryTasks] = useState<HistoryTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [activeTaskCreatedAt, setActiveTaskCreatedAt] = useState<string>();
  const [rawDocument, setRawDocument] = useState<RawDocument>();
  const [sourceFile, setSourceFile] = useState<Blob>();
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<MainTab>("bom");
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("bom");
  const [selectedLineId, setSelectedLineId] = useState<string>();
  const [patches, setPatches] = useState<ReviewPatch[]>([]);
  const [resolvedReviewIds, setResolvedReviewIds] = useState<Set<string>>(new Set());
  const [reviewedLineIds, setReviewedLineIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [enrichments, setEnrichments] = useState<Map<string, DigiKeyEnrichmentMatch[]>>(new Map());
  const [enrichmentKeys, setEnrichmentKeys] = useState<Map<string, string>>(new Map());
  const [enrichmentStatus, setEnrichmentStatus] = useState("");
  const [isEnriching, setIsEnriching] = useState(false);

  const resolvedLines = useMemo(
    () => (result ? applyReviewPatches(result.lines, patches) : []),
    [result, patches],
  );
  const filteredLines = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return resolvedLines;
    return resolvedLines.filter((line) => JSON.stringify(line).toLowerCase().includes(query));
  }, [resolvedLines, search]);
  const selectedLine = resolvedLines.find((line) => line.lineId === selectedLineId) ?? resolvedLines[0];
  const estimatedBomCost = resolvedLines.reduce((sum, line) => {
    const rawPrice = line.commercial.unitPrice?.normalized ?? enrichments.get(line.lineId)?.[0]?.unitPrice;
    const price = Number(rawPrice);
    return sum + (Number.isFinite(price) ? price : 0) * Number(line.quantity.perAssembly ?? 0);
  }, 0);

  useEffect(() => {
    void listStoredBomTasks().then((tasks) => {
      setHistoryTasks(tasks);
      setHistoryLoaded(true);
    }).catch(() => setHistoryLoaded(true));
  }, []);

  useEffect(() => {
    if (!historyLoaded || !activeTaskId || !result || !rawDocument || !sourceFile) return;
    const task: HistoryTask = {
      taskId: activeTaskId,
      createdAt: activeTaskCreatedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFile,
      rawDocument,
      result,
      patches,
      enrichments: Array.from(enrichments.entries()),
      enrichmentKeys: Array.from(enrichmentKeys.entries()),
      reviewedLineIds: Array.from(reviewedLineIds),
      resolvedReviewIds: Array.from(resolvedReviewIds),
    };
    setHistoryTasks((current) => [task, ...current.filter((item) => item.taskId !== task.taskId)]);
    void saveStoredBomTask(task);
  }, [activeTaskCreatedAt, activeTaskId, enrichments, enrichmentKeys, historyLoaded, patches, rawDocument, resolvedReviewIds, result, reviewedLineIds, sourceFile]);

  const runNormalization = async (loader: () => ReturnType<typeof parseText>, originalFile: Blob) => {
    setStatus("processing");
    setError("");
    setPatches([]);
    setResolvedReviewIds(new Set());
    setReviewedLineIds(new Set());
    setEnrichments(new Map());
    setEnrichmentKeys(new Map());
    setEnrichmentStatus("");
    try {
      const document = await loader();
      setProgress({ stage: "MAPPING_COLUMNS", progress: 78, detail: "正在识别表头与字段语义" });
      await new Promise((resolve) => setTimeout(resolve, 120));
      const normalized = normalizeDocument(document);
      setProgress({ stage: "QUALITY_EVALUATING", progress: 96, detail: "正在检查数量、位号和冲突" });
      setResult(normalized);
      setActiveTaskId(createId("task"));
      setActiveTaskCreatedAt(new Date().toISOString());
      setRawDocument(document);
      setSourceFile(originalFile);
      setSelectedLineId(normalized.lines[0]?.lineId);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "UNKNOWN_ERROR");
      setStatus("error");
    }
  };

  const handleFile = (file: File) => runNormalization(() => parseFile(file, setProgress), file);
  const handleText = (text: string) => runNormalization(() => parseText(text), new Blob([text], { type: "text/plain" }));
  const reset = () => {
    setStatus("idle");
    setResult(undefined);
    setPatches([]);
    setReviewedLineIds(new Set());
    setEnrichments(new Map());
    setEnrichmentKeys(new Map());
    setEnrichmentStatus("");
    setError("");
  };

  const enrichFromDistributors = async () => {
    const queryableLines = resolvedLines
      .filter((line) => line.lineType === "component" && (line.part.manufacturerPartNumber?.normalized || /^(R|C)\d+/i.test(line.referenceDesignators.normalized[0] ?? "")))
      .map((line) => {
        const reference = line.referenceDesignators.normalized[0] ?? "";
        return {
          line,
          key: enrichmentKey(line),
          request: {
            lineId: line.lineId,
            manufacturerPartNumber: line.part.manufacturerPartNumber?.normalized,
            searchQuery: line.part.manufacturerPartNumber?.normalized ? undefined : `${/^R/i.test(reference) ? "resistor" : "capacitor"} ${line.engineering.value?.normalized ?? ""} ${line.engineering.package?.normalized?.match(/(?:_|^)(\d{4})(?:_|\s|$)/)?.[1] ?? ""}`,
            footprint: line.engineering.footprint?.normalized ?? null,
            isPassive: /^(R|C)\d+/i.test(reference),
            requestedQuantity: Number(line.quantity.perAssembly ?? 1),
          },
        };
      });
    if (!queryableLines.length) {
      setEnrichmentStatus("没有可查询的制造商料号；请先补充型号后再查询。");
      return;
    }
    const changedLines = queryableLines.filter(({ line, key }) => enrichmentKeys.get(line.lineId) !== key);
    if (!changedLines.length) {
      setEnrichmentStatus("没有检测到料号、封装、数量或无源参数变化；无需重复查询。");
      return;
    }
    const lines = changedLines.map(({ request }) => request);
    setIsEnriching(true);
    setEnrichmentStatus("");
    try {
      const batches = Array.from({ length: Math.ceil(lines.length / 25) }, (_, index) => lines.slice(index * 25, (index + 1) * 25));
      const payloads: DigiKeyEnrichmentResponse[] = [];
      for (const batch of batches) {
        const response = await fetch("/api/v1/bom-normalization/enrich/digikey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: batch }),
        });
        const payload = await response.json() as DigiKeyEnrichmentResponse & { error?: string };
        if (!response.ok) throw new Error(payload.message ?? payload.error ?? "DISTRIBUTOR_ENRICHMENT_FAILED");
        payloads.push(payload);
      }
      if (payloads.some((payload) => !payload.configured)) {
        setEnrichmentStatus(payloads.find((payload) => !payload.configured)?.message ?? "分销商 API 尚未配置。");
        return;
      }
      const matches = payloads.flatMap((payload) => payload.matches);
      const grouped = new Map<string, DigiKeyEnrichmentMatch[]>();
      matches.forEach((match) => grouped.set(match.lineId, [...(grouped.get(match.lineId) ?? []), match]));
      setEnrichments((current) => {
        const next = new Map(current);
        changedLines.forEach(({ line }) => next.set(line.lineId, grouped.get(line.lineId) ?? []));
        return next;
      });
      setEnrichmentKeys((current) => {
        const next = new Map(current);
        changedLines.forEach(({ line, key }) => next.set(line.lineId, key));
        return next;
      });
      setEnrichmentStatus(`分销商已返回 ${matches.length} 个候选（本次仅查询 ${lines.length} 个已修改行，分 ${batches.length} 批）；结果为外部候选，不会覆盖原始字段。`);
    } catch (caught) {
      setEnrichmentStatus(caught instanceof Error ? `分销商查询失败：${caught.message}` : "分销商查询失败，请稍后重试。");
    } finally {
      setIsEnriching(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Layers3 size={20} /></div><div><strong>ezPLM</strong><span>BOM Normalize</span></div></div>
        <div className="topbar-center"><span className="topbar-title">BOM 接入与标准化</span></div>
        <div className="topbar-actions"><span className="privacy-badge" title="Excel、CSV、PDF 和图片默认在浏览器中解析；只有型号、封装和数量会在点击自动补全后发送到查询接口。"><LockKeyhole size={13} />本地优先解析</span>{status === "ready" && <button className="button secondary compact" onClick={reset}><Upload size={14} />新建任务</button>}</div>
      </header>
      <div className="body-shell">
        <nav className="sidebar">
          <div className="nav-label">工作区</div>
          <button className={`nav-item ${activeSection === "bom" ? "active" : ""}`} onClick={() => setActiveSection("bom")}><FileSpreadsheet size={17} />BOM 标准化<span className="nav-count">1</span></button>
          <button className={`nav-item ${activeSection === "history" ? "active" : ""}`} onClick={() => setActiveSection("history")}><FileClock size={17} />历史任务</button>
          <button className={`nav-item ${activeSection === "rules" ? "active" : ""}`} onClick={() => setActiveSection("rules")}><Tags size={17} />字段规则</button>
          <div className="nav-label pipeline-label">处理流水线</div>
          <div className="pipeline-list">
            {PIPELINE.map(([key, label], index) => {
              const activeIndex = status === "ready" ? PIPELINE.length : Math.floor((progress.progress / 100) * PIPELINE.length);
              return <div className={index < activeIndex ? "done" : index === activeIndex && status === "processing" ? "active" : ""} key={key}><span>{index < activeIndex ? <Check size={11} /> : index + 1}</span>{label}</div>;
            })}
          </div>
          <div className="sidebar-spacer" />
          <div className="security-note"><ShieldCheck size={18} /><div><strong>隐私保护</strong><span>文件默认不离开浏览器</span></div></div>
          <div className="version-note">Schema v1.0.0 · Agent v1.0.0</div>
        </nav>

        <main className={`workspace ${status === "ready" ? "has-inspector" : ""}`}>
          {activeSection === "history" ? <HistoryView tasks={historyTasks} onOpen={(task) => { setResult(task.result); setActiveTaskId(task.taskId); setActiveTaskCreatedAt(task.createdAt); setRawDocument(task.rawDocument); setSourceFile(task.sourceFile); setSelectedLineId(task.result.lines[0]?.lineId); setPatches(task.patches); setResolvedReviewIds(new Set(task.resolvedReviewIds)); setReviewedLineIds(new Set(task.reviewedLineIds)); setEnrichments(new Map(task.enrichments)); setEnrichmentKeys(new Map(task.enrichmentKeys)); setEnrichmentStatus("已加载已保存的原始 BOM、标准化结果和补全候选。"); setStatus("ready"); setActiveSection("bom"); }} /> : activeSection === "rules" ? <RulesView onOpen={() => setActiveSection("bom")} /> : <>
          {status === "idle" && <UploadZone onFile={handleFile} onPaste={handleText} onDemo={() => handleText(DEMO_BOM)} />}
          {status === "processing" && <LoadingView progress={progress} />}
          {status === "error" && <div className="error-view"><TriangleAlert size={34} /><h2>无法处理这份文件</h2><code>{error}</code><p>请检查格式、文件大小或是否已加密，然后重试。</p><button className="button primary" onClick={reset}><RefreshCw size={15} />重新开始</button></div>}
          {status === "ready" && result && (
            <div className="result-workspace">
              <div className="result-header">
                <div><div className="breadcrumb">BOM 标准化 <span>/</span> {result.source.filename}</div><h1>{result.source.filename}</h1><p><span>{result.source.sourceType.toUpperCase()}</span> · {formatBytes(result.source.size)} · SHA256 {result.source.sha256.slice(0, 10)}…</p></div>
                <div className="result-actions"><strong className="cost-total">BOM 估算 ${estimatedBomCost.toFixed(2)}</strong><div className="search-box"><Search size={15} /><input placeholder="搜索位号、型号、描述…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="button secondary compact" disabled={isEnriching} onClick={enrichFromDistributors}><Sparkles size={14} />{isEnriching ? "自动补全中" : "自动补全"}</button><div className="export-menu"><button className="button primary compact" onClick={() => setShowExport((value) => !value)}><ArrowDownToLine size={14} />导出<ChevronDown size={13} /></button>{showExport && <div className="export-popover"><button onClick={() => downloadArtifact("canonical-bom.json", resultToJson(result, patches), "application/json")}>Canonical JSON<span>含 Raw + Evidence + Patch</span></button><button onClick={() => downloadArtifact("canonical-bom.csv", resultToCsv({ ...result, lines: resolvedLines }), "text/csv;charset=utf-8")}>安全 CSV<span>已防止公式注入</span></button></div>}</div></div>
              </div>
              {enrichmentStatus && <div className="enrichment-notice"><Sparkles size={15} />{enrichmentStatus}</div>}
              <div className={`quality-banner ${result.quality.reviewRequired ? "review" : "approved"}`}><div>{result.quality.reviewRequired ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}<span>{result.quality.reviewRequired ? "已完成标准化，存在需要确认的项目" : "已通过全部自动审核条件"}</span></div><strong>整体质量 {Math.round(result.quality.overallScore * 100)}%</strong></div>
              <SummaryCards result={result} />
              <div className="content-card">
                <div className="tabs">
                  {([ ["bom", "标准 BOM", result.summary.canonicalLines], ["mapping", "列映射", result.columnMappings.length], ["evidence", "原始证据", Object.keys(selectedLine?.evidence ?? {}).length], ["reviews", "审核任务", result.summary.reviewItems - resolvedReviewIds.size] ] as Array<[MainTab, string, number]>).map(([key, label, count]) => <button className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)} key={key}>{label}<span>{Math.max(0, count)}</span></button>)}
                  <div className="tab-meta"><CircleDot size={13} />源表：{result.table.name} · Header {result.headerRows.map((row) => row + 1).join(", ")}</div>
                </div>
                {activeTab === "bom" && <BomTable lines={filteredLines} selectedLineId={selectedLine?.lineId} onSelect={(line) => setSelectedLineId(line.lineId)} enrichments={enrichments} reviewedLineIds={reviewedLineIds} />}
                {activeTab === "mapping" && <MappingTable result={result} />}
                {activeTab === "evidence" && <EvidenceView line={selectedLine} />}
                {activeTab === "reviews" && <ReviewsView result={result} resolvedIds={resolvedReviewIds} onResolve={(id) => setResolvedReviewIds((current) => new Set([...current, id]))} onSelectLine={(lineId) => { if (lineId) setSelectedLineId(lineId); }} />}
              </div>
            </div>
          )}</>}
        </main>
        {status === "ready" && activeSection === "bom" && <Inspector key={selectedLine?.lineId ?? "empty"} line={selectedLine} patches={patches} onPatch={(patch) => setPatches((current) => [...current, patch])} enrichments={selectedLine ? enrichments.get(selectedLine.lineId) : undefined} onMarkReviewed={(lineId) => setReviewedLineIds((current) => new Set([...current, lineId]))} />}
      </div>
    </div>
  );
}
