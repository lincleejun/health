import { auth } from "@/lib/auth";

// OAuth 发现文档（授权服务器元数据、受保护资源元数据）由 Better Auth 生成，这里只是把请求转给它
export const GET = (request: Request) => auth.handler(request);
