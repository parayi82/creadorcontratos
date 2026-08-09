-- ════════════════════════════════════════════════════════════════
-- ARREGLO: las 4 cuentas demo se crearon con el dominio interno viejo
-- (@clm.mx) y el código ahora busca @clicklaboral.mx — por eso el
-- login de demo dejó de funcionar. Esto actualiza el correo de Auth
-- de cada una para que coincida con el dominio nuevo.
-- ════════════════════════════════════════════════════════════════

UPDATE auth.users SET email = 'din800101aaa@clicklaboral.mx', raw_user_meta_data = raw_user_meta_data
  WHERE email = 'din800101aaa@clm.mx';
UPDATE auth.users SET email = 'mtj750515bbb@clicklaboral.mx'
  WHERE email = 'mtj750515bbb@clm.mx';
UPDATE auth.users SET email = 'amd190501ddd@clicklaboral.mx'
  WHERE email = 'amd190501ddd@clm.mx';
UPDATE auth.users SET email = 'ref901230ccc@clicklaboral.mx'
  WHERE email = 'ref901230ccc@clm.mx';

-- Verifica que haya quedado bien (deben aparecer las 4 con @clicklaboral.mx):
SELECT email, raw_user_meta_data->>'rfc' AS rfc FROM auth.users WHERE email LIKE '%@clicklaboral.mx';
