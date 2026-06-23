import React, { useState } from 'react';
import { Search, RefreshCw, Layers } from 'lucide-react';

interface SearchHeaderProps {
  onSearch: (query: string, type: 'text' | 'symbol' | 'structural') => void;
  onIndexComplete: () => void;
}

export const SearchHeader: React.FC<SearchHeaderProps> = ({ onSearch, onIndexComplete }) => {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'text' | 'symbol' | 'structural'>('text');
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexMessage, setIndexMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query, searchType);
  };

  const handleIndexProject = async () => {
    setIsIndexing(true);
    setIndexMessage('Indexing...');
    try {
      const response = await fetch('http://localhost:3000/api/index', {
        method: 'POST',
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setIndexMessage('Indexing completed!');
        setTimeout(() => setIndexMessage(''), 3000);
        onIndexComplete();
      } else {
        setIndexMessage('Error: ' + (data.error || 'Failed'));
      }
    } catch (e: any) {
      setIndexMessage('Network error');
    } finally {
      setIsIndexing(false);
    }
  };

  return (
    <header className="glass-panel" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 24px',
      margin: '16px 16px 0 16px',
      gap: '24px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
          width: '40px',
          height: '40px',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 12px rgba(139, 92, 246, 0.4)'
        }}>
          <Layers size={22} color="#fff" />
        </div>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-title)',
            fontSize: '1.25rem',
            fontWeight: 700,
            background: 'linear-gradient(to right, #fff, #9ca3af)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '0.5px'
          }}>
            Code Intelligence
          </h1>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Universal Ctags + SCIP + ast-grep
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        flex: 1,
        maxWidth: '700px',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
          <input
            type="text"
            className="premium-input"
            placeholder={
              searchType === 'structural'
                ? 'ast-grep pattern (e.g. "function $A($$$)")'
                : 'Search terms or regex (e.g. loginUser)...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: '40px' }}
          />
          <Search size={18} color="var(--text-muted)" style={{
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none'
          }} />
        </div>

        <select
          value={searchType}
          onChange={(e) => setSearchType(e.target.value as any)}
          className="premium-input"
          style={{ width: '160px', cursor: 'pointer' }}
        >
          <option value="text">Text Search</option>
          <option value="symbol">Symbol Search</option>
          <option value="structural">Structural Search</option>
        </select>

        <button type="submit" className="premium-btn">
          Search
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {indexMessage && (
          <span style={{
            fontSize: '0.8rem',
            color: indexMessage.includes('Error') ? 'var(--danger)' : 'var(--success)',
            fontFamily: 'var(--font-mono)'
          }}>
            {indexMessage}
          </span>
        )}
        <button
          onClick={handleIndexProject}
          disabled={isIndexing}
          className="premium-btn secondary"
          style={{ gap: '8px', cursor: isIndexing ? 'not-allowed' : 'pointer' }}
        >
          <RefreshCw size={16} className={isIndexing ? 'spin-anim' : ''} style={{
            animation: isIndexing ? 'spin 1.5s linear infinite' : 'none'
          }} />
          {isIndexing ? 'Indexing...' : 'Index Codebase'}
        </button>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </header>
  );
};
