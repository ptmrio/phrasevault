// Type declaration for locale files
interface LocaleModule {
  translation: Record<string, string>
}

declare const locale: LocaleModule
export default locale
