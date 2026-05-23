import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Boxes,
  Brush,
  Check,
  Clapperboard,
  Download,
  FolderOpen,
  Gauge,
  History,
  Home,
  Image,
  Loader2,
  Package,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Wand2
} from "lucide-react";
import type {
  AnimationConfig,
  AppSettings,
  Asset,
  AssetType,
  CreateProjectInput,
  ExportTarget,
  GenerateAssetInput,
  GenerationHistoryRecord,
  IpcResponse,
  Project,
  RecentProject,
  StyleTemplate
} from "@shared/types";

type Page = "home" | "project" | "generate" | "preview" | "style" | "export" | "history" | "settings";

const exportTargets: ExportTarget[] = ["unity", "godot", "tiled", "phaser", "cocos", "common"];
const assetTypes: Array<{ value: AssetType; label: string }> = [
  { value: "icon", label: "图标" },
  { value: "item", label: "道具" },
  { value: "character", label: "角色" },
  { value: "enemy", label: "怪物" },
  { value: "tileset", label: "TileSet" },
  { value: "ui", label: "UI" },
  { value: "background", label: "背景" },
  { value: "effect", label: "特效" }
];

const defaultAnimations: AnimationConfig[] = [
  { name: "idle", frames: 4, fps: 6, loop: true },
  { name: "walk", frames: 4, fps: 8, loop: true },
  { name: "attack", frames: 4, fps: 10, loop: false }
];

const defaultSettings: AppSettings = {
  aiProvider: "openai",
  apiKey: "",
  apiBaseUrl: "https://api.openai.com/v1/images/generations",
  model: "gpt-image-1",
  defaultProjectRoot: "",
  defaultExportDirectory: "",
  defaultImageSize: "64x64",
  defaultGenerationCount: 4,
  savePromptHistory: true,
  autoTransparent: true,
  autoTrim: true,
  autoPackAtlas: true,
  generationQuality: "low"
};

function App(): JSX.Element {
  const [page, setPage] = useState<Page>("home");
  const [project, setProject] = useState<Project | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [history, setHistory] = useState<GenerationHistoryRecord[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshInitialState();
  }, []);

  useEffect(() => {
    if (project) {
      void refreshHistory(project.path);
    }
  }, [project?.path]);

  const navItems = useMemo(
    () => [
      { page: "home" as Page, label: "首页", icon: Home, enabled: true },
      { page: "project" as Page, label: "项目配置", icon: Gauge, enabled: Boolean(project) },
      { page: "generate" as Page, label: "素材生成", icon: Wand2, enabled: Boolean(project) },
      { page: "preview" as Page, label: "预览", icon: Image, enabled: Boolean(project) },
      { page: "style" as Page, label: "风格", icon: Brush, enabled: Boolean(project) },
      { page: "export" as Page, label: "导出", icon: Download, enabled: Boolean(project) },
      { page: "history" as Page, label: "历史", icon: History, enabled: Boolean(project) },
      { page: "settings" as Page, label: "设置", icon: Settings, enabled: true }
    ],
    [project]
  );

  async function unwrap<T>(request: Promise<IpcResponse<T>>): Promise<T> {
    const result = await request;
    if (!result.ok) {
      throw new Error(result.error ?? "未知错误");
    }
    return result.data as T;
  }

  async function refreshInitialState(): Promise<void> {
    try {
      if (!window.aiSpriteStudio) {
        setMessage("浏览器预览模式：Electron IPC 未连接；桌面应用中会启用本地文件、AI 生成和导出服务。");
        return;
      }

      const [nextSettings, nextRecent] = await Promise.all([
        unwrap(window.aiSpriteStudio.getSettings()),
        unwrap(window.aiSpriteStudio.getRecentProjects())
      ]);
      setSettings(nextSettings);
      setRecentProjects(nextRecent);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshProject(projectPath = project?.path): Promise<Project | null> {
    if (!window.aiSpriteStudio) return null;
    if (!projectPath) return null;
    const nextProject = await unwrap(window.aiSpriteStudio.openProjectPath(projectPath));
    setProject(nextProject);
    return nextProject;
  }

  async function refreshHistory(projectPath: string): Promise<void> {
    if (!window.aiSpriteStudio) return;
    const nextHistory = await unwrap(window.aiSpriteStudio.getHistory(projectPath));
    setHistory(nextHistory);
  }

  async function runTask<T>(label: string, task: () => Promise<T>, success?: (result: T) => string): Promise<T | null> {
    setBusy(label);
    setMessage("");
    try {
      const result = await task();
      setMessage(success?.(result) ?? `${label}完成`);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>AI Sprite Studio</strong>
            <span>2D asset pipeline</span>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.page}
                className={page === item.page ? "active" : ""}
                disabled={!item.enabled}
                onClick={() => setPage(item.page)}
                title={item.label}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="projectDock">
          <span>当前项目</span>
          <strong>{project?.name ?? "未打开"}</strong>
          <small>{project?.path ?? "创建或打开一个本地素材项目"}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>{pageLabel(page)}</p>
            <h1>{project ? project.name : "AI Sprite Studio"}</h1>
          </div>
          <div className="statusStrip">
            {busy ? (
              <span className="busy">
                <Loader2 size={15} className="spin" />
                {busy}
              </span>
            ) : (
              <span className="ready">
                <Check size={15} />
                就绪
              </span>
            )}
          </div>
        </header>

        {message && <div className={message.includes("失败") || message.includes("错误") ? "notice error" : "notice"}>{message}</div>}

        {page === "home" && (
          <HomePage
            settings={settings}
            recentProjects={recentProjects}
            runTask={runTask}
            setProject={setProject}
            setPage={setPage}
            reloadRecent={refreshInitialState}
          />
        )}
        {page === "project" && project && (
          <ProjectPage
            project={project}
            runTask={runTask}
            onSaved={(nextProject) => {
              setProject(nextProject);
            }}
          />
        )}
        {page === "generate" && project && (
          <GeneratePage
            project={project}
            settings={settings}
            runTask={runTask}
            onGenerated={async () => {
              await refreshProject(project.path);
              await refreshHistory(project.path);
              setPage("preview");
            }}
          />
        )}
        {page === "preview" && project && <PreviewPage project={project} runTask={runTask} refreshProject={refreshProject} />}
        {page === "style" && project && (
          <StylePage
            project={project}
            runTask={runTask}
            onSaved={(nextProject) => {
              setProject(nextProject);
            }}
          />
        )}
        {page === "export" && project && <ExportPage project={project} runTask={runTask} />}
        {page === "history" && project && <HistoryPage project={project} history={history} />}
        {page === "settings" && (
          <SettingsPage
            settings={settings}
            runTask={runTask}
            onSaved={(nextSettings) => {
              setSettings(nextSettings);
            }}
          />
        )}
      </section>
    </main>
  );
}

function HomePage(props: {
  settings: AppSettings;
  recentProjects: RecentProject[];
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  setProject: (project: Project) => void;
  setPage: (page: Page) => void;
  reloadRecent: () => Promise<void>;
}): JSX.Element {
  const [input, setInput] = useState<CreateProjectInput>({
    name: "Demo RPG Game",
    parentDirectory: props.settings.defaultProjectRoot,
    gameType: "RPG",
    style: "16-bit pixel art",
    defaultResolution: "32x32",
    defaultBackground: "transparent",
    exportTargets: ["unity", "godot", "tiled", "common"]
  });

  useEffect(() => {
    setInput((current) => ({ ...current, parentDirectory: props.settings.defaultProjectRoot }));
  }, [props.settings.defaultProjectRoot]);

  return (
    <div className="pageGrid two">
      <section className="panel">
        <PanelTitle icon={Plus} title="新建项目" subtitle="创建本地目录、project.json 和标准素材结构" />
        <div className="formGrid">
          <TextInput label="项目名称" value={input.name} onChange={(name) => setInput({ ...input, name })} />
          <TextInput label="项目父目录" value={input.parentDirectory ?? ""} onChange={(parentDirectory) => setInput({ ...input, parentDirectory })} />
          <button
            className="ghostButton"
            onClick={async () => {
              const directory = await props.runTask("选择目录", () => unwrap(window.aiSpriteStudio.chooseProjectRoot()));
              if (directory) setInput({ ...input, parentDirectory: directory });
            }}
          >
            <FolderOpen size={16} />
            选择目录
          </button>
          <SelectInput
            label="游戏类型"
            value={input.gameType}
            options={["RPG", "平台跳跃", "俯视角", "横版动作", "卡牌", "塔防"]}
            onChange={(gameType) => setInput({ ...input, gameType })}
          />
          <SelectInput
            label="默认尺寸"
            value={input.defaultResolution}
            options={["16x16", "32x32", "64x64", "128x128"]}
            onChange={(defaultResolution) => setInput({ ...input, defaultResolution })}
          />
          <TextInput label="美术风格" value={input.style} onChange={(style) => setInput({ ...input, style })} />
          <TargetPicker value={input.exportTargets} onChange={(exportTargets) => setInput({ ...input, exportTargets })} />
        </div>
        <button
          className="primaryButton"
          onClick={async () => {
            const project = await props.runTask(
              "创建项目",
              () => unwrap(window.aiSpriteStudio.createProject(input)),
              (created) => `已创建项目: ${created.path}`
            );
            if (project) {
              props.setProject(project);
              props.setPage("project");
              await props.reloadRecent();
            }
          }}
        >
          <Plus size={18} />
          创建并进入
        </button>
      </section>

      <section className="panel">
        <PanelTitle icon={FolderOpen} title="打开项目" subtitle="从 project.json 或最近项目进入工作区" />
        <button
          className="primaryButton secondary"
          onClick={async () => {
            const project = await props.runTask("打开项目", () => unwrap(window.aiSpriteStudio.openProjectDialog()));
            if (project) {
              props.setProject(project);
              props.setPage("generate");
              await props.reloadRecent();
            }
          }}
        >
          <FolderOpen size={18} />
          打开 project.json
        </button>
        <div className="recentList">
          {props.recentProjects.length === 0 && <EmptyState text="还没有最近项目" />}
          {props.recentProjects.map((item) => (
            <article key={item.path} className="recentItem">
              <div>
                <strong>{item.name}</strong>
                <span>{item.gameType} · {item.style}</span>
                <small>{item.path}</small>
              </div>
              <div className="rowActions">
                <button
                  title="打开"
                  onClick={async () => {
                    const project = await props.runTask("打开最近项目", () => unwrap(window.aiSpriteStudio.openProjectPath(item.path)));
                    if (project) {
                      props.setProject(project);
                      props.setPage("generate");
                    }
                  }}
                >
                  <Play size={15} />
                </button>
                <button
                  title="移除记录"
                  onClick={async () => {
                    await props.runTask("移除最近项目", () => unwrap(window.aiSpriteStudio.removeRecentProject(item.path)));
                    await props.reloadRecent();
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProjectPage(props: {
  project: Project;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  onSaved: (project: Project) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Project>(props.project);
  useEffect(() => setDraft(props.project), [props.project]);

  return (
    <section className="panel wide">
      <PanelTitle icon={Gauge} title="项目配置" subtitle="这些配置会写回 project.json 并参与后续 prompt 与导出" />
      <div className="formGrid three">
        <TextInput label="项目名称" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        <SelectInput
          label="游戏类型"
          value={draft.gameType}
          options={["RPG", "平台跳跃", "俯视角", "横版动作", "卡牌", "塔防", "其他"]}
          onChange={(gameType) => setDraft({ ...draft, gameType })}
        />
        <SelectInput
          label="默认尺寸"
          value={draft.defaultResolution}
          options={["16x16", "32x32", "64x64", "128x128"]}
          onChange={(defaultResolution) => setDraft({ ...draft, defaultResolution })}
        />
        <TextInput label="美术风格" value={draft.style} onChange={(style) => setDraft({ ...draft, style })} />
        <SelectInput
          label="默认背景"
          value={draft.defaultBackground}
          options={["transparent", "solid", "custom"]}
          onChange={(defaultBackground) => setDraft({ ...draft, defaultBackground: defaultBackground as Project["defaultBackground"] })}
        />
        <TextInput label="项目路径" value={draft.path} disabled onChange={() => undefined} />
      </div>
      <TextArea label="项目风格描述" value={draft.styleDescription} onChange={(styleDescription) => setDraft({ ...draft, styleDescription })} />
      <TargetPicker value={draft.exportTargets} onChange={(exportTargets) => setDraft({ ...draft, exportTargets })} />
      <button
        className="primaryButton"
        onClick={async () => {
          const saved = await props.runTask("保存项目配置", () => unwrap(window.aiSpriteStudio.saveProject(draft)));
          if (saved) props.onSaved(saved);
        }}
      >
        <Save size={18} />
        保存 project.json
      </button>
    </section>
  );
}

function GeneratePage(props: {
  project: Project;
  settings: AppSettings;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  onGenerated: () => Promise<void>;
}): JSX.Element {
  const defaultPresets = useMemo(() => presetsFor("icon", props.project.defaultResolution), []);
  const [assetType, setAssetType] = useState<AssetType>("icon");
  const [name, setName] = useState(defaultPresets.name);
  const [description, setDescription] = useState(defaultPresets.description);
  const [style, setStyle] = useState(props.project.style);
  const [size, setSize] = useState(defaultPresets.size);
  const [count, setCount] = useState(props.settings.defaultGenerationCount);
  const [transparentBackground, setTransparentBackground] = useState(defaultPresets.transparentBackground);
  const [targets, setTargets] = useState<ExportTarget[]>(props.project.exportTargets);
  const [iconItemsText, setIconItemsText] = useState("potion\ncoin\nkey\nshort sword\nshield\nscroll\nmagic stone");
  const [makeAtlas, setMakeAtlas] = useState(props.settings.autoPackAtlas);
  const [characterView, setCharacterView] = useState("side-view");
  const [animations, setAnimations] = useState<AnimationConfig[]>(defaultAnimations);
  const [makeSpriteSheet, setMakeSpriteSheet] = useState(true);
  const [tileTheme, setTileTheme] = useState("dungeon");
  const [tileTypesText, setTileTypesText] = useState("floor\nwall\ninner corner\nouter corner\ndoor\nwater\ncrack\ntreasure chest");
  const [tileSeamless, setTileSeamless] = useState(true);
  const [makeTiled, setMakeTiled] = useState(true);

  function handleAssetTypeChange(newType: AssetType): void {
    setAssetType(newType);
    const { name: n, description: d, size: s, transparentBackground: t } = presetsFor(newType, props.project.defaultResolution);
    setName(n);
    setDescription(d);
    setSize(s);
    setTransparentBackground(t);
  }

  const input: GenerateAssetInput = {
    projectPath: props.project.path,
    assetType,
    name,
    description,
    style,
    size,
    count,
    transparentBackground,
    exportTargets: targets,
    iconItems: splitLines(iconItemsText),
    makeAtlas,
    characterView,
    animations,
    makeSpriteSheet,
    tileTheme,
    tileTypes: splitLines(tileTypesText),
    tileSeamless,
    makeTiled
  };

  return (
    <div className="pageGrid generation">
      <section className="panel">
        <PanelTitle icon={Wand2} title="素材生成" subtitle={`当前 API: ${props.settings.aiProvider} · 模型: ${props.settings.model}`} />
        {props.settings.aiProvider === "local-draft" && (
          <div className="inlineWarning">
            当前是 local-draft 本地草稿模式，不会调用外部 AI API。要调用中转站，请到设置页切换 Provider。
          </div>
        )}
        <div className="typeRail">
          {assetTypes.map((type) => (
            <button key={type.value} className={assetType === type.value ? "selected" : ""} onClick={() => handleAssetTypeChange(type.value)}>
              {type.label}
            </button>
          ))}
        </div>

        <div className="formGrid">
          <TextInput label="素材名称" value={name} onChange={setName} />
          <TextInput label="尺寸" value={size} onChange={setSize} />
          <NumberInput label="数量" value={count} min={1} max={64} onChange={setCount} />
          <TextInput label="风格" value={style} onChange={setStyle} />
        </div>
        <TextArea label="描述" value={description} onChange={setDescription} />
        <Toggle label="透明背景" value={transparentBackground} onChange={setTransparentBackground} />
        <TargetPicker value={targets} onChange={setTargets} />

        {(assetType === "icon" || assetType === "item" || assetType === "ui") && (
          <div className="subPanel">
            <TextArea label="批量名称列表" value={iconItemsText} onChange={setIconItemsText} />
            <Toggle label="生成 Atlas" value={makeAtlas} onChange={setMakeAtlas} />
          </div>
        )}

        {assetType === "character" && (
          <div className="subPanel">
            <SelectInput
              label="角色视角"
              value={characterView}
              options={["side-view", "top-down", "four-direction", "eight-direction"]}
              onChange={setCharacterView}
            />
            <AnimationEditor value={animations} onChange={setAnimations} />
            <Toggle label="合成 Sprite Sheet" value={makeSpriteSheet} onChange={setMakeSpriteSheet} />
          </div>
        )}

        {assetType === "tileset" && (
          <div className="subPanel">
            <TextInput label="TileSet 主题" value={tileTheme} onChange={setTileTheme} />
            <TextArea label="Tile 类型" value={tileTypesText} onChange={setTileTypesText} />
            <Toggle label="边缘尽量可拼接" value={tileSeamless} onChange={setTileSeamless} />
            <Toggle label="生成 Tiled TMX" value={makeTiled} onChange={setMakeTiled} />
          </div>
        )}

        <button
          className="primaryButton"
          onClick={async () => {
            const result = await props.runTask(
              "生成素材",
              () => unwrap(window.aiSpriteStudio.generateAssets(input)),
              (generated) => `生成完成：${generated.files.length} 个文件，metadata: ${generated.metadataPath ?? "无"}`
            );
            if (result) await props.onGenerated();
          }}
        >
          <Sparkles size={18} />
          调用生成并处理
        </button>
      </section>

      <section className="panel">
        <PanelTitle icon={Archive} title="将执行的任务" subtitle="提交后由 Electron 主进程执行" />
        <pre className="jsonPreview">{JSON.stringify(input, null, 2)}</pre>
      </section>
    </div>
  );
}

function PreviewPage(props: {
  project: Project;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  refreshProject: () => Promise<Project | null>;
}): JSX.Element {
  return (
    <section className="panel wide">
      <PanelTitle icon={Image} title="素材预览" subtitle={`${props.project.assets.length} 个素材包`} />
      <div className="assetGrid">
        {props.project.assets.length === 0 && <EmptyState text="还没有生成素材" />}
        {props.project.assets.map((asset) => (
          <AssetCard key={asset.id} project={props.project} asset={asset} runTask={props.runTask} />
        ))}
      </div>
      <button className="ghostButton" onClick={() => props.refreshProject()}>
        <RefreshCw size={16} />
        重新读取 project.json
      </button>
    </section>
  );
}

function StylePage(props: {
  project: Project;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  onSaved: (project: Project) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Project>(props.project);
  const [newTemplate, setNewTemplate] = useState({ name: "赛博朋克霓虹风", description: "cyberpunk neon 2D game art, clean silhouette" });

  useEffect(() => setDraft(props.project), [props.project]);

  function addTemplate(): void {
    const template: StyleTemplate = {
      id: crypto.randomUUID(),
      name: newTemplate.name,
      description: newTemplate.description,
      lineWeight: "consistent outlines",
      lighting: "single key light",
      cameraView: "project default"
    };
    setDraft({ ...draft, styleTemplates: [template, ...draft.styleTemplates] });
  }

  return (
    <section className="panel wide">
      <PanelTitle icon={Brush} title="风格管理" subtitle="项目级风格会参与所有生成 prompt" />
      <TextArea label="项目风格描述" value={draft.styleDescription} onChange={(styleDescription) => setDraft({ ...draft, styleDescription })} />
      <div className="formGrid">
        <TextInput label="模板名称" value={newTemplate.name} onChange={(name) => setNewTemplate({ ...newTemplate, name })} />
        <TextInput
          label="模板描述"
          value={newTemplate.description}
          onChange={(description) => setNewTemplate({ ...newTemplate, description })}
        />
        <button className="ghostButton" onClick={addTemplate}>
          <Plus size={16} />
          添加模板
        </button>
      </div>
      <div className="templateGrid">
        {draft.styleTemplates.map((template) => (
          <article key={template.id} className="templateItem">
            <strong>{template.name}</strong>
            <span>{template.description}</span>
            <small>{template.lineWeight ?? "line"} · {template.lighting ?? "light"} · {template.cameraView ?? "view"}</small>
          </article>
        ))}
      </div>
      <button
        className="primaryButton"
        onClick={async () => {
          const saved = await props.runTask("保存风格", () => unwrap(window.aiSpriteStudio.saveProject(draft)));
          if (saved) props.onSaved(saved);
        }}
      >
        <Save size={18} />
        保存风格
      </button>
    </section>
  );
}

function ExportPage(props: {
  project: Project;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
}): JSX.Element {
  const [targets, setTargets] = useState<ExportTarget[]>(props.project.exportTargets);
  const [includeZip, setIncludeZip] = useState(true);

  return (
    <section className="panel wide">
      <PanelTitle icon={Package} title="导出" subtitle="生成 Unity / Godot / Tiled / 通用资源目录和 ZIP 包" />
      <TargetPicker value={targets} onChange={setTargets} />
      <Toggle label="生成完整 ZIP 包" value={includeZip} onChange={setIncludeZip} />
      <button
        className="primaryButton"
        onClick={async () => {
          const result = await props.runTask(
            "导出资源",
            () => unwrap(window.aiSpriteStudio.exportProject({ projectPath: props.project.path, targets, includeZip })),
            (exported) => `导出完成：${exported.files.length} 个结果，目录 ${exported.exportRoot}`
          );
          if (result) {
            await window.aiSpriteStudio.openPath(result.exportRoot);
          }
        }}
      >
        <Download size={18} />
        导出资源
      </button>
    </section>
  );
}

function HistoryPage(props: { project: Project; history: GenerationHistoryRecord[] }): JSX.Element {
  return (
    <section className="panel wide">
      <PanelTitle icon={History} title="历史记录" subtitle={`${props.history.length} 次生成`} />
      <div className="historyList">
        {props.history.length === 0 && <EmptyState text="暂无历史记录" />}
        {props.history.map((record) => (
          <article key={record.id} className="historyItem">
            <div>
              <strong>{record.parameters.name || record.assetType}</strong>
              <span>{record.assetType} · {new Date(record.createdAt).toLocaleString()}</span>
              <small>{record.outputFiles.join(" · ")}</small>
            </div>
            <code>{record.prompt.slice(0, 240)}</code>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsPage(props: {
  settings: AppSettings;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  onSaved: (settings: AppSettings) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<AppSettings>(props.settings);
  useEffect(() => setDraft(props.settings), [props.settings]);

  return (
    <section className="panel wide">
      <PanelTitle icon={Settings} title="设置" subtitle="API Key、默认路径和生成参数保存在本机 userData 目录" />
      <div className="formGrid three">
        <SelectInput
          label="AI API Provider"
          value={draft.aiProvider}
          options={["openai", "custom", "local-draft"]}
          onChange={(aiProvider) => setDraft({ ...draft, aiProvider: aiProvider as AppSettings["aiProvider"] })}
        />
        <TextInput label="默认模型" value={draft.model} onChange={(model) => setDraft({ ...draft, model })} />
        <SelectInput
          label="生成质量"
          value={draft.generationQuality}
          options={["low", "medium", "high"]}
          onChange={(generationQuality) => setDraft({ ...draft, generationQuality: generationQuality as AppSettings["generationQuality"] })}
        />
        <TextInput label="API Base URL" value={draft.apiBaseUrl} onChange={(apiBaseUrl) => setDraft({ ...draft, apiBaseUrl })} />
        <TextInput label="API Key" value={draft.apiKey} type="password" onChange={(apiKey) => setDraft({ ...draft, apiKey })} />
        <TextInput label="默认项目目录" value={draft.defaultProjectRoot} onChange={(defaultProjectRoot) => setDraft({ ...draft, defaultProjectRoot })} />
        <TextInput label="默认导出目录" value={draft.defaultExportDirectory} onChange={(defaultExportDirectory) => setDraft({ ...draft, defaultExportDirectory })} />
        <TextInput label="默认图像尺寸" value={draft.defaultImageSize} onChange={(defaultImageSize) => setDraft({ ...draft, defaultImageSize })} />
        <NumberInput
          label="默认生成数量"
          value={draft.defaultGenerationCount}
          min={1}
          max={64}
          onChange={(defaultGenerationCount) => setDraft({ ...draft, defaultGenerationCount })}
        />
      </div>
      <div className="toggleRow">
        <Toggle label="保存 Prompt 历史" value={draft.savePromptHistory} onChange={(savePromptHistory) => setDraft({ ...draft, savePromptHistory })} />
        <Toggle label="自动透明背景" value={draft.autoTransparent} onChange={(autoTransparent) => setDraft({ ...draft, autoTransparent })} />
        <Toggle label="自动裁切" value={draft.autoTrim} onChange={(autoTrim) => setDraft({ ...draft, autoTrim })} />
        <Toggle label="自动打包 Atlas" value={draft.autoPackAtlas} onChange={(autoPackAtlas) => setDraft({ ...draft, autoPackAtlas })} />
      </div>
      <button
        className="primaryButton"
        onClick={async () => {
          const saved = await props.runTask("保存设置", () => unwrap(window.aiSpriteStudio.saveSettings(draft)));
          if (saved) props.onSaved(saved);
        }}
      >
        <Save size={18} />
        保存设置
      </button>
    </section>
  );
}

function AssetCard(props: {
  project: Project;
  asset: Asset;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
}): JSX.Element {
  const pngFile = props.asset.files.find((file) => file.endsWith(".png"));
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let alive = true;
    if (pngFile) {
      window.aiSpriteStudio.readImageDataUrl(props.project.path, pngFile).then((result) => {
        if (alive && result.ok && result.data) setDataUrl(result.data);
      });
    }
    return () => {
      alive = false;
    };
  }, [pngFile, props.project.path]);

  return (
    <article className="assetCard">
      <div className="assetPreview">{dataUrl ? <img src={dataUrl} alt={props.asset.name} /> : <Boxes size={42} />}</div>
      <div className="assetBody">
        <strong>{props.asset.name}</strong>
        <span>{props.asset.type} · {props.asset.size.width}x{props.asset.size.height}</span>
        <small>{props.asset.files.length} files</small>
      </div>
      <div className="assetActions">
        {props.asset.sheetPath && <Pill>Sheet</Pill>}
        {props.asset.atlasPath && <Pill>Atlas</Pill>}
        {props.asset.metadataPath && <Pill>JSON</Pill>}
      </div>
      <button
        className="ghostButton"
        onClick={() => {
          const file = props.asset.metadataPath ?? pngFile;
          if (file) {
            void props.runTask("打开文件位置", () => unwrap(window.aiSpriteStudio.showItemInFolder(resolveFile(props.project.path, file))));
          }
        }}
      >
        <FolderOpen size={15} />
        定位
      </button>
    </article>
  );
}

function AnimationEditor(props: { value: AnimationConfig[]; onChange: (value: AnimationConfig[]) => void }): JSX.Element {
  function update(index: number, patch: Partial<AnimationConfig>): void {
    props.onChange(props.value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="animationEditor">
      <label>动作帧</label>
      {props.value.map((animation, index) => (
        <div key={`${animation.name}-${index}`} className="animationRow">
          <input value={animation.name} onChange={(event) => update(index, { name: event.target.value })} />
          <input
            type="number"
            min={1}
            max={12}
            value={animation.frames}
            onChange={(event) => update(index, { frames: Number(event.target.value) })}
          />
          <input
            type="number"
            min={1}
            max={30}
            value={animation.fps}
            onChange={(event) => update(index, { fps: Number(event.target.value) })}
          />
          <button onClick={() => update(index, { loop: !animation.loop })}>{animation.loop ? "Loop" : "Once"}</button>
        </div>
      ))}
      <button
        className="ghostButton"
        onClick={() => props.onChange([...props.value, { name: "hurt", frames: 4, fps: 8, loop: false }])}
      >
        <Plus size={15} />
        添加动作
      </button>
    </div>
  );
}

function PanelTitle(props: { icon: typeof Home; title: string; subtitle: string }): JSX.Element {
  const Icon = props.icon;
  return (
    <div className="panelTitle">
      <div className="panelIcon">
        <Icon size={18} />
      </div>
      <div>
        <h2>{props.title}</h2>
        <p>{props.subtitle}</p>
      </div>
    </div>
  );
}

function TextInput(props: {
  label: string;
  value: string;
  type?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function NumberInput(props: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }): JSX.Element {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function TextArea(props: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="field full">
      <span>{props.label}</span>
      <textarea value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

function SelectInput(props: { label: string; value: string; options: string[]; onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (value: boolean) => void }): JSX.Element {
  return (
    <button className={props.value ? "toggle on" : "toggle"} onClick={() => props.onChange(!props.value)}>
      <span>{props.label}</span>
      <i />
    </button>
  );
}

function TargetPicker(props: { value: ExportTarget[]; onChange: (value: ExportTarget[]) => void }): JSX.Element {
  function toggle(target: ExportTarget): void {
    props.onChange(props.value.includes(target) ? props.value.filter((item) => item !== target) : [...props.value, target]);
  }

  return (
    <div className="targetPicker">
      <span>导出目标</span>
      <div>
        {exportTargets.map((target) => (
          <button key={target} className={props.value.includes(target) ? "selected" : ""} onClick={() => toggle(target)}>
            {target}
          </button>
        ))}
      </div>
    </div>
  );
}

function Pill(props: { children: string }): JSX.Element {
  return <span className="pill">{props.children}</span>;
}

function EmptyState(props: { text: string }): JSX.Element {
  return <div className="emptyState">{props.text}</div>;
}

function pageLabel(page: Page): string {
  const labels: Record<Page, string> = {
    home: "Project Home",
    project: "Project Settings",
    generate: "Generate Assets",
    preview: "Preview",
    style: "Style Library",
    export: "Export",
    history: "History",
    settings: "App Settings"
  };
  return labels[page];
}

function presetsFor(type: AssetType, defaultSize: string): { name: string; description: string; size: string; transparentBackground: boolean } {
  switch (type) {
    case "character":
      return { name: "knight", description: "silver armor knight with short sword", size: "64x64", transparentBackground: true };
    case "tileset":
      return { name: "dungeon", description: "stone dungeon modular tile set", size: "32x32", transparentBackground: false };
    case "icon":
      return { name: "rpg_items", description: "medieval RPG inventory icons, readable silhouettes", size: defaultSize, transparentBackground: true };
    case "item":
      return { name: "rpg_items", description: "medieval RPG inventory props, readable silhouettes", size: defaultSize, transparentBackground: true };
    case "enemy":
      return { name: "slime", description: "small dungeon slime enemy, readable silhouette", size: defaultSize, transparentBackground: true };
    case "ui":
      return { name: "ui_panel", description: "game UI panel elements, clean flat style", size: defaultSize, transparentBackground: true };
    case "background":
      return { name: "forest_bg", description: "side-scrolling forest background layer", size: "128x128", transparentBackground: false };
    case "effect":
      return { name: "fire_effect", description: "fire explosion particle sprite sheet", size: "64x64", transparentBackground: true };
  }
}

function splitLines(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveFile(projectPath: string, filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("/")) {
    return filePath;
  }
  return `${projectPath}\\${filePath.replace(/\//g, "\\")}`;
}

async function unwrap<T>(request: Promise<IpcResponse<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) {
    throw new Error(result.error ?? "未知错误");
  }
  return result.data as T;
}

export default App;
