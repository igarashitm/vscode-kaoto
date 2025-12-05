import React, { useState, useRef, useEffect } from 'react';
import { Button, TextArea, FormGroup, Card, CardBody, Stack, StackItem, Split, SplitItem, CodeBlock, CodeBlockCode } from '@patternfly/react-core';
import { PaperPlaneIcon, CheckIcon, TimesIcon } from '@patternfly/react-icons';
import { ChatMessage, ChatState } from './types';
import './AIChatPanel.css';

interface AIChatPanelProps {
	isOpen: boolean;
	onClose: () => void;
	onSendMessage: (message: string, currentRouteYAML?: string) => Promise<void>;
	onAcceptSuggestion: (messageId: string, content: string) => void;
	onRejectSuggestion: (messageId: string) => void;
	getCurrentRouteYAML: () => Promise<string | undefined>;
	aiResponse?: { content?: string; error?: string; applied?: boolean };
	isResponding?: boolean;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AIChatPanel: React.FC<AIChatPanelProps> = ({
	isOpen: _isOpen,
	onClose,
	onSendMessage,
	onAcceptSuggestion,
	onRejectSuggestion,
	getCurrentRouteYAML,
	aiResponse,
	isResponding = false,
}) => {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputValue, setInputValue] = useState('');
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	};

	useEffect(() => {
		scrollToBottom();
	}, [messages]);

	useEffect(() => {
		if (aiResponse && !isResponding) {
			const metadata: Record<string, unknown> = {};
			if (aiResponse.error) {
				metadata.error = aiResponse.error;
			}
			if (aiResponse.applied) {
				metadata.accepted = true;
				metadata.appliedToEditor = true;
			}
			const assistantMessage: ChatMessage = {
				id: `assistant-${Date.now()}`,
				role: 'assistant',
				content: aiResponse.content || '',
				timestamp: new Date(),
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
			setMessages((prev) => [...prev, assistantMessage]);
		}
	}, [aiResponse, isResponding]);

	const handleSend = async () => {
		if (!inputValue.trim() || isResponding) {
			return;
		}

		const userMessage: ChatMessage = {
			id: `user-${Date.now()}`,
			role: 'user',
			content: inputValue.trim(),
			timestamp: new Date(),
		};

		setMessages((prev) => [...prev, userMessage]);
		setInputValue('');

		const currentRouteYAML = await getCurrentRouteYAML();
		await onSendMessage(userMessage.content, currentRouteYAML);
	};

	const handleAccept = (messageId: string, content: string) => {
		setMessages((prev) =>
			prev.map((msg) =>
				msg.id === messageId
					? {
							...msg,
							metadata: {
								...msg.metadata,
								accepted: true,
								appliedToEditor: true,
							},
						}
					: msg,
			),
		);
		onAcceptSuggestion(messageId, content);
	};

	const handleReject = (messageId: string) => {
		setMessages((prev) =>
			prev.map((msg) =>
				msg.id === messageId
					? {
							...msg,
							metadata: {
								...msg.metadata,
								accepted: false,
							},
						}
					: msg,
			),
		);
		onRejectSuggestion(messageId);
	};

	const handleKeyPress = (event: React.KeyboardEvent) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void handleSend();
		}
	};

	const renderMessage = (message: ChatMessage) => {
		const isUser = message.role === 'user';
		const isError = message.metadata?.error;
		const isAccepted = message.metadata?.accepted;
		const isRejected = message.metadata?.accepted === false;

		return (
			<StackItem key={message.id}>
				<Card isCompact>
					<CardBody>
						<Stack hasGutter>
							<StackItem>
								<span className={isUser ? 'chat-user-label' : 'chat-assistant-label'}>{isUser ? 'You' : 'AI Assistant'}</span>
							</StackItem>
							<StackItem>
								{isUser ? (
									<p>{message.content}</p>
								) : (
									<>
										{isError ? (
											<p className="chat-error-message">{message.metadata?.error}</p>
										) : (
											<CodeBlock>
												<CodeBlockCode>{message.content}</CodeBlockCode>
											</CodeBlock>
										)}
									</>
								)}
							</StackItem>
							{!isUser && !isError && !isAccepted && !isRejected && (
								<StackItem>
									<Split hasGutter>
										<SplitItem>
											<Button variant="primary" size="sm" icon={<CheckIcon />} onClick={() => handleAccept(message.id, message.content)}>
												Accept
											</Button>
										</SplitItem>
										<SplitItem>
											<Button variant="secondary" size="sm" icon={<TimesIcon />} onClick={() => handleReject(message.id)}>
												Reject
											</Button>
										</SplitItem>
									</Split>
								</StackItem>
							)}
							{isAccepted && (
								<StackItem>
									<span className="chat-accepted-label">
										<CheckIcon /> Applied to editor
									</span>
								</StackItem>
							)}
							{isRejected && (
								<StackItem>
									<span className="chat-rejected-label">
										<TimesIcon /> Rejected
									</span>
								</StackItem>
							)}
						</Stack>
					</CardBody>
				</Card>
			</StackItem>
		);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem' }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
				<h2 style={{ margin: 0 }}>AI Assistant</h2>
				<Button variant="plain" onClick={onClose} icon={<TimesIcon />} />
			</div>
			<div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
				<Stack hasGutter className="chat-messages" style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem' }}>
					{messages.length === 0 && (
						<StackItem>
							<Card isPlain>
								<CardBody>
									<div>
										<p>Ask the AI assistant to help you create or modify Apache Camel routes. For example:</p>
										<ul>
											<li>"Create a timer route that logs a message every second"</li>
											<li>"Add a REST endpoint that processes orders"</li>
											<li>"Transform CSV files to JSON"</li>
										</ul>
									</div>
								</CardBody>
							</Card>
						</StackItem>
					)}
					{messages.map(renderMessage)}
					{isResponding && (
						<StackItem>
							<Card isCompact>
								<CardBody>
									<p>AI is thinking...</p>
								</CardBody>
							</Card>
						</StackItem>
					)}
					<div ref={messagesEndRef} />
				</Stack>
				<div className="chat-input-container">
					<FormGroup>
						<TextArea
							value={inputValue}
							onChange={(_event, value) => setInputValue(value)}
							onKeyPress={handleKeyPress}
							aria-label="Chat message input"
							placeholder="Describe the Camel route you want to create or modify..."
							rows={3}
							isDisabled={isResponding}
						/>
					</FormGroup>
					<Button variant="primary" icon={<PaperPlaneIcon />} onClick={handleSend} isDisabled={!inputValue.trim() || isResponding} isBlock>
						Send
					</Button>
				</div>
			</div>
		</div>
	);
};

export const useAIChat = () => {
	const [chatState, setChatState] = useState<ChatState>({
		messages: [],
		isStreaming: false,
		currentStreamingMessage: '',
		isOpen: false,
	});

	const toggleChat = () => {
		setChatState((prev) => ({ ...prev, isOpen: !prev.isOpen }));
	};

	const addStreamingChunk = (chunk: string) => {
		setChatState((prev) => ({
			...prev,
			currentStreamingMessage: prev.currentStreamingMessage + chunk,
		}));
	};

	const finalizeStreamingMessage = (success: boolean, error?: string) => {
		setChatState((prev) => {
			const assistantMessage: ChatMessage = {
				id: `assistant-${Date.now()}`,
				role: 'assistant',
				content: prev.currentStreamingMessage,
				timestamp: new Date(),
				metadata: error ? { error } : {},
			};

			return {
				...prev,
				messages: [...prev.messages, assistantMessage],
				isStreaming: false,
				currentStreamingMessage: '',
			};
		});
	};

	const startStreaming = () => {
		setChatState((prev) => ({
			...prev,
			isStreaming: true,
			currentStreamingMessage: '',
		}));
	};

	return {
		chatState,
		toggleChat,
		addStreamingChunk,
		finalizeStreamingMessage,
		startStreaming,
	};
};
