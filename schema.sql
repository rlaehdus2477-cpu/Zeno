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
