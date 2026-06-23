import React, { useEffect, useState, useCallback } from 'react';
import { SearchHeader } from './components/SearchHeader';
import { Sidebar } from './components/Sidebar';
import { CodeViewer } from './components/CodeViewer';
import { CallGraph } from './components/CallGraph';

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

interface SearchResult {
  file: string;
  line: number;
  match: string;
  kind: string;
}

const API_BASE = 'http://localhost:3000/api';

const App: React.FC = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [lineNum, setLineNum] = useState<number>(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  
  const [activeSymbol, setActiveSymbol] = useState<string>('');
  const [graphText, setGraphText] = useState<string>('');

  // Fetch all files from backend
  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
        
        // Auto-select first file if none is selected
        if (data.files && data.files.length > 0 && !selectedFile) {
          handleSelectFile(data.files[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch files list:', err);
    }
  }, [selectedFile]);

  // Load files list on mount
  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Select a file, fetch its content & outline symbols
  const handleSelectFile = async (filePath: string) => {
    setSelectedFile(filePath);
    setLineNum(0); // reset line scroll
    
    // Fetch file content
    try {
      const res = await fetch(`${API_BASE}/file/content?file=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        setFileContent(data.content || '');
      }
    } catch (err) {
      console.error('Failed to fetch file content:', err);
    }

    // Fetch symbols outline
    try {
      const res = await fetch(`${API_BASE}/file/symbols?file=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        const fileSymbols = data.symbols || [];
        setSymbols(fileSymbols);
        
        // If file contains symbols, load the first one's call graph by default
        if (fileSymbols.length > 0) {
          handleSelectSymbol(fileSymbols[0].name);
        } else {
          setActiveSymbol('');
          setGraphText('');
        }
      }
    } catch (err) {
      console.error('Failed to fetch symbols outline:', err);
    }
  };

  // Fetch call graph for a symbol
  const handleSelectSymbol = async (symbol: string) => {
    setActiveSymbol(symbol);
    try {
      const res = await fetch(`${API_BASE}/navigate/flow?symbol=${encodeURIComponent(symbol)}`);
      if (res.ok) {
        const data = await res.json();
        setGraphText(data.mermaid_graph || '');
      }
    } catch (err) {
      console.error('Failed to fetch call graph:', err);
    }
  };

  // Handle global searches
  const handleSearch = async (query: string, type: 'text' | 'symbol' | 'structural') => {
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  // User clicks on a search result item
  const handleSelectResult = async (filePath: string, line: number) => {
    if (selectedFile !== filePath) {
      await handleSelectFile(filePath);
    }
    
    // Small delay to let Editor render/position if file changed
    setTimeout(() => {
      setLineNum(line);
      
      // Look for a symbol defined on or near this line to update the Call Graph
      const matchSymbol = symbols.find(s => s.line_start === line || (s.line_start <= line && s.line_end !== null && s.line_end >= line));
      if (matchSymbol) {
        handleSelectSymbol(matchSymbol.name);
      }
    }, 150);
  };

  // Handle double-click or Ctrl+Click navigation inside Monaco
  const handleNavigate = async (filePath: string, line: number) => {
    await handleSelectResult(filePath, line);
  };

  // Handle clicking a node in the Call Graph
  const handleNodeClick = async (symbol: string) => {
    try {
      // Find where this symbol is defined in the database
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(symbol)}&type=symbol`);
      if (res.ok) {
        const data = await res.json();
        const results = data.results || [];
        // Find exact match
        const exact = results.find((r: any) => r.match.includes(` ${symbol}`) || r.match.includes(`${symbol}:`));
        if (exact) {
          handleSelectResult(exact.file, exact.line);
        } else if (results.length > 0) {
          handleSelectResult(results[0].file, results[0].line);
        }
      }
    } catch (err) {
      console.error('Failed to resolve symbol click from graph:', err);
    }
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      gap: '16px'
    }}>
      <SearchHeader onSearch={handleSearch} onIndexComplete={fetchFiles} />

      <main style={{
        flex: 1,
        display: 'flex',
        padding: '0 16px 16px 16px',
        gap: '16px',
        overflow: 'hidden'
      }}>
        <Sidebar
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
          onSelectLine={(line) => setLineNum(line)}
          files={files}
          symbols={symbols}
        />

        <CodeViewer
          filePath={selectedFile}
          content={fileContent}
          lineNum={lineNum}
          searchResults={searchResults}
          onSelectResult={handleSelectResult}
          onNavigate={handleNavigate}
        />

        <CallGraph
          symbolName={activeSymbol}
          graphText={graphText}
          onNodeClick={handleNodeClick}
        />
      </main>
    </div>
  );
};

export default App;
