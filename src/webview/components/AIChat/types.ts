export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
	metadata?: {
		accepted?: boolean;
		appliedToEditor?: boolean;
		error?: string;
	};
}

export interface ChatState {
	messages: ChatMessage[];
	isStreaming: boolean;
	currentStreamingMessage: string;
	isOpen: boolean;
}
