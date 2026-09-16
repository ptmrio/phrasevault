// Type declarations for locale files
interface LocaleModule {
  translation: Record<string, string>
}

declare module '*.js' {
  const locale: LocaleModule
  export default locale
}
