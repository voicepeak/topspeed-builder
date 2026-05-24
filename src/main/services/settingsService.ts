import path from "node:path";
import { app } from "electron";
import fs from "fs-extra";
import type { AppSettings } from "@shared/types";
import { readJsonFile, writeJsonFile } from "./utils";

export class SettingsService {
  private readonly settingsPath: string;

  constructor() {
    this.settingsPath = path.join(app.getPath("userData"), "settings.json");
  }

  async getSettings(): Promise<AppSettings> {
    const defaults = await this.getDefaultSettings();
    return {
      ...defaults,
      ...(await readJsonFile<Partial<AppSettings>>(this.settingsPath, {}))
    };
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    await writeJsonFile(this.settingsPath, settings);
    return this.getSettings();
  }

  private async getDefaultSettings(): Promise<AppSettings> {
    const projectRoot = path.join(app.getPath("documents"), "AI Sprite Studio Projects");
    await fs.ensureDir(projectRoot);

    return {
      aiProvider: "openai",
      apiKey: "",
      apiBaseUrl: "https://api.openai.com/v1/images/generations",
      model: "gpt-image-1.5",
      defaultProjectRoot: projectRoot,
      defaultExportDirectory: "",
      defaultImageSize: "64x64",
      defaultGenerationCount: 4,
      savePromptHistory: true,
      autoTransparent: true,
      autoTrim: true,
      autoPackAtlas: true,
      generationQuality: "low"
    };
  }
}
