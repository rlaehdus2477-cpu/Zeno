-- ZENO MVP D1 schema
CREATE TABLE IF NOT EXISTS hospital_settings (
  hospital_id TEXT PRIMARY KEY CHECK(hospital_id IN ('soo','naeum','tnd')),
  status TEXT NOT NULL DEFAULT 'check',
  notice TEXT NOT NULL DEFAULT '',
  emergency INTEGER NOT NULL DEFAULT 0,
  prices TEXT NOT NULL DEFAULT '[]',
  services TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  pet_name TEXT NOT NULL,
  species TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  service TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  proposed_at TEXT NOT NULL DEFAULT '',
  hospital_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_owner ON bookings(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_hospital ON bookings(hospital_id,created_at DESC);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  pet_name TEXT NOT NULL,
  text TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_owner ON questions(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS questions_hospital ON questions(hospital_id,created_at DESC);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  booking_id TEXT NOT NULL UNIQUE,
  hospital_id TEXT NOT NULL,
  stars INTEGER NOT NULL,
  text TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_owner ON reviews(owner_id,created_at DESC);


-- ZENO authenticated owners and controlled login attempts
CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{"pets":[],"records":[],"favorites":[]}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS owners_name ON owners(username);
CREATE TABLE IF NOT EXISTS login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

-- Optional guardian/patient details. Existing bookings are preserved.
CREATE TABLE IF NOT EXISTS booking_details (
 booking_id TEXT PRIMARY KEY,
 owner_phone TEXT NOT NULL DEFAULT '',
 breed TEXT NOT NULL DEFAULT '',
 age TEXT NOT NULL DEFAULT '',
 weight TEXT NOT NULL DEFAULT '',
 visit_type TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
);

-- Hospital state and submitted corrections, without deleting existing data.
CREATE TABLE IF NOT EXISTS hospital_operational_status (
 hospital_id TEXT PRIMARY KEY,
 emergency_status TEXT NOT NULL DEFAULT 'check',
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hospital_change_requests (
 id TEXT PRIMARY KEY,
 hospital_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL,
 reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS hospital_change_requests_by_hospital ON hospital_change_requests(hospital_id,created_at DESC);

-- Separately stored, hospital-declared representative specialties.
-- Status changes to '확인됨' are never performed by the hospital app.
CREATE TABLE IF NOT EXISTS hospital_specialty_keywords (
 hospital_id TEXT NOT NULL,
 keyword TEXT NOT NULL,
 position INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT '병원 안내' CHECK(status IN ('병원 안내','확인됨')),
 evidence_url TEXT NOT NULL DEFAULT '',
 registered_at TEXT NOT NULL,
 saved_at TEXT NOT NULL,
 last_checked_at TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 PRIMARY KEY(hospital_id,keyword)
);
CREATE INDEX IF NOT EXISTS hospital_specialty_keywords_active
 ON hospital_specialty_keywords(hospital_id,is_active,position);

CREATE TABLE IF NOT EXISTS hospital_specialty_evidence (
  hospital_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  approved_type TEXT NOT NULL DEFAULT '',
  approved_issuer TEXT NOT NULL DEFAULT '',
  approved_url TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  PRIMARY KEY(hospital_id,keyword)
);

-- Cached coordinates from NAVER Maps Geocoding; never stores a guardian's GPS.
CREATE TABLE IF NOT EXISTS hospital_geo_cache (
 hospital_id TEXT PRIMARY KEY,
 address TEXT NOT NULL,
 lat REAL,
 lon REAL,
 updated_at TEXT NOT NULL
);

-- 수의사 Q&A (2026-11-18): 공개 질문 + 제휴 병원 수의사 답변. 기존 questions(진료 전 질문)와 별개.
CREATE TABLE IF NOT EXISTS vetqa_questions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  species TEXT NOT NULL,
  field TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vetqa_questions_created ON vetqa_questions(status,created_at DESC);
CREATE INDEX IF NOT EXISTS vetqa_questions_owner ON vetqa_questions(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS vetqa_answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  vet_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(question_id,hospital_id)
);
CREATE INDEX IF NOT EXISTS vetqa_answers_question ON vetqa_answers(question_id,created_at);

-- A home_ad debit is the placement itself. Its expiry never affects the balance.
CREATE TABLE IF NOT EXISTS hospital_point_entries (
  hospital_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reference TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (hospital_id, kind, reference),
  CHECK (
    (kind IN ('vetqa','previsit') AND points > 0 AND expires_at IS NULL) OR
    (kind = 'home_ad' AND points < 0 AND expires_at IS NOT NULL AND expires_at > created_at)
  )
);
CREATE INDEX IF NOT EXISTS hospital_point_history ON hospital_point_entries(hospital_id,created_at DESC);
CREATE INDEX IF NOT EXISTS hospital_home_ads ON hospital_point_entries(expires_at) WHERE kind='home_ad';

-- ZENO PASS (2026-11-26): 월 1,800원 멤버십. 시범 운영 중에는 결제가 없습니다(billing='pilot-free').
CREATE TABLE IF NOT EXISTS pass_memberships (
  owner_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active','cancelled')),
  plan TEXT NOT NULL DEFAULT 'monthly-1800',
  billing TEXT NOT NULL DEFAULT 'pilot-free',
  started_at TEXT NOT NULL,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pass_prefs (
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,kind)
);

-- PASS 01 처방식 재고 (병원 입력 상태만, 수량·EMR 연동 없음, 현장 결제)
CREATE TABLE IF NOT EXISTS rx_stock (
  hospital_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  form TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('in','low','ask','out')),
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(hospital_id,product_id)
);
CREATE TABLE IF NOT EXISTS rx_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  pet_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  owner_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled','picked_up')),
  available_qty INTEGER,
  visit_by TEXT NOT NULL DEFAULT '',
  hospital_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rx_requests_owner ON rx_requests(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS rx_requests_hospital ON rx_requests(hospital_id,created_at DESC);
CREATE TABLE IF NOT EXISTS rx_alerts (
  owner_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','notified')),
  created_at TEXT NOT NULL,
  notified_at TEXT,
  PRIMARY KEY(owner_id,hospital_id,product_id)
);
CREATE INDEX IF NOT EXISTS rx_alerts_product ON rx_alerts(hospital_id,product_id,status);
-- PASS 02 공개 진료비 통합 비교: 비교 설정은 pass_prefs(kind='fee-plan')에 저장 (가격 자료는 공개 가격표만 사용)
-- PASS 03 맞춤 영양 관리: 아이별 정보·입력 가격은 pass_prefs(kind='nutrition')에 저장, 사료 자료는 worker.js의 ZP_FEED_CATALOG(제조사 공식 페이지 확인값)

-- PASS 04 영수증 통합 관리: 사진은 본인만 조회(공개 주소 없음), 해지 후에도 열람·수정·삭제·내보내기 가능
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  pet_id TEXT NOT NULL,
  hospital_id TEXT NOT NULL DEFAULT '',
  hospital_name TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 100000000),
  items_json TEXT NOT NULL DEFAULT '[]',
  memo TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','photo')),
  ocr_status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_owner ON receipts(owner_id,visit_date DESC);
CREATE TABLE IF NOT EXISTS receipt_photos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  receipt_id TEXT,
  mime TEXT NOT NULL,
  image_data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipt_photos_owner ON receipt_photos(owner_id,receipt_id);
-- PASS 04 보완 (2026-11-27): 같은 날 여러 아이를 함께 진료받은 영수증 1장을 아이별 금액으로 나눠 저장
-- receipts.pet_id는 첫 번째 아이(예전 기록 호환), 행이 없는 예전 영수증은 pet_id 한 마리 = 총액
CREATE TABLE IF NOT EXISTS receipt_pets (
  receipt_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  pet_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 100000000),
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(receipt_id,pet_id)
);
CREATE INDEX IF NOT EXISTS receipt_pets_owner ON receipt_pets(owner_id,receipt_id);
-- PASS 03 보완 (2026-11-27): 일반 사료 41개(제조사 공식 자료) 추가, 아이별 하루 급여량·체형·활동량은 pass_prefs(kind='nutrition')에 저장
-- 입원·야간 관리 (2026-11-27): 24시간 진료·야간 수의사 상주·입원환자 관리는 서로 다른 항목으로 따로 저장
-- 병원용 앱에서 제휴 병원이 자기 병원만 저장(source='hospital', 보호자 화면에 '병원 직접 등록'으로 표시)
-- 행이 없는 병원·항목은 모두 'unknown'(미확인). 다른 항목(예: 24시간 진료)으로 자동 설정하지 않음
CREATE TABLE IF NOT EXISTS hospital_care_profiles (
  hospital_id TEXT PRIMARY KEY,
  inpatient TEXT NOT NULL DEFAULT 'unknown',
  night_vet TEXT NOT NULL DEFAULT 'unknown',
  night_staff TEXT NOT NULL DEFAULT 'unknown',
  care24 TEXT NOT NULL DEFAULT 'unknown',
  monitoring TEXT NOT NULL DEFAULT 'unknown',
  monitoring_note TEXT NOT NULL DEFAULT '',
  cat_ward TEXT NOT NULL DEFAULT 'unknown',
  icu TEXT NOT NULL DEFAULT 'unknown',
  night_surgery TEXT NOT NULL DEFAULT 'unknown',
  night_vet_hours TEXT NOT NULL DEFAULT '',
  check_interval TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'hospital' CHECK(source IN ('hospital')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
