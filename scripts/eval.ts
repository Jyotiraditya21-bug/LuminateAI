import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { loadIndex, IndexNode } from '../src/lib/retrieve';
import { gradeContext, fetchLiveArxiv, ArxivPaper } from '../src/lib/grade';
import { generateAnswer, Citation } from '../src/lib/generate';

dotenv.config({ path: '.env.local' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY is not defined in .env.local');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const EVAL_RESULTS_FILE = path.join(process.cwd(), 'data', 'eval-results.json');

// Define 10 evaluation questions
interface EvalQuestion {
  id: string;
  category: 'A' | 'B';
  query: string;
  description: string;
}

const QUESTIONS: EvalQuestion[] = [
  // Category A: Answerable from indexed papers (RAG, Dialogue context, token routing, agentic RL, SPEC-DEC, composition)
  {
    id: 'Q1',
    category: 'A',
    query: 'Explain the core concept and benefits of RACES (Recursive Automated Composition for Environment Scaling) as proposed in the text.',
    description: 'Relates to the RACES environment composition paper'
  },
  {
    id: 'Q2',
    category: 'A',
    query: 'What are the main limitations of Doc-to-LoRA, and how does Doc-to-Atom (Doc2Atom) address them?',
    description: 'Relates to the Doc2Atom memory compression paper'
  },
  {
    id: 'Q3',
    category: 'A',
    query: 'Explain the mechanism of Agentic Procedural Policy Optimization (APPO) for reinforcement learning.',
    description: 'Relates to the APPO credit assignment paper'
  },
  {
    id: 'Q4',
    category: 'A',
    query: 'How does Context-Driven Incremental Compression (C-DIC) handle multi-turn dialogue context without information loss?',
    description: 'Relates to the C-DIC incremental context compression paper'
  },
  {
    id: 'Q5',
    category: 'A',
    query: 'What is the core proposal of Reroute for Vision-Language Models visual token reduction?',
    description: 'Relates to the visual token routing paper'
  },
  {
    id: 'Q6',
    category: 'A',
    query: 'How does VIA-SD improve speculative decoding efficiency over traditional draft-verify methods?',
    description: 'Relates to the spec-dec routing paper'
  },
  // Category B: Answerable only with fresh info (not in index / recent developments)
  {
    id: 'Q7',
    category: 'B',
    query: 'What is the mixture of experts (MoE) architecture and routing design of DeepSeek-V3?',
    description: 'Recent DeepSeek model details'
  },
  {
    id: 'Q8',
    category: 'B',
    query: 'What are the key technical details and inference-time search mechanism of OpenAI\'s o1 reasoning model series?',
    description: 'OpenAI o1 reasoning model'
  },
  {
    id: 'Q9',
    category: 'B',
    query: 'How does Gemini 1.5 Pro achieve its 1-million-token context window technically?',
    description: 'Gemini 1.5 Pro token scaling'
  },
  {
    id: 'Q10',
    category: 'B',
    query: 'Describe the design of the Swarm multi-agent orchestration framework open-sourced by OpenAI.',
    description: 'OpenAI Swarm agent framework'
  }
];

// Flat baseline retrieval (Leaf nodes only)
function baselineRetrieve(queryEmbedding: number[], k = 5): IndexNode[] {
  const { nodes } = loadIndex();
  const leafNodes = nodes.filter(n => n.level === 'leaf');
  
  const scored = leafNodes.map(node => {
    let sum = 0;
    for (let i = 0; i < queryEmbedding.length; i++) {
      sum += queryEmbedding[i] * node.embedding[i];
    }
    return { node, score: sum };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(s => s.node);
}

// Run baseline RAG pipeline
async function runBaseline(query: string, queryEmbedding: number[]): Promise<{ answer: string; citations: Citation[] }> {
  const retrievedLeaves = baselineRetrieve(queryEmbedding, 5);
  
  const citations: Citation[] = retrievedLeaves.map(node => ({
    title: node.metadata?.title || 'Index Paper',
    arxivId: node.metadata?.arxivId,
    url: node.metadata?.url,
    source: 'index'
  }));

  const contextText = retrievedLeaves.map(node => `[Paper: ${node.metadata?.title}]\nAbstract: ${node.text}`).join('\n\n');
  const result = await generateAnswer(openai, query, contextText, citations);
  return result;
}

// Run RAPTOR + CRAG pipeline
async function runRaptorCrag(query: string, queryEmbedding: number[]): Promise<{
  answer: string;
  citations: Citation[];
  gradeRating: string;
  fallbackTriggered: boolean;
}> {
  // 1. Retrieve top-5 nodes across ALL levels (leaves, clusters, root)
  const { nodes } = loadIndex();
  const scored = nodes.map(node => {
    let sum = 0;
    for (let i = 0; i < queryEmbedding.length; i++) {
      sum += queryEmbedding[i] * node.embedding[i];
    }
    return { node, score: sum };
  });
  scored.sort((a, b) => b.score - a.score);
  const retrievedNodes = scored.slice(0, 5).map(s => s.node);

  // 2. Grade
  const grade = await gradeContext(openai, query, retrievedNodes);

  // 3. Fallback logic
  let finalNodes: IndexNode[] = [];
  let livePapers: ArxivPaper[] = [];
  let fallbackTriggered = false;

  if (grade.rating === 'CORRECT') {
    finalNodes = retrievedNodes;
  } else if (grade.rating === 'INCORRECT') {
    fallbackTriggered = true;
    const fallback = await fetchLiveArxiv(openai, query);
    livePapers = fallback.papers;
  } else { // AMBIGUOUS
    fallbackTriggered = true;
    finalNodes = retrievedNodes;
    const fallback = await fetchLiveArxiv(openai, query);
    livePapers = fallback.papers;
  }

  // 4. Context compilation
  const citations: Citation[] = [];
  const contextTextParts: string[] = [];

  finalNodes.forEach(node => {
    contextTextParts.push(`[Index Source: ${node.id} (${node.level})]\n${node.text}`);
    if (node.metadata) {
      citations.push({
        title: node.metadata.title || `Summary Node (${node.level})`,
        arxivId: node.metadata.arxivId,
        url: node.metadata.url,
        source: 'index'
      });
    }
  });

  livePapers.forEach((paper, idx) => {
    contextTextParts.push(`[Live arXiv Source ${idx + 1}]\nTitle: ${paper.title}\nAbstract: ${paper.abstract}`);
    citations.push({
      title: paper.title,
      arxivId: paper.arxivId,
      url: paper.url,
      source: 'live'
    });
  });

  const contextText = contextTextParts.join('\n\n');
  const generation = await generateAnswer(openai, query, contextText, citations);

  return {
    answer: generation.answer,
    citations: generation.citations,
    gradeRating: grade.rating,
    fallbackTriggered
  };
}

// LLM-as-a-judge scoring
async function judgeAnswer(
  query: string,
  answer: string,
  pipelineType: 'Baseline' | 'RAPTOR+CRAG',
  category: 'A' | 'B',
  retrievedCitations: Citation[]
): Promise<{ correctness: number; citationQuality: number; fallbackScore: number | 'N/A'; reason: string }> {
  const citationsText = retrievedCitations.length > 0 
    ? retrievedCitations.map((c, i) => `${i + 1}. Title: "${c.title}"${c.arxivId ? `, arXiv: ${c.arxivId}` : ''} (Source: ${c.source})`).join('\n')
    : '(No sources retrieved)';

  const prompt = `You are an impartial evaluator grading answers from a RAG-based AI research assistant.
You are given:
1. User Query: "${query}"
2. System Answer: "${answer}"
3. Evaluated Pipeline: "${pipelineType}"
4. Query Category: "${category}" (Category A queries are in-index, Category B queries are out-of-index)
5. Retrieved Sources:
${citationsText}

Rate the answer on three metrics:
1. Correctness: Rate from 1 to 5 (1 = completely incorrect/hallucinated, 5 = fully correct and comprehensive).
2. Citation Quality: Rate as 1 if the answer uses and references the relevant titles from the "Retrieved Sources" list (formatted inline as [Title] or similar), and 0 if the citations in the answer are fabricated (not in the Retrieved Sources list), irrelevant, or missing entirely.
3. Corrective Fallback: (Only relevant for Category B) Rate as 1 if the system successfully retrieved fresh details from the live search (as shown in the "Retrieved Sources" with Source: live) and correctly integrated them into the answer, and 0 if it hallucinated or failed to include details from the live sources. If category is A, rate as "N/A".

Provide your evaluation in the following JSON format:
{
  "correctness": number,
  "citationQuality": number,
  "fallbackScore": number | "N/A",
  "reason": "A one-sentence explanation of the score."
}

Do not include any other text, markdown wrapper (like \`\`\`json), or whitespace. Return ONLY the raw JSON.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  const rawJson = response.choices[0].message.content || '{}';
  try {
    const parsed = JSON.parse(rawJson);
    return {
      correctness: parsed.correctness || 1,
      citationQuality: parsed.citationQuality || 0,
      fallbackScore: parsed.fallbackScore,
      reason: parsed.reason || ''
    };
  } catch (e) {
    console.error('Failed to parse judge response:', rawJson);
    return {
      correctness: 1,
      citationQuality: 0,
      fallbackScore: 'N/A',
      reason: 'Failed to parse evaluation.'
    };
  }
}

async function main() {
  console.log('Starting Evaluation Pipeline...');
  
  let results: any[] = [];
  if (fs.existsSync(EVAL_RESULTS_FILE)) {
    console.log('Loading existing evaluation results...');
    results = JSON.parse(fs.readFileSync(EVAL_RESULTS_FILE, 'utf-8'));
  }

  const existingMap = new Map<string, any>();
  results.forEach(r => existingMap.set(`${r.questionId}_${r.pipeline}`, r));

  const newResults: any[] = [];

  for (const q of QUESTIONS) {
    console.log(`\nEvaluating ${q.id} (Category ${q.category}): "${q.query.substring(0, 50)}..."`);
    
    // Embed Query once
    const embedResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: q.query,
    });
    const queryEmbedding = embedResponse.data[0].embedding;

    // --- Pipeline 1: Baseline Flat RAG ---
    const baseKey = `${q.id}_Baseline`;
    let baseResult = existingMap.get(baseKey);
    
    if (!baseResult) {
      console.log('Running Baseline pipeline...');
      const run = await runBaseline(q.query, queryEmbedding);
      console.log('Judging Baseline answer...');
      const judge = await judgeAnswer(q.query, run.answer, 'Baseline', q.category, run.citations);
      baseResult = {
        questionId: q.id,
        category: q.category,
        pipeline: 'Baseline',
        answer: run.answer,
        citations: run.citations.map(c => c.title),
        scores: judge
      };
    } else {
      console.log('Using cached Baseline results.');
    }
    newResults.push(baseResult);

    // --- Pipeline 2: RAPTOR + CRAG ---
    const raptorKey = `${q.id}_RAPTOR+CRAG`;
    let raptorResult = existingMap.get(raptorKey);

    if (!raptorResult) {
      console.log('Running RAPTOR + CRAG pipeline...');
      const run = await runRaptorCrag(q.query, queryEmbedding);
      console.log(`Graded: ${run.gradeRating} | Fallback Triggered: ${run.fallbackTriggered}`);
      console.log('Judging RAPTOR + CRAG answer...');
      const judge = await judgeAnswer(q.query, run.answer, 'RAPTOR+CRAG', q.category, run.citations);
      raptorResult = {
        questionId: q.id,
        category: q.category,
        pipeline: 'RAPTOR+CRAG',
        answer: run.answer,
        citations: run.citations.map(c => c.title),
        gradeRating: run.gradeRating,
        fallbackTriggered: run.fallbackTriggered,
        scores: judge
      };
    } else {
      console.log('Using cached RAPTOR + CRAG results.');
    }
    newResults.push(raptorResult);
  }

  // Save results
  fs.writeFileSync(EVAL_RESULTS_FILE, JSON.stringify(newResults, null, 2));
  console.log(`\nSaved evaluation results to ${EVAL_RESULTS_FILE}`);

  // Compute stats and print table
  const summary = {
    Baseline: { catACorrectness: 0, catBCorrectness: 0, citationCount: 0, fallbackHits: 0, countA: 0, countB: 0 },
    'RAPTOR+CRAG': { catACorrectness: 0, catBCorrectness: 0, citationCount: 0, fallbackHits: 0, countA: 0, countB: 0 }
  };

  newResults.forEach(r => {
    const type = r.pipeline as 'Baseline' | 'RAPTOR+CRAG';
    if (r.category === 'A') {
      summary[type].catACorrectness += r.scores.correctness;
      summary[type].countA++;
    } else {
      summary[type].catBCorrectness += r.scores.correctness;
      summary[type].countB++;
      if (r.scores.fallbackScore === 1) {
        summary[type].fallbackHits++;
      }
    }
    summary[type].citationCount += r.scores.citationQuality;
  });

  const baselineStats = {
    avgACorrectness: summary.Baseline.catACorrectness / summary.Baseline.countA,
    avgBCorrectness: summary.Baseline.catBCorrectness / summary.Baseline.countB,
    citationRate: summary.Baseline.citationCount / (summary.Baseline.countA + summary.Baseline.countB),
    fallbackRate: summary.Baseline.fallbackHits / summary.Baseline.countB
  };

  const raptorStats = {
    avgACorrectness: summary['RAPTOR+CRAG'].catACorrectness / summary['RAPTOR+CRAG'].countA,
    avgBCorrectness: summary['RAPTOR+CRAG'].catBCorrectness / summary['RAPTOR+CRAG'].countB,
    citationRate: summary['RAPTOR+CRAG'].citationCount / (summary['RAPTOR+CRAG'].countA + summary['RAPTOR+CRAG'].countB),
    fallbackRate: summary['RAPTOR+CRAG'].fallbackHits / summary['RAPTOR+CRAG'].countB
  };

  console.log('\n======================================================');
  console.log('               EVALUATION SUMMARY TABLE               ');
  console.log('======================================================');
  console.log('| Metric                             | Baseline | RAPTOR + CRAG |');
  console.log('|------------------------------------|----------|---------------|');
  console.log(`| Avg Correctness Category A (In-Idx) | ${baselineStats.avgACorrectness.toFixed(2)}/5.00 | ${raptorStats.avgACorrectness.toFixed(2)}/5.00 |`);
  console.log(`| Avg Correctness Category B (Out-Idx)| ${baselineStats.avgBCorrectness.toFixed(2)}/5.00 | ${raptorStats.avgBCorrectness.toFixed(2)}/5.00 |`);
  console.log(`| Citation Quality Rate              | ${(baselineStats.citationRate * 100).toFixed(0)}%      | ${(raptorStats.citationRate * 100).toFixed(0)}%          |`);
  console.log(`| Fallback Success Rate (Category B) | ${(baselineStats.fallbackRate * 100).toFixed(0)}%      | ${(raptorStats.fallbackRate * 100).toFixed(0)}%          |`);
  console.log('======================================================');
}

main();
