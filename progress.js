const status = document.querySelector('#status');
const cancel = document.querySelector('#cancel');

async function refreshStatus() {
  const build = await chrome.runtime.sendMessage({ type: 'GET_BUILD_STATUS' });
  if (!build?.active) {
    status.textContent = '作成処理は完了または中断されています。';
    cancel.disabled = true;
    return;
  }
  status.textContent = build.text || '一覧作成中…';
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'BUILD_PROGRESS') return;
  status.textContent = message.text;
  if (message.state === 'complete' || message.state === 'cancelled') cancel.disabled = true;
});

cancel.addEventListener('click', async () => {
  cancel.disabled = true;
  status.textContent = '中断しています…';
  await chrome.runtime.sendMessage({ type: 'CANCEL_BUILD' });
});

refreshStatus();
