import { execFileSync } from "node:child_process";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

// 커밋된 트리 해시는 GitHub 커밋과 그것을 게시하는 Sites 커밋에서 동일하다. 커밋 SHA는
// 두 저장소가 다르므로 트리만이 배포본의 신원이 된다. git이 없는 빌드 환경을 위해
// COLLECTIVE_SOURCE_TREE로 덮어쓸 수 있다.
function sourceTree(): string {
  const configured = process.env.COLLECTIVE_SOURCE_TREE;
  if (configured && /^[0-9a-f]{40}$/.test(configured)) return configured;
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    // vite는 디스크에 있는 것을 번들한다. 작업 트리가 더러우면 HEAD의 트리 해시가
    // 설명하지 못하는 코드가 배포되고 검증이 거짓 통과한다. 거짓 신원 대신 무신원으로 닫는다.
    if (git(["status", "--porcelain"]).trim() !== "") return "dirty";
    return git(["rev-parse", "HEAD^{tree}"]).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
    define: {
      __COLLECTIVE_BUILD_ID__: JSON.stringify(new Date().toISOString()),
      __COLLECTIVE_SOURCE_TREE__: JSON.stringify(sourceTree()),
    },
  };
});
