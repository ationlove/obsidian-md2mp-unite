import { readFileSync } from "fs";
import { resolve, join } from "path";

/**
 * 主题元信息
 */
export interface ThemeMeta {
	id: string;
	name: string;
	description: string;
	author: string;
	highlightTheme?: string; // 可选的自定义高亮主题
}

/**
 * 主题列表
 */
export const themes: ThemeMeta[] = [
	{
		id: "default",
		name: "Default",
		description: "经典简洁布局，适合长文阅读",
		author: "md2mp",
	},
	{
		id: "lapis",
		name: "Lapis",
		description: "清新蓝色主题",
		author: "YiNN",
	},
	{
		id: "orangeheart",
		name: "OrangeHeart",
		description: "温暖橙色主题，充满活力",
		author: "evgo2017",
	},
	{
		id: "rainbow",
		name: "Rainbow",
		description: "彩虹清新主题，多彩活泼",
		author: "thezbm",
	},
	{
		id: "pie",
		name: "Pie",
		description: "少数派风格，现代简洁",
		author: "kevinzhao2233",
	},
	{
		id: "maize",
		name: "Maize",
		description: "柔和黄色主题，温暖舒适",
		author: "BEATREE",
	},
	{
		id: "purple",
		name: "Purple",
		description: "紫色极简主题，优雅大方",
		author: "hliu202",
	},
	{
		id: "phycat",
		name: "Phycat",
		description: "物理猫薄荷主题，清新绿色",
		author: "sumruler",
	},
	{
		id: "ocean",
		name: "Ocean",
		description: "深海蓝色主题，适合技术文章",
		author: "md2mp",
		highlightTheme: "atom-one-dark",
	},
	{
		id: "forest",
		name: "Forest",
		description: "森林绿色主题，清新自然",
		author: "md2mp",
		highlightTheme: "atom-one-dark",
	},
	{
		id: "sunset",
		name: "Sunset",
		description: "日落渐变主题，温暖活力",
		author: "md2mp",
		highlightTheme: "atom-one-dark",
	},
	{
		id: "cherry",
		name: "Cherry",
		description: "樱花粉色主题，温柔浪漫",
		author: "md2mp",
	},
	{
		id: "midnight",
		name: "Midnight",
		description: "暗色主题，适合夜间阅读",
		author: "md2mp",
		highlightTheme: "monokai",
	},
];

/**
 * 获取主题 CSS 内容
 */
export function getThemeCss(themeId: string, pluginPath: string): string {
	const themePath = join(pluginPath, "themes", `${themeId}.css`);
	try {
		return readFileSync(themePath, "utf-8");
	} catch (error) {
		throw new Error(`主题 "${themeId}" 不存在或无法读取。可用主题: ${themes.map((t) => t.id).join(", ")}`);
	}
}

/**
 * 获取主题元信息
 */
export function getThemeMeta(themeId: string): ThemeMeta | undefined {
	return themes.find((t) => t.id === themeId);
}

/**
 * 获取所有主题
 */
export function getAllThemes(): ThemeMeta[] {
	return [...themes];
}
