import express from "express";
import { createEvent } from "./utils.mjs";
import YouProvider from "./provider.mjs";
import localtunnel from 'localtunnel';
const app = express();
const port = process.env.PORT || 8080;
const validApiKey = process.env.PASSWORD;
const availableModels = [
	"gpt_4o",
	"gpt_4_turbo",
	"gpt_4",
	"claude_3_5_sonnet",
	"claude_3_opus",
	"claude_3_sonnet",
	"claude_3_haiku",
	"claude_2",
	"llama3",
	"gemini_pro",
	"gemini_1_5_pro",
	"databricks_dbrx_instruct",
	"command_r",
	"command_r_plus",
	"zephyr",
];
const modelMappping = {
	"claude-3-5-sonnet-20240620": "claude_3_5_sonnet",
	"claude-3-20240229": "claude_3_opus",
	"claude-3-sonnet-20240229": "claude_3_sonnet",
	"claude-3-haiku-20240307": "claude_3_haiku",
	"claude-2.1": "claude_2",
	"claude-2.0": "claude_2",
	"gpt-4": "gpt_4",
	"gpt-4o": "gpt_4o",
	"gpt-4-turbo": "gpt_4_turbo",
};

// import config.mjs
try {
	var { config } = await import("./config.mjs");
} catch (e) {
	console.error(e);
	console.error("config.mjs 不存在或者有错误，请检查");
	process.exit(1);
}
var provider = new YouProvider(config);
await provider.init(config);

// handle preflight request
app.use((req, res, next) => {
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Max-Age", "86400");
        res.status(200).end();
    } else {
        next();
    }
});
// openai format model request
app.get("/v1/models", OpenAIApiKeyAuth, (req, res) => {
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Access-Control-Allow-Origin", "*");
	let models = availableModels.map((model, index) => {
		return {
			id: model,
			object: "model",
			created: 1700000000,
			owned_by: "closeai",
			name: model,
		};
	});
	res.json({ object: "list", data: models });
});
// handle openai format model request
app.post("/v1/chat/completions", OpenAIApiKeyAuth, (req, res) => {
	req.rawBody = "";
	req.setEncoding("utf8");

	req.on("data", function (chunk) {
		req.rawBody += chunk;
	});

	req.on("end", async () => {
		console.log("Handling request of OpenAI format");
		res.setHeader("Content-Type", "text/event-stream;charset=utf-8");
		res.setHeader("Access-Control-Allow-Origin", "*");
		let jsonBody = JSON.parse(req.rawBody);

		console.log("message length:" + jsonBody.messages.length);
		// decide which session to use randomly
		var randomSession = Object.keys(provider.sessions)[Math.floor(Math.random() * Object.keys(provider.sessions).length)];
		console.log("Using session " + randomSession);
		// call provider to get completion

		// try to map model
		if (jsonBody.model && modelMappping[jsonBody.model]) {
			jsonBody.model = modelMappping[jsonBody.model];
		}
		if (jsonBody.model && !availableModels.includes(jsonBody.model)) {
			res.json({ error: { code: 404, message: "Invalid Model" } });
			return;
		}
		console.log("Using model " + jsonBody.model);

		// call provider to get completion
		await provider
			.getCompletion(randomSession, jsonBody.messages, jsonBody.stream ? true : false, jsonBody.model, process.env.USE_CUSTOM_MODE == "true" ? true : false)
			.then(({ completion, cancel }) => {
				completion.on("start", (id) => {
					if (jsonBody.stream) {
						// send message start
						res.write(createEvent(":", "queue heartbeat 114514"));
						res.write(
							createEvent("data", {
								id: msgid,
								object: "chat.completion.chunk",
								created: Math.floor(new Date().getTime() / 1000),
								model: jsonBody.model,
								system_fingerprint: "114514",
								choices: [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }],
							})
						);
					}
				});

				completion.on("completion", (id, text) => {
					if (jsonBody.stream) {
						// send message delta
						res.write(
							createEvent("data", {
								choices: [
									{
										content_filter_results: {
											hate: { filtered: false, severity: "safe" },
											self_harm: { filtered: false, severity: "safe" },
											sexual: { filtered: false, severity: "safe" },
											violence: { filtered: false, severity: "safe" },
										},
										delta: { content: text },
										finish_reason: null,
										index: 0,
									},
								],
								created: Math.floor(new Date().getTime() / 1000),
								id: id,
								model: jsonBody.model,
								object: "chat.completion.chunk",
								system_fingerprint: "114514",
							})
						);
					} else {
						// 只会发一次，发送final response
						res.write(
							JSON.stringify({
								id: id,
								object: "chat.completion",
								created: Math.floor(new Date().getTime() / 1000),
								model: jsonBody.model,
								system_fingerprint: "114514",
								choices: [
									{
										index: 0,
										message: {
											role: "assistant",
											content: text,
										},
										logprobs: null,
										finish_reason: "stop",
									},
								],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									total_tokens: 1,
								},
							})
						);
						res.end();
					}
				});

				completion.on("end", () => {
					if (jsonBody.stream) {
						res.write(createEvent("data", "[DONE]"));
						res.end();
					}
				});

				res.on("close", () => {
					console.log(" > [Client closed]");
					completion.removeAllListeners();
					cancel();
				});
			})
			.catch((error) => {
				console.error(error);
				if (jsonBody.stream) {
					res.write(
						createEvent("data", {
							choices: [
								{
									content_filter_results: {
										hate: { filtered: false, severity: "safe" },
										self_harm: { filtered: false, severity: "safe" },
										sexual: { filtered: false, severity: "safe" },
										violence: { filtered: false, severity: "safe" },
									},
									delta: { content: "Error occurred, please check the log.\n\n出现错误，请检查日志：<pre>" + error.stack || error + "</pre>" },
									finish_reason: null,
									index: 0,
								},
							],
							created: Math.floor(new Date().getTime() / 1000),
							id: uuidv4(),
							model: jsonBody.model,
							object: "chat.completion.chunk",
							system_fingerprint: "114514",
						})
					);
					res.end();
				} else {
					res.write(
						JSON.stringify({
							id: uuidv4(),
							object: "chat.completion",
							created: Math.floor(new Date().getTime() / 1000),
							model: jsonBody.model,
							system_fingerprint: "114514",
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										content: "Error occurred, please check the log.\n\n出现错误，请检查日志：<pre>" + error.stack || error + "</pre>",
									},
									logprobs: null,
									finish_reason: "stop",
								},
							],
							usage: {
								prompt_tokens: 1,
								completion_tokens: 1,
								total_tokens: 1,
							},
						})
					);
					res.end();
				}
				return;
			});
	});
});
// handle anthropic format model request
app.post("/v1/messages", AnthropicApiKeyAuth, (req, res) => {
	req.rawBody = "";
	req.setEncoding("utf8");

	req.on("data", function (chunk) {
		req.rawBody += chunk;
	});

	req.on("end", async () => {
		console.log("Handling request of Anthropic format");
		res.setHeader("Content-Type", "text/event-stream;charset=utf-8");
		res.setHeader("Access-Control-Allow-Origin", "*");
		let jsonBody = JSON.parse(req.rawBody);
		if (jsonBody.system) {
			// 把系统消息加入messages的首条
			jsonBody.messages.unshift({ role: "system", content: jsonBody.system });
		}
		console.log("message length:" + jsonBody.messages.length);

		// decide which session to use randomly
		var randomSession = Object.keys(provider.sessions)[Math.floor(Math.random() * Object.keys(provider.sessions).length)];
		console.log("Using session " + randomSession);

		// decide which model to use
		if (process.env.AI_MODEL) {
			var proxyModel = process.env.AI_MODEL;
		} else if (jsonBody.model && modelMappping[jsonBody.model]) {
			var proxyModel = modelMappping[jsonBody.model];
		} else {
			var proxyModel = "claude_3_opus";
		}
		console.log("Using model " + proxyModel);

		// call provider to get completion
		await provider
			.getCompletion(randomSession, jsonBody.messages, jsonBody.stream ? true : false, proxyModel, process.env.USE_CUSTOM_MODE == "true" ? true : false)
			.then(({ completion, cancel }) => {
				completion.on("start", (id) => {
					if (jsonBody.stream) {
						// send message start
						res.write(
							createEvent("message_start", {
								type: "message_start",
								message: {
									id: `${id}`,
									type: "message",
									role: "assistant",
									content: [],
									model: proxyModel,
									stop_reason: null,
									stop_sequence: null,
									usage: { input_tokens: 8, output_tokens: 1 },
								},
							})
						);
						res.write(createEvent("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
						res.write(createEvent("ping", { type: "ping" }));
					}
				});

				completion.on("completion", (id, text) => {
					if (jsonBody.stream) {
						// send message delta
						res.write(
							createEvent("content_block_delta", {
								type: "content_block_delta",
								index: 0,
								delta: { type: "text_delta", text: text },
							})
						);
					} else {
						// 只会发一次，发送final response
						res.write(
							JSON.stringify({
								id: id,
								content: [
									{
										text: text,
									},
									{
										id: "string",
										name: "string",
										input: {},
									},
								],
								model: "string",
								stop_reason: "end_turn",
								stop_sequence: "string",
								usage: {
									input_tokens: 0,
									output_tokens: 0,
								},
							})
						);
						res.end();
					}
				});

				completion.on("end", () => {
					if (jsonBody.stream) {
						res.write(createEvent("content_block_stop", { type: "content_block_stop", index: 0 }));
						res.write(
							createEvent("message_delta", {
								type: "message_delta",
								delta: { stop_reason: "end_turn", stop_sequence: null },
								usage: { output_tokens: 12 },
							})
						);
						res.write(createEvent("message_stop", { type: "message_stop" }));
						res.end();
					}
				});

				res.on("close", () => {
					console.log(" > [Client closed]");
					completion.removeAllListeners();
					cancel();
				});
			})
			.catch((error) => {
				console.error(error);
				if (jsonBody.stream) {
					res.write(
						createEvent("content_block_delta", {
							type: "content_block_delta",
							index: 0,
							delta: {
								type: "text_delta",
								text: "Error occurred, please check the log.\n\n出现错误，请检查日志：<pre>" + error.stack || error + "</pre>",
							},
						})
					);
					res.end();
				} else {
					res.write(
						JSON.stringify({
							id: uuidv4(),
							content: [
								{
									text: "Error occurred, please check the log.\n\n出现错误，请检查日志：<pre>" + error.stack || error + "</pre>",
								},
								{
									id: "string",
									name: "string",
									input: {},
								},
							],
							model: "string",
							stop_reason: "end_turn",
							stop_sequence: "string",
							usage: {
								input_tokens: 0,
								output_tokens: 0,
							},
						})
					);
					res.end();
				}
				return;
			});
	});
});

// handle other
app.use((req, res, next) => {
	res.status(404).send("Not Found");
});

app.listen(port, async () => {
	console.log(`YouChat proxy listening on port ${port}`);
	if (!validApiKey) {
		console.log(`Proxy is currently running with no authentication`);
	}
	console.log(`Custom mode: ${process.env.USE_CUSTOM_MODE == "true" ? "enabled" : "disabled"}`);
	
    // 检查是否启用隧道
    if (process.env.ENABLE_TUNNEL === "true") {
        // 输出等待创建隧道的提示
        console.log("创建隧道中...");

        // 设置隧道配置
        const tunnelOptions = { port: port };
        if (process.env.SUBDOMAIN) {
            tunnelOptions.subdomain = process.env.SUBDOMAIN;
        }

        try {
            const tunnel = await localtunnel(tunnelOptions);
            console.log(`隧道已成功创建，可通过以下URL访问: ${tunnel.url}/v1`);

            tunnel.on('close', () => {
                console.log('已关闭隧道');
            });
        } catch (error) {
            console.error('创建隧道失败:', error);
        }
    }
});

function AnthropicApiKeyAuth(req, res, next) {
	const reqApiKey = req.header("x-api-key");

	if (validApiKey && reqApiKey !== validApiKey) {
		// If Environment variable PASSWORD is set AND x-api-key header is not equal to it, return 401
		const clientIpAddress = req.headers["x-forwarded-for"] || req.ip;
		console.log(`Receviced Request from IP ${clientIpAddress} but got invalid password.`);
		return res.status(401).json({ error: "Invalid Password" });
	}

	next();
}

function OpenAIApiKeyAuth(req, res, next) {
	const reqApiKey = req.header("Authorization");

	if (validApiKey && reqApiKey !== "Bearer " + validApiKey) {
		// If Environment variable PASSWORD is set AND Authorization header is not equal to it, return 401
		const clientIpAddress = req.headers["x-forwarded-for"] || req.ip;
		console.log(`Receviced Request from IP ${clientIpAddress} but got invalid password.`);
		return res.status(401).json({ error: { code: 403, message: "Invalid Password" } });
	}

	next();
}
