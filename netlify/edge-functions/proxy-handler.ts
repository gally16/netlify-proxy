import { Context } from "@netlify/edge-functions";
import { HTMLRewriter } from "https://ghuc.cc/worker-tools/html-rewriter/index.ts";

// 1. 定义你的路径映射表
const PROXY_MAP: Record<string, string> = {
  // API 服务器
  "/discord": "https://discord.com/api",
  "/telegram": "https://api.telegram.org",
  "/openai": "https://api.openai.com",
  "/claude": "https://api.anthropic.com",
  "/gemini": "https://generativelanguage.googleapis.com",
  "/meta": "https://www.meta.ai/api",
  "/groq": "https://api.groq.com/openai",
  "/xai": "https://api.x.ai",
  "/cohere": "https://api.cohere.ai",
  "/huggingface": "https://api-inference.huggingface.co",
  "/together": "https://api.together.xyz",
  "/novita": "https://api.novita.ai",
  "/portkey": "https://api.portkey.ai",
  "/fireworks": "https://api.fireworks.ai",
  "/openrouter": "https://openrouter.ai/api",
  // 任意网址
  "/hexo": "https://hexo-gally.vercel.app", 
  "/hexo2": "https://hexo-987.pages.dev",
  "/halo": "https://blog.gally.dpdns.org",
  "/kuma": "https://kuma.gally.dpdns.org",
  "/hf": "https://huggingface.co",
  "/tv": "https://tv.gally.ddns-ip.net",
  "/news": "https://newsnow-ahm.pages.dev"
};

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const path = url.pathname;

  let targetOrigin = "";
  let targetPath = "";

  // 2. 逻辑 A: 匹配固定别名映射
  for (const [prefix, origin] of Object.entries(PROXY_MAP)) {
    if (path.startsWith(prefix)) {
      targetOrigin = origin;
      targetPath = path.slice(prefix.length); // 提取前缀后的路径
      break;
    }
  }

  // 3. 逻辑 B: 匹配通用代理路径 /proxy/...
  if (!targetOrigin && path.startsWith("/proxy/")) {
    const rawTarget = path.slice(7); // 去掉 "/proxy/"
    try {
      // 修复可能缺失的 http/https 协议头
      const targetUrlString = rawTarget.startsWith("http") ? rawTarget : `https://${rawTarget}`;
      const fullTargetUrl = new URL(targetUrlString + url.search);
      targetOrigin = fullTargetUrl.origin;
      targetPath = fullTargetUrl.pathname + fullTargetUrl.search;
    } catch (e) {
      return new Response("Invalid Proxy URL", { status: 400 });
    }
  }

  // 如果都不匹配，交给 Netlify 处理（如展示首页）
  if (!targetOrigin) {
    return; 
  }

  // 4. 构建最终请求 URL
  const finalUrl = new URL(targetPath, targetOrigin);
  finalUrl.search = url.search; // 携带原始参数

  try {
    // 5. 构造请求头
    const headers = new Headers(request.headers);
    headers.set("Host", finalUrl.host);
    headers.set("Origin", finalUrl.origin);
    headers.set("Referer", finalUrl.origin);
    // 移除可能导致递归或被屏蔽的头
    headers.delete("cf-connecting-ip");
    headers.delete("x-forwarded-for");

    const response = await fetch(finalUrl.toString(), {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") || "";

    // 6. 核心步骤：针对 HTML 进行重写
    if (contentType.includes("text/html")) {
      return new HTMLRewriter()
        .on("head", {
          element(element) {
            // 注入 <base> 标签。这是解决网站样式、脚本代理后失效的灵魂操作
            // 它告诉浏览器：所有相对路径（如 /style.css）都去原始网站下找，不要找我的 Netlify
            element.prepend(`<base href="${targetOrigin}/">`, { html: true });
          },
        })
        .on("a", {
          element(element) {
            // 可选：如果希望点击链接后依然保持代理，可以在这里处理
          }
        })
        .transform(response);
    }

    // 7. 处理 API 和其他资源（CSS/JS/图片）
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*"); // 允许跨域
    newHeaders.delete("Content-Security-Policy");        // 移除安全限制，允许脚本运行
    newHeaders.delete("X-Frame-Options");               // 允许被嵌入

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });

  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
};

// 匹配所有路径，由内部逻辑判断
export const config = {
  path: "/*",
};
