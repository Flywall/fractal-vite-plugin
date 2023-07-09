import fs from 'fs'
import { AddressInfo } from 'net'
import { fileURLToPath } from 'url'
import path from 'path'
import { Plugin, UserConfig, ConfigEnv, ResolvedConfig, loadEnv, PluginOption } from 'vite'
import fullReload, { Config as FullReloadConfig } from 'vite-plugin-full-reload'

interface PluginConfig {
    /**
     * The path or paths of the entry points to compile.
     */
    input: string|string[]

    /**
     * Fractal's public directory.
     *
     * @default 'public'
     */
    publicDirectory?: string

    /**
     * The public subdirectory where compiled assets should be written.
     *
     * @default 'build'
     */
    buildDirectory?: string

    /**
     * The path to the "hot" file.
     *
     * @default `${publicDirectory}/hot`
     */
    hotFile?: string

    /**
     * The path of the SSR entry point.
     */
    ssr?: string|string[]

    /**
     * The directory where the SSR bundle should be written.
     *
     * @default 'bootstrap/ssr'
     */
    ssrOutputDirectory?: string

    /**
     * Configuration for performing full page refresh on blade (or other) file changes.
     *
     * {@link https://github.com/ElMassimo/vite-plugin-full-reload}
     * @default false
     */
    refresh?: boolean|string|string[]|RefreshConfig|RefreshConfig[]

    /**
     * Utilise the valet TLS certificates.
     *
     * @default false
     */
    valetTls?: string|boolean,

    /**
     * Transform the code while serving.
     */
    transformOnServe?: (code: string, url: DevServerUrl) => string,
}

interface FractalPlugin extends Plugin {
    config: (config: UserConfig, env: ConfigEnv) => UserConfig
}

interface RefreshConfig {
    paths: string[],
    config?: FullReloadConfig,
}

type DevServerUrl = `${'http'|'https'}://${string}:${number}`

let exitHandlersBound = false

export const refreshPaths = [
    'src/**'
]

export default function fractal(config: string|string[]|PluginConfig): [FractalPlugin, ...Plugin[]] {
    const pluginConfig = resolvePluginConfig(config)

    return [
        resolveFractalPlugin(pluginConfig),
        ...resolveFullReloadConfig(pluginConfig) as Plugin[],
    ]
}

function resolveFullReloadConfig({ refresh: config }: Required<PluginConfig>): PluginOption[]{
    if (typeof config === 'boolean') {
        return [];
    }

    if (typeof config === 'string') {
        config = [{ paths: [config]}]
    }

    if (! Array.isArray(config)) {
        config = [config]
    }

    if (config.some(c => typeof c === 'string')) {
        config = [{ paths: config }] as RefreshConfig[]
    }

    return (config as RefreshConfig[]).flatMap(c => {
        const plugin = fullReload(c.paths, c.config)

        /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
        /** @ts-ignore */
        plugin.__fractal_plugin_config = c

        return plugin
    })
}

function resolveBase(config: Required<PluginConfig>, assetUrl: string): string {
    return assetUrl + (! assetUrl.endsWith('/') ? '/' : '') + config.buildDirectory + '/'
}

function resolveInput(config: Required<PluginConfig>, ssr: boolean): string|string[]|undefined {
    if (ssr) {
        return config.ssr
    }

    return config.input
}

function resolveOutDir(config: Required<PluginConfig>, ssr: boolean): string|undefined {
    if (ssr) {
        return config.ssrOutputDirectory
    }

    return path.join(config.publicDirectory, config.buildDirectory)
}

function resolveFractalPlugin(pluginConfig: Required<PluginConfig>): FractalPlugin {
    let viteDevServerUrl: DevServerUrl
    let resolvedConfig: ResolvedConfig

    const defaultAliases: Record<string, string> = {
        '@': '/src/js',
    };

    return {
        name: 'fractal',
        enforce: 'post',
        config: (userConfig, { command, mode }) => {
            const ssr = !! userConfig.build?.ssr
            const env = loadEnv(mode, userConfig.envDir || process.cwd(), '')
            const assetUrl = ''

            return {
                base: userConfig.base ?? (command === 'build' ? resolveBase(pluginConfig, assetUrl) : ''),
                publicDir: userConfig.publicDir ?? false,
                build: {
                    manifest: userConfig.build?.manifest ?? !ssr,
                    outDir: userConfig.build?.outDir ?? resolveOutDir(pluginConfig, ssr),
                    rollupOptions: {
                        input: userConfig.build?.rollupOptions?.input ?? resolveInput(pluginConfig, ssr)
                    },
                    assetsInlineLimit: userConfig.build?.assetsInlineLimit ?? 0,
                },
                server: {
                    origin: userConfig.server?.origin ?? '__fractal_vite_placeholder__',
                },
                resolve: {
                    alias: Array.isArray(userConfig.resolve?.alias)
                        ? [
                            ...userConfig.resolve?.alias ?? [],
                            ...Object.keys(defaultAliases).map(alias => ({
                                find: alias,
                                replacement: defaultAliases[alias]
                            }))
                        ]
                        : {
                            ...defaultAliases,
                            ...userConfig.resolve?.alias,
                        }
                },
                // ssr: {
                //     noExternal: noExternalInertiaHelpers(userConfig),
                // },
            }
        },
        configResolved(config) {
            resolvedConfig = config
        },
        transform(code) {
            if (resolvedConfig.command === 'serve') {
                code = code.replace(/__fractal_vite_placeholder/g, viteDevServerUrl)

                return pluginConfig.transformOnServe(code, viteDevServerUrl)
            }
        },
        configureServer(server) {
            server.httpServer?.once('listening', () => {
                const address = server.httpServer?.address()

                const isAddressInfo = (x: string|AddressInfo|null|undefined): x is AddressInfo => typeof x === 'object'
                if (isAddressInfo(address)) {
                    viteDevServerUrl = resolveDevServerUrl(address, server.config)
                    fs.writeFileSync(pluginConfig.hotFile, viteDevServerUrl)
                }
            })

            if (! exitHandlersBound) {
                const clean = () => {
                    if (fs.existsSync(pluginConfig.hotFile)) {
                        fs.rmSync(pluginConfig.hotFile)
                    }
                }

                process.on('exit', clean)
                process.on('SIGINT', process.exit)
                process.on('SIGTERM', process.exit)
                process.on('SIGHUP', process.exit)

                exitHandlersBound = true
            }

            return () => server.middlewares.use((req, res, next) => {
                if (req.url === '/index.html') {
                    res.statusCode = 404

                    res.end(
                        fs.readFileSync(path.join(dirname(), 'vite-dev-server.html')).toString()
                    )
                }

                next()
            })
        }
    }
}

/**
 * Resolve the dev server URL from the server address and configuration.
 */
function resolveDevServerUrl(address: AddressInfo, config: ResolvedConfig): DevServerUrl {
    const configHmrProtocol = typeof config.server.hmr === 'object' ? config.server.hmr.protocol : null
    const clientProtocol = configHmrProtocol ? (configHmrProtocol === 'wss' ? 'https' : 'http') : null
    const serverProtocol = config.server.https ? 'https' : 'http'
    const protocol = clientProtocol ?? serverProtocol

    const configHmrHost = typeof config.server.hmr === 'object' ? config.server.hmr.host : null
    const configHost = typeof config.server.host === 'string' ? config.server.host : null
    const serverAddress = isIpv6(address) ? `[${address.address}]` : address.address
    const host = configHmrHost ?? configHost ?? serverAddress

    const configHmrClientPort = typeof config.server.hmr === 'object' ? config.server.hmr.clientPort : null
    const port = configHmrClientPort ?? address.port

    return `${protocol}://${host}:${port}`
}

function resolvePluginConfig(config: string|string[]|PluginConfig): Required<PluginConfig> {
    if (typeof config === 'undefined')
        throw new Error('fractal-vite-plugin: missing configuration.');

    if (typeof config === 'string' || Array.isArray(config))
        config = { input: config, ssr: config }
        
    if (typeof config.input === 'undefined')
        throw new Error('fractal-vite-plugin: missing configuration for "input".');

    if (typeof config.publicDirectory === 'string') {
        config.publicDirectory = config.publicDirectory.trim().replace(/^\/+/, '')

        if (config.publicDirectory === '')
            throw new Error('fractal-vite-plugin: publicDirectory must be a subdirectory. E.g. \'public\'.')
            
    }

    if (typeof config.buildDirectory === 'string') {
        config.buildDirectory.trim().replace(/^\/+/, '').replace(/\/+$/, '')

        if (config.buildDirectory === '')
            throw new Error('fractal-vite-plugin: buildDirectory must be a subdirectory. E.g. \'build\'.')
            
    }

    if (typeof config.ssrOutputDirectory === 'string')
        config.ssrOutputDirectory = config.ssrOutputDirectory.trim().replace(/^\/+/, '').replace(/\/+$/, '')

    if (config.refresh === true)
        config.refresh = [{ paths: refreshPaths }]
        
    return {
        input: config.input,
        publicDirectory: config.publicDirectory ?? 'public',
        buildDirectory: config.buildDirectory ?? 'build',
        ssr: config.ssr ?? config.input,
        ssrOutputDirectory: config.ssrOutputDirectory ?? 'bootstrap/ssr',
        refresh: config.refresh ?? false,
        hotFile: config.hotFile ?? path.join((config.publicDirectory ?? 'public'), 'hot'),
        valetTls: config.valetTls ?? false,
        transformOnServe: config.transformOnServe ?? ((code) => code),
    }
}


function isIpv6(address: AddressInfo): boolean {
    return address.family === 'IPv6'
        // In node >=18.0 <18.4 this was an integer value. This was changed in a minor version.
        // See: https://github.com/laravel/vite-plugin/issues/103
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore-next-line
        || address.family === 6;
}

/**
 * The directory of the current file.
 */
function dirname(): string {
    return fileURLToPath(new URL('.', import.meta.url))
}