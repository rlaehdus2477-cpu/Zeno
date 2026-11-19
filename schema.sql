-- ZENO MVP D1 schema
CREATE TABLE IF NOT EXISTS hospital_settings (
  hospital_id TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS hospital_staff (
 hospital_id TEXT NOT NULL, username TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 session_version TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 PRIMARY KEY(hospital_id,username));

CREATE TABLE IF NOT EXISTS removed_booking_submissions (
 booking_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS hospital_answer_reviews (
 id TEXT PRIMARY KEY, hospital_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('vetqa','previsit')),
 reference TEXT NOT NULL, owner_id TEXT NOT NULL, first_answer TEXT NOT NULL, created_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reviewed_at TEXT,
 UNIQUE(hospital_id,kind,reference));
CREATE INDEX IF NOT EXISTS removed_bookings_owner ON removed_booking_submissions(owner_id,created_at);
CREATE INDEX IF NOT EXISTS removed_bookings_expiry ON removed_booking_submissions(created_at);
CREATE INDEX IF NOT EXISTS answer_review_day ON hospital_answer_reviews(hospital_id,created_at);
CREATE INDEX IF NOT EXISTS answer_review_queue ON hospital_answer_reviews(status,created_at);
CREATE INDEX IF NOT EXISTS answer_review_owner ON hospital_answer_reviews(hospital_id,owner_id,created_at);
