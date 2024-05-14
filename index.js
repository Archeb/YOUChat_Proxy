const express = require("express");
const FormData = require("form-data");
const docx = require("docx");
const { v4: uuidv4 } = require("uuid");
const app = express();
const axios = require("axios");
const port = 8080;
const validApiKey = process.env.PASSWORD;

// import config.js
try {
	var config = require("./config.js");
} catch (e) {
	console.error("Missing config.js, create it from config.example.js and fill in the values.");
	process.exit(1);
}


app.post("/v1/messages", apiKeyAuth, (req, res) => {
	req.rawBody = "";
	req.setEncoding("utf8");

	req.on("data", function (chunk) {
		req.rawBody += chunk;
	});

	req.on("end", async () => {
		res.setHeader("Content-Type", "text/event-stream;charset=utf-8");
		try {
			let jsonBody = JSON.parse(req.rawBody);
			if (jsonBody.stream == false) {
				res.send(
					JSON.stringify({
						id: uuidv4(),
						content: [
							{
								text: "Please turn on streaming.",
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
			} else if (jsonBody.stream == true) {
				// 计算用户消息长度
				let userMessage = [{ question: "", answer: "" }];
				let userQuery = "";
				let lastUpdate = true;
				if (jsonBody.system) {
					// 把系统消息加入messages的首条
					jsonBody.messages.unshift({ role: "system", content: jsonBody.system });
				}
				console.log("message length:" + jsonBody.messages.length);
				jsonBody.messages.forEach((msg) => {
					if (msg.role == "system" || msg.role == "user") {
						if (lastUpdate) {
							userMessage[userMessage.length - 1].question += msg.content + "\n";
						} else if (userMessage[userMessage.length - 1].question == "") {
							userMessage[userMessage.length - 1].question += msg.content + "\n";
						} else {
							userMessage.push({ question: msg.content + "\n", answer: "" });
						}
						lastUpdate = true;
					} else if (msg.role == "assistant") {
						if (!lastUpdate) {
							userMessage[userMessage.length - 1].answer += msg.content + "\n";
						} else if (userMessage[userMessage.length - 1].answer == "") {
							userMessage[userMessage.length - 1].answer += msg.content + "\n";
						} else {
							userMessage.push({ question: "", answer: msg.content + "\n" });
						}
						lastUpdate = false;
					}
				});
				userQuery = userMessage[userMessage.length - 1].question;

				var traceId=uuidv4();

				// decide which session to use randomly
				let sessionIndex = Math.floor(Math.random() * config.sessions.length);
				var session = config.sessions[sessionIndex];
				console.log("using session " + sessionIndex);
				var instance = axios.create({
					headers: {
						"User-Agent": session.user_agent,
						"Cookie": session.cookie,
					},
				});

				// 试算用户消息长度
				if(encodeURIComponent(JSON.stringify(userMessage)).length + encodeURIComponent(userQuery).length > 32000) {
					//太长了，需要上传

					// user message to plaintext
					let previousMessages = jsonBody.messages
						.map((msg) => {
							return msg.content
						})
						.join("\n\n");

					userQuery = "Please view the document and reply.";
					userMessage = [];

					// GET https://you.com/api/get_nonce to get nonce
					let nonce = await instance("https://you.com/api/get_nonce").then((res) => res.data);
					if (!nonce) throw new Error("Failed to get nonce");

					// POST https://you.com/api/upload to upload user message
					const form_data = new FormData();
					var messageBuffer = await createDocx(previousMessages);
					form_data.append("file", messageBuffer, { filename: "messages.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
					var uploadedFile = await instance
						.post("https://you.com/api/upload", form_data, {
							headers: {
								...form_data.getHeaders(),
								"X-Upload-Nonce": nonce,
							},
						})
						.then((res) => res.data.filename);
					if (!uploadedFile) throw new Error("Failed to upload messages");
				}

				let msgid = uuidv4();

				// send message start
				res.write(
					createEvent("message_start", {
						type: "message_start",
						message: {
							id: `${traceId}`,
							type: "message",
							role: "assistant",
							content: [],
							model: "claude-3-opus-20240229",
							stop_reason: null,
							stop_sequence: null,
							usage: { input_tokens: 8, output_tokens: 1 },
						},
					})
				);
				res.write(createEvent("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
				res.write(createEvent("ping", { type: "ping" }));

				// proxy response

				var proxyReq = await instance
					.get("https://you.com/api/streamingSearch", {
						params: {
							page: "1",
							count: "10",
							safeSearch: "Off",
							q: userQuery.trim(),
							incognito: "true",
							chatId: traceId,
							traceId: `${traceId}|${msgid}|${new Date().toISOString()}`,
							conversationTurnId: msgid,
							selectedAiModel: "claude_3_opus",
							selectedChatMode: "custom",
							pastChatLength: userMessage.length,
							queryTraceId: traceId,
							use_personalization_extraction: "false",
							domain: "youchat",
							responseFilter: "WebPages,TimeZone,Computation,RelatedSearches",
							mkt: "zh-CN",
							userFiles: uploadedFile
								? JSON.stringify([
										{
											user_filename: "messages.docx",
											filename: uploadedFile,
											size: messageBuffer.length,
										},
								  ])
								: "",
							chat: JSON.stringify(userMessage),
						},
						headers: {
							accept: "text/event-stream",
							referer: "https://you.com/search?q=&fromSearchBar=true&tbm=youchat&chatMode=custom"
						},
						responseType: "stream",
					})
					.catch((e) => {
						if(e?.response?.data) {
							// print data
							e.response.data.on("data", (chunk) => {
								console.log(chunk.toString());
							}
							);
						}else{
							throw e;
						}
					});

				let cachedLine = "";
				const stream = proxyReq.data;
				stream.on("data", (chunk) => {
					// try to parse eventstream chunk
					chunk = chunk.toString();

					if (cachedLine) {
						chunk = cachedLine + chunk;
						cachedLine = "";
					}

					if (!chunk.endsWith("\n")) {
						const lines = chunk.split("\n");
						cachedLine = lines.pop();
						chunk = lines.join("\n");
					}

					try {
						if (chunk.indexOf("event: youChatToken\n") != -1) {
							chunk.split("\n").forEach((line) => {
								if (line.startsWith(`data: {"youChatToken"`)) {
									let data = line.substring(6);
									let json = JSON.parse(data);
									process.stdout.write(json.youChatToken);
									chunkJSON = JSON.stringify({
										type: "content_block_delta",
										index: 0,
										delta: { type: "text_delta", text: json.youChatToken },
									});
									res.write(createEvent("content_block_delta", chunkJSON));
								}
							});
						}else{
							console.log(chunk);
						}
					} catch (e) {
						console.log(e);
					}
				});

				res.on("close", function () {
					console.log(" > [Client closed]");
					if (stream && typeof stream.destroy === 'function') {
						stream.destroy();
					}
				});

				stream.on("end", () => {
					// send ending
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
				});
			} else {
				throw new Error("Invalid request");
			}
		} catch (e) {
			console.log(e);
			res.write(JSON.stringify({ error: e.message }));
			res.end();
			return;
		}
	});
});

// handle other
app.use((req, res, next) => {
	res.status(404).send("Not Found");
});

app.listen(port, () => {
	console.log(`YouChat proxy listening on port ${port}`);
	if (!validApiKey) {
		console.log(`Proxy is currently running with no authentication`)
	}
});

function apiKeyAuth(req, res, next) {
	const reqApiKey = req.header('x-api-key');

	if (validApiKey && (reqApiKey !== validApiKey)) {
		// If Environment variable PASSWORD is set AND x-api-key header is not equal to it, return 401
		const clientIpAddress = req.headers['x-forwarded-for'] || req.ip;
		console.log(`Receviced Request from IP ${clientIpAddress} but got invalid password.`);
		return res.status(401).json({error: 'Invalid Password'});
	}

	next();
}

// eventStream util
function createEvent(event, data) {
	// if data is object, stringify it
	if (typeof data === "object") {
		data = JSON.stringify(data);
	}
	return `event: ${event}\ndata: ${data}\n\n`;
}

function createDocx(content) {
	var paragraphs = [];
	content.split("\n").forEach((line) => {
	paragraphs.push(new docx.Paragraph({
		children: [
			new docx.TextRun(line),
		],
	}));
});
	var doc = new docx.Document({
		sections: [
			{
				properties: {},
				children:
					paragraphs
				,
			},
		],
	});
	return docx.Packer.toBuffer(doc).then((buffer) => buffer);
}
