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
  EditIntent,
  ExportTarget,
  GenerateAssetInput,
  GenerationMode,
  GenerationHistoryRecord,
  ImportedReferenceImage,
  IpcResponse,
  Project,
  ReferenceImageInput,
  ReferenceImageRole,
  ReferenceStrength,
  RecentProject,
  StyleTemplate
} from "@shared/types";

type Page = "home" | "project" | "generate" | "preview" | "export" | "history" | "settings";
type DetailTemplate = { id: string; name: string; prompt: string; meta: string };
type ReferenceDraft = ReferenceImageInput & Partial<Pick<ImportedReferenceImage, "width" | "height" | "bytes" | "hash" | "thumbnailPath" | "dataUrl">>;
type SelectOption = string | { value: string; label: string };

const exportTargets: ExportTarget[] = ["unity", "godot", "tiled", "phaser", "cocos", "common"];
const exportTargetLabels: Record<ExportTarget, string> = {
  unity: "Unity",
  godot: "Godot",
  tiled: "Tiled",
  phaser: "Phaser",
  cocos: "Cocos",
  common: "通用"
};
const gameTypeOptions: SelectOption[] = [
  { value: "RPG", label: "角色扮演" },
  "平台跳跃",
  "俯视角",
  "横版动作",
  "卡牌",
  "塔防",
  "其他"
];
const backgroundOptions: SelectOption[] = [
  { value: "transparent", label: "透明" },
  { value: "solid", label: "纯色" },
  { value: "custom", label: "自定义" }
];
const characterViewOptions: SelectOption[] = [
  { value: "side-view", label: "侧视角" },
  { value: "top-down", label: "俯视角" },
  { value: "four-direction", label: "四方向" },
  { value: "eight-direction", label: "八方向" }
];
const providerOptions: SelectOption[] = [
  { value: "openai", label: "OpenAI" },
  { value: "custom", label: "自定义接口" },
  { value: "local-draft", label: "本地草稿" }
];
const qualityOptions: SelectOption[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" }
];
const generationModes: Array<{ value: GenerationMode; label: string }> = [
  { value: "text-to-image", label: "文本生成" },
  { value: "image-to-image", label: "参考图生成" }
];
const referenceRoles: Array<{ value: ReferenceImageRole; label: string }> = [
  { value: "subject", label: "主体参考" },
  { value: "style", label: "风格参考" },
  { value: "composition", label: "构图参考" },
  { value: "palette", label: "色板参考" }
];
const editIntentOptions: Array<{ value: EditIntent; label: string }> = [
  { value: "preserve-subject", label: "保持主体" },
  { value: "preserve-style", label: "保持风格" },
  { value: "preserve-composition", label: "保持构图" },
  { value: "same-series", label: "同系列变体" },
  { value: "inpaint", label: "局部替换" }
];
const editIntentLabels = Object.fromEntries(editIntentOptions.map((option) => [option.value, option.label])) as Record<EditIntent, string>;
const referenceStrengthOptions: Array<{ value: ReferenceStrength; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" }
];
const referenceStrengthLabels = Object.fromEntries(referenceStrengthOptions.map((option) => [option.value, option.label])) as Record<ReferenceStrength, string>;
const assetTypes: Array<{ value: AssetType; label: string }> = [
  { value: "icon", label: "图标" },
  { value: "item", label: "道具" },
  { value: "character", label: "角色" },
  { value: "enemy", label: "怪物" },
  { value: "tileset", label: "瓦片集" },
  { value: "ui", label: "界面" },
  { value: "background", label: "背景" },
  { value: "effect", label: "特效" }
];
const assetTypeLabels = Object.fromEntries(assetTypes.map((option) => [option.value, option.label])) as Record<AssetType, string>;

const objectDetailTemplates: Record<AssetType, DetailTemplate[]> = {
  icon: [
    { id: "icon-readable", name: "高可读轮廓", prompt: "单个居中物体，轮廓粗清晰，正面视角，无文字，无多余道具", meta: "图标 · 背包识别" },
    { id: "icon-material", name: "材质重点", prompt: "材质特征明确，边缘精致，小面积高光，在小尺寸下仍可辨识", meta: "图标 · 材质" },
    { id: "icon-rare", name: "稀有道具感", prompt: "高级收藏品质，形状紧凑，轻微发光，轮廓干净，背景无杂物", meta: "图标 · 品质" }
  ],
  item: [
    { id: "item-held", name: "可持握道具", prompt: "手持道具比例，有清晰握持区域，游戏内轮廓实用，单独物体", meta: "道具 · 使用感" },
    { id: "item-worn", name: "旧化边缘", prompt: "边缘磨损，有划痕和小凹痕，材质旧化可读但不过度杂乱", meta: "道具 · 质感" },
    { id: "item-quest", name: "任务物品", prompt: "任务物品形状独特，有可识别的焦点细节，略带仪式感结构", meta: "道具 · 叙事" }
  ],
  character: [
    { id: "character-consistent", name: "身份一致", prompt: "每一帧保持同一角色身份，服装、比例、色板和视角一致", meta: "角色 · 序列帧" },
    { id: "character-action", name: "动作清晰", prompt: "动作姿态明确，四肢分离可读，重心平衡，无运动模糊", meta: "角色 · 动作" },
    { id: "character-rpg", name: "角色站姿", prompt: "紧凑的角色精灵站姿，姿态英勇，武器可见，待机轮廓干净", meta: "角色 · 战斗" }
  ],
  enemy: [
    { id: "enemy-threat", name: "威胁轮廓", prompt: "敌对生物轮廓，形状夸张且可读，有明确弱点，不要可爱表情", meta: "怪物 · 识别" },
    { id: "enemy-slime", name: "软体怪", prompt: "凝胶状身体，简单面部，可挤压的圆润形体，边缘半透明高光", meta: "怪物 · 软体" },
    { id: "enemy-boss", name: "精英单位", prompt: "更大的精英变体细节，甲壳或护甲板，更强轮廓，攻击提示可读", meta: "怪物 · 精英" }
  ],
  tileset: [
    { id: "tile-seam", name: "拼接边缘", prompt: "边缘可平铺，图案可重复，边界不穿过独特地标，铺满整个瓦片", meta: "瓦片集 · 拼接" },
    { id: "tile-wear", name: "地表磨损", prompt: "细微裂缝、缺角和小幅表面变化，俯视光照一致", meta: "瓦片集 · 地表" },
    { id: "tile-modular", name: "模块套件", prompt: "模块化地牢结构，地面与墙体视觉语言匹配，尺度线索一致", meta: "瓦片集 · 模块" }
  ],
  ui: [
    { id: "ui-panel", name: "面板控件", prompt: "干净的界面面板部件，边缘适合九宫格切片，斜面可读，无文字标签", meta: "界面 · 面板" },
    { id: "ui-button", name: "按钮状态", prompt: "游戏按钮元素，按下状态几何结构清晰，中心高光，无内嵌文字", meta: "界面 · 控件" },
    { id: "ui-hud", name: "状态栏元件", prompt: "紧凑的状态栏元素，有强图标槽，高对比边框，透明背景", meta: "界面 · 状态栏" }
  ],
  background: [
    { id: "bg-parallax", name: "视差层", prompt: "横版卷轴视差层，前景与背景层次分明，无角色", meta: "背景 · 横版" },
    { id: "bg-loop", name: "循环背景", prompt: "可水平循环的背景，地标柔和重复，地平线一致", meta: "背景 · 循环" },
    { id: "bg-atmosphere", name: "气氛光", prompt: "环境气氛光，深度层次可读，不干扰玩法的背景", meta: "背景 · 气氛" }
  ],
  effect: [
    { id: "effect-impact", name: "命中特效", prompt: "短促命中爆发，中心点清晰，径向粒子，透明背景", meta: "特效 · 打击" },
    { id: "effect-loop", name: "循环粒子", prompt: "适合循环的粒子形状，能量流向一致，无明显开头或结尾", meta: "特效 · 循环" },
    { id: "effect-magic", name: "魔法光效", prompt: "奥术发光粒子，法术核心可读，外层柔和辉光，透明边缘干净", meta: "特效 · 魔法" }
  ]
};

const defaultAnimations: AnimationConfig[] = [
  { name: "待机", frames: 4, fps: 6, loop: true },
  { name: "行走", frames: 4, fps: 8, loop: true },
  { name: "攻击", frames: 4, fps: 10, loop: false }
];

const defaultSettings: AppSettings = {
  aiProvider: "openai",
  apiKey: "",
  apiBaseUrl: "https://api.openai.com/v1/images/generations",
  model: "gpt-image-1.5",
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
  const [queuedReference, setQueuedReference] = useState<ReferenceDraft | null>(null);
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
        setMessage("浏览器预览模式：桌面通信未连接；桌面应用中会启用本地文件、智能生成和导出服务。");
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
            <span>二维素材流水线</span>
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
            queuedReference={queuedReference}
            onQueuedReferenceConsumed={() => setQueuedReference(null)}
            onGenerated={async () => {
              await refreshProject(project.path);
              await refreshHistory(project.path);
              setPage("preview");
            }}
          />
        )}
        {page === "preview" && project && (
          <PreviewPage
            project={project}
            runTask={runTask}
            refreshProject={refreshProject}
            onUseAsReference={(asset, filePath) => {
              setQueuedReference({
                path: filePath,
                role: "subject",
                sourceAssetId: asset.id,
                name: asset.name
              });
              setPage("generate");
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
    name: "演示角色资源",
    parentDirectory: props.settings.defaultProjectRoot,
    gameType: "RPG",
    style: "十六位像素风",
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
        <PanelTitle icon={Plus} title="新建项目" subtitle="创建本地目录、项目配置文件和标准素材结构" />
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
            options={gameTypeOptions.slice(0, 6)}
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
        <PanelTitle icon={FolderOpen} title="打开项目" subtitle="从项目配置文件或最近项目进入工作区" />
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
          打开项目配置文件
        </button>
        <div className="recentList">
          {props.recentProjects.length === 0 && <EmptyState text="还没有最近项目" />}
          {props.recentProjects.map((item) => (
            <article key={item.path} className="recentItem">
              <div>
                <strong>{item.name}</strong>
                <span>{gameTypeLabel(item.gameType)} · {item.style}</span>
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
  const [newTemplate, setNewTemplate] = useState({ name: "赛博朋克霓虹风", description: "赛博朋克霓虹二维游戏美术，轮廓干净" });

  useEffect(() => setDraft(props.project), [props.project]);

  function addTemplate(): void {
    const template: StyleTemplate = {
      id: crypto.randomUUID(),
      name: newTemplate.name,
      description: newTemplate.description,
      lineWeight: "轮廓一致",
      lighting: "单主光",
      cameraView: "项目默认视角"
    };
    setDraft({ ...draft, styleTemplates: [template, ...draft.styleTemplates] });
  }

  function applyTemplate(template: StyleTemplate): void {
    setDraft({ ...draft, styleDescription: template.description });
  }

  return (
    <section className="panel wide">
      <PanelTitle icon={Gauge} title="项目配置" subtitle="这些配置会写回项目配置文件，并参与后续提示词与导出" />
      <div className="formGrid three">
        <TextInput label="项目名称" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        <SelectInput
          label="游戏类型"
          value={draft.gameType}
          options={gameTypeOptions}
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
          options={backgroundOptions}
          onChange={(defaultBackground) => setDraft({ ...draft, defaultBackground: defaultBackground as Project["defaultBackground"] })}
        />
        <TextInput label="项目路径" value={draft.path} disabled onChange={() => undefined} />
      </div>
      <TextArea label="项目风格描述（将注入所有智能生成提示词）" value={draft.styleDescription} onChange={(styleDescription) => setDraft({ ...draft, styleDescription })} />
      <TargetPicker value={draft.exportTargets} onChange={(exportTargets) => setDraft({ ...draft, exportTargets })} />

      <div className="panelTitle" style={{ border: "none", padding: "12px 0 0", marginTop: 4 }}>
        <div className="panelIcon"><Brush size={18} /></div>
        <div><h2>风格模板</h2><p>点击模板卡片即可注入上方项目风格提示词</p></div>
      </div>

      <div className="templateGrid">
        {draft.styleTemplates.length === 0 && <EmptyState text="还没有风格模板" />}
        {draft.styleTemplates.map((template) => (
          <article
            key={template.id}
            className="templateItem templateItemAction"
            role="button"
            tabIndex={0}
            title="点击注入到项目风格提示词"
            onClick={() => applyTemplate(template)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                applyTemplate(template);
              }
            }}
          >
            <button
              className="templateDelete"
              title="删除模板"
              onClick={(event) => {
                event.stopPropagation();
                setDraft({ ...draft, styleTemplates: draft.styleTemplates.filter((item) => item.id !== template.id) });
              }}
            >
              <Trash2 size={13} />
            </button>
            <strong>{template.name}</strong>
            <span>{template.description}</span>
            <small>{template.lineWeight ?? "线条"} · {template.lighting ?? "光照"} · {template.cameraView ?? "视角"}</small>
            <small className="templateHint">点击注入提示词</small>
          </article>
        ))}
      </div>

      <div className="formGrid">
        <TextInput label="模板名称" value={newTemplate.name} onChange={(name) => setNewTemplate({ ...newTemplate, name })} />
        <TextInput label="描述" value={newTemplate.description} onChange={(description) => setNewTemplate({ ...newTemplate, description })} />
        <button className="ghostButton" style={{ alignSelf: "end" }} onClick={addTemplate}>
          <Plus size={16} />
          添加模板
        </button>
      </div>

      <button
        className="primaryButton"
        onClick={async () => {
          const saved = await props.runTask("保存项目配置", () => unwrap(window.aiSpriteStudio.saveProject(draft)));
          if (saved) props.onSaved(saved);
        }}
      >
        <Save size={18} />
        保存项目配置
      </button>
    </section>
  );
}

function GeneratePage(props: {
  project: Project;
  settings: AppSettings;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  queuedReference: ReferenceDraft | null;
  onQueuedReferenceConsumed: () => void;
  onGenerated: () => Promise<void>;
}): JSX.Element {
  const defaultPresets = useMemo(() => presetsFor("icon", props.project.defaultResolution), []);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("text-to-image");
  const [assetType, setAssetType] = useState<AssetType>("icon");
  const detailTemplates = useMemo(() => objectDetailTemplates[assetType], [assetType]);
  const [name, setName] = useState(defaultPresets.name);
  const [description, setDescription] = useState(defaultPresets.description);
  const [detailPrompt, setDetailPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceDraft[]>([]);
  const [editIntent, setEditIntent] = useState<EditIntent>("preserve-subject");
  const [referenceStrength, setReferenceStrength] = useState<ReferenceStrength>("medium");
  const [maskImage, setMaskImage] = useState<ReferenceDraft | null>(null);
  const [size, setSize] = useState(defaultPresets.size);
  const [count, setCount] = useState(props.settings.defaultGenerationCount);
  const [transparentBackground, setTransparentBackground] = useState(defaultPresets.transparentBackground);
  const [targets, setTargets] = useState<ExportTarget[]>(props.project.exportTargets);
  const [iconItemsText, setIconItemsText] = useState("药水\n金币\n钥匙\n短剑\n盾牌\n卷轴\n魔法石");
  const [makeAtlas, setMakeAtlas] = useState(props.settings.autoPackAtlas);
  const [characterView, setCharacterView] = useState("side-view");
  const [animations, setAnimations] = useState<AnimationConfig[]>(defaultAnimations);
  const [makeSpriteSheet, setMakeSpriteSheet] = useState(true);
  const [tileTheme, setTileTheme] = useState("地牢");
  const [tileTypesText, setTileTypesText] = useState("地板\n墙体\n内角\n外角\n门\n水池\n裂缝\n宝箱");
  const [tileSeamless, setTileSeamless] = useState(true);
  const [makeTiled, setMakeTiled] = useState(true);

  useEffect(() => {
    const queued = props.queuedReference;
    if (!queued) return;

    setGenerationMode("image-to-image");
    setEditIntent("preserve-subject");
    setReferenceImages((current) => {
      if (current.some((item) => item.path === queued.path)) {
        return current;
      }
      return [...current, queued].slice(0, 4);
    });

    if (window.aiSpriteStudio) {
      window.aiSpriteStudio.readImageDataUrl(props.project.path, queued.path).then((result) => {
        if (!result.ok || !result.data) return;
        setReferenceImages((current) =>
          current.map((item) => (item.path === queued.path ? { ...item, dataUrl: result.data } : item))
        );
      });
    }
    props.onQueuedReferenceConsumed();
  }, [props.queuedReference, props.project.path]);

  function handleAssetTypeChange(newType: AssetType): void {
    setAssetType(newType);
    const { name: n, description: d, size: s, transparentBackground: t } = presetsFor(newType, props.project.defaultResolution);
    setName(n);
    setDescription(d);
    setDetailPrompt("");
    setSize(s);
    setTransparentBackground(t);
  }

  const input: GenerateAssetInput = {
    projectPath: props.project.path,
    generationMode,
    assetType,
    name,
    description,
    detailPrompt,
    referenceImages: generationMode === "image-to-image" ? referenceImages.map(toReferenceInput) : [],
    editIntent,
    referenceStrength,
    maskImagePath: generationMode === "image-to-image" && editIntent === "inpaint" ? maskImage?.path : undefined,
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
        <PanelTitle icon={Wand2} title="素材生成" subtitle={`当前接口：${providerLabel(props.settings.aiProvider)} · 模型：${props.settings.model}`} />
        {props.settings.aiProvider === "local-draft" && (
          <div className="inlineWarning">
            当前是本地草稿模式，不会调用外部智能生成接口。要调用中转服务，请到设置页切换服务商。
          </div>
        )}
        <div className="typeRail">
          {assetTypes.map((type) => (
            <button key={type.value} className={assetType === type.value ? "selected" : ""} onClick={() => handleAssetTypeChange(type.value)}>
              {type.label}
            </button>
          ))}
        </div>

        <div className="modeRail">
          {generationModes.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={generationMode === mode.value ? "selected" : ""}
              onClick={() => setGenerationMode(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="inlineNote">
          项目风格会自动注入生成提示词；这里填写当前素材独有的造型、材质、姿态或构图细节。
        </div>
        {generationMode === "image-to-image" && (
          <ReferenceImagePanel
            project={props.project}
            value={referenceImages}
            maskImage={maskImage}
            editIntent={editIntent}
            referenceStrength={referenceStrength}
            runTask={props.runTask}
            onChange={setReferenceImages}
            onMaskChange={setMaskImage}
            onEditIntentChange={setEditIntent}
            onReferenceStrengthChange={setReferenceStrength}
          />
        )}
        <div className="formGrid">
          <TextInput label="素材名称" value={name} onChange={setName} />
          <TextInput label="尺寸" value={size} onChange={setSize} />
          <NumberInput label="数量" value={count} min={1} max={64} onChange={setCount} />
        </div>
        <TextArea label="描述" value={description} onChange={setDescription} />
        <div className="detailTemplateBlock">
          <div className="detailTemplateHeader">
            <div>
              <strong>对象细节模板</strong>
              <span>点击卡片即可注入下方对象细节提示词</span>
            </div>
            {detailPrompt && (
              <button className="miniClearButton" type="button" onClick={() => setDetailPrompt("")}>
                清空
              </button>
            )}
          </div>
          <div className="detailTemplateGrid">
            {detailTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={detailPrompt === template.prompt ? "detailTemplateCard selected" : "detailTemplateCard"}
                title="点击注入对象细节提示词"
                onClick={() => setDetailPrompt(template.prompt)}
              >
                <strong>{template.name}</strong>
                <span>{template.prompt}</span>
                <small>{template.meta}</small>
                <em>点击注入提示词</em>
              </button>
            ))}
          </div>
        </div>
        <TextArea label="对象细节提示词（可选，可编辑）" value={detailPrompt} onChange={setDetailPrompt} />
        <Toggle label="透明背景" value={transparentBackground} onChange={setTransparentBackground} />
        <TargetPicker value={targets} onChange={setTargets} />

        {(assetType === "icon" || assetType === "item" || assetType === "ui") && (
          <div className="subPanel">
            <TextArea label="批量名称列表" value={iconItemsText} onChange={setIconItemsText} />
            <Toggle label="生成图集" value={makeAtlas} onChange={setMakeAtlas} />
          </div>
        )}

        {assetType === "character" && (
          <div className="subPanel">
            <SelectInput
              label="角色视角"
              value={characterView}
              options={characterViewOptions}
              onChange={setCharacterView}
            />
            <AnimationEditor value={animations} onChange={setAnimations} />
            <Toggle label="合成精灵表" value={makeSpriteSheet} onChange={setMakeSpriteSheet} />
          </div>
        )}

        {assetType === "tileset" && (
          <div className="subPanel">
            <TextInput label="瓦片集主题" value={tileTheme} onChange={setTileTheme} />
            <TextArea label="瓦片类型" value={tileTypesText} onChange={setTileTypesText} />
            <Toggle label="边缘尽量可拼接" value={tileSeamless} onChange={setTileSeamless} />
            <Toggle label="生成 Tiled 地图文件" value={makeTiled} onChange={setMakeTiled} />
          </div>
        )}

        <button
          className="primaryButton"
          disabled={generationMode === "image-to-image" && referenceImages.length === 0}
          onClick={async () => {
            const result = await props.runTask(
              "生成素材",
              () => unwrap(window.aiSpriteStudio.generateAssets(input)),
              (generated) => `生成完成：${generated.files.length} 个文件，元数据：${generated.metadataPath ?? "无"}`
            );
            if (result) await props.onGenerated();
          }}
        >
          <Sparkles size={18} />
          调用生成并处理
        </button>
      </section>

      <section className="panel">
        <PanelTitle icon={Archive} title="任务摘要" subtitle="提交后由桌面主进程执行" />
        <TaskSummary input={input} />
      </section>
    </div>
  );
}

function TaskSummary(props: { input: GenerateAssetInput }): JSX.Element {
  const input = props.input;
  const lines = [
    ["生成方式", input.generationMode === "image-to-image" ? "参考图生成" : "文本生成"],
    ["素材类型", assetTypeLabels[input.assetType]],
    ["素材名称", input.name || "未命名"],
    ["画布尺寸", input.size],
    ["生成数量", `${input.count}`],
    ["透明背景", input.transparentBackground ? "是" : "否"],
    ["导出目标", input.exportTargets.map((target) => exportTargetLabels[target]).join("、") || "未选择"],
    ["图集输出", input.makeAtlas ? "生成" : "不生成"],
    ["精灵表输出", input.makeSpriteSheet ? "生成" : "不生成"],
    ["瓦片地图输出", input.makeTiled ? "生成" : "不生成"]
  ];

  if (input.generationMode === "image-to-image") {
    lines.push(["参考图数量", `${input.referenceImages.length}`]);
    lines.push(["编辑意图", editIntentLabels[input.editIntent]]);
    lines.push(["参考强度", referenceStrengthLabels[input.referenceStrength]]);
    lines.push(["蒙版", input.maskImagePath ? "已选择" : "未选择"]);
  }

  return (
    <div className="taskSummary">
      {lines.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      <section>
        <span>描述</span>
        <p>{input.description || "未填写"}</p>
      </section>
      {input.detailPrompt && (
        <section>
          <span>对象细节提示词</span>
          <p>{input.detailPrompt}</p>
        </section>
      )}
      {input.generationMode === "image-to-image" && input.referenceImages.length > 0 && (
        <section>
          <span>参考图用途</span>
          <p>
            {input.referenceImages
              .map((image, index) => `第 ${index + 1} 张：${referenceRoles.find((role) => role.value === image.role)?.label ?? image.role}`)
              .join("；")}
          </p>
        </section>
      )}
    </div>
  );
}

function ReferenceImagePanel(props: {
  project: Project;
  value: ReferenceDraft[];
  maskImage: ReferenceDraft | null;
  editIntent: EditIntent;
  referenceStrength: ReferenceStrength;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  onChange: (value: ReferenceDraft[]) => void;
  onMaskChange: (value: ReferenceDraft | null) => void;
  onEditIntentChange: (value: EditIntent) => void;
  onReferenceStrengthChange: (value: ReferenceStrength) => void;
}): JSX.Element {
  async function importReferences(): Promise<void> {
    const imported = await props.runTask(
      "导入参考图",
      () => unwrap(window.aiSpriteStudio.chooseReferenceImages(props.project.path)),
      (result) => `已导入 ${result.length} 张参考图`
    );
    if (!imported) return;

    const merged = [...props.value];
    for (const image of imported) {
      if (merged.length >= 4) break;
      if (!merged.some((item) => item.path === image.path)) {
        merged.push(image);
      }
    }
    props.onChange(merged);
  }

  async function importMask(): Promise<void> {
    const imported = await props.runTask(
      "导入蒙版",
      () => unwrap(window.aiSpriteStudio.chooseMaskImage(props.project.path)),
      () => "蒙版已导入"
    );
    if (imported) props.onMaskChange(imported);
  }

  function updateRole(pathValue: string, role: ReferenceImageRole): void {
    props.onChange(props.value.map((image) => (image.path === pathValue ? { ...image, role } : image)));
  }

  return (
    <div className="referencePanel">
      <div className="referenceHeader">
        <div>
          <strong>参考图</strong>
          <span>{props.value.length}/4 · 导入后会复制到当前项目参考图目录</span>
        </div>
        <div className="referenceActions">
          <button className="ghostButton" type="button" onClick={importReferences} disabled={props.value.length >= 4}>
            <Plus size={15} />
            导入参考图
          </button>
          <button className="ghostButton" type="button" onClick={() => props.onChange([])} disabled={props.value.length === 0}>
            <Trash2 size={15} />
            清空
          </button>
        </div>
      </div>

      <div className="formGrid">
        <SelectInput
          label="编辑意图"
          value={props.editIntent}
          options={editIntentOptions}
          onChange={(value) => props.onEditIntentChange(value as EditIntent)}
        />
        <SelectInput
          label="参考强度"
          value={props.referenceStrength}
          options={referenceStrengthOptions}
          onChange={(value) => props.onReferenceStrengthChange(value as ReferenceStrength)}
        />
      </div>

      {props.value.length === 0 ? (
        <EmptyState text="还没有参考图" />
      ) : (
        <div className="referenceGrid">
          {props.value.map((image) => (
            <article key={image.path} className="referenceCard">
              <div className="referenceThumb">
                {image.dataUrl ? <img src={image.dataUrl} alt={image.name ?? image.path} /> : <Image size={34} />}
              </div>
              <div className="referenceMeta">
                <strong>{image.name ?? image.path.split(/[\\/]/).pop()}</strong>
                <small>{image.width && image.height ? `${image.width}x${image.height}` : "项目素材"}</small>
                <select value={image.role} onChange={(event) => updateRole(image.path, event.target.value as ReferenceImageRole)}>
                  {referenceRoles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="referenceRemove"
                type="button"
                title="移除参考图"
                onClick={() => props.onChange(props.value.filter((item) => item.path !== image.path))}
              >
                <Trash2 size={13} />
              </button>
            </article>
          ))}
        </div>
      )}

      {props.editIntent === "inpaint" && (
        <div className="maskPanel">
          <div>
            <strong>局部替换蒙版</strong>
            <span>{props.maskImage ? props.maskImage.name ?? props.maskImage.path : "需要带透明通道的 PNG 图片"}</span>
          </div>
          <button className="ghostButton" type="button" onClick={importMask}>
            <Brush size={15} />
            选择蒙版
          </button>
          {props.maskImage && (
            <button className="miniClearButton" type="button" onClick={() => props.onMaskChange(null)}>
              移除蒙版
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewPage(props: {
  project: Project;
  runTask: <T>(label: string, task: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  refreshProject: () => Promise<Project | null>;
  onUseAsReference: (asset: Asset, filePath: string) => void;
}): JSX.Element {
  return (
    <section className="panel wide">
      <PanelTitle icon={Image} title="素材预览" subtitle={`${props.project.assets.length} 个素材包`} />
      <div className="assetGrid">
        {props.project.assets.length === 0 && <EmptyState text="还没有生成素材" />}
        {props.project.assets.map((asset) => (
          <AssetCard
            key={asset.id}
            project={props.project}
            asset={asset}
            runTask={props.runTask}
            onUseAsReference={props.onUseAsReference}
            onDelete={async () => { await props.refreshProject(); }}
          />
        ))}
      </div>
      <button className="ghostButton" onClick={() => props.refreshProject()}>
        <RefreshCw size={16} />
        重新读取项目配置
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
      <PanelTitle icon={Package} title="导出" subtitle="生成 Unity、Godot、Tiled 和通用资源目录，以及压缩包" />
      <TargetPicker value={targets} onChange={setTargets} />
      <Toggle label="生成完整压缩包" value={includeZip} onChange={setIncludeZip} />
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
              <span>
                {assetTypeLabels[record.assetType]} · {record.parameters.generationMode === "image-to-image" ? "参考图生成" : "文本生成"} ·{" "}
                {new Date(record.createdAt).toLocaleString()}
              </span>
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
      <PanelTitle icon={Settings} title="设置" subtitle="接口密钥、默认路径和生成参数保存在本机应用数据目录" />
      <div className="formGrid three">
        <SelectInput
          label="人工智能接口服务商"
          value={draft.aiProvider}
          options={providerOptions}
          onChange={(aiProvider) => setDraft({ ...draft, aiProvider: aiProvider as AppSettings["aiProvider"] })}
        />
        <TextInput label="默认模型" value={draft.model} onChange={(model) => setDraft({ ...draft, model })} />
        <SelectInput
          label="生成质量"
          value={draft.generationQuality}
          options={qualityOptions}
          onChange={(generationQuality) => setDraft({ ...draft, generationQuality: generationQuality as AppSettings["generationQuality"] })}
        />
        <TextInput label="接口基础地址" value={draft.apiBaseUrl} onChange={(apiBaseUrl) => setDraft({ ...draft, apiBaseUrl })} />
        <TextInput label="接口密钥" value={draft.apiKey} type="password" onChange={(apiKey) => setDraft({ ...draft, apiKey })} />
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
        <Toggle label="保存提示词历史" value={draft.savePromptHistory} onChange={(savePromptHistory) => setDraft({ ...draft, savePromptHistory })} />
        <Toggle label="自动透明背景" value={draft.autoTransparent} onChange={(autoTransparent) => setDraft({ ...draft, autoTransparent })} />
        <Toggle label="自动裁切" value={draft.autoTrim} onChange={(autoTrim) => setDraft({ ...draft, autoTrim })} />
        <Toggle label="自动打包图集" value={draft.autoPackAtlas} onChange={(autoPackAtlas) => setDraft({ ...draft, autoPackAtlas })} />
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
  onUseAsReference?: (asset: Asset, filePath: string) => void;
  onDelete?: () => Promise<void>;
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
        <span>{assetTypeLabels[props.asset.type]} · {props.asset.size.width}x{props.asset.size.height}</span>
        <small>{props.asset.files.length} 个文件</small>
      </div>
      <div className="assetActions">
        {props.asset.generationMode === "image-to-image" && <Pill>参考图</Pill>}
        {props.asset.sheetPath && <Pill>精灵表</Pill>}
        {props.asset.atlasPath && <Pill>图集</Pill>}
        {props.asset.metadataPath && <Pill>元数据</Pill>}
      </div>
      {props.asset.exportTargets && props.asset.exportTargets.length > 0 && (
        <div className="assetActions" style={{ gap: 4 }}>
          {props.asset.exportTargets.map((t) => (
            <span key={t} className="pill" style={{ borderColor: "rgba(0,212,255,0.25)", color: "var(--cyan)", background: "var(--cyan-dim)" }}>{exportTargetLabels[t]}</span>
          ))}
        </div>
      )}
      <div className="assetActions" style={{ marginTop: "auto" }}>
        {pngFile && props.onUseAsReference && (
          <button className="ghostButton" onClick={() => props.onUseAsReference?.(props.asset, pngFile)}>
            <Image size={15} />
            参考
          </button>
        )}
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
        <button
          className="ghostButton"
          style={{ borderColor: "rgba(255,45,149,0.3)", color: "var(--magenta)" }}
          onClick={async () => {
            if (!window.confirm(`确认删除素材「${props.asset.name}」？\n关联的本地文件将被一并移除，此操作不可撤销。`)) return;
            const result = await props.runTask(
              "删除素材",
              () => unwrap(window.aiSpriteStudio.deleteAsset(props.project.path, props.asset.id)),
              () => "已删除"
            );
            if (result && props.onDelete) await props.onDelete();
          }}
        >
          <Trash2 size={15} />
          删除
        </button>
      </div>
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
          <button onClick={() => update(index, { loop: !animation.loop })}>{animation.loop ? "循环" : "单次"}</button>
        </div>
      ))}
      <button
        className="ghostButton"
        onClick={() => props.onChange([...props.value, { name: "受击", frames: 4, fps: 8, loop: false }])}
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

function SelectInput(props: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map((option) => (
          <option key={selectOptionValue(option)} value={selectOptionValue(option)}>
            {selectOptionLabel(option)}
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
            {exportTargetLabels[target]}
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
    home: "项目首页",
    project: "项目配置",
    generate: "素材生成",
    preview: "素材预览",
    export: "资源导出",
    history: "历史记录",
    settings: "应用设置"
  };
  return labels[page];
}

function presetsFor(type: AssetType, defaultSize: string): { name: string; description: string; size: string; transparentBackground: boolean } {
  switch (type) {
    case "character":
      return { name: "骑士", description: "银色盔甲骑士，手持短剑", size: "64x64", transparentBackground: true };
    case "tileset":
      return { name: "地牢", description: "石质地牢模块化瓦片集", size: "32x32", transparentBackground: false };
    case "icon":
      return { name: "角色扮演道具", description: "中世纪背包图标，轮廓清晰易识别", size: defaultSize, transparentBackground: true };
    case "item":
      return { name: "角色扮演道具", description: "中世纪背包道具，轮廓清晰易识别", size: defaultSize, transparentBackground: true };
    case "enemy":
      return { name: "史莱姆", description: "小型地牢软体怪，轮廓清晰", size: defaultSize, transparentBackground: true };
    case "ui":
      return { name: "界面面板", description: "游戏界面面板元素，干净扁平风格", size: defaultSize, transparentBackground: true };
    case "background":
      return { name: "森林背景", description: "横版卷轴森林背景层", size: "128x128", transparentBackground: false };
    case "effect":
      return { name: "火焰特效", description: "火焰爆炸粒子精灵表", size: "64x64", transparentBackground: true };
  }
}

function splitLines(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toReferenceInput(image: ReferenceDraft): ReferenceImageInput {
  return {
    path: image.path,
    role: image.role,
    sourceAssetId: image.sourceAssetId,
    name: image.name
  };
}

function selectOptionValue(option: SelectOption): string {
  return typeof option === "string" ? option : option.value;
}

function selectOptionLabel(option: SelectOption): string {
  return typeof option === "string" ? option : option.label;
}

function providerLabel(provider: AppSettings["aiProvider"]): string {
  const found = providerOptions.find((option) => selectOptionValue(option) === provider);
  return found ? selectOptionLabel(found) : provider;
}

function gameTypeLabel(gameType: string): string {
  const found = gameTypeOptions.find((option) => selectOptionValue(option) === gameType);
  return found ? selectOptionLabel(found) : gameType;
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
