import matter from "gray-matter";
import * as toml from "toml";

export interface FrontMatterData {
	title?: string;
	description?: string;
	cover?: string;
	author?: string;
	[key: string]: any;
}

export interface ParsedMarkdown {
	content: string;
	data: FrontMatterData;
}

/**
 * 解析 Markdown 文件的 Front Matter
 * 支持 YAML (---) 和 TOML (+++ 或 ---toml) 格式
 */
export function parseFrontMatter(markdown: string): ParsedMarkdown {
	// 检测是否是 Hugo 风格的 TOML 格式 (+++)
	const trimmed = markdown.trimStart();
	if (trimmed.startsWith('+++')) {
		// 手动提取 TOML 内容（支持 \n 和 \r\n 换行符）
		const match = trimmed.match(/^\+\+\+\r?\n([\s\S]+?)\r?\n\+\+\+/);
		if (match) {
			const tomlContent = match[1];
			const content = trimmed.slice(match[0].length).trim();
			try {
				const data = toml.parse(tomlContent) as FrontMatterData;
				return { content, data };
			} catch (error) {
				throw new Error(`TOML 解析失败: ${error}`);
			}
		}
	}

	// 标准的 gray-matter 解析（支持 YAML 和 ---toml 格式）
	const result = matter(markdown, {
		engines: {
			toml: toml.parse.bind(toml),
		},
		delimiters: '---',
	});
	return {
		content: result.content,
		data: result.data as FrontMatterData,
	};
}

/**
 * 验证 Front Matter 是否包含必需字段
 */
export function validateFrontMatter(data: FrontMatterData): { valid: boolean; missing: string[] } {
	const missing: string[] = [];

	if (!data.title) {
		missing.push("title");
	}

	return {
		valid: missing.length === 0,
		missing,
	};
}
