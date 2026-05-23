import sharp from "sharp";
import type { AppSettings } from "@shared/types";
import { hashString, parseSize } from "./utils";

interface GenerateImageArgs {
  prompt: string;
  size: string;
  transparentBackground: boolean;
  settings: AppSettings;
}

export class AIGenerationService {
  async generateImage(args: GenerateImageArgs): Promise<Buffer> {
    if (args.settings.aiProvider === "local-draft") {
      return this.generateLocalDraft(args.prompt, args.size);
    }

    if (args.settings.aiProvider === "custom") {
      return this.generateWithCustomProvider(args);
    }

    return this.generateWithOpenAI(args);
  }

  buildPrompt(parts: {
    assetType: string;
    name: string;
    description: string;
    style: string;
    size: string;
    extra?: string;
    transparentBackground: boolean;
  }): string {
    const background = parts.transparentBackground
      ? "Transparent background. Centered subject. No shadow floor, no text, no watermark."
      : "Clean game asset background.";

    return [
      `Create a game-ready 2D ${parts.assetType} sprite named ${parts.name}.`,
      `Description: ${parts.description}.`,
      `Style: ${parts.style}.`,
      `Target final sprite canvas: ${parts.size}.`,
      background,
      "Readable silhouette. Consistent proportions. Asset-isolated composition.",
      parts.extra ?? ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async generateWithOpenAI(args: GenerateImageArgs): Promise<Buffer> {
    if (!args.settings.apiKey.trim()) {
      throw new Error("OpenAI API Key 为空。请在设置页配置 API Key，或切换到本地草稿模式。");
    }

    const endpoint = args.settings.apiBaseUrl || "https://api.openai.com/v1/images/generations";
    this.assertHttpEndpoint(endpoint, "OpenAI API Base URL");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: args.settings.model || "gpt-image-1",
        prompt: args.prompt,
        n: 1,
        size: this.mapProviderSize(args.size),
        background: args.transparentBackground ? "transparent" : "opaque",
        output_format: "png",
        quality: args.settings.generationQuality
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenAI 图片生成失败: HTTP ${response.status} ${response.statusText}. ${this.summarizeBody(responseText)}`
      );
    }

    const payload = this.parseJsonResponse(responseText, {
      provider: "OpenAI",
      endpoint,
      status: response.status,
      contentType: response.headers.get("content-type") ?? ""
    });
    const image = payload.data?.[0];

    if (image?.b64_json) {
      return Buffer.from(image.b64_json, "base64");
    }

    if (image?.url) {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) {
        throw new Error(`下载 OpenAI 图片失败: HTTP ${imageResponse.status} ${imageResponse.statusText}`);
      }
      return Buffer.from(await imageResponse.arrayBuffer());
    }

    throw new Error("OpenAI 响应中没有 b64_json 或 url 图片数据。");
  }

  private async generateWithCustomProvider(args: GenerateImageArgs): Promise<Buffer> {
    if (!args.settings.apiBaseUrl.trim()) {
      throw new Error("自定义 API 地址为空。请在设置页配置 apiBaseUrl。");
    }

    const endpoint = args.settings.apiBaseUrl.trim();
    this.assertHttpEndpoint(endpoint, "自定义 API Base URL");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(args.settings.apiKey ? { Authorization: `Bearer ${args.settings.apiKey}` } : {})
      },
      body: JSON.stringify({
        prompt: args.prompt,
        size: args.size,
        model: args.settings.model,
        transparentBackground: args.transparentBackground
      })
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("image/")) {
      return Buffer.from(await response.arrayBuffer());
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `自定义图片 API 失败: HTTP ${response.status} ${response.statusText}. ${this.summarizeBody(responseText)}`
      );
    }

    const payload = this.parseJsonResponse(responseText, {
      provider: "自定义 API",
      endpoint,
      status: response.status,
      contentType
    });
    const b64 = payload.b64_json ?? payload.image ?? payload.data?.[0]?.b64_json;
    const url = payload.url ?? payload.data?.[0]?.url;

    if (b64) {
      return Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ""), "base64");
    }

    if (url) {
      const imageResponse = await fetch(url);
      if (!imageResponse.ok) {
        throw new Error(`下载自定义 API 图片失败: HTTP ${imageResponse.status} ${imageResponse.statusText}`);
      }
      return Buffer.from(await imageResponse.arrayBuffer());
    }

    throw new Error("自定义 API 响应不含 image / b64_json / url。");
  }

  private assertHttpEndpoint(endpoint: string, label: string): void {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(`${label} 不是有效 URL：${endpoint}`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`${label} 必须以 http:// 或 https:// 开头：${endpoint}`);
    }
  }

  private parseJsonResponse(
    responseText: string,
    context: { provider: string; endpoint: string; status: number; contentType: string }
  ): any {
    try {
      return JSON.parse(responseText);
    } catch {
      const responseKind = responseText.trimStart().startsWith("<") ? "HTML 页面" : "非 JSON 内容";
      throw new Error(
        `${context.provider} 返回了${responseKind}，无法解析图片结果。请检查设置页的 API Base URL 是否是图片生成接口，不要填网页地址。` +
          ` 当前 URL: ${context.endpoint}; HTTP ${context.status}; Content-Type: ${context.contentType || "unknown"}; ` +
          this.summarizeBody(responseText)
      );
    }
  }

  private summarizeBody(body: string): string {
    const summary = body.replace(/\s+/g, " ").trim().slice(0, 220);
    return summary ? `响应摘要: ${summary}` : "响应正文为空。";
  }

  private mapProviderSize(size: string): string {
    const { width, height } = parseSize(size);
    if (width > height) {
      return "1536x1024";
    }
    if (height > width) {
      return "1024x1536";
    }
    return "1024x1024";
  }

  private async generateLocalDraft(prompt: string, size: string): Promise<Buffer> {
    const { width, height } = parseSize(size);
    const canvasWidth = Math.max(width, 64);
    const canvasHeight = Math.max(height, 64);
    const hash = hashString(prompt);
    const hue = hash % 360;
    const accentHue = (hue + 127) % 360;
    const shadowHue = (hue + 220) % 360;
    const label = prompt.match(/named ([^\n.]+)/i)?.[1]?.slice(0, 10) ?? "draft";

    const blocks = Array.from({ length: 18 }, (_, index) => {
      const x = 10 + ((hash >> (index % 12)) & 31);
      const y = 12 + ((hash >> ((index + 4) % 12)) & 31);
      const blockSize = 4 + ((hash >> (index % 8)) & 7);
      const opacity = 0.45 + (((hash >> (index % 16)) & 7) / 20);
      const color = index % 3 === 0 ? accentHue : index % 3 === 1 ? hue : shadowHue;
      return `<rect x="${x}" y="${y}" width="${blockSize}" height="${blockSize}" fill="hsl(${color}, 72%, 58%)" opacity="${opacity.toFixed(
        2
      )}" />`;
    }).join("");

    const svg = `
      <svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" fill="transparent"/>
        <g shape-rendering="crispEdges">
          <rect x="18" y="15" width="28" height="34" rx="4" fill="hsl(${hue}, 60%, 42%)"/>
          <rect x="23" y="10" width="18" height="16" rx="4" fill="hsl(${accentHue}, 68%, 62%)"/>
          <rect x="16" y="36" width="32" height="9" fill="hsl(${shadowHue}, 52%, 32%)"/>
          <rect x="24" y="22" width="5" height="5" fill="#10131a"/>
          <rect x="35" y="22" width="5" height="5" fill="#10131a"/>
          ${blocks}
        </g>
        <text x="32" y="59" text-anchor="middle" font-size="5" font-family="monospace" fill="rgba(255,255,255,.82)">${this.escapeSvg(
          label
        )}</text>
      </svg>
    `;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  private escapeSvg(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
