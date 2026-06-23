import React, { useEffect, useState } from 'react';
import { FileCode, ChevronDown, ChevronRight, ListCollapse, BookOpen } from 'lucide-react';

interface FileItem {
  id: string;
  language: string;
  size: number;
}

interface SymbolItem {
  id: number;
  name: string;
  kind: string;
  line_start: number;
  line_end: number | null;
  signature: string | null;
}

interface SidebarProps {
  selectedFile: string;
  onSelectFile: (file: string) => void;
  onSelectLine: (line: number) => void;
  files: FileItem[];
  symbols: SymbolItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedFile,
  onSelectFile,
  onSelectLine,
  files,
  symbols,
}) => {
  const [activeTab, setActiveTab] = useState<'files' | 'outline'>('files');

  // Change tab to outline automatically when file changes
  useEffect(() => {
    if (selectedFile) {
      setActiveTab('outline');
    }
  }, [selectedFile]);

  return (
    <aside className="glass-panel" style={{
      width: '320px',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden'
    }}>
      {/* Tab Switcher */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-light)',
        background: 'rgba(0, 0, 0, 0.2)'
      }}>
        <button
          onClick={() => setActiveTab('files')}
          style={{
            flex: 1,
            padding: '12px',
            background: activeTab === 'files' ? 'transparent' : 'rgba(0,0,0,0.15)',
            border: 'none',
            borderBottom: activeTab === 'files' ? '2px solid var(--primary)' : 'none',
            color: activeTab === 'files' ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: activeTab === 'files' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease'
          }}
        >
          <BookOpen size={16} />
          Files
        </button>
        <button
          onClick={() => setActiveTab('outline')}
          disabled={!selectedFile}
          style={{
            flex: 1,
            padding: '12px',
            background: activeTab === 'outline' ? 'transparent' : 'rgba(0,0,0,0.15)',
            border: 'none',
            borderBottom: activeTab === 'outline' ? '2px solid var(--primary)' : 'none',
            color: !selectedFile 
              ? 'var(--text-muted)' 
              : activeTab === 'outline' ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: !selectedFile ? 'not-allowed' : 'pointer',
            fontSize: '0.85rem',
            fontWeight: activeTab === 'outline' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease'
          }}
        >
          <ListCollapse size={16} />
          Outline
        </button>
      </div>

      {/* Tab Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px'
      }}>
        {activeTab === 'files' ? (
          <div>
            <h3 style={{
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: '12px',
              letterSpacing: '0.5px'
            }}>
              Project Directory
            </h3>
            {files.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', marginTop: '20px' }}>
                No files indexed. Click "Index Codebase" to scan.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {files.map((file) => {
                  const isActive = file.id === selectedFile;
                  return (
                    <div
                      key={file.id}
                      onClick={() => onSelectFile(file.id)}
                      className={`tree-node ${isActive ? 'active' : ''}`}
                    >
                      <FileCode size={16} color={isActive ? '#a78bfa' : '#6b7280'} />
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }} title={file.id}>
                        {file.id}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>
                Outline of
              </span>
              <h4 style={{
                fontSize: '0.85rem',
                color: 'var(--text-primary)',
                wordBreak: 'break-all',
                fontFamily: 'var(--font-mono)'
              }}>
                {selectedFile.split('/').pop()}
              </h4>
            </div>

            {symbols.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', marginTop: '20px' }}>
                No symbols found in this file.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {symbols.map((sym) => (
                  <div
                    key={sym.id}
                    className="symbol-item"
                    onClick={() => onSelectLine(sym.line_start)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      marginLeft: 0
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      <span className={`symbol-kind ${sym.kind}`}>
                        {sym.kind.substring(0, 4)}
                      </span>
                      <span style={{
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }} title={sym.name}>
                        {sym.name}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      L{sym.line_start}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
