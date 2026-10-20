// Better Auth 的表（user、session、apikey、oauth…）建在 public；健康数据的 schema 和只读账号由 ../health.py init-db 负责。可重复运行。
import { execSync } from "node:child_process";

execSync("npx auth@latest migrate --yes", { stdio: "inherit" });
console.log("登录相关的表已就绪");
