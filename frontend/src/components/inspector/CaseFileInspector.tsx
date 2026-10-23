import React, { useState } from 'react';
import { FileCode, Copy, Check } from 'lucide-react';

interface CaseFileInspectorProps {
  files: Record<string, string>;
}

export const CaseFileInspector: React.FC<CaseFileInspectorProps> = ({ files }) => {
  const fileKeys = Object.keys(files);
  const [selectedFile, setSelectedFile] = useState<string>(fileKeys[0] || 'system/controlDict');
  const [copied, setCopied] = useState<boolean>(false);

  const currentContent = files[selectedFile] || '// Select or generate case files to inspect';

  const handleCopy = () => {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full h-full flex flex-col bg-surface select-none">
      {/* File Tab Selector */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2 border-b border-line text-xs">
        <div className="flex items-center gap-1 overflow-x-auto">
          {fileKeys.map((f) => (
            <button
              key={f}
              onClick={() => setSelectedFile(f)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-[11px] transition-colors whitespace-nowrap ${
                selectedFile === f
                  ? 'bg-surface text-accent font-semibold border border-line'
                  : 'text-fg-2 hover:text-fg'
              }`}
            >
              <FileCode className="w-3 h-3 text-fg-4" />
              <span>{f}</span>
            </button>
          ))}
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-fg-2 hover:bg-line rounded text-[11px] font-medium transition-colors"
          title="Copy File Content"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Dictionary Code Viewer */}
      <div className="flex-1 p-4 overflow-y-auto bg-surface-2 text-fg-2 font-mono text-xs leading-relaxed select-text">
        <pre className="whitespace-pre-wrap">{currentContent}</pre>
      </div>
    </div>
  );
};
