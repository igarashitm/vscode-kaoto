import * as vscode from 'vscode';
import * as YAML from 'yaml';
import { KaotoOutputChannel } from '../extension/KaotoOutputChannel';

export type ResponseType = 'yaml' | 'text';

export interface GenerateRouteResult {
	success: boolean;
	responseType: ResponseType;
	content?: string;
	error?: string;
}

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

export interface AIAvailabilityStatus {
	available: boolean;
	reason?: string;
	modelInfo?: {
		vendor: string;
		family: string;
	};
}

export class AIAgentService {
	private static readonly MODEL_SELECTION_TIMEOUT_MS = 5000;
	private static readonly REQUEST_TIMEOUT_MS = 10000;

	private conversationHistory: Map<string, vscode.LanguageModelChatMessage[]> = new Map();

	async sendRequest(
		userPrompt: string,
		currentRouteYAML: string | undefined,
		onChunk: (chunk: string) => void,
		cancellationToken: vscode.CancellationToken,
	): Promise<GenerateRouteResult> {
		try {
			const model = await this.selectModel();
			if (!model) {
				return {
					success: false,
					responseType: 'text',
					error: 'No language model available. Please install and sign in to GitHub Copilot or another VS Code LM provider.',
				};
			}

			const messages = this.buildMessages(userPrompt, currentRouteYAML);

			let fullResponse = '';

			const chatResponse = await this.withTimeout(
				model.sendRequest(messages, {}, cancellationToken),
				AIAgentService.REQUEST_TIMEOUT_MS,
				'Language model request timed out. Please check that your LM provider (e.g. GitHub Copilot) is signed in and working.',
			);

			for await (const chunk of chatResponse.text) {
				fullResponse += chunk;
				onChunk(chunk);

				if (cancellationToken.isCancellationRequested) {
					return {
						success: false,
						responseType: 'text',
						error: 'Request cancelled by user',
					};
				}
			}

			const yamlCandidate = this.extractYAMLCandidate(fullResponse);
			const validation = await this.validateYAML(yamlCandidate);
			if (validation.valid) {
				return {
					success: true,
					responseType: 'yaml',
					content: yamlCandidate,
				};
			}

			return {
				success: true,
				responseType: 'text',
				content: fullResponse,
			};
		} catch (error) {
			if (error instanceof vscode.LanguageModelError) {
				KaotoOutputChannel.logError('Language Model Error', error);
				return {
					success: false,
					responseType: 'text',
					error: `Language Model Error: ${error.message}`,
				};
			}
			KaotoOutputChannel.logError('Unexpected error in sendRequest', error);
			return {
				success: false,
				responseType: 'text',
				error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	async validateYAML(yaml: string): Promise<ValidationResult> {
		try {
			const parsed = YAML.parse(yaml);

			if (!parsed) {
				return { valid: false, error: 'Empty YAML content' };
			}

			const routes = this.extractRoutes(parsed);
			if (routes.length === 0) {
				return { valid: false, error: 'No Camel routes found in YAML. Expected route definitions with "from" fields.' };
			}

			for (const route of routes) {
				if (!route.from) {
					return { valid: false, error: 'Route missing required "from" field' };
				}
			}

			return { valid: true };
		} catch (err) {
			return {
				valid: false,
				error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	private extractRoutes(parsed: unknown): Array<Record<string, unknown>> {
		if (Array.isArray(parsed)) {
			const routes: Array<Record<string, unknown>> = [];
			for (const item of parsed) {
				if (item?.route) {
					routes.push(item.route as Record<string, unknown>);
				} else if (item?.from) {
					routes.push(item as Record<string, unknown>);
				}
			}
			return routes;
		}

		const obj = parsed as Record<string, unknown>;
		if (Array.isArray(obj.routes)) {
			return this.extractRoutes(obj.routes);
		}

		if (obj.route) {
			return [obj.route as Record<string, unknown>];
		}

		if (obj.from) {
			return [obj];
		}

		return [];
	}

	async checkAvailability(): Promise<AIAvailabilityStatus> {
		try {
			const models = await this.withTimeout(
				vscode.lm.selectChatModels(),
				AIAgentService.MODEL_SELECTION_TIMEOUT_MS,
				'Timed out checking for available language models.',
			);
			if (models.length === 0) {
				return {
					available: false,
					reason: 'No language models available. Please install and sign in to GitHub Copilot or another VS Code LM provider.',
				};
			}
			return {
				available: true,
				modelInfo: {
					vendor: models[0].vendor,
					family: models[0].family,
				},
			};
		} catch (err) {
			if (err instanceof vscode.LanguageModelError) {
				return {
					available: false,
					reason: `Error: ${err.message}`,
				};
			}
			return {
				available: false,
				reason: `${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	private async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
		const preferredModels = [{ vendor: 'copilot', family: 'gpt-4o' }, { vendor: 'copilot', family: 'gpt-4' }, { family: 'claude-3.5-sonnet' }];

		for (const selector of preferredModels) {
			try {
				const models = await this.withTimeout(
					vscode.lm.selectChatModels(selector),
					AIAgentService.MODEL_SELECTION_TIMEOUT_MS,
					`Timed out selecting model: ${JSON.stringify(selector)}`,
				);
				if (models.length > 0) {
					KaotoOutputChannel.logInfo(`Selected model: ${models[0].vendor}/${models[0].family}`);
					return models[0];
				}
			} catch (err) {
				KaotoOutputChannel.logWarning(`Failed to select model ${JSON.stringify(selector)}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		try {
			const anyModels = await this.withTimeout(
				vscode.lm.selectChatModels(),
				AIAgentService.MODEL_SELECTION_TIMEOUT_MS,
				'Timed out selecting any available model.',
			);
			if (anyModels.length > 0) {
				KaotoOutputChannel.logInfo(`Selected fallback model: ${anyModels[0].vendor}/${anyModels[0].family}`);
				return anyModels[0];
			}
		} catch (err) {
			KaotoOutputChannel.logWarning(`Failed to select any model: ${err instanceof Error ? err.message : String(err)}`);
		}

		return undefined;
	}

	private withTimeout<T>(thenable: Thenable<T>, ms: number, timeoutMessage: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
			thenable.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(err: unknown) => {
					clearTimeout(timer);
					reject(err);
				},
			);
		});
	}

	private buildMessages(userPrompt: string, currentRouteYAML?: string): vscode.LanguageModelChatMessage[] {
		const systemPrompt = this.buildSystemPrompt();
		const userMessage = this.buildUserMessage(userPrompt, currentRouteYAML);

		return [vscode.LanguageModelChatMessage.User(systemPrompt), vscode.LanguageModelChatMessage.User(userMessage)];
	}

	private buildSystemPrompt(): string {
		return `You are an expert Apache Camel integration assistant embedded in the Kaoto visual editor.

You handle two types of requests:

1. ROUTE CREATION/MODIFICATION: When the user asks to create, modify, add, remove, or change a Camel route, output ONLY valid Camel YAML DSL. No explanations, no markdown code blocks, no additional text - just the raw YAML.

2. QUESTIONS: When the user asks a question about Camel, their route, components, EIPs, or anything else, respond with a helpful plain text explanation.

RULES FOR YAML OUTPUT:
- Use proper Camel component URIs (e.g., "timer:tick", "log:info", "direct:start")
- Follow Camel YAML DSL syntax exactly
- If modifying existing routes, preserve route IDs and structure where possible
- Suggest appropriate Enterprise Integration Patterns (EIP) when relevant
- Always include meaningful route IDs and descriptions
- Use proper indentation (2 spaces per level)

EXAMPLE - Simple Timer Route:
- route:
    id: timer-to-log
    description: Simple timer that logs every second
    from:
      uri: timer:tick
      parameters:
        period: 1000
      steps:
        - log:
            message: "Timer fired at \${date:now:yyyy-MM-dd HH:mm:ss}"

EXAMPLE - Content-Based Routing:
- route:
    id: rest-api-route
    from:
      uri: direct:processOrder
      steps:
        - choice:
            when:
              - simple: "\${body[orderType]} == 'EXPRESS'"
                steps:
                  - to: direct:expressProcessing
            otherwise:
              steps:
                - log:
                    message: "Unknown order type: \${body[orderType]}"

When the user provides an existing route, modify it according to their request while maintaining compatibility and preserving important configuration.`;
	}

	private buildUserMessage(prompt: string, context?: string): string {
		if (context) {
			return `Here is my current Camel route:

\`\`\`yaml
${context}
\`\`\`

${prompt}`;
		}

		return prompt;
	}

	private extractYAMLCandidate(response: string): string {
		const codeBlockOnlyPattern = /^\s*```ya?ml\n([\s\S]*?)\n```\s*$/;
		const match = response.match(codeBlockOnlyPattern);
		if (match) {
			return match[1].trim();
		}

		return response.trim();
	}
}
