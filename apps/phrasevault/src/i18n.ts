import i18n from 'i18next'
import en from '../locales/en.js'
import es from '../locales/es.js'
import pt from '../locales/pt.js'
import fr from '../locales/fr.js'
import de from '../locales/de.js'
import it from '../locales/it.js'
import ja from '../locales/ja.js'

const resources = {
  en,
  es,
  pt,
  fr,
  de,
  it,
  ja,
}

i18n.init({
  debug: false,
  lng: 'en',
  resources,
})

export const availableLanguages = Object.keys(resources)

export default i18n
