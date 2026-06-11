'use client';

import React, { useState, useRef, useEffect } from 'react';

interface Citation {
  title: string;
  arxivId?: string;
  url?: string;
  source: 'index' | 'live';
}

interface RetrievedNode {
  id: string;
  level: 'leaf' | 'cluster' | 'root';
  text: string;
  score: number;
  title: string;
}

interface Trace {
  retrievedNodes: RetrievedNode[];
  grade: {
    rating: 'CORRECT' | 'AMBIGUOUS' | 'INCORRECT';
    reason: string;
  };
  arxivFallback: {
    triggered: boolean;
    searchQuery?: string;
    fetchedPapers?: Array<{
      title: string;
      arxivId: string;
      url: string;
    }>;
  };
  finalContextUsed: string;
}

interface QABlock {
  id: string;
  query: string;
  answer: string;
  citations: Citation[];
  trace: Trace;
  isTraceOpen: boolean;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [blocks, setBlocks] = useState<QABlock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll disabled per user request
  // useEffect(() => {
  //   chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  // }, [blocks, isLoading]);

  // Parse markdown **bold** and apply custom live highlight (first occurrence only)
  const renderHighlightedText = (text: string) => {
    if (!text) return '';
    const parts = text.split(/\*\*([\s\S]*?)\*\*/g);
    const seen = new Set<string>();

    return parts.map((part, index) => {
      if (index % 2 === 1) {
        const normalized = part.trim().toLowerCase();
        if (seen.has(normalized)) {
          return <strong key={index}>{part}</strong>;
        }
        seen.add(normalized);
        return (
          <strong key={index} className="creamy-highlight">
            {part}
          </strong>
        );
      }
      return part;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    const currentQuery = query;
    setQuery('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: currentQuery }),
      });

      if (!response.ok) {
        throw new Error(await response.text() || 'Failed to get response');
      }

      const data = await response.json();

      const newBlock: QABlock = {
        id: `block_${Date.now()}`,
        query: currentQuery,
        answer: data.answer,
        citations: data.citations || [],
        trace: data.trace,
        isTraceOpen: true // open by default
      };

      setBlocks(prev => [...prev, newBlock]);
    } catch (err: any) {
      console.error(err);
      // Create a fallback error trace block
      const errorBlock: QABlock = {
        id: `block_${Date.now()}`,
        query: currentQuery,
        answer: `Error: ${err.message || 'Could not connect to server.'}`,
        citations: [],
        trace: {
          retrievedNodes: [],
          grade: { rating: 'INCORRECT', reason: 'Pipeline execution failed.' },
          arxivFallback: { triggered: false },
          finalContextUsed: ''
        },
        isTraceOpen: false
      };
      setBlocks(prev => [...prev, errorBlock]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTrace = (id: string) => {
    setBlocks(prev =>
      prev.map(b => (b.id === id ? { ...b, isTraceOpen: !b.isTraceOpen } : b))
    );
  };

  const getGradeText = (rating: string) => {
    if (rating === 'CORRECT') return 'answered from indexed papers';
    if (rating === 'AMBIGUOUS') return 'synthesized from index and live arXiv results';
    return 'answered from fresh live arXiv results';
  };

  return (
    <div className="app-container">
      {/* Header matching reference design with Luminate AI title */}
      <header style={{ marginBottom: '1rem' }}>
        <h1 className="app-header-title">Luminate AI</h1>
      </header>

      {/* Input Row section */}
      <section className="input-section">
        <form onSubmit={handleSubmit} className="chat-form">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="What are the latest approaches to multi-agent coordination?"
            className="chat-input"
            disabled={isLoading}
          />
          <button 
            type="submit" 
            className="chat-submit-btn"
            disabled={!query.trim() || isLoading}
          >
            {/* Magnifying Glass Search Icon */}
            <svg 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              style={{ marginRight: '2px' }}
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            Ask
          </button>
        </form>
      </section>

      {/* Suggestions Row for quick-test in case query is empty */}
      {blocks.length === 0 && !isLoading && (
        <>
          <div className="suggestions-row">
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Try:</span>
            <button 
              onClick={() => setQuery("Explain the core indexing approach of RAPTOR.")}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '18px', padding: '0.4rem 0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-card)'}
            >
              RAPTOR Indexing Approach
            </button>
            <button 
              onClick={() => setQuery("What is the CRAG fallback mechanism for out-of-index queries?")}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '18px', padding: '0.4rem 0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-card)'}
            >
              CRAG Fallback Mechanism
            </button>
            <button 
              onClick={() => setQuery("Who published the DeepSeek-V3 paper and what is its routing design?")}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '18px', padding: '0.4rem 0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-card)'}
            >
              DeepSeek-V3 Routing (arXiv Live)
            </button>
          </div>

          <div className="feature-grid">
            <div className="feature-card">
              <div className="feature-card-title">
                <span>✦</span> Hierarchical Indexing
              </div>
              <div className="feature-card-desc">
                Constructs a recursive tree of paper abstracts and cluster summaries (RAPTOR-style). Surfaces high-level summaries for theme-based queries to provide better contextual synthesis.
              </div>
            </div>
            <div className="feature-card">
              <div className="feature-card-title">
                <span>✦</span> Corrective RAG (CRAG)
              </div>
              <div className="feature-card-desc">
                Grades retrieved context relevance. If it is evaluated as insufficient or out-of-index, the assistant discards it and falls back to a live arXiv search to prevent hallucinations.
              </div>
            </div>
            <div className="feature-card">
              <div className="feature-card-title">
                <span>✦</span> Execution Trace Log
              </div>
              <div className="feature-card-desc">
                Reveals the internal execution path step-by-step. Inspect cosine similarities, CRAG grader evaluations, live arXiv query terms, and the compiled context passed to the LLM.
              </div>
            </div>
          </div>
        </>
      )}

      {/* QA Blocks Feed */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {blocks.map(block => (
          <div key={block.id} className="qa-block">
            {/* Query Title */}
            <div className="qa-query-title">
              Query: {block.query}
            </div>

            {/* 1. Answer Card */}
            <div className="answer-card">
              <div className="grade-row">
                <span className={`grade-badge ${block.trace.grade.rating.toLowerCase()}`}>
                  Grade: {block.trace.grade.rating.toLowerCase()}
                </span>
                <span>{getGradeText(block.trace.grade.rating)}</span>
              </div>

              <div className="answer-text">
                {renderHighlightedText(block.answer)}
              </div>

              {block.citations && block.citations.length > 0 && (
                <div className="sources-section">
                  <div className="sources-title">Sources</div>
                  <div className="sources-list">
                    {block.citations.map((cite, idx) => (
                      <a 
                        key={idx}
                        href={cite.url || '#'} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="source-item"
                      >
                        {/* Custom inline document icon */}
                        <svg 
                          width="13" 
                          height="13" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2.5" 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          className="source-icon"
                          style={{ marginRight: '2px' }}
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                        {cite.title} {cite.arxivId && `(arXiv:${cite.arxivId})`}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Trace Card */}
            <div className="trace-card">
              <div 
                className="trace-toggle-header" 
                onClick={() => toggleTrace(block.id)}
              >
                <span>{block.isTraceOpen ? '▼' : '▶'}</span>
                Trace: retrieval and grading steps
              </div>

              {block.isTraceOpen && (
                <div className="trace-content">
                  <div className="trace-nodes-list">
                    {block.trace.retrievedNodes.length === 0 ? (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No nodes retrieved.</div>
                    ) : (
                      block.trace.retrievedNodes.map((node, nodeIdx) => (
                        <div key={nodeIdx} className="trace-node-item">
                          <span className="node-badge">{node.level}</span>
                          <span className="node-text">
                            {node.level === 'root' && 'Top-level summary: '}
                            {node.level === 'cluster' && 'Cluster summary: '}
                            {node.title || node.text}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="trace-status-row">
                    {!block.trace.arxivFallback.triggered ? (
                      <>
                        {/* Checkmark SVG */}
                        <svg 
                          width="16" 
                          height="16" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="#485c3c" 
                          strokeWidth="3.5" 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          className="status-icon success"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Live arXiv fallback not triggered — retrieved context was sufficient</span>
                      </>
                    ) : (
                      <>
                        {/* Warning/Alert SVG */}
                        <svg 
                          width="16" 
                          height="16" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="var(--accent-red)" 
                          strokeWidth="2.5" 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          className="status-icon warning"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="8" x2="12" y2="12"></line>
                          <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <span>Live arXiv fallback triggered — queried arXiv for search term: "{block.trace.arxivFallback.searchQuery}"</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading placeholder */}
        {isLoading && (
          <div className="loading-box">
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </section>
    </div>
  );
}
