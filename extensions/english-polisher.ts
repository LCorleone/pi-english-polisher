/**
 * English Polisher Extension
 *
 * Prefix your input with `>` to get your English polished before sending.
 * Uses the current session's model and conversation context for natural rewrites.
 *
 * Usage:
 *   > this is my english input what i want to say
 *
 * Flow:
 *   1. Detect `>` prefix
 *   2. Fetch session context + call LLM to polish
 *   3. Show before/after comparison
 *   4. Confirm → use polished text / No → edit / Cancel → use original
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";

const SYSTEM_PROMPT = `Your ONLY task is to rewrite the user's English text to be more natural and grammatically correct. You are a text polisher, NOT a conversational assistant.

CRITICAL RULES:
- You MUST NOT answer questions, provide information, or help with any task mentioned in the text.
- You MUST NOT respond to the content — only rewrite it.
- Output ONLY the polished version of the user's text. Nothing else.
- No explanations, no commentary, no greetings, no acknowledgment.
- Preserve the original meaning, tone, and intent exactly.
- Preserve any code, file paths, technical terms, or commands exactly as-is.
- If the text is already correct, return it unchanged.
- If the text contains Chinese, translate the Chinese parts into English and polish the entire text into natural English.
- The output must ALWAYS be fully in English.
- The conversation context is provided ONLY to help you understand what the user means. Do NOT respond to it.

Examples:
Input:  "i want to make a function that process the data"
Output: "I want to create a function that processes the data"

Input:  "how to fix the bug in the login page"
Output: "How can I fix the bug on the login page?"

Input:  "我想要一个 function that can 处理 data and return 结果"
Output: "I want a function that can process data and return the results"

Input:  "this 逻辑 is wrong, 应该先 check the null"
Output: "This logic is wrong, we should check for null first"`

/**
 * Extract recent conversation text from session branch.
 * Returns last N user/assistant message pairs as context string.
 */
function buildContext(entries: any[], maxMessages: number = 10): string {
	const messages: string[] = [];

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role === "user") {
			const text = typeof msg.content === "string" ? msg.content : msg.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map(c => c.text).join("\n");
			if (text) messages.push(`User: ${text.slice(0, 500)}`);
		} else if (msg.role === "assistant") {
			const textParts = msg.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map(c => c.text).join("\n");
			if (textParts) messages.push(`Assistant: ${textParts.slice(0, 500)}`);
		}
		if (messages.length >= maxMessages) break;
	}

	return messages.join("\n\n");
}

/**
 * Call Anthropic Messages API
 */
async function callAnthropic(model: Model<Api>, apiKey: string, headers: Record<string, string>, context: string, rawInput: string, signal?: AbortSignal): Promise<string> {
	const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

	if (context) {
		messages.push({ role: "user", content: `Here is the conversation context:\n\n${context}` });
		messages.push({ role: "assistant", content: "Got it, I understand the context." });
	}

	messages.push({ role: "user", content: rawInput });

	const res = await fetch(`${model.baseUrl}/v1/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			...headers,
		},
		body: JSON.stringify({
			model: model.id,
			max_tokens: 2048,
			system: SYSTEM_PROMPT,
			messages,
		}),
		signal,
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Anthropic API error (${res.status}): ${err}`);
	}

	const data = await res.json() as { content: Array<{ type: string; text: string }> };
	const textBlock = data.content?.find((b) => b.type === "text");
	if (!textBlock) throw new Error("No text in Anthropic response");
	return textBlock.text.trim();
}

/**
 * Call OpenAI Chat Completions API (works for most OpenAI-compatible providers)
 */
async function callOpenAI(model: Model<Api>, apiKey: string, headers: Record<string, string>, context: string, rawInput: string, signal?: AbortSignal): Promise<string> {
	const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
		{ role: "system", content: SYSTEM_PROMPT },
	];

	if (context) {
		messages.push({ role: "user", content: `Here is the conversation context:\n\n${context}` });
		messages.push({ role: "assistant", content: "Got it, I understand the context." });
	}

	messages.push({ role: "user", content: rawInput });

	const res = await fetch(`${model.baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${apiKey}`,
			...headers,
		},
		body: JSON.stringify({
			model: model.id,
			max_tokens: 2048,
			messages,
		}),
		signal,
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenAI API error (${res.status}): ${err}`);
	}

	const data = await res.json() as { choices: Array<{ message: { content: string } }> };
	const content = data.choices?.[0]?.message?.content;
	if (!content) throw new Error("No content in OpenAI response");
	return content.trim();
}

/**
 * Call LLM based on model API type
 */
async function callLLM(model: Model<Api>, apiKey: string, headers: Record<string, string>, context: string, rawInput: string, signal?: AbortSignal): Promise<string> {
	const api = model.api as string;

	if (api === "anthropic-messages") {
		return callAnthropic(model, apiKey, headers, context, rawInput, signal);
	}

	// Default: OpenAI-compatible (covers openai-completions, openai-responses, etc.)
	return callOpenAI(model, apiKey, headers, context, rawInput, signal);
}

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		// Skip extension-injected messages
		if (event.source === "extension") {
			return { action: "continue" };
		}

		// Only trigger on `>` prefix
		if (!event.text.startsWith(">")) {
			return { action: "continue" };
		}

		const rawInput = event.text.slice(1).trim();

		// Too short
		if (rawInput.length < 3) {
			ctx.ui.notify("Usage: > your English text here", "warning");
			return { action: "handled" };
		}



		// Need a model to call
		const model = ctx.model;
		if (!model) {
			ctx.ui.notify("English polisher: no model selected", "warning");
			return { action: "transform", text: rawInput };
		}

		// Get API key
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) {
			ctx.ui.notify("English polisher: no API key for current model", "warning");
			return { action: "transform", text: rawInput };
		}

		// Build context from session
		const branch = ctx.sessionManager.getBranch();
		const context = buildContext(branch);

		// Call LLM to polish (animated spinner widget)
		const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
		let fi = 0;
		const spinner = setInterval(() => {
			ctx.ui.setWidget("polisher", [`${frames[fi++ % frames.length]} Polishing English...`]);
		}, 80);

		let polished: string;
		try {
			polished = await callLLM(model, auth.apiKey, auth.headers ?? {}, context, rawInput, ctx.signal);
		} catch (err: any) {
			clearInterval(spinner);
			ctx.ui.setWidget("polisher", undefined);
			if (err.name === "AbortError") {
				ctx.ui.notify("Polish cancelled", "warning");
				return { action: "handled" };
			}
			ctx.ui.notify(`Polish failed: ${err.message}`, "error");
			return { action: "transform", text: rawInput };
		}
		clearInterval(spinner);
		ctx.ui.setWidget("polisher", undefined);

		// No change
		if (polished === rawInput) {
			ctx.ui.notify("✨ Already looks great! No changes needed.", "info");
			return { action: "transform", text: rawInput };
		}

		// Show comparison — select between accept / edit / cancel
		const options = [
			`✅ Accept: ${polished}`,
			`✏️ Edit polished version`,
			`❌ Cancel and re-type`,
		];

		const choice = await ctx.ui.select(
			`✨ Polished:\n${polished}\n\n📄 Original:\n${rawInput}`,
			options,
		);

		// Cancelled (Escape) or chose "Cancel and re-type"
		if (choice === undefined || choice === options[2]) {
			return { action: "handled" };
		}

		// Edit polished version
		if (choice === options[1]) {
			const edited = await ctx.ui.editor("Edit polished text:", polished);
			if (edited && edited.trim()) {
				return { action: "transform", text: edited.trim() };
			}
			return { action: "handled" };
		}

		// Accept polished
		return { action: "transform", text: polished };
	});
}
