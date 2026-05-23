<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/ai--sprite--studio-v0.1.0-00d4ff?style=flat-square&labelColor=0b0e11">
    <img src="https://img.shields.io/badge/ai--sprite--studio-v0.1.0-00d4ff?style=flat-square&labelColor=0b0e11" alt="version">
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-33.x-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron"/>
  <img src="https://img.shields.io/badge/React-18.x-58c4dc?style=flat-square&logo=react&logoColor=white" alt="React"/>
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Vite-6.x-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"/>
  <img src="https://img.shields.io/badge/license-MIT-8a9aa8?style=flat-square" alt="MIT License"/>
</p>

<p align="center">
  <a href="#zh">🇨🇳 中文</a> · <a href="#en">🇬🇧 English</a>
</p>

---

<h1 align="center" id="zh">AI Sprite Studio</h1>

<p align="center">
  Electron + React + TypeScript 桌面应用，将 AI 图片生成接入本地 2D 游戏素材流水线。
</p>

## 概述

面向独立游戏开发者、美术原型师和工具链验证场景。创建本地项目，定义游戏类型、美术风格与导出目标，批量生成图标、道具、角色动作帧、怪物、背景、特效和 TileSet。所有数据与密钥均保存在本地，无云端依赖。

## 功能模块

| 模块 | 能力 |
|------|------|
| **项目** | 创建本地目录、保存 `project.json`、管理最近项目 |
| **生成** | 调用 OpenAI-compatible 图片 API、自定义 API 或本地草稿模式 |
| **后处理** | Sharp 处理透明背景、裁切、统一尺寸、PNG 输出 |
| **批量** | 图标 / 道具 / UI 素材批量名称列表生成 |
| **动画** | 角色动作帧合成 Sprite Sheet |
| **TileSet** | 基础 Tile、预览图、metadata、Tiled `.tmx` 导出 |
| **打包** | Texture Atlas 合成、JSON metadata、ZIP 导出 |
| **记录** | 生成历史、Prompt、参数和输出文件保存 |

## 快速开始

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

构建产物输出到 `out/`。

## AI API 配置

在设置页填写：

| 配置项 | 建议值 |
|--------|--------|
| `AI API Provider` | `openai` \| `custom` \| `local-draft` |
| `API Key` | 图片生成服务的 Key |
| `API Base URL` | OpenAI-compatible 接口，如 `https://example.com/v1/images/generations` |
| `Model` | 如 `gpt-image-2` |

OpenAI-compatible 模式发送最小兼容请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "prompt text",
  "n": 1,
  "size": "1024x1024"
}
```

透明背景、裁切和目标尺寸统一由本地 Sharp 后处理完成。

## 本地草稿模式

设置 `Provider` 为 `local-draft` 可生成本地占位 PNG，不调用外部 API。适合验证项目创建、后处理流程、Sprite Sheet / Atlas / TileSet 合成、metadata 和 ZIP 导出。

## 项目目录结构

```
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

## 导出目标

| 目标 | 内容 |
|------|------|
| **Unity** | PNG、Sprite Sheet、Atlas、JSON metadata、导入说明 |
| **Godot** | PNG、Sprite Sheet、SpriteFrames 说明、JSON metadata、导入说明 |
| **Tiled** | TileSet PNG、TileSet JSON、TMX、导入说明 |
| **Phaser / Cocos** | PNG、Sprite Sheet、Atlas、JSON 帧数据 |
| **Common** | 通用 PNG + JSON |
| **ZIP** | 完整导出资源包 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Electron 33 |
| 前端 | React 18、TypeScript、Lucide React |
| 构建 | Vite 6、electron-vite |
| 图像处理 | Sharp |
| 打包导出 | JSZip |
| 本地存储 | JSON 文件、项目目录、Electron userData |

## 协议

MIT

---

<h1 align="center" id="en">AI Sprite Studio</h1>

<p align="center">
  Electron + React + TypeScript desktop app — AI image generation meets local 2D game asset pipeline.
</p>

## Overview

Built for indie developers, art prototypers, and toolchain validators. Create local projects with game type, art style, and export targets; batch-generate icons, items, character poses, enemies, backgrounds, effects, and TileSets. All data and keys stay local — zero cloud dependency.

## Features

| Module | Capabilities |
|--------|-------------|
| **Project** | Create local directories, save `project.json`, manage recent projects |
| **Generation** | OpenAI-compatible API, custom API, or local draft mode |
| **Post-Processing** | Sharp-based transparent background, crop, uniform size, PNG |
| **Batch** | Mass-generate icons / items / UI sprites from a name list |
| **Animation** | Character pose frames → Sprite Sheet compositing |
| **TileSet** | Base tiles, previews, metadata, Tiled `.tmx` export |
| **Packing** | Texture Atlas synthesis, JSON metadata, ZIP bundle |
| **History** | Generation log, prompt/parameter review, output tracking |

## Quick Start

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

Build output → `out/`.

## AI API Configuration

Configure in the Settings page:

| Field | Example |
|-------|---------|
| `AI API Provider` | `openai` \| `custom` \| `local-draft` |
| `API Key` | Your image generation service key |
| `API Base URL` | OpenAI-compatible endpoint |
| `Model` | e.g. `gpt-image-2` |

Minimal request body:

```json
{
  "model": "gpt-image-2",
  "prompt": "prompt text",
  "n": 1,
  "size": "1024x1024"
}
```

Transparency, cropping, and sizing are handled locally by Sharp.

## Local Draft Mode

Set `Provider` to `local-draft` for placeholder PNGs — no external API calls. Validate pipeline, compositing, and export flows offline.

## Project Structure

```
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

## Export Targets

| Target | Contents |
|--------|----------|
| **Unity** | PNG, Sprite Sheet, Atlas, JSON metadata, import notes |
| **Godot** | PNG, Sprite Sheet, SpriteFrames guide, JSON metadata, import notes |
| **Tiled** | TileSet PNG, TileSet JSON, TMX, import notes |
| **Phaser / Cocos** | PNG, Sprite Sheet, Atlas, JSON frame data |
| **Common** | Generic PNG + JSON |
| **ZIP** | Complete export archive |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 33 |
| Frontend | React 18, TypeScript, Lucide React |
| Build | Vite 6, electron-vite |
| Image Processing | Sharp |
| Archive | JSZip |
| Storage | JSON files, project directory, Electron userData |

## License

MIT
