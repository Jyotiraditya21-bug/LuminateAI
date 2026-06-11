import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { retrieveNodes, IndexNode } from '@/lib/retrieve';
import { gradeContext, fetchLiveArxiv, ArxivPaper } from '@/lib/grade';
import { generateAnswer, Citation } from '@/lib/generate';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY || '' });

export async function POST(request: Request) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OpenAI API key is not configured on the server.' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Invalid or missing query parameter.' },
        { status: 400 }
      );
    }

    console.log(`Processing query: "${query}"`);

    // 1. Embed user query
    const embedResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    const queryEmbedding = embedResponse.data[0].embedding;

    // 2. Retrieve top-k nodes from index
    const retrievalResults = retrieveNodes(queryEmbedding, 5);
    const retrievedNodes = retrievalResults.map(r => r.node);

    // 3. Grade context relevance (CRAG)
    const grade = await gradeContext(openai, query, retrievedNodes);
    console.log(`CRAG Grade: ${grade.rating} | Reason: ${grade.reason}`);

    // 4. Handle corrective fallback based on grade
    let finalNodes: IndexNode[] = [];
    let livePapers: ArxivPaper[] = [];
    let arxivSearchQuery = '';
    let fallbackTriggered = false;

    if (grade.rating === 'CORRECT') {
      finalNodes = retrievedNodes;
    } else if (grade.rating === 'INCORRECT') {
      fallbackTriggered = true;
      const fallback = await fetchLiveArxiv(openai, query);
      livePapers = fallback.papers;
      arxivSearchQuery = fallback.searchQuery;
    } else { // AMBIGUOUS
      fallbackTriggered = true;
      finalNodes = retrievedNodes;
      const fallback = await fetchLiveArxiv(openai, query);
      livePapers = fallback.papers;
      arxivSearchQuery = fallback.searchQuery;
    }

    // 5. Compile context text and citations
    const citations: Citation[] = [];
    let contextTextParts: string[] = [];

    // Add retrieved nodes to context
    finalNodes.forEach(node => {
      contextTextParts.push(`[Index Source: ${node.id} (${node.level})]\n${node.text}`);
      if (node.level === 'leaf' && node.metadata) {
        citations.push({
          title: node.metadata.title,
          arxivId: node.metadata.arxivId,
          url: node.metadata.url,
          source: 'index'
        });
      } else if (node.metadata) {
        citations.push({
          title: node.metadata.title || `Index Summary Node (${node.level})`,
          source: 'index'
        });
      }
    });

    // Add live search papers to context
    livePapers.forEach((paper, idx) => {
      contextTextParts.push(`[Live arXiv Source ${idx + 1}]\nTitle: ${paper.title}\nAbstract: ${paper.abstract}`);
      citations.push({
        title: paper.title,
        arxivId: paper.arxivId,
        url: paper.url,
        source: 'live'
      });
    });

    const finalContextUsed = contextTextParts.join('\n\n');

    // 6. Generate answer
    const generation = await generateAnswer(openai, query, finalContextUsed, citations);

    // 7. Construct trace log
    const trace = {
      retrievedNodes: retrievalResults.map(r => ({
        id: r.node.id,
        level: r.node.level,
        text: r.node.text,
        score: r.score,
        title: r.node.metadata?.title || 'Summary Node'
      })),
      grade: {
        rating: grade.rating,
        reason: grade.reason
      },
      arxivFallback: {
        triggered: fallbackTriggered,
        searchQuery: arxivSearchQuery || undefined,
        fetchedPapers: livePapers.map(p => ({
          title: p.title,
          arxivId: p.arxivId,
          url: p.url
        }))
      },
      finalContextUsed
    };

    return NextResponse.json({
      answer: generation.answer,
      citations: generation.citations,
      trace
    });

  } catch (error: any) {
    console.error('Error in API route:', error);
    return NextResponse.json(
      { error: error.message || 'An internal server error occurred.' },
      { status: 500 }
    );
  }
}
