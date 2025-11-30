const i18n = require("i18next");
const en = require("../locales/en.js");
const es = require("../locales/es.js");
const pt = require("../locales/pt.js");
const fr = require("../locales/fr.js");
const de = require("../locales/de.js");
const it = require("../locales/it.js");

const resources = {
    en,
    es,
    pt,
    fr,
    de,
    it,
};

i18n.init({
    debug: false,
    lng: "en", // default language
    resources,
});

// Extracting language keys from the resources object
const availableLanguages = Object.keys(resources);

module.exports = i18n;
module.exports.availableLanguages = availableLanguages;