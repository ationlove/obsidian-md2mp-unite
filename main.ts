import { App, Plugin, PluginSettingTab, Setting, Menu, TFile, MarkdownView, Notice, FileSystemAdapter, Modal } from "obsidian";
import * as path from "path";
import { readFileSync } from "fs";
import { resolve, join } from "path";

// Import core modules
import { parseFrontMatter, validateFrontMatter, FrontMatterData } from "./src/parser";
import { renderMarkdown, wrapWithWechatStyle } from "./src/renderer";
import { publishToWechat, PublishOptions } from "./src/wechat";
import { getAllThemes, getThemeCss, ThemeMeta } from "./src/themes";

interface Md2MpSettings {
	appId: string;
	appSecret: string;
	theme: string;
	highlightTheme: string;
	defaultCoverPath: string;
}

const DEFAULT_SETTINGS: Md2MpSettings = {
	appId: "",
	appSecret: "",
	theme: "default",
	highlightTheme: "github",
	defaultCoverPath: "",
};

export default class Md2MpUnitePlugin extends Plugin {
	settings: Md2MpSettings;
	private originalOnPaneMenu: any;

	async onload() {
		await this.loadSettings();

		// Patch MarkdownView's onPaneMenu method
		this.patchMarkdownView();

		// Add commands
		this.addCommand({
			id: "wechat-publish",
			name: "一键发布",
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === "md") {
					if (!checking) {
						this.publishToWeChat(activeFile);
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "wechat-preview",
			name: "发布预览",
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === "md") {
					if (!checking) {
						this.previewPublish(activeFile);
					}
					return true;
				}
				return false;
			},
		});

		// Add settings tab
		this.addSettingTab(new Md2MpUniteSettingTab(this.app, this));
	}

	patchMarkdownView() {
		// Save the original prototype method
		this.originalOnPaneMenu = MarkdownView.prototype.onPaneMenu;

		// Replace with our own implementation
		const plugin = this;
		MarkdownView.prototype.onPaneMenu = function(this: MarkdownView, menu: Menu, source: string) {
			// Call the original method first
			plugin.originalOnPaneMenu.call(this, menu, source);

			// Add our menu items only for "more-options" (three dots menu)
			if (source === 'more-options') {
				const file = this.file;
				if (file && file.extension === "md") {
					// Add separator
					menu.addSeparator();

					// Add a section title item
					menu.addItem((item) => {
						item.setTitle("📊 微信公众号")
							.setDisabled(true)
							.setSection("wechat-section");
					});

					// Add menu items in the same section
					menu.addItem((item) => {
						item.setTitle("发布预览")
							.setSection("wechat-section")
							.onClick(async () => {
								await plugin.previewPublish(file);
							});
					});

					menu.addItem((item) => {
						item.setTitle("一键发布")
							.setSection("wechat-section")
							.onClick(async () => {
								await plugin.publishToWeChat(file);
							});
					});
				}
			}
		};

		// Register a cleanup function to restore the original method when plugin is unloaded
		this.register(() => {
			MarkdownView.prototype.onPaneMenu = this.originalOnPaneMenu;
		});
	}

	async publishToWeChat(file: TFile) {
		// Get App ID and App Secret from settings or environment variables
		let appId = this.settings.appId;
		let appSecret = this.settings.appSecret;

		// Fallback to environment variables if not configured in settings
		if (!appId || !appSecret) {
			try {
				const process = require('process');
				if (!appId) {
					appId = process.env.MP_APP_ID || '';
				}
				if (!appSecret) {
					appSecret = process.env.MP_APP_SECRET || '';
				}
			} catch (e) {
				// Ignore if process is not available
			}
		}

		// Validate settings
		if (!appId || !appSecret) {
			new Notice("✗ 请先在插件设置中配置微信公众号 App ID 和 App Secret，或设置环境变量 MP_APP_ID 和 MP_APP_SECRET");
			return;
		}

		// Show a notice to the user
		new Notice(`正在发布 ${file.name} 到微信公众号...`);

		try {
			// Get absolute file path
			const adapter = this.app.vault.adapter;
			let fullPath: string;

			if (adapter instanceof FileSystemAdapter) {
				fullPath = adapter.getFullPath(file.path);
			} else {
				const vaultPath = (adapter as any).path || "";
				fullPath = path.resolve(vaultPath, file.path);
			}

			// Read markdown content
			const markdownContent = await this.app.vault.read(file);

			// Parse Front Matter
			const { content, data } = parseFrontMatter(markdownContent);

			// Validate required fields
			const { valid, missing } = validateFrontMatter(data);
			if (!valid) {
				new Notice(`✗ 缺少必需字段: ${missing.join(", ")}`);
				return;
			}

			// Resolve image paths using Obsidian API
			const processedContent = await this.resolveImagesForPublish(content, file);

			// Render markdown to HTML
			console.log("正在渲染 Markdown...");
			const html = await renderMarkdown(processedContent);

			// Apply theme styles
			// Get plugin directory (absolute path)
			let pluginPath = "";

			if (adapter instanceof FileSystemAdapter) {
				const pluginsDir = join(adapter.getFullPath(""), ".obsidian", "plugins");
				pluginPath = join(pluginsDir, "obsidian-md2mp-unite");
			} else {
				// Fallback for other adapters
				const vaultPath = (adapter as any).basePath || "";
				const pluginsDir = join(vaultPath, ".obsidian", "plugins");
				pluginPath = join(pluginsDir, "obsidian-md2mp-unite");
			}

			console.log("Plugin path:", pluginPath);
			const themeCss = getThemeCss(this.settings.theme, pluginPath);
			const styledHtml = wrapWithWechatStyle(html, themeCss, this.settings.highlightTheme, pluginPath, this.settings.theme);

			// Prepare cover image if specified in Front Matter
			let coverBuffer: ArrayBuffer | undefined;
			let coverFilename: string | undefined;

			if (data.cover) {
				let coverPath = data.cover;
				let imagePath = coverPath;

				// 检查是否是 Obsidian Wiki 链接格式: ![[path]] 或 ![[path|alt]]
				const wikiLinkMatch = coverPath.match(/^!\[\[([^\]]+)\]\]$/);
				if (wikiLinkMatch) {
					// 提取图片路径
					imagePath = wikiLinkMatch[1].split('|')[0].trim();

					// 使用 Obsidian 的 metadataCache 解析链接
					const linkedFile = this.app.metadataCache.getFirstLinkpathDest(imagePath, file.path);
					if (linkedFile) {
						// 获取绝对路径
						const adapter = this.app.vault.adapter;
						if (adapter instanceof FileSystemAdapter) {
							coverPath = adapter.getFullPath(linkedFile.path);
						} else {
							const vaultPath = (adapter as any).basePath || "";
							coverPath = resolve(vaultPath, linkedFile.path);
						}
					} else {
						console.warn(`无法找到封面图: ${imagePath}`);
						coverPath = "";
					}
				} else {
					// 普通路径，相对于 markdown 文件所在目录解析
					coverPath = resolve(fullPath, "..", coverPath);
				}

				if (coverPath) {
					try {
						const coverImage = readFileSync(coverPath);
						coverBuffer = new Uint8Array(coverImage).buffer;
						coverFilename = coverPath.split(/[/\\]/).pop() || "cover.jpg";
					} catch (error) {
						console.warn(`无法读取封面图: ${coverPath} - ${error}`);
					}
				}
			}

			// Prepare publish options
			const options: PublishOptions = {
				appId: appId,
				appSecret: appSecret,
				basePath: fullPath,
				defaultCoverPath: this.settings.defaultCoverPath || undefined,
				pluginPath: pluginPath,
			};

			// Publish to WeChat
			console.log("正在发布到微信公众号...");
			const result = await publishToWechat(
				data.title!,
				styledHtml,
				coverBuffer,
				coverFilename,
				options,
				data.author,
				data.description
			);

			new Notice(`✓ 发布成功: ${file.name}\n媒体 ID: ${result.media_id}`);
			console.log("Publish result:", result);
		} catch (error: any) {
			new Notice(`✗ 发布失败: ${error.message}`);
			console.error("Publish error:", error);
		}
	}

	async previewPublish(file: TFile) {
		try {
			// Get absolute file path
			const adapter = this.app.vault.adapter;
			let fullPath: string;

			if (adapter instanceof FileSystemAdapter) {
				fullPath = adapter.getFullPath(file.path);
			} else {
				const vaultPath = (adapter as any).path || "";
				fullPath = path.resolve(vaultPath, file.path);
			}

			// Read markdown content
			const markdownContent = await this.app.vault.read(file);

			// Parse Front Matter
			const { content, data } = parseFrontMatter(markdownContent);

			// Validate required fields
			const { valid, missing } = validateFrontMatter(data);
			if (!valid) {
				new Notice(`✗ 缺少必需字段: ${missing.join(", ")}`);
				return;
			}

			// For preview, process images and convert to base64
			const processedContent = await this.resolveImagesForPreview(content, file);

			// Render markdown to HTML
			console.log("正在渲染 Markdown...");
			const html = await renderMarkdown(processedContent);

			// Get plugin directory (absolute path) - same as publishToWeChat
			let pluginPath = "";
			if (adapter instanceof FileSystemAdapter) {
				const pluginsDir = join(adapter.getFullPath(""), ".obsidian", "plugins");
				pluginPath = join(pluginsDir, "obsidian-md2mp-unite");
			} else {
				const vaultPath = (adapter as any).basePath || "";
				const pluginsDir = join(vaultPath, ".obsidian", "plugins");
				pluginPath = join(pluginsDir, "obsidian-md2mp-unite");
			}

			console.log("Plugin path:", pluginPath);

			// Show preview modal
			new PreviewModal(this.app, this, data.title!, markdownContent, pluginPath, processedContent).open();
		} catch (error: any) {
			new Notice(`✗ 预览失败: ${error.message}`);
			console.error("Preview error:", error);
		}
	}

	/**
	 * 预览模式：解析图片路径并转换为 base64
	 * 用于预览功能，图片嵌入在 HTML 中
	 */
	async resolveImagesForPreview(content: string, sourceFile: TFile): Promise<string> {
		// Match all Wiki-style image links: ![[path]] or ![[path|alt]]
		const wikiImageRegex = /!\[\[([^\]]+)\]\]/g;

		const replacements: Array<{match: string, replacement: string}> = [];

		for (const match of content.matchAll(wikiImageRegex)) {
			const fullMatch = match[0];
			const linkContent = match[1];
			const imagePath = linkContent.split('|')[0].trim();

			// Try to resolve the link using Obsidian's metadata cache
			const linkedFile = this.app.metadataCache.getFirstLinkpathDest(imagePath, sourceFile.path);

			if (linkedFile) {
				// Convert to base64 data URL for preview
				try {
					const adapter = this.app.vault.adapter;
					let absolutePath: string;

					if (adapter instanceof FileSystemAdapter) {
						absolutePath = adapter.getFullPath(linkedFile.path);
					} else {
						const vaultPath = (adapter as any).basePath || "";
						absolutePath = path.resolve(vaultPath, linkedFile.path);
					}

					const imageBuffer = readFileSync(absolutePath);
					const base64 = imageBuffer.toString('base64');
					const ext = linkedFile.path.split('.').pop()?.toLowerCase() || 'png';
					const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
						ext === 'png' ? 'image/png' :
						ext === 'gif' ? 'image/gif' :
						ext === 'webp' ? 'image/webp' : 'image/png';

					replacements.push({
						match: fullMatch,
						replacement: `![](data:${mimeType};base64,${base64})`
					});
				} catch (e) {
					console.warn(`无法读取图片: ${imagePath}`, e);
					replacements.push({
						match: fullMatch,
						replacement: `![](${imagePath})`
					});
				}
			} else {
				// File not found, keep original and log warning
				console.warn(`无法找到图片: ${imagePath}`);
				replacements.push({
					match: fullMatch,
					replacement: `![](${imagePath})`
				});
			}
		}

		// Apply all replacements
		let result = content;
		for (const { match, replacement } of replacements) {
			result = result.replace(match, replacement);
		}

		return result;
	}

	/**
	 * 发布模式：解析图片路径并转换为 file:// URL
	 * 用于发布功能，图片会上传到微信公众号
	 */
	async resolveImagesForPublish(content: string, sourceFile: TFile): Promise<string> {
		// Match all Wiki-style image links: ![[path]] or ![[path|alt]]
		const wikiImageRegex = /!\[\[([^\]]+)\]\]/g;

		const replacements: Array<{match: string, replacement: string}> = [];

		for (const match of content.matchAll(wikiImageRegex)) {
			const fullMatch = match[0];
			const linkContent = match[1];
			const imagePath = linkContent.split('|')[0].trim();

			// Try to resolve the link using Obsidian's metadata cache
			const linkedFile = this.app.metadataCache.getFirstLinkpathDest(imagePath, sourceFile.path);

			if (linkedFile) {
				// For publishing: use absolute path with file:// protocol
				const adapter = this.app.vault.adapter;
				let absolutePath: string;

				if (adapter instanceof FileSystemAdapter) {
					absolutePath = adapter.getFullPath(linkedFile.path);
				} else {
					const vaultPath = (adapter as any).basePath || "";
					absolutePath = path.resolve(vaultPath, linkedFile.path);
				}

				// Convert Windows path to file:// URL format
				// K:\path\to\file.png -> file:///K:/path/to/file.png
				const fileUrl = 'file:///' + absolutePath.replace(/\\/g, '/');

				// Convert to standard markdown image syntax
				replacements.push({
					match: fullMatch,
					replacement: `![](${fileUrl})`
				});
			} else {
				// File not found, keep original and log warning
				console.warn(`无法找到图片: ${imagePath}`);
				replacements.push({
					match: fullMatch,
					replacement: `![](${imagePath})`
				});
			}
		}

		// Apply all replacements
		let result = content;
		for (const { match, replacement } of replacements) {
			result = result.replace(match, replacement);
		}

		return result;
	}

	onunload() {
		// Restore the original method
		MarkdownView.prototype.onPaneMenu = this.originalOnPaneMenu;
		console.log("Unloading Obsidian MD2MP Unite plugin");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class Md2MpUniteSettingTab extends PluginSettingTab {
	plugin: Md2MpUnitePlugin;

	constructor(app: App, plugin: Md2MpUnitePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "微信公众号发布设置" });

		// WeChat App ID
		new Setting(containerEl)
			.setName("App ID")
			.setDesc("微信公众号 AppID")
			.addText((text) =>
				text
					.setPlaceholder("wxxxxxxxxxxxxxxxxx")
					.setValue(this.plugin.settings.appId)
					.onChange(async (value) => {
						this.plugin.settings.appId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// WeChat App Secret
		new Setting(containerEl)
			.setName("App Secret")
			.setDesc("微信公众号 AppSecret")
			.addText((text) =>
				text
					.setPlaceholder("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
					.setValue(this.plugin.settings.appSecret)
					.onChange(async (value) => {
						this.plugin.settings.appSecret = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// Theme selection
		const themes = getAllThemes();
		new Setting(containerEl)
			.setName("文章主题")
			.setDesc("选择文章渲染主题")
			.addDropdown((dropdown) => {
				themes.forEach((theme) => {
					dropdown.addOption(theme.id, `${theme.name} - ${theme.description}`);
				});
				dropdown
					.setValue(this.plugin.settings.theme)
					.onChange(async (value) => {
						this.plugin.settings.theme = value;
						await this.plugin.saveSettings();
					});
			});

		// Highlight theme
		new Setting(containerEl)
			.setName("代码高亮主题")
			.setDesc("选择代码块高亮主题 (highlight.js 支持的主题)")
			.addText((text) =>
				text
					.setPlaceholder("github")
					.setValue(this.plugin.settings.highlightTheme)
					.onChange(async (value) => {
						this.plugin.settings.highlightTheme = value.trim() || "github";
						await this.plugin.saveSettings();
					})
			);

		// Default cover path
		new Setting(containerEl)
			.setName("默认封面图路径")
			.setDesc("当文章没有指定封面时使用的默认图片路径（绝对路径）")
			.addText((text) =>
				text
					.setPlaceholder("/path/to/default-cover.jpg")
					.setValue(this.plugin.settings.defaultCoverPath)
					.onChange(async (value) => {
						this.plugin.settings.defaultCoverPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// Usage hints
		containerEl.createEl("h3", { text: "使用说明" });
		containerEl.createEl("p", {
			text: "1. 在 Front Matter 中设置 title (必需)、author、description 等字段"
		});
		containerEl.createEl("p", {
			text: "2. 可选设置 cover 字段指定封面图路径"
		});
		containerEl.createEl("p", {
			text: "3. 如果没有设置封面，会自动使用正文中的第一张图片或默认封面图"
		});
		containerEl.createEl("p", {
			text: "4. 发布后的文章会保存到微信公众号草稿箱"
		});
	}
}

class PreviewModal extends Modal {
	private plugin: Md2MpUnitePlugin;
	private title: string;
	private markdownContent: string;
	private pluginPath: string;
	private processedContent: string;
	private currentTheme: string;
	private iframeEl: HTMLIFrameElement | null = null;

	constructor(app: App, plugin: Md2MpUnitePlugin, title: string, markdownContent: string, pluginPath: string, processedContent: string) {
		super(app);
		this.plugin = plugin;
		this.title = title;
		this.markdownContent = markdownContent;
		this.pluginPath = pluginPath;
		this.processedContent = processedContent;
		this.currentTheme = plugin.settings.theme;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add title
		contentEl.createEl("h2", { text: "微信公众号发布预览" });

		// Add theme selector
		const themeContainer = contentEl.createEl("div", {
			attr: {
				style: "display: flex; align-items: center; gap: 10px; margin-bottom: 15px;"
			}
		});

		themeContainer.createEl("label", {
			text: "主题:",
			attr: {
				style: "font-weight: bold;"
			}
		});

		const themes = getAllThemes();
		const themeSelect = themeContainer.createEl("select", {
			attr: {
				style: "padding: 5px; border-radius: 4px; border: 1px solid var(--background-modifier-border);"
			}
		});

		themes.forEach((theme) => {
			const option = themeSelect.createEl("option", {
				value: theme.id,
				text: `${theme.name} - ${theme.description}`
			});
			if (theme.id === this.currentTheme) {
				option.setAttribute("selected", "selected");
			}
		});

		// Add event listener for theme change
		themeSelect.addEventListener("change", async (e) => {
			const target = e.target as HTMLSelectElement;
			this.currentTheme = target.value;
			await this.updatePreview();
		});

		// Add publish button
		const publishButton = themeContainer.createEl("button", {
			text: "一键发布",
			attr: {
				style: "padding: 5px 15px; border-radius: 4px; border: none; background: var(--interactive-accent); color: var(--text-on-accent); cursor: pointer; font-weight: bold;"
			}
		});

		publishButton.addEventListener("click", async () => {
			// Close the preview modal
			this.close();

			// Temporarily override the theme setting
			const originalTheme = this.plugin.settings.theme;
			this.plugin.settings.theme = this.currentTheme;

			// Call publishToWeChat
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && activeFile.extension === "md") {
				await this.plugin.publishToWeChat(activeFile);
			}

			// Restore the original theme setting
			this.plugin.settings.theme = originalTheme;
		});

		// Add iframe for preview
		this.iframeEl = contentEl.createEl("iframe", {
			attr: {
				style: "width: 100%; height: 65vh; border: 1px solid var(--background-modifier-border);"
			}
		});

		// Initial render
		this.updatePreview();
	}

	async updatePreview() {
		if (!this.iframeEl) return;

		try {
			// Render markdown to HTML
			const html = await renderMarkdown(this.processedContent);

			// Get theme CSS
			const themeCss = getThemeCss(this.currentTheme, this.pluginPath);
			const styledHtml = wrapWithWechatStyle(html, themeCss, this.plugin.settings.highlightTheme, this.pluginPath, this.currentTheme);

			// Update iframe content
			const doc = this.iframeEl.contentDocument || this.iframeEl.contentWindow?.document;
			if (doc) {
				doc.open();
				doc.write(`
					<!DOCTYPE html>
					<html>
					<head>
						<meta charset="UTF-8">
						<style>
							body {
								margin: 0;
								padding: 20px;
								background: #f5f5f5;
							}
						</style>
					</head>
					<body>
						${styledHtml}
					</body>
					</html>
				`);
				doc.close();
			}
		} catch (error: any) {
			console.error("Preview update error:", error);
			new Notice(`✗ 预览更新失败: ${error.message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
