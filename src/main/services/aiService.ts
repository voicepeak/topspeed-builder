import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import type { AppSettings, EditIntent, ReferenceImageRole, ReferenceStrength } from "@shared/types";
import { hashString, parseSize } from "./utils";

interface ReferenceImagePayload {
  filePath: string;
  role: ReferenceImageRole;
  name?: string;
  sourceAssetId?: string;
}

interface GenerateImageArgs {
  prompt: string;
  size: string;
  transparentBackground: boolean;
  settings: AppSettings;
  referenceImages?: ReferenceImagePayload[];
  maskImagePath?: string;
  editIntent?: EditIntent;
  referenceStrength?: ReferenceStrength;
}

export class AIGenerationService {
  async generateImage(args: GenerateImageArgs): Promise<Buffer> {
    if (args.settings.aiProvider === "local-draft") {
      return this.generateLocalDraft(args.prompt, args.size, args.referenceImages);
    }

    if (args.settings.aiProvider === "custom") {
      return this.generateWithCustomProvider(args);
    }

    if ((args.referenceImages?.length ?? 0) > 0 || args.maskImagePath) {
      return this.generateWithOpenAIEdit(args);
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
      ? "透明背景，主体居中，不要地面阴影，不要文字，不要水印。"
      : "干净的游戏素材背景。";

    return [
      `生成可直接用于游戏工程的二维${parts.assetType}精灵，名称为：${parts.name}。`,
      `素材描述：${parts.description}。`,
      `美术风格：${parts.style}。`,
      `最终画布尺寸：${parts.size}。`,
      background,
      "轮廓必须清晰可读，比例保持一致，构图只包含当前素材主体。",
      parts.extra ?? ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async generateWithOpenAI(args: GenerateImageArgs): Promise<Buffer> {
    if (!args.settings.apiKey.trim()) {
      throw new Error("OpenAI 接口密钥为空。请在设置页配置接口密钥，或切换到本地草稿模式。");
    }

    const endpoint = this.resolveOpenAIImageEndpoint(args.settings.apiBaseUrl, "generations");
    this.assertHttpEndpoint(endpoint, "OpenAI 接口基础地址");
    const requestPayload: Record<string, unknown> = {
      model: args.settings.model || "gpt-image-1.5",
      prompt: args.prompt,
      n: 1,
      size: this.mapProviderSize(args.size),
      quality: args.settings.generationQuality,
      background: args.transparentBackground ? "transparent" : "auto"
    };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload)
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenAI 图片生成失败：HTTP ${response.status} ${response.statusText}. ${this.summarizeBody(responseText)}`
      );
    }

    return this.extractImageFromPayload(
      this.parseJsonResponse(responseText, {
      provider: "OpenAI",
      endpoint,
      status: response.status,
      contentType: response.headers.get("content-type") ?? ""
      }),
      "OpenAI"
    );
  }

  private async generateWithOpenAIEdit(args: GenerateImageArgs): Promise<Buffer> {
    if (!args.settings.apiKey.trim()) {
      throw new Error("OpenAI 接口密钥为空。请在设置页配置接口密钥，或切换到本地草稿模式。");
    }

    const references = args.referenceImages ?? [];
    if (references.length === 0) {
      throw new Error("图生图需要至少一张参考图。");
    }

    const endpoint = this.resolveOpenAIImageEndpoint(args.settings.apiBaseUrl, "edits");
    this.assertHttpEndpoint(endpoint, "OpenAI 接口基础地址");

    const form = new FormData();
    form.append("model", args.settings.model || "gpt-image-1.5");
    form.append("prompt", args.prompt);
    form.append("n", "1");
    form.append("size", this.mapProviderSize(args.size));
    form.append("quality", args.settings.generationQuality);
    form.append("background", args.transparentBackground ? "transparent" : "auto");
    if (args.referenceStrength === "high") {
      form.append("input_fidelity", "high");
    }

    for (const reference of references) {
      form.append("image", await this.fileToBlob(reference.filePath), path.basename(reference.filePath));
    }

    if (args.maskImagePath) {
      form.append("mask", await this.fileToBlob(args.maskImagePath), path.basename(args.maskImagePath));
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.settings.apiKey}`
      },
      body: form
    });

    return this.readImageResponse(response, "OpenAI", endpoint);
  }

  private async generateWithCustomProvider(args: GenerateImageArgs): Promise<Buffer> {
    if (!args.settings.apiBaseUrl.trim()) {
      throw new Error("自定义接口地址为空。请在设置页配置接口基础地址。");
    }

    const endpoint = args.settings.apiBaseUrl.trim();
    this.assertHttpEndpoint(endpoint, "自定义接口基础地址");

    if ((args.referenceImages?.length ?? 0) > 0 || args.maskImagePath) {
      const form = new FormData();
      form.append("prompt", args.prompt);
      form.append("size", args.size);
      form.append("model", args.settings.model);
      form.append("transparentBackground", String(args.transparentBackground));
      form.append("editIntent", args.editIntent ?? "");
      form.append("referenceStrength", args.referenceStrength ?? "");
      form.append(
        "referenceImages",
        JSON.stringify(
          (args.referenceImages ?? []).map((reference) => ({
            role: reference.role,
            name: reference.name,
            sourceAssetId: reference.sourceAssetId
          }))
        )
      );

      for (const reference of args.referenceImages ?? []) {
        form.append("image", await this.fileToBlob(reference.filePath), path.basename(reference.filePath));
      }

      if (args.maskImagePath) {
        form.append("mask", await this.fileToBlob(args.maskImagePath), path.basename(args.maskImagePath));
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...(args.settings.apiKey ? { Authorization: `Bearer ${args.settings.apiKey}` } : {})
        },
        body: form
      });

      return this.readImageResponse(response, "自定义接口", endpoint);
    }

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

    return this.readImageResponse(response, "自定义接口", endpoint);
  }

  private resolveOpenAIImageEndpoint(input: string, mode: "generations" | "edits"): string {
    const fallback = "https://api.openai.com/v1/images/generations";
    const raw = input.trim() || fallback;
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/g, "");

    if (path === "" || path === "/") {
      url.pathname = `/v1/images/${mode}`;
      return url.toString();
    }

    if (path === "/v1") {
      url.pathname = `${path}/images/${mode}`;
      return url.toString();
    }

    if (path.endsWith("/images/generations") || path.endsWith("/images/edits")) {
      url.pathname = path.replace(/\/images\/(?:generations|edits)$/g, `/images/${mode}`);
      return url.toString();
    }

    return url.toString();
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
        `${context.provider} 返回了${responseKind}，无法解析图片结果。请检查设置页的接口基础地址是否是图片生成接口，不要填网页地址。` +
          ` 当前 URL: ${context.endpoint}; HTTP ${context.status}; Content-Type: ${context.contentType || "未知"}; ` +
          this.summarizeBody(responseText)
      );
    }
  }

  private async readImageResponse(response: Response, provider: string, endpoint: string): Promise<Buffer> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("image/")) {
      if (!response.ok) {
        throw new Error(`${provider} 图片接口失败: HTTP ${response.status} ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `${provider} 图片接口失败: HTTP ${response.status} ${response.statusText}. ${this.summarizeBody(responseText)}`
      );
    }

    return this.extractImageFromPayload(
      this.parseJsonResponse(responseText, {
        provider,
        endpoint,
        status: response.status,
        contentType
      }),
      provider
    );
  }

  private async extractImageFromPayload(payload: any, provider: string): Promise<Buffer> {
    const image = payload.data?.[0] ?? payload;
    const b64 = image?.b64_json ?? image?.image ?? payload.b64_json ?? payload.image;
    const url = image?.url ?? payload.url;

    if (b64) {
      return Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ""), "base64");
    }

    if (url) {
      const imageResponse = await fetch(url);
      if (!imageResponse.ok) {
        throw new Error(`下载${provider}图片失败: HTTP ${imageResponse.status} ${imageResponse.statusText}`);
      }
      return Buffer.from(await imageResponse.arrayBuffer());
    }

    throw new Error(`${provider} 响应中没有可解析的图片数据。`);
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

  private async fileToBlob(filePath: string): Promise<Blob> {
    const buffer = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const type = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    return new Blob([buffer], { type });
  }

  private async generateLocalDraft(prompt: string, size: string, referenceImages?: ReferenceImagePayload[]): Promise<Buffer> {
    const { width, height } = parseSize(size);
    const canvasWidth = Math.max(width, 64);
    const canvasHeight = Math.max(height, 64);
    const hash = hashString(prompt);
    const hue = hash % 360;
    const accentHue = (hue + 127) % 360;
    const shadowHue = (hue + 220) % 360;
    const label = (prompt.match(/名称为：([^。\n]+)/)?.[1] ?? prompt.match(/named ([^\n.]+)/i)?.[1] ?? "草稿").slice(0, 10);

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

    const draft = await sharp(Buffer.from(svg)).png().toBuffer();
    const firstReference = referenceImages?.[0];
    if (!firstReference) {
      return draft;
    }

    try {
      const reference = await sharp(firstReference.filePath)
        .ensureAlpha()
        .resize({
          width: canvasWidth,
          height: canvasHeight,
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .modulate({ brightness: 0.92, saturation: 0.75 })
        .png()
        .toBuffer();

      const badge = await sharp(
        Buffer.from(`
          <svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="30" height="12" rx="3" fill="rgba(0, 212, 255, .68)"/>
            <text x="17" y="10.5" text-anchor="middle" font-size="7" font-family="monospace" fill="#071013">参考</text>
          </svg>
        `)
      )
        .png()
        .toBuffer();

      return sharp({
        create: {
          width: canvasWidth,
          height: canvasHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
        .composite([
          { input: reference, blend: "over" },
          { input: draft, blend: "screen" },
          { input: badge, blend: "over" }
        ])
        .png()
        .toBuffer();
    } catch {
      return draft;
    }
  }

  private escapeSvg(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
