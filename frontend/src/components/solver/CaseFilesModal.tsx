import React, { useMemo, useState } from 'react';
import { X, Folder, FileText, Copy, Check, Download, Loader2, FolderOpen } from 'lucide-react';
import { exportCaseZip } from '../../utils/api';

interface CaseFilesModalProps {
  open: boolean;
  onClose: () => void;
  caseFiles: Record<string, string>;
  projectId?: string;
  projectName?: string;
}

interface TreeNode {
  name: string;
  path: string; // full key, only set for files
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), isFile: false };
  for (const full of paths) {
    const parts = full.split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: isFile ? full : '', children: new Map(), isFile };
        node.children.set(part, child);
      }
      node = child;
    });
  }
  return root;
}

const Row: React.FC<{
  node: TreeNode;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
}> = ({ node, depth, selected, onSelect }) => {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: 8 + depth * 12 };
  const kids = [...node.children.values()].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1; // folders first
    return a.name.localeCompare(b.name);
  });

  if (node.isFile) {
    const active = selected === node.path;
    return (
      <button
        onClick={() => onSelect(node.path)}
        style={pad}
        className={`w-full text-left pr-2 py-1 flex items-center gap-1.5 text-[12px] font-mono rounded-sm ${
          active ? 'bg-[#2563EB] text-white' : 'text-[#3A4149] hover:bg-[#EEF1F5]'
        }`}
      >
        <FileText className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-white' : 'text-[#9AA3AF]'}`} />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      {node.name && (
        <button
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="w-full text-left pr-2 py-1 flex items-center gap-1.5 text-[12px] font-semibold text-[#69717D] hover:bg-[#EEF1F5] rounded-sm"
        >
          {open ? (
            <FolderOpen className="w-3.5 h-3.5 text-[#F59E0B]" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-[#F59E0B]" />
          )}
          <span className="truncate">{node.name}/</span>
        </button>
      )}
      {open &&
        kids.map((k) => (
          <Row
            key={k.name + (k.path || '')}
            node={k}
            depth={node.name ? depth + 1 : depth}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
};

export const CaseFilesModal: React.FC<CaseFilesModalProps> = ({
  open,
  onClose,
  caseFiles,
  projectId,
  projectName,
}) => {
  const keys = useMemo(() => Object.keys(caseFiles || {}).sort(), [caseFiles]);
  const tree = useMemo(() => buildTree(keys), [keys]);
  const [selected, setSelected] = useState<string>(keys[0] || '');
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Keep a valid selection as the file set changes / modal (re)opens.
  React.useEffect(() => {
    if (open && (!selected || !caseFiles[selected])) setSelected(keys[0] || '');
  }, [open, keys, selected, caseFiles]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const content = caseFiles[selected] ?? '';
  const slug = (projectName || 'openfoam-case')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked - ignore */
    }
  };

  const doExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await exportCaseZip(projectId, slug || 'openfoam-case', caseFiles);
    } catch (e: any) {
      setExportError(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B0D10]/50 backdrop-blur-[2px] p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-6xl h-[86vh] rounded-2xl bg-white border border-[#E4E7EC] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="OpenFOAM case files"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEFF3] bg-[#FAFBFC]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1E293B] text-white flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-[#171A1F]">OpenFOAM case</div>
              <div className="text-[11px] text-[#8A929E]">
                {keys.length} {keys.length === 1 ? 'file' : 'files'} · read-only
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={doExport}
              disabled={exporting || keys.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-lg px-3 py-1.5 hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Export as .zip
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[#69717D] hover:bg-[#EEF1F5]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {exportError && (
          <div className="px-5 py-2 text-[11px] text-red-700 bg-red-50 border-b border-red-100">
            {exportError}
          </div>
        )}

        {keys.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#8A929E]">
            No case files yet — run the solver setup first.
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* File tree */}
            <div className="w-64 shrink-0 border-r border-[#EDEFF3] overflow-y-auto py-2 bg-[#FCFCFD]">
              <Row node={tree} depth={0} selected={selected} onSelect={setSelected} />
            </div>

            {/* File content */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[#EDEFF3] bg-white">
                <span className="text-[12px] font-mono text-[#3A4149] truncate">{selected}</span>
                <button
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#69717D] hover:text-[#171A1F] border border-[#E1E4E8] rounded-md px-2 py-1"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-[#16A34A]" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="flex-1 min-h-0 overflow-auto m-0 p-4 text-[12px] leading-relaxed font-mono bg-[#0F172A] text-[#E2E8F0] select-text whitespace-pre">
                {content || '// empty file'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CaseFilesModal;
