import type { CanonicalField } from "./types";

export const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  line_number: ["line", "line no", "item", "item no", "序号", "项次", "行号"],
  level: ["level", "lvl", "层级", "阶层", "bom level"],
  parent: ["parent", "parent item", "父项", "上级物料"],
  reference_designators: [
    "refdes",
    "reference designator",
    "reference",
    "designator",
    "ref",
    "refs",
    "位号",
    "器件位号",
    "元件位号",
  ],
  quantity: ["qty", "quantity", "q'ty", "usage", "用量", "数量", "单机用量", "每板用量"],
  unit: ["unit", "uom", "单位"],
  internal_part_number: [
    "internal part number",
    "internal pn",
    "material code",
    "material no",
    "part code",
    "物料编码",
    "内部料号",
    "物料号",
    "本厂料号",
  ],
  customer_part_number: ["customer pn", "customer part number", "客户料号", "客户物料编码"],
  manufacturer: ["manufacturer", "mfr", "maker", "brand", "厂商", "厂家", "品牌", "制造商"],
  manufacturer_part_number: [
    "mpn",
    "mfr part number",
    "manufacturer part no",
    "manufacturer part number",
    "mfr p/n",
    "model",
    "原厂料号",
    "厂家型号",
    "器件型号",
    "制造商料号",
    "型号",
  ],
  description: ["description", "desc", "specification", "规格描述", "描述", "品名", "规格", "器件描述"],
  value: ["value", "nominal", "参数值", "阻值", "容值"],
  tolerance: ["tolerance", "tol", "精度", "误差"],
  voltage_rating: ["voltage", "voltage rating", "额定电压", "耐压"],
  current_rating: ["current", "current rating", "额定电流", "电流"],
  power_rating: ["power", "power rating", "额定功率", "功率"],
  package: ["package", "case", "封装", "封装形式"],
  footprint: ["footprint", "land pattern", "pcb footprint", "焊盘", "封装库"],
  category: ["category", "type", "分类", "物料类型"],
  supplier: ["supplier", "vendor", "供应商", "供货商"],
  supplier_sku: ["supplier sku", "vendor part", "sku", "供应商料号", "商城编号"],
  alternate_part: ["alternate", "alternative", "substitute", "替代料", "备选型号"],
  dnp: [
    "dnp",
    "dni",
    "dnm",
    "not fitted",
    "not populated",
    "do not place",
    "不装",
    "不贴",
    "选配",
  ],
  variant: ["variant", "option", "版本", "机型", "配置"],
  notes: ["notes", "note", "remark", "remarks", "comment", "备注", "说明"],
  unit_price: ["unit price", "price", "cost", "单价", "含税单价"],
  currency: ["currency", "币种", "货币"],
  moq: ["moq", "minimum order", "最小起订量"],
  lead_time: ["lead time", "leadtime", "交期", "货期"],
};

export const REQUIRED_FIELDS: CanonicalField[] = [
  "quantity",
  "manufacturer_part_number",
  "internal_part_number",
  "description",
];

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\n\r]+/g, " ")
    .replace(/[._/\\()[\]{}:：#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
