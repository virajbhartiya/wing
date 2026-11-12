const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.cjs');

function twoProfiles(kind) {
  const state = M.initialState();
  state.profiles.push({ id: 'work', name: 'Work' });
  const [home] = state.spaces;
  const work = { id: 'space-work', name: 'Work', profileId: 'work', theme: 'lavender' };
  state.spaces.push(work);
  const make = (spaceId, url) => {
    const tab = M.newTab(spaceId, 'https://mail.example/');
    tab.kind = kind;
    tab.url = url;
    state.tabs.push(tab);
    return tab;
  };
  return { state, home, work, make };
}

for (const kind of ['favorite', 'pinned']) {
  test(`a ${kind} on its saved link opens where another Space left the site`, () => {
    const { state, home, work, make } = twoProfiles(kind);
    const left = make(home.id, 'https://mail.example/inbox/42');
    left.lastActive = 2000;
    const here = make(work.id, 'https://mail.example/');
    here.lastActive = 1000;
    M.resumeElsewhere(state, here.id);
    assert.equal(here.url, 'https://mail.example/inbox/42');
    assert.equal(left.url, 'https://mail.example/inbox/42');
  });

  test(`a ${kind} already moved, or newer than the other Space, keeps its page`, () => {
    const { state, home, work, make } = twoProfiles(kind);
    const left = make(home.id, 'https://mail.example/inbox/42');
    left.lastActive = 2000;
    const moved = make(work.id, 'https://mail.example/sent');
    moved.lastActive = 1000;
    M.resumeElsewhere(state, moved.id);
    assert.equal(moved.url, 'https://mail.example/sent');
    const newer = make(work.id, 'https://mail.example/');
    newer.lastActive = 3000;
    M.resumeElsewhere(state, newer.id);
    assert.equal(newer.url, 'https://mail.example/');
  });
}

test('only the same saved link in another profile, on that site and open, carries over', () => {
  const { state, home, work, make } = twoProfiles('favorite');
  const sameProfile = make(home.id, 'https://mail.example/inbox/1');
  sameProfile.lastActive = 2000;
  const offSite = make(work.id, 'https://other.example/x');
  offSite.homeURL = 'https://mail.example/';
  offSite.lastActive = 2000;
  const closed = make(work.id, 'https://mail.example/inbox/9');
  closed.closed = true;
  closed.lastActive = 2000;
  const otherLink = make(work.id, 'https://mail.example/inbox/7');
  otherLink.homeURL = 'https://mail.example/labels';
  otherLink.lastActive = 2000;
  const here = make(home.id, 'https://mail.example/');
  here.lastActive = 1000;
  M.resumeElsewhere(state, here.id);
  assert.equal(here.url, 'https://mail.example/');
});
