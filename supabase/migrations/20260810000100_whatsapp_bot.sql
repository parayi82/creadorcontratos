-- WhatsApp bot conversation state
CREATE TABLE IF NOT EXISTS whatsapp_conversaciones (
  telefono        TEXT PRIMARY KEY,
  paso            TEXT NOT NULL DEFAULT 'inicio',
  datos           JSONB DEFAULT '{}',
  actualizado_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_actualizado
  ON whatsapp_conversaciones (actualizado_at);
