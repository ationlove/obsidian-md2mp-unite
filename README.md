# Obsidian MD2MP Unite

将 Obsidian 中的 Markdown 文件发布到微信公众号的集成插件。

## 功能特点

- **无需外部依赖**：不再需要安装额外的 md2mp CLI 工具
- **配置集中管理**：微信公众号配置直接在 Obsidian 插件设置中管理
- **主题支持**：支持 13 种精美主题
- **代码高亮**：支持 highlight.js 的所有高亮主题
- **图片自动处理**：自动上传本地图片到微信公众号素材库
- **智能封面**：支持 Front Matter 指定封面，或自动使用正文第一张图片

## 安装

1. 将此插件文件夹复制到 Obsidian vault 的插件目录中
2. 在 Obsidian 设置中启用该插件
3. 配置微信公众号 App ID 和 App Secret

## 配置

### 插件设置

在 Obsidian 设置 > 第三方插件 > Obsidian MD2MP Unite 中配置：

- **App ID**: 微信公众号 AppID
- **App Secret**: 微信公众号 AppSecret
- **文章主题**: 选择渲染主题（13 个主题可选）
- **代码高亮主题**: 选择代码块高亮主题
- **默认封面图路径**: 当文章没有指定封面时使用的默认图片路径

### Front Matter 配置

在 Markdown 文件中添加 Front Matter：

```yaml
---
title: 文章标题（必需）
author: 作者名称
description: 文章摘要
cover: /path/to/cover.jpg
---
```

## 使用方法

1. 打开一个 Markdown 文件
2. 点击编辑器右上角的三点菜单，选择"发布到微信公众号"
3. 或者使用命令面板 (Ctrl/Cmd + P) 搜索"发布到微信公众号"
4. 等待发布完成，文章会保存到微信公众号草稿箱

## 主题列表

| ID | 名称 | 描述 |
|----|------|------|
| default | Default | 经典简洁布局 |
| lapis | Lapis | 清新蓝色主题（默认） |
| orangeheart | OrangeHeart | 温暖橙色主题 |
| rainbow | Rainbow | 彩虹清新主题 |
| pie | Pie | 少数派风格 |
| maize | Maize | 柔和黄色主题 |
| purple | Purple | 紫色极简主题 |
| phycat | Phycat | 物理猫薄荷主题 |
| ocean | Ocean | 深海蓝色主题 |
| forest | Forest | 森林绿色主题 |
| sunset | Sunset | 日落渐变主题 |
| cherry | Cherry | 樱花粉色主题 |
| midnight | Midnight | 暗色主题 |

## 封面图优先级

1. Front Matter 中的 `cover` 字段
2. 正文中的第一张本地图片
3. 插件设置中的默认封面图路径
4. 插件 assets 目录中的 default-cover.jpg

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build
```

## 许可证

MIT License
