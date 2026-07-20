"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Image as ImageIcon, FileText, ScanText, UploadCloud } from "lucide-react";

interface UploadZoneProps {
  onFile: (file: File) => void;
  onPaste: (text: string) => void;
  onDemo: () => void;
  disabled?: boolean;
}

const FORMAT_ITEMS = [
  { icon: FileSpreadsheet, label: "Excel", detail: "XLSX · XLSM · XLS · XLSB" },
  { icon: FileText, label: "表格文本", detail: "CSV · TSV · Markdown · HTML" },
  { icon: ScanText, label: "PDF", detail: "原生表格 · 扫描件" },
  { icon: ImageIcon, label: "图片", detail: "截图 · 照片 · 扫描图" },
];

export function UploadZone({ onFile, onPaste, onDemo, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [text, setText] = useState("");

  const acceptFile = (file?: File) => {
    if (file && !disabled) onFile(file);
  };

  return (
    <section className="upload-stage">
      <div className="upload-heading">
        <span className="eyebrow">BOM INTAKE AGENT</span>
        <h1>把杂乱 BOM，变成可信数据</h1>
        <p>自动识别表格结构、映射字段并保留每个原始单元格与证据。</p>
      </div>

      <div
        className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          acceptFile(event.dataTransfer.files[0]);
        }}
      >
        <div className="upload-orbit">
          <UploadCloud size={28} strokeWidth={1.8} />
        </div>
        <h2>拖放 BOM 文件到这里</h2>
        <p>文件默认在浏览器本地解析，不上传至第三方模型</p>
        <div className="upload-actions">
          <button className="button primary" onClick={() => inputRef.current?.click()} disabled={disabled}>
            选择文件
          </button>
          <button className="button secondary" onClick={() => setShowPaste((value) => !value)} disabled={disabled}>
            粘贴表格
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".xlsx,.xlsm,.xls,.xlsb,.csv,.tsv,.txt,.md,.html,.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp"
          onChange={(event) => acceptFile(event.target.files?.[0])}
        />
        {showPaste && (
          <div className="paste-panel">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={'位号\t数量\t厂商\t型号\nR1-R4\t4\tYageo\tRC0402FR-0710KL'}
              autoFocus
            />
            <div className="paste-footer">
              <span>支持 Tab、Markdown、HTML 与空格对齐文本</span>
              <button className="button primary compact" onClick={() => text.trim() && onPaste(text)}>
                开始解析
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="format-grid">
        {FORMAT_ITEMS.map(({ icon: Icon, label, detail }) => (
          <div className="format-item" key={label}>
            <Icon size={18} />
            <div>
              <strong>{label}</strong>
              <span>{detail}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="demo-link" onClick={onDemo} disabled={disabled}>
        没有文件？使用含冲突与未知列的演示 BOM →
      </button>
    </section>
  );
}
