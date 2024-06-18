import i18n from 'i18next';
import en from '../locales/en.js';
import es from '../locales/es.js';
import pt from '../locales/pt.js';
import fr from '../locales/fr.js';
import de from '../locales/de.js';
import it from '../locales/it.js';

const resources = {
    en,
    es,
    pt,
    fr,
    de,
    it
};

i18n
    .init({
        debug: false,
        lng: 'en',  // default language
        resources
    });

// Extracting language keys from the resources object
export const availableLanguages = Object.keys(resources);

export default i18n;
