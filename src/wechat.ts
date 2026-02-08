import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { createHash } from "crypto";
import { requestUrl, RequestUrlParam } from "obsidian";
import * as https from "https";
import { URL } from "url";

/**
 * 图片上传缓存项
 */
interface CachedImage {
	url: string;
	media_id: string;
	timestamp: number;  // 上传时间戳
}

/**
 * 图片上传缓存
 * 使用文件内容哈希值作为键，避免重复上传相同图片
 */
const uploadedImageCache = new Map<string, CachedImage>();

// 微信 API 端点
const API_BASE = "https://api.weixin.qq.com/cgi-bin";

/**
 * 微信 Access Token 响应
 */
export interface AccessTokenResponse {
	access_token: string;
	expires_in: number;
	errcode?: number;
	errmsg?: string;
}

/**
 * 素材上传响应
 */
export interface MediaUploadResponse {
	media_id: string;
	url: string;
	errcode?: number;
	errmsg?: string;
}

/**
 * 文章发布响应
 */
export interface ArticlePublishResponse {
	media_id: string;
	errcode?: number;
	errmsg?: string;
}

/**
 * 发布选项
 */
export interface PublishOptions {
	appId: string;
	appSecret: string;
	basePath?: string;
	defaultCoverPath?: string;
	pluginPath: string;
}

/**
 * HTTP POST 请求
 */
async function httpPost(url: string, data?: any, isFormData = false): Promise<any> {
	if (isFormData && data) {
		// 手动构建 multipart/form-data
		const boundary = '----WebKitFormBoundary' + Date.now();
		let body = '';

		// 添加文件数据
		if (data.media) {
			const buffer = Buffer.from(data.media.buffer);
			body += `--${boundary}\r\n`;
			body += `Content-Disposition: form-data; name="media"; filename="${data.filename}"\r\n`;
			body += `Content-Type: image/jpeg\r\n\r\n`;
			const headerBuffer = Buffer.from(body, 'utf8');
			const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
			const combinedBuffer = Buffer.concat([headerBuffer, buffer, footerBuffer]);
			body = combinedBuffer.toString('binary');
		}

		const response = await requestUrl({
			url,
			method: "POST",
			headers: {
				'Content-Type': `multipart/form-data; boundary=${boundary}`
			},
			body: body,
		});
		return response.json;
	} else if (data) {
		// JSON 请求
		const response = await requestUrl({
			url,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});
		return response.json;
	} else {
		const response = await requestUrl({
			url,
			method: "POST",
		});
		return response.json;
	}
}

/**
 * HTTP GET 请求
 */
async function httpGet(url: string): Promise<any> {
	const response = await requestUrl({
		url,
		method: "GET",
	});
	return response.json;
}

/**
 * 获取微信 Access Token
 */
export async function getAccessToken(appId: string, appSecret: string): Promise<AccessTokenResponse> {
	const url = `${API_BASE}/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
	const data = await httpGet(url) as AccessTokenResponse;

	if (data.errcode && data.errcode !== 0) {
		throw new Error(`获取 Access Token 失败: ${data.errcode} - ${data.errmsg}`);
	}

	return data;
}

/**
 * 上传图片素材
 */
async function uploadImageInternal(
	imageBuffer: ArrayBuffer,
	filename: string,
	accessToken: string,
): Promise<MediaUploadResponse> {
	const url = `${API_BASE}/material/add_material?access_token=${accessToken}&type=image`;

	// 手动构建 multipart/form-data
	const boundary = '----ObsidianBoundary' + Math.random().toString(36).substring(2);
	const buffer = Buffer.from(imageBuffer);

	const header = [
		`--${boundary}`,
		`Content-Disposition: form-data; name="media"; filename="${filename}"`,
		`Content-Type: image/jpeg`,
		'',
		''].join('\r\n');

	const footer = `\r\n--${boundary}--\r\n`;

	const headerBuffer = Buffer.from(header, 'utf8');
	const footerBuffer = Buffer.from(footer, 'utf8');
	const body = Buffer.concat([headerBuffer, buffer, footerBuffer]);

	// 使用 https 模块发送请求
	return new Promise((resolve, reject) => {
		const urlObj = new URL(url);
		const options = {
			hostname: urlObj.hostname,
			port: urlObj.port || 443,
			path: urlObj.pathname + urlObj.search,
			method: 'POST',
			headers: {
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'Content-Length': body.length,
			},
		};

		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => {
				data += chunk;
			});
			res.on('end', () => {
				try {
					const result = JSON.parse(data) as MediaUploadResponse;
					if (result.errcode && result.errcode !== 0) {
						reject(new Error(`上传图片失败: ${result.errcode} - ${result.errmsg}`));
					} else {
						resolve(result);
					}
				} catch (e) {
					reject(new Error(`解析响应失败: ${e}`));
				}
			});
		});

		req.on('error', (e) => {
			reject(new Error(`请求失败: ${e}`));
		});

		req.write(body);
		req.end();
	});
}

/**
 * 上传图片素材（带缓存）
 * 如果相同内容的图片已上传过，直接返回缓存的结果
 * 注意：微信的 media_id 有效期为 3 天，超过后会自动失效
 */
export async function uploadImage(
	imageBuffer: ArrayBuffer,
	filename: string,
	accessToken: string,
): Promise<MediaUploadResponse> {
	const buffer = Buffer.from(imageBuffer);
	const fileHash = getFileHash(buffer);

	// 检查缓存
	const cached = uploadedImageCache.get(fileHash);
	if (cached) {
		// 检查缓存是否过期（3天 = 3 * 24 * 60 * 60 * 1000 = 259200000 毫秒）
		const cacheAge = Date.now() - cached.timestamp;
		const cacheMaxAge = 3 * 24 * 60 * 60 * 1000;  // 3 天

		if (cacheAge < cacheMaxAge) {
			console.log(`  复用图片缓存: ${filename}`);
			return { url: cached.url, media_id: cached.media_id };
		} else {
			console.log(`  缓存已过期，重新上传: ${filename}`);
			// 移除过期缓存
			uploadedImageCache.delete(fileHash);
		}
	}

	// 上传图片
	const result = await uploadImageInternal(imageBuffer, filename, accessToken);

	// 缓存结果（包含时间戳）
	uploadedImageCache.set(fileHash, {
		url: result.url,
		media_id: result.media_id,
		timestamp: Date.now()
	});

	return result;
}

/**
 * 计算文件内容的 MD5 哈希值
 */
function getFileHash(buffer: Buffer): string {
	return createHash("md5").update(buffer).digest("hex");
}

/**
 * 上传 HTML 中的所有图片并替换 URL
 * 返回更新后的 HTML 和第一张本地图片的路径（用于封面）
 */
export async function uploadContentImages(
	htmlContent: string,
	accessToken: string,
	basePath?: string,
): Promise<{ html: string; firstLocalImagePath?: string }> {
	// 匹配所有 img 标签
	const imgRegex = /<img([^>]+)>/gi;
	let updatedHtml = htmlContent;
	let firstLocalImagePath: string | undefined;
	let match;

	while ((match = imgRegex.exec(htmlContent)) !== null) {
		const imgTag = match[0];
		const attrs = match[1];

		// 提取 src 属性
		const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
		if (!srcMatch) continue;

		const src = srcMatch[1];

		// 跳过已经上传到微信的图片
		if (src.startsWith("https://mmbiz.qpic.cn")) {
			continue;
		}

		// 跳过网络图片（HTTP/HTTPS）
		if (src.startsWith("http://") || src.startsWith("https://")) {
			console.log(`  跳过网络图片: ${src}`);
			continue;
		}

		// 跳过 base64 图片
		if (src.startsWith("data:")) {
			console.log(`  跳过 base64 图片`);
			continue;
		}

		// 处理本地图片
		let imagePath = src;

		// 处理 file:// URL
		if (src.startsWith("file:///")) {
			// 移除 file:/// 前缀，将 file:///K:/path 转换为 K:\path
			imagePath = src.substring(8).replace(/\//g, '\\');
			imagePath = resolve(imagePath);
		} else if (basePath && !src.startsWith("/") && !src.match(/^[a-zA-Z]:\//)) {
			// 相对路径，需要基于 Markdown 文件所在目录解析
			const baseDir = dirname(resolve(basePath));
			imagePath = resolve(baseDir, src);
		} else {
			// 绝对路径或 Windows 驱动器路径（如 K:/file.png）
			// 将正斜杠转换为反斜杠，然后使用 resolve 规范化
			const normalizedSrc = src.replace(/\//g, '\\');
			imagePath = resolve(normalizedSrc);
		}

		// 记录第一张本地图片（用于封面）
		if (!firstLocalImagePath) {
			firstLocalImagePath = imagePath;
		}

		try {
			const imageBuffer = readFileSync(imagePath);
			const arrayBuffer = new Uint8Array(imageBuffer).buffer;
			const filename = imagePath.split(/[/\\]/).pop() || "image.jpg";

			const uploadResult = await uploadImage(arrayBuffer, filename, accessToken);

			// 替换图片 URL - 使用正则表达式并转义特殊字符
			const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const srcRegex = new RegExp('src=["\']' + escapedSrc + '["\']', 'g');
			updatedHtml = updatedHtml.replace(srcRegex, 'src="' + uploadResult.url + '"');
		} catch (error) {
			console.error(`  ✗ 上传失败: ${imagePath} - ${error}`);
			// 继续处理其他图片，不中断流程
		}
	}

	return { html: updatedHtml, firstLocalImagePath };
}

/**
 * 发布文章到草稿箱
 */
export async function publishArticle(
	title: string,
	content: string,
	thumbMediaId: string,
	accessToken: string,
	author?: string,
	digest?: string,
): Promise<ArticlePublishResponse> {
	const url = `${API_BASE}/draft/add?access_token=${accessToken}`;

	const data = await httpPost(url, {
		articles: [
			{
				title,
				content,
				thumb_media_id: thumbMediaId,
				author: author || "",
				digest: digest || "",
				show_cover_pic: 1,
			},
		],
	}) as ArticlePublishResponse;

	if (data.errcode && data.errcode !== 0) {
		throw new Error(`发布文章失败: ${data.errcode} - ${data.errmsg}`);
	}

	return data;
}

/**
 * 完整的发布流程
 */
export async function publishToWechat(
	title: string,
	htmlContent: string,
	coverImageBuffer: ArrayBuffer | undefined,
	coverFilename: string | undefined,
	options: PublishOptions,
	author?: string,
	digest?: string,
): Promise<ArticlePublishResponse> {
	const { appId, appSecret, basePath, defaultCoverPath, pluginPath } = options;

	// 1. 获取 Access Token
	const { access_token } = await getAccessToken(appId, appSecret);

	// 2. 上传正文中的图片
	console.log("\n正在处理正文中的图片...");
	const { html: updatedHtmlContent, firstLocalImagePath } = await uploadContentImages(
		htmlContent,
		access_token,
		basePath,
	);

	// 3. 确定封面图
	let finalCoverBuffer = coverImageBuffer;
	let finalCoverFilename = coverFilename;

	if (!finalCoverBuffer && firstLocalImagePath) {
		// 如果没有指定封面图，使用正文中的第一张图片
		console.log("\n使用正文中的第一张图片作为封面...");
		try {
			const imageBuffer = readFileSync(firstLocalImagePath);
			finalCoverBuffer = new Uint8Array(imageBuffer).buffer;
			finalCoverFilename = firstLocalImagePath.split(/[/\\]/).pop() || "cover.jpg";
		} catch (error) {
			console.error(`无法读取第一张图片: ${error}`);
		}
	}

	// 如果仍然没有封面图，尝试使用默认封面图
	if (!finalCoverBuffer) {
		// 构建默认封面图查找路径列表（按优先级排序）
		const defaultCoverPaths: string[] = [];

		// 用户配置的默认封面路径（优先级最高）
		if (defaultCoverPath) {
			defaultCoverPaths.push(resolve(defaultCoverPath));
		}

		// 插件 assets 目录的默认封面（备选）
		defaultCoverPaths.push(
			join(pluginPath, "assets", "default-cover.jpg"),
			join(pluginPath, "assets", "default-cover.png")
		);

		for (const coverPath of defaultCoverPaths) {
			if (existsSync(coverPath)) {
				console.log(`\n使用默认封面图: ${coverPath}`);
				try {
					const imageBuffer = readFileSync(coverPath);
					finalCoverBuffer = new Uint8Array(imageBuffer).buffer;
					finalCoverFilename = coverPath.split(/[/\\]/).pop() || "default-cover.jpg";
					break;
				} catch (error) {
					console.error(`无法读取默认封面图: ${error}`);
				}
			}
		}
	}

	if (!finalCoverBuffer) {
		throw new Error(
			"缺少封面图。微信公众号要求必须提供封面图。\n" +
				"请选择以下方式之一：\n" +
				"  1. 在 Front Matter 中指定 cover 字段\n" +
				"  2. 在正文中至少包含一张本地图片\n" +
				"  3. 在插件设置中配置默认封面图路径\n\n" +
				"参考文档：assets/README.md",
		);
	}

	// 4. 上传封面图
	console.log("\n正在上传封面图...");
	const { media_id } = await uploadImage(finalCoverBuffer, finalCoverFilename || "cover.jpg", access_token);
	console.log(`✓ 封面图上传成功`);

	// 5. 发布文章
	console.log("\n正在发布到草稿箱...");
	return await publishArticle(title, updatedHtmlContent, media_id, access_token, author, digest);
}
