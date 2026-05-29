import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "fs-extra";
import sharp from "sharp";
import type {
  Asset,
  GenerateAssetInput,
  GeneratedAssetResult,
  GenerationHistoryRecord,
  Project,
  ReferenceImageInput,
  ReferenceImageRole,
  Size
} from "@shared/types";
import { AIGenerationService } from "./aiService";
import { AtlasPackingService } from "./atlasService";
import { HistoryService } from "./historyService";
import { ImageProcessingService } from "./imageService";
import { ProjectService } from "./projectService";
import { SettingsService } from "./settingsService";
import { SpriteSheetService } from "./spriteSheetService";
import { TileSetService } from "./tileSetService";
import { nowIso, parseSize, resolveProjectPath, sanitizeFileName, toRelative, writeJsonFile } from "./utils";

interface GeneratedFrame {
  absolutePath: string;
  relativePath: string;
  name: string;
  animation: string;
  frameIndex: number;
}

interface ResolvedReferenceImage extends ReferenceImageInput {
  filePath: string;
}

interface FrameDiagnostic {
  file: string;
  alphaRatio: number;
  largeComponents: number;
  warnings: string[];
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
    this.validateInput(input);

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
    const referenceImages = this.resolveReferenceImages(project, input);
    const maskImagePath = this.resolveMaskImagePath(project, input);
    const referenceGuidance = this.buildReferenceGuidance(input);

    for (let index = 0; index < itemNames.length; index += 1) {
      const itemName = itemNames[index];
      const itemSlug = sanitizeFileName(itemName);
      const fileName = `${input.assetType}_${itemSlug}_${String(index).padStart(2, "0")}.png`;
      const rawPath = path.join(project.path, "generated", "raw", runId, fileName);
      const processedPath = path.join(project.path, outputDirectory, fileName);
      const prompt = this.aiService.buildPrompt({
        assetType: this.assetTypeLabel(input.assetType),
        name: itemName,
        description: `${input.description}。同批次物品列表：${itemNames.join("、")}`,
        style: this.buildStylePrompt(project, input),
        size: input.size,
        transparentBackground: input.transparentBackground,
        extra: ["单个居中图标。正交视角的游戏背包素材。与同批次保持一致色板。", referenceGuidance]
          .filter(Boolean)
          .join(" ")
      });
      prompts.push(prompt);

      try {
        const image = await this.generateWithRetry(prompt, input.size, input.transparentBackground, input, referenceImages, maskImagePath);
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
      logs.push(`生成图集: ${path.join(project.path, atlasPath)}`);
    }

    const metadataPath = path.join(project.path, outputDirectory, `${assetName}_metadata.json`);
    const metadata = {
      name: input.name,
      type: input.assetType,
      style: project.style,
      detailPrompt: this.resolveDetailPrompt(input),
      ...this.buildGenerationMetadata(input),
      size,
      files,
      atlas: atlasPath,
      prompt: prompts.join("\n\n---\n\n"),
      exportTargets: input.exportTargets,
      createdAt: nowIso()
    };
    await writeJsonFile(metadataPath, metadata);
    logs.push(`生成元数据: ${metadataPath}`);

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
    const frameSize = parseSize(input.size);
    const animations = input.animations.length
      ? input.animations
      : [
          { name: "待机", frames: 4, fps: 6, loop: true },
          { name: "行走", frames: 4, fps: 8, loop: true },
          { name: "攻击", frames: 4, fps: 10, loop: false }
        ];
    const versionCount = Math.max(input.count, 1);
    const columns = Math.max(...animations.map((animation) => animation.frames), 1);
    const rows = Math.max(animations.length, 1);
    const sheetSize = {
      width: frameSize.width * columns,
      height: frameSize.height * rows
    };
    const sheetSizeText = `${sheetSize.width}x${sheetSize.height}`;
    const frames: GeneratedFrame[] = [];
    const prompts: string[] = [];
    const sourceSheets: string[] = [];
    const sheetPaths: string[] = [];
    const sheetMetadataPaths: string[] = [];
    const diagnostics: FrameDiagnostic[] = [];
    const referenceImages = this.resolveReferenceImages(project, input);
    const maskImagePath = this.resolveMaskImagePath(project, input);
    const referenceGuidance = this.buildReferenceGuidance(input);

    const isCharacterI2I = input.generationMode === "image-to-image" && input.referenceImages.some((ref) => ref.sourceAssetId);
    const sourceAsset = isCharacterI2I ? this.findAssetById(project, input.referenceImages.find((ref) => ref.sourceAssetId)!.sourceAssetId!) : undefined;
    const originalPrompt = sourceAsset?.prompt ?? "";
    const originalSourceSheets = this.findSourceSheetPaths(sourceAsset, project);
    const resolvedReferences = isCharacterI2I && originalSourceSheets.length > 0
      ? originalSourceSheets.map((sheetPath) => ({ filePath: sheetPath, role: "subject" as ReferenceImageRole, path: sheetPath }))
      : referenceImages;

    for (let versionIndex = 0; versionIndex < versionCount; versionIndex += 1) {
      const versionLabel = `v${String(versionIndex + 1).padStart(2, "0")}`;
      const versionOutputName = versionCount > 1 ? `${assetName}_${versionLabel}` : assetName;
      const versionDirectory = path.join(project.path, "sprites", "characters", assetName, versionLabel);
      const sourceSheetName = `character_${assetName}_${versionLabel}_source_sheet.png`;
      const rawPath = path.join(project.path, "generated", "raw", runId, sourceSheetName);
      const sourceSheetPath = path.join(versionDirectory, sourceSheetName);

      const prompt = isCharacterI2I && originalPrompt
        ? this.buildCharacterI2IPrompt(originalPrompt, input, project, animations, columns, rows, versionIndex, versionCount)
        : this.aiService.buildPrompt({
            assetType: "完整角色动作表",
            name: versionCount > 1 ? `${input.name} ${versionLabel}` : input.name,
            description: input.description,
            style: this.buildStylePrompt(project, input),
            size: `${columns}x${rows} action sheet; each exported frame ${input.size}`,
            transparentBackground: input.transparentBackground,
            extra: [
              this.buildCharacterSheetGuidance(input, animations, columns, rows),
              versionCount > 1 ? `这是第 ${versionIndex + 1} 套候选角色版本，必须保持本套内部所有动作帧一致。` : "",
              referenceGuidance
            ].join(" ")
          });
      prompts.push(prompt);

      try {
        const image = await this.generateWithRetry(prompt, sheetSizeText, input.transparentBackground, input, resolvedReferences, maskImagePath);
        const normalizedSheet = await this.normalizeCharacterSheet(image, sheetSize);
        await fs.ensureDir(path.dirname(rawPath));
        await fs.writeFile(rawPath, image);
        await fs.ensureDir(path.dirname(sourceSheetPath));
        await fs.writeFile(sourceSheetPath, normalizedSheet);
        sourceSheets.push(toRelative(project.path, sourceSheetPath));
        logs.push(`生成角色动作表: ${sourceSheetPath}`);

        const versionFrames: GeneratedFrame[] = [];
        for (let rowIndex = 0; rowIndex < animations.length; rowIndex += 1) {
          const animation = animations[rowIndex];
          for (let frameIndex = 0; frameIndex < animation.frames; frameIndex += 1) {
            const fileName = `character_${assetName}_${versionLabel}_${animation.name}_${String(frameIndex).padStart(2, "0")}.png`;
            const processedPath = path.join(versionDirectory, fileName);
            const frameBuffer = await this.extractCharacterFrame(image, {
              columns,
              rows,
              rowIndex,
              frameIndex,
              frameSize
            });

            await this.imageService.saveProcessedImage(frameBuffer, processedPath, {
              width: frameSize.width,
              height: frameSize.height,
              transparentBackground: input.transparentBackground,
              trim: true,
              anchor: "bottom-center",
              padding: 2,
              removeEdgeArtifacts: true
            });

            const frame: GeneratedFrame = {
              absolutePath: processedPath,
              relativePath: toRelative(project.path, processedPath),
              name: fileName,
              animation: animation.name,
              frameIndex
            };
            frames.push(frame);
            versionFrames.push(frame);

            const diagnostic = await this.inspectCharacterFrame(processedPath, frameSize);
            diagnostics.push({ ...diagnostic, file: frame.relativePath });
            if (diagnostic.warnings.length > 0) {
              logs.push(`角色帧诊断 ${frame.relativePath}: ${diagnostic.warnings.join("；")}`);
            }
          }
        }

        if (input.makeSpriteSheet && versionFrames.length > 0) {
          const sheet = await this.spriteSheetService.createSpriteSheet({
            projectPath: project.path,
            outputName: versionOutputName,
            frames: versionFrames.map((frame) => ({
              filePath: frame.absolutePath,
              name: frame.name,
              animation: frame.animation,
              frameIndex: frame.frameIndex
            })),
            animations,
            size: input.size
          });
          sheetPaths.push(sheet.sheetPath);
          sheetMetadataPaths.push(sheet.metadataPath);
          logs.push(`生成精灵表: ${path.join(project.path, sheet.sheetPath)}`);
        }
      } catch (error) {
        logs.push(`角色版本失败 ${versionLabel}: ${this.formatError(error)}`);
      }
    }

    if (frames.length === 0) {
      throw new Error(`角色序列帧生成失败，没有成功输出。日志：${logs.join(" | ")}`);
    }

    const sheetPath = sheetPaths[0];
    const files = frames.map((frame) => frame.relativePath);
    const metadataPath = path.join(project.path, "sprites", "characters", assetName, `${assetName}_metadata.json`);
    await writeJsonFile(metadataPath, {
      name: input.name,
      type: "character",
      style: project.style,
      detailPrompt: this.resolveDetailPrompt(input),
      ...this.buildGenerationMetadata(input),
      generationStrategy: "character-sheet-slice",
      characterVersions: versionCount,
      sheetGrid: {
        columns,
        rows,
        frameSize,
        sheetSize
      },
      sourceSheets,
      diagnostics,
      size: frameSize,
      files,
      sheet: sheetPath,
      sheets: sheetPaths,
      sheetMetadata: sheetMetadataPaths[0],
      sheetMetadataFiles: sheetMetadataPaths,
      animations,
      prompt: prompts.join("\n\n---\n\n"),
      exportTargets: input.exportTargets,
      createdAt: nowIso()
    });

    const asset = this.createAsset(input, {
      id: runId,
      project,
      files: [...files, ...sourceSheets, ...sheetPaths].filter(Boolean) as string[],
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
      [...sourceSheets, ...sheetPaths, ...sheetMetadataPaths, toRelative(project.path, metadataPath)].filter(Boolean) as string[]
    );

    return {
      asset,
      files,
      metadataPath: asset.metadataPath,
      sheetPath,
      logs
    };
  }

  private buildCharacterSheetGuidance(
    input: GenerateAssetInput,
    animations: GenerateAssetInput["animations"],
    columns: number,
    rows: number
  ): string {
    const rowPlan = animations
      .map((animation, index) => `第 ${index + 1} 行：${animation.name}，从左到右 ${animation.frames} 帧。`)
      .join(" ");

    return [
      "请生成一张完整的角色动作表，不要生成单张角色插图。",
      `固定网格布局为 ${columns} 列 x ${rows} 行，每个格子是一帧。`,
      rowPlan,
      "Keep 15-20% transparent safe padding inside every cell; no body part, weapon, cape, projectile, or magic effect may touch or cross a cell edge.",
      "If the provider canvas is not exactly the grid aspect ratio, keep the whole grid centered with equal transparent outer margins and mathematically even rows and columns.",
      `角色视角：${this.characterViewLabel(input.characterView)}。`,
      "所有格子必须是同一个角色：同一脸型、发型、服装、道具、身高比例、色板和轮廓。",
      "每个格子只允许出现一个角色姿势，角色要居中，脚底基线一致，大小一致。",
      "不要文字、不要标签、不要边框、不要网格线、不要额外装饰、不要多个角色。",
      "不要把整套小图压进某一个格子；整张输出本身就是动作表。"
    ]
      .filter(Boolean)
      .join(" ");
  }

  private async normalizeCharacterSheet(input: Buffer, size: { width: number; height: number }): Promise<Buffer> {
    return sharp(input)
      .ensureAlpha()
      .resize({
        width: size.width,
        height: size.height,
        fit: "fill",
        kernel: sharp.kernel.nearest
      })
      .png()
      .toBuffer();
  }

  private async extractCharacterFrame(
    sheet: Buffer,
    args: {
      columns: number;
      rows: number;
      rowIndex: number;
      frameIndex: number;
      frameSize: { width: number; height: number };
    }
  ): Promise<Buffer> {
    const metadata = await sharp(sheet).metadata();
    const width = metadata.width ?? args.frameSize.width * args.columns;
    const height = metadata.height ?? args.frameSize.height * args.rows;
    const cellWidth = width / args.columns;
    const cellHeight = height / args.rows;
    const bleed = Math.round(Math.min(cellWidth, cellHeight) * 0.04);
    const left = Math.max(0, Math.floor(args.frameIndex * cellWidth - bleed));
    const top = Math.max(0, Math.floor(args.rowIndex * cellHeight - bleed));
    const right = Math.min(width, Math.ceil((args.frameIndex + 1) * cellWidth + bleed));
    const bottom = Math.min(height, Math.ceil((args.rowIndex + 1) * cellHeight + bleed));

    return sharp(sheet)
      .ensureAlpha()
      .extract({
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
      })
      .png()
      .toBuffer();
  }

  private async inspectCharacterFrame(filePath: string, expectedSize: { width: number; height: number }): Promise<Omit<FrameDiagnostic, "file">> {
    const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const total = info.width * info.height;
    const mask = new Uint8Array(total);
    let alphaPixels = 0;
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;

    for (let index = 0; index < total; index += 1) {
      const alpha = data[index * channels + 3];
      if (alpha > 12) {
        mask[index] = 1;
        alphaPixels += 1;
        const x = index % info.width;
        const y = Math.floor(index / info.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const alphaRatio = total > 0 ? alphaPixels / total : 0;
    const warnings: string[] = [];
    if (alphaPixels === 0) {
      warnings.push("空白帧");
    }
    if (alphaRatio > 0 && alphaRatio < 0.015) {
      warnings.push("主体过小，疑似整套图被压缩进单帧或生成失败");
    }
    if (alphaRatio > 0.78) {
      warnings.push("透明区域过少，疑似背景未清理或整格被填满");
    }

    const bboxWidth = maxX >= minX ? maxX - minX + 1 : 0;
    const bboxHeight = maxY >= minY ? maxY - minY + 1 : 0;
    const edgeMargin = Math.max(1, Math.floor(Math.min(expectedSize.width, expectedSize.height) * 0.03));
    if (alphaPixels > 0 && (minX <= edgeMargin || minY <= edgeMargin || maxX >= info.width - 1 - edgeMargin || maxY >= info.height - 1 - edgeMargin)) {
      warnings.push("主体贴近帧边缘，可能存在切割残缺");
    }
    if (bboxWidth > expectedSize.width * 0.94 && bboxHeight > expectedSize.height * 0.94 && alphaRatio > 0.45) {
      warnings.push("主体占满整格，疑似多状态套图或背景占用");
    }

    const largeComponents = this.countLargeAlphaComponents(mask, info.width, info.height, Math.max(32, Math.floor(total * 0.055)));
    if (largeComponents > 2) {
      warnings.push("检测到多个分离主体，疑似一格多角色");
    }

    return {
      alphaRatio: Number(alphaRatio.toFixed(4)),
      largeComponents,
      warnings
    };
  }

  private countLargeAlphaComponents(mask: Uint8Array, width: number, height: number, minPixels: number): number {
    const visited = new Uint8Array(mask.length);
    const stack: number[] = [];
    let largeComponents = 0;

    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) continue;

      let size = 0;
      visited[start] = 1;
      stack.push(start);

      while (stack.length > 0) {
        const index = stack.pop() as number;
        size += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y < height - 1 ? index + width : -1
        ];

        for (const next of neighbors) {
          if (next < 0 || !mask[next] || visited[next]) continue;
          visited[next] = 1;
          stack.push(next);
        }
      }

      if (size >= minPixels) {
        largeComponents += 1;
      }
    }

    return largeComponents;
  }

  private async generateTileset(project: Project, input: GenerateAssetInput): Promise<GeneratedAssetResult> {
    const logs: string[] = [];
    const runId = randomUUID();
    const assetName = sanitizeFileName(input.name || input.tileTheme || "瓦片集");
    const size = parseSize(input.size);
    const tileTypes = input.tileTypes.length ? input.tileTypes : ["地板", "墙体", "转角", "边缘", "门", "水面"];
    const tiles: Array<{ filePath: string; type: string }> = [];
    const files: string[] = [];
    const prompts: string[] = [];
    const referenceImages = this.resolveReferenceImages(project, input);
    const maskImagePath = this.resolveMaskImagePath(project, input);
    const referenceGuidance = this.buildReferenceGuidance(input);

    for (let index = 0; index < tileTypes.length; index += 1) {
      const tileType = tileTypes[index];
      const tileSlug = sanitizeFileName(tileType);
      const fileName = `tileset_${assetName}_${tileSlug}_${String(index).padStart(2, "0")}.png`;
      const rawPath = path.join(project.path, "generated", "raw", runId, fileName);
      const processedPath = path.join(project.path, "tilesets", assetName, fileName);
      const prompt = this.aiService.buildPrompt({
        assetType: "瓦片集瓦片",
        name: tileType,
        description: `${input.tileTheme || input.description} ${tileType}`,
        style: this.buildStylePrompt(project, input),
        size: input.size,
        transparentBackground: false,
        extra: [
          "俯视角瓦片。不要透视镜头。铺满整个瓦片画布。",
          input.tileSeamless ? "边缘应尽量可重复、可平铺。" : "",
          `该瓦片属于同一组「${assetName}」瓦片集。`,
          referenceGuidance
        ].join(" ")
      });
      prompts.push(prompt);

      try {
        const image = await this.generateWithRetry(prompt, input.size, false, input, referenceImages, maskImagePath);
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
        logs.push(`生成瓦片: ${processedPath}`);
      } catch (error) {
        logs.push(`瓦片失败 ${tileType}: ${this.formatError(error)}`);
      }
    }

    if (tiles.length === 0) {
      throw new Error(`瓦片集生成失败，没有成功输出。日志：${logs.join(" | ")}`);
    }

    const tileset = await this.tileSetService.composeTileSet({
      projectPath: project.path,
      name: assetName,
      tiles,
      size: input.size,
      theme: input.tileTheme,
      seamless: input.tileSeamless
    });
    await this.appendGenerationMetadata(path.join(project.path, tileset.metadataPath), input);
    logs.push(`生成瓦片集: ${path.join(project.path, tileset.tilesetPath)}`);
    logs.push(`生成 Tiled 地图文件: ${path.join(project.path, tileset.tmxPath)}`);

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
    const referenceImages = this.resolveReferenceImages(project, input);
    const maskImagePath = this.resolveMaskImagePath(project, input);
    const referenceGuidance = this.buildReferenceGuidance(input);

    for (let index = 0; index < Math.max(input.count, 1); index += 1) {
      const fileName = `${input.assetType}_${assetName}_${String(index).padStart(2, "0")}.png`;
      const rawPath = path.join(project.path, "generated", "raw", runId, fileName);
      const processedPath = path.join(project.path, "generated", "processed", assetName, fileName);
      const prompt = this.aiService.buildPrompt({
        assetType: this.assetTypeLabel(input.assetType),
        name: input.name,
        description: input.description,
        style: this.buildStylePrompt(project, input),
        size: input.size,
        transparentBackground: input.transparentBackground,
        extra: ["可直接复用的游戏二维素材。", referenceGuidance].filter(Boolean).join(" ")
      });
      prompts.push(prompt);

      try {
        const image = await this.generateWithRetry(prompt, input.size, input.transparentBackground, input, referenceImages, maskImagePath);
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
      logs.push(`生成图集: ${path.join(project.path, atlasPath)}`);
    }

    const metadataPath = path.join(project.path, "generated", "processed", assetName, `${assetName}_metadata.json`);
    await writeJsonFile(metadataPath, {
      name: input.name,
      type: input.assetType,
      style: project.style,
      detailPrompt: this.resolveDetailPrompt(input),
      ...this.buildGenerationMetadata(input),
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

  private async generateWithRetry(
    prompt: string,
    size: string,
    transparentBackground: boolean,
    input: GenerateAssetInput,
    referenceImages: ResolvedReferenceImage[],
    maskImagePath?: string
  ): Promise<Buffer> {
    const settings = await this.settingsService.getSettings();
    if (settings.aiProvider === "local-draft") {
      return this.aiService.generateImage({
        prompt,
        size,
        transparentBackground,
        settings,
        referenceImages,
        maskImagePath,
        editIntent: input.editIntent,
        referenceStrength: input.referenceStrength
      });
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.aiService.generateImage({
          prompt,
          size,
          transparentBackground,
          settings,
          referenceImages,
          maskImagePath,
          editIntent: input.editIntent,
          referenceStrength: input.referenceStrength
        });
      } catch (error) {
        lastError = error;
        if (!this.isRetriableImageError(error)) {
          throw error;
        }

        if (attempt < 4) {
          await this.sleep(this.isRateLimitError(error) ? 8000 * attempt : 3000 * attempt);
        }
      }
    }

    if (this.isRateLimitError(lastError)) {
      throw new Error(`图片生成接口连续限流，已重试 4 次但没有成功；不会生成本地假图。最后错误：${this.formatError(lastError)}`);
    }

    if (this.isTransientImageError(lastError)) {
      throw new Error(`图片生成请求连续网络失败，已重试 4 次但没有成功。最后错误：${this.formatError(lastError)}`);
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

  private isRetriableImageError(error: unknown): boolean {
    return this.isRateLimitError(error) || this.isTransientImageError(error);
  }

  private isTransientImageError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    return (
      lower.includes("fetch failed") ||
      lower.includes("network") ||
      lower.includes("timeout") ||
      lower.includes("econnreset") ||
      lower.includes("etimedout") ||
      lower.includes("und_err_connect_timeout") ||
      message.includes("HTTP 502") ||
      message.includes("HTTP 503") ||
      message.includes("HTTP 504")
    );
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
      generationMode: input.generationMode ?? "text-to-image",
      referenceImages: input.generationMode === "image-to-image" ? input.referenceImages : undefined,
      maskImagePath: input.generationMode === "image-to-image" ? input.maskImagePath : undefined,
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

  private findAssetById(project: Project, assetId: string): Asset | undefined {
    return project.assets.find((asset) => asset.id === assetId);
  }

  private findSourceSheetPaths(asset: Asset | undefined, project: Project): string[] {
    if (!asset) return [];
    const sheets = asset.files.filter((file) => file.includes("source_sheet"));
    if (sheets.length > 0) return sheets.map((f) => resolveProjectPath(project.path, f));
    if (asset.sheetPath) return [resolveProjectPath(project.path, asset.sheetPath)];
    if (asset.files.length > 0) return [resolveProjectPath(project.path, asset.files[0])];
    return [];
  }

  private buildCharacterI2IPrompt(
    originalPrompt: string,
    input: GenerateAssetInput,
    project: Project,
    animations: GenerateAssetInput["animations"],
    columns: number,
    rows: number,
    versionIndex: number,
    versionCount: number
  ): string {
    const versionLabel = `v${String(versionIndex + 1).padStart(2, "0")}`;
    const mergedDescription = input.description
      ? `修改要求：${input.description}。来自用户的新描述，必须覆盖原描述中可能冲突的部分。`
      : "";

    return [
      originalPrompt,
      "======== 以上是原始生成提示词 ========",
      mergedDescription,
      `版本：${versionCount > 1 ? `${input.name} ${versionLabel}` : input.name}`,
      `角色视角：${this.characterViewLabel(input.characterView)}。`,
      this.buildCharacterSheetGuidance(input, animations, columns, rows),
      "请基于原始角色设计进行修改调整，保持角色身份、服装、色板一致，只改变指定的部分。"
    ].filter(Boolean).join("\n");
  }

  private validateInput(input: GenerateAssetInput): void {
    const mode = input.generationMode ?? "text-to-image";
    if (mode !== "image-to-image") {
      return;
    }

    if (!input.referenceImages?.length) {
      throw new Error("图生图模式需要至少一张参考图。");
    }

    if (input.referenceImages.length > 4) {
      throw new Error("图生图 v1 最多支持 4 张参考图。");
    }

    if (input.editIntent === "inpaint" && !input.maskImagePath) {
      throw new Error("局部替换模式需要提供蒙版 PNG。");
    }
  }

  private resolveReferenceImages(project: Project, input: GenerateAssetInput): ResolvedReferenceImage[] {
    if ((input.generationMode ?? "text-to-image") !== "image-to-image") {
      return [];
    }

    return input.referenceImages.map((reference) => ({
      ...reference,
      filePath: resolveProjectPath(project.path, reference.path)
    }));
  }

  private resolveMaskImagePath(project: Project, input: GenerateAssetInput): string | undefined {
    if ((input.generationMode ?? "text-to-image") !== "image-to-image" || !input.maskImagePath) {
      return undefined;
    }

    return resolveProjectPath(project.path, input.maskImagePath);
  }

  private buildReferenceGuidance(input: GenerateAssetInput): string {
    if ((input.generationMode ?? "text-to-image") !== "image-to-image") {
      return "";
    }

    const roleLabels: Record<ReferenceImageRole, string> = {
      subject: "保持主体身份和轮廓",
      style: "匹配视觉风格、线条语言和渲染方式",
      composition: "遵循构图和镜头安排",
      palette: "复用色板和材质气质"
    };
    const intentLabels: Record<GenerateAssetInput["editIntent"], string> = {
      "preserve-subject": "保留参考图主体，并重绘成可用于游戏工程的素材。",
      "preserve-style": "创建一个遵循参考风格的新素材。",
      "preserve-composition": "创建一个遵循参考构图的新素材。",
      "same-series": "创建一个与参考素材属于同系列的变体。",
      inpaint: "只编辑蒙版区域，其余区域保持视觉稳定。"
    };
    const strengthLabels: Record<GenerateAssetInput["referenceStrength"], string> = {
      low: "宽松参考输入图。",
      medium: "在提示词要求和参考图保留之间保持平衡。",
      high: "尽量高保真保留参考图细节。"
    };

    const roles = input.referenceImages
      .map((reference, index) => `第 ${index + 1} 张参考图（${this.referenceRoleLabel(reference.role)}）：${roleLabels[reference.role]}。`)
      .join(" ");

    return [
      "使用提供的输入参考图。",
      intentLabels[input.editIntent],
      strengthLabels[input.referenceStrength],
      roles
    ]
      .filter(Boolean)
      .join(" ");
  }

  private buildGenerationMetadata(input: GenerateAssetInput): Record<string, unknown> {
    const generationMode = input.generationMode ?? "text-to-image";
    if (generationMode !== "image-to-image") {
      return { generationMode };
    }

    return {
      generationMode,
      editIntent: input.editIntent,
      referenceStrength: input.referenceStrength,
      referenceImages: input.referenceImages,
      maskImagePath: input.maskImagePath
    };
  }

  private async appendGenerationMetadata(metadataPath: string, input: GenerateAssetInput): Promise<void> {
    try {
      const metadata = await fs.readJson(metadataPath);
      await writeJsonFile(metadataPath, {
        ...metadata,
        ...this.buildGenerationMetadata(input)
      });
    } catch {
      await writeJsonFile(metadataPath, this.buildGenerationMetadata(input));
    }
  }

  private buildStylePrompt(project: Project, input: GenerateAssetInput): string {
    const detailPrompt = this.resolveDetailPrompt(input);
    const projectStyleParts = this.uniqueNonEmpty([project.style, project.styleDescription]);
    const parts = [
      ...projectStyleParts.map((part) => `项目风格：${part}`),
      detailPrompt ? `对象细节：${detailPrompt}` : ""
    ];
    return parts.filter(Boolean).join("\n");
  }

  private resolveAssetStyle(project: Project, input: GenerateAssetInput): string {
    const detailPrompt = this.resolveDetailPrompt(input);
    return detailPrompt ? `${project.style} | ${detailPrompt}` : project.style;
  }

  private characterViewLabel(value: string): string {
    const labels: Record<string, string> = {
      "side-view": "侧视角",
      "top-down": "俯视角",
      "four-direction": "四方向",
      "eight-direction": "八方向"
    };
    return labels[value] ?? value;
  }

  private referenceRoleLabel(value: ReferenceImageRole): string {
    const labels: Record<ReferenceImageRole, string> = {
      subject: "主体参考",
      style: "风格参考",
      composition: "构图参考",
      palette: "色板参考"
    };
    return labels[value];
  }

  private assetTypeLabel(value: GenerateAssetInput["assetType"]): string {
    const labels: Record<GenerateAssetInput["assetType"], string> = {
      character: "角色",
      enemy: "怪物",
      icon: "图标",
      item: "道具",
      ui: "界面元素",
      tileset: "瓦片集",
      background: "背景",
      effect: "特效"
    };
    return labels[value];
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
