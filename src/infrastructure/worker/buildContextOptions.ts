import type { BrowserContextOptions } from 'playwright'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'

type PartialSettings = Pick<StepSettings, 'contextOptions' | 'userAgent' | 'proxySettings'> | undefined

export function buildContextOptions(base: PartialSettings, override: PartialSettings): BrowserContextOptions {
  const userAgent = override?.userAgent ?? base?.userAgent
  const proxySettings = override?.proxySettings ?? base?.proxySettings

  return {
    ...(userAgent && { userAgent }),
    ...(proxySettings && {
      proxy: {
        server: `http://${proxySettings.host}:${proxySettings.port}`,
        username: proxySettings.username,
        password: proxySettings.password,
      },
    }),
    ...base?.contextOptions,
    ...override?.contextOptions,
  }
}
