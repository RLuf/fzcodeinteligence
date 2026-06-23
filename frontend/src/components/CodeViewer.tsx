import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { FileCode, Search, ChevronRight } from 'lucide-react';

interface SearchResult {
  file: string;
  line: number;
  match: string;
  kind: string;
}

interface CodeViewerProps {
  filePath: string;
  content: string;
  lineNum: number;
  searchResults: SearchResult[];
  onSelectResult: (file: string, line: number) => void;
  onNavigate: (file: string, line: number) => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  filePath,
  content,
  lineNum,
  searchResults,
  onSelectResult,
  onNavigate,
}) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [activeLang, setActiveLang] = useState('typescript');

  // Detect language for Monaco
  useEffect(() => {
    if (!filePath) return;
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        setActiveLang('typescript');
        break;
      case 'js':
      case 'jsx':
        setActiveLang('javascript');
        break;
      case 'py':
        setActiveLang('python');
        break;
      case 'json':
        setActiveLang('json');
        break;
      default:
        setActiveLang('plaintext');
        break;
    }
  }, [filePath]);

  // Handle line scrolling
  useEffect(() => {
    if (editorRef.current && lineNum > 0) {
      setTimeout(() => {
        editorRef.current.revealLineInCenter(lineNum);
        editorRef.current.setPosition({ lineNumber: lineNum, column: 1 });
        editorRef.current.focus();
      }, 100);
    }
  }, [lineNum, content]);

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Set editor options
    editor.updateOptions({
      readOnly: true,
      minimap: { enabled: true },
      fontSize: 13,
      fontFamily: 'var(--font-mono)',
      cursorBlinking: 'smooth',
      renderLineHighlight: 'all',
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
    });

    // Register Hover Provider for JS/TS/Python
    const langs = ['typescript', 'javascript', 'python'];
    langs.forEach((lang) => {
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model, position) => {
          const word = model.getWordAtPosition(position);
          if (!word) return null;

          try {
            const currentFile = filePath;
            const response = await fetch(
              `http://localhost:3000/api/navigate/definition?file=${encodeURIComponent(
                currentFile
              )}&line=${position.lineNumber}&character=${position.column}`
            );
            
            if (!response.ok) return null;
            const data = await response.json();
            
            if (data.definition) {
              return {
                range: new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn
                ),
                contents: [
                  { value: `**Defined in:** \`${data.definition.file}\` (Line ${data.definition.line_start})` },
                  { value: '```' + lang + '\n' + data.definition.code_block + '\n```' },
                  { value: '*Ctrl+Click to navigate*' }
                ],
              };
            }
          } catch (e) {
            // Ignore
          }
          return null;
        },
      });

      // Register Definition Provider (handles Ctrl+Click navigation)
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model, position) => {
          try {
            const currentFile = filePath;
            const response = await fetch(
              `http://localhost:3000/api/navigate/definition?file=${encodeURIComponent(
                currentFile
              )}&line=${position.lineNumber}&character=${position.column}`
            );
            
            if (response.ok) {
              const data = await response.json();
              if (data.definition) {
                // Call React callback
                onNavigate(data.definition.file, data.definition.line_start);
                
                // Return a dummy location to tell Monaco we handled it
                return {
                  uri: model.uri,
                  range: new monaco.Range(position.lineNumber, 1, position.lineNumber, 1)
                };
              }
            }
          } catch (e) {
            // Ignore
          }
          return null;
        }
      });
    });
  };

  return (
    <div className="glass-panel animate-fade-in" style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden'
    }}>
      {/* File Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 18px',
        borderBottom: '1px solid var(--border-light)',
        background: 'rgba(0, 0, 0, 0.15)',
        fontFamily: 'var(--font-sans)',
        fontSize: '0.85rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileCode size={16} color="var(--primary)" />
          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
            {filePath || 'No File Selected'}
          </span>
          {filePath && (
            <span style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              background: 'rgba(255,255,255,0.05)',
              padding: '2px 6px',
              borderRadius: '4px',
              textTransform: 'uppercase'
            }}>
              {activeLang}
            </span>
          )}
        </div>
      </div>

      {/* Monaco Editor Container */}
      <div style={{ flex: 1, position: 'relative', background: '#0e1320' }}>
        {filePath ? (
          <Editor
            height="100%"
            language={activeLang}
            theme="vs-dark"
            value={content}
            loading={
              <div style={{
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%'
              }}>
                Loading Editor...
              </div>
            }
            onMount={handleEditorDidMount}
          />
        ) : (
          <div style={{
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            fontSize: '0.9rem',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <FileCode size={48} color="rgba(255,255,255,0.15)" />
            Select a file from the sidebar or search to view code.
          </div>
        )}
      </div>

      {/* Search Results Drawer */}
      {searchResults.length > 0 && (
        <div style={{
          height: '220px',
          borderTop: '1px solid var(--border-light)',
          background: 'rgba(10, 15, 30, 0.95)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border-light)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(0,0,0,0.2)'
          }}>
            <Search size={14} color="var(--primary)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Search Matches ({searchResults.length})
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {searchResults.map((res, index) => (
              <div
                key={index}
                onClick={() => onSelectResult(res.file, res.line)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background 0.2s ease',
                  borderBottom: '1px solid rgba(255,255,255,0.02)',
                  fontFamily: 'var(--font-sans)'
                }}
                className="tree-node"
              >
                <ChevronRight size={14} color="var(--text-muted)" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {res.file.split('/').pop()}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {res.file} : line {res.line}
                    </span>
                  </div>
                  <pre style={{
                    fontFamily: 'var(--font-mono)',
                    color: '#60a5fa',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    margin: '2px 0 0 0',
                    fontSize: '0.75rem',
                    overflowX: 'auto'
                  }}>
                    {res.match.trim()}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
