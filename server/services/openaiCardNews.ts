const OPENAI_API_BASE = 'https://api.openai.com/v1';
const TEXT_MODEL = 'gpt-4o-mini';
const VISION_MODEL = 'gpt-4o-mini';

// Rough USD-per-1M-token rates for cost estimation only — OpenAI doesn't return a dollar amount,
// only token counts, and published rates change over time. Treat estimatedCost/actualCost as an
// approximation, not a billing-accurate figure.
const PRICING_PER_MILLION_TOKENS = { input: 0.15, output: 0.6 };

export interface GenerateCardNewsInput {
  title: string | null;
  story: string | null;
  hashtags: string[];
  cardCount: number;
  photoUrls: string[];
}

export interface GeneratedCard {
  title: string;
  body: string;
}

export interface GenerateCardNewsResult {
  cards: GeneratedCard[];
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

export interface OpenAIClient {
  generateCardNewsCopy(input: GenerateCardNewsInput): Promise<GenerateCardNewsResult>;
}

function buildPrompt(input: GenerateCardNewsInput): string {
  return [
    '당신은 한국 학원(academy)의 SNS 카드뉴스 문구를 작성하는 카피라이터입니다.',
    `카드 수: ${input.cardCount}장`,
    input.title ? `제목: ${input.title}` : null,
    input.story ? `사연/내용: ${input.story}` : null,
    input.hashtags.length > 0 ? `해시태그 참고: ${input.hashtags.join(', ')}` : null,
    '',
    `각 카드마다 짧은 제목(title)과 1~2문장 본문(body)을 만들어 주세요.`,
    `아래 JSON 형식으로만 응답하세요: {"cards":[{"title":"...","body":"..."}, ...]}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function createOpenAIClient(apiKey: string): OpenAIClient {
  return {
    async generateCardNewsCopy(input) {
      const model = input.photoUrls.length > 0 ? VISION_MODEL : TEXT_MODEL;
      const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
        { type: 'text', text: buildPrompt(input) },
      ];
      for (const url of input.photoUrls) {
        userContent.push({ type: 'image_url', image_url: { url } });
      }

      const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: userContent }],
          response_format: { type: 'json_object' },
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI request failed: ${response.status} ${body.slice(0, 500)}`);
      }

      const body = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };
      const content = body.choices[0]?.message.content ?? '{"cards":[]}';
      let parsed: { cards?: GeneratedCard[] };
      try {
        parsed = JSON.parse(content) as { cards?: GeneratedCard[] };
      } catch {
        parsed = { cards: [] };
      }

      const promptTokens = body.usage?.prompt_tokens ?? 0;
      const completionTokens = body.usage?.completion_tokens ?? 0;
      const estimatedCostUsd =
        (promptTokens / 1_000_000) * PRICING_PER_MILLION_TOKENS.input + (completionTokens / 1_000_000) * PRICING_PER_MILLION_TOKENS.output;

      return {
        cards: (parsed.cards ?? []).slice(0, input.cardCount),
        model,
        promptTokens,
        completionTokens,
        estimatedCostUsd,
      };
    },
  };
}
