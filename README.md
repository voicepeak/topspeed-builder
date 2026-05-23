# AI Sprite Studio

Electron + React + TypeScript 桌面应用，用于把 AI 图片生成接入本地 2D 游戏素材流水线。它覆盖从项目配置、素材生成、后处理、预览、历史记录到 Unity / Godot / Tiled / ZIP 导出的完整 MVP 流程。

## 项目定位

AI Sprite Studio 面向独立游戏、美术原型和工具链验证场景。用户可以创建本地项目，定义游戏类型、美术风格、默认尺寸和导出目标，然后批量生成图标、道具、角色动作帧、怪物、背景、特效和 TileSet。

## 核心能力

| 模块 | 能力 |
| --- | --- |
| 项目 | 创建本地目录、保存 `project.json`、管理最近项目 |
| 生成 | 调用 OpenAI-compatible 图片 API、自定义 API 或本地草稿模式 |
| 后处理 | 使用 Sharp 处理透明背景、裁切、统一尺寸和 PNG 输出 |
| 批量 | 支持图标、道具、UI 素材批量名称列表生成 |
| 动画 | 生成角色动作帧并合成 Sprite Sheet |
| TileSet | 生成基础 Tile、预览图、metadata 和 Tiled `.tmx` |
| 打包 | 合成 Texture Atlas、生成 JSON metadata、导出 ZIP |
| 记录 | 保存生成历史、Prompt、参数和输出文件 |

## 页面结构

- 首页：新建项目、打开项目、最近项目
- 项目配置：项目名称、游戏类型、风格、默认尺寸、导出目标
- 素材生成：素材类型、描述、批量列表、动画和 TileSet 参数
- 预览：单图、动画帧、Sprite Sheet、Atlas 和 metadata 入口
- 风格：项目风格描述和风格模板
- 导出：Unity、Godot、Tiled、通用 PNG + JSON、ZIP
- 设置：API Key、API Base URL、默认路径、生成参数

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面壳 | Electron |
| 前端 | React、TypeScript、lucide-react |
| 构建 | Vite、electron-vite |
| 图像处理 | Sharp |
| 打包导出 | JSZip |
| 本地存储 | JSON 文件、项目目录、Electron userData |

## 快速开始

```bash
npm install
npm run dev
```

构建生产产物：

```bash
npm run build
```

构建输出目录：

```text
out/
```

## AI API 配置

在应用的设置页填写：

| 配置项 | 建议值 |
| --- | --- |
| `AI API Provider` | `openai`、`custom` 或 `local-draft` |
| `API Key` | 图片生成服务的 Key |
| `API Base URL` | OpenAI-compatible 图片接口，例如 `https://example.com/v1/images/generations` |
| `Model` | 中转站或服务商支持的图片模型，例如 `gpt-image-2` |

OpenAI-compatible 模式会发送最小兼容请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "prompt text",
  "n": 1,
  "size": "1024x1024"
}
```

透明背景、裁切和目标尺寸统一由本地 Sharp 后处理完成，避免依赖不同中转站对高级图片参数的兼容性。

## 本地草稿模式

`local-draft` 不调用外部 API，会生成本地占位 PNG。它适合验证：

- 项目创建和配置保存
- 图像后处理流程
- Sprite Sheet / Atlas / TileSet 合成
- metadata、历史记录和 ZIP 导出

正式出图请切换到外部图片 API。

## 项目目录结构

应用创建的项目目录大致如下：

```text
project.json
generated/
  raw/
  processed/
sprites/
icons/
tilesets/
sheets/
atlas/
exports/
history/
```

## 导出结果

| 目标 | 内容 |
| --- | --- |
| Unity | PNG、Sprite Sheet、Atlas、JSON metadata、导入说明 |
| Godot | PNG、Sprite Sheet、SpriteFrames 说明、JSON metadata、导入说明 |
| Tiled | TileSet PNG、TileSet JSON、TMX、导入说明 |
| Common | 通用 PNG + JSON |
| ZIP | 完整导出资源包 |

## 常用命令

```bash
npm run dev
npm run typecheck
npm run build
```

## 说明

所有项目数据和生成结果都保存在本地目录中。API Key 保存在 Electron `userData` 下的设置文件中，不会写入项目导出包。
