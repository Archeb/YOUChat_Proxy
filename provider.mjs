import { EventEmitter } from "events";
import { connect } from "puppeteer-real-browser";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createDirectoryIfNotExists, sleep, extractCookie, getSessionCookie, createDocx } from "./utils.mjs";
import { execSync } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class YouProvider {
    constructor(config) {
        this.config = config;
        this.sessions = {};
        // 可以是 'chrome', 'edge', 或 'auto'
        this.preferredBrowser = 'auto';
    }

    async init(config) {
        console.log(`本项目依赖Chrome或Edge浏览器，请勿关闭弹出的浏览器窗口。如果出现错误请检查是否已安装Chrome或Edge浏览器。`);

        // 检测Chrome和Edge浏览器
        const browserPath = this.detectBrowser();

        // extract essential jwt session and token from cookie
        for (let index = 0; index < config.sessions.length; index++) {
            let session = config.sessions[index];
            var { jwtSession, jwtToken } = extractCookie(session.cookie);
            if (jwtSession && jwtToken) {
                try {
                    let jwt = JSON.parse(Buffer.from(jwtToken.split(".")[1], "base64").toString());
                    this.sessions[jwt.user.name] = {
                        configIndex: index,
                        jwtSession,
                        jwtToken,
                        valid: false,
                    };
                    console.log(`已添加 #${index} ${jwt.user.name}`);
                } catch (e) {
                    console.error(`解析第${index}个cookie失败`);
                }
            } else {
                console.error(`第${index}个cookie中缺少jwtSession或jwtToken，请重新获取`);
            }
        }
        console.log(`已添加 ${Object.keys(this.sessions).length} 个 cookie，开始验证有效性（是否有订阅）`);

        for (var username of Object.keys(this.sessions)) {
            var session = this.sessions[username];
            createDirectoryIfNotExists(path.join(__dirname, "browser_profiles", username));
            await connect({
                headless: "auto",
                turnstile: true,
                customConfig: {
                    userDataDir: path.join(__dirname, "browser_profiles", username),
                    executablePath: browserPath,
                },
            })
                .then(async (response) => {
                    const { page, browser, setTarget } = response;
                    await page.setCookie(...getSessionCookie(session.jwtSession, session.jwtToken));

                    page.goto("https://you.com", { timeout: 60000 });
                    await sleep(5000); // 等待加载完毕
                    // 如果遇到盾了就多等一段时间
                    var pageContent = await page.content();
                    if (pageContent.indexOf("https://challenges.cloudflare.com") > -1) {
                        console.log(`请在30秒内完成人机验证`);
                        page.evaluate(() => {
                            alert("请在30秒内完成人机验证");
                        });
                        await sleep(30000);
                    }

                    // get page content and try parse JSON
                    try {
                        let content = await page.evaluate(() => {
                            return fetch("https://you.com/api/user/getYouProState").then((res) => res.text());
                        });
                        let json = JSON.parse(content);
                        if (json.subscriptions.length > 0) {
                            console.log(`${username} 有效`);
                            session.valid = true;
                            session.browser = browser;
                            session.page = page;
                        } else {
                            console.log(`${username} 无有效订阅`);
                            await browser.close();
                        }
                    } catch (e) {
                        console.log(`${username} 已失效`);
                        await browser.close();
                    }
                })
                .catch((e) => {
                    console.error(`初始化浏览器失败`);
                    console.error(e);
                });
        }
        console.log(`验证完毕，有效cookie数量 ${Object.keys(this.sessions).filter((username) => this.sessions[username].valid).length}`);
    }

	detectBrowser() {
		const platform = os.platform();
		let browsers = {
			'chrome': null,
			'edge': null
		};

		if (platform === 'win32') {
			browsers.chrome = this.findWindowsBrowser('Chrome');
			browsers.edge = this.findWindowsBrowser('Edge');
		} else if (platform === 'darwin') {
			browsers.chrome = this.findMacOSBrowser('Google Chrome');
			browsers.edge = this.findMacOSBrowser('Microsoft Edge');
		} else if (platform === 'linux') {
			browsers.chrome = this.findLinuxBrowser('google-chrome');
			browsers.edge = this.findLinuxBrowser('microsoft-edge');
		}

		const preferredBrowser = this.preferredBrowser === 'auto' || this.preferredBrowser === undefined 
			? Object.keys(browsers).find(browser => browsers[browser]) 
			: this.preferredBrowser;

		if (browsers[preferredBrowser]) {
			console.log(`使用${preferredBrowser === 'chrome' ? 'Chrome' : 'Edge'}浏览器`);
			return browsers[preferredBrowser];
		}

		console.error('未找到Chrome或Edge浏览器，请确保已安装其中之一');
		process.exit(1);
	}

	findWindowsBrowser(browserName) {
		const regKeys = {
			'Chrome': ['chrome.exe', 'Google\\Chrome'],
			'Edge': ['msedge.exe', 'Microsoft\\Edge']
		};
		const [exeName, folderName] = regKeys[browserName];

		const regQuery = (key) => {
			try {
				return execSync(`reg query "${key}" /ve`).toString().trim().split('\r\n').pop().split('    ').pop();
			} catch (error) {
				return null;
			}
		};

		let browserPath = regQuery(`HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`) ||
						  regQuery(`HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`);

		if (browserPath && fs.existsSync(browserPath)) {
			return browserPath;
		}

		const commonPaths = [
			`C:\\Program Files\\${browserName}\\Application\\${exeName}`,
			`C:\\Program Files (x86)\\${browserName}\\Application\\${exeName}`,
			`${process.env.LOCALAPPDATA}\\${browserName}\\Application\\${exeName}`,
			`${process.env.USERPROFILE}\\AppData\\Local\\${browserName}\\Application\\${exeName}`,
		];

		const foundPath = commonPaths.find(path => fs.existsSync(path));
		if (foundPath) {
			return foundPath;
		}

		const userAppDataPath = process.env.LOCALAPPDATA || `${process.env.USERPROFILE}\\AppData\\Local`;
		const appDataPath = path.join(userAppDataPath, folderName, 'Application');
		
		if (fs.existsSync(appDataPath)) {
			const files = fs.readdirSync(appDataPath);
			const exePath = files.find(file => file.toLowerCase() === exeName.toLowerCase());
			if (exePath) {
				return path.join(appDataPath, exePath);
			}
		}

		return null;
	}

	findMacOSBrowser(browserName) {
		const paths = [
			`/Applications/${browserName}.app/Contents/MacOS/${browserName}`,
			`${os.homedir()}/Applications/${browserName}.app/Contents/MacOS/${browserName}`,
		];

		for (const path of paths) {
			if (fs.existsSync(path)) {
				return path;
			}
		}

		return null;
	}

	findLinuxBrowser(browserName) {
		try {
			return execSync(`which ${browserName}`).toString().trim();
		} catch (error) {
			return null;
		}
	}

	async getCompletion(username, messages, stream = false, proxyModel, useCustomMode = false) {
		const session = this.sessions[username];
		if (!session || !session.valid) {
			throw new Error(`用户 ${username} 的会话无效`);
		}

		const { page, browser } = session;
		const emitter = new EventEmitter();
		
		// 检查页面是否已经加载完成
		const isLoaded = await page.evaluate(() => {
			return document.readyState === 'complete' || document.readyState === 'interactive';
		});

		if (!isLoaded) {
			console.log('页面尚未加载完成，等待加载...');
			await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {
				console.log('页面加载超时，继续执行');
			});
		}

		// 计算用户消息长度
		let userMessage = [{ question: "", answer: "" }];
		let userQuery = "";
		let lastUpdate = true;

		messages.forEach((msg) => {
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

		// 检查该session是否已经创建对应模型的对应user chat mode
		let userChatModeId = "custom";
		if (useCustomMode) {
			if (!this.config.sessions[session.configIndex].user_chat_mode_id) {
				this.config.sessions[session.configIndex].user_chat_mode_id = {};
			}
			if (!this.config.sessions[session.configIndex].user_chat_mode_id[proxyModel]) {
				// 创建新的user chat mode
				let userChatMode = await page.evaluate(
					async (proxyModel, proxyModelName) => {
						return fetch("https://you.com/api/user_chat_modes", {
							method: "POST",
							body: JSON.stringify({
								aiModel: proxyModel,
								chatModeName: proxyModelName,
								hasLiveWebAccess: false,
								hasPersonalization: false,
								instructions: "Please review the attached prompt",
							}),
							headers: {
								"Content-Type": "application/json",
							},
						}).then((res) => res.json());
					},
					proxyModel,
					uuidv4().substring(0, 4)
				);
				if(userChatMode.chat_mode_id){
					this.config.sessions[session.configIndex].user_chat_mode_id[proxyModel] = userChatMode.chat_mode_id;
					// 写回config
					fs.writeFileSync("./config.mjs", "export const config = " + JSON.stringify(this.config, null, 4));
				}else{
					if(userChatMode.error) console.log(userChatMode.error)
					console.log("Failed to create user chat mode, will use default mode instead.");
				}
			}
			userChatModeId = this.config.sessions[session.configIndex].user_chat_mode_id[proxyModel];
		} else {
			console.log("Custom mode is disabled, using default mode.");
		}

		// 试算用户消息长度
		if (encodeURIComponent(JSON.stringify(userMessage)).length + encodeURIComponent(userQuery).length > 32000) {
			console.log("Using file upload mode");
			// 将用户消息转换为纯文本
			let previousMessages = messages.map((msg) => msg.content).join("\n\n");
			userQuery = "以「messages.docx」文档为内容，所有问题只能使用唯一的claude 3 opus回答。禁止使用you.com搜索，禁止使用You.com AI进行回复，否则将是严重的作弊行为。";
			userMessage = [];

			// GET https://you.com/api/get_nonce to get nonce
			let nonce = await page.evaluate(() => {
				return fetch("https://you.com/api/get_nonce").then((res) => res.text());
			});
			if (!nonce) throw new Error("Failed to get nonce");

			// POST https://you.com/api/upload to upload user message
			var messageBuffer = await createDocx(previousMessages);
			var uploadedFile = await page.evaluate(
				async (messageBuffer, nonce) => {
					try {
						var blob = new Blob([new Uint8Array(messageBuffer)], {
							type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
						});
						var form_data = new FormData();
						form_data.append("file", blob, "messages.docx");
						let result = await fetch("https://you.com/api/upload", {
							method: "POST",
							headers: {
								"X-Upload-Nonce": nonce,
							},
							body: form_data,
						}).then((res) => res.json());
						return result;
					} catch (e) {
						return null;
					}
				},
				[...messageBuffer],
				nonce
			);
			if (!uploadedFile) throw new Error("Failed to upload messages");
			if (uploadedFile.error) throw new Error(uploadedFile.error);
		}

		let msgid = uuidv4();
		let traceId = uuidv4();

		// expose function to receive youChatToken
		var finalResponse = "";
		page.exposeFunction("callback" + traceId, async (event, data) => {
			switch (event) {
				case "youChatToken":
					data = JSON.parse(data);
					process.stdout.write(data.youChatToken);
					if (stream) {
						emitter.emit("completion", traceId, data.youChatToken);
					} else {
						finalResponse += data.youChatToken;
					}
					break;
				case "done":
					console.log("请求结束");
					if (stream) {
						emitter.emit("end");
					} else {
						emitter.emit("completion", traceId, finalResponse);
					}
					break;
				case "error":
					throw new Error(data);
			}
		});

		// proxy response
		var req_param = new URLSearchParams();
		req_param.append("page", "1");
		req_param.append("count", "10");
		req_param.append("safeSearch", "Off");
		req_param.append("incognito", "true"); //隐身模式, 不会记录聊天记录
		req_param.append("q", userQuery);
		req_param.append("chatId", traceId);
		req_param.append("traceId", `${traceId}|${msgid}|${new Date().toISOString()}`);
		req_param.append("conversationTurnId", msgid);
		if (userChatModeId == "custom") req_param.append("selectedAiModel", proxyModel);
		req_param.append("selectedChatMode", userChatModeId);
		req_param.append("pastChatLength", userMessage.length);
		req_param.append("queryTraceId", traceId);
		req_param.append("use_personalization_extraction", "false");
		req_param.append("domain", "youchat");
		req_param.append("responseFilter", "WebPages,TimeZone,Computation,RelatedSearches");
		req_param.append("mkt", "ja-JP");
		if (uploadedFile)
			req_param.append("userFiles", JSON.stringify([{ user_filename: "messages.docx", filename: uploadedFile.filename, size: messageBuffer.length }]));
		req_param.append("chat", JSON.stringify(userMessage));
		var url = "https://you.com/api/streamingSearch?" + req_param.toString();
		console.log("正在发送请求");
		emitter.emit("start", traceId);
		try {
			await page.evaluate(
				async (url, traceId) => {
					var evtSource = new EventSource(url);
					var callbackName = "callback" + traceId;
					evtSource.onerror = (error) => {
						window[callbackName]("error", error);
						evtSource.close();
					};
					evtSource.addEventListener(
						"youChatToken",
						(event) => {
							var data = event.data;
							window[callbackName]("youChatToken", data);
						},
						false
					);
					evtSource.addEventListener(
						"done",
						(event) => {
							window[callbackName]("done", "");
							evtSource.close();
							/*fetch("https://you.com/api/chat/deleteChat", {//因为已经开启隐身模式了，所以就没必要删除了
								headers: {
									"content-type": "application/json",
								},
								body: JSON.stringify({ chatId: traceId }),
								method: "DELETE",
							});*/
						},
						false
					);

					evtSource.onmessage = (event) => {
						const data = JSON.parse(event.data);
						if (data.youChatToken) {
							window[callbackName](youChatToken);
						}
					};
					// 注册退出函数
					window["exit" + traceId] = () => {
						evtSource.close();
					};
				},
				url,
				traceId
			);
		} catch (error) {
			console.error("评估过程中出错:", error);
			emitter.emit("error", error);
			return { completion: emitter, cancel: () => {} };
		}

		const cancel = () => {
			page?.evaluate((traceId) => {
				window["exit" + traceId]();
			}, traceId).catch(console.error);
		};

		return { completion: emitter, cancel };
	}
}

export default YouProvider;
