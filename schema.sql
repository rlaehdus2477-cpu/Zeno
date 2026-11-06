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
