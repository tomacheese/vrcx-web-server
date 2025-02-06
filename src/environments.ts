// 環境変数を一元管理する
const defaultEnvironment = {
  API_HOST: '0.0.0.0',
  API_PORT: null,
  VRCX_SQLITE_FILEPATH: null,
}

type EnvironmentName = keyof typeof defaultEnvironment
const environmentNames = Object.keys(defaultEnvironment) as EnvironmentName[]

export const ENV = Object.fromEntries(
  environmentNames.map((name) => [
    name,
    process.env[name] ?? defaultEnvironment[name],
  ])
) as Record<EnvironmentName, string>
