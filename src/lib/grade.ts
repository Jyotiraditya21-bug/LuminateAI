import OpenAI from 'openai';
import { IndexNode } from './retrieve';

export type GradeRating = 'CORRECT' | 'AMBIGUOUS' | 'INCORRECT';

export interface GradeResult {
  rating: GradeRating;
  reason: string;
}

export interface ArxivPaper {
  title: string;
  abstract: string;
  authors: string[];
  published: string;
  url: string;
  arxivId: string;
}

// Clean and format text helper
function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
}

// Parser for live arXiv XML responses
export function parseArxivXml(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entryContent = match[1];

    const titleMatch = entryContent.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = entryContent.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = entryContent.match(/<published>([\s\S]*?)<\/published>/);
    const idMatch = entryContent.match(/<id>([\s\S]*?)<\/id>/);

    const authors: string[] = [];
    const nameRegex = /<name>([^<]+)<\/name>/g;
    let nameMatch;
    while ((nameMatch = nameRegex.exec(entryContent)) !== null) {
      authors.push(cleanText(nameMatch[1]));
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

// Grade the retrieved nodes using GPT-4o-mini
export async function gradeContext(
  openai: OpenAI,
  query: string,
  nodes: IndexNode[]
): Promise<GradeResult> {
  const contextText = nodes
    .map((n, i) => `[Snippet ${i + 1}] (Level: ${n.level})\nContent: ${n.text}`)
    .join('\n\n');

  const prompt = `You are a strict grading assistant evaluating retrieval results for an AI research assistant.
Given a user query and a list of retrieved snippets (which may be paper abstracts or higher-level summaries), assess if the context contains enough direct and confident information to fully answer the query.

Select one of these three ratings:
- CORRECT: The retrieved context is fully sufficient to answer the query confidently.
- AMBIGUOUS: The context is partially helpful, but some details are missing or it is incomplete.
- INCORRECT: The context is completely irrelevant or does not contain any answer to the query.

Provide your output in the following JSON format:
{
  "rating": "CORRECT" | "AMBIGUOUS" | "INCORRECT",
  "reason": "A one-sentence explanation of your grading decision."
}

Do not include any other text, markdown wrapper (like \`\`\`json), or whitespace. Return ONLY the raw JSON.

User Query: "${query}"

Retrieved Context:
${contextText}

JSON Output:`;

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
      rating: parsed.rating || 'AMBIGUOUS',
      reason: parsed.reason || 'No reason provided.'
    };
  } catch (e) {
    console.error('Failed to parse grading response:', rawJson);
    return {
      rating: 'AMBIGUOUS',
      reason: 'Failed to parse grading output, defaulting to AMBIGUOUS.'
    };
  }
}

// Fetch papers live from arXiv using LLM-generated keywords
export async function fetchLiveArxiv(
  openai: OpenAI,
  query: string
): Promise<{ papers: ArxivPaper[]; searchQuery: string }> {
  // Use GPT-4o-mini to generate an optimal arXiv query directly
  const prompt = `You need to search the arXiv API for academic papers relevant to this user query: "${query}".
Generate an optimal search query.
Instructions:
1. Extract only the 2 or 3 most important technical keywords or model names (e.g. "DeepSeek-V3", "Gemini 1.5", "OpenAI o1", "Swarm").
2. Prefix each word with "all:" and join them with "+AND+" (e.g. "all:DeepSeek-V3+AND+all:MoE" or "all:OpenAI+AND+all:o1").
3. Keep the words simple, strip out extra terms like "routing", "details", "mechanism", or "window" unless they are the primary subject.
4. Keep the output strictly in the format: all:WORD1+AND+all:WORD2... with NO other text, NO quotes, and NO punctuation outside of the format.

Query: "${query}"
arXiv Search Query:`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 30,
    temperature: 0.1
  });

  const rawQuery = response.choices[0].message.content?.trim() || '';
  // Clean up any formatting noise
  const arxivSearchQuery = rawQuery.replace(/`/g, '').replace(/\s+/g, '').trim();
  
  // Reconstruct simple keywords for trace logs (e.g. "OpenAI o1")
  const keywords = arxivSearchQuery.split('+AND+').map(s => s.replace('all:', '')).join(' ');

  console.log(`Generated live arXiv search query: "${arxivSearchQuery}"`);

  const url = `https://export.arxiv.org/api/query?search_query=${arxivSearchQuery}&start=0&max_results=5&sortBy=relevance`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`arXiv search failed: ${res.statusText}`);
  }
  const xmlText = await res.text();
  const papers = parseArxivXml(xmlText);

  return { papers, searchQuery: keywords };
}
