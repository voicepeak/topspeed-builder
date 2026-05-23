import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "fs-extra";
import type {
  Asset,
  GenerateAssetInput,
  GeneratedAssetResult,
  GenerationHistoryRecord,
  Project
} from "@shared/types";
import { AIGenerationService } from "./aiService";
import { AtlasPackingService } from "./atlasService";
import { HistoryService } from "./historyService";
import { ImageProcessingService } from "./imageService";
import { ProjectService } from "./projectService";
import { SettingsService } from "./settingsService";
import { SpriteSheetService } from "./spriteSheetService";
import { TileSetService } from "./tileSetService";
import { nowIso, parseSize, sanitizeFileName, toRelative, writeJsonFile } from "./utils";

interface GeneratedFrame {
  absolutePath: string;
  relativePath: string;
  name: string;
  animation: string;
  frameIndex: number;
}

export class GenerationService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly projectService: ProjectService,
    private readonly aiService: AIGenerationService,
    private readonly imageService: ImageProcessingService,
    private readonly spriteSheetService: SpriteSheetService,
    private readonly atlasService: AtlasPackingService,
    private readonly tileSetService: TileSetService,
    private readonly historyService: HistoryService
  ) {}

  async generate(input: GenerateAssetInput): Promise<GeneratedAssetResult> {
    const project = await this.projectService.openProjectPath(input.projectPath);

    if (input.assetType === "character") {
      return this.generateCharacter(project, input);
    }

    if (input.assetType === "tileset") {
      return this.generateTileset(project, input);
    }

    if (input.assetType === "icon" || input.assetType === "item" || input.assetType === "ui") {
      return this.generateIconBatch(project, input);
    }

    return this.generateGeneric(project, input);
  }

  private async generateIconBatch(project: Project, input: GenerateAssetInput): Promise<GeneratedAssetResult> {
    const logs: string[] = [];
    const runId = randomUUID();
    const assetName = sanitizeFileName(input.name || "icons");
    const size = parseSize(input.size);
    const itemNames = this.resolveIconNames(input);
    const outputDirectory = input.assetType === "ui" ? "icons/ui" : "icons/items";
    const files: string[] = [];
    const absoluteFiles: string[] = [];
    const prompts: string[] = [];

    for (let index = 0; index < itemNames.length; index += 1) {
      const itemName = itemNames[index];
      const itemSlug = sanitizeFileName(itemName);
      const fileName = `${input.assetType}_${itemSlug}_${String(index).padStart(2, "0")}.png`;
      const rawPath = path.join(project.path, "generated", "raw", runId, fileName);
      const processedPath = path.join(project.path, outputDirectory, fileName);
      const prompt = this.aiService.buildPrompt({
        assetType: input.assetType,
        name: itemName,
        description: `${input.description}. Item list context: ${itemNames.join(", ")}`,
        style: this.buildStylePrompt(project, input),
        size: input.size,
        transparentBackground: input.transparentBackground,
        extra: "Single centered icon. Orthographic game inventory asset. Keep consistent palette with the batch."
      });
      prompts.push(prompt);

      try {
        const image = await this.generateWithRetry(prompt, input.size, input.transparentBackground);
        await fs.ensureDir(path.dirname(rawPath));
        await fs.writeFile(rawPath, image);
        logs.push(`保存原始图像: ${rawPath}`);

        await this.imageService.saveProcessedImage(image, processedPath, {
          width: size.width,
          height: size.height,
          transparentBackground: input.transparentBackground,
          trim: true
        });
        logs.push(`保存处理图像: ${processedPath}`);

        files.push(toRelative(project.path, processedPath));
        absoluteFiles.push(processedPath);
      } catch (error) {
        logs.push(`生成失败 ${itemName}: ${this.formatError(error)}`);
      }
    }

    if (files.length === 0) {
      throw new Error(`批量图标生成失败，没有成功输出。日志：${logs.join(" | ")}`);
    }

    let atlasPath: string | undefined;
    let atlasMetadataPath: string | undefined;
    if (input.makeAtlas && absoluteFiles.length > 0) {
      const atlas = await this.atlasService.pack({
        projectPath: project.path,
        name: assetName,
        files: absoluteFiles
      });
      atlasPath = atlas.atlasPath;
      atlasMetadataPath = atlas.metadataPath;
      logs.push(`生成 Atlas: ${path.join(project.path, atlasPath)}`);
    }

    const metadataPath = path.join(project.path, outputDirectory, `${assetName}_metadata.json`);
    const metadata = {
      name: input.name,
      type: input.assetType,
      style: project.style,
      detailPrompt: this.resolveDetailPrompt(input),
      size,
      files,
      atlas: atlasPath,
      prompt: prompts.join("\n\n---\n\n"),
      exportTargets: input.exportTargets,
      createdAt: nowIso()
    };
    await writeJsonFile(metadataPath, metadata);
    logs.push(`生成 metadata: ${metadataPath}`);

    const asset = this.createAsset(input, {
      id: runId,
      project,
      files,
      metadataPath: toRelative(project.path, metadataPath),
      atlasPath,
      prompt: metadata.prompt
    });

    await this.persistResult(project, input, asset, logs, files, [atlasPath, atlasMetadataPath].filter(Boolean) as string[]);

    return {
      asset,
      files,
      metadataPath: asset.metadataPath,
      atlasPath,
      logs
    };
  }

  private async generateCharacter(project: Project, input: GenerateAssetInput): Promise<GeneratedAssetResult> {
    const logs: string[] = [];
    const runId = randomUUID();
    const assetName = sanitizeFileName(input.name || "character");
    const size = parseSize(input.size);
    const animations = input.animations.length
      ? input.animations
      : [
          { name: "idle", frames: 4, fps: 6, loop: true },
          { name: "walk", frames: 4, fps: 8, loop: true },
          { name: "attack", frames: 4, fps: 10, loop: false }
        ];
    const frames: GeneratedFrame[] = [];
    const prompts: string[] = [];

    for (const animation of animations) {
      for (let frameIndex = 0; frameIndex < animation.frames; frameIndex += 1) {
        const fileName = `character_${assetName}_${animation.name}_${String(frameIndex).padStart(2, "0")}.png`;
        const rawPath = path.join(project.path, "generated", "raw", runId, fileName);
        const processedPath = path.join(project.path, "sprites", "characters", assetName, fileName);
        const prompt = this.aiService.buildPrompt({
          assetType: "character animation frame",
          name: input.name,
          description: input.description,
          style: this.buildStylePrompt(project, input),
          size: input.size,
          transparentBackground: input.transparentBackground,
          extra: [
            `View: ${input.characterView}.`,
            `Animation action: ${animation.name}. Frame ${frameIndex + 1} of ${animation.frames}.`,
            "Keep the same character identity, silhouette, outfit, proportions, and camera angle across all frames."
          ].join(" ")
        });
        prompts.push(prompt);

        try {
          const image = await this.generateWithRetry(prompt, input.size, input.transparentBackground);
          await fs.ensureDir(path.dirname(rawPath));
          await fs.writeFile(rawPath, image);
          await this.imageService.saveProcessedImage(image, processedPath, {
            width: size.width,
            height: size.height,
            transparentBackground: input.transparentBackground,
            trim: true
          });

          frames.push({
            absolutePath: processedPath,
            relativePath: toRelative(project.path, processedPath),
            name: fileName,
            animation: animation.name,
            frameIndex
          });
          logs.push(`生成角色帧: ${processedPath}`);
      } catch (error) {
          logs.push(`角色帧失败 ${animation.name}#${frameIndex}: ${this.formatError(error)}`);
      }
      }
    }

    if (frames.length === 0) {
      throw new Error(`角色序列帧生成失败，没有成功输出。日志：${logs.join(" | ")}`);
    }

    let sheetPath: string | undefined;
    let sheetMetadataPath: string | undefined;
    if (input.makeSpriteSheet) {
      const sheet = await this.spriteSheetService.createSpriteSheet({
        projectPath: project.path,
        outputName: assetName,
        frames: frames.map((frame) => ({
          filePath: frame.absolutePath,
          name: frame.name,
          animation: frame.animation,
          frameIndex: frame.frameIndex
        })),
        animations,
        size: input.size
      });
      sheetPath = sheet.sheetPath;
      sheetMetadataPath = sheet.metadataPath;
      logs.push(`生成 Sprite Sheet: ${path.join(project.path, sheetPath)}`);
    }

    const files = frames.map((frame) => frame.relativePath);
    const metadataPath = path.join(project.path, "sprites", "characters", assetName, `${assetName}_metadata.json`);
    await writeJsonFile(metadataPath, {
      name: input.name,
      type: "character",
      style: project.style,
      detailPrompt: this.resolveDetailPrompt(input),
      size,
      files,
      sheet: sheetPath,
      sheetMetadata: sheetMetadataPath,
      animations,
      prompt: prompts.join("\n\n---\n\n"),
      exportTargets: input.exportTargets,
      createdAt: nowIso()
    });

    const asset = this.createAsset(input, {
      id: runId,
      project,
      files: [...files, sheetPath].filter(Boolean) as string[],
      metadataPath: toRelative(project.path, metadataPath),
      sheetPath,
      prompt: prompts.join("\n\n---\n\n")
    });

    await this.persistResult(
      project,
      input,
      asset,
      logs,
      files,
      [sheetPath, sheetMetadataPath, toRelative(project.path, metadataPath)].filter(Boolean) as string[]
    );

    return {
      asset,
      files,
      metadataPath: asset.metadataPath,
      sheetPath,
      logs
    };
  }

  private async generateTileset(project: Project, input: GenerateAssetInput): Promise<GeneratedAssetResult> {
    const logs: string[] = [];
    const runId = randomUUID();
    const assetName = sanitizeFileName(input.name || input.tileTheme || "tileset");
    const size = parseSize(input.size);
    const tileTypes = input.tileTypes.length ? input.tileTypes : ["floor", "wall", "corner", "edge", "door", "water"];
    const tiles: Array<{ filePath: string; type: string }> = [];
    const files: string[] = [];
    const prompts: string[] = [];

    for (let index = 0; index < tileTypes.length; index += 1) {
      const tileType = tileTypes[index];
      const tileSlug = sanitizeFileName(tileType);
      const fileName = `tileset_${assetName}_${tileSlug}_${String(index).padStart(2, "0")}.png`;
      const rawPath = path.join(project.path, "generated", "raw", runId, fileName);
      const processedPath = path.join(project.path, "tilesets", assetName, fileName);
      const prompt = this.aiService.buildPrompt({
        assetType: "tileset tile",
        name: tileType,
        description: `${input.tileTheme || input.description} ${tileType}`,
        style: this.buildStylePrompt(project, input),
        size: input.size,
        transparentBackground: false,
        extra: [
          "Top-down tile. No perspective camera. Fill the full tile canvas.",
          input.tileSeamless ? "Edges should be visually repeatable and tileable." : "",
          `Tile belongs to the same ${assetName} tileset.`
        ].join(" ")
      });
      prompts.push(prompt);

      try {
        const image = await this.generateWithRetry(prompt, input.size, false);
        await fs.ensureDir(path.dirname(rawPath));
        await fs.writeFile(rawPath, image);
        await this.imageService.saveProcessedImage(image, processedPath, {
          width: size.width,
          height: size.height,
          transparentBackground: false,
          trim: false
        });

        tiles.push({ filePath: processedPath, type: tileType });
        files.push(toRelative(project.path, processedPath));
        logs.push(`生成 Tile: ${processedPath}`);
      } catch (error) {
        logs.push(`Tile 失败 ${tileType}: ${this.formatError(error)}`);
      }
    }

    if (tiles.length === 0) {
      throw new Error(`TileSet 生成失败，没有成功输出。日志：${logs.join(" | ")}`);
    }

    const tileset = await this.tileSetService.composeTileSet({
      projectPath: project.path,
      name: assetName,
      tiles,
      size: input.size,
      theme: input.tileTheme,
      seamless: input.tileSeamless
    });
    logs.push(`生成 TileSet: ${path.join(project.path, tileset.tilesetPath)}`);
    logs.push(`生成 Tiled TMX: ${path.join(project.path, tileset.tmxPath)}`);

    const asset = this.createAsset(input, {
      id: runId,
      project,
      files: [...files, tileset.tilesetPath, tileset.previewPath, tileset.tmxPath],
      metadataPath: tileset.metadataPath,
      prompt: prompts.join("\n\n---\n\n")
    });

    await this.persistResult(
      project,
      input,
      asset,
      logs,
      files,
      [tileset.tilesetPath, tileset.metadataPath, tileset.previewPath, tileset.tmxPath]
    );

    return {
      asset,
      files,
      metadataPath: tileset.metadataPath,
      previewPath: tileset.previewPath,
      tmxPath: tileset.tmxPath,
      logs
    };
  }

  private async generateGeneric(project: Project, input: GenerateAssetInput): Promise<GeneratedAssetResult> {
    const logs: string[] = [];
    const runId = randomUUID();
    const assetName = sanitizeFileName(input.name || input.assetType);
    const size = parseSize(input.size);
    const files: string[] = [];
    const absoluteFiles: string[] = [];
    const prompts: string[] = [];

    for (let index = 0; index < Math.max(input.count, 1); index += 1) {
      const fileName = `${input.assetType}_${assetName}_${String(index).padStart(2, "0")}.png`;
      const rawPath = path.join(project.path, "generated", "raw", runId, fileName);
      const processedPath = path.join(project.path, "generated", "processed", assetName, fileName);
      const prompt = this.aiService.buildPrompt({
        assetType: input.assetType,
        name: input.name,
        description: input.description,
        style: this.buildStylePrompt(project, input),
        size: input.size,
        transparentBackground: input.transparentBackground,
        extra: "Game-ready reusable 2D asset."
      });
      prompts.push(prompt);

      try {
        const image = await this.generateWithRetry(prompt, input.size, input.transparentBackground);
        await fs.ensureDir(path.dirname(rawPath));
        await fs.writeFile(rawPath, image);
        await this.imageService.saveProcessedImage(image, processedPath, {
          width: size.width,
          height: size.height,
          transparentBackground: input.transparentBackground,
          trim: true
        });
        files.push(toRelative(project.path, processedPath));
        absoluteFiles.push(processedPath);
        logs.push(`生成素材: ${processedPath}`);
      } catch (error) {
        logs.push(`素材失败 #${index}: ${this.formatError(error)}`);
      }
    }

    if (files.length === 0) {
      throw new Error(`素材生成失败，没有成功输出。日志：${logs.join(" | ")}`);
    }

    let atlasPath: string | undefined;
    if (input.makeAtlas && absoluteFiles.length > 1) {
      const atlas = await this.atlasService.pack({
        projectPath: project.path,
        name: assetName,
        files: absoluteFiles
      });
      atlasPath = atlas.atlasPath;
      logs.push(`生成 Atlas: ${path.join(project.path, atlasPath)}`);
    }

    const metadataPath = path.join(project.path, "generated", "processed", assetName, `${assetName}_metadata.json`);
    await writeJsonFile(metadataPath, {
      name: input.name,
      type: input.assetType,
      style: project.style,
      detailPrompt: this.resolveDetailPrompt(input),
      size,
      files,
      atlas: atlasPath,
      prompt: prompts.join("\n\n---\n\n"),
      exportTargets: input.exportTargets,
      createdAt: nowIso()
    });

    const asset = this.createAsset(input, {
      id: runId,
      project,
      files,
      metadataPath: toRelative(project.path, metadataPath),
      atlasPath,
      prompt: prompts.join("\n\n---\n\n")
    });

    await this.persistResult(project, input, asset, logs, files, [atlasPath].filter(Boolean) as string[]);

    return {
      asset,
      files,
      metadataPath: asset.metadataPath,
      atlasPath,
      logs
    };
  }

  private async generateWithRetry(prompt: string, size: string, transparentBackground: boolean): Promise<Buffer> {
    const settings = await this.settingsService.getSettings();
    if (settings.aiProvider === "local-draft") {
      return this.aiService.generateImage({
        prompt,
        size,
        transparentBackground,
        settings
      });
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.aiService.generateImage({
          prompt,
          size,
          transparentBackground,
          settings
        });
      } catch (error) {
        lastError = error;
        if (!this.isRateLimitError(error)) {
          throw error;
        }

        if (attempt < 4) {
          await this.sleep(8000 * attempt);
        }
      }
    }

    if (this.isRateLimitError(lastError)) {
      throw new Error(`图片生成 API 连续限流，已重试 4 次但没有成功；不会生成本地假图。最后错误：${this.formatError(lastError)}`);
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private resolveIconNames(input: GenerateAssetInput): string[] {
    if (input.iconItems.length > 0) {
      return input.iconItems.slice(0, Math.max(input.count, 1));
    }

    return Array.from({ length: Math.max(input.count, 1) }, (_, index) => `${input.name || "icon"} ${index + 1}`);
  }

  private isRateLimitError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("HTTP 429") || message.toLowerCase().includes("too many requests");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private formatError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.replace(/\s+/g, " ").trim();
    return normalized.length > 320 ? `${normalized.slice(0, 320)}...` : normalized;
  }

  private createAsset(
    input: GenerateAssetInput,
    args: {
      id: string;
      project: Project;
      files: string[];
      metadataPath?: string;
      atlasPath?: string;
      sheetPath?: string;
      prompt: string;
    }
  ): Asset {
    const size = parseSize(input.size);
    const timestamp = nowIso();

    return {
      id: args.id,
      name: input.name,
      type: input.assetType,
      description: input.description,
      style: this.resolveAssetStyle(args.project, input),
      size,
      files: args.files,
      metadataPath: args.metadataPath,
      atlasPath: args.atlasPath,
      sheetPath: args.sheetPath,
      prompt: args.prompt,
      exportTargets: input.exportTargets,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private async persistResult(
    project: Project,
    input: GenerateAssetInput,
    asset: Asset,
    logs: string[],
    files: string[],
    extraFiles: string[]
  ): Promise<void> {
    await this.projectService.addAssets(project.path, [asset]);

    const outputFiles = [...files, ...extraFiles].filter(Boolean);
    const historyRecord: GenerationHistoryRecord = {
      id: asset.id,
      createdAt: asset.createdAt,
      assetType: input.assetType,
      prompt: asset.prompt,
      parameters: input,
      style: asset.style,
      outputFiles,
      exportTargets: input.exportTargets,
      favorite: false,
      exported: false
    };

    await this.historyService.append(project.path, historyRecord);
    logs.push(`保存历史记录: ${path.join(project.path, "history", `${asset.id}.json`)}`);
  }

  private buildStylePrompt(project: Project, input: GenerateAssetInput): string {
    const detailPrompt = this.resolveDetailPrompt(input);
    const projectStyleParts = this.uniqueNonEmpty([project.style, project.styleDescription]);
    const parts = [
      ...projectStyleParts.map((part) => `Project style: ${part}`),
      detailPrompt ? `Object-specific details: ${detailPrompt}` : ""
    ];
    return parts.filter(Boolean).join("\n");
  }

  private resolveAssetStyle(project: Project, input: GenerateAssetInput): string {
    const detailPrompt = this.resolveDetailPrompt(input);
    return detailPrompt ? `${project.style} | ${detailPrompt}` : project.style;
  }

  private resolveDetailPrompt(input: GenerateAssetInput): string {
    const legacyStyle = (input as GenerateAssetInput & { style?: string }).style;
    return (input.detailPrompt || legacyStyle || "").trim();
  }

  private uniqueNonEmpty(values: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const normalized = value?.trim();
      if (!normalized) continue;

      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      result.push(normalized);
    }

    return result;
  }
}
