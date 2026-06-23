import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { GitFork, HelpCircle } from 'lucide-react';

interface CallGraphProps {
  symbolName: string;
  graphText: string;
  onNodeClick: (symbol: string) => void;
}

// Initialize mermaid once outside
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis'
  }
});

export const CallGraph: React.FC<CallGraphProps> = ({
  symbolName,
  graphText,
  onNodeClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState('');
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    if (!graphText) {
      setSvgContent('');
      return;
    }

    setRenderError(false);
    const id = `mermaid-${Math.floor(Math.random() * 1000000)}`;

    // Clean up previous renderings before calling render
    mermaid.render(id, graphText)
      .then(({ svg }) => {
        setSvgContent(svg);
      })
      .catch((err) => {
        console.error('Mermaid render error:', err);
        // Clean up bad state
        setRenderError(true);
        // Force reset element
        const badEl = document.getElementById(id);
        if (badEl) badEl.remove();
      });
  }, [graphText]);

  // Bind click event listeners to SVG nodes once SVG is inserted
  useEffect(() => {
    if (!svgContent || !containerRef.current) return;

    const container = containerRef.current;
    
    // Find all node elements in the rendered SVG
    const nodes = container.querySelectorAll('.node');
    
    const clickHandlers: Array<{ node: Element; handler: () => void }> = [];

    nodes.forEach((node) => {
      // Style node to indicate it is clickable
      (node as HTMLElement).style.cursor = 'pointer';
      
      const handler = () => {
        // Extract node text
        const labelEl = node.querySelector('.label') || node.querySelector('text');
        const text = labelEl?.textContent?.trim() || '';
        if (text) {
          // Remove any markdown shapes/signs
          const cleanedText = text.replace(/["()]/g, '');
          onNodeClick(cleanedText);
        }
      };

      node.addEventListener('click', handler);
      clickHandlers.push({ node, handler });
    });

    // Cleanup listeners
    return () => {
      clickHandlers.forEach(({ node, handler }) => {
        node.removeEventListener('click', handler);
      });
    };
  }, [svgContent, onNodeClick]);

  return (
    <div className="glass-panel animate-fade-in" style={{
      width: '320px',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden'
    }}>
      {/* Title Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-light)',
        background: 'rgba(0, 0, 0, 0.15)',
        fontSize: '0.85rem'
      }}>
        <GitFork size={16} color="var(--primary)" />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          Call Graph Flow
        </span>
      </div>

      {/* Content Area */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(0, 0, 0, 0.1)'
      }}>
        {symbolName ? (
          renderError ? (
            <div style={{
              color: 'var(--danger)',
              fontSize: '0.85rem',
              textAlign: 'center'
            }}>
              Failed to render Mermaid graph.
            </div>
          ) : (
            <div 
              ref={containerRef}
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          )
        ) : (
          <div style={{
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}>
            <HelpCircle size={32} color="rgba(255,255,255,0.1)" />
            <div>No symbol selected.</div>
            <div style={{ fontSize: '0.75rem' }}>
              Click a function in the Sidebar Outline or double-click in code to view its call graph.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
