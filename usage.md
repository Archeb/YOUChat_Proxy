# 使用方法

0. 安装 Node.JS

1. 获得一个 YOU.COM 账户并且订阅，登录。

2. 打开 F12（DevTools），找到 “Network（网络）”、刷新一下页面，找到“you.com”这个项目（或者“instrumentation”这个项目）

3. 点进去，往下滑找到 "Cookie"，完整的复制后面的内容。

4. 用同样的方法找到 "User-Agent"，完整的复制后面的内容。

5. 下载或Clone本项目代码，解压

6. 编辑 `config.example.js` 文件，把上面的 Cookie 和 User Agent 粘贴进去，如果有多个则按如下格式填入。然后另存为把文件名改为 `config.js`

```
module.exports = {
    "sessions": [
        {
            "user_agent": `...`,
            "cookie": `cookie1`
        },
        {
            "user_agent": `...`,
            "cookie": `cookie2`
        },
        {
            "user_agent": `...`,
            "cookie": `cookie3`
        }
    ]
}
```

7. （可选）如果需要，您可以仿照第6步在`start.bat`中设定一个名为 "PASSWORD" 的环境变量，并将其用作密码。如果没有定义该环境变量，程序将接受所有传入的请求，而不进行任何身份验证

    （可选）如果需要，可以设置代理。

    （可选）如果需要，可以启用自定义会话模式（`USE_CUSTOM_MODE`设置为`true`）。可以缩短原系统消息长度、禁用联网、减缓等待时间，可能有助于破限。但有可能导致更容易出现 unusual query volume。

8. 启动 start.bat

9. 酒馆中选择 **Custom (OpenAI-compatible)**，反向代理地址填 http://127.0.0.1:8080/v1 **反代密码必须填**，随便什么都可以（除非你在第7步设置了PASSWORD）。

10. 开始使用。如果失败了/没有结果/403/Warning 就多重试几次。

## 抓Cookie和填写格式图文说明

![image](https://github.com/Archeb/YOUChat_Proxy/assets/11910831/df34c2b8-5e9c-4004-ae79-c440e078dc0b)

![image](https://github.com/Archeb/YOUChat_Proxy/assets/11910831/301f7e24-a21e-4e08-837c-1150b23d0e54)

感谢 @amksenshu3915 做的图

## 使用代理

可以使用本地的socks5或http(s)代理。只需在 start.bat 中设置 `https_proxy` 环境变量。

比如，如要使用 Clash 的默认本地代理，则应设置为 `set https_proxy=http://127.0.0.1:7890`

欲知详细代理格式，请查阅 https://www.npmjs.com/package/proxy-from-env

## 注意事项

出现 403 错误请重新抓 COOKIE 或者更换代理出口 IP。


# Usage

0. Install Node.JS

1. Get a you.com account and subscribe, log in.

2. Open F12 (DevTools), find “Network”, refresh the page, and find “you.com” (or "instrumentation") entry.

3. Click on it, scroll down and find “Cookie:”, and copy the entire contents.

4. Find the "user-agent" in the same way.

5. Download or Clone the code of this project and unzip it.

6. Edit `config.example.js` as follow。And save the file as `config.js`

```
module.exports = {
    "sessions": [
        {
            "user_agent": `...`,
            "cookie": `cookie1`
        },
        {
            "user_agent": `...`,
            "cookie": `cookie2`
        },
        {
            "user_agent": `...`,
            "cookie": `cookie3`
        }
    ]
}
```

7. (Optional) you can set an environment variable named `PASSWORD` in `start.bat`, similar to Step 6, and use it as the password. If this environment variable is not defined, the program will accept all incoming requests without performing any authentication.
   
   (Optional) You can set the proxy in start.bat. See below.

   (Optional) You may turn on the custom chat mode by setting `USE_CUSTOM_MODE` env to `true`

8. Start start.bat

9. Select **Custom (OpenAI-compatible)** in the SillyTavern and ues http://127.0.0.1:8080/v1 as the endpoint of the reverse proxy. **Use any random string for password** (unless you set PASSWORD in step 7).

10. Select the model and Enjoy it. If it fails/no result/403/Warning, try again.

## Use custom proxy

Use the `https_proxy` env to set custom proxy. Refer to https://www.npmjs.com/package/proxy-from-env for detail.

## Reminder

If you get 403 errors, consider getting the cookie again or changing your IP.
