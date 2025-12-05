/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * This class is a copy of https://github.com/apache/incubator-kie-tools/blob/main/packages/editor/src/envelope/KogitoEditorEnvelope.tsx
 * meant to override how React apps are bootstrapped.
 */
import { Editor, KogitoEditorEnvelopeContext, KogitoEditorEnvelopeContextType } from '@kie-tools-core/editor/dist/api';
import { EditorEnvelopeView, EditorEnvelopeViewApi } from '@kie-tools-core/editor/dist/envelope/EditorEnvelopeView';
import { EditorEnvelopeI18nContext, editorEnvelopeI18nDefaults, editorEnvelopeI18nDictionaries } from '@kie-tools-core/editor/dist/envelope/i18n';
import { I18nDictionariesProvider } from '@kie-tools-core/i18n/dist/react-components';
import { createRef, FunctionComponent, RefObject, useCallback, useState, useEffect, useRef } from 'react';
import { AIChatPanel } from '../components/AIChat';

interface KogitoEditorEnvelopeAppProps {
	callback: (ref: RefObject<EditorEnvelopeViewApi<Editor> | null>) => void;
	context: KogitoEditorEnvelopeContextType<any>;
	showKeyBindingsOverlay: boolean;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const KogitoEditorEnvelopeApp: FunctionComponent<KogitoEditorEnvelopeAppProps> = ({
	callback,
	context,
	showKeyBindingsOverlay,
}: KogitoEditorEnvelopeAppProps) => {
	const editorEnvelopeViewRef = createRef<EditorEnvelopeViewApi<Editor>>();
	const [isChatOpen, setIsChatOpen] = useState(false);
	const [isAIResponding, setIsAIResponding] = useState(false);
	const [aiMessages, setAIMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; error?: string; applied?: boolean }>>([]);
	const vscodeApiRef = useRef<{ postMessage(message: unknown): void } | null>(null);

	const onMountFn = useCallback(() => {
		callback(editorEnvelopeViewRef);
	}, []);

	useEffect(() => {
		if (!vscodeApiRef.current) {
			if ((window as any).vscode) {
				console.log('[AI] VS Code API found on window.vscode');
				vscodeApiRef.current = (window as any).vscode;
			} else if (typeof (window as any).acquireVsCodeApi === 'function') {
				try {
					vscodeApiRef.current = (window as any).acquireVsCodeApi();
					(window as any).vscode = vscodeApiRef.current;
					console.log('[AI] VS Code API acquired via acquireVsCodeApi');
				} catch (error) {
					console.error('[AI] Failed to acquire VS Code API:', error);
				}
			} else {
				console.error('[AI] No VS Code API available');
			}
		}
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const msgType = event.data?.type;
			if (msgType === 'toggleAIChat' || msgType === 'aiChatResponse' || msgType === 'aiPing') {
				console.log(`[AI] Received message: type=${msgType}`, event.data);
			}
			if (msgType === 'toggleAIChat') {
				setIsChatOpen((prev) => !prev);
			} else if (msgType === 'aiPing') {
				console.log('[AI] Received aiPing, sending aiPong back');
				vscodeApiRef.current?.postMessage({ type: 'aiPong' });
			} else if (msgType === 'aiChatResponse') {
				const result = event.data.result;
				if (result.success && result.content) {
					if (result.responseType === 'yaml') {
						const editor = editorEnvelopeViewRef.current?.getEditor();
						if (editor && typeof (editor as any).setContent === 'function') {
							(editor as any).setContent('', result.content).catch((err: unknown) => {
								console.error('[AI] Failed to apply AI response to editor:', err);
							});
						}
						setAIMessages((prev) => [...prev, { role: 'assistant', content: result.content!, applied: true }]);
					} else {
						setAIMessages((prev) => [...prev, { role: 'assistant', content: result.content! }]);
					}
				} else {
					setAIMessages((prev) => [...prev, { role: 'assistant', content: '', error: result.error || 'Unknown error' }]);
				}
				setIsAIResponding(false);
			}
		};

		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, []);

	const handleSendMessage = async (message: string, routeYAML?: string) => {
		setAIMessages((prev) => [...prev, { role: 'user', content: message }]);
		setIsAIResponding(true);

		const vscodeApi = vscodeApiRef.current;
		if (vscodeApi) {
			const requestId = `ai-request-${Date.now()}`;
			console.log(`[AI] Sending aiChatRequest: requestId=${requestId}, hasVscodeApi=true`);
			vscodeApi.postMessage({
				type: 'aiChatRequest',
				requestId,
				prompt: message,
				routeYAML,
			});
		} else {
			console.error('[AI] VS Code API not available, cannot send message');
			setAIMessages((prev) => [...prev, { role: 'assistant', content: '', error: 'VS Code API not available' }]);
			setIsAIResponding(false);
		}
	};

	const handleAcceptSuggestion = async (messageId: string, content: string) => {
		try {
			const editor = editorEnvelopeViewRef.current?.getEditor();
			if (editor && typeof (editor as any).setContent === 'function') {
				await (editor as any).setContent('', content);
			}
		} catch (error) {
			console.error('Failed to apply AI suggestion:', error);
		}
	};

	const handleRejectSuggestion = (messageId: string) => {
		console.log('AI suggestion rejected:', messageId);
	};

	const getCurrentRouteYAML = async (): Promise<string | undefined> => {
		try {
			const editor = editorEnvelopeViewRef.current?.getEditor();
			if (editor && typeof (editor as any).getContent === 'function') {
				return await (editor as any).getContent();
			}
		} catch (error) {
			console.error('Failed to get current route content:', error);
		}
		return undefined;
	};

	const latestAIResponse = aiMessages.length > 0 ? aiMessages[aiMessages.length - 1] : undefined;

	return (
		<div ref={onMountFn} style={{ height: '100vh', width: '100%' }}>
			<KogitoEditorEnvelopeContext.Provider value={context}>
				<I18nDictionariesProvider
					defaults={editorEnvelopeI18nDefaults}
					dictionaries={editorEnvelopeI18nDictionaries}
					ctx={EditorEnvelopeI18nContext}
					initialLocale={navigator.language}
				>
					<EditorEnvelopeI18nContext.Consumer>
						{({ setLocale }) => (
							<div style={{ display: 'flex', height: '100%', width: '100%' }}>
								<div className="kaoto-editor-container" style={{ flex: 1, overflow: 'hidden', minWidth: 0, position: 'relative', height: '100%' }}>
									<EditorEnvelopeView ref={editorEnvelopeViewRef} setLocale={setLocale} showKeyBindingsOverlay={showKeyBindingsOverlay} />
								</div>
								{isChatOpen && (
									<div
										style={{
											width: '400px',
											minWidth: '300px',
											backgroundColor: 'var(--vscode-sideBar-background)',
											borderLeft: '1px solid var(--vscode-sideBar-border)',
											display: 'flex',
											flexDirection: 'column',
										}}
									>
										<AIChatPanel
											isOpen={isChatOpen}
											onClose={() => setIsChatOpen(false)}
											onSendMessage={handleSendMessage}
											onAcceptSuggestion={handleAcceptSuggestion}
											onRejectSuggestion={handleRejectSuggestion}
											getCurrentRouteYAML={getCurrentRouteYAML}
											aiResponse={
												latestAIResponse
													? { content: latestAIResponse.content, error: latestAIResponse.error, applied: latestAIResponse.applied }
													: undefined
											}
											isResponding={isAIResponding}
										/>
									</div>
								)}
							</div>
						)}
					</EditorEnvelopeI18nContext.Consumer>
				</I18nDictionariesProvider>
			</KogitoEditorEnvelopeContext.Provider>
		</div>
	);
};
