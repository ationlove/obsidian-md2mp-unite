import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import * as csstree from "css-tree";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * 配置 marked 使用 highlight.js 进行代码高亮
 */
marked.use(
	markedHighlight({
		highlight(code, lang) {
			const language = hljs.getLanguage(lang) ? lang : "plaintext";
			return hljs.highlight(code, { language }).value;
		},
	}),
);

/**
 * 自定义渲染器，处理 file:// 协议的图片链接
 * marked 默认不识别 file:// 协议，需要自定义处理
 */
const renderer = new marked.Renderer();

// 重写 image 方法，强制渲染所有 ![]() 语法，包括 file:// 协议
renderer.image = function(href: string, title: string | null, text: string) {
	// 确保 file:// 协议的图片也能被渲染
	// marked 默认会忽略 file:// 协议，这里强制渲染
	return `<img src="${href}" alt="${text}" ${title ? `title="${title}"` : ''}>`;
};

marked.setOptions({ renderer });

/**
 * 将 Obsidian Wiki 链接语法的图片转换为标准 Markdown 图片语法
 * ![[path.jpg]] => ![](path.jpg)
 * ![[path.jpg|alt text]] => ![](path.jpg)
 * ![[folder/path.jpg]] => ![](folder/path.jpg)
 * ![[Pasted image 20260202215021.png]] => ![](Pasted%20image%2020260202215021.png)
 *
 * 注意：URL 中的空格需要被编码为 %20，否则 marked 不会正确渲染
 */
function convertObsidianImages(markdown: string): string {
	return markdown.replace(/!\[\[([^\]]+)\]\]/g, (match, content) => {
		// 处理可能带 alt text 的情况：[[path.jpg|alt text]]
		const imagePath = content.split('|')[0].trim();
		// 对路径进行 URL 编码，确保空格等特殊字符被正确处理
		// 但不对 Windows 驱动器路径的冒号进行编码
		const encodedPath = imagePath.replace(/[^a-zA-Z0-9:\/\\\-_.]/g, (char) => {
			// 保留 Windows 驱动器路径格式（如 K:/）
			if (char === ':' && imagePath.match(/^[a-zA-Z]:/)) {
				return ':';
			}
			return encodeURIComponent(char);
		});
		return `![](${encodedPath})`;
	});
}

/**
 * 将 Markdown 内容转换为 HTML
 */
export async function renderMarkdown(markdown: string): Promise<string> {
	marked.setOptions({
		gfm: true,
		breaks: true,
	});

	// 先转换 Obsidian Wiki 链接语法的图片
	const convertedMarkdown = convertObsidianImages(markdown);

	// 使用 marked 渲染
	let html = await marked(convertedMarkdown);

	// 后处理：手动转换所有 ![](file://...) 模式为 <img> 标签
	// marked 不识别 file:// 协议，所以需要手动处理
	html = html.replace(/!\[\]\((file:\/\/\/[^)]+)\)/g, (match, fileUrl) => {
		// 转换为 img 标签
		return `<img src="${fileUrl}" alt="">`;
	});

	return html;
}

/**
 * CSS 解析选项
 */
const parseOptions: csstree.ParseOptions = {
	context: "stylesheet",
	positions: false,
	parseAtrulePrelude: false,
	parseCustomProperty: false,
	parseValue: false,
};

/**
 * 将 CSS 转换为内联样式并应用到元素
 */
function applyCssToElement(css: string, element: HTMLElement): void {
	const ast = csstree.parse(css, parseOptions);

	csstree.walk(ast, {
		visit: "Rule",
		enter(node) {
			if (node.prelude.type !== "SelectorList") return;

			const declarations = node.block.children.toArray();

			node.prelude.children.forEach((selectorNode) => {
				const selector = csstree.generate(selectorNode);
				// 跳过伪类/伪元素
				if (selector.includes(":")) return;

				// 查找匹配的元素
				const targets =
					selector === "#md2mp"
						? [element]
						: Array.from(element.querySelectorAll<HTMLElement>(selector));

				targets.forEach((el) => {
					declarations.forEach((decl) => {
						if (decl.type !== "Declaration") return;
						const value = csstree.generate(decl.value);
						const property = decl.property;
						const priority = decl.important ? "important" : "";
						el.style.setProperty(property, value, priority);
					});
				});
			});
		},
	});
}

/**
 * 读取代码高亮主题 CSS
 */
function getHighlightThemeCss(pluginPath: string, theme: string): string {
	// 尝试从 node_modules 读取
	const hljsPath = join(pluginPath, "node_modules", "highlight.js", "styles", `${theme}.min.css`);
	try {
		const css = readFileSync(hljsPath, "utf-8");
		// 添加 #md2mp 前缀到所有选择器
		return css.replace(/^([^{]+)(\{)/gm, "#md2mp $1$2");
	} catch (error) {
		// 如果主题文件不存在，使用默认的 GitHub 主题
		const defaultCss = readFileSync(
			join(pluginPath, "node_modules", "highlight.js", "styles", "github.min.css"),
			"utf-8",
		);
		return defaultCss.replace(/^([^{]+)(\{)/gm, "#md2mp $1$2");
	}
}

/**
 * 为微信公众号添加样式
 * @param html HTML 内容
 * @param themeCss 主题 CSS
 * @param highlightTheme 代码高亮主题（默认 github）
 * @param pluginPath 插件路径
 * @param themeId 主题 ID（用于查找自定义高亮主题）
 */
export function wrapWithWechatStyle(
	html: string,
	themeCss: string,
	highlightTheme: string,
	pluginPath: string,
	themeId?: string
): string {
	// 使用浏览器原生 DOM API 创建虚拟 DOM
	const template = document.createElement('template');
	template.innerHTML = `<section id="md2mp">${html}</section>`;
	const md2mpElement = template.content.firstChild as HTMLElement;

	if (!md2mpElement) {
		throw new Error("Failed to create md2mp element");
	}

	// 应用主题 CSS
	applyCssToElement(themeCss, md2mpElement);

	// 查找主题是否有自定义高亮主题
	const { getThemeMeta } = require("./themes");
	let actualHighlightTheme = highlightTheme;

	if (themeId) {
		const themeMeta = getThemeMeta(themeId);
		if (themeMeta?.highlightTheme) {
			actualHighlightTheme = themeMeta.highlightTheme;
		}
	}

	// 应用代码高亮 CSS
	const highlightCss = getHighlightThemeCss(pluginPath, actualHighlightTheme);
	applyCssToElement(highlightCss, md2mpElement);

	// 微信公众号编辑器会去除 <code> 标签内的换行符和空格
	// 解决方案：递归处理所有文本节点
	// - 换行符替换为 <br> 标签
	// - 空格通过在之前的元素上添加 margin-right 样式来保留
	const codeElements = md2mpElement.querySelectorAll('pre code');
	codeElements.forEach((code) => {
		const processTextNodes = (element: Element) => {
			const childNodes = Array.from(element.childNodes);

			childNodes.forEach((node) => {
				if (node.nodeType === Node.TEXT_NODE) {
					const text = node.textContent || '';
					if (text.includes('\n') || text.includes(' ')) {
						const fragment = document.createDocumentFragment();
						
						let currentText = '';
						
						for (let i = 0; i < text.length; i++) {
							const char = text[i];
							
							if (char === '\n') {
								if (currentText.length > 0) {
									fragment.appendChild(document.createTextNode(currentText));
									currentText = '';
								}
								const br = document.createElement('br');
								fragment.appendChild(br);
							} else if (char === ' ') {
								if (currentText.length > 0) {
									fragment.appendChild(document.createTextNode(currentText));
									currentText = '';
								}
								// 空格：替换为带样式的 span
								// const spaceSpan = document.createElement('span');
								// spaceSpan.style.marginLeft = '-0.2rem';
								// spaceSpan.style.marginRight = '-0.2rem';
								// // spaceSpan.innerHTML = '　&nbsp;';
								// spaceSpan.innerHTML = '　&nbsp;';
								// fragment.appendChild(spaceSpan);

								const spaceSpan = document.createElement('span');

								const spaceSpan1 = document.createElement('span');
								spaceSpan1.style.marginLeft = '0';
								spaceSpan1.style.marginRight = '-1.6em';
								spaceSpan1.innerHTML = '　&nbsp;';
								spaceSpan.appendChild(spaceSpan1);

								const spaceSpan2 = document.createElement('span');
								spaceSpan2.style.marginLeft = '-1.6em';
								spaceSpan2.style.marginRight = '0';
								spaceSpan2.innerHTML = '&nbsp;　';
								spaceSpan.appendChild(spaceSpan2);

								fragment.appendChild(spaceSpan);
							} else {
								currentText += char;
							}
						}
						
						if (currentText.length > 0) {
							fragment.appendChild(document.createTextNode(currentText));
						}
						
						node.parentNode?.replaceChild(fragment, node);
					}
				} else if (node.nodeType === Node.ELEMENT_NODE) {
					// 元素节点：递归处理
					processTextNodes(node as Element);
				}
			});
		};

		processTextNodes(code);
	});

	// 返回带有内联样式的 HTML
	let result = md2mpElement.outerHTML;

	// 添加响应式样式：在窄屏（<400px）下显示水平滚动条，不自动换行
	const responsiveStyle = `
	<style>
		.md2mp-space::before {
			margin-left: 0.1rem;
			margin-right: 0.1rem;
			content: '\u00A0';
		}
		@media (max-width: 400px) {
			#md2mp pre {
				overflow-x: auto;
				max-width: 100%;
			}
			#md2mp pre code {
				white-space: pre !important;
				word-wrap: normal !important;
				word-break: normal !important;
			}
		}
		@media (min-width: 401px) {
			#md2mp pre code {
				white-space: pre-wrap !important;
				word-wrap: break-word !important;
				word-break: break-word !important;
			}
		}
	</style>
	`;

	// 将 style 标签插入到 #md2mp 元素内部
	result = result.replace('<section id="md2mp">', `<section id="md2mp">${responsiveStyle}`);

	// 微信公众号后处理：移除多余的换行
	result = result
		.replace(/\n<li/g, "<li")
		.replace(/<\/li>\n/g, "</li>");

	return result;
}
