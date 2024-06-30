@echo off

REM 安装依赖包
call npm install

REM 设置是否启用隧道访问
set ENABLE_TUNNEL=false

REM 设置子域名(留空则为随机域名)
set SUBDOMAIN=

REM 设置 https_proxy 代理，可以使用本地的socks5或http(s)代理
REM 比如，如要使用 Clash 的默认本地代理，则应设置为 set https_proxy=http://127.0.0.1:7890
set https_proxy=

REM 设置 PASSWORD API密码
set PASSWORD=

REM 设置 PORT 端口
set PORT=8080

REM 设置AI模型(Claude系列模型直接在酒馆中选择即可使用，修改`AI_MODEL`环境变量可以切换Claude以外的模型，支持的模型名字如下 (请参考官网获取最新模型))
set AI_MODEL=

REM 自定义会话模式
set USE_CUSTOM_MODE=false

REM 运行 Node.js 应用程序
node index.mjs

REM 暂停脚本执行,等待用户按任意键退出
pause
