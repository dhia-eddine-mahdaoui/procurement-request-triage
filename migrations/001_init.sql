-- Core schema: requests, their source documents, normalised risk flags and the audit log.

CREATE TABLE requests (
  id             text PRIMARY KEY,
  title          text NOT NULL,
  source_name    text NOT NULL,
  source_type    text NOT NULL CHECK (source_type IN ('pdf', 'text')),
  extractor      text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
  route          text NOT NULL CHECK (route IN ('requester', 'procurement', 'finance', 'legal')),
  risk_level     text NOT NULL CHECK (risk_level IN ('none', 'low', 'medium', 'high')),
  policy_version text NOT NULL,
  pages          jsonb NOT NULL,   -- [{page, paragraphs[]}]: parsed text, source of snippet highlighting
  terms          jsonb NOT NULL,   -- extracted terms, each {value, snippet, page}
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX requests_status_idx ON requests (status);
CREATE INDEX requests_route_idx ON requests (route);
CREATE INDEX requests_created_idx ON requests (created_at, id);

CREATE TABLE documents (
  request_id   text PRIMARY KEY REFERENCES requests (id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL,
  content      bytea NOT NULL
);

CREATE TABLE risk_flags (
  id         bigserial PRIMARY KEY,
  request_id text NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  rule_id    text NOT NULL,
  severity   text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  route      text NOT NULL,
  message    text NOT NULL
);

CREATE INDEX risk_flags_request_idx ON risk_flags (request_id);

CREATE TABLE audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigserial NOT NULL,
  request_id  text NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  reviewer    text NOT NULL,
  action      text NOT NULL CHECK (action IN ('approve', 'reject', 'request_changes')),
  from_status text NOT NULL,
  to_status   text NOT NULL,
  comment     text
);

CREATE INDEX audit_events_request_idx ON audit_events (request_id, seq);
