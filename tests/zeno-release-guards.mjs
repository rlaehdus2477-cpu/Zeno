// ZENO release regressions: protect the 2026-11-18 owner home and verified clinic facts.
// Read-only checks. No network, secrets, runtime DB, or modifications to user data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const owner = readFileSync(new URL('../owner.html', import.meta.url), 'utf8');
const hospital = readFileSync(new URL('../hospital.html', import.meta.url), 'utf8');
function hospitals(source, label) {
  const token = 'const HOSPITALS=';
  const start = source.indexOf(token);
  assert.ok(start >= 0, label + ': HOSPITALS must exist');
  const begin = start + token.length;
  const end = source.indexOf(';\n', begin);
  assert.ok(end > begin, label + ': HOSPITALS closing delimiter');
  const list = JSON.parse(source.slice(begin, end));
  assert.equal(list.length, 62, label + ': do not silently lose a clinic');
  assert.equal(new Set(list.map(x => x.id)).size, 62, label + ': unique clinic IDs');
  return list;
}
const a = hospitals(owner, 'owner');
const b = hospitals(hospital, 'hospital');
assert.deepEqual(a.map(x => x.id), b.map(x => x.id), 'owner/hospital clinic identities and order must match');

function get(list, id) {
  const result = list.find(x => x.id === id);
  assert.ok(result, 'missing clinic ' + id);
  return result;
}
const weekdays = ['월','화','수','목','금','토','일'];
for (const [id, hours, breakTime, reception] of [
  ['tnd', '10:00~19:30', '13:00~14:00', '19:00'],
  ['naeum','09:30~24:00', '12:30~13:30','23:30'],
]) {
  for (const list of [a,b]) {
    const h = get(list,id);
    assert.ok(weekdays.every(day => h.weeklySchedule?.[day] === hours), id + ': published opening hours');
    assert.ok(weekdays.every(day => h.receptionDeadlines?.[day] === reception), id + ': published intake cutoff');
    assert.ok(h.breakSchedule?.월?.includes(breakTime), id + ': published break time');
    assert.equal(h.hoursVerificationStatus, 'naver-place-screenshot', id + ': source evidence classification');
  }
}
for (const list of [a,b]) {
  const soo = get(list,'soo');
  for (const d of ['월','화','목','금']) assert.equal(soo.weeklySchedule?.[d], '10:00~18:00');
  assert.equal(soo.weeklySchedule?.수, '휴진');
  assert.equal(soo.weeklySchedule?.토, '10:00~15:00');
  assert.equal(soo.weeklySchedule?.일, '휴진');
  assert.equal(soo.receptionDeadlines?.토, '14:30');
  assert.equal(soo.publishedCareFields?.length, 10, 'Soo NAVER published departments');
  assert.equal(soo.publishedExoticSpecies?.length, 7, 'Soo NAVER exotic species');
  assert.equal(soo.publishedCareDiseases?.length, 15, 'Soo NAVER diseases and procedures');
}
function functionBody(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  const next = source.indexOf('\nfunction ', start + 12);
  assert.ok(next > start, name + ' boundaries');
  return source.slice(start, next);
}
const home = functionBody(owner, 'zenoHomeOperatingRail');
assert.match(home, /const cards=open\.map\(/, 'keep Nov 18 single open-clinic carousel');
assert.match(home, /더 많은 병원 찾기/, 'keep the original browse-more card');
assert.match(home, /data-action="show-all-hospitals"/, 'keep the browse-all action');
assert.doesNotMatch(home, /const others\s*=|zeno-home-other-heading|data-rail="other"/, 'do not restore the unwanted second carousel');
assert.doesNotMatch(home, /다른 병원.*곳|zeno-home-open-count/, 'do not restore the unwanted counts');
assert.match(owner, /function zenoBookingFlow\(/, 'booking must remain in owner');
assert.match(owner, /function zenoProvidedClinicalProfile\(/, 'NAVER care fields must remain visible');
assert.match(owner, /\['soo','pub046'\]\.includes\(h\.id\)/, 'Soo exotic species must remain visible');
assert.match(owner, /zenoPublishedStatusMarkup/, 'hospital status display must remain separate from hours');
assert.match(owner, /function zenoHomeWithinPublishedHours\(/, 'open-now must remain time gated');
console.log('PASS ZENO regression guards: Nov 18 home, 62 clinics, Soo/TND/Naeum hours, booking and care UI.');
