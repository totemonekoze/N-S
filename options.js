import { getLanguagePreference, getUiLanguage, setLanguagePreference, translate } from './i18n.js';

const languageSelect = document.querySelector('#language-select');
const saved = document.querySelector('#saved');
let language = await getUiLanguage();

function applyTranslations() {
  document.documentElement.lang = language;
  document.title = translate(language, 'settingsTitle');
  document.querySelector('#settings-title').textContent = translate(language, 'settingsTitle');
  document.querySelector('#language-description').textContent = translate(language, 'languageDescription');
  document.querySelector('#language-label').textContent = translate(language, 'language');
  languageSelect.options[0].textContent = translate(language, 'languageAuto');
  languageSelect.options[1].textContent = translate(language, 'languageJapanese');
  languageSelect.options[2].textContent = translate(language, 'languageEnglish');
}

languageSelect.value = await getLanguagePreference();
applyTranslations();

languageSelect.addEventListener('change', async () => {
  await setLanguagePreference(languageSelect.value);
  language = await getUiLanguage();
  applyTranslations();
  saved.textContent = translate(language, 'saved');
});
