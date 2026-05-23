import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, dialog } from "electron";
import fs from "fs-extra";
import type { CreateProjectInput, Project, RecentProject } from "@shared/types";
import {
  ensureProjectDirectories,
  nowIso,
  readJsonFile,
  sanitizeFileName,
  uniqueByPath,
  writeJsonFile
} from "./utils";
import { SettingsService } from "./settingsService";

export class ProjectService {
  private readonly recentPath: string;

  constructor(private readonly settingsService: SettingsService) {
    this.recentPath = path.join(app.getPath("userData"), "recent-projects.json");
  }

  async chooseProjectRoot(): Promise<string> {
    const result = await dialog.showOpenDialog({
      title: "选择项目父目录",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      throw new Error("已取消选择目录");
    }

    return result.filePaths[0];
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const settings = await this.settingsService.getSettings();
    const parentDirectory = input.parentDirectory?.trim() || settings.defaultProjectRoot;
    const projectPath = path.join(parentDirectory, sanitizeFileName(input.name));

    if (await fs.pathExists(path.join(projectPath, "project.json"))) {
      throw new Error(`项目已存在: ${projectPath}`);
    }

    await ensureProjectDirectories(projectPath);

    const createdAt = nowIso();
    const project: Project = {
      id: randomUUID(),
      name: input.name.trim() || "Untitled Project",
      path: projectPath,
      gameType: input.gameType,
      style: input.style,
      styleDescription: input.style,
      defaultResolution: input.defaultResolution,
      defaultBackground: input.defaultBackground,
      exportTargets: input.exportTargets,
      assets: [],
      styleTemplates: [
        {
          id: randomUUID(),
          name: "16-bit 像素风",
          description: "16-bit pixel art, clean silhouette, limited palette, transparent background",
          lineWeight: "crisp 1px edges",
          lighting: "top-left soft key light",
          cameraView: "side-view"
        },
        {
          id: randomUUID(),
          name: "暗黑地牢",
          description: "dark dungeon fantasy, readable shapes, muted metal and stone palette",
          lineWeight: "bold outline",
          lighting: "low warm torch light",
          cameraView: "top-down"
        }
      ],
      createdAt,
      updatedAt: createdAt
    };

    await this.saveProject(project);
    await this.addRecent(project);
    return project;
  }

  async openProjectDialog(): Promise<Project> {
    const result = await dialog.showOpenDialog({
      title: "打开 AI Sprite Studio 项目",
      filters: [{ name: "AI Sprite Studio Project", extensions: ["json"] }],
      properties: ["openFile"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      throw new Error("已取消打开项目");
    }

    return this.openProjectPath(result.filePaths[0]);
  }

  async openProjectPath(inputPath: string): Promise<Project> {
    const projectJsonPath = inputPath.endsWith("project.json")
      ? inputPath
      : path.join(inputPath, "project.json");

    if (!(await fs.pathExists(projectJsonPath))) {
      throw new Error(`未找到 project.json: ${projectJsonPath}`);
    }

    const project = await fs.readJson(projectJsonPath);
    const normalized: Project = {
      id: project.id ?? randomUUID(),
      name: project.name ?? project.projectName ?? "Untitled Project",
      path: path.dirname(projectJsonPath),
      gameType: project.gameType ?? "RPG",
      style: project.style ?? "16-bit pixel art",
      styleDescription: project.styleDescription ?? project.style ?? "",
      defaultResolution: project.defaultResolution ?? "64x64",
      defaultBackground: project.defaultBackground ?? "transparent",
      exportTargets: project.exportTargets ?? ["common"],
      assets: project.assets ?? [],
      styleTemplates: project.styleTemplates ?? [],
      createdAt: project.createdAt ?? nowIso(),
      updatedAt: project.updatedAt ?? nowIso()
    };

    await ensureProjectDirectories(normalized.path);
    await this.saveProject(normalized);
    await this.addRecent(normalized);
    return normalized;
  }

  async saveProject(project: Project): Promise<Project> {
    const nextProject: Project = {
      ...project,
      updatedAt: nowIso()
    };

    await ensureProjectDirectories(nextProject.path);
    await writeJsonFile(path.join(nextProject.path, "project.json"), nextProject);
    await this.addRecent(nextProject);
    return nextProject;
  }

  async addAssets(projectPath: string, assets: Project["assets"]): Promise<Project> {
    const project = await this.openProjectPath(projectPath);
    const assetMap = new Map(project.assets.map((asset) => [asset.id, asset]));

    for (const asset of assets) {
      assetMap.set(asset.id, asset);
    }

    return this.saveProject({
      ...project,
      assets: Array.from(assetMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    });
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    const recent = await readJsonFile<RecentProject[]>(this.recentPath, []);
    const existing: RecentProject[] = [];

    for (const item of recent) {
      if (await fs.pathExists(path.join(item.path, "project.json"))) {
        existing.push(item);
      }
    }

    if (existing.length !== recent.length) {
      await writeJsonFile(this.recentPath, existing);
    }

    return existing;
  }

  async deleteAsset(projectPath: string, assetId: string): Promise<Project> {
    const project = await this.openProjectPath(projectPath);
    const asset = project.assets.find((a) => a.id === assetId);
    if (asset) {
      const dir = path.dirname(projectPath.endsWith("project.json") ? projectPath : path.join(projectPath, "project.json"));
      for (const file of asset.files) {
        const absPath = path.isAbsolute(file) ? file : path.join(path.dirname(dir), file);
        try { await fs.remove(absPath); } catch { /* file may not exist */ }
      }
    }
    return this.saveProject({ ...project, assets: project.assets.filter((a) => a.id !== assetId) });
  }

  async removeRecentProject(projectPath: string): Promise<RecentProject[]> {
    const recent = await this.getRecentProjects();
    const next = recent.filter((item) => path.normalize(item.path) !== path.normalize(projectPath));
    await writeJsonFile(this.recentPath, next);
    return next;
  }

  private async addRecent(project: Project): Promise<void> {
    const recent = await readJsonFile<RecentProject[]>(this.recentPath, []);
    const next = uniqueByPath([
      {
        id: project.id,
        name: project.name,
        path: project.path,
        gameType: project.gameType,
        style: project.style,
        updatedAt: nowIso()
      },
      ...recent
    ]).slice(0, 12);

    await writeJsonFile(this.recentPath, next);
  }
}
