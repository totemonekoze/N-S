import { getUiLanguage, translate, translateProgress } from './i18n.js';

const status = document.querySelector('#status');
const cancel = document.querySelector('#cancel');
const language = await getUiLanguage();
const t = (key, values) => translate(language, key, values);
document.documentElement.lang = language;
status.textContent = t('preparingSearch');
cancel.textContent = t('cancelBuild');

async function refreshStatus() {
  const build = await chrome.runtime.sendMessage({ type: 'GET_BUILD_STATUS' });
  if (!build?.active) {
    status.textContent = t('operationFinished');
    cancel.disabled = true;
    return;
  }
  status.textContent = translateProgress(language, build);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'BUILD_PROGRESS') return;
  status.textContent = translateProgress(language, message);
  if (message.state === 'complete' || message.state === 'cancelled') cancel.disabled = true;
});

cancel.addEventListener('click', async () => {
  cancel.disabled = true;
  status.textContent = t('cancelling');
  await chrome.runtime.sendMessage({ type: 'CANCEL_BUILD' });
});

refreshStatus();
