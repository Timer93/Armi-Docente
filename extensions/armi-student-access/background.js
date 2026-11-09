import { createController } from './controller.js';
const controller = createController(chrome);
const alarmName = 'armi-policy-sync';
const badge = async () => {
  const state = await controller.status();
  await chrome.action.setBadgeText({ text: state.state === 'applied' ? '✓' : state.paired ? '!' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: state.state === 'applied' ? '#059669' : '#d97706' });
};
const ensureAlarm = async () => {
  if (!(await chrome.alarms.get(alarmName))) await chrome.alarms.create(alarmName, { periodInMinutes: 0.5 });
};
const synchronize = async () => { await controller.sync(); await badge(); };
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm().then(synchronize).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm().then(synchronize).catch(console.error); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === alarmName) void synchronize().catch(console.error); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  (async () => {
    if (message?.type === 'pair') await controller.pair(message.serverUrl, message.code);
    else if (message?.type === 'sync' || message?.type === 'status') await controller.sync();
    else if (message?.type !== 'status') throw new Error('Solicitud no reconocida.');
    await badge();
    return controller.status();
  })().then(data => reply({ success: true, data }), error => reply({ success: false, message: error.message }));
  return true;
});
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error);
void ensureAlarm().catch(console.error);
