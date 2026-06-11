import OpenAI from 'openai';

export interface Citation {
  title: string;
  arxivId?: string;
  url?: string;
  source: 'index' | 'live';
}

export interface GenerationResult {
  answer: string;
  citations: Citation[];
}

export async function generateAnswer(
  openai: OpenAI,
  query: string,
  contextText: string,
  citations: Citation[]
): Promise<GenerationResult> {
  const prompt = `You are a professional AI research assistant specializing in Retrieval-Augmented Generation (RAG). 
Your task is to answer the user's query using the provided context (which contains paper abstracts, cluster summaries, or live arXiv papers).
  
Constraints:
1. Answer the query thoroughly but concisely (under 200 words).
2. Cite the specific papers/sources that inform your answer using their exact titles or titles in brackets. Format citations inline as [Title] or [Title, arXiv:ID].
3. Only use the provided context. If the context does not contain the answer, say "I cannot find the answer in the retrieved sources."
4. Be precise, professional, and clean in your formatting.
5. Wrap key technical terms, model/paper names, and main concepts in **double asterisks** (markdown bold) so they can be highlighted on the screen (e.g. **RAPTOR**, **CRAG**, **speculative decoding**, **RACES**).

User Query: "${query}"

Context:
${contextText}

Answer:`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 400
  });

  const answer = response.choices[0].message.content || 'No answer generated.';

  // Match which citations are actually mentioned or relevant
  const lowerAnswer = answer.toLowerCase();
  const usedCitations = citations.filter(c => {
    const titleMatch = lowerAnswer.includes(c.title.toLowerCase());
    const idMatch = c.arxivId ? lowerAnswer.includes(c.arxivId.toLowerCase()) : false;
    return titleMatch || idMatch;
  });

  // Fallback to all if none matched explicitly by text
  const finalCitations = usedCitations.length > 0 ? usedCitations : citations;

  return {
    answer,
    citations: finalCitations
  };
}
