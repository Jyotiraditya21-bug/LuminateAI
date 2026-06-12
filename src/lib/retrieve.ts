export interface IndexNode {
  id: string;
  level: 'leaf' | 'cluster' | 'root';
  text: string;
  embedding: number[];
  metadata?: {
    title: string;
    authors?: string[];
    published?: string;
    url?: string;
    arxivId?: string;
    papers?: string[];
  };
}

let cachedIndex: { nodes: IndexNode[] } | null = null;

export function loadIndex(): { nodes: IndexNode[] } {
  if (cachedIndex) return cachedIndex;
  if (typeof window !== 'undefined') {
    throw new Error('loadIndex is server-only. In browser, fetch the index file instead.');
  }
  const req = eval('require');
  const fs = req('fs');
  const path = req('path');
  const filePath = path.join(process.cwd(), 'data', 'index.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Index file not found at ${filePath}. Make sure to run the build-index script first.`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  cachedIndex = data;
  return data;
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function retrieveNodes(queryEmbedding: number[], k = 5, nodes?: IndexNode[]): Array<{ node: IndexNode; score: number }> {
  const targetNodes = nodes || loadIndex().nodes;
  const scored = targetNodes.map(node => {
    const score = dotProduct(queryEmbedding, node.embedding);
    return { node, score };
  });
  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
