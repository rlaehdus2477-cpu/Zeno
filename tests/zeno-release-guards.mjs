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
]) {
  for (const list of [a,b]) {
    const h = get(list,id);
    assert.ok(weekdays.every(day => h.weeklySchedule?.[day] === hours), id + ': published opening hours');
    assert.ok(weekdays.every(day => h.receptionDeadlines?.[day] === reception), id + ': published intake cutoff');
    assert.ok(h.breakSchedule?.월?.includes(breakTime), id + ': published break time');
    assert.equal(h.hoursVerificationStatus, 'naver-place-screenshot', id + ': source evidence classification');
  }
}
// Keep both public-facing apps on the same clinic facts; they share one dataset contract.
for (const sourceClinic of a) {
  const hospitalClinic = get(b, sourceClinic.id);
  for (const field of ['is24','weeklySchedule','breakSchedule','receptionDeadlines','hoursVerificationStatus','hours','declaredSpecialties','careFields']) {
    assert.deepEqual(hospitalClinic[field], sourceClinic[field], sourceClinic.id + ': owner/hospital ' + field + ' mismatch');
  }
}
for (const list of [a,b]) {
  const naeum = get(list,'naeum');
  assert.equal(naeum.is24,true,'Naeum must be categorized as 24-hour hospital');
  for (const day of [...weekdays,'공휴일']) {
    assert.equal(naeum.weeklySchedule?.[day],'24시간 진료 안내','Naeum must not inherit old general-care hours');
  }
  assert.equal(Object.keys(naeum.breakSchedule||{}).length,0,'Naeum must not inherit previous lunch break as global 24h closure');
  assert.equal(Object.keys(naeum.receptionDeadlines||{}).length,0,'Naeum must not inherit previous 23:30 global closing time');
  assert.equal(naeum.hoursVerificationStatus,'hospital-official','Naeum official source classification');
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
const defaultSearch = Function('HOSPITALS','state','zenoWaitingQuery','zenoActiveFilters',
  functionBody(owner,'zenoPartnerFirst')+'\n'+functionBody(owner,'filteredHospitals')+'\nreturn filteredHospitals();'
);
const listed = defaultSearch(Object.freeze([...a]), {query:''}, () => ({text:''}), () => []);
assert.deepEqual(listed.map(h => h.id), [...a.filter(h => h.linked), ...a.filter(h => !h.linked)].map(h => h.id),
  'default search must put partners first and retain all other clinics in their original order');

const home = functionBody(owner, 'zenoHomeOperatingRail');
assert.match(home, /const cards=open\.map\(/, 'keep Nov 18 single open-clinic carousel');
assert.match(home, /더 많은 병원 찾기/, 'keep the original browse-more card');
assert.match(home, /data-action="show-all-hospitals"/, 'keep the browse-all action');
assert.doesNotMatch(home, /const others\s*=|zeno-home-other-heading|data-rail="other"/, 'do not restore the unwanted second carousel');
assert.doesNotMatch(home, /다른 병원.*곳|zeno-home-open-count/, 'do not restore the unwanted counts');
assert.match(owner, /function zenoBookingFlow\(/, 'booking must remain in owner');
assert.match(owner, /function zenoProvidedClinicalProfile\(/, 'NAVER care fields must remain visible');
const renderClinicalProfile = Function('e','zenoRepresentativeSpecialtySection','zenoCareSourceLink','zenoExoticCareMarkup',
  functionBody(owner,'zenoProvidedClinicalProfile')+'\nreturn zenoProvidedClinicalProfile;'
)(String, () => '', () => '', () => '');
for (const id of ['soo','pub046']) {
  const clinic = get(a,id);
  const speciesSection = renderClinicalProfile(clinic).match(/<h3>주요 진료 대상<\/h3>([\s\S]*?)<\/section>/)?.[1];
  for (const species of clinic.publishedExoticSpecies) {
    assert.ok(speciesSection?.includes('>'+species+'</span>'), id+' clinic profile must show '+species);
  }
}
assert.match(owner, /zenoPublishedStatusMarkup/, 'hospital status display must remain separate from hours');
assert.match(owner, /function zenoHomeWithinPublishedHours\(/, 'open-now must remain time gated');

// Exercise the real production open-now functions at fixed Korean local times.
// Only public, user-supplied NAVER facts are used; no live hospital status is inferred.
const statusFunctions = [
  'zenoSeoulClock','zenoScheduleSpan','zenoWeeklyData','zenoProvisionalHoursRecent','zenoStatusSchedule','zenoBreakAt',
  'zenoReceptionClosedAt','zenoHomeHoursVerified','zenoHomeWithinPublishedHours'
].map(name => functionBody(owner,name)).join('\n');
const {zenoHomeWithinPublishedHours} =
  Function(statusFunctions+'\nreturn {zenoHomeWithinPublishedHours};')();
const on = (id, dateTime) => zenoHomeWithinPublishedHours(
  get(a,id), new Date(dateTime + '+09:00')
);
for (const [label,id,time,expected] of [
 ['TND working Thursday','tnd','2026-11-19T12:00:00',true],
 ['TND lunch break','tnd','2026-11-19T13:30:00',false],
 ['TND after lunch','tnd','2026-11-19T14:30:00',true],
 ['TND intake cutoff','tnd','2026-11-19T19:01:00',false],
 ['Soo open Thursday','soo','2026-11-19T11:00:00',true],
 ['Soo break Thursday','soo','2026-11-19T13:00:00',false],
 ['Soo intake cutoff','soo','2026-11-19T17:40:00',false],
 ['Soo Wednesday closed','soo','2026-11-18T11:00:00',false],
 ['Soo Saturday cutoff','soo','2026-11-21T14:35:00',false],
 ['Naeum evening 24h','naeum','2026-11-20T17:30:00',true],
 ['Naeum evening clinic','naeum','2026-11-20T18:30:00',true],
 ['Naeum 23:40 24h','naeum','2026-11-20T23:40:00',true],
 ['Naeum after midnight','naeum','2026-11-20T00:15:00',true],
 ['Naeum Sunday night','naeum','2026-11-22T03:20:00',true],
]) {
 assert.equal(on(id,time),expected,label+' must not mislead owners about opening or intake');
}

console.log('PASS ZENO regression guards: Nov 18 home, 62 clinics, Soo/TND/Naeum hours, booking and care UI.');
