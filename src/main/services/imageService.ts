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
    const background = this.estimateBackground(data, info);
    const tolerance = 42;

    for (let offset = 0; offset < data.length; offset += channels) {
      const distance = Math.sqrt(
        (data[offset] - background.r) ** 2 +
          (data[offset + 1] - background.g) ** 2 +
          (data[offset + 2] - background.b) ** 2
      );

      if (distance <= tolerance || data[offset + 3] < 8) {
        data[offset + 3] = 0;
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

  private estimateBackground(data: Buffer, info: sharp.OutputInfo): { r: number; g: number; b: number } {
    const samples: Array<{ r: number; g: number; b: number }> = [];
    const channels = info.channels;
    const points = [
      [0, 0],
      [info.width - 1, 0],
      [0, info.height - 1],
      [info.width - 1, info.height - 1]
    ];

    for (const [x, y] of points) {
      const offset = (y * info.width + x) * channels;
      samples.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
    }

    return samples.reduce(
      (sum, color) => ({
        r: sum.r + color.r / samples.length,
        g: sum.g + color.g / samples.length,
        b: sum.b + color.b / samples.length
      }),
      { r: 0, g: 0, b: 0 }
    );
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
