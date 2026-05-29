import path from "node:path";
import fs from "fs-extra";
import sharp, { type Raw } from "sharp";
import type { Size } from "@shared/types";

interface ProcessImageOptions {
  width: number;
  height: number;
  transparentBackground: boolean;
  trim: boolean;
  anchor?: "center" | "bottom-center";
  padding?: number;
  removeEdgeArtifacts?: boolean;
}

export class ImageProcessingService {
  async processImage(input: Buffer, options: ProcessImageOptions): Promise<Buffer> {
    let output = input;

    if (options.transparentBackground) {
      output = await this.removeFlatBackground(output);
    } else {
      output = await sharp(output).ensureAlpha().png().toBuffer();
    }

    if (options.removeEdgeArtifacts) {
      output = await this.removeEdgeArtifacts(output);
    }

    if (options.trim) {
      output = await this.trimTransparent(output);
    }

    output = await this.normalizeCanvas(output, { width: options.width, height: options.height }, options.anchor ?? "center", options.padding ?? 0);
    return output;
  }

  async saveProcessedImage(input: Buffer, outputPath: string, options: ProcessImageOptions): Promise<void> {
    const processed = await this.processImage(input, options);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, processed);
  }

  async normalizeFile(inputPath: string, outputPath: string, size: Size): Promise<void> {
    const buffer = await fs.readFile(inputPath);
    const processed = await this.normalizeCanvas(buffer, size);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, processed);
  }

  private async removeFlatBackground(input: Buffer): Promise<Buffer> {
    const image = sharp(input).ensureAlpha();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;

    const alreadyTransparent = this.hasRealAlphaChannel(data, channels, info.width * info.height);
    if (alreadyTransparent) {
      return sharp(data, {
        raw: { width: info.width, height: info.height, channels: channels as Raw["channels"] }
      }).png().toBuffer();
    }

    const background = this.estimateBackgroundFromEdges(data, info);
    const tolerance = this.computeAdaptiveTolerance(data, info, background, channels);
    const toRemove = new Uint8Array(data.length / channels);

    for (let i = 0; i < data.length; i += channels) {
      const index = i / channels;
      const distance = Math.sqrt(
        (data[i] - background.r) ** 2 +
        (data[i + 1] - background.g) ** 2 +
        (data[i + 2] - background.b) ** 2
      );

      if (distance <= tolerance || data[i + 3] < 8) {
        toRemove[index] = 1;
      }
    }

    this.cleanupStrayPixels(toRemove, info.width, info.height);

    for (let i = 0; i < data.length; i += channels) {
      if (toRemove[i / channels]) {
        data[i + 3] = 0;
      }
    }

    return sharp(data, {
      raw: { width: info.width, height: info.height, channels: channels as Raw["channels"] }
    }).png().toBuffer();
  }

  private hasRealAlphaChannel(data: Buffer, channels: number, totalPixels: number): boolean {
    let fullyOpaque = 0;
    let fullyTransparent = 0;
    for (let i = 0; i < totalPixels; i++) {
      const alpha = data[i * channels + 3];
      if (alpha >= 254) fullyOpaque++;
      else if (alpha <= 1) fullyTransparent++;
    }
    const transparentRatio = fullyTransparent / totalPixels;
    const opaqueRatio = fullyOpaque / totalPixels;
    return transparentRatio > 0.02 && opaqueRatio < 0.98;
  }

  private estimateBackgroundFromEdges(data: Buffer, info: sharp.OutputInfo): { r: number; g: number; b: number } {
    const channels = info.channels;
    const samples: Array<{ r: number; g: number; b: number }> = [];

    const stride = Math.max(1, Math.floor(Math.min(info.width, info.height) / 40));
    for (let x = 0; x < info.width; x += stride) {
      const top = x * channels;
      samples.push({ r: data[top], g: data[top + 1], b: data[top + 2] });
      const bottom = ((info.height - 1) * info.width + x) * channels;
      samples.push({ r: data[bottom], g: data[bottom + 1], b: data[bottom + 2] });
    }
    for (let y = stride; y < info.height - 1; y += stride) {
      const left = y * info.width * channels;
      samples.push({ r: data[left], g: data[left + 1], b: data[left + 2] });
      const right = (y * info.width + info.width - 1) * channels;
      samples.push({ r: data[right], g: data[right + 1], b: data[right + 2] });
    }

    const rValues = samples.map(s => s.r).sort((a, b) => a - b);
    const gValues = samples.map(s => s.g).sort((a, b) => a - b);
    const bValues = samples.map(s => s.b).sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);

    return {
      r: rValues[mid],
      g: gValues[mid],
      b: bValues[mid]
    };
  }

  private computeAdaptiveTolerance(
    data: Buffer, info: sharp.OutputInfo,
    background: { r: number; g: number; b: number }, channels: number
  ): number {
    const edgeDists: number[] = [];
    for (let x = 0; x < info.width; x++) {
      [0, info.height - 1].forEach(y => {
        const i = (y * info.width + x) * channels;
        edgeDists.push(Math.sqrt(
          (data[i] - background.r) ** 2 +
          (data[i + 1] - background.g) ** 2 +
          (data[i + 2] - background.b) ** 2
        ));
      });
    }
    if (edgeDists.length === 0) return 42;
    edgeDists.sort((a, b) => a - b);

    const q3 = edgeDists[Math.floor(edgeDists.length * 0.75)];
    const iqr = edgeDists[Math.floor(edgeDists.length * 0.75)] - edgeDists[Math.floor(edgeDists.length * 0.25)];
    return Math.min(64, Math.max(24, Math.round(q3 + iqr * 1.5)));
  }

  private cleanupStrayPixels(mask: Uint8Array, width: number, height: number): void {
    const total = width * height;
    const visited = new Uint8Array(total);
    const minRegion = Math.max(12, Math.floor(total * 0.008));

    for (let start = 0; start < total; start++) {
      if (!mask[start] || visited[start]) continue;

      const stack = [start];
      visited[start] = 1;
      const component: number[] = [];

      while (stack.length > 0) {
        const index = stack.pop()!;
        component.push(index);
        const x = index % width;
        const y = Math.floor(index / width);
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y < height - 1 ? index + width : -1
        ];
        for (const next of neighbors) {
          if (next >= 0 && mask[next] && !visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }

      if (component.length < minRegion) {
        for (const index of component) mask[index] = 0;
      }
    }
  }

  private async trimTransparent(input: Buffer): Promise<Buffer> {
    try {
      return await sharp(input)
        .trim({
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          threshold: 1
        })
        .png()
        .toBuffer();
    } catch {
      return input;
    }
  }

  private async removeEdgeArtifacts(input: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const total = info.width * info.height;
    const visited = new Uint8Array(total);
    const remove = new Uint8Array(total);
    const minArtifactArea = Math.max(64, Math.floor(total * 0.035));

    for (let start = 0; start < total; start += 1) {
      if (visited[start] || data[start * channels + 3] <= 12) {
        continue;
      }

      const stack = [start];
      const component: number[] = [];
      visited[start] = 1;
      let touchesEdge = false;

      while (stack.length > 0) {
        const index = stack.pop() as number;
        component.push(index);
        const x = index % info.width;
        const y = Math.floor(index / info.width);
        if (x <= 1 || y <= 1 || x >= info.width - 2 || y >= info.height - 2) {
          touchesEdge = true;
        }

        const neighbors = [index - 1, index + 1, index - info.width, index + info.width];
        for (const next of neighbors) {
          if (next < 0 || next >= total || visited[next]) {
            continue;
          }
          const nextX = next % info.width;
          if ((next === index - 1 && nextX !== x - 1) || (next === index + 1 && nextX !== x + 1)) {
            continue;
          }
          if (data[next * channels + 3] > 12) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }

      if (touchesEdge && component.length < minArtifactArea) {
        for (const index of component) {
          remove[index] = 1;
        }
      }
    }

    for (let index = 0; index < total; index += 1) {
      if (remove[index]) {
        data[index * channels + 3] = 0;
      }
    }

    return sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: channels as Raw["channels"]
      }
    })
      .png()
      .toBuffer();
  }

  private async normalizeCanvas(input: Buffer, size: Size, anchor: "center" | "bottom-center" = "center", padding = 0): Promise<Buffer> {
    const safePadding = Math.max(0, Math.min(padding, Math.floor(Math.min(size.width, size.height) / 4)));
    const targetWidth = Math.max(1, size.width - safePadding * 2);
    const targetHeight = Math.max(1, size.height - safePadding * 2);
    const resized = await sharp(input)
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "inside",
        kernel: sharp.kernel.nearest
      })
      .png()
      .toBuffer();
    const metadata = await sharp(resized).metadata();
    const resizedWidth = metadata.width ?? targetWidth;
    const resizedHeight = metadata.height ?? targetHeight;
    const left = Math.floor((size.width - resizedWidth) / 2);
    const top =
      anchor === "bottom-center"
        ? Math.max(0, size.height - safePadding - resizedHeight)
        : Math.floor((size.height - resizedHeight) / 2);

    return sharp({
      create: {
        width: size.width,
        height: size.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{
        input: resized,
        left,
        top
      }])
      .png()
      .toBuffer();
  }
}
