import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { loadEnv } from "vite";
import fullReload from "vite-plugin-full-reload";
let exitHandlersBound = false;
const refreshPaths = [
  "src/**"
];
function fractal(config) {
  const pluginConfig = resolvePluginConfig(config);
  return [
    resolveFractalPlugin(pluginConfig),
    ...resolveFullReloadConfig(pluginConfig)
  ];
}
function resolveFullReloadConfig({ refresh: config }) {
  if (typeof config === "boolean") {
    return [];
  }
  if (typeof config === "string") {
    config = [{ paths: [config] }];
  }
  if (!Array.isArray(config)) {
    config = [config];
  }
  if (config.some((c) => typeof c === "string")) {
    config = [{ paths: config }];
  }
  return config.flatMap((c) => {
    const plugin = fullReload(c.paths, c.config);
    plugin.__fractal_plugin_config = c;
    return plugin;
  });
}
function resolveBase(config, assetUrl) {
  return assetUrl + (!assetUrl.endsWith("/") ? "/" : "") + config.buildDirectory + "/";
}
function resolveInput(config, ssr) {
  if (ssr) {
    return config.ssr;
  }
  return config.input;
}
function resolveOutDir(config, ssr) {
  if (ssr) {
    return config.ssrOutputDirectory;
  }
  return path.join(config.publicDirectory, config.buildDirectory);
}
function resolveFractalPlugin(pluginConfig) {
  let viteDevServerUrl;
  let resolvedConfig;
  const defaultAliases = {
    "@": "/src/js"
  };
  return {
    name: "fractal",
    enforce: "post",
    config: (userConfig, { command, mode }) => {
      const ssr = !!userConfig.build?.ssr;
      const env = loadEnv(mode, userConfig.envDir || process.cwd(), "");
      const assetUrl = "";
      return {
        base: userConfig.base ?? (command === "build" ? resolveBase(pluginConfig, assetUrl) : ""),
        publicDir: userConfig.publicDir ?? false,
        build: {
          manifest: userConfig.build?.manifest ?? !ssr,
          outDir: userConfig.build?.outDir ?? resolveOutDir(pluginConfig, ssr),
          rollupOptions: {
            input: userConfig.build?.rollupOptions?.input ?? resolveInput(pluginConfig, ssr)
          },
          assetsInlineLimit: userConfig.build?.assetsInlineLimit ?? 0
        },
        server: {
          origin: userConfig.server?.origin ?? "__fractal_vite_placeholder__"
        },
        resolve: {
          alias: Array.isArray(userConfig.resolve?.alias) ? [
            ...userConfig.resolve?.alias ?? [],
            ...Object.keys(defaultAliases).map((alias) => ({
              find: alias,
              replacement: defaultAliases[alias]
            }))
          ] : {
            ...defaultAliases,
            ...userConfig.resolve?.alias
          }
        }
        // ssr: {
        //     noExternal: noExternalInertiaHelpers(userConfig),
        // },
      };
    },
    configResolved(config) {
      resolvedConfig = config;
    },
    transform(code) {
      if (resolvedConfig.command === "serve") {
        code = code.replace(/__fractal_vite_placeholder/g, viteDevServerUrl);
        return pluginConfig.transformOnServe(code, viteDevServerUrl);
      }
    },
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        const isAddressInfo = (x) => typeof x === "object";
        if (isAddressInfo(address)) {
          viteDevServerUrl = resolveDevServerUrl(address, server.config);
          fs.writeFileSync(pluginConfig.hotFile, viteDevServerUrl);
        }
      });
      if (!exitHandlersBound) {
        const clean = () => {
          if (fs.existsSync(pluginConfig.hotFile)) {
            fs.rmSync(pluginConfig.hotFile);
          }
        };
        process.on("exit", clean);
        process.on("SIGINT", process.exit);
        process.on("SIGTERM", process.exit);
        process.on("SIGHUP", process.exit);
        exitHandlersBound = true;
      }
      return () => server.middlewares.use((req, res, next) => {
        if (req.url === "/index.html") {
          res.statusCode = 404;
          res.end(
            fs.readFileSync(path.join(dirname(), "vite-dev-server.html")).toString()
          );
        }
        next();
      });
    }
  };
}
function resolveDevServerUrl(address, config) {
  const configHmrProtocol = typeof config.server.hmr === "object" ? config.server.hmr.protocol : null;
  const clientProtocol = configHmrProtocol ? configHmrProtocol === "wss" ? "https" : "http" : null;
  const serverProtocol = config.server.https ? "https" : "http";
  const protocol = clientProtocol ?? serverProtocol;
  const configHmrHost = typeof config.server.hmr === "object" ? config.server.hmr.host : null;
  const configHost = typeof config.server.host === "string" ? config.server.host : null;
  const serverAddress = isIpv6(address) ? `[${address.address}]` : address.address;
  const host = configHmrHost ?? configHost ?? serverAddress;
  const configHmrClientPort = typeof config.server.hmr === "object" ? config.server.hmr.clientPort : null;
  const port = configHmrClientPort ?? address.port;
  return `${protocol}://${host}:${port}`;
}
function resolvePluginConfig(config) {
  if (typeof config === "undefined")
    throw new Error("fractal-vite-plugin: missing configuration.");
  if (typeof config === "string" || Array.isArray(config))
    config = { input: config, ssr: config };
  if (typeof config.input === "undefined")
    throw new Error('fractal-vite-plugin: missing configuration for "input".');
  if (typeof config.publicDirectory === "string") {
    config.publicDirectory = config.publicDirectory.trim().replace(/^\/+/, "");
    if (config.publicDirectory === "")
      throw new Error("fractal-vite-plugin: publicDirectory must be a subdirectory. E.g. 'public'.");
  }
  if (typeof config.buildDirectory === "string") {
    config.buildDirectory.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (config.buildDirectory === "")
      throw new Error("fractal-vite-plugin: buildDirectory must be a subdirectory. E.g. 'build'.");
  }
  if (typeof config.ssrOutputDirectory === "string")
    config.ssrOutputDirectory = config.ssrOutputDirectory.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (config.refresh === true)
    config.refresh = [{ paths: refreshPaths }];
  return {
    input: config.input,
    publicDirectory: config.publicDirectory ?? "public",
    buildDirectory: config.buildDirectory ?? "build",
    ssr: config.ssr ?? config.input,
    ssrOutputDirectory: config.ssrOutputDirectory ?? "bootstrap/ssr",
    refresh: config.refresh ?? false,
    hotFile: config.hotFile ?? path.join(config.publicDirectory ?? "public", "hot"),
    valetTls: config.valetTls ?? false,
    transformOnServe: config.transformOnServe ?? ((code) => code)
  };
}
function isIpv6(address) {
  return address.family === "IPv6" || address.family === 6;
}
function dirname() {
  return fileURLToPath(new URL(".", import.meta.url));
}
export {
  fractal as default,
  refreshPaths
};
