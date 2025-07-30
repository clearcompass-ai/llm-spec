import {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import { combineHeaders } from '@ai-sdk/provider-utils';
import { z } from 'zod';

const larsBackendStreamEventSchema = z.object({
  type: z.enum([
    'start',
    'metadata',
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'text-start',
    'text-delta',
    'text-end',
    'error',
    'finish',
    'done',
  ]),
  messageId: z.string().optional(),
  id: z.string().optional(),
  delta: z.string().optional(),
  errorText: z.string().optional(),
  finishReason: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      reasoningTokens: z.number().optional(),
      totalTokens: z.number(),
    })
    .optional(),
  answer: z.unknown().optional(),
  data: z.record(z.unknown()).optional(),
});

type LarsBackendStreamEvent = z.infer<typeof larsBackendStreamEventSchema>;

export interface LarsLanguageModelConfig {
  modelId: string;
  baseURL?: string;
  debug?: boolean;
}

export class LarsLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2';
  readonly modelId: string;
  private readonly baseURL: string;
  private readonly debug: boolean;

  constructor(config: LarsLanguageModelConfig) {
    this.modelId = config.modelId;
    this.baseURL =
      config.baseURL ??
      (typeof process !== 'undefined'
        ? process.env.LARS_API_BASE_URL
        : undefined) ??
      'http://127.0.0.1:8000';
    this.debug = config.debug ?? false;
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log(`[LARS Provider Debug]:`, ...args);
    }
  }

  async doStream({
    prompt,
    headers,
    abortSignal,
    providerOptions,
  }: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
  }> {
    if (!headers?.['Authorization']) {
      throw new Error(
        'Authentication error: Authorization header is missing. Please provide a valid bearer token.',
      );
    }
    for (const message of prompt) {
      for (const part of message.content) {
        if (part.type !== 'text') {
          throw new UnsupportedFunctionalityError({
            functionality: `Input type '${part.type}' is not supported by this model.`,
          });
        }
      }
    }

    const url = `${this.baseURL}/api/v1/chat`;
    const threadId = providerOptions?.threadId as string | undefined;
    const initialContext = providerOptions?.initialContext as
      | Record<string, unknown>
      | undefined;

    const requestBody = {
      model_id: this.modelId,
      messages: prompt.map(message => ({
        role: message.role,
        content: message.content
          .map(part => (part.type === 'text' ? part.text : ''))
          .join(''),
      })),
      thread_id: threadId,
      initial_context: initialContext,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: combineHeaders(
        {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        headers,
      ),
      body: JSON.stringify(requestBody),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(
          `API call failed with status ${response.status}: ${
            errorJson.detail || errorText
          }`,
        );
      } catch (e) {
        throw new Error(
          `API call failed with status ${response.status} ${response.statusText}: ${errorText}`,
        );
      }
    }

    if (response.body == null) {
      throw new Error('API response body is null.');
    }

    const self = this;
    let buffer = '';

    const stream = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(
        new TransformStream<string, LanguageModelV2StreamPart>({
          transform(chunk, controller) {
            self.log('Received raw chunk:', JSON.stringify(chunk));
            buffer += chunk;

            // Process all complete messages in the buffer.
            while (true) {
              const separatorIndex = buffer.indexOf('\n\n');
              if (separatorIndex === -1) {
                break; // No complete message in buffer, wait for more data.
              }

              const message = buffer.slice(0, separatorIndex);
              buffer = buffer.slice(separatorIndex + 2); // Keep the rest for next time.

              if (message.trim() === '' || message.startsWith('data: [DONE]')) {
                continue;
              }

              const jsonString = message.replace(/^data: /, '');

              try {
                const json = JSON.parse(jsonString);
                const validationResult =
                  larsBackendStreamEventSchema.safeParse(json);

                if (!validationResult.success) {
                  self.log('Skipping invalid backend event:', validationResult.error);
                  continue;
                }

                const event = validationResult.data;
                self.log('Parsed and validated event:', event);

                // Translate the valid event into an SDK stream part.
                switch (event.type) {
                  case 'start':
                    controller.enqueue({ type: 'stream-start', warnings: [] });
                    break;
                  case 'metadata':
                    if (event.data) {
                      controller.enqueue({ type: 'data', data: event.data });
                    }
                    break;
                  case 'reasoning-start':
                    controller.enqueue({
                      type: 'reasoning-start',
                      id: event.id ?? 'reasoning-block',
                    });
                    break;
                  case 'reasoning-delta':
                    if (event.delta) {
                      controller.enqueue({
                        type: 'reasoning-delta',
                        id: event.id ?? 'reasoning-block',
                        delta: event.delta,
                      });
                    }
                    break;
                  case 'reasoning-end':
                    controller.enqueue({
                      type: 'reasoning-end',
                      id: event.id ?? 'reasoning-block',
                    });
                    break;
                  case 'text-start':
                    controller.enqueue({
                      type: 'text-start',
                      id: event.id ?? 'text-block',
                    });
                    break;
                  case 'text-delta':
                    if (event.delta) {
                      controller.enqueue({
                        type: 'text-delta',
                        id: event.id ?? 'text-block',
                        delta: event.delta,
                      });
                    }
                    break;
                  case 'text-end':
                    controller.enqueue({
                      type: 'text-end',
                      id: event.id ?? 'text-block',
                    });
                    break;
                  case 'error':
                    controller.enqueue({
                      type: 'error',
                      error: new Error(
                        event.errorText ?? 'An unknown backend error occurred.',
                      ),
                    });
                    break;
                  case 'finish':
                    controller.enqueue({
                      type: 'finish',
                      finishReason:
                        (event.finishReason as LanguageModelV2FinishReason) ?? 'stop',
                      usage: {
                        inputTokens: event.usage?.inputTokens ?? 0,
                        outputTokens: event.usage?.outputTokens ?? 0,
                        totalTokens: event.usage?.totalTokens ?? 0,
                        reasoningTokens: event.usage?.reasoningTokens,
                      },
                    });
                    break;
                  case 'done':
                    break;
                  default:
                    self.log(`Unknown stream event type received`);
                    break;
                }
              } catch (error) {
                self.log('Failed to parse SSE message JSON:', jsonString, error);
              }
            }
          },
        }),
      );

    return { stream };
  }
}
