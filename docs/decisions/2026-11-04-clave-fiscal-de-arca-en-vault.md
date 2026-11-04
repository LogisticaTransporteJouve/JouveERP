# 2026-11-04 — Clave fiscal de ARCA en Vault

**Decisión.** El usuario de ARCA con el que se baja Mis Comprobantes →
Recibidos se guarda en `arca_web_account` (una fila: CUIT y estado) y su
clave fiscal en Supabase Vault. La cargan y cambian owner y admin desde Admin
→ AFIP; nadie la vuelve a ver. Solo el service role la lee, en el paso del job
que inicia sesión. Si ARCA la rechaza, queda «rechazada» y no se vuelve a
intentar hasta que alguien la cambie (para no bloquear el usuario).

**Por qué.** La clave cambia sin deploy y no queda en variables de entorno ni
en logs.

**Descartado.** Variables de entorno en Vercel (cambiarla pide un deploy y la
ve quien ve el proyecto); guardarla en una columna cifrada propia (Vault ya lo
hace y no hay que manejar la llave).
