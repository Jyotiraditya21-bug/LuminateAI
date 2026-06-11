import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY is not defined in .env.local');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const DATA_DIR = path.join(process.cwd(), 'data');
const PAPERS_FILE = path.join(DATA_DIR, 'papers.json');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const CACHE_DIR = path.join(process.cwd(), '.cache');
const EMBEDDINGS_CACHE_FILE = path.join(CACHE_DIR, 'embeddings.json');
const SUMMARIES_CACHE_FILE = path.join(CACHE_DIR, 'summaries.json');

// Initialize caches
let embeddingsCache: Record<string, number[]> = {};
let summariesCache: Record<string, string> = {};

function initDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function initCache() {
  if (fs.existsSync(EMBEDDINGS_CACHE_FILE)) {
    try {
      embeddingsCache = JSON.parse(fs.readFileSync(EMBEDDINGS_CACHE_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Failed to parse embeddings cache, starting fresh');
    }
  }
  if (fs.existsSync(SUMMARIES_CACHE_FILE)) {
    try {
      summariesCache = JSON.parse(fs.readFileSync(SUMMARIES_CACHE_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Failed to parse summaries cache, starting fresh');
    }
  }
}

function saveCache() {
  fs.writeFileSync(EMBEDDINGS_CACHE_FILE, JSON.stringify(embeddingsCache, null, 2));
  fs.writeFileSync(SUMMARIES_CACHE_FILE, JSON.stringify(summariesCache, null, 2));
}

// Clean and format text
function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
}

// Simple XML/Atom Parser for arXiv
function parseArxivXml(xml: string) {
  const papers: any[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entryContent = match[1];

    const titleMatch = entryContent.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = entryContent.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = entryContent.match(/<published>([\s\S]*?)<\/published>/);
    const idMatch = entryContent.match(/<id>([\s\S]*?)<\/id>/);

    // Parse authors
    const authors: string[] = [];
    const authorRegex = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entryContent)) !== null) {
      authors.push(cleanText(authorMatch[1]));
    }
    // Fallback if formatting differs
    if (authors.length === 0) {
      const nameRegex = /<name>([^<]+)<\/name>/g;
      let nameMatch;
      while ((nameMatch = nameRegex.exec(entryContent)) !== null) {
        authors.push(cleanText(nameMatch[1]));
      }
    }

    const title = titleMatch ? cleanText(titleMatch[1]) : 'Unknown Title';
    const summary = summaryMatch ? cleanText(summaryMatch[1]) : 'No Abstract';
    const published = publishedMatch ? cleanText(publishedMatch[1]) : '';
    const idUrl = idMatch ? cleanText(idMatch[1]) : '';
    const arxivId = idUrl.split('/abs/').pop()?.split('v')[0] || '';

    papers.push({
      title,
      abstract: summary,
      authors,
      published,
      url: idUrl,
      arxivId
    });
  }

  return papers;
}

// Fetch arXiv papers
async function fetchArxivPapers(query: string, count: number): Promise<any[]> {
  if (fs.existsSync(PAPERS_FILE)) {
    console.log('Loading papers from cached papers.json...');
    return JSON.parse(fs.readFileSync(PAPERS_FILE, 'utf-8'));
  }

  console.log(`Fetching ${count} papers from arXiv matching: ${query}...`);
  // URL Encode query
  const encQuery = encodeURIComponent(query);
  const url = `http://export.arxiv.org/api/query?search_query=${encQuery}&start=0&max_results=${count}&sortBy=submittedDate&sortOrder=descending`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`arXiv API failed: ${response.statusText}`);
  }

  const xmlText = await response.text();
  const papers = parseArxivXml(xmlText);

  console.log(`Parsed ${papers.length} papers from arXiv.`);
  fs.writeFileSync(PAPERS_FILE, JSON.stringify(papers, null, 2));
  return papers;
}

// Get embeddings (cached & batched)
async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const results: number[][] = new Array(texts.length);
  const missingIndices: number[] = [];
  const missingTexts: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (embeddingsCache[text]) {
      results[i] = embeddingsCache[text];
    } else {
      missingIndices.push(i);
      missingTexts.push(text);
    }
  }

  if (missingTexts.length > 0) {
    console.log(`Fetching embeddings from OpenAI for ${missingTexts.length} missing items...`);
    // Batch in chunks of 20 to avoid size issues
    const chunkSize = 20;
    for (let i = 0; i < missingTexts.length; i += chunkSize) {
      const chunk = missingTexts.slice(i, i + chunkSize);
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunk,
      });

      for (let j = 0; j < response.data.length; j++) {
        const embedding = response.data[j].embedding;
        const textIdx = i + j;
        const originalIdx = missingIndices[textIdx];
        const text = missingTexts[textIdx];
        embeddingsCache[text] = embedding;
        results[originalIdx] = embedding;
      }
    }
    saveCache();
  }

  return results;
}

// Simple Custom KMeans Clustering Implementation
interface KMeansResult {
  assignments: number[];
  centroids: number[][];
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function meanVector(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += v[i];
    }
  }
  const count = vectors.length;
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    mean[i] /= count;
    norm += mean[i] * mean[i];
  }
  const len = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    mean[i] /= len || 1;
  }
  return mean;
}

function kMeans(embeddings: number[][], k: number, maxIterations = 30): KMeansResult {
  const n = embeddings.length;
  if (n < k) {
    throw new Error(`Cannot cluster ${n} papers into ${k} groups. Reduce K.`);
  }

  // Initialize centroids using K-means++ selection style
  const centroids: number[][] = [];
  centroids.push([...embeddings[Math.floor(Math.random() * n)]]);

  while (centroids.length < k) {
    const distances = embeddings.map(emb => {
      // Find min distance (1 - similarity) to existing centroids
      let maxSim = -Infinity;
      for (const cent of centroids) {
        const sim = dotProduct(emb, cent);
        if (sim > maxSim) maxSim = sim;
      }
      return 1 - maxSim;
    });

    // Weighted selection
    const sumDist = distances.reduce((sum, d) => sum + d, 0);
    let r = Math.random() * sumDist;
    let selectedIdx = n - 1;
    for (let i = 0; i < n; i++) {
      r -= distances[i];
      if (r <= 0) {
        selectedIdx = i;
        break;
      }
    }
    centroids.push([...embeddings[selectedIdx]]);
  }

  let assignments = new Array(n).fill(-1);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assignment Step
    for (let i = 0; i < n; i++) {
      let maxSim = -Infinity;
      let bestCluster = -1;
      for (let j = 0; j < k; j++) {
        const sim = dotProduct(embeddings[i], centroids[j]);
        if (sim > maxSim) {
          maxSim = sim;
          bestCluster = j;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed) {
      console.log(`KMeans converged at iteration ${iter + 1}`);
      break;
    }

    // Update Step
    const clusterMembers: number[][][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) {
      clusterMembers[assignments[i]].push(embeddings[i]);
    }

    for (let j = 0; j < k; j++) {
      if (clusterMembers[j].length > 0) {
        centroids[j] = meanVector(clusterMembers[j]);
      } else {
        // Reinitialize empty cluster
        centroids[j] = [...embeddings[Math.floor(Math.random() * n)]];
      }
    }
  }

  return { assignments, centroids };
}

// Generate cluster summaries
async function getSummary(clusterText: string, clusterId: number): Promise<string> {
  if (summariesCache[clusterText]) {
    return summariesCache[clusterText];
  }

  console.log(`Generating GPT summary for Cluster ${clusterId}...`);
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a professional research assistant summarizing AI/ML literature.'
      },
      {
        role: 'user',
        content: `Summarize the main themes, key techniques, and focus of this cluster of RAG papers in about 100 words. Keep it professional, synthesized, and clear. Avoid listing the papers individually. Instead, write a unified summary.\n\nPapers:\n${clusterText}\n\nSummary:`
      }
    ],
    max_tokens: 250,
    temperature: 0.3
  });

  const summary = response.choices[0].message.content?.trim() || '';
  summariesCache[clusterText] = summary;
  saveCache();
  return summary;
}

// Generate root summary
async function getRootSummary(summariesText: string): Promise<string> {
  const cacheKey = `ROOT:${summariesText}`;
  if (summariesCache[cacheKey]) {
    return summariesCache[cacheKey];
  }

  console.log('Generating top-level root summary...');
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a professional research assistant synthesizing AI/ML literature.'
      },
      {
        role: 'user',
        content: `Here are summaries of different clusters of RAG papers. Generate a single top-level summary (~150 words) that describes the entire field of Retrieval-Augmented Generation based on these cluster summaries. Keep it professional, synthesized, and clear.\n\nCluster Summaries:\n${summariesText}\n\nTop-level Summary:`
      }
    ],
    max_tokens: 300,
    temperature: 0.3
  });

  const summary = response.choices[0].message.content?.trim() || '';
  summariesCache[cacheKey] = summary;
  saveCache();
  return summary;
}

// Main Build Pipeline
async function main() {
  initDirectories();
  initCache();

  try {
    // 1. Fetch Papers
    const query = 'all:retrieval-augmented generation AND (cat:cs.CL OR cat:cs.AI)';
    const papers = await fetchArxivPapers(query, 35);
    if (papers.length === 0) {
      throw new Error('No papers fetched from arXiv');
    }

    console.log(`Ingested ${papers.length} papers.`);

    // 2. Generate Leaf Embeddings
    console.log('Embedding abstracts...');
    const abstracts = papers.map(p => p.abstract);
    const leafEmbeddings = await getEmbeddings(abstracts);

    // 3. Perform KMeans Clustering
    const k = 5;
    console.log(`Clustering papers into K=${k} groups...`);
    const { assignments, centroids } = kMeans(leafEmbeddings, k);

    // Group papers by cluster
    const clusters: Array<typeof papers> = Array.from({ length: k }, () => []);
    papers.forEach((paper, idx) => {
      clusters[assignments[idx]].push({ ...paper, idx });
    });

    // 4. Summarize Clusters
    console.log('Summarizing clusters...');
    const clusterSummaries: string[] = [];
    for (let c = 0; c < k; c++) {
      const members = clusters[c];
      console.log(`Cluster ${c} has ${members.length} papers.`);
      if (members.length === 0) {
        clusterSummaries.push('Empty cluster');
        continue;
      }
      const clusterText = members.map(m => `Title: ${m.title}\nAbstract: ${m.abstract}`).join('\n\n');
      const summary = await getSummary(clusterText, c);
      clusterSummaries.push(summary);
    }

    // 5. Summarize Root Level
    const allClusterSummariesText = clusterSummaries.map((s, idx) => `[Cluster ${idx}]: ${s}`).join('\n\n');
    const rootSummaryText = await getRootSummary(allClusterSummariesText);

    // 6. Embed Cluster Summaries and Root Summary
    console.log('Embedding cluster and root summaries...');
    const summaryEmbeddings = await getEmbeddings([...clusterSummaries, rootSummaryText]);
    const clusterEmbeddings = summaryEmbeddings.slice(0, k);
    const rootEmbedding = summaryEmbeddings[k];

    // 7. Compile Index File
    console.log('Assembling final RAPTOR index...');
    const nodes: any[] = [];

    // Leaf nodes
    papers.forEach((paper, idx) => {
      nodes.push({
        id: `leaf_${idx}`,
        level: 'leaf',
        text: `Title: ${paper.title}\nAbstract: ${paper.abstract}`,
        embedding: leafEmbeddings[idx],
        metadata: {
          title: paper.title,
          authors: paper.authors,
          published: paper.published,
          url: paper.url,
          arxivId: paper.arxivId
        }
      });
    });

    // Cluster nodes
    clusterSummaries.forEach((summary, idx) => {
      nodes.push({
        id: `cluster_${idx}`,
        level: 'cluster',
        text: `Cluster ${idx} Summary: ${summary}`,
        embedding: clusterEmbeddings[idx],
        metadata: {
          title: `Cluster ${idx} Summary`,
          papers: clusters[idx].map(p => `leaf_${p.idx}`)
        }
      });
    });

    // Root node
    nodes.push({
      id: 'root_0',
      level: 'root',
      text: `Root Summary: ${rootSummaryText}`,
      embedding: rootEmbedding,
      metadata: {
        title: 'Global RAG Architecture Summary'
      }
    });

    fs.writeFileSync(INDEX_FILE, JSON.stringify({ nodes }, null, 2));
    console.log(`Success! Index written to ${INDEX_FILE}. Total nodes: ${nodes.length}`);

  } catch (error) {
    console.error('Error during index building:', error);
    process.exit(1);
  }
}

main();
