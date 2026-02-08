import { readFileSync } from "fs";
import { resolve, dirname } from "path";

// 导出 resolve 供其他模块使用
export { resolve };

/**
 * 读取文件内容
 */
export function readFile(filePath: string): string {
	try {
		return readFileSync(resolve(filePath), "utf-8");
	} catch (error) {
		throw new Error(`无法读取文件: ${filePath}`);
	}
}

/**
 * 读取二进制文件内容
 */
export function readFileBinary(filePath: string): Buffer {
	try {
		return readFileSync(resolve(filePath));
	} catch (error) {
		throw new Error(`无法读取文件: ${filePath}`);
	}
}

/**
 * 相对于基准文件解析路径
 * @param filePath 要解析的文件路径（可以是相对路径）
 * @param basePath 基准文件路径
 */
export function resolvePathRelativeTo(filePath: string, basePath: string): string {
	// 如果是绝对路径，直接返回
	if (resolve(filePath) === filePath) {
		return filePath;
	}
	// 否则相对于基准文件的目录解析
	const baseDir = dirname(resolve(basePath));
	return resolve(baseDir, filePath);
}
